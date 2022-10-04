import {
  ElementNode,
  ObjectExpression,
  createObjectExpression,
  NodeTypes,
  createObjectProperty,
  createSimpleExpression,
  createFunctionExpression,
  DirectiveNode,
  ElementTypes,
  ExpressionNode,
  Property,
  TemplateChildNode,
  SourceLocation,
  createConditionalExpression,
  ConditionalExpression,
  SimpleExpressionNode,
  FunctionExpression,
  CallExpression,
  createCallExpression,
  createArrayExpression,
  SlotsExpression
} from '../ast'
import { TransformContext, NodeTransform } from '../transform'
import { createCompilerError, ErrorCodes } from '../errors'
import {
  findDir,
  isTemplateNode,
  assert,
  isVSlot,
  hasScopeRef,
  isStaticExp
} from '../utils'
import { CREATE_SLOTS, RENDER_LIST, WITH_CTX } from '../runtimeHelpers'
import { parseForExpression, createForLoopParams } from './vFor'
import { SlotFlags, slotFlagsText } from '@vue/shared'

/**
 * 默认回退结果
 */
const defaultFallback = createSimpleExpression(`undefined`, false)

// A NodeTransform that:
// 1. Tracks scope identifiers for scoped slots so that they don't get prefixed
//    by transformExpression. This is only applied in non-browser builds with
//    { prefixIdentifiers: true }.
// 2. Track v-slot depths so that we know a slot is inside another slot.
//    Note the exit callback is executed before buildSlots() on the same node,
//    so only nested slots see positive numbers.
/**
 * 一个节点转化:
 * 1. 跟踪作用域标识符用于作用插槽，以便他们不被转化表达式添加前缀
 * 这仅仅被应用于非浏览器构建中，且启用了{ prefixIdentifiers: true }
 * 2. 跟踪v-slot深度，因此我们了解到slot在另一个slot内部
 * 注意，退出回调在同一节点上的buildSlots()之前执行，
 * 因此只有嵌套槽才能看到正数。
 * @param node 
 * @param context 
 * @returns 
 */
export const trackSlotScopes: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ELEMENT &&
    (node.tagType === ElementTypes.COMPONENT ||
      node.tagType === ElementTypes.TEMPLATE)
  ) {
    // We are only checking non-empty v-slot here
    // since we only care about slots that introduce scope variables.
    // 我们仅仅检查非空v-slot
    // 因为我们仅仅关心引入作用域变量的插槽
    const vSlot = findDir(node, 'slot')
    if (vSlot) {
      const slotProps = vSlot.exp
      if (!__BROWSER__ && context.prefixIdentifiers) {
        slotProps && context.addIdentifiers(slotProps)
      }
      context.scopes.vSlot++
      return () => {
        if (!__BROWSER__ && context.prefixIdentifiers) {
          slotProps && context.removeIdentifiers(slotProps)
        }
        context.scopes.vSlot--
      }
    }
  }
}

// A NodeTransform that tracks scope identifiers for scoped slots with v-for.
// This transform is only applied in non-browser builds with { prefixIdentifiers: true }
/**
 * 跟踪v-for插槽作用域
 * 使用v-for跟踪作用域槽的作用域标识符的NodeTransform。
 * 这个转换只适用于非浏览器版本中{prefixIdentifiers: true}
 * @param node 
 * @param context 
 * @returns 
 */
export const trackVForSlotScopes: NodeTransform = (node, context) => {
  let vFor
  // node是<template>且含有v-slot且存在指令v-for
  if (
    isTemplateNode(node) &&
    node.props.some(isVSlot) &&
    (vFor = findDir(node, 'for'))
  ) {
    // 获取v-for解析结果
    const result = (vFor.parseResult = parseForExpression(
      vFor.exp as SimpleExpressionNode,
      context
    ))
    if (result) {
      // 添加标识符
      const { value, key, index } = result
      const { addIdentifiers, removeIdentifiers } = context
      value && addIdentifiers(value)
      key && addIdentifiers(key)
      index && addIdentifiers(index)

      // 离开该节点时，删除标识符
      return () => {
        value && removeIdentifiers(value)
        key && removeIdentifiers(key)
        index && removeIdentifiers(index)
      }
    }
  }
}

