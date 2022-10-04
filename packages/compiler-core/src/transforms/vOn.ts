import { DirectiveTransform, DirectiveTransformResult } from '../transform'
import {
  createCompoundExpression,
  createObjectProperty,
  createSimpleExpression,
  DirectiveNode,
  ElementTypes,
  ExpressionNode,
  NodeTypes,
  SimpleExpressionNode
} from '../ast'
import { camelize, toHandlerKey } from '@vue/shared'
import { createCompilerError, ErrorCodes } from '../errors'
import { processExpression } from './transformExpression'
import { validateBrowserExpression } from '../validateExpression'
import { hasScopeRef, isMemberExpression } from '../utils'
import { TO_HANDLER_KEY } from '../runtimeHelpers'

/**
 * 方法表达式正则
 */
const fnExpRE =
  /^\s*([\w$_]+|(async\s*)?\([^)]*?\))\s*=>|^\s*(async\s+)?function(?:\s+[\w$]+)?\s*\(/

export interface VOnDirectiveNode extends DirectiveNode {
  // v-on without arg is handled directly in ./transformElements.ts due to it affecting
  // codegen for the entire props object. This transform here is only for v-on
  // *with* args.
  // v-on 没有带参数则被 transformElements.ts 直接处理
  // 由于它影响整个属性对象的编译
  // 这个转化仅仅在v-on带有参数时进行处理
  arg: ExpressionNode
  // exp is guaranteed to be a simple expression here because v-on w/ arg is
  // skipped by transformExpression as a special case.
  // 表达式被守卫成一个简单表达式，
  // 因为v-on会被transformExpression当做特殊情况跳过
  exp: SimpleExpressionNode | undefined
}

/**
 * v-on
 * @param dir 
 * @param node 
 * @param context 
 * @param augmentor 
 * @returns 
 */
export const transformOn: DirectiveTransform = (
  dir,
  node,
  context,
  augmentor
) => {
  const { loc, modifiers, arg } = dir as VOnDirectiveNode
  // 指令没有表达式，没有修饰符
  if (!dir.exp && !modifiers.length) {
    context.onError(createCompilerError(ErrorCodes.X_V_ON_NO_EXPRESSION, loc))
  }
  let eventName: ExpressionNode
  // 简单表达式
  if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
    // 参数是静态的
    if (arg.isStatic) {
      // 原始名称
      let rawName = arg.content
      // TODO deprecate @vnodeXXX usage
      // 废弃 @vnodeXXX 的使用
      // 原生名称中以vue:开头
      // 则修改为 vnode-xxxx
      if (rawName.startsWith('vue:')) {
        rawName = `vnode-${rawName.slice(4)}`
      }
      // for all event listeners, auto convert it to camelCase. See issue #2249
      // 对于所有事件监听器，自动转化它为驼峰式
      eventName = createSimpleExpression(
        toHandlerKey(camelize(rawName)),
        true,
        arg.loc
      )
    } else {
      // #2388
      // 不是静态的则创建一个复杂表达式
      eventName = createCompoundExpression([
        `${context.helperString(TO_HANDLER_KEY)}(`,
        arg,
        `)`
      ])
    }
  } else {
    // already a compound expression.
    // 已经是一个复杂表达式了
    eventName = arg
    eventName.children.unshift(`${context.helperString(TO_HANDLER_KEY)}(`)
    eventName.children.push(`)`)
  }

  // handler processing
  // 事件监听器处理
  let exp: ExpressionNode | undefined = dir.exp as
    | SimpleExpressionNode
    | undefined
    // 表达式但是为空表达式，将表达式置为undefined
  if (exp && !exp.content.trim()) {
    exp = undefined
  }
  // 是否应该缓存，看v-once且不存在表达式 
  let shouldCache: boolean = context.cacheHandlers && !exp && !context.inVOnce
  // 存在表达式
  if (exp) {
    // 是成员表达式
    const isMemberExp = isMemberExpression(exp.content, context)
    // 是内联语句（既不是成员表达式，也不是函数表达式）
    // $emit($event) 或者  isActive = false;isSelect = true 这类的
    const isInlineStatement = !(isMemberExp || fnExpRE.test(exp.content))
    // 有多个语句
    const hasMultipleStatements = exp.content.includes(`;`)

    // process the expression since it's been skipped
    // 处理已跳过的表达式
    if (!__BROWSER__ && context.prefixIdentifiers) {
      // 是内联语句且上下文添加标识符$event
      isInlineStatement && context.addIdentifiers(`$event`)
      // 表达式，指令表达式是处理表达式
      exp = dir.exp = processExpression(
        exp,
        context,
        false,
        hasMultipleStatements
      )
      // 是内联语句则需要在处理完表达式后移除标识符
      isInlineStatement && context.removeIdentifiers(`$event`)
      // with scope analysis, the function is hoistable if it has no reference
      // to scope variables.
      // 通过作用域分析，如果这个函数没有引用局部变量，那么对该函数
      // 静态提升
      shouldCache =
        context.cacheHandlers &&
        // unnecessary to cache inside v-once
        // 如果是v-once中不需要再缓存了，之前都缓存了
        !context.inVOnce &&
        // runtime constants don't need to be cached
        // (this is analyzed by compileScript in SFC <script setup>)
        // 运行时常量不需要缓存
        // 作用域分析是通过sfc<script setup>中的编译脚本分析的
        !(exp.type === NodeTypes.SIMPLE_EXPRESSION && exp.constType > 0) &&
        // #1541 bail if this is a member exp handler passed to a component -
        // we need to use the original function to preserve arity,
        // e.g. <transition> relies on checking cb.length to determine
        // transition end handling. Inline function is ok since its arity
        // is preserved even when cached.
        // 保释，如果这是传递给组件的成员exp处理程序-
        // 我们需要使用原始函数来保留相似性，
        // 例如<transition>依赖于cb长度的检查确定过渡结束处理效果。
        // 内联函数是ok的，
        // 因为即使在缓存时，它的特性也被保留了。
        !(isMemberExp && node.tagType === ElementTypes.COMPONENT) &&
        // bail if the function references closure variables (v-for, v-slot)
        // it must be passed fresh to avoid stale values.
        // 保释，如果函数引用了闭包变量v-for或者v-slot，它必须被传递最新的值避免陈旧的值
        !hasScopeRef(exp, context.identifiers)
      // If the expression is optimizable and is a member expression pointing
      // to a function, turn it into invocation (and wrap in an arrow function
      // below) so that it always accesses the latest value when called - thus
      // avoiding the need to be patched.
      // 如果表达式有优化且是一个成员表达式表明一个函数，将其转化为调用（包裹在一个箭头函数下面）
      // 因此当被调用时，它总是使用最新的值，由于避免了被更新
      if (shouldCache && isMemberExp) {
        if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          // 表达式内容
          exp.content = `${exp.content} && ${exp.content}(...args)`
        } else {
          exp.children = [...exp.children, ` && `, ...exp.children, `(...args)`]
        }
      }
    }

    // 校验浏览器表达式
    if (__DEV__ && __BROWSER__) {
      validateBrowserExpression(
        exp as SimpleExpressionNode,
        context,
        false,
        hasMultipleStatements
      )
    }

    // 内联语句或者（成员表达式且应该缓存）
    if (isInlineStatement || (shouldCache && isMemberExp)) {
      // wrap inline statement in a function expression
      // 包裹内联语句在一个函数表达式中
      // $event => { exp } 多个语句
      // (...args) => { exp } 多个语句
      // $event => (exp) 单个语句
      exp = createCompoundExpression([
        `${
          isInlineStatement
            ? !__BROWSER__ && context.isTS
              ? `($event: any)`
              : `$event`
            : `${
                !__BROWSER__ && context.isTS ? `\n//@ts-ignore\n` : ``
              }(...args)`
        } => ${hasMultipleStatements ? `{` : `(`}`,
        exp,
        hasMultipleStatements ? `}` : `)`
      ])
    }
  }

  // 编译结果
  let ret: DirectiveTransformResult = {
    props: [
      createObjectProperty(
        eventName,
        exp || createSimpleExpression(`() => {}`, false, loc)
      )
    ]
  }

  // apply extended compiler augmentor
  // 应用扩展编译器增强器
  if (augmentor) {
    ret = augmentor(ret)
  }

  if (shouldCache) {
    // cache handlers so that it's always the same handler being passed down.
    // this avoids unnecessary re-renders when users use inline handlers on
    // components.
    // 缓存事件处理器因为它总是有相同的处理器被传递
    // 这避免了当用户在组件上使用内联处理器时不必要的重新渲染
    ret.props[0].value = context.cache(ret.props[0].value)
  }

  // mark the key as handler for props normalization check
  // 标记key作为属性序列化检查的事件处理器
  ret.props.forEach(p => (p.key.isHandlerKey = true))
  return ret
}
