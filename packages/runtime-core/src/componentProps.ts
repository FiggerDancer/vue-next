import {
  toRaw,
  shallowReactive,
  trigger,
  TriggerOpTypes
} from '@vue/reactivity'
import {
  EMPTY_OBJ,
  camelize,
  hyphenate,
  capitalize,
  isString,
  isFunction,
  isArray,
  isObject,
  hasOwn,
  toRawType,
  PatchFlags,
  makeMap,
  isReservedProp,
  EMPTY_ARR,
  def,
  extend,
  isOn,
  IfAny
} from '@vue/shared'
import { warn } from './warning'
import {
  Data,
  ComponentInternalInstance,
  ComponentOptions,
  ConcreteComponent,
  setCurrentInstance,
  unsetCurrentInstance
} from './component'
import { isEmitListener } from './componentEmits'
import { InternalObjectKey } from './vnode'
import { AppContext } from './apiCreateApp'
import { createPropsDefaultThis } from './compat/props'
import { isCompatEnabled, softAssertCompatEnabled } from './compat/compatConfig'
import { DeprecationTypes } from './compat/compatConfig'
import { shouldSkipAttr } from './compat/attrsFallthrough'

// 组件属性选项，允许可以用对象形式，{attr}也可以用字符串形式['attr']
export type ComponentPropsOptions<P = Data> =
  | ComponentObjectPropsOptions<P>
  | string[]

// 组件对象属性选项
export type ComponentObjectPropsOptions<P = Data> = {
  [K in keyof P]: Prop<P[K]> | null
}

// 属性，可以选择用属性选项的形式，也可以直接传属性
export type Prop<T, D = T> = PropOptions<T, D> | PropType<T>

// 默认工厂
type DefaultFactory<T> = (props: Data) => T | null | undefined

// 属性选项
export interface PropOptions<T = any, D = T> {
  type?: PropType<T> | true | null
  required?: boolean
  default?: D | DefaultFactory<D> | null | undefined | object
  validator?(value: unknown): boolean
}

// 属性内置类型
export type PropType<T> = PropConstructor<T> | PropConstructor<T>[]

// 属性构造器
type PropConstructor<T = any> =
  | { new (...args: any[]): T & {} }
  | { (): T }
  | PropMethod<T>

// 属性方法
type PropMethod<T, TConstructor = any> = [T] extends [
  ((...args: any) => any) | undefined
] // if is function with args, allowing non-required functions
  // If is function with args，允许非必需函数
  ? { new (): TConstructor; (): T; readonly prototype: TConstructor } // Create Function like constructor
  // 像构造器一样创建函数
  : never

// 从T中筛选出必选的key
type RequiredKeys<T> = {
  [K in keyof T]: T[K] extends
    | { required: true } // required为true
    | { default: any } // 默认值为any
    // don't mark Boolean props as undefined
    // 没有标记布尔值属性作为undefined
    | BooleanConstructor //  类型为布尔值
    | { type: BooleanConstructor }
    ? T[K] extends { default: undefined | (() => undefined) } // 声明为undefined，则不是必填
      ? never
      : K
    : never
}[keyof T]

// 可选的Key，从所有的属性中排除必选的key
type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>

// 默认的key
type DefaultKeys<T> = {
  [K in keyof T]: T[K] extends
    | { default: any }
    // Boolean implicitly defaults to false
    // 布尔值隐式默认为false
    | BooleanConstructor
    | { type: BooleanConstructor }
    ? T[K] extends { type: BooleanConstructor; required: true } // not default if Boolean is marked as required
    // 如果布尔值被标记为必要值，则不是默认值
      ? never
      : K
    : never
}[keyof T]

