export const enum SlotFlags {
  /**
   * Stable slots that only reference slot props or context state. The slot
   * can fully capture its own dependencies so when passed down the parent won't need to force the child to update.
   * need to force the child to update.
   * 只引用槽属性或上下文状态的稳定槽。
   * 插槽可以完全捕获它自己的依赖，所以当传递给父节点时，
   * 父节点不需要强制子节点进行更新。
   */
  STABLE = 1,
  /**
   * Slots that reference scope variables (v-for or an outer slot prop), or
   * has conditional structure (v-if, v-for). The parent will need to force
   * the child to update because the slot does not fully capture its dependencies.
   * 引用范围变量(v-for或外部槽支柱)，或具有条件结构(v-if, v-for)的槽。
   * 父节点将需要强制子节点更新，因为槽没有完全捕获它的依赖项。
   */
  DYNAMIC = 2,
  /**
   * `<slot/>` being forwarded into a child component. Whether the parent needs
   * to update the child is dependent on what kind of slots the parent itself
   * received. This has to be refined at runtime, when the child's vnode
   * is being created (in `normalizeChildren`)
   *  ' <slot/> '被转发到子组件中。父节点是否需要更新子节点取决于父节点本身接收到的槽类型。
   * 这必须在运行时进行优化，当子节点的vnode被创建时(在' normalizeChildren '中)
   */
  FORWARDED = 3
}

/**
 * Dev only
 */
export const slotFlagsText = {
  [SlotFlags.STABLE]: 'STABLE',
  [SlotFlags.DYNAMIC]: 'DYNAMIC',
  [SlotFlags.FORWARDED]: 'FORWARDED'
}
