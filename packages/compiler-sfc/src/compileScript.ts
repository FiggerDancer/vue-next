import MagicString from 'magic-string'
import {
  BindingMetadata,
  BindingTypes,
  createRoot,
  NodeTypes,
  transform,
  parserOptions,
  UNREF,
  SimpleExpressionNode,
  isFunctionType,
  walkIdentifiers
} from '@vue/compiler-dom'
import { SFCDescriptor, SFCScriptBlock } from './parse'
import { parse as _parse, ParserOptions, ParserPlugin } from '@babel/parser'
import { camelize, capitalize, generateCodeFrame, makeMap } from '@vue/shared'
import {
  Node,
  Declaration,
  ObjectPattern,
  ObjectExpression,
  ArrayPattern,
  Identifier,
  ExportSpecifier,
  TSType,
  TSTypeLiteral,
  TSFunctionType,
  ObjectProperty,
  ArrayExpression,
  Statement,
  CallExpression,
  RestElement,
  TSInterfaceBody,
  AwaitExpression,
  Program,
  ObjectMethod,
  LVal,
  Expression
} from '@babel/types'
import { walk } from 'estree-walker'
import { RawSourceMap } from 'source-map'
import {
  CSS_VARS_HELPER,
  genCssVarsCode,
  genNormalScriptCssVarsCode
} from './cssVars'
import { compileTemplate, SFCTemplateCompileOptions } from './compileTemplate'
import { warnOnce } from './warn'
import { rewriteDefault } from './rewriteDefault'
import { createCache } from './cache'
import { shouldTransform, transformAST } from '@vue/reactivity-transform'

// Special compiler macros
// 特殊的编译宏
const DEFINE_PROPS = 'defineProps'
const DEFINE_EMITS = 'defineEmits'
const DEFINE_EXPOSE = 'defineExpose'
const WITH_DEFAULTS = 'withDefaults'

// constants
// 默认值变量
const DEFAULT_VAR = `__default__`

/**
 * 内置指令
 */
const isBuiltInDir = makeMap(
  `once,memo,if,else,else-if,slot,text,html,on,bind,model,show,cloak,is`
)

/**
 * SFC的编译选项
 */
export interface SFCScriptCompileOptions {
  /**
   * Scope ID for prefixing injected CSS variables.
   * This must be consistent with the `id` passed to `compileStyle`.
   * 为注入的CSS变量添加前缀的作用域ID。
   * 这必须与传递给' compileStyle '的' id '一致。
   */
  id: string
  /**
   * Production mode. Used to determine whether to generate hashed CSS variables
   * 生产模式。用于确定是否生成散列CSS变量
   */
  isProd?: boolean
  /**
   * Enable/disable source map. Defaults to true.
   * 启用/禁用源地图。默认值为true。
   */
  sourceMap?: boolean
  /**
   * https://babeljs.io/docs/en/babel-parser#plugins
   */
  babelParserPlugins?: ParserPlugin[]
  /**
   * (Experimental) Enable syntax transform for using refs without `.value` and
   * using destructured props with reactivity
   * 实验性  为了使用refs不用`.value`启用类型转化并且使reactivity具有解构属性的功能
   */
  reactivityTransform?: boolean
  /**
   * (Experimental) Enable syntax transform for using refs without `.value`
   * https://github.com/vuejs/rfcs/discussions/369
   * 实验性
   * 启用语法转化为了在使用refs的时候不用`.value`
   * @deprecated now part of `reactivityTransform` 废弃  现在是reactivityTransform的一部分
   * @default false
   */
  refTransform?: boolean
  /**
   * (Experimental) Enable syntax transform for destructuring from defineProps()
   * 实验性 启用语法转化为了在解构来自defineProps的属性
   * https://github.com/vuejs/rfcs/discussions/394
   * @deprecated now part of `reactivityTransform` 废弃  现在是reactivityTransform的一部分
   * @default false
   */
  propsDestructureTransform?: boolean
  /**
   * @deprecated use `reactivityTransform` instead. 废弃  使用reactivityTransform代替
   */
  refSugar?: boolean
  /**
   * Compile the template and inline the resulting render function
   * directly inside setup().
   * - Only affects `<script setup>`
   * - This should only be used in production because it prevents the template
   * from being hot-reloaded separately from component state.
   * 编译template并直接在setup中内联生成的渲染函数
   * 仅影响 `<script setup>`
   * 这应该仅仅被用在生产环境中因为它阻止模板从组件状态单独热重新加载。
   */
  inlineTemplate?: boolean
  /**
   * Options for template compilation when inlining. Note these are options that
   * would normally be passed to `compiler-sfc`'s own `compileTemplate()`, not
   * options passed to `compiler-dom`.
   * 内联时模板编译的选项。
   * 注意这些选项
   * 通常会被传递给' compiler-sfc '自己的' compileTemplate() '，而不是选项传递给' compiler-dom '。
   */
  templateOptions?: Partial<SFCTemplateCompileOptions>
}

/**
 * 引入绑定
 */
export interface ImportBinding {
  /** ts类型 */
  isType: boolean
  /**
   * 被xxx引入
   */
  imported: string
  /**
   * 源
   */
  source: string
  /**
   * 是否来自setup
   */
  isFromSetup: boolean
  /**
   * 是否被用于模板
   */
  isUsedInTemplate: boolean
}

/**
 * Compile `<script setup>`
 * It requires the whole SFC descriptor because we need to handle and merge
 * normal `<script>` + `<script setup>` if both are present.
 * 编译 `<script setup>`
 * 它需要整个SFC描述
 * 因为我们需要处理和合并普通的`<script>` + `<script setup>`
 * 如果两个都存在
 */