// 推断出T的类型
type InferPropType<T> = [T] extends [null]
  ? any // null & true would fail to infer
  // null 与 true 将推断失败
  : [T] extends [{ type: null | true }]
  ? any // As TS issue https://github.com/Microsoft/TypeScript/issues/14829
  // somehow `ObjectConstructor` when inferred from { (): T } becomes `any` 
  // `BooleanConstructor` when inferred from PropConstructor(with PropMethod) becomes `Boolean`
  // 作为TS问题https://github.com/Microsoft/TypeScript/issues/14829
  // 不知道什么原因推论' ObjectConstructor '时，从{():T}变成了' any ' 
  // 推论'BooleanConstructor'时，从PropConstructor(与PropMethod)推理成为'布尔'
  : [T] extends [ObjectConstructor | { type: ObjectConstructor }]
  ? Record<string, any>
  : [T] extends [BooleanConstructor | { type: BooleanConstructor }]
  ? boolean
  // 推论是否是Date
  : [T] extends [DateConstructor | { type: DateConstructor }]
  ? Date
  // 不是Date的话  就推断它         
  : [T] extends [(infer U)[] | { type: (infer U)[] }]
  // 除了Date需要进行额外的推断
  ? U extends DateConstructor
    ? Date | InferPropType<U>
    : InferPropType<U>
  : [T] extends [Prop<infer V, infer D>] // U推断失败，推断V，D
  ? unknown extends V // 推断出来的V如果是unknown，那么就是用IfAny，否则就直接是V
    ? IfAny<V, V, D>
    : V
  : T // 推断又失败

// 提取出最后的属性
export type ExtractPropTypes<O> = {
  // use `keyof Pick<O, RequiredKeys<O>>` instead of `RequiredKeys<O>` to support IDE features
  // 使用' keyof Pick<O, RequiredKeys<O>> '而不是' RequiredKeys<O> '来支持IDE特性
  [K in keyof Pick<O, RequiredKeys<O>>]: InferPropType<O[K]>
} & {
  // use `keyof Pick<O, OptionalKeys<O>>` instead of `OptionalKeys<O>` to support IDE features
  // 使用' keyof Pick<O, OptionalKeys<O>> '而不是' OptionalKeys<O> '来支持IDE特性
  [K in keyof Pick<O, OptionalKeys<O>>]?: InferPropType<O[K]>
}

// 枚举布尔值转化标记
const enum BooleanFlags {
  shouldCast, // false值转化
  shouldCastTrue // true值转化标记
}

// extract props which defined with default from prop options
// 从属性选项中提取默认定义的属性
export type ExtractDefaultPropTypes<O> = O extends object
  ? { [K in DefaultKeys<O>]: InferPropType<O[K]> }
  : {}

// 初始化属性
type NormalizedProp =
  | null
  | (PropOptions & {
      [BooleanFlags.shouldCast]?: boolean // 转化布尔值为false
      [BooleanFlags.shouldCastTrue]?: boolean // 转化布尔值为true
    })

// normalized value is a tuple of the actual normalized options
// and an array of prop keys that need value casting (booleans and defaults)
// 规范化值是一个实际规范化选项的元组和一个需要进行值转换(布尔值和默认值)的prop键数组。
export type NormalizedProps = Record<string, NormalizedProp>
// 最后的初始化属性，可以允许对象式的或者字符串数组
export type NormalizedPropsOptions = [NormalizedProps, string[]] | []

/**
 * 初始化属性
 * @param instance 
 * @param rawProps 
 * @param isStateful 
 * @param isSSR 
 */
export function initProps(
  instance: ComponentInternalInstance,
  rawProps: Data | null,
  // 位标志比较的结果
  isStateful: number, // result of bitwise flag comparison 
  isSSR = false
) {
  // 定义空的属性和特性
  const props: Data = {}
  const attrs: Data = {}
  // 定义一个特性
  def(attrs, InternalObjectKey, 1)

  instance.propsDefaults = Object.create(null)

  // 拆分
  // propsOptions: ['foo']
  // rawProps: {foo,bar}
  // props: {foo}
  // attrs: {bar}
  setFullProps(instance, rawProps, props, attrs)

  // ensure all declared prop keys are present
  // propsOptions 是用户定义的选项 如：props:{type:{type: String, default: ""}}
  for (const key in instance.propsOptions[0]) {
    if (!(key in props)) {
      props[key] = undefined
    }
  }

  // validation
  // 校验属性
  if (__DEV__) {
    validateProps(rawProps || {}, props, instance)
  }

  if (isStateful) {
    // stateful
    // 有状态的组件
    // 非SSR环境下，浅响应式
    instance.props = isSSR ? props : shallowReactive(props)
  } else {
    // 如果是函数式组件
    if (!instance.type.props) { // 组件定义的props，如果组件没有定义过props
      // functional w/ optional props, props === attrs
      // 功能性的可选的Props，props等同于attrs
      instance.props = attrs
    } else {
      // functional w/ declared props
      // 功能已声明属性
      instance.props = props
    }
  }
  // 实例的attrs
  instance.attrs = attrs
}

