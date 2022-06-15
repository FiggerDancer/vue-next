import { TrackOpTypes, TriggerOpTypes } from './operations'
import { extend, isArray, isIntegerKey, isMap } from '@vue/shared'
import { EffectScope, recordEffectScope } from './effectScope'
import {
  createDep,
  Dep,
  finalizeDepMarkers,
  initDepMarkers,
  newTracked,
  wasTracked
} from './dep'
import { ComputedRefImpl } from './computed'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
// 这个主要的WeakMap存储着{target->key->dep}的关系
// 从概念上讲，我们更容易将依赖关系看作是维护一组订阅者的Dep类，但我们只是将它们存储为原始的Set以减少内存开销。
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

// The number of effects currently being tracked recursively.
// 目前正在递归跟踪的副作用的层级深度
let effectTrackDepth = 0

export let trackOpBit = 1

/**
 * The bitwise track markers support at most 30 levels of recursion.
 * This value is chosen to enable modern JS engines to use a SMI on all platforms.
 * When recursion depth is greater, fall back to using a full cleanup.
 * 按位跟踪标记最多支持30级递归
 * 选择这个值是为了使现代JS引擎能够在所有平台上使用SMI。
 * 当递归深度更大时，退回到使用完全清理。
 */
const maxMarkerBits = 30

// 副作用调度
export type EffectScheduler = (...args: any[]) => any

// Debugger事件类型
export type DebuggerEvent = {
  effect: ReactiveEffect
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

// 当前正在执行的副作用函数
export let activeEffect: ReactiveEffect | undefined

// 迭代唯一标记值
export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
// Map迭代的唯一标记值
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

// 响应式副作用
export class ReactiveEffect<T = any> {
  active = true // 激活的
  deps: Dep[] = [] // 依赖
  parent: ReactiveEffect | undefined = undefined // 父级响应式副作用函数

  /**
   * Can be attached after creation
   * 创建后可以被附加
   * @internal
   */
  computed?: ComputedRefImpl<T>
  /**
   * @internal
   */
  allowRecurse?: boolean // 允许嵌套

  onStop?: () => void
  // dev only
  // 开发者环境
  onTrack?: (event: DebuggerEvent) => void
  // dev only
  // 开发者环境
  onTrigger?: (event: DebuggerEvent) => void

  constructor(
    public fn: () => T,
    public scheduler: EffectScheduler | null = null,
    scope?: EffectScope
  ) {
    recordEffectScope(this, scope) // 记录作用域
  }

  // 执行
  run() {
    // 如果已经停止执行，执行fn，不收集依赖
    if (!this.active) {
      return this.fn()
    }
    // 赋值当前activeEffect给parent吗，但在这个函数里我并没有看到它被使用，猜测是副作用？，因为它把它的包含它的副作用函数相当于遍历了一遍。
    let parent: ReactiveEffect | undefined = activeEffect
    // 上次是否允许跟踪
    let lastShouldTrack = shouldTrack
    // 找到根副作用函数
    while (parent) {
      if (parent === this) {
        return
      }
      parent = parent.parent
    }
    try {
      // 更换当前正在执行的副作用函数，并且建立副作用函数嵌套从属关系
      this.parent = activeEffect
      activeEffect = this
      shouldTrack = true // 允许跟踪

      // 每当跟踪的时候深度+1
      // 跟踪标志位 = 向左移副作用跟踪的深度的位数，如果是第一层这里会是 10（2进制），第2次 100，第3次 1000 可以理解为唯一id
      trackOpBit = 1 << ++effectTrackDepth

      // 如果嵌套层级不超过最大限制，那就初始化该副作用函数的标记，因为位掩码最多31位，否则从包含该副作用函数的依赖集中清除该副作用函数
      // 使用异或标记
      // 每次执行依赖前收集一遍标记，结束后先清理掉不用的，然后清除标记
      if (effectTrackDepth <= maxMarkerBits) { 
        initDepMarkers(this)
      } else {
        cleanupEffect(this)
      }
      return this.fn() // 执行副作用函数
    } finally {
      if (effectTrackDepth <= maxMarkerBits) { // 清理标记
        finalizeDepMarkers(this)
      }

      // 跟踪完了深度-1
      trackOpBit = 1 << --effectTrackDepth // 深度--

      activeEffect = this.parent // 更换当前正在执行的副作用函数
      shouldTrack = lastShouldTrack // 恢复本层级的跟踪模式
      this.parent = undefined
    }
  }

  // 停止该依赖
  stop() {
    // 将激活状态置为false，并且清除依赖中相应的副作用函数，触发onStop回调函数
    if (this.active) {
      cleanupEffect(this)
      if (this.onStop) {
        this.onStop()
      }
      this.active = false
    }
  }
}

// 清理副作用函数
function cleanupEffect(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

// Debug
export interface DebuggerOptions {
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
}

// 响应式选项
export interface ReactiveEffectOptions extends DebuggerOptions {
  lazy?: boolean // 懒执行
  scheduler?: EffectScheduler // 调度器
  scope?: EffectScope // 作用域
  allowRecurse?: boolean // 是否允许嵌套的副作用函数能够执行，可能导致被嵌套的副作用函数多次执行
  onStop?: () => void // 监听停止
}

// 本身是个函数，函数带有属性effect
export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

// 副作用函数
export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions
): ReactiveEffectRunner {
  // 如果匿名函数是一个副作用函数的运行器，则将运行器的副作用匿名函数取出并赋值
  if ((fn as ReactiveEffectRunner).effect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const _effect = new ReactiveEffect(fn)
  if (options) {
    extend(_effect, options)
    // 如果有作用域，要记录作用域
    if (options.scope) recordEffectScope(_effect, options.scope)
  }
  // 如果不是lazy模式，则执行执行
  if (!options || !options.lazy) {
    _effect.run()
  }
  // 如果用户要用到的是lazy模式，这时需要通过调度器或者用户手动执行，所以这里返回原函数，并绑定_effect作为该函数的额this
  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  runner.effect = _effect
  return runner
}

// 停止运行副作用
export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}

// 是否可跟踪
export let shouldTrack = true
// 跟踪栈
const trackStack: boolean[] = []

// 暂停跟踪
export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

// 允许跟踪
export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

// 退回到上一步，上一步是否允许跟踪
export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

// 跟踪
export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (shouldTrack && activeEffect) {
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = createDep()))
    }

    // 调试环境用的调试信息
    const eventInfo = __DEV__
      ? { effect: activeEffect, target, type, key }
      : undefined
    // 跟踪
    trackEffects(dep, eventInfo)
  }
}

