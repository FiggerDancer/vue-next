import {
  ComponentOptionsMixin,
  ComponentOptionsWithArrayProps,
  ComponentOptionsWithObjectProps,
  ComponentOptionsWithoutProps,
  ComponentPropsOptions,
  ComponentPublicInstance,
  ComputedOptions,
  EmitsOptions,
  MethodOptions,
  RenderFunction,
  SetupContext,
  ComponentInternalInstance,
  VNode,
  RootHydrateFunction,
  ExtractPropTypes,
  createVNode,
  defineComponent,
  nextTick,
  warn,
  ConcreteComponent,
  ComponentOptions
} from '@vue/runtime-core'
import { camelize, extend, hyphenate, isArray, toNumber } from '@vue/shared'
import { hydrate, render } from '.'

// 这个文件是Web组件的一个套API

export type VueElementConstructor<P = {}> = {
  new (initialProps?: Record<string, any>): VueElement & P
}

// defineCustomElement provides the same type inference as defineComponent
// so most of the following overloads should be kept in sync w/ defineComponent.
// defineCustomElement提供和defineComponent相同的接口类型,所以webComponent和defineComponent大多数的重载都是同步的

// overload 1: direct setup function
// 重载1：setup函数
export function defineCustomElement<Props, RawBindings = object>(
  setup: (
    props: Readonly<Props>,
    ctx: SetupContext
  ) => RawBindings | RenderFunction
): VueElementConstructor<Props>

// overload 2: object format with no props
// 重载2：option api没有属性
export function defineCustomElement<
  Props = {},
  RawBindings = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = EmitsOptions,
  EE extends string = string
>(
  options: ComponentOptionsWithoutProps<
    Props,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE
  > & { styles?: string[] }
): VueElementConstructor<Props>

// overload 3: object format with array props declaration
// 重载3： option api格式为数组属性声明
export function defineCustomElement<
  PropNames extends string,
  RawBindings,
  D,
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = Record<string, any>,
  EE extends string = string
>(
  options: ComponentOptionsWithArrayProps<
    PropNames,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE
  > & { styles?: string[] }
): VueElementConstructor<{ [K in PropNames]: any }>

// overload 4: object format with object props declaration
// 重载4： option api格式为对象属性声明
export function defineCustomElement<
  PropsOptions extends Readonly<ComponentPropsOptions>,
  RawBindings,
  D,
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = Record<string, any>,
  EE extends string = string
>(
  options: ComponentOptionsWithObjectProps<
    PropsOptions,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE
  > & { styles?: string[] }
): VueElementConstructor<ExtractPropTypes<PropsOptions>>

// overload 5: defining a custom element from the returned value of
// `defineComponent`
// 重载5： 定义一个自定义元素返回一个defineComponent的值
export function defineCustomElement(options: {
  new (...args: any[]): ComponentPublicInstance
}): VueElementConstructor

// 定义元素用options
export function defineCustomElement(
  options: any,
  hydate?: RootHydrateFunction
): VueElementConstructor {
  const Comp = defineComponent(options as any)
  class VueCustomElement extends VueElement {
    static def = Comp
    constructor(initialProps?: Record<string, any>) {
      super(Comp, initialProps, hydate)
    }
  }

  return VueCustomElement
}

// 服务器渲染用
export const defineSSRCustomElement = ((options: any) => {
  // @ts-ignore
  return defineCustomElement(options, hydrate)
}) as typeof defineCustomElement

// 基础的类类型 HTMLElement或者class
const BaseClass = (
  typeof HTMLElement !== 'undefined' ? HTMLElement : class {}
) as typeof HTMLElement

type InnerComponentDef = ConcreteComponent & { styles?: string[] }

export class VueElement extends BaseClass {
  /**
   * @internal
   * 组件的实例
   */
  _instance: ComponentInternalInstance | null = null

