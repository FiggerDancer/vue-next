import {
  getCurrentInstance,
  SetupContext,
  ComponentInternalInstance,
  ComponentOptions
} from '../component'
import {
  cloneVNode,
  Comment,
  isSameVNodeType,
  VNode,
  VNodeArrayChildren,
  Fragment
} from '../vnode'
import { warn } from '../warning'
import { isKeepAlive } from './KeepAlive'
import { toRaw } from '@vue/reactivity'
import { callWithAsyncErrorHandling, ErrorCodes } from '../errorHandling'
import { ShapeFlags, PatchFlags } from '@vue/shared'
import { onBeforeUnmount, onMounted } from '../apiLifecycle'
import { RendererElement } from '../renderer'

/**
 * 基础过渡属性
 * mode 模式 in-out：新元素先进行过渡，完成之后当前元素过渡离开。  
 *          out-in：当前元素先进行过渡，完成之后新元素过渡进入。  
 * appear 是enter还是appear（appear属性可以设置初始化渲染的过渡）  
 * persisted 暗示这个过渡只有切换显示隐藏过渡
 */
export interface BaseTransitionProps<HostElement = RendererElement> {
  mode?: 'in-out' | 'out-in' | 'default'
  appear?: boolean

  // If true, indicates this is a transition that doesn't actually insert/remove
  // the element, but toggles the show / hidden status instead.
  // The transition hooks are injected, but will be skipped by the renderer.
  // Instead, a custom directive can control the transition by calling the
  // injected hooks (e.g. v-show).
  // 如果为真，暗示这是一个过渡没有插入和移除元素，只是切换显示隐藏状态
  // 这个过渡的钩子被注入，但将被渲染器跳过
  // 然而，一个自定义的指令可能控制这个过渡通过调用被注入的钩子
  persisted?: boolean

  // Hooks. Using camel case for easier usage in render functions & JSX.
  // In templates these can be written as @before-enter="xxx" as prop names
  // are camelized.
  // 钩子，使用驼峰写法在渲染函数和jsx中是更简单易用的
  // 在模板里这些将被成类似 @before-enter，它们作为属性时会驼峰化
  onBeforeEnter?: (el: HostElement) => void
  onEnter?: (el: HostElement, done: () => void) => void
  onAfterEnter?: (el: HostElement) => void
  onEnterCancelled?: (el: HostElement) => void
  // leave
  // 离开
  onBeforeLeave?: (el: HostElement) => void
  onLeave?: (el: HostElement, done: () => void) => void
  onAfterLeave?: (el: HostElement) => void
  onLeaveCancelled?: (el: HostElement) => void // only fired in persisted mode
  // 仅仅被触发在永久模式
  // appear
  // 第一次渲染
  onBeforeAppear?: (el: HostElement) => void
  onAppear?: (el: HostElement, done: () => void) => void
  onAfterAppear?: (el: HostElement) => void
  onAppearCancelled?: (el: HostElement) => void
}

/**
 * 过渡钩子
 */
export interface TransitionHooks<
  HostElement extends RendererElement = RendererElement
> {
  mode: BaseTransitionProps['mode']
  persisted: boolean
  beforeEnter(el: HostElement): void
  enter(el: HostElement): void
  leave(el: HostElement, remove: () => void): void
  clone(vnode: VNode): TransitionHooks<HostElement>
  // optional
  // 可选的
  afterLeave?(): void
  delayLeave?(
    el: HostElement,
    earlyRemove: () => void,
    delayedLeave: () => void
  ): void
  delayedLeave?(): void
}

/** 过渡钩子调用者 */
export type TransitionHookCaller = (
  hook: ((el: any) => void) | Array<(el: any) => void> | undefined,
  args?: any[]
) => void

/** 等待回调 */ 
export type PendingCallback = (cancelled?: boolean) => void

/**
 * 过渡状态
 * leavingVNodes 正被移除的节点
 */
