import { ErrorHandlingOptions, ParserOptions } from './options'
import { NO, isArray, makeMap, extend } from '@vue/shared'
import {
  ErrorCodes,
  createCompilerError,
  defaultOnError,
  defaultOnWarn
} from './errors'
import {
  assert,
  advancePositionWithMutation,
  advancePositionWithClone,
  isCoreComponent,
  isStaticArgOf
} from './utils'
import {
  Namespaces,
  AttributeNode,
  CommentNode,
  DirectiveNode,
  ElementNode,
  ElementTypes,
  ExpressionNode,
  NodeTypes,
  Position,
  RootNode,
  SourceLocation,
  TextNode,
  TemplateChildNode,
  InterpolationNode,
  createRoot,
  ConstantTypes
} from './ast'
import {
  checkCompatEnabled,
  CompilerCompatOptions,
  CompilerDeprecationTypes,
  isCompatEnabled,
  warnDeprecation
} from './compat/compatConfig'

// Parse的过程就是HTML嵌套结构的解析过程，就是一个递归解析元素节点的过程
// 为了维护父子关系，当需要解析子节点时
// 我们把当前节点入栈
// 子节点解析完毕后，把当前子节点出栈
// 因此ancestors的设计就是一个栈的数据结构
// 整个过程是一个不断入栈和出栈的过程
// 通过不断地递归解析，我们就可以完整的解析整个模板
// 并且标签类型的AST节点会保持对子节点数组的引用
// 这就形成了一个树形的数据结构
// 所以整个解析过程构造出AST节点数组就能很好的映射整个模板的DOM结构

/**
 * 可选选项
 * whitespace 空格
 * isNativeTag 是否是原生标签
 * isBuiltInComponent 是否是内置组件
 */
type OptionalOptions =
  | 'whitespace'
  | 'isNativeTag'
  | 'isBuiltInComponent'
  | keyof CompilerCompatOptions

/**
 * 被合并的解析器选项
 * 从解析选项中排除可选选项并将所有选项设置为必传值，然后再将可选选项放入
 */
type MergedParserOptions = Omit<Required<ParserOptions>, OptionalOptions> &
  Pick<ParserOptions, OptionalOptions>

/**
 * 属性值
 * content 内容  
 * isQuoted 是否有引号  
 * loc 位置  
 */
type AttributeValue =
  | {
      content: string
      isQuoted: boolean
      loc: SourceLocation
    }
  | undefined

// The default decoder only provides escapes for characters reserved as part of
// the template syntax, and is only used if the custom renderer did not provide
// a platform-specific decoder.
/**
 * 默认的解码仅仅提供字符串解码编译被保留作为模板语法的一部分
 * 并且仅仅被使用当自定义渲染器没有提供一个平台专有的解码器时
 */
const decodeRE = /&(gt|lt|amp|apos|quot);/g
/**
 * 解码对应字符
 */
const decodeMap: Record<string, string> = {
  gt: '>',
  lt: '<',
  amp: '&',
  apos: "'",
  quot: '"'
}

/**
 * 默认解析选项
 * delimiters {{}}  
 * getNamespace 命名空间  
 * getTextMode 获取文本模式数据  
 * isVoidTag 是否是自闭和标签  
 * isPreTag 是否是 <pre> 里面是要保留空格的  
 * isCustomElement 是否自定义元素  
 * deocdeEntities 对特殊字符实体解码  
 * onError 错误处理函数  
 * onWarn 警告处理函数  
 * comment 是否开启注释  
 */
export const defaultParserOptions: MergedParserOptions = {
  delimiters: [`{{`, `}}`],
  getNamespace: () => Namespaces.HTML,
  getTextMode: () => TextModes.DATA,
  isVoidTag: NO,
  isPreTag: NO,
  isCustomElement: NO,
  decodeEntities: (rawText: string): string =>
    rawText.replace(decodeRE, (_, p1) => decodeMap[p1]),
  onError: defaultOnError,
  onWarn: defaultOnWarn,
  comments: __DEV__
}

/**
 * 文本模式
 * DATA 允许有元素、允许有特殊字符，结束标签是祖先的标签
 * RCDATA 允许有文本，不允许有特殊元素，结束标签是父节点标签，textarea
 * RAWTEXT 不允许有文本，也不允许有特殊字符，结束标签是父节点标签，style、script
 */
export const enum TextModes {
  //          | Elements | Entities | End sign              | Inside of
  DATA, //    | ✔        | ✔        | End tags of ancestors |
  RCDATA, //  | ✘        | ✔        | End tag of the parent | <textarea>
  RAWTEXT, // | ✘        | ✘        | End tag of the parent | <style>,<script>
  CDATA,
  ATTRIBUTE_VALUE
}


/**
 * 解析文本
 * 
 * options 解析相关配置  
 * originalSource 表示最初原始代码  
 * source 表示当前代码  
 * offset 表示当前代码相对于原始代码的偏移量  
 * line 行号  
 * column 列号  
 * inPre 表示当前代码是否在pre标签内，<pre> 标签，保留空格符。  
 * inVPre 表示当前代码是否在v-pre指令的环境下，<tag v-pre> v-pre指令 不处理指令和内插值  
 * onWarn 警告函数  
 */
export interface ParserContext {
  options: MergedParserOptions
  readonly originalSource: string
  source: string
  offset: number
  line: number
  column: number
  inPre: boolean // HTML <pre> tag, preserve whitespaces
  inVPre: boolean // v-pre, do not process directives and interpolations
  onWarn: NonNullable<ErrorHandlingOptions['onWarn']>
}

/**
 * 基本解析
 * @param content 
 * @param options 
 * @returns 
 */
export function baseParse(
  content: string,
  options: ParserOptions = {}
): RootNode {
  // 创建基本解析上下文
  const context = createParserContext(content, options)
  // 获取上下文指针
  const start = getCursor(context)
  // 解析子节点，并创建AST
  return createRoot(
    parseChildren(context, TextModes.DATA, []),
    getSelection(context, start)
  )
}

/**
 * 创建解析上下文
 * @param content 
 * @param rawOptions 解析相关配置
 * @returns 
 */
function createParserContext(
  content: string,
  rawOptions: ParserOptions
): ParserContext {
  // 解析选项
  const options = extend({}, defaultParserOptions)

  // key
  let key: keyof ParserOptions
  // 遍历原始选项的key，rawOptions里没有配置的使用默认的
  for (key in rawOptions) {
    // @ts-ignore
    options[key] =
      rawOptions[key] === undefined
        ? defaultParserOptions[key]
        : rawOptions[key]
  }
  // 返回上下文对象
  return {
    options,
    column: 1,
    line: 1,
    offset: 0,
    originalSource: content,
    source: content,
    inPre: false,
    inVPre: false,
    onWarn: options.onWarn
  }
}

