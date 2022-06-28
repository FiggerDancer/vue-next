import {
  Text,
  Fragment,
  Comment,
  cloneIfMounted,
  normalizeVNode,
  VNode,
  VNodeArrayChildren,
  createVNode,
  isSameVNodeType,
  Static,
  VNodeHook,
  VNodeProps,
  invokeVNodeHook
} from './vnode'
import {
  ComponentInternalInstance,
  ComponentOptions,
  createComponentInstance,
  Data,
  setupComponent
} from './component'
import {
  filterSingleRoot,
  renderComponentRoot,
  shouldUpdateComponent,
  updateHOCHostEl
} from './componentRenderUtils'
import {
  EMPTY_OBJ,
  EMPTY_ARR,
  isReservedProp,
  PatchFlags,
  ShapeFlags,
  NOOP,
  invokeArrayFns,
  isArray,
  getGlobalThis
} from '@vue/shared'
import {
  queueJob,
  queuePostFlushCb,
  flushPostFlushCbs,
  invalidateJob,
  flushPreFlushCbs,
  SchedulerJob
} from './scheduler'
import { pauseTracking, resetTracking, ReactiveEffect } from '@vue/reactivity'
import { updateProps } from './componentProps'
import { updateSlots } from './componentSlots'
import { pushWarningContext, popWarningContext, warn } from './warning'
import { createAppAPI, CreateAppFunction } from './apiCreateApp'
import { setRef } from './rendererTemplateRef'
import {
  SuspenseBoundary,
  queueEffectWithSuspense,
  SuspenseImpl
} from './components/Suspense'
import { TeleportImpl, TeleportVNode } from './components/Teleport'
import { isKeepAlive, KeepAliveContext } from './components/KeepAlive'
import { registerHMR, unregisterHMR, isHmrUpdating } from './hmr'
import { createHydrationFunctions, RootHydrateFunction } from './hydration'
import { invokeDirectiveHook } from './directives'
import { startMeasure, endMeasure } from './profiling'
import {
  devtoolsComponentAdded,
  devtoolsComponentRemoved,
  devtoolsComponentUpdated,
  setDevtoolsHook
} from './devtools'
import { initFeatureFlags } from './featureFlags'
import { isAsyncWrapper } from './apiAsyncComponent'
import { isCompatEnabled } from './compat/compatConfig'
import { DeprecationTypes } from './compat/compatConfig'

/**
 * 渲染器
 * render 渲染函数
 * createApp 创建App函数
 */
export interface Renderer<HostElement = RendererElement> {
  render: RootRenderFunction<HostElement>
  
  createApp: CreateAppFunction<HostElement>
}

/**
 * SSR的渲染器 继承自普通渲染器
 * 添加了注水的函数
 */
export interface HydrationRenderer extends Renderer<Element | ShadowRoot> {
  hydrate: RootHydrateFunction
}

/**
 * 根节点渲染函数
 * vnode 虚拟node
 * container 容器元素
 * isSVG 是否是SVG
 */
export type RootRenderFunction<HostElement = RendererElement> = (
  vnode: VNode | null,
  container: HostElement,
  isSVG?: boolean
) => void

/**
 * 渲染器选项
 * patchProp 更新属性的函数
 * insert
 * remove
 * createElement
 * createText
 * createComment
 * setText
 * setElementText
 * parentNode
 * nextSibling
 * querySelector
 * setScopeId
 * cloneNode
 * insertStaticContent
 */
export interface RendererOptions<
  HostNode = RendererNode,
  HostElement = RendererElement
> {
  patchProp(
    el: HostElement,
    key: string,
    prevValue: any,
    nextValue: any,
    isSVG?: boolean,
    prevChildren?: VNode<HostNode, HostElement>[],
    parentComponent?: ComponentInternalInstance | null,
    parentSuspense?: SuspenseBoundary | null,
    unmountChildren?: UnmountChildrenFn
  ): void
  insert(el: HostNode, parent: HostElement, anchor?: HostNode | null): void
  remove(el: HostNode): void
  createElement(
    type: string,
    isSVG?: boolean,
    isCustomizedBuiltIn?: string,
    vnodeProps?: (VNodeProps & { [key: string]: any }) | null
  ): HostElement
  createText(text: string): HostNode
  createComment(text: string): HostNode
  setText(node: HostNode, text: string): void
  setElementText(node: HostElement, text: string): void
  parentNode(node: HostNode): HostElement | null
  nextSibling(node: HostNode): HostNode | null
  querySelector?(selector: string): HostElement | null
  setScopeId?(el: HostElement, id: string): void
  cloneNode?(node: HostNode): HostNode
  insertStaticContent?(
    content: string,
    parent: HostElement,
    anchor: HostNode | null,
    isSVG: boolean,
    start?: HostNode | null,
    end?: HostNode | null
  ): [HostNode, HostNode]
}

// Renderer Node can technically be any object in the context of core renderer
// logic - they are never directly operated on and always passed to the node op
// functions provided via options, so the internal constraint is really just
// a generic object.
// 从技术上讲，Renderer Node可以是核心渲染器逻辑上下文中的任何对象
// 它们从来没有被直接操作过，总是传递给通过选项提供的节点op函数，所以内部约束实际上只是一个通用对象。
export interface RendererNode {
  [key: string]: any
}

export interface RendererElement extends RendererNode {}

// An object exposing the internals of a renderer, passed to tree-shakeable
// features so that they can be decoupled from this file. Keys are shortened
// to optimize bundle size.
// 一个暴露渲染器内部结构的对象，传递给可摇树特性，这样它们就可以从这个文件中解耦。
// 键被缩短以优化包大小。有利于摇树
export interface RendererInternals<
  HostNode = RendererNode,
  HostElement = RendererElement
> {
  p: PatchFn
  um: UnmountFn
  r: RemoveFn
  m: MoveFn
  mt: MountComponentFn
  mc: MountChildrenFn
  pc: PatchChildrenFn
  pbc: PatchBlockChildrenFn
  n: NextFn
  o: RendererOptions<HostNode, HostElement>
}

// These functions are created inside a closure and therefore their types cannot
// be directly exported. In order to avoid maintaining function signatures in
// two places, we declare them once here and use them inside the closure.
// 这些函数是在闭包中创建的，因此它们的类型不能直接导出。
// 为了避免在两个地方维护函数签名，我们在这里声明它们一次，然后在闭包中使用它们。
type PatchFn = (
  n1: VNode | null, // null means this is a mount
  n2: VNode,
  container: RendererElement,
  anchor?: RendererNode | null,
  parentComponent?: ComponentInternalInstance | null,
  parentSuspense?: SuspenseBoundary | null,
  isSVG?: boolean,
  slotScopeIds?: string[] | null,
  optimized?: boolean
) => void

/**
 * 挂载孩子的方法
 */
type MountChildrenFn = (
  children: VNodeArrayChildren,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  start?: number
) => void

/**
 * 更新子节点的方法
 */
type PatchChildrenFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean
) => void

/**
 * 更新块状子节点
 */
type PatchBlockChildrenFn = (
  oldChildren: VNode[],
  newChildren: VNode[],
  fallbackContainer: RendererElement,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null
) => void

/**
 * 移动节点的方法
 */
type MoveFn = (
  vnode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  type: MoveType,
  parentSuspense?: SuspenseBoundary | null
) => void

/**
 * 下一个节点
 */
type NextFn = (vnode: VNode) => RendererNode | null

/**
 * 卸载节点方法
 */
type UnmountFn = (
  vnode: VNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean,
  optimized?: boolean
) => void

/**
 * 移除节点方法
 */
type RemoveFn = (vnode: VNode) => void

/**
 * 卸载孩子
 */
type UnmountChildrenFn = (
  children: VNode[],
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean,
  optimized?: boolean,
  start?: number
) => void

/**
 * 挂载组件
 */
export type MountComponentFn = (
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean
) => void

/**
 * 处理文本或者注释
 */
type ProcessTextOrCommentFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null
) => void

/**
 * 安装渲染器副作用
 */
export type SetupRenderEffectFn = (
  instance: ComponentInternalInstance,
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean
) => void

/**
 * 移动节点的类型
 * Enter 插入
 * Leave离开
 * Reorder 重新排序
 */
export const enum MoveType {
  ENTER, // 插入
  LEAVE, // 离开
  REORDER // 重新排序
}

/**
 * 处理副作用的在悬疑之后，或者冲刷由是否开启悬疑特性决定
 */
export const queuePostRenderEffect = __FEATURE_SUSPENSE__
  ? queueEffectWithSuspense
  : queuePostFlushCb

/**
 * The createRenderer function accepts two generic arguments:
 * HostNode and HostElement, corresponding to Node and Element types in the
 * host environment. For example, for runtime-dom, HostNode would be the DOM
 * `Node` interface and HostElement would be the DOM `Element` interface.
 *
 * Custom renderers can pass in the platform specific types like this:
 *
 * ``` js
 * const { render, createApp } = createRenderer<Node, Element>({
 *   patchProp,
 *   ...nodeOps
 * })
 * ```
 * 
 * 获取渲染的实例
 * 
 * 创建渲染器函数接收2个泛型参数
 * HostNode和HostElement，分别对应宿主环境中的Node和Element类型。
 * 例如，对于运行时DOM, HostNode将是DOM ' Node '接口，而HostElement将是DOM ' Element '接口。
 * 自定义渲染器可以像这样传递平台特定的类型:
 * 
 * ``` ts
 * const { render, createApp } = createRenderer<Node, Element>({
 *   patchProp,
 *   ...nodeOps
 * })
 * ```
 */
export function createRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement
>(options: RendererOptions<HostNode, HostElement>) {
  return baseCreateRenderer<HostNode, HostElement>(options)
}

