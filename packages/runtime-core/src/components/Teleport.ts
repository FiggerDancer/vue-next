import { ComponentInternalInstance } from '../component'
import { SuspenseBoundary } from './Suspense'
import {
  RendererInternals,
  MoveType,
  RendererElement,
  RendererNode,
  RendererOptions,
  traverseStaticChildren
} from '../renderer'
import { VNode, VNodeArrayChildren, VNodeProps } from '../vnode'
import { isString, ShapeFlags } from '@vue/shared'
import { warn } from '../warning'
import { isHmrUpdating } from '../hmr'

export type TeleportVNode = VNode<RendererNode, RendererElement, TeleportProps>

// Teleport 传输组件，实现主要是挂载子元素时，直接挂载到对应的target上
// 当to或者disabled改变时，将挂载的子元素移动到新的目标或者主体容器上
// ssr注水时，要考虑多个元素指向同一个target时，
// 要以最后一个移动到target的节点为准

/**
 * 两个属性
 * to 目标
 * disabled 是否禁止，禁止的话  传输就不生效了
 */
export interface TeleportProps {
  to: string | RendererElement | null | undefined
  disabled?: boolean
}

/**
 * 是否是一个传送门
 * @param type
 * @returns 
 */
export const isTeleport = (type: any): boolean => type.__isTeleport

/**
 * 是否禁止传送
 * @param props 
 * @returns 
 */
const isTeleportDisabled = (props: VNode['props']): boolean =>
  props && (props.disabled || props.disabled === '')

/**
 * 是否是SVG元素
 * @param target 
 * @returns 
 */
const isTargetSVG = (target: RendererElement): boolean =>
  typeof SVGElement !== 'undefined' && target instanceof SVGElement

/**
 * 就是获取传送目的地dom元素
 * @param props 
 * @param select 
 * @returns 
 */
const resolveTarget = <T = RendererElement>(
  props: TeleportProps | null,
  select: RendererOptions['querySelector']
): T | null => {
  // 目标选择器
  const targetSelector = props && props.to
  // 选择器为字符串
  if (isString(targetSelector)) {
    // 不支持querySelector 则警告
    if (!select) {
      __DEV__ &&
        warn(
          `Current renderer does not support string target for Teleports. ` +
            `(missing querySelector renderer option)`
        )
      return null
    } else { // 有这个则去选择，返回dom节点
      const target = select(targetSelector)
      if (!target) {
        __DEV__ &&
          warn(
            `Failed to locate Teleport target with selector "${targetSelector}". ` +
              `Note the target element must exist before the component is mounted - ` +
              `i.e. the target cannot be rendered by the component itself, and ` +
              `ideally should be outside of the entire Vue component tree.`
          )
      }
      return target as T
    }
  } else {
    // 非字符串直接返回
    if (__DEV__ && !targetSelector && !isTeleportDisabled(props)) {
      warn(`Invalid Teleport target: ${targetSelector}`)
    }
    return targetSelector as T
  }
}

/**
 * 传送组件实现
 */
