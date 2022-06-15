import { warn, getCurrentInstance } from '@vue/runtime-core'
import { EMPTY_OBJ } from '@vue/shared'

export function useCssModule(name = '$style'): Record<string, string> {
  /* istanbul ignore else */
  if (!__GLOBAL__) {
    // 获取vue实例
    const instance = getCurrentInstance()!
    if (!instance) {
      // useCssModule必须在setup内调用
      __DEV__ && warn(`useCssModule must be called inside setup()`)
      return EMPTY_OBJ
    }
    // 获取组件上的cssModules对象
    const modules = instance.type.__cssModules
    if (!modules) {
      __DEV__ && warn(`Current instance does not have CSS modules injected.`)
      return EMPTY_OBJ
    }
    // 获取对应的$style样式的值
    const mod = modules[name]
    if (!mod) {
      __DEV__ &&
        warn(`Current instance does not have CSS module named "${name}".`)
      return EMPTY_OBJ
    }
    return mod as Record<string, string>
  } else {
    if (__DEV__) {
      warn(`useCssModule() is not supported in the global build.`)
    }
    return EMPTY_OBJ
  }
}