// 更新属性
export function updateProps(
  instance: ComponentInternalInstance,
  rawProps: Data | null,
  rawPrevProps: Data | null,
  optimized: boolean
) {
  // 从实例中获取props、attrs、更新标记
  const {
    props,
    attrs,
    vnode: { patchFlag }
  } = instance
  // 获取属性的原始值
  const rawCurrentProps = toRaw(props)
  // 解构propsOptions获取属性选项
  const [options] = instance.propsOptions
  // 是否存在变化的attrs
  let hasAttrsChanged = false

  if (
    // always force full diff in dev
    // - #1942 if hmr is enabled with sfc component
    // - vite#872 non-sfc component used by sfc component
    // 在开发者环境中总是强制全量diff
    // sfc组件中热更新是允许的
    // 但非SFC组件使用SFC组件是会存在问题的
    // 第一个条件：非开发环境或者开发环境下当前实例或当前实例的父实例都不存在热更新id
    // 第二个条件：优化过的或者更新标记存在
    // 第三个条件：更新标记不为全量更新
    !(
      __DEV__ &&
      (instance.type.__hmrId ||
        (instance.parent && instance.parent.type.__hmrId))
    ) &&
    (optimized || patchFlag > 0) &&
    !(patchFlag & PatchFlags.FULL_PROPS)
  ) {
    if (patchFlag & PatchFlags.PROPS) {
      // Compiler-generated props & no keys change, just set the updated
      // the props.
      // 编译器生成的props&没有键的改变，只是设置更新的props。
      // 获取动态属性，即要更新的属性
      const propsToUpdate = instance.vnode.dynamicProps!
      for (let i = 0; i < propsToUpdate.length; i++) {
        let key = propsToUpdate[i]
        // PROPS flag guarantees rawProps to be non-null
        // PROPS标志(PatchFlags.PROPS)保证rawProps是非空的
        const value = rawProps![key]
        if (options) {
          // attr / props separation was done on init and will be consistent
          // in this code path, so just check if attrs have it.
          // 在init中完成了Attr / props分离，并在这个代码路径中保持一致，所以只需要检查attrs是否有它。
          if (hasOwn(attrs, key)) {
            // 两者不等说明发生了变化
            if (value !== attrs[key]) {
              attrs[key] = value
              // 存在发生改变的attrs
              hasAttrsChanged = true
            }
          } else {
            // 如果不是attr，那么就需要将key驼峰化
            const camelizedKey = camelize(key)
            props[camelizedKey] = resolvePropValue(
              options, // 属性 {type: {}}
              rawCurrentProps, // 当前props的原始值
              camelizedKey, // 驼峰化的key
              value, // 值
              instance, // 实例
              false /* isAbsent */ // 缺少的
            )
          }
        } else {
          if (__COMPAT__) { // 兼容
            // 如果是监听事件，且后缀为Native则移除Native后缀
            if (isOn(key) && key.endsWith('Native')) {
              key = key.slice(0, -6) // remove Native postfix // 移除Native的后缀
            } else if (shouldSkipAttr(key, instance)) { // 判断是否是要跳过的实例
              continue
            }
          }
          if (value !== attrs[key]) {
            attrs[key] = value
            hasAttrsChanged = true
          }
        }
      }
    }
  } else {
    // full props update.
    // 全部的属性进行更新
    if (setFullProps(instance, rawProps, props, attrs)) {
      hasAttrsChanged = true
    }
    // in case of dynamic props, check if we need to delete keys from
    // the props object
    // 如果是动态的props，检查我们是否需要从props对象中删除键
    let kebabKey: string
    // 遍历当前的props的原始值
    for (const key in rawCurrentProps) {
      // 新的props原始值 或 props不存在该键且props中不存在该键的烤肉串形式
      if (
        !rawProps ||
        // for camelCase
        // 对于驼峰拼写法
        (!hasOwn(rawProps, key) &&
          // it's possible the original props was passed in as kebab-case
          // and converted to camelCase (#955)
          // 有可能原始的prop被传递为烤肉串的形式，也会被转换为驼峰式 (#955)
          ((kebabKey = hyphenate(key)) === key || !hasOwn(rawProps, kebabKey)))
      ) {
        if (options) {
          // 属性
          // 过去props原始值中存在过这个属性
          if (
            rawPrevProps &&
            // for camelCase
            // 对于驼峰式
            (rawPrevProps[key] !== undefined ||
              // for kebab-case
              // 对于烤肉串
              rawPrevProps[kebabKey!] !== undefined)
          ) {
            props[key] = resolvePropValue(
              options,
              rawCurrentProps,
              key,
              undefined, // 删除该值
              instance,
              true /* isAbsent */
            )
          }
        } else {
          delete props[key]
        }
      }
    }
    // in the case of functional component w/o props declaration, props and
    // attrs point to the same object so it should already have been updated.
    // 在没有props声明的功能组件的情况下，props和attrs指向相同的对象，
    // 所以它应该已经更新过了。
    // attrs不等于当前props的原始值
    if (attrs !== rawCurrentProps) {
      for (const key in attrs) {
        // 遍历attrs
        // props新原始值不存在或者或者
        // 不存在对应的属性且不开启兼容模式或者没有Native为后缀的key
        if (
          !rawProps ||
          (!hasOwn(rawProps, key) &&
            (!__COMPAT__ || !hasOwn(rawProps, key + 'Native')))
        ) {
          // 删除属性
          delete attrs[key]
          // 存在属性修改
          hasAttrsChanged = true
        }
      }
    }
  }

  // trigger updates for $attrs in case it's used in component slots
  // 触发对$attrs的更新，以防它在组件槽中使用
  if (hasAttrsChanged) {
    trigger(instance, TriggerOpTypes.SET, '$attrs')
  }

  if (__DEV__) {
    // DEV环境，校验新的props值
    validateProps(rawProps || {}, props, instance)
  }
}

