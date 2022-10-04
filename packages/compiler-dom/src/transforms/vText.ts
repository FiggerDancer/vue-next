import {
  DirectiveTransform,
  createObjectProperty,
  createSimpleExpression,
  TO_DISPLAY_STRING,
  createCallExpression,
  getConstantType
} from '@vue/compiler-core'
import { createDOMCompilerError, DOMErrorCodes } from '../errors'

/**
 * 转化v-text
 * @param dir 
 * @param node 
 * @param context 
 * @returns 
 */
export const transformVText: DirectiveTransform = (dir, node, context) => {
  const { exp, loc } = dir
  // 不存在表达式警告
  if (!exp) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_TEXT_NO_EXPRESSION, loc)
    )
  }
  // 存在子节点警告,并删除子节点
  if (node.children.length) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_TEXT_WITH_CHILDREN, loc)
    )
    node.children.length = 0
  }
  // 指令转化的结果
  return {
    props: [
      createObjectProperty(
        createSimpleExpression(`textContent`, true),
        exp
          ? getConstantType(exp, context) > 0
            ? exp
            : createCallExpression(
                context.helperString(TO_DISPLAY_STRING),
                [exp],
                loc
              )
          : createSimpleExpression('', true)
      )
    ]
  }
}