export function trackEffects(
  dep: Dep,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  let shouldTrack = false
  // 没有超出
  if (effectTrackDepth <= maxMarkerBits) {
    // 按位与
    if (!newTracked(dep)) {
      dep.n |= trackOpBit // set newly tracked 跟踪新设
      shouldTrack = !wasTracked(dep) // 该dep之前没有被跟踪则可以跟踪
    }
  } else {
    // Full cleanup mode.
    // 全面清理模式。
    // 如果超出，且dep中收集了当前的副作用函数，这是就不能使用位掩码的运算方式了
    shouldTrack = !dep.has(activeEffect!)
  }

  if (shouldTrack) {
    // 收集副作用函数，同时副作用函数也要清楚谁收集了它，建立了依赖关系
    dep.add(activeEffect!)
    activeEffect!.deps.push(dep)
    // 下面都是调试信息
    if (__DEV__ && activeEffect!.onTrack) {
      activeEffect!.onTrack(
        Object.assign(
          {
            effect: activeEffect!
          },
          debuggerEventExtraInfo
        )
      )
    }
  }
}

// 触发
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // never been tracked
    // 没有被跟踪
    return
  }

  // 一会儿要执行其副作用的依赖集
  let deps: (Dep | undefined)[] = []
  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    // 集合被清理，应该触发这个target下的所有的副作用函数
    deps = [...depsMap.values()]
  } else if (key === 'length' && isArray(target)) {
    // 如果是length且是数组，如果传入的key是length，那么对于数组的length会发生影响，对于数组的中索引大于新长度的元素也会发生影响
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) {
        deps.push(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    // 调度运行set|add|delete时
    if (key !== void 0) {
      deps.push(depsMap.get(key))
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    switch (type) {
      // 如果是add的操作（添加了新的元素）
      case TriggerOpTypes.ADD:
        if (!isArray(target)) {
          // Object.keys,Map.keys,Set.keys，for in等等
          deps.push(depsMap.get(ITERATE_KEY))
          // 如果是Map的话还要额外执行别的value的遍历相关的副作用函数 Map.values Map.entries等等
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // new index added to array -> length changes
          // 数组的话，如果是添加了新的索引，要去触发length的依赖集
          deps.push(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        // 删除，
        if (!isArray(target)) {
          // Object.keys,Map.keys,Set.keys，for in等等
          deps.push(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            // Map.values
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          // Map.set
          deps.push(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  const eventInfo = __DEV__
    ? { target, type, key, newValue, oldValue, oldTarget }
    : undefined

  // 去调用触发这些收集好要触发的副作用集
  if (deps.length === 1) {
    if (deps[0]) {
      if (__DEV__) {
        triggerEffects(deps[0], eventInfo)
      } else {
        triggerEffects(deps[0])
      }
    }
  } else {
    const effects: ReactiveEffect[] = []
    for (const dep of deps) {
      if (dep) {
        effects.push(...dep)
      }
    }
    if (__DEV__) {
      triggerEffects(createDep(effects), eventInfo)
    } else {
      triggerEffects(createDep(effects))
    }
  }
}

export function triggerEffects(
  dep: Dep | ReactiveEffect[],
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // spread into array for stabilization
  // 为了保持稳定性，使用扩展运算符把非数组转化为数组
  for (const effect of isArray(dep) ? dep : [...dep]) {
    // 当前副作用函数和要执行的副作用函数不同或者允许嵌套副作用函数执行
    if (effect !== activeEffect || effect.allowRecurse) {
      if (__DEV__ && effect.onTrigger) {
        effect.onTrigger(extend({ effect }, debuggerEventExtraInfo))
      }
      // 有调度器执行调度器，否则执行匿名副作用函数本身
      if (effect.scheduler) {
        effect.scheduler()
      } else {
        effect.run()
      }
    }
  }
}
