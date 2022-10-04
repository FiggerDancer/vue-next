// - Parse expressions in templates into compound expressions so that each
//   identifier gets more accurate source-map locations.
//
// - Prefix identifiers with `_ctx.` or `$xxx` (for known binding types) so that
//   they are accessed from the right source
//
// - This transform is only applied in non-browser builds because it relies on
//   an additional JavaScript parser. In the browser, there is no source-map
//   support and the code is wrapped in `with (this) { ... }`.
// 解析模板中的表达式成复杂表达式
// 每个标识符获取更确切的source-map位置
// 标识符使用_ctx.或者$xxx前缀（用于已知binding类型）所以他们
// 可以从正确的源访问到
// 这个转化仅仅被应用于非浏览器构建中，因为它依赖于一个额外的js解析器。
// 在浏览器中，
// 那没有source-map支持并且code被包裹在`with(this){...}`内部
import { NodeTransform, TransformContext } from '../transform'
import {
  NodeTypes,
  createSimpleExpression,
  ExpressionNode,
  SimpleExpressionNode,
  CompoundExpressionNode,
  createCompoundExpression,
  ConstantTypes
} from '../ast'
import {
  isInDestructureAssignment,
  isStaticProperty,
  isStaticPropertyKey,
  walkIdentifiers
} from '../babelUtils'
import { advancePositionWithClone, isSimpleIdentifier } from '../utils'
import {
  isGloballyWhitelisted,
  makeMap,
  hasOwn,
  isString,
  genPropsAccessExp
} from '@vue/shared'
import { createCompilerError, ErrorCodes } from '../errors'
import {
  Node,
  Identifier,
  AssignmentExpression,
  UpdateExpression
} from '@babel/types'
import { validateBrowserExpression } from '../validateExpression'
import { parse } from '@babel/parser'
import { IS_REF, UNREF } from '../runtimeHelpers'
import { BindingTypes } from '../options'

/**
 * 是字面量白名单
 */
const isLiteralWhitelisted = /*#__PURE__*/ makeMap('true,false,null,this')

/**
 * 表达式转化，将表达式转化成最终版本
 * 主要功能就是：转换插值和元素指令中的动态表达式
 * 简单表达式转化为复杂表达式对象
 * 变量可能要加前缀，如_ctx.msg _ctx.test
 * 内部主要是通过processExpression函数完成
 * 这个方法只能放在Node端执行，不能再Web端执行
 * 因为这个函数依赖@babel/parser 这个库通常Node.js端用，本身体积非常大
 * 打包进vue，让包体积膨胀4倍，生产环境的Web端是不会引入的
 * Web生产环境仍然会使用with的方式
 * 
 * 
 * @param node 
 * @param context 
 */
export const transformExpression: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.INTERPOLATION) {
    node.content = processExpression(
      node.content as SimpleExpressionNode,
      context
    )
  } else if (node.type === NodeTypes.ELEMENT) {
    // handle directives on element
    // 在元素上处理指令
    for (let i = 0; i < node.props.length; i++) {
      const dir = node.props[i]
      // do not process for v-on & v-for since they are special handled
      // 不处理v-on和v-for因为他们有专用的处理
      if (dir.type === NodeTypes.DIRECTIVE && dir.name !== 'for') {
        const exp = dir.exp
        const arg = dir.arg
        // do not process exp if this is v-on:arg - we need special handling
        // for wrapping inline statements.
        // 如果这是v-on:arg 则不用处理表达式
        // 我们需要专有的处理用于包裹内联的语句
        if (
          exp &&
          exp.type === NodeTypes.SIMPLE_EXPRESSION &&
          !(dir.name === 'on' && arg)
        ) {
          dir.exp = processExpression(
            exp,
            context,
            // slot args must be processed as function params
            // 插槽参数必须被处理成一个函数参数
            dir.name === 'slot'
          )
        }
        // 如果参数和参数类型是简单表达式且参数是静态的
        // 指令的参数
        if (arg && arg.type === NodeTypes.SIMPLE_EXPRESSION && !arg.isStatic) {
          dir.arg = processExpression(arg, context)
        }
      }
    }
  }
}

/**
 * 前缀标签
 */
interface PrefixMeta {
  prefix?: string
  isConstant: boolean
  start: number
  end: number
  scopeIds?: Set<string>
}

// Important: since this function uses Node.js only dependencies, it should
// always be used with a leading !__BROWSER__ check so that it can be
// tree-shaken from the browser build.
/**
 * 注意：因为这个方法使用只依赖Node.js
 * 它应该总是被用在一个非浏览器环境中检查，
 * 因此它可能在浏览器构建中被摇树
 * @param node 
 * @param context 
 * @param asParams 
 * @param asRawStatements 
 * @param localVars 
 * @returns 
 */
