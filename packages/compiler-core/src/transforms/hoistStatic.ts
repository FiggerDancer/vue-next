import {
  ConstantTypes,
  RootNode,
  NodeTypes,
  TemplateChildNode,
  SimpleExpressionNode,
  ElementTypes,
  PlainElementNode,
  ComponentNode,
  TemplateNode,
  VNodeCall,
  ParentNode,
  JSChildNode,
  CallExpression,
  createArrayExpression
} from '../ast'
import { TransformContext } from '../transform'
import { PatchFlags, isString, isSymbol, isArray } from '@vue/shared'
import { getVNodeBlockHelper, getVNodeHelper, isSlotOutlet } from '../utils'
import {
  OPEN_BLOCK,
  GUARD_REACTIVE_PROPS,
  NORMALIZE_CLASS,
  NORMALIZE_PROPS,
  NORMALIZE_STYLE
} from '../runtimeHelpers'

// 这一块代码主要讲的就是静态提升，通过静态提升Vue提高了性能
// 读这块代码对以后如果使用vue3也是有帮助的

// 注：SVG中的<foreignObject>元素允许包含来自不同的 XML 命名空间的元素。

/**
 * 提升静态节点
 * @param root 
 * @param context 
 */
export function hoistStatic(root: RootNode, context: TransformContext) {
  walk(
    root,
    context,
    // Root node is unfortunately non-hoistable due to potential parent
    // fallthrough attributes.
    // 不幸的是，由于潜在的父节点fallthrough属性，根节点不能挂起
    isSingleElementRoot(root, root.children[0])
  )
}

/**
 * 是元素的单独根组件
 * @param root 
 * @param child 
 * @returns 
 */
export function isSingleElementRoot(
  root: RootNode,
  child: TemplateChildNode
): child is PlainElementNode | ComponentNode | TemplateNode {
  const { children } = root
  // 只还有一个根节点且该节点是元素类型且不是插槽的出口
  return (
    children.length === 1 &&
    child.type === NodeTypes.ELEMENT &&
    !isSlotOutlet(child)
  )
}

/**
 * 遍历节点
 * @param node 
 * @param context 
 * @param doNotHoistNode 
 */
