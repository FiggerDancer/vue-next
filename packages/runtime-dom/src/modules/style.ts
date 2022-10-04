import { isString, hyphenate, capitalize, isArray } from '@vue/shared'
import { camelize } from '@vue/runtime-core'

type Style = string | Record<string, string | string[]> | null

/**
 * 更新style
 * @param el 
 * @param prev 
 * @param next 
 */
export function patchStyle(el: Element, prev: Style, next: Style) {
  const style = (el as HTMLElement).style
  // 是css字符串
  const isCssString = isString(next)
  // 新的是否存在，且不是css字符串
  if (next && !isCssString) {
    // 遍历在next中的key
    for (const key in next) {
      // 设置样式key为next[key]
      setStyle(style, key, next[key])
    }
    // 以前存在，且不是字符串
    if (prev && !isString(prev)) {
      // 如果现在有以后没有则清空这些key
      for (const key in prev) {
        if (next[key] == null) {
          setStyle(style, key, '')
        }
      }
    }
  } else {
    // 当前的display
    const currentDisplay = style.display
    // 是字符串类型 ，则直接赋值给cssText
    if (isCssString) {
      // 之前和现在不相等，则进行文本替换
      if (prev !== next) {
        style.cssText = next as string
      }
    } else if (prev) {
      // 新的没有，以前有，删除
      el.removeAttribute('style')
    }
    // indicates that the `display` of the element is controlled by `v-show`,
    // so we always keep the current `display` value regardless of the `style`
    // value, thus handing over control to `v-show`.
    // 意味着元素的display被v-show控制
    // 因为元素的display被v-show控制
    // 所以我们总是要保证当前的display值排除在style外
    if ('_vod' in el) {
      style.display = currentDisplay
    }
  }
}

// !important css权重标记
const importantRE = /\s*!important$/

function setStyle(
  style: CSSStyleDeclaration,
  name: string,
  val: string | string[]
) {
  // 数组进行递归
  if (isArray(val)) {
    val.forEach(v => setStyle(style, name, v))
  } else {
    if (val == null) val = ''
    // 如果以--开头则表示自定义属性
    if (name.startsWith('--')) {
      // custom property definition
      // 自定义属性定义
      style.setProperty(name, val)
    } else {
      // 自动添加前缀
      const prefixed = autoPrefix(style, name)
      // !important权重
      if (importantRE.test(val)) {
        // !important
        // 属性值设为连字符
        style.setProperty(
          hyphenate(prefixed),
          val.replace(importantRE, ''),
          'important'
        )
      } else {
        // 直接设置
        style[prefixed as any] = val
      }
    }
  }
}

// 前缀
const prefixes = ['Webkit', 'Moz', 'ms']
// 前缀缓存
const prefixCache: Record<string, string> = {}

// 自动添加前缀
function autoPrefix(style: CSSStyleDeclaration, rawName: string): string {
  // 从缓存中获取
  const cached = prefixCache[rawName]
  if (cached) {
    return cached
  }
  // 驼峰化
  let name = camelize(rawName)
  // filter
  if (name !== 'filter' && name in style) {
    return (prefixCache[rawName] = name)
  }
  // 首字母大写
  name = capitalize(name)
  // 通过在浏览器style中尝试来判断出使用什么前缀
  // 顺序，'Webkit', 'Moz', 'ms'。在这里我有一个比较好奇的地方，就是如果无前缀就可以用的话，岂不是多加了前缀，不知道作者怎么解决的
  for (let i = 0; i < prefixes.length; i++) {
    const prefixed = prefixes[i] + name
    if (prefixed in style) {
      return (prefixCache[rawName] = prefixed)
    }
  }
  return rawName
}