/**
 * 插槽方法构建
 */
export type SlotFnBuilder = (
  slotProps: ExpressionNode | undefined,
  slotChildren: TemplateChildNode[],
  loc: SourceLocation
) => FunctionExpression

/**
 * 构建客户端插槽方法
 * @param props 
 * @param children 
 * @param loc 
 * @returns 
 */
const buildClientSlotFn: SlotFnBuilder = (props, children, loc) =>
  createFunctionExpression(
    props,
    children,
    false /* newline */,
    true /* isSlot */,
    children.length ? children[0].loc : loc
  )

// Instead of being a DirectiveTransform, v-slot processing is called during
// transformElement to build the slots object for a component.
/**
 * 构建插槽
 * 与DirectiveTransform不同，
 * v-slot处理在过程中被transformElement调用
 * 来为组件构建slots对象
 * @param node 
 * @param context 
 * @param buildSlotFn 
 * @returns 
 */
export function buildSlots(
  node: ElementNode,
  context: TransformContext,
  buildSlotFn: SlotFnBuilder = buildClientSlotFn
): {
  slots: SlotsExpression
  hasDynamicSlots: boolean
} {
  context.helper(WITH_CTX)

  const { children, loc } = node
  const slotsProperties: Property[] = []
  const dynamicSlots: (ConditionalExpression | CallExpression)[] = []

  // If the slot is inside a v-for or another v-slot, force it to be dynamic
  // since it likely uses a scope variable.
  // 如果插槽在一个v-for或者另一个v-slot内部，强制让其成为动态的
  let hasDynamicSlots = context.scopes.vSlot > 0 || context.scopes.vFor > 0
  // with `prefixIdentifiers: true`, this can be further optimized to make
  // it dynamic only when the slot actually uses the scope variables.
  // 前缀标识符设置为true，
  // 这可能会被进一步优化仅仅当插槽真的使用作用域变量时才使它动态
  if (!__BROWSER__ && !context.ssr && context.prefixIdentifiers) {
    hasDynamicSlots = hasScopeRef(node, context.identifiers)
  }

  // 1. Check for slot with slotProps on component itself.
  //    <Comp v-slot="{ prop }"/>
  // 1.  在组件本身上使用slotProps检查slot。
  const onComponentSlot = findDir(node, 'slot', true)
  if (onComponentSlot) {
    const { arg, exp } = onComponentSlot
    if (arg && !isStaticExp(arg)) {
      hasDynamicSlots = true
    }
    slotsProperties.push(
      createObjectProperty(
        arg || createSimpleExpression('default', true),
        buildSlotFn(exp, children, loc)
      )
    )
  }

  // 2. Iterate through children and check for template slots
  //    <template v-slot:foo="{ prop }">
  // 遍历子节点并检查模板槽
  let hasTemplateSlots = false
  let hasNamedDefaultSlot = false
  const implicitDefaultChildren: TemplateChildNode[] = []
  const seenSlotNames = new Set<string>()

  for (let i = 0; i < children.length; i++) {
    const slotElement = children[i]
    let slotDir

    if (
      !isTemplateNode(slotElement) ||
      !(slotDir = findDir(slotElement, 'slot', true))
    ) {
      // not a <template v-slot>, skip.
      // 不是一个<template v-slot> 跳过
      if (slotElement.type !== NodeTypes.COMMENT) {
        implicitDefaultChildren.push(slotElement)
      }
      continue
    }

    if (onComponentSlot) {
      // already has on-component slot - this is incorrect usage.
      // 已经有组件插槽-这是不正确的用法。
      context.onError(
        createCompilerError(ErrorCodes.X_V_SLOT_MIXED_SLOT_USAGE, slotDir.loc)
      )
      break
    }

    hasTemplateSlots = true
    const { children: slotChildren, loc: slotLoc } = slotElement
    const {
      arg: slotName = createSimpleExpression(`default`, true),
      exp: slotProps,
      loc: dirLoc
    } = slotDir

    // check if name is dynamic.
    // 检查name是否为动态。
    let staticSlotName: string | undefined
    if (isStaticExp(slotName)) {
      staticSlotName = slotName ? slotName.content : `default`
    } else {
      hasDynamicSlots = true
    }

    const slotFunction = buildSlotFn(slotProps, slotChildren, slotLoc)
    // check if this slot is conditional (v-if/v-for)
    // 检查这个槽位是否有条件(v-if/v-for)
    let vIf: DirectiveNode | undefined
    let vElse: DirectiveNode | undefined
    let vFor: DirectiveNode | undefined
    if ((vIf = findDir(slotElement, 'if'))) {
      hasDynamicSlots = true
      dynamicSlots.push(
        createConditionalExpression(
          vIf.exp!,
          buildDynamicSlot(slotName, slotFunction),
          defaultFallback
        )
      )
    } else if (
      (vElse = findDir(slotElement, /^else(-if)?$/, true /* allowEmpty */))
    ) {
      // find adjacent v-if
      // 找到相邻的v-if
      let j = i
      let prev
      while (j--) {
        prev = children[j]
        if (prev.type !== NodeTypes.COMMENT) {
          break
        }
      }
      if (prev && isTemplateNode(prev) && findDir(prev, 'if')) {
        // remove node
        // 移除节点
        children.splice(i, 1)
        i--
        __TEST__ && assert(dynamicSlots.length > 0)
        // attach this slot to previous conditional
        // 将此槽附加到之前的条件
        let conditional = dynamicSlots[
          dynamicSlots.length - 1
        ] as ConditionalExpression
        while (
          conditional.alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION
        ) {
          // 如果条件表达式有备用，则获取其备用
          conditional = conditional.alternate
        }
        // 设置备用
        // 1. 条件表达式；2. 动态插槽
        conditional.alternate = vElse.exp
          ? createConditionalExpression(
              vElse.exp,
              buildDynamicSlot(slotName, slotFunction),
              defaultFallback
            )
          : buildDynamicSlot(slotName, slotFunction)
      } else {
        context.onError(
          createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, vElse.loc)
        )
      }
    } else if ((vFor = findDir(slotElement, 'for'))) {
      hasDynamicSlots = true
      const parseResult =
        vFor.parseResult ||
        parseForExpression(vFor.exp as SimpleExpressionNode, context)
      if (parseResult) {
        // Render the dynamic slots as an array and add it to the createSlot()
        // args. The runtime knows how to handle it appropriately.
        // 将动态槽呈现为一个数组，并将其添加到createSlot()参数中
        // 运行时知道如何适当地处理它。
        dynamicSlots.push(
          createCallExpression(context.helper(RENDER_LIST), [
            parseResult.source,
            createFunctionExpression(
              createForLoopParams(parseResult),
              buildDynamicSlot(slotName, slotFunction),
              true /* force newline */
            )
          ])
        )
      } else {
        context.onError(
          createCompilerError(ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION, vFor.loc)
        )
      }
    } else {
      // check duplicate static names
      // 检查重复的静态名称
      if (staticSlotName) {
        if (seenSlotNames.has(staticSlotName)) {
          context.onError(
            createCompilerError(
              ErrorCodes.X_V_SLOT_DUPLICATE_SLOT_NAMES,
              dirLoc
            )
          )
          continue
        }
        seenSlotNames.add(staticSlotName)
        if (staticSlotName === 'default') {
          hasNamedDefaultSlot = true
        }
      }
      slotsProperties.push(createObjectProperty(slotName, slotFunction))
    }
  }

  if (!onComponentSlot) {
    const buildDefaultSlotProperty = (
      props: ExpressionNode | undefined,
      children: TemplateChildNode[]
    ) => {
      const fn = buildSlotFn(props, children, loc)
      if (__COMPAT__ && context.compatConfig) {
        fn.isNonScopedSlot = true
      }
      return createObjectProperty(`default`, fn)
    }

    if (!hasTemplateSlots) {
      // implicit default slot (on component)
      // 在组件上隐式默认插槽
      slotsProperties.push(buildDefaultSlotProperty(undefined, children))
    } else if (
      implicitDefaultChildren.length &&
      // #3766
      // with whitespace: 'preserve', whitespaces between slots will end up in
      // implicitDefaultChildren. Ignore if all implicit children are whitespaces.
      // 使用空格:'preserve'，
      // 插槽之间的空格将以隐式defaultchildren结束
      // 如果所有隐式子空间都是空白，则忽略
      implicitDefaultChildren.some(node => isNonWhitespaceContent(node))
    ) {
      // implicit default slot (mixed with named slots)
      // 隐式默认槽(与命名槽混合)
      if (hasNamedDefaultSlot) {
        context.onError(
          createCompilerError(
            ErrorCodes.X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN,
            implicitDefaultChildren[0].loc
          )
        )
      } else {
        slotsProperties.push(
          buildDefaultSlotProperty(undefined, implicitDefaultChildren)
        )
      }
    }
  }

  /**
   * 插槽标记
   */
  const slotFlag = hasDynamicSlots
    ? SlotFlags.DYNAMIC
    : hasForwardedSlots(node.children)
    ? SlotFlags.FORWARDED
    : SlotFlags.STABLE

  let slots = createObjectExpression(
    slotsProperties.concat(
      createObjectProperty(
        `_`,
        // 2 = compiled but dynamic = can skip normalization, but must run diff
        // 1 = compiled and static = can skip normalization AND diff as optimized
        createSimpleExpression(
          slotFlag + (__DEV__ ? ` /* ${slotFlagsText[slotFlag]} */` : ``),
          false
        )
      )
    ),
    loc
  ) as SlotsExpression
  
  if (dynamicSlots.length) {
    slots = createCallExpression(context.helper(CREATE_SLOTS), [
      slots,
      createArrayExpression(dynamicSlots)
    ]) as SlotsExpression
  }

  return {
    slots,
    hasDynamicSlots
  }
}

