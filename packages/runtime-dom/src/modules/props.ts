// __UNSAFE__
// Reason: potentially setting innerHTML.
// This can come from explicit usage of v-html or innerHTML as a prop in render
// 不安全的
// 原因：潜在的设置innerHTML
// 这可能来自于在渲染中显式地使用v-html或innerHTML作为Prop

import { warn, DeprecationTypes, compatUtils } from '@vue/runtime-core'
import { includeBooleanAttr } from '@vue/shared'

// functions. The user is responsible for using them with only trusted content.
// 功能：用户要对他们提供的内容负责。
export function patchDOMProp(
  el: any,
  key: string,
  value: any,
  // the following args are passed only due to potential innerHTML/textContent
  // overriding existing VNodes, in which case the old tree must be properly
  // unmounted.
  // 下面的参数传递只是由于潜在的innerHTML/textContent覆盖现有的vnode，
  // 在这种情况下，旧树必须正确卸载。
  prevChildren: any,
  parentComponent: any,
  parentSuspense: any,
  unmountChildren: any
) {
  // 如果是innerHTML或者textContent，需要先卸载之前所有的子节点
  if (key === 'innerHTML' || key === 'textContent') {
    if (prevChildren) {
      unmountChildren(prevChildren, parentComponent, parentSuspense)
    }
    // 如果用户设置为null的话，就将其置空
    el[key] = value == null ? '' : value
    return
  }

  if (
    key === 'value' &&
    el.tagName !== 'PROGRESS' &&
    // custom elements may use _value internally
    // 自定义元素(web组件）可以在内部使用_value
    !el.tagName.includes('-')
  ) {
    // store value as _value as well since
    // non-string values will be stringified.
    // 将value存储为_value，因为非字符串值将被字符串化。
    el._value = value
    const newValue = value == null ? '' : value
    if (
      el.value !== newValue ||
      // #4956: always set for OPTION elements because its value falls back to
      // textContent if no value attribute is present. And setting .value for
      // OPTION has no side effect
      // 总是设置OPTION元素，因为如果没有value属性，
      // 它的值会回落到textContent。并设置OPTION的.value是没有副作用的
      el.tagName === 'OPTION'
    ) {
      el.value = newValue
    }
    // value == null的话，移除属性 == null 即 value为null或者undefined
    if (value == null) {
      el.removeAttribute(key)
    }
    return
  }

  let needRemove = false
  // value为空字符串或者value是null或undefined, 移除属性
  if (value === '' || value == null) {
    const type = typeof el[key]
    if (type === 'boolean') {
      // e.g. <select multiple> compiles to { multiple: '' }
      // 例如:<select multiple>编译为{multiple: "}
      value = includeBooleanAttr(value)
    } else if (value == null && type === 'string') {
      // e.g. <div :id="null">
      // 例如：<div :id="null">
      value = ''
      needRemove = true
    } else if (type === 'number') {
      // e.g. <img :width="null">
      value = 0
      // 例如：<img :width="null">
      // 某些IDL属性的值必须大于0，例如input.size = 0 ->错误
      needRemove = true
    }
  } else {
    // 兼容vue2.x，如果value是false，该值的类型应为string或者number，先修改为 0或者空字符串，然后移除属性
  if (
      __COMPAT__ &&
      value === false &&
      // 判断是否启用了属性false值验证
    compatUtils.isCompatEnabled(
        DeprecationTypes.ATTR_FALSE_VALUE,
        parentComponent
      )
    ) {
      // 类型
    const type = typeof el[key]
      if (type === 'string' || type === 'number') {
        __DEV__ &&
          compatUtils.warnDeprecation(
            DeprecationTypes.ATTR_FALSE_VALUE,
            parentComponent,
            key
          )
      // number置为0，字符串置为空，再移除
        value = type === 'number' ? 0 : ''
        needRemove = true
      }
    }
  }

  // some properties perform value validation and throw,
  // some properties has getter, no setter, will error in 'use strict'
  // eg. <select :type="null"></select> <select :willValidate="null"></select>
  // 有些属性执行值验证并抛出
  try {
    el[key] = value
  } catch (e: any) {
    // do not warn if value is auto-coerced from nullish values
    if (__DEV__ && !needRemove) {
      warn(
        `Failed setting prop "${key}" on <${el.tagName.toLowerCase()}>: ` +
          `value ${value} is invalid.`,
        e
      )
    }
  }
  needRemove && el.removeAttribute(key)
}
