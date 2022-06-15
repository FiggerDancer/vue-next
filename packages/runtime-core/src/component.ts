import { VNode, VNodeChild, isVNode } from './vnode'
import {
  pauseTracking,
  resetTracking,
  shallowReadonly,
  proxyRefs,
  EffectScope,
  markRaw,
  track,
  TrackOpTypes,
  ReactiveEffect
} from '@vue/reactivity'
import {
  ComponentPublicInstance,
  PublicInstanceProxyHandlers,
  createDevRenderContext,
  exposePropsOnRenderContext,
  exposeSetupStateOnRenderContext,
  ComponentPublicInstanceConstructor,
  publicPropertiesMap,
  RuntimeCompiledPublicInstanceProxyHandlers
} from './componentPublicInstance'
import {
  ComponentPropsOptions,
  NormalizedPropsOptions,
  initProps,
  normalizePropsOptions
} from './componentProps'
import { Slots, initSlots, InternalSlots } from './componentSlots'
import { warn } from './warning'
import { ErrorCodes, callWithErrorHandling, handleError } from './errorHandling'
import { AppContext, createAppContext, AppConfig } from './apiCreateApp'
import { Directive, validateDirectiveName } from './directives'
import {
  applyOptions,
  ComponentOptions,
  ComputedOptions,
  MethodOptions
} from './componentOptions'
import {
  EmitsOptions,
  ObjectEmitsOptions,
  EmitFn,
  emit,
  normalizeEmitsOptions
} from './componentEmits'
import {
  EMPTY_OBJ,
  isFunction,
  NOOP,
  isObject,
  NO,
  makeMap,
  isPromise,
  ShapeFlags,
  extend
} from '@vue/shared'
import { SuspenseBoundary } from './components/Suspense'
import { CompilerOptions } from '@vue/compiler-core'
import { markAttrsAccessed } from './componentRenderUtils'
import { currentRenderingInstance } from './componentRenderContext'
import { startMeasure, endMeasure } from './profiling'
import { convertLegacyRenderFn } from './compat/renderFn'
import {
  CompatConfig,
  globalCompatConfig,
  validateCompatConfig
} from './compat/compatConfig'
import { SchedulerJob } from './scheduler'

export type Data = Record<string, unknown>

/**
 * For extending allowed non-declared props on components in TSX
 * 用于扩展TSX中组件上允许的未声明的属性
 */
export interface ComponentCustomProps {}

/**
 * Default allowed non-declared props on component in TSX
 * 默认允许在TSX组件上使用未声明的属性
 */
export interface AllowedComponentProps {
  class?: unknown
  style?: unknown
}

// Note: can't mark this whole interface internal because some public interfaces.
// extend it.
// 注意:不能将整个接口标记为内部接口，因为一些公共接口扩展了它。
export interface ComponentInternalOptions {
  /**
   * @internal
   */
  __scopeId?: string
  /**
   * @internal
   */
  __cssModules?: Data
  /**
   * @internal
   */
  __hmrId?: string
  /**
   * Compat build only, for bailing out of certain compatibility behavior
   * 仅Compat构建，以脱离某些兼容性行为
   */
  __isBuiltIn?: boolean
  /**
   * This one should be exposed so that devtools can make use of it
   * 这个应该被公开，这样devtools就可以利用它
   */
  __file?: string
}

// 组件函数
export interface FunctionalComponent<P = {}, E extends EmitsOptions = {}>
  extends ComponentInternalOptions {
  // use of any here is intentional so it can be a valid JSX Element constructor
  // 有意使用any，这样它就可以成为有效的JSX Element构造函数
  (props: P, ctx: Omit<SetupContext<E>, 'expose'>): any
  props?: ComponentPropsOptions<P>
  emits?: E | (keyof E)[]
  inheritAttrs?: boolean
  displayName?: string
  compatConfig?: CompatConfig
}

/**
 * 组件
 * 组件的构造函数
 * _vccOpts 组件选项
 */
export interface ClassComponent {
  new (...args: any[]): ComponentPublicInstance<any, any, any, any, any>
  __vccOpts: ComponentOptions
}

