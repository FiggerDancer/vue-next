import {
  ComponentInternalInstance,
  FunctionalComponent,
  Data,
  getComponentName
} from './component'
import {
  VNode,
  normalizeVNode,
  createVNode,
  Comment,
  cloneVNode,
  VNodeArrayChildren,
  isVNode,
  blockStack
} from './vnode'
import { handleError, ErrorCodes } from './errorHandling'
import { PatchFlags, ShapeFlags, isOn, isModelListener } from '@vue/shared'
import { warn } from './warning'
import { isHmrUpdating } from './hmr'
import { NormalizedProps } from './componentProps'
import { isEmitListener } from './componentEmits'
import { setCurrentRenderingInstance } from './componentRenderContext'
import {
  DeprecationTypes,
  isCompatEnabled,
  warnDeprecation
} from './compat/compatConfig'

/**
 * dev only flag to track whether $attrs was used during render.
 * If $attrs was used during render then the warning for failed attrs
 * fallthrough can be suppressed.
 * 开发者环境仅仅标记跟踪在渲染器中$attrs是否被用
 * 如果$attr在渲染器中使用，为错误的$attrs进行失败警告
 */
let accessedAttrs: boolean = false

/**
 * 标记使用了$attrs
 */
export function markAttrsAccessed() {
  accessedAttrs = true
}

type SetRootFn = ((root: VNode) => void) | undefined

/**
 * 渲染根组件
 * @param instance 
 * @returns 
 */