function walk(
  node: ParentNode,
  context: TransformContext,
  doNotHoistNode: boolean = false
) {
  // 获取节点所有子节点
  const { children } = node
  // 获取子节点长度
  const originalCount = children.length
  // 挂起节点的数量
  let hoistedCount = 0

  // 遍历子节点，
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    // only plain elements & text calls are eligible for hoisting.
    // 只有纯元素和文本调用才有资格挂起，也就是说组件是不能挂起的
    if (
      child.type === NodeTypes.ELEMENT &&
      child.tagType === ElementTypes.ELEMENT
    ) {
      // 常量类型
      const constantType = doNotHoistNode
        ? ConstantTypes.NOT_CONSTANT
        : getConstantType(child, context)
      // 是常量
      if (constantType > ConstantTypes.NOT_CONSTANT) {
        // 该类型可以挂起
        if (constantType >= ConstantTypes.CAN_HOIST) {
          // 增加挂起更新标记
          ;(child.codegenNode as VNodeCall).patchFlag =
            PatchFlags.HOISTED + (__DEV__ ? ` /* HOISTED */` : ``)
          child.codegenNode = context.hoist(child.codegenNode!)
          // 挂起节点数量增加
          hoistedCount++
          continue
        }
      } else {
        // node may contain dynamic children, but its props may be eligible for
        // hoisting.
        // 节点可以包含动态子节点，但它的属性可能是符合挂起条件的
        const codegenNode = child.codegenNode!
        // 代码类型是节点生成
        if (codegenNode.type === NodeTypes.VNODE_CALL) {
          // 获取patch标记
          const flag = getPatchFlag(codegenNode)
          // 无标记
          // 有标记但是标记是需要更新
          // 标记是更新文本
          // 且该节点是可以挂起的节点
          if (
            (!flag ||
              flag === PatchFlags.NEED_PATCH ||
              flag === PatchFlags.TEXT) &&
            getGeneratedPropsConstantType(child, context) >=
              ConstantTypes.CAN_HOIST
          ) {
            // 获取节点props
            const props = getNodeProps(child)
            if (props) {
              // 节点props
              codegenNode.props = context.hoist(props)
            }
          }
          // 动态props
          if (codegenNode.dynamicProps) {
            codegenNode.dynamicProps = context.hoist(codegenNode.dynamicProps)
          }
        }
      }
    } else if (
      child.type === NodeTypes.TEXT_CALL &&
      getConstantType(child.content, context) >= ConstantTypes.CAN_HOIST
    ) {
      // 文本
      child.codegenNode = context.hoist(child.codegenNode)
      hoistedCount++
    }

    // walk further
    // 进一步遍历
    if (child.type === NodeTypes.ELEMENT) {
      // 是组件
      const isComponent = child.tagType === ElementTypes.COMPONENT
      if (isComponent) {
        // v-slot
        context.scopes.vSlot++
      }
      walk(child, context)
      // 遍历子节点
      if (isComponent) {
        // v-slot
        context.scopes.vSlot--
      }
    } else if (child.type === NodeTypes.FOR) {
      // Do not hoist v-for single child because it has to be a block
      // 不能挂起v-for单个子节点，因为它必须是一个块
      walk(child, context, child.children.length === 1)
    } else if (child.type === NodeTypes.IF) {
      // if
      for (let i = 0; i < child.branches.length; i++) {
        // Do not hoist v-if single child because it has to be a block
        // 不能挂起v-if单个节点因为它必须是一个块（也就是v-if只有一个分支是不能挂起的）
        walk(
          child.branches[i],
          context,
          child.branches[i].children.length === 1
        )
      }
    }
  }

  // 被挂起的数量且上下文转化挂起函数存在
  if (hoistedCount && context.transformHoist) {
    context.transformHoist(children, context, node)
  }

  // all children were hoisted - the entire children array is hoistable.
  // 所有的子节点被挂起，整个子节点数组是挂起的
  if (
    hoistedCount &&
    hoistedCount === originalCount &&
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.ELEMENT &&
    node.codegenNode &&
    node.codegenNode.type === NodeTypes.VNODE_CALL &&
    isArray(node.codegenNode.children)
  ) {
    node.codegenNode.children = context.hoist(
      createArrayExpression(node.codegenNode.children)
    )
  }
}

/**
 * 获取常量类型
 * @param node 
 * @param context 
 * @returns 
 */