  // 标识是否激活（WebComponent)
  private _connected = false
  // 异步组件，是否加载成功
  private _resolved = false
  // ？哪些属性是数字？
  private _numberProps: Record<string, true> | null = null
  // 样式表
  private _styles?: HTMLStyleElement[]

  constructor(
    // 内部组件定义
    private _def: InnerComponentDef,
    // 属性
    private _props: Record<string, any> = {},
    // 注水激活SSR
    hydrate?: RootHydrateFunction
  ) {
    super()
    // 是SSR且是一个有shadowRoot的WebComponent
    if (this.shadowRoot && hydrate) {
      hydrate(this._createVNode(), this.shadowRoot)
    } else { // 非SSR，开发者环境且有shadowRoot会提示警告自定义元素。自定义元素已预渲染声明性阴影根，但没有定义为水合性。使用“defineSSRCustomElement"
      if (__DEV__ && this.shadowRoot) {
        warn(
          `Custom element has pre-rendered declarative shadow root but is not ` +
            `defined as hydratable. Use \`defineSSRCustomElement\`.`
        )
      }
      // 添加一个shadowRoot到这个element上
      this.attachShadow({ mode: 'open' }) // 这里的open表示外界可以访问这个shadowRoot，如果写closed就是不可访问，比如video就是closed
    }
  }

  // 挂载
  connectedCallback() {
    this._connected = true // 将挂载标识置为true
    if (!this._instance) { // 没有实例会去加载
      this._resolveDef()
    }
  }

  // 卸载
  disconnectedCallback() {
    // 将挂载标识置为false
    this._connected = false
    // 如果下一帧，还是没有挂载的话，那就卸载掉，这里不进行任何的diff，将实例置为null，清除内存的占用
    nextTick(() => {
      if (!this._connected) {
        render(null, this.shadowRoot!)
        this._instance = null
      }
    })
  }

  /**
   * resolve inner component definition (handle possible async component)
   * 解决内部组件释义（处理可能的异步组件）
   */
  private _resolveDef() {
    // 已经加载好了就不用加载了
    if (this._resolved) {
      return
    }
    // 将加载状态设置成true
    this._resolved = true

    // set initial attrs
    // 设置初始化属性
    for (let i = 0; i < this.attributes.length; i++) {
      this._setAttr(this.attributes[i].name)
    }

    // watch future attr changes
    // 观察未来属性的变化
    new MutationObserver(mutations => {
      // 当监听到属性变化的时候，将这些属性重新设置，并更新dom元素
      for (const m of mutations) {
        this._setAttr(m.attributeName!)
      }
    }).observe(this, { attributes: true })

    const resolve = (def: InnerComponentDef) => {
      const { props, styles } = def // 定义中包含属性和样式两部分
      const hasOptions = !isArray(props) // 如果属性不是数组，就意味着不是属性
      // 通过遍历keys收集原始的属性的key值（键值）
      const rawKeys = props ? (hasOptions ? Object.keys(props) : props) : []

      // cast Number-type props set before resolve
      // 在resolve之前投射数字类型属性的设置
      let numberProps // 收集数字属性
      if (hasOptions) {
        for (const key in this._props) {
          const opt = props[key]
          if (opt === Number || (opt && opt.type === Number)) {
            this._props[key] = toNumber(this._props[key])
            ;(numberProps || (numberProps = Object.create(null)))[key] = true
          }
        }
      }
      // 收集的数字属性
      this._numberProps = numberProps

      // check if there are props set pre-upgrade or connect
      // 检查props是否有预更新或者连接
      for (const key of Object.keys(this)) {
        if (key[0] !== '_') {
          this._setProp(key, this[key as keyof this], true, false)
        }
      }

      // defining getter/setters on prototype
      // 在原型链上定义getter和setter
      for (const key of rawKeys.map(camelize)) {
        Object.defineProperty(this, key, {
          get() {
            return this._getProp(key)
          },
          set(val) {
            this._setProp(key, val)
          }
        })
      }

      // apply CSS
      // 应用css
      this._applyStyles(styles)

      // initial render
      // 初始化渲染
      this._update()
    }

    // 是否是异步组件
    const asyncDef = (this._def as ComponentOptions).__asyncLoader
    if (asyncDef) { // 异步组件，通过异步组件的loader去引入
      asyncDef().then(resolve)
    } else { // 否则，同步组件，直接引入
      resolve(this._def)
    }
  }

