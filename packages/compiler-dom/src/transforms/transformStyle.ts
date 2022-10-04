import {
  NodeTransform,
  NodeTypes,
  createSimpleExpression,
  SimpleExpressionNode,
  SourceLocation,
  ConstantTypes
} from '@vue/compiler-core'
import { parseStringStyle } from '@vue/shared'

// Parse inline CSS strings for static style attributes into an object.
// This is a NodeTransform since it works on the static `style` attribute and
// converts it into a dynamic equivalent:
// style="color: red" -> :style='{ "color": "red" }'
// It is then processed by `transformElement` and included in the generated
// props.
// 解析内联css字符串用于静态style属性在一个对象中
// 这是一个NodeTransform
// 因为它在一个静态`style`中运行并且转化它成为一个动态环境
// style="color: red" -> :style='{ "color": "red" }'
// 之后它被transformElement处理并且包含在生成props里
export const transformStyle: NodeTransform = node => {
  if (node.type === NodeTypes.ELEMENT) {
    node.props.forEach((p, i) => {
      if (p.type === NodeTypes.ATTRIBUTE && p.name === 'style' && p.value) {
        // replace p with an expression node
        // 用一个表达式节点代替p
        node.props[i] = {
          type: NodeTypes.DIRECTIVE,
          name: `bind`,
          arg: createSimpleExpression(`style`, true, p.loc),
          exp: parseInlineCSS(p.value.content, p.loc),
          modifiers: [],
          loc: p.loc
        }
      }
    })
  }
}

/**
 * 解析内联css
 * @param cssText 
 * @param loc 
 * @returns 
 */
const parseInlineCSS = (
  cssText: string,
  loc: SourceLocation
): SimpleExpressionNode => {
  const normalized = parseStringStyle(cssText)
  return createSimpleExpression(
    JSON.stringify(normalized),
    false,
    loc,
    ConstantTypes.CAN_STRINGIFY
  )
}
