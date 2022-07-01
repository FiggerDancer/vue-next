import { App } from './apiCreateApp'
import { Fragment, Text, Comment, Static } from './vnode'
import { ComponentInternalInstance } from './component'

/**
 * AppRecord
 * id 
 * app App
 * version 版本  
 * types
 */
interface AppRecord {
  id: number
  app: App
  version: string
  types: Record<string, string | Symbol>
}

/**
 * 开发工具的钩子类型
 * 初始化
 * 卸载
 * 组件更新
 * 组件添加
 * 组件移除
 * 组件触发事件
 * 执行开始
 * 执行结束
 */
const enum DevtoolsHooks {
  APP_INIT = 'app:init',
  APP_UNMOUNT = 'app:unmount',
  COMPONENT_UPDATED = 'component:updated',
  COMPONENT_ADDED = 'component:added',
  COMPONENT_REMOVED = 'component:removed',
  COMPONENT_EMIT = 'component:emit',
  PERFORMANCE_START = 'perf:start',
  PERFORMANCE_END = 'perf:end'
}

/**
 * 开发者工具钩子
 * enabled 启用
 * emit 触发事件
 * on 监听
 * once 一次监听
 * off 取消监听
 * appRecords
 */
interface DevtoolsHook {
  enabled?: boolean
  emit: (event: string, ...payload: any[]) => void
  on: (event: string, handler: Function) => void
  once: (event: string, handler: Function) => void
  off: (event: string, handler: Function) => void
  appRecords: AppRecord[]
}

/**
 * 开发者工具
 */
export let devtools: DevtoolsHook

/**
 * 缓存
 * 事件-参数键值对
 */
let buffer: { event: string; args: any[] }[] = []

/**
 * 开发者工具安装标记
 */
let devtoolsNotInstalled = false

/**
 * 触发事件
 * @param event 
 * @param args 
 */
function emit(event: string, ...args: any[]) {
  if (devtools) {
    // 有开发者工具，则触发事件
    devtools.emit(event, ...args)
  } else if (!devtoolsNotInstalled) {
    // 开发者工具安装了但是没有devtools则先放到缓存里
    buffer.push({ event, args })
  }
}

/**
 * 设置开发者工具的钩子
 * @param hook 
 * @param target 
 */
export function setDevtoolsHook(hook: DevtoolsHook, target: any) {
  // 设置开发者工具的值
  devtools = hook
  if (devtools) {
    // 如果存在devtools，启用
    devtools.enabled = true
    // 先从缓存里读，把那些事件都触发一遍，因为用户一开始可能没打开开发者工具
    buffer.forEach(({ event, args }) => devtools.emit(event, ...args))
    buffer = []
  } else if (
    // handle late devtools injection - only do this if we are in an actual
    // browser environment to avoid the timer handle stalling test runner exit
    // 处理最新的开发者工具注入 ，这样做仅仅是因为，我们在一个真实浏览器下需要避免
    // 时间句柄停止运行卡住
    // (#4815)
    // eslint-disable-next-line no-restricted-globals
    typeof window !== 'undefined' &&
    // some envs mock window but not fully
    // 一些环境模拟window，但是不完全
    window.HTMLElement &&
    // also exclude jsdom
    // 排除jsdom
    !window.navigator?.userAgent?.includes('jsdom')
  ) {
    // 重新开始钩子
    const replay = (target.__VUE_DEVTOOLS_HOOK_REPLAY__ =
      target.__VUE_DEVTOOLS_HOOK_REPLAY__ || [])
    // 放入重新开始钩子
    replay.push((newHook: DevtoolsHook) => {
      // 重新开始的时候，就是设置新钩子
      setDevtoolsHook(newHook, target)
    })
    // clear buffer after 3s - the user probably doesn't have devtools installed
    // at all, and keeping the buffer will cause memory leaks (#4738)
    // 3s后清理缓存，用户可能根本没有安装开发者工具
    // 保存这些缓存将导致内存泄漏
    setTimeout(() => {
      if (!devtools) {
        // 没有开发者工具，清空所有数据
        target.__VUE_DEVTOOLS_HOOK_REPLAY__ = null
        // 已经明确没有安装开发者工具
        devtoolsNotInstalled = true
        // 清空缓存
        buffer = []
      }
    }, 3000)
  } else {
    // non-browser env, assume not installed
    // 非浏览器环境，直接就假定没有安装
    devtoolsNotInstalled = true
    buffer = []
  }
}

/**
 * 开发者工具安装app
 * 触发事件
 * @param app 
 * @param version 
 */
export function devtoolsInitApp(app: App, version: string) {
  emit(DevtoolsHooks.APP_INIT, app, version, {
    Fragment,
    Text,
    Comment,
    Static
  })
}

/**
 * 开发者工具卸载app
 * @param app 
 */
export function devtoolsUnmountApp(app: App) {
  emit(DevtoolsHooks.APP_UNMOUNT, app)
}

/**
 * 开发者工具组件被添加
 */
export const devtoolsComponentAdded = /*#__PURE__*/ createDevtoolsComponentHook(
  DevtoolsHooks.COMPONENT_ADDED
)

/**
 * 开发者工具组件被更新
 */
export const devtoolsComponentUpdated =
  /*#__PURE__*/ createDevtoolsComponentHook(DevtoolsHooks.COMPONENT_UPDATED)

/**
 * 开发者工具组件被移除
 */
export const devtoolsComponentRemoved =
  /*#__PURE__*/ createDevtoolsComponentHook(DevtoolsHooks.COMPONENT_REMOVED)

/**
 * 创建开发者组件的钩子
 * @param hook 
 * @returns 
 */
function createDevtoolsComponentHook(hook: DevtoolsHooks) {
  return (component: ComponentInternalInstance) => {
    emit(
      hook,
      component.appContext.app,
      component.uid,
      component.parent ? component.parent.uid : undefined,
      component
    )
  }
}

/**
 * 开发者工具执行开始
 */
export const devtoolsPerfStart = /*#__PURE__*/ createDevtoolsPerformanceHook(
  DevtoolsHooks.PERFORMANCE_START
)

/**
 * 开发工具执行结束
 */
export const devtoolsPerfEnd = /*#__PURE__*/ createDevtoolsPerformanceHook(
  DevtoolsHooks.PERFORMANCE_END
)

/**
 * 创建开发者工具性能钩子
 * @param hook 
 * @returns 
 */
function createDevtoolsPerformanceHook(hook: DevtoolsHooks) {
  return (component: ComponentInternalInstance, type: string, time: number) => {
    emit(hook, component.appContext.app, component.uid, component, type, time)
  }
}

/**
 * 开发者工具组件事件触发钩子
 * @param component 
 * @param event 
 * @param params 
 */
export function devtoolsComponentEmit(
  component: ComponentInternalInstance,
  event: string,
  params: any[]
) {
  emit(
    DevtoolsHooks.COMPONENT_EMIT,
    component.appContext.app,
    component,
    event,
    params
  )
}