/**
 * Concrete component type matches its actual value: it's either an options
 * object, or a function. Use this where the code expects to work with actual
 * values, e.g. checking if its a function or not. This is mostly for internal
 * implementation code.
 * 具体的组件类型与其实际值相匹配:它可以是一个选项对象或者一个函数。
 * 在代码需要处理实际值的地方使用它，例如检查它是否是一个函数。
 * 这主要用于内部实现代码。
 */
export type ConcreteComponent<
  Props = {},
  RawBindings = any,
  D = any,
  C extends ComputedOptions = ComputedOptions,
  M extends MethodOptions = MethodOptions
> =
  | ComponentOptions<Props, RawBindings, D, C, M>
  | FunctionalComponent<Props, any>

/**
 * A type used in public APIs where a component type is expected.
 * The constructor type is an artificial type returned by defineComponent().
 * 在公共api中使用的一种类型，其中需要组件类型。
 * 构造函数类型是由defineComponent()返回的人工类型。
 */
export type Component<
  Props = any,
  RawBindings = any,
  D = any,
  C extends ComputedOptions = ComputedOptions,
  M extends MethodOptions = MethodOptions
> =
  | ConcreteComponent<Props, RawBindings, D, C, M>
  | ComponentPublicInstanceConstructor<Props>

export { ComponentOptions }

// 生命周期钩子
type LifecycleHook<TFn = Function> = TFn[] | null

// 枚举生命周期钩子类型
export const enum LifecycleHooks {
  BEFORE_CREATE = 'bc', // 创建前
  CREATED = 'c', // 创建后
  BEFORE_MOUNT = 'bm', // 挂载
  MOUNTED = 'm',
  BEFORE_UPDATE = 'bu', // 更新
  UPDATED = 'u',
  BEFORE_UNMOUNT = 'bum', // 卸载
  UNMOUNTED = 'um',
  DEACTIVATED = 'da', // 失效
  ACTIVATED = 'a', // 激活
  RENDER_TRIGGERED = 'rtg', // 渲染触发
  RENDER_TRACKED = 'rtc', // 渲染跟踪
  ERROR_CAPTURED = 'ec', // 错误捕获
  SERVER_PREFETCH = 'sp' // 服务器预载
}

// setup上下文
export interface SetupContext<E = EmitsOptions> {
  attrs: Data // 属性
  slots: Slots // 插槽
  emit: EmitFn<E> // emit函数
  expose: (exposed?: Record<string, any>) => void // 组件向外部暴露内部变量或函数的方法
}

/**
 * @internal
 */
export type InternalRenderFunction = {
  (
    ctx: ComponentPublicInstance,
    cache: ComponentInternalInstance['renderCache'],
    // for compiler-optimized bindings
    // compiler-optimized绑定
    $props: ComponentInternalInstance['props'],
    $setup: ComponentInternalInstance['setupState'],
    $data: ComponentInternalInstance['data'],
    $options: ComponentInternalInstance['ctx']
  ): VNodeChild
  _rc?: boolean // isRuntimeCompiled 运行时编译

  // __COMPAT__ only
  _compatChecked?: boolean // v3 and already checked for v2 compat
  _compatWrapped?: boolean // is wrapped for v2 compat
}

/**
 * We expose a subset of properties on the internal instance as they are
 * useful for advanced external libraries and tools.
 * 我们在内部实例上公开属性子集，因为它们对高级外部库和工具有用。
 */
export interface ComponentInternalInstance {
  uid: number
  type: ConcreteComponent
  parent: ComponentInternalInstance | null
  root: ComponentInternalInstance
  appContext: AppContext
  /**
   * Vnode representing this component in its parent's vdom tree
   * 在父组件的vdom树中表示该组件的Vnode
   */
  vnode: VNode
  /**
   * The pending new vnode from parent updates
   * 来自父更新的挂起的新vnode
   * @internal
   */
  next: VNode | null
  /**
   * Root vnode of this component's own vdom tree
   * 该组件自己的vdom树的根vnode
   */
  subTree: VNode
  /**
   * Render effect instance
   * 渲染效果实例
   */
  effect: ReactiveEffect
  /**
   * Bound effect runner to be passed to schedulers
   * 绑定效应运行器被传递给调度程序
   */
  update: SchedulerJob
  /**
   * The render function that returns vdom tree.
   * 返回vdom树的渲染函数。
   * @internal
   */
  render: InternalRenderFunction | null
  /**
   * SSR render function
   * SSR渲染函数
   * @internal
   */
  ssrRender?: Function | null
  /**
   * Object containing values this component provides for its descendents
   * 对象，该对象包含此组件为其后代提供的值
   * @internal
   */
  provides: Data
  /**
   * Tracking reactive effects (e.g. watchers) associated with this component
   * so that they can be automatically stopped on component unmount
   * 跟踪与此组件相关的反应效果(例如监视器)，以便在组件卸载时自动停止它们
   * @internal
   */
  scope: EffectScope
  /**
   * cache for proxy access type to avoid hasOwnProperty calls
   * 缓存代理访问类型，以避免hasOwnProperty调用
   * @internal
   */
  accessCache: Data | null
  /**
   * cache for render function values that rely on _ctx but won't need updates
   * after initialized (e.g. inline handlers)
   * 缓存渲染函数值依赖于_ctx，但在初始化后不需要更新(例如内联处理程序)
   * @internal
   */
  renderCache: (Function | VNode)[]

