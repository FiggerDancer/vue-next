import {
  ComponentInternalInstance,
  Data,
  getExposeProxy,
  isStatefulComponent
} from './component'
import { nextTick, queueJob } from './scheduler'
import { instanceWatch, WatchOptions, WatchStopHandle } from './apiWatch'
import {
  EMPTY_OBJ,
  hasOwn,
  isGloballyWhitelisted,
  NOOP,
  extend,
  isString,
  isFunction,
  UnionToIntersection
} from '@vue/shared'
import {
  toRaw,
  shallowReadonly,
  track,
  TrackOpTypes,
  ShallowUnwrapRef,
  UnwrapNestedRefs
} from '@vue/reactivity'
import {
  ExtractComputedReturns,
  ComponentOptionsBase,
  ComputedOptions,
  MethodOptions,
  ComponentOptionsMixin,
  OptionTypesType,
  OptionTypesKeys,
  resolveMergedOptions,
  shouldCacheAccess,
  MergedComponentOptionsOverride
} from './componentOptions'
import { EmitsOptions, EmitFn } from './componentEmits'
import { Slots } from './componentSlots'
import { markAttrsAccessed } from './componentRenderUtils'
import { currentRenderingInstance } from './componentRenderContext'
import { warn } from './warning'
import { installCompatInstanceProperties } from './compat/instance'

/**
 * Custom properties added to component instances in any way and can be accessed through `this`
 * 自定义属性以任何方式被添加到组件实例上
 * 可能通过this被使用
 * 
 * @example
 * Here is an example of adding a property `$router` to every component instance:
 * 这是一个添加$router的示例对于每个组件实例
 * ```ts
 * import { createApp } from 'vue'
 * import { Router, createRouter } from 'vue-router'
 *
 * declare module '@vue/runtime-core' {
 *   interface ComponentCustomProperties {
 *     $router: Router
 *   }
 * }
 *
 * // effectively adding the router to every component instance
 * // 给每个组件实例有效的添加router
 * const app = createApp({})
 * const router = createRouter()
 * app.config.globalProperties.$router = router
 *
 * const vm = app.mount('#app')
 * // we can access the router from the instance
 * // 我们可以从实例中使用路由
 * vm.$router.push('/')
 * ```
 */
export interface ComponentCustomProperties {}

/**
 * 是默认混合器组件
 */
type IsDefaultMixinComponent<T> = T extends ComponentOptionsMixin
  ? ComponentOptionsMixin extends T
    ? true
    : false
  : false

/**
 * 混合器用于选项式类型
 */
type MixinToOptionTypes<T> = T extends ComponentOptionsBase<
  infer P,
  infer B,
  infer D,
  infer C,
  infer M,
  infer Mixin,
  infer Extends,
  any,
  any,
  infer Defaults
>
  ? OptionTypesType<P & {}, B & {}, D & {}, C & {}, M & {}, Defaults & {}> &
      IntersectionMixin<Mixin> &
      IntersectionMixin<Extends>
  : never

// ExtractMixin(map type) is used to resolve circularly references
/**
 * 提取混合器（映射类型）被用于解决循环引用
 */
type ExtractMixin<T> = {
  Mixin: MixinToOptionTypes<T>
}[T extends ComponentOptionsMixin ? 'Mixin' : never]

/**
 * 交集混合器
 * 是否是默认的混合器组件，如果是的话
 * 则。。
 */
type IntersectionMixin<T> = IsDefaultMixinComponent<T> extends true
  ? OptionTypesType<{}, {}, {}, {}, {}>
  : UnionToIntersection<ExtractMixin<T>>

/**
 * 拆包混合器类型
 */
type UnwrapMixinsType<
  T,
  Type extends OptionTypesKeys
> = T extends OptionTypesType ? T[Type] : never

/**
 * 确保不是void
 */
type EnsureNonVoid<T> = T extends void ? {} : T

/**
 * 组件公共实例构造器
 */
export type ComponentPublicInstanceConstructor<
  T extends ComponentPublicInstance<
    Props,
    RawBindings,
    D,
    C,
    M
  > = ComponentPublicInstance<any>,
  Props = any,
  RawBindings = any,
  D = any,
  C extends ComputedOptions = ComputedOptions,
  M extends MethodOptions = MethodOptions
> = {
  __isFragment?: never
  __isTeleport?: never
  __isSuspense?: never
  new (...args: any[]): T
}

/**
 * 创建组件公共实例
 */