// Separate API for creating hydration-enabled renderer.
// Hydration logic is only used when calling this function, making it
// tree-shakable.
// 独立的API创建水合渲染器。水合逻辑仅在调用此函数时使用，使其可摇树。
export function createHydrationRenderer(
  options: RendererOptions<Node, Element>
) {
  return baseCreateRenderer(options, createHydrationFunctions)
}

// overload 1: no hydration
// 重载：非注水
function baseCreateRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement
>(options: RendererOptions<HostNode, HostElement>): Renderer<HostElement>

// overload 2: with hydration
// 重载：注水
function baseCreateRenderer(
  options: RendererOptions<Node, Element>,
  createHydrationFns: typeof createHydrationFunctions
): HydrationRenderer

// implementation
// 实现
function baseCreateRenderer(
  options: RendererOptions,
  createHydrationFns?: typeof createHydrationFunctions
): any {
  // compile-time feature flags check
  // 编译时特性标志检查
  if (__ESM_BUNDLER__ && !__TEST__) {
    initFeatureFlags()
  }
  
  // 获取全局变量
  const target = getGlobalThis()
  // Vue标记
  target.__VUE__ = true
  // 开发者环境或者是开启生产可调式特性时，设置开发者工具的钩子
  if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
    setDevtoolsHook(target.__VUE_DEVTOOLS_GLOBAL_HOOK__, target)
  }

  const {
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
    createElement: hostCreateElement,
    createText: hostCreateText,
    createComment: hostCreateComment,
    setText: hostSetText,
    setElementText: hostSetElementText,
    parentNode: hostParentNode,
    nextSibling: hostNextSibling,
    setScopeId: hostSetScopeId = NOOP,
    cloneNode: hostCloneNode,
    insertStaticContent: hostInsertStaticContent
  } = options

  // Note: functions inside this closure should use `const xxx = () => {}`
  // style in order to prevent being inlined by minifiers.
  // 注意:这个闭包中的函数应该使用' const xxx =() =>{} '样式，以防止被代码压缩内联。
  const patch: PatchFn = (
    n1, // 旧vnode
    n2, // 新vnode
    container, // 容器
    anchor = null, // 锚节点，用于insertBefore等，作为锚点，方便操作
    parentComponent = null,
    parentSuspense = null,
    isSVG = false,
    slotScopeIds = null,
    optimized = __DEV__ && isHmrUpdating ? false : !!n2.dynamicChildren // 优化，如果是开发者环境且是热更新则不优化，否则看新节点是否存在动态子节点
  ) => {
    // 如果新旧节点相同
    if (n1 === n2) {
      return
    }

    // patching & not same type, unmount old tree
    // 修补&不相同的类型，卸载老的节点树
    if (n1 && !isSameVNodeType(n1, n2)) {
      anchor = getNextHostNode(n1)
      unmount(n1, parentComponent, parentSuspense, true)
      n1 = null
    }

    // 当patchFlag是脱离标记的时候，应该脱离优化模式
    if (n2.patchFlag === PatchFlags.BAIL) {
      optimized = false // 优化标记
      n2.dynamicChildren = null // 动态子节点
    }

    // 根据最新vnode类型做相应处理
    const { type, ref, shapeFlag } = n2
    switch (type) {
      case Text: // 文本
        processText(n1, n2, container, anchor)
        break
      case Comment: // 注释
        processCommentNode(n1, n2, container, anchor)
        break
      case Static: // 静态节点
        if (n1 == null) { // 原先没有就挂载这个静态节点
          mountStaticNode(n2, container, anchor, isSVG)
        } else if (__DEV__) { // 开发者环境进行打补丁
          patchStaticNode(n1, n2, container, isSVG)
        }
        break
      case Fragment: // 片段
        processFragment(
          n1,
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        break
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          processElement( // 元素
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        } else if (shapeFlag & ShapeFlags.COMPONENT) { // 组件
          // 首次初始化走这个分支
          // 因为我们传入的是一个组件对象
          processComponent(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        } else if (shapeFlag & ShapeFlags.TELEPORT) { // Teleport传输组件
          ;(type as typeof TeleportImpl).process(
            n1 as TeleportVNode,
            n2 as TeleportVNode,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized,
            internals
          )
        } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) { // suspense 悬疑节点（加载）
          ;(type as typeof SuspenseImpl).process(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized,
            internals
          )
        } else if (__DEV__) { // 失效的type
          warn('Invalid VNode type:', type, `(${typeof type})`)
        }
    }

    // set ref
    if (ref != null && parentComponent) { // 有ref且存在父组件的话去设置ref
      setRef(ref, n1 && n1.ref, parentSuspense, n2 || n1, !n2)
    }
  }

  const processText: ProcessTextOrCommentFn = (n1, n2, container, anchor) => {
    if (n1 == null) { // 原先没有的话，就在锚点前插入
      hostInsert(
        (n2.el = hostCreateText(n2.children as string)),
        container,
        anchor
      )
    } else { // 重新设置元素文本，并且设置新vnode节点的el
      const el = (n2.el = n1.el!)
      // 文本不相同，重新设置
      if (n2.children !== n1.children) {
        hostSetText(el, n2.children as string)
      }
    }
  }

  const processCommentNode: ProcessTextOrCommentFn = (
    n1,
    n2,
    container,
    anchor
  ) => {
    // 原先无注释，设置注释
    if (n1 == null) {
      hostInsert(
        (n2.el = hostCreateComment((n2.children as string) || '')),
        container,
        anchor
      )
    } else {
      // there's no support for dynamic comments
      // 不支持动态注释
      n2.el = n1.el
    }
  }

  const mountStaticNode = (
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    isSVG: boolean
  ) => {
    // static nodes are only present when used with compiler-dom/runtime-dom
    // which guarantees presence of hostInsertStaticContent.
    // 静态节点只有在compiler-dom/runtime-dom使用时才会出现
    // 这保证了hostInsertStaticContent的存在。
    ;[n2.el, n2.anchor] = hostInsertStaticContent!(
      n2.children as string,
      container,
      anchor,
      isSVG,
      n2.el,
      n2.anchor
    )
  }

  /**
   * Dev / HMR only
   * 仅开发环境 / 热更新适用
   */
  const patchStaticNode = (
    n1: VNode,
    n2: VNode,
    container: RendererElement,
    isSVG: boolean
  ) => {
    // static nodes are only patched during dev for HMR
    // 静态节点仅仅被在开发HMR时打了补丁
    if (n2.children !== n1.children) {
      const anchor = hostNextSibling(n1.anchor!)
      // remove existing
      // 移除存在的节点
      removeStaticNode(n1)
      // insert new
      // 插入新的节点
      ;[n2.el, n2.anchor] = hostInsertStaticContent!(
        n2.children as string,
        container,
        anchor,
        isSVG
      )
    } else {
      n2.el = n1.el
      n2.anchor = n1.anchor
    }
  }

  // 将指定范围内的节点移动到指定的节点前
  const moveStaticNode = (
    { el, anchor }: VNode,
    container: RendererElement,
    nextSibling: RendererNode | null
  ) => {
    let next
    while (el && el !== anchor) {
      next = hostNextSibling(el)
      hostInsert(el, container, nextSibling)
      el = next
    }
    hostInsert(anchor!, container, nextSibling)
  }

  // 移除指定范围的节点
  const removeStaticNode = ({ el, anchor }: VNode) => {
    let next
    while (el && el !== anchor) {
      next = hostNextSibling(el)
      hostRemove(el)
      el = next
    }
    hostRemove(anchor!)
  }

  // 处理元素
  const processElement = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    // 是否是svg
    isSVG = isSVG || (n2.type as string) === 'svg'
    // 没有就挂载，原先有就更新
    if (n1 == null) {
      mountElement(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    } else {
      patchElement(
        n1,
        n2,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    }
  }

  // 挂载元素
  const mountElement = (
    vnode: VNode, // 虚拟节点
    container: RendererElement, // 容器
    anchor: RendererNode | null, // 锚点
    parentComponent: ComponentInternalInstance | null, // 父组件
    parentSuspense: SuspenseBoundary | null, // 父悬疑
    isSVG: boolean, // SVG标记
    slotScopeIds: string[] | null, // 插槽作用域id
    optimized: boolean // 是否需要启用优化
  ) => {
    let el: RendererElement
    let vnodeHook: VNodeHook | undefined | null
    const { type, props, shapeFlag, transition, patchFlag, dirs } = vnode
    if (
      !__DEV__ &&
      vnode.el &&
      hostCloneNode !== undefined &&
      patchFlag === PatchFlags.HOISTED
    ) {
      // If a vnode has non-null el, it means it's being reused.
      // Only static vnodes can be reused, so its mounted DOM nodes should be
      // exactly the same, and we can simply do a clone here.
      // only do this in production since cloned trees cannot be HMR updated.
      // 如果一个vnode有非空的el，这意味着它正在被重用。
      // 只有静态的vnode可以被重用，所以它挂载的DOM节点应该是完全相同的，
      // 我们可以在这里简单地克隆一下。只能在生产中这样做，因为克隆树不能进行HMR更新。
      el = vnode.el = hostCloneNode(vnode.el)
    } else {
      // 其他情况下，需要创建一个新的
      // hostCreateElement相当于document.createElement
      el = vnode.el = hostCreateElement(
        vnode.type as string,
        isSVG,
        props && props.is,
        props
      )

      // mount children first, since some props may rely on child content
      // being already rendered, e.g. `<select value>`
      // 首先Mount子节点，因为一些属性可能依赖于已经渲染的子节点内容，例如 `<select value>`
      if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
        // 文本属性 v-text
        hostSetElementText(el, vnode.children as string)
      } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // 子节点 v-for
        mountChildren(
          vnode.children as VNodeArrayChildren,
          el,
          null,
          parentComponent,
          parentSuspense,
          isSVG && type !== 'foreignObject', // 节点类型不是 foreignObject (svg一种)
          slotScopeIds,
          optimized
        )
      }

      // 有指令，调用指令中的created钩子
      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'created')
      }
      // props
      // 属性
      if (props) {
        for (const key in props) {
          // 对非保留字段属性打补丁，更新
          if (key !== 'value' && !isReservedProp(key)) {
            hostPatchProp(
              el,
              key, // props
              null,
              props[key], // props的值
              isSVG,
              vnode.children as VNode[],
              parentComponent,
              parentSuspense,
              unmountChildren // 卸载组件的方法
            )
          }
        }
        /**
         * Special case for setting value on DOM elements:
         * - it can be order-sensitive (e.g. should be set *after* min/max, #2325, #4024)
         * - it needs to be forced (#1471)
         * #2353 proposes adding another renderer option to configure this, but
         * the properties affects are so finite it is worth special casing it
         * here to reduce the complexity. (Special casing it also should not
         * affect non-DOM renderers)
         * 给dom设置value是一种特殊情况，它对顺序是敏感的，应该在设置min/max之后设置
         * 这需要强制
         * 建议添加另一个渲染器选项来配置它，但属性影响是如此有限，
         * 因此值得在这里对其进行特殊的包装，以降低复杂性。(特殊的大小写也不会影响到非dom渲染器)
         */
        if ('value' in props) {
          hostPatchProp(el, 'value', null, props.value)
        }
        // 调用钩子
        if ((vnodeHook = props.onVnodeBeforeMount)) {
          invokeVNodeHook(vnodeHook, parentComponent, vnode)
        }
      }
      // scopeId
      // 设置作用域Id
      setScopeId(el, vnode, vnode.scopeId, slotScopeIds, parentComponent)
    }
    // 开发者环境或者开启了开发这工具
    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      Object.defineProperty(el, '__vnode', {
        value: vnode,
        enumerable: false
      })
      Object.defineProperty(el, '__vueParentComponent', {
        value: parentComponent,
        enumerable: false
      })
    }
    // 有指令的话，调用指令中的beforeMount钩子
    if (dirs) {
      invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
    }
    // 过渡钩子
    // #1583 For inside suspense + suspense not resolved case, enter hook should call when suspense resolved
    // 对于内部悬疑+悬疑未解决的情况，当悬疑解决时，应调用enter hook
    // #1689 For inside suspense + suspense resolved case, just call it
    // 对于内部悬疑+悬疑解决的情况，只需调用它
    const needCallTransitionHooks =
      (!parentSuspense || (parentSuspense && !parentSuspense.pendingBranch)) &&
      transition &&
      !transition.persisted
    // 如果需要过渡钩子
    if (needCallTransitionHooks) {
      transition!.beforeEnter(el)
    }
    // 插入元素（挂载的元素需要追加上去）
    hostInsert(el, container, anchor)
    if (
      (vnodeHook = props && props.onVnodeMounted) ||
      needCallTransitionHooks ||
      dirs
    ) {
      // 在挂载后执行挂载各种钩子
      // queuePostRenderEffect 异步执行（微任务）
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        needCallTransitionHooks && transition!.enter(el)
        dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
      }, parentSuspense)
    }
  }

  // 设置作用域Id
  const setScopeId = (
    el: RendererElement, // 元素
    vnode: VNode, // 节点
    scopeId: string | null, // 作用域Id
    slotScopeIds: string[] | null, // 插槽作用域Id
    parentComponent: ComponentInternalInstance | null // 父组件
  ) => {
    // 设置作用域Id
    if (scopeId) {
      hostSetScopeId(el, scopeId)
    }
    // 设置插槽作用域Id
    if (slotScopeIds) {
      for (let i = 0; i < slotScopeIds.length; i++) {
        hostSetScopeId(el, slotScopeIds[i])
      }
    }
    // 存在父组件
    if (parentComponent) {
      // 父组件树节点
      let subTree = parentComponent.subTree
      // 开发环境下，用户在模板的根级别存在为注释而创建的片段
      if (
        __DEV__ &&
        subTree.patchFlag > 0 &&
        subTree.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
      ) {
        // 过滤多个节点，如果超过1个节点，返回第一个子节点
        subTree =
          filterSingleRoot(subTree.children as VNodeArrayChildren) || subTree
      }
      // 节点是父组件的节点树
      if (vnode === subTree) {
        const parentVNode = parentComponent.vnode
        // 设置父节点的作用域Id
        setScopeId(
          el,
          parentVNode,
          parentVNode.scopeId,
          parentVNode.slotScopeIds,
          parentComponent.parent
        )
      }
    }
  }

  // 挂载子节点
  const mountChildren: MountChildrenFn = (
    children,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    slotScopeIds,
    optimized,
    start = 0 // 从start个节点开始挂载
  ) => {
    for (let i = start; i < children.length; i++) {
      // 优化的情况使用 cloneIfMounted 非优化情况下使用 normalizeVNode
      const child = (children[i] = optimized
        ? cloneIfMounted(children[i] as VNode)
        : normalizeVNode(children[i]))
      // 更新节点
      patch(
        null,
        child,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    }
  }

  // 更新元素
  const patchElement = (
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    const el = (n2.el = n1.el!) // 获取对应的dom元素并给新节点赋值对应的dom
    // 从新节点中获取要更新的标记，动态子节点，指令
    let { patchFlag, dynamicChildren, dirs } = n2 
    // #1426 take the old vnode's patch flag into account since user may clone a
    // compiler-generated vnode, which de-opts to FULL_PROPS
    // 考虑到旧的vnode的补丁标志，因为用户可能会克隆一个编译器生成的vnode，它会被移除到FULL_PROPS
    patchFlag |= n1.patchFlag & PatchFlags.FULL_PROPS
    // 获取新旧节点的props
    const oldProps = n1.props || EMPTY_OBJ
    const newProps = n2.props || EMPTY_OBJ
    let vnodeHook: VNodeHook | undefined | null

    // disable recurse in beforeUpdate hooks
    // 在beforeUpdate钩子中禁用递归
    parentComponent && toggleRecurse(parentComponent, false)
    // 有beforeUpdate钩子就调用beforeUpdate钩子
    if ((vnodeHook = newProps.onVnodeBeforeUpdate)) {
      invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
    }
    // 存在指令，调用指令中的beforeUpdate的钩子
    if (dirs) {
      invokeDirectiveHook(n2, n1, parentComponent, 'beforeUpdate')
    }
    // 开启递归
    parentComponent && toggleRecurse(parentComponent, true)

    if (__DEV__ && isHmrUpdating) {
      // HMR updated, force full diff
      // 开发者模式下开启热更新的话，强制全部进行diff，其实相当于补丁标记无效了
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    // svg
    const areChildrenSVG = isSVG && n2.type !== 'foreignObject'

    // 动态子节点
    if (dynamicChildren) {
      // 更新动态子节点
      patchBlockChildren(
        n1.dynamicChildren!,
        dynamicChildren,
        el,
        parentComponent,
        parentSuspense,
        areChildrenSVG,
        slotScopeIds
      )
      // 开发者环境、父节点存在热更新Id， 遍历旧的节点和新的节点
      if (__DEV__ && parentComponent && parentComponent.type.__hmrId) {
        traverseStaticChildren(n1, n2)
      }
    } else if (!optimized) {
      // full diff
      // 全量diff
      patchChildren(
        n1,
        n2,
        el,
        null,
        parentComponent,
        parentSuspense,
        areChildrenSVG,
        slotScopeIds,
        false
      )
    }

    if (patchFlag > 0) {
      // the presence of a patchFlag means this element's render code was
      // generated by the compiler and can take the fast path.
      // in this path old node and new node are guaranteed to have the same shape
      // (i.e. at the exact same position in the source template)
      // patchFlag的存在意味着这个元素的渲染代码是由编译器生成的，并且可以采用快速路径。
      // 在这个路径中，旧节点和新节点保证具有相同的形状(即在源模板中完全相同的位置)。
      if (patchFlag & PatchFlags.FULL_PROPS) {
        // element props contain dynamic keys, full diff needed
        // 元素属性含动态键，需要全diff
        patchProps(
          el,
          n2,
          oldProps,
          newProps,
          parentComponent,
          parentSuspense,
          isSVG
        )
      } else {
        // class
        // this flag is matched when the element has dynamic class bindings.
        // 当元素具有动态类绑定时，将匹配此标志。
        if (patchFlag & PatchFlags.CLASS) {
          if (oldProps.class !== newProps.class) {
            hostPatchProp(el, 'class', null, newProps.class, isSVG)
          }
        }

        // style
        // this flag is matched when the element has dynamic style bindings
        // 当元素具有动态样式绑定时，将匹配此标志
        if (patchFlag & PatchFlags.STYLE) {
          hostPatchProp(el, 'style', oldProps.style, newProps.style, isSVG)
        }

        // props
        // This flag is matched when the element has dynamic prop/attr bindings
        // other than class and style. The keys of dynamic prop/attrs are saved for
        // faster iteration.
        // Note dynamic keys like :[foo]="bar" will cause this optimization to
        // bail out and go through a full diff because we need to unset the old key
        // 当元素具有动态的prop/attr绑定而不是类和样式时，该标志被匹配。
        // 保存了动态props/attrs的键值，提高了迭代速度。
        // 注意像:[foo]="bar"这样的动态键会导致优化失败，并经历一个完全的diff，
        // 因为我们需要取消旧键的设置
        if (patchFlag & PatchFlags.PROPS) {
          // if the flag is present then dynamicProps must be non-null
          // 如果该标志存在，那么dynamicProps必须是非空的
          const propsToUpdate = n2.dynamicProps!
          for (let i = 0; i < propsToUpdate.length; i++) {
            const key = propsToUpdate[i]
            const prev = oldProps[key]
            const next = newProps[key]
            // #1471 force patch value
            // 强制更新value
            if (next !== prev || key === 'value') {
              hostPatchProp(
                el,
                key,
                prev,
                next,
                isSVG,
                n1.children as VNode[],
                parentComponent,
                parentSuspense,
                unmountChildren
              )
            }
          }
        }
      }

      // text
      // This flag is matched when the element has only dynamic text children.
      // 当元素只有动态文本子元素时，匹配此标志。
      if (patchFlag & PatchFlags.TEXT) {
        if (n1.children !== n2.children) {
          hostSetElementText(el, n2.children as string)
        }
      }
    } else if (!optimized && dynamicChildren == null) {
      // unoptimized, full diff
      // 不优化，全量diff
      patchProps(
        el,
        n2,
        oldProps,
        newProps,
        parentComponent,
        parentSuspense,
        isSVG
      )
    }

    // 如果有updated钩子，异步调用相关钩子
    if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
        dirs && invokeDirectiveHook(n2, n1, parentComponent, 'updated')
      }, parentSuspense)
    }
  }

  // The fast path for blocks.
  // 局部快速更新
  const patchBlockChildren: PatchBlockChildrenFn = (
    oldChildren,
    newChildren,
    fallbackContainer,
    parentComponent,
    parentSuspense,
    isSVG,
    slotScopeIds
  ) => {
    for (let i = 0; i < newChildren.length; i++) {
      const oldVNode = oldChildren[i]
      const newVNode = newChildren[i]
      // Determine the container (parent element) for the patch.
      // 确定补丁的容器(父元素)。
      const container =
        // oldVNode may be an errored async setup() component inside Suspense
        // which will not have a mounted element
        // oldVNode可能是一个在悬疑内部的错误的async setup()组件，它不会有一个被挂载的元素
        oldVNode.el &&
        // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        // 在Fragment的情况下，我们需要提供Fragment本身的实际父元素，这样它才能移动它的子元素。
        (oldVNode.type === Fragment ||
          // - In the case of different nodes, there is going to be a replacement
          // which also requires the correct parent container
          // 在不同节点的情况下，将会有一个替换，这也需要正确的父容器
          !isSameVNodeType(oldVNode, newVNode) ||
          // - In the case of a component, it could contain anything.
          // 在组件的情况下，它可以包含任何内容。
          oldVNode.shapeFlag & (ShapeFlags.COMPONENT | ShapeFlags.TELEPORT))
          // 找父节点
          ? hostParentNode(oldVNode.el)!
          : // In other cases, the parent container is not actually used so we
            // just pass the block element here to avoid a DOM parentNode call.
            // 在其他情况下，父容器实际上并没有被使用，所以我们只是在这里传递block元素，
            // 以避免调用DOM parentNode。
            fallbackContainer
      patch(
        oldVNode,
        newVNode,
        container,
        null,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        true
      )
    }
  }

  // 更新Props
  const patchProps = (
    el: RendererElement,
    vnode: VNode,
    oldProps: Data,
    newProps: Data,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean
  ) => {
    if (oldProps !== newProps) {
      for (const key in newProps) {
        // empty string is not valid prop
        // 空的字符串不是有效属性
        // 保留属性直接跳过
        if (isReservedProp(key)) continue
        const next = newProps[key]
        const prev = oldProps[key]
        // defer patching value
        // 其他的属性更新，延迟更新value
        if (next !== prev && key !== 'value') {
          hostPatchProp(
            el,
            key,
            prev,
            next,
            isSVG,
            vnode.children as VNode[],
            parentComponent,
            parentSuspense,
            unmountChildren
          )
        }
      }
      // 旧值不为空
      if (oldProps !== EMPTY_OBJ) {
        for (const key in oldProps) {
          // 清除不再使用的旧值
          if (!isReservedProp(key) && !(key in newProps)) {
            hostPatchProp(
              el,
              key,
              oldProps[key],
              null,
              isSVG,
              vnode.children as VNode[],
              parentComponent,
              parentSuspense,
              unmountChildren
            )
          }
        }
      }
      // 更新value
      if ('value' in newProps) {
        hostPatchProp(el, 'value', oldProps.value, newProps.value)
      }
    }
  }

  // 处理片段
  const processFragment = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    // 获取片段开始锚点和结束锚点
    const fragmentStartAnchor = (n2.el = n1 ? n1.el : hostCreateText(''))!
    const fragmentEndAnchor = (n2.anchor = n1 ? n1.anchor : hostCreateText(''))!

    let { patchFlag, dynamicChildren, slotScopeIds: fragmentSlotScopeIds } = n2

    if (__DEV__ && isHmrUpdating) {
      // HMR updated, force full diff
      // 热更新强制全量diff
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    // check if this is a slot fragment with :slotted scope ids
    // 检查这是否是一个带有:slotted scope id的插槽片段
    if (fragmentSlotScopeIds) {
      slotScopeIds = slotScopeIds
        ? slotScopeIds.concat(fragmentSlotScopeIds)
        : fragmentSlotScopeIds
    }

    // 无旧节点
    if (n1 == null) {
      // 插入片段的插槽锚点，方便用来插入片段的子节点
      hostInsert(fragmentStartAnchor, container, anchor)
      hostInsert(fragmentEndAnchor, container, anchor)
      // a fragment can only have array children
      // since they are either generated by the compiler, or implicitly created
      // from arrays.
      // 一个片段只能有数组子元素，因为它们要么是由编译器生成的，要么是从数组中隐式创建的。
      mountChildren(
        n2.children as VNodeArrayChildren,
        container,
        fragmentEndAnchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    } else {
      // 补丁标记标记如果存在STABLE_FRAGMENT说明，数组的顺序不会发生变化
      if (
        patchFlag > 0 &&
        patchFlag & PatchFlags.STABLE_FRAGMENT &&
        dynamicChildren &&
        // #2715 the previous fragment could've been a BAILed one as a result
        // of renderSlot() with no valid children
        // 由于renderSlot()没有有效的子元素，之前的片段可能是一个保留的片段
        n1.dynamicChildren
      ) {
        // a stable fragment (template root or <template v-for>) doesn't need to
        // patch children order, but it may contain dynamicChildren.
        // 一个稳定的片段(模板根或<template v-for>)打补丁不需要考虑顺序问题，但它可能包含dynamicChildren。
        patchBlockChildren(
          n1.dynamicChildren,
          dynamicChildren,
          container,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds
        )
        // 开发者环境若为父组件热更新，深度遍历静态节点
        if (__DEV__ && parentComponent && parentComponent.type.__hmrId) {
          traverseStaticChildren(n1, n2)
        } else if (
          // #2080 if the stable fragment has a key, it's a <template v-for> that may
          //  get moved around. Make sure all root level vnodes inherit el.
          // #2134 or if it's a component root, it may also get moved around
          // as the component is being moved.
          // 如果稳定的片段有一个键，它是一个<template v-for>，可以被移动。
          // 确保所有根节点都继承el。或者如果它是一个组件根，它也可以随着组件的移动而移动。
          n2.key != null ||
          (parentComponent && n2 === parentComponent.subTree)
        ) { // 浅度遍历静态节点
          traverseStaticChildren(n1, n2, true /* shallow */)
        }
      } else {
        // keyed / unkeyed, or manual fragments.
        // for keyed & unkeyed, since they are compiler generated from v-for,
        // each child is guaranteed to be a block so the fragment will never
        // have dynamicChildren.
        // 绑定不绑定键，或手动片段。
        // 对于绑定不绑定键，因为它们是由v-for生成的编译器，
        // 所以每个子块都保证是一个块，所以片段永远不会有dynamicChildren。
        patchChildren(
          n1,
          n2,
          container,
          fragmentEndAnchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
      }
    }
  }

  // 处理组件
  const processComponent = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    n2.slotScopeIds = slotScopeIds
    // n1为null表示初始化
    if (n1 == null) {
      // 新节点为被缓存的节点，执行父组件的上下文进行激活操作
      if (n2.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
        ;(parentComponent!.ctx as KeepAliveContext).activate(
          n2,
          container,
          anchor,
          isSVG,
          optimized
        )
      } else {
        // 否则挂载新组件
        mountComponent(
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      }
    } else {
      // 如果已经挂载过了，更新组件
      updateComponent(n1, n2, optimized)
    }
  }

  // 初始化挂载组件
  const mountComponent: MountComponentFn = (
    initialVNode, // 初始化vnode
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized
  ) => {
    // 2.x compat may pre-create the component instance before actually
    // mounting
    // 2.X compat可以在实际创建组件之前预先创建组件实例
    // 兼容挂载实例
    const compatMountInstance =
      __COMPAT__ && initialVNode.isCompatRoot && initialVNode.component
    // 如果有兼容版实例使用兼容版本
    // 创建一个新的instance
    const instance: ComponentInternalInstance =
      compatMountInstance ||
      (initialVNode.component = createComponentInstance(
        initialVNode,
        parentComponent,
        parentSuspense
      ))

    // 开发环境下，若已启用热更新，组件注册热更新
    if (__DEV__ && instance.type.__hmrId) {
      registerHMR(instance)
    }

    // 开发环境
    if (__DEV__) {
      // 在开始挂载前将当前实例置入警告上下文，并开启挂载前记录
      pushWarningContext(initialVNode)
      startMeasure(instance, `mount`)
    }

    // inject renderer internals for keepAlive
    // 为了实现keepAlive组件内部注入渲染器
    if (isKeepAlive(initialVNode)) {
      ;(instance.ctx as KeepAliveContext).renderer = internals
    }

    // resolve props and slots for setup context
    // 将props和slots收入setup上下文
    // 非兼容情况下
    if (!(__COMPAT__ && compatMountInstance)) {
      // 开启初始化记录
      if (__DEV__) {
        startMeasure(instance, `init`)
      }
      // 初始化
      setupComponent(instance)
      // 结束初始化记录
      if (__DEV__) {
        endMeasure(instance, `init`)
      }
    }

    // setup() is async. This component relies on async logic to be resolved
    // before proceeding
    // setup()是异步的。此组件在继续之前依赖于异步逻辑进行解析
    if (__FEATURE_SUSPENSE__ && instance.asyncDep) {
      // 父节点为悬疑节点，注册依赖
      parentSuspense && parentSuspense.registerDep(instance, setupRenderEffect)

      // Give it a placeholder if this is not hydration
      // TODO handle self-defined fallback
      // 给它一个占位符，如果这不是水合TODO处理自定义的回退
      if (!initialVNode.el) {
        // 创建占位符节点
        const placeholder = (instance.subTree = createVNode(Comment))
        // 处理注释节点
        processCommentNode(null, placeholder, container!, anchor)
      }
      return
    }

    // 手动执行setupRenderEffect, 设置副作用
    setupRenderEffect(
      instance,
      initialVNode,
      container,
      anchor,
      parentSuspense,
      isSVG,
      optimized
    )

    // 开发者环境，推出当前实例
    if (__DEV__) {
      popWarningContext()
      // 结束记录挂载
      endMeasure(instance, `mount`)
    }
  }

  // 更新组件
  const updateComponent = (n1: VNode, n2: VNode, optimized: boolean) => {
    const instance = (n2.component = n1.component)!
    // 组件是否应该更新
    if (shouldUpdateComponent(n1, n2, optimized)) {
      // 悬疑节点
      if (
        __FEATURE_SUSPENSE__ &&
        instance.asyncDep &&
        !instance.asyncResolved
      ) {
        // async & still pending - just update props and slots
        // since the component's reactive effect for render isn't set-up yet
        // 异步&仍在等待-只是更新props和slots，因为组件的为渲染而准备的响应式副作用渲染还没有设置
        if (__DEV__) {
          pushWarningContext(n2)
        }
        // 更新组件预渲染
        updateComponentPreRender(instance, n2, optimized)
        if (__DEV__) {
          popWarningContext()
        }
        return
      } else {
        // normal update
        // 正常更新
        instance.next = n2
        // in case the child component is also queued, remove it to avoid
        // double updating the same child component in the same flush.
        // 如果子组件也在队列中，请删除它，以避免在同一刷新中重复更新相同的子组件。
        invalidateJob(instance.update)
        // instance.update is the reactive effect.
        // 实例。更新是响应式效果。
        instance.update()
      }
    } else {
      // no update needed. just copy over properties
      // 不需要更新。仅覆盖属性
      n2.component = n1.component
      n2.el = n1.el
      instance.vnode = n2
    }
  }

  // 启动渲染副作用
  const setupRenderEffect: SetupRenderEffectFn = (
    instance,
    initialVNode,
    container,
    anchor,
    parentSuspense,
    isSVG,
    optimized
  ) => {
    // 创建更新函数
    const componentUpdateFn = () => {
      // 未挂载，此时执行初始化流程
      if (!instance.isMounted) {
        let vnodeHook: VNodeHook | null | undefined
        const { el, props } = initialVNode
        const { bm, m, parent } = instance
        const isAsyncWrapperVNode = isAsyncWrapper(initialVNode) // 异步vnode

        // 禁止递归
        toggleRecurse(instance, false)
        // beforeMount hook
        // beforeMount 钩子
        if (bm) {
          invokeArrayFns(bm)
        }
        // onVnodeBeforeMount
        // beforeMount钩子触发
        if (
          !isAsyncWrapperVNode &&
          (vnodeHook = props && props.onVnodeBeforeMount)
        ) {
          invokeVNodeHook(vnodeHook, parent, initialVNode)
        }
        // 兼容版本
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          instance.emit('hook:beforeMount')
        }
        // 开启递归
        toggleRecurse(instance, true)

        // 注水node
        if (el && hydrateNode) {
          // vnode has adopted host node - perform hydration instead of mount.
          // Vnode采用主节点水化而非挂载。
          const hydrateSubTree = () => {
            // 开始记录渲染
            if (__DEV__) {
              startMeasure(instance, `render`)
            }
            // 获取子树的虚拟dom
            instance.subTree = renderComponentRoot(instance)
            // 结束记录渲染
            if (__DEV__) {
              endMeasure(instance, `render`)
            }
            // 开始记录注水
            if (__DEV__) {
              startMeasure(instance, `hydrate`)
            }
            // 注水Node
            hydrateNode!(
              el as Node,
              instance.subTree,
              instance,
              parentSuspense,
              null
            )
            // 结束记录注水
            if (__DEV__) {
              endMeasure(instance, `hydrate`)
            }
          }

          // 是异步Vnode
          if (isAsyncWrapperVNode) {
            ;(initialVNode.type as ComponentOptions).__asyncLoader!().then(
              // note: we are moving the render call into an async callback,
              // which means it won't track dependencies - but it's ok because
              // a server-rendered async wrapper is already in resolved state
              // and it will never need to change.
              // 注意:我们正在将渲染调用移到异步回调中，
              // 这意味着它不会跟踪依赖项——但这是可以的，
              // 因为服务器渲染的异步包装器已经处于解析状态，它永远不需要更改。
              () => !instance.isUnmounted && hydrateSubTree()
            )
          } else {
            // 直接注水
            hydrateSubTree()
          }
        } else {
          // 开始记录渲染
          if (__DEV__) {
            startMeasure(instance, `render`)
          }
          // 获取虚拟DOM树
          const subTree = (instance.subTree = renderComponentRoot(instance))
          // 结束记录渲染
          if (__DEV__) {
            endMeasure(instance, `render`)
          }
          // 开始记录更新
          if (__DEV__) {
            startMeasure(instance, `patch`)
          }
          // 转化之前的vnode为node
          patch(
            null,
            subTree,
            container,
            anchor,
            instance,
            parentSuspense,
            isSVG
          )
          // 结束记录更新
          if (__DEV__) {
            endMeasure(instance, `patch`)
          }
          // 更换元素
          initialVNode.el = subTree.el
        }
        // mounted hook
        // mounted钩子
        if (m) {
          queuePostRenderEffect(m, parentSuspense)
        }
        // onVnodeMounted
        // mounted钩子
        if (
          !isAsyncWrapperVNode &&
          (vnodeHook = props && props.onVnodeMounted)
        ) {
          const scopedInitialVNode = initialVNode
          queuePostRenderEffect(
            () => invokeVNodeHook(vnodeHook!, parent, scopedInitialVNode),
            parentSuspense
          )
        }
        // 兼容 vue2
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          queuePostRenderEffect(
            () => instance.emit('hook:mounted'),
            parentSuspense
          )
        }

        // activated hook for keep-alive roots.
        // #1742 activated hook must be accessed after first render
        // since the hook may be injected by a child keep-alive
        // keep-alive激活的钩子的根节点
        // 被激活的钩子必须在第一次渲染后被访问，因为钩子可能被一个child keep-alive注入
        if (initialVNode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
          // 异步挂载
          instance.a && queuePostRenderEffect(instance.a, parentSuspense)
          // 兼容，异步触发 钩子
          if (
            __COMPAT__ &&
            isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
          ) {
            queuePostRenderEffect(
              () => instance.emit('hook:activated'),
              parentSuspense
            )
          }
        }
        // 挂载标记
        instance.isMounted = true

        // 开发者工具
        if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
          devtoolsComponentAdded(instance)
        }

        // #2458: deference mount-only object parameters to prevent memleaks
        // 遵从仅挂载对象参数以防止内存泄漏
        initialVNode = container = anchor = null as any
      } else {
        // updateComponent
        // This is triggered by mutation of component's own state (next: null)
        // OR parent calling processComponent (next: VNode)
        // 更新组件
        // 这是由组件自身状态的变化(next: null)
        // 或父组件调用processComponent (next: VNo .)触发的
        let { next, bu, u, parent, vnode } = instance
        let originNext = next
        let vnodeHook: VNodeHook | null | undefined
        if (__DEV__) {
          pushWarningContext(next || instance.vnode)
        }

        // Disallow component effect recursion during pre-lifecycle hooks.
        // 在生命周期前钩子期间禁止组件效果递归。
        toggleRecurse(instance, false)
        if (next) {
          next.el = vnode.el
          updateComponentPreRender(instance, next, optimized)
        } else {
          next = vnode
        }

        // beforeUpdate hook
        // beforeUpdate钩子
        if (bu) {
          invokeArrayFns(bu)
        }
        // onVnodeBeforeUpdate
        // beforeUpdate钩子
        if ((vnodeHook = next.props && next.props.onVnodeBeforeUpdate)) {
          invokeVNodeHook(vnodeHook, parent, next, vnode)
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          instance.emit('hook:beforeUpdate')
        }
        // 开启递归
        toggleRecurse(instance, true)

        // render
        if (__DEV__) {
          startMeasure(instance, `render`)
        }
        // 生成新的渲染树
        const nextTree = renderComponentRoot(instance)
        if (__DEV__) {
          endMeasure(instance, `render`)
        }
        // 旧的渲染树
        const prevTree = instance.subTree
        instance.subTree = nextTree

        if (__DEV__) {
          startMeasure(instance, `patch`)
        }
        // 打补丁 diff
        // 根据新老vnode之间的不同，判断出所要做的精确的dom操作
        patch(
          prevTree,
          nextTree,
          // parent may have changed if it's in a teleport
          // 父节点可能在teleport中被改变了
          hostParentNode(prevTree.el!)!,
          // anchor may have changed if it's in a fragment
          // 锚可能已经改变，如果它是在一个片段
          getNextHostNode(prevTree),
          instance,
          parentSuspense,
          isSVG
        )
        if (__DEV__) {
          endMeasure(instance, `patch`)
        }
        next.el = nextTree.el
        if (originNext === null) {
          // self-triggered update. In case of HOC, update parent component
          // vnode el. HOC is indicated by parent instance's subTree pointing
          // to child component's vnode
          // 是一种自发性的更新。在HOC情况下，更新父组件vnode el。
          // 由父实例的子树指向子组件的vnode来指示HOC
          updateHOCHostEl(instance, nextTree.el)
        }
        // updated hook
        // updated钩子
        if (u) {
          queuePostRenderEffect(u, parentSuspense)
        }
        // onVnodeUpdated
        if ((vnodeHook = next.props && next.props.onVnodeUpdated)) {
          queuePostRenderEffect(
            () => invokeVNodeHook(vnodeHook!, parent, next!, vnode),
            parentSuspense
          )
        }
        if (
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
        ) {
          queuePostRenderEffect(
            () => instance.emit('hook:updated'),
            parentSuspense
          )
        }
        // 开发者工具
        if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
          devtoolsComponentUpdated(instance)
        }
        // 警告上下文
        if (__DEV__) {
          popWarningContext()
        }
      }
    }

    // create reactive effect for rendering
    // 创建更新机制
    // 副作用：如果componentUpdateFn执行过程中有响应式数据发生变化
    // 则按照参数2（`() => queueJob(instance.update)`）的方式
    // 执行参数1(`componentUpdateFn`)
    // 为渲染创建响应式副作用
    const effect = (instance.effect = new ReactiveEffect(
      componentUpdateFn,
      () => queueJob(instance.update), // 通过调度器异步更新
      instance.scope // track it in component's effect scope
      // 在组件的影响作用域内跟踪它
    ))

    const update = (instance.update = effect.run.bind(effect) as SchedulerJob)
    update.id = instance.uid
    // allowRecurse
    // #1801, #2043 component render effects should allow recursive updates
    // 组件呈现效果应该允许递归更新
    toggleRecurse(instance, true)

    // 开发者实例
    if (__DEV__) {
      effect.onTrack = instance.rtc
        ? e => invokeArrayFns(instance.rtc!, e)
        : void 0
      effect.onTrigger = instance.rtg
        ? e => invokeArrayFns(instance.rtg!, e)
        : void 0
      // @ts-ignore (for scheduler)
      // 为了调度，拥有者的实例
      update.ownerInstance = instance
    }

    // 首次更新
    update()
  }

  // 在render前更新组件
  const updateComponentPreRender = (
    instance: ComponentInternalInstance,
    nextVNode: VNode,
    optimized: boolean
  ) => {
    nextVNode.component = instance
    const prevProps = instance.vnode.props
    instance.vnode = nextVNode
    instance.next = null
    // 更新属性
    updateProps(instance, nextVNode.props, prevProps, optimized)
    // 更新插槽
    updateSlots(instance, nextVNode.children, optimized)

    // 停止跟踪
    pauseTracking()
    // props update may have triggered pre-flush watchers.
    // flush them before the render update.
    // props更新可能触发了pre-flush的观察者。在渲染更新之前刷新它们。
    flushPreFlushCbs(undefined, instance.update)
    // 重置追踪（回退到上一步的追踪状态）
    resetTracking()
  }

  // 更新子节点
  const patchChildren: PatchChildrenFn = (
    n1,
    n2,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    slotScopeIds,
    optimized = false
  ) => {
    const c1 = n1 && n1.children
    const prevShapeFlag = n1 ? n1.shapeFlag : 0
    const c2 = n2.children

    const { patchFlag, shapeFlag } = n2
    // fast path
    // 优化路径
    if (patchFlag > 0) {
      if (patchFlag & PatchFlags.KEYED_FRAGMENT) {
        // this could be either fully-keyed or mixed (some keyed some not)
        // presence of patchFlag means children are guaranteed to be arrays
        // 这可以是全有键或混合(一些有键和一些没有键)的patchFlag的存在意味着子元素保证是数组
        patchKeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        return
      } else if (patchFlag & PatchFlags.UNKEYED_FRAGMENT) {
        // unkeyed
        // 没有键
        patchUnkeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        return
      }
    }

    // children has 3 possibilities: text, array or no children.
    // 子节点有3种可能:文本、数组或没有子节点。
    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      // text children fast path
      // 文本子进程快速路径
      // 如果之前的节点是数组节点，删除，然后若新旧不同重新设置新的文本节点
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        unmountChildren(c1 as VNode[], parentComponent, parentSuspense)
      }
      if (c2 !== c1) {
        hostSetElementText(container, c2 as string)
      }
    } else {
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // prev children was array
        // 之前的子节点是数组
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          // two arrays, cannot assume anything, do full diff
          // 现在的也是数组，两个数组，不能做任何假设，做全量diff
          patchKeyedChildren(
            c1 as VNode[],
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        } else {
          // no new children, just unmount old
          // 没有新节点，卸载旧的节点
          unmountChildren(c1 as VNode[], parentComponent, parentSuspense, true)
        }
      } else {
        // prev children was text OR null
        // new children is array OR null
        // 旧节点是文本或者null
        // 新节点是数组或者null
        // 文本清空
        if (prevShapeFlag & ShapeFlags.TEXT_CHILDREN) {
          hostSetElementText(container, '')
        }
        // mount new if array
        // 如果新节点是数组挂载新的节点
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          mountChildren(
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        }
      }
    }
  }

  // 更新不带key值的子节点
  // 从前往后更新每个子节点
  const patchUnkeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    c1 = c1 || EMPTY_ARR
    c2 = c2 || EMPTY_ARR
    const oldLength = c1.length
    const newLength = c2.length
    const commonLength = Math.min(oldLength, newLength)
    let i
    for (i = 0; i < commonLength; i++) {
      // 获取当前新节点
      const nextChild = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      // 更新当前节点
      patch(
        c1[i],
        nextChild,
        container,
        null,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized
      )
    }
    // 如果旧节点个数超出新节点个数就需要删除旧的节点
    if (oldLength > newLength) {
      // remove old
      // 移除就的
      unmountChildren(
        c1,
        parentComponent,
        parentSuspense,
        true,
        false,
        commonLength
      )
    } else { // 否则就挂载新的
      // mount new
      // 挂载新的
      mountChildren(
        c2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized,
        commonLength
      )
    }
  }

  // can be all-keyed or mixed
  // 更新带全部key或者部分带key的子节点，这里包含diff算法
  const patchKeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    parentAnchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    // 起始索引
    let i = 0
    // 新子节点列表的长度
    const l2 = c2.length
    // 旧子节点列表中结尾节点索引
    let e1 = c1.length - 1 // prev ending index
    // 新子节点列表中结尾节点索引
    let e2 = l2 - 1 // next ending index

    // 1. sync from start
    // (a b) c
    // (a b) d e
    // 从起始节点开始同步
    while (i <= e1 && i <= e2) {
      const n1 = c1[i]
      const n2 = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      if (isSameVNodeType(n1, n2)) { // 如果两节点类型相同，就更新这个节点
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
      } else {
        break
      }
      // 起始点++
      i++
    }

    // 2. sync from end
    // a (b c)
    // d e (b c)
    // 从尾部同步
    while (i <= e1 && i <= e2) {
      const n1 = c1[e1]
      const n2 = (c2[e2] = optimized
        ? cloneIfMounted(c2[e2] as VNode)
        : normalizeVNode(c2[e2]))
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          optimized
        )
      } else {
        break
      }
      // 尾--
      e1--
      e2--
    }

    // 3. common sequence + mount
    // 公共序列+挂载
    // (a b)
    // (a b) c
    // i = 2, e1 = 1, e2 = 2
    // (a b)
    // c (a b)
    // i = 0, e1 = -1, e2 = 0
    // 如果其中旧节点数量少于新节点数量
    if (i > e1) {
      if (i <= e2) {
        const nextPos = e2 + 1
        const anchor = nextPos < l2 ? (c2[nextPos] as VNode).el : parentAnchor
        while (i <= e2) {
          patch(
            null,
            (c2[i] = optimized
              ? cloneIfMounted(c2[i] as VNode)
              : normalizeVNode(c2[i])),
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
          i++
        }
      }
    }

    // 4. common sequence + unmount
    // 公共序列+卸载
    // (a b) c
    // (a b)
    // i = 2, e1 = 2, e2 = 1
    // a (b c)
    // (b c)
    // i = 0, e1 = 0, e2 = -1
    // 如果其中新节点数量小于旧节点数量
    else if (i > e2) {
      while (i <= e1) {
        unmount(c1[i], parentComponent, parentSuspense, true)
        i++
      }
    }

    // 5. unknown sequence
    // 未知序列
    // [i ... e1 + 1]: a b [c d e] f g
    // [i ... e2 + 1]: a b [e d c h] f g
    // i = 2, e1 = 4, e2 = 5
    else {
      // 旧的开始节点
      const s1 = i // prev starting index
      // 新的开始节点
      const s2 = i // next starting index

      // 5.1 build key:index map for newChildren
      // 构建关键字: 新节点的key值映射其索引 Map { key : Index}
      const keyToNewIndexMap: Map<string | number | symbol, number> = new Map()
      for (i = s2; i <= e2; i++) {
        // 新节点
        const nextChild = (c2[i] = optimized
          ? cloneIfMounted(c2[i] as VNode)
          : normalizeVNode(c2[i]))
        // 如果新节点的key不为null
        if (nextChild.key != null) {
          // 开发者环境下如果设置重复key会警告用户设置了重复的key
          if (__DEV__ && keyToNewIndexMap.has(nextChild.key)) {
            warn(
              `Duplicate keys found during update:`,
              JSON.stringify(nextChild.key),
              `Make sure keys are unique.`
            )
          }
          // 设置key值对应索引
          keyToNewIndexMap.set(nextChild.key, i)
        }
      }

      // 5.2 loop through old children left to be patched and try to patch
      // matching nodes & remove nodes that are no longer present
      // 循环遍历需要修补的旧子节点，并尝试修补匹配的节点，并删除不再存在的节点
      let j
      // 标记的个数
      let patched = 0
      // 需要标记补丁标记的子节点个数
      const toBePatched = e2 - s2 + 1
      // 该节点是否需要移动的标记
      let moved = false
      // used to track whether any node has moved
      // 用于跟踪节点是否移动
      // 用于记录新索引的最大值
      let maxNewIndexSoFar = 0
      // works as Map<newIndex, oldIndex>
      // Note that oldIndex is offset by +1
      // and oldIndex = 0 is a special value indicating the new node has
      // no corresponding old node.
      // used for determining longest stable subsequence
      // Map<newIndex, oldIndex>
      // 请注意，oldIndex的值为偏移量+1,oldIndex = 0是一个特殊值，表示新节点没有对应的旧节点。
      // 用于确定最长稳定子序列
      const newIndexToOldIndexMap = new Array(toBePatched)
      // 令每一个点的值为0
      for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0

      // 遍历旧节点
      for (i = s1; i <= e1; i++) {
        // 旧节点
        const prevChild = c1[i]
        // 超出时，卸载剩余节点
        if (patched >= toBePatched) {
          // all new children have been patched so this can only be a removal
          // 所有的新子节点都打了补丁
          unmount(prevChild, parentComponent, parentSuspense, true)
          continue
        }
        let newIndex
        // 旧节点有key
        if (prevChild.key != null) {
          // 找对应的新索引
          newIndex = keyToNewIndexMap.get(prevChild.key)
        } else {
          // key-less node, try to locate a key-less node of the same type
          // 无key节点，尝试定位, 直接粗暴的遍历
          for (j = s2; j <= e2; j++) {
            if (
              newIndexToOldIndexMap[j - s2] === 0 && // 该新节点索引没有对应的旧节点索引
              isSameVNodeType(prevChild, c2[j] as VNode) // type同且key同null
            ) {
              newIndex = j
              break
            }
          }
        }
        // 没有找到新的索引，那就卸载该旧节点
        if (newIndex === undefined) {
          unmount(prevChild, parentComponent, parentSuspense, true)
        } else {
          // 找到新的索引了，记录该索引
          newIndexToOldIndexMap[newIndex - s2] = i + 1
          // 该值大于当前新索引中的最大索引
          if (newIndex >= maxNewIndexSoFar) {
            // 更新新索引的最大值
            maxNewIndexSoFar = newIndex
          } else {
            // 小于，说名不符合索引递增的趋势，说明存在节点需要移动，标记移动
            moved = true
          }
          // 更新新旧节点，这里只是更新节点本身，并没有移动该节点
          patch(
            prevChild,
            c2[newIndex] as VNode,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
          // 打了补丁的个数++
          patched++
        }
      }

      // 5.3 move and mount
      // generate longest stable subsequence only when nodes have moved
      // 移动并且挂载
      // 只有当节点移动时才生成最长稳定子序列
      const increasingNewIndexSequence = moved
        ? getSequence(newIndexToOldIndexMap)
        : EMPTY_ARR
      // 令j为你最长递增子序列的尾索引
      j = increasingNewIndexSequence.length - 1
      // looping backwards so that we can use last patched node as anchor
      // 向后循环，这样我们就可以使用最后一个打过补丁的节点作为锚
      for (i = toBePatched - 1; i >= 0; i--) {
        // 新节点的索引
        const nextIndex = s2 + i
        // 新节点
        const nextChild = c2[nextIndex] as VNode
        // 锚点
        const anchor =
          nextIndex + 1 < l2 ? (c2[nextIndex + 1] as VNode).el : parentAnchor
        // 如果新节点对应的旧节点索引为0，说明原先不存在，直接挂载新的
        if (newIndexToOldIndexMap[i] === 0) {
          // mount new
          // 挂载新的
          patch(
            null,
            nextChild,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        } else if (moved) {
          // move if:
          // There is no stable subsequence (e.g. a reverse)
          // OR current node is not among the stable sequence
          // 如果:
          // 没有稳定子序列(例如反向)或当前节点不在稳定序列中，则移动
          // 每移动一个向前移一位，
          // 例如: 
          // a, b, c, d, e
          // e, b, a, d, c
          // 最长子序列 b d [1, 3]; j = 2
          // b d c; j = 1
          // b d c; j = 0
          // b a d c; j = 0
          // b a d c; j = -1
          // e b a d c; j = -1 
          // < 0 可以用来快速处理剩余元素
          if (j < 0 || i !== increasingNewIndexSequence[j]) {
            move(nextChild, container, anchor, MoveType.REORDER)
          } else {
            // 如果相等的话 j--
            j-- 
          }
        }
      }
    }
  }

  // 移动节点
  const move: MoveFn = (
    vnode,
    container,
    anchor,
    moveType,
    parentSuspense = null
  ) => {
    const { el, type, transition, children, shapeFlag } = vnode
    // 组件，移动组件的subtree
    if (shapeFlag & ShapeFlags.COMPONENT) {
      move(vnode.component!.subTree, container, anchor, moveType)
      return
    }

    // SUSPENSE 悬疑，移动悬疑容易
    if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
      vnode.suspense!.move(container, anchor, moveType)
      return
    }

    // TELEPORT 移动该节点
    if (shapeFlag & ShapeFlags.TELEPORT) {
      ;(type as typeof TeleportImpl).move(vnode, container, anchor, internals)
      return
    }

    // 片段，需要将其子节点全部移动
    if (type === Fragment) {
      // 移入片段头
      hostInsert(el!, container, anchor)
      for (let i = 0; i < (children as VNode[]).length; i++) {
        move((children as VNode[])[i], container, anchor, moveType)
      }
      // 移入片段尾
      hostInsert(vnode.anchor!, container, anchor)
      return
    }

    // 静态节点
    if (type === Static) {
      moveStaticNode(vnode, container, anchor)
      return
    }

    // single nodes
    // 单节点
    // 需要transition
    const needTransition =
      moveType !== MoveType.REORDER &&
      shapeFlag & ShapeFlags.ELEMENT &&
      transition
    if (needTransition) {
      // ENTER
      if (moveType === MoveType.ENTER) {
        // 先执行插入前操作
        transition!.beforeEnter(el!)
        // 插入节点
        hostInsert(el!, container, anchor)
        // 触发钩子
        queuePostRenderEffect(() => transition!.enter(el!), parentSuspense)
      } else {
        const { leave, delayLeave, afterLeave } = transition!
        // 插入函数
        const remove = () => hostInsert(el!, container, anchor)
        // 完整的transition-leave
        const performLeave = () => {
          leave(el!, () => {
            remove() // 插入
            afterLeave && afterLeave() // 插入回调
          })
        }
        // 延迟调用leave
        if (delayLeave) {
          delayLeave(el!, remove, performLeave)
        } else {
          // 直接调用leave
          performLeave()
        }
      }
    } else {
      // 插入节点
      hostInsert(el!, container, anchor)
    }
  }

  // 卸载
  const unmount: UnmountFn = (
    vnode,
    parentComponent,
    parentSuspense,
    doRemove = false,
    optimized = false
  ) => {
    const {
      type,
      props,
      ref,
      children,
      dynamicChildren,
      shapeFlag,
      patchFlag,
      dirs
    } = vnode
    // unset ref
    // 未设置的ref
    if (ref != null) {
      setRef(ref, null, parentSuspense, vnode, true)
    }

    // keep-alive组件，取消激活
    if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
      ;(parentComponent!.ctx as KeepAliveContext).deactivate(vnode)
      return
    }

    // 元素 指令
    const shouldInvokeDirs = shapeFlag & ShapeFlags.ELEMENT && dirs
    // 节点不是异步才能调用unmount的节点钩子
    const shouldInvokeVnodeHook = !isAsyncWrapper(vnode)

    let vnodeHook: VNodeHook | undefined | null
    if (
      shouldInvokeVnodeHook &&
      (vnodeHook = props && props.onVnodeBeforeUnmount)
    ) {
      invokeVNodeHook(vnodeHook, parentComponent, vnode)
    }

    // 组件
    if (shapeFlag & ShapeFlags.COMPONENT) {
      unmountComponent(vnode.component!, parentSuspense, doRemove)
    } else {
      // SUSPENSE 悬疑组件
      if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
        vnode.suspense!.unmount(parentSuspense, doRemove)
        return
      }

      // 应该调用钩子
      if (shouldInvokeDirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeUnmount')
      }

      // TELEPORT 移除节点
      if (shapeFlag & ShapeFlags.TELEPORT) {
        ;(vnode.type as typeof TeleportImpl).remove(
          vnode,
          parentComponent,
          parentSuspense,
          optimized,
          internals,
          doRemove
        )
      } else if (
        dynamicChildren &&
        // #1153: fast path should not be taken for non-stable (v-for) fragments
        // 对于不稳定(v-for)的碎片，不应采用快速路径
        (type !== Fragment ||
          (patchFlag > 0 && patchFlag & PatchFlags.STABLE_FRAGMENT))
      ) {
        // fast path for block nodes: only need to unmount dynamic children.
        // 块节点快速路径:仅需卸载动态子节点。
        unmountChildren(
          dynamicChildren,
          parentComponent,
          parentSuspense,
          false,
          true
        )
      } else if (
        (type === Fragment &&
          patchFlag &
            (PatchFlags.KEYED_FRAGMENT | PatchFlags.UNKEYED_FRAGMENT)) ||
        (!optimized && shapeFlag & ShapeFlags.ARRAY_CHILDREN)
      ) {
        // 片段且存在key或者没有key，不进行优化，且存在数组子节点
        // 卸载所有子节点
        unmountChildren(children as VNode[], parentComponent, parentSuspense)
      }
      // 移除虚拟节点
      if (doRemove) {
        remove(vnode)
      }
    }

    // 调用unmounted钩子
    if (
      (shouldInvokeVnodeHook &&
        (vnodeHook = props && props.onVnodeUnmounted)) ||
      shouldInvokeDirs
    ) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        shouldInvokeDirs &&
          invokeDirectiveHook(vnode, null, parentComponent, 'unmounted')
      }, parentSuspense)
    }
  }

  // 移除
  const remove: RemoveFn = vnode => {
    const { type, el, anchor, transition } = vnode
    // 片段
    if (type === Fragment) {
      removeFragment(el!, anchor!)
      return
    }

    // 静态
    if (type === Static) {
      removeStaticNode(vnode)
      return
    }

    // 元素移除，并触发transition对应的钩子
    const performRemove = () => {
      hostRemove(el!)
      if (transition && !transition.persisted && transition.afterLeave) {
        transition.afterLeave()
      }
    }

    // 如果节点为元素，且需要执行transition动画
    if (
      vnode.shapeFlag & ShapeFlags.ELEMENT &&
      transition &&
      !transition.persisted
    ) {
      const { leave, delayLeave } = transition
      const performLeave = () => leave(el!, performRemove)
      if (delayLeave) {
        // 延迟调用
        delayLeave(vnode.el!, performRemove, performLeave)
      } else {
        // 直接调用
        performLeave()
      }
    } else {
      // 直接调用
      performRemove()
    }
  }

  // 移除片段
  const removeFragment = (cur: RendererNode, end: RendererNode) => {
    // For fragments, directly remove all contained DOM nodes.
    // (fragment child nodes cannot have transition)
    // 对于fragment，直接删除所有包含的DOM节点。
    // (片段子节点不能有transition)
    let next
    while (cur !== end) {
      next = hostNextSibling(cur)!
      hostRemove(cur)
      cur = next
    }
    hostRemove(end)
  }

  // 卸载组件
  const unmountComponent = (
    instance: ComponentInternalInstance,
    parentSuspense: SuspenseBoundary | null,
    doRemove?: boolean
  ) => {
    // 注销组件热更新
    if (__DEV__ && instance.type.__hmrId) {
      unregisterHMR(instance)
    }

    const { bum, scope, update, subTree, um } = instance

    // beforeUnmount hook
    // beforeUnmount钩子
    if (bum) {
      invokeArrayFns(bum)
    }

    // 兼容版且能够兼容废弃的特性实例事件钩子，触发beforeDestroy
    if (
      __COMPAT__ &&
      isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
    ) {
      instance.emit('hook:beforeDestroy')
    }

    // stop effects in component scope
    // 停止组件作用域内的副作用
    scope.stop()

    // update may be null if a component is unmounted before its async
    // setup has resolved.
    // 如果组件在解决异步设置之前被卸载，则Update可能为空。
    if (update) {
      // so that scheduler will no longer invoke it
      // 因此调度器将不再调用它
      update.active = false
      unmount(subTree, instance, parentSuspense, doRemove)
    }
    // unmounted hook
    // unmounted 钩子，异步执行
    if (um) {
      queuePostRenderEffect(um, parentSuspense)
    }
    // 兼容版
    if (
      __COMPAT__ &&
      isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)
    ) {
      queuePostRenderEffect(
        () => instance.emit('hook:destroyed'),
        parentSuspense
      )
    }
    // 异步执行卸载
    queuePostRenderEffect(() => {
      instance.isUnmounted = true
    }, parentSuspense)

    // A component with async dep inside a pending suspense is unmounted before
    // its async dep resolves. This should remove the dep from the suspense, and
    // cause the suspense to resolve immediately if that was the last dep.
    // 正待解决的悬念组件中带有异步dep的组件会在它的异步dep解析之前被卸载。
    // 这应该能够将dep从悬念中移除，并且如果这是最后一个dep，那么悬念便能够立即得到解决。
    if (
      __FEATURE_SUSPENSE__ &&
      parentSuspense &&
      parentSuspense.pendingBranch &&
      !parentSuspense.isUnmounted &&
      instance.asyncDep &&
      !instance.asyncResolved &&
      instance.suspenseId === parentSuspense.pendingId
    ) {
      parentSuspense.deps--
      if (parentSuspense.deps === 0) {
        parentSuspense.resolve()
      }
    }

    // 开发者环境或者生产环境开启调试工具
    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      devtoolsComponentRemoved(instance)
    }
  }

  // 卸载子节点
  const unmountChildren: UnmountChildrenFn = (
    children,
    parentComponent,
    parentSuspense,
    doRemove = false,
    optimized = false,
    start = 0
  ) => {
    for (let i = start; i < children.length; i++) {
      unmount(children[i], parentComponent, parentSuspense, doRemove, optimized)
    }
  }

  // 获取下一个宿主节点
  const getNextHostNode: NextFn = vnode => {
    // 如果是该节点是组件，则获取其节点树中第一个节点
    if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
      return getNextHostNode(vnode.component!.subTree)
    }
    // 如果是悬疑节点
    if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
      return vnode.suspense!.next()
    }
    // 否则获取下一个相邻宿主节点
    return hostNextSibling((vnode.anchor || vnode.el)!)
  }

  // 渲染器
  const render: RootRenderFunction = (vnode, container, isSVG) => {
    if (vnode == null) {
      // 卸载
      if (container._vnode) {
        unmount(container._vnode, null, null, true)
      }
    } else {
      // 更新
      patch(container._vnode || null, vnode, container, null, null, null, isSVG)
    }
    // 执行全部异步回调，并推出这些回调
    flushPostFlushCbs()
    container._vnode = vnode
  }

  // 内部方法 简化名称
  const internals: RendererInternals = {
    p: patch, // 更新
    um: unmount, // 卸载
    m: move, // 移动
    r: remove, // 删除
    mt: mountComponent, // 挂载组件
    mc: mountChildren, // 挂载子节点
    pc: patchChildren, // 比较子节点
    pbc: patchBlockChildren, // 比较子节点块
    n: getNextHostNode, // 获取下一个宿主节点
    o: options // 获取选项
  }

  let hydrate: ReturnType<typeof createHydrationFunctions>[0] | undefined
  let hydrateNode: ReturnType<typeof createHydrationFunctions>[1] | undefined
  if (createHydrationFns) { // 创建SSR激活方法
    ;[hydrate, hydrateNode] = createHydrationFns(
      internals as RendererInternals<Node, Element>
    )
  }

  // 所谓渲染器，其实是一个对象，包含三个属性
  // render-渲染函数，hydrate-注水，用于ssr， createApp-实例函数
  return {
    render,
    hydrate,
    createApp: createAppAPI(render, hydrate)
  }
}

