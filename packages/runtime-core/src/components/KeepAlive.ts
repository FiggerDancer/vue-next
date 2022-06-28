import {
  ConcreteComponent,
  getCurrentInstance,
  SetupContext,
  ComponentInternalInstance,
  LifecycleHooks,
  currentInstance,
  getComponentName,
  ComponentOptions
} from '../component'
import {
  VNode,
  cloneVNode,
  isVNode,
  VNodeProps,
  invokeVNodeHook
} from '../vnode'
import { warn } from '../warning'
import {
  onBeforeUnmount,
  injectHook,
  onUnmounted,
  onMounted,
  onUpdated
} from '../apiLifecycle'
import {
  isString,
  isArray,
  ShapeFlags,
  remove,
  invokeArrayFns
} from '@vue/shared'
import { watch } from '../apiWatch'
import {
  RendererInternals,
  queuePostRenderEffect,
  MoveType,
  RendererElement,
  RendererNode
} from '../renderer'
import { setTransitionHooks } from './BaseTransition'
import { ComponentRenderContext } from '../componentPublicInstance'
import { devtoolsComponentAdded } from '../devtools'
import { isAsyncWrapper } from '../apiAsyncComponent'

/** 
 * 正则匹配类型
 * 1. string
 * 2. regexp
 * 3. string|regexp数组
 * */
type MatchPattern = string | RegExp | (string | RegExp)[]

/**
 * <keep-alive></keep-alive>的props include 和 exclude 以及 max
 */
export interface KeepAliveProps {
  include?: MatchPattern
  exclude?: MatchPattern
  max?: number | string
}

/**
 * 缓存的Key  string | number | symbol | 具体组件
 */
type CacheKey = string | number | symbol | ConcreteComponent
/**
 * 缓存Map
 * key: 缓存Key CacheKey
 * VNode
 */
type Cache = Map<CacheKey, VNode>
/**
 * 键
 */
type Keys = Set<CacheKey>

/**
 * <keep-alive></keep-alive>的上下文继承自组件渲染上下文
 * renderer: 内部渲染器
 * activate: 激活函数
 * deactivate: 使节点失效函数
 */
export interface KeepAliveContext extends ComponentRenderContext {
  renderer: RendererInternals
  activate: (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    isSVG: boolean,
    optimized: boolean
  ) => void
  deactivate: (vnode: VNode) => void
}

/**
 * 是否是缓存的节点
 * 缓存的节点 type 上有一个  __isKeepAlive  属性
 * @param vnode 
 * @returns 
 */
export const isKeepAlive = (vnode: VNode): boolean =>
  (vnode.type as any).__isKeepAlive

/**
 * 缓存组件的实现
 */