/**
 * 解析并创建AST节点数组。
 * 两个主要流程：
 * 1. 自顶向下分析代码生成AST节点数组nodes
 * 2. 空白字符管理，用于提高编译的效率
 *    主要就是遍历 nodes，拿到每一个 AST 节点，判断是否为一个文本节点，如果是则判断它是不是空白字符；如果是则进一步判断空白字符是开头或还是结尾节点，或者空白字符与注释节点相连，或者空白字符在两个元素之间并包含换行符，如果满足上述这些情况，这些空白字符节点都应该被移除。此外，不满足这三种情况的空白字符都会被压缩成一个空格，非空文本中间的空白字符也会被压缩成一个空格，在生产环境下注释节点也会被移除。在 parseChildren 函数的最后，会过滤掉这些被标记清除的节点并返回过滤后的 AST 节点数组。

 * @param context 
 * @param mode 
 * @param ancestors 
 * @returns 
 */
function parseChildren(
  context: ParserContext,
  mode: TextModes,
  ancestors: ElementNode[]
): TemplateChildNode[] {
  // 父节点
  const parent = last(ancestors)
  // HTML命名空间
  const ns = parent ? parent.ns : Namespaces.HTML
  const nodes: TemplateChildNode[] = []

  // 判断是否遍历结束
  while (!isEnd(context, mode, ancestors)) {
    __TEST__ && assert(context.source.length > 0)
    const s = context.source
    let node: TemplateChildNode | TemplateChildNode[] | undefined = undefined

    if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
      // 模式是 DATA或者RCDATA
      // 处理内插值
      if (!context.inVPre && startsWith(s, context.options.delimiters[0])) {
        // '{{'
        node = parseInterpolation(context, mode)
      } else if (mode === TextModes.DATA && s[0] === '<') {
        // 模式是DATA且以<开头
        // 处理 < 开头的代码
        // https://html.spec.whatwg.org/multipage/parsing.html#tag-open-state
        if (s.length === 1) {
          // s 长度为1，说明代码结尾是<,代码只有一个<,报错
          emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 1)
        } else if (s[1] === '!') {
          // 处理 <! 开头的代码
          // 注释
          // https://html.spec.whatwg.org/multipage/parsing.html#markup-declaration-open-state
          if (startsWith(s, '<!--')) {
            // 处理注释节点
            node = parseComment(context)
          } else if (startsWith(s, '<!DOCTYPE')) {
            // 处理 <!DOCTYPE 节点>
            // Ignore DOCTYPE by a limitation.
            // 通过一个限制忽略DOCTYPE
            node = parseBogusComment(context)
          } else if (startsWith(s, '<![CDATA[')) {
            // 处理 <![CDATA[ 节点
            // CDATA， 这个是XML里的
            if (ns !== Namespaces.HTML) {
              node = parseCDATA(context, ancestors)
            } else {
              // 在HTML中要抛错
              emitError(context, ErrorCodes.CDATA_IN_HTML_CONTENT)
              node = parseBogusComment(context)
            }
          } else {
            // 其他的都不对了抛错
            emitError(context, ErrorCodes.INCORRECTLY_OPENED_COMMENT)
            node = parseBogusComment(context)
          }
        } else if (s[1] === '/') {
          // 处理 </ 结束标签
          // https://html.spec.whatwg.org/multipage/parsing.html#end-tag-open-state
          if (s.length === 2) {
            // </ s 长度为2， 说明代码结尾为 </ ，报错
            emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 2)
          } else if (s[2] === '>') {
            // </> 缺少结束标签，报错
            emitError(context, ErrorCodes.MISSING_END_TAG_NAME, 2)
            advanceBy(context, 3)
            continue
          } else if (/[a-z]/i.test(s[2])) {
            // </x 多余的结束标签
            emitError(context, ErrorCodes.X_INVALID_END_TAG)
            parseTag(context, TagType.End, parent)
            continue
          } else {
            // 失效的首字母
            emitError(
              context,
              ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME,
              2
            )
            node = parseBogusComment(context)
          }
        } else if (/[a-z]/i.test(s[1])) {
          // <x 解析标签元素节点
          node = parseElement(context, ancestors)

          // 2.x <template> with no directive compat
          // 2.x的<tempalte>是没有指令的
          if (
            __COMPAT__ &&
            isCompatEnabled(
              CompilerDeprecationTypes.COMPILER_NATIVE_TEMPLATE,
              context
            ) &&
            node &&
            node.tag === 'template' &&
            !node.props.some(
              p =>
                p.type === NodeTypes.DIRECTIVE &&
                isSpecialTemplateDirective(p.name)
            )
          ) {
            __DEV__ &&
              warnDeprecation(
                CompilerDeprecationTypes.COMPILER_NATIVE_TEMPLATE,
                context,
                node.loc
              )
            node = node.children
          }
        } else if (s[1] === '?') {
          // <?
          emitError(
            context,
            ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME,
            1
          )
          node = parseBogusComment(context)
        } else {
          emitError(context, ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME, 1)
        }
      }
    }
    // 没有node节点的话，生成一个node节点
    if (!node) {
      // 解析普通文本节点
      node = parseText(context, mode)
    }

    // node是数组，遍历该数组，将该数组中的节点依次加入，对文本节点能够合并的
    // 进行合并
    if (isArray(node)) {
      // 如果 node 是数组，则遍历添加
      for (let i = 0; i < node.length; i++) {
        pushNode(nodes, node[i])
      }
    } else {
      // 添加单个node
      pushNode(nodes, node)
    }
  }

  // Whitespace handling strategy like v2
  // 空格处理策略像v2版本
  let removedWhitespace = false
  // 如果模式不是script、style内且不是RCDATA
  if (mode !== TextModes.RAWTEXT && mode !== TextModes.RCDATA) {
    // 应该去掉，只要whitespace不是保留
    const shouldCondense = context.options.whitespace !== 'preserve'
    for (let i = 0; i < nodes.length; i++) {
      // 遍历节点
      const node = nodes[i]
      // 不是pre, <pre>中的内容需要原封不动保留
      // 节点为文本
      if (!context.inPre && node.type === NodeTypes.TEXT) {
        // 文本内容中不包含除换行制表空格之外的字符
        if (!/[^\t\r\n\f ]/.test(node.content)) {
          // 匹配空白字符
          const prev = nodes[i - 1]
          const next = nodes[i + 1]
          // Remove if:
          // - the whitespace is the first or last node, or:
          // - (condense mode) the whitespace is adjacent to a comment, or:
          // - (condense mode) the whitespace is between two elements AND contains newline
          // 如果符合以下条件
          // 1. 如果空白字符是开头或者结尾节点
          // 2. 或者空白字符与注释节点相连
          // 3. 或者空白字符在两个元素之间并包含换行符
          // 那么这些空白字符节点都应该被移除
          if (
            !prev ||
            !next ||
            (shouldCondense &&
              (prev.type === NodeTypes.COMMENT ||
                next.type === NodeTypes.COMMENT ||
                (prev.type === NodeTypes.ELEMENT &&
                  next.type === NodeTypes.ELEMENT &&
                  /[\r\n]/.test(node.content))))
          ) {
            // 节点置为空，最后删除
            removedWhitespace = true
            nodes[i] = null as any
          } else {
            // Otherwise, the whitespace is condensed into a single space
            // 否则，空格被压缩成一个单独的空格
            node.content = ' '
          }
        } else if (shouldCondense) {
          // in condense mode, consecutive whitespaces in text are condensed
          // down to a single space.
          // 在压缩模式，连续的空格在文本被压缩成一个单独的空格
          node.content = node.content.replace(/[\t\r\n\f ]+/g, ' ')
        }
      }
      // Remove comment nodes if desired by configuration.
      // 生产环境中移除注释节点如果配置移除
      else if (node.type === NodeTypes.COMMENT && !context.options.comments) {
        removedWhitespace = true
        nodes[i] = null as any
      }
    }
    if (context.inPre && parent && context.options.isPreTag(parent.tag)) {
      // remove leading newline per html spec
      // 根据HTML规范删除前导换行符
      // https://html.spec.whatwg.org/multipage/grouping-content.html#the-pre-element
      const first = nodes[0]
      if (first && first.type === NodeTypes.TEXT) {
        first.content = first.content.replace(/^\r?\n/, '')
      }
    }
  }

  // 过滤空白字符节点
  return removedWhitespace ? nodes.filter(Boolean) : nodes
}

