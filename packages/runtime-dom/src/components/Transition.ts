import {
  BaseTransition,
  BaseTransitionProps,
  h,
  warn,
  FunctionalComponent,
  compatUtils,
  DeprecationTypes
} from '@vue/runtime-core'
import { isObject, toNumber, extend, isArray } from '@vue/shared'

// 过渡
const TRANSITION = 'transition'
// 动画
const ANIMATION = 'animation'

/**
 * 定义transition的属性
 * name
 * type 类型 是动画还是过渡
 * css 使用css还是js
 * duration 过渡速度
 * enterFromClass enter-from
 * enterActiveClass enter-active
 * enterToClass enter-to
 * appearFromClass appear-from
 * appearActiveClass appear-active
 * appearToClass appear-to
 * leaveFromClass leave-from
 * leaveActiveClass leave-active
 * leaveToClass leave-to
 */
export interface TransitionProps extends BaseTransitionProps<Element> {
  name?: string
  type?: typeof TRANSITION | typeof ANIMATION
  css?: boolean
  duration?: number | { enter: number; leave: number }
  // custom transition classes
  // 自定义过渡类名
  enterFromClass?: string
  enterActiveClass?: string
  enterToClass?: string
  appearFromClass?: string
  appearActiveClass?: string
  appearToClass?: string
  leaveFromClass?: string
  leaveActiveClass?: string
  leaveToClass?: string
}

export interface ElementWithTransition extends HTMLElement {
  // _vtc = Vue Transition Classes.
  // Store the temporarily-added transition classes on the element
  // so that we can avoid overwriting them if the element's class is patched
  // during the transition.
  // _vtc = Vue过渡类名
  // 在元素上存储临时添加的过渡类型
  // 所以当元素类型在过渡期间被更新时我们可以避免覆盖它们
  _vtc?: Set<string>
}

// DOM Transition is a higher-order-component based on the platform-agnostic
// base Transition component, with DOM-specific logic.
// DOM Transition是一种基于平台无关的高阶组件
// 基本的Transition组件，具有dom特定的逻辑。
export const Transition: FunctionalComponent<TransitionProps> = (
  props,
  { slots }
) => h(BaseTransition, resolveTransitionProps(props), slots)

Transition.displayName = 'Transition'

// 兼容性
if (__COMPAT__) {
  Transition.__isBuiltIn = true
}

// DOM过渡属性值校验
const DOMTransitionPropsValidators = {
  name: String,
  type: String,
  css: {
    type: Boolean,
    default: true
  },
  duration: [String, Number, Object],
  enterFromClass: String,
  enterActiveClass: String,
  enterToClass: String,
  appearFromClass: String,
  appearActiveClass: String,
  appearToClass: String,
  leaveFromClass: String,
  leaveActiveClass: String,
  leaveToClass: String
}

// 过渡属性的校验
export const TransitionPropsValidators = (Transition.props =
  /*#__PURE__*/ extend(
    {},
    (BaseTransition as any).props,
    DOMTransitionPropsValidators
  ))

/**
 * #3227 Incoming hooks may be merged into arrays when wrapping Transition
 * with custom HOCs.
 * 当用自定义HOCS包装Transition时，传入的钩子可以合并到数组中
 */
const callHook = (
  hook: Function | Function[] | undefined,
  args: any[] = []
) => {
  // 如果钩子是数组
  if (isArray(hook)) {
    hook.forEach(h => h(...args))
  } else if (hook) {
    hook(...args)
  }
}

/**
 * Check if a hook expects a callback (2nd arg), which means the user
 * intends to explicitly control the end of the transition.
 * 检查钩子是否需要回调(第二个参数)，这意味着就是用户期望显式控制转换的结束。
 * 了解一个知识点：如果获取函数的length则实际上是获取函数的参数个数
 */
const hasExplicitCallback = (
  hook: Function | Function[] | undefined
): boolean => { 
  return hook
    ? isArray(hook)
      ? hook.some(h => h.length > 1)
      : hook.length > 1
    : false
}

/**
 * 获取过渡效果属性
 * @param rawProps 原始属性
 * @returns 
 */
