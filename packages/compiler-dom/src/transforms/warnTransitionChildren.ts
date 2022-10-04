import {
  NodeTransform,
  NodeTypes,
  ElementTypes,
  ComponentNode,
  IfBranchNode
} from '@vue/compiler-core'
import { TRANSITION } from '../runtimeHelpers'
import { createDOMCompilerError, DOMErrorCodes } from '../errors'

/**
 * transition警告
 */
export const warnTransitionChildren: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.COMPONENT
  ) {
    const component = context.isBuiltInComponent(node.tag)
    // 组件是transition
    if (component === TRANSITION) {
      return () => {
        // 如果有多个子节点警告
        if (node.children.length && hasMultipleChildren(node)) {
          context.onError(
            createDOMCompilerError(
              DOMErrorCodes.X_TRANSITION_INVALID_CHILDREN,
              {
                start: node.children[0].loc.start,
                end: node.children[node.children.length - 1].loc.end,
                source: ''
              }
            )
          )
        }
      }
    }
  }
}

/**
 * 是否有多个子节点
 * @param node 
 * @returns 
 */
function hasMultipleChildren(node: ComponentNode | IfBranchNode): boolean {
  // #1352 filter out potential comment nodes.
  // 过滤潜在的注释节点
  const children = (node.children = node.children.filter(
    c =>
      c.type !== NodeTypes.COMMENT &&
      !(c.type === NodeTypes.TEXT && !c.content.trim())
  ))
  const child = children[0]
  // 有多个子节点，存在v-for指令，存在v-if且分支下存在多个节点
  return (
    children.length !== 1 ||
    child.type === NodeTypes.FOR ||
    (child.type === NodeTypes.IF && child.branches.some(hasMultipleChildren))
  )
}
