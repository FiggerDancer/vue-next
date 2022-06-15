// Core API ------------------------------------------------------------------

export const version = __VERSION__
export {
  // core
  // 核心
  reactive,
  ref,
  readonly,
  // utilities
  // 工具
  unref,
  proxyRefs,
  isRef,
  toRef,
  toRefs,
  isProxy,
  isReactive,
  isReadonly,
  isShallow,
  // advanced
  // 高级
  customRef,
  triggerRef,
  shallowRef,
  shallowReactive,
  shallowReadonly,
  markRaw,
  toRaw,
  // effect
  // 副作用
  effect,
  stop,
  ReactiveEffect,
  // effect scope
  // 作用域
  effectScope,
  EffectScope,
  getCurrentScope,
  onScopeDispose
} from '@vue/reactivity'
export { computed } from './apiComputed'
export {
  watch,
  watchEffect,
  watchPostEffect,
  watchSyncEffect
} from './apiWatch'
export {
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
  onActivated,
  onDeactivated,
  onRenderTracked,
  onRenderTriggered,
  onErrorCaptured,
  onServerPrefetch
} from './apiLifecycle'
export { provide, inject } from './apiInject'
export { nextTick } from './scheduler'
export { defineComponent } from './apiDefineComponent'
export { defineAsyncComponent } from './apiAsyncComponent'
export { useAttrs, useSlots } from './apiSetupHelpers'

// <script setup> API ----------------------------------------------------------
// setup语法糖
export {
  // macros runtime, for typing and warnings only
  // 宏运行时，仅用于输入和警告
  defineProps,
  defineEmits,
  defineExpose,
  withDefaults,
  // internal
  // 内部函数
  mergeDefaults,
  createPropsRestProxy,
  withAsyncContext
} from './apiSetupHelpers'

// Advanced API ----------------------------------------------------------------
// 高级API
// For getting a hold of the internal instance in setup() - useful for advanced
// plugins
// 用于在setup()中获取内部实例—用于高级插件
export { getCurrentInstance } from './component'

// For raw render function users
// 用于使用原始渲染功能的用户
export { h } from './h'
// Advanced render function utilities
// 高级渲染函数工具方法
export { createVNode, cloneVNode, mergeProps, isVNode } from './vnode'
// VNode types
// 虚拟节点类型
export { Fragment, Text, Comment, Static } from './vnode'
// Built-in components
// 内置组件
export { Teleport, TeleportProps } from './components/Teleport'
export { Suspense, SuspenseProps } from './components/Suspense'
export { KeepAlive, KeepAliveProps } from './components/KeepAlive'
export {
  BaseTransition,
  BaseTransitionProps
} from './components/BaseTransition'
// For using custom directives
// 用来使用自定义指令
export { withDirectives } from './directives'
// SSR context
// SSR上下文
export { useSSRContext, ssrContextKey } from './helpers/useSsrContext'

// Custom Renderer API ---------------------------------------------------------
// 自定义渲染API
export { createRenderer, createHydrationRenderer } from './renderer'
export { queuePostFlushCb } from './scheduler'
export { warn } from './warning'
export {
  handleError,
  callWithErrorHandling,
  callWithAsyncErrorHandling,
  ErrorCodes
} from './errorHandling'
export {
  resolveComponent,
  resolveDirective,
  resolveDynamicComponent
} from './helpers/resolveAssets'
// For integration with runtime compiler
// 用于与运行时编译器集成
export { registerRuntimeCompiler, isRuntimeOnly } from './component'
export {
  useTransitionState,
  resolveTransitionHooks,
  setTransitionHooks,
  getTransitionRawChildren
} from './components/BaseTransition'
export { initCustomFormatter } from './customFormatter'

// For devtools
// 用于开发者工具
export { devtools, setDevtoolsHook } from './devtools'

// Types -------------------------------------------------------------------------
// 类型
import { VNode } from './vnode'
import { ComponentInternalInstance } from './component'

// Augment Ref unwrap bail types.
// Note: if updating this, also update `types/refBail.d.ts`.
// 增加Ref展开保释类型。
// 注意:如果要更新这个，也要更新' types/refBail.d.ts '。
declare module '@vue/reactivity' {
  export interface RefUnwrapBailTypes {
    runtimeCoreBailTypes:
      | VNode
      | {
          // directly bailing on ComponentPublicInstance results in recursion
          // so we use this as a bail hint
          // 直接退出ComponentPublicInstance会导致递归,所以我们用这个作为保释提示
          $: ComponentInternalInstance
        }
  }
}

