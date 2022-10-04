import {
  SourceLocation,
  Position,
  ElementNode,
  NodeTypes,
  CallExpression,
  createCallExpression,
  DirectiveNode,
  ElementTypes,
  TemplateChildNode,
  RootNode,
  ObjectExpression,
  Property,
  JSChildNode,
  createObjectExpression,
  SlotOutletNode,
  TemplateNode,
  RenderSlotCall,
  ExpressionNode,
  IfBranchNode,
  TextNode,
  InterpolationNode,
  VNodeCall,
  SimpleExpressionNode,
  BlockCodegenNode,
  MemoExpression
} from './ast'
import { TransformContext } from './transform'
import {
  MERGE_PROPS,
  TELEPORT,
  SUSPENSE,
  KEEP_ALIVE,
  BASE_TRANSITION,
  TO_HANDLERS,
  NORMALIZE_PROPS,
  GUARD_REACTIVE_PROPS,
  CREATE_BLOCK,
  CREATE_ELEMENT_BLOCK,
  CREATE_VNODE,
  CREATE_ELEMENT_VNODE,
  WITH_MEMO,
  OPEN_BLOCK
} from './runtimeHelpers'
import { isString, isObject, hyphenate, extend, NOOP } from '@vue/shared'
import { PropsExpression } from './transforms/transformElement'
import { parseExpression } from '@babel/parser'
import { Expression } from '@babel/types'

/**
 * 是否是静态表达式
 * 如果子节点类型是简单表达式且是静态表达式
 * @param p 
 * @returns 
 */
export const isStaticExp = (p: JSChildNode): p is SimpleExpressionNode =>
  p.type === NodeTypes.SIMPLE_EXPRESSION && p.isStatic

/**
 * 是内置类型
 * 标签和被期待的类型相同或者连字符后相同
 * @param tag 
 * @param expected 
 * @returns 
 */
export const isBuiltInType = (tag: string, expected: string): boolean =>
  tag === expected || tag === hyphenate(expected)

/**
 * 是否是核心组件
 * teleport
 * suspense
 * keep-alive
 * base-transition
 * @param tag 
 * @returns 
 */
export function isCoreComponent(tag: string): symbol | void {
  if (isBuiltInType(tag, 'Teleport')) {
    return TELEPORT
  } else if (isBuiltInType(tag, 'Suspense')) {
    return SUSPENSE
  } else if (isBuiltInType(tag, 'KeepAlive')) {
    return KEEP_ALIVE
  } else if (isBuiltInType(tag, 'BaseTransition')) {
    return BASE_TRANSITION
  }
}

/**
 * 非标识符正则表达式
 */
const nonIdentifierRE = /^\d|[^\$\w]/

/**
 * 是简单标识符，
 * 非简单标识符是以数字开头的或者里面不包含字母_和$符的
 * 简单标识符是不以数字开头的包含字母或者$_符号的
 * @param name 
 * @returns 
 */
export const isSimpleIdentifier = (name: string): boolean =>
  !nonIdentifierRE.test(name)

/**
 * 成员表达式状态
 * 在成员表达式里
 * 在[]里
 * 在()中
 * 在字符串中
 */
const enum MemberExpLexState {
  inMemberExp,
  inBrackets,
  inParens,
  inString
}

/**
 * 校验第一个表示字符
 */
const validFirstIdentCharRE = /[A-Za-z_$\xA0-\uFFFF]/
/**
 * 校验标识符字符
 */
const validIdentCharRE = /[\.\?\w$\xA0-\uFFFF]/
/**
 * 空格匹配
 */
