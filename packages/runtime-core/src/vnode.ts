import {
  isArray,
  isFunction,
  isString,
  isObject,
  EMPTY_ARR,
  extend,
  normalizeClass,
  normalizeStyle,
  PatchFlags,
  ShapeFlags,
  SlotFlags,
  isOn
} from '@vue/shared'
import {
  ComponentInternalInstance,
  Data,
  ConcreteComponent,
  ClassComponent,
  Component,
  isClassComponent
} from './component'
import { RawSlots } from './componentSlots'
import { isProxy, Ref, toRaw, ReactiveFlags, isRef } from '@vue/reactivity'
import { AppContext } from './apiCreateApp'
import {
  SuspenseImpl,
  isSuspense,
  SuspenseBoundary
} from './components/Suspense'
import { DirectiveBinding } from './directives'
import { TransitionHooks } from './components/BaseTransition'
import { warn } from './warning'
import { TeleportImpl, isTeleport } from './components/Teleport'
import {
  currentRenderingInstance,
  currentScopeId
} from './componentRenderContext'
import { RendererNode, RendererElement } from './renderer'
import { NULL_DYNAMIC_COMPONENT } from './helpers/resolveAssets'
import { hmrDirtyComponents } from './hmr'
import { convertLegacyComponent } from './compat/component'
import { convertLegacyVModelProps } from './compat/componentVModel'
import { defineLegacyVNodeProperties } from './compat/renderFn'
import { callWithAsyncErrorHandling, ErrorCodes } from './errorHandling'
import { ComponentPublicInstance } from './componentPublicInstance'

/**
 * 片段
 */
export const Fragment = Symbol(__DEV__ ? 'Fragment' : undefined) as any as {
  __isFragment: true
  new (): {
    $props: VNodeProps
  }
}

/**
 * 文本
 */
export const Text = Symbol(__DEV__ ? 'Text' : undefined)
/**
 * 注释
 */
export const Comment = Symbol(__DEV__ ? 'Comment' : undefined)
/**
 * 静态标记
 */
export const Static = Symbol(__DEV__ ? 'Static' : undefined)

/**
 * 节点类型
 * 字符串、虚拟Dom、组件、文本、静态、注释、片段、teleport、suspense
 */
export type VNodeTypes =
  | string
  | VNode
  | Component
  | typeof Text
  | typeof Static
  | typeof Comment
  | typeof Fragment
  | typeof TeleportImpl
  | typeof SuspenseImpl

/**
 * 节点引用ref
 * 字符串、ref，或者方法setRef
 */
export type VNodeRef =
  | string
  | Ref
  | ((
      ref: Element | ComponentPublicInstance | null,
      refs: Record<string, any>
    ) => void)

// 
export type VNodeNormalizedRefAtom = {
  i: ComponentInternalInstance
  r: VNodeRef
  k?: string // setup ref key
  f?: boolean // refInFor marker
}

export type VNodeNormalizedRef =
  | VNodeNormalizedRefAtom
  | VNodeNormalizedRefAtom[]

type VNodeMountHook = (vnode: VNode) => void
type VNodeUpdateHook = (vnode: VNode, oldVNode: VNode) => void
export type VNodeHook =
  | VNodeMountHook
  | VNodeUpdateHook
  | VNodeMountHook[]
  | VNodeUpdateHook[]

// https://github.com/microsoft/TypeScript/issues/33099
export type VNodeProps = {
  key?: string | number | symbol // key
  ref?: VNodeRef // 引用，一般父节点传进来，收集ref用
  ref_for?: boolean
  ref_key?: string

  // vnode hooks
  // 虚拟节点钩子
  onVnodeBeforeMount?: VNodeMountHook | VNodeMountHook[]
  onVnodeMounted?: VNodeMountHook | VNodeMountHook[]
  onVnodeBeforeUpdate?: VNodeUpdateHook | VNodeUpdateHook[]
  onVnodeUpdated?: VNodeUpdateHook | VNodeUpdateHook[]
  onVnodeBeforeUnmount?: VNodeMountHook | VNodeMountHook[]
  onVnodeUnmounted?: VNodeMountHook | VNodeMountHook[]
}

/**
 * 子节点原子
 */
type VNodeChildAtom =
  | VNode
  | string
  | number
  | boolean
  | null
  | undefined
  | void

/**
 * 子节点数组
 */
export type VNodeArrayChildren = Array<VNodeArrayChildren | VNodeChildAtom>

/**
 * 子节点
 */