/**
 * 放入节点
 * @param nodes 
 * @param node 
 * @returns 
 */
function pushNode(nodes: TemplateChildNode[], node: TemplateChildNode): void {
  if (node.type === NodeTypes.TEXT) {
    // 上一个节点
    const prev = last(nodes)
    // Merge if both this and the previous node are text and those are
    // consecutive. This happens for cases like "a < b".
    // 如果这个和上一个节点都是文本且他们之间没有冲突，合并。
    // 这有点像 a < b这种情况
    if (
      prev &&
      prev.type === NodeTypes.TEXT &&
      prev.loc.end.offset === node.loc.start.offset
    ) {
      prev.content += node.content
      prev.loc.end = node.loc.end
      prev.loc.source += node.loc.source
      return
    }
  }

  // 否则放入新节点
  nodes.push(node)
}

/**
 * 解析CDATA
 * @param context 
 * @param ancestors 
 * @returns 
 */
function parseCDATA(
  context: ParserContext,
  ancestors: ElementNode[]
): TemplateChildNode[] {
  __TEST__ &&
    assert(last(ancestors) == null || last(ancestors)!.ns !== Namespaces.HTML)
  __TEST__ && assert(startsWith(context.source, '<![CDATA['))

  // 删除 <![CDATA[
  advanceBy(context, 9)
  // 解析CDATA中存在的子节点
  const nodes = parseChildren(context, TextModes.CDATA, ancestors)
  // 删去末尾的]]>
  if (context.source.length === 0) {
    emitError(context, ErrorCodes.EOF_IN_CDATA)
  } else {
    __TEST__ && assert(startsWith(context.source, ']]>'))
    advanceBy(context, 3)
  }

  // 返回这些节点
  return nodes
}

/**
 * 解析注释
 * @param context 
 * @returns 
 */
function parseComment(context: ParserContext): CommentNode {
  __TEST__ && assert(startsWith(context.source, '<!--'))

  const start = getCursor(context)
  let content: string

  // Regular comment.
  // 正则匹配注释的末尾
  // 常规注释的结束符
  const match = /--(\!)?>/.exec(context.source)
  if (!match) { 
    // 没有找到一路推到末尾并报错
    // 没有匹配的注释结束符
    content = context.source.slice(4)
    advanceBy(context, context.source.length)
    emitError(context, ErrorCodes.EOF_IN_COMMENT)
  } else {
    // 如果匹配到了且这个注释的字符数小于等于3  
    // 那肯定说明缺少注释文本，这种该情况就是空注释，报错
    if (match.index <= 3) {
      // 非法注释符号
      emitError(context, ErrorCodes.ABRUPT_CLOSING_OF_EMPTY_COMMENT)
    }
    // 末尾匹配到!说明不正确的闭合注释
    if (match[1]) {
      // 注释结束符不正确
      emitError(context, ErrorCodes.INCORRECTLY_CLOSED_COMMENT)
    }
    // 获取注释内容
    content = context.source.slice(4, match.index)

    // Advancing with reporting nested comments.
    // 提前报告嵌套的注释 <!--我是注释
    // 截取到注释结尾之间的代码，用于后续判断嵌套注释
    const s = context.source.slice(0, match.index)
    // 上一个索引和嵌套的索引
    let prevIndex = 1,
      nestedIndex = 0
    // 将嵌套的注释全部去掉
    // 判断嵌套注释符的情况，存在即报错
    while ((nestedIndex = s.indexOf('<!--', prevIndex)) !== -1) {
      advanceBy(context, nestedIndex - prevIndex + 1)
      if (nestedIndex + 4 < s.length) {
        // 报错嵌套的注释
        emitError(context, ErrorCodes.NESTED_COMMENT)
      }
      prevIndex = nestedIndex + 1
    }
    // 删除这些注释
    // 前进代码到结束注释符后
    advanceBy(context, match.index + match[0].length - prevIndex + 1)
  }

  return {
    type: NodeTypes.COMMENT,
    content,
    loc: getSelection(context, start)
  }
}

/**
 * 解析假的注释
 * @param context 
 * @returns 
 */
function parseBogusComment(context: ParserContext): CommentNode | undefined {
  __TEST__ && assert(/^<(?:[\!\?]|\/[^a-z>])/i.test(context.source))

  const start = getCursor(context)
  const contentStart = context.source[1] === '?' ? 1 : 2
  let content: string

  const closeIndex = context.source.indexOf('>')
  if (closeIndex === -1) {
    content = context.source.slice(contentStart)
    advanceBy(context, context.source.length)
  } else {
    content = context.source.slice(contentStart, closeIndex)
    advanceBy(context, closeIndex + 1)
  }

  return {
    type: NodeTypes.COMMENT,
    content,
    loc: getSelection(context, start)
  }
}

