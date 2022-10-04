import { NodeTransform } from '../transform'
import {
  NodeTypes,
  CompoundExpressionNode,
  createCallExpression,
  CallExpression,
  ElementTypes,
  ConstantTypes
} from '../ast'
import { isText } from '../utils'
import { CREATE_TEXT } from '../runtimeHelpers'
import { PatchFlags, PatchFlagNames } from '@vue/shared'
import { getConstantType } from './hoistStatic'

// Merge adjacent text nodes and expressions into a single expression
// e.g. <div>abc {{ d }} {{ e }}</div> should have a single expression node as child.
/**
 * 合并相邻的文本节点和表达式成一个单独的表达式
 * 例如： <div>abc {{ d }} {{ e }}</div>应该有一个单独的表达式节点作为子节点
 * @param node 
 * @param context 
 * @returns 
 */
export const transformText: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ROOT ||
    node.type === NodeTypes.ELEMENT ||
    node.type === NodeTypes.FOR ||
    node.type === NodeTypes.IF_BRANCH
  ) {
    // perform the transform on node exit so that all expressions have already
    // been processed.
    // 执行转化在节点退出的时候，因为此时所有的表达式已经被处理完了
    return () => {
      // 子节点
      const children = node.children
      // 当前容器
      let currentContainer: CompoundExpressionNode | undefined = undefined
      // 存在文本
      let hasText = false

      for (let i = 0; i < children.length; i++) {
        // 子节点
        const child = children[i]
        // 子节点是文本
        if (isText(child)) {
          // 有文本
          hasText = true
          // 遍历子节点
          for (let j = i + 1; j < children.length; j++) {
            // 下一个节点
            const next = children[j]
            // 下个节点是文本节点
            if (isText(next)) {
              // 第一个节点需要定义当前容器
              // 生成复杂表达式节点 [ExpressionNode, ` + `, TextNode]
              if (!currentContainer) {
                // 当前容器
                currentContainer = children[i] = {
                  type: NodeTypes.COMPOUND_EXPRESSION,
                  loc: child.loc,
                  children: [child]
                }
              }
              // merge adjacent text node into current
              // 合并相邻的文本节点到当前节点
              currentContainer.children.push(` + `, next)
              children.splice(j, 1)
              j--
            } else {
              // 这段文本节点结束，那就删除当前容器
              currentContainer = undefined
              break
            }
          }
        }
      }

      if (
        !hasText ||
        // if this is a plain element with a single text child, leave it
        // as-is since the runtime has dedicated fast path for this by directly
        // setting textContent of the element.
        // for component root it's always normalized anyway.
        // 如果这是一个只有一个文本子节点的简单元素
        // 通过直接设置元素的textContent，让它保持原样，
        // 因为运行时为此专门提供了快速路径。对于组件根，它总是规范化的。
        (children.length === 1 &&
          (node.type === NodeTypes.ROOT ||
            (node.type === NodeTypes.ELEMENT &&
              node.tagType === ElementTypes.ELEMENT &&
              // #3756
              // custom directives can potentially add DOM elements arbitrarily,
              // we need to avoid setting textContent of the element at runtime
              // to avoid accidentally overwriting the DOM elements added
              // by the user through custom directives.
              // 自定义可以随意添加dom元素
              // 我们需要在运行时避免设置这些元素的textContent
              // 防止意外的覆盖被用户通过自定义指令添加的dom元素
              !node.props.find(
                p =>
                  p.type === NodeTypes.DIRECTIVE &&
                  !context.directiveTransforms[p.name]
              ) &&
              // in compat mode, <template> tags with no special directives
              // will be rendered as a fragment so its children must be
              // converted into vnodes.
              // 在兼容模式，模板标签没有专有的指令奖杯渲染成一个
              // fragment
              // 所以它的子节点必须被转化成vnodes
              !(__COMPAT__ && node.tag === 'template'))))
      ) {
        return
      }

      // pre-convert text nodes into createTextVNode(text) calls to avoid
      // runtime normalization.
      // 预转化文本节点为createTextVNode(text)调用避免
      // 运行时序列化
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (isText(child) || child.type === NodeTypes.COMPOUND_EXPRESSION) {
          const callArgs: CallExpression['arguments'] = []
          // createTextVNode defaults to single whitespace, so if it is a
          // single space the code could be an empty call to save bytes.
          // createTextVNode 默认为单个空格，如果它是单个空格则说明
          // 代码可能是一个空的调用用来节省字节
          if (child.type !== NodeTypes.TEXT || child.content !== ' ') {
            callArgs.push(child)
          }
          // mark dynamic text with flag so it gets patched inside a block
          // 用标志标记动态文本，这样它就可以在块中修补
          if (
            !context.ssr &&
            getConstantType(child, context) === ConstantTypes.NOT_CONSTANT
          ) {
            callArgs.push(
              PatchFlags.TEXT +
                (__DEV__ ? ` /* ${PatchFlagNames[PatchFlags.TEXT]} */` : ``)
            )
          }
          children[i] = {
            type: NodeTypes.TEXT_CALL,
            content: child,
            loc: child.loc,
            codegenNode: createCallExpression(
              context.helper(CREATE_TEXT),
              callArgs
            )
          }
        }
      }
    }
  }
}
