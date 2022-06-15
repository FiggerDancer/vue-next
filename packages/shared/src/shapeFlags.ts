export const enum ShapeFlags {
  ELEMENT = 1, // 元素
  FUNCTIONAL_COMPONENT = 1 << 1, // 函数组件，无状态组件
  STATEFUL_COMPONENT = 1 << 2, // 有状态组件
  TEXT_CHILDREN = 1 << 3, // 文本子节点
  ARRAY_CHILDREN = 1 << 4, // 数组子节点
  SLOTS_CHILDREN = 1 << 5, // 插槽子节点
  TELEPORT = 1 << 6, // 移动
  SUSPENSE = 1 << 7, // 悬疑
  COMPONENT_SHOULD_KEEP_ALIVE = 1 << 8, // 组件应该KEEP标记
  COMPONENT_KEPT_ALIVE = 1 << 9, // 组件已经被KEPT标记
  COMPONENT = ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.FUNCTIONAL_COMPONENT // 组件
}