/**
 * 设置全属性
 * @param instance 
 * @param rawProps 
 * @param props 
 * @param attrs 
 * @returns 
 */
function setFullProps(
  instance: ComponentInternalInstance,
  rawProps: Data | null,
  props: Data,
  attrs: Data
) {
  // options 哪些是直接用props
  // needCastKeys 哪些是需要进行大小写转化的key
  const [options, needCastKeys] = instance.propsOptions
  let hasAttrsChanged = false
  let rawCastValues: Data | undefined // 用来放大小写需要转化的值的键值对
  // 原始属性
  if (rawProps) {
    for (let key in rawProps) {
      // key, ref are reserved and never passed down
      // 键，引用被保留并且从不会被传下去
      if (isReservedProp(key)) {
        continue
      }

      // 兼容模式
      if (__COMPAT__) {
        // 以onHook：为前缀的key
        if (key.startsWith('onHook:')) {
          // 警告
          softAssertCompatEnabled(
            DeprecationTypes.INSTANCE_EVENT_HOOKS,
            instance,
            key.slice(2).toLowerCase()
          )
        }
        // 'inline-template'跳过
        if (key === 'inline-template') {
          continue
        }
      }
      // 属性原始值
      const value = rawProps[key]
      // prop option names are camelized during normalization, so to support
      // kebab -> camel conversion here we need to camelize the key.
      // prop选项名称在规范化过程中被驼峰化，
      // 所以为了支持kebab ->驼峰转换，我们需要驼峰化键。
      let camelKey
      // 属性选项存在且options中含有驼峰化的key
      if (options && hasOwn(options, (camelKey = camelize(key)))) {
        // 不需要转化大小写的key中不包含key
        if (!needCastKeys || !needCastKeys.includes(camelKey)) {
          props[camelKey] = value
        } else {
          // 对大小写转化值后的prop中的值
          ;(rawCastValues || (rawCastValues = {}))[camelKey] = value
        }
      } else if (!isEmitListener(instance.emitsOptions, key)) {
        // Any non-declared (either as a prop or an emitted event) props are put
        // into a separate `attrs` object for spreading. Make sure to preserve
        // original key casing
        // 任何未声明的(作为prop或发出的事件)prop，就是未在emit里声明的事件
        // 都被放入单独的' attrs '对象中进行传播。
        // 确保保存原始的key
        if (__COMPAT__) {
          if (isOn(key) && key.endsWith('Native')) {
            key = key.slice(0, -6) // remove Native postfix // 移除Native后缀
          } else if (shouldSkipAttr(key, instance)) { // 跳过属性
            continue
          }
        }
        // 将attrs中不存的key或者value与原值不相等的放入，并设置存在属性变化为true
        if (!(key in attrs) || value !== attrs[key]) {
          attrs[key] = value
          hasAttrsChanged = true
        }
      }
    }
  }

  // 有转化大小写的key
  if (needCastKeys) {
    // 当前属性的原始值
    const rawCurrentProps = toRaw(props)
    // 大小写转化key在属性中的一个键值对
    const castValues = rawCastValues || EMPTY_OBJ
    // 遍历这些大小写转化过的属性，并赋值props
    for (let i = 0; i < needCastKeys.length; i++) {
      const key = needCastKeys[i]
      props[key] = resolvePropValue(
        options!,
        rawCurrentProps,
        key,
        castValues[key],
        instance,
        !hasOwn(castValues, key)
      )
    }
  }

  return hasAttrsChanged
}

