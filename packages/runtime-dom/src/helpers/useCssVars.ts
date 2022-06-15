import {
  getCurrentInstance,
  warn,
  VNode,
  Fragment,
  Static,
  watchPostEffect,
  onMounted,
  onUnmounted
} from '@vue/runtime-core'
import { ShapeFlags } from '@vue/shared'

/**
 * Runtime helper for SFC's CSS variable injection feature.
 * 运行时帮助函数用于sfc的css变量注入特性
 * @private
 */
export function useCssVars(getter: (ctx: any) => Record<string, string>) {
  if (!__BROWSER__ && !__TEST__) return

  const instance = getCurrentInstance()
  /* istanbul ignore next */
  if (!instance) {
    __DEV__ &&
      warn(`useCssVars is called without current active component instance.`)
    return
  }

  const setVars = () =>
    setVarsOnVNode(instance.subTree, getter(instance.proxy!))
  watchPostEffect(setVars)
  onMounted(() => {
    const ob = new MutationObserver(setVars)
    ob.observe(instance.subTree.el!.parentNode, { childList: true })
    onUnmounted(() => ob.disconnect())
  })
}

// 在虚拟节点上设置css变量
function setVarsOnVNode(vnode: VNode, vars: Record<string, string>) {
  // 如果是suspense节点
  if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
    const suspense = vnode.suspense!
    vnode = suspense.activeBranch!
    if (suspense.pendingBranch && !suspense.isHydrating) {
      suspense.effects.push(() => {
        // 将设置节点的操作放到组件suspense要加载的组件生成后
        setVarsOnVNode(suspense.activeBranch!, vars)
      })
    }
  }

  // drill down HOCs until it's a non-component vnode
  // 向下钻取hoc，直到它是非组件vnode
  while (vnode.component) {
    vnode = vnode.component.subTree
  }

  // 节点是元素
  if (vnode.shapeFlag & ShapeFlags.ELEMENT && vnode.el) {
    setVarsOnNode(vnode.el as Node, vars) // 设置节点变量
  } else if (vnode.type === Fragment) {
    // 节点是fragment，递归设置
    ;(vnode.children as VNode[]).forEach(c => setVarsOnVNode(c, vars))
  } else if (vnode.type === Static) {
    // 节点是静态类型
    let { el, anchor } = vnode
    while (el) { // 遍历并设置节点变量，一直设置到锚点，静态节点一般有一个起始点和一个结束点
      setVarsOnNode(el as Node, vars)
      if (el === anchor) break
      el = el.nextSibling
    }
  }
}

// 在节点上设置变量
function setVarsOnNode(el: Node, vars: Record<string, string>) {
  if (el.nodeType === 1) {
    // 如果节点是元素节点
    const style = (el as HTMLElement).style
    for (const key in vars) {
      style.setProperty(`--${key}`, vars[key])
    }
  }
}
