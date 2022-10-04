import { CodegenOptions } from './options'
import {
  RootNode,
  TemplateChildNode,
  TextNode,
  CommentNode,
  ExpressionNode,
  NodeTypes,
  JSChildNode,
  CallExpression,
  ArrayExpression,
  ObjectExpression,
  Position,
  InterpolationNode,
  CompoundExpressionNode,
  SimpleExpressionNode,
  FunctionExpression,
  ConditionalExpression,
  CacheExpression,
  locStub,
  SSRCodegenNode,
  TemplateLiteral,
  IfStatement,
  AssignmentExpression,
  ReturnStatement,
  VNodeCall,
  SequenceExpression
} from './ast'
import { SourceMapGenerator, RawSourceMap } from 'source-map'
import {
  advancePositionWithMutation,
  assert,
  getVNodeBlockHelper,
  getVNodeHelper,
  isSimpleIdentifier,
  toValidAssetId
} from './utils'
import { isString, isArray, isSymbol } from '@vue/shared'
import {
  helperNameMap,
  TO_DISPLAY_STRING,
  CREATE_VNODE,
  RESOLVE_COMPONENT,
  RESOLVE_DIRECTIVE,
  SET_BLOCK_TRACKING,
  CREATE_COMMENT,
  CREATE_TEXT,
  PUSH_SCOPE_ID,
  POP_SCOPE_ID,
  WITH_DIRECTIVES,
  CREATE_ELEMENT_VNODE,
  OPEN_BLOCK,
  CREATE_STATIC,
  WITH_CTX,
  RESOLVE_FILTER
} from './runtimeHelpers'
import { ImportItem } from './transform'

/**
 * 摇树注释
 */
const PURE_ANNOTATION = `/*#__PURE__*/`

/**
 * 代码生成节点
 * 模板子节点|JS子节点|SSR代码生成节点
 */
type CodegenNode = TemplateChildNode | JSChildNode | SSRCodegenNode

/**
 * 生成代码的结果
 * 代码： 字符串
 * 序言： 字符串
 * ast： 根节点
 * map: 原始sourcemap
 */
export interface CodegenResult {
  code: string
  preamble: string
  ast: RootNode
  map?: RawSourceMap
}

/**
 * 代码生成上下文
 */
export interface CodegenContext
  extends Omit<Required<CodegenOptions>, 'bindingMetadata' | 'inline'> {
  source: string
  code: string
  line: number
  column: number
  offset: number
  indentLevel: number
  pure: boolean
  map?: SourceMapGenerator
  helper(key: symbol): string
  push(code: string, node?: CodegenNode): void
  indent(): void
  deindent(withoutNewLine?: boolean): void
  newline(): void
}

/**
 * 创建代码生成的上下文
 * @param ast 
 * @param param1 
 * @returns 
 */
function createCodegenContext(
  ast: RootNode,
  {
    mode = 'function',
    prefixIdentifiers = mode === 'module',
    sourceMap = false,
    filename = `template.vue.html`,
    scopeId = null,
    optimizeImports = false,
    runtimeGlobalName = `Vue`,
    runtimeModuleName = `vue`,
    ssrRuntimeModuleName = 'vue/server-renderer',
    ssr = false,
    isTS = false,
    inSSR = false
  }: CodegenOptions
): CodegenContext {
  const context: CodegenContext = {
    mode,
    prefixIdentifiers,
    sourceMap,
    filename,
    scopeId,
    optimizeImports,
    runtimeGlobalName,
    runtimeModuleName,
    ssrRuntimeModuleName,
    ssr,
    isTS,
    inSSR,
    source: ast.loc.source,
    code: ``,
    column: 1,
    line: 1,
    offset: 0,
    indentLevel: 0,
    pure: false,
    map: undefined,
    /** 
     * 返回帮助函数
    */
    helper(key) {
      return `_${helperNameMap[key]}`
    },
    /**
     * 将代码放到上下文代码中拼接
     * @param code 
     * @param node 
     */
    push(code, node) {
      context.code += code
      // 如果不是浏览器环境，且存在map映射
      if (!__BROWSER__ && context.map) {
        if (node) {
          // 有传入节点时
          let name
          // 节点是一个静态表达式且不是一个静态节点
          if (node.type === NodeTypes.SIMPLE_EXPRESSION && !node.isStatic) {
            // 将内容开头的_ctx.删除
            const content = node.content.replace(/^_ctx\./, '')
            if (content !== node.content && isSimpleIdentifier(content)) {
              // 内容不是节点内容且是简单标识符
              name = content
            }
          }
          // 添加映射关系
          addMapping(node.loc.start, name)
        }
        // 位置推前
        advancePositionWithMutation(context, code)
        // 节点且节点位置不是起始存根
        if (node && node.loc !== locStub) {
          // 添加映射
          addMapping(node.loc.end)
        }
      }
    },
    /**
     * 开启新的一行，并相较于上一行多2个开头的空格
     */
    indent() {
      newline(++context.indentLevel)
    },
    /**
     * 将indent等级回调，换行时空格减少
     * @param withoutNewLine 不换行
     */
    deindent(withoutNewLine = false) {
      if (withoutNewLine) {
        --context.indentLevel
      } else {
        newline(--context.indentLevel)
      }
    },
    /** 换行并以当前界别的空格开头 */
    newline() {
      newline(context.indentLevel)
    }
  }

  /**
   * 换行，新行以n*2个空格开头
   * @param n 
   */
  function newline(n: number) {
    context.push('\n' + `  `.repeat(n))
  }

  /**
   * 添加映射
   * @param loc 位置
   * @param name 名称
   */
  function addMapping(loc: Position, name?: string) {
    context.map!.addMapping({
      name, // 名称
      source: context.filename, // 文件
      original: { // 源
        line: loc.line,
        column: loc.column - 1 // source-map column is 0 based
      },
      generated: { // 生成的上下文的行号
        line: context.line,
        column: context.column - 1
      }
    })
  }

  if (!__BROWSER__ && sourceMap) {
    // lazy require source-map implementation, only in non-browser builds
    // 懒加载source-map的实现，仅仅在非浏览器构建中启用
    context.map = new SourceMapGenerator()
    context.map!.setSourceContent(filename, context.source)
  }

  return context
}

