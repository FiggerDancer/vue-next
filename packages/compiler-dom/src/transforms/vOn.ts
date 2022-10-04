import {
  transformOn as baseTransform,
  DirectiveTransform,
  createObjectProperty,
  createCallExpression,
  createSimpleExpression,
  NodeTypes,
  createCompoundExpression,
  ExpressionNode,
  SimpleExpressionNode,
  isStaticExp,
  CompilerDeprecationTypes,
  TransformContext,
  SourceLocation,
  checkCompatEnabled
} from '@vue/compiler-core'
import { V_ON_WITH_MODIFIERS, V_ON_WITH_KEYS } from '../runtimeHelpers'
import { makeMap, capitalize } from '@vue/shared'

/**
 * 是否是事件选项修饰器
 * passive 可以提升滚动事件的性能
 * once 只监听一次
 * capture 捕获
 */
const isEventOptionModifier = /*#__PURE__*/ makeMap(`passive,once,capture`)
/**
 * 是否是非键盘的修饰符
 */
const isNonKeyModifier = /*#__PURE__*/ makeMap(
  // event propagation management
  // 事件冒泡管理
  `stop,prevent,self,` +
    // system modifiers + exact
    // 系统修饰符+确切
    `ctrl,shift,alt,meta,exact,` +
    // mouse
    // 鼠标
    `middle`
)
// left & right could be mouse or key modifiers based on event type
/**
 * 左和右可以是鼠标也可使按键修饰符基于事件类型
 */
const maybeKeyModifier = /*#__PURE__*/ makeMap('left,right')
/**
 * 是键盘事件
 */
const isKeyboardEvent = /*#__PURE__*/ makeMap(
  `onkeyup,onkeydown,onkeypress`,
  true
)

/**
 * 获取修饰符
 * @param key 
 * @param modifiers 
 * @param context 
 * @param loc 
 * @returns 
 */
const resolveModifiers = (
  key: ExpressionNode,
  modifiers: string[],
  context: TransformContext,
  loc: SourceLocation
) => {
  // Key修饰符
  const keyModifiers = []
  // 无key修饰符
  const nonKeyModifiers = []
  // 事件选项修饰器
  const eventOptionModifiers = []

  // 遍历所有的修饰符
  for (let i = 0; i < modifiers.length; i++) {
    const modifier = modifiers[i]

    if (
      __COMPAT__ &&
      modifier === 'native' &&
      checkCompatEnabled(
        CompilerDeprecationTypes.COMPILER_V_ON_NATIVE,
        context,
        loc
      )
    ) {
      // 兼容vue2，native修饰符
      eventOptionModifiers.push(modifier)
    } else if (isEventOptionModifier(modifier)) {
      // eventOptionModifiers: modifiers for addEventListener() options,
      // e.g. .passive & .capture
      // 事件选项修饰器：修饰器用于addEventListener选项
      // 例如： .passive 和 .capture
      eventOptionModifiers.push(modifier)
    } else {
      // runtimeModifiers: modifiers that needs runtime guards
      // 运行时修饰符：修饰符需要运行时守卫
      // 有可能是键盘的修饰符，比如right和left
      if (maybeKeyModifier(modifier)) {
        // key是静态表达式
        if (isStaticExp(key)) {
          // 是键盘事件
          if (isKeyboardEvent((key as SimpleExpressionNode).content)) {
            keyModifiers.push(modifier)
          } else {
            // 非键盘
            nonKeyModifiers.push(modifier)
          }
        } else {
          // 如果key不是一个固定值，
          // 那该事件需要将修饰符分别放到键盘修饰器中和非键盘修饰器中
          keyModifiers.push(modifier)
          nonKeyModifiers.push(modifier)
        }
      } else {
        // 非键盘修饰器
        if (isNonKeyModifier(modifier)) {
          nonKeyModifiers.push(modifier)
        } else {
          // 键盘修饰器
          keyModifiers.push(modifier)
        }
      }
    }
  }

  // 返回分类好的各种修饰器
  return {
    keyModifiers,
    nonKeyModifiers,
    eventOptionModifiers
  }
}

/**
 * click转化
 * 右键转化成onContextmenu
 * 中键转化成onMouseup
 * @param key 
 * @param event 
 * @returns 
 */
const transformClick = (key: ExpressionNode, event: string) => {
  const isStaticClick =
    isStaticExp(key) && key.content.toLowerCase() === 'onclick'
  return isStaticClick
    ? createSimpleExpression(event, true) // 静态的
    : key.type !== NodeTypes.SIMPLE_EXPRESSION 
    // 动态的，不是简单表达式则需要进一步处理()执行下看结果，如果是
    // onClick在换成事件名称，否则有可能不是onClick事件这个比如变成
    // 键盘事件这时right修饰符完全是另一个东西，不是onContextmenu
    ? createCompoundExpression([
        `(`,
        key,
        `) === "onClick" ? "${event}" : (`,
        key,
        `)`
      ]) 
    : key
}

/**
 * 转化on
 * @param dir 
 * @param node 
 * @param context 
 * @returns 
 */
export const transformOn: DirectiveTransform = (dir, node, context) => {
  // 使用vOn的基本转化
  return baseTransform(dir, node, context, baseResult => {
    // 拿到转化结果
    const { modifiers } = dir
    // 没有修饰符，直接返回本体
    if (!modifiers.length) return baseResult

    // 有的话，从属性中拿key，value
    let { key, value: handlerExp } = baseResult.props[0]
    // 获取该v-on指令的修饰器
    const { keyModifiers, nonKeyModifiers, eventOptionModifiers } =
      resolveModifiers(key, modifiers, context, dir.loc)

    // normalize click.right and click.middle since they don't actually fire
    // 序列化click.right和click.middle
    // 因为它们没有真正的触发
    // 非键盘修饰器包含right
    if (nonKeyModifiers.includes('right')) {
      // 转化上下文菜单触发事件（因为鼠标右键是打开上下文菜单事件）
      // 通过transformClick转化成 onContextmenu
      key = transformClick(key, `onContextmenu`)
    }
    // 非键盘修饰器包含middle
    if (nonKeyModifiers.includes('middle')) {
      // 转化onMouseup事件（因为鼠标中键是onMouseup事件）
      // 通过transformClick事件转化成 onMouseup
      key = transformClick(key, `onMouseup`)
    }

    // 非键盘修饰器的个数
    if (nonKeyModifiers.length) {
      // 创建调用表达式，加入这些非键盘修饰器
      handlerExp = createCallExpression(context.helper(V_ON_WITH_MODIFIERS), [
        handlerExp,
        JSON.stringify(nonKeyModifiers)
      ])
    }

    if (
      keyModifiers.length &&
      // if event name is dynamic, always wrap with keys guard
      // 如果事件名称是动态的，总是使用键盘守卫包裹
      (!isStaticExp(key) || isKeyboardEvent(key.content))
    ) {
      handlerExp = createCallExpression(context.helper(V_ON_WITH_KEYS), [
        handlerExp,
        JSON.stringify(keyModifiers)
      ])
    }

    // 事件选项修饰器
    if (eventOptionModifiers.length) {
      // 修饰器选项首字母大写，并合并起来
      const modifierPostfix = eventOptionModifiers.map(capitalize).join('')
      // key是静态的,创建简单表达式，不是则使用(key)来生成真实值
      key = isStaticExp(key)
        ? createSimpleExpression(`${key.content}${modifierPostfix}`, true)
        : createCompoundExpression([`(`, key, `) + "${modifierPostfix}"`])
    }

    return {
      props: [createObjectProperty(key, handlerExp)]
    }
  })
}
