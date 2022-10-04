import {
  createStructuralDirectiveTransform,
  TransformContext,
  traverseNode
} from '../transform'
import {
  NodeTypes,
  ElementTypes,
  ElementNode,
  DirectiveNode,
  IfBranchNode,
  SimpleExpressionNode,
  createCallExpression,
  createConditionalExpression,
  createSimpleExpression,
  createObjectProperty,
  createObjectExpression,
  IfConditionalExpression,
  BlockCodegenNode,
  IfNode,
  createVNodeCall,
  AttributeNode,
  locStub,
  CacheExpression,
  ConstantTypes,
  MemoExpression
} from '../ast'
import { createCompilerError, ErrorCodes } from '../errors'
import { processExpression } from './transformExpression'
import { validateBrowserExpression } from '../validateExpression'
import { FRAGMENT, CREATE_COMMENT } from '../runtimeHelpers'
import {
  injectProp,
  findDir,
  findProp,
  isBuiltInType,
  makeBlock
} from '../utils'
import { PatchFlags, PatchFlagNames } from '@vue/shared'
import { getMemoedVNodeCall } from '..'

/**
 * v-if
 * 通过createStructuralDirectiveTransform函数创建的结构化指令的结构函数
 * v-if、v-else-if、v-else、v-for这些都是结构化指令，因为他们都能影响代码的组织结构
 * 
 */
export const transformIf = createStructuralDirectiveTransform(
  /^(if|else|else-if)$/,
  (node, dir, context) => {
    return processIf(node, dir, context, (ifNode, branch, isRoot) => {
      // #1587: We need to dynamically increment the key based on the current
      // node's sibling nodes, since chained v-if/else branches are
      // rendered at the same depth
      const siblings = context.parent!.children
      let i = siblings.indexOf(ifNode)
      let key = 0
      while (i-- >= 0) {
        const sibling = siblings[i]
        if (sibling && sibling.type === NodeTypes.IF) {
          key += sibling.branches.length
        }
      }

      // Exit callback. Complete the codegenNode when all children have been
      // transformed.
      return () => {
        if (isRoot) {
          ifNode.codegenNode = createCodegenNodeForBranch(
            branch,
            key,
            context
          ) as IfConditionalExpression
        } else {
          // attach this branch's codegen node to the v-if root.
          const parentCondition = getParentCondition(ifNode.codegenNode!)
          parentCondition.alternate = createCodegenNodeForBranch(
            branch,
            key + ifNode.branches.length - 1,
            context
          )
        }
      }
    })
  }
)

// target-agnostic transform used for both Client and SSR
/**
 * 客户端和SSR都使用目标不可知变换
 * @param node 
 * @param dir 
 * @param context 
 * @param processCodegen 
 * @returns 
 */