// 代码生成这块有几个常用方法
// push 追加代码
// indent 代码格式化，控制缩进换行
// deindent 代码格式化，控制缩进换行

/**
 * 生成
 * 1. 创建代码生成上下文
 * 2. 生成预设代码
 * 3. 生成渲染函数
 * 4. 生成资源声明代码
 * 5. 生成创建VNode树的表达式
 * @param ast 
 * @param options 
 * @returns 
 */
export function generate(
  ast: RootNode,
  options: CodegenOptions & {
    onContextCreated?: (context: CodegenContext) => void
  } = {}
): CodegenResult {
  // 创建代码生成上下文
  const context = createCodegenContext(ast, options)
  if (options.onContextCreated) options.onContextCreated(context)
  const {
    mode,
    push,
    prefixIdentifiers,
    indent,
    deindent,
    newline,
    scopeId,
    ssr
  } = context

  // 有帮助函数
  const hasHelpers = ast.helpers.length > 0
  // 使用block
  const useWithBlock = !prefixIdentifiers && mode !== 'module'
  // 生成作用域Id
  const genScopeId = !__BROWSER__ && scopeId != null && mode === 'module'
  // 是内联的setup
  const isSetupInlined = !__BROWSER__ && !!options.inline

  // preambles
  // in setup() inline mode, the preamble is generated in a sub context
  // and returned separately.
  // 在setup()内联的序言，序言被一个子上下文生成并且单独返回
  // 生成预设代码
  const preambleContext = isSetupInlined
    ? createCodegenContext(ast, options)
    : context
  // 不是浏览器且模式是module
  if (!__BROWSER__ && mode === 'module') {
    genModulePreamble(ast, preambleContext, genScopeId, isSetupInlined)
  } else {
    genFunctionPreamble(ast, preambleContext)
  }
  // enter render function
  // 进入渲染函数
  const functionName = ssr ? `ssrRender` : `render`
  // 参数
  const args = ssr ? ['_ctx', '_push', '_parent', '_attrs'] : ['_ctx', '_cache']
  if (!__BROWSER__ && options.bindingMetadata && !options.inline) {
    // binding optimization args
    // 绑定优化的参数
    args.push('$props', '$setup', '$data', '$options')
  }
  // 标签
  const signature =
    !__BROWSER__ && options.isTS
      ? args.map(arg => `${arg}: any`).join(',')
      : args.join(', ')

  // 是setup内联
  if (isSetupInlined) {
    push(`(${signature}) => {`)
  } else {
    push(`function ${functionName}(${signature}) {`)
  }
  // 换行，开头空出2格
  indent()

  // 使用withBlock
  if (useWithBlock) {
    // with (_ctx) {}
    push(`with (_ctx) {`)
    indent()
    // function mode const declarations should be inside with block
    // also they should be renamed to avoid collision with user properties
    // 函数模式的const声明应该放在with块中
    // 此外，它们应该重新命名，以避免与用户属性冲突 加个_
    if (hasHelpers) {
      push(
        `const { ${ast.helpers
          .map(s => `${helperNameMap[s]}: _${helperNameMap[s]}`)
          .join(', ')} } = _Vue`
      )
      // 换行
      push(`\n`)
      // 新起一行
      newline()
    }
  }

  // generate asset resolution statements
  // 生成资源声明代码
  // ast的组件长度
  if (ast.components.length) {
    // 生成资源组件
    genAssets(ast.components, 'component', context)
    // ast树指令长度或者存在ast临时变量
    if (ast.directives.length || ast.temps > 0) {
      // 新起一行
      newline()
    }
  }
  // 存在ast指令
  if (ast.directives.length) {
    // 生成指令
    genAssets(ast.directives, 'directive', context)
    // ast存在变量
    if (ast.temps > 0) {
      newline()
    }
  }
  // 兼容性处理，ast过滤器，ast过滤器个数
  if (__COMPAT__ && ast.filters && ast.filters.length) {
    // 新行
    newline()
    // 生成过滤，filter，上下文
    genAssets(ast.filters, 'filter', context)
    // 新行
    newline()
  }

  // 存在ast临时变量
  if (ast.temps > 0) {
    // let 变量 
    // let _temp0, _temp1
    push(`let `)
    for (let i = 0; i < ast.temps; i++) {
      push(`${i > 0 ? `, ` : ``}_temp${i}`)
    }
  }
  // 存在组件或者指令或者临时变量
  if (ast.components.length || ast.directives.length || ast.temps) {
    push(`\n`)
    newline()
  }

  // generate the VNode tree expression
  // 生成vnode tree表达式
  // 不是ssr return Node 或者 return null
  if (!ssr) {
    push(`return `)
  }
  // 生成代码节点
  if (ast.codegenNode) {
    genNode(ast.codegenNode, context)
  } else {
    push(`null`)
  }

  // 闭合with
  if (useWithBlock) {
    deindent()
    push(`}`)
  }

  // 闭合setup
  deindent()
  push(`}`)

  return {
    ast,
    code: context.code,
    preamble: isSetupInlined ? preambleContext.code : ``,
    // SourceMapGenerator does have toJSON() method but it's not in the types
    // SourceMapGenerator有toJSON()方法，但它不在ts中
    map: context.map ? (context.map as any).toJSON() : undefined
  }
}

