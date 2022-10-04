import {
  ObjectDirective,
  VNode,
  DirectiveHook,
  DirectiveBinding,
  warn
} from '@vue/runtime-core'
import { addEventListener } from '../modules/events'
import {
  isArray,
  looseEqual,
  looseIndexOf,
  invokeArrayFns,
  toNumber,
  isSet
} from '@vue/shared'

type AssignerFn = (value: any) => void

// 获取v-model指定函数
const getModelAssigner = (vnode: VNode): AssignerFn => {
  const fn =
    vnode.props!['onUpdate:modelValue'] ||
    (__COMPAT__ && vnode.props!['onModelCompat:input'])
  // 数组重写一个总函数里面会依次调用数组中的函数，否则就返回当前函数
  return isArray(fn) ? value => invokeArrayFns(fn, value) : fn
}

// 监听文本合成开始
function onCompositionStart(e: Event) {
  ;(e.target as any).composing = true
}

// 监听文本合成结束
function onCompositionEnd(e: Event) {
  const target = e.target as any
  if (target.composing) {
    target.composing = false
    // 结束的时候触发input
    target.dispatchEvent(new Event('input'))
  }
}

// 触发事件
// Model指令，指定函数
type ModelDirective<T> = ObjectDirective<T & { _assign: AssignerFn }>

// We are exporting the v-model runtime directly as vnode hooks so that it can
// be tree-shaken in case v-model is never used.
// 我们将v-model运行时直接导出为vnode挂钩，这样它就可以
// 在v-model从未使用的情况下进行摇树
export const vModelText: ModelDirective<
  HTMLInputElement | HTMLTextAreaElement
> = {
  // create钩子
  created(el, { modifiers: { lazy, trim, number } }, vnode) {
    // 指控器
    el._assign = getModelAssigner(vnode)
    // 转化成数字
    const castToNumber =
      number || (vnode.props && vnode.props.type === 'number')
    // 监听事件，如果是懒监听，则change，否则input
    addEventListener(el, lazy ? 'change' : 'input', e => {
      // 书写中文，则停止修改value
      if ((e.target as any).composing) return
      let domValue: string | number = el.value
      if (trim) {
        // 删除空格
        domValue = domValue.trim()
      }
      if (castToNumber) {
        // 需要转化数字
        domValue = toNumber(domValue)
      }
      // 修改值
      el._assign(domValue)
    })
    if (trim) {
      addEventListener(el, 'change', () => {
        el.value = el.value.trim()
      })
    }
    if (!lazy) {
      // 监听文本合成开始
      addEventListener(el, 'compositionstart', onCompositionStart)
      // 监听文本合成结束
      addEventListener(el, 'compositionend', onCompositionEnd)
      // Safari < 10.2 & UIWebView doesn't fire compositionend when
      // switching focus before confirming composition choice
      // this also fixes the issue where some browsers e.g. iOS Chrome
      // fires "change" instead of "input" on autocomplete.
      // safari低于10.2版本 
      // 在确认文本输入之前，切换焦点，
      // UIWebView不会触发文本合成结束事件
      // 这也修复了一些浏览器的问题，如iOS Chrome 触发"change"而不是"input"。
      // 监听change结束
      addEventListener(el, 'change', onCompositionEnd)
    }
  },
  // set value on mounted so it's after min/max for type="range"
  // 设置值在mounted钩子中，所以这一步的操作应该是type=“range” min/max后
  mounted(el, { value }) {
    el.value = value == null ? '' : value
  },
  // 更新钩子中
  beforeUpdate(el, { value, modifiers: { lazy, trim, number } }, vnode) {
    // 指控函数
    el._assign = getModelAssigner(vnode)
    // avoid clearing unresolved text. #2302
    // 避免清理未解决的文本
    if ((el as any).composing) return
    // 如果当前元素是焦点元素
    if (document.activeElement === el && el.type !== 'range') {
      // 如果有lazy后缀
      if (lazy) {
        return
      }
      // 如果有trim后缀
      if (trim && el.value.trim() === value) {
        return
      }
      // 如果有number后缀，input类型是数字，那就把值转化成数字
      if ((number || el.type === 'number') && toNumber(el.value) === value) {
        return
      }
    }
    // 赋新值
    const newValue = value == null ? '' : value
    if (el.value !== newValue) {
      el.value = newValue
    }
  }
}

