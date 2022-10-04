import { SourceLocation } from './ast'

/**
 * 编译错误
 * code 代码
 * loc 位置
 */
export interface CompilerError extends SyntaxError {
  code: number | string
  loc?: SourceLocation
}

/**
 * 编译错误
 * code 代码
 */
export interface CoreCompilerError extends CompilerError {
  code: ErrorCodes
}

/**
 * 抛出错误
 * @param error 
 */
export function defaultOnError(error: CompilerError) {
  throw error
}

/**
 * 警告
 * @param msg 
 */
export function defaultOnWarn(msg: CompilerError) {
  __DEV__ && console.warn(`[Vue warn] ${msg.message}`)
}

/**
 * 推断编译器错误
 * T是 ErrorCodes则属于核心编译器错误，否则编译器错误
 */
type InferCompilerError<T> = T extends ErrorCodes
  ? CoreCompilerError
  : CompilerError

/**
 * 创建编译器错误
 * @param code 代码
 * @param loc 位置
 * @param messages 信息
 * @param additionalMessage 额外的信息
 * @returns 
 */
export function createCompilerError<T extends number>(
  code: T,
  loc?: SourceLocation,
  messages?: { [code: number]: string },
  additionalMessage?: string
): InferCompilerError<T> {
  const msg =
    __DEV__ || !__BROWSER__
      ? (messages || errorMessages)[code] + (additionalMessage || ``)
      : code
  // 生成一个错误实例
  const error = new SyntaxError(String(msg)) as InferCompilerError<T>
  // 设置错误的code和位置
  error.code = code
  error.loc = loc
  // 并返回错误实例
  return error
}

/**
 * 错误枚举
 */
export const enum ErrorCodes {
  // parse errors
  // 解析错误
  ABRUPT_CLOSING_OF_EMPTY_COMMENT, // 突然关闭空注释
  CDATA_IN_HTML_CONTENT, // CDATA出现在HTML内容汇总
  DUPLICATE_ATTRIBUTE, // 重复属性
  END_TAG_WITH_ATTRIBUTES, // 闭合标签携带了属性
  END_TAG_WITH_TRAILING_SOLIDUS, // 闭合标签尾部带有斜线
  EOF_BEFORE_TAG_NAME, // 标签名称前的分析
  EOF_IN_CDATA, // CDATA分析
  EOF_IN_COMMENT, // 注释分析
  EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT, // 在脚本HTML注释像是文本一样的解析
  EOF_IN_TAG, // 在标签中的分析
  INCORRECTLY_CLOSED_COMMENT, // 不正确的关闭注释
  INCORRECTLY_OPENED_COMMENT, // 不正确的打开注释
  INVALID_FIRST_CHARACTER_OF_TAG_NAME, // 失效的标签名首字母
  MISSING_ATTRIBUTE_VALUE, // 缺少属性值
  MISSING_END_TAG_NAME, // 缺少闭合标签名称
  MISSING_WHITESPACE_BETWEEN_ATTRIBUTES, // 缺少属性之间的空格
  NESTED_COMMENT, // 嵌套注释
  UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME, // 不被期待的字符出现在属性名称中
  UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE, // 不被期待的字符出现在属性
  UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME, // 不憋期待的等于号出现在属性名称前
  UNEXPECTED_NULL_CHARACTER, // 不被期待的空值字符
  UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME, // 不被期待的问题标记而不是标签名称
  UNEXPECTED_SOLIDUS_IN_TAG, // 不被期待的斜线在标签中

  // Vue-specific parse errors
  // Vue转有解析错误
  X_INVALID_END_TAG, // x失效的闭合标签
  X_MISSING_END_TAG, // 丢失闭合标签
  X_MISSING_INTERPOLATION_END, // 丢失插值结束符号}}
  X_MISSING_DIRECTIVE_NAME, // 丢失指令名称
  X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END, // 丢失动态指令参数

  // transform errors
  // 转化错误
  X_V_IF_NO_EXPRESSION, // v-if无表达式
  X_V_IF_SAME_KEY, // v-if key相同
  X_V_ELSE_NO_ADJACENT_IF, // v-else 没有对应的if
  X_V_FOR_NO_EXPRESSION, // v-for无表达式
  X_V_FOR_MALFORMED_EXPRESSION, // v-for有一个不正确的表达式
  X_V_FOR_TEMPLATE_KEY_PLACEMENT, // v-for 模板key放置
  X_V_BIND_NO_EXPRESSION, // v-bind无表达式
  X_V_ON_NO_EXPRESSION, // v-on无表达式
  X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET, // v-slot不被期待的指令在插槽上
  X_V_SLOT_MIXED_SLOT_USAGE, // v-slot混合插槽使用
  X_V_SLOT_DUPLICATE_SLOT_NAMES, // v-slot重复插槽名称
  X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN, // v-slot没有关联默认插槽子节点
  X_V_SLOT_MISPLACED, // v-slot没有被放置
  X_V_MODEL_NO_EXPRESSION, // v-model无表达式
  X_V_MODEL_MALFORMED_EXPRESSION, // v-model值是一个畸形表达式
  X_V_MODEL_ON_SCOPE_VARIABLE, // v-model在作用域变量上
  X_INVALID_EXPRESSION, // 失效表达式
  X_KEEP_ALIVE_INVALID_CHILDREN, // keep-alive失效子节点

  // generic errors
  // 一般错误
  X_PREFIX_ID_NOT_SUPPORTED, // 前缀Id不支持
  X_MODULE_MODE_NOT_SUPPORTED, // Module模式不支持
  X_CACHE_HANDLER_NOT_SUPPORTED, // 缓存处理不支持
  X_SCOPE_ID_NOT_SUPPORTED, // 作用域Id不支持

  // Special value for higher-order compilers to pick up the last code
  // to avoid collision of error codes. This should always be kept as the last
  // item.
  // 特殊值用于更高级的编译器拾取最后的代码来避免错误代码冲突
  // 这应该总是被放在最后
  __EXTEND_POINT__
}

