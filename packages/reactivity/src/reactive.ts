import { isObject, toRawType, def } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers,
  shallowReadonlyCollectionHandlers
} from './collectionHandlers'
import { UnwrapRefSimple, Ref } from './ref'

// 实现响应式的核心

// 响应式标记
export const enum ReactiveFlags {
  SKIP = '__v_skip', // 可以直接跳过标记
  IS_REACTIVE = '__v_isReactive', // 响应式标记
  IS_READONLY = '__v_isReadonly', // 只读标记
  IS_SHALLOW = '__v_isShallow', // 浅响应式标记
  RAW = '__v_raw' // 原始值 也是用proxy要代理的对象
}

// 代理对象的一些特性
export interface Target {
  [ReactiveFlags.SKIP]?: boolean // 跳过
  [ReactiveFlags.IS_REACTIVE]?: boolean // 响应式
  [ReactiveFlags.IS_READONLY]?: boolean // 只读
  [ReactiveFlags.IS_SHALLOW]?: boolean // 浅
  [ReactiveFlags.RAW]?: any // 原始值
}

/**
 * 下面几个WeakMap用于存储代理对象
 */
export const reactiveMap = new WeakMap<Target, any>()
export const shallowReactiveMap = new WeakMap<Target, any>()
export const readonlyMap = new WeakMap<Target, any>()
export const shallowReadonlyMap = new WeakMap<Target, any>()

// 代理对象的类型
const enum TargetType {
  INVALID = 0, // 无效的
  COMMON = 1, // 数组或者字面量对象
  COLLECTION = 2 // 集合（Map,Set,WeakMap，WeakSet）
}

// 原始类型归类
function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

/**
 * 对代理类型归类
 * 传入代理对象，判断其是否有可跳过的标记和是否能够扩展（增加新字段）
 * 对于可跳过或者不能够扩展的代理对象归类为失效类型
 * 否则根据原始类型进行归类
 * @param value 
 * @returns 
 */
function getTargetType(value: Target) {
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
    ? TargetType.INVALID
    : targetTypeMap(toRawType(value))
}

// only unwrap nested ref
// 对嵌套的ref进行拆包
export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRefSimple<T>
/**
 * Creates a reactive copy of the original object.
 *
 * The reactive conversion is "deep"—it affects all nested properties. In the
 * ES2015 Proxy based implementation, the returned proxy is **not** equal to the
 * original object. It is recommended to work exclusively with the reactive
 * proxy and avoid relying on the original object.
 *
 * A reactive object also automatically unwraps refs contained in it, so you
 * don't need to use `.value` when accessing and mutating their value:
 *
 * ```js
 * const count = ref(0)
 * const obj = reactive({
 *   count
 * })
 *
 * obj.count++
 * obj.count // -> 1
 * count.value // -> 1
 * ```
 * 
 * 创建一个原始对象的响应式副本
 * 
 * 响应式的转化是将影响所有嵌套在内的属性。
 * 基于es6的Proxy的响应式转化，它的返回值并不等于原始对象。
 * 建议仅仅使用响应式对象而不要使用原始对象。
 * 一个响应式对象能够自动拆包内部的ref，所以当你添加或者修改它们的value时，你不需要使用.value
 */
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 如果代理对象为只读类型，则直接返回只读版本即可
  if (isReadonly(target)) {
    return target
  }
  // 创建响应式对象
  return createReactiveObject(
    target,
    false,
    mutableHandlers, // 数组对象的代理处理函数
    mutableCollectionHandlers, // 集合的代理处理函数
    reactiveMap
  )
}

// 声明浅响应式标记是一个独立的symbol
export declare const ShallowReactiveMarker: unique symbol

// 定义浅响应式的类型
export type ShallowReactive<T> = T & { [ShallowReactiveMarker]?: true }

/**
 * Return a shallowly-reactive copy of the original object, where only the root
 * level properties are reactive. It also does not auto-unwrap refs (even at the
 * root level).
 * 返回一个浅响应的原始对象副本，仅仅根节点上的属性时响应式的。
 * 即使在根节点上，它也不会自动拆包ref
 */
export function shallowReactive<T extends object>(
  target: T
): ShallowReactive<T> {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers,
    shallowReactiveMap
  )
}

// 基本数据类型
type Primitive = string | number | boolean | bigint | symbol | undefined | null
// 内置数据类型
type Builtin = Primitive | Function | Date | Error | RegExp

