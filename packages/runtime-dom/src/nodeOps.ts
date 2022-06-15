import { RendererOptions } from '@vue/runtime-core'

export const svgNS = 'http://www.w3.org/2000/svg'

const doc = (typeof document !== 'undefined' ? document : null) as Document

const templateContainer = doc && doc.createElement('template')

// 节点操作 这个nodeOps里的类型是RendererOptions<Node, Element>中除了patchProp其他所有键值对组成的对象
export const nodeOps: Omit<RendererOptions<Node, Element>, 'patchProp'> = {
  // 插入，anchor是一个锚点
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
  // 创建节点  标签、是否是SVG，
  createElement: (tag, isSVG, is, props): Element => {
    const el = isSVG
      ? doc.createElementNS(svgNS, tag) // svg创建svg标签
      : doc.createElement(tag, is ? { is } : undefined) // 非svg需要去处理is
    // 标签如果是select的话，那要对他的mulitiple单独处理，就是多选
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
  // 设置元素的文本
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
  // 克隆节点
  cloneNode(el) {
    const cloned = el.cloneNode(true) // el.cloneNode(deep) // 是否是深拷贝
    // #3072
    // - in `patchDOMProp`, we store the actual value in the `el._value` property.
    // - normally, elements using `:value` bindings will not be hoisted, but if
    //   the bound value is a constant, e.g. `:value="true"` - they do get
    //   hoisted.
    // - in production, hoisted nodes are cloned when subsequent inserts, but
    //   cloneNode() does not copy the custom property we attached.
    // - This may need to account for other custom DOM properties we attach to
    //   elements in addition to `_value` in the future.
    // 在更新dom的属性时，我们会存储真实的值在  `el._value` 这个属性里，
    // 一般来说，元素使用 `:value` 绑定不会不会被挂起的
    // 但如果被绑定的值时一个常量 比如 `:value="true"` 这时也会挂起这个值
    // 在生产环境中， 当插入节点后，挂起的节点被克隆，但是这个克隆的节点是不会拷贝我们自定义的属性的
    // 这可能需要考虑到将来除了' _value '之外附加到元素的其他定制DOM属性。
    if (`_value` in el) {
      ;(cloned as any)._value = (el as any)._value
    }
    return cloned
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
