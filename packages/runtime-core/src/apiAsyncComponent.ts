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
  /**
   * 加载函数，一般是加载组件的函数 () => import('CompA')
   */
  loader: AsyncComponentLoader<T>
  /**
   * 加载时显示的组件
   */
  loadingComponent?: Component
  /**
   * 加载失败时显示的组件
   */
  errorComponent?: Component
  /**
   * 延迟多少时间再进行加载
   */
  delay?: number
  /**
   * 加载超时
   */
  timeout?: number
  /**
   * 是否处于 suspense 标签 内部
   */
  suspensible?: boolean
  /**
   * 监听错误处理
   * @param error
   * @param retry
   * @param fail
   * @param attempts 尝试次数
   */
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
 * 1. 渲染占位节点
 * 2. 加载异步JS模块以获取组件对象
 * 3. 重新渲染组件
 * @param source 可以是个函数也可以是一个对象，如果是函数首先对函数标准化
 * @returns 
 */
export function defineAsyncComponent<
  T extends Component = { new (): ComponentPublicInstance }
>(source: AsyncComponentLoader<T> | AsyncComponentOptions<T>): T {
  // 标准化参数，如果是source函数，就转成一个对象
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
  // 获取到的异步组件
  let resolvedComp: ConcreteComponent | undefined

  // 重试次数
  let retries = 0
  /**
   * 定义重试函数
   * 累加重试次数，并重新执行加载请求
   * @returns 
   */
  const retry = () => {
    // 重试次数+1
    retries++
    // 等待中的请求
    pendingRequest = null
    return load()
  }

  /**
   * 加载异步组件的的js代码，获取组件模块定义的对象
   * @returns 
   */
  const load = (): Promise<ConcreteComponent> => {
    let thisRequest: Promise<ConcreteComponent>
    // Promise
    // 让等待中的请求等于该次请求，然后执行传入的loader方法
    // 多个异步组件同时加载，多次调用load，只请求一次
    // 如果之前请求过了 直接用之前存储好的
    return (
      pendingRequest ||
      (thisRequest = pendingRequest =
        loader()
          .catch(err => {
            // 加载失败逻辑处理，错误处理
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
              // 警告： 异步组件加载加载结果为undefined
              // 如果你正在执行retry
              // 确保返回它的返回值
              warn(
                `Async component loader resolved to undefined. ` +
                  `If you are using retry(), make sure to return its return value.`
              )
            }
            // interop module default
            // 互操作模块默认 
            // 导出组件的方式为 export default，则需要将default设置为组件
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

  // 定义异步组件
  return defineComponent({
    name: 'AsyncComponentWrapper',
    // 异步加载器
    __asyncLoader: load,

    // 返回获取到的异步组件
    get __asyncResolved() {
      return resolvedComp
    },

    setup() {
      const instance = currentInstance!

      // already resolved
      // 已经获取到的组件，则直接创建内部组件就行
      if (resolvedComp) {
        // 创建内部组件并作为函数返回值
        return () => createInnerComp(resolvedComp!, instance)
      }

      /**
       * 定义错误回调函数
       * @param err 
       */
      const onError = (err: Error) => {
        pendingRequest = null
        // 处理错误
        handleError(
          err,
          instance,
          ErrorCodes.ASYNC_COMPONENT_LOADER,
          // 不要扔在dev如果用户提供的错误组件
          // 如果开发者已经定义了错误的组件，在开发环境下就不用抛出错误了
          !errorComponent /* do not throw in dev if user provided error component */
        )
      }

      // suspense-controlled or SSR.
      // suspense 控制或者SSR
      // 如果获取到组件位于 suspense 组件中，则进一步加载 suspense 中的组件
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
              // 存在错误组件，则创建对应的vnode
              errorComponent
                ? createVNode(errorComponent as ConcreteComponent, {
                    error: err
                  })
                : null
          })
      }

      // 是否已经加载，响应式变量，当它们发生改变时，触发组件的重新渲染
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
          // 超时执行错误处理函数
          if (!loaded.value && !error.value) {
            const err = new Error(
              `Async component timed out after ${timeout}ms.`
            )
            onError(err)
            error.value = err
          }
        }, timeout)
      }

      // 正常情况下，加载完异步组件后
      load()
        .then(() => {
          // 在调用load之后，会修改响应式对象loaded来触发异步组件的重新渲染
          loaded.value = true
          if (instance.parent && isKeepAlive(instance.parent.vnode)) {
            // parent is keep-alive, force update so the loaded component's
            // name is taken into account
            // 如果父节点是keep-alive，强制更新，所以被加载的组件名称被考虑
            queueJob(instance.parent.update)
          }
        })
        .catch(err => {
          onError(err)
          error.value = err
        })

      // 当异步组件重新渲染后，就会再次执行组件的render函数
      // 这其实是一个render渲染函数，返回一个要渲染的节点
      return () => {
        // 已加载，则渲染真实的组件
        if (loaded.value && resolvedComp) {
          // 加载到的时候返回组件实例节点
          return createInnerComp(resolvedComp, instance)
        } 
        // 加载失败且配置了error组件，则渲染error组件
        else if (error.value && errorComponent) {
          // 错误，返回错误组件
          return createVNode(errorComponent as ConcreteComponent, {
            error: error.value
          })
        } 
        // 配置了loading组件且没有设置延时，则直接渲染loading组件
        else if (loadingComponent && !delayed.value) {
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