export type VNodeChild = VNodeChildAtom | VNodeArrayChildren

/**
 * 序列化的子节点数组
 */
export type VNodeNormalizedChildren =
  | string
  | VNodeArrayChildren
  | RawSlots
  | null

/**
 * __v_isVNode:是否是虚拟节点  
 * [ReactiveFlag.SKIP] 是否跳过 有时候做一些响应式处理有这个标记旧跳过  
 * type： 虚拟节点类型  
 * key:  
 * ref  
 * scopeId  
 * slotScopeId  
 * children 子节点  
 * component 组件  
 * dirs 指令  
 * transition 过渡  
 * el 元素  
 * anchor fragment 锚点  
 * target teleport 目标元素  
 * targetAnchor teleport 锚点  
 * staticCount 静态vnode中包含的元素数量   
 * suspense  
 * ssContent suspense 内容  
 * ssFallback suspense 失败、加载  
 * shapeFlag 类型标记   
 * patchFlag 补丁标记  
 * dynamicProps 动态属性  
 * dynamicChildren 动态节点   
 * appContext 根上下文  
 * memo v-memo  
 * isCompatRoot 是兼容性根节点  
 * ce 自定义元素拦截钩子  
 */
export interface VNode<
  HostNode = RendererNode, // 宿主节点
  HostElement = RendererElement, // 宿主元素
  ExtraProps = { [key: string]: any } // 额外的属性
> {
  /**
   * @internal
   */
  __v_isVNode: true // 是否是虚拟节点

  /**
   * @internal
   */
  [ReactiveFlags.SKIP]: true // 跳过响应式标记

  type: VNodeTypes // 虚拟节点类型
  props: (VNodeProps & ExtraProps) | null // 属性
  key: string | number | symbol | null // key
  ref: VNodeNormalizedRef | null // ref
  /**
   * SFC only. This is assigned on vnode creation using currentScopeId
   * which is set alongside currentRenderingInstance.
   * 仅在SFC。这是在创建vnode时使用currentScopeId分配的，
   * currentScopeId和currentRenderingInstance一起设置。
   */
  scopeId: string | null
  /**
   * SFC only. This is assigned to:
   * - Slot fragment vnodes with :slotted SFC styles.
   * - Component vnodes (during patch/hydration) so that its root node can
   *   inherit the component's slotScopeIds
   * 仅SFC。这被分配给:
   * - 槽位片段vnode:槽位SFC风格。
   * - 组件的vnode(在补丁/水化过程中)，这样它的根节点就可以继承组件的slotScopeIds
   * @internal
   */
  slotScopeIds: string[] | null
  children: VNodeNormalizedChildren // 子节点
  component: ComponentInternalInstance | null // 组件
  dirs: DirectiveBinding[] | null // 指令
  transition: TransitionHooks<HostElement> | null // 动画钩子

  // DOM
  el: HostNode | null // 真实dom
  anchor: HostNode | null // fragment anchor 片段会有锚点
  target: HostElement | null // teleport target teleport的目标位置
  targetAnchor: HostNode | null // teleport target anchor teleport的目标位置的锚点
  /**
   * number of elements contained in a static vnode
   * 静态vnode中包含的元素数量
   * @internal
   */
  staticCount: number

  // suspense suspense悬疑
  suspense: SuspenseBoundary | null
  /**
   * @internal
   */
  ssContent: VNode | null
  /**
   * @internal
   */
  ssFallback: VNode | null

  // optimization only 用于优化
  shapeFlag: number // 类型
  patchFlag: number // 补丁标记
  /**
   * @internal
   */
  dynamicProps: string[] | null // 动态的属性
  /**
   * @internal
   */
  dynamicChildren: VNode[] | null // 动态的子组件

  // application root node only 
  // 仅应用程序根节点
  appContext: AppContext | null

  /**
   * @internal attached by v-memo
   * 用于 v-memo 固定数组跳过更新
   */
  memo?: any[]
  /**
   * @internal __COMPAT__ only
   * 仅用于兼容
   */
  isCompatRoot?: true
  /**
   * @internal custom element interception hook
   * 自定义元素拦截钩子
   */
  ce?: (instance: ComponentInternalInstance) => void
}