/**
 * 生成函数序言
 * @param ast 
 * @param context 
 */
function genFunctionPreamble(ast: RootNode, context: CodegenContext) {
  const {
    ssr,
    prefixIdentifiers,
    push,
    newline,
    runtimeModuleName,
    runtimeGlobalName,
    ssrRuntimeModuleName
  } = context
  // ssr 需要使用require
  // ssr 使用运行时全局名称
  const VueBinding =
    !__BROWSER__ && ssr
      ? `require(${JSON.stringify(runtimeModuleName)})`
      : runtimeGlobalName
  // 帮助函数别名
  const aliasHelper = (s: symbol) => `${helperNameMap[s]}: _${helperNameMap[s]}`
  // Generate const declaration for helpers
  // In prefix mode, we place the const declaration at top so it's done
  // only once; But if we not prefixing, we place the declaration inside the
  // with block so it doesn't incur the `in` check cost for every helper access.
  // 生成常量声明为帮助函数
  // 在前缀模式，我们将常量声明放在顶部
  // 这样它仅仅能够执行一次
  // 但如果我们没有加前缀，我们把声明放在在with block中
  // 它不会为每个helper访问招致“in”检查开销。
  if (ast.helpers.length > 0) {
    // 不是浏览器且有前缀标识符
    if (!__BROWSER__ && prefixIdentifiers) {
      push(
        `const { ${ast.helpers.map(aliasHelper).join(', ')} } = ${VueBinding}\n`
      )
    } else {
      // "with" mode.
      // save Vue in a separate variable to avoid collision
      // with 模式
      // 保存Vue在一个单独的变量中以避免碰撞
      push(`const _Vue = ${VueBinding}\n`)
      // in "with" mode, helpers are declared inside the with block to avoid
      // has check cost, but hoists are lifted out of the function - we need
      // to provide the helper here.
      // 在with模式下，帮助函数在with block中被声明用来避免检查花费
      // 但是挂起功能被取消
      // 我们需要提供帮助函数
      if (ast.hoists.length) {
        const staticHelpers = [
          CREATE_VNODE,
          CREATE_ELEMENT_VNODE,
          CREATE_COMMENT,
          CREATE_TEXT,
          CREATE_STATIC
        ]
          .filter(helper => ast.helpers.includes(helper))
          .map(aliasHelper)
          .join(', ')
        push(`const { ${staticHelpers} } = _Vue\n`)
      }
    }
  }
  // generate variables for ssr helpers
  // 生成变量用于ssr帮助函数
  if (!__BROWSER__ && ast.ssrHelpers && ast.ssrHelpers.length) {
    // ssr guarantees prefixIdentifier: true
    // ssr守卫前缀标识符: true
    push(
      `const { ${ast.ssrHelpers
        .map(aliasHelper)
        .join(', ')} } = require("${ssrRuntimeModuleName}")\n`
    )
  }
  // 生成挂起
  genHoists(ast.hoists, context)
  // 新起一行
  newline()
  push(`return `)
}