export type CreateComponentPublicInstance<
  P = {},
  B = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = {},
  PublicProps = P,
  Defaults = {},
  MakeDefaultsOptional extends boolean = false,
  PublicMixin = IntersectionMixin<Mixin> & IntersectionMixin<Extends>,
  PublicP = UnwrapMixinsType<PublicMixin, 'P'> & EnsureNonVoid<P>,
  PublicB = UnwrapMixinsType<PublicMixin, 'B'> & EnsureNonVoid<B>,
  PublicD = UnwrapMixinsType<PublicMixin, 'D'> & EnsureNonVoid<D>,
  PublicC extends ComputedOptions = UnwrapMixinsType<PublicMixin, 'C'> &
    EnsureNonVoid<C>,
  PublicM extends MethodOptions = UnwrapMixinsType<PublicMixin, 'M'> &
    EnsureNonVoid<M>,
  PublicDefaults = UnwrapMixinsType<PublicMixin, 'Defaults'> &
    EnsureNonVoid<Defaults>
> = ComponentPublicInstance<
  PublicP,
  PublicB,
  PublicD,
  PublicC,
  PublicM,
  E,
  PublicProps,
  PublicDefaults,
  MakeDefaultsOptional,
  ComponentOptionsBase<P, B, D, C, M, Mixin, Extends, E, string, Defaults>
>

// public properties exposed on the proxy, which is used as the render context
// in templates (as `this` in the render option)
/**
 * 公共属性被暴露在代理上，这将被用于渲染器上下文
 * 在模板中（作为 this 在渲染器选项中）
 */
export type ComponentPublicInstance<
  /** 
   * 属性类型从属性选项中提取
   * */
  P = {}, // props type extracted from props option
  // 原始绑定值从setup中返回
  B = {}, // raw bindings returned from setup()
  // 从data中返回数据
  D = {}, // return from data()
  // 计算属性
  C extends ComputedOptions = {},
  // 方法
  M extends MethodOptions = {},
  // emits
  E extends EmitsOptions = {},
  // 属性
  PublicProps = P,
  // 默认值
  Defaults = {},
  // 默认选项
  MakeDefaultsOptional extends boolean = false,
  // 选项
  Options = ComponentOptionsBase<any, any, any, any, any, any, any, any, any>
> = {
  // 组件内部实例
  $: ComponentInternalInstance
  // data
  $data: D
  // 属性，有默认属性，默认属性全都调整为可选属性，从公共属性中排除默认属性
  $props: MakeDefaultsOptional extends true
    ? Partial<Defaults> & Omit<P & PublicProps, keyof Defaults>
    : P & PublicProps
  // attr
  $attrs: Data
  // 模板引用
  $refs: Data
  // 插槽
  $slots: Slots
  // 根节点
  $root: ComponentPublicInstance | null
  // 父节点
  $parent: ComponentPublicInstance | null
  // 触发事件
  $emit: EmitFn<E>
  // dom元素
  $el: any
  // 选项
  $options: Options & MergedComponentOptionsOverride
  // 强制更新方法
  $forceUpdate: () => void
  // 下一步
  $nextTick: typeof nextTick
  // 监听器
  $watch(
    source: string | Function,
    cb: Function,
    options?: WatchOptions
  ): WatchStopHandle
} & P &
  // 浅拆包 setup 中的绑定值
  ShallowUnwrapRef<B> &
  // 拆包data中嵌套的ref
  UnwrapNestedRefs<D> &
  // 提取计算属性的返回值
  ExtractComputedReturns<C> &
  // 方法
  M &
  // 组件自定义属性
  ComponentCustomProperties

export type PublicPropertiesMap = Record<
  string,
  (i: ComponentInternalInstance) => any
>

/**
 * #2437 In Vue 3, functional components do not have a public instance proxy but
 * they exist in the internal parent chain. For code that relies on traversing
 * public $parent chains, skip functional ones and go to the parent instead.
 * 在Vue3中，函数式组件没有一个公共的实例代理
 * 但是他们存在于内部的父组件链
 * 因为代码依赖于公共父组件链，跳过函数式的组件而转到父级
 */
const getPublicInstance = (
  i: ComponentInternalInstance | null
): ComponentPublicInstance | ComponentInternalInstance['exposed'] | null => {
  // 如果组件实例不存在，直接返回空
  if (!i) return null
  // 有状态组件， 返回暴露的代理或者实例的代理
  if (isStatefulComponent(i)) return getExposeProxy(i) || i.proxy
  // 函数式组件则递归返回父类
  return getPublicInstance(i.parent)
}