// Since v-if and v-for are the two possible ways node structure can dynamically
// change, once we consider v-if branches and each v-for fragment a block, we
// can divide a template into nested blocks, and within each block the node
// structure would be stable. This allows us to skip most children diffing
// and only worry about the dynamic nodes (indicated by patch flags).
// 由于v-if和v-for是节点结构动态变化的两种可能方式，
// 一旦我们将v-if分支和每个v-for片段视为一个块，我们就可以将模板划分为嵌套的块，
// 在每个块中节点结构是稳定的。这允许我们跳过大多数子节点，只关心动态节点(由补丁标志表示)。
export const blockStack: (VNode[] | null)[] = []
export let currentBlock: VNode[] | null = null

/**
 * Open a block.
 * This must be called before `createBlock`. It cannot be part of `createBlock`
 * because the children of the block are evaluated before `createBlock` itself
 * is called. The generated code typically looks like this:
 * 打开一个块
 * 必须在createBlock之前调用。
 * 它不能是' createBlock '的一部分，因为在调用' createBlock '本身之前，
 * 该块的子块会被求值。生成的代码通常是这样的:
 * ```js
 * function render() {
 *   return (openBlock(),createBlock('div', null, [...]))
 * }
 * ```
 * disableTracking is true when creating a v-for fragment block, since a v-for
 * fragment always diffs its children.
 * 当创建v-for片段块时，disableTracking为真，因为v-for片段总是diff它的子节点。
 *
 * @private
 */
export function openBlock(disableTracking = false) {
  blockStack.push((currentBlock = disableTracking ? null : []))
}

// 关闭当前块
export function closeBlock() {
  blockStack.pop()
  currentBlock = blockStack[blockStack.length - 1] || null
}

// Whether we should be tracking dynamic child nodes inside a block.
// Only tracks when this value is > 0
// We are not using a simple boolean because this value may need to be
// incremented/decremented by nested usage of v-once (see below)
// 我们是否应该跟踪一个块内的动态子节点。
// 我们不使用简单的布尔值，因为这个值可能需要通过嵌套使用v-once来递增/递减(见下面)
export let isBlockTreeEnabled = 1

/**
 * Block tracking sometimes needs to be disabled, for example during the
 * creation of a tree that needs to be cached by v-once. The compiler generates
 * code like this:
 * 块跟踪有时需要禁用，例如在创建需要v-once缓存的树时。编译器生成如下代码:
 *
 * ``` js
 * _cache[1] || (
 *   setBlockTracking(-1),
 *   _cache[1] = createVNode(...),
 *   setBlockTracking(1),
 *   _cache[1]
 * )
 * ```
 *
 * @private
 */
export function setBlockTracking(value: number) {
  isBlockTreeEnabled += value
}

// 给该虚拟节点安装当前块
function setupBlock(vnode: VNode) {
  // save current block children on the block vnode
  // 在块vnode上保存当前块作为该vnode的动态子节点
  vnode.dynamicChildren =
    isBlockTreeEnabled > 0 ? currentBlock || (EMPTY_ARR as any) : null
  // close block
  // 闭合块
  closeBlock()
  // a block is always going to be patched, so track it as a child of its
  // parent block
  // 一个块总是会被修补，所以跟踪它作为它的父块的子块
  if (isBlockTreeEnabled > 0 && currentBlock) {
    currentBlock.push(vnode)
  }
  return vnode
}

/**
 * 创建元素块
 * @private
 */
export function createElementBlock(
  type: string | typeof Fragment, // 字符串|片段
  props?: Record<string, any> | null, // 属性
  children?: any, // 子节点
  patchFlag?: number, // 补丁标记
  dynamicProps?: string[], // 动态属性
  shapeFlag?: number // 节点形态
) {
  // 安装当前块
  return setupBlock(
    // 创建一个基本的虚拟节点
    createBaseVNode(
      type,
      props,
      children,
      patchFlag,
      dynamicProps,
      shapeFlag,
      true /* isBlock */
    )
  )
}

/**
 * Create a block root vnode. Takes the same exact arguments as `createVNode`.
 * A block root keeps track of dynamic nodes within the block in the
 * `dynamicChildren` array.
 * 创建块根vnode。参数与' createVNode '完全相同。
 * 块根跟踪' dynamicChildren '数组中块中的动态节点。
 *
 * @private
 */
export function createBlock(
  type: VNodeTypes | ClassComponent, // 虚拟节点|组件
  props?: Record<string, any> | null, // 属性
  children?: any, // 子节点
  patchFlag?: number, // 补丁标记
  dynamicProps?: string[] // 动态属性
): VNode {
  return setupBlock(
    createVNode(
      type,
      props,
      children,
      patchFlag,
      dynamicProps,
      true /* isBlock: prevent a block from tracking itself  防止一个块跟踪自己 */
    )
  )
}

