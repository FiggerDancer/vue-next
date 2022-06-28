import {
  isRef,
  isShallow,
  Ref,
  ComputedRef,
  ReactiveEffect,
  isReactive,
  ReactiveFlags,
  EffectScheduler,
  DebuggerOptions
} from '@vue/reactivity'
import { SchedulerJob, queuePreFlushCb } from './scheduler'
import {
  EMPTY_OBJ,
  isObject,
  isArray,
  isFunction,
  isString,
  hasChanged,
  NOOP,
  remove,
  isMap,
  isSet,
  isPlainObject
} from '@vue/shared'
import {
  currentInstance,
  ComponentInternalInstance,
  isInSSRComponentSetup,
  setCurrentInstance,
  unsetCurrentInstance
} from './component'
import {
  ErrorCodes,
  callWithErrorHandling,
  callWithAsyncErrorHandling
} from './errorHandling'
import { queuePostRenderEffect } from './renderer'
import { warn } from './warning'
import { DeprecationTypes } from './compat/compatConfig'
import { checkCompatEnabled, isCompatEnabled } from './compat/compatConfig'
import { ObjectWatchOptionItem } from './componentOptions'

/**
 * watchEffect
 * 清理
 */
export type WatchEffect = (onCleanup: OnCleanup) => void

/**
 * 监听的值，可以是一个ref，可以是计算属性的结果，可以是一个返回任意值的函数
 */
export type WatchSource<T = any> = Ref<T> | ComputedRef<T> | (() => T)

/**
 * 观察者的回调函数
 * 值
 * 旧的值
 * 清理
 */
export type WatchCallback<V = any, OV = any> = (
  value: V,
  oldValue: OV,
  onCleanup: OnCleanup
) => any

/**
 * 映射资源
 */
type MapSources<T, Immediate> = {
  [K in keyof T]: T[K] extends WatchSource<infer V>
    ? Immediate extends true
      ? V | undefined
      : V
    : T[K] extends object
    ? Immediate extends true
      ? T[K] | undefined
      : T[K]
    : never
}

/**
 * 清理
 */
type OnCleanup = (cleanupFn: () => void) => void

/**
 * 监听的基本选项
 * 冲刷的时机，提前，异步（后置），同步
 */
export interface WatchOptionsBase extends DebuggerOptions {
  flush?: 'pre' | 'post' | 'sync'
}

/**
 * 监听者选项
 * 立刻执行
 * 深度监听
 */
export interface WatchOptions<Immediate = boolean> extends WatchOptionsBase {
  immediate?: Immediate
  deep?: boolean
}

/**
 * 停止监听
 */
export type WatchStopHandle = () => void

// Simple effect.
/**
 * 简单副作用
 * @param effect 
 * @param options 
 * @returns 
 */
export function watchEffect(
  effect: WatchEffect,
  options?: WatchOptionsBase
): WatchStopHandle {
  // 执行监听
  return doWatch(effect, null, options)
}

/**
 * 异步监视副作用
 * @param effect 
 * @param options 
 * @returns 
 */
export function watchPostEffect(
  effect: WatchEffect,
  options?: DebuggerOptions
) {
  // 执行监听
  return doWatch(
    effect,
    null,
    (__DEV__
      ? Object.assign(options || {}, { flush: 'post' })
      : { flush: 'post' }) as WatchOptionsBase
  )
}

/**
 * 同步监视副作用
 * @param effect 
 * @param options 
 * @returns 
 */
export function watchSyncEffect(
  effect: WatchEffect,
  options?: DebuggerOptions
) {
  // 执行监听
  return doWatch(
    effect,
    null,
    (__DEV__
      ? Object.assign(options || {}, { flush: 'sync' })
      : { flush: 'sync' }) as WatchOptionsBase
  )
}

// initial value for watchers to trigger on undefined initial values
// 初始化的值用于监听器在未定义的初始值上触发
const INITIAL_WATCHER_VALUE = {}

/**
 * 多个监听资源值
 */
type MultiWatchSources = (WatchSource<unknown> | object)[]

// overload: array of multiple sources + cb
/**
 * 重载： 多个资源的数组+cb
 * @param sources 
 * @param cb 
 * @param options 
 */
export function watch<
  T extends MultiWatchSources,
  Immediate extends Readonly<boolean> = false
