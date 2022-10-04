// 联合交叉
export type UnionToIntersection<U> = (
  // U是any，则返回一个函数，参数是U类型，否则返回never
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void // 推断参数，如果是联合类型，比如number|string的话，则推断不出I
  ? I // 拿到推断的参数
  : never

// make keys required but keep undefined values
// 将键设置为必需的，但保留未定义的值
export type LooseRequired<T> = { [P in string & keyof T]: T[P] }

// If the the type T accepts type "any", output type Y, otherwise output type N.
// https://stackoverflow.com/questions/49927523/disallow-call-with-any/49928360#49928360
// 貌似无论传什么值N都是false
// 除非传的是any，Y才会是true，通过这种方式可以判断出T是否是any
export type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N