/**
 * 解决属性值
 * @param options {hasAttr: ''}
 * @param props 实例的实际属性对象
 * @param key 属性
 * @param value 属性对应的值
 * @param instance 实例
 * @param isAbsent 缺少
 * @returns 
 */
function resolvePropValue(
  options: NormalizedProps,
  props: Data,
  key: string,
  value: unknown,
  instance: ComponentInternalInstance,
  isAbsent: boolean
) {
  const opt = options[key]
  if (opt != null) {
    const hasDefault = hasOwn(opt, 'default')
    // default values
    // 存在默认值，且给定的值为undefined
    if (hasDefault && value === undefined) {
      // 获取默认值
      const defaultValue = opt.default
      // 如果默认值是Function且值的类型不为Function
      if (opt.type !== Function && isFunction(defaultValue)) {
        // 从实例中获取到属性默认值
        const { propsDefaults } = instance
        // 若存在该key值的默认值则获取到该key的默认值赋值
        if (key in propsDefaults) {
          value = propsDefaults[key]
        } else { // 若在propsDefaulst中未找到对应的属性默认值
          // 设置当前实例为该实例
          setCurrentInstance(instance)
          // 通过函数的方式获取该值
          value = propsDefaults[key] = defaultValue.call(
            // 兼容this，这样defaultValue的function第一个参数就是this，第二个参数就是props
            __COMPAT__ &&
              isCompatEnabled(DeprecationTypes.PROPS_DEFAULT_THIS, instance)
              ? createPropsDefaultThis(instance, props, key)
              : null,
            props
          )
          // 重置当前实例
          unsetCurrentInstance()
        }
      } else {
        // 不是函数直接赋值即可
        value = defaultValue
      }
    }
    // boolean casting
    // 开启选项布尔值转化
    if (opt[BooleanFlags.shouldCast]) {
      // 如果该值不存在且不存在默认值，直接转化为false
      if (isAbsent && !hasDefault) {
        value = false
      } else if ( // 如果该值为空字串或者该值烤串化的自身，则转化为true
        opt[BooleanFlags.shouldCastTrue] &&
        (value === '' || value === hyphenate(key))
      ) {
        value = true
      }
    }
  }
  return value
}

/**
 * 标准化props配置
 * 
 * 该函数会首先处理mixins和extends，因为这两个特殊属性
 * 因为他们的作用都是扩展组件的定义
 * 所以需要对其定义中的props递归执行normalizePropsOptions
 * 
 * @param comp 定义组件的对象
 * @param appContext 全局上下文
 * @param asMixin 表示当前是否处于mixins的处理环境中
 * @returns 
 */
