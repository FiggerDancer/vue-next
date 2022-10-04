import {
  reactive,
  readonly,
  toRaw,
  ReactiveFlags,
  Target,
  readonlyMap,
  reactiveMap,
  shallowReactiveMap,
  shallowReadonlyMap,
  isReadonly,
  isShallow
} from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking
} from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  isIntegerKey,
  extend,
  makeMap
} from '@vue/shared'
import { isRef } from './ref'
import { warn } from './warning'

// 处理Object和Array的拦截器

/**
 * 不需要跟踪的key
 * 这里使用 注释标记纯函数，是为了方便摇树
 */
const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

/**
 * 收集内置Symbol类型的所有symbol类型的键值
 */
const builtInSymbols = new Set(
  /*#__PURE__*/
  Object.getOwnPropertyNames(Symbol)
    // ios10.x Object.getOwnPropertyNames(Symbol) can enumerate 'arguments' and 'caller'
    // but accessing them on Symbol leads to TypeError because Symbol is a strict mode
    // function
    .filter(key => key !== 'arguments' && key !== 'caller')
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

/**
 * 普通get
 */
const get = /*#__PURE__*/ createGetter()
/**
 * 浅响应的get
 */
const shallowGet = /*#__PURE__*/ createGetter(false, true)
/**
 * 只读的get
 */
const readonlyGet = /*#__PURE__*/ createGetter(true)
/**
 * 浅响应只读的get
 */
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

/**
 * 数组的方法集
 */
const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()

/**
 * 创建数组的方法集
 * @returns 
 */
function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  // instrument identity-sensitive Array methods to account for possible reactive
  // values
  // 为数组中识别值是否存在的方法，增加响应式
  // Get部分
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      // toRaw 可以把响应式对象转成原始数据
      const arr = toRaw(this) as any // 拿到原始值
      for (let i = 0, l = this.length; i < l; i++) {
        // 依赖收集
        track(arr, TrackOpTypes.GET, i + '')
      }
      // we run the method using the original args first (which may be reactive)
      // 首先我们运行方法时使用原始参数，获取该值
      // 先尝试使用参数本身，它可能是响应式数据
      const res = arr[key](...args)
      if (res === -1 || res === false) { 
        // 如果数组内部含有响应式的值（这些值是不能用原始值来判断有没有的），可能还需要做特殊的处理
        // if that didn't work, run it again using raw values.
        // 如果它不能正常运行原始的方法，再次调用函数使用原始值，这是因为有可能这个数组内部的数值做了响应式的包裹，所以与原始值不相等了
        // 如果失败，再尝试把参数转成原始数据
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  // instrument length-altering mutation methods to avoid length being tracked
  // which leads to infinite loops in some cases (#2137)
  // 处理长度变化的方法，避免因为长度变化时进行数据跟踪，导致某些情况下无限循环
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      pauseTracking() // 停止跟踪
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetTracking() // 继续跟踪
      return res
    }
  })
  return instrumentations
}

/**
 * 创建访问器
 * @param isReadonly 只读
 * @param shallow 浅响应
 * @returns 
 */
