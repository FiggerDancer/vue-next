import { NodeTransform } from '../transform'
import { findDir } from '../utils'
import { ElementNode, ForNode, IfNode, NodeTypes } from '../ast'
import { SET_BLOCK_TRACKING } from '../runtimeHelpers'

// 缓存
const seen = new WeakSet()

/** 
 * Once转化 
 * */ 
export const transformOnce: NodeTransform = (node, context) => {
  // 节点类型为元素类型，如果可以找到v-once指令
  if (node.type === NodeTypes.ELEMENT && findDir(node, 'once', true)) {
    // 如果已经存储过该节点，或者祖先有v-once指令，则不再存储
    if (seen.has(node) || context.inVOnce) {
      return
    }
    seen.add(node)
    context.inVOnce = true
    // 块跟踪
    context.helper(SET_BLOCK_TRACKING)
    return () => {
      // 离开该节点时，需要将v-once上下文标识去掉
      context.inVOnce = false
      // 获取当前节点
      const cur = context.currentNode as ElementNode | IfNode | ForNode
      // 缓存当前生成的代码节点（离开时换存确保内部搞定了）
      if (cur.codegenNode) {
        cur.codegenNode = context.cache(cur.codegenNode, true /* isVNode */)
      }
    }
  }
}
