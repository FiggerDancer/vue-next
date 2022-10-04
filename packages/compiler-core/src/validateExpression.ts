// these keywords should not appear inside expressions, but operators like
// 这些关键字不应该出现在表达式中，而应该出现操作符

import { SimpleExpressionNode } from './ast'
import { TransformContext } from './transform'
import { createCompilerError, ErrorCodes } from './errors'

// typeof, instanceof and in are allowed
// Typeof、instanceof和in是允许的
const prohibitedKeywordRE = new RegExp(
  '\\b' +
    (
      'do,if,for,let,new,try,var,case,else,with,await,break,catch,class,const,' +
      'super,throw,while,yield,delete,export,import,return,switch,default,' +
      'extends,finally,continue,debugger,function,arguments,typeof,void'
    )
      .split(',')
      .join('\\b|\\b') +
    '\\b'
)

// strip strings in expressions
// 去掉表达式中字符串
const stripStringRE =
  /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*\$\{|\}(?:[^`\\]|\\.)*`|`(?:[^`\\]|\\.)*`/g

/**
 * Validate a non-prefixed expression.
 * This is only called when using the in-browser runtime compiler since it
 * doesn't prefix expressions.
 * 校验一个无前缀表达式
 * 当在浏览器运行时编译器使用时被调用因为它不能给表达式加前缀
 */
export function validateBrowserExpression(
  node: SimpleExpressionNode,
  context: TransformContext,
  asParams = false,
  asRawStatements = false
) {
  const exp = node.content

  // empty expressions are validated per-directive since some directives
  // do allow empty expressions.
  // 每个指令的空的表达式被校验，因为一些指令不允许空表达式
  if (!exp.trim()) {
    return
  }

  // 可以成功new出这个方法说明这个方法是有效的
  try {
    new Function(
      asRawStatements
        ? ` ${exp} `
        : `return ${asParams ? `(${exp}) => {}` : `(${exp})`}`
    )
  } catch (e: any) {
    let message = e.message
    const keywordMatch = exp
      .replace(stripStringRE, '')
      .match(prohibitedKeywordRE)
    if (keywordMatch) {
      message = `avoid using JavaScript keyword as property name: "${keywordMatch[0]}"`
    }
    context.onError(
      createCompilerError(
        ErrorCodes.X_INVALID_EXPRESSION,
        node.loc,
        undefined,
        message
      )
    )
  }
}
