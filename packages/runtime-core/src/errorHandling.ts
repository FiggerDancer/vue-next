import { VNode } from './vnode'
import { ComponentInternalInstance, LifecycleHooks } from './component'
import { warn, pushWarningContext, popWarningContext } from './warning'
import { isPromise, isFunction } from '@vue/shared'

// contexts where user provided function may be executed, in addition to
// lifecycle hooks.
/**
 * 用户提供功能可能被执行的上下文 除了生命周期钩子
 */
export const enum ErrorCodes {
  SETUP_FUNCTION,
  RENDER_FUNCTION,
  WATCH_GETTER,
  WATCH_CALLBACK,
  WATCH_CLEANUP,
  NATIVE_EVENT_HANDLER,
  COMPONENT_EVENT_HANDLER,
  VNODE_HOOK,
  DIRECTIVE_HOOK,
  TRANSITION_HOOK,
  APP_ERROR_HANDLER,
  APP_WARN_HANDLER,
  FUNCTION_REF,
  ASYNC_COMPONENT_LOADER,
  SCHEDULER
}

/**
 * 错误类型字符串
 * 这些钩子的字符串信息
 */
export const ErrorTypeStrings: Record<number | string, string> = {
  [LifecycleHooks.SERVER_PREFETCH]: 'serverPrefetch hook',
  [LifecycleHooks.BEFORE_CREATE]: 'beforeCreate hook',
  [LifecycleHooks.CREATED]: 'created hook',
  [LifecycleHooks.BEFORE_MOUNT]: 'beforeMount hook',
  [LifecycleHooks.MOUNTED]: 'mounted hook',
  [LifecycleHooks.BEFORE_UPDATE]: 'beforeUpdate hook',
  [LifecycleHooks.UPDATED]: 'updated',
  [LifecycleHooks.BEFORE_UNMOUNT]: 'beforeUnmount hook',
  [LifecycleHooks.UNMOUNTED]: 'unmounted hook',
  [LifecycleHooks.ACTIVATED]: 'activated hook',
  [LifecycleHooks.DEACTIVATED]: 'deactivated hook',
  [LifecycleHooks.ERROR_CAPTURED]: 'errorCaptured hook',
  [LifecycleHooks.RENDER_TRACKED]: 'renderTracked hook',
  [LifecycleHooks.RENDER_TRIGGERED]: 'renderTriggered hook',
  [ErrorCodes.SETUP_FUNCTION]: 'setup function',
  [ErrorCodes.RENDER_FUNCTION]: 'render function',
  [ErrorCodes.WATCH_GETTER]: 'watcher getter',
  [ErrorCodes.WATCH_CALLBACK]: 'watcher callback',
  [ErrorCodes.WATCH_CLEANUP]: 'watcher cleanup function',
  [ErrorCodes.NATIVE_EVENT_HANDLER]: 'native event handler',
  [ErrorCodes.COMPONENT_EVENT_HANDLER]: 'component event handler',
  [ErrorCodes.VNODE_HOOK]: 'vnode hook',
  [ErrorCodes.DIRECTIVE_HOOK]: 'directive hook',
  [ErrorCodes.TRANSITION_HOOK]: 'transition hook',
  [ErrorCodes.APP_ERROR_HANDLER]: 'app errorHandler',
  [ErrorCodes.APP_WARN_HANDLER]: 'app warnHandler',
  [ErrorCodes.FUNCTION_REF]: 'ref function',
  [ErrorCodes.ASYNC_COMPONENT_LOADER]: 'async component loader',
  [ErrorCodes.SCHEDULER]:
    'scheduler flush. This is likely a Vue internals bug. ' +
    'Please open an issue at https://new-issue.vuejs.org/?repo=vuejs/core'
}

export type ErrorTypes = LifecycleHooks | ErrorCodes

/**
 * 执行某个函数，并捕获和处理函数执行期间的错误
 * @param fn 表示要执行的函数
 * @param instance 表示组件实例对象
 * @param type 表示错误类型
 * @param args 表示执行fn时传入的参数
 * @returns 
 */
export function callWithErrorHandling(
  fn: Function,
  instance: ComponentInternalInstance | null,
  type: ErrorTypes,
  args?: unknown[]
) {
  let res
  try {
    // 函数返回结果 参数  有参数  调用函数时带参数，否则不带
    res = args ? fn(...args) : fn()
  } catch (err) {
    // 处理错误
    handleError(err, instance, type)
  }
  // 将函数的返回结果反出去
  return res
}

