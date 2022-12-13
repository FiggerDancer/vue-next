import { ReactiveEffect, trackOpBit } from './effect'

export type Dep = Set<ReactiveEffect> & TrackedMarkers

/**
 * wasTracked and newTracked maintain the status for several levels of effect
 * tracking recursion. One bit per level is used to define whether the dependency
 * was/is tracked.
 * wasTracked 和 newTracked为嵌套的副作用提供跟踪递归维护状态。
 * 每个嵌套的层级使用一位来定义是否跟踪依赖关系。
 * 由于存在递归嵌套执行effect函数的场景，需要通过按位标记记录各个层级的依赖状态
 * 然后设计了几个全局变量：effectTrackDepth、trackOpBit和maxMarkerBits
 */
type TrackedMarkers = {
  /**
   * wasTracked
   * 用于记录已经被收集的依赖
   */
  w: number
  /**
   * newTracked
   * 用于记录新依赖
   */
  n: number
}

/**
 * 创建依赖集合
 * 
 * 在3.0版本，每次执行副作用函数，都需要cleanup清除依赖
 * 这个过程涉及大量的对集合添加和删除操作
 * 在大多数情况下，依赖改变是很少的，存在优化空间
 * 为了减少集合的添加和删除操作，我们需要标识每个依赖集合的状态
 * 比如它是新收集的，还是已经被收集过的，所以这里需要给集合dep添加两个属性
 * @param effects 
 * @returns 
 */
export const createDep = (effects?: ReactiveEffect[]): Dep => {
  const dep = new Set<ReactiveEffect>(effects) as Dep
  // w的每一位代表这一位的层数有没有收集依赖
  dep.w = 0
  dep.n = 0
  return dep
}

/**
 * 是否已经被当前层收集为依赖
 * @param dep 
 * @returns 
 */
export const wasTracked = (dep: Dep): boolean => (dep.w & trackOpBit) > 0

/**
 * 是否是当前层的新依赖
 * @param dep 
 * @returns 
 */
export const newTracked = (dep: Dep): boolean => (dep.n & trackOpBit) > 0

// effect(() => {  // effectTrackDepth = 0  trackOpbit = 1 << 0
//   console.log(data.a) // data => 'a' => dep.tag |= trackOpbit        dep.tag = 1
//   effect(() => {  // effectTrackDepth = 1  trackOpbit = 1 << 1
//     console.log(data.a + 1) // data => 'a' => dep.tag |= trackOpbit  dep.tag = 3
//   })
// })
// 最后我们可以通过 dep.tag & 2 > 0  来判断该dep是否在特定的effect中使用过
// 其实这里就是借助了权限管理的知识，第一层的effect依赖不依赖1，第二层的依赖不依赖11，第三层的依赖不依赖111，只有有以一层不依赖了那这个dep.tag肯定就变了，但是你仔细想&的时候，只要当前这一层effect依赖它，这一层的就不用删


/**
 * 给依赖打标记
 * @param param0 
 */
export const initDepMarkers = ({ deps }: ReactiveEffect) => {
  // 给
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      // set was tracked 
      // 使用异或给该dep打标记
      // 标记当前层的依赖已经被收集
      deps[i].w |= trackOpBit 
    }
  }
}

/**
 * 清理标记，同时清理不需要的依赖
 * @param effect 
 */
export const finalizeDepMarkers = (effect: ReactiveEffect) => {
  const { deps } = effect
  if (deps.length) {
    let ptr = 0
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i]
      if (wasTracked(dep) && !newTracked(dep)) { 
        // 曾经被收集但不是新的依赖，需要删除
        dep.delete(effect)
      } else { 
        // 如果之前收集过那就把它重新放回数组
        deps[ptr++] = dep
      }
      // clear bits
      // 清理标记位，只是清除当前位，也就是当前层已经处理完
      dep.w &= ~trackOpBit
      dep.n &= ~trackOpBit
    }
    // 剩下的都是不要的了，直接删除
    deps.length = ptr
  }
}
