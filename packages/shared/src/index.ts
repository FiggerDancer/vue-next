import { makeMap } from './makeMap'

export { makeMap }
export * from './patchFlags'
export * from './shapeFlags'
export * from './slotFlags'
export * from './globalsWhitelist'
export * from './codeframe'
export * from './normalizeProp'
export * from './domTagConfig'
export * from './domAttrConfig'
export * from './escapeHtml'
export * from './looseEqual'
export * from './toDisplayString'
export * from './typeUtils'

// 空对象
export const EMPTY_OBJ: { readonly [key: string]: any } = __DEV__
  ? Object.freeze({})
  : {}

// 空数组
export const EMPTY_ARR = __DEV__ ? Object.freeze([]) : []

// 空函数
export const NOOP = () => {}

/**
 * Always return false.
 * 总是返回false
 */
export const NO = () => false

// 正则用于匹配监听的事件 比如：onClick
const onRE = /^on[^a-z]/
// 以on开头
export const isOn = (key: string) => onRE.test(key)

/**
 * 判断是否是v-model监听 onUpdate: (相当于Vue2里的.sync,$emit('update:'))
 * @param key 
 * @returns 
 */
export const isModelListener = (key: string) => key.startsWith('onUpdate:')

// 扩展函数
export const extend = Object.assign

// 移除数组中的元素
export const remove = <T>(arr: T[], el: T) => {
  const i = arr.indexOf(el)
  if (i > -1) {
    arr.splice(i, 1)
  }
}

// 拥有的属性
const hasOwnProperty = Object.prototype.hasOwnProperty

// 是否拥有某属性
export const hasOwn = (
  val: object,
  key: string | symbol
): key is keyof typeof val => hasOwnProperty.call(val, key)

// 是数组
export const isArray = Array.isArray

// 是否是Map
export const isMap = (val: unknown): val is Map<any, any> =>
  toTypeString(val) === '[object Map]'

// 是否是Set
export const isSet = (val: unknown): val is Set<any> =>
  toTypeString(val) === '[object Set]'

// 是否是Date
export const isDate = (val: unknown): val is Date => val instanceof Date
export const isFunction = (val: unknown): val is Function =>
  typeof val === 'function'
export const isString = (val: unknown): val is string => typeof val === 'string'
export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol'

// 是否是对象，包括 Map、Set、Array等，但不包括null
export const isObject = (val: unknown): val is Record<any, any> =>
  val !== null && typeof val === 'object'

// 是否是Promise
export const isPromise = <T = any>(val: unknown): val is Promise<T> => {
  return isObject(val) && isFunction(val.then) && isFunction(val.catch)
}

// 返回对应的类型字符串，用于判断是何种类型
export const objectToString = Object.prototype.toString
export const toTypeString = (value: unknown): string =>
  objectToString.call(value)

// 返回对应的原始值
export const toRawType = (value: unknown): string => {
  // extract "RawType" from strings like "[object RawType]"
  // 析出原始值
  return toTypeString(value).slice(8, -1)
}

/**
 * 字面量对象
 * @param val 
 * @returns 
 */
export const isPlainObject = (val: unknown): val is object =>
  toTypeString(val) === '[object Object]'

/**
 * 字符串正整型
 * @param key 
 * @returns 
 */
export const isIntegerKey = (key: unknown) =>
  isString(key) &&
  key !== 'NaN' &&
  key[0] !== '-' &&
  '' + parseInt(key, 10) === key

/**
 * 判断是否预留的属性
 */
export const isReservedProp = /*#__PURE__*/ makeMap(
  // the leading comma is intentional so empty string "" is also included
  // 开头的逗号是故意而为的，所以空字符串也会被囊括
  ',key,ref,ref_for,ref_key,' +
    'onVnodeBeforeMount,onVnodeMounted,' +
    'onVnodeBeforeUpdate,onVnodeUpdated,' +
    'onVnodeBeforeUnmount,onVnodeUnmounted'
)

/**
 * 判断是否是内置指令
 */
export const isBuiltInDirective = /*#__PURE__*/ makeMap(
  'bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text,memo'
)

/**
 * 字符串记忆函数
 * 性能优化，比如驼峰化
 * @param fn 返回值是一个传入参数为字符串，返回值是字符串的函数
 * @returns fn 返回值是一个传入参数为字符串，返回值是字符串的函数
 */
const cacheStringFunction = <T extends (str: string) => string>(fn: T): T => {
  const cache: Record<string, string> = Object.create(null)
  return ((str: string) => {
    const hit = cache[str]
    return hit || (cache[str] = fn(str))
  }) as any
}

/**
 * 驼峰的正则
 */
const camelizeRE = /-(\w)/g
/**
 * @private
 * 驼峰化
 * props-data => propsData
 */
export const camelize = cacheStringFunction((str: string): string => {
  return str.replace(camelizeRE, (_, c) => (c ? c.toUpperCase() : ''))
})

// 连字化
const hyphenateRE = /\B([A-Z])/g
/**
 * @private
 * 驼峰 => 烤串化
 * propsData => props-data
 */
export const hyphenate = cacheStringFunction((str: string) =>
  str.replace(hyphenateRE, '-$1').toLowerCase()
)

/**
 * @private
 * 首字母大写化
 */
export const capitalize = cacheStringFunction(
  (str: string) => str.charAt(0).toUpperCase() + str.slice(1)
)

/**
 * @private
 * 监听函数添加on前缀
 */
export const toHandlerKey = cacheStringFunction((str: string) =>
  str ? `on${capitalize(str)}` : ``
)

// compare whether a value has changed, accounting for NaN.
// 比较值是否发生变化，其中使用Object.is而不使用===，其实是因为NaN
// 因为NaN === NaN 返回的是false
export const hasChanged = (value: any, oldValue: any): boolean =>
  !Object.is(value, oldValue)

/**
 * 依次调用数组的函数
 * @param fns 
 * @param arg 
 */
export const invokeArrayFns = (fns: Function[], arg?: any) => {
  for (let i = 0; i < fns.length; i++) {
    fns[i](arg)
  }
}

// 定义对象的标记
export const def = (obj: object, key: string | symbol, value: any) => {
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: false,
    value
  })
}

// 转化成数字，如果转化后是NaN，则将原先的值返回
export const toNumber = (val: any): any => {
  const n = parseFloat(val)
  return isNaN(n) ? val : n
}

// 当前的全局对象
let _globalThis: any
// 获取全局变量
export const getGlobalThis = (): any => {
  return (
    _globalThis ||
    (_globalThis =
      typeof globalThis !== 'undefined'
        ? globalThis
        : typeof self !== 'undefined'
        ? self
        : typeof window !== 'undefined'
        ? window
        : typeof global !== 'undefined'
        ? global
        : {})
  )
}