export interface TransitionState {
  isMounted: boolean
  isLeaving: boolean
  isUnmounting: boolean
  // Track pending leave callbacks for children of the same key.
  // This is used to force remove leaving a child when a new copy is entering.
  // 跟踪等待离开的回调，因为存在相同key的子节点
  // 这被用来强制移除一个离开的子节点当一个新的副本加入时
  leavingVNodes: Map<any, Record<string, VNode>>
}

/**
 * 过渡元素
 */
export interface TransitionElement {
  // in persisted mode (e.g. v-show), the same element is toggled, so the
  // pending enter/leave callbacks may need to be cancelled if the state is toggled
  // before it finishes.
  // 在永久模式中v-show，相同元素切换，等待进入或离开
  // 回调可能需要被取消如果状态在它结束前切换
  _enterCb?: PendingCallback
  _leaveCb?: PendingCallback
}

/**
 * 获取transition过渡的状态
 * isMounted 已挂载
 * isLeaving: 正离开
 * isUmounting: 卸载中
 * leavingVNodes: 离开的虚拟节点
 * @returns 
 */
export function useTransitionState(): TransitionState {
  const state: TransitionState = {
    isMounted: false,
    isLeaving: false,
    isUnmounting: false,
    leavingVNodes: new Map()
  }
  onMounted(() => {
    state.isMounted = true
  })
  onBeforeUnmount(() => {
    state.isUnmounting = true
  })
  return state
}

/**
 * 过渡钩子校验
 */
const TransitionHookValidator = [Function, Array]