/**
 * 解析元素
 * 
 * 当前代码以 < 开头，后面跟随字幕，说明是一个标签开头，走到元素节点的解析处理逻辑
 * 
 * 解析开始标签，解析子节点，解析闭合标签
 * @param context 
 * @param ancestors 
 * @returns 
 */
function parseElement(
  context: ParserContext,
  ancestors: ElementNode[]
): ElementNode | undefined {
  __TEST__ && assert(/^<[a-z]/i.test(context.source))

  // Start tag.
  // 开始标签
  // 是否在 pre 标签内
  const wasInPre = context.inPre
  // 是否在 v-pre 指令内
  const wasInVPre = context.inVPre
  // 获取当前元素的父标签节点
  const parent = last(ancestors)
  // 解析开始标签，生成一个标签节点，并前进代码到开始标签后
  const element = parseTag(context, TagType.Start, parent)
  // 是否在 pre 标签的边界
  const isPreBoundary = context.inPre && !wasInPre
  // 是否在 v-pre 指令的边界
  const isVPreBoundary = context.inVPre && !wasInVPre

  // 元素是自闭和标签
  if (element.isSelfClosing || context.options.isVoidTag(element.tag)) {
    // #4030 self-closing <pre> tag
    // 自闭和<pre>标签
    // 是pre临界点的话，inpre设置为false
    if (isPreBoundary) {
      context.inPre = false
    }
    // 是v-pre临界点的话，inPre设置为false
    if (isVPreBoundary) {
      context.inVPre = false
    }
    // 返回元素本身
    return element
  }

  // Children.
  // 下面是处理子节点的逻辑
  // 先把标签节点添加到 ancestors， 入栈
  ancestors.push(element)
  // 获取当前文本的模式
  const mode = context.options.getTextMode(element, parent)
  // 递归解析子节点 传入 ancestors
  const children = parseChildren(context, mode, ancestors)
  // ancestors 出栈
  ancestors.pop()

  // 2.x inline-template compat
  // 2.x 兼容内联模板
  if (__COMPAT__) {
    // 内联模板属性
    const inlineTemplateProp = element.props.find(
      p => p.type === NodeTypes.ATTRIBUTE && p.name === 'inline-template'
    ) as AttributeNode
    if (
      inlineTemplateProp &&
      checkCompatEnabled(
        CompilerDeprecationTypes.COMPILER_INLINE_TEMPLATE,
        context,
        inlineTemplateProp.loc
      )
    ) {
      const loc = getSelection(context, element.loc.end)
      inlineTemplateProp.value = {
        type: NodeTypes.TEXT,
        content: loc.source,
        loc
      }
    }
  }

  // 添加到 children 属性中
  element.children = children

  // End tag.
  // 结束标签
  if (startsWithEndTagOpen(context.source, element.tag)) {
    // 解析结束标签，并前进代码到结束标签后
    parseTag(context, TagType.End, parent)
  } else {
    // 抛出错误
    emitError(context, ErrorCodes.X_MISSING_END_TAG, 0, element.loc.start)
    if (context.source.length === 0 && element.tag.toLowerCase() === 'script') {
      // 如果元素标签是script
      const first = children[0]
      // script中第一个节点是<!-- 报错 script中出现HTML注释
      if (first && startsWith(first.loc.source, '<!--')) {
        emitError(context, ErrorCodes.EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT)
      }
    }
  }

  // 更新标签节点的代码位置，结束位置到结束标签后
  element.loc = getSelection(context, element.loc.start)

  // pre临界点
  if (isPreBoundary) {
    context.inPre = false
  }
  // v-pre临界点
  if (isVPreBoundary) {
    context.inVPre = false
  }
  return element
}

/**
 * 标签类型
 */
const enum TagType {
  Start,
  End
}

/**
 * 特殊模板指令
 */
const isSpecialTemplateDirective = /*#__PURE__*/ makeMap(
  `if,else,else-if,for,slot`
)

/**
 * Parse a tag (E.g. `<div id=a>`) with that type (start tag or end tag).
 * 解析一个tag 使用开标签和闭标签
 * 
 * parseTag 首先匹配标签文本结束的位置，
 * 并前进代码到标签文本后面的空白字符
 * 解析标签属性 如:class、style、指令等
 * 检查是什么标签，如果是pre，则设置 context.inPre = true
 * 检查属性中是否存在v-pre指令，有 context.vPre = true
 * 如果有v-pre重置上下文并重新解析属性
 * 接下来判断是不是一个自闭和标签，并前进代码到闭合标签后
 * 最后判断标签类型是组件、插槽还是模板
 */
