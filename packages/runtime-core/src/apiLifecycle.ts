import {
  ComponentInternalInstance,
  currentInstance,
  isInSSRComponentSetup,
  LifecycleHooks,
  setCurrentInstance,
  unsetCurrentInstance
} from './component'
import { ComponentPublicInstance } from './componentPublicInstance'
import { callWithAsyncErrorHandling, ErrorTypeStrings } from './errorHandling'
import { warn } from './warning'
import { toHandlerKey } from '@vue/shared'
import { DebuggerEvent, pauseTracking, resetTracking } from '@vue/reactivity'

export { onActivated, onDeactivated } from './components/KeepAlive'

/**
 * 注入钩子
 * @param type 
 * @param hook 
 * @param target 
 * @param prepend 是否放到前面，false放后面，true放到前面
 * @returns 
 */
export function injectHook(
  type: LifecycleHooks,
  hook: Function & { __weh?: Function },
  target: ComponentInternalInstance | null = currentInstance,
  prepend: boolean = false
): Function | undefined {
  // 有无实例，有实例的情况
  if (target) {
    const hooks = target[type] || (target[type] = [])
    // cache the error handling wrapper for injected hooks so the same hook
    // can be properly deduped by the scheduler. "__weh" stands for "with error
    // handling".
    // 缓存错误处理包装器用于注入钩子，所以相同的钩子
    // 调度器会去重
    // __weh 代表错误处理
    const wrappedHook =
      hook.__weh ||
      (hook.__weh = (...args: unknown[]) => {
        if (target.isUnmounted) {
          return
        }
        // disable tracking inside all lifecycle hooks
        // since they can potentially be called inside effects.
        // 禁止跟踪所有生命周期钩子的内容
        // 因为他们可能会被内部的副作用所调用
        pauseTracking()
        // Set currentInstance during hook invocation.
        // This assumes the hook does not synchronously trigger other hooks, which
        // can only be false when the user does something really funky.
        // 在钩子调用期间设置当前实例
        // 这假定钩子不会同步触发其他钩子，
        // 这可能仅仅是false 当用户做一些真的很奇怪的事情
        setCurrentInstance(target)
        // 异步错误处理
        const res = callWithAsyncErrorHandling(hook, target, type, args)
        // 重置当前实例
        unsetCurrentInstance()
        // 重新追踪
        resetTracking()
        return res
      })
    if (prepend) {
      // 在缓存前面追加，则放到数组前
      hooks.unshift(wrappedHook)
    } else {
      // 在缓存后面增加
      hooks.push(wrappedHook)
    }
    return wrappedHook
  } else if (__DEV__) {
    // 不存在当前实例
    const apiName = toHandlerKey(ErrorTypeStrings[type].replace(/ hook$/, ''))
    warn(
      `${apiName} is called when there is no active component instance to be ` +
        `associated with. ` +
        `Lifecycle injection APIs can only be used during execution of setup().` +
        (__FEATURE_SUSPENSE__
          ? ` If you are using async setup(), make sure to register lifecycle ` +
            `hooks before the first await statement.`
          : ``)
    )
  }
}

/**
 * 创建钩子
 * @param lifecycle 
 * @returns 
 */
export const createHook =
  <T extends Function = () => any>(lifecycle: LifecycleHooks) =>
  (hook: T, target: ComponentInternalInstance | null = currentInstance) =>
    // post-create lifecycle registrations are noops during SSR (except for serverPrefetch)
    // 创建后生命周期注册在SSR期间是noops (serverPrefetch除外)
    // ssr 除了serverPrefetch 就不创建钩子
    // 非ssr的正常情况下是要创建的
    (!isInSSRComponentSetup || lifecycle === LifecycleHooks.SERVER_PREFETCH) &&
    injectHook(lifecycle, hook, target)

// 生命周期钩子
export const onBeforeMount = createHook(LifecycleHooks.BEFORE_MOUNT)
export const onMounted = createHook(LifecycleHooks.MOUNTED)
export const onBeforeUpdate = createHook(LifecycleHooks.BEFORE_UPDATE)
export const onUpdated = createHook(LifecycleHooks.UPDATED)
export const onBeforeUnmount = createHook(LifecycleHooks.BEFORE_UNMOUNT)
export const onUnmounted = createHook(LifecycleHooks.UNMOUNTED)
export const onServerPrefetch = createHook(LifecycleHooks.SERVER_PREFETCH)

// 调试钩子
export type DebuggerHook = (e: DebuggerEvent) => void
// 创建渲染触发钩子
export const onRenderTriggered = createHook<DebuggerHook>(
  LifecycleHooks.RENDER_TRIGGERED
)
// 创建渲染跟踪钩子
export const onRenderTracked = createHook<DebuggerHook>(
  LifecycleHooks.RENDER_TRACKED
)

// 错误捕获钩子
export type ErrorCapturedHook<TError = unknown> = (
  err: TError,
  instance: ComponentPublicInstance | null,
  info: string
) => boolean | void

// 错误捕获
export function onErrorCaptured<TError = Error>(
  hook: ErrorCapturedHook<TError>,
  target: ComponentInternalInstance | null = currentInstance
) {
  injectHook(LifecycleHooks.ERROR_CAPTURED, hook, target)
}
