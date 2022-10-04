import { isString } from '@vue/shared'
import { ForParseResult } from './transforms/vFor'
import {
  RENDER_SLOT,
  CREATE_SLOTS,
  RENDER_LIST,
  OPEN_BLOCK,
  FRAGMENT,
  WITH_DIRECTIVES,
  WITH_MEMO
} from './runtimeHelpers'
import { PropsExpression } from './transforms/transformElement'
import { ImportItem, TransformContext } from './transform'
import { getVNodeBlockHelper, getVNodeHelper } from './utils'

// Vue template is a platform-agnostic superset of HTML (syntax only).
// More namespaces like SVG and MathML are declared by platform specific
// compilers.
// vue 模板是一个平台无关的html超集（仅语法）
// 更多命名空间像是SVG和MathML被声明通过专有平台编译器
export type Namespace = number

/**
 * 枚举命名空间HMTL
 */
export const enum Namespaces {
  HTML
}

/**
 * 节点类型
 */
export const enum NodeTypes {
  /** 根节点 */
  ROOT,
  /** 元素 */
  ELEMENT,
  /** 文本 */
  TEXT,
  /** 注释 */
  COMMENT,
  /** 简单表达式 */
  SIMPLE_EXPRESSION,
  /** 内插值 */
  INTERPOLATION,
  /** attr */ 
  ATTRIBUTE,
  /** 指令 */
  DIRECTIVE,
  // containers
  // 容器
  /** 复杂表达式 */
  COMPOUND_EXPRESSION,
  /** v-if */
  IF,
  /** v-if分支 */ 
  IF_BRANCH,
  /** for */ 
  FOR,
  /** 文本调用 */ 
  TEXT_CALL,
  // codegen
  /** vnode调用 */ 
  VNODE_CALL,
  /** js调用表达式 */ 
  JS_CALL_EXPRESSION,
  /** js对象表达式 */ 
  JS_OBJECT_EXPRESSION,
  /** js属性 */ 
  JS_PROPERTY,
  /** js数组表达式 */ 
  JS_ARRAY_EXPRESSION,
  /** js方法表达式 */ 
  JS_FUNCTION_EXPRESSION,
  /** js条件表达式 */ 
  JS_CONDITIONAL_EXPRESSION,
  /** js缓存表达式 */ 
  JS_CACHE_EXPRESSION,

  // ssr codegen
  // 服务器渲染
  /** block */ 
  JS_BLOCK_STATEMENT,
  /** template */ 
  JS_TEMPLATE_LITERAL,
  /** 条件陈述 */ 
  JS_IF_STATEMENT,
  /** 假定表达式 */ 
  JS_ASSIGNMENT_EXPRESSION,
  /** 序列表达式 */ 
  JS_SEQUENCE_EXPRESSION,
  /** 返回陈述 */
  JS_RETURN_STATEMENT
}

/**
 * 元素类型
 */
export const enum ElementTypes {
  ELEMENT,
  COMPONENT,
  SLOT,
  TEMPLATE
}

/**
 * Node 节点
 */
export interface Node {
  type: NodeTypes
  /**
   * 代码的位置信息
   */
  loc: SourceLocation
}

// The node's range. The `start` is inclusive and `end` is exclusive.
// [start, end)
/**
 * 节点范围
 * start被被包含
 * end是被排除在外的
 * [start, end)
 */
export interface SourceLocation {
  start: Position
  end: Position
  source: string
}

/**
 * 位置
 * offset 从文件开始位置偏移量
 * line 行数
 * column 列
 */
export interface Position {
  offset: number // from start of file
  line: number
  column: number
}

/**
 * 父节点
 * 根节点|元素节点|条件分支节点|v-for节点
 */
export type ParentNode = RootNode | ElementNode | IfBranchNode | ForNode

/**
 * 表达式节点
 * 简单表达式节点|复杂表达式节点
 */
export type ExpressionNode = SimpleExpressionNode | CompoundExpressionNode

/**
 * 模板子节点
 * Element节点|内插节点|复杂表达式节点|文本节点|注释节点|If节点|IfBranch节点|For节点|文本回调节点
 */