  /**
   * Resolved component registry, only for components with mixins or extends
   * 解析组件注册表，仅适用于带有mixin或extends的组件
   * @internal
   */
  components: Record<string, ConcreteComponent> | null
  /**
   * Resolved directive registry, only for components with mixins or extends
   * 解析指令注册表，仅适用于带有mixin或extends的组件
   * @internal
   */
  directives: Record<string, Directive> | null
  /**
   * Resolved filters registry, v2 compat only
   * 解析过滤器注册表，仅v2 compat
   * @internal
   */
  filters?: Record<string, Function>
  /**
   * resolved props options
   * 解决道具选项
   * @internal
   */
  propsOptions: NormalizedPropsOptions
  /**
   * resolved emits options
   * 解决排放选项
   * @internal
   */
  emitsOptions: ObjectEmitsOptions | null
  /**
   * resolved inheritAttrs options
   * 解决inheritAttrs选项
   * @internal
   */
  inheritAttrs?: boolean
  /**
   * is custom element?
   * 是不是自定义的元素（web组件）
   */
  isCE?: boolean
  /**
   * custom element specific HMR method
   * 自定义元素特定的HMR方法
   */
  ceReload?: (newStyles?: string[]) => void

  // the rest are only for stateful components ---------------------------------

  // 其余的仅用于有状态组件 用作公共实例的主代理(“this”)

  // main proxy that serves as the public instance (`this`)
  // 
  proxy: ComponentPublicInstance | null

  // exposed properties via expose()
  // 通过expose()暴露属性
  exposed: Record<string, any> | null
  exposeProxy: Record<string, any> | null

  /**
   * alternative proxy used only for runtime-compiled render functions using 
   * `with` block
   * 仅用于使用' with '块的运行时编译的呈现函数的替代代理
   * @internal
   */
  withProxy: ComponentPublicInstance | null
  /**
   * This is the target for the public instance proxy. It also holds properties
   * injected by user options (computed, methods etc.) and user-attached
   * custom properties (via `this.x = ...`)
   * 这是公共实例代理的目标。
   * 它还保存由用户选项(计算、方法等)注入的属性和用户附加的自定义属性(通过' this.x =…”)
   * @internal
   */
  ctx: Data

  // state
  // 状态
  data: Data
  props: Data
  attrs: Data
  slots: InternalSlots
  refs: Data
  emit: EmitFn
  /**
   * used for keeping track of .once event handlers on components
   * 用于跟踪组件上的.once事件处理程序
   * @internal
   */
  emitted: Record<string, boolean> | null
  /**
   * used for caching the value returned from props default factory functions to
   * avoid unnecessary watcher trigger
   * 用于缓存从props默认工厂函数返回的值，
   * 以避免不必要的监视器触发器
   * @internal
   */
  propsDefaults: Data
  /**
   * setup related
   * 相关的设置
   * @internal
   */
  setupState: Data
  /**
   * devtools access to additional info
   * Devtools访问附加信息
   * @internal
   */
  devtoolsRawSetupState?: any
  /**
   * @internal
   */
  setupContext: SetupContext | null

  /**
   * suspense related
   * 相关的suspense组件
   * @internal
   */
  suspense: SuspenseBoundary | null
  /**
   * suspense pending batch id
   * suspense 等待批id
   * @internal
   */
  suspenseId: number
  /**
   * @internal
   */
  asyncDep: Promise<any> | null
  /**
   * @internal
   */
  asyncResolved: boolean