export function compileScript(
  sfc: SFCDescriptor,
  options: SFCScriptCompileOptions
): SFCScriptBlock {
  let { script, scriptSetup, source, filename } = sfc
  // feature flags
  // TODO remove support for deprecated options when out of experimental
  // 特性标记
  // 接下来：在超出实验范围时，删除对已弃用选项的支持
  // 是否启用 reactivity转化 ref 不带 .value, reactivity可解构
  const enableReactivityTransform =
    !!options.reactivityTransform ||
    !!options.refSugar ||
    !!options.refTransform
  // props可以解构
  const enablePropsTransform =
    !!options.reactivityTransform || !!options.propsDestructureTransform
  // 生产环境
  const isProd = !!options.isProd
  // sourceMap
  const genSourceMap = options.sourceMap !== false
  // ref绑定
  let refBindings: string[] | undefined

  if (!options.id) {
    warnOnce(
      `compileScript now requires passing the \`id\` option.\n` +
        `Upgrade your vite or vue-loader version for compatibility with ` +
        `the latest experimental proposals.`
    )
  }

  // 作用域id
  const scopeId = options.id ? options.id.replace(/^data-v-/, '') : ''
  // css 变量
  const cssVars = sfc.cssVars
  // script lang 获取是否是ts，tsx
  const scriptLang = script && script.lang
  const scriptSetupLang = scriptSetup && scriptSetup.lang
  const isTS =
    scriptLang === 'ts' ||
    scriptLang === 'tsx' ||
    scriptSetupLang === 'ts' ||
    scriptSetupLang === 'tsx'

  // resolve parser plugins
  // 获取解析插件
  const plugins: ParserPlugin[] = []
  // 如果不是ts或者是tsx，则插件中需要添加jsx
  if (!isTS || scriptLang === 'tsx' || scriptSetupLang === 'tsx') {
    plugins.push('jsx')
  }
  // 如果需要babel解析，则加入babel解析插件
  if (options.babelParserPlugins) plugins.push(...options.babelParserPlugins)
  // ts需要加入的插件
  if (isTS) plugins.push('typescript', 'decorators-legacy')

  // 如果没有<script setup>
  if (!scriptSetup) {
    // 又没有<script> 抛错
    if (!script) {
      throw new Error(`[@vue/compiler-sfc] SFC contains no <script> tags.`)
    }
    // js或者ts  不是tsx或者jsx
    if (scriptLang && !isTS && scriptLang !== 'jsx') {
      // do not process non js/ts script blocks
      // 不处理js和ts脚本块
      return script
    }
    try {
      // 脚本内容
      let content = script.content
      let map = script.map
      // 解析脚本获取其ast树
      const scriptAst = _parse(content, {
        plugins,
        sourceType: 'module'
      }).program
      // 从ast中获取脚本绑定值
      const bindings = analyzeScriptBindings(scriptAst.body)
      // 启用语义转化
      if (enableReactivityTransform && shouldTransform(content)) {
        // 魔法字符串
        const s = new MagicString(source)
        // script在整个sfc中起始偏移位置
        const startOffset = script.loc.start.offset
        // script的闭合标签在整个sfc中结尾偏移位置
        const endOffset = script.loc.end.offset
        // 被引入的帮助函数
        const { importedHelpers } = transformAST(scriptAst, s, startOffset)
        // 被引入的帮助函数
        if (importedHelpers.length) {
          // 在前面追加，要引入的帮助函数
          s.prepend(
            `import { ${importedHelpers
              .map(h => `${h} as _${h}`)
              .join(', ')} } from 'vue'\n`
          )
        }
        // 将script外的东西删除掉，比如template style
        s.remove(0, startOffset)
        s.remove(endOffset, source.length)
        // 获取script中的内容
        content = s.toString()
        // 如果要生成sourceMap
        if (genSourceMap) {
          // 将script中的代码生成map
          map = s.generateMap({
            source: filename,
            hires: true,
            includeContent: true
          }) as unknown as RawSourceMap
        }
      }
      // 存在css变量
      if (cssVars.length) {
        // 重写默认值
        content = rewriteDefault(content, DEFAULT_VAR, plugins)
        // 获取普通脚本的css变量代码
        content += genNormalScriptCssVarsCode(
          cssVars,
          bindings,
          scopeId,
          isProd
        )
        content += `\nexport default ${DEFAULT_VAR}`
      }
      return {
        ...script,
        content,
        map,
        bindings,
        scriptAst: scriptAst.body
      }
    } catch (e: any) {
      // silently fallback if parse fails since user may be using custom
      // babel syntax
      // 如果解析失败，则静默回退，因为用户可能正在使用自定义babel语法
      return script
    }
  }

  // 如果script和script setup的语法不同，则抛错
  if (script && scriptLang !== scriptSetupLang) {
    throw new Error(
      `[@vue/compiler-sfc] <script> and <script setup> must have the same ` +
        `language type.`
    )
  }

  if (scriptSetupLang && !isTS && scriptSetupLang !== 'jsx') {
    // do not process non js/ts script blocks
    // 不处理非js或者ts的脚本块
    return scriptSetup
  }

  // metadata that needs to be returned
  // 需要被返回的metadata
  const bindingMetadata: BindingMetadata = {}
  // 帮助函数引入
  const helperImports: Set<string> = new Set()
  // 用户引入
  const userImports: Record<string, ImportBinding> = Object.create(null)
  // 用户引入别名
  const userImportAlias: Record<string, string> = Object.create(null)
  // 脚本绑定
  const scriptBindings: Record<string, BindingTypes> = Object.create(null)
  // setup绑定
  const setupBindings: Record<string, BindingTypes> = Object.create(null)

  // 默认导出
  let defaultExport: Node | undefined
  // 有调用defineProps宏
  let hasDefinePropsCall = false
  // 有调用defineEmit宏
  let hasDefineEmitCall = false
  // 有调用defineExpose宏
  let hasDefineExposeCall = false
  // props运行时声明
  let propsRuntimeDecl: Node | undefined
  // props运行时默认值
  let propsRuntimeDefaults: ObjectExpression | undefined
  // props解构声明
  let propsDestructureDecl: Node | undefined
  // props解构依赖的Id
  let propsDestructureRestId: string | undefined
  // props ts声明
  let propsTypeDecl: TSTypeLiteral | TSInterfaceBody | undefined
  // props ts 声明原始值
  let propsTypeDeclRaw: Node | undefined
  // props标识符
  let propsIdentifier: string | undefined
  // 触发事项运行时声明
  let emitsRuntimeDecl: Node | undefined
  // 触发事项 ts 声明
  let emitsTypeDecl:
    | TSFunctionType
    | TSTypeLiteral
    | TSInterfaceBody
    | undefined
  // 触发事项 ts 声明原始值
  let emitsTypeDeclRaw: Node | undefined
  // 触发标识符
  let emitIdentifier: string | undefined
  // 已经await
  let hasAwait = false
  // 存在内联的ssr渲染函数
  let hasInlinedSsrRenderFn = false
  // props/emits declared via types
  // props/emits 声明变量类型
  const typeDeclaredProps: Record<string, PropTypeData> = {}
  // ts 声明事项
  const typeDeclaredEmits: Set<string> = new Set()
  // record declared types for runtime props type generation
  // 记录声明类型用于运行时props类型生成
  const declaredTypes: Record<string, string[]> = {}
  // props destructure data
  // props解构data
  const propsDestructuredBindings: Record<
    string, // public prop key 公共prop key
    {
      local: string // local identifier, may be different 本地标识符，或许是不同的
      default?: Expression
    }
  > = Object.create(null)

  // magic-string state
  // 魔幻字符串状态
  const s = new MagicString(source)
  /**
   * script setup开始的偏移量
   */
  const startOffset = scriptSetup.loc.start.offset
  /**
   * script setup结束的偏移量
   */
  const endOffset = scriptSetup.loc.end.offset
  /**
   * script 开始的偏移量
   */
  const scriptStartOffset = script && script.loc.start.offset
  /**
   * script 结束的偏移量
   */
  const scriptEndOffset = script && script.loc.end.offset

  /**
   * 帮助函数
   * @param key 
   * @returns 
   */
  function helper(key: string): string {
    helperImports.add(key)
    return `_${key}`
  }

  /**
   * 解析
   * @param input 
   * @param options 
   * @param offset 
   * @returns 
   */
  function parse(
    input: string,
    options: ParserOptions,
    offset: number
  ): Program {
    try {
      // 返回解析结果
      return _parse(input, options).program
    } catch (e: any) {
      // 错误信息
      e.message = `[@vue/compiler-sfc] ${e.message}\n\n${
        sfc.filename
      }\n${generateCodeFrame(source, e.pos + offset, e.pos + offset + 1)}`
      throw e
    }
  }

  /**
   * 错误
   * @param msg 
   * @param node 
   * @param end 
   */
  function error(
    msg: string,
    node: Node,
    end: number = node.end! + startOffset
  ): never {
    throw new Error(
      `[@vue/compiler-sfc] ${msg}\n\n${sfc.filename}\n${generateCodeFrame(
        source,
        node.start! + startOffset,
        end
      )}`
    )
  }

  /**
   * 注册用户导入
   * import { imported as local } from source
   * @param source 资源文件
   * @param local 在当前文件中别名
   * @param imported 被导入的变量
   * @param isType 
   * @param isFromSetup 
   */
  function registerUserImport(
    source: string,
    local: string,
    imported: string | false,
    isType: boolean,
    isFromSetup: boolean
  ) {
    // 资源是vue
    if (source === 'vue' && imported) {
      userImportAlias[imported] = local
    }

    // 在模板中被使用
    let isUsedInTemplate = true
    // 是ts且sfc中有template，且template没有src和lang
    if (isTS && sfc.template && !sfc.template.src && !sfc.template.lang) {
      isUsedInTemplate = isImportUsed(local, sfc)
    }

    userImports[local] = {
      isType,
      imported: imported || 'default',
      source,
      isFromSetup,
      isUsedInTemplate
    }
  }

  /**
   * 处理defineProps宏
   * @param node 
   * @param declId 
   * @returns 
   */
  function processDefineProps(node: Node, declId?: LVal): boolean {
    // node不是一个defineProps调用，则返回false
    if (!isCallOf(node, DEFINE_PROPS)) {
      return false
    }

    if (hasDefinePropsCall) {
      // 已经有了  重复报错（一个sfc文件只能有一个）
      error(`duplicate ${DEFINE_PROPS}() call`, node)
    }
    // 修改标记
    hasDefinePropsCall = true

    // props运行时声明
    propsRuntimeDecl = node.arguments[0]

    // call has type parameters - infer runtime types from it
    // 调用有参数类型时 根据参数类型推断运行时类型
    if (node.typeParameters) {
      // 有props运行时声明抛错
      if (propsRuntimeDecl) {
        error(
          `${DEFINE_PROPS}() cannot accept both type and non-type arguments ` +
            `at the same time. Use one or the other.`,
          node
        )
      }

      // props ts声明的原始值
      propsTypeDeclRaw = node.typeParameters.params[0]
      // props ts声明  由原始类型获取限定的类型
      propsTypeDecl = resolveQualifiedType(
        propsTypeDeclRaw,
        node => node.type === 'TSTypeLiteral'
      ) as TSTypeLiteral | TSInterfaceBody | undefined

      // 没有props类型声明抛错
      if (!propsTypeDecl) {
        error(
          `type argument passed to ${DEFINE_PROPS}() must be a literal type, ` +
            `or a reference to an interface or literal type.`,
          propsTypeDeclRaw
        )
      }
    }

    // 存在声明Id
    if (declId) {
      // 启用props转化，声明id的类型是对象模式
      if (enablePropsTransform && declId.type === 'ObjectPattern') {
        propsDestructureDecl = declId
        // props destructure - handle compilation sugar
        // 属性解构 - 处理编译糖
        for (const prop of declId.properties) {
          // prop是对象属性
          if (prop.type === 'ObjectProperty') {
            // prop中存在计算属性，报错
            if (prop.computed) {
              error(
                `${DEFINE_PROPS}() destructure cannot use computed key.`,
                prop.key
              )
            }
            // prop的key
            const propKey = (prop.key as Identifier).name
            // 是赋值表达式
            if (prop.value.type === 'AssignmentPattern') {
              // default value { foo = 123 }
              // 默认值 { foo = 123 }
              const { left, right } = prop.value
              // 左边不是标识符
              if (left.type !== 'Identifier') {
                error(
                  `${DEFINE_PROPS}() destructure does not support nested patterns.`,
                  left
                )
              }
              // store default value
              // 存储默认值
              propsDestructuredBindings[propKey] = {
                local: left.name,
                default: right
              }
            } else if (prop.value.type === 'Identifier') {
              // simple destructure
              // 简单解构
              propsDestructuredBindings[propKey] = {
                local: prop.value.name
              }
            } else {
              // 不支持嵌套模式
              error(
                `${DEFINE_PROPS}() destructure does not support nested patterns.`,
                prop.value
              )
            }
          } else {
            // rest spread
            // 不是对象的话，获取其扩展参数
            propsDestructureRestId = (prop.argument as Identifier).name
          }
        }
      } else {
        // props标识符
        propsIdentifier = scriptSetup!.content.slice(declId.start!, declId.end!)
      }
    }

    return true
  }

  /**
   * 处理默认值
   * @param node 
   * @param declId 
   * @returns 
   */
  function processWithDefaults(node: Node, declId?: LVal): boolean {
    // 节点不是withDefaults调用节点
    if (!isCallOf(node, WITH_DEFAULTS)) {
      return false
    }
    // 如果内部存在defineProps
    if (processDefineProps(node.arguments[0], declId)) {
      // 如果props运行时声明存在抛错
      if (propsRuntimeDecl) {
        error(
          `${WITH_DEFAULTS} can only be used with type-based ` +
            `${DEFINE_PROPS} declaration.`,
          node
        )
      }
      // props解构声明存在抛错
      // 对于解构的props，withDefaults是没必要的
      // 更推荐 const { foo = 1 } = defineProps(...) 
      if (propsDestructureDecl) {
        error(
          `${WITH_DEFAULTS}() is unnecessary when using destructure with ${DEFINE_PROPS}().\n` +
            `Prefer using destructure default values, e.g. const { foo = 1 } = defineProps(...).`,
          node.callee
        )
      }
      // props运行时默认值
      propsRuntimeDefaults = node.arguments[1] as ObjectExpression
      if (
        !propsRuntimeDefaults ||
        propsRuntimeDefaults.type !== 'ObjectExpression'
      ) {
        // props运行值不存在或者 
        // props运行时默认值的类型不是对象表达式
        // 抛错 第二个参数必须是一个对象字面量
        error(
          `The 2nd argument of ${WITH_DEFAULTS} must be an object literal.`,
          propsRuntimeDefaults || node
        )
      }
    } else {
      // 第一个参数必须是一个defineProps调用
      error(
        `${WITH_DEFAULTS}' first argument must be a ${DEFINE_PROPS} call.`,
        node.arguments[0] || node
      )
    }
    return true
  }

  /**
   * 处理defineEmits宏
   * @param node 
   * @param declId 
   * @returns 
   */
  function processDefineEmits(node: Node, declId?: LVal): boolean {
    if (!isCallOf(node, DEFINE_EMITS)) {
      return false
    }
    // 重复抛错
    if (hasDefineEmitCall) {
      error(`duplicate ${DEFINE_EMITS}() call`, node)
    }
    hasDefineEmitCall = true
    // 触发事项运行时声明
    emitsRuntimeDecl = node.arguments[0]
    // 如果节点存在ts参数
    if (node.typeParameters) {
      // 如果触发事项运行时存在抛错
      // defineEmits不能同时接收有类型和无类型的参数，
      // 只能使用其中一个
      if (emitsRuntimeDecl) {
        error(
          `${DEFINE_EMITS}() cannot accept both type and non-type arguments ` +
            `at the same time. Use one or the other.`,
          node
        )
      }

      // 触发事项类型原始值
      emitsTypeDeclRaw = node.typeParameters.params[0]
      // 触发事项类型声明
      emitsTypeDecl = resolveQualifiedType(
        emitsTypeDeclRaw,
        node => node.type === 'TSFunctionType' || node.type === 'TSTypeLiteral'
      ) as TSFunctionType | TSTypeLiteral | TSInterfaceBody | undefined

      // 如果没有触发类型声明
      if (!emitsTypeDecl) {
        error(
          `type argument passed to ${DEFINE_EMITS}() must be a function type, ` +
            `a literal type with call signatures, or a reference to the above types.`,
          emitsTypeDeclRaw
        )
      }
    }

    // 声明Id
    if (declId) {
      // 声明标识符
      emitIdentifier = scriptSetup!.content.slice(declId.start!, declId.end!)
    }

    return true
  }

  /**
   * 获取限定类型
   * @param node 
   * @param qualifier 限定函数
   * @returns 
   */
  function resolveQualifiedType(
    node: Node,
    qualifier: (node: Node) => boolean
  ) {
    // 本身就是限定类型直接返回
    if (qualifier(node)) {
      return node
    }
    // 节点类型为类型引用，节点为标识符
    if (
      node.type === 'TSTypeReference' &&
      node.typeName.type === 'Identifier'
    ) {
      const refName = node.typeName.name
      /**
       * 判断是否是限定类型
       * @param node 
       * @returns 
       */
      const isQualifiedType = (node: Node): Node | undefined => {
        // interface T {body} => {body}
        if (
          node.type === 'TSInterfaceDeclaration' &&
          node.id.name === refName
        ) {
          // 如果node类型为ts 接口声明且节点的同节点的引用名称，返回body
          return node.body
        } else if (
          node.type === 'TSTypeAliasDeclaration' &&
          node.id.name === refName &&
          qualifier(node.typeAnnotation)
        ) {
          // 别名声明且同节为
          // 返回节点的注释
          return node.typeAnnotation
        } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
          // 如果节点类型是导出名称声明，则递归校验该声明
          return isQualifiedType(node.declaration)
        }
      }
      // 获取脚本的内容并合并
      const body = scriptAst
        ? [...scriptSetupAst.body, ...scriptAst.body]
        : scriptSetupAst.body
      // 遍历所有节点，对所有脚本的判断
      for (const node of body) {
        const qualified = isQualifiedType(node)
        if (qualified) {
          // 其中有一个在限定范围内，返回
          return qualified
        }
      }
    }
  }

  /**
   * 处理defineExpose宏
   * @param node 
   * @returns 
   */
  function processDefineExpose(node: Node): boolean {
    if (isCallOf(node, DEFINE_EXPOSE)) {
      if (hasDefineExposeCall) {
        error(`duplicate ${DEFINE_EXPOSE}() call`, node)
      }
      hasDefineExposeCall = true
      return true
    }
    return false
  }

  /**
   * 检查有效的作用域引用
   * @param node 
   * @param method 
   * @returns 
   */
  function checkInvalidScopeReference(node: Node | undefined, method: string) {
    if (!node) return
    // 遍历所有的标识符，并且对于setupBindings中不存在的引用抛错
    walkIdentifiers(node, id => {
      if (setupBindings[id.name]) {
        // method() 在 <script setup>中不能够引用当前作用域下声明的变量，
        // 因为它将被提升到setup函数外面
        // 如果你的组件选项需要在模块化作用域中初始化，
        // 使用一个单独的<script>导出这些选项
        error(
          `\`${method}()\` in <script setup> cannot reference locally ` +
            `declared variables because it will be hoisted outside of the ` +
            `setup() function. If your component options require initialization ` +
            `in the module scope, use a separate normal <script> to export ` +
            `the options instead.`,
          id
        )
      }
    })
  }

  /**
   * await foo()
   * -->
   * ;(
   *   ([__temp,__restore] = withAsyncContext(() => foo())),
   *   await __temp,
   *   __restore()
   * )
   *
   * const a = await foo()
   * -->
   * const a = (
   *   ([__temp, __restore] = withAsyncContext(() => foo())),
   *   __temp = await __temp,
   *   __restore(),
   *   __temp
   * )
   * 处理await
   */
  function processAwait(
    node: AwaitExpression,
    needSemi: boolean,
    isStatement: boolean
  ) {
    // 参数开始
    const argumentStart =
      node.argument.extra && node.argument.extra.parenthesized
        ? (node.argument.extra.parenStart as number)
        : node.argument.start!

    // 参数截取字符串
    const argumentStr = source.slice(
      argumentStart + startOffset,
      node.argument.end! + startOffset
    )

    // 包含嵌套的await
    const containsNestedAwait = /\bawait\b/.test(argumentStr)

    /** 
     * ;(
     *  ([_temp, _restore] = withAsyncContext(async () => node)),
     *  __temp = await __temp,
     *  __restore()
     *  __temp
     * )
     * */
    // 覆盖这部分，重写这部分代码
    s.overwrite(
      node.start! + startOffset,
      argumentStart + startOffset,
      `${needSemi ? `;` : ``}(\n  ([__temp,__restore] = ${helper(
        `withAsyncContext`
      )}(${containsNestedAwait ? `async ` : ``}() => `
    )
    // 添加到节点后面，补全前文的括号
    s.appendLeft(
      node.end! + startOffset,
      `)),\n  ${isStatement ? `` : `__temp = `}await __temp,\n  __restore()${
        isStatement ? `` : `,\n  __temp`
      }\n)`
    )
  }

  /**
   * check defaults. If the default object is an object literal with only
   * static properties, we can directly generate more optimized default
   * declarations. Otherwise we will have to fallback to runtime merging.
   * 检查默认值
   * 如果默认对象是一个带有静态属性的对象字面量
   * 我们能够直接生成更多被优化的默认声明
   * 否则我们将不得不回退到运行时合并
   */
  function hasStaticWithDefaults() {
    return (
      propsRuntimeDefaults &&
      propsRuntimeDefaults.type === 'ObjectExpression' &&
      propsRuntimeDefaults.properties.every(
        node =>
          (node.type === 'ObjectProperty' && !node.computed) ||
          node.type === 'ObjectMethod'
      )
    )
  }

  /**
   * 生成运行时props
   * keys
   * @param props 
   * @returns 
   */
  function genRuntimeProps(props: Record<string, PropTypeData>) {
    const keys = Object.keys(props)
    if (!keys.length) {
      return ``
    }
    // 存在静态的默认值
    const hasStaticDefaults = hasStaticWithDefaults()
    // 脚本setup资源
    const scriptSetupSource = scriptSetup!.content
    // props声明
    let propsDecls = `{
    ${keys
      .map(key => {
        let defaultString: string | undefined
        // 生成解构默认值
        const destructured = genDestructuredDefaultValue(key)
        // 存在解构默认值
        if (destructured) {
          defaultString = `default: ${destructured}`
        } else if (hasStaticDefaults) {
          // 存在静态默认值
          // 从默认值中找到对应的属性
          const prop = propsRuntimeDefaults!.properties.find(
            (node: any) => node.key.name === key
          ) as ObjectProperty | ObjectMethod
          // 如果能够找到对应的属性
          if (prop) {
            // 如果属性是对象属性
            if (prop.type === 'ObjectProperty') {
              // prop has corresponding static default value
              // prop有相应的静态默认值
              defaultString = `default: ${scriptSetupSource.slice(
                prop.value.start!,
                prop.value.end!
              )}`
            } else {
              defaultString = `default() ${scriptSetupSource.slice(
                prop.body.start!,
                prop.body.end!
              )}`
            }
          }
        }

        // 属性的类型，是否必传
        const { type, required } = props[key]
        // 如果不是生产环境
        if (!isProd) {
          // 返回 ${key}: { type, required, default }
          return `${key}: { type: ${toRuntimeTypeString(
            type
          )}, required: ${required}${
            defaultString ? `, ${defaultString}` : ``
          } }`
        } else if (
          // ts 类型  是 Boolean或者存在默认值且 元素类型为Function
          type.some(
            el => el === 'Boolean' || (defaultString && el === 'Function')
          )
        ) {
          // #4783 production: if boolean or defaultString and function exists, should keep the type.
          // 生产环境： 如果boolean或者默认字符串和函数存在，应该保持这个类型
          return `${key}: { type: ${toRuntimeTypeString(type)}${
            defaultString ? `, ${defaultString}` : ``
          } }`
        } else {
          // production: checks are useless
          // 生产环境：检查是无用的
          return `${key}: ${defaultString ? `{ ${defaultString} }` : 'null'}`
        }
      })
      .join(',\n    ')}\n  }`

    // props运行时默认值且没有静态默认值
    if (propsRuntimeDefaults && !hasStaticDefaults) {
      // props声明  合并默认值
      propsDecls = `${helper('mergeDefaults')}(${propsDecls}, ${source.slice(
        propsRuntimeDefaults.start! + startOffset,
        propsRuntimeDefaults.end! + startOffset
      )})`
    }

    return `\n  props: ${propsDecls},`
  }

  /**
   * 生成解构的默认值
   * @param key 
   * @returns 
   */
  function genDestructuredDefaultValue(key: string): string | undefined {
    // 解构pros绑定
    const destructured = propsDestructuredBindings[key]
    // 解构与解构默认值
    if (destructured && destructured.default) {
      const value = scriptSetup!.content.slice(
        destructured.default.start!,
        destructured.default.end!
      )
      // 字面量   解构的默认值类型以Literal结尾
      const isLiteral = destructured.default.type.endsWith('Literal')
      // 是Literal结尾  则 返回的默认值是一个 value本身， 否则返回一个函数  返回值是 value
      return isLiteral ? value : `() => ${value}`
    }
  }

  /**
   * 生成setup props类型
   * @param node 
   * @returns 
   */
  function genSetupPropsType(node: TSTypeLiteral | TSInterfaceBody) {
    const scriptSetupSource = scriptSetup!.content
    // 有静态默认值
    if (hasStaticWithDefaults()) {
      // if withDefaults() is used, we need to remove the optional flags
      // on props that have default values
      // 如果withDefaults被使用，我们需要移除有默认值的props的可选标记
      /**
       * {
       *  
       * }
       */
      let res = `{ `
      // 获取props的类型，遍历props中每个prop
      const members = node.type === 'TSTypeLiteral' ? node.members : node.body
      for (const m of members) {
        if (
          (m.type === 'TSPropertySignature' ||
            m.type === 'TSMethodSignature') &&
          m.typeAnnotation &&
          m.key.type === 'Identifier'
        ) {
          if (
            propsRuntimeDefaults!.properties.some(
              (p: any) => p.key.name === (m.key as Identifier).name
            )
          ) {
            res +=
              m.key.name +
              (m.type === 'TSMethodSignature' ? '()' : '') +
              scriptSetupSource.slice(
                m.typeAnnotation.start!,
                m.typeAnnotation.end!
              ) +
              ', '
          } else {
            res +=
              scriptSetupSource.slice(m.start!, m.typeAnnotation.end!) + `, `
          }
        }
      }
      return (res.length ? res.slice(0, -2) : res) + ` }`
    } else {
      return scriptSetupSource.slice(node.start!, node.end!)
    }
  }

  // 1. process normal <script> first if it exists
  // 1. 如果存在普通的<script> 首先处理普通的<script>
  let scriptAst: Program | undefined
  if (script) {
    scriptAst = parse(
      script.content,
      {
        plugins,
        sourceType: 'module'
      },
      scriptStartOffset!
    )

    // 遍历所有节点
    for (const node of scriptAst.body) {
      // 引入
      if (node.type === 'ImportDeclaration') {
        // record imports for dedupe
        // 记录引入用于去重
        for (const specifier of node.specifiers) {
          const imported =
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name
          // 注册用户的引入
          registerUserImport(
            node.source.value,
            specifier.local.name,
            imported,
            node.importKind === 'type',
            false
          )
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        // export default
        // 导出默认声明
        defaultExport = node
        // export default { ... } --> const __default__ = { ... }
        const start = node.start! + scriptStartOffset!
        const end = node.declaration.start! + scriptStartOffset!
        // 覆盖 const __default__ = 
        s.overwrite(start, end, `const ${DEFAULT_VAR} = `)
      } else if (node.type === 'ExportNamedDeclaration') {
        const defaultSpecifier = node.specifiers.find(
          s => s.exported.type === 'Identifier' && s.exported.name === 'default'
        ) as ExportSpecifier
        if (defaultSpecifier) {
          defaultExport = node
          // 1. remove specifier
          // 1. 移除说明符
          if (node.specifiers.length > 1) {
            s.remove(
              defaultSpecifier.start! + scriptStartOffset!,
              defaultSpecifier.end! + scriptStartOffset!
            )
          } else {
            s.remove(
              node.start! + scriptStartOffset!,
              node.end! + scriptStartOffset!
            )
          }
          if (node.source) {
            // export { x as default } from './x'
            // rewrite to `import { x as __default__ } from './x'` and
            // add to top
            // 重写成 `import { x as __default__ } from './x'`
            // 并且添加到顶部
            s.prepend(
              `import { ${defaultSpecifier.local.name} as ${DEFAULT_VAR} } from '${node.source.value}'\n`
            )
          } else {
            // export { x as default }
            // rewrite to `const __default__ = x` and move to end
            // 重写 `const __default__ = x` 并且移动到末尾
            s.appendLeft(
              scriptEndOffset!,
              `\nconst ${DEFAULT_VAR} = ${defaultSpecifier.local.name}\n`
            )
          }
        }
        if (node.declaration) {
          walkDeclaration(node.declaration, scriptBindings, userImportAlias)
        }
      } else if (
        (node.type === 'VariableDeclaration' ||
          node.type === 'FunctionDeclaration' ||
          node.type === 'ClassDeclaration' ||
          node.type === 'TSEnumDeclaration') &&
        !node.declare
      ) {
        walkDeclaration(node, scriptBindings, userImportAlias)
      }
    }

    // apply reactivity transform
    // 应用响应式转化
    if (enableReactivityTransform && shouldTransform(script.content)) {
      const { rootRefs, importedHelpers } = transformAST(
        scriptAst,
        s,
        scriptStartOffset!
      )
      refBindings = rootRefs
      for (const h of importedHelpers) {
        helperImports.add(h)
      }
    }

    // <script> after <script setup>
    // we need to move the block up so that `const __default__` is
    // declared before being used in the actual component definition
    // 对于 <script> 在 <script setup> 之后的
    // 我们需要把<script>搬上去，因为 `const __default` 要被声明在被使用在真实组件定义前
    if (scriptStartOffset! > startOffset) {
      s.move(scriptStartOffset!, scriptEndOffset!, 0)
    }
  }

  // 2. parse <script setup> and  walk over top level statements
  // 2. 解析 <script setup> 并且遍历顶级语句
  const scriptSetupAst = parse(
    scriptSetup.content,
    {
      plugins: [
        ...plugins,
        // allow top level await but only inside <script setup>
        // 允许顶级语句await但仅仅在<script setup>内
        'topLevelAwait'
      ],
      sourceType: 'module'
    },
    startOffset
  )

  // 遍历节点
  for (const node of scriptSetupAst.body) {
    const start = node.start! + startOffset
    let end = node.end! + startOffset
    // locate comment
    // 定位注释
    if (node.trailingComments && node.trailingComments.length > 0) {
      const lastCommentNode =
        node.trailingComments[node.trailingComments.length - 1]
      end = lastCommentNode.end + startOffset
    }
    // locate the end of whitespace between this statement and the next
    // 定位位于语句之间的空格
    while (end <= source.length) {
      if (!/\s/.test(source.charAt(end))) {
        break
      }
      end++
    }

    // (Dropped) `ref: x` bindings
    // 废弃 `ref: x` 绑定
    if (
      node.type === 'LabeledStatement' &&
      node.label.name === 'ref' &&
      node.body.type === 'ExpressionStatement'
    ) {
      error(
        `ref sugar using the label syntax was an experimental proposal and ` +
          `has been dropped based on community feedback. Please check out ` +
          `the new proposal at https://github.com/vuejs/rfcs/discussions/369`,
        node
      )
    }

    if (node.type === 'ImportDeclaration') {
      // import declarations are moved to top
      // 引入声明被移动到顶部
      s.move(start, end, 0)

      // dedupe imports
      // 引入去重
      /**
       * 累加被移除的声明描述
       */
      let removed = 0
      /** 
       * 移除第i个声明描述
       **/
      const removeSpecifier = (i: number) => {
        const removeLeft = i > removed
        removed++
        // 当前声明描述
        const current = node.specifiers[i]
        // 下一个声明描述
        const next = node.specifiers[i + 1]
        // 移除声明描述
        s.remove(
          removeLeft
            ? node.specifiers[i - 1].end! + startOffset
            : current.start! + startOffset,
          next && !removeLeft
            ? next.start! + startOffset
            : current.end! + startOffset
        )
      }

      // 遍历声明描述
      for (let i = 0; i < node.specifiers.length; i++) {
        const specifier = node.specifiers[i]
        const local = specifier.local.name
        const imported =
          specifier.type === 'ImportSpecifier' &&
          specifier.imported.type === 'Identifier' &&
          specifier.imported.name
        const source = node.source.value
        // 已存在的引入
        const existing = userImports[local]
        if (
          source === 'vue' &&
          (imported === DEFINE_PROPS ||
            imported === DEFINE_EMITS ||
            imported === DEFINE_EXPOSE)
        ) {
          // 警告
          warnOnce(
            `\`${imported}\` is a compiler macro and no longer needs to be imported.`
          )
          // 移除声明描述
          removeSpecifier(i)
        } else if (existing) {
          if (existing.source === source && existing.imported === imported) {
            // already imported in <script setup>, dedupe
            // 已经被引入到<script setup>中，去重
            removeSpecifier(i)
          } else {
            error(`different imports aliased to same local name.`, specifier)
          }
        } else {
          // 注册用户的导入
          registerUserImport(
            source,
            local,
            imported,
            node.importKind === 'type',
            true
          )
        }
      }
      // 被移除的长度
      if (node.specifiers.length && removed === node.specifiers.length) {
        s.remove(node.start! + startOffset, node.end! + startOffset)
      }
    }

    if (node.type === 'ExpressionStatement') {
      // process `defineProps` and `defineEmit(s)` calls
      // 处理 `defineProps` 和 `defineEmits` 调用
      if (
        processDefineProps(node.expression) ||
        processDefineEmits(node.expression) ||
        processWithDefaults(node.expression)
      ) {
        // 移除
        s.remove(node.start! + startOffset, node.end! + startOffset)
      } else if (processDefineExpose(node.expression)) {
        // defineExpose({}) -> expose({})
        // defineExpose({}) 转化为 expose({})
        const callee = (node.expression as CallExpression).callee
        s.overwrite(
          callee.start! + startOffset,
          callee.end! + startOffset,
          'expose'
        )
      }
    }

    // 变量声明
    if (node.type === 'VariableDeclaration' && !node.declare) {
      // 声明的长度
      const total = node.declarations.length
      // 剩余的声明数量
      let left = total
      // 遍历声明
      for (let i = 0; i < total; i++) {
        const decl = node.declarations[i]
        // 声明已初始化
        if (decl.init) {
          // defineProps / defineEmits
          // 是defineProps或者withDefaults
          const isDefineProps =
            processDefineProps(decl.init, decl.id) ||
            processWithDefaults(decl.init, decl.id)
          // 是defineEmits
          const isDefineEmits = processDefineEmits(decl.init, decl.id)
          // 如果这个声明是defineProp或者defineEmits
          if (isDefineProps || isDefineEmits) {
            if (left === 1) {
              // 剩余的声明只有一个
              s.remove(node.start! + startOffset, node.end! + startOffset)
            } else {
              // 定位到当前声明的开始位置
              let start = decl.start! + startOffset
              // 定位到当前声明末尾位置
              let end = decl.end! + startOffset
              if (i < total - 1) {
                // not the last one, locate the start of the next
                // 不是最后一个，定位到下个声明开始位置
                end = node.declarations[i + 1].start! + startOffset
              } else {
                // last one, locate the end of the prev
                // 最后一个，定位到上一个声明的末尾位置
                start = node.declarations[i - 1].end! + startOffset
              }
              // 移除
              s.remove(start, end)
              left--
            }
          }
        }
      }
    }

    // walk declarations to record declared bindings
    // 遍历声明用来记录被声明的绑定
    if (
      (node.type === 'VariableDeclaration' ||
        node.type === 'FunctionDeclaration' ||
        node.type === 'ClassDeclaration') &&
      !node.declare
    ) {
      walkDeclaration(node, setupBindings, userImportAlias)
    }

    // walk statements & named exports / variable declarations for top level
    // await
    // 遍历语句和被命名的导出或者变量声明用于顶级await
    if (
      (node.type === 'VariableDeclaration' && !node.declare) ||
      node.type.endsWith('Statement')
    ) {
      // 遍历节点
      ;(walk as any)(node, {
        enter(child: Node, parent: Node) {
          if (isFunctionType(child)) {
            // 如果节点是函数类型
            this.skip()
          }
          // 节点类型是await表达式
          if (child.type === 'AwaitExpression') {
            // 存在await
            hasAwait = true
            // 是否需要分号
            const needsSemi = scriptSetupAst.body.some(n => {
              return n.type === 'ExpressionStatement' && n.start === child.start
            })
            // 处理await
            processAwait(
              child,
              needsSemi,
              parent.type === 'ExpressionStatement'
            )
          }
        }
      })
    }

    // 导出名称声明且节点的导出类型不是type
    // 或者导出所有声明
    // 导出默认声明
    // 以上情况报错，script setup不能包含es 模块导出
    // 如果你正在使用一个旧版本的script setup，请查阅rfc的更新
    if (
      (node.type === 'ExportNamedDeclaration' && node.exportKind !== 'type') ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ExportDefaultDeclaration'
    ) {
      error(
        `<script setup> cannot contain ES module exports. ` +
          `If you are using a previous version of <script setup>, please ` +
          `consult the updated RFC at https://github.com/vuejs/rfcs/pull/227.`,
        node
      )
    }

    // 如果是ts
    if (isTS) {
      // runtime enum
      // 运行时枚举
      // 节点类型为enum声明，在binding中注册
      if (node.type === 'TSEnumDeclaration') {
        registerBinding(setupBindings, node.id, BindingTypes.SETUP_CONST)
      }

      // move all Type declarations to outer scope
      // 将所有的ts声明移动到作用域外面
      if (
        node.type.startsWith('TS') ||
        (node.type === 'ExportNamedDeclaration' &&
          node.exportKind === 'type') ||
        (node.type === 'VariableDeclaration' && node.declare)
      ) {
        // 记录类型
        recordType(node, declaredTypes)
        s.move(start, end, 0)
      }
    }
  }

  // 3. Apply reactivity transform
  // 3. 应用响应式转化
  if (
    (enableReactivityTransform &&
      // normal <script> had ref bindings that maybe used in <script setup>
      // 普通的<script>有ref绑定可以被用在<script setup>中
      (refBindings || shouldTransform(scriptSetup.content))) ||
    propsDestructureDecl
  ) {
    // rootRefs, importedHelpers
    // 对script ast 进行转化
    const { rootRefs, importedHelpers } = transformAST(
      scriptSetupAst,
      s,
      startOffset,
      refBindings,
      propsDestructuredBindings
    )
    // ref绑定， 根节点的ref绑定和ref绑定合并
    refBindings = refBindings ? [...refBindings, ...rootRefs] : rootRefs
    // 遍历被倒入的帮助函数
    for (const h of importedHelpers) {
      helperImports.add(h)
    }
  }

  // 4. extract runtime props/emits code from setup context type
  // 4. 从setup上下文的ts中提取运行时props或者emits代码
  if (propsTypeDecl) {
    extractRuntimeProps(propsTypeDecl, typeDeclaredProps, declaredTypes, isProd)
  }
  if (emitsTypeDecl) {
    extractRuntimeEmits(emitsTypeDecl, typeDeclaredEmits)
  }

  // 5. check useOptions args to make sure it doesn't reference setup scope
  // variables
  // 5. 检查使用选项的参数来确保它没有引入setup作用域变量
  checkInvalidScopeReference(propsRuntimeDecl, DEFINE_PROPS)
  checkInvalidScopeReference(propsRuntimeDefaults, DEFINE_PROPS)
  checkInvalidScopeReference(propsDestructureDecl, DEFINE_PROPS)
  checkInvalidScopeReference(emitsRuntimeDecl, DEFINE_PROPS)

  // 6. remove non-script content
  // 6. 移除非script的内容
  if (script) {
    if (startOffset < scriptStartOffset!) {
      // <script setup> before <script>
      // <script setup>在<script>之前
      s.remove(0, startOffset)
      s.remove(endOffset, scriptStartOffset!)
      s.remove(scriptEndOffset!, source.length)
    } else {
      // <script> before <script setup>
      s.remove(0, scriptStartOffset!)
      s.remove(scriptEndOffset!, startOffset)
      s.remove(endOffset, source.length)
    }
  } else {
    // only <script setup>
    // 仅仅只有<script setup>
    s.remove(0, startOffset)
    s.remove(endOffset, source.length)
  }

  // 7. analyze binding metadata
  // 7. 分析绑定的媒体信息
  if (scriptAst) {
    // 合并
    Object.assign(bindingMetadata, analyzeScriptBindings(scriptAst.body))
  }
  // 属性运行时声明
  if (propsRuntimeDecl) {
    // 获取对象或数组的表达式key值
    for (const key of getObjectOrArrayExpressionKeys(propsRuntimeDecl)) {
      bindingMetadata[key] = BindingTypes.PROPS
    }
  }
  // 遍历ts声明属性
  for (const key in typeDeclaredProps) {
    bindingMetadata[key] = BindingTypes.PROPS
  }
  // props aliases
  // 属性别名 属性解构声明
  if (propsDestructureDecl) {
    if (propsDestructureRestId) {
      bindingMetadata[propsDestructureRestId] = BindingTypes.SETUP_CONST
    }
    for (const key in propsDestructuredBindings) {
      const { local } = propsDestructuredBindings[key]
      if (local !== key) {
        bindingMetadata[local] = BindingTypes.PROPS_ALIASED
        ;(bindingMetadata.__propsAliases ||
          (bindingMetadata.__propsAliases = {}))[local] = key
      }
    }
  }
  // 遍历用户的引入
  for (const [key, { isType, imported, source }] of Object.entries(
    userImports
  )) {
    // 过滤ts类型
    if (isType) continue
    // .vue文件或者vue中引入的都是常量，否则可能是ref
    bindingMetadata[key] =
      (imported === 'default' && source.endsWith('.vue')) || source === 'vue'
        ? BindingTypes.SETUP_CONST
        : BindingTypes.SETUP_MAYBE_REF
  }
  // 合并script中的绑定值
  for (const key in scriptBindings) {
    bindingMetadata[key] = scriptBindings[key]
  }
  // 合并setup中绑定值
  for (const key in setupBindings) {
    bindingMetadata[key] = setupBindings[key]
  }
  // known ref bindings
  // 已知的ref绑定
  if (refBindings) {
    for (const key of refBindings) {
      bindingMetadata[key] = BindingTypes.SETUP_REF
    }
  }

  // 8. inject `useCssVars` calls
  // 8. 注入 `useCssVars` 调用
  if (cssVars.length) {
    helperImports.add(CSS_VARS_HELPER)
    helperImports.add('unref')
    // 在具体位置添加css变量的代码
    s.prependRight(
      startOffset,
      `\n${genCssVarsCode(cssVars, bindingMetadata, scopeId, isProd)}\n`
    )
  }

  // 9. finalize setup() argument signature
  // 9. 完成setup()的参数签名
  let args = `__props`
  if (propsTypeDecl) {
    // mark as any and only cast on assignment
    // since the user defined complex types may be incompatible with the
    // inferred type from generated runtime declarations
    // 标记为any和仅在赋值时使用
    // 因为用户定义的复杂类型可能与从生成的运行时声明推断的类型不兼容
    args += `: any`
  }
  // inject user assignment of props
  // we use a default __props so that template expressions referencing props
  // can use it directly
  // 注入用户的属性赋值
  // 我们使用一个默认的__props，因此引入属性的模板表达式能够直接使用它
  if (propsIdentifier) {
    // 向前添加字符串，这部分字符串就是props的代码
    s.prependLeft(
      startOffset,
      `\nconst ${propsIdentifier} = __props${
        propsTypeDecl ? ` as ${genSetupPropsType(propsTypeDecl)}` : ``
      }\n`
    )
  }
  // 属性解构id
  if (propsDestructureRestId) {
    // 生成props的代理
    s.prependLeft(
      startOffset,
      `\nconst ${propsDestructureRestId} = ${helper(
        `createPropsRestProxy`
      )}(__props, ${JSON.stringify(Object.keys(propsDestructuredBindings))})\n`
    )
  }
  // inject temp variables for async context preservation
  // 注入临时的变量用于异步的上下文维护
  if (hasAwait) {
    const any = isTS ? `: any` : ``
    s.prependLeft(startOffset, `\nlet __temp${any}, __restore${any}\n`)
  }

  // 解构元素
  // 存在defineExpose，或者不是内联模板，则解构元素中包含expose
  const destructureElements =
    hasDefineExposeCall || !options.inlineTemplate ? [`expose`] : []
  // 存在emit标识符，则表明存在emit
  if (emitIdentifier) {
    destructureElements.push(
      emitIdentifier === `emit` ? `emit` : `emit: ${emitIdentifier}`
    )
  }
  // 存在解构元素
  if (destructureElements.length) {
    args += `, { ${destructureElements.join(', ')} }`
    if (emitsTypeDecl) {
      args += `: { emit: (${scriptSetup.content.slice(
        emitsTypeDecl.start!,
        emitsTypeDecl.end!
      )}), expose: any, slots: any, attrs: any }`
    }
  }

  // 10. generate return statement
  let returned
  if (options.inlineTemplate) {
    if (sfc.template && !sfc.template.src) {
      if (options.templateOptions && options.templateOptions.ssr) {
        hasInlinedSsrRenderFn = true
      }
      // inline render function mode - we are going to compile the template and
      // inline it right here
      const { code, ast, preamble, tips, errors } = compileTemplate({
        filename,
        source: sfc.template.content,
        inMap: sfc.template.map,
        ...options.templateOptions,
        id: scopeId,
        scoped: sfc.styles.some(s => s.scoped),
        isProd: options.isProd,
        ssrCssVars: sfc.cssVars,
        compilerOptions: {
          ...(options.templateOptions &&
            options.templateOptions.compilerOptions),
          inline: true,
          isTS,
          bindingMetadata
        }
      })
      if (tips.length) {
        tips.forEach(warnOnce)
      }
      const err = errors[0]
      if (typeof err === 'string') {
        throw new Error(err)
      } else if (err) {
        if (err.loc) {
          err.message +=
            `\n\n` +
            sfc.filename +
            '\n' +
            generateCodeFrame(
              source,
              err.loc.start.offset,
              err.loc.end.offset
            ) +
            `\n`
        }
        throw err
      }
      if (preamble) {
        s.prepend(preamble)
      }
      // avoid duplicated unref import
      // as this may get injected by the render function preamble OR the
      // css vars codegen
      if (ast && ast.helpers.includes(UNREF)) {
        helperImports.delete('unref')
      }
      returned = code
    } else {
      returned = `() => {}`
    }
  } else {
    // return bindings from script and script setup
    const allBindings: Record<string, any> = {
      ...scriptBindings,
      ...setupBindings
    }
    for (const key in userImports) {
      if (!userImports[key].isType && userImports[key].isUsedInTemplate) {
        allBindings[key] = true
      }
    }
    returned = `{ ${Object.keys(allBindings).join(', ')} }`
  }

  if (!options.inlineTemplate && !__TEST__) {
    // in non-inline mode, the `__isScriptSetup: true` flag is used by
    // componentPublicInstance proxy to allow properties that start with $ or _
    s.appendRight(
      endOffset,
      `\nconst __returned__ = ${returned}\n` +
        `Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true })\n` +
        `return __returned__` +
        `\n}\n\n`
    )
  } else {
    s.appendRight(endOffset, `\nreturn ${returned}\n}\n\n`)
  }

  // 11. finalize default export
  let runtimeOptions = ``
  if (hasInlinedSsrRenderFn) {
    runtimeOptions += `\n  __ssrInlineRender: true,`
  }
  if (propsRuntimeDecl) {
    let declCode = scriptSetup.content
      .slice(propsRuntimeDecl.start!, propsRuntimeDecl.end!)
      .trim()
    if (propsDestructureDecl) {
      const defaults: string[] = []
      for (const key in propsDestructuredBindings) {
        const d = genDestructuredDefaultValue(key)
        if (d) defaults.push(`${key}: ${d}`)
      }
      if (defaults.length) {
        declCode = `${helper(
          `mergeDefaults`
        )}(${declCode}, {\n  ${defaults.join(',\n  ')}\n})`
      }
    }
    runtimeOptions += `\n  props: ${declCode},`
  } else if (propsTypeDecl) {
    runtimeOptions += genRuntimeProps(typeDeclaredProps)
  }
  if (emitsRuntimeDecl) {
    runtimeOptions += `\n  emits: ${scriptSetup.content
      .slice(emitsRuntimeDecl.start!, emitsRuntimeDecl.end!)
      .trim()},`
  } else if (emitsTypeDecl) {
    runtimeOptions += genRuntimeEmits(typeDeclaredEmits)
  }

  // <script setup> components are closed by default. If the user did not
  // explicitly call `defineExpose`, call expose() with no args.
  const exposeCall =
    hasDefineExposeCall || options.inlineTemplate ? `` : `  expose();\n`
  // wrap setup code with function.
  if (isTS) {
    // for TS, make sure the exported type is still valid type with
    // correct props information
    // we have to use object spread for types to be merged properly
    // user's TS setting should compile it down to proper targets
    // export default defineComponent({ ...__default__, ... })
    const def = defaultExport ? `\n  ...${DEFAULT_VAR},` : ``
    s.prependLeft(
      startOffset,
      `\nexport default /*#__PURE__*/${helper(
        `defineComponent`
      )}({${def}${runtimeOptions}\n  ${
        hasAwait ? `async ` : ``
      }setup(${args}) {\n${exposeCall}`
    )
    s.appendRight(endOffset, `})`)
  } else {
    if (defaultExport) {
      // without TS, can't rely on rest spread, so we use Object.assign
      // export default Object.assign(__default__, { ... })
      s.prependLeft(
        startOffset,
        `\nexport default /*#__PURE__*/Object.assign(${DEFAULT_VAR}, {${runtimeOptions}\n  ` +
          `${hasAwait ? `async ` : ``}setup(${args}) {\n${exposeCall}`
      )
      s.appendRight(endOffset, `})`)
    } else {
      s.prependLeft(
        startOffset,
        `\nexport default {${runtimeOptions}\n  ` +
          `${hasAwait ? `async ` : ``}setup(${args}) {\n${exposeCall}`
      )
      s.appendRight(endOffset, `}`)
    }
  }

  // 12. finalize Vue helper imports
  if (helperImports.size > 0) {
    s.prepend(
      `import { ${[...helperImports]
        .map(h => `${h} as _${h}`)
        .join(', ')} } from 'vue'\n`
    )
  }

  s.trim()

  return {
    ...scriptSetup,
    bindings: bindingMetadata,
    imports: userImports,
    content: s.toString(),
    map: genSourceMap
      ? (s.generateMap({
          source: filename,
          hires: true,
          includeContent: true
        }) as unknown as RawSourceMap)
      : undefined,
    scriptAst: scriptAst?.body,
    scriptSetupAst: scriptSetupAst?.body
  }
}