// v-model checkbox
export const vModelCheckbox: ModelDirective<HTMLInputElement> = {
  // #4096 array checkboxes need to be deep traversed
  // 数组复选框需要深入遍历
  deep: true,
  created(el, _, vnode) {
    // 虚拟节点的指控器
    el._assign = getModelAssigner(vnode)
    // 监听change事件
    addEventListener(el, 'change', () => {
      // modelValue
      const modelValue = (el as any)._modelValue
      // 元素值
      const elementValue = getValue(el)
      // checked
      const checked = el.checked
      // 指控器
      const assign = el._assign
      // 数组
      if (isArray(modelValue)) {
        // 从数组中找当前值元素的值存在不存在
        const index = looseIndexOf(modelValue, elementValue)
        const found = index !== -1
        if (checked && !found) {
          // 合并
          assign(modelValue.concat(elementValue))
        } else if (!checked && found) {
          // 复制，过滤，通过指控器修改
          const filtered = [...modelValue]
          filtered.splice(index, 1)
          assign(filtered)
        }
      } else if (isSet(modelValue)) {
        // Set 克隆当前set
        const cloned = new Set(modelValue)
        // 添加
        if (checked) {
          cloned.add(elementValue)
        } else {
          cloned.delete(elementValue)
        }
        // 通过指控器修改
        assign(cloned)
      } else {
        // 通过指控器修改
        assign(getCheckboxValue(el, checked))
      }
    })
  },
  // set initial checked on mount to wait for true-value/false-value
  // 设置初始化checked值在挂载之后，等待是true-value还是false-value
  mounted: setChecked,
  beforeUpdate(el, binding, vnode) {
    // 指控器
    el._assign = getModelAssigner(vnode)
    setChecked(el, binding, vnode)
  }
}

// 设置domU元素的checked属性
function setChecked(
  el: HTMLInputElement,
  { value, oldValue }: DirectiveBinding,
  vnode: VNode
) {
  // store the v-model value on the element so it can be accessed by the
  // change listener.
  // 存储v-model的值在元素上，当change事件触发时能够生效
  ;(el as any)._modelValue = value
  // 通过值的包含关系，值的相等关系，判断选中元素包含不包含当前元素
  if (isArray(value)) {
    // 数组，循环索引
    el.checked = looseIndexOf(value, vnode.props!.value) > -1
  } else if (isSet(value)) {
    // Set 用has
    el.checked = value.has(vnode.props!.value)
  } else if (value !== oldValue) {
    // 不相等，用两值前后是否相等
    el.checked = looseEqual(value, getCheckboxValue(el, true))
  }
}

// v-model radio元素
export const vModelRadio: ModelDirective<HTMLInputElement> = {
  created(el, { value }, vnode) {
    // 创建后，可与选中的值是否相等，相等则是被选中状态
    el.checked = looseEqual(value, vnode.props!.value)
    // 指控器
    el._assign = getModelAssigner(vnode)
    addEventListener(el, 'change', () => {
      // 指控器修改值
      el._assign(getValue(el))
    })
  },
  beforeUpdate(el, { value, oldValue }, vnode) {
    el._assign = getModelAssigner(vnode)
    // 如果不相等，则修改dom值
    if (value !== oldValue) {
      el.checked = looseEqual(value, vnode.props!.value)
    }
  }
}

export const vModelSelect: ModelDirective<HTMLSelectElement> = {
  // <select multiple> value need to be deep traversed
  // 多选的值需要被深度递归
  deep: true,
  created(el, { value, modifiers: { number } }, vnode) {
    const isSetModel = isSet(value)
    // Set
    addEventListener(el, 'change', () => {
      const selectedVal = Array.prototype.filter
        .call(el.options, (o: HTMLOptionElement) => o.selected)
        .map((o: HTMLOptionElement) =>
          number ? toNumber(getValue(o)) : getValue(o)
        )
      // 数组过滤options中选择的值，需要保证selected的值是true
      // 数字修饰符则要转化成数字
      el._assign(
        // 多个值
        el.multiple
          ? isSetModel // 是Set
            ? new Set(selectedVal)
            : selectedVal // 数组获取数组
          : selectedVal[0] // 单个值后去第一个
      )
    })
    el._assign = getModelAssigner(vnode)
  },
  // set value in mounted & updated because <select> relies on its children
  // <option>s.
  // 在mounted & updated中设置值，因为<select>依赖于它的子节点 <option>
  mounted(el, { value }) {
    setSelected(el, value)
  },
  beforeUpdate(el, _binding, vnode) {
    el._assign = getModelAssigner(vnode)
  },
  updated(el, { value }) {
    setSelected(el, value)
  }
}