  // lifecycle
  // 声明周期
  isMounted: boolean
  isUnmounted: boolean
  isDeactivated: boolean
  /**
   * @internal
   */
  [LifecycleHooks.BEFORE_CREATE]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.CREATED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.BEFORE_MOUNT]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.MOUNTED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.BEFORE_UPDATE]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.UPDATED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.BEFORE_UNMOUNT]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.UNMOUNTED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.RENDER_TRACKED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.RENDER_TRIGGERED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.ACTIVATED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.DEACTIVATED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.ERROR_CAPTURED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.SERVER_PREFETCH]: LifecycleHook<() => Promise<unknown>>
}

// 空上下文件节点
const emptyAppContext = createAppContext()

// 组件实例唯一id
let uid = 0

/**
 * 创建组件实例
 * @param vnode 
 * @param parent 
 * @param suspense 
 * @returns 
 */
export function createComponentInstance(
  vnode: VNode,
  parent: ComponentInternalInstance | null,
  suspense: SuspenseBoundary | null
) {
  const type = vnode.type as ConcreteComponent
  // inherit parent app context - or - if root, adopt from root vnode
  // 继承父应用上下文-或-如果根，从根vnode采用
  const appContext =
    (parent ? parent.appContext : vnode.appContext) || emptyAppContext

  const instance: ComponentInternalInstance = {
    uid: uid++,
    vnode,
    type,
    parent,
    appContext,
    root: null!, // to be immediately set // 被立刻设置
    next: null,
    subTree: null!, // will be set synchronously right after creation // 会在创建后同步设置
    effect: null!,
    update: null!, // will be set synchronously right after creation // 会在创建后同步设置
    scope: new EffectScope(true /* detached */), // 分离的副作用
    render: null,
    proxy: null,
    exposed: null,
    exposeProxy: null,
    withProxy: null,
    provides: parent ? parent.provides : Object.create(appContext.provides),
    accessCache: null!,
    renderCache: [],

    // local resovled assets
    // 当地急需解决的资源
    components: null,
    directives: null,

    // resolved props and emits options
    // 解决props和emits选项
    propsOptions: normalizePropsOptions(type, appContext),
    emitsOptions: normalizeEmitsOptions(type, appContext),

    // emit
    emit: null!, // to be set immediately
    emitted: null,

    // props default value
    // 默认值
    propsDefaults: EMPTY_OBJ,

    // inheritAttrs
    // 继承的属性
    inheritAttrs: type.inheritAttrs,

    // state
    // 状态相关
    ctx: EMPTY_OBJ,
    data: EMPTY_OBJ,
    props: EMPTY_OBJ,
    attrs: EMPTY_OBJ,
    slots: EMPTY_OBJ,
    refs: EMPTY_OBJ,
    setupState: EMPTY_OBJ,
    setupContext: null,

    // suspense related
    // 相关suspense
    suspense,
    suspenseId: suspense ? suspense.pendingId : 0,
    asyncDep: null,
    asyncResolved: false,

    // lifecycle hooks
    // not using enums here because it results in computed properties
    // 这里不使用枚举，因为这会导致计算属性
    isMounted: false,
    isUnmounted: false,
    isDeactivated: false,
    bc: null,
    c: null,
    bm: null,
    m: null,
    bu: null,
    u: null,
    um: null,
    bum: null,
    da: null,
    a: null,
    rtg: null,
    rtc: null,
    ec: null,
    sp: null
  }
  if (__DEV__) {
    // 开发环境：创建开发环境渲染上下文
    instance.ctx = createDevRenderContext(instance)
  } else {
    instance.ctx = { _: instance }
  }
  // 如果有父节点，则去找父节点的根节点，否则自己本身就是根节点了
  instance.root = parent ? parent.root : instance
  // 触发事件
  instance.emit = emit.bind(null, instance)

  // apply custom element special handling
  // 应用web组件特殊处理
  if (vnode.ce) {
    vnode.ce(instance)
  }

  return instance
}

// 当前实例
export let currentInstance: ComponentInternalInstance | null = null

// 获取当前实例
export const getCurrentInstance: () => ComponentInternalInstance | null = () =>
  currentInstance || currentRenderingInstance

