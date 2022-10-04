import {
  VNode,
  normalizeVNode,
  Text,
  Comment,
  Static,
  Fragment,
  VNodeHook,
  createVNode,
  createTextVNode,
  invokeVNodeHook
} from './vnode'
import { flushPostFlushCbs } from './scheduler'
import { ComponentInternalInstance } from './component'
import { invokeDirectiveHook } from './directives'
import { warn } from './warning'
import { PatchFlags, ShapeFlags, isReservedProp, isOn } from '@vue/shared'
import { RendererInternals } from './renderer'
import { setRef } from './rendererTemplateRef'
import {
  SuspenseImpl,
  SuspenseBoundary,
  queueEffectWithSuspense
} from './components/Suspense'
import { TeleportImpl, TeleportVNode } from './components/Teleport'
import { isAsyncWrapper } from './apiAsyncComponent'

/**
 * 根节点注水函数
 */
export type RootHydrateFunction = (
  vnode: VNode<Node, Element>,
  container: (Element | ShadowRoot) & { _vnode?: VNode }
) => void

/**
 * DOM Node 类型
 */
const enum DOMNodeTypes {
  ELEMENT = 1,
  TEXT = 3,
  COMMENT = 8
}

/**
 * 是否忽略匹配机制
 */
let hasMismatch = false

/**
 * 是svg容器
 * 且容器的标签名foreignObject
 * @param container 
 * @returns 
 */
const isSVGContainer = (container: Element) =>
  /svg/.test(container.namespaceURI!) && container.tagName !== 'foreignObject'

/**
 * 是注释
 * @param node 
 * @returns 
 */
const isComment = (node: Node): node is Comment =>
  node.nodeType === DOMNodeTypes.COMMENT

// Note: hydration is DOM-specific
// But we have to place it in core due to tight coupling with core - splitting
// it out creates a ton of unnecessary complexity.
// Hydration also depends on some renderer internal logic which needs to be
// passed in via arguments.
/**
 * 注意： 注水是dom专有的
 * 但我们不得不将它放到core里由于它和core是紧密相关的
 * 分离它会导致不必要的复杂性
 * 注水也依赖一些渲染器内部的逻辑需要通过参数传递
 * @param rendererInternals 
 * @returns 
 */