// 是否是虚拟节点
export function isVNode(value: any): value is VNode {
  return value ? value.__v_isVNode === true : false
}

/**
 * 是相同的VNodeType（type相同且key相同就是相同节点）
 * @param n1 
 * @param n2 
 * @returns 
 */
export function isSameVNodeType(n1: VNode, n2: VNode): boolean {
  // 开发环境热更新组件一定返回false
  if (
    __DEV__ &&
    n2.shapeFlag & ShapeFlags.COMPONENT &&
    hmrDirtyComponents.has(n2.type as ConcreteComponent)
  ) {
    // HMR only: if the component has been hot-updated, force a reload.
    // 仅HMR:如果组件已热更新，则强制重新加载。
    return false
  }
  // n1和n2节点的type和key都相同，就是相同节点
  return n1.type === n2.type && n1.key === n2.key
}

let vnodeArgsTransformer:
  | ((
      args: Parameters<typeof _createVNode>,
      instance: ComponentInternalInstance | null
    ) => Parameters<typeof _createVNode>)
  | undefined

/**
 * Internal API for registering an arguments transform for createVNode
 * used for creating stubs in the test-utils
 * It is *internal* but needs to be exposed for test-utils to pick up proper
 * typings
 * 注册createVNode参数转换的内部API，该参数用于在test-utils中创建存根
 * 它是*内部的*，但是需要公开给test-utils以获得正确的类型
 */
export function transformVNodeArgs(transformer?: typeof vnodeArgsTransformer) {
  vnodeArgsTransformer = transformer
}

// 创建虚拟节点使用转化后的参数
const createVNodeWithArgsTransform = (
  ...args: Parameters<typeof _createVNode>
): VNode => {
  return _createVNode(
    ...(vnodeArgsTransformer
      ? vnodeArgsTransformer(args, currentRenderingInstance)
      : args)
  )
}

// 内部
export const InternalObjectKey = `__vInternal`

// 序列化的Key
const normalizeKey = ({ key }: VNodeProps): VNode['key'] =>
  key != null ? key : null

// 序列化的ref  这个ref是模板里那个引dom的
const normalizeRef = ({
  ref,
  ref_key,
  ref_for
}: VNodeProps): VNodeNormalizedRefAtom | null => {
  return (
    ref != null
      ? isString(ref) || isRef(ref) || isFunction(ref)
        ? { i: currentRenderingInstance, r: ref, k: ref_key, f: !!ref_for } // 字符串、ref或者Function
        : ref // 非字符串、Ref类型或者Function
      : null
  ) as any
}

/**
 * 创建基础的VNode对象
 * 主要针对普通元素节点创建的vnode。
 * 组件vnode是通过createVNode函数创建的
 * @param type 
 * @param props 
 * @param children 
 * @param patchFlag 
 * @param dynamicProps 
 * @param shapeFlag 
 * @param isBlockNode 
 * @param needFullChildrenNormalization 是否标准化子节点
 * @returns 
 */