export function normalizePropsOptions(
  comp: ConcreteComponent,
  appContext: AppContext,
  asMixin = false
): NormalizedPropsOptions {
  // 用于缓存标准化的结果，有缓存则直接返回
  const cache = appContext.propsCache
  const cached = cache.get(comp)
  if (cached) {
    return cached
  }

  const raw = comp.props
  /**
   * 标准化后的props
   */
  const normalized: NormalizedPropsOptions[0] = {}
  /**
   * 存放需要转化的key
   */
  const needCastKeys: NormalizedPropsOptions[1] = []

  // apply mixin/extends props
  // 处理mixin和extend这些props
  let hasExtends = false
  if (__FEATURE_OPTIONS_API__ && !isFunction(comp)) {
    const extendProps = (raw: ComponentOptions) => {
      if (__COMPAT__ && isFunction(raw)) {
        raw = raw.options
      }
      hasExtends = true
      const [props, keys] = normalizePropsOptions(raw, appContext, true)
      extend(normalized, props)
      if (keys) needCastKeys.push(...keys)
    }
    // 处理全局的mixins
    if (!asMixin && appContext.mixins.length) {
      appContext.mixins.forEach(extendProps)
    }
    if (comp.extends) {
      extendProps(comp.extends)
    }
    if (comp.mixins) {
      comp.mixins.forEach(extendProps)
    }
  }

  if (!raw && !hasExtends) {
    // 没有属性值，没有extends，设置为空数组，并返回空数组
    cache.set(comp, EMPTY_ARR as any)
    return EMPTY_ARR as any
  }

  if (isArray(raw)) {
    // 处理数组形式的props定义 ['name', 'nick-name'] => {name: {}, nickName: {}}
    for (let i = 0; i < raw.length; i++) {
      if (__DEV__ && !isString(raw[i])) {
        warn(`props must be strings when using array syntax.`, raw[i])
      }
      // 驼峰
      const normalizedKey = camelize(raw[i])
      // 校验props名称是否符合规范
      if (validatePropName(normalizedKey)) {
        // 设置 name: {}
        normalized[normalizedKey] = EMPTY_OBJ
      }
    }
  } else if (raw) {
    // {name: String, nickName: [String, Boolean]} => {name: {type: String}, nickName: { type: [String, Boolean ]}}
    if (__DEV__ && !isObject(raw)) {
      warn(`invalid props options`, raw)
    }
    for (const key in raw) {
      const normalizedKey = camelize(key)
      if (validatePropName(normalizedKey)) {
        const opt = raw[key]
        // 标准化prop的定义格式
        const prop: NormalizedProp = (normalized[normalizedKey] =
          isArray(opt) || isFunction(opt) ? { type: opt } : opt)
        if (prop) {
          // Boolean类型的索引
          const booleanIndex = getTypeIndex(Boolean, prop.type)
          // String类型的索引
          const stringIndex = getTypeIndex(String, prop.type)
          // 存在boolean值类型的索引，则标记，存在需要转化的key
          prop[BooleanFlags.shouldCast] = booleanIndex > -1
          // 1.属性不是String类型；2.属性中布尔值类型在字符串之前，（布尔值可能不存在，字符串存在）
          prop[BooleanFlags.shouldCastTrue] =
            stringIndex < 0 || booleanIndex < stringIndex
          // if the prop needs boolean casting or default value
          // 布尔值和有默认值的prop都需要转换
          if (booleanIndex > -1 || hasOwn(prop, 'default')) {
            needCastKeys.push(normalizedKey)
          }
        }
      }
    }
  }

  const res: NormalizedPropsOptions = [normalized, needCastKeys]
  cache.set(comp, res)
  return res
}

// 校验属性名称，如果key的首字母不为$即可通过
function validatePropName(key: string) {
  if (key[0] !== '$') {
    return true
  } else if (__DEV__) {
    warn(`Invalid prop name: "${key}" is a reserved property.`)
  }
  return false
}

// use function string name to check type constructors
// so that it works across vms / iframes.
// 使用函数字符串名称检查类型构造函数，
// 以便它跨VMS / iframes工作。
function getType(ctor: Prop<any>): string {
  const match = ctor && ctor.toString().match(/^\s*function (\w+)/)
  return match ? match[1] : ctor === null ? 'null' : ''
}

// 看看两个属性是否是相同的类型
function isSameType(a: Prop<any>, b: Prop<any>): boolean {
  return getType(a) === getType(b)
}

/**
 * 获取类型位于期待类型中的索引
 * @param type 
 * @param expectedTypes 
 * @returns 
 */
function getTypeIndex(
  type: Prop<any>,
  expectedTypes: PropType<any> | void | null | true
): number {
  if (isArray(expectedTypes)) {
    // 数组的话直接用findIndex找相同类型
    return expectedTypes.findIndex(t => isSameType(t, type))
  } else if (isFunction(expectedTypes)) {
    // 类型为函数的话
    return isSameType(expectedTypes, type) ? 0 : -1
  }
  // 否则返回-1
  return -1
}

/**
 * dev only
 * 对非null属性依次校验
 */
function validateProps(
  rawProps: Data,
  props: Data,
  instance: ComponentInternalInstance
) {
  const resolvedValues = toRaw(props)
  const options = instance.propsOptions[0]
  for (const key in options) {
    let opt = options[key]
    if (opt == null) continue
    validateProp(
      key,
      resolvedValues[key],
      opt,
      !hasOwn(rawProps, key) && !hasOwn(rawProps, hyphenate(key))
    )
  }
}

