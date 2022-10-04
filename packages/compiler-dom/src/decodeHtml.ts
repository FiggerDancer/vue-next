import { ParserOptions } from '@vue/compiler-core'
import namedCharacterReferences from './namedChars.json'

class  Basic {
  private _components: Record<string, Basic> = {}
}

// lazy compute this to make this file tree-shakable for browser
// 惰性计算使这个文件在浏览器中可以摇树
let maxCRNameLength: number

/**
 * 解码html
 * @param rawText 原始文本
 * @param asAttr 作为属性
 * @returns 
 */
export const decodeHtml: ParserOptions['decodeEntities'] = (
  rawText,
  asAttr
) => {
  // 偏离位置
  let offset = 0
  // 原始文本末尾位置
  const end = rawText.length
  // 解码文本
  let decodedText = ''

  // 前进
  function advance(length: number) {
    offset += length
    rawText = rawText.slice(length)
  }

  // 还没有超出
  while (offset < end) {
    // 匹配 &, &#, &#x
    const head = /&(?:#x?)?/i.exec(rawText)
    if (!head || offset + head.index >= end) {
      // 如果超出或者没有匹配到
      // 记录剩余文本数
      const remaining = end - offset
      // 将剩余文本加入
      decodedText += rawText.slice(0, remaining)
      advance(remaining)
      break
    }

    // Advance to the "&".
    // 前进到&符号
    decodedText += rawText.slice(0, head.index)
    advance(head.index)

    if (head[0] === '&') {
      // Named character reference.
      // 命名字符引用
      let name = ''
      let value: string | undefined = undefined
      if (/[0-9a-z]/i.test(rawText[1])) {
        // 获取最大解析的命名长度
        if (!maxCRNameLength) {
          maxCRNameLength = Object.keys(namedCharacterReferences).reduce(
            (max, name) => Math.max(max, name.length),
            0
          )
        }
        for (let length = maxCRNameLength; !value && length > 0; --length) {
          // 按照长度由多到少的顺序，从需要解码的Map集合中寻找解码后的值
          name = rawText.slice(1, 1 + length)
          value = (namedCharacterReferences as Record<string, string>)[name]
        }
        if (value) {
          // 如果name以;结尾，则对其进行标记
          const semi = name.endsWith(';')
          // 如果是作为属性的一部分且没有以;结尾而是后面跟着=或者字母数字
          if (
            asAttr &&
            !semi &&
            /[=a-z0-9]/i.test(rawText[name.length + 1] || '')
          ) {
            // 则将本部分直接原文放入
            decodedText += '&' + name
            advance(1 + name.length)
          } else {
            // 将解码后的值放入
            decodedText += value
            advance(1 + name.length)
          }
        } else {
          // 没有匹配到对应的值，原文放入
          decodedText += '&' + name
          advance(1 + name.length)
        }
      } else {
        // &后面没有跟数字或者字母
        decodedText += '&'
        advance(1)
      }
    } else {
      // Numeric character reference.
      // 数字字符串引用
      const hex = head[0] === '&#x'
      const pattern = hex ? /^&#x([0-9a-f]+);?/i : /^&#([0-9]+);?/
      const body = pattern.exec(rawText)
      // 没有匹配到内容
      if (!body) {
        // 增加解码文本
        decodedText += head[0]
        // 前进
        advance(head[0].length)
      } else {
        // https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
        let cp = Number.parseInt(body[1], hex ? 16 : 10)
        if (cp === 0) {
          cp = 0xfffd
        } else if (cp > 0x10ffff) {
          cp = 0xfffd
        } else if (cp >= 0xd800 && cp <= 0xdfff) {
          cp = 0xfffd
        } else if ((cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe) {
          // noop
        } else if (
          (cp >= 0x01 && cp <= 0x08) ||
          cp === 0x0b ||
          (cp >= 0x0d && cp <= 0x1f) ||
          (cp >= 0x7f && cp <= 0x9f)
        ) {
          cp = CCR_REPLACEMENTS[cp] || cp
        }
        decodedText += String.fromCodePoint(cp)
        advance(body[0].length)
      }
    }
  }
  return decodedText
}

// https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
/**
 * 数字字符引用结束状态 映射表
 */
const CCR_REPLACEMENTS: Record<number, number | undefined> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178
}