function parseTag(
  context: ParserContext,
  type: TagType.Start,
  parent: ElementNode | undefined
): ElementNode
function parseTag(
  context: ParserContext,
  type: TagType.End,
  parent: ElementNode | undefined
): void
function parseTag(
  context: ParserContext,
  type: TagType,
  parent: ElementNode | undefined
): ElementNode | undefined {
  __TEST__ && assert(/^<\/?[a-z]/i.test(context.source))
  __TEST__ &&
    assert(
      type === (startsWith(context.source, '</') ? TagType.End : TagType.Start)
    )

  // Tag open.
  // 标签打开
  // 获取开始指针
  const start = getCursor(context)
  // 匹配标签文本结束的位置
  const match = /^<\/?([a-z][^\t\r\n\f />]*)/i.exec(context.source)!
  // 标签
  const tag = match[1]
  // 命名空间
  const ns = context.options.getNamespace(tag, parent)

  // 前进代码到标签文本结束位置
  advanceBy(context, match[0].length)
  // 前进代码到标签文本后面的空白字符后
  advanceSpaces(context)

  // save current state in case we need to re-parse attributes with v-pre
  // 保存当前状态以防我们需要用 v-pre 重新解析属性
  const cursor = getCursor(context)
  // 当前的source
  const currentSource = context.source

  // check <pre> tag
  // 检查是不是一个 pre 标签
  if (context.options.isPreTag(tag)) {
    context.inPre = true
  }

  // Attributes.
  // 解析标签中的属性，并前进代码到属性后
  let props = parseAttributes(context, type)

  // check v-pre
  // 检查属性中有没有 v-pre 指令
  if (
    type === TagType.Start &&
    !context.inVPre &&
    props.some(p => p.type === NodeTypes.DIRECTIVE && p.name === 'pre')
  ) {
    // 设置v-pre标记
    context.inVPre = true
    // reset context
    // 重置上下文，回到刚才的点
    // 重置 context
    extend(context, cursor)
    // 重置资源
    context.source = currentSource
    // re-parse attrs and filter out v-pre itself
    // 重新解析属性并且过滤掉v-pre本身，因为有没有v-pre解析过程是不一样的
    // 主要体现在parseAttribute中对于指令是不解析的，只是解析了属性和值
    // 问题为什么需要重新解析：因为我们的父级可能不是inVPre，但当前tag有v-pre指令，我们可能一开始进去处理了，
    // 后面解析完了后，发现不需要二次处理，所以需要重新解析属性
    // 这种没办法提前校验，因为不解析属性，不知道有没有v-pre
    // 只有解析完成后，才知道有没有v-pre
    props = parseAttributes(context, type).filter(p => p.name !== 'v-pre')
  }

  // Tag close.
  // 闭合标签
  // 自闭和标签标记
  let isSelfClosing = false
  // 没有文本了抛错
  if (context.source.length === 0) {
    emitError(context, ErrorCodes.EOF_IN_TAG)
  } else {
    // 判断是不是自闭和标签
    isSelfClosing = startsWith(context.source, '/>')
    // 结束标签不应该是自闭和标签
    if (type === TagType.End && isSelfClosing) {
      emitError(context, ErrorCodes.END_TAG_WITH_TRAILING_SOLIDUS)
    }
    // 前进代码到闭合标签后
    advanceBy(context, isSelfClosing ? 2 : 1)
  }

  // 如果是闭合标签
  if (type === TagType.End) {
    return
  }

  // 2.x deprecation checks
  // 2.x废弃的检查，用于警告的
  if (
    __COMPAT__ &&
    __DEV__ &&
    isCompatEnabled(
      CompilerDeprecationTypes.COMPILER_V_IF_V_FOR_PRECEDENCE,
      context
    )
  ) {
    // 有没有if有没有for
    let hasIf = false
    let hasFor = false
    // 遍历属性，如果属性中有if或者for
    for (let i = 0; i < props.length; i++) {
      const p = props[i]
      if (p.type === NodeTypes.DIRECTIVE) {
        if (p.name === 'if') {
          hasIf = true
        } else if (p.name === 'for') {
          hasFor = true
        }
      }
      // 两者都有警告
      if (hasIf && hasFor) {
        warnDeprecation(
          CompilerDeprecationTypes.COMPILER_V_IF_V_FOR_PRECEDENCE,
          context,
          getSelection(context, start)
        )
        break
      }
    }
  }

  // 标签类型 元素
  let tagType = ElementTypes.ELEMENT
  // 接下来判断标签类型，是组件、插槽还是模板
  if (!context.inVPre) { // 不是v-pre
    if (tag === 'slot') { // 插槽
      tagType = ElementTypes.SLOT
    } else if (tag === 'template') { // <template></template>
      // 是模板且属性中包含特殊的模板指令，v-if,v-else, v-else-if, v-for,v-slot，但是slot上面用了，这些都没有用那就是最普通的元素标签
      if (
        props.some(
          p =>
            p.type === NodeTypes.DIRECTIVE && isSpecialTemplateDirective(p.name)
        )
      ) {
        tagType = ElementTypes.TEMPLATE // 模板
      }
    } else if (isComponent(tag, props, context)) {
      tagType = ElementTypes.COMPONENT // 组件
    }
  }

  return {
    type: NodeTypes.ELEMENT, // 元素
    ns, // 命名空间
    tag, // 标签
    tagType, // 标签类型 元素？模板？组件？插槽？指令？
    props, // 属性
    isSelfClosing, // 自闭和？
    children: [], // 子节点
    loc: getSelection(context, start), // 位置
    codegenNode: undefined // to be created during transform phase 在转化阶段用于生成代码
  }
}

/**
 * 是组件
 * 1. 不是一个自定义组件
 * 2. 大写开头的
 * 3. 核心组件
 * 4. 内置组件
 * 5. 不是原生标签
 * 6. 包含is属性或v-is指令，看有没有开启兼容模式，决定是否是组件
 * 就是原始标签中没有的
 * @param tag 
 * @param props 
 * @param context 
 * @returns 
 */
function isComponent(
  tag: string,
  props: (AttributeNode | DirectiveNode)[],
  context: ParserContext
) {
  const options = context.options
  // 是否是自定义组件
  if (options.isCustomElement(tag)) {
    return false
  }
  // 如果是component、大小开头的、核心组件、内置组件、或者不是原生标签则就是组件
  if (
    tag === 'component' ||
    /^[A-Z]/.test(tag) ||
    isCoreComponent(tag) ||
    (options.isBuiltInComponent && options.isBuiltInComponent(tag)) ||
    (options.isNativeTag && !options.isNativeTag(tag))
  ) {
    return true
  }
  // at this point the tag should be a native tag, but check for potential "is"
  // casting
  // 如果代码执行到这里，说明标签应该是一个原生标签，但是要检查潜在的is属性
  for (let i = 0; i < props.length; i++) {
    // 看它属性中是否存在is，如果存在is，且is有值且is值以vue:开头说明是一个组件
    // 否则看兼容性，如果兼容vue2，则也是true
    // 如果属性是一个指令，看v-is指令，如果有v-is指令，则说明是组件
    // 如果属性中存在:is则在兼容模式上是组件
    const p = props[i]
    if (p.type === NodeTypes.ATTRIBUTE) {
      if (p.name === 'is' && p.value) {
        if (p.value.content.startsWith('vue:')) {
          return true
        } else if (
          __COMPAT__ &&
          checkCompatEnabled(
            CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
            context,
            p.loc
          )
        ) {
          return true
        }
      }
    } else {
      // directive
      // v-is (TODO Deprecate)
      if (p.name === 'is') {
        return true
      } else if (
        // :is on plain element - only treat as component in compat mode
        // :is在简单元素上仅仅在兼容模式中是组件
        p.name === 'bind' &&
        isStaticArgOf(p.arg, 'is') &&
        __COMPAT__ &&
        checkCompatEnabled(
          CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
          context,
          p.loc
        )
      ) {
        return true
      }
    }
  }
}

/**
 * 解析props
 * 
 * 它最终会生成一个props数组，并前进代码到属性后
 * @param context 
 * @param type 
 * @returns 
 */
function parseAttributes(
  context: ParserContext,
  type: TagType
): (AttributeNode | DirectiveNode)[] {
  const props = []
  const attributeNames = new Set<string>()
  // 没有到>或者/>
  while (
    context.source.length > 0 &&
    !startsWith(context.source, '>') &&
    !startsWith(context.source, '/>')
  ) {
    // 抛错
    if (startsWith(context.source, '/')) {
      emitError(context, ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG)
      advanceBy(context, 1)
      advanceSpaces(context)
      continue
    }
    // 抛错
    if (type === TagType.End) {
      emitError(context, ErrorCodes.END_TAG_WITH_ATTRIBUTES)
    }

    // 解析属性，同时为了防止重复的属性使用Set
    const attr = parseAttribute(context, attributeNames)

    // Trim whitespace between class
    // https://github.com/vuejs/core/issues/4251
    // 删除class两边的空格
    if (
      attr.type === NodeTypes.ATTRIBUTE &&
      attr.value &&
      attr.name === 'class'
    ) {
      attr.value.content = attr.value.content.replace(/\s+/g, ' ').trim()
    }

    // 如果是开标签内
    if (type === TagType.Start) {
      props.push(attr)
    }

    // 缺少空格抛错
    if (/^[^\t\r\n\f />]/.test(context.source)) {
      emitError(context, ErrorCodes.MISSING_WHITESPACE_BETWEEN_ATTRIBUTES)
    }
    // 删除空格
    advanceSpaces(context)
  }
  return props
}

