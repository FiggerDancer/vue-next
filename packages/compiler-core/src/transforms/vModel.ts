import { DirectiveTransform } from '../transform'
import {
  createSimpleExpression,
  createObjectProperty,
  createCompoundExpression,
  NodeTypes,
  Property,
  ElementTypes,
  ExpressionNode,
  ConstantTypes
} from '../ast'
import { createCompilerError, ErrorCodes } from '../errors'
import {
  isMemberExpression,
  isSimpleIdentifier,
  hasScopeRef,
  isStaticExp
} from '../utils'
import { IS_REF } from '../runtimeHelpers'
import { BindingTypes } from '../options'

/**
 * v-model
 * @param dir 
 * @param node 
 * @param context 
 * @returns 
 */
export const transformModel: DirectiveTransform = (dir, node, context) => {
  const { exp, arg } = dir
  if (!exp) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_MODEL_NO_EXPRESSION, dir.loc)
    )
    return createTransformProps()
  }

  // 原始表达式
  const rawExp = exp.loc.source
  // 表达式字符串
  const expString =
    exp.type === NodeTypes.SIMPLE_EXPRESSION ? exp.content : rawExp

  // im SFC <script setup> inline mode, the exp may have been transformed into
  // _unref(exp)
  // im SFC <script setup>内联模式，表达式可以被转化为_unref(exp)
  const bindingType = context.bindingMetadata[rawExp]
  // 可能是ref
  const maybeRef =
    !__BROWSER__ &&
    context.inline &&
    bindingType &&
    bindingType !== BindingTypes.SETUP_CONST

  // 表达式字符串不为空或者不是成员表达式且不是ref
  if (
    !expString.trim() ||
    (!isMemberExpression(expString, context) && !maybeRef)
  ) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_MODEL_MALFORMED_EXPRESSION, exp.loc)
    )
    return createTransformProps()
  }

  // 非浏览器
  // 且上下文前缀标识符
  // 且是简单标识符
  // 且上下文标识符
  if (
    !__BROWSER__ &&
    context.prefixIdentifiers &&
    isSimpleIdentifier(expString) &&
    context.identifiers[expString]
  ) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_MODEL_ON_SCOPE_VARIABLE, exp.loc)
    )
    return createTransformProps()
  }

  // 属性的名称 v-model:arg="rawExp"
  const propName = arg ? arg : createSimpleExpression('modelValue', true)
  // 事件名称
  const eventName = arg
    ? isStaticExp(arg)
      ? `onUpdate:${arg.content}`
      : createCompoundExpression(['"onUpdate:" + ', arg])
    : `onUpdate:modelValue`

  // 赋值表达式
  let assignmentExp: ExpressionNode
  // 参数
  const eventArg = context.isTS ? `($event: any)` : `$event`
  // 如果是ref
  if (maybeRef) {
    // 明确是ref
    if (bindingType === BindingTypes.SETUP_REF) {
      // v-model used on known ref.
      // v-model被用在已知的ref上
      // ($event) => ((rawExp).value = $event)
      assignmentExp = createCompoundExpression([
        `${eventArg} => ((`,
        createSimpleExpression(rawExp, false, exp.loc),
        `).value = $event)`
      ])
    } else {
      // v-model used on a potentially ref binding in <script setup> inline mode.
      // the assignment needs to check whether the binding is actually a ref.
      // v-model在<script setup>内联模式中被用在一个潜在的ref绑定
      // 赋值的需要检查绑定是否是一个ref
      // 不明确是ref，判定下
      // 是跟上面那个一样，不是
      // 1. let  $event => rawExp = $event
      // 2. 其他情况 $event => null
      const altAssignment =
        bindingType === BindingTypes.SETUP_LET ? `${rawExp} = $event` : `null`
      assignmentExp = createCompoundExpression([
        `${eventArg} => (${context.helperString(IS_REF)}(${rawExp}) ? (`,
        createSimpleExpression(rawExp, false, exp.loc),
        `).value = $event : ${altAssignment})`
      ])
    }
  } else {
    // 肯定不是ref
    // $events => ((exp) = $events)
    assignmentExp = createCompoundExpression([
      `${eventArg} => ((`,
      exp,
      `) = $event)`
    ])
  }

  const props = [
    // modelValue: foo
    createObjectProperty(propName, dir.exp!),
    // "onUpdate:modelValue": $event => (foo = $event)
    createObjectProperty(eventName, assignmentExp)
  ]

  // cache v-model handler if applicable (when it doesn't refer any scope vars)
  // 如果适用，缓存v-model处理程序(当它不引用任何作用域变量时)
  if (
    !__BROWSER__ &&
    context.prefixIdentifiers &&
    !context.inVOnce &&
    context.cacheHandlers &&
    !hasScopeRef(exp, context.identifiers)
  ) {
    props[1].value = context.cache(props[1].value)
  }

  // modelModifiers: { foo: true, "bar-baz": true }
  if (dir.modifiers.length && node.tagType === ElementTypes.COMPONENT) {
    const modifiers = dir.modifiers
      .map(m => (isSimpleIdentifier(m) ? m : JSON.stringify(m)) + `: true`)
      .join(`, `)
    const modifiersKey = arg
      ? isStaticExp(arg)
        ? `${arg.content}Modifiers`
        : createCompoundExpression([arg, ' + "Modifiers"'])
      : `modelModifiers`
    props.push(
      createObjectProperty(
        modifiersKey,
        createSimpleExpression(
          `{ ${modifiers} }`,
          false,
          dir.loc,
          ConstantTypes.CAN_HOIST
        )
      )
    )
  }

  return createTransformProps(props)
}

/**
 * 创建转化的Props
 * @param props 
 * @returns 
 */
function createTransformProps(props: Property[] = []) {
  return { props }
}
