/* eslint-disable no-restricted-globals */
import { ComponentInternalInstance, formatComponentName } from './component'
import { devtoolsPerfEnd, devtoolsPerfStart } from './devtools'

/**
 * 是否支持标记
 */
let supported: boolean
/**
 * 性能
 */
let perf: Performance

/**
 * 记录执行开始方法（某实例构建开始时）在performance面板中标记
 * @param instance 
 * @param type 
 */
export function startMeasure(
  instance: ComponentInternalInstance,
  type: string
) {
  // 实例app上下文配置的performance 且 浏览器是支持的
  if (instance.appContext.config.performance && isSupported()) {
    // 在performance中去标记
    perf.mark(`vue-${type}-${instance.uid}`)
  }

  // 开发者工具开始记录执行开始时间
  if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
    devtoolsPerfStart(instance, type, supported ? perf.now() : Date.now())
  }
}

/**
 * 结束实现某实例构建的时，给出标记
 * @param instance 
 * @param type 
 */
export function endMeasure(instance: ComponentInternalInstance, type: string) {
  if (instance.appContext.config.performance && isSupported()) {
    const startTag = `vue-${type}-${instance.uid}`
    const endTag = startTag + `:end`
    perf.mark(endTag)
    perf.measure(
      `<${formatComponentName(instance, instance.type)}> ${type}`,
      startTag,
      endTag
    )
    // 清理标记
    perf.clearMarks(startTag)
    perf.clearMarks(endTag)
  }

  // 开发者工具统计执行结束时间
  if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
    devtoolsPerfEnd(instance, type, supported ? perf.now() : Date.now())
  }
}

/**
 * 浏览器是否支持 performance
 * @returns 
 */
function isSupported() {
  if (supported !== undefined) {
    return supported
  }
  if (typeof window !== 'undefined' && window.performance) {
    supported = true
    perf = window.performance
  } else {
    supported = false
  }
  return supported
}
