import { ComponentInternalInstance, currentInstance } from './component'
import {
  VNode,
  VNodeNormalizedChildren,
  normalizeVNode,
  VNodeChild,
  InternalObjectKey
} from './vnode'
import {
  isArray,
  isFunction,
  EMPTY_OBJ,
  ShapeFlags,
  extend,
  def,
  SlotFlags
} from '@vue/shared'
import { warn } from './warning'
import { isKeepAlive } from './components/KeepAlive'
import { ContextualRenderFn, withCtx } from './componentRenderContext'
import { isHmrUpdating } from './hmr'
import { DeprecationTypes, isCompatEnabled } from './compat/compatConfig'
import { toRaw } from '@vue/reactivity'

/** 插槽，返回VNode节点 */ 
export type Slot = (...args: any[]) => VNode[]

/** 内部插槽 */ 
export type InternalSlots = {
  [name: string]: Slot | undefined
}

/**
 * 将内部插槽所有属性只读化
 */
export type Slots = Readonly<InternalSlots>

/**
 * 原始插槽
 */
export type RawSlots = {
  [name: string]: unknown
  // manual render fn hint to skip forced children updates
  // 手动渲染器函数提示跳过强制子节点更新
  $stable?: boolean
  /**
   * for tracking slot owner instance. This is attached during
   * normalizeChildren when the component vnode is created.
   * 为了追踪插槽自己的实例
   * 在序列化子节点期间被赋予
   * 这时组件的虚拟节点被创建
   * @internal
   */
  _ctx?: ComponentInternalInstance | null
  /**
   * indicates compiler generated slots
   * we use a reserved property instead of a vnode patchFlag because the slots
   * object may be directly passed down to a child component in a manual
   * render function, and the optimization hint need to be on the slot object
   * itself to be preserved.
   * 暗示编译器生成插槽
   * 我们用一个被保留属性代替一个结点补丁标记
   * 因为插槽对象可能直接被传递给子组件
   * 在一个手动渲染函数
   * 优化提示需要在一个插槽对象上被保留
   * @internal
   */
  _?: SlotFlags
}

/**
 * 是否是内部的key
 * key为_开头
 * key是$stable
 * @param key 
 * @returns 
 */
const isInternalKey = (key: string) => key[0] === '_' || key === '$stable'

/**
 * 序列化插槽值
 * 如果插槽是数组，则对数组进行序列节点处理
 * 如果不是数组，直接对节点进行序列化处理
 * 并返回vnode节点数组
 * @param value 
 * @returns 
 */
const normalizeSlotValue = (value: unknown): VNode[] =>
  isArray(value)
    ? value.map(normalizeVNode)
    : [normalizeVNode(value as VNodeChild)]

/**
 * 序列化插槽
 * @param key 
 * @param rawSlot 
 * @param ctx 
 * @returns 
 */
const normalizeSlot = (
  key: string,
  rawSlot: Function,
  ctx: ComponentInternalInstance | null | undefined
): Slot => {
  if ((rawSlot as any)._n) {
    // already normalized - #5353
    return rawSlot as Slot
  }
  /**
   * 序列化带有实例
   */
  const normalized = withCtx((...args: any[]) => {
    if (__DEV__ && currentInstance) {
      // 开发者环境且存在当前实例进行警告
      //  槽"${key}"调用外部渲染函数:这将不会跟踪插槽中使用的依赖关系。
      // 调用render函数内部的slot函数
      warn(
        `Slot "${key}" invoked outside of the render function: ` +
          `this will not track dependencies used in the slot. ` +
          `Invoke the slot function inside the render function instead.`
      )
    }
    // 序列化插槽值返回节点数组
    return normalizeSlotValue(rawSlot(...args))
  }, ctx) as Slot
  // NOT a compiled slot
  // 不是一个被编译的插槽
  ;(normalized as ContextualRenderFn)._c = false
  return normalized
}

/**
 * 序列化对象插槽
 * @param rawSlots 
 * @param slots 
 * @param instance 
 */
const normalizeObjectSlots = (
  rawSlots: RawSlots,
  slots: InternalSlots,
  instance: ComponentInternalInstance
) => {
  // 获取原始插槽上下文
  const ctx = rawSlots._ctx
  // 遍历原始插槽
  for (const key in rawSlots) {
    // 如果key是内部key跳过
    if (isInternalKey(key)) continue
    // 获取插槽的值
    const value = rawSlots[key]
    // 如果值是一个函数，则序列化该插槽
    if (isFunction(value)) {
      slots[key] = normalizeSlot(key, value, ctx)
    } else if (value != null) {
      // 如果值不为null或undefined，
      // 上面也过滤掉了函数的情况，就是一个普通的值
      // 如果为开发者环境且不兼容vue2则警告
      if (
        __DEV__ &&
        !(
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.RENDER_FUNCTION, instance)
        )
      ) {
        warn(
          `Non-function value encountered for slot "${key}". ` +
            `Prefer function slots for better performance.`
        )
      }
      // 序列化插槽值的结果
      const normalized = normalizeSlotValue(value)
      // 添加序列化好的插槽
      slots[key] = () => normalized
    }
  }
}

