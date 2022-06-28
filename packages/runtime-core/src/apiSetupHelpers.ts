import { ComponentPropsOptions } from '@vue/runtime-core'
import { isArray, isPromise, isFunction } from '@vue/shared'
import {
  getCurrentInstance,
  setCurrentInstance,
  SetupContext,
  createSetupContext,
  unsetCurrentInstance
} from './component'
import { EmitFn, EmitsOptions } from './componentEmits'
import { ComponentObjectPropsOptions, ExtractPropTypes } from './componentProps'
import { warn } from './warning'

// dev only
// 仅服务器环境使用
const warnRuntimeUsage = (method: string) =>
  warn(
    `${method}() is a compiler-hint helper that is only usable inside ` +
      `<script setup> of a single file component. Its arguments should be ` +
      `compiled away and passing it at runtime has no effect.`
  )

/**
 * Vue `<script setup>` compiler macro for declaring component props. The
 * expected argument is the same as the component `props` option.
 * 
 * Vue `<script setup>` 编译器宏用于声明组件的属性
 * 期待的参数与组件属性选项中相同
 *
 * Example runtime declaration:
 * 运行时例子声明：
 * 
 * ```js
 * // using Array syntax
 * // 使用数组语法
 * const props = defineProps(['foo', 'bar'])
 * // using Object syntax
 * // 使用对象语法
 * const props = defineProps({
 *   foo: String,
 *   bar: {
 *     type: Number,
 *     required: true
 *   }
 * })
 * ```
 * 
 * Equivalent type-based declaration:
 * // 等效于基于类型的声明
 * ```ts
 * // will be compiled into equivalent runtime declarations
 * // 将被编译成等效的运行时声明
 * const props = defineProps<{
 *   foo?: string
 *   bar: number
 * }>()
 * ```
 *
 * This is only usable inside `<script setup>`, is compiled away in the
 * output and should **not** be actually called at runtime.
 * 这仅仅在 <script setup> 中有用，
 * 被编译输出
 * 不应该在运行时调用
 */
// overload 1: runtime props w/ array
/**
 * 重载1： 运行时属性 数组
 * @param props 
 */
export function defineProps<PropNames extends string = string>(
  props: PropNames[]
): Readonly<{ [key in PropNames]?: any }>
// overload 2: runtime props w/ object
// 重载2： 运行时属性 对象
export function defineProps<
  PP extends ComponentObjectPropsOptions = ComponentObjectPropsOptions
>(props: PP): Readonly<ExtractPropTypes<PP>>
// overload 3: typed-based declaration
// 重载3： 基于类型声明
export function defineProps<TypeProps>(): Readonly<TypeProps>
// implementation
/**
 * 实现
 * @returns 
 */
export function defineProps() {
  if (__DEV__) {
    // 运行时使用警告
    warnRuntimeUsage(`defineProps`)
  }
  return null as any
}

/**
 * Vue `<script setup>` compiler macro for declaring a component's emitted
 * events. The expected argument is the same as the component `emits` option.
 *
 * Vue `<script setup>` 编译器宏用于声明一个组件的触发事件
 * 被期待的参数与组件emits选项相同
 * 
 * Example runtime declaration:
 * 运行时声明示例
 * ```js
 * const emit = defineEmits(['change', 'update'])
 * ```
 *
 * Example type-based declaration:
 * 基于类型声明示例
 * ```ts
 * const emit = defineEmits<{
 *   (event: 'change'): void
 *   (event: 'update', id: number): void
 * }>()
 *
 * emit('change')
 * emit('update', 1)
 * ```
 *
 * This is only usable inside `<script setup>`, is compiled away in the
 * output and should **not** be actually called at runtime.
 * 这仅仅用于<script setup> 被编译输出
 * 不应该在运行时调用
 */
// overload 1: runtime emits w/ array
/**
 * 重载1： 数组
 * @param emitOptions 
 */
