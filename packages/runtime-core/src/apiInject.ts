import { isFunction } from '@vue/shared'
import { currentInstance } from './component'
import { currentRenderingInstance } from './componentRenderContext'
import { warn } from './warning'

// 注入key
export interface InjectionKey<T> extends Symbol {}

/**
 * 提供的键值对
 * @param key 
 * @param value 
 */
export function provide<T>(key: InjectionKey<T> | string | number, value: T) {
  // 没有当前实例
  if (!currentInstance) {
    // 开发者环境
    if (__DEV__) {
      warn(`provide() can only be used inside setup().`)
    }
  } else {
    // 获取实例的提供
    let provides = currentInstance.provides
    // by default an instance inherits its parent's provides object
    // but when it needs to provide values of its own, it creates its
    // own provides object using parent provides object as prototype.
    // this way in `inject` we can simply look up injections from direct
    // parent and let the prototype chain do the work.
    // 默认情况一个实例继承它的父级的provides对象，但是当它需要提供它自己的值时
    // 它创建它自己的provides对象，使用父级的provides对象作为原型
    // 这中方式在 `inject` 我们能够从直属父类中查找注入表并且让原型链工作
    const parentProvides =
      currentInstance.parent && currentInstance.parent.provides
    if (parentProvides === provides) {
      provides = currentInstance.provides = Object.create(parentProvides)
    }
    // TS doesn't allow symbol as index type
    // ts不允许symbol作为索引
    provides[key as string] = value
  }
}

/**
 * 注入
 * @param key 
 */
export function inject<T>(key: InjectionKey<T> | string): T | undefined
/**
 * 注入，进行默认值处理
 * @param key 
 * @param defaultValue 
 * @param treatDefaultAsFactory 
 */
export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue: T,
  treatDefaultAsFactory?: false
): T
/**
 * 注入，默认值是对象或者数组，这种引用类型
 * @param key 
 * @param defaultValue 
 * @param treatDefaultAsFactory 
 */
export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue: T | (() => T),
  treatDefaultAsFactory: true
): T
/**
 * 注入，其他未知的
 * @param key 
 * @param defaultValue 
 * @param treatDefaultAsFactory 
 * @returns 
 */
export function inject(
  key: InjectionKey<any> | string,
  defaultValue?: unknown,
  treatDefaultAsFactory = false
) {
  // fallback to `currentRenderingInstance` so that this can be called in
  // a functional component
  // 回退到当前渲染的实例上，所以它可以被调用在一个函数式组件内
  const instance = currentInstance || currentRenderingInstance
  if (instance) {
    // #2400
    // to support `app.use` plugins,
    // fallback to appContext's `provides` if the instance is at root
    // 为了支持 app.use 插件
    // 如果实例是root节点，则回退到 appContext 上的 provides
    const provides =
      instance.parent == null
        ? instance.vnode.appContext && instance.vnode.appContext.provides
        : instance.parent.provides

    if (provides && (key as string | symbol) in provides) {
      // TS doesn't allow symbol as index type
      // ts 不允许 symbol 作为索引类型
      return provides[key as string]
    } else if (arguments.length > 1) {
      // 如果参数>1说明有默认值
      // 如果传进来的值是函数，说明是个数组或者对象这种引用类型
      // 需要先执行，获取其返回值
      return treatDefaultAsFactory && isFunction(defaultValue)
        ? defaultValue.call(instance.proxy)
        : defaultValue
    } else if (__DEV__) {
      warn(`injection "${String(key)}" not found.`)
    }
  } else if (__DEV__) {
    // inject 方法只能用于 setup 或者 函数式组件
    warn(`inject() can only be used inside setup() or functional components.`)
  }
}