export function renderComponentRoot(
  instance: ComponentInternalInstance
): VNode {
  const {
    type: Component,
    vnode,
    proxy,
    withProxy,
    props,
    propsOptions: [propsOptions],
    slots,
    attrs,
    emit,
    render,
    renderCache,
    data,
    setupState,
    ctx,
    inheritAttrs
  } = instance

  let result
  let fallthroughAttrs
  // 设置渲染的实例，并返回上一次的值
  const prev = setCurrentRenderingInstance(instance)
  if (__DEV__) {
    // 开发者环境，默认将其设置为false
    // 没有使用$attrs标记
    accessedAttrs = false
  }

  try {
    // 有状态组件
    if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
      // withProxy is a proxy with a different `has` trap only for
      // runtime-compiled render functions using `with` block.
      // withProxy是一个只有不同的“has”陷阱的代理 
      // 运行时编译的渲染函数使用' with '块。
      const proxyToUse = withProxy || proxy
      // 序列化节点
      result = normalizeVNode(
        render!.call(
          proxyToUse,
          proxyToUse!,
          renderCache,
          props,
          setupState,
          data,
          ctx
        )
      )
      fallthroughAttrs = attrs
    } else {
      // functional
      // 函数式组件
      const render = Component as FunctionalComponent
      // in dev, mark attrs accessed if optional props (attrs === props)
      // 在开发者环境，标记$attrs被使用如果选项式props（attrs===props)
      if (__DEV__ && attrs === props) {
        // 标记attrs
        markAttrsAccessed()
      }
      // 序列化的虚拟节点
      result = normalizeVNode(
        // 渲染函数参数个数，超过1， 意味着$attr使用了
        // 则给一个访问器，用于访问$attrs
        render.length > 1
          ? render(
              props,
              __DEV__
                ? {
                    get attrs() {
                      markAttrsAccessed()
                      return attrs
                    },
                    slots,
                    emit
                  }
                : { attrs, slots, emit }
            )
            // 否则，我们可以明确的指导用户不需要attrs，这样减少消耗
          : render(props, null as any /* we know it doesn't need it */)
      )
      // 如果组件有props，则贯穿的$attrs就是$attrs，否则
      fallthroughAttrs = Component.props
        ? attrs
        : getFunctionalFallthrough(attrs)
    }
  } catch (err) {
    // 清空块栈
    blockStack.length = 0
    // 处理错误
    handleError(err, instance, ErrorCodes.RENDER_FUNCTION)
    // 渲染出错则渲染成一个注释节点
    result = createVNode(Comment)
  }

  // attr merging
  // in dev mode, comments are preserved, and it's possible for a template
  // to have comments along side the root element which makes it a fragment
  // $attr 合并
  // 在开发者模式，注释被保留， 
  // 并且它可能用于一个以注释为边缘的根元素，使其成为一个片段
  let root = result
  // 设置根
  let setRoot: SetRootFn = undefined
  // 如果是开发者环境，存在补丁标记，且补丁标记为开发者根片段
  if (
    __DEV__ &&
    result.patchFlag > 0 &&
    result.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
  ) {
    // 获取子节点的根元素，及设置根节点
    ;[root, setRoot] = getChildRoot(result)
  }

  // 存在贯穿的属性 且  继承属性不为false
  if (fallthroughAttrs && inheritAttrs !== false) {
    // 获取所有$attrs
    const keys = Object.keys(fallthroughAttrs)
    // 根节点类型标记
    const { shapeFlag } = root
    // 存在key
    if (keys.length) {
      // 节点类型为元素或者组件
      if (shapeFlag & (ShapeFlags.ELEMENT | ShapeFlags.COMPONENT)) {
        // props选项且keys中存在v-model
        if (propsOptions && keys.some(isModelListener)) {
          // If a v-model listener (onUpdate:xxx) has a corresponding declared
          // prop, it indicates this component expects to handle v-model and
          // it should not fallthrough.
          // related: #1543, #1643, #1989
          // 如果一个v-model监听器（onUpdate:xxx) 有一个相应的声明属性
          // 意味着这个组件期待处理v-model
          // 并且它不应该失败
          // 所以过滤掉它
          fallthroughAttrs = filterModelListeners(
            fallthroughAttrs,
            propsOptions
          )
        }
        // 克隆根节点，并给它贯穿的属性
        root = cloneVNode(root, fallthroughAttrs)
      } else if (__DEV__ && !accessedAttrs && root.type !== Comment) {
        // 开发者环境，没有使用$attrs且根节点不是注释
        // 获取所有attrs
        const allAttrs = Object.keys(attrs)
        // 事件attrs
        const eventAttrs: string[] = []
        // 其他的attrs
        const extraAttrs: string[] = []
        // 遍历所有的attrs
        for (let i = 0, l = allAttrs.length; i < l; i++) {
          // 获取key
          const key = allAttrs[i]
          // 如果key以on开头说明是事件监听器
          if (isOn(key)) {
            // ignore v-model handlers when they fail to fallthrough
            //  当v-model处理程序失败时忽略它们
            if (!isModelListener(key)) {
              // remove `on`, lowercase first letter to reflect event casing
              // accurately
              // 移除 on 并首字母小写化去映射真实事件
              eventAttrs.push(key[2].toLowerCase() + key.slice(3))
            }
          } else {
            // 其他的属性都是额外属性
            extraAttrs.push(key)
          }
        }
        // 存在额外的属性，警告
        if (extraAttrs.length) {
          warn(
            `Extraneous non-props attributes (` +
              `${extraAttrs.join(', ')}) ` +
              `were passed to component but could not be automatically inherited ` +
              `because component renders fragment or text root nodes.`
          )
        }
        // 存在事件属性，警告
        if (eventAttrs.length) {
          warn(
            `Extraneous non-emits event listeners (` +
              `${eventAttrs.join(', ')}) ` +
              `were passed to component but could not be automatically inherited ` +
              `because component renders fragment or text root nodes. ` +
              `If the listener is intended to be a component custom event listener only, ` +
              `declare it using the "emits" option.`
          )
        }
      }
    }
  }

  if (
    __COMPAT__ &&
    isCompatEnabled(DeprecationTypes.INSTANCE_ATTRS_CLASS_STYLE, instance) &&
    vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT &&
    root.shapeFlag & (ShapeFlags.ELEMENT | ShapeFlags.COMPONENT)
  ) {
    const { class: cls, style } = vnode.props || {}
    if (cls || style) {
      if (__DEV__ && inheritAttrs === false) {
        warnDeprecation(
          DeprecationTypes.INSTANCE_ATTRS_CLASS_STYLE,
          instance,
          getComponentName(instance.type)
        )
      }
      root = cloneVNode(root, {
        class: cls,
        style: style
      })
    }
  }

  // inherit directives
  if (vnode.dirs) {
    if (__DEV__ && !isElementRoot(root)) {
      warn(
        `Runtime directive used on component with non-element root node. ` +
          `The directives will not function as intended.`
      )
    }
    // clone before mutating since the root may be a hoisted vnode
    root = cloneVNode(root)
    root.dirs = root.dirs ? root.dirs.concat(vnode.dirs) : vnode.dirs
  }
  // inherit transition data
  if (vnode.transition) {
    if (__DEV__ && !isElementRoot(root)) {
      warn(
        `Component inside <Transition> renders non-element root node ` +
          `that cannot be animated.`
      )
    }
    root.transition = vnode.transition
  }

  if (__DEV__ && setRoot) {
    setRoot(root)
  } else {
    result = root
  }

  setCurrentRenderingInstance(prev)
  return result
}

/**
 * dev only
 * In dev mode, template root level comments are rendered, which turns the
 * template into a fragment root, but we need to locate the single element
 * root for attrs and scope id processing.
 */
