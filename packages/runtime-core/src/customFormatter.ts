import { isReactive, isReadonly, isRef, Ref, toRaw } from '@vue/reactivity'
import { EMPTY_OBJ, extend, isArray, isFunction, isObject } from '@vue/shared'
import { isShallow } from '../../reactivity/src/reactive'
import { ComponentInternalInstance, ComponentOptions } from './component'
import { ComponentPublicInstance } from './componentPublicInstance'

// 文件用于开发者工具

/**
 * 初始化自定义格式器 用于控制台打印
 * @returns 
 */
export function initCustomFormatter() {
  /* eslint-disable no-restricted-globals */
  if (!__DEV__ || typeof window === 'undefined') {
    return
  }

  // 设置各种颜色
  const vueStyle = { style: 'color:#3ba776' }
  const numberStyle = { style: 'color:#0b1bc9' }
  const stringStyle = { style: 'color:#b62e24' }
  const keywordStyle = { style: 'color:#9d288c' }

  // custom formatter for Chrome
  // 自定义格式器为Chrome开发者工具
  // https://www.mattzeunert.com/2016/02/19/custom-chrome-devtools-object-formatters.html
  const formatter = {
    /**
     * 标头
     */
    header(obj: unknown) {
      // TODO also format ComponentPublicInstance & ctx.slots/attrs in setup
      // TODO也格式化ComponentPublicInstance & ctx.slots/ attrs设置
      // 不是对象返回null
      if (!isObject(obj)) {
        return null
      }

      if (obj.__isVue) {
        // obj是vue组件，返回一个div，样式上使用vue的绿色，然后
        return ['div', vueStyle, `VueInstance`]
      } else if (isRef(obj)) {
        // 如果是一个ref， div，包含内容，样式上使用vue的绿色
        return [
          'div',
          {},
          ['span', vueStyle, genRefFlag(obj)],
          '<',
          formatValue(obj.value),
          `>`
        ]
      } else if (isReactive(obj)) {
        // reactive
        return [
          'div',
          {},
          ['span', vueStyle, isShallow(obj) ? 'ShallowReactive' : 'Reactive'],
          '<',
          formatValue(obj),
          `>${isReadonly(obj) ? ` (readonly)` : ``}`
        ]
      } else if (isReadonly(obj)) {
        // 只读
        return [
          'div',
          {},
          ['span', vueStyle, isShallow(obj) ? 'ShallowReadonly' : 'Readonly'],
          '<',
          formatValue(obj),
          '>'
        ]
      }
      return null
    },
    /**
     * 有body
     * @param obj 
     * @returns 
     */
    hasBody(obj: unknown) {
      // 是不是一个vue组件
      return obj && (obj as any).__isVue
    },
    /**
     * body
     * @param obj 
     * @returns 
     */
    body(obj: unknown) {
      if (obj && (obj as any).__isVue) {
        // 是vue组件则有body
        return [
          'div',
          {},
          ...formatInstance((obj as ComponentPublicInstance).$)
        ]
      }
    }
  }

  /**
   * 格式化实例
   * @param instance 
   * @returns 
   */
  function formatInstance(instance: ComponentInternalInstance) {
    // 块
    const blocks = []
    // 实例的组件的props存在，且实例的props存在，则添加props块
    if (instance.type.props && instance.props) {
      blocks.push(createInstanceBlock('props', toRaw(instance.props)))
    }
    // 如果实例的setupState不为空对象，则添加setupState块
    if (instance.setupState !== EMPTY_OBJ) {
      blocks.push(createInstanceBlock('setup', instance.setupState))
    }
    // 如果实例的data不为空对象，则添加data块
    if (instance.data !== EMPTY_OBJ) {
      blocks.push(createInstanceBlock('data', toRaw(instance.data)))
    }
    // 如果实例的computed存在，则创建computed块
    const computed = extractKeys(instance, 'computed')
    if (computed) {
      blocks.push(createInstanceBlock('computed', computed))
    }
    // 如果实例的inject在，创建inject块
    const injected = extractKeys(instance, 'inject')
    if (injected) {
      blocks.push(createInstanceBlock('injected', injected))
    }

    // 一个实例小尾巴，放一个内部值的块
    blocks.push([
      'div',
      {},
      [
        'span',
        {
          style: keywordStyle.style + ';opacity:0.66'
        },
        '$ (internal): '
      ],
      ['object', { object: instance }]
    ])
    return blocks
  }

  /**
   * 创建实例块
   * @param type 
   * @param target 
   * @returns 
   */
  function createInstanceBlock(type: string, target: any) {
    // 浅拷贝对象
    target = extend({}, target)

    // 如果对象为空对象，则。。
    if (!Object.keys(target).length) {
      return ['span', {}]
    }
    // 不为空
    return [
      'div',
      { style: 'line-height:1.25em;margin-bottom:0.6em' },
      [
        'div',
        {
          style: 'color:#476582'
        },
        type
      ],
      [
        'div',
        {
          style: 'padding-left:1.25em'
        },
        ...Object.keys(target).map(key => {
          return [
            'div',
            {},
            ['span', keywordStyle, key + ': '],
            formatValue(target[key], false)
          ]
        })
      ]
    ]
  }

  /**
   * 对值进行格式化，返回值的原始值
   * 需要区分数据的格式
   * 数字
   * 字符串
   * 布尔值
   * 对象
   * 其他 ——》 同字符串
   * @param v 
   * @param asRaw 
   * @returns 
   */
  function formatValue(v: unknown, asRaw = true) {
    if (typeof v === 'number') {
      return ['span', numberStyle, v]
    } else if (typeof v === 'string') {
      return ['span', stringStyle, JSON.stringify(v)]
    } else if (typeof v === 'boolean') { // 布尔值转化为关键字
      return ['span', keywordStyle, v]
    } else if (isObject(v)) {
      return ['object', { object: asRaw ? toRaw(v) : v }]
    } else {
      return ['span', stringStyle, String(v)]
    }
  }

  /**
   * 提取keys
   * 从实例特定type上取key，比如computed、inject等
   * @param instance 
   * @param type 
   * @returns 
   */
  function extractKeys(instance: ComponentInternalInstance, type: string) {
    // 获取实例上的组件
    const Comp = instance.type
    if (isFunction(Comp)) {
      // 组件是一个函数则返回，不需要进行提取
      return
    }
    // 提取的Map
    const extracted: Record<string, any> = {}
    for (const key in instance.ctx) {
      if (isKeyOfType(Comp, key, type)) {
        extracted[key] = instance.ctx[key]
      }
    }
    return extracted
  }

  /**
   * 判断key在组件中是否有效
   * @param Comp 
   * @param key 
   * @param type 
   * @returns 
   */
  function isKeyOfType(Comp: ComponentOptions, key: string, type: string) {
    // 从组件中拿到对应值，一般type是computed、inject等
    const opts = Comp[type]
    // 判断该值的数据格式
    // 如果是数组或对象，看其是否包含key
    if (
      (isArray(opts) && opts.includes(key)) ||
      (isObject(opts) && key in opts)
    ) {
      return true
    }
    // 如果上面没有找到则从extends扩展找
    if (Comp.extends && isKeyOfType(Comp.extends, key, type)) {
      return true
    }
    // 然后从混合器中找
    if (Comp.mixins && Comp.mixins.some(m => isKeyOfType(m, key, type))) {
      return true
    }
  }

  /**
   * 产生ref标记
   * @param v 
   * @returns 
   */
  function genRefFlag(v: Ref) {
    // 如果是shallowRef
    if (isShallow(v)) {
      return `ShallowRef`
    }
    // 包含副作用的ref，就是计算属性
    if ((v as any).effect) {
      return `ComputedRef`
    }
    return `Ref`
  }

  // 将格式器推送至开发者工具中
  if ((window as any).devtoolsFormatters) {
    ;(window as any).devtoolsFormatters.push(formatter)
  } else {
    ;(window as any).devtoolsFormatters = [formatter]
  }
}