function registerBinding(
  bindings: Record<string, BindingTypes>,
  node: Identifier,
  type: BindingTypes
) {
  bindings[node.name] = type
}

function walkDeclaration(
  node: Declaration,
  bindings: Record<string, BindingTypes>,
  userImportAlias: Record<string, string>
) {
  if (node.type === 'VariableDeclaration') {
    const isConst = node.kind === 'const'
    // export const foo = ...
    for (const { id, init } of node.declarations) {
      const isDefineCall = !!(
        isConst &&
        isCallOf(
          init,
          c => c === DEFINE_PROPS || c === DEFINE_EMITS || c === WITH_DEFAULTS
        )
      )
      if (id.type === 'Identifier') {
        let bindingType
        const userReactiveBinding = userImportAlias['reactive'] || 'reactive'
        if (isCallOf(init, userReactiveBinding)) {
          // treat reactive() calls as let since it's meant to be mutable
          bindingType = BindingTypes.SETUP_LET
        } else if (
          // if a declaration is a const literal, we can mark it so that
          // the generated render fn code doesn't need to unref() it
          isDefineCall ||
          (isConst && canNeverBeRef(init!, userReactiveBinding))
        ) {
          bindingType = BindingTypes.SETUP_CONST
        } else if (isConst) {
          if (isCallOf(init, userImportAlias['ref'] || 'ref')) {
            bindingType = BindingTypes.SETUP_REF
          } else {
            bindingType = BindingTypes.SETUP_MAYBE_REF
          }
        } else {
          bindingType = BindingTypes.SETUP_LET
        }
        registerBinding(bindings, id, bindingType)
      } else {
        if (isCallOf(init, DEFINE_PROPS)) {
          // skip walking props destructure
          return
        }
        if (id.type === 'ObjectPattern') {
          walkObjectPattern(id, bindings, isConst, isDefineCall)
        } else if (id.type === 'ArrayPattern') {
          walkArrayPattern(id, bindings, isConst, isDefineCall)
        }
      }
    }
  } else if (
    node.type === 'TSEnumDeclaration' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'ClassDeclaration'
  ) {
    // export function foo() {} / export class Foo {}
    // export declarations must be named.
    bindings[node.id!.name] = BindingTypes.SETUP_CONST
  }
}