export type TemplateChildNode =
  | ElementNode
  | InterpolationNode
  | CompoundExpressionNode
  | TextNode
  | CommentNode
  | IfNode
  | IfBranchNode
  | ForNode
  | TextCallNode

/**
 * 根节点
 * type: 根节点
 * children: 子节点
 * helpers
 * components
 * directives:指令
 * hoists:挂起
 * imports:引入
 * cached:缓存
 * temps:临时
 * ssrHelpers:
 * codegenNode:代码生成的Node
 */
export interface RootNode extends Node {
  type: NodeTypes.ROOT
  children: TemplateChildNode[]
  helpers: symbol[]
  components: string[]
  directives: string[]
  hoists: (JSChildNode | null)[]
  imports: ImportItem[]
  cached: number
  temps: number
  ssrHelpers?: symbol[]
  codegenNode?: TemplateChildNode | JSChildNode | BlockStatement

  // v2 compat only
  // 仅用于v2兼容
  filters?: string[]
}

/**
 * Element节点
 * 面板元素节点|组件节点|插槽外节点|模板节点
 */
export type ElementNode =
  | PlainElementNode
  | ComponentNode
  | SlotOutletNode
  | TemplateNode

/**
 * 基本元素节点
 * type:Element
 * ns:命名空间
 * tag:标签
 * tagType:标签类型
 * isSelfClosing:是自我闭合标签
 * props:属性及自定义指令节点数组
 * children
 */
  export interface BaseElementNode extends Node {
  /**
   * 标签元素
   */
  type: NodeTypes.ELEMENT
  ns: Namespace
  /**
   * 标签名
   */
  tag: string
  /**
   * 表示标签类型
   */
  tagType: ElementTypes
  /**
   * 是否是自闭和标签
   */
  isSelfClosing: boolean
  props: Array<AttributeNode | DirectiveNode>
  /**
   * 标签的子节点数组
   */
  children: TemplateChildNode[]
}

/**
 * 面板元素节点继承自基本元素节点
 * tagType:标签类型
 * codegenNode:VNodeCall|简单表达式节点|缓存表达式节点|Memo|未定义
 * ssr代码生成的Node：字面模板
 */
export interface PlainElementNode extends BaseElementNode {
  tagType: ElementTypes.ELEMENT
  codegenNode:
    | VNodeCall
    | SimpleExpressionNode // when hoisted 当被挂起
    | CacheExpression // when cached by v-once 一次
    | MemoExpression // when cached by v-memo v-memo
    | undefined
  ssrCodegenNode?: TemplateLiteral
}

/**
 * 组件节点
 * tagType:组件
 * codegenNode:VNode函数|v-once|v-memo|未定义
 */
export interface ComponentNode extends BaseElementNode {
  tagType: ElementTypes.COMPONENT
  codegenNode:
    | VNodeCall
    | CacheExpression // when cached by v-once
    | MemoExpression // when cached by v-memo
    | undefined
  ssrCodegenNode?: CallExpression
}

/**
 * 插槽排除节点
 * 代码生成的Node
 * ssr代码生成的Node
 */
export interface SlotOutletNode extends BaseElementNode {
  tagType: ElementTypes.SLOT
  codegenNode:
    | RenderSlotCall
    | CacheExpression // when cached by v-once
    | undefined
  ssrCodegenNode?: CallExpression
}

/**
 * 模板Node
 */
export interface TemplateNode extends BaseElementNode {
  tagType: ElementTypes.TEMPLATE
  // TemplateNode is a container type that always gets compiled away
  // 模板Node是一个容器类型总是被编译掉
  codegenNode: undefined
}

/**
 * TextNode
 */
export interface TextNode extends Node {
  type: NodeTypes.TEXT
  content: string
}

/**
 * CommentNode
 */
export interface CommentNode extends Node {
  type: NodeTypes.COMMENT
  content: string
}

/**
 * attrNode  
 * type  
 * name 字符串  
 * value TextNode|undefined  
 */
export interface AttributeNode extends Node {
  type: NodeTypes.ATTRIBUTE
  name: string
  value: TextNode | undefined
}

/**
 * 指令Node
 * type  
 * name  
 * exp  
 * arg  
 * modifiers: 修饰器
 */