// 公共属性/** @type {*} */
const publicPropertiesMap: PublicPropertiesMap =
  // Move PURE marker to new line to workaround compiler discarding it
  // due to type annotation
  /*#__PURE__*/ 

// 扩展
extend(Object.create(null), {
    /** 获取实例本身 */ 
    $: i => i,
    // 获取实例的dom元素
    $el: i => i.vnode.el,
    // data
    $data: i => i.data,
    // 属性
    $props: i => (__DEV__ ? shallowReadonly(i.props) : i.props),
    // attr
    $attrs: i => (__DEV__ ? shallowReadonly(i.attrs) : i.attrs),
    // 插槽
    $slots: i => (__DEV__ ? shallowReadonly(i.slots) : i.slots),
    // 引用
    $refs: i => (__DEV__ ? shallowReadonly(i.refs) : i.refs),
    // 父节点
    $parent: i => getPublicInstance(i.parent),
    // 根节点
    $root: i => getPublicInstance(i.root),
    // 触发
    $emit: i => i.emit,
    // 选项
    $options: i => (__FEATURE_OPTIONS_API__ ? resolveMergedOptions(i) : i.type),
    // 强制更新
    $forceUpdate: i => i.f || (i.f = () => queueJob(i.update)),
    // 下一步
    $nextTick: i => i.n || (i.n = nextTick.bind(i.proxy!)),
    // 监视器
    $watch: i => (__FEATURE_OPTIONS_API__ ? instanceWatch.bind(i) : NOOP)
  } as PublicPropertiesMap)

// 兼容性，安装兼容性实例属性
if (__COMPAT__) {
  installCompatInstanceProperties(publicPropertiesMap)
}

/**
 * 使用类型
 */
const enum AccessTypes {
  OTHER,
  SETUP,
  DATA,
  PROPS,
  CONTEXT
}

/**
 * 组件渲染上下文
 */
export interface ComponentRenderContext {
  [key: string]: any
  // 组件内部实例
  _: ComponentInternalInstance
}

export const isReservedPrefix = (key: string) => key === '_' || key === '$'

/**
 * 公共实例代理处理器
 * 先从setup里取值
 * 然后data
 * 如果没缓存则先props，后ctx，然后其他比如混合器，公共属性，css模块，全局
 * 否则先ctx，props，然后混合器，全局
 * 
 * 使用Vue-Template-Explorer编译后的render函数
 * ```js
 * export function render(_ctx, _cache, $props, $setup, $data, $options) {
 *  return (_openBlock(), _createElementBlock("template", null, [
 *    _createElementVNode("div", _hoisted_1, _toDisplayString(_ctx.msg) + " " + _toDisplayString(_ctx.propData), 1)
 * ]))
 * }
 * ```
 * 
 * 第一个参数_ctx就是我们创建的上下文代理instance.proxy
 * 
 * 尽管使用了accessCache做了缓存优化，但是仍慢于直接访问，模板中数据越多，通过代理访问和直接访问在
 * 性能上差异越明显
 * 
 * Vue SFC Playground编译后的结果
 * 
 * ```js
 * function render(_ctx, _cache, $props, $setup, $data, $options) {
 *  return (_openBlock(), _createElementBlock("div", _hoisted_1, _toDisplayString($data.msg) + " " + _toDisplayString($props.propData), 1))
 * }
 * ```
 * 
 * 和纯模板编译工具不同，SFC导出工具的编译过程不仅分析template模板部分，还结合了对script部分代码的分析
 * 直接用$data.msg替换了_ctx.msg,用$props.propData代替了_ctx.propData
 * 通过直接访问数据的方法，运行时的性能自然好过ctx代理的方式
 * 使用.vue单文件开发时就可以起到这个效果
 */