const BaseTransitionImpl: ComponentOptions = {
  name: `BaseTransition`,

  props: {
    mode: String,
    appear: Boolean,
    persisted: Boolean,
    // enter
    // 进入
    onBeforeEnter: TransitionHookValidator,
    onEnter: TransitionHookValidator,
    onAfterEnter: TransitionHookValidator,
    onEnterCancelled: TransitionHookValidator,
    // leave
    // 离开
    onBeforeLeave: TransitionHookValidator,
    onLeave: TransitionHookValidator,
    onAfterLeave: TransitionHookValidator,
    onLeaveCancelled: TransitionHookValidator,
    // appear
    // 第一次渲染
    onBeforeAppear: TransitionHookValidator,
    onAppear: TransitionHookValidator,
    onAfterAppear: TransitionHookValidator,
    onAppearCancelled: TransitionHookValidator
  },

  setup(props: BaseTransitionProps, { slots }: SetupContext) {
    // 获取实例和过渡状态
    const instance = getCurrentInstance()!
    const state = useTransitionState()

    // 上一个过渡的key
    let prevTransitionKey: any

    return () => {
      // 获取过渡原始子节点
      const children =
        slots.default && getTransitionRawChildren(slots.default(), true)
      if (!children || !children.length) {
        return
      }

      // warn multiple elements
      // 多个元素时进行警告
      if (__DEV__ && children.length > 1) {
        warn(
          '<transition> can only be used on a single element or component. Use ' +
            '<transition-group> for lists.'
        )
      }

      // there's no need to track reactivity for these props so use the raw
      // props for a bit better perf
      // 不需要跟踪这些props的响应式，所以直接用原始值拥有更好的性能
      const rawProps = toRaw(props)
      const { mode } = rawProps
      // check mode
      // 检查模式，无效警告
      if (
        __DEV__ &&
        mode &&
        mode !== 'in-out' && mode !== 'out-in' && mode !== 'default'
      ) {
        warn(`invalid <transition> mode: ${mode}`)
      }

      // at this point children has a guaranteed length of 1.
      // 此时子元素的保证长度为1。
      const child = children[0]
      if (state.isLeaving) {
        return emptyPlaceholder(child)
      }

      // in the case of <transition><keep-alive/></transition>, we need to
      // compare the type of the kept-alive children.
      // 像是<transition><keep-alive></keep-alive></transition>这种
      // 我们需要比较缓存子节点的类型
      const innerChild = getKeepAliveChild(child)
      if (!innerChild) {
        return emptyPlaceholder(child)
      }
      // 进入的钩子
      const enterHooks = resolveTransitionHooks(
        innerChild,
        rawProps,
        state,
        instance
      )
      // 设置过渡钩子
      setTransitionHooks(innerChild, enterHooks)
      // 旧的子节点
      const oldChild = instance.subTree
      // 旧的内部节点，获取其内部缓存的子节点
      const oldInnerChild = oldChild && getKeepAliveChild(oldChild)
      // 标志过渡的key是否发生变化
      let transitionKeyChanged = false
      // 从缓存的组件中获取过渡的key
      const { getTransitionKey } = innerChild.type as any
      // 如果存在获取过渡key的方法
      if (getTransitionKey) {
        // 获取key
        const key = getTransitionKey()
        // 之前没有key，设置之前的key为当前key，之前的key与当前不相等，则重置key，并标记key发生过变化
        if (prevTransitionKey === undefined) {
          prevTransitionKey = key
        } else if (key !== prevTransitionKey) {
          prevTransitionKey = key
          transitionKeyChanged = true
        }
      }

      // handle mode
      // 处理模式
      if (
        // 旧的缓存子节点不是注释且与新节点不同或key值已经修改过
        oldInnerChild &&
        oldInnerChild.type !== Comment &&
        (!isSameVNodeType(innerChild, oldInnerChild) || transitionKeyChanged)
      ) {
        // 离开中钩子，解决过渡钩子
        const leavingHooks = resolveTransitionHooks(
          oldInnerChild, // 旧的缓存节点
          rawProps, // 原始props
          state, // 状态
          instance // 实例
        )
        // update old tree's hooks in case of dynamic transition
        // 更新旧节点树的钩子由于动态过渡
        setTransitionHooks(oldInnerChild, leavingHooks)
        // switching between different views
        // 在不同视图中切换
        if (mode === 'out-in') {
          // out-in 模式
          // 正在离开设置为true
          state.isLeaving = true
          // return placeholder node and queue update when leave finishes
          // 当leave完成时返回占位符节点和队列更新
          leavingHooks.afterLeave = () => {
            // 状态正在离开中结束
            state.isLeaving = false
            // 更新实例
            instance.update()
          }
          // 返回节点空的占位符
          return emptyPlaceholder(child)
        } else if (mode === 'in-out' && innerChild.type !== Comment) {
          // in-out模式且不为注释
          // 延迟离开
          leavingHooks.delayLeave = (
            el: TransitionElement,
            earlyRemove,
            delayedLeave
          ) => {
            // 离开中的节点缓存
            // 获取正在离开的虚拟节点类型
            const leavingVNodesCache = getLeavingNodesForType(
              state,
              oldInnerChild
            )
            // 设置正离开的虚拟节点
            leavingVNodesCache[String(oldInnerChild.key)] = oldInnerChild
            // early removal callback
            // 早期移除回调
            el._leaveCb = () => {
              earlyRemove()
              // 删除清空
              el._leaveCb = undefined
              // 删除进入钩子中的延迟离开
              delete enterHooks.delayedLeave
            }
            // 将进入勾子中的延迟离开设置为延迟离开
            enterHooks.delayedLeave = delayedLeave
          }
        }
      }

      return child
    }
  }
}

if (__COMPAT__) {
  // 兼容性，增加内置属性
  BaseTransitionImpl.__isBuiltIn = true
}

// export the public type for h/tsx inference
// also to avoid inline import() in generated d.ts files
/**
 * 导出公共类型对于h函数或者tsx引用
 * 也为了避免在产生的d.ts文件时生成内联import()
 */
export const BaseTransition = BaseTransitionImpl as any as {
  new (): {
    $props: BaseTransitionProps<any>
  }
}

/**
 * 根据vnode类型，获取正在离开的节点
 * @param state 
 * @param vnode 
 * @returns 
 */
function getLeavingNodesForType(
  state: TransitionState,
  vnode: VNode
): Record<string, VNode> {
  const { leavingVNodes } = state
  let leavingVNodesCache = leavingVNodes.get(vnode.type)!
  if (!leavingVNodesCache) {
    leavingVNodesCache = Object.create(null)
    leavingVNodes.set(vnode.type, leavingVNodesCache)
  }
  return leavingVNodesCache
}