function setSelected(el: HTMLSelectElement, value: any) {
  const isMultiple = el.multiple
  if (isMultiple && !isArray(value) && !isSet(value)) {
    __DEV__ &&
      warn(
        `<select multiple v-model> expects an Array or Set value for its binding, ` +
          `but got ${Object.prototype.toString.call(value).slice(8, -1)}.`
      )
    return
  }
  for (let i = 0, l = el.options.length; i < l; i++) {
    const option = el.options[i]
    const optionValue = getValue(option)
    if (isMultiple) {
      if (isArray(value)) {
        option.selected = looseIndexOf(value, optionValue) > -1
      } else {
        option.selected = value.has(optionValue)
      }
    } else {
      if (looseEqual(getValue(option), value)) {
        if (el.selectedIndex !== i) el.selectedIndex = i
        return
      }
    }
  }
  if (!isMultiple && el.selectedIndex !== -1) {
    el.selectedIndex = -1
  }
}

// retrieve raw value set via :value bindings
// 检索通过:value绑定设置的原始值
function getValue(el: HTMLOptionElement | HTMLInputElement) {
  return '_value' in el ? (el as any)._value : el.value
}

// retrieve raw value for true-value and false-value set via :true-value or :false-value bindings
//  检索通过:true-value或:false-value绑定设置的真值和假值的原始值
function getCheckboxValue(
  el: HTMLInputElement & { _trueValue?: any; _falseValue?: any },
  checked: boolean
) {
  const key = checked ? '_trueValue' : '_falseValue'
  return key in el ? el[key] : checked
}

// 动态v-model
export const vModelDynamic: ObjectDirective<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
> = {
  // 总之就是调用各种钩子
  created(el, binding, vnode) {
    // 调用created钩子
    callModelHook(el, binding, vnode, null, 'created')
  },
  // updated
  mounted(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, 'mounted')
  },
  // beforeUpdate
  beforeUpdate(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, 'beforeUpdate')
  },
  // updated
  updated(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, 'updated')
  }
}

function resolveDynamicModel(tagName: string, type: string | undefined) {
  switch (tagName) {
    case 'SELECT':
      // v-model select
      return vModelSelect
    case 'TEXTAREA':
      // textarea v-model
      return vModelText
    default:
      switch (type) {
        case 'checkbox':
          // v-model checkbox
          return vModelCheckbox
        case 'radio':
          // v-model radio
          return vModelRadio
        default:
          // v-model text
          return vModelText
      }
  }
}

function callModelHook(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  binding: DirectiveBinding,
  vnode: VNode,
  prevVNode: VNode | null,
  hook: keyof ObjectDirective
) {
  const modelToUse = resolveDynamicModel(
    el.tagName,
    vnode.props && vnode.props.type
  )
  // 钩子函数
  const fn = modelToUse[hook] as DirectiveHook
  // 不同标签调用对应的不同钩子函数
  fn && fn(el, binding, vnode, prevVNode)
}

// SSR vnode transforms, only used when user includes client-oriented render
// function in SSR
// SSR vnode转换，仅在用户包含面向客户端的渲染时使用在SSR中调用函数
export function initVModelForSSR() {
  // v-model text
  vModelText.getSSRProps = ({ value }) => ({ value })
  // v-model radio
  vModelRadio.getSSRProps = ({ value }, vnode) => {
    // 是否相等
    if (vnode.props && looseEqual(vnode.props.value, value)) {
      return { checked: true }
    }
  }

  // v0model checkbox 获取ssr 属性
  vModelCheckbox.getSSRProps = ({ value }, vnode) => {
    if (isArray(value)) { // 数组中包含
      if (vnode.props && looseIndexOf(value, vnode.props.value) > -1) {
        return { checked: true }
      }
    } else if (isSet(value)) { // Set中包含
      if (vnode.props && value.has(vnode.props.value)) {
        return { checked: true }
      }
    } else if (value) { // 普通值
      return { checked: true }
    }
  }

  vModelDynamic.getSSRProps = (binding, vnode) => {
    if (typeof vnode.type !== 'string') {
      return
    }
    const modelToUse = resolveDynamicModel(
      // resolveDynamicModel expects an uppercase tag name, but vnode.type is lowercase
      vnode.type.toUpperCase(),
      vnode.props && vnode.props.type
    )
    if (modelToUse.getSSRProps) {
      return modelToUse.getSSRProps(binding, vnode)
    }
  }
}