export interface DirectiveNode extends Node {
  type: NodeTypes.DIRECTIVE
  name: string
  exp: ExpressionNode | undefined
  arg: ExpressionNode | undefined
  modifiers: string[]
  /**
   * optional property to cache the expression parse result for v-for
   * 选项式属性用来缓存表达式用于解析v-for的结果
   */
  parseResult?: ForParseResult
}

/**
 * Static types have several levels.
 * Higher levels implies lower levels. e.g. a node that can be stringified
 * can always be hoisted and skipped for patch.
 * 静态类型有几个层级
 * 更高的层级包含着更低的层级 例如 一个node可能被字符串化
 * 可能总是被挂起并且跳过patch
 */
export const enum ConstantTypes {
  NOT_CONSTANT = 0,
  CAN_SKIP_PATCH,
  CAN_HOIST,
  CAN_STRINGIFY
}

/**
 * 简单表达式节点
 * type 
 * content 内容
 * isStatic 静态节点
 * constType 常量类型
 * hoisted:挂起
 * identifiers：标识符
 * isHandlerKey
 */
export interface SimpleExpressionNode extends Node {
  type: NodeTypes.SIMPLE_EXPRESSION
  /**
   * 插值内容
   */
  content: string
  isStatic: boolean
  constType: ConstantTypes
  /**
   * Indicates this is an identifier for a hoist vnode call and points to the
   * hoisted node.
   * 暗示这是一个标识符用于一个挂起的节点调用并且指向一个已经被挂起的节点
   */
  hoisted?: JSChildNode
  /**
   * an expression parsed as the params of a function will track
   * the identifiers declared inside the function body.
   * 一个表达式解析成一个带有参数的函数将跟踪这个被声明的标识符，在函数体内部
   */
  identifiers?: string[]
  // 是不是一个处理含数的key
  isHandlerKey?: boolean
}

/**
 * 插值节点
 */
export interface InterpolationNode extends Node {
  /**
   * 插值节点
   */
  type: NodeTypes.INTERPOLATION
  /**
   * 描述表达式节点的对象
   */
  content: ExpressionNode
}

/**
 * 复杂表达式节点
 * type: 类型
 * children：简单表达式节点|复杂表达式节点|内插节点|文本节点|字符串|symbol
 */
export interface CompoundExpressionNode extends Node {
  type: NodeTypes.COMPOUND_EXPRESSION
  children: (
    | SimpleExpressionNode
    | CompoundExpressionNode
    | InterpolationNode
    | TextNode
    | string
    | symbol
  )[]

  /**
   * an expression parsed as the params of a function will track
   * the identifiers declared inside the function body.
   * 一个表达式解析成一个带有参数的函数将跟踪被声明的标识符在函数体内部
   */
  identifiers?: string[]
  isHandlerKey?: boolean
}

/**
 * IfNode
 * type
 * branches 分支节点
 * codegenNode 条件分支表达式|v-once
 */
export interface IfNode extends Node {
  type: NodeTypes.IF
  branches: IfBranchNode[]
  codegenNode?: IfConditionalExpression | CacheExpression // <div v-if v-once>
}


/**
 * IfBranch
 * type
 * condition: 表达式节点|undefined
 * children: 模板子节点
 * userKey attrNode | 指令Node
 */
export interface IfBranchNode extends Node {
  type: NodeTypes.IF_BRANCH
  condition: ExpressionNode | undefined // else
  children: TemplateChildNode[]
  userKey?: AttributeNode | DirectiveNode
  isTemplateIf?: boolean
}


/**
 * v-for="(value, key, index) in source"
 * source 数据源 表达式节点
 * valueAlias value 表达式节点
 * keyAlias key 表达式节点
 * objectIndexAlias index 表达式节点
 * parseResult 解析结果
 * children
 * codegenNode
 */
export interface ForNode extends Node {
  type: NodeTypes.FOR
  source: ExpressionNode
  valueAlias: ExpressionNode | undefined
  keyAlias: ExpressionNode | undefined
  objectIndexAlias: ExpressionNode | undefined
  parseResult: ForParseResult
  children: TemplateChildNode[]
  codegenNode?: ForCodegenNode
}

/**
 * 文本调用节点
 * 内容： 文本节点|内插节点|复杂的表达式节点
 * 代码生成节点：调用表达式|简单表达式
 */