/**
 * 生成模块序言
 * @param ast 
 * @param context 
 * @param genScopeId 
 * @param inline 
 */
function genModulePreamble(
  ast: RootNode,
  context: CodegenContext,
  genScopeId: boolean,
  inline?: boolean
) {
  const {
    push,
    newline,
    optimizeImports,
    runtimeModuleName,
    ssrRuntimeModuleName
  } = context

  // 是否要生成scopeId且是否有挂起
  if (genScopeId && ast.hoists.length) {
    ast.helpers.push(PUSH_SCOPE_ID, POP_SCOPE_ID)
  }

  // generate import statements for helpers
  // 生成引入的语句用于帮助函数
  if (ast.helpers.length) {
    // 优化导入
    if (optimizeImports) {
      // when bundled with webpack with code-split, calling an import binding
      // as a function leads to it being wrapped with `Object(a.b)` or `(0,a.b)`,
      // incurring both payload size increase and potential perf overhead.
      // therefore we assign the imports to variables (which is a constant ~50b
      // cost per-component instead of scaling with template size)
      // 当使用webpack分割代码打包时
      // 调用引入绑定作为一个函数会导致它被包装成 Object(a.b) 或者 (0,a.b)
      // 导致负载的规模增长和潜在的性能开销
      // 因此我们分派引入的变量这是一个常量 ~50b
      // 每个组件成本是固定而不是按照模板的大小
      // import { name, name2 } from runtimeModule
      push(
        `import { ${ast.helpers
          .map(s => helperNameMap[s])
          .join(', ')} } from ${JSON.stringify(runtimeModuleName)}\n`
      )
      // 添加一个注释：绑定优化用于webpack的代码分割
      // 常量
      // const _name = name,
      //       _name2 = name2
      push(
        `\n// Binding optimization for webpack code-split\nconst ${ast.helpers
          .map(s => `_${helperNameMap[s]} = ${helperNameMap[s]}`)
          .join(', ')}\n`
      )
    } else {
      // 不优化导入的情况
      // import { name as _name, name2 as _name2 } from module
      push(
        `import { ${ast.helpers
          .map(s => `${helperNameMap[s]} as _${helperNameMap[s]}`)
          .join(', ')} } from ${JSON.stringify(runtimeModuleName)}\n`
      )
    }
  }

  // 如果引入了ssr的帮助函数
  // import { name as _name } from 'module'
  if (ast.ssrHelpers && ast.ssrHelpers.length) {
    push(
      `import { ${ast.ssrHelpers
        .map(s => `${helperNameMap[s]} as _${helperNameMap[s]}`)
        .join(', ')} } from "${ssrRuntimeModuleName}"\n`
    )
  }

  // 存在引入，生成引入的代码
  if (ast.imports.length) {
    genImports(ast.imports, context)
    newline()
  }

  // 生成挂起
  genHoists(ast.hoists, context)
  newline()

  if (!inline) {
    // 不是内联的  则写入export
    push(`export `)
  }
}

/**
 * 生成资源代码，  component， directive， filter
 * @param assets 
 * @param type 
 * @param param2 
 */
function genAssets(
  assets: string[],
  type: 'component' | 'directive' | 'filter',
  { helper, push, newline, isTS }: CodegenContext
) {
  // 生成对应的帮助函数
  const resolver = helper(
    __COMPAT__ && type === 'filter'
      ? RESOLVE_FILTER
      : type === 'component'
      ? RESOLVE_COMPONENT
      : RESOLVE_DIRECTIVE
  )
  // 遍历资源
  for (let i = 0; i < assets.length; i++) {
    let id = assets[i]
    // potential component implicit self-reference inferred from SFC filename
    // 从SFC文件名推断的潜在组件隐式自我引用
    const maybeSelfReference = id.endsWith('__self')
    // 如果是组件自我引用，将后缀的__self去掉，就又变成组件自己的名字了
    if (maybeSelfReference) {
      id = id.slice(0, -6)
    }
    // 推入代码
    // const id = resolver(id, true)!
    push(
      `const ${toValidAssetId(id, type)} = ${resolver}(${JSON.stringify(id)}${
        maybeSelfReference ? `, true` : ``
      })${isTS ? `!` : ``}`
    )
    // 如果后面还有新的资源，则换行新起
    if (i < assets.length - 1) {
      newline()
    }
  }
}

/**
 * 生成挂起点代码
 * @param hoists 
 * @param context 
 * @returns 
 */