// 设置当前实例，作用域
export const setCurrentInstance = (instance: ComponentInternalInstance) => {
  currentInstance = instance
  instance.scope.on()
}

// 清空当前实例
export const unsetCurrentInstance = () => {
  currentInstance && currentInstance.scope.off()
  currentInstance = null
}

// 内置标签 动态组件、插槽
const isBuiltInTag = /*#__PURE__*/ makeMap('slot,component')

// 校验组件名称
export function validateComponentName(name: string, config: AppConfig) {
  // 原生标签
  const appIsNativeTag = config.isNativeTag || NO
  // 内置标签活原生标签警告提示
  if (isBuiltInTag(name) || appIsNativeTag(name)) {
    warn(
      'Do not use built-in or reserved HTML elements as component id: ' + name
    )
  }
}

// 判断是否是有状态组件
export function isStatefulComponent(instance: ComponentInternalInstance) {
  return instance.vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT
}

// 是否是正处于SSR组件安装
export let isInSSRComponentSetup = false

// 安装组件
export function setupComponent(
  instance: ComponentInternalInstance,
  isSSR = false
) {
  isInSSRComponentSetup = isSSR

  // 获取实例的孩子节点和属性
  const { props, children } = instance.vnode
  const isStateful = isStatefulComponent(instance)
  // 组件的初始化其实就是子节点和属性的初始化
  initProps(instance, props, isStateful, isSSR)
  initSlots(instance, children)

  // 判断组件是哦福是stateful，然后做相应处理
  const setupResult = isStateful
    ? setupStatefulComponent(instance, isSSR)
    : undefined
  isInSSRComponentSetup = false
  return setupResult
}

// 安装有状态组件
function setupStatefulComponent(
  instance: ComponentInternalInstance,
  isSSR: boolean
) {
  // 获取组件
  const Component = instance.type as ComponentOptions

  if (__DEV__) {
    // 存在组件名称，对组件名称进行校验
    if (Component.name) {
      validateComponentName(Component.name, instance.appContext.config)
    }
    // 对组件中包含的组件名称进行校验
    if (Component.components) {
      const names = Object.keys(Component.components)
      for (let i = 0; i < names.length; i++) {
        validateComponentName(names[i], instance.appContext.config)
      }
    }
    // 对指令名称进行校验
    if (Component.directives) {
      const names = Object.keys(Component.directives)
      for (let i = 0; i < names.length; i++) {
        validateDirectiveName(names[i])
      }
    }
    // 组件编译项和正在运行时
    if (Component.compilerOptions && isRuntimeOnly()) {
      warn(
        `"compilerOptions" is only supported when using a build of Vue that ` +
          `includes the runtime compiler. Since you are using a runtime-only ` +
          `build, the options should be passed via your build tool config instead.`
      )
    }
  }
  // 0. create render proxy property access cache
  // 0. 创建呈现代理属性访问缓存
  instance.accessCache = Object.create(null)
  // 1. create public instance / render proxy
  // also mark it raw so it's never observed
  // 创建公共实例/渲染代理也将其标记为原始，所以它永远不会被观察到
  // 对组件的context上下文做代理
  instance.proxy = markRaw(new Proxy(instance.ctx, PublicInstanceProxyHandlers))
  if (__DEV__) {
    // 暴露属性在渲染器上下文
    exposePropsOnRenderContext(instance)
  }
  // 2. call setup()
  // 调用setup
  const { setup } = Component
  // 有setup的话
  if (setup) {
    // 获取setup上下文this
    const setupContext = (instance.setupContext =
      setup.length > 1 ? createSetupContext(instance) : null)

    // 设置当前实例
    setCurrentInstance(instance)
    pauseTracking()
    // 调用setup并获取setup返回值，并且带有报错处理
    const setupResult = callWithErrorHandling(
      setup,
      instance,
      ErrorCodes.SETUP_FUNCTION,
      [__DEV__ ? shallowReadonly(instance.props) : instance.props, setupContext]
    )
    resetTracking()
    // 删除当前实例
    unsetCurrentInstance()

    // 调用setup返回的是一个promise
    if (isPromise(setupResult)) {
      setupResult.then(unsetCurrentInstance, unsetCurrentInstance)

      if (isSSR) {
        // return the promise so server-renderer can wait on it
        // 返回promise，以便服务器渲染器可以等待它
        return setupResult
          .then((resolvedResult: unknown) => {
            // 处理setupResult的结果resolvedResult
            handleSetupResult(instance, resolvedResult, isSSR)
          })
          .catch(e => {
            handleError(e, instance, ErrorCodes.SETUP_FUNCTION)
          })
      } else if (__FEATURE_SUSPENSE__) {
        // async setup returned Promise.
        // bail here and wait for re-entry.
        // 如果支持suspense组件，异步的setup
        // async setup返回Promise。
        // 在这里保释，等待再次进入。
        instance.asyncDep = setupResult
      } else if (__DEV__) { // 开发者环境，如果不支持异步setup
        warn(
          `setup() returned a Promise, but the version of Vue you are using ` +
            `does not support it yet.`
        )
      }
    } else {
      // 如果setup返回的不是promise，则直接处理返回的结果可
      handleSetupResult(instance, setupResult, isSSR)
    }
  } else {
    // 结束组件的安装
    finishComponentSetup(instance, isSSR)
  }
}