export interface TextCallNode extends Node {
  type: NodeTypes.TEXT_CALL
  content: TextNode | InterpolationNode | CompoundExpressionNode
  codegenNode: CallExpression | SimpleExpressionNode // when hoisted
}

/**
 * 模板文本子节点
 * 文本节点|内插节点|复杂表达式节点
 */
export type TemplateTextChildNode =
  | TextNode
  | InterpolationNode
  | CompoundExpressionNode

/**
 * VNode 调用基于Node类型
 * type 类型  
 * tag 标签
 * props：props表达式 或者undefined
 * children: 
 * patchFlag
 * dynamicProps
 * directives
 * isBlock
 * disableTracking：禁止跟踪
 * isComponent: 是组件
 */
export interface VNodeCall extends Node {
  type: NodeTypes.VNODE_CALL
  tag: string | symbol | CallExpression
  props: PropsExpression | undefined
  children:
    | TemplateChildNode[] // multiple children 多个子节点
    | TemplateTextChildNode // single text child 单个文本子节点
    | SlotsExpression // component slots 组件插槽
    | ForRenderListExpression // v-for fragment call v-for片段调用
    | SimpleExpressionNode // hoisted 被挂起
    | undefined
  patchFlag: string | undefined
  dynamicProps: string | SimpleExpressionNode | undefined
  directives: DirectiveArguments | undefined
  isBlock: boolean
  disableTracking: boolean
  isComponent: boolean
}

// JS Node Types ---------------------------------------------------------------

// We also include a number of JavaScript AST nodes for code generation.
// The AST is an intentionally minimal subset just to meet the exact needs of
// Vue render function generation.

/**
 * js node types
 * 
 * 我们也包括一系列的js ast 节点用于代码生成
 * ast是有意做了一个极小精简版仅仅适用于vue渲染器函数生成
 * VNode 调用
 * CallExpression
 */
export type JSChildNode =
  | VNodeCall
  | CallExpression
  | ObjectExpression
  | ArrayExpression
  | ExpressionNode
  | FunctionExpression
  | ConditionalExpression
  | CacheExpression
  | AssignmentExpression
  | SequenceExpression

/**
 * 调用表达式
 * type
 * callee 
 * arguments 参数 
 */
export interface CallExpression extends Node {
  type: NodeTypes.JS_CALL_EXPRESSION
  callee: string | symbol
  arguments: (
    | string
    | symbol
    | JSChildNode
    | SSRCodegenNode
    | TemplateChildNode
    | TemplateChildNode[]
  )[]
}

/**
 * 对象表达式
 */
export interface ObjectExpression extends Node {
  type: NodeTypes.JS_OBJECT_EXPRESSION
  properties: Array<Property>
}

/**
 * 属性
 */
export interface Property extends Node {
  type: NodeTypes.JS_PROPERTY
  key: ExpressionNode
  value: JSChildNode
}

/**
 * 数组表达式
 */
export interface ArrayExpression extends Node {
  type: NodeTypes.JS_ARRAY_EXPRESSION
  elements: Array<string | Node>
}

/**
 * 函数表达式
 * type
 * params 参数
 * returns 返回值
 * body 函数体
 * newline 
 */
export interface FunctionExpression extends Node {
  type: NodeTypes.JS_FUNCTION_EXPRESSION
  params: ExpressionNode | string | (ExpressionNode | string)[] | undefined
  returns?: TemplateChildNode | TemplateChildNode[] | JSChildNode
  body?: BlockStatement | IfStatement
  newline: boolean
  /**
   * This flag is for codegen to determine whether it needs to generate the
   * withScopeId() wrapper
   * 这个标记用于生成代码并决定它是否需要生成带有作用域id的包装器
   */
  isSlot: boolean
  /**
   * __COMPAT__ only, indicates a slot function that should be excluded from
   * the legacy $scopedSlots instance property.
   * 兼容性仅仅，暗示一个插槽函数应该从遗留的$scopedSlots实例属性排除
   */
  isNonScopedSlot?: boolean
}

/**
 * 条件表达式 v-if
 * test 判断条件
 * consequent 推断1 true
 * alternate 推断2 false
 * newline 新的行
 */