function createBaseVNode(
  type: VNodeTypes | ClassComponent | typeof NULL_DYNAMIC_COMPONENT,
  props: (Data & VNodeProps) | null = null,
  children: unknown = null,
  patchFlag = 0,
  dynamicProps: string[] | null = null,
  shapeFlag = type === Fragment ? 0 : ShapeFlags.ELEMENT,
  isBlockNode = false,
  needFullChildrenNormalization = false
) {
  const vnode = {
    __v_isVNode: true,
    __v_skip: true,
    type,
    props,
    key: props && normalizeKey(props),
    ref: props && normalizeRef(props),
    scopeId: currentScopeId,
    slotScopeIds: null,
    children,
    component: null,
    suspense: null,
    ssContent: null,
    ssFallback: null,
    dirs: null,
    transition: null,
    el: null,
    anchor: null,
    target: null,
    targetAnchor: null,
    staticCount: 0,
    shapeFlag,
    patchFlag,
    dynamicProps,
    dynamicChildren: null,
    appContext: null
  } as VNode

  // 序列化子节点
  if (needFullChildrenNormalization) {
    normalizeChildren(vnode, children)
    // normalize suspense children
    // 序列化 suspense 子节点
    if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
      ;(type as typeof SuspenseImpl).normalize(vnode)
    }
  } else if (children) {
    // compiled element vnode - if children is passed, only possible types are
    // string or Array.
    // 被编译过的元素节点，如果传递子元素，只传递可能的类型（字符串或者数组）
    vnode.shapeFlag |= isString(children)
      ? ShapeFlags.TEXT_CHILDREN
      : ShapeFlags.ARRAY_CHILDREN
  }

  // validate key
  // 校验key
  if (__DEV__ && vnode.key !== vnode.key) {
    warn(`VNode created with invalid key (NaN). VNode type:`, vnode.type)
  }

  // 处理Block Tree
  // track vnode for block tree
  // 跟踪vnode用于生成block tree
  if (
    isBlockTreeEnabled > 0 &&
    // avoid a block node from tracking itself
    // 避免一个block跟踪自己
    !isBlockNode &&
    // has current parent block
    // 存在当前父Block
    currentBlock &&
    // presence of a patch flag indicates this node needs patching on updates.
    // component nodes also should always be patched, because even if the
    // component doesn't need to update, it needs to persist the instance on to
    // the next vnode so that it can be properly unmounted later.
    // 出现补丁标志表示该节点需要在更新时打补丁。
    // 组件节点也应该总是打补丁，因为即使组件不需要更新
    // 它需要将实例持久化到下一个vnode，以便稍后可以正确卸载它。
    (vnode.patchFlag > 0 || shapeFlag & ShapeFlags.COMPONENT) &&
    // the EVENTS flag is only for hydration and if it is the only flag, the
    // vnode should not be considered dynamic due to handler caching.
    // 这个事件标志仅仅用于注水并且如果它是唯一标记
    // 由于处理程序缓存，Vnode不应该被认为是动态的。
    vnode.patchFlag !== PatchFlags.HYDRATE_EVENTS
  ) {
    currentBlock.push(vnode)
  }

  if (__COMPAT__) {
    convertLegacyVModelProps(vnode)
    defineLegacyVNodeProperties(vnode)
  }
  return vnode
}

export { createBaseVNode as createElementVNode }

/**
 * 开发者环境需要转换参数，生产者环境就不用转换参数
 */
export const createVNode = (
  __DEV__ ? createVNodeWithArgsTransform : _createVNode
) as typeof _createVNode

/**
 * 创建组件VNode
 * @param type 
 * @param props 
 * @param children 
 * @param patchFlag 
 * @param dynamicProps 
 * @param isBlockNode 
 * @returns 
 */
function _createVNode(
  type: VNodeTypes | ClassComponent | typeof NULL_DYNAMIC_COMPONENT,
  props: (Data & VNodeProps) | null = null,
  children: unknown = null,
  patchFlag: number = 0,
  dynamicProps: string[] | null = null,
  isBlockNode = false
): VNode {
  // 判断type是否为空
  if (!type || type === NULL_DYNAMIC_COMPONENT) {
    if (__DEV__ && !type) {
      warn(`Invalid vnode type when creating vnode: ${type}.`)
    }
    type = Comment
  }
  // 判断type是不是一个vnode节点
  if (isVNode(type)) {
    // createVNode receiving an existing vnode. This happens in cases like
    // <component :is="vnode"/>
    // #2078 make sure to merge refs during the clone instead of overwriting it
    // createVNode接收一个存在的vnode
    // 这发生在某些情况中（如： <component :is="vnode" />
    // 确保在克隆过程中合并引用，而不是覆盖它
    const cloned = cloneVNode(type, props, true /* mergeRef: true */)
    if (children) {
      normalizeChildren(cloned, children)
    }
    if (isBlockTreeEnabled > 0 && !isBlockNode && currentBlock) {
      if (cloned.shapeFlag & ShapeFlags.COMPONENT) {
        currentBlock[currentBlock.indexOf(type)] = cloned
      } else {
        currentBlock.push(cloned)
      }
    }
    cloned.patchFlag |= PatchFlags.BAIL
    return cloned
  }

  // class component normalization.
  // class类型的组件序列化
  // 判断type是不是一个class类型的组件
  if (isClassComponent(type)) {
    type = type.__vccOpts
  }

  // 2.x async/functional component compat
  if (__COMPAT__) {
    type = convertLegacyComponent(type, currentRenderingInstance)
  }

  // class & style normalization.
  // class和style标准化
  if (props) {
    // for reactive or proxy objects, we need to clone it to enable mutation.
    // 对于反应性或代理对象，我们需要克隆它以启用突变。
    props = guardReactiveProps(props)!
    let { class: klass, style } = props
    if (klass && !isString(klass)) {
      props.class = normalizeClass(klass)
    }
    if (isObject(style)) {
      // reactive state objects need to be cloned since they are likely to be
      // mutated
      // 响应式状态对象需要被克隆因为他们很可能被修改
      if (isProxy(style) && !isArray(style)) {
        style = extend({}, style)
      }
      props.style = normalizeStyle(style)
    }
  }

  // encode the vnode type information into a bitmap
  // 对vnode类型信息做了编码
  const shapeFlag = isString(type)
    ? ShapeFlags.ELEMENT // 元素
    : __FEATURE_SUSPENSE__ && isSuspense(type)
    ? ShapeFlags.SUSPENSE // suspense
    : isTeleport(type)
    ? ShapeFlags.TELEPORT // teleport
    : isObject(type)
    ? ShapeFlags.STATEFUL_COMPONENT // 有状态组件
    : isFunction(type)
    ? ShapeFlags.FUNCTIONAL_COMPONENT // 无状态组件
    : 0

  if (__DEV__ && shapeFlag & ShapeFlags.STATEFUL_COMPONENT && isProxy(type)) {
    type = toRaw(type)
    warn(
      `Vue received a Component which was made a reactive object. This can ` +
        `lead to unnecessary performance overhead, and should be avoided by ` +
        `marking the component with \`markRaw\` or using \`shallowRef\` ` +
        `instead of \`ref\`.`,
      `\nComponent that was made reactive: `,
      type
    )
  }

  return createBaseVNode(
    type,
    props,
    children,
    patchFlag,
    dynamicProps,
    shapeFlag,
    isBlockNode,
    true
  )
}