function genHoists(hoists: (JSChildNode | null)[], context: CodegenContext) {
  if (!hoists.length) {
    return
  }
  context.pure = true
  const { push, newline, helper, scopeId, mode } = context
  // 是否生成scopeId
  const genScopeId = !__BROWSER__ && scopeId != null && mode !== 'function'
  newline()

  // generate inlined withScopeId helper
  // 生成内联的带有scopeId的帮助函数
  // 该函数的功能：
  // 生成id
  // 执行帮助函数
  // 推出id
  // 返回帮助函数的返回值
  if (genScopeId) {
    push(
      `const _withScopeId = n => (${helper(
        PUSH_SCOPE_ID
      )}("${scopeId}"),n=n(),${helper(POP_SCOPE_ID)}(),n)`
    )
    newline()
  }

  // 遍历挂起的点
  // const _hoisted_1 = _withScopedId(() => Node)
  // 如果不是needScopeId _hoisted_2 = Node
  for (let i = 0; i < hoists.length; i++) {
    const exp = hoists[i]
    if (exp) {
      // 如果是节点的话，需要scopeId
      const needScopeIdWrapper = genScopeId && exp.type === NodeTypes.VNODE_CALL
      push(
        `const _hoisted_${i + 1} = ${
          needScopeIdWrapper ? `${PURE_ANNOTATION} _withScopeId(() => ` : ``
        }`
      )
      genNode(exp, context)
      if (needScopeIdWrapper) {
        push(`)`)
      }
      newline()
    }
  }

  context.pure = false
}

/**
 * 生成引入
 * @param importsOptions 
 * @param context 
 * @returns 
 * import Node from '..'
 */
function genImports(importsOptions: ImportItem[], context: CodegenContext) {
  if (!importsOptions.length) {
    return
  }
  importsOptions.forEach(imports => {
    context.push(`import `)
    genNode(imports.exp, context)
    context.push(` from '${imports.path}'`)
    context.newline()
  })
}

/**
 * 是文本
 * @param n 
 * @returns 
 */
function isText(n: string | CodegenNode) {
  return (
    isString(n) ||
    n.type === NodeTypes.SIMPLE_EXPRESSION ||
    n.type === NodeTypes.TEXT ||
    n.type === NodeTypes.INTERPOLATION ||
    n.type === NodeTypes.COMPOUND_EXPRESSION
  )
}

/**
 * 生成像数组一样的节点列表
 * @param nodes 
 * @param context 
 */
function genNodeListAsArray(
  nodes: (string | CodegenNode | TemplateChildNode[])[],
  context: CodegenContext
) {
  const multilines =
    nodes.length > 3 ||
    ((!__BROWSER__ || __DEV__) && nodes.some(n => isArray(n) || !isText(n)))
  context.push(`[`)
  multilines && context.indent()
  genNodeList(nodes, context, multilines)
  multilines && context.deindent()
  context.push(`]`)
}

/**
 * 生成节点列表
 * @param nodes 
 * @param context 
 * @param multilines 
 * @param comma 
 */
function genNodeList(
  nodes: (string | symbol | CodegenNode | TemplateChildNode[])[],
  context: CodegenContext,
  multilines: boolean = false,
  comma: boolean = true
) {
  const { push, newline } = context
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (isString(node)) {
      push(node)
    } else if (isArray(node)) {
      genNodeListAsArray(node, context)
    } else {
      genNode(node, context)
    }
    if (i < nodes.length - 1) {
      if (multilines) {
        comma && push(',')
        newline()
      } else {
        comma && push(', ')
      }
    }
  }
}

/**
 * 根据节点的类型生成不同的节点
 * @param node 
 * @param context 
 * @returns 
 */