const KeepAliveImpl: ComponentOptions = {
  name: `KeepAlive`,

  // Marker for special handling inside the renderer. We are not using a ===
  // check directly on KeepAlive in the renderer, because importing it directly
  // would prevent it from being tree-shaken.
  // 该标记用于在渲染器内部进行特殊处理。
  // 我们没有使用===在渲染器中直接检查KeepAlive，
  // 因为直接导入它，它就很难被摇树了。
  __isKeepAlive: true,

  // 属性包含include、exclude、max
  // include可以是正则字符串、正则表达式、数组
  // max 最大的缓存组件数
  props: {
    include: [String, RegExp, Array],
    exclude: [String, RegExp, Array],
    max: [String, Number]
  },

  setup(props: KeepAliveProps, { slots }: SetupContext) {
    const instance = getCurrentInstance()!
    // KeepAlive communicates with the instantiated renderer via the
    // ctx where the renderer passes in its internals,
    // and the KeepAlive instance exposes activate/deactivate implementations.
    // The whole point of this is to avoid importing KeepAlive directly in the
    // renderer to facilitate tree-shaking.
    // <keep-alive></keep-alive>组件控件通过传入它的内部函数的CTX渲染器和已经被实例化的渲染器通信
    // 并且<keep-alive></keep-alive>实例暴露了激活或者使无效化的实现
    // 这个点是为了避免直接引入keepAlive导致渲染器无法摇树
    // 实例上下文
    const sharedContext = instance.ctx as KeepAliveContext

    // if the internal renderer is not registered, it indicates that this is server-side rendering,
    // for KeepAlive, we just need to render its children
    // 如果内部渲染没有被注册，就意味着这是个服务器渲染
    // 对于keepAlive来说，我们仅仅需要渲染它的子节点
    if (!sharedContext.renderer) {
      return slots.default
    }

    // 缓存
    const cache: Cache = new Map()
    const keys: Keys = new Set()
    let current: VNode | null = null

    // 开发者环境要缓存到实例中
    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      ;(instance as any).__v_cache = cache
    }

    // 获取组件的suspense
    const parentSuspense = instance.suspense

    // 获取patch，move，unmount， createElement 这些方法从实例上下文中
    const {
      renderer: {
        p: patch,
        m: move,
        um: _unmount,
        o: { createElement }
      }
    } = sharedContext
    // 存储容器
    const storageContainer = createElement('div')

    // 组件实例上下文激活钩子
    sharedContext.activate = (vnode, container, anchor, isSVG, optimized) => {
      // 组件实例
      const instance = vnode.component!
      // 将vnode移动到container中，锚点为anchor，移动方式为进入，将悬疑加入
      move(vnode, container, anchor, MoveType.ENTER, parentSuspense)
      // in case props have changed
      // 防止props被改变
      patch(
        instance.vnode,
        vnode,
        container,
        anchor,
        instance,
        parentSuspense,
        isSVG,
        vnode.slotScopeIds,
        optimized
      )
      // 异步队列副作用渲染
      queuePostRenderEffect(() => {
        instance.isDeactivated = false
        // 调用激活钩子
        if (instance.a) {
          invokeArrayFns(instance.a)
        }
        const vnodeHook = vnode.props && vnode.props.onVnodeMounted
        // 调用挂载钩子
        if (vnodeHook) {
          invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
      }, parentSuspense)

      if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
        // Update components tree
        // 更新组件树
        devtoolsComponentAdded(instance)
      }
    }

    // 组件实例上下文失效钩子
    sharedContext.deactivate = (vnode: VNode) => {
      const instance = vnode.component!
      // 把node节点移到缓存dom里
      move(vnode, storageContainer, null, MoveType.LEAVE, parentSuspense)
      queuePostRenderEffect(() => {
        // 调用失效钩子
        if (instance.da) {
          invokeArrayFns(instance.da)
        }
        const vnodeHook = vnode.props && vnode.props.onVnodeUnmounted
        if (vnodeHook) {
          invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
        instance.isDeactivated = true
      }, parentSuspense)

      if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
        // Update components tree
        // 更新组件树
        devtoolsComponentAdded(instance)
      }
    }

    // 卸载
    function unmount(vnode: VNode) {
      // reset the shapeFlag so it can be properly unmounted
      // 重置 shapeFlag 使它可以被正确卸载
      resetShapeFlag(vnode)
      _unmount(vnode, instance, parentSuspense, true)
    }

    /**
     * 删除缓存
     * @param filter 过滤函数，传入组件名进行过滤
     */
    function pruneCache(filter?: (name: string) => boolean) {
      // 遍历缓存，删除掉不符合过滤条件的缓存
      cache.forEach((vnode, key) => {
        const name = getComponentName(vnode.type as ConcreteComponent)
        if (name && (!filter || !filter(name))) {
          pruneCacheEntry(key)
        }
      })
    }

    /**
     * 清理掉指定key所对应的缓存
     * @param key 
     */
    function pruneCacheEntry(key: CacheKey) {
      // 拿到对应的缓存
      const cached = cache.get(key) as VNode
      if (!current || cached.type !== current.type) {
        unmount(cached)
      } else if (current) {
        // current active instance should no longer be kept-alive.
        // we can't unmount it now but it might be later, so reset its flag now.
        // 当前激活的实例应该不再被缓存
        // 虽然我们现在不能卸载它，但稍后可以，所以重置它的标记
        resetShapeFlag(current)
      }
      cache.delete(key)
      keys.delete(key)
    }

    // prune cache on include/exclude prop change
    // 监听include和exclude属性的修改，用于重新修剪缓存
    watch(
      () => [props.include, props.exclude],
      ([include, exclude]) => {
        include && pruneCache(name => matches(include, name))
        exclude && pruneCache(name => !matches(exclude, name))
      },
      // prune post-render after `current` has been updated
      // 在' current '被更新后删减后期渲染
      { flush: 'post', deep: true }
    )

    // cache sub tree after render
    // 在渲染后缓存子树
    let pendingCacheKey: CacheKey | null = null
    // 缓存子树
    const cacheSubtree = () => {
      // fix #1621, the pendingCacheKey could be 0
      // 待缓存的key可能是0,这里只有undefined和null不行
      if (pendingCacheKey != null) {
        // 设置缓存的key，并对应实例的子树
        cache.set(pendingCacheKey, getInnerChild(instance.subTree))
      }
    }
    // 挂载后去缓存子树
    onMounted(cacheSubtree)
    // 更新后去缓存子树
    onUpdated(cacheSubtree)

    // 在卸载前遍历缓存
    onBeforeUnmount(() => {
      // 从缓存中遍历
      cache.forEach(cached => {
        // 子树，悬疑
        const { subTree, suspense } = instance
        // 获取内部节点
        const vnode = getInnerChild(subTree)
        // 缓存节点的类型和当前虚拟节点类型相同
        if (cached.type === vnode.type) {
          // current instance will be unmounted as part of keep-alive's unmount
          // 当前实例将被卸载作为keep-alive的卸载的一部分
          resetShapeFlag(vnode)
          // but invoke its deactivated hook here
          // 这里调用它的失活钩子
          const da = vnode.component!.da
          // 异步调用
          da && queuePostRenderEffect(da, suspense)
          return
        }
        // 卸载
        unmount(cached)
      })
    })

    return () => {
      // 清空待缓存的key
      pendingCacheKey = null

      // keep-alive内没有默认插槽，返回空
      if (!slots.default) {
        return null
      }

      // 获取插槽内容
      const children = slots.default()
      // 原始虚拟节点
      const rawVNode = children[0]
      // keepalive不支持多个子节点，多了会警告
      if (children.length > 1) {
        if (__DEV__) {
          warn(`KeepAlive should contain exactly one component child.`)
        }
        current = null
        return children
      } else if (
        !isVNode(rawVNode) ||
        (!(rawVNode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) &&
          !(rawVNode.shapeFlag & ShapeFlags.SUSPENSE))
      ) {
        // 以下2种情况2选1
        // 1. 节点不是虚拟节点
        // 2. 是虚拟节点但不是有状态组件且不是suspense节点
        // 将当前节点置为空，并返回该节点（像是注释之类的)
        current = null
        // 返回虚拟节点
        return rawVNode
      }

      // 获取内部节点
      let vnode = getInnerChild(rawVNode)
      // 组件
      const comp = vnode.type as ConcreteComponent

      // for async components, name check should be based in its loaded
      // inner component if available
      // 对于异步组件，名称检查应该基于它所加载的内部组件，而不是基于异步组件
      const name = getComponentName(
        isAsyncWrapper(vnode)
          ? (vnode.type as ComponentOptions).__asyncResolved || {}
          : comp
      )

      // 获取配置的属性
      const { include, exclude, max } = props

      // 是否不被包含或者被排除，如果被排除了，则将当前节点置为该虚拟节点，并返回原始节点
      if (
        (include && (!name || !matches(include, name))) ||
        (exclude && name && matches(exclude, name))
      ) {
        current = vnode
        return rawVNode
      }

      // 节点的key为undefined或者null，则返回组件，有key返回对应key
      const key = vnode.key == null ? comp : vnode.key
      const cachedVNode = cache.get(key)

      // clone vnode if it's reused because we are going to mutate it
      // 克隆虚拟节点，如果它因为我们要改变它被重用
      if (vnode.el) {
        vnode = cloneVNode(vnode)
        // suspense节点，要使用suspense内容
        if (rawVNode.shapeFlag & ShapeFlags.SUSPENSE) {
          rawVNode.ssContent = vnode
        }
      }
      // #1513 it's possible for the returned vnode to be cloned due to attr
      // fallthrough or scopeId, so the vnode here may not be the final vnode
      // that is mounted. Instead of caching it directly, we store the pending
      // key and cache `instance.subTree` (the normalized vnode) in
      // beforeMount/beforeUpdate hooks.
      // 由于attr的障碍或者作用域id的存在
      // 这可能被会导致克隆产生的虚拟节点不是最终被跪在的节点
      // 我们存储等待中的key并且缓存组件子树在挂载前的钩子和更新前的钩子里
      // 而不是直接缓存它
      pendingCacheKey = key

      // 缓存过
      if (cachedVNode) {
        // copy over mounted state
        // 如果有缓存节点，复制挂载的状态
        vnode.el = cachedVNode.el
        vnode.component = cachedVNode.component
        if (vnode.transition) {
          // recursively update transition hooks on subTree
          // 递归更新过渡钩子在子树上
          setTransitionHooks(vnode, vnode.transition!)
        }
        // avoid vnode being mounted as fresh
        // 避免虚拟节点作为新节点被挂载
        // 标记为已keep-alive
        vnode.shapeFlag |= ShapeFlags.COMPONENT_KEPT_ALIVE
        // make this key the freshest
        // 使key保持最新，这是因为lru策略，最近最少使用
        keys.delete(key)
        keys.add(key)
      } else {
        // keys 缓存key
        keys.add(key)
        // prune oldest entry
        // 超长则删掉最老的缓存
        if (max && keys.size > parseInt(max as string, 10)) {
          pruneCacheEntry(keys.values().next().value)
        }
      }
      // avoid vnode being unmounted
      // 避免节点被卸载，对组件标记
      vnode.shapeFlag |= ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE

      current = vnode
      return rawVNode
    }
  }
}