>(
  sources: [...T],
  cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload: multiple sources w/ `as const`
// watch([foo, bar] as const, () => {})
// somehow [...T] breaks when the type is readonly
/**
 * 重载： 多个资源 作为常量
 * 监听[foo,bar]作为常量，()=>{}
 * 无论以何种方法 [...T] 解构会破坏 当类型为只读时
 * @param source 
 * @param cb 
 * @param options 
 */
export function watch<
  T extends Readonly<MultiWatchSources>,
  Immediate extends Readonly<boolean> = false
>(
  source: T,
  cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload: single source + cb
/**
 * 重载： 单个资源+cb
 * @param source 
 * @param cb 
 * @param options 
 */
export function watch<T, Immediate extends Readonly<boolean> = false>(
  source: WatchSource<T>,
  cb: WatchCallback<T, Immediate extends true ? T | undefined : T>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload: watching reactive object w/ cb
/**
 * 重载： 监听reactive对象
 * @param source 
 * @param cb 
 * @param options 
 */
export function watch<
  T extends object,
  Immediate extends Readonly<boolean> = false
>(
  source: T,
  cb: WatchCallback<T, Immediate extends true ? T | undefined : T>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// implementation
/**
 * 实现监视器
 * @param source 
 * @param cb 
 * @param options 
 * @returns 
 */
export function watch<T = any, Immediate extends Readonly<boolean> = false>(
  source: T | WatchSource<T>,
  cb: any,
  options?: WatchOptions<Immediate>
): WatchStopHandle {
  if (__DEV__ && !isFunction(cb)) {
    warn(
      `\`watch(fn, options?)\` signature has been moved to a separate API. ` +
        `Use \`watchEffect(fn, options?)\` instead. \`watch\` now only ` +
        `supports \`watch(source, cb, options?) signature.`
    )
  }
  // 执行监听
  return doWatch(source as any, cb, options)
}

/**
 * 执行监听
 * @param source 
 * @param cb 
 * @param param2 
 * @returns 
 */
function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect | object,
  cb: WatchCallback | null,
  { immediate, deep, flush, onTrack, onTrigger }: WatchOptions = EMPTY_OBJ
): WatchStopHandle {
  if (__DEV__ && !cb) {
    // 没有回调函数并且设置了immediate立即执行选项，则警告
    if (immediate !== undefined) {
      warn(
        `watch() "immediate" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`
      )
    }
    // 设置deep 但是无回调 警告
    if (deep !== undefined) {
      warn(
        `watch() "deep" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`
      )
    }
  }

  // 失效资源警告
  const warnInvalidSource = (s: unknown) => {
    warn(
      `Invalid watch source: `,
      s,
      `A watch source can only be a getter/effect function, a ref, ` +
        `a reactive object, or an array of these types.`
    )
  }

  // 当前实例
  const instance = currentInstance
  // 访问器
  let getter: () => any
  // 强制触发
  let forceTrigger = false
  // 是多个资源
  let isMultiSource = false

  // 如果资源是ref
  if (isRef(source)) {
    // 访问器能够返回资源的值
    getter = () => source.value
    // 强制触发
    forceTrigger = isShallow(source)
  } else if (isReactive(source)) {
    // 如果源值是响应式的
    // 访问器返回reactive代理对象
    getter = () => source
    // 并且将deep设置为true
    deep = true
  } else if (isArray(source)) {
    // 如果是多个源
    isMultiSource = true
    // 值里面是否存在reactive，如果有的话，将强制触发设置为true
    forceTrigger = source.some(isReactive)
    // 访问器
    getter = () =>
      source.map(s => {
        if (isRef(s)) {
          // ref返回ref的值
          return s.value
        } else if (isReactive(s)) {
          // 响应式，则递归遍历收集该reactive的所有层级
          return traverse(s)
        } else if (isFunction(s)) {
          // 执行函数收集依赖
          // 如果是一个方法，则执行该方法并处理该方法的抛错
          return callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER)
        } else {
          // 警告失效的来源
          __DEV__ && warnInvalidSource(s)
        }
      })
  } else if (isFunction(source)) {
    // 是函数
    // 带有回调函数
    if (cb) {
      // getter with cb
      // 访问器带有回调函数，
      getter = () =>
        // 执行函数收集依赖
        callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER)
    } else {
      // no cb -> simple effect
      // 没有回调函数，则是简单副作用
      getter = () => {
        // 如果实例已经被卸载，则什么都不需要做
        if (instance && instance.isUnmounted) {
          return
        }
        // 如果有清理函数，则进行依赖清理，防止重复收集
        // 或者收集到本次不需要收集的内容
        if (cleanup) {
          cleanup()
        }
        // 执行函数，并收集依赖
        return callWithAsyncErrorHandling(
          source,
          instance,
          ErrorCodes.WATCH_CALLBACK,
          [onCleanup]
        )
      }
    }
  } else {
    // 均不符合将访问器设置为NOOP
    getter = NOOP
    __DEV__ && warnInvalidSource(source)
  }

  // 2.x array mutation watch compat
  // 2.x 数组操作监听兼容
  if (__COMPAT__ && cb && !deep) {
    // 获取原始访问器
    const baseGetter = getter
    // 改造访问器
    getter = () => {
      // 从原始访问器中获取值
      const val = baseGetter()
      // 如果是数组的话，就遍历递归去收集依赖
      if (
        isArray(val) &&
        checkCompatEnabled(DeprecationTypes.WATCH_ARRAY, instance)
      ) {
        traverse(val)
      }
      return val
    }
  }

  // 如果存在回调函数和deep属性
  if (cb && deep) {
    // 原始访问器
    const baseGetter = getter
    // 递归的去收集依赖
    getter = () => traverse(baseGetter())
  }

  let cleanup: () => void
  // 清理副作用
  let onCleanup: OnCleanup = (fn: () => void) => {
    // 传入一个清理副作用后的回调函数，副作用执行完毕后清理副作用
    cleanup = effect.onStop = () => {
      callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP)
    }
  }

  // in SSR there is no need to setup an actual effect, and it should be noop
  // unless it's eager
  if (__SSR__ && isInSSRComponentSetup) {
    // we will also not call the invalidate callback (+ runner is not set up)
    onCleanup = NOOP
    if (!cb) {
      getter()
    } else if (immediate) {
      callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
        getter(),
        isMultiSource ? [] : undefined,
        onCleanup
      ])
    }
    return NOOP
  }

  let oldValue = isMultiSource ? [] : INITIAL_WATCHER_VALUE
  const job: SchedulerJob = () => {
    if (!effect.active) {
      return
    }
    if (cb) {
      // watch(source, cb)
      const newValue = effect.run()
      if (
        deep ||
        forceTrigger ||
        (isMultiSource
          ? (newValue as any[]).some((v, i) =>
              hasChanged(v, (oldValue as any[])[i])
            )
          : hasChanged(newValue, oldValue)) ||
        (__COMPAT__ &&
          isArray(newValue) &&
          isCompatEnabled(DeprecationTypes.WATCH_ARRAY, instance))
      ) {
        // cleanup before running cb again
        if (cleanup) {
          cleanup()
        }
        callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
          newValue,
          // pass undefined as the old value when it's changed for the first time
          oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
          onCleanup
        ])
        oldValue = newValue
      }
    } else {
      // watchEffect
      effect.run()
    }
  }

  // important: mark the job as a watcher callback so that scheduler knows
  // it is allowed to self-trigger (#1727)
  job.allowRecurse = !!cb

  let scheduler: EffectScheduler
  if (flush === 'sync') {
    scheduler = job as any // the scheduler function gets called directly
  } else if (flush === 'post') {
    scheduler = () => queuePostRenderEffect(job, instance && instance.suspense)
  } else {
    // default: 'pre'
    scheduler = () => {
      if (!instance || instance.isMounted) {
        queuePreFlushCb(job)
      } else {
        // with 'pre' option, the first call must happen before
        // the component is mounted so it is called synchronously.
        job()
      }
    }
  }

  const effect = new ReactiveEffect(getter, scheduler)

  if (__DEV__) {
    effect.onTrack = onTrack
    effect.onTrigger = onTrigger
  }

  // initial run
  if (cb) {
    if (immediate) {
      job()
    } else {
      oldValue = effect.run()
    }
  } else if (flush === 'post') {
    queuePostRenderEffect(
      effect.run.bind(effect),
      instance && instance.suspense
    )
  } else {
    effect.run()
  }

  return () => {
    effect.stop()
    if (instance && instance.scope) {
      remove(instance.scope.effects!, effect)
    }
  }
}