  protected _setAttr(key: string) {
    let value = this.getAttribute(key)
    // 数字属性转化为数字
    if (this._numberProps && this._numberProps[key]) {
      value = toNumber(value)
    }
    // 设置属性的key值转化为驼峰式
    this._setProp(camelize(key), value, false)
  }

  /**
   * @internal
   * 获取属性
   */
  protected _getProp(key: string) {
    return this._props[key]
  }

  /**
   * @internal
   * 设置属性
   */
  protected _setProp(
    key: string,
    val: any,
    shouldReflect = true,
    shouldUpdate = true
  ) {
    if (val !== this._props[key]) {
      this._props[key] = val
      if (shouldUpdate && this._instance) { // 设置属性完成后需要更新元素
        this._update()
      }
      // reflect 映射就是有些特定的属性，比如设置的value是true或者一些字符串需要做一些特殊处理，更符合框架特征
      if (shouldReflect) {
        if (val === true) {
          this.setAttribute(hyphenate(key), '') // 启用连字符，并且布尔值表现与html一致化
        } else if (typeof val === 'string' || typeof val === 'number') { // 数字和字符串都变为字符串
          this.setAttribute(hyphenate(key), val + '')
        } else if (!val) { // 值为falsy且不为 0，'', false 则移除属性
          this.removeAttribute(hyphenate(key))
        }
      }
    }
  }

  // 渲染新的dom
  private _update() {
    render(this._createVNode(), this.shadowRoot!)
  }

  // 创建节点
  private _createVNode(): VNode<any, any> {
    // 按照定义创建虚拟节点，并且增加属性
    const vnode = createVNode(this._def, extend({}, this._props))
    // 没有实例，也就是挂载
    if (!this._instance) {
      vnode.ce = instance => {
        this._instance = instance
        instance.isCE = true
        // HMR 热更新
        if (__DEV__) {
          instance.ceReload = newStyles => {
            // always reset styles
            // 移除所有样式
            if (this._styles) {
              this._styles.forEach(s => this.shadowRoot!.removeChild(s))
              this._styles.length = 0
            }
            // 添加新的样式
            this._applyStyles(newStyles)
            // if this is an async component, ceReload is called from the inner
            // component so no need to reload the async wrapper
            // 如果这是一个异步组件，ceReload被内部组件重载
            if (!(this._def as ComponentOptions).__asyncLoader) {
              // reload
              // 重载
              this._instance = null
              this._update()
            }
          }
        }

        // intercept emit
        // 拦截事件触发，变成一个原生事件，可以触发自定义的事件
        instance.emit = (event: string, ...args: any[]) => {
          this.dispatchEvent(
            new CustomEvent(event, {
              detail: args
            })
          )
        }

        // locate nearest Vue custom element parent for provide/inject
        // 找到最近的Vue自定义元素的父元素提供/注入
        let parent: Node | null = this
        while (
          (parent =
            parent && (parent.parentNode || (parent as ShadowRoot).host))
        ) {
          if (parent instanceof VueElement) {
            instance.parent = parent._instance
            break
          }
        }
      }
    }
    // 返回vnode
    return vnode
  }

  // 添加样式
  private _applyStyles(styles: string[] | undefined) {
    if (styles) {
      styles.forEach(css => {
        const s = document.createElement('style')
        s.textContent = css
        this.shadowRoot!.appendChild(s)
        // record for HMR
        // 为热更新记录
        if (__DEV__) {
          ;(this._styles || (this._styles = [])).push(s)
        }
      })
    }
  }
}
