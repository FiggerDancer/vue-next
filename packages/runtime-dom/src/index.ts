import {
  createRenderer,
  createHydrationRenderer,
  warn,
  RootRenderFunction,
  CreateAppFunction,
  Renderer,
  HydrationRenderer,
  App,
  RootHydrateFunction,
  isRuntimeOnly,
  DeprecationTypes,
  compatUtils
} from '@vue/runtime-core'
import { nodeOps } from './nodeOps'
import { patchProp } from './patchProp'
// Importing from the compiler, will be tree-shaken in prod
// 从编译器中引入，在生产环境中将通过摇树删除
import {
  isFunction,
  isString,
  isHTMLTag,
  isSVGTag,
  extend,
  NOOP
} from '@vue/shared'

declare module '@vue/reactivity' {
  export interface RefUnwrapBailTypes {
    // Note: if updating this, also update `types/refBail.d.ts`.
    // 注意:如果更新这个，也要更新' types/refBail.d.ts '。
    runtimeDOMBailTypes: Node | Window
  }
}

const rendererOptions = extend({ patchProp }, nodeOps)

// lazy create the renderer - this makes core renderer logic tree-shakable
// in case the user only imports reactivity utilities from Vue.
// lazy创建渲染器——这使得核心渲染器逻辑可摇树，以防用户只从Vue导入响应性实用程序。
let renderer: Renderer<Element | ShadowRoot> | HydrationRenderer

let enabledHydration = false

// 获取一个渲染的实例
function ensureRenderer() {
  return (
    renderer ||
    (renderer = createRenderer<Node, Element | ShadowRoot>(rendererOptions))
  )
}

// 获取一个渲染的实例（SSR版的）
function ensureHydrationRenderer() {
  renderer = enabledHydration
    ? renderer
    : createHydrationRenderer(rendererOptions)
  enabledHydration = true
  return renderer as HydrationRenderer
}

// use explicit type casts here to avoid import() calls in rolled-up d.ts
// 在这里使用显式类型转换，以避免在打包后的d.ts中调用import()
export const render = ((...args) => {
  ensureRenderer().render(...args)
}) as RootRenderFunction<Element | ShadowRoot>

export const hydrate = ((...args) => {
  ensureHydrationRenderer().hydrate(...args)
}) as RootHydrateFunction

// 获取一个Vue实例
export const createApp = ((...args) => {
  // 获取app渲染器
  const app = ensureRenderer().createApp(...args)

  if (__DEV__) {
    // 注入的原生标签检查
    injectNativeTagCheck(app)
    // 编译器选项检查
    injectCompilerOptionsCheck(app)
  }

  // 扩展mount方法，使用户没有设置render函数或者template选项时可以使用
  // 获取根组件的模板
  const { mount } = app
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    // 获取container实例，并挂载，目的就是防止container为字符串或者ShadowRoot
    const container = normalizeContainer(containerOrSelector)
    if (!container) return

    const component = app._component
    // 如果根组件不是Function，没有render方法也没有template模板
    if (!isFunction(component) && !component.render && !component.template) {
      // __UNSAFE__
      // Reason: potential execution of JS expressions in in-DOM template.
      // The user must make sure the in-DOM template is trusted. If it's
      // rendered by the server, the template should not contain any user data.
      // 不安全的
      // 原因：在in-dom的模板中可能隐藏着js表达式，用户必须保证in-dom的模板是可靠的。
      // 如果是使用服务器渲染，模板中应该不包含任何用户数据
      component.template = container.innerHTML
      // 2.x compat check
      // 2.x 兼容检查
      if (__COMPAT__ && __DEV__) {
        for (let i = 0; i < container.attributes.length; i++) {
          const attr = container.attributes[i]
          // 当用户打出非 v-，:， @开头 告诉用户废弃的警告
          if (attr.name !== 'v-cloak' && /^(v-|:|@)/.test(attr.name)) {
            compatUtils.warnDeprecation(
              DeprecationTypes.GLOBAL_MOUNT_CONTAINER,
              null
            )
            break
          }
        }
      }
    }

    // clear content before mounting
    // 挂载前清理内容
    container.innerHTML = ''
    const proxy = mount(container, false, container instanceof SVGElement)
    // 如果容器是一个元素的话，就移除v-cloak,并增加data-v-app
    if (container instanceof Element) { 
      container.removeAttribute('v-cloak')
      container.setAttribute('data-v-app', '')
    }
    return proxy
  }

  return app
}) as CreateAppFunction<Element>

export const createSSRApp = ((...args) => {
  // 获取app渲染器
  const app = ensureHydrationRenderer().createApp(...args)

  if (__DEV__) {
    injectNativeTagCheck(app)
    injectCompilerOptionsCheck(app)
  }

  // 重写mount，获取container实例，并挂载，目的就是防止container为字符串或者ShadowRoot
  const { mount } = app
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    const container = normalizeContainer(containerOrSelector)
    if (container) {
      return mount(container, true, container instanceof SVGElement)
    }
  }

  return app
}) as CreateAppFunction<Element>

