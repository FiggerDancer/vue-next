import LRU from 'lru-cache'

/**
 * 创建缓存，如果是全局注入或者浏览器注入esm模块
 * 则采用普通Map，否则使用LRU最近最少使用规则
 * @param size 
 * @returns 
 */
export function createCache<T>(size = 500) {
  return __GLOBAL__ || __ESM_BROWSER__
    ? new Map<string, T>()
    : (new LRU(size) as any as Map<string, T>)
}
