import {
  VNode,
  normalizeVNode,
  VNodeProps,
  isSameVNodeType,
  openBlock,
  closeBlock,
  currentBlock,
  Comment,
  createVNode,
  isBlockTreeEnabled
} from '../vnode'
import { isFunction, isArray, ShapeFlags, toNumber } from '@vue/shared'
import { ComponentInternalInstance, handleSetupResult } from '../component'
import { Slots } from '../componentSlots'
import {
  RendererInternals,
  MoveType,
  SetupRenderEffectFn,
  RendererNode,
  RendererElement
} from '../renderer'
import { queuePostFlushCb } from '../scheduler'
import { filterSingleRoot, updateHOCHostEl } from '../componentRenderUtils'
import { pushWarningContext, popWarningContext, warn } from '../warning'
import { handleError, ErrorCodes } from '../errorHandling'

export interface SuspenseProps {
  onResolve?: () => void // 加载完成
  onPending?: () => void // 等待
  onFallback?: () => void // 加载中
  timeout?: string | number
}

// 是否是 suspense 节点，通过组件上是否包含__isSuspense属性
export const isSuspense = (type: any): boolean => type.__isSuspense

// Suspense exposes a component-like API, and is treated like a component
// in the compiler, but internally it's a special built-in type that hooks
// directly into the renderer.
/**
 * suspense 暴露了一个组件式api，并且在编译器中当做一个组件处理
 * 但是内部它是一个特殊的内置类型
 * 钩子直接在渲染器里
 */
export const SuspenseImpl = {
  name: 'Suspense',
  // In order to make Suspense tree-shakable, we need to avoid importing it
  // directly in the renderer. The renderer checks for the __isSuspense flag
  // on a vnode's type and calls the `process` method, passing in renderer
  // internals.
  // 为了使suspense支持摇树，我们需要避免在渲染器里直接引入它
  // 在一个vnode的type上，渲染器检查__isSuspense标记，并且调用process方法
  // 传入内部渲染器
  __isSuspense: true,

  process(
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean,
    // platform-specific impl passed from renderer
    // 从渲染器传递的平台特定的impl
    rendererInternals: RendererInternals
  ) {
    // 原先为 null 或 undefined
    if (n1 == null) {
      // 挂载 suspense
      mountSuspense(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        slotScopeIds,
        optimized,
        rendererInternals
      )
    } else {
      // 更新suspense
      patchSuspense(
        n1,
        n2,
        container,
        anchor,
        parentComponent,
        isSVG,
        slotScopeIds,
        optimized,
        rendererInternals
      )
    }
  },
  hydrate: hydrateSuspense,
  create: createSuspenseBoundary,
  normalize: normalizeSuspenseChildren
}

// Force-casted public typing for h and TSX props inference
// 强制浇筑公共的类型为 h 和 tsx 属性接口
export const Suspense = (__FEATURE_SUSPENSE__ ? SuspenseImpl : null) as any as {
  __isSuspense: true
  new (): { $props: VNodeProps & SuspenseProps }
}

/**
 * 触发事件
 * @param vnode 
 * @param name 
 */
function triggerEvent(
  vnode: VNode,
  name: 'onResolve' | 'onPending' | 'onFallback'
) {
  const eventListener = vnode.props && vnode.props[name]
  if (isFunction(eventListener)) {
    eventListener()
  }
}

/**
 * 挂载 suspense
 * @param vnode 
 * @param container 
 * @param anchor 
 * @param parentComponent 
 * @param parentSuspense 
 * @param isSVG 
 * @param slotScopeIds 
 * @param optimized 
 * @param rendererInternals 
 */