export function getConstantType(
  node: TemplateChildNode | SimpleExpressionNode,
  context: TransformContext
): ConstantTypes {
  // 常量缓存
  const { constantCache } = context
  switch (node.type) {
    // 元素
    case NodeTypes.ELEMENT:
      // 标签类型不是元素，不是常量
      if (node.tagType !== ElementTypes.ELEMENT) {
        return ConstantTypes.NOT_CONSTANT
      }
      // 优先从缓存中获取
      const cached = constantCache.get(node)
      if (cached !== undefined) {
        return cached
      }
      const codegenNode = node.codegenNode!
      // 不是VNODE_CALL 不是常量
      if (codegenNode.type !== NodeTypes.VNODE_CALL) {
        return ConstantTypes.NOT_CONSTANT
      }
      // 是Block但不是svg和foreignObject则不是常量
      if (
        codegenNode.isBlock &&
        node.tag !== 'svg' &&
        node.tag !== 'foreignObject'
      ) {
        return ConstantTypes.NOT_CONSTANT
      }
      // 获取更新标记
      const flag = getPatchFlag(codegenNode)
      // 无更新标记
      if (!flag) {
        // 可以字符串化的常量
        let returnType = ConstantTypes.CAN_STRINGIFY

        // Element itself has no patch flag. However we still need to check:

        // 1. Even for a node with no patch flag, it is possible for it to contain
        // non-hoistable expressions that refers to scope variables, e.g. compiler
        // injected keys or cached event handlers. Therefore we need to always
        // check the codegenNode's props to be sure.
        // 元素本身没有更新标记，但是我们依然需要检查
        // 1. 即使一个节点没有更新标记，对它而言可能包含不可提升的表达式由于这些表达式引用了作用域变量
        // 例如 编译器注入的key或者缓存的事件处理器
        // 因此我们需要总是检查代码生成节点的props来保证它是可以被静态提升的
        // 被生成的属性类型
        const generatedPropsType = getGeneratedPropsConstantType(node, context)
        // 如果生成的属性类型不是常量，那就意味该节点也不是一个常量，不可以被静态提升
        if (generatedPropsType === ConstantTypes.NOT_CONSTANT) {
          constantCache.set(node, ConstantTypes.NOT_CONSTANT)
          return ConstantTypes.NOT_CONSTANT
        }
        // 被生成属性类型，虽然是常量，但是它的可挂起的级别不是字符串级别，需要修改其常量类型
        if (generatedPropsType < returnType) {
          returnType = generatedPropsType
        }

        // 2. its children.
        // 2. 它的子节点，递归的判断子节点，只要有一个子节点不是常量，也就意味着这个节点不可以是常量
        for (let i = 0; i < node.children.length; i++) {
          const childType = getConstantType(node.children[i], context)
          if (childType === ConstantTypes.NOT_CONSTANT) {
            constantCache.set(node, ConstantTypes.NOT_CONSTANT)
            return ConstantTypes.NOT_CONSTANT
          }
          if (childType < returnType) {
            returnType = childType
          }
        }

        // 3. if the type is not already CAN_SKIP_PATCH which is the lowest non-0
        // type, check if any of the props can cause the type to be lowered
        // we can skip can_patch because it's guaranteed by the absence of a
        // patchFlag.
        // 3. 如果类型不是CAN_SKIP_PATCH这是最低层级的可提升静态标记
        // 检查是否有任何的props可能引起类型变得更低层级
        // 我们可以跳过更新标记，因为它没有更新标记已经确定了它就是不需要更新的
        if (returnType > ConstantTypes.CAN_SKIP_PATCH) {
          for (let i = 0; i < node.props.length; i++) {
            const p = node.props[i]
            if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && p.exp) {
              // props中存在表达式，表达式不可以常量化，则意味着不可以静态提升
              const expType = getConstantType(p.exp, context)
              if (expType === ConstantTypes.NOT_CONSTANT) {
                constantCache.set(node, ConstantTypes.NOT_CONSTANT)
                return ConstantTypes.NOT_CONSTANT
              }
              if (expType < returnType) {
                returnType = expType
              }
            }
          }
        }

        // only svg/foreignObject could be block here, however if they are
        // static then they don't need to be blocks since there will be no
        // nested updates.
        // 仅仅svg或者foreignObject可能是块，但是如果他们是静态的，则他们不需要变成块
        // 因为这里不会发生嵌套更新
        // 下面是对块的svg进行修改，解除他们的块结构
        if (codegenNode.isBlock) {
          context.removeHelper(OPEN_BLOCK)
          context.removeHelper(
            getVNodeBlockHelper(context.inSSR, codegenNode.isComponent)
          )
          codegenNode.isBlock = false
          context.helper(getVNodeHelper(context.inSSR, codegenNode.isComponent))
        }

        constantCache.set(node, returnType)
        return returnType
      } else {
        // 有更新标记，那肯定就不能用常量了
        constantCache.set(node, ConstantTypes.NOT_CONSTANT)
        return ConstantTypes.NOT_CONSTANT
      }
      // 字符串和注释都是用可字符串化
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
      return ConstantTypes.CAN_STRINGIFY
      // if、for、if_branch肯定不是常量
    case NodeTypes.IF:
    case NodeTypes.FOR:
    case NodeTypes.IF_BRANCH:
      return ConstantTypes.NOT_CONSTANT
      // 内插值，这个要看插入的内容
    case NodeTypes.INTERPOLATION:
    case NodeTypes.TEXT_CALL:
      return getConstantType(node.content, context)
      // 简单表达式
    case NodeTypes.SIMPLE_EXPRESSION:
      return node.constType
      // 复杂表达式，看子节点
    case NodeTypes.COMPOUND_EXPRESSION:
      let returnType = ConstantTypes.CAN_STRINGIFY
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        if (isString(child) || isSymbol(child)) {
          continue
        }
        const childType = getConstantType(child, context)
        if (childType === ConstantTypes.NOT_CONSTANT) {
          return ConstantTypes.NOT_CONSTANT
        } else if (childType < returnType) {
          returnType = childType
        }
      }
      return returnType
      // 其他的情况都是非常量，不做静态提升
    default:
      if (__DEV__) {
        const exhaustiveCheck: never = node
        exhaustiveCheck
      }
      return ConstantTypes.NOT_CONSTANT
  }
}

