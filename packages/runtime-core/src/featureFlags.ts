import { getGlobalThis } from '@vue/shared'

/**
 * This is only called in esm-bundler builds.
 * It is called when a renderer is created, in `baseCreateRenderer` so that
 * importing runtime-core is side-effects free.
 *
 * 初始化标记
 * 这仅仅被调用在esm-bundler的构建中
 * 当一个渲染器被创建时，
 * 在 `baseCreateRenderer` 中引入 runtime-core 是没有副作用的
 * istanbul-ignore-next
 */
export function initFeatureFlags() {
  // 需要警告
  const needWarn = []

  // 根据开启的特性，收集警告
  // 全局环境进行兼容项配置
  if (typeof __FEATURE_OPTIONS_API__ !== 'boolean') {
    __DEV__ && needWarn.push(`__VUE_OPTIONS_API__`)
    getGlobalThis().__VUE_OPTIONS_API__ = true
  }

  if (typeof __FEATURE_PROD_DEVTOOLS__ !== 'boolean') {
    __DEV__ && needWarn.push(`__VUE_PROD_DEVTOOLS__`)
    getGlobalThis().__VUE_PROD_DEVTOOLS__ = false
  }

  // 如果是开发者环境且需要警告
  if (__DEV__ && needWarn.length) {
    // 多个警告，则将警告中的is换成are
    const multi = needWarn.length > 1
    console.warn(
      `Feature flag${multi ? `s` : ``} ${needWarn.join(', ')} ${
        multi ? `are` : `is`
      } not explicitly defined. You are running the esm-bundler build of Vue, ` +
        `which expects these compile-time feature flags to be globally injected ` +
        `via the bundler config in order to get better tree-shaking in the ` +
        `production bundle.\n\n` +
        `For more details, see https://link.vuejs.org/feature-flags.`
    )
  }
}
