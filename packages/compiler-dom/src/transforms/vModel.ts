import {
  transformModel as baseTransform,
  DirectiveTransform,
  ElementTypes,
  findProp,
  NodeTypes,
  hasDynamicKeyVBind
} from '@vue/compiler-core'
import { createDOMCompilerError, DOMErrorCodes } from '../errors'
import {
  V_MODEL_CHECKBOX,
  V_MODEL_RADIO,
  V_MODEL_SELECT,
  V_MODEL_TEXT,
  V_MODEL_DYNAMIC
} from '../runtimeHelpers'

/**
 * 转化v-model
 * @param dir 
 * @param node 
 * @param context 
 * @returns 
 */
export const transformModel: DirectiveTransform = (dir, node, context) => {
  const baseResult = baseTransform(dir, node, context)
  // base transform has errors OR component v-model (only need props)
  // 基本的转化有错误或者组件v-model（仅仅需要props）
  if (!baseResult.props.length || node.tagType === ElementTypes.COMPONENT) {
    return baseResult
  }

  if (dir.arg) {
    context.onError(
      createDOMCompilerError(
        DOMErrorCodes.X_V_MODEL_ARG_ON_ELEMENT,
        dir.arg.loc
      )
    )
  }

  // 检查重复的值，看看v-model是否与正常的重复
  function checkDuplicatedValue() {
    const value = findProp(node, 'value')
    if (value) {
      context.onError(
        createDOMCompilerError(
          DOMErrorCodes.X_V_MODEL_UNNECESSARY_VALUE,
          value.loc
        )
      )
    }
  }

  const { tag } = node
  // 是web组件
  const isCustomElement = context.isCustomElement(tag)
  if (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    isCustomElement
  ) {
    // 定义好要执行的指令
    let directiveToUse = V_MODEL_TEXT
    let isInvalidType = false
    if (tag === 'input' || isCustomElement) {
      const type = findProp(node, `type`)
      if (type) {
        if (type.type === NodeTypes.DIRECTIVE) {
          // :type="foo"
          directiveToUse = V_MODEL_DYNAMIC
        } else if (type.value) {
          switch (type.value.content) {
            case 'radio':
              directiveToUse = V_MODEL_RADIO
              break
            case 'checkbox':
              directiveToUse = V_MODEL_CHECKBOX
              break
            case 'file':
              isInvalidType = true
              context.onError(
                createDOMCompilerError(
                  DOMErrorCodes.X_V_MODEL_ON_FILE_INPUT_ELEMENT,
                  dir.loc
                )
              )
              break
            default:
              // text type
              __DEV__ && checkDuplicatedValue()
              break
          }
        }
      } else if (hasDynamicKeyVBind(node)) {
        // element has bindings with dynamic keys, which can possibly contain
        // 元素具有动态键绑定，其中可能包含
        // "type".
        directiveToUse = V_MODEL_DYNAMIC
      } else {
        // text type
        // 检查重复值
        __DEV__ && checkDuplicatedValue()
      }
    } else if (tag === 'select') {
      directiveToUse = V_MODEL_SELECT
    } else {
      // textarea
      __DEV__ && checkDuplicatedValue()
    }
    // inject runtime directive
    // by returning the helper symbol via needRuntime
    // the import will replaced a resolveDirective call.
    // 通过运行时的引入将代替获取指令的回调
    // 返回帮助函数的symbol注入运行时指令
    if (!isInvalidType) {
      baseResult.needRuntime = context.helper(directiveToUse)
    }
  } else {
    context.onError(
      createDOMCompilerError(
        DOMErrorCodes.X_V_MODEL_ON_INVALID_ELEMENT,
        dir.loc
      )
    )
  }

  // native vmodel doesn't need the `modelValue` props since they are also
  // passed to the runtime as `binding.value`. removing it reduces code size.
  // 原始的v-model不需要modelValue属性
  // 因为他们总是被传值运行时绑定的value
  // 移除它减少代码体积
  baseResult.props = baseResult.props.filter(
    p =>
      !(
        p.key.type === NodeTypes.SIMPLE_EXPRESSION &&
        p.key.content === 'modelValue'
      )
  )

  return baseResult
}