export function defineEmits<EE extends string = string>(
  emitOptions: EE[]
): EmitFn<EE[]>
/**
 * 重载2： 对象或数组
 * @param emitOptions 
 */
export function defineEmits<E extends EmitsOptions = EmitsOptions>(
  emitOptions: E
): EmitFn<E>

/**
 * 重载3： 基于类型
 */
export function defineEmits<TypeEmit>(): TypeEmit
// implementation
/**
 * 实现
 * @returns 
 */
export function defineEmits() {
  if (__DEV__) {
    warnRuntimeUsage(`defineEmits`)
  }
  return null as any
}
/** 定义update事件 */
defineEmits<{
  (event: 'update'): void
}>()

/**
 * Vue `<script setup>` compiler macro for declaring a component's exposed
 * instance properties when it is accessed by a parent component via template
 * refs.
 * 
 * Vue `<script setup>` 编译器宏用于声明一个组件的暴露实例的属性值
 * 当它被一个父组件通过模板引用（template refs)使用时
 *
 * `<script setup>` components are closed by default - i.e. variables inside
 * the `<script setup>` scope is not exposed to parent unless explicitly exposed
 * via `defineExpose`.
 * 
 * `<script setup>` 组件默认被闭合
 * 例如：变量在 <script setup>作用域内想要暴露给父组件
 * 必须得使用defineExpose
 *
 * This is only usable inside `<script setup>`, is compiled away in the
 * output and should **not** be actually called at runtime.
 * 这仅仅用于 <script setup> 被编译输出
 * 不应该在能运行时被调用
 */
export function defineExpose<
  Exposed extends Record<string, any> = Record<string, any>
>(exposed?: Exposed) {
  if (__DEV__) {
    warnRuntimeUsage(`defineExpose`)
  }
}

/**
 * 未定义
 */
type NotUndefined<T> = T extends undefined ? never : T

/**
 * 推断默认值
 * 遍历所有的key，依次推断不允许值是undefined
 */
type InferDefaults<T> = {
  [K in keyof T]?: InferDefault<T, NotUndefined<T[K]>>
}

/**
 * 推断默认值
 * 如果是基本类型的话，那就是直接返回类型本身
 * 如果是引用类型，则返回一个函数
 */
type InferDefault<P, T> = T extends
  | null
  | number
  | string
  | boolean
  | symbol
  | Function
  ? T
  : (props: P) => T

/**
 * 属性带有默认值
 * 遍历所有默认值，基础值是否属于Base
 * 属于则不是undefined
 */
type PropsWithDefaults<Base, Defaults> = Base & {
  [K in keyof Defaults]: K extends keyof Base ? NotUndefined<Base[K]> : never
}

/**
 * Vue `<script setup>` compiler macro for providing props default values when
 * using type-based `defineProps` declaration.
 * Vue `<script setup>` 编译器宏用于提供属性默认值
 * 当基于类型的 `defineProps` 声明
 *
 * Example usage:
 * 示例使用：
 * ```ts
 * withDefaults(defineProps<{
 *   size?: number
 *   labels?: string[]
 * }>(), {
 *   size: 3,
 *   labels: () => ['default label']
 * })
 * ```
 *
 * This is only usable inside `<script setup>`, is compiled away in the output
 * and should **not** be actually called at runtime.
 * 这仅仅用于<script setup>中，被编译后输出
 * 不应该用于运行时
 */
export function withDefaults<Props, Defaults extends InferDefaults<Props>>(
  props: Props,
  defaults: Defaults
): PropsWithDefaults<Props, Defaults> {
  // 运行时警告
  if (__DEV__) {
    warnRuntimeUsage(`withDefaults`)
  }
  return null as any
}

/**
 * 获取插槽
 * 从上下文中获取插槽
 * @returns 
 */
export function useSlots(): SetupContext['slots'] {
  return getContext().slots
}

/**
 * 获取attrs
 * @returns 
 */
export function useAttrs(): SetupContext['attrs'] {
  return getContext().attrs
}

/**
 * 获取上下文
 * @returns 
 */