/**
 * 对应上面错误的信息提示
 */
export const errorMessages: Record<ErrorCodes, string> = {
  // parse errors
  [ErrorCodes.ABRUPT_CLOSING_OF_EMPTY_COMMENT]: 'Illegal comment.',
  [ErrorCodes.CDATA_IN_HTML_CONTENT]:
    'CDATA section is allowed only in XML context.',
  [ErrorCodes.DUPLICATE_ATTRIBUTE]: 'Duplicate attribute.',
  [ErrorCodes.END_TAG_WITH_ATTRIBUTES]: 'End tag cannot have attributes.',
  [ErrorCodes.END_TAG_WITH_TRAILING_SOLIDUS]: "Illegal '/' in tags.",
  [ErrorCodes.EOF_BEFORE_TAG_NAME]: 'Unexpected EOF in tag.',
  [ErrorCodes.EOF_IN_CDATA]: 'Unexpected EOF in CDATA section.',
  [ErrorCodes.EOF_IN_COMMENT]: 'Unexpected EOF in comment.',
  [ErrorCodes.EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT]:
    'Unexpected EOF in script.',
  [ErrorCodes.EOF_IN_TAG]: 'Unexpected EOF in tag.',
  [ErrorCodes.INCORRECTLY_CLOSED_COMMENT]: 'Incorrectly closed comment.',
  [ErrorCodes.INCORRECTLY_OPENED_COMMENT]: 'Incorrectly opened comment.',
  [ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME]:
    "Illegal tag name. Use '&lt;' to print '<'.",
  [ErrorCodes.MISSING_ATTRIBUTE_VALUE]: 'Attribute value was expected.',
  [ErrorCodes.MISSING_END_TAG_NAME]: 'End tag name was expected.',
  [ErrorCodes.MISSING_WHITESPACE_BETWEEN_ATTRIBUTES]:
    'Whitespace was expected.',
  [ErrorCodes.NESTED_COMMENT]: "Unexpected '<!--' in comment.",
  [ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME]:
    'Attribute name cannot contain U+0022 ("), U+0027 (\'), and U+003C (<).',
  [ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE]:
    'Unquoted attribute value cannot contain U+0022 ("), U+0027 (\'), U+003C (<), U+003D (=), and U+0060 (`).',
  [ErrorCodes.UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME]:
    "Attribute name cannot start with '='.",
  [ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME]:
    "'<?' is allowed only in XML context.",
  [ErrorCodes.UNEXPECTED_NULL_CHARACTER]: `Unexpected null character.`,
  [ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG]: "Illegal '/' in tags.",

  // Vue-specific parse errors
  [ErrorCodes.X_INVALID_END_TAG]: 'Invalid end tag.',
  [ErrorCodes.X_MISSING_END_TAG]: 'Element is missing end tag.',
  [ErrorCodes.X_MISSING_INTERPOLATION_END]:
    'Interpolation end sign was not found.',
  [ErrorCodes.X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END]:
    'End bracket for dynamic directive argument was not found. ' +
    'Note that dynamic directive argument cannot contain spaces.',
  [ErrorCodes.X_MISSING_DIRECTIVE_NAME]: 'Legal directive name was expected.',

  // transform errors
  [ErrorCodes.X_V_IF_NO_EXPRESSION]: `v-if/v-else-if is missing expression.`,
  [ErrorCodes.X_V_IF_SAME_KEY]: `v-if/else branches must use unique keys.`,
  [ErrorCodes.X_V_ELSE_NO_ADJACENT_IF]: `v-else/v-else-if has no adjacent v-if or v-else-if.`,
  [ErrorCodes.X_V_FOR_NO_EXPRESSION]: `v-for is missing expression.`,
  [ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION]: `v-for has invalid expression.`,
  [ErrorCodes.X_V_FOR_TEMPLATE_KEY_PLACEMENT]: `<template v-for> key should be placed on the <template> tag.`,
  [ErrorCodes.X_V_BIND_NO_EXPRESSION]: `v-bind is missing expression.`,
  [ErrorCodes.X_V_ON_NO_EXPRESSION]: `v-on is missing expression.`,
  [ErrorCodes.X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET]: `Unexpected custom directive on <slot> outlet.`,
  [ErrorCodes.X_V_SLOT_MIXED_SLOT_USAGE]:
    `Mixed v-slot usage on both the component and nested <template>.` +
    `When there are multiple named slots, all slots should use <template> ` +
    `syntax to avoid scope ambiguity.`,
  [ErrorCodes.X_V_SLOT_DUPLICATE_SLOT_NAMES]: `Duplicate slot names found. `,
  [ErrorCodes.X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN]:
    `Extraneous children found when component already has explicitly named ` +
    `default slot. These children will be ignored.`,
  [ErrorCodes.X_V_SLOT_MISPLACED]: `v-slot can only be used on components or <template> tags.`,
  [ErrorCodes.X_V_MODEL_NO_EXPRESSION]: `v-model is missing expression.`,
  [ErrorCodes.X_V_MODEL_MALFORMED_EXPRESSION]: `v-model value must be a valid JavaScript member expression.`,
  [ErrorCodes.X_V_MODEL_ON_SCOPE_VARIABLE]: `v-model cannot be used on v-for or v-slot scope variables because they are not writable.`,
  [ErrorCodes.X_INVALID_EXPRESSION]: `Error parsing JavaScript expression: `,
  [ErrorCodes.X_KEEP_ALIVE_INVALID_CHILDREN]: `<KeepAlive> expects exactly one child component.`,

  // generic errors
  [ErrorCodes.X_PREFIX_ID_NOT_SUPPORTED]: `"prefixIdentifiers" option is not supported in this build of compiler.`,
  [ErrorCodes.X_MODULE_MODE_NOT_SUPPORTED]: `ES module mode is not supported in this build of compiler.`,
  [ErrorCodes.X_CACHE_HANDLER_NOT_SUPPORTED]: `"cacheHandlers" option is only supported when the "prefixIdentifiers" option is enabled.`,
  [ErrorCodes.X_SCOPE_ID_NOT_SUPPORTED]: `"scopeId" option is only supported in module mode.`,

  // just to fulfill types
  [ErrorCodes.__EXTEND_POINT__]: ``
}
