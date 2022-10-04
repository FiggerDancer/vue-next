import {
  VNode,
  VNodeProps,
  createVNode,
  VNodeArrayChildren,
  Fragment,
  Text,
  Comment,
  isVNode
} from './vnode'
import { Teleport, TeleportProps } from './components/Teleport'
import { Suspense, SuspenseProps } from './components/Suspense'
import { isObject, isArray } from '@vue/shared'
import { RawSlots } from './componentSlots'
import {
  FunctionalComponent,
  Component,
  ComponentOptions,
  ConcreteComponent
} from './component'
import { EmitsOptions } from './componentEmits'
import { DefineComponent } from './apiDefineComponent'

// `h` is a more user-friendly version of `createVNode` that allows omitting the
// props when possible. It is intended for manually written render functions.
// Compiler-generated code uses `createVNode` because
// 1. it is monomorphic and avoids the extra call overhead
// 2. it allows specifying patchFlags for optimization
// `h` 是一个更友好的`createVnode`函数, 它尽可能的允许使用者忽略属性。用于开发者手写render函数
// 编译器生成的代码使用的`createVnode`函数 原因如下：
// 1. 它是单态的，避免了额外的调用开销
// 2. 它允许为优化指定patchFlags  patchFlags涉及到静态标记

/*
// type only
// 仅使用标签类型
h('div')

// type + props
// 使用标签类型和属性
h('div', {})

// type + omit props + children
// 类型,忽略属性,子节点
// Omit props does NOT support named slots
// 忽略属性不支持命名插槽
h('div', []) // array
h('div', 'foo') // text
h('div', h('br')) // vnode
h(Component, () => {}) // default slot

// type + props + children
// 类型+属性+子节点
h('div', {}, []) // array
h('div', {}, 'foo') // text
h('div', {}, h('br')) // vnode
h(Component, {}, () => {}) // default slot
h(Component, {}, {}) // named slots

// named slots without props requires explicit `null` to avoid ambiguity
// 没有属性的命名插槽需要显式的' null '以避免歧义
h(Component, null, {})
**/

type RawProps = VNodeProps & {
  // used to differ from a single VNode object as children
  // 用于区别于单个VNode对象作为子节点
  __v_isVNode?: never
  // used to differ from Array children
  // 被用于区别Array子数组
  [Symbol.iterator]?: never
} & Record<string, any>

type RawChildren =
  | string
  | number
  | boolean
  | VNode
  | VNodeArrayChildren
  | (() => any)

// fake constructor type returned from `defineComponent`
// 从' defineComponent '返回的假构造函数类型
interface Constructor<P = any> {
  __isFragment?: never
  __isTeleport?: never
  __isSuspense?: never
  new (...args: any[]): { $props: P }
}



// The following is a series of overloads for providing props validation of
// manually written render functions.
// 下面是一系列提供手写属性校验的渲染函数的重载
// element
// 元素
// 无props
export function h(type: string, children?: RawChildren): VNode
// 有props
export function h(
  type: string,
  props?: RawProps | null,
  children?: RawChildren | RawSlots
): VNode

// text/comment
// 文本或注释
export function h(
  type: typeof Text | typeof Comment,
  children?: string | number | boolean
): VNode
export function h(
  type: typeof Text | typeof Comment,
  props?: null,
  children?: string | number | boolean
): VNode
// fragment
// 片段
export function h(type: typeof Fragment, children?: VNodeArrayChildren): VNode
export function h(
  type: typeof Fragment,
  props?: RawProps | null,
  children?: VNodeArrayChildren
): VNode

// teleport (target prop is required)
// 传送
export function h(
  type: typeof Teleport,
  props: RawProps & TeleportProps,
  children: RawChildren | RawSlots
): VNode

// suspense
// 悬疑
export function h(type: typeof Suspense, children?: RawChildren): VNode
export function h(
  type: typeof Suspense,
  props?: (RawProps & SuspenseProps) | null,
  children?: RawChildren | RawSlots
): VNode

// functional component
// 函数式组件
export function h<P, E extends EmitsOptions = {}>(
  type: FunctionalComponent<P, E>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

// catch-all for generic component types
// 通用组件类型的全部捕获
export function h(type: Component, children?: RawChildren): VNode

// concrete component
// 实体的组件
export function h<P>(
  type: ConcreteComponent | string,
  children?: RawChildren
): VNode
export function h<P>(
  type: ConcreteComponent<P> | string,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren
): VNode

// component without props
// 没有属性的组件
export function h(
  type: Component,
  props: null,
  children?: RawChildren | RawSlots
): VNode

// exclude `defineComponent` constructors
// 不包括 `defineComponent` 构造器
export function h<P>(
  type: ComponentOptions<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

// fake constructor type returned by `defineComponent` or class component
// 由defineComponent或class类组件返回的伪造构造类型
export function h(type: Constructor, children?: RawChildren): VNode
export function h<P>(
  type: Constructor<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

// fake constructor type returned by `defineComponent`
// 由defineComponent返回的伪造构造类型
export function h(type: DefineComponent, children?: RawChildren): VNode
export function h<P>(
  type: DefineComponent<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots
): VNode

// Actual implementation
// 真实接口，实现h函数，h函数其实是对createVNode的一个语法糖封装
export function h(type: any, propsOrChildren?: any, children?: any): VNode {
  const l = arguments.length
  if (l === 2) {
    if (isObject(propsOrChildren) && !isArray(propsOrChildren)) {
      // single vnode without props
      // 没有属性的单个节点（第二个参数是虚拟节点）
      if (isVNode(propsOrChildren)) {
        return createVNode(type, null, [propsOrChildren])
      }
      // props without children
      // 有属性，但没有子节点，第二个参数是属性
      return createVNode(type, propsOrChildren)
    } else {
      // omit props
      // 省去属性
      return createVNode(type, null, propsOrChildren)
    }
  } else {
    if (l > 3) {
      // 将第三个参数及其后的参数作为子节点数组
      children = Array.prototype.slice.call(arguments, 2)
    } else if (l === 3 && isVNode(children)) {
      // 第三个参数是否是一个结点，如果是一个节点，要把它变成子节点数组
      children = [children]
    }
    return createVNode(type, propsOrChildren, children)
  }
}