export const PublicInstanceProxyHandlers: ProxyHandler<any> = {
  /**
   * get 访问器拦截
   * 
   * get函数首先处理访问的key不以$开头的情况
   * 依次setupState、data、props、ctx中的一种
   * ctx包含Options API中的methods、computed、inject定义的数据
   * 最后为了兼容vue2可以读取一些其他数据
   *
   * 此外get函数对读取数据做了优化，因为按照上述的逻辑要经过很多判断
   * 所以使用accessCache做了缓存，你上次读数据读的是哪个这次就给你返回那个
   * 省下了一次调用hasOwn判断的逻辑
   * 
   * @param param0 
   * @param key 
   * @returns 
   */
  get({ _: instance }: ComponentRenderContext, key: string) {
    const { ctx, setupState, data, props, accessCache, type, appContext } =
      instance

    // for internal formatters to know that this is a Vue instance
    // 用于内部格式化去了解这是一个vue实例
    if (__DEV__ && key === '__isVue') {
      return true
    }

    // prioritize <script setup> bindings during dev.
    // this allows even properties that start with _ or $ to be used - so that
    // it aligns with the production behavior where the render fn is inlined and
    // indeed has access to all declared variables.
    // <script setup> 在开发者环境下按绑定优先顺序 
    // 这允许即使属性前缀使用_或者$被使它与渲染函数内联的生产行为保持一致
    // 并且可以访问到所有声明的变量
    if (
      __DEV__ &&
      setupState !== EMPTY_OBJ &&
      setupState.__isScriptSetup &&
      hasOwn(setupState, key)
    ) {
      return setupState[key]
    }

    // data / props / ctx
    // This getter gets called for every property access on the render context
    // during render and is a major hotspot. The most expensive part of this
    // is the multiple hasOwn() calls. It's much faster to do a simple property
    // access on a plain object, so we use an accessCache object (with null
    // prototype) to memoize what access type a key corresponds to.
    // 这个访问器被调用用于存取每个渲染器上下文的属性在渲染期间并且是一个主要的热区
    // 最消耗性能的部分是多个hasOwn调用
    // 做一个简单的属性存取在一个扁平化对象上是很快的
    // 所以我们使用一个缓存对象（不使用原型）用于记忆，存取key的访问类型
    let normalizedProps
    // key前缀
    if (key[0] !== '$') {
      // 存取缓存
      const n = accessCache![key]
      // 如果可以从缓存中找到（缓存过）
      if (n !== undefined) {
        switch (n) {
          case AccessTypes.SETUP:
            // 从setup中获取缓存之
            return setupState[key]
          case AccessTypes.DATA:
            // 从data中获取
            return data[key]
          case AccessTypes.CONTEXT:
            // 从上下文中获取
            return ctx[key]
          case AccessTypes.PROPS:
            // 从props中获取
            return props![key]
          // default: just fallthrough
          // 默认仅仅退回
        }
      } else if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
        // 缓存中没有  先从setup中获取，设置缓存并返回
        accessCache![key] = AccessTypes.SETUP
        // 从 setupState 中获取数据
        return setupState[key]
      } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
        accessCache![key] = AccessTypes.DATA
        // 从data中获取数据
        return data[key]
      } else if (
        // only cache other properties when instance has declared (thus stable)
        // props
        // 实例已经声明过，只缓存其他属性（因为是稳定的）
        (normalizedProps = instance.propsOptions[0]) &&
        hasOwn(normalizedProps, key)
      ) {
        accessCache![key] = AccessTypes.PROPS
        // 从props中获取数据
        return props![key]
      } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
        // 上下文
        accessCache![key] = AccessTypes.CONTEXT
        // 从ctx中获取数据
        return ctx[key]
      } else if (!__FEATURE_OPTIONS_API__ || shouldCacheAccess) {
        // 其他，兼容options api
        accessCache![key] = AccessTypes.OTHER
      }
    }

    // 下面是获取一些内部的值

    const publicGetter = publicPropertiesMap[key]
    let cssModule, globalProperties
    // public $xxx properties
    // 公共$xxx属性或者方法
    if (publicGetter) {
      if (key === '$attrs') {
        track(instance, TrackOpTypes.GET, key)
        __DEV__ && markAttrsAccessed()
      }
      return publicGetter(instance)
    } else if (
      // css module (injected by vue-loader)
      // css模块（通过vue-loader编译的时候注入）
      (cssModule = type.__cssModules) &&
      (cssModule = cssModule[key])
    ) {
      return cssModule
    } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
      // user may set custom properties to `this` that start with `$`
      // 用户可以设置自定义属性 `this` 以$为前缀
      accessCache![key] = AccessTypes.CONTEXT
      return ctx[key]
    } else if (
      // global properties
      // 全局定义的属性
      ((globalProperties = appContext.config.globalProperties),
      hasOwn(globalProperties, key))
    ) {
      if (__COMPAT__) {
        // 兼容
        const desc = Object.getOwnPropertyDescriptor(globalProperties, key)!
        // 有get访问器，返回get的访问器
        if (desc.get) {
          return desc.get.call(instance.proxy)
        } else {
          // 全局属性的值
          const val = globalProperties[key]
          // 如果是函数的返回函数执行的值，否则返回函数值
          return isFunction(val)
            ? Object.assign(val.bind(instance.proxy), val)
            : val
        }
      } else {
        // 返回属性
        return globalProperties[key]
      }
    } else if (
      __DEV__ &&
      // 当前渲染实例
      currentRenderingInstance &&
      // 不是字符串
      (!isString(key) ||
        // #1091 avoid internal isRef/isVNode checks on component instance leading
        // to infinite warning loop
        // 避免组件实例上的内部isRef/isVNode检查导致无限警告循环
        // key的前缀不为__v
        key.indexOf('__v') !== 0)
    ) {
      // 数据不是空对象且前缀是$或者_,且拥有该属性，警告
      if (data !== EMPTY_OBJ && isReservedPrefix(key[0]) && hasOwn(data, key)) {
        // 如果在data中定义的数据以$或_开头，会发出警告
        // 原因是$和_保留字符，不会做代理
        warn(
          `Property ${JSON.stringify(
            key
          )} must be accessed via $data because it starts with a reserved ` +
            `character ("$" or "_") and is not proxied on the render context.`
        )
      } else if (instance === currentRenderingInstance) {
        // 如果没有定义模板中使用的变量，则发出警告
        warn(
          `Property ${JSON.stringify(key)} was accessed during render ` +
            `but is not defined on instance.`
        )
      }
    }
  },
  /**
   * set访问拦截
   * 先setup=>data=>props=>ctx
   * 不允许设置props
   * 不允许设置前缀为$的
   * 设置仅作用于组件上下文共享
   * @param param0 
   * @param key 
   * @param value 
   * @returns 
   */
  set(
    { _: instance }: ComponentRenderContext,
    key: string,
    value: any
  ): boolean {
    const { data, setupState, ctx } = instance
    if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
      // 给setupState赋值
      setupState[key] = value
      return true
    } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
      // 给data赋值
      data[key] = value
      return true
    } else if (hasOwn(instance.props, key)) {
      // 不能直接给props赋值
      __DEV__ &&
        warn(
          `Attempting to mutate prop "${key}". Props are readonly.`,
          instance
        )
      return false
    }
    if (key[0] === '$' && key.slice(1) in instance) {
      // 不能给Vue内部以$开头的保留属性赋值
      __DEV__ &&
        warn(
          `Attempting to mutate public property "${key}". ` +
            `Properties starting with $ are reserved and readonly.`,
          instance
        )
      return false
    } else {
      if (__DEV__ && key in instance.appContext.config.globalProperties) {
        // 设置上下文属性
        Object.defineProperty(ctx, key, {
          enumerable: true,
          configurable: true,
          value
        })
      } else {
        // 给用户自定义数据赋值
        ctx[key] = value
      }
    }
    return true
  },

  /**
   * 先从缓存读
   * 顺序 缓存->data->setupState->props->ctx->公共属性Map $->全局
   * @param param0 
   * @param key 
   * @returns 
   */
  has(
    {
      _: { data, setupState, accessCache, ctx, appContext, propsOptions }
    }: ComponentRenderContext,
    key: string
  ) {
    let normalizedProps
    // 依次判断
    return (
      !!accessCache![key] ||
      (data !== EMPTY_OBJ && hasOwn(data, key)) ||
      (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) ||
      ((normalizedProps = propsOptions[0]) && hasOwn(normalizedProps, key)) ||
      hasOwn(ctx, key) ||
      hasOwn(publicPropertiesMap, key) ||
      hasOwn(appContext.config.globalProperties, key)
    )
  },

  /**
   * 定义属性
   * @param target 
   * @param key 
   * @param descriptor 
   * @returns 
   */
  defineProperty(
    target: ComponentRenderContext,
    key: string,
    descriptor: PropertyDescriptor
  ) {
    // 定义属性的访问器不为undefined或者空,存在访问器
    if (descriptor.get != null) {
      // invalidate key cache of a getter based property #5417
      // 使一个基于属性的访问器对应的缓存失效，因为0会false
      target._.accessCache![key] = 0
    } else if (hasOwn(descriptor, 'value')) { // 不是访问器，也就是有值喽，将值通过set进行设置
      // 描述中存在value值，给target设置value值
      this.set!(target, key, descriptor.value, null)
    }
    // 定义属性
    return Reflect.defineProperty(target, key, descriptor)
  }
}