// 守卫响应式的值，对响应式的值生成一份浅copy返回
export function guardReactiveProps(props: (Data & VNodeProps) | null) {
  if (!props) return null
  return isProxy(props) || InternalObjectKey in props
    ? extend({}, props)
    : props
}

// 克隆虚拟节点
export function cloneVNode<T, U>(
  vnode: VNode<T, U>, // vnode
  extraProps?: (Data & VNodeProps) | null, // 额外的属性
  mergeRef = false // 合并ref
): VNode<T, U> {
  // This is intentionally NOT using spread or extend to avoid the runtime
  // key enumeration cost.
  // 这是有意不使用扩展或扩展，以避免运行时key枚举成本。
  const { props, ref, patchFlag, children } = vnode
  // 合并属性
  const mergedProps = extraProps ? mergeProps(props || {}, extraProps) : props
  const cloned: VNode<T, U> = {
    __v_isVNode: true, // 是否是vnode
    __v_skip: true, // 是否跳动
    type: vnode.type, // 节点类型
    props: mergedProps, // 合并属性
    key: mergedProps && normalizeKey(mergedProps), // key
    ref:
      extraProps && extraProps.ref
        ? // #2078 in the case of <component :is="vnode" ref="extra"/>
          // if the vnode itself already has a ref, cloneVNode will need to merge
          // the refs so the single vnode can be set on multiple refs
          //  在<component的情况下:is="vnode" ref="extra"/>,
          // 如果vnode本身已经有一个ref, cloneVNode将需要合并ref，这样单个vnode可以在多个ref上设置
          mergeRef && ref
          ? isArray(ref)
            ? ref.concat(normalizeRef(extraProps)!)
            : [ref, normalizeRef(extraProps)!]
          : normalizeRef(extraProps)
        : ref,
    scopeId: vnode.scopeId, // 作用域Id
    slotScopeIds: vnode.slotScopeIds, // 作用域IdList
    children: // 子节点
      __DEV__ && patchFlag === PatchFlags.HOISTED && isArray(children)
        ? (children as VNode[]).map(deepCloneVNode)
        : children,
    target: vnode.target, // teleport移动点
    targetAnchor: vnode.targetAnchor, // teleport移动锚点
    staticCount: vnode.staticCount, // 静态节点数量
    shapeFlag: vnode.shapeFlag, // 形状标记
    // if the vnode is cloned with extra props, we can no longer assume its
    // existing patch flag to be reliable and need to add the FULL_PROPS flag.
    // note: preserve flag for fragments since they use the flag for children
    // fast paths only.
    // 如果用额外的prop克隆了vnode，我们就不能再假设它现有的补丁标志是可靠的，
    // 需要添加FULL_PROPS标志。注意:为片段保留标志，因为它们只对子快速路径使用该标志
    patchFlag:
      extraProps && vnode.type !== Fragment
        ? patchFlag === -1 // hoisted node 挂起节点
          ? PatchFlags.FULL_PROPS // 挂起节点返回全属性
          : patchFlag | PatchFlags.FULL_PROPS // 否则增加全属性补丁标记
        : patchFlag, // Fragment直接原样返回
    dynamicProps: vnode.dynamicProps, // 动态属性
    dynamicChildren: vnode.dynamicChildren, // 动态子节点
    appContext: vnode.appContext, // app上下文
    dirs: vnode.dirs, // 指令
    transition: vnode.transition, // 动画

    // These should technically only be non-null on mounted VNodes. However,
    // they *should* be copied for kept-alive vnodes. So we just always copy
    // them since them being non-null during a mount doesn't affect the logic as
    // they will simply be overwritten.
    // 从技术上讲，这些应该只在装载的vnode上是非空的。
    // 但是，对于保持活动状态的vnode，它们*应该*被复制。
    // 因此，我们总是复制它们，因为它们在挂载期间是非空的，这不会影响逻辑，因为它们将被简单地覆盖。
    component: vnode.component, // 组件
    suspense: vnode.suspense, // suspense
    ssContent: vnode.ssContent && cloneVNode(vnode.ssContent),
    ssFallback: vnode.ssFallback && cloneVNode(vnode.ssFallback),
    el: vnode.el, // dom元素
    anchor: vnode.anchor // 锚点
  }
  // 兼容
  if (__COMPAT__) {
    defineLegacyVNodeProperties(cloned as VNode)
  }
  return cloned as any
}

