import { DirectiveTransform } from '../transform'
import {
  createObjectProperty,
  createSimpleExpression,
  ExpressionNode,
  NodeTypes
} from '../ast'
import { createCompilerError, ErrorCodes } from '../errors'
import { camelize } from '@vue/shared'
import { CAMELIZE } from '../runtimeHelpers'

// v-bind without arg is handled directly in ./transformElements.ts due to it affecting
// codegen for the entire props object. This transform here is only for v-bind
// *with* args.
/**
 * v-bind没有参数被直接处理在./transformElements.ts
 * 由于它影响用于整个属性对象的编译
 * 这个转化仅仅用于带有v-bind的参数
 * @param dir 
 * @param _node 
 * @param context 
 * @returns 
 */
export const transformBind: DirectiveTransform = (dir, _node, context) => {
  const { exp, modifiers, loc } = dir
  const arg = dir.arg!

  // 不是简单表达式，两边加括号  ($simpleExpression) || ""
  if (arg.type !== NodeTypes.SIMPLE_EXPRESSION) {
    arg.children.unshift(`(`)
    arg.children.push(`) || ""`)
  } else if (!arg.isStatic) {
    // 是简单表达式，且参数不是静态的 
    arg.content = `${arg.content} || ""`
  }

  // .sync is replaced by v-model:arg
  // .sync被v-model:arg所代替
  // 修饰符中包含camel修饰符
  if (modifiers.includes('camel')) {
    // 简单表达式
    if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
      // 静态
      if (arg.isStatic) {
        // 将属性名称驼峰化
        // <svg :view-box.camel="viewBox"></svg>
        // <svg viewBox="...viewBox">
        arg.content = camelize(arg.content)
      } else {
        // 非静态 camel(sim_expression)
        arg.content = `${context.helperString(CAMELIZE)}(${arg.content})`
      }
    } else {
      // 非简单表达式，对表达式结果驼峰 camel($xxx)
      arg.children.unshift(`${context.helperString(CAMELIZE)}(`)
      arg.children.push(`)`)
    }
  }

  // 不是ssr
  if (!context.inSSR) {
    // prop修饰的直接作用于dom，不放在props里
    // .text = 'foo' 或者 :text.props = 'foo'
    if (modifiers.includes('prop')) {
      // 增加.前缀
      injectPrefix(arg, '.')
    }
    // attr修饰强制用于dom
    // ^text = 'foo' 或者 :text.attr = 'foo'
    if (modifiers.includes('attr')) {
      // 增加^前缀
      injectPrefix(arg, '^')
    }
  }

  // 没有表达式或者
  // 表达式类型是简单表达式且表达式内容不为空
  if (
    !exp ||
    (exp.type === NodeTypes.SIMPLE_EXPRESSION && !exp.content.trim())
  ) {
    context.onError(createCompilerError(ErrorCodes.X_V_BIND_NO_EXPRESSION, loc))
    // 创建对象属性，内部需要创建简单表达式
    return {
      props: [createObjectProperty(arg, createSimpleExpression('', true, loc))]
    }
  }

  // 创建对象属性
  return {
    props: [createObjectProperty(arg, exp)]
  }
}

/**
 * 注入前缀
 * @param arg 
 * @param prefix 
 */
const injectPrefix = (arg: ExpressionNode, prefix: string) => {
  // 属性名称前加前缀
  // 简单表达式
  if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
    // 表达式前加前缀
    if (arg.isStatic) {
      arg.content = prefix + arg.content
    } else {
      arg.content = `\`${prefix}\${${arg.content}}\``
    }
  } else {
    arg.children.unshift(`'${prefix}' + (`)
    arg.children.push(`)`)
  }
}
