/**
 * Make a map and return a function for checking if a key
 * is in that map.
 * IMPORTANT: all calls of this function must be prefixed with
 * \/\*#\_\_PURE\_\_\*\/
 * So that rollup can tree-shake them if necessary.
 * 创建一个映射表并且返回一个函数，这个函数能够判断某个值是否存在于这个映射表中
 * 重要：使用这个函数时，应该加一个\/\*#\_\_PURE\_\_\*\/标记，表示无副作用，用于打包工具摇树
 * 关于标记我比较好奇，想了想是因为对传入的参数进行了读取，比如一些读取操作可能会产生副作用，最典型的就是Proxy和defineProperty
 */
export function makeMap(
  str: string,
  expectsLowerCase?: boolean
): (key: string) => boolean {
  const map: Record<string, boolean> = Object.create(null)
  const list: Array<string> = str.split(',')
  for (let i = 0; i < list.length; i++) {
    map[list[i]] = true
  }
  // 忽视大小写
  return expectsLowerCase ? val => !!map[val.toLowerCase()] : val => !!map[val]
}
