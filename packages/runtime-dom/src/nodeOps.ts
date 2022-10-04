import { RendererOptions } from '@vue/runtime-core'

export const svgNS = 'http://www.w3.org/2000/svg'

const doc = (typeof document !== 'undefined' ? document : null) as Document

const templateContainer = doc && /*#__PURE__*/ doc.createElement('template')

// 节点操作 这个nodeOps里的类型是RendererOptions<Node, Element>中除了patchProp其他所有键值对组成的对象
export const nodeOps: Omit<RendererOptions<Node, Element>, 'patchProp'> = {
  /**
   * 插入
   * @param child 插入节点
   * @param parent 插入节点的父节点
   * @param anchor child插入的参考节点
   */
  insert: (child, parent, anchor) => {
    parent.insertBefore(child, anchor || null)
  },
  // 移除
  remove: child => {
    const parent = child.parentNode
    if (parent) {
      parent.removeChild(child)
    }
  },
  /**
   * 创建元素
   * 底层最终还是通过 document.createElement
   * 或者document.createElementNS来创建元素
   * 对比其他平台（如Weex），hostCreateElement函数就不再操作DOM
   * 而是操作平台相关的API
   * 这些与平台相关的函数是在创建渲染器阶段作为参数传入的
   * @param tag 标签
   * @param isSVG 是否是svg
   * @param is 表示用户创建Web Component规范的自定义标签
   * @param props 额外属性
   * @returns 
   */
  createElement: (tag, isSVG, is, props): Element => {
    const el = isSVG
      ? doc.createElementNS(svgNS, tag) // svg创建svg标签
      : doc.createElement(tag, is ? { is } : undefined) // 非svg需要去处理is
    // 标签如果是select的话，那要对他的mulitiple单独处理，就是多选
    // 处理Select标签多选属性
    if (tag === 'select' && props && props.multiple != null) {
      ;(el as HTMLSelectElement).setAttribute('multiple', props.multiple)
    }

    return el
  },
  // 创建文本节点
  createText: text => doc.createTextNode(text),
  // 创建注释
  createComment: text => doc.createComment(text),
  // 设置节点文本                            
  setText: (node, text) => {
    node.nodeValue = text
  },
  /**
   * 设置元素的文本
   * @param el 
   * @param text 
   */
  setElementText: (el, text) => {
    el.textContent = text
  },
  // 返回父节点
  parentNode: node => node.parentNode as Element | null,
  // 返回下一个兄弟节点
  nextSibling: node => node.nextSibling,
  // 查询
  querySelector: selector => doc.querySelector(selector),
  // 设置作用域id（给style scoped）用的
  setScopeId(el, id) {
    el.setAttribute(id, '')
  },

  // __UNSAFE__
  // Reason: innerHTML.
  // Static content here can only come from compiled templates.
  // As long as the user only uses trusted templates, this is safe.
  // 不安全
  // 原因：innerHTML
  // 静态内容在这里可能仅仅来自于编译后的模板字符串（template)
  // 只有用户使用信任的模板template，才是安全的
  // 插入静态内容 内容，父节点，锚点，起始点，终点，是否是svg
  insertStaticContent(content, parent, anchor, isSVG, start, end) {
    // <parent> before | first ... last | anchor </parent>
    // 在before和anchor之间创建
    // 如果没有锚点，就添加到父元素尾部
    const before = anchor ? anchor.previousSibling : parent.lastChild
    // #5308 can only take cached path if:
    // - has a single root node
    // - nextSibling info is still available
    // 只能在以下情况都符合一样才能使用缓存结构：
    // 1. 要么只有一个根节点 start === end
    // 2. 要么下个兄弟节点的信息是可以获得的 start.nextSibling
    if (start && (start === end || start.nextSibling)) {
      // cached
      // 使用缓存的，就是刚刚克隆过的
      while (true) {
        parent.insertBefore(start!.cloneNode(true), anchor)
        // 但一个节点，你渲染完一个就没有了可以结束了所以break；
        // 多个节点，你每一次去挂载一个节点然后下个节点来，一直到没有下一个节点才算结束
        if (start === end || !(start = start!.nextSibling)) break
      }
    } else {
      // fresh insert 插入新的
      templateContainer.innerHTML = isSVG ? `<svg>${content}</svg>` : content
      const template = templateContainer.content
      if (isSVG) {
        // remove outer svg wrapper
        // 移除外面的svg包裹
        const wrapper = template.firstChild!
        while (wrapper.firstChild) {
          template.appendChild(wrapper.firstChild)
        }
        template.removeChild(wrapper)
      }
      parent.insertBefore(template, anchor)
    }
    return [
      // first 插入起始点
      before ? before.nextSibling! : parent.firstChild!,
      // last 插入的终止点
      anchor ? anchor.previousSibling! : parent.lastChild!
    ]
  }
}