function genNode(node: CodegenNode | symbol | string, context: CodegenContext) {
  if (isString(node)) {
    context.push(node)
    return
  }
  if (isSymbol(node)) {
    context.push(context.helper(node))
    return
  }
  switch (node.type) {
    case NodeTypes.ELEMENT:
    case NodeTypes.IF:
    case NodeTypes.FOR:
      __DEV__ &&
        assert(
          node.codegenNode != null,
          `Codegen node is missing for element/if/for node. ` +
            `Apply appropriate transforms first.`
        )
      genNode(node.codegenNode!, context)
      break
    case NodeTypes.TEXT:
      genText(node, context)
      break
    case NodeTypes.SIMPLE_EXPRESSION:
      genExpression(node, context)
      break
    case NodeTypes.INTERPOLATION:
      genInterpolation(node, context)
      break
    case NodeTypes.TEXT_CALL:
      genNode(node.codegenNode, context)
      break
    case NodeTypes.COMPOUND_EXPRESSION:
      genCompoundExpression(node, context)
      break
    case NodeTypes.COMMENT:
      genComment(node, context)
      break
    case NodeTypes.VNODE_CALL:
      genVNodeCall(node, context)
      break

    case NodeTypes.JS_CALL_EXPRESSION:
      genCallExpression(node, context)
      break
    case NodeTypes.JS_OBJECT_EXPRESSION:
      genObjectExpression(node, context)
      break
    case NodeTypes.JS_ARRAY_EXPRESSION:
      genArrayExpression(node, context)
      break
    case NodeTypes.JS_FUNCTION_EXPRESSION:
      genFunctionExpression(node, context)
      break
    case NodeTypes.JS_CONDITIONAL_EXPRESSION:
      genConditionalExpression(node, context)
      break
    case NodeTypes.JS_CACHE_EXPRESSION:
      genCacheExpression(node, context)
      break
    case NodeTypes.JS_BLOCK_STATEMENT:
      genNodeList(node.body, context, true, false)
      break

    // SSR only types
    case NodeTypes.JS_TEMPLATE_LITERAL:
      !__BROWSER__ && genTemplateLiteral(node, context)
      break
    case NodeTypes.JS_IF_STATEMENT:
      !__BROWSER__ && genIfStatement(node, context)
      break
    case NodeTypes.JS_ASSIGNMENT_EXPRESSION:
      !__BROWSER__ && genAssignmentExpression(node, context)
      break
    case NodeTypes.JS_SEQUENCE_EXPRESSION:
      !__BROWSER__ && genSequenceExpression(node, context)
      break
    case NodeTypes.JS_RETURN_STATEMENT:
      !__BROWSER__ && genReturnStatement(node, context)
      break

    /* istanbul ignore next */
    case NodeTypes.IF_BRANCH:
      // noop
      break
    default:
      if (__DEV__) {
        assert(false, `unhandled codegen node type: ${(node as any).type}`)
        // make sure we exhaust all possible types
        const exhaustiveCheck: never = node
        return exhaustiveCheck
      }
  }
}

/**
 * 生成文本
 * @param node 
 * @param context 
 */
function genText(
  node: TextNode | SimpleExpressionNode,
  context: CodegenContext
) {
  context.push(JSON.stringify(node.content), node)
}

/**
 * 生成表达式
 * @param node 
 * @param context 
 */
function genExpression(node: SimpleExpressionNode, context: CodegenContext) {
  const { content, isStatic } = node
  context.push(isStatic ? JSON.stringify(content) : content, node)
}

/**
 * 生成插值
 * @param node 
 * @param context 
 */
function genInterpolation(node: InterpolationNode, context: CodegenContext) {
  const { push, helper, pure } = context
  if (pure) push(PURE_ANNOTATION)
  push(`${helper(TO_DISPLAY_STRING)}(`)
  genNode(node.content, context)
  push(`)`)
}

/**
 * 生成复杂表达式
 * @param node 
 * @param context 
 */
function genCompoundExpression(
  node: CompoundExpressionNode,
  context: CodegenContext
) {
  for (let i = 0; i < node.children!.length; i++) {
    const child = node.children![i]
    if (isString(child)) {
      context.push(child)
    } else {
      genNode(child, context)
    }
  }
}

/**
 * 生成表达式作为property的键
 * @param node 
 * @param context 
 */
function genExpressionAsPropertyKey(
  node: ExpressionNode,
  context: CodegenContext
) {
  const { push } = context
  // [复杂表达式]
  if (node.type === NodeTypes.COMPOUND_EXPRESSION) {
    push(`[`)
    genCompoundExpression(node, context)
    push(`]`)
  } else if (node.isStatic) {
    // only quote keys if necessary
    // 必要情况下仅仅引用keys
    const text = isSimpleIdentifier(node.content)
      ? node.content
      : JSON.stringify(node.content)
    push(text, node)
  } else {
    push(`[${node.content}]`, node)
  }
}

/**
 * 生成注释
 * @param node 
 * @param context 
 */
function genComment(node: CommentNode, context: CodegenContext) {
  const { push, helper, pure } = context
  if (pure) {
    push(PURE_ANNOTATION)
  }
  push(`${helper(CREATE_COMMENT)}(${JSON.stringify(node.content)})`, node)
}

/**
 * 生成节点
 * @param node 
 * @param context 
 * helper(WITH_DIRECTIVES)((${helper(OPEN_BLOCK)}(${disableTracking ? `true` : ``}), ${PURE_ANNOTATION}helper(callHelper)(nodeList), Node)
 */
