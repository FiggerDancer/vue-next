import {
  ConcreteComponent,
  Data,
  validateComponentName,
  Component,
  ComponentInternalInstance,
  getExposeProxy
} from './component'
import {
  ComponentOptions,
  MergedComponentOptions,
  RuntimeCompilerOptions
} from './componentOptions'
import { ComponentPublicInstance } from './componentPublicInstance'
import { Directive, validateDirectiveName } from './directives'
import { RootRenderFunction } from './renderer'
import { InjectionKey } from './apiInject'
import { warn } from './warning'
import { createVNode, cloneVNode, VNode } from './vnode'
import { RootHydrateFunction } from './hydration'
import { devtoolsInitApp, devtoolsUnmountApp } from './devtools'
import { isFunction, NO, isObject } from '@vue/shared'
import { version } from '.'
import { installAppCompatProperties } from './compat/global'
import { NormalizedPropsOptions } from './componentProps'
import { ObjectEmitsOptions } from './componentEmits'

export interface App<HostElement = any> {
  version: string
  config: AppConfig
  use(plugin: Plugin, ...options: any[]): this
  mixin(mixin: ComponentOptions): this
  component(name: string): Component | undefined
  component(name: string, component: Component): this
  directive(name: string): Directive | undefined
  directive(name: string, directive: Directive): this
  mount(
    rootContainer: HostElement | string,
    isHydrate?: boolean,
    isSVG?: boolean
  ): ComponentPublicInstance
  unmount(): void
  provide<T>(key: InjectionKey<T> | string, value: T): this

  // internal, but we need to expose these for the server-renderer and devtools
  // 内部属性，但我们需要为服务器渲染器和开发者工具暴露这些属性
  _uid: number
  _component: ConcreteComponent
  _props: Data | null
  _container: HostElement | null
  _context: AppContext
  _instance: ComponentInternalInstance | null

  /**
   * v2 compat only
   * 兼容vue2
   */
  filter?(name: string): Function | undefined
  filter?(name: string, filter: Function): this

  /**
   * @internal v3 compat only
   * 兼容vue3
   */
  _createRoot?(options: ComponentOptions): ComponentPublicInstance
}

/**
 * 选项合并
 */
export type OptionMergeFunction = (to: unknown, from: unknown) => any

export interface AppConfig {
  // @private
  // 是不是原生标签
  readonly isNativeTag?: (tag: string) => boolean

  performance: boolean
  optionMergeStrategies: Record<string, OptionMergeFunction>
  globalProperties: Record<string, any>
  errorHandler?: (
    err: unknown,
    instance: ComponentPublicInstance | null,
    info: string
  ) => void
  warnHandler?: (
    msg: string,
    instance: ComponentPublicInstance | null,
    trace: string
  ) => void

  /**
   * Options to pass to `@vue/compiler-dom`.
   * Only supported in runtime compiler build.
   * 选项通过 vue 编译器
   * 仅仅运行时构建支持
   */
  compilerOptions: RuntimeCompilerOptions

  /**
   * @deprecated use config.compilerOptions.isCustomElement
   * 废弃，使用编译器选项中的自定义元素
   */
  isCustomElement?: (tag: string) => boolean

  /**
   * Temporary config for opt-in to unwrap injected refs.
   * TODO deprecate in 3.3
   * 用于opt-in打开注入引用的临时配置。
   * 3.3将废弃
   */
  unwrapInjectedRef?: boolean
}

export interface AppContext {
  app: App // for devtools 用于开发者工具
  config: AppConfig
  mixins: ComponentOptions[]
  components: Record<string, Component>
  directives: Record<string, Directive>
  provides: Record<string | symbol, any>

  /**
   * Cache for merged/normalized component options
   * Each app instance has its own cache because app-level global mixins and
   * optionMergeStrategies can affect merge behavior.
   * 缓存合并或者序列化组件选项
   * 每个app实例有它自己的缓存
   * 因为app级别的全局混合器和合并策略可能影响合并表现
   * @internal
   */
  optionsCache: WeakMap<ComponentOptions, MergedComponentOptions>
  /**
   * Cache for normalized props options
   * 缓存序列化的属性选项
   * @internal
   */
  propsCache: WeakMap<ConcreteComponent, NormalizedPropsOptions>
  /**
   * Cache for normalized emits options
   * 缓存序列化emits选项
   * @internal
   */
  emitsCache: WeakMap<ConcreteComponent, ObjectEmitsOptions | null>
  /**
   * HMR only
   * 仅用于热更新
   * @internal
   */
  reload?: () => void
  /**
   * v2 compat only
   * 兼容vue2
   * @internal
   */
  filters?: Record<string, Function>
}