export interface ConditionalExpression extends Node {
  type: NodeTypes.JS_CONDITIONAL_EXPRESSION
  test: JSChildNode
  consequent: JSChildNode
  alternate: JSChildNode
  newline: boolean
}

/**
 * 缓存表达式 v-once
 * index 索引
 * value 值
 * isVnode
 */
export interface CacheExpression extends Node {
  type: NodeTypes.JS_CACHE_EXPRESSION
  index: number
  value: JSChildNode
  isVNode: boolean
}

/**
 * v-memo
 * callee
 * arguments
 */
export interface MemoExpression extends CallExpression {
  callee: typeof WITH_MEMO
  arguments: [ExpressionNode, MemoFactory, string, string]
}

/**
 * MemoFactory 
 * Memo函数返回值是一个节点代码块
 */
interface MemoFactory extends FunctionExpression {
  returns: BlockCodegenNode
}

// SSR-specific Node Types -----------------------------------------------------

/**
 * SSR专属节点类型
 * 
 */
export type SSRCodegenNode =
  | BlockStatement
  | TemplateLiteral
  | IfStatement
  | AssignmentExpression
  | ReturnStatement
  | SequenceExpression

/**
 * Block
 */
export interface BlockStatement extends Node {
  type: NodeTypes.JS_BLOCK_STATEMENT
  body: (JSChildNode | IfStatement)[]
}

/**
 * 字面量模板
 */
export interface TemplateLiteral extends Node {
  type: NodeTypes.JS_TEMPLATE_LITERAL
  elements: (string | JSChildNode)[]
}

/**
 * If 陈述
 */
export interface IfStatement extends Node {
  type: NodeTypes.JS_IF_STATEMENT
  test: ExpressionNode
  consequent: BlockStatement
  alternate: IfStatement | BlockStatement | ReturnStatement | undefined
}

/**
 * 赋值表达式
 */
export interface AssignmentExpression extends Node {
  type: NodeTypes.JS_ASSIGNMENT_EXPRESSION
  left: SimpleExpressionNode
  right: JSChildNode
}

/**
 * 序列表达式
 */
export interface SequenceExpression extends Node {
  type: NodeTypes.JS_SEQUENCE_EXPRESSION
  expressions: JSChildNode[]
}

/**
 * 返回声明
 */
export interface ReturnStatement extends Node {
  type: NodeTypes.JS_RETURN_STATEMENT
  returns: TemplateChildNode | TemplateChildNode[] | JSChildNode
}

// Codegen Node Types ----------------------------------------------------------

/**
 * 代码生成节点类型
 */

/**
 * 指令参数
 */
export interface DirectiveArguments extends ArrayExpression {
  elements: DirectiveArgumentNode[]
}

/**
 * 指令参数节点
 */
export interface DirectiveArgumentNode extends ArrayExpression {
  elements: // dir, exp, arg, modifiers 指令，表达式，参数，修饰器
  | [string]
    | [string, ExpressionNode]
    | [string, ExpressionNode, ExpressionNode]
    | [string, ExpressionNode, ExpressionNode, ObjectExpression]
}

// renderSlot(...)

/**
 * 渲染插槽调用
 */
export interface RenderSlotCall extends CallExpression {
  callee: typeof RENDER_SLOT
  arguments: // $slots, name, props, fallback
  | [string, string | ExpressionNode]
    | [string, string | ExpressionNode, PropsExpression]
    | [
        string,
        string | ExpressionNode,
        PropsExpression | '{}',
        TemplateChildNode[]
      ]
}

/**
 * 插槽表达式
 * 对象插槽表达式|动态插槽表达式
 */
export type SlotsExpression = SlotsObjectExpression | DynamicSlotsExpression

// { foo: () => [...] }
/**
 * { foo: () => [...] }
 */
export interface SlotsObjectExpression extends ObjectExpression {
  properties: SlotsObjectProperty[]
}

/**
 * 对象插槽表达式属性
 */
export interface SlotsObjectProperty extends Property {
  value: SlotFunctionExpression
}

export interface SlotFunctionExpression extends FunctionExpression {
  returns: TemplateChildNode[]
}