const getChildRoot = (vnode: VNode): [VNode, SetRootFn] => {
  const rawChildren = vnode.children as VNodeArrayChildren
  const dynamicChildren = vnode.dynamicChildren
  const childRoot = filterSingleRoot(rawChildren)
  if (!childRoot) {
    return [vnode, undefined]
  }
  const index = rawChildren.indexOf(childRoot)
  const dynamicIndex = dynamicChildren ? dynamicChildren.indexOf(childRoot) : -1
  const setRoot: SetRootFn = (updatedRoot: VNode) => {
    rawChildren[index] = updatedRoot
    if (dynamicChildren) {
      if (dynamicIndex > -1) {
        dynamicChildren[dynamicIndex] = updatedRoot
      } else if (updatedRoot.patchFlag > 0) {
        vnode.dynamicChildren = [...dynamicChildren, updatedRoot]
      }
    }
  }
  return [normalizeVNode(childRoot), setRoot]
}

// 过滤多个节点，如果超过1个节点，返回第一个子节点
export function filterSingleRoot(
  children: VNodeArrayChildren
): VNode | undefined {
  let singleRoot
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (isVNode(child)) {
      // ignore user comment
      // 忽略用户的注释
      if (child.type !== Comment || child.children === 'v-if') {
        if (singleRoot) {
          // has more than 1 non-comment child, return now
          // 有超过1个非注释的子节点，现在返回
          return
        } else {
          singleRoot = child
        }
      }
    } else {
      return
    }
  }
  return singleRoot
}

const getFunctionalFallthrough = (attrs: Data): Data | undefined => {
  let res: Data | undefined
  for (const key in attrs) {
    if (key === 'class' || key === 'style' || isOn(key)) {
      ;(res || (res = {}))[key] = attrs[key]
    }
  }
  return res
}

const filterModelListeners = (attrs: Data, props: NormalizedProps): Data => {
  const res: Data = {}
  for (const key in attrs) {
    if (!isModelListener(key) || !(key.slice(9) in props)) {
      res[key] = attrs[key]
    }
  }
  return res
}

const isElementRoot = (vnode: VNode) => {
  return (
    vnode.shapeFlag & (ShapeFlags.COMPONENT | ShapeFlags.ELEMENT) ||
    vnode.type === Comment // potential v-if branch switch
  )
}

export function shouldUpdateComponent(
  prevVNode: VNode,
  nextVNode: VNode,
  optimized?: boolean
): boolean {
  const { props: prevProps, children: prevChildren, component } = prevVNode
  const { props: nextProps, children: nextChildren, patchFlag } = nextVNode
  const emits = component!.emitsOptions

  // Parent component's render function was hot-updated. Since this may have
  // caused the child component's slots content to have changed, we need to
  // force the child to update as well.
  if (__DEV__ && (prevChildren || nextChildren) && isHmrUpdating) {
    return true
  }

  // force child update for runtime directive or transition on component vnode.
  if (nextVNode.dirs || nextVNode.transition) {
    return true
  }

  if (optimized && patchFlag >= 0) {
    if (patchFlag & PatchFlags.DYNAMIC_SLOTS) {
      // slot content that references values that might have changed,
      // e.g. in a v-for
      return true
    }
    if (patchFlag & PatchFlags.FULL_PROPS) {
      if (!prevProps) {
        return !!nextProps
      }
      // presence of this flag indicates props are always non-null
      return hasPropsChanged(prevProps, nextProps!, emits)
    } else if (patchFlag & PatchFlags.PROPS) {
      const dynamicProps = nextVNode.dynamicProps!
      for (let i = 0; i < dynamicProps.length; i++) {
        const key = dynamicProps[i]
        if (
          nextProps![key] !== prevProps![key] &&
          !isEmitListener(emits, key)
        ) {
          return true
        }
      }
    }
  } else {
    // this path is only taken by manually written render functions
    // so presence of any children leads to a forced update
    if (prevChildren || nextChildren) {
      if (!nextChildren || !(nextChildren as any).$stable) {
        return true
      }
    }
    if (prevProps === nextProps) {
      return false
    }
    if (!prevProps) {
      return !!nextProps
    }
    if (!nextProps) {
      return true
    }
    return hasPropsChanged(prevProps, nextProps, emits)
  }

  return false
}

function hasPropsChanged(
  prevProps: Data,
  nextProps: Data,
  emitsOptions: ComponentInternalInstance['emitsOptions']
): boolean {
  const nextKeys = Object.keys(nextProps)
  if (nextKeys.length !== Object.keys(prevProps).length) {
    return true
  }
  for (let i = 0; i < nextKeys.length; i++) {
    const key = nextKeys[i]
    if (
      nextProps[key] !== prevProps[key] &&
      !isEmitListener(emitsOptions, key)
    ) {
      return true
    }
  }
  return false
}

/**
 * 更新HOC宿主元素
 * 从下往上只要父节点使用的虚拟节点和指定节点相同，就将dom元素赋值给该节点
 * @param param0 
 * @param el 
 */
export function updateHOCHostEl(
  { vnode, parent }: ComponentInternalInstance,
  el: typeof vnode.el // HostNode 宿主节点
) {
  while (parent && parent.subTree === vnode) {
    ;(vnode = parent.vnode).el = el
    parent = parent.parent
  }
}