function genVNodeCall(node: VNodeCall, context: CodegenContext) {
  const { push, helper, pure } = context
  const {
    tag,
    props,
    children,
    patchFlag,
    dynamicProps,
    directives,
    isBlock,
    disableTracking,
    isComponent
  } = node
  if (directives) {
    push(helper(WITH_DIRECTIVES) + `(`)
  }
  if (isBlock) {
    push(`(${helper(OPEN_BLOCK)}(${disableTracking ? `true` : ``}), `)
  }
  if (pure) {
    push(PURE_ANNOTATION)
  }
  const callHelper: symbol = isBlock
    ? getVNodeBlockHelper(context.inSSR, isComponent)
    : getVNodeHelper(context.inSSR, isComponent)
  push(helper(callHelper) + `(`, node)
  genNodeList(
    genNullableArgs([tag, props, children, patchFlag, dynamicProps]),
    context
  )
  push(`)`)
  if (isBlock) {
    push(`)`)
  }
  if (directives) {
    push(`, `)
    genNode(directives, context)
    push(`)`)
  }
}

/**
 * 倒序遍历所有参数，返回新数组
 * @param args 
 * @returns 
 * [,,,3,,,,] => [null,null,null,3]
 */
function genNullableArgs(args: any[]): CallExpression['arguments'] {
  let i = args.length
  // 遍历，找到第一个不为null或者undefined的参数
  while (i--) {
    if (args[i] != null) break
  }
  // 拷贝数组，将没有设置的设置为null
  return args.slice(0, i + 1).map(arg => arg || `null`)
}

// JavaScript
/**
 * 获取调用表达式
 * @param node 
 * @param context 
 * ```
 * {pure注释}callee(...args)
 * ```
 */
function genCallExpression(node: CallExpression, context: CodegenContext) {
  const { push, helper, pure } = context
  const callee = isString(node.callee) ? node.callee : helper(node.callee)
  if (pure) {
    push(PURE_ANNOTATION)
  }
  push(callee + `(`, node)
  genNodeList(node.arguments, context)
  push(`)`)
}

/**
 * 获取对象的表达式
 * @param node 
 * @param context 
 * @returns 
 * {}
 * { key: value }
 * {
 *   key: value,
 * }
 */
function genObjectExpression(node: ObjectExpression, context: CodegenContext) {
  const { push, indent, deindent, newline } = context
  const { properties } = node
  if (!properties.length) {
    push(`{}`, node)
    return
  }
  const multilines =
    properties.length > 1 ||
    ((!__BROWSER__ || __DEV__) &&
      properties.some(p => p.value.type !== NodeTypes.SIMPLE_EXPRESSION))
  push(multilines ? `{` : `{ `)
  multilines && indent()
  for (let i = 0; i < properties.length; i++) {
    const { key, value } = properties[i]
    // key
    genExpressionAsPropertyKey(key, context)
    push(`: `)
    // value
    genNode(value, context)
    if (i < properties.length - 1) {
      // will only reach this if it's multilines
      push(`,`)
      newline()
    }
  }
  multilines && deindent()
  push(multilines ? `}` : ` }`)
}

/**
 * 获取数组表达式
 * @param node 
 * @param context 
 */
function genArrayExpression(node: ArrayExpression, context: CodegenContext) {
  genNodeListAsArray(node.elements as CodegenNode[], context)
}

/**
 * 获取函数表达式
 * @param node 
 * @param context 
 * _helperNameMap[WITH_CTX]((...params) => {
 *   return Node
 * }, undefined, true)
 */
function genFunctionExpression(
  node: FunctionExpression,
  context: CodegenContext
) {
  const { push, indent, deindent } = context
  const { params, returns, body, newline, isSlot } = node
  if (isSlot) {
    // wrap slot functions with owner context
    // 包裹插槽函数有自己的上下文
    push(`_${helperNameMap[WITH_CTX]}(`)
  }
  push(`(`, node)
  if (isArray(params)) {
    genNodeList(params, context)
  } else if (params) {
    genNode(params, context)
  }
  push(`) => `)
  if (newline || body) {
    push(`{`)
    indent()
  }
  if (returns) {
    if (newline) {
      push(`return `)
    }
    if (isArray(returns)) {
      genNodeListAsArray(returns, context)
    } else {
      genNode(returns, context)
    }
  } else if (body) {
    genNode(body, context)
  }
  if (newline || body) {
    deindent()
    push(`}`)
  }
  if (isSlot) {
    if (__COMPAT__ && node.isNonScopedSlot) {
      push(`, undefined, true`)
    }
    push(`)`)
  }
}

/**
 * 三元条件表达式
 * @param node 
 * @param context 
 * (expression) ? consequent : alternate
 */
