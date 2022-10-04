import { DebuggerOptions, ReactiveEffect } from './effect'
import { Ref, trackRefValue, triggerRefValue } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags, toRaw } from './reactive'
import { Dep } from './dep'

// 声明一个计算属性的标志
declare const ComputedRefSymbol: unique symbol

// 计算属性
export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
  [ComputedRefSymbol]: true
}

// 可写入的计算属性
export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

// 计算属性访问器
export type ComputedGetter<T> = (...args: any[]) => T
export type ComputedSetter<T> = (v: T) => void

// 可写入计算属性的配置项
export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

// 计算属性装载器，计算属性的生成工厂
export class ComputedRefImpl<T> {
  public dep?: Dep = undefined

  private _value!: T
  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true // 计算属性是ref
  public readonly [ReactiveFlags.IS_READONLY]: boolean = false

  public _dirty = true // 是否存在脏数据，就是数据变动没变动过
  public _cacheable: boolean // 缓存

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean, // 只读
    isSSR: boolean // 服务器渲染
  ) {
    this.effect = new ReactiveEffect(getter, () => {
      // 调度器执行，意味着依赖的值被修改了，将脏数据标记为脏，并触发副作用
      if (!this._dirty) {
        this._dirty = true
        triggerRefValue(this)
      }
    })
    this.effect.computed = this
    // 只有客户单渲染才有缓存
    this.effect.active = this._cacheable = !isSSR
    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    // 计算属性的ref可能会被其他代理包裹，例如readonly()
    const self = toRaw(this)
    // 跟踪
    trackRefValue(self)
    // 如果有脏数据或者是服务器环境，手动执行副作用函数并且重置脏数据标记
    if (self._dirty || !self._cacheable) {
      self._dirty = false
      self._value = self.effect.run()! // 此时手动执行副作用函数!非空断言操作符
    }
    return self._value
  }

  set value(newValue: T) {
    this._setter(newValue)
  }
}

// 计算属性函数
// 函数重载
export function computed<T>(
  getter: ComputedGetter<T>,
  debugOptions?: DebuggerOptions
): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>,
  debugOptions?: DebuggerOptions
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>,
  debugOptions?: DebuggerOptions,
  isSSR = false
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  // 如果只读
  const onlyGetter = isFunction(getterOrOptions)
  if (onlyGetter) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  // 计算属性
  const cRef = new ComputedRefImpl(getter, setter, onlyGetter || !setter, isSSR)

  if (__DEV__ && debugOptions && !isSSR) { // 调试
    cRef.effect.onTrack = debugOptions.onTrack
    cRef.effect.onTrigger = debugOptions.onTrigger
  }

  return cRef as any
}
