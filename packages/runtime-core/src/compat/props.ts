import { isArray } from '@vue/shared'
import { inject } from '../apiInject'
import { ComponentInternalInstance, Data } from '../component'
import { ComponentOptions, resolveMergedOptions } from '../componentOptions'
import { DeprecationTypes, warnDeprecation } from './compatConfig'

/**
 * 创建一个属性列表作为this使用
 * @param instance 
 * @param rawProps 
 * @param propKey 
 * @returns 
 */
export function createPropsDefaultThis(
  instance: ComponentInternalInstance,
  rawProps: Data,
  propKey: string
) {
  // 通过代理
  return new Proxy(
    {},
    {
      get(_, key: string) {
        // 开发环境下会有警告
        __DEV__ &&
          warnDeprecation(DeprecationTypes.PROPS_DEFAULT_THIS, null, propKey)
        // $options
        // $options的话，需要合并options
        if (key === '$options') {
          return resolveMergedOptions(instance)
        }
        // props
        // 如果key为原始属性的话，返回其对应的值
        if (key in rawProps) {
          return rawProps[key]
        }
        // injections
        // 注入
        const injections = (instance.type as ComponentOptions).inject
        // 如果注入中包含key，则返回注入的key
        if (injections) {
          if (isArray(injections)) {
            if (injections.includes(key)) {
              return inject(key)
            }
          } else if (key in injections) {
            return inject(key)
          }
        }
      }
    }
  )
}