// 兼容性修改，内置组件
if (__COMPAT__) {
  KeepAliveImpl.__isBuildIn = true
}

// export the public type for h/tsx inference
// also to avoid inline import() in generated d.ts files
// 导出公共类型为 h 函数或者 tsx接口
// 也是为了避免生成d.ts文件时内联引入
export const KeepAlive = KeepAliveImpl as any as {
  __isKeepAlive: true
  new (): {
    $props: VNodeProps & KeepAliveProps
  }
}

/**
 * 匹配include或者exclude，该组件是否要缓存
 * @param pattern 
 * @param name 
 * @returns 
 */
function matches(pattern: MatchPattern, name: string): boolean {
  if (isArray(pattern)) {
    return pattern.some((p: string | RegExp) => matches(p, name))
  } else if (isString(pattern)) {
    return pattern.split(',').includes(name)
  } else if (pattern.test) {
    return pattern.test(name)
  }
  /* istanbul ignore next */
  return false
}

/**
 * 监听激活，注册激活的钩子
 * @param hook 
 * @param target 
 */
export function onActivated(
  hook: Function,
  target?: ComponentInternalInstance | null
) {
  registerKeepAliveHook(hook, LifecycleHooks.ACTIVATED, target)
}

/**
 * 失活，注册失活钩子
 * @param hook 
 * @param target 
 */