/**
 * 序列化vnode插槽
 * 将children 放到插槽中
 * @param instance 
 * @param children 
 */
const normalizeVNodeSlots = (
  instance: ComponentInternalInstance,
  children: VNodeNormalizedChildren
) => {
  // 开发者环境且不是keep-alive节点且不兼容vue2，则警告
  if (
    __DEV__ &&
    !isKeepAlive(instance.vnode) &&
    !(__COMPAT__ && isCompatEnabled(DeprecationTypes.RENDER_FUNCTION, instance))
  ) {
    warn(
      `Non-function value encountered for default slot. ` +
        `Prefer function slots for better performance.`
    )
  }
  // 序列化
  const normalized = normalizeSlotValue(children)
  // 设置默认值
  instance.slots.default = () => normalized
}

/**
 * 初始化插槽
 * @param instance 
 * @param children 
 */
export const initSlots = (
  instance: ComponentInternalInstance,
  children: VNodeNormalizedChildren
) => {
  // 如果实例的vnode shapeFlag是插槽子节点
  if (instance.vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    // 获取子节点的插槽标记
    const type = (children as RawSlots)._
    // 存在标记
    if (type) {
      // users can get the shallow readonly version of the slots object through `this.$slots`,
      // we should avoid the proxy object polluting the slots of the internal instance
      // 用户可以获取的浅层的只读版本的插槽对象通过this.$slots
      // 我们应该避免代理对象污染内部实例的插槽
      // 实例的插槽，将children转化为原始值
      instance.slots = toRaw(children as InternalSlots)
      // make compiler marker non-enumerable
      // 使用编译器标记不可枚举
      def(children as InternalSlots, '_', type)
    } else {
      // 不存在标记，序列化
      normalizeObjectSlots(
        children as RawSlots,
        (instance.slots = {}),
        instance
      )
    }
  } else {
    // 不是插槽子节点
    instance.slots = {}
    // 且存在子节点
    if (children) {
      normalizeVNodeSlots(instance, children)
    }
  }
  // 定义实例的插槽值的内部标记为1
  def(instance.slots, InternalObjectKey, 1)
}

/**
 * 更新插槽
 * @param instance 
 * @param children 
 * @param optimized 
 */
export const updateSlots = (
  instance: ComponentInternalInstance,
  children: VNodeNormalizedChildren,
  optimized: boolean
) => {
  // 获取节点和插槽
  const { vnode, slots } = instance
  // 需要进行删除插槽检查，也就是有要删除的插槽
  let needDeletionCheck = true
  // 删除插槽默认为空对象
  let deletionComparisonTarget = EMPTY_OBJ
  // 如果节点是插槽的子节点
  if (vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    // 获取插槽标记
    const type = (children as RawSlots)._
    // 存在插槽标记
    if (type) {
      // compiled slots.
      // 编译插槽
      if (__DEV__ && isHmrUpdating) {
        // Parent was HMR updated so slot content may have changed.
        // force update slots and mark instance for hmr as well
        // 父节点是被热更新更新所以插槽内容可能发生改变
        // 强制更新插槽和标记实例热更新
        extend(slots, children as Slots)
      } else if (optimized && type === SlotFlags.STABLE) {
        // compiled AND stable.
        // no need to update, and skip stale slots removal.
        // 如果开启优化且插槽是静态插槽
        // 不需要更新，并且跳过废弃插槽移除
        needDeletionCheck = false
      } else {
        // compiled but dynamic (v-if/v-for on slots) - update slots, but skip
        // normalization.
        // 被编译且是动态的 比如(v-if,v-for在插槽上)更新插槽
        // 但跳过序列化
        extend(slots, children as Slots)
        // #2893
        // when rendering the optimized slots by manually written render function,
        // we need to delete the `slots._` flag if necessary to make subsequent updates reliable,
        // i.e. let the `renderSlot` create the bailed Fragment
        // 当正在渲染优化的插槽通过手写的渲染函数
        // 如果必要的话，我们需要删除这个插槽的标记
        // 这会使后续更新更可靠
        // 例如 让插槽渲染函数创建一个
        if (!optimized && type === SlotFlags.STABLE) {
          delete slots._
        }
      }
    } else {
      // 不存在插槽标记，则检查标记是看该子节点是不是静态节点
      needDeletionCheck = !(children as RawSlots).$stable
      // 序列化对象插槽
      normalizeObjectSlots(children as RawSlots, slots, instance)
    }
    // 删除后生成的节点（新插槽子节点的值）
    deletionComparisonTarget = children as RawSlots
  } else if (children) {
    // non slot object children (direct value) passed to a component
    // 传递给组件的非槽对象子对象(直接就是插槽值)
    normalizeVNodeSlots(instance, children)
    // 这时就只有default
    deletionComparisonTarget = { default: 1 }
  }

  // delete stale slots
  // 删除废弃的的插槽
  if (needDeletionCheck) {
    // 遍历插槽，并删除非内部插槽且新插槽中不包含
    for (const key in slots) {
      if (!isInternalKey(key) && !(key in deletionComparisonTarget)) {
        delete slots[key]
      }
    }
  }
}
