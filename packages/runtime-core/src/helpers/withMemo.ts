import { hasChanged } from '@vue/shared'
import { currentBlock, isBlockTreeEnabled, VNode } from '../vnode'

/**
 * 使用v-memo来控制，数据变化
 * 只有当v-memo指定的数组，每个值与原数据不相等或者数组长度变化时
 * 触发更新
 * @param memo 
 * @param render 
 * @param cache 
 * @param index 
 * @returns 
 */
export function withMemo(
  memo: any[],
  render: () => VNode<any, any>,
  cache: any[],
  index: number
) {
  const cached = cache[index] as VNode | undefined
  // 存在缓存值且是同一memo 则返回缓存值
  if (cached && isMemoSame(cached, memo)) {
    return cached
  }
  // 获取渲染节点
  const ret = render()

  // shallow clone
  // 浅克隆
  ret.memo = memo.slice()
  // 缓存并返回节点
  return (cache[index] = ret)
}

/**
 * 是同一个memo
 * @param cached 
 * @param memo 
 * @returns 
 */
export function isMemoSame(cached: VNode, memo: any[]) {
  // 获取之前的样子
  const prev: any[] = cached.memo!
  // 长度比较，不同则返回false
  if (prev.length != memo.length) {
    return false
  }

  // 某个点值不相同，返回false
  for (let i = 0; i < prev.length; i++) {
    if (hasChanged(prev[i], memo[i])) {
      return false
    }
  }

  // make sure to let parent block track it when returning cached
  // 保证让父节点跟踪它当返回缓存时
  if (isBlockTreeEnabled > 0 && currentBlock) {
    currentBlock.push(cached)
  }
  return true
}