export function onDeactivated(
  hook: Function,
  target?: ComponentInternalInstance | null
) {
  registerKeepAliveHook(hook, LifecycleHooks.DEACTIVATED, target)
}

/**
 * 注册keepAlive钩子
 * @param hook 
 * @param type 
 * @param target 
 */
function registerKeepAliveHook(
  hook: Function & { __wdc?: Function },
  type: LifecycleHooks,
  target: ComponentInternalInstance | null = currentInstance
) {
  // cache the deactivate branch check wrapper for injected hooks so the same
  // hook can be properly deduped by the scheduler. "__wdc" stands for "with
  // deactivation check".
  // 缓存失活的分支，检查包装器从因为注入的钩子可能是重复的
  // __wdc 代表 正在进行失活检查
  const wrappedHook =
    hook.__wdc ||
    (hook.__wdc = () => {
      // only fire the hook if the target instance is NOT in a deactivated branch.
      // 如果target实例不属于失活的分支则仅仅触发钩子
      let current: ComponentInternalInstance | null = target
      // 从子节点到父节点递归，直到找到顶层节点中失活的节点
      while (current) {
        if (current.isDeactivated) {
          return
        }
        current = current.parent
      }
      // 执行当前钩子
      return hook()
    })
  // 注入钩子
  injectHook(type, wrappedHook, target)
  // In addition to registering it on the target instance, we walk up the parent
  // chain and register it on all ancestor instances that are keep-alive roots.
  // This avoids the need to walk the entire component tree when invoking these
  // hooks, and more importantly, avoids the need to track child components in
  // arrays.
  // 除了在target实例上注册外，
  // 我们遍历父组件链并在所有具有keep-alive的根节点的原型实例上注册它
  // 这就避免了在调用这些钩子时遍历整个组件树的需要
  if (target) {
    let current = target.parent
    while (current && current.parent) {
      // 该节点是keep-alive节点，则注入钩子
      if (isKeepAlive(current.parent.vnode)) {
        injectToKeepAliveRoot(wrappedHook, type, target, current)
      }
      current = current.parent
    }
  }
}

function injectToKeepAliveRoot(
  hook: Function & { __weh?: Function },
  type: LifecycleHooks,
  target: ComponentInternalInstance,
  keepAliveRoot: ComponentInternalInstance
) {
  // injectHook wraps the original for error handling, so make sure to remove
  // the wrapped version.
  // injectHook包装了原来的错误处理，所以一定要删除被包装的版本
  const injected = injectHook(type, hook, keepAliveRoot, true /* prepend */)
  // 卸载时，移除钩子
  onUnmounted(() => {
    remove(keepAliveRoot[type]!, injected)
  }, target)
}

/**
 * 重置Shape标记，
 * 如果组件应该被keep-alive，则删除该标记
 * 如果组件已经keep-alive，则删除该标记
 * 重置该节点的标记
 * @param vnode 
 */
function resetShapeFlag(vnode: VNode) {
  let shapeFlag = vnode.shapeFlag
  if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
    shapeFlag -= ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
  }
  if (shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
    shapeFlag -= ShapeFlags.COMPONENT_KEPT_ALIVE
  }
  vnode.shapeFlag = shapeFlag
}

/**
 * 获取内部子节点，如果是suspense则返回vnode的ssContent，
 * 否则正常应返回vnode
 * @param vnode 
 * @returns 
 */
function getInnerChild(vnode: VNode) {
  return vnode.shapeFlag & ShapeFlags.SUSPENSE ? vnode.ssContent! : vnode
}
