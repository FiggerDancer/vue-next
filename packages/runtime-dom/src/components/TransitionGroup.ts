import {
  TransitionProps,
  addTransitionClass,
  removeTransitionClass,
  ElementWithTransition,
  getTransitionInfo,
  resolveTransitionProps,
  TransitionPropsValidators,
  forceReflow
} from './Transition'
import {
  Fragment,
  VNode,
  warn,
  resolveTransitionHooks,
  useTransitionState,
  getTransitionRawChildren,
  getCurrentInstance,
  setTransitionHooks,
  createVNode,
  onUpdated,
  SetupContext,
  toRaw,
  compatUtils,
  DeprecationTypes,
  ComponentOptions
} from '@vue/runtime-core'
import { extend } from '@vue/shared'

// 位置Map
const positionMap = new WeakMap<VNode, DOMRect>()
// 新的位置Map
const newPositionMap = new WeakMap<VNode, DOMRect>()

/**
 * 构造props排除mode
 * 并添加
 * tag 标签
 * moveClass 移动的类名
 */
export type TransitionGroupProps = Omit<TransitionProps, 'mode'> & {
  tag?: string
  moveClass?: string
}

const TransitionGroupImpl: ComponentOptions = {
  name: 'TransitionGroup',

  props: /*#__PURE__*/ extend({}, TransitionPropsValidators, {
    tag: String,
    moveClass: String
  }),

  setup(props: TransitionGroupProps, { slots }: SetupContext) {
    // 获取当前实例
    const instance = getCurrentInstance()!
    // 获取transition状态
    const state = useTransitionState()
    // 之前的节点
    let prevChildren: VNode[]
    // 现在的
    let children: VNode[]

    // 组件更新钩子
    onUpdated(() => {
      // children is guaranteed to exist after initial render
      // 子节点得保证在初始化渲染之后存在
      if (!prevChildren.length) {
        return
      }
      // 移动类名
      const moveClass = props.moveClass || `${props.name || 'v'}-move`

      // 不存在transform过渡则停止执行
      if (
        !hasCSSTransform(
          prevChildren[0].el as ElementWithTransition,
          instance.vnode.el as Node,
          moveClass
        )
      ) {
        return
      }

      // we divide the work into three loops to avoid mixing DOM reads and writes
      // in each iteration - which helps prevent layout thrashing.
      // 我们将工作分成三个循环，以避免在每次迭代中混合读取和写入DOM 
      // 这有助于防止布局抖动。
      // 执行move钩子和enter钩子
      prevChildren.forEach(callPendingCbs)
      // 记录位置
      prevChildren.forEach(recordPosition)
      // 获取被移动过的节点
      const movedChildren = prevChildren.filter(applyTranslation)

      // force reflow to put everything in position
      // 强制回流，把所有东西都放到位
      forceReflow()

      // 对被移动过的节点遍历，拿到其dom元素及样式
      // 添加过渡类名
      // 写元素的回调函数
      movedChildren.forEach(c => {
        const el = c.el as ElementWithTransition
        const style = el.style
        addTransitionClass(el, moveClass)
        style.transform = style.webkitTransform = style.transitionDuration = ''
        const cb = ((el as any)._moveCb = (e: TransitionEvent) => {
          if (e && e.target !== el) {
            return
          }
          if (!e || /transform$/.test(e.propertyName)) {
            // 如果没有过渡事件触发，或者事件中存在transform属性，
            // 则移除监听和类名
            el.removeEventListener('transitionend', cb)
            ;(el as any)._moveCb = null
            removeTransitionClass(el, moveClass)
          }
        })
        el.addEventListener('transitionend', cb)
      })
    })

    return () => {
      // 获取属性原始值
      const rawProps = toRaw(props)
      // 获取过渡属性
      const cssTransitionProps = resolveTransitionProps(rawProps)
      // 标签或者Fragment，不填就是fragment
      let tag = rawProps.tag || Fragment

      // 兼容性处理，一定是span
      if (
        __COMPAT__ &&
        !rawProps.tag &&
        compatUtils.checkCompatEnabled(
          DeprecationTypes.TRANSITION_GROUP_ROOT,
          instance.parent
        )
      ) {
        tag = 'span'
      }

      // 子节点
      prevChildren = children
      // 获取新的原始子节点
      children = slots.default ? getTransitionRawChildren(slots.default()) : []

      // 遍历子节点
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child.key != null) {
          // 设置子节点的过渡钩子
          setTransitionHooks(
            child,
            // 完成钩子
            resolveTransitionHooks(child, cssTransitionProps, state, instance)
          )
        } else if (__DEV__) {
          warn(`<TransitionGroup> children must be keyed.`)
        }
      }

      if (prevChildren) {
        for (let i = 0; i < prevChildren.length; i++) {
          // 遍历之前的节点
          const child = prevChildren[i]
          // 设置过渡钩子
          setTransitionHooks(
            child,
            resolveTransitionHooks(child, cssTransitionProps, state, instance)
          )
          // 设置位置
          positionMap.set(child, (child.el as Element).getBoundingClientRect())
        }
      }

      // 创建vnode节点
      return createVNode(tag, null, children)
    }
  }
}