export function resolveTransitionProps(
  rawProps: TransitionProps
): BaseTransitionProps<Element> {
  const baseProps: BaseTransitionProps<Element> = {}
  // 遍历原始属性，并将原始属性中的每个符合DOMTransitionPropsValidators的key赋值到baseProps
  for (const key in rawProps) {
    if (!(key in DOMTransitionPropsValidators)) {
      ;(baseProps as any)[key] = (rawProps as any)[key]
    }
  }
  // 如果css是false，则直接返回baseProps
  if (rawProps.css === false) {
    return baseProps
  }
  // 从原始属性中解构得到使用的属性
  const {
    name = 'v',
    type,
    duration,
    enterFromClass = `${name}-enter-from`,
    enterActiveClass = `${name}-enter-active`,
    enterToClass = `${name}-enter-to`,
    appearFromClass = enterFromClass,
    appearActiveClass = enterActiveClass,
    appearToClass = enterToClass,
    leaveFromClass = `${name}-leave-from`,
    leaveActiveClass = `${name}-leave-active`,
    leaveToClass = `${name}-leave-to`
  } = rawProps

  // legacy transition class compat
  // 过渡类名的遗留问题兼容
  // 兼容enter=>enter-from leave=>leave-from
  const legacyClassEnabled =
    __COMPAT__ &&
    compatUtils.isCompatEnabled(DeprecationTypes.TRANSITION_CLASSES, null)
  let legacyEnterFromClass: string
  let legacyAppearFromClass: string
  let legacyLeaveFromClass: string
  if (__COMPAT__ && legacyClassEnabled) {
    const toLegacyClass = (cls: string) => cls.replace(/-from$/, '')
    if (!rawProps.enterFromClass) {
      legacyEnterFromClass = toLegacyClass(enterFromClass)
    }
    if (!rawProps.appearFromClass) {
      legacyAppearFromClass = toLegacyClass(appearFromClass)
    }
    if (!rawProps.leaveFromClass) {
      legacyLeaveFromClass = toLegacyClass(leaveFromClass)
    }
  }

  // 时间，正常化过渡时间
  const durations = normalizeDuration(duration)
  // 进入时间
  const enterDuration = durations && durations[0]
  // 离开时间
  const leaveDuration = durations && durations[1]
  const {
    onBeforeEnter,
    onEnter,
    onEnterCancelled, // 进入取消回调
    onLeave,
    onLeaveCancelled, // 离开取消回调
    onBeforeAppear = onBeforeEnter,
    onAppear = onEnter,
    onAppearCancelled = onEnterCancelled // 出现取消会带哦
  } = baseProps

  // 进入结束
  const finishEnter = (el: Element, isAppear: boolean, done?: () => void) => {
    // 移除过渡类名
    removeTransitionClass(el, isAppear ? appearToClass : enterToClass)
    removeTransitionClass(el, isAppear ? appearActiveClass : enterActiveClass)
    done && done()
  }

  // 结束离开
  const finishLeave = (
    el: Element & { _isLeaving?: boolean },
    done?: () => void
  ) => {
    el._isLeaving = false
    removeTransitionClass(el, leaveFromClass)
    removeTransitionClass(el, leaveToClass)
    removeTransitionClass(el, leaveActiveClass)
    done && done()
  }

  // 创建进入的钩子
  const makeEnterHook = (isAppear: boolean) => {
    return (el: Element, done: () => void) => {
      // 钩子appear enter
      const hook = isAppear ? onAppear : onEnter
      // resolve注册为结束enter，isAppear是否为出现
      const resolve = () => finishEnter(el, isAppear, done)
      // 调用钩子
      callHook(hook, [el, resolve])
      // 并在下一帧移除对应的enter-from或者appear-from类名，添加enter-to类名和leave-to类名
      nextFrame(() => {
        removeTransitionClass(el, isAppear ? appearFromClass : enterFromClass)
        if (__COMPAT__ && legacyClassEnabled) {
          removeTransitionClass(
            el,
            isAppear ? legacyAppearFromClass : legacyEnterFromClass
          )
        }
        addTransitionClass(el, isAppear ? appearToClass : enterToClass)
        // 如果没有确切的回调钩子，则执行默认的transitionEnd，就是看用户有没有打算用resolve，给函数传了resolve这个参数
        if (!hasExplicitCallback(hook)) {
          whenTransitionEnds(el, type, enterDuration, resolve)
        }
      })
    }
  }

  // 扩展base属性
  return extend(baseProps, {
    // 进入钩子
    onBeforeEnter(el) {
      // 回调
      callHook(onBeforeEnter, [el])
      // 添加类名
      addTransitionClass(el, enterFromClass)
      if (__COMPAT__ && legacyClassEnabled) {
        addTransitionClass(el, legacyEnterFromClass)
      }
      // 添加active类名
      addTransitionClass(el, enterActiveClass)
    },
    // appear钩子
    onBeforeAppear(el) {
      callHook(onBeforeAppear, [el])
      addTransitionClass(el, appearFromClass)
      if (__COMPAT__ && legacyClassEnabled) {
        addTransitionClass(el, legacyAppearFromClass)
      }
      addTransitionClass(el, appearActiveClass)
    },
    // enter钩子
    onEnter: makeEnterHook(false),
    // appear钩子
    onAppear: makeEnterHook(true),
    // leave钩子
    onLeave(el: Element & { _isLeaving?: boolean }, done) {
      el._isLeaving = true
      const resolve = () => finishLeave(el, done)
      addTransitionClass(el, leaveFromClass)
      if (__COMPAT__ && legacyClassEnabled) {
        addTransitionClass(el, legacyLeaveFromClass)
      }
      // force reflow so *-leave-from classes immediately take effect (#2593)
      // 强制回流，使leave-from立即生效
      forceReflow()
      addTransitionClass(el, leaveActiveClass)
      nextFrame(() => {
        if (!el._isLeaving) {
          // cancelled
          return
        }
        removeTransitionClass(el, leaveFromClass)
        if (__COMPAT__ && legacyClassEnabled) {
          removeTransitionClass(el, legacyLeaveFromClass)
        }
        addTransitionClass(el, leaveToClass)
        if (!hasExplicitCallback(onLeave)) {
          whenTransitionEnds(el, type, leaveDuration, resolve)
        }
      })
      callHook(onLeave, [el, resolve])
    },
    // 取消钩子
    onEnterCancelled(el) {
      finishEnter(el, false)
      callHook(onEnterCancelled, [el])
    },
    onAppearCancelled(el) {
      finishEnter(el, true)
      callHook(onAppearCancelled, [el])
    },
    onLeaveCancelled(el) {
      finishLeave(el)
      callHook(onLeaveCancelled, [el])
    }
  } as BaseTransitionProps<Element>)
}