// 定义深只读类型
export type DeepReadonly<T> = T extends Builtin
  ? T // 如果泛型T是Builtin类型，返回T
  : T extends Map<infer K, infer V>
  ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>> // Map,则Map中的Key和Value也只读
  : T extends ReadonlyMap<infer K, infer V>
  ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends WeakMap<infer K, infer V>
  ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends Set<infer U>
  ? ReadonlySet<DeepReadonly<U>> // Set,则Set中的Value只读
  : T extends ReadonlySet<infer U>
  ? ReadonlySet<DeepReadonly<U>>
  : T extends WeakSet<infer U>
  ? WeakSet<DeepReadonly<U>>
  : T extends Promise<infer U> 
  ? Promise<DeepReadonly<U>> // Promise,则Promise返回值只读
  : T extends Ref<infer U>
  ? Readonly<Ref<DeepReadonly<U>>> // Ref，则Ref的Value只读
  : T extends {}
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> } // 字面量对象，则每个Value都只读
  : Readonly<T> // 主要是用于一些基本数据类型只读（没法更深了，因为没有更深的层次了）

/**
 * Creates a readonly copy of the original object. Note the returned copy is not
 * made reactive, but `readonly` can be called on an already reactive object.
 * 创建一个原始类型的一个只读副本。
 * 注意返回的副本不是响应式的，readonly可以传一个响应式的对象作为参数
 */
export function readonly<T extends object>(
  target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers,
    readonlyMap
  )
}

/**
 * Returns a reactive-copy of the original object, where only the root level
 * properties are readonly, and does NOT unwrap refs nor recursively convert
 * returned properties.
 * This is used for creating the props proxy object for stateful components.
 * 返回一个响应式副本，这个副本仅仅只有根节点属性是只读的，但不会拆包ref或者递归的转化返回值为只读。
 * 用于为状态组件的属性创建代理对象
 */
export function shallowReadonly<T extends object>(target: T): Readonly<T> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyCollectionHandlers,
    shallowReadonlyMap
  )
}

/**
 * @param target 代理对象
 * @param isReadonly 只读
 * @param baseHandlers 数组和对象的代理处理函数
 * @param collectionHandlers 集合的代理处理函数
 * @param proxyMap 副作用函数和代理对象及其属性的依赖关系映射表
 * @returns 
 */
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  // 对于非对象值，在开发环境给与良好的错误警告
  // 使用__DEV__这种环境变量，在生产环境中通过摇树可以删除这段dead_code
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  // 如果target已经是一个响应式对象了，直接返回它
  // 除非：是要在代理对象上调用readonly，将其变成只读的代理对象
  if (
    target[ReactiveFlags.RAW] && // 通过该target有没有原始值，有原始值
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE]) // 不是（只读且有响应式标记）
  ) {
    return target
  }
  // target already has corresponding Proxy
  // target已经存在对应的代理对象，那就直接返回那个代理对象
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }
  // only a whitelist of value types can be observed.
  // 仅仅白名单上的类型的target可以监听，object、Array、collection(Set,Map,WeakMap,WeakSet)
  const targetType = getTargetType(target)
  if (targetType === TargetType.INVALID) {
    return target
  }

  // 对于集合和数组、对象的函数进行代理拦截，然后在代理完成后，存储这些代理对象
  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  )
  proxyMap.set(target, proxy)
  return proxy
}

/**
 * 是否是响应式
 * @param value 
 * @returns 
 */
export function isReactive(value: unknown): boolean {
  // 是否是只读的，如果是只读的可以通过target中是否存在原始值来判断该值是否是响应式的
  if (isReadonly(value)) {
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  // 如果不是只读的，那么就通过target中是否存在响应式标记来判断
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

// 判断只读
export function isReadonly(value: unknown): boolean {
  // 有没有只读标记
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

// 判断浅响应
export function isShallow(value: unknown): boolean {
  // 是否有浅响应标记
  return !!(value && (value as Target)[ReactiveFlags.IS_SHALLOW])
}

// 是否是代理对象（只读或者响应式）
export function isProxy(value: unknown): boolean {
  // 是否是只读或者响应式的对象
  return isReactive(value) || isReadonly(value)
}

// 获取原始值
export function toRaw<T>(observed: T): T {
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  // 通过递归的方式，直到到获取到的值已经没有对应的原始值
  return raw ? toRaw(raw) : observed
}

// 标记原始值
export function markRaw<T extends object>(value: T): T {
  // 定义这个value值为原始值，这样在做响应式时，可以直接跳过
  def(value, ReactiveFlags.SKIP, true)
  return value
}

// 转化为响应式
export const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? reactive(value) : value

// 转化成只读对象
export const toReadonly = <T extends unknown>(value: T): T =>
  isObject(value) ? readonly(value as Record<any, any>) : value