function createGetter(isReadonly = false, shallow = false) {
  // get函数主要做4件事
  // 1. 首先对特殊的key做代理，key是__v_raw则直接返回原始对象target
  // 这就是我们在createReactiveObject函数中判断响应式对象是否存在__v_raw属性
  // 若其存在返回该对象对应的原始对象的原因
  // 2. 如果target是数组，且key命中了arrayInstrumentations,则执行其内部对应的函数
  return function get(target: Target, key: string | symbol, receiver: object) {
    if (key === ReactiveFlags.IS_REACTIVE) { 
      // 获取是否是响应式，如果不是只读的话，返回true
      // 代理 proxy.__v_isReactive
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) { 
      // 获取是否只读
      // 代理 proxy.__v_isReadonly
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) { 
      // 获取是否是浅响应
      // 代理 proxy.__v_isShallow
      return shallow
    } else if ( 
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? shallow
            ? shallowReadonlyMap
            : readonlyMap
          : shallow
          ? shallowReactiveMap
          : reactiveMap
        ).get(target)
    ) {
      // 获取原始值，如果接收器能够从缓存的代理对象映射表得到，
      // 那么就会直接返回这个原始值
      // 代理 proxy.__v_raw
      return target
    }

    // 数组标记
    const targetIsArray = isArray(target)

    // arrayInstrumentations 包含对数组一些函数修改的函数
    // 数组非只读且key值存在于代理函数中执行代理的函数，
    // 通过代理函数实现追踪，并返回对应的值
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver)
    }

    // 求值
    // 正常获取值，使用Reflect的原因在于可以传递第三个参数receiver，
    // 这可以传递this，用于ref等
    const res = Reflect.get(target, key, receiver)

    // 内置Symbol key，不需要依赖收集
    // key是symbol是内部的或者是在Vue内部不需要跟踪的一些保留的值，就不需要跟踪了
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }

    // 不是只读，依赖收集
    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }

    // 浅拷贝的话，就可以直接返回了
    if (shallow) {
      return res
    }

    // 如果是ref的话
    if (isRef(res)) {
      // ref unwrapping - skip unwrap for Array + integer key.
      // 如果不是数组或者key不是整型字符串，就需要对ref进行拆包并进行返回
      return targetIsArray && isIntegerKey(key) ? res : res.value
    }

    // 如果不是浅拷贝
    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      // 如果res是对象或者数组类型的，则执行reactive函数，将res变成响应式的。
      // 我们使用isObject函数检查res的类型，避免警告
      // 需要懒访问来避免只读和响应式造成的循环依赖
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

/**
 * 创建设置器
 */
const set = /*#__PURE__*/ createSetter()
/**
 * 浅响应设置
 */
const shallowSet = /*#__PURE__*/ createSetter(true)

/**
 * 创建修改器
 * @param shallow 浅响应
 * @returns 
 */
function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    let oldValue = (target as any)[key]
    // 首先，先对ref进行处理
    // 旧值只读、是ref类型，且新值不是ref类型则不允许设置
    if (isReadonly(oldValue) && isRef(oldValue) && !isRef(value)) {
      return false
    }
    // 非浅响应且非只读
    if (!shallow && !isReadonly(value)) {
      // 新的值是非浅响应
      if (!isShallow(value)) {
        // 新原始值
        value = toRaw(value)
        // 旧原始值
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
      // 非数组、旧值是ref且新值不是ref
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        // 设置旧的值为value
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
      // 在浅响应模式中，无论对象是否是响应式额对象都应该按正常修改设置。
    }

    // 第二部分，对于非ref处理
    // 是否包含Key值，比如object是否包含该key值，数组是否包含该索引
    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    
    // 设置这个值
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    // 如果目标是原型链的某个属性，通过Reflect.set修改它会再次触发setter
    // 在这种情况下就没有必要触发两次trigger
    // 如果目标在原型链上则不触发
    // 如果修改当前元素的接受器，就是当前元素
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        // 原先没有，则告诉用户是增加新的key
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        // 原先有了且又发生变化，则告诉用户是修改了
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}

/**
 * 删除属性
 * @param target 
 * @param key 
 * @returns 
 */
function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue) // 触发
  }
  return result
}

/**
 * 存在某属性
 * @param target 
 * @param key 
 * @returns 
 */
function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) { // 内置属性除外
    track(target, TrackOpTypes.HAS, key) // 跟踪
  }
  return result
}

/**
 * 拥有keys
 * @param target 
 * @returns 
 */
function ownKeys(target: object): (string | symbol)[] {
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY) // 跟踪 length 或者 ITERATE_KEY(这个)
  return Reflect.ownKeys(target)
}

/**
 * 拦截器
 * 
 * 访问对象属性会触发get函数
 * 设置对象属性会触发set函数
 * 删除对象属性会触发deleteProperty
 * in操作符会触发has函数
 * 通过Object.getOwnPropertyNames访问对象属性名会触发ownKeys函数
 */
export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}

/**
 * 只读拦截器
 * 设置、删除警告
 */
export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set(target, key) {
    if (__DEV__) {
      warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

/**
 * 浅响应拦截器
 */
export const shallowReactiveHandlers = /*#__PURE__*/ extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
// 属性处理函数要特殊处理，为了ref是能够传递下去，它不应该被在顶层拆开，但是应该保留只读对象的响应式
/**
 * 浅响应只读拦截器
 */
export const shallowReadonlyHandlers = /*#__PURE__*/ extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