// createSlots({ ... }, [
//    foo ? () => [] : undefined,
//    renderList(list, i => () => [i])
// ])
/**
 * createSlots({...}, [
 *  foo ? () => [] : undefined
 *  renderList(list, i => () => [i])
 * ])
 * 动态插槽表达式
 */
export interface DynamicSlotsExpression extends CallExpression {
  callee: typeof CREATE_SLOTS
  arguments: [SlotsObjectExpression, DynamicSlotEntries]
}

/**
 * 动态插槽入口
 */
export interface DynamicSlotEntries extends ArrayExpression {
  elements: (ConditionalDynamicSlotNode | ListDynamicSlotNode)[]
}

/**
 * 条件表达式动态插槽节点
 */
export interface ConditionalDynamicSlotNode extends ConditionalExpression {
  consequent: DynamicSlotNode
  alternate: DynamicSlotNode | SimpleExpressionNode
}

/**
 * 动态插槽列表节点
 */
export interface ListDynamicSlotNode extends CallExpression {
  callee: typeof RENDER_LIST
  arguments: [ExpressionNode, ListDynamicSlotIterator]
}

/**
 * 动态插槽列表迭代器
 */
export interface ListDynamicSlotIterator extends FunctionExpression {
  returns: DynamicSlotNode
}

/**
 * 动态插槽节点
 */
export interface DynamicSlotNode extends ObjectExpression {
  properties: [Property, DynamicSlotFnProperty]
}

/**
 * 动态插槽函数属性
 */
export interface DynamicSlotFnProperty extends Property {
  value: SlotFunctionExpression
}

/**
 * 块代码生成Node
 */
export type BlockCodegenNode = VNodeCall | RenderSlotCall

/**
 * 条件表达式
 */
export interface IfConditionalExpression extends ConditionalExpression {
  consequent: BlockCodegenNode | MemoExpression
  alternate: BlockCodegenNode | IfConditionalExpression | MemoExpression
}

/**
 * For 代码生成节点
 */
export interface ForCodegenNode extends VNodeCall {
  isBlock: true
  tag: typeof FRAGMENT
  props: undefined
  children: ForRenderListExpression
  patchFlag: string
  disableTracking: boolean
}

/**
 * For渲染列表表达式
 */
export interface ForRenderListExpression extends CallExpression {
  callee: typeof RENDER_LIST
  arguments: [ExpressionNode, ForIteratorExpression]
}

/**
 * For迭代器表达式
 */
export interface ForIteratorExpression extends FunctionExpression {
  returns: BlockCodegenNode
}

// AST Utilities ---------------------------------------------------------------

// Some expressions, e.g. sequence and conditional expressions, are never
// associated with template nodes, so their source locations are just a stub.
// Container types like CompoundExpression also don't need a real location.

/**
 * AST 工具
 * ——————————————
 * 一些表达式   例如： 序列和条件表达式和template的节点是从不关联的
 * 所以他们的来源位置仅仅是一个存根
 * 容器类型像复杂表达式也不需要一个真实的位置
 */
export const locStub: SourceLocation = {
  source: '',
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 }
}

/**
 * 创建根节点
 * 先建一个初始化的
 * @param children 子节点
 * @param loc 代码行
 * @returns 
 */
export function createRoot(
  children: TemplateChildNode[],
  loc = locStub
): RootNode {
  return {
    type: NodeTypes.ROOT,
    children,
    helpers: [],
    components: [],
    directives: [],
    hoists: [],
    imports: [],
    cached: 0,
    temps: 0,
    codegenNode: undefined,
    loc
  }
}

/**
 * 创建vnode call
 * @param context 上下文
 * @param tag 标记
 * @param props 属性
 * @param children 子节点
 * @param patchFlag 更新标记
 * @param dynamicProps 动态props
 * @param directives 指令
 * @param isBlock 是否是代码块
 * @param disableTracking 禁止跟踪
 * @param isComponent 是否是组件
 * @param loc 行数
 * @returns 
 */