/**
 * dev only
 * 校验属性
 */
function validateProp(
  name: string,
  value: unknown,
  prop: PropOptions,
  isAbsent: boolean
) {
  const { type, required, validator } = prop
  // required!
  if (required && isAbsent) { // 必须且不存在的报错信息
    warn('Missing required prop: "' + name + '"')
    return
  }
  // missing but optional
  // null但可选
  if (value == null && !prop.required) {
    return
  }
  // type check
  // 类型检查，类型不是true，null和undefined
  if (type != null && type !== true) {
    let isValid = false
    const types = isArray(type) ? type : [type]
    const expectedTypes = []
    // value is valid as long as one of the specified types match
    // 值是有效的，只要其中一个指定的类型匹配,就停止类型校验
    for (let i = 0; i < types.length && !isValid; i++) {
      const { valid, expectedType } = assertType(value, types[i])
      expectedTypes.push(expectedType || '')
      isValid = valid
    }
    // 没有一个有效的就警告
    if (!isValid) {
      warn(getInvalidTypeMessage(name, value, expectedTypes))
      return
    }
  }
  // custom validator
  // 自定义的校验函数
  if (validator && !validator(value)) {
    warn('Invalid prop: custom validator check failed for prop "' + name + '".')
  }
}

// 简单类型
const isSimpleType = /*#__PURE__*/ makeMap(
  'String,Number,Boolean,Function,Symbol,BigInt'
)

/**
 * 断言结果
 * valid 有效
 * expectedType 期待类型
 */
type AssertionResult = {
  valid: boolean
  expectedType: string
}

/**
 * dev only
 * 类型断言
 */
function assertType(value: unknown, type: PropConstructor): AssertionResult {
  let valid // 值是否是有效类型
  const expectedType = getType(type) // 获取值的类型
  if (isSimpleType(expectedType)) { // 是简单类型
    const t = typeof value
    valid = t === expectedType.toLowerCase()
    // for primitive wrapper objects
    // 对于原始包装器对象
    if (!valid && t === 'object') {
      valid = value instanceof type
    }
  } else if (expectedType === 'Object') {
    valid = isObject(value)
  } else if (expectedType === 'Array') {
    valid = isArray(value)
  } else if (expectedType === 'null') {
    valid = value === null
  } else {
    valid = value instanceof type // 对于自定义的属性构造器（或者vue自带的）
  }
  return {
    valid,
    expectedType
  }
}

/**
 * dev only
 * 获取失效的类型信息
 */
function getInvalidTypeMessage(
  name: string,
  value: unknown,
  expectedTypes: string[]
): string {
  let message =
    `Invalid prop: type check failed for prop "${name}".` +
    ` Expected ${expectedTypes.map(capitalize).join(' | ')}`
  const expectedType = expectedTypes[0] // 期待类型
  const receivedType = toRawType(value) // 接收到的类型
  const expectedValue = styleValue(value, expectedType) // 期待值
  const receivedValue = styleValue(value, receivedType) // 接收到的值
  // check if we need to specify expected value
  // 检查是否需要指定期望值
  if (
    expectedTypes.length === 1 &&
    isExplicable(expectedType) &&
    !isBoolean(expectedType, receivedType)
  ) {
    // 期待的类型数量为1，且期待类型与实际类型都不是布尔值，是string|number类型
    message += ` with value ${expectedValue}`
  }
  message += `, got ${receivedType} `
  // check if we need to specify received value
  // 检查是否接收的类型为 string|number|boolean类型
  if (isExplicable(receivedType)) {
    message += `with value ${receivedValue}.`
  }
  return message
}

/**
 * dev only
 * 将值转化为字符串（格式化）
 */
function styleValue(value: unknown, type: string): string {
  if (type === 'String') {
    return `"${value}"`
  } else if (type === 'Number') {
    return `${Number(value)}`
  } else {
    return `${value}`
  }
}

/**
 * dev only
 * 元素是string，number，boolean中的任意类型
 */
function isExplicable(type: string): boolean {
  const explicitTypes = ['string', 'number', 'boolean']
  return explicitTypes.some(elem => type.toLowerCase() === elem)
}

/**
 * dev only
 * 参数中存在布尔值
 */
function isBoolean(...args: string[]): boolean {
  return args.some(elem => elem.toLowerCase() === 'boolean')
}
