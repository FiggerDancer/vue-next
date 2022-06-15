// This entry exports the runtime only, and is built as
// `dist/vue.esm-bundler.js` which is used by default for bundlers.
// 这个入口文件仅导出运行时，并且被构建为 `dist/vue.esm-bundler.js`
// 默认使用该文件减少打包的体积
import { initDev } from './dev'
import { warn } from '@vue/runtime-dom'

if (__DEV__) {
  initDev()
}

export * from '@vue/runtime-dom'

export const compile = () => {
  if (__DEV__) {
    warn(
      `Runtime compilation is not supported in this build of Vue.` +
        (__ESM_BUNDLER__
          ? ` Configure your bundler to alias "vue" to "vue/dist/vue.esm-bundler.js".`
          : __ESM_BROWSER__
          ? ` Use "vue.esm-browser.js" instead.`
          : __GLOBAL__
          ? ` Use "vue.global.js" instead.`
          : ``) /* should not happen */
    )
  }
}