/**
 * 处理setup的返回结果 setup() {return {}}
 * @param instance 
 * @param setupResult 
 * @param isSSR 
 */
export function handleSetupResult(
  instance: ComponentInternalInstance,
  setupResult: unknown,
  isSSR: boolean
) {
  // setup返回值是函数
  if (isFunction(setupResult)) {
    // setup returned an inline render function
    // 安装程序返回一个内联渲染函数
    if (__SSR__ && (instance.type as ComponentOptions).__ssrInlineRender) {
      // when the function's name is `ssrRender` (compiled by SFC inline mode), 
      // set it as ssrRender instead.
      // 当函数名是' ssrRender '(由SFC内联模式编译)时，
      // 将其设置为ssrRender。
      instance.ssrRender = setupResult
    } else {
      // 覆盖示例的渲染函数
      instance.render = setupResult as InternalRenderFunction
    }
  } else if (isObject(setupResult)) {
    // setup返回值是对象
    if (__DEV__ && isVNode(setupResult)) {
      // 如果是开发这环境，且setupResult是虚拟节点，警告
      warn(
        `setup() should not return VNodes directly - ` +
          `return a render function instead.`
      )
    }
    // setup returned bindings.
    // assuming a render function compiled from template is present.
    // setup返回bindings值，假设存在从模板编译的呈现函数。
    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      // 开发者工具原始的setup状态赋值
      instance.devtoolsRawSetupState = setupResult
    }
    // setup状态对setupResult进行代理设置
    instance.setupState = proxyRefs(setupResult)
    if (__DEV__) {
      // 暴露setup状态在渲染器上下文上
      exposeSetupStateOnRenderContext(instance)
    }
  } else if (__DEV__ && setupResult !== undefined) {
    // 如果开发环境下存在setupResult不等于undefined，
    // 加上之前也判断了不是函数或者对象，
    // 警告，setup应该返回一个object
    warn(
      `setup() should return an object. Received: ${
        setupResult === null ? 'null' : typeof setupResult
      }`
    )
  }
  // 结束组件setup
  finishComponentSetup(instance, isSSR)
}

// 编译函数
type CompileFunction = (
  template: string | object,
  options?: CompilerOptions
) => InternalRenderFunction

let compile: CompileFunction | undefined
let installWithProxy: (i: ComponentInternalInstance) => void

/**
 * For runtime-dom to register the compiler.
 * Note the exported method uses any to avoid d.ts relying on the compiler types.
 * 用于runtime-dom注册编译器。
 * 注意，导出的方法使用any来避免d.ts依赖于编译器类型。
 */
export function registerRuntimeCompiler(_compile: any) {
  compile = _compile
  installWithProxy = i => {
    if (i.render!._rc) {
      i.withProxy = new Proxy(i.ctx, RuntimeCompiledPublicInstanceProxyHandlers)
    }
  }
}

// dev only
// 判断是不是仅包含运行时
export const isRuntimeOnly = () => !compile

