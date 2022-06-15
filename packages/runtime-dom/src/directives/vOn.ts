import {
  getCurrentInstance,
  DeprecationTypes,
  LegacyConfig,
  compatUtils,
  ComponentInternalInstance
} from '@vue/runtime-core'
import { hyphenate, isArray } from '@vue/shared'

// 系统修饰符
const systemModifiers = ['ctrl', 'shift', 'alt', 'meta']

type KeyedEvent = KeyboardEvent | MouseEvent | TouchEvent

// 修饰器守卫
const modifierGuards: Record<
  string,
  (e: Event, modifiers: string[]) => void | boolean
> = {
  stop: e => e.stopPropagation(), // 阻止冒泡
  prevent: e => e.preventDefault(), // 阻止默认事件
  self: e => e.target !== e.currentTarget, // 只执行本身
  ctrl: e => !(e as KeyedEvent).ctrlKey, // 如果没有ctrl则不执行
  shift: e => !(e as KeyedEvent).shiftKey, // 如果没有shift则不执行
  alt: e => !(e as KeyedEvent).altKey, // 如果没有alt
  meta: e => !(e as KeyedEvent).metaKey, // 没有meta
  left: e => 'button' in e && (e as MouseEvent).button !== 0, // 按照鼠标左键
  middle: e => 'button' in e && (e as MouseEvent).button !== 1, // 中建
  right: e => 'button' in e && (e as MouseEvent).button !== 2, // 右键
  exact: (e, modifiers) =>
    systemModifiers.some(m => (e as any)[`${m}Key`] && !modifiers.includes(m)) // 修饰符中是否包含任意一种系统修饰符
}

/**
 * @private
 * 有没有带修饰符
 */
export const withModifiers = (fn: Function, modifiers: string[]) => {
  return (event: Event, ...args: unknown[]) => {
    // 遍历修饰符，并执行每个修饰符的守卫，只要有一个不通过则停止执行
    for (let i = 0; i < modifiers.length; i++) {
      const guard = modifierGuards[modifiers[i]]
      if (guard && guard(event, modifiers)) return
    }
    return fn(event, ...args)
  }
}

// Kept for 2.x compat.
// Note: IE11 compat for `spacebar` and `del` is removed for now.
// 兼容2.x 一些键盘修饰符
// 注意：IE11对于IE中的spacebar和del现在已经不兼容
const keyNames: Record<string, string | string[]> = {
  esc: 'escape',
  space: ' ',
  up: 'arrow-up',
  left: 'arrow-left',
  right: 'arrow-right',
  down: 'arrow-down',
  delete: 'backspace'
}

/**
 * @private
 * 按键修饰符
 * 全局keyCodes
 */
export const withKeys = (fn: Function, modifiers: string[]) => {
  let globalKeyCodes: LegacyConfig['keyCodes']
  let instance: ComponentInternalInstance | null = null
  // 兼容处理
  if (__COMPAT__) {
    instance = getCurrentInstance()
    if (
      compatUtils.isCompatEnabled(DeprecationTypes.CONFIG_KEY_CODES, instance)
    ) {
      if (instance) {
        // 获取全局的keyCodes
        globalKeyCodes = (instance.appContext.config as LegacyConfig).keyCodes
      }
    }
    // 对数字进行警告
    if (__DEV__ && modifiers.some(m => /^\d+$/.test(m))) {
      compatUtils.warnDeprecation(
        DeprecationTypes.V_ON_KEYCODE_MODIFIER,
        instance
      )
    }
  }

  // 正常情况下
  return (event: KeyboardEvent) => {
    // event中是否存在key
    if (!('key' in event)) {
      return
    }

    // 将key进行肉串化
    const eventKey = hyphenate(event.key)
    // 修复符中包含该修饰符，执行该修饰符对应函数
    if (modifiers.some(k => k === eventKey || keyNames[k] === eventKey)) {
      return fn(event)
    }
    // 兼容性
    if (__COMPAT__) {
      const keyCode = String(event.keyCode)
      if (
        compatUtils.isCompatEnabled(
          DeprecationTypes.V_ON_KEYCODE_MODIFIER,
          instance
        ) &&
        modifiers.some(mod => mod == keyCode)
      ) {
        return fn(event)
      }
      // 全局keyCodes
      if (globalKeyCodes) {
        for (const mod of modifiers) {
          const codes = globalKeyCodes[mod]
          if (codes) {
            const matches = isArray(codes)
              ? codes.some(code => String(code) === keyCode)
              : String(codes) === keyCode
            if (matches) {
              return fn(event)
            }
          }
        }
      }
    }
  }
}
