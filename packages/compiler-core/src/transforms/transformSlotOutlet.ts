import { NodeTransform, TransformContext } from '../transform'
import {
  NodeTypes,
  CallExpression,
  createCallExpression,
  ExpressionNode,
  SlotOutletNode,
  createFunctionExpression
} from '../ast'
import { isSlotOutlet, isStaticArgOf, isStaticExp } from '../utils'
import { buildProps, PropsExpression } from './transformElement'
import { createCompilerError, ErrorCodes } from '../errors'
import { RENDER_SLOT } from '../runtimeHelpers'
import { camelize } from '@vue/shared/'

/**
 * 转化的slot出口
 * @param node 
 * @param context 
 */
export const transformSlotOutlet: NodeTransform = (node, context) => {
  // 是slot的出口
  if (isSlotOutlet(node)) {
    const { children, loc } = node
    // 处理插槽出口
    const { slotName, slotProps } = processSlotOutlet(node, context)

    // 插槽参数
    const slotArgs: CallExpression['arguments'] = [
      context.prefixIdentifiers ? `_ctx.$slots` : `$slots`,
      slotName,
      '{}',
      'undefined',
      'true'
    ]
    // 被期待的行数
    let expectedLen = 2

    // 插槽props
    if (slotProps) {
      slotArgs[2] = slotProps
      expectedLen = 3
    }

    // 子节点长度
    if (children.length) {
      // 插槽参数 创建函数表达式
      slotArgs[3] = createFunctionExpression([], children, false, false, loc)
      expectedLen = 4
    }

    // 如果上下文作用域Id与上下文插槽
    if (context.scopeId && !context.slotted) {
      expectedLen = 5
    }
    // 移除插槽中多余的参数
    slotArgs.splice(expectedLen) // remove unused arguments

    // 生成调用表达式  生成插槽
    node.codegenNode = createCallExpression(
      context.helper(RENDER_SLOT),
      slotArgs,
      loc
    )
  }
}

/**
 * 插槽出口处理结果
 * 插槽名称
 * 插槽props
 */
interface SlotOutletProcessResult {
  slotName: string | ExpressionNode
  slotProps: PropsExpression | undefined
}

/**
 * 处理插槽出口
 * @param node 
 * @param context 
 * @returns 
 */
export function processSlotOutlet(
  node: SlotOutletNode,
  context: TransformContext
): SlotOutletProcessResult {
  // 插槽名称
  let slotName: string | ExpressionNode = `"default"`
  // 插槽props
  let slotProps: PropsExpression | undefined = undefined

  // 非插槽名称props
  const nonNameProps = []
  // 遍历属性
  for (let i = 0; i < node.props.length; i++) {
    const p = node.props[i]
    if (p.type === NodeTypes.ATTRIBUTE) {
      if (p.value) {
        // 插槽名称
        if (p.name === 'name') {
          slotName = JSON.stringify(p.value.content)
        } else {
          // 不是插槽名称，则将属性key驼峰化
          p.name = camelize(p.name)
          // 非名称props
          nonNameProps.push(p)
        }
      }
    } else {
      // v-bind 且参数为name   slot v-bind:name=""
      if (p.name === 'bind' && isStaticArgOf(p.arg, 'name')) {
        // 如果p的表达式存在，则插槽名称为表达式
        if (p.exp) slotName = p.exp
      } else {
        // 否则
        if (p.name === 'bind' && p.arg && isStaticExp(p.arg)) {
          p.arg.content = camelize(p.arg.content)
        }
        // 收集非插槽props
        nonNameProps.push(p)
      }
    }
  }

  // 非插槽名称props
  if (nonNameProps.length > 0) {
    const { props, directives } = buildProps(
      node,
      context,
      nonNameProps,
      false,
      false
    )
    slotProps = props

    // 指令长度
    if (directives.length) {
      context.onError(
        createCompilerError(
          ErrorCodes.X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET,
          directives[0].loc
        )
      )
    }
  }

  return {
    slotName,
    slotProps
  }
}