// 允许递归，关闭递归
function toggleRecurse(
  { effect, update }: ComponentInternalInstance,
  allowed: boolean
) {
  effect.allowRecurse = update.allowRecurse = allowed
}

/**
 * #1156
 * When a component is HMR-enabled, we need to make sure that all static nodes
 * inside a block also inherit the DOM element from the previous tree so that
 * HMR updates (which are full updates) can retrieve the element for patching.
 * 当一个组件启用HMR时，我们需要确保一个块内的所有静态节点也从前面的树中继承DOM元素，
 * 以便HMR更新(完全更新)可以检索用于打补丁的元素。
 *
 * #2080
 * Inside keyed `template` fragment static children, if a fragment is moved,
 * the children will always be moved. Therefore, in order to ensure correct move
 * position, el should be inherited from previous nodes.
 * 在带key的“模板”片段静态子片段中，如果一个片段被移动，子片段将始终被移动。
 * 因此，为了保证正确的移动位置，el应该继承自之前的节点。
 */
export function traverseStaticChildren(n1: VNode, n2: VNode, shallow = false) {
  const ch1 = n1.children
  const ch2 = n2.children
  if (isArray(ch1) && isArray(ch2)) {
    for (let i = 0; i < ch1.length; i++) {
      // this is only called in the optimized path so array children are
      // guaranteed to be vnodes
      // 这只在优化的路径中被调用，所以数组的子节点保证是vnode
      const c1 = ch1[i] as VNode
      let c2 = ch2[i] as VNode
      // c2是元素节点且c2没有动态子节点
      if (c2.shapeFlag & ShapeFlags.ELEMENT && !c2.dynamicChildren) {
        // c2的补丁标记不存在或者c2的补丁标记为SSR激活（注水）事件
        if (c2.patchFlag <= 0 || c2.patchFlag === PatchFlags.HYDRATE_EVENTS) {
          c2 = ch2[i] = cloneIfMounted(ch2[i] as VNode)
          c2.el = c1.el
        }
        // 深度遍历还要继续执行，浅度就此停止了
        if (!shallow) traverseStaticChildren(c1, c2)
      }
      // also inherit for comment nodes, but not placeholders (e.g. v-if which
      // would have received .el during block patch)
      // 也继承注释节点，但不继承占位符(例如v-if，它将在块补丁期间收到.el)
      if (__DEV__ && c2.type === Comment && !c2.el) {
        c2.el = c1.el
      }
    }
  }
}

