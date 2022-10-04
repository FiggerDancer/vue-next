import { NodeTransform } from '../transform'
import { findDir, makeBlock } from '../utils'
import {
  createCallExpression,
  createFunctionExpression,
  ElementTypes,
  MemoExpression,
  NodeTypes,
  PlainElementNode
} from '../ast'
import { WITH_MEMO } from '../runtimeHelpers'

const seen = new WeakSet()

/**
 * 转化v-memo
 * @param node 
 * @param context 
 * @returns 
 */
export const transformMemo: NodeTransform = (node, context) => {
  // 元素
  if (node.type === NodeTypes.ELEMENT) {
    // 指令为memo
    const dir = findDir(node, 'memo')
    if (!dir || seen.has(node)) {
      return
    }
    // 记录
    seen.add(node)
    return () => {
      // 获取编译结果
      const codegenNode =
        node.codegenNode ||
        (context.currentNode as PlainElementNode).codegenNode
        // 如果编译的节点类型为 VNODE_CALL
      if (codegenNode && codegenNode.type === NodeTypes.VNODE_CALL) {
        // non-component sub tree should be turned into a block
        // 非组件子树应该被转化为一个block
        if (node.tagType !== ElementTypes.COMPONENT) {
          makeBlock(codegenNode, context)
        }
        // 将编译好的代码使用withMemo()包装一下
        node.codegenNode = createCallExpression(context.helper(WITH_MEMO), [
          dir.exp!,
          createFunctionExpression(undefined, codegenNode),
          `_cache`,
          String(context.cached++)
        ]) as MemoExpression
      }
    }
  }
}