function injectNativeTagCheck(app: App) {
  // Inject `isNativeTag`
  // 注入是是否是原生标签的检查标记
  // this is used for component name validation (dev only)
  // 这用于组件名称验证(仅适用于dev)
  Object.defineProperty(app.config, 'isNativeTag', {
    value: (tag: string) => isHTMLTag(tag) || isSVGTag(tag), // 原生标签：html或svg
    writable: false // 禁止重写
  })
}

// dev only
// 仅开发者环境
function injectCompilerOptionsCheck(app: App) {
  if (isRuntimeOnly()) {
    // 是自定义元素
    const isCustomElement = app.config.isCustomElement
    // 注入自定义元素检查标记
    Object.defineProperty(app.config, 'isCustomElement', {
      get() {
        return isCustomElement
      },
      set() {
        // 提示用户原先的方法废弃，使用新的方法
        warn(
          `The \`isCustomElement\` config option is deprecated. Use ` +
            `\`compilerOptions.isCustomElement\` instead.`
        )
      }
    })

    // 编译选项
    const compilerOptions = app.config.compilerOptions
    // 警告信息
    const msg =
      `The \`compilerOptions\` config option is only respected when using ` +
      `a build of Vue.js that includes the runtime compiler (aka "full build"). ` +
      `Since you are using the runtime-only build, \`compilerOptions\` ` +
      `must be passed to \`@vue/compiler-dom\` in the build setup instead.\n` +
      `- For vue-loader: pass it via vue-loader's \`compilerOptions\` loader option.\n` +
      `- For vue-cli: see https://cli.vuejs.org/guide/webpack.html#modifying-options-of-a-loader\n` +
      `- For vite: pass it via @vitejs/plugin-vue options. See https://github.com/vitejs/vite/tree/main/packages/plugin-vue#example-for-passing-options-to-vuecompiler-dom`

    // 编译选项，无论是获取，还是设置都会给予警告
    // 警告的信息：主要是编译选项仅在包含运行时编译的vue中生效，
    // 因为compilerOptions必须要通过@vue/compiler-dom构建才能获取到，所以你需要使用运行时构建。
    // 对于vue-loader，通过vue-loader构建 compilerOptions 将会作为loader选项
    // 对于vue-cli，看https://cli.vuejs.org/guide/webpack.html#modifying-options-of-a-loader
    // 对于vite 通过@vitejs/plugin-vue的选项构建
    // 看https://github.com/vitejs/vite/tree/main/packages/plugin-vue#example-for-passing-options-to-vuecompiler-dom
    Object.defineProperty(app.config, 'compilerOptions', {
      get() {
        warn(msg)
        return compilerOptions
      },
      set() {
        warn(msg)
      }
    })
  }
}

// 获取容器的实例
function normalizeContainer(
  container: Element | ShadowRoot | string
): Element | null {
  // 字符串， #app
  if (isString(container)) {
    const res = document.querySelector(container)
    if (__DEV__ && !res) {
      warn(
        `Failed to mount app: mount target selector "${container}" returned null.`
      )
    }
    return res
  }
  // ShadowDom是一种WebComponent技术
  if (
    __DEV__ &&
    window.ShadowRoot &&
    container instanceof window.ShadowRoot &&
    container.mode === 'closed'
  ) {
    // 开发者环境，将模式为closed的ShadowRoot作为App的根节点可能会导致不可预知的错误
    warn(
      `mounting on a ShadowRoot with \`{mode: "closed"}\` may lead to unpredictable bugs`
    )
  }
  return container as any
}

// Custom element support
// web组件支持
export {
  defineCustomElement,
  defineSSRCustomElement,
  VueElement,
  VueElementConstructor
} from './apiCustomElement'

// SFC CSS utilities
// SFC css 工具
export { useCssModule } from './helpers/useCssModule'
export { useCssVars } from './helpers/useCssVars'

// DOM-only components
// 动画组件
export { Transition, TransitionProps } from './components/Transition'
export {
  TransitionGroup,
  TransitionGroupProps
} from './components/TransitionGroup'

// **Internal** DOM-only runtime directive helpers
// 内部运行时帮助指令
export {
  vModelText,
  vModelCheckbox,
  vModelRadio,
  vModelSelect,
  vModelDynamic
} from './directives/vModel'
export { withModifiers, withKeys } from './directives/vOn'
export { vShow } from './directives/vShow'

import { initVModelForSSR } from './directives/vModel'
import { initVShowForSSR } from './directives/vShow'

// ssr指令是否初始化标志
let ssrDirectiveInitialized = false

/**
 * @internal
 * 内部的
 * 初始化SSR指令
 */
export const initDirectivesForSSR = __SSR__
  ? () => {
      if (!ssrDirectiveInitialized) {
        ssrDirectiveInitialized = true
        initVModelForSSR()
        initVShowForSSR()
      }
    }
  : NOOP

// re-export everything from core
// h, Component, reactivity API, nextTick, flags & types
// 重新导出core的每个api
// h,Component,reactivity API,nextTick,flags和types
export * from '@vue/runtime-core'