/**
 * 插件安装函数
 */
type PluginInstallFunction = (app: App, ...options: any[]) => any

/**
 * 插件
 */
export type Plugin =
  | (PluginInstallFunction & { install?: PluginInstallFunction })
  | {
      install: PluginInstallFunction
    }

/**
 * 创建app上下文
 * @returns 
 */
export function createAppContext(): AppContext {
  return {
    app: null as any,
    config: {
      isNativeTag: NO,
      performance: false,
      globalProperties: {},
      optionMergeStrategies: {},
      errorHandler: undefined,
      warnHandler: undefined,
      compilerOptions: {}
    },
    mixins: [],
    components: {},
    directives: {},
    provides: Object.create(null),
    optionsCache: new WeakMap(),
    propsCache: new WeakMap(),
    emitsCache: new WeakMap()
  }
}

/**
 * 创建APP
 */
export type CreateAppFunction<HostElement> = (
  rootComponent: Component,
  rootProps?: Data | null
) => App<HostElement>

// uid
let uid = 0

/**
 * 获取实例创建函数createApp
 * 
 * Vue.js利用闭包和函数柯里化的技巧，很好地实现了参数保留。
 * 在执行app.mount时，不需要传入核心渲染函数render、根组件对象和根props
 * 因为执行createAppAPI时，render参数已经被保留下来了
 * 执行createApp时，rootComponent和rootProps两个参数也被保留下来了
 * @param render 
 * @param hydrate 
 * @returns 
  */
