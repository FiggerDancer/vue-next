/* eslint-disable no-restricted-globals */

let decoder: HTMLDivElement

/**
 * 解码html浏览器
 * @param raw 
 * @param asAttr 
 * @returns 
 */
export function decodeHtmlBrowser(raw: string, asAttr = false): string {
  if (!decoder) {
    // 创建一个dom元素用于解析
    decoder = document.createElement('div')
  }
  // 搞一个foo专门用于模拟，然后拿返回值就行
  if (asAttr) {
    decoder.innerHTML = `<div foo="${raw.replace(/"/g, '&quot;')}">`
    return decoder.children[0].getAttribute('foo') as string
  } else {
    decoder.innerHTML = raw
    return decoder.textContent as string
  }
}