export {
  Ref,
  ToRef,
  ToRefs,
  UnwrapRef,
  ShallowRef,
  ShallowUnwrapRef,
  CustomRefFactory,
  ReactiveFlags,
  DeepReadonly,
  ShallowReactive,
  UnwrapNestedRefs,
  ComputedRef,
  WritableComputedRef,
  WritableComputedOptions,
  ComputedGetter,
  ComputedSetter,
  ReactiveEffectRunner,
  ReactiveEffectOptions,
  EffectScheduler,
  DebuggerOptions,
  DebuggerEvent,
  DebuggerEventExtraInfo,
  TrackOpTypes,
  TriggerOpTypes
} from '@vue/reactivity'
export {
  WatchEffect,
  WatchOptions,
  WatchOptionsBase,
  WatchCallback,
  WatchSource,
  WatchStopHandle
} from './apiWatch'
export { InjectionKey } from './apiInject'
export {
  App,
  AppConfig,
  AppContext,
  Plugin,
  CreateAppFunction,
  OptionMergeFunction
} from './apiCreateApp'
export {
  VNode,
  VNodeChild,
  VNodeTypes,
  VNodeProps,
  VNodeArrayChildren,
  VNodeNormalizedChildren
} from './vnode'
export {
  Component,
  ConcreteComponent,
  FunctionalComponent,
  ComponentInternalInstance,
  SetupContext,
  ComponentCustomProps,
  AllowedComponentProps
} from './component'
export { DefineComponent } from './apiDefineComponent'
export {
  ComponentOptions,
  ComponentOptionsMixin,
  ComponentOptionsWithoutProps,
  ComponentOptionsWithObjectProps,
  ComponentOptionsWithArrayProps,
  ComponentCustomOptions,
  ComponentOptionsBase,
  RenderFunction,
  MethodOptions,
  ComputedOptions,
  RuntimeCompilerOptions
} from './componentOptions'
export { EmitsOptions, ObjectEmitsOptions } from './componentEmits'
export {
  ComponentPublicInstance,
  ComponentCustomProperties,
  CreateComponentPublicInstance
} from './componentPublicInstance'
export {
  Renderer,
  RendererNode,
  RendererElement,
  HydrationRenderer,
  RendererOptions,
  RootRenderFunction
} from './renderer'
export { RootHydrateFunction } from './hydration'
export { Slot, Slots } from './componentSlots'
export {
  Prop,
  PropType,
  ComponentPropsOptions,
  ComponentObjectPropsOptions,
  ExtractPropTypes,
  ExtractDefaultPropTypes
} from './componentProps'
export {
  Directive,
  DirectiveBinding,
  DirectiveHook,
  ObjectDirective,
  FunctionDirective,
  DirectiveArguments
} from './directives'
export { SuspenseBoundary } from './components/Suspense'
export { TransitionState, TransitionHooks } from './components/BaseTransition'
export {
  AsyncComponentOptions,
  AsyncComponentLoader
} from './apiAsyncComponent'
export { HMRRuntime } from './hmr'

// Internal API ----------------------------------------------------------------
// 内部API
// **IMPORTANT** Internal APIs may change without notice between versions and
// user code should avoid relying on them.
// 重要的
// 这些内部API未来可能会改变而不会关注版本，用户的代码应该避免依赖它们

// For compiler generated code
// should sync with '@vue/compiler-core/src/runtimeHelpers.ts'
// 对于编译器生成代码应该
// 使用'@vue/compiler-core/src/runtimeHelpers.ts'同步
export {
  withCtx,
  pushScopeId,
  popScopeId,
  withScopeId
} from './componentRenderContext'
export { renderList } from './helpers/renderList'
export { toHandlers } from './helpers/toHandlers'
export { renderSlot } from './helpers/renderSlot'
export { createSlots } from './helpers/createSlots'
export { withMemo, isMemoSame } from './helpers/withMemo'
export {
  openBlock,
  createBlock,
  setBlockTracking,
  createTextVNode,
  createCommentVNode,
  createStaticVNode,
  createElementVNode,
  createElementBlock,
  guardReactiveProps
} from './vnode'
export {
  toDisplayString,
  camelize,
  capitalize,
  toHandlerKey,
  normalizeProps,
  normalizeClass,
  normalizeStyle
} from '@vue/shared'

// For test-utils
// 用于单元测试
export { transformVNodeArgs } from './vnode'

// SSR -------------------------------------------------------------------------

// **IMPORTANT** These APIs are exposed solely for @vue/server-renderer and may
// change without notice between versions. User code should never rely on them.
// 注意：
// 这些API被暴露仅仅用于服务端渲染器并且版本改变不会有通知。
// 用户的代码不应该依赖它们
import { createComponentInstance, setupComponent } from './component'
import { renderComponentRoot } from './componentRenderUtils'
import { setCurrentRenderingInstance } from './componentRenderContext'
import { isVNode, normalizeVNode } from './vnode'

const _ssrUtils = {
  createComponentInstance,
  setupComponent,
  renderComponentRoot,
  setCurrentRenderingInstance,
  isVNode,
  normalizeVNode
}

/**
 * SSR utils for \@vue/server-renderer. Only exposed in cjs builds.
 * SSR工具应用于服务端渲染器
 * 仅仅暴露在cjs构建中
 * @internal
 */
export const ssrUtils = (__SSR__ ? _ssrUtils : null) as typeof _ssrUtils

// 2.x COMPAT ------------------------------------------------------------------
// 兼容2.x
export { DeprecationTypes } from './compat/compatConfig'
export { CompatVue } from './compat/global'
export { LegacyConfig } from './compat/globalConfig'

import { warnDeprecation } from './compat/compatConfig'
import { createCompatVue } from './compat/global'
import {
  isCompatEnabled,
  checkCompatEnabled,
  softAssertCompatEnabled
} from './compat/compatConfig'
import { resolveFilter as _resolveFilter } from './helpers/resolveAssets'

/**
 * @internal only exposed in compat builds
 * 仅仅被暴露用于兼容构建
 */
export const resolveFilter = __COMPAT__ ? _resolveFilter : null

const _compatUtils = {
  warnDeprecation,
  createCompatVue,
  isCompatEnabled,
  checkCompatEnabled,
  softAssertCompatEnabled
}

/**
 * @internal only exposed in compat builds.
 * 仅仅被暴露在支持兼容性的构建中
 */
export const compatUtils = (
  __COMPAT__ ? _compatUtils : null
) as typeof _compatUtils