export function createHydrationFunctions(
  rendererInternals: RendererInternals<Node, Element>
) {
  // 从渲染器内部解构mt\p\o
  const {
    mt: mountComponent,
    p: patch,
    o: {
      patchProp,
      createText,
      nextSibling,
      parentNode,
      remove,
      insert,
      createComment
    }
  } = rendererInternals

  // 注水
  const hydrate: RootHydrateFunction = (vnode, container) => {
    if (!container.hasChildNodes()) {
      // 如果容器没有子节点，且是开发环境警告
      // 试图水合现有的标记，但容器是空的
      // 执行完整的mount代替
      __DEV__ &&
        warn(
          `Attempting to hydrate existing markup but container is empty. ` +
            `Performing full mount instead.`
        )
      // 执行完成的mount patch
      patch(null, vnode, container)
      // 清空异步队列
      flushPostFlushCbs()
      container._vnode = vnode
      return
    }
    // 有子节点
    // 不忽略匹配机制
    hasMismatch = false
    // 给容器第一个节点注水
    hydrateNode(container.firstChild!, vnode, null, null, null)
    // 执行异步队列
    flushPostFlushCbs()
    container._vnode = vnode
    // 如果忽略匹配机制且不是测试环境
    if (hasMismatch && !__TEST__) {
      // this error should show up in production
      // 这个错误在生成环境也应该提示
      // 水合完成但是忽略了匹配机制
      console.error(`Hydration completed but contains mismatches.`)
    }
  }

  /**
   * 对节点进行注水操作
   * @param node 节点
   * @param vnode vnode
   * @param parentComponent 父组件
   * @param parentSuspense 父suspense
   * @param slotScopeIds 作用域插槽id
   * @param optimized 是否进行优化
   * @returns 
   */
  const hydrateNode = (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized = false
  ): Node | null => {
    // 看节点是否是注释节点且是[,这个表示Fragment的开头
    const isFragmentStart = isComment(node) && node.data === '['
    /**
     * 监听忽略匹配机制
     * @returns 
     */
    const onMismatch = () =>
      // 处理忽略匹配机制
      handleMismatch(
        node,
        vnode,
        parentComponent,
        parentSuspense,
        slotScopeIds,
        isFragmentStart
      )

    // type， ref， shapeFlag
    const { type, ref, shapeFlag, patchFlag } = vnode
    // 节点类型
    let domType = node.nodeType
    // vnode的节点元素设置
    vnode.el = node

    if (patchFlag === PatchFlags.BAIL) {
      optimized = false
      vnode.dynamicChildren = null
    }

    // 下一个节点
    let nextNode: Node | null = null
    // 后面基本上都是处理数据对不上的情况
    // 节点类型
    switch (type) {
      // 虚拟节点是文本类型
      case Text:
        // 然而实际渲染到html上的如果不是文本
        if (domType !== DOMNodeTypes.TEXT) {
          // #5728 empty text node inside a slot can cause hydration failure
          // because the server rendered HTML won't contain a text node
          if (vnode.children === '') {
            insert((vnode.el = createText('')), parentNode(node)!, node)
            nextNode = node
          } else {
            // 文本节点，需要进行忽略匹配机制
          nextNode = onMismatch()
          }
        } else {
          // 两边都是文本节点，但是dom上的文本与vnode上的内容不相同
          if ((node as Text).data !== vnode.children) {
            // 存在忽略的匹配，因为文本内容不同导致这个需要忽略匹配了
            hasMismatch = true
            // 如果是开发者环境则警告
            __DEV__ &&
              warn(
                `Hydration text mismatch:` +
                  `\n- Client: ${JSON.stringify((node as Text).data)}` +
                  `\n- Server: ${JSON.stringify(vnode.children)}`
              )
            // 更新该文本
            ;(node as Text).data = vnode.children as string
          }
          // 获取下一个节点
          nextNode = nextSibling(node)
        }
        break
      // 注释
      case Comment:
        // 不是注释或者是Fragment开始节点
        if (domType !== DOMNodeTypes.COMMENT || isFragmentStart) {
          // 对该节点忽略匹配后执行下个节点
          nextNode = onMismatch()
        } else {
          // 是单纯的注释
          // 直接下一个节点
          nextNode = nextSibling(node)
        }
        break
      // 静态节点
      case Static:
        // 不是元素
        if (isFragmentStart) {
          // entire template is static but SSRed as a fragment
          // 忽略处理
          node = nextSibling(node)!
          domType = node.nodeType
        }
        if (domType === DOMNodeTypes.ELEMENT || domType === DOMNodeTypes.TEXT) {
          // 是元素
          // determine anchor, adopt content
          // 决定是锚点，适配内容
          nextNode = node
          // if the static vnode has its content stripped during build,
          // adopt it from the server-rendered HTML.
          // 如果在构建中静态的vnode存在它自己的内容，但是被卸载了
          // 在服务器渲染使用它
          const needToAdoptContent = !(vnode.children as string).length
          // 遍历静态vnode包含的元素数量
          for (let i = 0; i < vnode.staticCount!; i++) {
            // 需要使用内容
            if (needToAdoptContent)
              // vnode的子节点添加上
              vnode.children +=
                nextNode.nodeType === DOMNodeTypes.ELEMENT
                  ? (nextNode as Element).outerHTML
                  : (nextNode as Text).data
            if (i === vnode.staticCount! - 1) {
              // 达到最后一个节点时，将锚点设置为下一个节点
              vnode.anchor = nextNode
            }
            // 获取下一个结点
            nextNode = nextSibling(nextNode)!
          }
          // 返回下一个节点
          return isFragmentStart ? nextSibling(nextNode) : nextNode
        } else {
          onMismatch()
        }
        break
      // 片段
      case Fragment:
        // 如果不是片段开头
        if (!isFragmentStart) {
          // 则进行忽略匹配处理
          nextNode = onMismatch()
        } else {
          // 前后符合，则进行Fragment注水
          nextNode = hydrateFragment(
            node as Comment,
            vnode,
            parentComponent,
            parentSuspense,
            slotScopeIds,
            optimized
          )
        }
        break
      default:
        // 如果是元素
        if (shapeFlag & ShapeFlags.ELEMENT) {
          // 真实dom不是一个元素
          // 或者真实dom不是标签名和vnode的是不一样的
          if (
            domType !== DOMNodeTypes.ELEMENT ||
            (vnode.type as string).toLowerCase() !==
              (node as Element).tagName.toLowerCase()
          ) {
            // 忽略匹配机制
            nextNode = onMismatch()
          } else {
            // 元素激活
            nextNode = hydrateElement(
              node as Element,
              vnode,
              parentComponent,
              parentSuspense,
              slotScopeIds,
              optimized
            )
          }
        } else if (shapeFlag & ShapeFlags.COMPONENT) {
          // 如果是组件
          // when setting up the render effect, if the initial vnode already
          // has .el set, the component will perform hydration instead of mount
          // on its sub-tree.
          // 当设置渲染器副作用时，如果初始化的vnode应有.el被设置，
          // 组件将执行注水代替挂载到它的子树上
          // 节点的作用域id
          vnode.slotScopeIds = slotScopeIds
          // 容器
          const container = parentNode(node)!
          // 挂载组件
          mountComponent(
            vnode,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVGContainer(container),
            optimized
          )

          // component may be async, so in the case of fragments we cannot rely
          // on component's rendered output to determine the end of the fragment
          // instead, we do a lookahead to find the end anchor node.
          // 组件可能是异步的，所以在fragments情况下我们不能依赖组件的渲染输出
          // 确定片段的结束位置
          // 但是我可以通过先找结束节点的方式解决这个问题
          // 如果节点是片段开头，则先找好片段
          nextNode = isFragmentStart
            ? locateClosingAsyncAnchor(node)
            : nextSibling(node)

          // #4293 teleport as component root
          if (
            nextNode &&
            isComment(nextNode) &&
            nextNode.data === 'teleport end'
          ) {
            nextNode = nextSibling(nextNode)
          }

          // #3787
          // if component is async, it may get moved / unmounted before its
          // inner component is loaded, so we need to give it a placeholder
          // vnode that matches its adopted DOM.
          // 如果组件是异步组件，它在它内部组件被加载前可能获取被移动或者别卸载的
          // 所以我们需要给它一个匹配它所采用的DOM的vnode。
          if (isAsyncWrapper(vnode)) {
            let subTree
            // 是片段开头，则nextNode就是],需要创建新的片段
            if (isFragmentStart) {
              // 子节点树，创建片段节点
              subTree = createVNode(Fragment)
              // 设置片段的锚点
              subTree.anchor = nextNode
                ? nextNode.previousSibling
                : container.lastChild
            } else {
              // 不是片段开头的组件，则看节点类型是啥
              subTree =
                node.nodeType === 3 ? createTextVNode('') : createVNode('div')
            }
            // 设置node
            subTree.el = node
            // 赋值新的subTree
            vnode.component!.subTree = subTree
          }
        } else if (shapeFlag & ShapeFlags.TELEPORT) {
          // teleport 只要不是注释，就会忽略之前的重新加载
          if (domType !== DOMNodeTypes.COMMENT) {
            nextNode = onMismatch()
          } else {
            // 走teleport的注释
            nextNode = (vnode.type as typeof TeleportImpl).hydrate(
              node,
              vnode as TeleportVNode,
              parentComponent,
              parentSuspense,
              slotScopeIds,
              optimized,
              rendererInternals,
              hydrateChildren
            )
          }
        } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
          // suspense，调用suspense的激活
          nextNode = (vnode.type as typeof SuspenseImpl).hydrate(
            node,
            vnode,
            parentComponent,
            parentSuspense,
            isSVGContainer(parentNode(node)!),
            slotScopeIds,
            optimized,
            rendererInternals,
            hydrateNode
          )
        } else if (__DEV__) {
          // 其他警告
          warn('Invalid HostVNode type:', type, `(${typeof type})`)
        }
    }

    if (ref != null) {
      // ref不为空
      setRef(ref, null, parentSuspense, vnode)
    }

    return nextNode
  }

  const hydrateElement = (
    el: Element,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    optimized = optimized || !!vnode.dynamicChildren
    const { type, props, patchFlag, shapeFlag, dirs } = vnode
    // #4006 for form elements with non-string v-model value bindings
    // e.g. <option :value="obj">, <input type="checkbox" :true-value="1">
    const forcePatchValue = (type === 'input' && dirs) || type === 'option'
    // skip props & children if this is hoisted static nodes
    // #5405 in dev, always hydrate children for HMR
    if (__DEV__ || forcePatchValue || patchFlag !== PatchFlags.HOISTED) {
      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'created')
      }
      // props
      if (props) {
        if (
          forcePatchValue ||
          !optimized ||
          patchFlag & (PatchFlags.FULL_PROPS | PatchFlags.HYDRATE_EVENTS)
        ) {
          for (const key in props) {
            if (
              (forcePatchValue && key.endsWith('value')) ||
              (isOn(key) && !isReservedProp(key))
            ) {
              patchProp(
                el,
                key,
                null,
                props[key],
                false,
                undefined,
                parentComponent
              )
            }
          }
        } else if (props.onClick) {
          // Fast path for click listeners (which is most often) to avoid
          // iterating through props.
          patchProp(
            el,
            'onClick',
            null,
            props.onClick,
            false,
            undefined,
            parentComponent
          )
        }
      }
      // vnode / directive hooks
      let vnodeHooks: VNodeHook | null | undefined
      if ((vnodeHooks = props && props.onVnodeBeforeMount)) {
        invokeVNodeHook(vnodeHooks, parentComponent, vnode)
      }
      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
      }
      if ((vnodeHooks = props && props.onVnodeMounted) || dirs) {
        queueEffectWithSuspense(() => {
          vnodeHooks && invokeVNodeHook(vnodeHooks, parentComponent, vnode)
          dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
        }, parentSuspense)
      }
      // children
      if (
        shapeFlag & ShapeFlags.ARRAY_CHILDREN &&
        // skip if element has innerHTML / textContent
        !(props && (props.innerHTML || props.textContent))
      ) {
        let next = hydrateChildren(
          el.firstChild,
          vnode,
          el,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
        let hasWarned = false
        while (next) {
          hasMismatch = true
          if (__DEV__ && !hasWarned) {
            warn(
              `Hydration children mismatch in <${vnode.type as string}>: ` +
                `server rendered element contains more child nodes than client vdom.`
            )
            hasWarned = true
          }
          // The SSRed DOM contains more nodes than it should. Remove them.
          const cur = next
          next = next.nextSibling
          remove(cur)
        }
      } else if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
        if (el.textContent !== vnode.children) {
          hasMismatch = true
          __DEV__ &&
            warn(
              `Hydration text content mismatch in <${
                vnode.type as string
              }>:\n` +
                `- Client: ${el.textContent}\n` +
                `- Server: ${vnode.children as string}`
            )
          el.textContent = vnode.children as string
        }
      }
    }
    return el.nextSibling
  }

  const hydrateChildren = (
    node: Node | null,
    parentVNode: VNode,
    container: Element,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ): Node | null => {
    optimized = optimized || !!parentVNode.dynamicChildren
    const children = parentVNode.children as VNode[]
    const l = children.length
    let hasWarned = false
    for (let i = 0; i < l; i++) {
      const vnode = optimized
        ? children[i]
        : (children[i] = normalizeVNode(children[i]))
      if (node) {
        node = hydrateNode(
          node,
          vnode,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
      } else if (vnode.type === Text && !vnode.children) {
        continue
      } else {
        hasMismatch = true
        if (__DEV__ && !hasWarned) {
          warn(
            `Hydration children mismatch in <${container.tagName.toLowerCase()}>: ` +
              `server rendered element contains fewer child nodes than client vdom.`
          )
          hasWarned = true
        }
        // the SSRed DOM didn't contain enough nodes. Mount the missing ones.
        patch(
          null,
          vnode,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVGContainer(container),
          slotScopeIds
        )
      }
    }
    return node
  }

  const hydrateFragment = (
    node: Comment,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    const { slotScopeIds: fragmentSlotScopeIds } = vnode
    if (fragmentSlotScopeIds) {
      slotScopeIds = slotScopeIds
        ? slotScopeIds.concat(fragmentSlotScopeIds)
        : fragmentSlotScopeIds
    }

    const container = parentNode(node)!
    const next = hydrateChildren(
      nextSibling(node)!,
      vnode,
      container,
      parentComponent,
      parentSuspense,
      slotScopeIds,
      optimized
    )
    if (next && isComment(next) && next.data === ']') {
      return nextSibling((vnode.anchor = next))
    } else {
      // fragment didn't hydrate successfully, since we didn't get a end anchor
      // back. This should have led to node/children mismatch warnings.
      hasMismatch = true
      // since the anchor is missing, we need to create one and insert it
      insert((vnode.anchor = createComment(`]`)), container, next)
      return next
    }
  }

  /**
   * 处理忽略匹配
   * 这里就是删除原先的节点，然后挂载新的节点
   * @param node 
   * @param vnode 
   * @param parentComponent 
   * @param parentSuspense 
   * @param slotScopeIds 
   * @param isFragment 
   * @returns 
   */
  const handleMismatch = (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    isFragment: boolean
  ): Node | null => {
    // 使用这个函数意味着已经执行了忽略匹配
    hasMismatch = true
    // 警告
    __DEV__ &&
      warn(
        `Hydration node mismatch:\n- Client vnode:`,
        vnode.type,
        `\n- Server rendered DOM:`,
        node,
        node.nodeType === DOMNodeTypes.TEXT
          ? `(text)`
          : isComment(node) && node.data === '['
          ? `(start of fragment)`
          : ``
      )
    // 将vnode元素设置为null
    vnode.el = null

    // 如果是片段
    if (isFragment) {
      // remove excessive fragment nodes
      // 移除过多的fragment节点
      // 找到最近的异步锚点
      const end = locateClosingAsyncAnchor(node)
      // 一直找下一个节点，一直到end节点然后进行删除
      while (true) {
        const next = nextSibling(node)
        if (next && next !== end) {
          remove(next)
        } else {
          break
        }
      }
    }

    // 下个节点
    const next = nextSibling(node)
    // 容器
    const container = parentNode(node)!
    // 移除节点
    remove(node)

    // 当做空的节点去重新挂载，直接走初始化挂载
    patch(
      null,
      vnode,
      container,
      next,
      parentComponent,
      parentSuspense,
      isSVGContainer(container),
      slotScopeIds
    )
    return next
  }

  /**
   * 找最近的异步锚点
   * 找到[对应的]
   * @param node 
   * @returns 
   */
  const locateClosingAsyncAnchor = (node: Node | null): Node | null => {
    let match = 0
    // 一个一个往后找节点
    while (node) {
      node = nextSibling(node)
      // 如果节点是注释
      if (node && isComment(node)) {
        // 说明了就是找到[对应的]
        if (node.data === '[') match++
        if (node.data === ']') {
          if (match === 0) {
            //
            return nextSibling(node)
          } else {
            match--
          }
        }
      }
    }
    return node
  }

  return [hydrate, hydrateNode] as const
}