/**
 * 格式化Duration
 * 都处理成数组[enterDuration, leaveDuration]
 * @param duration 
 * @returns 
 */
function normalizeDuration(
  duration: TransitionProps['duration']
): [number, number] | null {
  if (duration == null) {
    return null
  } else if (isObject(duration)) {
    return [NumberOf(duration.enter), NumberOf(duration.leave)]
  } else {
    const n = NumberOf(duration)
    return [n, n]
  }
}

/**
 * 值进行数字转化
 * @param val 
 * @returns 
 */
function NumberOf(val: unknown): number {
  const res = toNumber(val)
  if (__DEV__) validateDuration(res)
  return res
}

/**
 * 检验过渡时间
 * @param val 
 */
function validateDuration(val: unknown) {
  if (typeof val !== 'number') {
    warn(
      `<transition> explicit duration is not a valid number - ` +
        `got ${JSON.stringify(val)}.`
    )
  } else if (isNaN(val)) {
    warn(
      `<transition> explicit duration is NaN - ` +
        'the duration expression might be incorrect.'
    )
  }
}

/**
 * 添加过渡类名，并放到Set里去
 * @param el 
 * @param cls 
 */
export function addTransitionClass(el: Element, cls: string) {
  cls.split(/\s+/).forEach(c => c && el.classList.add(c))
  ;(
    (el as ElementWithTransition)._vtc ||
    ((el as ElementWithTransition)._vtc = new Set())
  ).add(cls)
}

/**
 * 移除过渡类名
 * @param el 
 * @param cls 
 */
export function removeTransitionClass(el: Element, cls: string) {
  cls.split(/\s+/).forEach(c => c && el.classList.remove(c))
  const { _vtc } = el as ElementWithTransition
  if (_vtc) {
    _vtc.delete(cls)
    if (!_vtc!.size) {
      ;(el as ElementWithTransition)._vtc = undefined
    }
  }
}

/**
 * 下一帧
 * @param cb 
 */
function nextFrame(cb: () => void) {
  requestAnimationFrame(() => {
    requestAnimationFrame(cb)
  })
}

// 过渡结束动画的id
let endId = 0

/**
 * 当过渡结束时
 * @param el 
 * @param expectedType 
 * @param explicitTimeout 
 * @param resolve 
 * @returns 
 */
function whenTransitionEnds(
  el: Element & { _endId?: number },
  expectedType: TransitionProps['type'] | undefined,
  explicitTimeout: number | null,
  resolve: () => void
) {
  // 获取id
  const id = (el._endId = ++endId)
  // 如果没有失效（当前id等于el._endId），如果当前id为el._endId则执行resolve
  const resolveIfNotStale = () => {
    if (id === el._endId) {
      resolve()
    }
  }

  // 明确的延迟时间，那就延迟后调用
  if (explicitTimeout) {
    return setTimeout(resolveIfNotStale, explicitTimeout)
  }

  // 
  const { type, timeout, propCount } = getTransitionInfo(el, expectedType)
  // 没有任何类型，直接触发完成
  if (!type) {
    return resolve()
  }

  const endEvent = type + 'end'
  let ended = 0
  const end = () => {
    // 结束后移除对应的监听
    el.removeEventListener(endEvent, onEnd)
    // 通知过渡结束
    resolveIfNotStale()
  }
  const onEnd = (e: Event) => {
    // 如果触发结束动画次数超过总的动画个数则手动结束
    if (e.target === el && ++ended >= propCount) {
      end()
    }
  }
  setTimeout(() => {
    // 时间到了后如果还有未结束的过渡效果，手动结束
    if (ended < propCount) {
      end()
    }
  }, timeout + 1)
  // 添加监听
  el.addEventListener(endEvent, onEnd)
}