export const TeleportImpl = {
  __isTeleport: true,
  /**
   * 
   * @param n1 
   * @param n2 
   * @param container 
   * @param anchor 
   * @param parentComponent 
   * @param parentSuspense 
   * @param isSVG 
   * @param slotScopeIds 
   * @param optimized 
   * @param internals 
   */
  process(
    n1: TeleportVNode | null,
    n2: TeleportVNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean,
    internals: RendererInternals
  ) {
    const {
      mc: mountChildren,
      pc: patchChildren,
      pbc: patchBlockChildren,
      o: { insert, querySelector, createText, createComment }
    } = internals

    // 是否是禁止的
    const disabled = isTeleportDisabled(n2.props)
    // 获取新节点的状态
    let { shapeFlag, children, dynamicChildren } = n2

    // #3302
    // HMR updated, force full diff
    // 热更新，强制全量diff
    if (__DEV__ && isHmrUpdating) {
      optimized = false
      dynamicChildren = null
    }

    if (n1 == null) {
      // insert anchors in the main view
      // 在主视图中插入锚点
      // 占位符
      const placeholder = (n2.el = __DEV__
        ? createComment('teleport start')
        : createText(''))
      const mainAnchor = (n2.anchor = __DEV__
        ? createComment('teleport end')
        : createText(''))
      insert(placeholder, container, anchor)
      insert(mainAnchor, container, anchor)
      // 目标容器
      const target = (n2.target = resolveTarget(n2.props, querySelector))
      // 目标锚点
      const targetAnchor = (n2.targetAnchor = createText(''))
      if (target) {
        // 插入
        insert(targetAnchor, target)
        // #2652 we could be teleporting from a non-SVG tree into an SVG tree
        // 我们可能正从一个非svg树节点中将节点传到svg中
        isSVG = isSVG || isTargetSVG(target)
      } else if (__DEV__ && !disabled) {
        warn('Invalid Teleport target on mount:', target, `(${typeof target})`)
      }

      const mount = (container: RendererElement, anchor: RendererNode) => {
        // Teleport *always* has Array children. This is enforced in both the
        // compiler and vnode children normalization.
        // 传输总是数组节点。这在编译器和vnode子规范化中都是强制的。
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          mountChildren(
            children as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        }
      }

      // 如果传输被禁用了，则在容器中挂载
      if (disabled) {
        mount(container, mainAnchor)
      } else if (target) {
        // 如果没有被禁用，则将元素挂载到目标元素中
        mount(target, targetAnchor)
      }
    } else {
      // update content
      // 更新内容
      n2.el = n1.el
      const mainAnchor = (n2.anchor = n1.anchor)!
      const target = (n2.target = n1.target)!
      const targetAnchor = (n2.targetAnchor = n1.targetAnchor)!
      const wasDisabled = isTeleportDisabled(n1.props)
      const currentContainer = wasDisabled ? container : target
      const currentAnchor = wasDisabled ? mainAnchor : targetAnchor
      isSVG = isSVG || isTargetSVG(target)

      // 动态子节点
      if (dynamicChildren) {
        // fast path when the teleport happens to be a block root
        // 当传送恰好是块根时的快速路径
        patchBlockChildren(
          n1.dynamicChildren!,
          dynamicChildren,
          currentContainer,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds
        )
        // even in block tree mode we need to make sure all root-level nodes
        // in the teleport inherit previous DOM references so that they can
        // be moved in future patches.
        // 在块级树节点模式中，
        // 我们需要保证teleport继承上一个DOM引用所有的根级节点
        // 所以他们能够被移动到未来的更新中
        traverseStaticChildren(n1, n2, true)
      } else if (!optimized) {
        // 禁用优化
        patchChildren(
          n1,
          n2,
          currentContainer,
          currentAnchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          false
        )
      }

      // 禁用
      if (disabled) {
        // 之前没有被禁用
        if (!wasDisabled) {
          // enabled -> disabled
          // move into main container
          // 将enabled值设置为disabled
          // 将元素移动回主容器
          moveTeleport(
            n2,
            container,
            mainAnchor,
            internals,
            TeleportMoveTypes.TOGGLE
          )
        }
      } else {
        // target changed
        // 目标改变
        if ((n2.props && n2.props.to) !== (n1.props && n1.props.to)) {
          // 获取新目标
          const nextTarget = (n2.target = resolveTarget(
            n2.props,
            querySelector
          ))
          // 如果存在新目标，将元素移动到新目标
          if (nextTarget) {
            moveTeleport(
              n2,
              nextTarget,
              null,
              internals,
              TeleportMoveTypes.TARGET_CHANGE
            )
          } else if (__DEV__) {
            warn(
              'Invalid Teleport target on update:',
              target,
              `(${typeof target})`
            )
          }
        } else if (wasDisabled) {
          // 过去被禁止，现在不禁止
          // disabled -> enabled
          // move into teleport target
          // 移动到对应的目标中
          moveTeleport(
            n2,
            target,
            targetAnchor,
            internals,
            TeleportMoveTypes.TOGGLE
          )
        }
      }
    }
  },

  /**
   * 移除元素
   * @param vnode 
   * @param parentComponent 
   * @param parentSuspense 
   * @param optimized 
   * @param param4 
   * @param doRemove 
   */
  remove(
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    optimized: boolean,
    { um: unmount, o: { remove: hostRemove } }: RendererInternals,
    doRemove: Boolean
  ) {
    const { shapeFlag, children, anchor, targetAnchor, target, props } = vnode

    if (target) {
      hostRemove(targetAnchor!)
    }

    // an unmounted teleport should always remove its children if not disabled
    // 一个未挂载的teleport应该总是移除它的子元素如果没有被禁止
    if (doRemove || !isTeleportDisabled(props)) {
      // 移除锚点
      hostRemove(anchor!)
      if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        for (let i = 0; i < (children as VNode[]).length; i++) {
          const child = (children as VNode[])[i]
          unmount(
            child,
            parentComponent,
            parentSuspense,
            true,
            !!child.dynamicChildren
          )
        }
      }
    }
  },

  move: moveTeleport,
  hydrate: hydrateTeleport
}

export const enum TeleportMoveTypes {
  TARGET_CHANGE,
  TOGGLE, // enable / disable 启动/切换
  REORDER // moved in the main view 被移动到主视图
}