/**
 * 使用异步错误处理函数
 * @param fn 表示要执行的函数
 * @param instance 表示组件实例对象
 * @param type 表示错误类型
 * @param args 表示执行fn时传入的参数
 * @returns 
 */
export function callWithAsyncErrorHandling(
  fn: Function | Function[],
  instance: ComponentInternalInstance | null,
  type: ErrorTypes,
  args?: unknown[]
): any[] {
  // 是函数
  if (isFunction(fn)) {
    // 调用错误处理函数
    const res = callWithErrorHandling(fn, instance, type, args)
    // 如果调用的结果是promise 则需要catch下处理错误，然后返回promise本身
    if (res && isPromise(res)) {
      res.catch(err => {
        handleError(err, instance, type)
      })
    }
    return res
  }

  // 不是函数，那就是函数数组
  const values = []
  // 函数数组去遍历处理
  for (let i = 0; i < fn.length; i++) {
    values.push(callWithAsyncErrorHandling(fn[i], instance, type, args))
  }
  // 返回值
  return values
}

/**
 * 处理错误
 * @param err 被捕获的错误对象
 * @param instance 组件实例
 * @param type 错误类型
 * @param throwInDev 开发环境下直接抛出错误，阻止应用程序继续执行
 * @returns 
 */
export function handleError(
  err: unknown,
  instance: ComponentInternalInstance | null,
  type: ErrorTypes,
  throwInDev = true
) {
  // 上下文节点
  const contextVNode = instance ? instance.vnode : null
  if (instance) {
    // 如果有实例
    // 获取实例父节点
    let cur = instance.parent
    // the exposed instance is the render proxy to keep it consistent with 2.x
    // 被暴露的实例是渲染器代理，以保持与2.x一致
    const exposedInstance = instance.proxy
    // in production the hook receives only the error code
    // 在生产环境 钩子接收错误代码 获取错误信息
    const errorInfo = __DEV__ ? ErrorTypeStrings[type] : type
    // 从下往上递归找父节点，一直到根 
    // 尝试向上查找所有父组件，执行errorCaptured钩子函数
    while (cur) {
      // 错误捕获钩子
      const errorCapturedHooks = cur.ec
      // 错误捕获钩子
      if (errorCapturedHooks) {
        // 遍历错误捕获的钩子，如果错误捕获钩子的返回值是false，则结束遍历
        for (let i = 0; i < errorCapturedHooks.length; i++) {
          if (
            // 如果执行errorCaptured 钩子函数返回false，则停止向上查找
            errorCapturedHooks[i](err, exposedInstance, errorInfo) === false
          ) {
            return
          }
        }
      }
      cur = cur.parent
    }
    // app-level handling
    // app级别的处理
    const appErrorHandler = instance.appContext.config.errorHandler
    if (appErrorHandler) {
      // 调用错误处理函数
      callWithErrorHandling(
        appErrorHandler,
        null,
        ErrorCodes.APP_ERROR_HANDLER,
        [err, exposedInstance, errorInfo]
      )
      return
    }
  }
  // 打印错误日志
  logError(err, type, contextVNode, throwInDev)
}

/**
 * 打印错误日志
 * @param err 
 * @param type 
 * @param contextVNode 
 * @param throwInDev 
 */
function logError(
  err: unknown,
  type: ErrorTypes,
  contextVNode: VNode | null,
  throwInDev = true
) {
  // 如果开发者环境
  if (__DEV__) {
    // 错误信息类型
    const info = ErrorTypeStrings[type]
    // 上下文节点，推入警告上下文节点
    if (contextVNode) {
      pushWarningContext(contextVNode)
    }
    // 警告
    warn(`Unhandled error${info ? ` during execution of ${info}` : ``}`)
    // 推出
    if (contextVNode) {
      popWarningContext()
    }
    // crash in dev by default so it's more noticeable
    // 在开发中默认崩溃，所以它更容易被注意到
    if (throwInDev) {
      throw err
    } else if (!__TEST__) {
      console.error(err)
    }
  } else {
    // recover in prod to reduce the impact on end-user
    // 在prod中进行恢复，以减少对终端用户的影响
    console.error(err)
  }
}