function walkObjectPattern(
  node: ObjectPattern,
  bindings: Record<string, BindingTypes>,
  isConst: boolean,
  isDefineCall = false
) {
  for (const p of node.properties) {
    if (p.type === 'ObjectProperty') {
      if (p.key.type === 'Identifier' && p.key === p.value) {
        // shorthand: const { x } = ...
        const type = isDefineCall
          ? BindingTypes.SETUP_CONST
          : isConst
          ? BindingTypes.SETUP_MAYBE_REF
          : BindingTypes.SETUP_LET
        registerBinding(bindings, p.key, type)
      } else {
        walkPattern(p.value, bindings, isConst, isDefineCall)
      }
    } else {
      // ...rest
      // argument can only be identifier when destructuring
      const type = isConst ? BindingTypes.SETUP_CONST : BindingTypes.SETUP_LET
      registerBinding(bindings, p.argument as Identifier, type)
    }
  }
}

function walkArrayPattern(
  node: ArrayPattern,
  bindings: Record<string, BindingTypes>,
  isConst: boolean,
  isDefineCall = false
) {
  for (const e of node.elements) {
    e && walkPattern(e, bindings, isConst, isDefineCall)
  }
}

function walkPattern(
  node: Node,
  bindings: Record<string, BindingTypes>,
  isConst: boolean,
  isDefineCall = false
) {
  if (node.type === 'Identifier') {
    const type = isDefineCall
      ? BindingTypes.SETUP_CONST
      : isConst
      ? BindingTypes.SETUP_MAYBE_REF
      : BindingTypes.SETUP_LET
    registerBinding(bindings, node, type)
  } else if (node.type === 'RestElement') {
    // argument can only be identifier when destructuring
    const type = isConst ? BindingTypes.SETUP_CONST : BindingTypes.SETUP_LET
    registerBinding(bindings, node.argument as Identifier, type)
  } else if (node.type === 'ObjectPattern') {
    walkObjectPattern(node, bindings, isConst)
  } else if (node.type === 'ArrayPattern') {
    walkArrayPattern(node, bindings, isConst)
  } else if (node.type === 'AssignmentPattern') {
    if (node.left.type === 'Identifier') {
      const type = isDefineCall
        ? BindingTypes.SETUP_CONST
        : isConst
        ? BindingTypes.SETUP_MAYBE_REF
        : BindingTypes.SETUP_LET
      registerBinding(bindings, node.left, type)
    } else {
      walkPattern(node.left, bindings, isConst)
    }
  }
}

