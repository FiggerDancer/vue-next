/**
Runtime helper for applying directives to a vnode. Example usage:

运行时帮助函数用于对vnode应用指令

示例使用:

const comp = resolveComponent('comp')
const foo = resolveDirective('foo')
const bar = resolveDirective('bar')

return withDirectives(h(comp), [
  [foo, this.x],
  [bar, this.y]
])
*/

import { VNode } from './vnode'
import { isFunction, EMPTY_OBJ, isBuiltInDirective } from '@vue/shared'
import { warn } from './warning'
import { ComponentInternalInstance, Data, getExposeProxy } from './component'
import { currentRenderingInstance } from './componentRenderContext'
import { callWithAsyncErrorHandling, ErrorCodes } from './errorHandling'
import { ComponentPublicInstance } from './componentPublicInstance'
import { mapCompatDirectiveHook } from './compat/customDirective'
import { pauseTracking, resetTracking } from '@vue/reactivity'
import { traverse } from './apiWatch'

/**
 * 指令绑定
 * instance 实例
 * vaue 值
 * oldValue 旧的值
 * arg 参数
 * modifers 修饰器
 * dir 指令
 */
export interface DirectiveBinding<V = any> {
  instance: ComponentPublicInstance | null
  value: V
  oldValue: V | null
  arg?: string
  modifiers: DirectiveModifiers
  dir: ObjectDirective<any, V>
}

/**
 * 指令钩子
 * el 元素
 * binding 绑定
 * vnode 节点
 * prevNode 上一个节点
 */
export type DirectiveHook<T = any, Prev = VNode<any, T> | null, V = any> = (
  el: T,
  binding: DirectiveBinding<V>,
  vnode: VNode<any, T>,
  prevVNode: Prev
) => void

/**
 * SSR指令钩子
 */
export type SSRDirectiveHook = (
  binding: DirectiveBinding,
  vnode: VNode
) => Data | undefined

/**
 * 对象钩子
 * created 创建
 * beforeMount 在挂载前
 * mounted 挂载
 * beforeUpdate 在更新前
 * updated 在更新后
 * beforeUnmount 在销毁前
 * unmounted 销毁后
 * getSSRProps 
 * deep
 */
export interface ObjectDirective<T = any, V = any> {
  created?: DirectiveHook<T, null, V>
  beforeMount?: DirectiveHook<T, null, V>
  mounted?: DirectiveHook<T, null, V>
  beforeUpdate?: DirectiveHook<T, VNode<any, T>, V>
  updated?: DirectiveHook<T, VNode<any, T>, V>
  beforeUnmount?: DirectiveHook<T, null, V>
  unmounted?: DirectiveHook<T, null, V>
  getSSRProps?: SSRDirectiveHook
  deep?: boolean
}

/**
 * 方法钩子，指令钩子
 */
export type FunctionDirective<T = any, V = any> = DirectiveHook<T, any, V>

/**
 * 指令
 * 对象指令
 * 方法指令
 */
export type Directive<T = any, V = any> =
  | ObjectDirective<T, V>
  | FunctionDirective<T, V>

/**
 * 指令修饰器
 */
export type DirectiveModifiers = Record<string, boolean>

/**
 * 检验指令名称的有效性
 * @param name 
 */
export function validateDirectiveName(name: string) {
  // 是不是内置的指令
  if (isBuiltInDirective(name)) {
    warn('Do not use built-in directive ids as custom directive id: ' + name)
  }
}

// Directive, value, argument, modifiers
/**
 * 指令，值，参数，修饰器
 */
export type DirectiveArguments = Array<
  | [Directive]
  | [Directive, any]
  | [Directive, any, string]
  | [Directive, any, string, DirectiveModifiers]
>

/**
 * Adds directives to a VNode.
 * 给vnode添加指令
 */
export function withDirectives<T extends VNode>(
  vnode: T,
  directives: DirectiveArguments
): T {
  // 内部实例
  const internalInstance = currentRenderingInstance
  // 内部实例为空
  if (internalInstance === null) {
    __DEV__ && warn(`withDirectives can only be used inside render functions.`)
    return vnode
  }
  // 实例   内部实例代理
  const instance =
    (getExposeProxy(internalInstance) as ComponentPublicInstance) ||
    internalInstance.proxy
  // 从vnode节点上获取绑定过的指令，以此为基础添加新指令
  const bindings: DirectiveBinding[] = vnode.dirs || (vnode.dirs = [])
  // 遍历指令数组，依次添加
  for (let i = 0; i < directives.length; i++) {
    // 从指令中解构
    let [dir, value, arg, modifiers = EMPTY_OBJ] = directives[i]
    // 指令是函数
    if (isFunction(dir)) {
      // 则序列化指令的格式为对象
      dir = {
        mounted: dir,
        updated: dir
      } as ObjectDirective
    }
    // 指令是否允许深度遍历
    if (dir.deep) {
      // 递归遍历指令
      traverse(value)
    }
    // 放入要绑定的指令
    bindings.push({
      dir,
      instance,
      value,
      oldValue: void 0,
      arg,
      modifiers
    })
  }
  return vnode
}

/**
 * 调用指令钩子
 * @param vnode 
 * @param prevVNode 
 * @param instance 
 * @param name 
 */
export function invokeDirectiveHook(
  vnode: VNode,
  prevVNode: VNode | null,
  instance: ComponentInternalInstance | null,
  name: keyof ObjectDirective
) {
  // 绑定
  const bindings = vnode.dirs!
  // 旧的绑定
  const oldBindings = prevVNode && prevVNode.dirs!
  // 遍历绑定
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]
    // 如果存在旧的绑定，将新绑定的旧值设置为旧绑定的值
    if (oldBindings) {
      binding.oldValue = oldBindings[i].value
    }
    // 钩子  通过名称后的绑定的指令钩子
    let hook = binding.dir[name] as DirectiveHook | DirectiveHook[] | undefined
    // 如果兼容vue2 且 没有钩子
    if (__COMPAT__ && !hook) {
      // 对所有的钩子做兼容性处理
      hook = mapCompatDirectiveHook(name, binding.dir, instance)
    }
    if (hook) {
      // disable tracking inside all lifecycle hooks
      // since they can potentially be called inside effects.
      // 在所有生命周期钩子中禁止跟踪
      // 因为他们可能被调用在副作用中
      pauseTracking()
      // 调用钩子
      callWithAsyncErrorHandling(hook, instance, ErrorCodes.DIRECTIVE_HOOK, [
        vnode.el,
        binding,
        vnode,
        prevVNode
      ])
      resetTracking()
    }
  }
}