/**
 * Dev only, for HMR of hoisted vnodes reused in v-for
 * 仅适用于Dev，用于v-for中重用的挂起的vnodes的HMR
 * https://github.com/vitejs/vite/issues/2022
 */
function deepCloneVNode(vnode: VNode): VNode {
  const cloned = cloneVNode(vnode)
  if (isArray(vnode.children)) {
    cloned.children = (vnode.children as VNode[]).map(deepCloneVNode)
  }
  return cloned
}

/**
 * 文本节点
 * @private
 */
export function createTextVNode(text: string = ' ', flag: number = 0): VNode {
  return createVNode(Text, null, text, flag)
}

/**
 * 创建静态节点
 * @private
 */
export function createStaticVNode(
  content: string,
  numberOfNodes: number
): VNode {
  // A static vnode can contain multiple stringified elements, and the number
  // of elements is necessary for hydration.
  // 静态vnode可以包含多个字符串化元素，元素的数量对于水化是必要的
  const vnode = createVNode(Static, null, content)
  vnode.staticCount = numberOfNodes
  return vnode
}

/**
 * 创建注释节点
 * @private
 */
export function createCommentVNode(
  text: string = '', 
  // when used as the v-else branch, the comment node must be created as a
  // block to ensure correct updates.
  // 当用作v-else分支时，注释节点必须创建为一个块，以确保正确的更新。
  asBlock: boolean = false
): VNode {
  return asBlock
    ? (openBlock(), createBlock(Comment, null, text))
    : createVNode(Comment, null, text)
}

/**
 * 标准化虚拟节点
 * @param child 
 * @returns 
 */
export function normalizeVNode(child: VNodeChild): VNode {
  if (child == null || typeof child === 'boolean') {
    // empty placeholder
    // 使用注释产生空占位
    return createVNode(Comment)
  } else if (isArray(child)) {
    // fragment
    // 如果是子节点数组，创建片段
    return createVNode(
      Fragment,
      null,
      // #3666, avoid reference pollution when reusing vnode
      // 在重用vnode时避免引用污染，浅拷贝一份数组
      child.slice()
    )
  } else if (typeof child === 'object') {
    // already vnode, this should be the most common since compiled templates
    // always produce all-vnode children arrays
    // 已经是vnode了，这应该是最常见的，因为编译后的模板总是产生全vnode的子数组
    return cloneIfMounted(child)
  } else {
    // strings and numbers
    // 字符串和数字，创建文本节点
    return createVNode(Text, null, String(child))
  }
}

// optimized normalization for template-compiled render fns
// 优化了模板编译渲染FNS的规范化
// 节点没有挂载到dom上返回false，挂载的话，看看是否是固定数组，
// 固定数组就用当前元素，不是固定数组，克隆该节点
export function cloneIfMounted(child: VNode): VNode {
  return (child.el === null && child.patchFlag !== PatchFlags.HOISTED) ||
    child.memo
    ? child
    : cloneVNode(child)
}