/**
 * 移动teleport
 * @param vnode 
 * @param container 
 * @param parentAnchor 
 * @param param3 
 * @param moveType 
 */
function moveTeleport(
  vnode: VNode,
  container: RendererElement,
  parentAnchor: RendererNode | null,
  { o: { insert }, m: move }: RendererInternals,
  moveType: TeleportMoveTypes = TeleportMoveTypes.REORDER
) {
  // move target anchor if this is a target change.
  // 如果这是一个目标改变，移动目标的锚点
  if (moveType === TeleportMoveTypes.TARGET_CHANGE) {
    insert(vnode.targetAnchor!, container, parentAnchor)
  }

  const { el, anchor, shapeFlag, children, props } = vnode
  const isReorder = moveType === TeleportMoveTypes.REORDER
  // move main view anchor if this is a re-order.
  // 如果重新排序，移动主视图的锚点
  if (isReorder) {
    // 插入元素
    insert(el!, container, parentAnchor)
  }
  // if this is a re-order and teleport is enabled (content is in target)
  // do not move children. So the opposite is: only move children if this
  // is not a reorder, or the teleport is disabled
  // 如果这是一个重新排序并且传输被启用，内容处于目标中则不再移动子节点
  // 所以对面的是：仅仅移动子节点如果这不是一个重新排序，或者传输被禁止了
  if (!isReorder || isTeleportDisabled(props)) {
    // Teleport has either Array children or no children.
    // 传输有数组子元素或者没有子元素。
    if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      for (let i = 0; i < (children as VNode[]).length; i++) {
        move(
          (children as VNode[])[i],
          container,
          parentAnchor,
          MoveType.REORDER
        )
      }
    }
  }
  // move main view anchor if this is a re-order.
  // 如果重新排序，则移动主要视图锚点
  if (isReorder) {
    insert(anchor!, container, parentAnchor)
  }
}

interface TeleportTargetElement extends Element {
  // last teleport target
  // 上一个传输目标的标记
  _lpa?: Node | null
}

/**
 * ssr注水
 * @param node 
 * @param vnode 
 * @param parentComponent 
 * @param parentSuspense 
 * @param slotScopeIds 
 * @param optimized 
 * @param param6 
 * @param hydrateChildren 
 * @returns 
 */
function hydrateTeleport(
  node: Node,
  vnode: TeleportVNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  slotScopeIds: string[] | null,
  optimized: boolean,
  {
    o: { nextSibling, parentNode, querySelector }
  }: RendererInternals<Node, Element>,
  hydrateChildren: (
    node: Node | null,
    vnode: VNode,
    container: Element,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => Node | null
): Node | null {
  const target = (vnode.target = resolveTarget<Element>(
    vnode.props,
    querySelector
  ))
  if (target) {
    // if multiple teleports rendered to the same target element, we need to
    // pick up from where the last teleport finished instead of the first node
    // 如果多个传输被渲染到相同的目标元素，
    // 我们要从最后一次传送结束的地方而不是第一个节点拾取物品
    const targetNode =
      (target as TeleportTargetElement)._lpa || target.firstChild
    // 如果节点包含多个节点
    if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      // 传输被禁止
      if (isTeleportDisabled(vnode.props)) {
        // 注水并获取锚点
        vnode.anchor = hydrateChildren(
          nextSibling(node),
          vnode,
          parentNode(node)!,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
        // 设置目标目标锚点
        vnode.targetAnchor = targetNode
      } else {
        // 下个节点
        vnode.anchor = nextSibling(node)
        // 注水并重新设置目标锚点

        // lookahead until we find the target anchor
        // we cannot rely on return value of hydrateChildren() because there
        // could be nested teleports
        let targetAnchor = targetNode
        while (targetAnchor) {
          targetAnchor = nextSibling(targetAnchor)
          if (
            targetAnchor &&
            targetAnchor.nodeType === 8 &&
            (targetAnchor as Comment).data === 'teleport anchor'
          ) {
            vnode.targetAnchor = targetAnchor
            ;(target as TeleportTargetElement)._lpa =
              vnode.targetAnchor && nextSibling(vnode.targetAnchor as Node)
            break
          }
        }

        hydrateChildren(
          targetNode,
          vnode,
          target,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
      }
    }
  }
  return vnode.anchor && nextSibling(vnode.anchor as Node)
}

// Force-casted public typing for h and TSX props inference
// 强制浇筑公共类型为h和tsx服务
export const Teleport = TeleportImpl as unknown as {
  __isTeleport: true
  new (): { $props: VNodeProps & TeleportProps }
}
