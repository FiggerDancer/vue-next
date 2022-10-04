import { NodeTransform, NodeTypes, ElementTypes } from '@vue/compiler-core'
import { DOMErrorCodes, createDOMCompilerError } from '../errors'

/**
 * 忽略副作用标签
 * @param node 
 * @param context 
 */
export const ignoreSideEffectTags: NodeTransform = (node, context) => {
  // 该节点为style或者是style节点，则忽略
  if (
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.ELEMENT &&
    (node.tag === 'script' || node.tag === 'style')
  ) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_IGNORED_SIDE_EFFECT_TAG, node.loc)
    )
    context.removeNode()
  }
}