// this.$watch
export function instanceWatch(
  this: ComponentInternalInstance,
  source: string | Function,
  value: WatchCallback | ObjectWatchOptionItem,
  options?: WatchOptions
): WatchStopHandle {
  const publicThis = this.proxy as any
  const getter = isString(source)
    ? source.includes('.')
      ? createPathGetter(publicThis, source)
      : () => publicThis[source]
    : source.bind(publicThis, publicThis)
  let cb
  if (isFunction(value)) {
    cb = value
  } else {
    cb = value.handler as Function
    options = value
  }
  const cur = currentInstance
  setCurrentInstance(this)
  const res = doWatch(getter, cb.bind(publicThis), options)
  if (cur) {
    setCurrentInstance(cur)
  } else {
    unsetCurrentInstance()
  }
  return res
}

export function createPathGetter(ctx: any, path: string) {
  const segments = path.split('.')
  return () => {
    let cur = ctx
    for (let i = 0; i < segments.length && cur; i++) {
      cur = cur[segments[i]]
    }
    return cur
  }
}

/**
 * 递归遍历
 * @param value 
 * @param seen 
 * @returns 
 */
export function traverse(value: unknown, seen?: Set<unknown>) {
  // 如果值不是一个对象或者含有明确的跳过标记
  if (!isObject(value) || (value as any)[ReactiveFlags.SKIP]) {
    return value
  }
  // 收集遍历过的值
  seen = seen || new Set()
  // 如果过去收集过该值，则直接返回
  if (seen.has(value)) {
    return value
  }
  // 否则添加新的值
  seen.add(value)
  // 如果是ref
  if (isRef(value)) {
    // 递归遍历ref的value
    traverse(value.value, seen)
  } else if (isArray(value)) {
    // 数组，递归遍历
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen)
    }
  } else if (isSet(value) || isMap(value)) {
    // 集合递归遍历
    value.forEach((v: any) => {
      traverse(v, seen)
    })
  } else if (isPlainObject(value)) {
    // 扁平化的对象遍历
    for (const key in value) {
      traverse((value as any)[key], seen)
    }
  }
  // 其他返回当前值
  return value
}