export function createAppAPI<HostElement>(
  render: RootRenderFunction,
  hydrate?: RootHydrateFunction
): CreateAppFunction<HostElement> {
  // rootComponent就是用户传入的根组件
  /** createApp函数接收两个参数：根组件的对象和根props */
  return function createApp(rootComponent, rootProps = null) {
    // 根节点属性不为undefined或者0  且  rootProps 不是对象，则警告
    if (rootProps != null && !isObject(rootProps)) {
      __DEV__ && warn(`root props passed to app.mount() must be an object.`)
      rootProps = null
    }

    // 创建APP上下文
    const context = createAppContext()
    // 安装插件set
    const installedPlugins = new Set()

    // 挂载标记
    let isMounted = false

    // Vue实例
    const app: App = (context.app = {
      _uid: uid++, // app唯一id
      _component: rootComponent as ConcreteComponent, // 组件
      _props: rootProps, // 属性
      _container: null, // 容器
      _context: context, // 上下文
      _instance: null, // 实例

      version, // 版本

      // 返回配置文件
      get config() {
        return context.config
      },

      // 设置配置，config本身是不允许替换的，但是可以修改内部选项
      set config(v) {
        if (__DEV__) {
          warn(
            `app.config cannot be replaced. Modify individual options instead.`
          )
        }
      },

      // 安装插件
      use(plugin: Plugin, ...options: any[]) {
        // 已经安装警告提示
        if (installedPlugins.has(plugin)) {
          __DEV__ && warn(`Plugin has already been applied to target app.`)
        } else if (plugin && isFunction(plugin.install)) {
          // 未安装且插件有install方法，则调用插件的install方法安装
          installedPlugins.add(plugin)
          plugin.install(app, ...options)
        } else if (isFunction(plugin)) {
          // 未安装，插件不存在install方法且本身就是方法，则直接调用插件本身安装
          installedPlugins.add(plugin)
          plugin(app, ...options)
        } else if (__DEV__) {
          // 警告，插件必须是一个object或者一个方法
          warn(
            `A plugin must either be a function or an object with an "install" ` +
              `function.`
          )
        }
        return app
      },

      /**
       * 生成混合器
       * @param mixin 
       * @returns 
       */
      mixin(mixin: ComponentOptions) {
        if (__FEATURE_OPTIONS_API__) {
          // 上下文中混合器不包含当前混合器，则将当前混合器放入
          // 否则警告
          if (!context.mixins.includes(mixin)) {
            context.mixins.push(mixin)
          } else if (__DEV__) {
            warn(
              'Mixin has already been applied to target app' +
                (mixin.name ? `: ${mixin.name}` : '')
            )
          }
        } else if (__DEV__) {
          // 没有启用选项api，则禁用
          warn('Mixins are only available in builds supporting Options API')
        }
        return app
      },

      /**
       * 注册组件
       * @param name 
       * @param component 
       * @returns 
       */
      component(name: string, component?: Component): any {
        if (__DEV__) {
          // 检验组件名称
          validateComponentName(name, context.config)
        }
        if (!component) {
          // 没有组件则返回组件名称
          return context.components[name]
        }
        // 开发者环境且上下文组件
        if (__DEV__ && context.components[name]) {
          warn(`Component "${name}" has already been registered in target app.`)
        }
        // 上下文组件名称为当前组件
        context.components[name] = component
        return app
      },

      /**
       * 注册指令
       * @param name 
       * @param directive 
       * @returns 
       */
      directive(name: string, directive?: Directive) {
        if (__DEV__) {
          // 开发者环境，教研指令的名称
          validateDirectiveName(name)
        }

        // 没有注册的指令，则从缓存的指令中获取对应的指令
        if (!directive) {
          return context.directives[name] as any
        }
        // 已存在警告
        if (__DEV__ && context.directives[name]) {
          warn(`Directive "${name}" has already been registered in target app.`)
        }
        // 上下文指令注册
        context.directives[name] = directive
        return app
      },

      /**
       * rootContainer是我们执行mount时传入的宿主容器
       * @param rootContainer 
       * @param isHydrate 
       * @param isSVG 
       * @returns 
       */
      mount(
        rootContainer: HostElement,
        isHydrate?: boolean,
        isSVG?: boolean
      ): any {
        // 初始化流程
        if (!isMounted) {
          // 创建根组件的vnode
          const vnode = createVNode(
            rootComponent as ConcreteComponent,
            rootProps
          )
          // store app context on the root VNode.
          // this will be set on the root instance on initial mount.
          // store app上下文在根节点
          // 在初始化挂载时，这将被设置在根节点实例
          vnode.appContext = context

          // HMR root reload
          // 热更新根节点重载
          if (__DEV__) {
            // 上下文调用重载函数，则渲染克隆后的根节点
            context.reload = () => {
              render(cloneVNode(vnode), rootContainer, isSVG)
            }
          }

          // 注水
          if (isHydrate && hydrate) {
            // 服务器渲染注水
            hydrate(vnode as VNode<Node, Element>, rootContainer as any)
          } else {
            // 首次渲染：把传入vnode转换位dom，然后追加到rootContainer
            // 利用渲染器渲染vnode
            render(vnode, rootContainer, isSVG)
          }
          // 挂载标记
          isMounted = true
          // 设置容器
          app._container = rootContainer
          // for devtools and telemetry
          // 用于开发者工具且是临时的
          ;(rootContainer as any).__vue_app__ = app

          // 开发者环境下，app实例是节点组件
          // 使用开发者工具初始化app
          if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
            app._instance = vnode.component
            devtoolsInitApp(app, version)
          }

          // 返回暴露的代理对象
          return getExposeProxy(vnode.component!) || vnode.component!.proxy
        } else if (__DEV__) {
          warn(
            `App has already been mounted.\n` +
              `If you want to remount the same app, move your app creation logic ` +
              `into a factory function and create fresh app instances for each ` +
              `mount - e.g. \`const createMyApp = () => createApp(App)\``
          )
        }
      },

      /**
       * 卸载
       */
      unmount() {
        // 已卸载
        if (isMounted) {
          // 渲染空节点
          render(null, app._container)
          if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
            // 清空app上的实例节点
            app._instance = null
            // 开发工具卸载app
            devtoolsUnmountApp(app)
          }
          delete app._container.__vue_app__
        } else if (__DEV__) {
          warn(`Cannot unmount an app that is not mounted.`)
        }
      },

      /**
       * 提供key和value
       * @param key 
       * @param value 
       * @returns 
       */
      provide(key, value) {
        // key是string或者symbol
        if (__DEV__ && (key as string | symbol) in context.provides) {
          warn(
            `App already provides property with key "${String(key)}". ` +
              `It will be overwritten with the new value.`
          )
        }
        // TypeScript doesn't allow symbols as index type
        // ts不支持symbol作为索引类型
        // https://github.com/Microsoft/TypeScript/issues/24587
        context.provides[key as string] = value

        return app
      }
    })

    // 兼容
    if (__COMPAT__) {
      // 启用app的兼容性属性
      installAppCompatProperties(app, context, render)
    }

    return app
  }
}
