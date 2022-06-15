import {
  includeBooleanAttr,
  isSpecialBooleanAttr,
  makeMap,
  NOOP
} from '@vue/shared'
import {
  compatUtils,
  ComponentInternalInstance,
  DeprecationTypes
} from '@vue/runtime-core'

// xlink 链接
export const xlinkNS = 'http://www.w3.org/1999/xlink'

// 更新attr
export function patchAttr(
  el: Element,
  key: string,
  value: any,
  isSVG: boolean,
  instance?: ComponentInternalInstance | null
) {
  // 是SVG且键以xlink:开头
  if (isSVG && key.startsWith('xlink:')) {
    if (value == null) {
      // 值为null或undefined，需要移除
      el.removeAttributeNS(xlinkNS, key.slice(6, key.length))
    } else {
      // 添加设置修改
      el.setAttributeNS(xlinkNS, key, value)
    }
  } else {
    // 如果不是SVG
    if (__COMPAT__ && compatCoerceAttr(el, key, value, instance)) {
      return
    }

    // note we are only checking boolean attributes that don't have a
    // corresponding dom prop of the same name here.
    // 注意，我们只检查那些没有相应的同名dom属性的布尔属性。
    const isBoolean = isSpecialBooleanAttr(key)
    // 值为undefined或null  或者  是特殊的布尔值且它转义后正常情况下不存在
    if (value == null || (isBoolean && !includeBooleanAttr(value))) {
      el.removeAttribute(key)
    } else {
      el.setAttribute(key, isBoolean ? '' : value)
    }
  }
}

// 2.x compat
// 2.x 兼容，对枚举属性做兼容
const isEnumeratedAttr = __COMPAT__
  ? /*#__PURE__*/ makeMap('contenteditable,draggable,spellcheck')
  : NOOP

// 兼容强制属性
export function compatCoerceAttr(
  el: Element,
  key: string,
  value: unknown,
  instance: ComponentInternalInstance | null = null
): boolean {
  if (isEnumeratedAttr(key)) { // 是枚举属性
    // null强转为false，value不为undefined或布尔值转为true，其他情况（undefined？）转成null
    const v2CocercedValue =
      value === null
        ? 'false'
        : typeof value !== 'boolean' && value !== undefined
        ? 'true'
        : null
    if (
      v2CocercedValue &&
      compatUtils.softAssertCompatEnabled(
        DeprecationTypes.ATTR_ENUMERATED_COERCION,
        instance,
        key,
        value,
        v2CocercedValue
      )
    ) {
      el.setAttribute(key, v2CocercedValue)
      return true
    }
  } else if ( // 非枚举属性
  // 移除值为false的属性
    value === false &&
    !isSpecialBooleanAttr(key) &&
    compatUtils.softAssertCompatEnabled(
      DeprecationTypes.ATTR_FALSE_VALUE,
      instance,
      key
    )
  ) {
    el.removeAttribute(key)
    return true
  }
  return false
}
