import { inject } from '../apiInject'
import { warn } from '../warning'

export const ssrContextKey = Symbol(__DEV__ ? `ssrContext` : ``)

export const useSSRContext = <T = Record<string, any>>() => {
  // 非全局构建
  if (!__GLOBAL__) {
    // 获取上下文
    const ctx = inject<T>(ssrContextKey)
    if (!ctx) {
      // 没有上下文则警告
      warn(
        `Server rendering context not provided. Make sure to only call ` +
          `useSSRContext() conditionally in the server build.`
      )
    }
    // 返回上下文
    return ctx
  } else if (__DEV__) {
    // 全局构建，直接警告，useSSRContext不支持全局构建
    warn(`useSSRContext() is not supported in the global build.`)
  }
}