/**
 * CSS过渡信息
 * type 类型 动画、过渡
 * propCount 时长个数
 * timeout 总时长
 * hasTransform 过渡效果是否包含transform
 */
interface CSSTransitionInfo {
  type: typeof TRANSITION | typeof ANIMATION | null
  propCount: number
  timeout: number
  hasTransform: boolean
}

/**
 * 获取过渡信息
 * @param el 
 * @param expectedType 
 * @returns 
 */
export function getTransitionInfo(
  el: Element,
  expectedType?: TransitionProps['type']
): CSSTransitionInfo {
  // 获取计算后的实际样式
  const styles: any = window.getComputedStyle(el)
  // JSDOM may return undefined for transition properties
  // 对过渡属性而言，JSDom可以返回undefined
  const getStyleProperties = (key: string) => (styles[key] || '').split(', ')
  // 从style中获取过渡延迟
  const transitionDelays = getStyleProperties(TRANSITION + 'Delay')
  // 从style中获取过渡时间
  const transitionDurations = getStyleProperties(TRANSITION + 'Duration')
  // 通过过渡延迟和过渡时间，获取到总的时间
  const transitionTimeout = getTimeout(transitionDelays, transitionDurations)
  // 动画延迟
  const animationDelays = getStyleProperties(ANIMATION + 'Delay')
  // 动画时间
  const animationDurations = getStyleProperties(ANIMATION + 'Duration')
  // 动画总时长
  const animationTimeout = getTimeout(animationDelays, animationDurations)
  // 切换的类型
  let type: CSSTransitionInfo['type'] = null
  let timeout = 0
  let propCount = 0
  /* istanbul ignore if */
  if (expectedType === TRANSITION) { // 期待的类型是过渡
    if (transitionTimeout > 0) {
      type = TRANSITION
      timeout = transitionTimeout
      propCount = transitionDurations.length // 给定的时间个数
    }
  } else if (expectedType === ANIMATION) { // 动画
    if (animationTimeout > 0) {
      type = ANIMATION
      timeout = animationTimeout
      propCount = animationDurations.length // 给定的时间个数
    }
  } else { // 其他
    timeout = Math.max(transitionTimeout, animationTimeout)
    type = // 谁的过渡时长大就是谁
      timeout > 0
        ? transitionTimeout > animationTimeout
          ? TRANSITION
          : ANIMATION
        : null
    propCount = type
      ? type === TRANSITION
        ? transitionDurations.length
        : animationDurations.length
      : 0
  }
  // 过渡中是否包含transform
  const hasTransform =
    type === TRANSITION &&
    /\b(transform|all)(,|$)/.test(styles[TRANSITION + 'Property'])
  return {
    type,
    timeout,
    propCount,
    hasTransform
  }
}

/**
 * 获取动画延迟+过渡的总时长
 * @param delays 
 * @param durations 
 * @returns 
 */
function getTimeout(delays: string[], durations: string[]): number {
  while (delays.length < durations.length) {
    delays = delays.concat(delays)
  }
  return Math.max(...durations.map((d, i) => toMs(d) + toMs(delays[i])))
}

// Old versions of Chromium (below 61.0.3163.100) formats floating pointer
// numbers in a locale-dependent way, using a comma instead of a dot.
// If comma is not replaced with a dot, the input will be rounded down
// (i.e. acting as a floor function) causing unexpected behaviors
/**
 * chrome老版本61.0.3163.100以下的格式化浮点指针数字依赖于使用的语言，使用逗号代替句号
 * 如果逗号没被句号替换，input将被向下舍入，例如像floor函数，导致不期望的表现
 * @param s 
 * @returns 
 */
function toMs(s: string): number {
  return Number(s.slice(0, -1).replace(',', '.')) * 1000
}

// synchronously force layout to put elements into a certain state
/** 
 * 同步强制布局，使元素进入特定状态
 **/ 
export function forceReflow() {
  return document.body.offsetHeight
}