// The transition hooks are attached to the vnode as vnode.transition
// and will be called at appropriate timing in the renderer.
/**
 * 过渡钩子作为vnode附加到vnode的transition上 并将在适当的时间在渲染器中调用。
 * @param vnode 
 * @param props 
 * @param state 
 * @param instance 
 * @returns 
 */
export function resolveTransitionHooks(
  vnode: VNode,
  props: BaseTransitionProps<any>,
  state: TransitionState,
  instance: ComponentInternalInstance
): TransitionHooks {
  const {
    appear,
    mode,
    persisted = false,
    onBeforeEnter,
    onEnter,
    onAfterEnter,
    onEnterCancelled,
    onBeforeLeave,
    onLeave,
    onAfterLeave,
    onLeaveCancelled,
    onBeforeAppear,
    onAppear,
    onAfterAppear,
    onAppearCancelled
  } = props
  const key = String(vnode.key)
  const leavingVNodesCache = getLeavingNodesForType(state, vnode)

  // 带参调用钩子
  const callHook: TransitionHookCaller = (hook, args) => {
    hook &&
      callWithAsyncErrorHandling(
        hook,
        instance,
        ErrorCodes.TRANSITION_HOOK,
        args
      )
  }

  // 各种钩子
  const hooks: TransitionHooks<TransitionElement> = {
    mode,
    persisted,
    // 进入
    beforeEnter(el) {
      // 获取节点原先的钩子
      let hook = onBeforeEnter
      if (!state.isMounted) {
        // 如果节点没有被挂载，且使用appear第一次出现的钩子
        if (appear) {
          hook = onBeforeAppear || onBeforeEnter
        } else {
          return
        }
      }
      // for same element (v-show)
      // 对于相同的元素 v-show
      if (el._leaveCb) {
        // 取消移除
        el._leaveCb(true /* cancelled */)
      }
      // for toggled element with same key (v-if)
      // 对于具有相同键的互斥元素 v-if
      const leavingVNode = leavingVNodesCache[key]
      // 离开中的节点与该节点相同且离开中的节点有_leaveCb
      if (
        leavingVNode &&
        isSameVNodeType(vnode, leavingVNode) &&
        leavingVNode.el!._leaveCb
      ) {
        // force early removal (not cancelled)
        // 强制先期移除
        leavingVNode.el!._leaveCb()
      }
      // 调用钩子
      callHook(hook, [el])
    },

    // 进入
    enter(el) {
      // 获取钩子
      let hook = onEnter
      let afterHook = onAfterEnter
      let cancelHook = onEnterCancelled
      // 未挂载
      if (!state.isMounted) {
        // 如果是出现
        if (appear) {
          hook = onAppear || onEnter
          afterHook = onAfterAppear || onAfterEnter
          cancelHook = onAppearCancelled || onEnterCancelled
        } else {
          return
        }
      }
      // 被调用过
      let called = false
      // 手动调用结束过渡函数
      const done = (el._enterCb = (cancelled?) => {
        if (called) return
        called = true
        if (cancelled) { // 如果取消
          callHook(cancelHook, [el])
        } else { // 不取消，则是结束
          callHook(afterHook, [el])
        }
        if (hooks.delayedLeave) { // 延迟离开钩子
          hooks.delayedLeave()
        }
        // 清除
        el._enterCb = undefined
      })
      if (hook) {
        // 调用进入钩子
        hook(el, done)
        // onEnter钩子参数不大于1
        if (hook.length <= 1) {
          done()
        }
      } else {
        // 没有钩子则直接
        done()
      }
    },

    // 离开
    leave(el, remove) {
      const key = String(vnode.key)
      // 进入回调
      if (el._enterCb) {
        // 取消进入回调
        el._enterCb(true /* cancelled */)
      }
      // 下载中
      if (state.isUnmounting) {
        return remove()
      }
      // 调用钩子
      callHook(onBeforeLeave, [el])
      // 有没有调用过
      let called = false
      // 结果钩子
      const done = (el._leaveCb = (cancelled?) => {
        if (called) return
        called = true
        // 移除
        remove()
        // 取消钩子
        if (cancelled) {
          callHook(onLeaveCancelled, [el])
        } else {
          // 结束钩子
          callHook(onAfterLeave, [el])
        }
        el._leaveCb = undefined
        // 从缓存中删除正离开的节点
        if (leavingVNodesCache[key] === vnode) {
          delete leavingVNodesCache[key]
        }
      })
      // 将节点缓存表示正在离开中
      leavingVNodesCache[key] = vnode
      if (onLeave) {
        // 离开中
        onLeave(el, done)
        // 离开的参数不大于1
        if (onLeave.length <= 1) {
          done()
        }
      } else {
        done()
      }
    },

    // 克隆
    clone(vnode) {
      return resolveTransitionHooks(vnode, props, state, instance)
    }
  }

  return hooks
}

