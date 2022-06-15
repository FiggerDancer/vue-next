// This entry is the "full-build" that includes both the runtime
// and the compiler, and supports on-the-fly compilation of the template option.
// 这个入口文件是全量打包包含运行时和编译时，并且支持运行时模板编译
import { initDev } from './dev'
import { compile, CompilerOptions, CompilerError } from '@vue/compiler-dom'
import { registerRuntimeCompiler, RenderFunction, warn } from '@vue/runtime-dom'
import * as runtimeDom from '@vue/runtime-dom'
import { isString, NOOP, generateCodeFrame, extend } from '@vue/shared'
import { InternalRenderFunction } from 'packages/runtime-core/src/component'

if (__DEV__) {
  initDev()
}

const compileCache: Record<string, RenderFunction> = Object.create(null)

// 定义编译函数
// 为浏览器平台单独编写一个编译函数
function compileToFunction(
  template: string | HTMLElement,
  options?: CompilerOptions
): RenderFunction {
  if (!isString(template)) { // 选择器
    // dom对象
    if (template.nodeType) {
      // 从宿主元素的innerHTML中获取模板
      template = template.innerHTML
    } else {
      // 返回一个空函数，防止程序卡死，并给出警告
      __DEV__ && warn(`invalid template option: `, template)
      return NOOP
    }
  }

  const key = template
  // 对编译过的模板进行缓存
  const cached = compileCache[key]
  if (cached) {
    return cached
  }

  // 用户传入的是选择器 如#app，可以注意到只支持id选择器
  if (template[0] === '#') {
    const el = document.querySelector(template)
    if (__DEV__ && !el) {
      warn(`Template element not found or is empty: ${template}`)
    }
    // __UNSAFE__
    // Reason: potential execution of JS expressions in in-DOM template.
    // The user must make sure the in-DOM template is trusted. If it's rendered
    // by the server, the template should not contain any user data.
    // 不安全
    // 原因：dom模板中潜在的js表达式会执行
    // 用户必须保证dom模板是安全的，如果它被服务器渲染，模板不应该包含任何用户数据
    template = el ? el.innerHTML : ``
  }

  // 编译成code
  const { code } = compile(
    template,
    extend(
      {
        hoistStatic: true,
        onError: __DEV__ ? onError : undefined,
        onWarn: __DEV__ ? e => onError(e, true) : NOOP
      } as CompilerOptions,
      options
    )
  )

  // 错误回调
  function onError(err: CompilerError, asWarning = false) {
    const message = asWarning
      ? err.message
      : `Template compilation error: ${err.message}`
    const codeFrame =
      err.loc &&
      generateCodeFrame(
        template as string,
        err.loc.start.offset,
        err.loc.end.offset
      )
    warn(codeFrame ? `${message}\n${codeFrame}` : message)
  }

  // The wildcard import results in a huge object with every export
  // with keys that cannot be mangled, and can be quite heavy size-wise.
  // In the global build we know `Vue` is available globally so we can avoid
  // the wildcard object.
  // 重复的通配符对象对内存等的使用很重，我们可以通过缓存的方式避免
  const render = (
    __GLOBAL__ ? new Function(code)() : new Function('Vue', code)(runtimeDom)
  ) as RenderFunction

  // mark the function as runtime compiled
  // 标记这个方法是一个运行时编译过的函数
  ;(render as InternalRenderFunction)._rc = true

  return (compileCache[key] = render)
}

// 注册运行时编译器
registerRuntimeCompiler(compileToFunction)

export { compileToFunction as compile }
export * from '@vue/runtime-dom'