// 兼容性
if (__COMPAT__) {
  TransitionGroupImpl.__isBuiltIn = true
}

/**
 * TransitionGroup does not support "mode" so we need to remove it from the
 * props declarations, but direct delete operation is considered a side effect
 * and will make the entire transition feature non-tree-shakeable, so we do it
 * in a function and mark the function's invocation as pure.
 * TransitionGroup不支持“mode”，所以我们需要将它从 
 * props声明，但直接删除操作被认为是副作用将使整个过渡功能不可摇树，所以我们这样做
 * 所以我们将函数的调用标记为纯调用。
 */
const removeMode = (props: any) => delete props.mode
/*#__PURE__*/ removeMode(TransitionGroupImpl.props)

// TransitionGroup赋值
export const TransitionGroup = TransitionGroupImpl as unknown as {
  new (): {
    $props: TransitionGroupProps
  }
}

// 调用待定的回调
function callPendingCbs(c: VNode) {
  const el = c.el as any
  // move回调
  if (el._moveCb) {
    el._moveCb()
  }
  // enter回调
  if (el._enterCb) {
    el._enterCb()
  }
}

/**
 * 获取该虚拟节点的位置大小并记录
 * @param c
 */
function recordPosition(c: VNode) {
  newPositionMap.set(c, (c.el as Element).getBoundingClientRect())
}

// 应用过渡效果
function applyTranslation(c: VNode): VNode | undefined {
  const oldPos = positionMap.get(c)!
  const newPos = newPositionMap.get(c)!
  const dx = oldPos.left - newPos.left
  const dy = oldPos.top - newPos.top
  // 存在位移则使用transform进行位移，过渡动画时间为0
  if (dx || dy) {
    const s = (c.el as HTMLElement).style
    s.transform = s.webkitTransform = `translate(${dx}px,${dy}px)`
    s.transitionDuration = '0s'
    return c
  }
}

/**
 * 是否存在transform变化
 * @param el 
 * @param root 
 * @param moveClass 
 * @returns 
 */
function hasCSSTransform(
  el: ElementWithTransition,
  root: Node,
  moveClass: string
): boolean {
  // Detect whether an element with the move class applied has
  // CSS transitions. Since the element may be inside an entering
  // transition at this very moment, we make a clone of it and remove
  // all other transition classes applied to ensure only the move class
  // is applied.
  // 检测应用了move类的元素是否具有CSS转换。
  // 因为在这个非常时刻，元素可能正在执行进入动画
  // 我们做了一个克隆并删除克隆节点上的所有被应用的其他转换类
  // 以确保移动类能够正常应用
  const clone = el.cloneNode() as HTMLElement
  if (el._vtc) {
    // 移除克隆所有转换类
    el._vtc.forEach(cls => {
      cls.split(/\s+/).forEach(c => c && clone.classList.remove(c))
    })
  }
  // 添加移动类
  moveClass.split(/\s+/).forEach(c => c && clone.classList.add(c))
  // 将clone的节点display置为none
  clone.style.display = 'none'
  // 获取transition-group的容器节点
  const container = (
    root.nodeType === 1 ? root : root.parentNode
  ) as HTMLElement
  // 容器节点添加克隆的节点
  container.appendChild(clone)
  // 看克隆的节点是否存在transform变化
  const { hasTransform } = getTransitionInfo(clone)
  // 移除克隆后的节点
  container.removeChild(clone)
  return hasTransform
}