function mountSuspense(
  vnode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  rendererInternals: RendererInternals
) {
  // 渲染器内部函数
  const {
    p: patch,
    o: { createElement }
  } = rendererInternals
  // 隐藏的容器
  const hiddenContainer = createElement('div')
  // suspense 创建suspense分界线
  const suspense = (vnode.suspense = createSuspenseBoundary(
    vnode,
    parentSuspense,
    parentComponent,
    container,
    hiddenContainer,
    anchor,
    isSVG,
    slotScopeIds,
    optimized,
    rendererInternals
  ))

  // start mounting the content subtree in an off-dom container
  // 开始在off-dom容器中挂载内容子树
  patch(
    null,
    (suspense.pendingBranch = vnode.ssContent!),
    hiddenContainer,
    null,
    parentComponent,
    suspense,
    isSVG,
    slotScopeIds
  )
  // now check if we have encountered any async deps
  // 现在检查我们是否遇到了任何异步deps
  if (suspense.deps > 0) {
    // has async
    // invoke @fallback event
    // 有异步调用fallback事件
    triggerEvent(vnode, 'onPending')
    triggerEvent(vnode, 'onFallback')

    // mount the fallback tree
    // 挂载fallback树
    patch(
      null,
      vnode.ssFallback!,
      container,
      anchor,
      parentComponent,
      // fallback树没有suspense上下文
      null, // fallback tree will not have suspense context
      isSVG,
      slotScopeIds
    )
    // 设置激活的分支
    setActiveBranch(suspense, vnode.ssFallback!)
  } else {
    // Suspense has no async deps. Just resolve.
    // suspense没有异步依赖。仅仅resolve
    suspense.resolve()
  }
}

/**
 * 更新suspense
 * @param n1 
 * @param n2 
 * @param container 
 * @param anchor 
 * @param parentComponent 
 * @param isSVG 
 * @param slotScopeIds 
 * @param optimized 
 * @param param8 
 */