export function processIf(
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext,
  processCodegen?: (
    node: IfNode,
    branch: IfBranchNode,
    isRoot: boolean
  ) => (() => void) | undefined
) {
  if (
    dir.name !== 'else' &&
    (!dir.exp || !(dir.exp as SimpleExpressionNode).content.trim())
  ) {
    // 位置 指令表达式存在？指令表达式位置：节点位置
    const loc = dir.exp ? dir.exp.loc : node.loc
    context.onError(
      createCompilerError(ErrorCodes.X_V_IF_NO_EXPRESSION, dir.loc)
    )
    // 创建简单表达式 v-if="true"
    dir.exp = createSimpleExpression(`true`, false, loc)
  }

  if (!__BROWSER__ && context.prefixIdentifiers && dir.exp) {
    // dir.exp can only be simple expression because vIf transform is applied
    // before expression transform.
    // 指令表达式可能是简单表达式
    // 因为v-if转化被应用
    // 在表达式转化前
    dir.exp = processExpression(dir.exp as SimpleExpressionNode, context)
  }

  if (__DEV__ && __BROWSER__ && dir.exp) {
    // 校验浏览器表达式
    validateBrowserExpression(dir.exp as SimpleExpressionNode, context)
  }

  if (dir.name === 'if') {
    // 创建if分支
    const branch = createIfBranch(node, dir)
    const ifNode: IfNode = {
      type: NodeTypes.IF,
      loc: node.loc,
      branches: [branch]
    }
    // 上下文替换节点
    context.replaceNode(ifNode)
    // 处理代码生成
    if (processCodegen) {
      return processCodegen(ifNode, branch, true)
    }
  } else {
    // locate the adjacent v-if
    // 确定相邻v-if的位置
    const siblings = context.parent!.children
    const comments = []
    let i = siblings.indexOf(node)
    while (i-- >= -1) {
      const sibling = siblings[i]
      // 注释
      if (__DEV__ && sibling && sibling.type === NodeTypes.COMMENT) {
        context.removeNode(sibling)
        comments.unshift(sibling)
        continue
      }

      // 文本
      if (
        sibling &&
        sibling.type === NodeTypes.TEXT &&
        !sibling.content.trim().length
      ) {
        context.removeNode(sibling)
        continue
      }

      // 节点类型为if
      if (sibling && sibling.type === NodeTypes.IF) {
        // Check if v-else was followed by v-else-if
        // 检查v-else后面是否跟着v-else-if
        if (
          dir.name === 'else-if' &&
          sibling.branches[sibling.branches.length - 1].condition === undefined
        ) {
          context.onError(
            createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, node.loc)
          )
        }

        // move the node to the if node's branches
        // 将节点移动到if节点的分支
        context.removeNode()
        const branch = createIfBranch(node, dir)
        if (
          __DEV__ &&
          comments.length &&
          // #3619 ignore comments if the v-if is direct child of <transition>
          !(
            context.parent &&
            context.parent.type === NodeTypes.ELEMENT &&
            isBuiltInType(context.parent.tag, 'transition')
          )
        ) {
          branch.children = [...comments, ...branch.children]
        }

        // check if user is forcing same key on different branches
        // 查用户是否在不同的分支上强制使用相同的键
        if (__DEV__ || !__BROWSER__) {
          const key = branch.userKey
          if (key) {
            sibling.branches.forEach(({ userKey }) => {
              if (isSameKey(userKey, key)) {
                context.onError(
                  createCompilerError(
                    ErrorCodes.X_V_IF_SAME_KEY,
                    branch.userKey!.loc
                  )
                )
              }
            })
          }
        }

        sibling.branches.push(branch)
        const onExit = processCodegen && processCodegen(sibling, branch, false)
        // since the branch was removed, it will not be traversed.
        // make sure to traverse here.
        // 因为这个分支已经被移除，它将不会被遍历。
        // 我们要做的是保证遍历这里
        traverseNode(branch, context)
        // call on exit
        // 退出时调用
        if (onExit) onExit()
        // make sure to reset currentNode after traversal to indicate this
        // node has been removed.
        // 在遍历完这些要移除的节点后确保重置当前的节点为null
        context.currentNode = null
      } else {
        context.onError(
          createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, node.loc)
        )
      }
      break
    }
  }
}

/**
 * 创建if分支
 * @param node 
 * @param dir 
 * @returns 
 */
function createIfBranch(node: ElementNode, dir: DirectiveNode): IfBranchNode {
  return {
    type: NodeTypes.IF_BRANCH,
    loc: node.loc,
    condition: dir.name === 'else' ? undefined : dir.exp,
    children:
      node.tagType === ElementTypes.TEMPLATE && !findDir(node, 'for')
        ? node.children
        : [node],
    userKey: findProp(node, `key`)
  }
}

/**
 * 创建代码生成节点for branch
 * @param branch 
 * @param keyIndex 
 * @param context 
 * @returns 
 */
function createCodegenNodeForBranch(
  branch: IfBranchNode,
  keyIndex: number,
  context: TransformContext
): IfConditionalExpression | BlockCodegenNode | MemoExpression {
  // 有分支
  if (branch.condition) {
    return createConditionalExpression(
      branch.condition,
      createChildrenCodegenNode(branch, keyIndex, context),
      // make sure to pass in asBlock: true so that the comment node call
      // closes the current block.
      // 确保传入asBlock: true以便调用注释节点关闭当前块
      createCallExpression(context.helper(CREATE_COMMENT), [
        __DEV__ ? '"v-if"' : '""',
        'true'
      ])
    ) as IfConditionalExpression
  } else {
    return createChildrenCodegenNode(branch, keyIndex, context)
  }
}

/**
 * 创建子节点代码生成节点
 * @param branch 分支
 * @param keyIndex key的索引
 * @param context 上下文
 * @returns 
 */
