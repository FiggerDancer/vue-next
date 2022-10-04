import {
  currentInstance,
  ConcreteComponent,
  ComponentOptions,
  getComponentName
} from '../component'
import { currentRenderingInstance } from '../componentRenderContext'
import { Directive } from '../directives'
import { camelize, capitalize, isString } from '@vue/shared'
import { warn } from '../warning'
import { VNodeTypes } from '../vnode'

// 主要是工具方法，用于获取资源
// 主要是组件、指令、过滤器

export const COMPONENTS = 'components'
export const DIRECTIVES = 'directives'
export const FILTERS = 'filters'

/**
 * 组件/指令/过滤器
 */
export type AssetTypes = typeof COMPONENTS | typeof DIRECTIVES | typeof FILTERS

/**
 * @private
 * 获取组件
 */
export function resolveComponent(
  name: string,
  maybeSelfReference?: boolean
): ConcreteComponent | string {
  return resolveAsset(COMPONENTS, name, true, maybeSelfReference) || name
}

// 空的动态组件
export const NULL_DYNAMIC_COMPONENT = Symbol()

/**
 * @private
 * 获取动态组件
 */
export function resolveDynamicComponent(component: unknown): VNodeTypes {
  if (isString(component)) {
    // 组件是字符串
    return resolveAsset(COMPONENTS, component, false) || component
  } else {
    // invalid types will fallthrough to createVNode and raise warning
    // 失效的类型将返回createVNode并且发出警告
    return (component || NULL_DYNAMIC_COMPONENT) as any
  }
}

/**
 * @private
 * 获取指令
 */
export function resolveDirective(name: string): Directive | undefined {
  return resolveAsset(DIRECTIVES, name)
}

/**
 * v2 compat only
 * @internal
 * 兼容vue2 获取过滤器
 */
export function resolveFilter(name: string): Function | undefined {
  return resolveAsset(FILTERS, name)
}

/**
 * @private
 * overload 1: components
 * 重载1， 组件重载
 */
function resolveAsset(
  type: typeof COMPONENTS,
  name: string,
  warnMissing?: boolean,
  maybeSelfReference?: boolean
): ConcreteComponent | undefined
// overload 2: directives
// 重载2： 指令重载
function resolveAsset(
  type: typeof DIRECTIVES,
  name: string
): Directive | undefined
// implementation
// overload 3: filters (compat only)
// 实现
// 重载3： 过滤器（仅兼容性）
function resolveAsset(type: typeof FILTERS, name: string): Function | undefined
// implementation
// 实现
/**
 * 如果是实例中去获取，则看实例是否是组件
 * 是组件的话且名称与要获取的组件名称相同，则返回该组件
 * 否则检查本地信息中是否存在对应的组件，有则返回
 * 从全局上下文中去找，有则返回
 * 依然没有则根据是否可以是组件自身的引用来决定是否返回组件本身
 * @param type 
 * @param name 
 * @param warnMissing 
 * @param maybeSelfReference 
 * @returns 
 */
function resolveAsset(
  type: AssetTypes,
  name: string,
  warnMissing = true,
  maybeSelfReference = false
) {
  const instance = currentRenderingInstance || currentInstance
  
  if (instance) {
    const Component = instance.type

    // explicit self name has highest priority
    // 明确的名称有最高的优先级
    if (type === COMPONENTS) {
      const selfName = getComponentName(
        Component,
        false /* do not include inferred name to avoid breaking existing code */
      )
      if (
        selfName &&
        (selfName === name ||
          selfName === camelize(name) ||
          selfName === capitalize(camelize(name)))
      ) {
        return Component
      }
    }

    const res =
      // local registration
      // check instance[type] first which is resolved for options API
      // 本地的注册信息
      // 首先检查那些使用了options api的实例
      resolve(instance[type] || (Component as ComponentOptions)[type], name) ||
      // global registration
      // 全局注册
      resolve(instance.appContext[type], name)

    if (!res && maybeSelfReference) {
      // fallback to implicit self-reference
      // 返回内部的自己的引用
      return Component
    }

    if (__DEV__ && warnMissing && !res) {
      const extra =
        type === COMPONENTS
          ? `\nIf this is a native custom element, make sure to exclude it from ` +
            `component resolution via compilerOptions.isCustomElement.`
          : ``
      warn(`Failed to resolve ${type.slice(0, -1)}: ${name}${extra}`)
    }

    return res
  } else if (__DEV__) {
    warn(
      `resolve${capitalize(type.slice(0, -1))} ` +
        `can only be used in render() or setup().`
    )
  }
}

/**
 * 按照名字获取
 * @param registry 
 * @param name 
 * @returns 
 */
function resolve(registry: Record<string, any> | undefined, name: string) {
  return (
    registry &&
    (registry[name] ||
      registry[camelize(name)] ||
      registry[capitalize(camelize(name))])
  )
}