/**
 * 允许挂起的帮助集合，
 * 序列化类名
 * 序列化样式
 * 序列化props
 * 守卫响应props
 */
const allowHoistedHelperSet = new Set([
  NORMALIZE_CLASS,
  NORMALIZE_STYLE,
  NORMALIZE_PROPS,
  GUARD_REACTIVE_PROPS
])

/**
 * 获取帮助函数调用的常量类型
 * 只有几种有限的帮助函数支持静态提升
 * 然后这些帮助函数还是要看它的参数是否能做静态提升
 * @param value 
 * @param context 
 * @returns 
 */
function getConstantTypeOfHelperCall(
  value: CallExpression,
  context: TransformContext
): ConstantTypes {
  // js调用表达式
  if (
    value.type === NodeTypes.JS_CALL_EXPRESSION &&
    !isString(value.callee) &&
    allowHoistedHelperSet.has(value.callee)
  ) {
    const arg = value.arguments[0] as JSChildNode
    // 参数是简单表达式
    if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
      return getConstantType(arg, context)
    } else if (arg.type === NodeTypes.JS_CALL_EXPRESSION) {
      // in the case of nested helper call, e.g. `normalizeProps(guardReactiveProps(exp))`
      // 某些情况下嵌套函数调用，例如：normalizeProps, guardReactiveProps(exp)
      return getConstantTypeOfHelperCall(arg, context)
    }
  }
  return ConstantTypes.NOT_CONSTANT
}

/**
 * 获取被生成的props常量类型
 * @param node 
 * @param context 
 * @returns 
 */
function getGeneratedPropsConstantType(
  node: PlainElementNode,
  context: TransformContext
): ConstantTypes {
  let returnType = ConstantTypes.CAN_STRINGIFY
  const props = getNodeProps(node)
  if (props && props.type === NodeTypes.JS_OBJECT_EXPRESSION) {
    const { properties } = props
    for (let i = 0; i < properties.length; i++) {
      const { key, value } = properties[i]
      const keyType = getConstantType(key, context)
      if (keyType === ConstantTypes.NOT_CONSTANT) {
        return keyType
      }
      if (keyType < returnType) {
        returnType = keyType
      }
      let valueType: ConstantTypes
      if (value.type === NodeTypes.SIMPLE_EXPRESSION) {
        valueType = getConstantType(value, context)
      } else if (value.type === NodeTypes.JS_CALL_EXPRESSION) {
        // some helper calls can be hoisted,
        // such as the `normalizeProps` generated by the compiler for pre-normalize class,
        // in this case we need to respect the ConstantType of the helper's arguments
        // 一些帮助函数调用可能是可以提升的
        // 例如normalizeProps被编译器预类名生成
        // 某些情况我们需要重视助手函数的参数常量类名
        valueType = getConstantTypeOfHelperCall(value, context)
      } else {
        valueType = ConstantTypes.NOT_CONSTANT
      }
      if (valueType === ConstantTypes.NOT_CONSTANT) {
        return valueType
      }
      if (valueType < returnType) {
        returnType = valueType
      }
    }
  }
  return returnType
}

/**
 * 获取节点属性
 * @param node 
 * @returns 
 */
function getNodeProps(node: PlainElementNode) {
  const codegenNode = node.codegenNode!
  if (codegenNode.type === NodeTypes.VNODE_CALL) {
    return codegenNode.props
  }
}

/**
 * 获取更新标记
 * @param node 
 * @returns 
 */
function getPatchFlag(node: VNodeCall): number | undefined {
  const flag = node.patchFlag
  return flag ? parseInt(flag, 10) : undefined
}