/**
 * 构建动态插槽
 * @param name 
 * @param fn 
 * @returns 
 */
function buildDynamicSlot(
  name: ExpressionNode,
  fn: FunctionExpression
): ObjectExpression {
  return createObjectExpression([
    createObjectProperty(`name`, name),
    createObjectProperty(`fn`, fn)
  ])
}

/**
 * 子节点中存在已转移的插槽
 * @param children 
 * @returns 
 */
function hasForwardedSlots(children: TemplateChildNode[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    switch (child.type) {
      case NodeTypes.ELEMENT:
        if (
          child.tagType === ElementTypes.SLOT ||
          hasForwardedSlots(child.children)
        ) {
          return true
        }
        break
      case NodeTypes.IF:
        if (hasForwardedSlots(child.branches)) return true
        break
      case NodeTypes.IF_BRANCH:
      case NodeTypes.FOR:
        if (hasForwardedSlots(child.children)) return true
        break
      default:
        break
    }
  }
  return false
}

/**
 * 不是空格内容
 * @param node 
 * @returns 
 */
function isNonWhitespaceContent(node: TemplateChildNode): boolean {
  // 节点不是文本，节点不是文本回调
  if (node.type !== NodeTypes.TEXT && node.type !== NodeTypes.TEXT_CALL)
    return true
    // 节点为文本且内容为空，或者节点是TEXT_CALL（递归调用）
  return node.type === NodeTypes.TEXT
    ? !!node.content.trim()
    : isNonWhitespaceContent(node.content)
}