// 开发者环境且不是测试用例，则提供拥有的key的拦截，进行警告
if (__DEV__ && !__TEST__) {
  PublicInstanceProxyHandlers.ownKeys = (target: ComponentRenderContext) => {
    //  避免依赖于组件实例上的枚举键的应用逻辑。
    // 在生产模式下，键将为空，以避免性能开销
    warn(
      `Avoid app logic that relies on enumerating keys on a component instance. ` +
        `The keys will be empty in production mode to avoid performance overhead.`
    )
    return Reflect.ownKeys(target)
  }
}

/**
 * 运行时编译器公共实例代理处理器
 * 
 * 对于使用with块运行时编译的渲染函数，渲染上下文的dialing是RuntimeCompiledPublicInstanceProxyHandlers
 * 它在之前渲染上下文代理PublicInstanceProxyHandlers的基础上做了扩展
 * 主要针对has函数的实现
 */
export const RuntimeCompiledPublicInstanceProxyHandlers = /*#__PURE__*/ extend(
  {},
  PublicInstanceProxyHandlers,
  {
    get(target: ComponentRenderContext, key: string) {
      // fast path for unscopables when using `with` block
      // 当使用' with '块时，unscopables的快速路径
      if ((key as any) === Symbol.unscopables) {
        return
      }
      return PublicInstanceProxyHandlers.get!(target, key, target)
    },
    // 判断是否存在key，key不可包含_前缀，且必须包含在全局白名单中
    has(_: ComponentRenderContext, key: string) {
      // 如果key以_开头或者key在全局变量白名单内，则has为false
      const has = key[0] !== '_' && !isGloballyWhitelisted(key)
      if (__DEV__ && !has && PublicInstanceProxyHandlers.has!(_, key)) {
        warn(
          `Property ${JSON.stringify(
            key
          )} should not start with _ which is a reserved prefix for Vue internals.`
        )
      }
      return has
    }
  }
)