function getContext(): SetupContext {
  // 获取当前实例
  const i = getCurrentInstance()!
  if (__DEV__ && !i) {
    warn(`useContext() called without active instance.`)
  }
  // 返回当前实例的上下文对象，如果没有上下文则创建一个并赋值返回
  return i.setupContext || (i.setupContext = createSetupContext(i))
}

/**
 * Runtime helper for merging default declarations. Imported by compiled code
 * only.
 * 运行时帮助函数用于合并默认的声明
 * 仅仅在编译代码中被引入
 * @internal
 */
export function mergeDefaults(
  raw: ComponentPropsOptions,
  defaults: Record<string, any>
): ComponentObjectPropsOptions {
  // 属性是数组，将数组转化为对象
  const props = isArray(raw)
    ? raw.reduce(
        (normalized, p) => ((normalized[p] = {}), normalized),
        {} as ComponentObjectPropsOptions
      )
    : raw
  // 遍历默认值
  for (const key in defaults) {
    const opt = props[key]
    if (opt) {
      // 属性值是数组或者方法 key: [String, Number] 或者 key: ComponentFn
      if (isArray(opt) || isFunction(opt)) {
        // 将其转化为对象进行赋值
        props[key] = { type: opt, default: defaults[key] }
      } else {
        // 否则直接赋值 key: String 
        opt.default = defaults[key]
      }
    } else if (opt === null) {
      // 属性为null key: null
      props[key] = { default: defaults[key] }
    } else if (__DEV__) {
      // 属性默认值key没有被直接声明
      warn(`props default key "${key}" has no corresponding declaration.`)
    }
  }
  return props
}

/**
 * Used to create a proxy for the rest element when destructuring props with
 * defineProps().
 * 被用来创建一个代理用于剩余元素
 * 当使用defineProps解构属性时
 * @internal
 */
export function createPropsRestProxy(
  props: any,
  excludedKeys: string[]
): Record<string, any> {
  // Record
  const ret: Record<string, any> = {}
  // 遍历属性
  for (const key in props) {
    // 包含在内的属性
    if (!excludedKeys.includes(key)) {
      // 定义这些包含在内的属性，进行代理，通过defineProperty访问
      Object.defineProperty(ret, key, {
        enumerable: true,
        get: () => props[key]
      })
    }
  }
  return ret
}

/**
 * `<script setup>` helper for persisting the current instance context over
 * async/await flows.
 * `<script setup>` 帮助函数用于持久化当前实例上下文的异步流
 *
 * `@vue/compiler-sfc` converts the following:
 * `@vue/compiler-sfc` 转化这个异步流
 *
 * ```ts
 * const x = await foo()
 * ```
 *
 * into:
 * 转变成如下所示：
 *
 * ```ts
 * let __temp, __restore
 * const x = (([__temp, __restore] = withAsyncContext(() => foo())),__temp=await __temp,__restore(),__temp)
 * 
 * 调用withAsyncContext 执行 await中的方法
 * 令 __temp 为异步方法 __restore 为将当前实例置为当前实例
 * 调用异步方法并等待它的值返回 将值赋给__temp
 * 获取结果值后调用  __restore 设置当前实例
 * 返回__temp的值
 * ```
 * @internal
 */
export function withAsyncContext(getAwaitable: () => any) {
  // 获取当前实例
  const ctx = getCurrentInstance()!
  if (__DEV__ && !ctx) {
    warn(
      `withAsyncContext called without active current instance. ` +
        `This is likely a bug.`
    )
  }
  // 获取等待中
  let awaitable = getAwaitable()
  // 清空当亲实例
  unsetCurrentInstance()
  // 等待中是一个Promise
  if (isPromise(awaitable)) {
    // 捕获错误后，重新设置当前实例
    awaitable = awaitable.catch(e => {
      setCurrentInstance(ctx)
      throw e
    })
  }
  // 返回
  return [awaitable, () => setCurrentInstance(ctx)]
}