export function createVNodeCall(
  context: TransformContext | null,
  tag: VNodeCall['tag'],
  props?: VNodeCall['props'],
  children?: VNodeCall['children'],
  patchFlag?: VNodeCall['patchFlag'],
  dynamicProps?: VNodeCall['dynamicProps'],
  directives?: VNodeCall['directives'],
  isBlock: VNodeCall['isBlock'] = false,
  disableTracking: VNodeCall['disableTracking'] = false,
  isComponent: VNodeCall['isComponent'] = false,
  loc = locStub
): VNodeCall {
  // 上下文
  if (context) {
    // 是不是块
    if (isBlock) {
      // 上下文帮助函数 openBlock
      context.helper(OPEN_BLOCK)
      // 获取vnodeblock帮助函数
      context.helper(getVNodeBlockHelper(context.inSSR, isComponent))
    } else {
      context.helper(getVNodeHelper(context.inSSR, isComponent))
    }
    if (directives) {
      // 用指令
      context.helper(WITH_DIRECTIVES)
    }
  }

  return {
    type: NodeTypes.VNODE_CALL,
    tag,
    props,
    children,
    patchFlag,
    dynamicProps,
    directives,
    isBlock,
    disableTracking,
    isComponent,
    loc
  }
}

/**
 * 创建数组表达式
 * elements 数组元素
 * loc 行数
 * @param elements 
 * @param loc 
 * @returns 
 */
export function createArrayExpression(
  elements: ArrayExpression['elements'],
  loc: SourceLocation = locStub
): ArrayExpression {
  return {
    type: NodeTypes.JS_ARRAY_EXPRESSION,
    loc,
    elements
  }
}

/**
 * 创建对象表达式
 * properties 属性
 * loc 行数
 * @param properties 
 * @param loc 
 * @returns 
 */
export function createObjectExpression(
  properties: ObjectExpression['properties'],
  loc: SourceLocation = locStub
): ObjectExpression {
  return {
    type: NodeTypes.JS_OBJECT_EXPRESSION,
    loc,
    properties
  }
}

/**
 * 创建Object属性
 * key
 * value
 * @param key 
 * @param value 
 * @returns 
 */
export function createObjectProperty(
  key: Property['key'] | string,
  value: Property['value']
): Property {
  return {
    type: NodeTypes.JS_PROPERTY,
    loc: locStub,
    key: isString(key) ? createSimpleExpression(key, true) : key,
    value
  }
}

/**
 * 创建简单的表达式
 * content 内容
 * isStatic 是静态节点
 * loc 行数
 * constType 常量类型
 * @param content 
 * @param isStatic 
 * @param loc 
 * @param constType 
 * @returns 
 */
export function createSimpleExpression(
  content: SimpleExpressionNode['content'],
  isStatic: SimpleExpressionNode['isStatic'] = false,
  loc: SourceLocation = locStub,
  constType: ConstantTypes = ConstantTypes.NOT_CONSTANT
): SimpleExpressionNode {
  return {
    type: NodeTypes.SIMPLE_EXPRESSION,
    loc,
    content,
    isStatic,
    constType: isStatic ? ConstantTypes.CAN_STRINGIFY : constType
  }
}

/**
 * 创建内插节点
 * content 内容
 * loc 行数
 * @param content 
 * @param loc 
 * @returns 
 */
export function createInterpolation(
  content: InterpolationNode['content'] | string,
  loc: SourceLocation
): InterpolationNode {
  return {
    type: NodeTypes.INTERPOLATION,
    loc,
    content: isString(content)
      ? createSimpleExpression(content, false, loc)
      : content
  }
}

/**
 * 创建复杂的表达式
 * loc 行数
 * children 行数
 * @param children 
 * @param loc 
 * @returns 
 */
export function createCompoundExpression(
  children: CompoundExpressionNode['children'],
  loc: SourceLocation = locStub
): CompoundExpressionNode {
  return {
    type: NodeTypes.COMPOUND_EXPRESSION,
    loc,
    children
  }
}

/**
 * 推断代码生成的节点类型
 */
type InferCodegenNodeType<T> = T extends typeof RENDER_SLOT
  ? RenderSlotCall
  : CallExpression

/**
 * 创建调用函数表达式
 * 创建的函数表达式所生成的节点，对应的函数名是createTextVNode
 * 参数args是子节点本身的child
 * 如果是动态插值节点，那么参数还会多一个TEXT的patchFlag
 * loc 行数
 * callee 被调用的函数
 * arguments 参数
 * @param callee 
 * @param args 
 * @param loc 
 * @returns 
 */ 
