import {
  DirectiveTransform,
  createObjectProperty,
  createSimpleExpression
} from '@vue/compiler-core'
import { createDOMCompilerError, DOMErrorCodes } from '../errors'

/**
 * 转化v-html
 * @param dir 
 * @param node 
 * @param context 
 * @returns 
 */
export const transformVHtml: DirectiveTransform = (dir, node, context) => {
  const { exp, loc } = dir
  // 警告处理
  if (!exp) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_HTML_NO_EXPRESSION, loc)
    )
  }
  if (node.children.length) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_HTML_WITH_CHILDREN, loc)
    )
    node.children.length = 0
  }
  // innerHTML
  return {
    props: [
      createObjectProperty(
        createSimpleExpression(`innerHTML`, true, loc),
        exp || createSimpleExpression('', true)
      )
    ]
  }
}