// dev only
// In dev mode, the proxy target exposes the same properties as seen on `this`
// for easier console inspection. In prod mode it will be an empty object so
// these properties definitions can be skipped.
/**
 * 在开发模式下，这个代理对象暴露相同属性
 * 便于控制台检查
 * 在生产模式下是一个空对象，所以这些属性定义被跳过
 * @param instance 
 * @returns 
 */
export function createDevRenderContext(instance: ComponentInternalInstance) {
  const target: Record<string, any> = {}

  // expose internal instance for proxy handlers
  // 暴露内部实例用于代理处理
  Object.defineProperty(target, `_`, {
    configurable: true,
    enumerable: false,
    get: () => instance
  })

  // expose public properties
  // 暴露公共属性
  Object.keys(publicPropertiesMap).forEach(key => {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      get: () => publicPropertiesMap[key](instance),
      // intercepted by the proxy so no need for implementation,
      // but needed to prevent set errors
      // 被代理拦截，所以不需要执行，但是需要防止设置错误
      set: NOOP
    })
  })

  return target as ComponentRenderContext
}

// dev only
/**
 * 仅开发者环境
 * 用于暴露并访问实例中的属性
 * @param instance 
 */
export function exposePropsOnRenderContext(
  instance: ComponentInternalInstance
) {
  const {
    ctx,
    propsOptions: [propsOptions]
  } = instance
  if (propsOptions) {
    Object.keys(propsOptions).forEach(key => {
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        get: () => instance.props[key],
        set: NOOP
      })
    })
  }
}

// dev only
/**
 * 仅开发者环境
 * 设置setupState的访问器
 * 用于暴露setupState中的值
 * @param instance 
 */
export function exposeSetupStateOnRenderContext(
  instance: ComponentInternalInstance
) {
  // 获取实例上下文和setup状态
  const { ctx, setupState } = instance
  // 将setupState值转化为原始值，遍历
  Object.keys(toRaw(setupState)).forEach(key => {
    // 如果不是 <script setup>
    if (!setupState.__isScriptSetup) {
      // 如果 key 以 $ 或者 _ 开头警告 并且阻断运行，
      // 因为 $ 和 _ 是 vue内部使用的前缀
      if (isReservedPrefix(key[0])) {
        warn(
          `setup() return property ${JSON.stringify(
            key
          )} should not start with "$" or "_" ` +
            `which are reserved prefixes for Vue internals.`
        )
        return
      }
      // 定义属性，可以从实例的上下文中通过访问器获取，并且不能够进行设置
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        get: () => setupState[key],
        set: NOOP
      })
    }
  })
}