interface PropTypeData {
  key: string
  type: string[]
  required: boolean
}

function recordType(node: Node, declaredTypes: Record<string, string[]>) {
  if (node.type === 'TSInterfaceDeclaration') {
    declaredTypes[node.id.name] = [`Object`]
  } else if (node.type === 'TSTypeAliasDeclaration') {
    declaredTypes[node.id.name] = inferRuntimeType(
      node.typeAnnotation,
      declaredTypes
    )
  } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    recordType(node.declaration, declaredTypes)
  }
}

function extractRuntimeProps(
  node: TSTypeLiteral | TSInterfaceBody,
  props: Record<string, PropTypeData>,
  declaredTypes: Record<string, string[]>,
  isProd: boolean
) {
  const members = node.type === 'TSTypeLiteral' ? node.members : node.body
  for (const m of members) {
    if (
      (m.type === 'TSPropertySignature' || m.type === 'TSMethodSignature') &&
      m.key.type === 'Identifier'
    ) {
      let type
      if (m.type === 'TSMethodSignature') {
        type = ['Function']
      } else if (m.typeAnnotation) {
        type = inferRuntimeType(m.typeAnnotation.typeAnnotation, declaredTypes)
      }
      props[m.key.name] = {
        key: m.key.name,
        required: !m.optional,
        type: type || [`null`]
      }
    }
  }
}