function patchSuspense(
  n1: VNode,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  { p: patch, um: unmount, o: { createElement } }: RendererInternals
) {
  const suspense = (n2.suspense = n1.suspense)!
  suspense.vnode = n2
  n2.el = n1.el
  // 新分支
  const newBranch = n2.ssContent!
  // 新的备选方案
  const newFallback = n2.ssFallback!

  // 当前激活的分支，等待中的分支，是否在fallback中，是否正在注水
  const { activeBranch, pendingBranch, isInFallback, isHydrating } = suspense
  // 等待中的分支
  if (pendingBranch) {
    // 重新设置新分支
    suspense.pendingBranch = newBranch
    if (isSameVNodeType(newBranch, pendingBranch)) {
      // same root type but content may have changed.
      // 相同的根节点类型但是内容已经改变
      patch(
        pendingBranch,
        newBranch,
        suspense.hiddenContainer,
        null,
        parentComponent,
        suspense,
        isSVG,
        slotScopeIds,
        optimized
      )
      // 如果suspense的依赖小于等于0
      if (suspense.deps <= 0) {
        suspense.resolve()
      } else if (isInFallback) {
        // 如果正在执行备用方案
        // 比较当前激活的分支与备用方案
        patch(
          activeBranch,
          newFallback,
          container,
          anchor,
          parentComponent,
          // 备用的树不会有 suspense 上下文
          null, // fallback tree will not have suspense context
          isSVG,
          slotScopeIds,
          optimized
        )
        setActiveBranch(suspense, newFallback)
      }
    } else {
      // toggled before pending tree is resolved
      // 在等待树被解决前已切换
      suspense.pendingId++
      if (isHydrating) {
        // if toggled before hydration is finished, the current DOM tree is
        // no longer valid. set it as the active branch so it will be unmounted
        // when resolved
        // 如果切换发生在注水结束前，当前dom树不在有效，将它设置为激活的分支
        // 加载完成时它将被卸载
        // 总结：就是服务器渲染，激活的时候删除掉服务器渲染的dom节点
        // 使用新的
        suspense.isHydrating = false
        suspense.activeBranch = pendingBranch
      } else {
        // 卸载节点
        unmount(pendingBranch, parentComponent, suspense)
      }
      // increment pending ID. this is used to invalidate async callbacks
      // reset suspense state
      // 增长等待的Id，这被用来重置suspense状态使异步回调失效
      suspense.deps = 0
      // discard effects from pending branch
      // 从等待的分支中清空effects
      suspense.effects.length = 0
      // discard previous container
      // 删除之前的容器，重置容器
      suspense.hiddenContainer = createElement('div')

      if (isInFallback) {
        // already in fallback state
        // 在fallback过程中，更新成新的分支
        patch(
          null,
          newBranch,
          suspense.hiddenContainer,
          null,
          parentComponent,
          suspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        // 如果已经不存在依赖，就告知suspense加载已完成
        if (suspense.deps <= 0) {
          suspense.resolve()
        } else {
          // 将节点内容替换为fallback内容继续加载
          patch(
            activeBranch,
            newFallback,
            container,
            anchor,
            parentComponent,
            // fallback树不会有suspense上下文
            null, // fallback tree will not have suspense context
            isSVG,
            slotScopeIds,
            optimized
          )
          // 重新设置激活的分支
          setActiveBranch(suspense, newFallback)
        }
      } else if (activeBranch && isSameVNodeType(newBranch, activeBranch)) {
        // toggled "back" to current active branch
        // 切换回退到当前激活的分支
        patch(
          activeBranch,
          newBranch,
          container,
          anchor,
          parentComponent,
          suspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        // force resolve
        // 强制结束
        suspense.resolve(true)
      } else {
        // switched to a 3rd branch
        // 切换到第三个分支
        patch(
          null,
          newBranch,
          suspense.hiddenContainer,
          null,
          parentComponent,
          suspense,
          isSVG,
          slotScopeIds,
          optimized
        )
        // suspense 无依赖结束
        if (suspense.deps <= 0) {
          suspense.resolve()
        }
      }
    }
  } else {
    if (activeBranch && isSameVNodeType(newBranch, activeBranch)) {
      // root did not change, just normal patch
      // 根节点没有改变，仅仅正常的更新
      patch(
        activeBranch,
        newBranch,
        container,
        anchor,
        parentComponent,
        suspense,
        isSVG,
        slotScopeIds,
        optimized
      )
      setActiveBranch(suspense, newBranch)
    } else {
      // root node toggled
      // invoke @pending event
      // 根节点被切换
      // 调用@pending事件
      triggerEvent(n2, 'onPending')
      // mount pending branch in off-dom container
      //  在off-dom容器中挂载pending的分支
      suspense.pendingBranch = newBranch
      suspense.pendingId++
      patch(
        null,
        newBranch,
        suspense.hiddenContainer,
        null,
        parentComponent,
        suspense,
        isSVG,
        slotScopeIds,
        optimized
      )
      // 如果suspense的依赖数量不大于0
      if (suspense.deps <= 0) {
        // incoming branch has no async deps, resolve now.
        // 传入分支没有async deps，现在解决。
        suspense.resolve()
      } else {
        const { timeout, pendingId } = suspense
        if (timeout > 0) {
          // 延迟后变成挂载新的加载组件
          setTimeout(() => {
            // 等待中的Id
            if (suspense.pendingId === pendingId) {
              suspense.fallback(newFallback)
            }
          }, timeout)
        } else if (timeout === 0) {
          // suspense 加载组件
          suspense.fallback(newFallback)
        }
      }
    }
  }
}

export interface SuspenseBoundary {
  vnode: VNode<RendererNode, RendererElement, SuspenseProps>
  parent: SuspenseBoundary | null
  parentComponent: ComponentInternalInstance | null
  isSVG: boolean
  container: RendererElement
  hiddenContainer: RendererElement
  anchor: RendererNode | null
  activeBranch: VNode | null
  pendingBranch: VNode | null
  deps: number
  pendingId: number
  timeout: number
  isInFallback: boolean
  isHydrating: boolean
  isUnmounted: boolean
  effects: Function[]
  resolve(force?: boolean): void
  fallback(fallbackVNode: VNode): void
  move(
    container: RendererElement,
    anchor: RendererNode | null,
    type: MoveType
  ): void
  next(): RendererNode | null
  registerDep(
    instance: ComponentInternalInstance,
    setupRenderEffect: SetupRenderEffectFn
  ): void
  unmount(parentSuspense: SuspenseBoundary | null, doRemove?: boolean): void
}

let hasWarned = false

/**
 * 创建suspense边界
 * @param vnode 
 * @param parent 
 * @param parentComponent 
 * @param container 
 * @param hiddenContainer 
 * @param anchor 
 * @param isSVG 
 * @param slotScopeIds 
 * @param optimized 
 * @param rendererInternals 
 * @param isHydrating 
 * @returns 
 */
function createSuspenseBoundary(
  vnode: VNode,
  parent: SuspenseBoundary | null,
  parentComponent: ComponentInternalInstance | null,
  container: RendererElement,
  hiddenContainer: RendererElement,
  anchor: RendererNode | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  rendererInternals: RendererInternals,
  isHydrating = false
): SuspenseBoundary {
  /* istanbul ignore if */
  if (__DEV__ && !__TEST__ && !hasWarned) {
    hasWarned = true
    // @ts-ignore `console.info` cannot be null error
    console[console.info ? 'info' : 'log'](
      `<Suspense> is an experimental feature and its API will likely change.`
    )
  }

  const {
    p: patch,
    m: move,
    um: unmount,
    n: next,
    o: { parentNode, remove }
  } = rendererInternals

  // 延迟时长
  const timeout = toNumber(vnode.props && vnode.props.timeout)
  const suspense: SuspenseBoundary = {
    vnode,
    parent,
    parentComponent,
    isSVG,
    container,
    hiddenContainer,
    anchor,
    deps: 0,
    pendingId: 0,
    timeout: typeof timeout === 'number' ? timeout : -1,
    activeBranch: null,
    pendingBranch: null,
    isInFallback: true,
    isHydrating,
    isUnmounted: false,
    effects: [],

    /**
     * 解决
     * @param resume 唤醒
     */
    resolve(resume = false) {
      if (__DEV__) {
        // 如果没有环境且suspense不存在等待中的分支
        if (!resume && !suspense.pendingBranch) {
          throw new Error(
            `suspense.resolve() is called without a pending branch.`
          )
        }
        // 如果suspense已经卸载
        if (suspense.isUnmounted) {
          throw new Error(
            `suspense.resolve() is called on an already unmounted suspense boundary.`
          )
        }
      }
      const {
        vnode,
        activeBranch,
        pendingBranch,
        pendingId,
        effects,
        parentComponent,
        container
      } = suspense
      // suspense 处于注水中
      if (suspense.isHydrating) {
        // 将该标记设置为false
        suspense.isHydrating = false
      } else if (!resume) {
        // 如果还没有被唤醒
        const delayEnter =
          activeBranch &&
          pendingBranch!.transition &&
          pendingBranch!.transition.mode === 'out-in'
        // 延迟进入
        if (delayEnter) {
          activeBranch!.transition!.afterLeave = () => {
            // 等待Id与suspense的等待Id相等
            if (pendingId === suspense.pendingId) {
              // 将等待中的节点移入
              move(pendingBranch!, container, anchor, MoveType.ENTER)
            }
          }
        }
        // this is initial anchor on mount
        // 这是挂载时一个初始化的锚点
        let { anchor } = suspense
        // unmount current active tree
        // 卸载当前激活的节点树
        if (activeBranch) {
          // if the fallback tree was mounted, it may have been moved
          // as part of a parent suspense. get the latest anchor for insertion
          // 如果fallback树节点被卸载，它可能会被移除作为父suspense的一部分
          // 获取用于插入的最新锚点
          // next获取下一个节点
          anchor = next(activeBranch)
          // 卸载
          unmount(activeBranch, parentComponent, suspense, true)
        }
        if (!delayEnter) {
          // move content from off-dom container to actual container
          // 将off-dom容器里的内容移动到实际的容器中
          move(pendingBranch!, container, anchor, MoveType.ENTER)
        }
      }

      // 设置激活的分支
      setActiveBranch(suspense, pendingBranch!)
      // 等待中的分支
      suspense.pendingBranch = null
      // suspense处于fallback状态
      suspense.isInFallback = false

      // flush buffered effects
      // check if there is a pending parent suspense
      // 冲刷缓存中的副作用
      // 检查是否存在一个等待中的父suspense
      let parent = suspense.parent
      // 存在未解决的祖先节点标记
      let hasUnresolvedAncestor = false
      // 递归去找为解决的祖先节点
      while (parent) {
        if (parent.pendingBranch) {
          // found a pending parent suspense, merge buffered post jobs
          // into that parent
          // 找到一个等待中的父suspense，合并缓存异步任务在父节点中
          parent.effects.push(...effects)
          hasUnresolvedAncestor = true
          break
        }
        parent = parent.parent
      }
      // no pending parent suspense, flush all jobs
      // 没有等待中的父suspense，冲刷所有任务
      if (!hasUnresolvedAncestor) {
        queuePostFlushCb(effects)
      }
      suspense.effects = []

      // invoke @resolve event
      // 调用@resolve事件
      triggerEvent(vnode, 'onResolve')
    },

    /**
     * 
     */
    fallback(fallbackVNode) {
      // 不存在等待中分支
      if (!suspense.pendingBranch) {
        return
      }

      const { vnode, activeBranch, parentComponent, container, isSVG } =
        suspense

      // invoke @fallback event
      // 调用@fallback事件
      triggerEvent(vnode, 'onFallback')

      // 获取下个节点作为锚点
      const anchor = next(activeBranch!)
      // 挂载
      const mountFallback = () => {
        if (!suspense.isInFallback) {
          return
        }
        // mount the fallback tree
        // 挂载fallback树节点
        patch(
          null,
          fallbackVNode,
          container,
          anchor,
          parentComponent,
          // fallback树节点不会有suspense上下文
          null, // fallback tree will not have suspense context
          isSVG,
          slotScopeIds,
          optimized
        )
        // 设置激活的分支
        setActiveBranch(suspense, fallbackVNode)
      }

      // 延迟进入
      const delayEnter =
        fallbackVNode.transition && fallbackVNode.transition.mode === 'out-in'
      if (delayEnter) {
        activeBranch!.transition!.afterLeave = mountFallback
      }
      // suspense处于fallback状态中
      suspense.isInFallback = true

      // unmount current active branch
      // 卸载当前激活的分支
      unmount(
        activeBranch!,
        parentComponent,
        // 没有suspense所以卸载钩子现在触发
        null, // no suspense so unmount hooks fire now
        // 应该移除
        true // shouldRemove
      )

      if (!delayEnter) {
        // 无延迟直接挂载
        mountFallback()
      }
    },

    /**
     * 将激活的节点移动到对应位置
     * @param container 
     * @param anchor 
     * @param type 
     */
    move(container, anchor, type) {
      suspense.activeBranch &&
        move(suspense.activeBranch, container, anchor, type)
      suspense.container = container
    },

    /**
     * 获取锚点
     * @returns 
     */
    next() {
      return suspense.activeBranch && next(suspense.activeBranch)
    },

    /**
     * 注册依赖
     * @param instance 
     * @param setupRenderEffect 
     */
    registerDep(instance, setupRenderEffect) {
      // 存在等待中的分支即处于等待状态
      const isInPendingSuspense = !!suspense.pendingBranch
      // 处于等待suspense中
      if (isInPendingSuspense) {
        // suspense的依赖数量增加
        suspense.deps++
      }
      // 激活的元素
      const hydratedEl = instance.vnode.el
      // 实例的异步依赖
      instance
        .asyncDep!.catch(err => {
          handleError(err, instance, ErrorCodes.SETUP_FUNCTION)
        })
        .then(asyncSetupResult => {
          // retry when the setup() promise resolves.
          // component may have been unmounted before resolve.
          // 当调用setup时重试，
          // 组件可能已经在加载完成前卸载
          if (
            instance.isUnmounted ||
            suspense.isUnmounted ||
            suspense.pendingId !== instance.suspenseId
          ) {
            return
          }
          // retry from this component
          // 从这个组件中重试
          instance.asyncResolved = true
          const { vnode } = instance
          if (__DEV__) {
            pushWarningContext(vnode)
          }
          handleSetupResult(instance, asyncSetupResult, false)
          if (hydratedEl) {
            // vnode may have been replaced if an update happened before the
            // async dep is resolved.
            // 如果异步依赖被解决在一个更新前则虚拟节点可能被替换
            vnode.el = hydratedEl
          }
          // 占位符
          const placeholder = !hydratedEl && instance.subTree.el
          setupRenderEffect(
            instance,
            vnode,
            // component may have been moved before resolve.
            // if this is not a hydration, instance.subTree will be the comment
            // placeholder.
            // 组件可能已经在resolve前被移动
            // 如果这不是一个激活ssr的功能，实例的树节点将使用注释作为占位符
            parentNode(hydratedEl || instance.subTree.el!)!,
            // anchor will not be used if this is hydration, so only need to
            // consider the comment placeholder case.
            // 如果激活ssr，则锚点将被使用，
            // 所以仅仅需要考虑注释占位符的情况
            hydratedEl ? null : next(instance.subTree),
            suspense,
            isSVG,
            optimized
          )
          if (placeholder) {
            // 如果有占位符，删除占位符
            remove(placeholder)
          }
          // 更新HOC宿主元素
          updateHOCHostEl(instance, vnode.el)
          if (__DEV__) {
            popWarningContext()
          }
          // only decrease deps count if suspense is not already resolved
          // 当前处于等待suspense状态中，如果suspense没有完全解决，仅仅减少依赖数量
          if (isInPendingSuspense && --suspense.deps === 0) {
            suspense.resolve()
          }
        })
    },

    /**
     * 卸载
     * @param parentSuspense 
     * @param doRemove 
     */
    unmount(parentSuspense, doRemove) {
      // suspense 已经被卸载
      suspense.isUnmounted = true
      // 如果 suspense 存在激活的分支，卸载
      if (suspense.activeBranch) {
        unmount(
          suspense.activeBranch,
          parentComponent,
          parentSuspense,
          doRemove
        )
      }
      // 如果 suspense存在等待中分支，卸载等待中分支
      if (suspense.pendingBranch) {
        unmount(
          suspense.pendingBranch,
          parentComponent,
          parentSuspense,
          doRemove
        )
      }
    }
  }

  return suspense
}

/**
 * 激活suspense
 * @param node 
 * @param vnode 
 * @param parentComponent 
 * @param parentSuspense 
 * @param isSVG 
 * @param slotScopeIds 
 * @param optimized 
 * @param rendererInternals 
 * @param hydrateNode 
 * @returns 
 */
function hydrateSuspense(
  node: Node,
  vnode: VNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  slotScopeIds: string[] | null,
  optimized: boolean,
  rendererInternals: RendererInternals,
  hydrateNode: (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => Node | null
): Node | null {
  /* eslint-disable no-restricted-globals */
  const suspense = (vnode.suspense = createSuspenseBoundary(
    vnode,
    parentSuspense,
    parentComponent,
    node.parentNode!,
    document.createElement('div'),
    null,
    isSVG,
    slotScopeIds,
    optimized,
    rendererInternals,
    true /* hydrating */
  ))
  // there are two possible scenarios for server-rendered suspense:
  // - success: ssr content should be fully resolved
  // - failure: ssr content should be the fallback branch.
  // however, on the client we don't really know if it has failed or not
  // attempt to hydrate the DOM assuming it has succeeded, but we still
  // need to construct a suspense boundary first
  // 2个坑你场景使用服务器渲染suspense
  // 成功 ssr 内容将被加载
  // 失败 ssr内容应该是加载状态
  // 然而在客户端中我们不知道它是否已经失败或者假设已经成功不再尝试激活dom元素
  // 但首先我们依然需要构造一个suspense判断边界
  const result = hydrateNode(
    node,
    (suspense.pendingBranch = vnode.ssContent!),
    parentComponent,
    suspense,
    slotScopeIds,
    optimized
  )
  // suspense依赖已全部清空时，resolve
  if (suspense.deps === 0) {
    suspense.resolve()
  }
  return result
  /* eslint-enable no-restricted-globals */
}

/**
 * 序列化suspense子节点
 * @param vnode 
 */
function normalizeSuspenseChildren(vnode: VNode) {
  const { shapeFlag, children } = vnode
  // 插槽子节点
  const isSlotChildren = shapeFlag & ShapeFlags.SLOTS_CHILDREN
  // 渲染内容
  vnode.ssContent = normalizeSuspenseSlot(
    isSlotChildren ? (children as Slots).default : children
  )
  // 加载过程中，是插槽子节点，则序列化slot插槽，否则创建一个注释节点
  vnode.ssFallback = isSlotChildren
    ? normalizeSuspenseSlot((children as Slots).fallback)
    : createVNode(Comment)
}

/**
 * 规范化suspense插槽
 * 目的是将suspense插槽中的节点进行序列化
 * 并返回根节点树
 * @param s 
 * @returns 
 */
function normalizeSuspenseSlot(s: any) {
  let block: VNode[] | null | undefined
  if (isFunction(s)) {
    // 如果s是函数
    // 启用了blockTree
    const trackBlock = isBlockTreeEnabled && s._c
    if (trackBlock) {
      // disableTracking: false
      // allow block tracking for compiled slots
      // (see ./componentRenderContext.ts)
      // 禁用跟踪为false
      // 允许块跟踪编译插槽
      // 可以看./componentRenderContext.ts文件
      s._d = false
      // 打开代码块
      openBlock()
    }
    // 获取插槽的结果
    s = s()
    if (trackBlock) {
      s._d = true
      // 设置block为当前block节点
      block = currentBlock
      // 闭合代码块
      closeBlock()
    }
  }
  // 如果s是数组
  if (isArray(s)) {
    // 从s中过滤根节点
    const singleChild = filterSingleRoot(s)
    // 开发者环境下且没有单独节点警告
    if (__DEV__ && !singleChild) {
      warn(`<Suspense> slots expect a single root node.`)
    }
    // s为单独节点
    s = singleChild
  }
  // 对s进行节点序列化
  s = normalizeVNode(s)
  // 如果有block且没有动态子节点
  if (block && !s.dynamicChildren) {
    s.dynamicChildren = block.filter(c => c !== s)
  }
  return s
}

/**
 * suspense 队列副作用
 * @param fn 
 * @param suspense 
 */
export function queueEffectWithSuspense(
  fn: Function | Function[],
  suspense: SuspenseBoundary | null
): void {
  // 如果suspense存在等待中的分支
  if (suspense && suspense.pendingBranch) {
    if (isArray(fn)) {
      suspense.effects.push(...fn)
    } else {
      suspense.effects.push(fn)
    }
  } else {
    // 如果不存在等待中的分支，将函数加入到异步执行栈中
    queuePostFlushCb(fn)
  }
}

/**
 * 设置当前激活的节点
 * @param suspense 
 * @param branch 
 */
function setActiveBranch(suspense: SuspenseBoundary, branch: VNode) {
  suspense.activeBranch = branch
  const { vnode, parentComponent } = suspense
  const el = (vnode.el = branch.el)
  // in case suspense is the root node of a component,
  // recursively update the HOC el
  // 某些情况下suspense是组件的根节点，递归更新HOC元素
  if (parentComponent && parentComponent.subTree === vnode) {
    parentComponent.vnode.el = el
    updateHOCHostEl(parentComponent, el)
  }
}