export function processExpression(
  node: SimpleExpressionNode,
  context: TransformContext,
  // some expressions like v-slot props & v-for aliases should be parsed as
  // function params
  // 一些表达式像v-slot props和v-for别名应该被传递作为方法的参数
  asParams = false,
  // v-on handler values may contain multiple statements
  // v-on处理器的值可能包含多个语句
  asRawStatements = false,
  localVars: Record<string, number> = Object.create(context.identifiers)
): ExpressionNode {
  if (__BROWSER__) {
    if (__DEV__) {
      // simple in-browser validation (same logic in 2.x)
      // 简单的在浏览器校验中（相同的逻辑在2.x)
      validateBrowserExpression(node, context, asParams, asRawStatements)
    }
    return node
  }

  // 如果上下文中无前缀标识符或者存在去除空格的节点内容
  if (!context.prefixIdentifiers || !node.content.trim()) {
    return node
  }

  // 内联，绑定标签数据
  const { inline, bindingMetadata } = context
  /**
   * 重写标识符
   * @param raw 原始值
   * @param parent 父节点
   * @param id 标识符
   * @returns 
   */
  const rewriteIdentifier = (raw: string, parent?: Node, id?: Identifier) => {
    // 类型， 包含该值则类型定义为该值
    const type = hasOwn(bindingMetadata, raw) && bindingMetadata[raw]
    // 如果是内联
    if (inline) {
      // x = y
      // 赋值表达式
      // 且左边===id
      const isAssignmentLVal =
        parent && parent.type === 'AssignmentExpression' && parent.left === id
      // x++
      // 更新表达式
      const isUpdateArg =
        parent && parent.type === 'UpdateExpression' && parent.argument === id
      // ({ x } = y)
      // 解构赋值
      const isDestructureAssignment =
        parent && isInDestructureAssignment(parent, parentStack)

      // setup const 或者 作用域变量
      if (
        type === BindingTypes.SETUP_CONST ||
        type === BindingTypes.SETUP_REACTIVE_CONST ||
        localVars[raw]
      ) {
        // 返回原始值
        return raw
      } else if (type === BindingTypes.SETUP_REF) {
        // setup 内的 ref 则修改为 raw.value
        return `${raw}.value`
      } else if (type === BindingTypes.SETUP_MAYBE_REF) {
        // const binding that may or may not be ref
        // if it's not a ref, then assignments don't make sense -
        // so we ignore the non-ref assignment case and generate code
        // that assumes the value to be a ref for more efficiency
        // 常量绑定可能是也可能不是ref，如果不是一个ref
        // 赋值没有发生，我们忽视非ref的赋值情况并且生成代码
        // 假定这个值是一个ref更有效
        return isAssignmentLVal || isUpdateArg || isDestructureAssignment
          ? `${raw}.value`
          : `${context.helperString(UNREF)}(${raw})`
      } else if (type === BindingTypes.SETUP_LET) {
        if (isAssignmentLVal) {
          // let binding.
          // this is a bit more tricky as we need to cover the case where
          // let is a local non-ref value, and we need to replicate the
          // right hand side value.
          // x = y --> isRef(x) ? x.value = y : x = y
          // let 绑定
          // 这有点麻烦，因为我们需要覆盖这种情况当let是一个作用域非ref变量，并且我们需要复制右边的值
          const { right: rVal, operator } = parent as AssignmentExpression
          // 右边的表达式
          const rExp = rawExp.slice(rVal.start! - 1, rVal.end! - 1)
          // 右表达式字符串，字符串化右边的表达式
          const rExpString = stringifyExpression(
            processExpression(
              createSimpleExpression(rExp, false),
              context,
              false,
              false,
              knownIds
            )
          )
          return `${context.helperString(IS_REF)}(${raw})${
            context.isTS ? ` //@ts-ignore\n` : ``
          } ? ${raw}.value ${operator} ${rExpString} : ${raw}`
        } else if (isUpdateArg) {
          // make id replace parent in the code range so the raw update operator
          // is removed
          // 使id替换代码范围中的parent，以便删除原始更新操作符
          id!.start = parent!.start
          id!.end = parent!.end
          // 前缀
          const { prefix: isPrefix, operator } = parent as UpdateExpression
          const prefix = isPrefix ? operator : ``
          const postfix = isPrefix ? `` : operator
          // let binding.
          // x++ --> isRef(a) ? a.value++ : a++
          // let 绑定
          // x++ --> isRef(a) ? a.value++ : a++
          return `${context.helperString(IS_REF)}(${raw})${
            context.isTS ? ` //@ts-ignore\n` : ``
          } ? ${prefix}${raw}.value${postfix} : ${prefix}${raw}${postfix}`
        } else if (isDestructureAssignment) {
          // TODO
          // let binding in a destructure assignment - it's very tricky to
          // handle both possible cases here without altering the original
          // structure of the code, so we just assume it's not a ref here
          // for now
          // 让binding在一个解构赋值中，它非常麻烦处理两个可能发生的情况在不变更代码原始结构的情况下，所以现在我们仅仅假定它不是ref
          return raw
        } else {
          // 对原始值拆包
          return `${context.helperString(UNREF)}(${raw})`
        }
      } else if (type === BindingTypes.PROPS) {
        // use __props which is generated by compileScript so in ts mode
        // it gets correct type
        // 使用props被编译器脚本生成，
        // 所以在ts模式中它获得了正确的类型
        return genPropsAccessExp(raw)
      } else if (type === BindingTypes.PROPS_ALIASED) {
        // prop with a different local alias (from defineProps() destructure)
        // prop使用一个不同的作用域别名（来自定义属性解构）
        return genPropsAccessExp(bindingMetadata.__propsAliases![raw])
      }
    } else {
      if (type && type.startsWith('setup')) {
        // setup bindings in non-inline mode
        // setup绑定在非内联模式中
        return `$setup.${raw}`
      } else if (type === BindingTypes.PROPS_ALIASED) {
        return `$props['${bindingMetadata.__propsAliases![raw]}']`
      } else if (type) {
        return `$${type}.${raw}`
      }
    }

    // fallback to ctx
    // 回退到上下文的raw值
    return `_ctx.${raw}`
  }

  // fast path if expression is a simple identifier.
  // 如果表达式是一个简单标识符则快捷方式如下
  // 原始表达式
  const rawExp = node.content
  // bail constant on parens (function invocation) and dot (member access)
  // 括号(函数调用)和点(成员访问)上的保释常量
  const bailConstant = rawExp.indexOf(`(`) > -1 || rawExp.indexOf('.') > 0

  // 是简单标识符
  if (isSimpleIdentifier(rawExp)) {
    // 是作用域变量引用
    const isScopeVarReference = context.identifiers[rawExp]
    // 全局的允许
    const isAllowedGlobal = isGloballyWhitelisted(rawExp)
    // 字面量
    const isLiteral = isLiteralWhitelisted(rawExp)
    // 不作为参数且不是作用域变量引用且不允许全局且不是字面量
    if (!asParams && !isScopeVarReference && !isAllowedGlobal && !isLiteral) {
      // const bindings exposed from setup can be skipped for patching but
      // cannot be hoisted to module scope
      // 可以通过跳过从setup中暴露的常量绑定来打补丁
      // 但不能被提升到模块作用域上
      if (bindingMetadata[node.content] === BindingTypes.SETUP_CONST) {
        node.constType = ConstantTypes.CAN_SKIP_PATCH
      }
      node.content = rewriteIdentifier(rawExp)
    } else if (!isScopeVarReference) {
      if (isLiteral) {
        node.constType = ConstantTypes.CAN_STRINGIFY
      } else {
        node.constType = ConstantTypes.CAN_HOIST
      }
    }
    return node
  }

  let ast: any
  // exp needs to be parsed differently:
  // 1. Multiple inline statements (v-on, with presence of `;`): parse as raw
  //    exp, but make sure to pad with spaces for consistent ranges
  // 2. Expressions: wrap with parens (for e.g. object expressions)
  // 3. Function arguments (v-for, v-slot): place in a function argument position
  // 表达式需要通过不同的方式解析：
  // 1. 多个内联语句 v-on 使用时存在；
  // 解析成原始表达式，但要保证扩展空格范围的一致性
  // 2. 表达式： 使用{}包裹的表达式，用于例如对象表达式
  // 3. 函数参数 v-for， v-slot 放置在一个函数参数的位置
  const source = asRawStatements
    ? ` ${rawExp} `
    : `(${rawExp})${asParams ? `=>{}` : ``}`
  // 解析成ast
  try {
    ast = parse(source, {
      plugins: context.expressionPlugins
    }).program
  } catch (e: any) {
    context.onError(
      createCompilerError(
        ErrorCodes.X_INVALID_EXPRESSION,
        node.loc,
        undefined,
        e.message
      )
    )
    return node
  }

  type QualifiedId = Identifier & PrefixMeta
  /**
   * 标识符id
   */
  const ids: QualifiedId[] = []
  /**
   * {}栈
   */
  const parentStack: Node[] = []
  /**
   * 知识点Id
   */
  const knownIds: Record<string, number> = Object.create(context.identifiers)

  
  walkIdentifiers(
    ast,
    (node, parent, _, isReferenced, isLocal) => {
      if (isStaticPropertyKey(node, parent!)) {
        return
      }
      // v2 wrapped filter call
      if (__COMPAT__ && node.name.startsWith('_filter_')) {
        return
      }

      const needPrefix = isReferenced && canPrefix(node)
      if (needPrefix && !isLocal) {
        if (isStaticProperty(parent!) && parent.shorthand) {
          // property shorthand like { foo }, we need to add the key since
          // we rewrite the value
          // 像{foo}这样的属性简写，我们需要添加键，因为我们重写了值
          ;(node as QualifiedId).prefix = `${node.name}: `
        }
        node.name = rewriteIdentifier(node.name, parent, node)
        ids.push(node as QualifiedId)
      } else {
        // The identifier is considered constant unless it's pointing to a
        // local scope variable (a v-for alias, or a v-slot prop)
        // 标识符被认为是常量除非它指向一个作用域变量
        // 一个v-for别名或者一个v-slot的prop
        if (!(needPrefix && isLocal) && !bailConstant) {
          ;(node as QualifiedId).isConstant = true
        }
        // also generate sub-expressions for other identifiers for better
        // source map support. (except for property keys which are static)
        // 也生成了子表达式为了更好的用于其他表示符
        // sourcemap支持（除非属性keys是静态的）
        ids.push(node as QualifiedId)
      }
    },
    true, // invoke on ALL identifiers 在所有标识符上调用
    parentStack,
    knownIds
  )

  // We break up the compound expression into an array of strings and sub
  // expressions (for identifiers that have been prefixed). In codegen, if
  // an ExpressionNode has the `.children` property, it will be used instead of
  // `.content`.
  /**
   * 我们把复杂组件茶城一个字符串或者子表达式数组（因为标识符已经添加前缀）
   * 在生成的代码中，如果一个表达式有children属性，它将被用来代替.content
   */
  const children: CompoundExpressionNode['children'] = []
  ids.sort((a, b) => a.start - b.start)
  ids.forEach((id, i) => {
    // range is offset by -1 due to the wrapping parens when parsed
    // 当解析时，范围是偏离-1对于包裹的括号
    const start = id.start - 1
    const end = id.end - 1
    // 上一个节点
    const last = ids[i - 1]
    // 引文
    const leadingText = rawExp.slice(last ? last.end - 1 : 0, start)
    // 引文长度，id的修饰符
    if (leadingText.length || id.prefix) {
      children.push(leadingText + (id.prefix || ``))
    }
    // 原始表达式
    const source = rawExp.slice(start, end)
    // 创建简单表达式
    children.push(
      createSimpleExpression(
        id.name,
        false,
        {
          source,
          start: advancePositionWithClone(node.loc.start, source, start),
          end: advancePositionWithClone(node.loc.start, source, end)
        },
        id.isConstant ? ConstantTypes.CAN_STRINGIFY : ConstantTypes.NOT_CONSTANT
      )
    )
    // 原始表达式
    if (i === ids.length - 1 && end < rawExp.length) {
      children.push(rawExp.slice(end))
    }
  })

  // 创建复杂表达式
  let ret
  if (children.length) {
    ret = createCompoundExpression(children, node.loc)
  } else {
    ret = node
    ret.constType = bailConstant
      ? ConstantTypes.NOT_CONSTANT
      : ConstantTypes.CAN_STRINGIFY
  }
  // 标识符
  ret.identifiers = Object.keys(knownIds)
  return ret
}

/**
 * 可以加前缀
 * @param id 
 * @returns 
 */
function canPrefix(id: Identifier) {
  // skip whitelisted globals
  // 跳过全局白名单
  if (isGloballyWhitelisted(id.name)) {
    return false
  }
  // special case for webpack compilation
  // 特殊的情况用于webpack编译
  if (id.name === 'require') {
    return false
  }
  return true
}

/**
 * 字符串化表达式
 * @param exp 
 * @returns 
 */
function stringifyExpression(exp: ExpressionNode | string): string {
  // 如果表达式是字符串
  if (isString(exp)) {
    // 返回表达式
    return exp
  } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
    // 表达式类型是简单表达式
    // 表达式内容
    return exp.content
  } else {
    // 表达式的子节点递归的去做表达式转化
    return (exp.children as (ExpressionNode | string)[])
      .map(stringifyExpression)
      .join('')
  }
}