function inferRuntimeType(
  node: TSType,
  declaredTypes: Record<string, string[]>
): string[] {
  switch (node.type) {
    case 'TSStringKeyword':
      return ['String']
    case 'TSNumberKeyword':
      return ['Number']
    case 'TSBooleanKeyword':
      return ['Boolean']
    case 'TSObjectKeyword':
      return ['Object']
    case 'TSTypeLiteral':
      // TODO (nice to have) generate runtime property validation
      return ['Object']
    case 'TSFunctionType':
      return ['Function']
    case 'TSArrayType':
    case 'TSTupleType':
      // TODO (nice to have) generate runtime element type/length checks
      return ['Array']

    case 'TSLiteralType':
      switch (node.literal.type) {
        case 'StringLiteral':
          return ['String']
        case 'BooleanLiteral':
          return ['Boolean']
        case 'NumericLiteral':
        case 'BigIntLiteral':
          return ['Number']
        default:
          return [`null`]
      }

    case 'TSTypeReference':
      if (node.typeName.type === 'Identifier') {
        if (declaredTypes[node.typeName.name]) {
          return declaredTypes[node.typeName.name]
        }
        switch (node.typeName.name) {
          case 'Array':
          case 'Function':
          case 'Object':
          case 'Set':
          case 'Map':
          case 'WeakSet':
          case 'WeakMap':
          case 'Date':
            return [node.typeName.name]
          case 'Record':
          case 'Partial':
          case 'Readonly':
          case 'Pick':
          case 'Omit':
          case 'Exclude':
          case 'Extract':
          case 'Required':
          case 'InstanceType':
            return ['Object']
        }
      }
      return [`null`]

    case 'TSParenthesizedType':
      return inferRuntimeType(node.typeAnnotation, declaredTypes)
    case 'TSUnionType':
      return [
        ...new Set(
          [].concat(
            ...(node.types.map(t => inferRuntimeType(t, declaredTypes)) as any)
          )
        )
      ]
    case 'TSIntersectionType':
      return ['Object']

    case 'TSSymbolKeyword':
      return ['Symbol']

    default:
      return [`null`] // no runtime check
  }
}

