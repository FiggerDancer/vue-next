import { computed as _computed } from '@vue/reactivity'
import { isInSSRComponentSetup } from './component'

/**
 * 计算属性
 */
export const computed = ((getterOrOptions: any, debugOptions?: any) => {
  // @ts-ignore
  return _computed(getterOrOptions, debugOptions, isInSSRComponentSetup)
}) as typeof _computed
