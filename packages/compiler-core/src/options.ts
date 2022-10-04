import { ElementNode, Namespace, TemplateChildNode, ParentNode } from './ast'
import { TextModes } from './parse'
import { CompilerError } from './errors'
import {
  NodeTransform,
  DirectiveTransform,
  TransformContext
} from './transform'
import { CompilerCompatOptions } from './compat/compatConfig'
import { ParserPlugin } from '@babel/parser'

/**
 * 错误处理的选项
 * onWarn
 * onError
 */
export interface ErrorHandlingOptions {
  onWarn?: (warning: CompilerError) => void
  onError?: (error: CompilerError) => void
}

/**
 * 解析选项
 */
export interface ParserOptions
  extends ErrorHandlingOptions,
    CompilerCompatOptions {
  /**
   * e.g. platform native elements, e.g. `<div>` for browsers
   * 例如 平台的原生元素 例如 浏览器上的`<div>` 
   */
  isNativeTag?: (tag: string) => boolean
  /**
   * e.g. native elements that can self-close, e.g. `<img>`, `<br>`, `<hr>`
   * 原生元素可以自闭和的 img，br，hr
   */
  isVoidTag?: (tag: string) => boolean
  /**
   * e.g. elements that should preserve whitespace inside, e.g. `<pre>`
   * 元素应该在里面保留空格的  pre
   */
  isPreTag?: (tag: string) => boolean
  /**
   * Platform-specific built-in components e.g. `<Transition>`
   * 平台专有的内置组件 transition
   */
  isBuiltInComponent?: (tag: string) => symbol | void
  /**
   * Separate option for end users to extend the native elements list
   * 最终用户扩展本机元素列表的单独选项,自定义元素
   */
  isCustomElement?: (tag: string) => boolean | void
  /**
   * Get tag namespace
   * 获取标签命名空间
   */
  getNamespace?: (tag: string, parent: ElementNode | undefined) => Namespace
  /**
   * Get text parsing mode for this element
   * 获取此元素的文本解析模式
   */
  getTextMode?: (
    node: ElementNode,
    parent: ElementNode | undefined
  ) => TextModes
  /**
   * {{}}
   * @default ['{{', '}}']
   */
  delimiters?: [string, string]
  /**
   * Whitespace handling strategy
   * 空格处理策略，preserve保留，condense压缩
   */
  whitespace?: 'preserve' | 'condense'
  /**
   * Only needed for DOM compilers
   * 仅仅被dom编译器需要
   * 对部分特殊文本解码
   */
  decodeEntities?: (rawText: string, asAttr: boolean) => string
  /**
   * Whether to keep comments in the templates AST.
   * This defaults to `true` in development and `false` in production builds.
   * 是否保留模板ast中的注释
   * 这个默认选项是true在开发者环境中，是false在生成构建中
   */
  comments?: boolean
}

/**
 * 挂起的转化
 * children: 模板子节点
 * context: 转化的上下文
 * parent: 父节点
 */
export type HoistTransform = (
  children: TemplateChildNode[],
  context: TransformContext,
  parent: ParentNode
) => void

/**
 * 绑定的类型
 */
export const enum BindingTypes {
  /**
   * returned from data()
   * 从data中返回的值
   */
  DATA = 'data',
  /**
   * declared as a prop
   * 声明成一个prop
   */
  PROPS = 'props',
  /**
   * a local alias of a `<script setup>` destructured prop.
   * the original is stored in __propsAliases of the bindingMetadata object.
   * 一个<script setup>解构prop的作用域别名
   * 原始值别存储在__propsAliases的绑定bindingMetadata对象中
   */
  PROPS_ALIASED = 'props-aliased',
  /**
   * a let binding (may or may not be a ref)
   * 一个let绑定（可能是一个ref）
   */
  SETUP_LET = 'setup-let',
  /**
   * a const binding that can never be a ref.
   * these bindings don't need `unref()` calls when processed in inlined
   * template expressions.
   * 不可能是一个ref一个常量绑定，
   * 这些绑定不需要 unref 当处理内联模板表达式时
   */
  SETUP_CONST = 'setup-const',
  /**
   * a const binding that may be a ref.
   * 一个或许是ref的常量绑定
   */
  SETUP_MAYBE_REF = 'setup-maybe-ref',
  /**
   * bindings that are guaranteed to be refs
   * 保证是引用的绑定
   */
  SETUP_REF = 'setup-ref',
  /**
   * declared by other options, e.g. computed, inject
   * 被其他选项声明 computed， inject
   */
  OPTIONS = 'options'
}

/**
 * 绑定的数据
 */
export type BindingMetadata = {
  [key: string]: BindingTypes | undefined
} & {
  /**
   * 是否是<script setup>
   */
  __isScriptSetup?: boolean
  /**
   * setup的props存储在这
   */
  __propsAliases?: Record<string, string>
}