function genConditionalExpression(
  node: ConditionalExpression,
  context: CodegenContext
) {
  const { test, consequent, alternate, newline: needNewline } = node
  const { push, indent, deindent, newline } = context
  if (test.type === NodeTypes.SIMPLE_EXPRESSION) {
    const needsParens = !isSimpleIdentifier(test.content)
    needsParens && push(`(`)
    genExpression(test, context)
    needsParens && push(`)`)
  } else {
    push(`(`)
    genNode(test, context)
    push(`)`)
  }
  needNewline && indent()
  context.indentLevel++
  needNewline || push(` `)
  push(`? `)
  genNode(consequent, context)
  context.indentLevel--
  needNewline && newline()
  needNewline || push(` `)
  push(`: `)
  const isNested = alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION
  if (!isNested) {
    context.indentLevel++
  }
  genNode(alternate, context)
  if (!isNested) {
    context.indentLevel--
  }
  needNewline && deindent(true /* without newline */)
}

/**
 * 生成缓存表达式
 * @param node 
 * @param context 
 * isVNode:
 * _cache[0] || (
 *   helper(SET_BLOCK_TRACKING)(-1),
 *   _cache[0] = Node,
 *   helper(SET_BLOCK_TRACKING)(1),
 *   _cache[0]
 * )
 * 不是VNode
 * _cache[0] || (
 *   _cache[0] = Node,
 *   _cache[0]
 * )
 */
function genCacheExpression(node: CacheExpression, context: CodegenContext) {
  const { push, helper, indent, deindent, newline } = context
  // _cache[]
  push(`_cache[${node.index}] || (`)
  // 节点是虚拟节点
  if (node.isVNode) {
    indent()
    push(`${helper(SET_BLOCK_TRACKING)}(-1),`)
    newline()
  }
  push(`_cache[${node.index}] = `)
  genNode(node.value, context)
  if (node.isVNode) {
    push(`,`)
    newline()
    push(`${helper(SET_BLOCK_TRACKING)}(1),`)
    newline()
    push(`_cache[${node.index}]`)
    deindent()
  }
  push(`)`)
}

/**
 * 生成模板字符串
 * @param node 
 * @param context 
 * 对$,`,\这些特殊字符串进行转义处理
 * `${e}`
 */
function genTemplateLiteral(node: TemplateLiteral, context: CodegenContext) {
  const { push, indent, deindent } = context
  // 最外层放个 `
  push('`')
  // 节点长度
  const l = node.elements.length
  // l>3则是多行
  const multilines = l > 3
  // 遍历节点元素
  for (let i = 0; i < l; i++) {
    // 元素
    const e = node.elements[i]
    // 如果元素本身就是字符串，进行正则匹配，将元素中的 `,$,\ 替换成 \`,\$,\\
    if (isString(e)) {
      // 转化后就是 `\``, `\$`, `\\`
      push(e.replace(/(`|\$|\\)/g, '\\$1'))
    } else {
      /* 如果不是一个字符串，则往里添加元素 `${e}`,多行的话生成的是
       * `${
       *   e
       * }`
       */
      push('${')
      if (multilines) indent()
      genNode(e, context)
      if (multilines) deindent()
      push('}')
    }
  }
  // 结尾的 `
  push('`')
}

/**
 * 生成条件语句
 * @param node 
 * @param context
 * if (${test}) { 
 *   ${consequent}
 * } else ${根据节点类型，判断是新的if条件语句，还是else语句}
 */
function genIfStatement(node: IfStatement, context: CodegenContext) {
  const { push, indent, deindent } = context
  const { test, consequent, alternate } = node
  push(`if (`)
  genNode(test, context)
  push(`) {`)
  indent()
  genNode(consequent, context)
  deindent()
  push(`}`)
  // 存在互斥
  if (alternate) {
    // else
    push(` else `)
    if (alternate.type === NodeTypes.JS_IF_STATEMENT) {
      genIfStatement(alternate, context)
    } else {
      push(`{`)
      indent()
      genNode(alternate, context)
      deindent()
      push(`}`)
    }
  }
}

/**
 * 生成赋值表达式
 * @param node 
 * @param context 
 * ${left} = ${right}
 */
function genAssignmentExpression(
  node: AssignmentExpression,
  context: CodegenContext
) {
  genNode(node.left, context)
  context.push(` = `)
  genNode(node.right, context)
}

/**
 * 生成序列化的表达式
 * @param node 
 * @param context 
 * (${序列化的表达式})
 */
function genSequenceExpression(
  node: SequenceExpression,
  context: CodegenContext
) {
  context.push(`(`)
  genNodeList(node.expressions, context)
  context.push(`)`)
}

/**
 * 生成返回语句
 * @param param0 返回语句
 * @param context 代码上下文
 */
function genReturnStatement(
  { returns }: ReturnStatement,
  context: CodegenContext
) {
  context.push(`return `)
  // 如果returns是数组
  if (isArray(returns)) {
    genNodeListAsArray(returns, context)
  } else {
    // 否则处理不是数组的情况
    genNode(returns, context)
  }
}