// https://en.wikipedia.org/wiki/Longest_increasing_subsequence
// 最长递归子序列，用于diff算法
// 贪心+二分
function getSequence(arr: number[]): number[] {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
  const len = arr.length
  for (i = 0; i < len; i++) {
    const arrI = arr[i] // 当前
    if (arrI !== 0) {
      j = result[result.length - 1] // 栈顶元素索引
      if (arr[j] < arrI) { // 比栈顶元素大就放进去
        p[i] = j // 
        result.push(i) // 直接往后加索引
        continue
      }
      // 没有栈顶元素大，二分查找
      u = 0
      v = result.length - 1
      while (u < v) {
        c = (u + v) >> 1
        if (arr[result[c]] < arrI) {
          u = c + 1
        } else {
          v = c
        }
      }
      if (arrI < arr[result[u]]) { // 当前元素值如果小于u的索引指向的值
        if (u > 0) { // 如果u不是result里第一个元素
          p[i] = result[u - 1] // 记住从哪个索引来到这个索引的，就是和他上一个节点的关系
        }
        result[u] = i // 修改result第u个元素的索引
      }
    }
  }
  u = result.length // 获取result的长度
  v = result[u - 1] // v为尾元素，这个元素肯定是固定下来的
  while (u-- > 0) {
    result[u] = v
    v = p[v] // 从p里拿真实的值给result，因为这是对应了最长的子序列的真实值
  }
  return result
}