// 序列/常规化子节点
export function normalizeChildren(vnode: VNode, children: unknown) {
  // 类型
  let type = 0
  // 形状
  const { shapeFlag } = vnode
  // 子节点为空就是空，防止类似false
  if (children == null) {
    children = null
  } else if (isArray(children)) { // 子节点是数组
    type = ShapeFlags.ARRAY_CHILDREN
  } else if (typeof children === 'object') { // 子节点是对象
    if (shapeFlag & (ShapeFlags.ELEMENT | ShapeFlags.TELEPORT)) { // 元素或者teleport
      // Normalize slot to plain children for plain element and Teleport
      // 为普通元素和teleport将插槽规范化为普通子元素
      const slot = (children as any).default
      if (slot) {
        // _c marker is added by withCtx() indicating this is a compiled slot
        // _c标记是由withCtx()添加的，表示这是一个编译后的槽位
        slot._c && (slot._d = false)
        // 递归序列化插槽
        normalizeChildren(vnode, slot())
        slot._c && (slot._d = true)
      }
      return
    } else { // 插槽子节点
      type = ShapeFlags.SLOTS_CHILDREN // 插槽子节点
      const slotFlag = (children as RawSlots)._ // 插槽的标记
      if (!slotFlag && !(InternalObjectKey in children!)) {
        // if slots are not normalized, attach context instance
        // (compiled / normalized slots already have context)
        // 如果插槽没有被规范化，则附加上下文实例(已编译/规范化的插槽已经有上下文)
        ;(children as RawSlots)._ctx = currentRenderingInstance
      } else if (slotFlag === SlotFlags.FORWARDED && currentRenderingInstance) {
        // a child component receives forwarded slots from the parent.
        // its slot type is determined by its parent's slot type.
        // 子组件从父组件接收转发槽。它的槽类型由它的父槽类型决定。
        // 从父组件中或者插槽是否可变
        if (
          (currentRenderingInstance.slots as RawSlots)._ === SlotFlags.STABLE
        ) {
          // 插槽是静态的
          ;(children as RawSlots)._ = SlotFlags.STABLE
        } else {
          // 插槽是动态的
          ;(children as RawSlots)._ = SlotFlags.DYNAMIC
          // 增加动态插槽补丁标志
          vnode.patchFlag |= PatchFlags.DYNAMIC_SLOTS
        }
      }
    }
  } else if (isFunction(children)) {
    // 子节点为函数，类型为插槽子节点
    children = { default: children, _ctx: currentRenderingInstance }
    type = ShapeFlags.SLOTS_CHILDREN
  } else {
    children = String(children)
    // force teleport children to array so it can be moved around
    // 强制传送子节点到数组，这样它就可以移动
    if (shapeFlag & ShapeFlags.TELEPORT) {
      type = ShapeFlags.ARRAY_CHILDREN
      children = [createTextVNode(children as string)]
    } else {
      // 文本子节点
      type = ShapeFlags.TEXT_CHILDREN
    }
  }
  // 文本子节点
  vnode.children = children as VNodeNormalizedChildren
  // 补充修正类型
  vnode.shapeFlag |= type
}

// 合并属性
export function mergeProps(...args: (Data & VNodeProps)[]) {
  const ret: Data = {}
  for (let i = 0; i < args.length; i++) {
    const toMerge = args[i]
    for (const key in toMerge) {
      if (key === 'class') {
        if (ret.class !== toMerge.class) {
          // 对类做处理，生成一个字符串
          ret.class = normalizeClass([ret.class, toMerge.class])
        }
      } else if (key === 'style') {
        // 对样式处理生成一个字符串|对象|undefined
        ret.style = normalizeStyle([ret.style, toMerge.style])
      } else if (isOn(key)) { // 以on开头
        const existing = ret[key]
        const incoming = toMerge[key]
        // 如果现在存在，且没有包含在已存在的数组中，则添加
        if (
          incoming &&
          existing !== incoming &&
          !(isArray(existing) && existing.includes(incoming))
        ) {
          ret[key] = existing
            ? [].concat(existing as any, incoming as any)
            : incoming
        }
      } else if (key !== '') {
        ret[key] = toMerge[key]
      }
    }
  }
  return ret
}

// 调用钩子
export function invokeVNodeHook(
  hook: VNodeHook,
  instance: ComponentInternalInstance | null,
  vnode: VNode,
  prevVNode: VNode | null = null
) {
  // 异步调用，携带错误处理
  callWithAsyncErrorHandling(hook, instance, ErrorCodes.VNODE_HOOK, [
    vnode,
    prevVNode
  ])
}
