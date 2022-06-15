import { ReactiveEffect, trackOpBit } from './effect'

export type Dep = Set<ReactiveEffect> & TrackedMarkers

/**
 * wasTracked and newTracked maintain the status for several levels of effect
 * tracking recursion. One bit per level is used to define whether the dependency
 * was/is tracked.
 * wasTracked 和 newTracked为嵌套的副作用提供跟踪递归维护状态。每个嵌套的层级使用一位来定义是否跟踪依赖关系。
 */
type TrackedMarkers = {
  /**
   * wasTracked
   * 被跟踪
   */
  w: number
  /**
   * newTracked
   * 新跟踪
   */
  n: number
}

// 创建Dep
export const createDep = (effects?: ReactiveEffect[]): Dep => {
  const dep = new Set<ReactiveEffect>(effects) as Dep
  dep.w = 0
  dep.n = 0
  return dep
}

// 被跟踪
export const wasTracked = (dep: Dep): boolean => (dep.w & trackOpBit) > 0

// 新跟踪
export const newTracked = (dep: Dep): boolean => (dep.n & trackOpBit) > 0

// effect(() => {  // effectTrackDepth = 0  trackOpbit = 1 << 0
//   console.log(data.a) // data => 'a' => dep.tag |= trackOpbit        dep.tag = 1
//   effect(() => {  // effectTrackDepth = 1  trackOpbit = 1 << 1
//     console.log(data.a + 1) // data => 'a' => dep.tag |= trackOpbit  dep.tag = 3
//   })
// })
// 最后我们可以通过 dep.tag & 2 > 0  来判断该dep是否在特定的effect中使用过
// 其实这里就是借助了权限管理的知识，第一层的effect依赖不依赖1，第二层的依赖不依赖11，第三层的依赖不依赖111，只有有以一层不依赖了那这个dep.tag肯定就变了，但是你仔细想&的时候，只要当前这一层effect依赖它，这一层的就不用删


// 初始化Dep的标记数量
export const initDepMarkers = ({ deps }: ReactiveEffect) => {
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].w |= trackOpBit // set was tracked // 使用异或给该dep打标记
    }
  }
}

// 清理标记，同时清理不需要的依赖
export const finalizeDepMarkers = (effect: ReactiveEffect) => {
  const { deps } = effect
  if (deps.length) {
    let ptr = 0
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i]
      if (wasTracked(dep) && !newTracked(dep)) { // 如果这个副作用不在被跟踪，那就删除它
        dep.delete(effect)
      } else { // 如果跟踪那就把它重新放回数组
        deps[ptr++] = dep
      }
      // clear bits
      // 清理标记位，只是清除当前位
      dep.w &= ~trackOpBit
      dep.n &= ~trackOpBit
    }
    deps.length = ptr
  }
}