// the placeholder really only handles one special case: KeepAlive
// in the case of a KeepAlive in a leave phase we need to return a KeepAlive
// placeholder with empty content to avoid the KeepAlive instance from being
// unmounted.
/**
 * 占位符只是处理一个特殊情况：keepAlive
 * 由于一个keepAlive在一个离开阶段，我们需要返回一个keepalive，使用空白内容占位可以避免keepAlive实例正被卸载
 * @param vnode 
 * @returns 
 */
function emptyPlaceholder(vnode: VNode): VNode | undefined {
  if (isKeepAlive(vnode)) {
    vnode = cloneVNode(vnode)
    vnode.children = null
    return vnode
  }
}

function getKeepAliveChild(vnode: VNode): VNode | undefined {
  return isKeepAlive(vnode)
    ? vnode.children
      ? ((vnode.children as VNodeArrayChildren)[0] as VNode)
      : undefined
    : vnode
}

export function setTransitionHooks(vnode: VNode, hooks: TransitionHooks) {
  if (vnode.shapeFlag & ShapeFlags.COMPONENT && vnode.component) {
    setTransitionHooks(vnode.component.subTree, hooks)
  } else if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
    vnode.ssContent!.transition = hooks.clone(vnode.ssContent!)
    vnode.ssFallback!.transition = hooks.clone(vnode.ssFallback!)
  } else {
    vnode.transition = hooks
  }
}

/**
 * 获取过度的原始children
 * @param children 
 * @param keepComment 
 * @returns 
 */
export function getTransitionRawChildren(
  children: VNode[],
  keepComment: boolean = false
): VNode[] {
  let ret: VNode[] = []
  let keyedFragmentCount = 0
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    // handle fragment children case, e.g. v-for
    // 处理片段自子节点的情况：例如v-for
    if (child.type === Fragment) {
      // 存在key的片段
      if (child.patchFlag & PatchFlags.KEYED_FRAGMENT) 
      // 记录有key片段的数量
      keyedFragmentCount++
      // 递归获取子节点中的节点
      ret = ret.concat(
        getTransitionRawChildren(child.children as VNode[], keepComment)
      )
    }
    // comment placeholders should be skipped, e.g. v-if
    // 注释占位符应该被跳过，例如v-if
    else if (keepComment || child.type !== Comment) {
      ret.push(child)
    }
  }
  // #1126 if a transition children list contains multiple sub fragments, these
  // fragments will be merged into a flat children array. Since each v-for
  // fragment may contain different static bindings inside, we need to de-op
  // these children to force full diffs to ensure correct behavior.
  // 如果一个过渡子节点列表包含多个子片段，
  // 这些片段将被合并到一个扁平的children数组中，
  // 因为每一个v-for片段可以包含不同的静态绑定，
  // 我们需要面对这些子节点来强制全量diff以确保正确的表现
  if (keyedFragmentCount > 1) {
    for (let i = 0; i < ret.length; i++) {
      ret[i].patchFlag = PatchFlags.BAIL
    }
  }
  return ret
}
