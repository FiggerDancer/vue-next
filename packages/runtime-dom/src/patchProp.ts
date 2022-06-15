import { patchClass } from './modules/class'
import { patchStyle } from './modules/style'
import { patchAttr } from './modules/attrs'
import { patchDOMProp } from './modules/props'
import { patchEvent } from './modules/events'
import { isOn, isString, isFunction, isModelListener } from '@vue/shared'
import { RendererOptions } from '@vue/runtime-core'

// 监听事件
const nativeOnRE = /^on[a-z]/

// DOM渲染器选项
type DOMRendererOptions = RendererOptions<Node, Element>

// 元素属性的更新
export const patchProp: DOMRendererOptions['patchProp'] = (
  el,
  key,
  prevValue,
  nextValue,
  isSVG = false,
  prevChildren,
  parentComponent,
  parentSuspense,
  unmountChildren
) => {
  if (key === 'class') {
    // 如果key是class，则更新class
    patchClass(el, nextValue, isSVG)
  } else if (key === 'style') {
    // 如果key是style，则更新style
    patchStyle(el, prevValue, nextValue)
  } else if (isOn(key)) {
    // ignore v-model listeners
    // 忽略v-model监听
    if (!isModelListener(key)) {
      patchEvent(el, key, prevValue, nextValue, parentComponent)
    }
  } else if (
    // key以.开头，那让key赋值为.后面的字符，并通过条件判断
    // 以 ^ 开头，则让key赋值为^后面的字符，并无法通过条件判断
    // 否则将key视为属性处理
    key[0] === '.'
      ? ((key = key.slice(1)), true)
      : key[0] === '^'
      ? ((key = key.slice(1)), false)
      : shouldSetAsProp(el, key, nextValue, isSVG)
  ) {
    // 处理Prop属性
    patchDOMProp(
      el,
      key,
      nextValue,
      prevChildren,
      parentComponent,
      parentSuspense,
      unmountChildren
    )
  } else {
    // special case for <input v-model type="checkbox"> with
    // :true-value & :false-value
    // store value as dom properties since non-string values will be
    // stringified.
    // 特殊case对于input标签checkbox选项框的v-model
    // 使用:true-value和：false-value 存储作为dom元素的属性
    // 因为非字符串值将被字符串化
    if (key === 'true-value') {
      ;(el as any)._trueValue = nextValue
    } else if (key === 'false-value') {
      ;(el as any)._falseValue = nextValue
    }
    patchAttr(el, key, nextValue, isSVG, parentComponent)
  }
}

/**
 * 是否应该作为Prop进行设置
 * 什么是Prop  元素对象的属性
 * 什么是Attributes 元素dom的属性
 * @param el 
 * @param key 
 * @param value 
 * @param isSVG 
 * @returns 
 */
function shouldSetAsProp(
  el: Element,
  key: string,
  value: unknown,
  isSVG: boolean
) {
  // 是SVG
  if (isSVG) {
    // most keys must be set as attribute on svg elements to work
    // ...except innerHTML & textContent
    // 大多数的key值被设置成svg元素的属性进行工作
    // 除了innerHTML和textContent
    if (key === 'innerHTML' || key === 'textContent') {
      return true
    }
    // or native onclick with function values
    // 或者是函数值用于原生事件
    if (key in el && nativeOnRE.test(key) && isFunction(value)) {
      return true
    }
    // 如果不是这两者，那么返回false
    return false
  }
  // 非SVG
  // spellcheck and draggable are numerated attrs, however their
  // corresponding DOM properties are actually booleans - this leads to
  // setting it with a string "false" value leading it to be coerced to 
  // `true`, so we need to always treat them as attributes.
  // Note that `contentEditable` doesn't have this problem: its DOM
  // property is also enumerated string values.
  // 拼写检查和可拖动属性是数字属性，但它们对应的DOM属性实际上是布尔值
  // 这导致将该值设置为"false"字符串时会导致它被强制纠正为`true`
  if (key === 'spellcheck' || key === 'draggable') {
    return false
  }

  // #1787, #2840 form property on form elements is readonly and must be set as
  // attribute.
  // 表单上的属性是只读的必须被设置为属性
  if (key === 'form') {
    return false
  }

  // #1526 <input list> must be set as attribute
  // input的list必须被设置成属性
  if (key === 'list' && el.tagName === 'INPUT') {
    return false
  }

  // #2766 <textarea type> must be set as attribute
  // textarea的type必须被设置成属性
  if (key === 'type' && el.tagName === 'TEXTAREA') {
    return false
  }

  // native onclick with string value, must be set as attribute
  // 原始onclick带着字符串值，必须被设置成属性
  if (nativeOnRE.test(key) && isString(value)) {
    return false
  }

  // key如果在元素中能够找到对应的值
  return key in el
}