const whitespaceRE = /\s+[.[]\s*|\s*[.[]\s+/g

/**
 * Simple lexer to check if an expression is a member expression. This is
 * lax and only checks validity at the root level (i.e. does not validate exps
 * inside square brackets), but it's ok since these are only used on template
 * expressions and false positives are invalid expressions in the first place.
 * 简单的词法分析表达式是否是一个成员表达式
 * 这是词法分析且仅仅检查根节点有效性
 * 不能够校验方括号里表达式
 * 但这是可以的，因为这些只用于模板表达式，假阳性在一开始就是无效的表达式。
 * 成员表达式要求()[]都能够闭合
 * 
 * 成员表达式节点，即表示引用对象成员的语句，
 * object 是引用对象的表达式节点，
 * property 是表示属性名称，
 * computed 如果为 false，
 * 是表示 . 来引用成员，
 * property 应该为一个 Identifier 节点，
 * 如果 computed 属性为 true，
 * 则是 [] 来进行引用，
 * 即 property 是一个 Expression 节点，
 * 名称是表达式的结果值。
 */
export const isMemberExpressionBrowser = (path: string): boolean => {
  // remove whitespaces around . or [ first
  // 首先移除 . 或者 [ 附近的空格
  path = path.trim().replace(whitespaceRE, s => s.trim())

  // 是成员表达式
  let state = MemberExpLexState.inMemberExp
  // 状态栈
  let stateStack: MemberExpLexState[] = []
  // 当前打开的[]的数量
  let currentOpenBracketCount = 0
  // 当前打开()点的数量
  let currentOpenParensCount = 0
  // 当前字符串类型
  let currentStringType: "'" | '"' | '`' | null = null

  // 遍历路径上的每个字符
  for (let i = 0; i < path.length; i++) {
    const char = path.charAt(i)
    switch (state) {
      case MemberExpLexState.inMemberExp:
        // 成员表达式，字符是[
        if (char === '[') {
          stateStack.push(state)
          // 状态变为在括号里
          state = MemberExpLexState.inBrackets
          // 当前开口的括号数++
          currentOpenBracketCount++
        } else if (char === '(') {
          // 在 () 中
          stateStack.push(state)
          state = MemberExpLexState.inParens
          currentOpenParensCount++
        } else if (
          !(i === 0 ? validFirstIdentCharRE : validIdentCharRE).test(char)
        ) {
          // 有效性校验
          return false
        }
        break
      case MemberExpLexState.inBrackets:
        // 在括号里
        if (char === `'` || char === `"` || char === '`') {
          // 在字符中
          stateStack.push(state)
          state = MemberExpLexState.inString
          currentStringType = char
        } else if (char === `[`) {
          // 开口括号++
          currentOpenBracketCount++
        } else if (char === `]`) {
          // 闭合[]
          if (!--currentOpenBracketCount) {
            state = stateStack.pop()!
          }
        }
        break
      case MemberExpLexState.inParens:
        if (char === `'` || char === `"` || char === '`') {
          // 进入字符模式
          stateStack.push(state)
          state = MemberExpLexState.inString
          currentStringType = char
        } else if (char === `(`) {
          currentOpenParensCount++
        } else if (char === `)`) {
          // if the exp ends as a call then it should not be considered valid
          // 如果exp以调用结束，那么它就不应该被认为是有效的
          if (i === path.length - 1) {
            return false
          }
          if (!--currentOpenParensCount) {
            state = stateStack.pop()!
          }
        }
        break
      case MemberExpLexState.inString:
        // 字符是这些类型  就是 ' ` " 这种字符串开始结束符，就结束字符串模式
        if (char === currentStringType) {
          state = stateStack.pop()!
          currentStringType = null
        }
        break
    }
  }
  // 成员表达式要求所有的括号都能够闭合
  return !currentOpenBracketCount && !currentOpenParensCount
}

/**
 * 是成员表达式（Node环境）
 * 浏览器中该函数为空函数，不需要判断
 * 解析表达式，使用表达式插件
 */
export const isMemberExpressionNode = __BROWSER__
  ? (NOOP as any as (path: string, context: TransformContext) => boolean)
  : (path: string, context: TransformContext): boolean => {
      try {
        let ret: Expression = parseExpression(path, {
          plugins: context.expressionPlugins
        })
        if (ret.type === 'TSAsExpression' || ret.type === 'TSTypeAssertion') {
          ret = ret.expression
        }
        return (
          ret.type === 'MemberExpression' ||
          ret.type === 'OptionalMemberExpression' ||
          ret.type === 'Identifier'
        )
      } catch (e) {
        return false
      }
    }

/**
 * 根据环境使用不同的成员表达式判定标准
 */
export const isMemberExpression = __BROWSER__
  ? isMemberExpressionBrowser
  : isMemberExpressionNode

/**
 * 获取内部范围
 * @param loc 
 * @param offset 
 * @param length 
 * @returns 
 */
export function getInnerRange(
  loc: SourceLocation,
  offset: number,
  length: number
): SourceLocation {
  __TEST__ && assert(offset <= loc.source.length)
  // 截取文本
  const source = loc.source.slice(offset, offset + length)
  // 新位置
  const newLoc: SourceLocation = {
    source,
    start: advancePositionWithClone(loc.start, loc.source, offset),
    end: loc.end
  }

  // 长度不为null
  if (length != null) {
    __TEST__ && assert(offset + length <= loc.source.length)
    // 获取新的位置
    newLoc.end = advancePositionWithClone(
      loc.start,
      loc.source,
      offset + length
    )
  }

  return newLoc
}

/**
 * 前进，但是使用的修改后的值
 * 先拷贝位置再修改
 * @param pos 
 * @param source 
 * @param numberOfCharacters 
 * @returns 
 */
export function advancePositionWithClone(
  pos: Position,
  source: string,
  numberOfCharacters: number = source.length
): Position {
  // 修改拷贝后的值
  return advancePositionWithMutation(
    extend({}, pos),
    source,
    numberOfCharacters
  )
}

// advance by mutation without cloning (for performance reasons), since this
// gets called a lot in the parser
/**
 * 前进通过修改而不是克隆（因为性能原因），因为这个调用在解析过程中会有很多次
 * @param pos 
 * @param source 
 * @param numberOfCharacters 
 * @returns 
 */
export function advancePositionWithMutation(
  pos: Position,
  source: string,
  numberOfCharacters: number = source.length
): Position {
  let linesCount = 0
  let lastNewLinePos = -1
  for (let i = 0; i < numberOfCharacters; i++) {
    if (source.charCodeAt(i) === 10 /* newline char code 换行符 */) {
      linesCount++
      // 上一行最后的位置的偏移量
      lastNewLinePos = i
    }
  }

  // 偏移位置增加字符数
  pos.offset += numberOfCharacters
  // 行数增加  根据\n次数
  pos.line += linesCount
  // 列数为上一行最后的位置不存在，说明没换过行，此时最后位置为原始列数 + 字符数
  // 否则为使用总字符数-上一行到的字符数
  pos.column =
    lastNewLinePos === -1
      ? pos.column + numberOfCharacters
      : numberOfCharacters - lastNewLinePos

  return pos
}

/**
 * 断言给警告
 * @param condition 
 * @param msg 
 */
export function assert(condition: boolean, msg?: string) {
  /* istanbul ignore if */
  if (!condition) {
    throw new Error(msg || `unexpected compiler condition`)
  }
}

/**
 * 寻找指定指令
 * @param node 
 * @param name 
 * @param allowEmpty 
 * @returns 
 */
export function findDir(
  node: ElementNode,
  name: string | RegExp,
  allowEmpty: boolean = false
): DirectiveNode | undefined {
  // 遍历属性，从属性找出指定的指令
  for (let i = 0; i < node.props.length; i++) {
    const p = node.props[i]
    if (
      p.type === NodeTypes.DIRECTIVE &&
      (allowEmpty || p.exp) &&
      (isString(name) ? p.name === name : name.test(p.name))
    ) {
      return p
    }
  }
}

/**
 * 寻找属性，找指定的
 * @param node 
 * @param name 
 * @param dynamicOnly 
 * @param allowEmpty 
 * @returns 
 */
export function findProp(
  node: ElementNode,
  name: string,
  dynamicOnly: boolean = false,
  allowEmpty: boolean = false
): ElementNode['props'][0] | undefined {
  // 遍历属性
  for (let i = 0; i < node.props.length; i++) {
    // 属性
    const p = node.props[i]
    // 属性
    if (p.type === NodeTypes.ATTRIBUTE) {
      if (dynamicOnly) continue
      if (p.name === name && (p.value || allowEmpty)) {
        return p
      }
    } else if (
      p.name === 'bind' &&
      (p.exp || allowEmpty) &&
      isStaticArgOf(p.arg, name)
    ) {
      return p
    }
  }
}

/**
 * 是静态参数
 * @param arg 
 * @param name 
 * @returns 
 */
export function isStaticArgOf(
  arg: DirectiveNode['arg'],
  name: string
): boolean {
  // 参数且是静态参数且参数名称相匹配
  return !!(arg && isStaticExp(arg) && arg.content === name)
}

/**
 * 是否存在动态key绑定
 * @param node 
 * @returns 
 */
export function hasDynamicKeyVBind(node: ElementNode): boolean {
  return node.props.some(
    p =>
      p.type === NodeTypes.DIRECTIVE &&
      p.name === 'bind' &&
      (!p.arg || // v-bind="obj"
        p.arg.type !== NodeTypes.SIMPLE_EXPRESSION || // v-bind:[_ctx.foo]
        !p.arg.isStatic) // v-bind:[foo]
  )
}

/**
 * 是否是文本
 * @param node 
 * @returns 
 */
export function isText(
  node: TemplateChildNode
): node is TextNode | InterpolationNode {
  return node.type === NodeTypes.INTERPOLATION || node.type === NodeTypes.TEXT
}

/**
 * v-slot
 * @param p 
 * @returns 
 */
export function isVSlot(p: ElementNode['props'][0]): p is DirectiveNode {
  return p.type === NodeTypes.DIRECTIVE && p.name === 'slot'
}

/**
 * 模板节点
 * @param node 
 * @returns 
 */
export function isTemplateNode(
  node: RootNode | TemplateChildNode
): node is TemplateNode {
  return (
    node.type === NodeTypes.ELEMENT && node.tagType === ElementTypes.TEMPLATE
  )
}

/**
 * 插槽出口
 * @param node 
 * @returns 
 */
export function isSlotOutlet(
  node: RootNode | TemplateChildNode
): node is SlotOutletNode {
  return node.type === NodeTypes.ELEMENT && node.tagType === ElementTypes.SLOT
}

/**
 * 获取vnode 帮助函数createVNode, CreateElementVNode
 * @param ssr 
 * @param isComponent 
 * @returns 
 */
export function getVNodeHelper(ssr: boolean, isComponent: boolean) {
  return ssr || isComponent ? CREATE_VNODE : CREATE_ELEMENT_VNODE
}

/**
 * 获取vnode块帮助函数 createBlock, createElementBlock
 * @param ssr 
 * @param isComponent 
 * @returns 
 */
export function getVNodeBlockHelper(ssr: boolean, isComponent: boolean) {
  return ssr || isComponent ? CREATE_BLOCK : CREATE_ELEMENT_BLOCK
}

/**
 * 属性帮助函数集  
 * 序列化属性  
 * 保护响应式属性
 */
const propsHelperSet = new Set([NORMALIZE_PROPS, GUARD_REACTIVE_PROPS])

/**
 * 获取未序列化的属性
 * 获取未序列化的属性
 * 如果回调函数不是字符串且属性帮助函数里不存在该函数
 * 那就递直到属性是一个字符串或者属性不是一个js调用表达式，并且往里加调用路径（一个函数）
 * @param props 
 * @param callPath 
 * @returns 
 */
function getUnnormalizedProps(
  props: PropsExpression | '{}',
  callPath: CallExpression[] = []
): [PropsExpression | '{}', CallExpression[]] {
  if (
    props &&
    !isString(props) &&
    props.type === NodeTypes.JS_CALL_EXPRESSION
  ) {
    // 如果节点是js调用表达式
    // 则获取其调用
    const callee = props.callee
    // 看有没有该调用
    if (!isString(callee) && propsHelperSet.has(callee)) {
      // 如果回调函数不是字符串且属性帮助函数里不存在该函数
      // 那就递直到属性是一个字符串或者属性不是一个js调用表达式，并且往里加调用路径（一个函数）
      return getUnnormalizedProps(
        props.arguments[0] as PropsExpression,
        callPath.concat(props)
      )
    }
  }
  return [props, callPath]
}
/**
 * 注入属性
 * @param node 
 * @param prop 
 * @param context 
 */
export function injectProp(
  node: VNodeCall | RenderSlotCall,
  prop: Property,
  context: TransformContext
) {
  let propsWithInjection: ObjectExpression | CallExpression | undefined
  /**
   * 1. mergeProps(...)
   * 2. toHandlers(...)
   * 3. normalizeProps(...)
   * 4. normalizeProps(guardReactiveProps(...))
   *
   * we need to get the real props before normalization
   * 
   * 1. 合并属性
   * 2. 转化成处理函数
   * 3. 序列化属性
   * 4. 序列化属性
   * 
   * 我们需要获取真实的属性在序列化前
   */
  let props =
    node.type === NodeTypes.VNODE_CALL ? node.props : node.arguments[2]
  // 调用路径
  let callPath: CallExpression[] = []
  // 父级调用
  let parentCall: CallExpression | undefined
  // js调用表达式
  if (
    props &&
    !isString(props) &&
    props.type === NodeTypes.JS_CALL_EXPRESSION
  ) {
    // 获取为序列化的属性
    const ret = getUnnormalizedProps(props)
    props = ret[0]
    callPath = ret[1]
    parentCall = callPath[callPath.length - 1]
  }

  // 属性为空或者是字符串
  if (props == null || isString(props)) {
    // 创建对象表达式
    propsWithInjection = createObjectExpression([prop])
  } else if (props.type === NodeTypes.JS_CALL_EXPRESSION) {
    // merged props... add ours
    // only inject key to object literal if it's the first argument so that
    // if doesn't override user provided keys
    // 合并属性 添加我们的
    // 仅仅注入key到object字面量如果它是第一个参数以致于
    // 没有覆盖用户提供的key
    const first = props.arguments[0] as string | JSChildNode
    // 属性第一个参数不是字符串且参数类型是js对象表达式
    if (!isString(first) && first.type === NodeTypes.JS_OBJECT_EXPRESSION) {
      // prop加入队头
      first.properties.unshift(prop)
    } else {
      if (props.callee === TO_HANDLERS) {
        // #2366
        // 回调函数是一个To_HANDLERS函数
        // 创建一个调用表达式（合并属性，创建对象表达式，props）
        propsWithInjection = createCallExpression(context.helper(MERGE_PROPS), [
          createObjectExpression([prop]),
          props
        ])
      } else {
        // 将对象表达式加入队头
        props.arguments.unshift(createObjectExpression([prop]))
      }
    }
    // 属性中带有注入
    !propsWithInjection && (propsWithInjection = props)
  } else if (props.type === NodeTypes.JS_OBJECT_EXPRESSION) {
    let alreadyExists = false
    // 已经存在
    // check existing key to avoid overriding user provided keys
    // 检查存在的key避免覆盖用户提供的keys
    if (prop.key.type === NodeTypes.SIMPLE_EXPRESSION) {
      // 属性key的名称
      const propKeyName = prop.key.content
      // 已经存在
      alreadyExists = props.properties.some(
        p =>
          p.key.type === NodeTypes.SIMPLE_EXPRESSION &&
          p.key.content === propKeyName
      )
    }
    if (!alreadyExists) {
      // 将prop做为一个属性加入
      props.properties.unshift(prop)
    }
    propsWithInjection = props
  } else {
    // single v-bind with expression, return a merged replacement
    // 单独的v-bind使用表达式，返回一个被合并的代替
    propsWithInjection = createCallExpression(context.helper(MERGE_PROPS), [
      createObjectExpression([prop]),
      props
    ])
    // in the case of nested helper call, e.g. `normalizeProps(guardReactiveProps(props))`,
    // it will be rewritten as `normalizeProps(mergeProps({ key: 0 }, props))`,
    // the `guardReactiveProps` will no longer be needed
    // 在某些方面嵌套的帮助函数调用
    // 例如 序列化属性 守卫响应式属性
    // 它将被重写成 序列化属性   合并属性 ({key:0},props)
    // 守卫响应属性将不再被需要
    // 父级调用是守卫响应属性，父级调用这一层可以忽略了，直接将父级设置为上一级
    if (parentCall && parentCall.callee === GUARD_REACTIVE_PROPS) {
      parentCall = callPath[callPath.length - 2]
    }
  }
  // 节点类型是VNode_CALL
  if (node.type === NodeTypes.VNODE_CALL) {
    // 存在父级调用，让父级调用第一个参数设置为注入的属性
    if (parentCall) {
      parentCall.arguments[0] = propsWithInjection
    } else {
      // 节点属性
      node.props = propsWithInjection
    }
  } else {
    // 不是vnode
    if (parentCall) {
      parentCall.arguments[0] = propsWithInjection
    } else {
      node.arguments[2] = propsWithInjection
    }
  }
}

/**
 * 生成有效的资源Id
 * @param name 
 * @param type 
 * @returns 
 */
export function toValidAssetId(
  name: string,
  type: 'component' | 'directive' | 'filter'
): string {
  // see issue#4422, we need adding identifier on validAssetId if variable `name` has specific character
  // 我们需要添加标识符在有效资源上，如果变量的名称有专有的字符
  return `_${type}_${name.replace(/[^\w]/g, (searchValue, replaceValue) => {
    return searchValue === '-' ? '_' : name.charCodeAt(replaceValue).toString()
  })}`
}

// Check if a node contains expressions that reference current context scope ids
/**
 * 检查节点是否包含引用当前上下文作用域id的表达式
 * @param node 
 * @param ids 
 * @returns 
 */
export function hasScopeRef(
  node: TemplateChildNode | IfBranchNode | ExpressionNode | undefined,
  ids: TransformContext['identifiers']
): boolean {
  // 没有节点或者不存在标识符
  if (!node || Object.keys(ids).length === 0) {
    return false
  }
  switch (node.type) {
    case NodeTypes.ELEMENT:
      // 元素
      // 遍历属性，看属性中是否存在，指令的参数是否存在在作用域ids中，或者指令的表达式中有参数存在
      for (let i = 0; i < node.props.length; i++) {
        const p = node.props[i]
        if (
          p.type === NodeTypes.DIRECTIVE &&
          (hasScopeRef(p.arg, ids) || hasScopeRef(p.exp, ids))
        ) {
          return true
        }
      }
      // 对子节点遍历
      return node.children.some(c => hasScopeRef(c, ids))
    case NodeTypes.FOR:
      // 如果是For节点，看是不是，然后对子节点遍历
      if (hasScopeRef(node.source, ids)) {
        return true
      }
      return node.children.some(c => hasScopeRef(c, ids))
    case NodeTypes.IF:
      // if对每个分支遍历搜索
      return node.branches.some(b => hasScopeRef(b, ids))
    case NodeTypes.IF_BRANCH:
      // ifbranch，看条件表达式有没有，
      if (hasScopeRef(node.condition, ids)) {
        return true
      }
      // 找子节点
      return node.children.some(c => hasScopeRef(c, ids))
    case NodeTypes.SIMPLE_EXPRESSION:
      // 简单表达式
      // 节点不是静态的且节点的内容是一个简单标识符，节点的内容在ids里
      return (
        !node.isStatic &&
        isSimpleIdentifier(node.content) &&
        !!ids[node.content]
      )
    case NodeTypes.COMPOUND_EXPRESSION:
      // 复杂表达式
      return node.children.some(c => isObject(c) && hasScopeRef(c, ids))
    case NodeTypes.INTERPOLATION:
    case NodeTypes.TEXT_CALL:
      // 内插或者文本
      return hasScopeRef(node.content, ids)
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
      // 注释或者纯文本直接就不需要引用
      return false
    default:
      if (__DEV__) {
        const exhaustiveCheck: never = node
        exhaustiveCheck
      }
      return false
  }
}

/**
 * 获取v-memo节点
 * @param node 
 * @returns 
 */
export function getMemoedVNodeCall(node: BlockCodegenNode | MemoExpression) {
  if (node.type === NodeTypes.JS_CALL_EXPRESSION && node.callee === WITH_MEMO) {
    return node.arguments[1].returns as VNodeCall
  } else {
    return node
  }
}

/**
 * 制作块
 * @param node 
 * @param param1 
 */
export function makeBlock(
  node: VNodeCall,
  { helper, removeHelper, inSSR }: TransformContext
) {
  if (!node.isBlock) {
    node.isBlock = true
    removeHelper(getVNodeHelper(inSSR, node.isComponent))
    helper(OPEN_BLOCK)
    helper(getVNodeBlockHelper(inSSR, node.isComponent))
  }
}