// 结束组件的setup
export function finishComponentSetup(
  instance: ComponentInternalInstance,
  isSSR: boolean,
  skipOptions?: boolean
) {
  // 组件
  const Component = instance.type as ComponentOptions

  // 兼容模式
  if (__COMPAT__) {
    // 传递渲染函数 
    convertLegacyRenderFn(instance)

    if (__DEV__ && Component.compatConfig) {
      // 检验兼容性配置
      validateCompatConfig(Component.compatConfig)
    }
  }

  // template / render function normalization
  // could be already set when returned from setup()
  // 如果当前组件没有render，给它生成一个渲染函数
  if (!instance.render) {
    // only do on-the-fly compile if not in SSR - SSR on-the-fly compilation
    // is done by server-renderer
    // 只在不是ssr的情况下做动态编译——SSR的动态编译是由服务器渲染器完成的
    if (!isSSR && compile && !Component.render) {
      // 模板
      const template =
        (__COMPAT__ &&
          instance.vnode.props &&
          instance.vnode.props['inline-template']) ||
        Component.template
      // 可以获取到模板
      if (template) {
        // 开发者模式
        if (__DEV__) {
          startMeasure(instance, `compile`)
        }
        // 从app上下文配置中获取到编译选项和是否是web组件
        const { isCustomElement, compilerOptions } = instance.appContext.config
        // 获取组件的分隔符和组件的编译选项
        const { delimiters, compilerOptions: componentCompilerOptions } =
          Component
        // 混合生成最终的编译选项
        const finalCompilerOptions: CompilerOptions = extend(
          extend(
            {
              isCustomElement,
              delimiters
            },
            compilerOptions
          ),
          componentCompilerOptions
        )
        // 兼容模式
        if (__COMPAT__) {
          // pass runtime compat config into the compiler
          // 将运行时compat配置传递给编译器
          finalCompilerOptions.compatConfig = Object.create(globalCompatConfig)
          if (Component.compatConfig) {
            extend(finalCompilerOptions.compatConfig, Component.compatConfig)
          }
        }
        // 组件的渲染函数就是编译出来的代码
        Component.render = compile(template, finalCompilerOptions)
        // 结束编译
        if (__DEV__) {
          endMeasure(instance, `compile`)
        }
      }
    }

    // 实例的渲染函数就等于组件的渲染函数
    instance.render = (Component.render || NOOP) as InternalRenderFunction

    // for runtime-compiled render functions using `with` blocks, the render
    // proxy used needs a different `has` handler which is more performant and
    // also only allows a whitelist of globals to fallthrough.
    // 对于使用' with '块的运行时编译的渲染函数，
    // 使用的渲染代理需要一个不同的' has '处理程序，这会拥有更好的性能，
    // 也只允许一个白名单的全局失败。
    if (installWithProxy) {
      installWithProxy(instance)
    }
  }

  // support for 2.x options
  // 通过单独解析options选项兼容之前的版本
  if (__FEATURE_OPTIONS_API__ && !(__COMPAT__ && skipOptions)) {
    setCurrentInstance(instance)
    pauseTracking()
    applyOptions(instance)
    resetTracking()
    unsetCurrentInstance()
  }

  // warn missing template/render
  // the runtime compilation of template in SSR is done by server-render
  // 警告失踪的渲染模板或者渲染器
  // 在SSR中，模板的运行时编译是通过服务器渲染完成的
  if (__DEV__ && !Component.render && instance.render === NOOP && !isSSR) {
    /* istanbul ignore if */
    if (!compile && Component.template) {
      warn(
        `Component provided template option but ` +
          `runtime compilation is not supported in this build of Vue.` +
          (__ESM_BUNDLER__
            ? ` Configure your bundler to alias "vue" to "vue/dist/vue.esm-bundler.js".`
            : __ESM_BROWSER__
            ? ` Use "vue.esm-browser.js" instead.`
            : __GLOBAL__
            ? ` Use "vue.global.js" instead.`
            : ``) /* should not happen */
      )
    } else {
      warn(`Component is missing template or render function.`)
    }
  }
}

// 创建组件attrs代理                                            
function createAttrsProxy(instance: ComponentInternalInstance): Data {
  return new Proxy(
    instance.attrs,
    __DEV__
      ? {
          get(target, key: string) {
            // 标记attr被使用了
            markAttrsAccessed()
            // 跟踪
            track(instance, TrackOpTypes.GET, '$attrs')
            return target[key]
          },
          set() {
            // 警告， setup上下文attr是只读的
            warn(`setupContext.attrs is readonly.`)
            return false
          },
          deleteProperty() {
            // 警告， setup上下文attr是只读的
            warn(`setupContext.attrs is readonly.`)
            return false
          }
        }
      : {
          get(target, key: string) {
            // 跟踪
            track(instance, TrackOpTypes.GET, '$attrs')
            return target[key]
          }
        }
  )
}