/**
 * 解析属性
 * 注意有没有v-pre，解析的过程是不一样的
 * @param context 
 * @param nameSet 
 * @returns 
 */
function parseAttribute(
  context: ParserContext,
  nameSet: Set<string>
): AttributeNode | DirectiveNode {
  __TEST__ && assert(/^[^\t\r\n\f />]/.test(context.source))

  // Name.
  // 匹配出属性名称
  const start = getCursor(context)
  const match = /^[^\t\r\n\f />][^\t\r\n\f />=]*/.exec(context.source)!
  const name = match[0]

  if (nameSet.has(name)) {
    emitError(context, ErrorCodes.DUPLICATE_ATTRIBUTE)
  }
  // 重复的属性名称
  nameSet.add(name)

  // 属性名称第一个字符是=报错
  if (name[0] === '=') {
    emitError(context, ErrorCodes.UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME)
  }
  {
    // 属性名称中存在非法字符报错
    const pattern = /["'<]/g
    let m: RegExpExecArray | null
    while ((m = pattern.exec(name))) {
      emitError(
        context,
        ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME,
        m.index
      )
    }
  }

  // 删除属性名称
  advanceBy(context, name.length)

  // Value
  // 属性值
  let value: AttributeValue = undefined

  // 如果属性名称后有=号
  if (/^[\t\r\n\f ]*=/.test(context.source)) {
    // 去掉空格
    advanceSpaces(context)
    // 去掉=
    advanceBy(context, 1)
    // 去掉空格
    advanceSpaces(context)
    // 解析属性的值
    value = parseAttributeValue(context)
    // 没有值报错
    if (!value) {
      emitError(context, ErrorCodes.MISSING_ATTRIBUTE_VALUE)
    }
  }
  // 位置
  const loc = getSelection(context, start)

  // 属性不是v-pre 且是v-开头的或者(:v-bind,@v-on,#v-model,.modifer)
  if (!context.inVPre && /^(v-[A-Za-z0-9-]|:|\.|@|#)/.test(name)) {
    const match =
      /(?:^v-([a-z0-9-]+))?(?:(?::|^\.|^@|^#)(\[[^\]]+\]|[^\.]+))?(.+)?$/i.exec(
        name
      )!

    // 如果以.开头 bind
    // <div .someProperty="someObject"></div> => <div :someProperty.prop="someObject"></div>
    // .prop - force a binding to be set as a DOM property.

    let isPropShorthand = startsWith(name, '.')
    // 指令名称，v1匹配到的是  v-后面的指令名称，不包含v-，因为?:是非捕获分组
    // 以:或.开头是v-bind bind指令
    // 以@开头是v-on on指令
    // 否则是v-slot slot指令
    let dirName =
      match[1] ||
      (isPropShorthand || startsWith(name, ':')
        ? 'bind'
        : startsWith(name, '@')
        ? 'on'
        : 'slot')
    // 参数
    let arg: ExpressionNode | undefined

    // 匹配到的第二个 :[key] 中的[key] 或者  :key中的key
    if (match[2]) {
      // 如果是v-slot
      const isSlot = dirName === 'slot'
      // 从后往前找偏移量
      const startOffset = name.lastIndexOf(match[2])
      // 获取位置
      const loc = getSelection(
        context,
        getNewPosition(context, start, startOffset),
        getNewPosition(
          context,
          start,
          startOffset + match[2].length + ((isSlot && match[3]) || '').length
        )
      )
      // 属性名称
      let content = match[2]
      // 是否是静态的
      let isStatic = true

      // 有[]就不是静态的了
      if (content.startsWith('[')) {
        isStatic = false

        // []没有互相匹配到就报错
        if (!content.endsWith(']')) {
          emitError(
            context,
            ErrorCodes.X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END
          )
          content = content.slice(1)
        } else {
          content = content.slice(1, content.length - 1)
        }
      } else if (isSlot) {
        // #1241 special case for v-slot: vuetify relies extensively on slot
        // names containing dots. v-slot doesn't have any modifiers and Vue 2.x
        // supports such usage so we are keeping it consistent with 2.x.
        // 如果是插槽的话，
        // 特殊情况对于v-slot， 由于v-slot没有任何修饰符。所以vuetify 在slot名上大量的包含.这样的符号依赖
        // 2.x支持这样的用法所以我们继续和2.x保持一致
        content += match[3] || '' // 内容需要包含.后面的内容
      }

      // 参数
      arg = {
        type: NodeTypes.SIMPLE_EXPRESSION, // 简单正则表达式
        content, // 属性名一般
        isStatic, // 是否是静态的
        constType: isStatic // 是否是常量
          ? ConstantTypes.CAN_STRINGIFY
          : ConstantTypes.NOT_CONSTANT,
        loc
      }
    }

    if (value && value.isQuoted) { // 值有引号的话
      const valueLoc = value.loc // 值的位置
      valueLoc.start.offset++
      valueLoc.start.column++
      valueLoc.end = advancePositionWithClone(valueLoc.start, value.content)
      // 截取文本，将头部和尾部引号去掉
      valueLoc.source = valueLoc.source.slice(1, -1)
    }

    // 修饰符，第三个匹配的是修饰符
    const modifiers = match[3] ? match[3].slice(1).split('.') : []
    // 如果是前面有.，则是一个prop修饰符 .someProps="" => someProps.prop=""
    if (isPropShorthand) modifiers.push('prop')

    // 2.x compat v-bind:foo.sync -> v-model:foo
    // 2.x兼容 v-bind:foo.sync -> v-model:foo
    if (__COMPAT__ && dirName === 'bind' && arg) {
      // 是否启用对sync的兼容，启用的话，将其转化为model指令，并消除该修饰符
      if (
        modifiers.includes('sync') &&
        checkCompatEnabled(
          CompilerDeprecationTypes.COMPILER_V_BIND_SYNC,
          context,
          loc,
          arg.loc.source
        )
      ) {
        dirName = 'model'
        modifiers.splice(modifiers.indexOf('sync'), 1)
      }

      // 
      if (__DEV__ && modifiers.includes('prop')) {
        checkCompatEnabled(
          CompilerDeprecationTypes.COMPILER_V_BIND_PROP,
          context,
          loc
        )
      }
    }

    // 返回属性的节点
    return {
      type: NodeTypes.DIRECTIVE, // 指令类型
      name: dirName, // 指令
      exp: value && { // 值
        type: NodeTypes.SIMPLE_EXPRESSION, // 简单表达式类型
        content: value.content, // 内容
        isStatic: false, // 静态
        // Treat as non-constant by default. This can be potentially set to
        // other values by `transformExpression` to make it eligible for hoisting.
        // 默认是非常量，这可能被设置为通过' transformExpression '设置其他值，使其符合吊装条件。
        constType: ConstantTypes.NOT_CONSTANT, // 是否是常量
        loc: value.loc // 位置
      },
      arg, // 参数
      modifiers, // 修饰符
      loc // 位置
    }
  }

  // missing directive name or illegal directive name
  // 缺少指令或者不规范的指令名称
  if (!context.inVPre && startsWith(name, 'v-')) {
    emitError(context, ErrorCodes.X_MISSING_DIRECTIVE_NAME)
  }

  return {
    type: NodeTypes.ATTRIBUTE, // 属性类型
    name, // 名称
    value: value && {
      type: NodeTypes.TEXT, // 文本类型
      content: value.content, // 内容
      loc: value.loc // 位置
    },
    loc
  }
}

/**
 * 解析属性值
 * @param context 
 * @returns 
 */
function parseAttributeValue(context: ParserContext): AttributeValue {
  // 获取上下文指针
  const start = getCursor(context)
  let content: string

  // 获取第一个字符
  const quote = context.source[0]
  // 是否是引号
  const isQuoted = quote === `"` || quote === `'`
  if (isQuoted) {
    // Quoted value.
    // 删掉引号
    advanceBy(context, 1)

    // 找到下个引号
    const endIndex = context.source.indexOf(quote)
    // 没有找到，则解析剩下的整段文本
    if (endIndex === -1) {
      content = parseTextData(
        context,
        context.source.length,
        TextModes.ATTRIBUTE_VALUE
      )
    } else {
      // 找到引号，则解析这段文本
      content = parseTextData(context, endIndex, TextModes.ATTRIBUTE_VALUE)
      // 删掉引号
      advanceBy(context, 1)
    }
  } else {
    // Unquoted
    // 没有引号的情况，匹配非空格和非换行符非>
    const match = /^[^\t\r\n\f >]+/.exec(context.source)
    if (!match) {
      return undefined
    }
    // 不被期待的字符，引号、<、=
    const unexpectedChars = /["'<=`]/g
    let m: RegExpExecArray | null
    // 有任何不被期待的字符报错
    while ((m = unexpectedChars.exec(match[0]))) {
      emitError(
        context,
        ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
        m.index
      )
    }
    // 解析出来
    content = parseTextData(context, match[0].length, TextModes.ATTRIBUTE_VALUE)
  }

  return { content, isQuoted, loc: getSelection(context, start) }
}

/**
 * 解析内插值
 * 
 * 首先尝试找插值的结束分隔符，如果找不到则报错
 * 如果找到，先前进代码到插值开始分隔符后
 * 通过parseTextData获取插值中间的内容
 * 并前进代码到插值内容后
 * 除了普通字符串
 * parseTextData内部会处理一些HTML实体符号如&nbsp
 * 由于插值内容前后有空白字符
 * 所以最终返回的content需要执行一下trim函数
 * 为了准确反馈插值内容和代码位置信息，我们用innerStart和 innerEnd
 * 记录插值内容（不包含空白字符）的代码开头和结束位置
 * @param context 
 * @param mode 
 * @returns 
 */
function parseInterpolation(
  context: ParserContext,
  mode: TextModes
): InterpolationNode | undefined {
  // 从配置中获取插值开始和结束分隔符，默认是 {{ 和 }} 
  const [open, close] = context.options.delimiters
  __TEST__ && assert(startsWith(context.source, open))

  // 闭索引
  const closeIndex = context.source.indexOf(close, open.length)
  // 闭索引不存在
  if (closeIndex === -1) {
    // 触发错误
    emitError(context, ErrorCodes.X_MISSING_INTERPOLATION_END)
    return undefined
  }

  // 获取指针开始位置
  const start = getCursor(context)
  // 代码前进到插值开始分隔符后
  advanceBy(context, open.length)
  // 内部插值开始位置
  const innerStart = getCursor(context)
  // 内部插值结束位置
  const innerEnd = getCursor(context)
  // 插值原始内容的长度
  const rawContentLength = closeIndex - open.length
  // 插值原始内容
  const rawContent = context.source.slice(0, rawContentLength)
  // 获取插值的内容，并前进代码到插值的内容后
  const preTrimContent = parseTextData(context, rawContentLength, mode)
  // 去掉两边空格
  const content = preTrimContent.trim()
  // 内容相对插值开始分隔符的头偏移
  const startOffset = preTrimContent.indexOf(content)
  if (startOffset > 0) {
    // 更新内部插值开始位置
    advancePositionWithMutation(innerStart, rawContent, startOffset)
  }
  // 内容相对于插值结束分隔符的尾偏移
  const endOffset =
    rawContentLength - (preTrimContent.length - content.length - startOffset)
  // 更新内部插值结束分隔符的尾偏移
  advancePositionWithMutation(innerEnd, rawContent, endOffset)
  // 前进代码到插值结束分隔符后
  advanceBy(context, close.length)

  // 返回插值节点
  return {
    // 插值
    type: NodeTypes.INTERPOLATION,
    // 内容
    content: {
      // 类型：简单表达式
      type: NodeTypes.SIMPLE_EXPRESSION,
      // 静态：否
      isStatic: false,
      // Set `isConstant` to false by default and will decide in transformExpression
      // 设置 是否是 常量 默认标识为false并且将在转化表达式决定
      constType: ConstantTypes.NOT_CONSTANT,
      // 内容
      content,
      // 位置
      loc: getSelection(context, innerStart, innerEnd)
    },
    // 位置
    loc: getSelection(context, start)
  }
}

/**
 * 解析文本
 * 
 * 遇到 < 或者插值分隔符 {{ 结束，所以会遍历这些结束符，匹配并找到文本结束位置
 * 执行parseTextData获取文本的内容，并前进代码到文本的内容后
 * parseText最终返回的值就是一个描述文本节点的对象
 * 其中type表示它是一个文本节点，content表示文本的内容，loc表示文本的代码
 * 开头和结束位置信息
 * @param context 
 * @param mode 
 * @returns 
 */
function parseText(context: ParserContext, mode: TextModes): TextNode {
  __TEST__ && assert(context.source.length > 0)

  // 文本的结束令牌，一种是 ]]> 一种是 < ,还有一种是}}
  // 文本结束符， CDATA 标记 XML 中的穿文本
  const endTokens =
    mode === TextModes.CDATA ? [']]>'] : ['<', context.options.delimiters[0]]

  // 结束的索引，默认值最后，反正找到最后也找不到
  let endIndex = context.source.length
  // 然后去找，优先 < 其次 }}
  // 遍历文本结束符，匹配找到结束的位置
  for (let i = 0; i < endTokens.length; i++) {
    const index = context.source.indexOf(endTokens[i], 1)
    if (index !== -1 && endIndex > index) {
      endIndex = index
    }
  }

  __TEST__ && assert(endIndex > 0)

  // 获取开始指针
  const start = getCursor(context)
  // 获取文本的内容，并前进代码到文本的内容后
  const content = parseTextData(context, endIndex, mode)

  // 返回文本节点
  return {
    type: NodeTypes.TEXT,
    content,
    loc: getSelection(context, start)
  }
}

/**
 * Get text data with a given length from the current location.
 * This translates HTML entities in the text data.
 * 从当前位置获取一个给定长度的TextData
 * 在textData中翻译这个HTML特殊字符
 */
function parseTextData(
  context: ParserContext,
  length: number,
  mode: TextModes
): string {
  // 原始文本
  const rawText = context.source.slice(0, length)
  // 前进原始文本的个数
  advanceBy(context, length)
  // 模式中是否包含&,包含就解析&，同时如果是RAWTEXT和CDATA是不解析这个东西的
  if (
    mode === TextModes.RAWTEXT ||
    mode === TextModes.CDATA ||
    !rawText.includes('&')
  ) {
    return rawText
  } else {
    // DATA or RCDATA containing "&"". Entity decoding required.
    // DATA或者RCDATA包含& 特殊字符需要解码
    return context.options.decodeEntities(
      rawText,
      mode === TextModes.ATTRIBUTE_VALUE
    )
  }
}

/**
 * 获取指针位置
 * @param context 
 * @returns 
 */
function getCursor(context: ParserContext): Position {
  const { column, line, offset } = context
  return { column, line, offset }
}

/**
 * 选中
 * @param context 
 * @param start 起始位置
 * @param end 结束位置，没传用当前进行到的位置
 * @returns 
 * 返回截取的文本及起始值位置和结束位置
 */
function getSelection(
  context: ParserContext,
  start: Position,
  end?: Position
): SourceLocation {
  // 先获取指针
  end = end || getCursor(context)
  return {
    start,
    end,
    source: context.originalSource.slice(start.offset, end.offset)
  }
}

/**
 * 返回数组中最后一个元素
 * @param xs 
 * @returns 
 */
function last<T>(xs: T[]): T | undefined {
  return xs[xs.length - 1]
}

/**
 * 以xxx开头
 * @param source 
 * @param searchString 
 * @returns 
 */
function startsWith(source: string, searchString: string): boolean {
  return source.startsWith(searchString)
}

/**
 * 前进x个字符
 * 
 * 主要就是更新解析上下文 context 中的 source 来前进代码，
 * 同时更新 offset、line、column 等和代码位置相关的属性
 * @param context 
 * @param numberOfCharacters 前进的字符数
 */
function advanceBy(context: ParserContext, numberOfCharacters: number): void {
  const { source } = context
  // 测试环境中文字不够断言警告
  __TEST__ && assert(numberOfCharacters <= source.length)
  // 更新 context 的 offset、line、column
  advancePositionWithMutation(context, source, numberOfCharacters)
  // 更新 context 的 source 
  context.source = source.slice(numberOfCharacters) // 修改上下文源，删除前进的文本
}

/**
 * 前进到下一个非空白字符
 * @param context 
 */
function advanceSpaces(context: ParserContext): void {
  const match = /^[\t\r\n\f ]+/.exec(context.source)
  if (match) {
    advanceBy(context, match[0].length)
  }
}

/**
 * 获取新位置
 * @param context 
 * @param start 开始的位置
 * @param numberOfCharacters 前移字符数
 * @returns 
 */
function getNewPosition(
  context: ParserContext,
  start: Position,
  numberOfCharacters: number
): Position {
  // 使用克隆的方式，位置前移
  return advancePositionWithClone(
    start,
    context.originalSource.slice(start.offset, numberOfCharacters), // 迁移中复制的字符
    numberOfCharacters
  )
}

/**
 * 触发错误
 * @param context 
 * @param code 
 * @param offset 
 * @param loc 
 */
function emitError(
  context: ParserContext,
  code: ErrorCodes,
  offset?: number,
  loc: Position = getCursor(context)
): void {
  if (offset) {
    loc.offset += offset
    loc.column += offset
  }
  // 创建一个编译错误信息，code为错误码，并告知行号、列号
  context.options.onError(
    createCompilerError(code, {
      start: loc,
      end: loc,
      source: ''
    })
  )
}

/**
 * 是否已经结束当前这个模式
 * @param context 
 * @param mode 
 * @param ancestors 
 * @returns 
 */
function isEnd(
  context: ParserContext,
  mode: TextModes,
  ancestors: ElementNode[]
): boolean {
  const s = context.source

  // 分析模式
  switch (mode) {
    case TextModes.DATA:
      // 如果是DATA模式，以</开头
      if (startsWith(s, '</')) {
        // TODO: probably bad performance
        // 可能性能比较糟糕，以祖先节点倒序遍历，看看是否存在能闭合的标签，存在就结束了
        for (let i = ancestors.length - 1; i >= 0; --i) {
          if (startsWithEndTagOpen(s, ancestors[i].tag)) {
            return true
          }
        }
      }
      break

    case TextModes.RCDATA:
    case TextModes.RAWTEXT: {
      // 父节点
      const parent = last(ancestors)
      // 找到父节点结尾，就结束了
      if (parent && startsWithEndTagOpen(s, parent.tag)) {
        return true
      }
      break
    }

    case TextModes.CDATA:
      // CDATA存在 ]]>就结束了
      if (startsWith(s, ']]>')) {
        return true
      }
      break
  }

  return !s
}

/**
 * 是不是需要的闭合标签  
 *  1. 是否以</开始  
 *  2. tag值必须对应上  
 *  3. 去掉前面匹配到的字符后，后面是不是一个>符号
 * @param source 
 * @param tag 
 * @returns 
 */
function startsWithEndTagOpen(source: string, tag: string): boolean {
  return (
    startsWith(source, '</') &&
    source.slice(2, 2 + tag.length).toLowerCase() === tag.toLowerCase() &&
    /[\t\r\n\f />]/.test(source[2 + tag.length] || '>')
  )
}