export function createCallExpression<T extends CallExpression['callee']>(
  callee: T,
  args: CallExpression['arguments'] = [],
  loc: SourceLocation = locStub
): InferCodegenNodeType<T> {
  return {
    type: NodeTypes.JS_CALL_EXPRESSION,
    loc,
    callee,
    arguments: args
  } as InferCodegenNodeType<T>
}

/**
 * 创建函数表达式
 * params 参数
 * returns 返回值
 * newline 是否新起一行
 * isSlot 是插槽
 * loc 行数
 * @param params 
 * @param returns 
 * @param newline 
 * @param isSlot 
 * @param loc 
 * @returns 
 */
export function createFunctionExpression(
  params: FunctionExpression['params'],
  returns: FunctionExpression['returns'] = undefined,
  newline: boolean = false,
  isSlot: boolean = false,
  loc: SourceLocation = locStub
): FunctionExpression {
  return {
    type: NodeTypes.JS_FUNCTION_EXPRESSION,
    params,
    returns,
    newline,
    isSlot,
    loc
  }
}

/**
 * 创建条件表达式
 * @param test 
 * @param consequent 
 * @param alternate 
 * @param newline 
 * @returns 
 */
export function createConditionalExpression(
  test: ConditionalExpression['test'],
  consequent: ConditionalExpression['consequent'],
  alternate: ConditionalExpression['alternate'],
  newline = true
): ConditionalExpression {
  return {
    type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
    test,
    consequent,
    alternate,
    newline,
    loc: locStub
  }
}

/**
 * 创建缓存表达式v-once
 * @param index 
 * @param value 
 * @param isVNode 
 * @returns 
 */
export function createCacheExpression(
  index: number,
  value: JSChildNode,
  isVNode: boolean = false
): CacheExpression {
  return {
    type: NodeTypes.JS_CACHE_EXPRESSION,
    index,
    value,
    isVNode,
    loc: locStub
  }
}

/**
 * 创建声明体
 * @param body 
 * @returns 
 */
export function createBlockStatement(
  body: BlockStatement['body']
): BlockStatement {
  return {
    type: NodeTypes.JS_BLOCK_STATEMENT,
    body,
    loc: locStub
  }
}

/**
 * 创建字面量模板
 * @param elements 
 * @returns 
 */
export function createTemplateLiteral(
  elements: TemplateLiteral['elements']
): TemplateLiteral {
  return {
    type: NodeTypes.JS_TEMPLATE_LITERAL,
    elements,
    loc: locStub
  }
}

/**
 * 创建条件声明
 * test
 * consequent
 * alternate
 * loc 行数
 * @param test 判断
 * @param consequent true 
 * @param alternate false
 * @returns 
 */
export function createIfStatement(
  test: IfStatement['test'],
  consequent: IfStatement['consequent'],
  alternate?: IfStatement['alternate']
): IfStatement {
  return {
    type: NodeTypes.JS_IF_STATEMENT,
    test,
    consequent,
    alternate,
    loc: locStub
  }
}

/**
 * 创建赋值表达式
 * loc 行数
 * @param left 赋值表达式左
 * @param right 赋值表达式右
 * @returns 
 */
export function createAssignmentExpression(
  left: AssignmentExpression['left'],
  right: AssignmentExpression['right']
): AssignmentExpression {
  return {
    type: NodeTypes.JS_ASSIGNMENT_EXPRESSION,
    left,
    right,
    loc: locStub
  }
}

/**
 * 创建序列化声明
 * @param expressions 
 * @returns 
 */
export function createSequenceExpression(
  expressions: SequenceExpression['expressions']
): SequenceExpression {
  return {
    type: NodeTypes.JS_SEQUENCE_EXPRESSION,
    expressions,
    loc: locStub
  }
}

/**
 * 创建返回的声明
 * type 返回的陈述
 * returns 返回值
 * loc 行数
 * @param returns 
 * @returns 
 */
export function createReturnStatement(
  returns: ReturnStatement['returns']
): ReturnStatement {
  return {
    type: NodeTypes.JS_RETURN_STATEMENT,
    returns,
    loc: locStub
  }
}
