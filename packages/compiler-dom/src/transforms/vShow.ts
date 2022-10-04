import { DirectiveTransform } from '@vue/compiler-core'
import { createDOMCompilerError, DOMErrorCodes } from '../errors'
import { V_SHOW } from '../runtimeHelpers'

/**
 * 转化v-show指令
 * @param dir 
 * @param node 
 * @param context 
 * @returns 
 */
export const transformShow: DirectiveTransform = (dir, node, context) => {
  const { exp, loc } = dir
  // 无表达式则警告
  if (!exp) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_SHOW_NO_EXPRESSION, loc)
    )
  }

  // 转化成如下，并提供v-show帮主函数
  return {
    props: [],
    needRuntime: context.helper(V_SHOW)
  }
}