function toRuntimeTypeString(types: string[]) {
  return types.length > 1 ? `[${types.join(', ')}]` : types[0]
}

function extractRuntimeEmits(
  node: TSFunctionType | TSTypeLiteral | TSInterfaceBody,
  emits: Set<string>
) {
  if (node.type === 'TSTypeLiteral' || node.type === 'TSInterfaceBody') {
    const members = node.type === 'TSTypeLiteral' ? node.members : node.body
    for (let t of members) {
      if (t.type === 'TSCallSignatureDeclaration') {
        extractEventNames(t.parameters[0], emits)
      }
    }
    return
  } else {
    extractEventNames(node.parameters[0], emits)
  }
}

function extractEventNames(
  eventName: Identifier | RestElement,
  emits: Set<string>
) {
  if (
    eventName.type === 'Identifier' &&
    eventName.typeAnnotation &&
    eventName.typeAnnotation.type === 'TSTypeAnnotation'
  ) {
    const typeNode = eventName.typeAnnotation.typeAnnotation
    if (typeNode.type === 'TSLiteralType') {
      if (typeNode.literal.type !== 'UnaryExpression') {
        emits.add(String(typeNode.literal.value))
      }
    } else if (typeNode.type === 'TSUnionType') {
      for (const t of typeNode.types) {
        if (
          t.type === 'TSLiteralType' &&
          t.literal.type !== 'UnaryExpression'
        ) {
          emits.add(String(t.literal.value))
        }
      }
    }
  }
}