function createChildrenCodegenNode(
  branch: IfBranchNode,
  keyIndex: number,
  context: TransformContext
): BlockCodegenNode | MemoExpression {
  const { helper } = context
  // 创建对象属性
  const keyProperty = createObjectProperty(
    `key`,
    createSimpleExpression(
      `${keyIndex}`,
      false,
      locStub,
      ConstantTypes.CAN_HOIST
    )
  )
  // 子节点
  const { children } = branch
  // 第一个 子节点
  const firstChild = children[0]
  // 需要fragment包裹，如果节点不止一个或者节点不是元素
  const needFragmentWrapper =
    children.length !== 1 || firstChild.type !== NodeTypes.ELEMENT
  if (needFragmentWrapper) {
    if (children.length === 1 && firstChild.type === NodeTypes.FOR) {
      // optimize away nested fragments when child is a ForNode
      // 当子节点是ForNode时，优化掉嵌套的片段
      // 节点
      const vnodeCall = firstChild.codegenNode!
      // 注入prop
      injectProp(vnodeCall, keyProperty, context)
      return vnodeCall
    } else {
      // 更新标记
      let patchFlag = PatchFlags.STABLE_FRAGMENT
      // 更新标记的文本
      let patchFlagText = PatchFlagNames[PatchFlags.STABLE_FRAGMENT]
      // check if the fragment actually contains a single valid child with
      // the rest being comments
      // 检查片段是否包含一个有效的子片段，其余的都是注释
      if (
        __DEV__ &&
        children.filter(c => c.type !== NodeTypes.COMMENT).length === 1
      ) {
        // 添加DEV_ROOT_FRAGMENT标记
        patchFlag |= PatchFlags.DEV_ROOT_FRAGMENT
        patchFlagText += `, ${PatchFlagNames[PatchFlags.DEV_ROOT_FRAGMENT]}`
      }

      // 创建节点
      return createVNodeCall(
        context,
        helper(FRAGMENT),
        createObjectExpression([keyProperty]),
        children,
        patchFlag + (__DEV__ ? ` /* ${patchFlagText} */` : ``),
        undefined,
        undefined,
        true,
        false,
        false /* isComponent */,
        branch.loc
      )
    }
  } else {
    // 代码生成的节点
    const ret = (firstChild as ElementNode).codegenNode as
      | BlockCodegenNode
      | MemoExpression
    // vnode节点
    const vnodeCall = getMemoedVNodeCall(ret)
    // Change createVNode to createBlock.
    // 将createVNode修改为createBlock
    if (vnodeCall.type === NodeTypes.VNODE_CALL) {
      makeBlock(vnodeCall, context)
    }
    // inject branch key
    // 注入branch key
    injectProp(vnodeCall, keyProperty, context)
    return ret
  }
}

/**
 * 是相同的key
 * @param a 
 * @param b 
 * @returns 
 */
function isSameKey(
  a: AttributeNode | DirectiveNode | undefined,
  b: AttributeNode | DirectiveNode
): boolean {
  if (!a || a.type !== b.type) {
    return false
  }
  if (a.type === NodeTypes.ATTRIBUTE) {
    if (a.value!.content !== (b as AttributeNode).value!.content) {
      return false
    }
  } else {
    // directive
    const exp = a.exp!
    const branchExp = (b as DirectiveNode).exp!
    if (exp.type !== branchExp.type) {
      return false
    }
    if (
      exp.type !== NodeTypes.SIMPLE_EXPRESSION ||
      exp.isStatic !== (branchExp as SimpleExpressionNode).isStatic ||
      exp.content !== (branchExp as SimpleExpressionNode).content
    ) {
      return false
    }
  }
  return true
}

/**
 * 获取父条件
 * @param node 
 * @returns 
 */
function getParentCondition(
  node: IfConditionalExpression | CacheExpression
): IfConditionalExpression {
  while (true) {
    // 节点为条件表达式
    if (node.type === NodeTypes.JS_CONDITIONAL_EXPRESSION) {
      // 节点的备用类型为节点条件表达式
      if (node.alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION) {
        node = node.alternate
      } else {
        return node
      }
    } else if (node.type === NodeTypes.JS_CACHE_EXPRESSION) {
      // JS缓存表达式
      node = node.value as IfConditionalExpression
    }
  }
}
