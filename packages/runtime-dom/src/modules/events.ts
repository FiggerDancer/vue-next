import { hyphenate, isArray } from '@vue/shared'
import {
  ComponentInternalInstance,
  callWithAsyncErrorHandling
} from '@vue/runtime-core'
import { ErrorCodes } from 'packages/runtime-core/src/errorHandling'

interface Invoker extends EventListener {
  value: EventValue
  attached: number
}

type EventValue = Function | Function[]

// Async edge case fix requires storing an event listener's attach timestamp.
// 异步边缘情况修复需要存储事件侦听器的附加时间戳。
const [_getNow, skipTimestampCheck] = /*#__PURE__*/ (() => {
  let _getNow = Date.now
  let skipTimestampCheck = false
  if (typeof window !== 'undefined') {
    // Determine what event timestamp the browser is using. Annoyingly, the
    // timestamp can either be hi-res (relative to page load) or low-res
    // (relative to UNIX epoch), so in order to compare time we have to use the
    // same timestamp type when saving the flush timestamp.
    // 确定浏览器正在使用的事件时间戳。比较烦人的是不同系统的时间戳格式不同，说的就是unix这样的，为了比较这些时间，我们不得不用相同的时间戳类型当保存事件调用时间时。
  if (Date.now() > document.createEvent('Event').timeStamp) {
      // if the low-res timestamp which is bigger than the event timestamp
      // (which is evaluated AFTER) it means the event is using a hi-res timestamp,
      // and we need to use the hi-res version for event listeners as well.
      // 如果低分辨率时间戳大于事件时间戳的分辨率，那就意味着我们需要使用一个高分辨率的时间戳，我们需要使用高分辨率的版本
    _getNow = performance.now.bind(performance)
    }
    // #3485: Firefox <= 53 has incorrect Event.timeStamp implementation
    // and does not fire microtasks in between event propagation, so safe to exclude.
    //  Firefox <= 53有不正确的事件。时间戳的实现并且不会在事件传播之间触发微任务，所以排除是安全的。
  const ffMatch = navigator.userAgent.match(/firefox\/(\d+)/i)
    // 跳过时间戳检查标识
  skipTimestampCheck = !!(ffMatch && Number(ffMatch[1]) <= 53)
  }
  return [_getNow, skipTimestampCheck]
})()

// To avoid the overhead of repeatedly calling performance.now(), we cache
// and use the same timestamp for all event listeners attached in the same tick.
// 为了避免重复调用performance.now()的开销，我们进行缓存.
// 并且使用相同的时间戳对于同一个钩子上的所有事件监听器
let cachedNow: number = 0
// 做一个promise 做微任务
const p = /*#__PURE__*/ Promise.resolve()
// 重新设置缓存时间
const reset = () => {
  cachedNow = 0
}
// getNow先获取缓存时间，缓存时间没有再去获取当前时间，执行微任务清空
const getNow = () => cachedNow || (p.then(reset), (cachedNow = _getNow()))

// 监听事件
export function addEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions
) {
  el.addEventListener(event, handler, options)
}

// 移除监听事件
export function removeEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions
) {
  el.removeEventListener(event, handler, options)
}

// 更新事件
export function patchEvent(
  el: Element & { _vei?: Record<string, Invoker | undefined> },
  rawName: string,
  prevValue: EventValue | null,
  nextValue: EventValue | null,
  instance: ComponentInternalInstance | null = null
) {
  // vei = vue event invokers
  // vei = vue事件调用器
  // _vei缓存vue的事件
  const invokers = el._vei || (el._vei = {})
  // 如果存在该事件调用器
  const existingInvoker = invokers[rawName]
  // 存在新值和旧值
  if (nextValue && existingInvoker) {
    // patch
    // 把调用器的值修改为新值
    existingInvoker.value = nextValue
  } else {
    const [name, options] = parseName(rawName)
    // 存在新值，没有旧值
    if (nextValue) {
      // add
      // 创建一个新的调度器
      const invoker = (invokers[rawName] = createInvoker(nextValue, instance))
      addEventListener(el, name, invoker, options)
    } else if (existingInvoker) { // 存在旧值，没有新值，删除
      // remove
      removeEventListener(el, name, existingInvoker, options)
      invokers[rawName] = undefined
    }
  }
}

// 选项修饰器
const optionsModifierRE = /(?:Once|Passive|Capture)$/

// 解析名称
function parseName(name: string): [string, EventListenerOptions | undefined] {
  let options: EventListenerOptions | undefined
  // once、passive、capture
  // 拿到这些后缀，并获取到事件名
  if (optionsModifierRE.test(name)) {
    options = {}
    let m
    while ((m = name.match(optionsModifierRE))) {
      name = name.slice(0, name.length - m[0].length)
      ;(options as any)[m[0].toLowerCase()] = true
    }
  }
  // 烤肉串化
  const event = name[2] === ':' ? name.slice(3) : hyphenate(name.slice(2))
  return [event, options]
}

/**
 * 创建调度器
 * @param initialValue 
 * @param instance 
 * @returns 
 */
function createInvoker(
  initialValue: EventValue,
  instance: ComponentInternalInstance | null
) {
  const invoker: Invoker = (e: Event) => {
    // async edge case #6566: inner click event triggers patch, event handler
    // attached to outer element during patch, and triggered again. This
    // happens because browsers fire microtask ticks between event propagation.
    // the solution is simple: we save the timestamp when a handler is attached,
    // and the handler would only fire if the event passed to it was fired
    // AFTER it was attached.
    //  Async边缘案例#6566:内部点击事件触发补丁，事件处理程序在补丁过程中附加到外部元素，并再次触发。
    // 发生这种情况是因为浏览器在事件传播之间触发微任务滴答。
    // 解决方案很简单:在附加处理程序时保存时间戳，
    // 只有当传递给它的事件被触发时，处理程序才会触发
    const timeStamp = e.timeStamp || _getNow()

    if (skipTimestampCheck || timeStamp >= invoker.attached - 1) {
      // 异步调用函数并处理错误
      callWithAsyncErrorHandling(
        // 调用立即阻止冒泡函数，通过invoker.value的方式patch的时候直接替换这个值，而不用去修改外面的一大坨，或者重新解绑，监听啥的了
        patchStopImmediatePropagation(e, invoker.value),
        instance,
        ErrorCodes.NATIVE_EVENT_HANDLER, // 错误处理函数
        [e]
      )
    }
  }
  invoker.value = initialValue
  invoker.attached = getNow()
  return invoker
}

// 更新阻止立刻冒泡
function patchStopImmediatePropagation(
  e: Event,
  value: EventValue
): EventValue {
  // 看event是不是数组，如果event的值是函数数组
  if (isArray(value)) {
    // 原始的阻止冒泡函数
    const originalStop = e.stopImmediatePropagation
    e.stopImmediatePropagation = () => {
      // 调用原生的阻止冒泡函数
      originalStop.call(e)
      ;(e as any)._stopped = true
    }
    // 对所有的函数做阻止冒泡处理
    return value.map(fn => (e: Event) => !(e as any)._stopped && fn && fn(e))
  } else {
    // 如果不是数组原值返回就可以了，因为说明这个事件后面也没有冒泡，就一个
    return value
  }
}
