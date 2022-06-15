import { VNode, VNodeChild } from '../vnode'
import { isArray, isString, isObject } from '@vue/shared'
import { warn } from '../warning'

/**
 * v-for string
 * v-for 字符串重载
 * @private
 */
export function renderList(
  source: string,
  renderItem: (value: string, index: number) => VNodeChild
): VNodeChild[]

/**
 * v-for number
 * v-for 数字重载
 */
export function renderList(
  source: number,
  renderItem: (value: number, index: number) => VNodeChild
): VNodeChild[]

/**
 * v-for array
 * v-for 数组重载
 */
export function renderList<T>(
  source: T[],
  renderItem: (value: T, index: number) => VNodeChild
): VNodeChild[]

/**
 * v-for iterable
 * v-for 迭代器重载
 */
export function renderList<T>(
  source: Iterable<T>,
  renderItem: (value: T, index: number) => VNodeChild
): VNodeChild[]

/**
 * v-for object
 * v-for 对象重载
 */
export function renderList<T>(
  source: T,
  renderItem: <K extends keyof T>(
    value: T[K],
    key: K,
    index: number
  ) => VNodeChild
): VNodeChild[]

/**
 * Actual implementation
 * 实现
 */
export function renderList(
  source: any,
  renderItem: (...args: any[]) => VNodeChild,
  cache?: any[],
  index?: number
): VNodeChild[] {
  let ret: VNodeChild[]
  // 获取缓存的VNode
  const cached = (cache && cache[index!]) as VNode[] | undefined
  // 如果是数组或者字符串
  if (isArray(source) || isString(source)) {
    ret = new Array(source.length)
    for (let i = 0, l = source.length; i < l; i++) {
      ret[i] = renderItem(source[i], i, undefined, cached && cached[i])
    }
  } else if (typeof source === 'number') {
    // 数字，判断是不是整数，不是整数警告
    if (__DEV__ && !Number.isInteger(source)) {
      warn(`The v-for range expect an integer value but got ${source}.`)
      return []
    }
    // 整数则声称x个item，x为整数的值，每个item从1开始，索引从0开始
    ret = new Array(source)
    for (let i = 0; i < source; i++) {
      ret[i] = renderItem(i + 1, i, undefined, cached && cached[i])
    }
  } else if (isObject(source)) {
    // 对象，看是不是可迭代对象，可迭代对象转化成数组进行处理
    if (source[Symbol.iterator as any]) {
      ret = Array.from(source as Iterable<any>, (item, i) =>
        renderItem(item, i, undefined, cached && cached[i])
      )
    } else {
      // 非可迭代对象，拿key遍历
      const keys = Object.keys(source)
      ret = new Array(keys.length)
      for (let i = 0, l = keys.length; i < l; i++) {
        const key = keys[i]
        ret[i] = renderItem(source[key], key, i, cached && cached[i])
      }
    }
  } else {
    // 这些都不是返回空数组
    ret = []
  }

  if (cache) {
    // 缓存
    cache[index!] = ret
  }
  // 返回渲染列表结果
  return ret
}