/**
 * 代码转化选项
 */
interface SharedTransformCodegenOptions {
  /**
   * Transform expressions like {{ foo }} to `_ctx.foo`.
   * If this option is false, the generated code will be wrapped in a
   * `with (this) { ... }` block.
   * - This is force-enabled in module mode, since modules are by default strict
   * and cannot use `with`
   * @default mode === 'module'
   * 转化表达式像 {{ foo }} 转化为 _ctx.foo
   * 如果这个选项是false，那么生成的代码将被包裹在一个 with (this) {...} 代码块中
   * 这在module模式中是强制开启的，因为module默认使用严格模式，严格模式不支持with
   */
  prefixIdentifiers?: boolean
  /**
   * Control whether generate SSR-optimized render functions instead.
   * The resulting function must be attached to the component via the
   * `ssrRender` option instead of `render`.
   *
   * When compiler generates code for SSR's fallback branch, we need to set it to false:
   *  - context.ssr = false
   *
   * see `subTransform` in `ssrTransformComponent.ts`
   * 控制是否生成ssr优化渲染函数代替  
   * 方法将生成的结果附加给组件的ssrRender而不是render
   * 
   * 当编译器需要为ssr的生成回退分支的代码时，我们需要将它设置为false
   * context.ssr = false
   * 
   * 参考`ssrTransformComponent.ts`中的`subTransform`  
   */
  ssr?: boolean
  /**
   * Indicates whether the compiler generates code for SSR,
   * it is always true when generating code for SSR,
   * regardless of whether we are generating code for SSR's fallback branch,
   * this means that when the compiler generates code for SSR's fallback branch:
   *  - context.ssr = false
   *  - context.inSSR = true
   * 暗示是否编译器为ssr生成代码
   * 当生成代码是用于ssr时，它总是true
   * 除非我们为ssr的回退分支生成代码
   * 这意味着当编译器为ssr的回退分支生成代时
   * context.ssr = false
   * context.inSSR = true
   */
  inSSR?: boolean
  /**
   * Optional binding metadata analyzed from script - used to optimize
   * binding access when `prefixIdentifiers` is enabled.
   * 选项绑定metadata被script分析，被用于优化绑定的使用，当前缀标识符被启用的时候
   */
  bindingMetadata?: BindingMetadata
  /**
   * Compile the function for inlining inside setup().
   * This allows the function to directly access setup() local bindings.
   * 编译函数在内联的setup内部
   * 这允许函数直接使用setup的局部绑定
   */
  inline?: boolean
  /**
   * Indicates that transforms and codegen should try to output valid TS code
   * 暗示转化和代码生成应该尝试输出有效的ts代码
   */
  isTS?: boolean
  /**
   * Filename for source map generation.
   * Also used for self-recursive reference in templates
   * 文件名字为sourcemap的生成
   * 也被用于模板的自我引用
   * @default 'template.vue.html'
   */
  filename?: string
}

/**
 * 转化选项
 */
