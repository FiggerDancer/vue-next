import {
  Component,
  ConcreteComponent,
  currentInstance,
  ComponentInternalInstance,
  isInSSRComponentSetup,
  ComponentOptions
} from './component'
import { isFunction, isObject } from '@vue/shared'
import { ComponentPublicInstance } from './componentPublicInstance'
import { createVNode, VNode } from './vnode'
import { defineComponent } from './apiDefineComponent'
import { warn } from './warning'
import { ref } from '@vue/reactivity'
import { handleError, ErrorCodes } from './errorHandling'
import { isKeepAlive } from './components/KeepAlive'
import { queueJob } from './scheduler'

export type AsyncComponentResolveResult<T = Component> = T | { default: T } // es modules

export type AsyncComponentLoader<T = any> = () => Promise<
  AsyncComponentResolveResult<T>
>

export interface AsyncComponentOptions<T = any> {
  loader: AsyncComponentLoader<T>
  loadingComponent?: Component
  errorComponent?: Component
  delay?: number
  timeout?: number
  suspensible?: boolean
  onError?: (
    error: Error,
    retry: () => void,
    fail: () => void,
    attempts: number
  ) => any
}

/**
 * 是否存在异步包装
 * 异步加载器
 * @param i 
 * @returns 
 */
export const isAsyncWrapper = (i: ComponentInternalInstance | VNode): boolean =>
  !!(i.type as ComponentOptions).__asyncLoader

/**
 * 定义异步组件
 * @param source 
 * @returns 
 */
export function defineAsyncComponent<
  T extends Component = { new (): ComponentPublicInstance }
>(source: AsyncComponentLoader<T> | AsyncComponentOptions<T>): T {
  if (isFunction(source)) {
    // 是函数， 将加载函数放到loader中，用于后续的解构，这一步相当于标准化
    source = { loader: source }
  }

  const {
    loader,
    loadingComponent,
    errorComponent,
    delay = 200,
    // 未定义则为永不超时
    timeout, // undefined = never times out
    suspensible = true,
    onError: userOnError
  } = source

  // 等待中的请求
  let pendingRequest: Promise<ConcreteComponent> | null = null
  // 被获取的组件
  let resolvedComp: ConcreteComponent | undefined

  // 重试次数
  let retries = 0
  // 重试
  const retry = () => {
    // 重试次数+1
    retries++
    // 等待中的请求
    pendingRequest = null
    return load()
  }

  /**
   * 加载
   * @returns 
   */
  const load = (): Promise<ConcreteComponent> => {
    let thisRequest: Promise<ConcreteComponent>
    // Promise
    // 让等待中的请求等于该次请求，然后执行传入的loader方法
    return (
      pendingRequest ||
      (thisRequest = pendingRequest =
        loader()
          .catch(err => {
            // 错误处理
            err = err instanceof Error ? err : new Error(String(err))
            if (userOnError) {
              // 如果用户传入了错误处理函数，则执行器传入的函数
              // 并给用户提供重试、失败的方法，并且告诉用户重试的次数和错误原因
              return new Promise((resolve, reject) => {
                const userRetry = () => resolve(retry())
                const userFail = () => reject(err)
                userOnError(err, userRetry, userFail, retries + 1)
              })
            } else {
              throw err
            }
          })
          .then((comp: any) => {
            // 这个请求不是等待中的请求且存在等待中的请求，则返回等待中的请求
            if (thisRequest !== pendingRequest && pendingRequest) {
              return pendingRequest
            }
            if (__DEV__ && !comp) {
              warn(
                `Async component loader resolved to undefined. ` +
                  `If you are using retry(), make sure to return its return value.`
              )
            }
            // interop module default
            // 互操作模块默认
            if (
              comp &&
              (comp.__esModule || comp[Symbol.toStringTag] === 'Module')
            ) {
              comp = comp.default
            }
            // 失效的组件结果
            if (__DEV__ && comp && !isObject(comp) && !isFunction(comp)) {
              throw new Error(`Invalid async component load result: ${comp}`)
            }
            // 获取到的组件
            resolvedComp = comp
            return comp
          }))
    )
  }

  // 定义组件
  return defineComponent({
    name: 'AsyncComponentWrapper',
    // 异步加载器
    __asyncLoader: load,

    get __asyncResolved() {
      return resolvedComp
    },

    setup() {
      const instance = currentInstance!

      // already resolved
      // 已经获取到的组件，则直接创建内部组件就行
      if (resolvedComp) {
        // 创建内部组件
        return () => createInnerComp(resolvedComp!, instance)
      }

      // 错误处理
      const onError = (err: Error) => {
        pendingRequest = null
        // 处理错误
        handleError(
          err,
          instance,
          ErrorCodes.ASYNC_COMPONENT_LOADER,
          // 不要扔在dev如果用户提供的错误组件
          !errorComponent /* do not throw in dev if user provided error component */
        )
      }

      // suspense-controlled or SSR.
      // suspense 控制或者SSR
      if (
        (__FEATURE_SUSPENSE__ && suspensible && instance.suspense) ||
        (__SSR__ && isInSSRComponentSetup)
      ) {
        return load()
          .then(comp => {
            return () => createInnerComp(comp, instance)
          })
          .catch(err => {
            onError(err)
            return () =>
              errorComponent
                ? createVNode(errorComponent as ConcreteComponent, {
                    error: err
                  })
                : null
          })
      }

      // 是否已经加载
      const loaded = ref(false)
      // 错误
      const error = ref()
      // 延迟
      const delayed = ref(!!delay)

      // 启用延迟
      if (delay) {
        // 延迟结束后将延迟标记设置为false
        setTimeout(() => {
          delayed.value = false
        }, delay)
      }

      // 存在超时时间，到一定时间超时错误
      if (timeout != null) {
        setTimeout(() => {
          if (!loaded.value && !error.value) {
            const err = new Error(
              `Async component timed out after ${timeout}ms.`
            )
            onError(err)
            error.value = err
          }
        }, timeout)
      }

      // 正常情况下
      load()
        .then(() => {
          loaded.value = true
          if (instance.parent && isKeepAlive(instance.parent.vnode)) {
            // parent is keep-alive, force update so the loaded component's
            // name is taken into account
            // 父节点是keep-alive，强制更新，所以被加载的组件名称被考虑
            queueJob(instance.parent.update)
          }
        })
        .catch(err => {
          onError(err)
          error.value = err
        })

      // 返回一个节点
      return () => {
        if (loaded.value && resolvedComp) {
          // 加载到的时候返回组件实例节点
          return createInnerComp(resolvedComp, instance)
        } else if (error.value && errorComponent) {
          // 错误，返回错误组件
          return createVNode(errorComponent as ConcreteComponent, {
            error: error.value
          })
        } else if (loadingComponent && !delayed.value) {
          // 加载中，返回加载中组件
          return createVNode(loadingComponent as ConcreteComponent)
        }
      }
    }
  }) as T
}

/**
 * 创建组件
 * @param comp 
 * @param param1 
 * @returns 
 */
function createInnerComp(
  comp: ConcreteComponent,
  { vnode: { ref, props, children } }: ComponentInternalInstance
) {
  const vnode = createVNode(comp, props, children)
  // ensure inner component inherits the async wrapper's ref owner
  // 确保内部组件继承异步组件包装器的ref所有者
  vnode.ref = ref
  return vnode
}