function genRuntimeEmits(emits: Set<string>) {
  return emits.size
    ? `\n  emits: [${Array.from(emits)
        .map(p => JSON.stringify(p))
        .join(', ')}],`
    : ``
}

function isCallOf(
  node: Node | null | undefined,
  test: string | ((id: string) => boolean)
): node is CallExpression {
  return !!(
    node &&
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    (typeof test === 'string'
      ? node.callee.name === test
      : test(node.callee.name))
  )
}

function canNeverBeRef(node: Node, userReactiveImport: string): boolean {
  if (isCallOf(node, userReactiveImport)) {
    return true
  }
  switch (node.type) {
    case 'UnaryExpression':
    case 'BinaryExpression':
    case 'ArrayExpression':
    case 'ObjectExpression':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'UpdateExpression':
    case 'ClassExpression':
    case 'TaggedTemplateExpression':
      return true
    case 'SequenceExpression':
      return canNeverBeRef(
        node.expressions[node.expressions.length - 1],
        userReactiveImport
      )
    default:
      if (node.type.endsWith('Literal')) {
        return true
      }
      return false
  }
}

/**
 * Analyze bindings in normal `<script>`
 * Note that `compileScriptSetup` already analyzes bindings as part of its
 * compilation process so this should only be used on single `<script>` SFCs.
 */
function analyzeScriptBindings(ast: Statement[]): BindingMetadata {
  for (const node of ast) {
    if (
      node.type === 'ExportDefaultDeclaration' &&
      node.declaration.type === 'ObjectExpression'
    ) {
      return analyzeBindingsFromOptions(node.declaration)
    }
  }
  return {}
}

function analyzeBindingsFromOptions(node: ObjectExpression): BindingMetadata {
  const bindings: BindingMetadata = {}
  // #3270, #3275
  // mark non-script-setup so we don't resolve components/directives from these
  Object.defineProperty(bindings, '__isScriptSetup', {
    enumerable: false,
    value: false
  })
  for (const property of node.properties) {
    if (
      property.type === 'ObjectProperty' &&
      !property.computed &&
      property.key.type === 'Identifier'
    ) {
      // props
      if (property.key.name === 'props') {
        // props: ['foo']
        // props: { foo: ... }
        for (const key of getObjectOrArrayExpressionKeys(property.value)) {
          bindings[key] = BindingTypes.PROPS
        }
      }

      // inject
      else if (property.key.name === 'inject') {
        // inject: ['foo']
        // inject: { foo: {} }
        for (const key of getObjectOrArrayExpressionKeys(property.value)) {
          bindings[key] = BindingTypes.OPTIONS
        }
      }

      // computed & methods
      else if (
        property.value.type === 'ObjectExpression' &&
        (property.key.name === 'computed' || property.key.name === 'methods')
      ) {
        // methods: { foo() {} }
        // computed: { foo() {} }
        for (const key of getObjectExpressionKeys(property.value)) {
          bindings[key] = BindingTypes.OPTIONS
        }
      }
    }

    // setup & data
    else if (
      property.type === 'ObjectMethod' &&
      property.key.type === 'Identifier' &&
      (property.key.name === 'setup' || property.key.name === 'data')
    ) {
      for (const bodyItem of property.body.body) {
        // setup() {
        //   return {
        //     foo: null
        //   }
        // }
        if (
          bodyItem.type === 'ReturnStatement' &&
          bodyItem.argument &&
          bodyItem.argument.type === 'ObjectExpression'
        ) {
          for (const key of getObjectExpressionKeys(bodyItem.argument)) {
            bindings[key] =
              property.key.name === 'setup'
                ? BindingTypes.SETUP_MAYBE_REF
                : BindingTypes.DATA
          }
        }
      }
    }
  }

  return bindings
}

function getObjectExpressionKeys(node: ObjectExpression): string[] {
  const keys = []
  for (const prop of node.properties) {
    if (
      (prop.type === 'ObjectProperty' || prop.type === 'ObjectMethod') &&
      !prop.computed
    ) {
      if (prop.key.type === 'Identifier') {
        keys.push(prop.key.name)
      } else if (prop.key.type === 'StringLiteral') {
        keys.push(prop.key.value)
      }
    }
  }
  return keys
}

function getArrayExpressionKeys(node: ArrayExpression): string[] {
  const keys = []
  for (const element of node.elements) {
    if (element && element.type === 'StringLiteral') {
      keys.push(element.value)
    }
  }
  return keys
}

function getObjectOrArrayExpressionKeys(value: Node): string[] {
  if (value.type === 'ArrayExpression') {
    return getArrayExpressionKeys(value)
  }
  if (value.type === 'ObjectExpression') {
    return getObjectExpressionKeys(value)
  }
  return []
}

const templateUsageCheckCache = createCache<string>()

function resolveTemplateUsageCheckString(sfc: SFCDescriptor) {
  const { content, ast } = sfc.template!
  const cached = templateUsageCheckCache.get(content)
  if (cached) {
    return cached
  }

  let code = ''
  transform(createRoot([ast]), {
    nodeTransforms: [
      node => {
        if (node.type === NodeTypes.ELEMENT) {
          if (
            !parserOptions.isNativeTag!(node.tag) &&
            !parserOptions.isBuiltInComponent!(node.tag)
          ) {
            code += `,${camelize(node.tag)},${capitalize(camelize(node.tag))}`
          }
          for (let i = 0; i < node.props.length; i++) {
            const prop = node.props[i]
            if (prop.type === NodeTypes.DIRECTIVE) {
              if (!isBuiltInDir(prop.name)) {
                code += `,v${capitalize(camelize(prop.name))}`
              }
              if (prop.exp) {
                code += `,${stripStrings(
                  (prop.exp as SimpleExpressionNode).content
                )}`
              }
            }
          }
        } else if (node.type === NodeTypes.INTERPOLATION) {
          code += `,${stripStrings(
            (node.content as SimpleExpressionNode).content
          )}`
        }
      }
    ]
  })

  code += ';'
  templateUsageCheckCache.set(content, code)
  return code
}

function stripStrings(exp: string) {
  return exp
    .replace(/'[^']*'|"[^"]*"/g, '')
    .replace(/`[^`]+`/g, stripTemplateString)
}

function stripTemplateString(str: string): string {
  const interpMatch = str.match(/\${[^}]+}/g)
  if (interpMatch) {
    return interpMatch.map(m => m.slice(2, -1)).join(',')
  }
  return ''
}

function isImportUsed(local: string, sfc: SFCDescriptor): boolean {
  return new RegExp(
    // #4274 escape $ since it's a special char in regex
    // (and is the only regex special char that is valid in identifiers)
    `[^\\w$_]${local.replace(/\$/g, '\\$')}[^\\w$_]`
  ).test(resolveTemplateUsageCheckString(sfc))
}

/**
 * Note: this comparison assumes the prev/next script are already identical,
 * and only checks the special case where <script setup lang="ts"> unused import
 * pruning result changes due to template changes.
 */
export function hmrShouldReload(
  prevImports: Record<string, ImportBinding>,
  next: SFCDescriptor
): boolean {
  if (
    !next.scriptSetup ||
    (next.scriptSetup.lang !== 'ts' && next.scriptSetup.lang !== 'tsx')
  ) {
    return false
  }

  // for each previous import, check if its used status remain the same based on
  // the next descriptor's template
  for (const key in prevImports) {
    // if an import was previous unused, but now is used, we need to force
    // reload so that the script now includes that import.
    if (!prevImports[key].isUsedInTemplate && isImportUsed(key, next)) {
      return true
    }
  }

  return false
}