export interface TransformOptions
  extends SharedTransformCodegenOptions,
    ErrorHandlingOptions,
    CompilerCompatOptions {
  /**
   * An array of node transforms to be applied to every AST node.
   * 一个node转化数组用来应用于每个ast节点
   */
  nodeTransforms?: NodeTransform[]
  /**
   * An object of { name: transform } to be applied to every directive attribute
   * node found on element nodes.
   * 一个{name: transform}对象被应用于每个指令属性节点被发现在元素节点上
   */
  directiveTransforms?: Record<string, DirectiveTransform | undefined>
  /**
   * An optional hook to transform a node being hoisted.
   * used by compiler-dom to turn hoisted nodes into stringified HTML vnodes.
   * 一个选项钩子用来转化一个被挂起的节点
   * 挂起节点被编译器用来转化成字符串化的HTML虚拟节点
   * @default null
   */
  transformHoist?: HoistTransform | null
  /**
   * If the pairing runtime provides additional built-in elements, use this to
   * mark them as built-in so the compiler will generate component vnodes
   * for them.
   * 如果配对运行时提供额外的内建元素，使用它标记他们作为内建所以编译器将生成组件节点
   */
  isBuiltInComponent?: (tag: string) => symbol | void
  /**
   * Used by some transforms that expects only native elements
   * 由只期望原生元素的一些转换使用
   * 是否是自定义组件
   */
  isCustomElement?: (tag: string) => boolean | void
  /**
   * Transform expressions like {{ foo }} to `_ctx.foo`.
   * If this option is false, the generated code will be wrapped in a
   * `with (this) { ... }` block.
   * - This is force-enabled in module mode, since modules are by default strict
   * and cannot use `with`
   * 转化表达式像{{foo}} => _ctx.foo
   * 如果这个选项是false，这个生成的代码将被包裹在一个with(this) {...}块中
   * 这是一个强制启用的module模式，因为模块默认是严格模式，不可以使用with
   * @default mode === 'module'
   */
  prefixIdentifiers?: boolean
  /**
   * Hoist static VNodes and props objects to `_hoisted_x` constants
   * 挂起的静态vnode节点和属性对象转化成_hoisted_x常量存储
   * @default false
   */
  hoistStatic?: boolean
  /**
   * Cache v-on handlers to avoid creating new inline functions on each render,
   * also avoids the need for dynamically patching the handlers by wrapping it.
   * e.g `@click="foo"` by default is compiled to `{ onClick: foo }`. With this
   * option it's compiled to:
   * ```js
   * { onClick: _cache[0] || (_cache[0] = e => _ctx.foo(e)) }
   * ```
   * - Requires "prefixIdentifiers" to be enabled because it relies on scope
   * analysis to determine if a handler is safe to cache.
   * 通过包装处理函数缓存v-on的处理函数避免创建新的内联函数，在每个渲染器上
   * 也是为了避免需要动态的跟新处理
   * 例如:  `@click="foo"` 默认被编译成 `{onClick: foo}`
   * 使用这种方式就编译成
   * ```js
   * { onClick: _cache[0] || (_cache[0] = e => _ctx.foo(e)) }
   * ```
   * 需要启用前缀标识符因为它依赖作用域分析来确定一个处理函数是否是安全的
   * @default false
   */
  cacheHandlers?: boolean
  /**
   * A list of parser plugins to enable for `@babel/parser`, which is used to
   * parse expressions in bindings and interpolations.
   * https://babeljs.io/docs/en/next/babel-parser#plugins
   * 一个用于启用babel解析的插件列表
   * 这被用于解析绑定的和内插的表达式
   */
  expressionPlugins?: ParserPlugin[]
  /**
   * SFC scoped styles ID
   * SFC作用域样式ID
   */
  scopeId?: string | null
  /**
   * Indicates this SFC template has used :slotted in its styles
   * Defaults to `true` for backwards compatibility - SFC tooling should set it
   * to `false` if no `:slotted` usage is detected in `<style>`
   * 意味这SFC模板已经使用:slotted在它的样式中
   * 为了向后兼容，默认为' true '
   * 如果没有::slotted则SFC工具应该设置它为false
   */
  slotted?: boolean
  /**
   * SFC `<style vars>` injection string
   * Should already be an object expression, e.g. `{ 'xxxx-color': color }`
   * needed to render inline CSS variables on component root
   * SFC style变量注入字符串
   * 应该已经是一个对象表达式 
   * {
   *  xxx-color: color
   * }
   * 需要被渲染成内联css变量在组件根节点上
   */
  ssrCssVars?: string
}

/**
 * 代码生成选项
 */
export interface CodegenOptions extends SharedTransformCodegenOptions {
  /**
   * - `module` mode will generate ES module import statements for helpers
   * and export the render function as the default export.
   * - `function` mode will generate a single `const { helpers... } = Vue`
   * statement and return the render function. It expects `Vue` to be globally
   * available (or passed by wrapping the code with an IIFE). It is meant to be
   * used with `new Function(code)()` to generate a render function at runtime.
   * 
   * module模式将生成es模块引入语句用于帮助函数和导出渲染函数作为默认的导出
   * function模式将生成一个单独`const {helpers...} = Vue`的语句用来返回渲染函数。它期望Vue是一个全局变量（或者通过一个IIFE函数包裹被传递）。它意味着在运行时使用new Function(code)() 来生成一个渲染函数
   * @default 'function'
   */
  mode?: 'module' | 'function'
  /**
   * Generate source map?
   * 生成sourcemap
   * @default false
   */
  sourceMap?: boolean
  /**
   * SFC scoped styles ID
   * SFC作用域样式ID
   */
  scopeId?: string | null
  /**
   * Option to optimize helper import bindings via variable assignment
   * (only used for webpack code-split)
   * 选项用于优化帮助函数引入绑定通过变量赋值
   * 仅仅适用于webpack的代码划分
   * @default false
   */
  optimizeImports?: boolean
  /**
   * Customize where to import runtime helpers from.
   * 定义从哪里引入运行时帮助函数
   * @default 'vue'
   */
  runtimeModuleName?: string
  /**
   * Customize where to import ssr runtime helpers from/**
   * 定义从哪里引入ssr运行时帮助函数
   * @default 'vue/server-renderer'
   */
  ssrRuntimeModuleName?: string
  /**
   * Customize the global variable name of `Vue` to get helpers from
   * in function mode
   * 自定义全局变量名称Vue来获取帮助函数从函数模式中
   * @default 'Vue'
   */
  runtimeGlobalName?: string
}

export type CompilerOptions = ParserOptions & TransformOptions & CodegenOptions