// 创建setup上下文
export function createSetupContext(
  instance: ComponentInternalInstance
): SetupContext {
  // 获取setup上下文中的expose
  const expose: SetupContext['expose'] = exposed => {
    if (__DEV__ && instance.exposed) {
      // edxpose 仅应该在setup时调用一次
      warn(`expose() should be called only once per setup().`)
    }
    instance.exposed = exposed || {}
  }

  let attrs: Data
  // 开发者环境
  if (__DEV__) {
    // We use getters in dev in case libs like test-utils overwrite instance
    // properties (overwrites should not be done in prod)
    // 我们在dev的case库中使用getter，
    // 比如test-utils覆盖实例属性(覆盖不应该在prod中完成)
    return Object.freeze({
      get attrs() {
        return attrs || (attrs = createAttrsProxy(instance))
      },
      get slots() {
        return shallowReadonly(instance.slots)
      },
      get emit() {
        return (event: string, ...args: any[]) => instance.emit(event, ...args)
      },
      expose
    })
  } else {
    // 在生产环境中
    return {
      get attrs() {
        return attrs || (attrs = createAttrsProxy(instance))
      },
      slots: instance.slots,
      emit: instance.emit,
      expose
    }
  }
}

// 获取暴露的值的代理
export function getExposeProxy(instance: ComponentInternalInstance) {
  if (instance.exposed) {
    // 实例存在暴露，返回暴露的代理
    return (
      instance.exposeProxy ||
      (instance.exposeProxy = new Proxy(proxyRefs(markRaw(instance.exposed)), {
        get(target, key: string) {
          if (key in target) {
            // 如果target中存在key，则直接获取
            return target[key]
          } else if (key in publicPropertiesMap) {
            // 否则公共属性映射表中存在key，从公共属性映射表里获取
            return publicPropertiesMap[key](instance)
          }
        }
      }))
    )
  }
}

const classifyRE = /(?:^|[-_])(\w)/g
// 驼峰化组件名称
const classify = (str: string): string =>
  str.replace(classifyRE, c => c.toUpperCase()).replace(/[-_]/g, '')

/**
 * 获取组件名称
 * @param Component 
 * @returns 
 */
export function getComponentName(
  Component: ConcreteComponent
): string | undefined {
  return isFunction(Component)
    ? Component.displayName || Component.name
    : Component.name
}

/* istanbul ignore next */
/**
 * 格式化组件名称
 * @param instance 
 * @param Component 
 * @param isRoot 
 * @returns 
 */
export function formatComponentName(
  instance: ComponentInternalInstance | null,
  Component: ConcreteComponent,
  isRoot = false
): string {
  let name = getComponentName(Component) // 获取组件名称
  if (!name && Component.__file) { // 如果组件无名称，且组件是个sfc文件，则使用文件名称去获取组件名称
    const match = Component.__file.match(/([^/\\]+)\.\w+$/)
    if (match) {
      name = match[1]
    }
  }

  // 还是没有名称，但有父组件
  if (!name && instance && instance.parent) {
    // try to infer the name based on reverse resolution
    // 尝试推断名字基于保留的结果反转
    const inferFromRegistry = (registry: Record<string, any> | undefined) => {
      for (const key in registry) {
        if (registry[key] === Component) { // 遍历所有注册的组件，有相同的返回key
          return key
        }
      }
    }
    // 从父组件中注册的组件中找名称，从app里找名称找名称
    name =
      inferFromRegistry(
        instance.components ||
          (instance.parent.type as ComponentOptions).components
      ) || inferFromRegistry(instance.appContext.components)
  }
  // 格式化名称，如果还是没找到名称，是根节点则是App，否则Anonymous （匿名组件）
  return name ? classify(name) : isRoot ? `App` : `Anonymous`
}

// 是Class组件
export function isClassComponent(value: unknown): value is ClassComponent {
  // value是Function且value中存在__vccOpts属性就是Class组件
  return isFunction(value) && '__vccOpts' in value
}
