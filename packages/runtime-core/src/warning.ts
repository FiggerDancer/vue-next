import { VNode } from './vnode'
import {
  Data,
  ComponentInternalInstance,
  ConcreteComponent,
  formatComponentName
} from './component'
import { isString, isFunction } from '@vue/shared'
import { toRaw, isRef, pauseTracking, resetTracking } from '@vue/reactivity'
import { callWithErrorHandling, ErrorCodes } from './errorHandling'

/**
 * 组件的vnode
 * type: 确切的组件
 */
type ComponentVNode = VNode & {
  type: ConcreteComponent
}

/**
 * vnode 栈
 */
const stack: VNode[] = []

/**
 * 跟踪入口
 * vnode 组件节点
 * recurseCount 递归次数统计
 */
type TraceEntry = {
  vnode: ComponentVNode
  recurseCount: number
}

/**
 * 组件跟踪栈
 */
type ComponentTraceStack = TraceEntry[]

/**
 * 放入警告上下文
 * @param vnode 
 */
export function pushWarningContext(vnode: VNode) {
  stack.push(vnode)
}

/**
 * 抛出警告上下文
 */
export function popWarningContext() {
  stack.pop()
}

/**
 * 警告
 * @param msg 
 * @param args 
 */
export function warn(msg: string, ...args: any[]) {
  // avoid props formatting or warn handler tracking deps that might be mutated
  // during patch, leading to infinite recursion.
  // 在打补丁期间避免props格式化或警告处理程序跟踪可能发生突变的deps，导致无限递归
  // 禁止跟踪
  pauseTracking()

  // 实例
  // 堆栈的长度
  // 实例 节点组件
  const instance = stack.length ? stack[stack.length - 1].component : null
  // app警告处理函数
  const appWarnHandler = instance && instance.appContext.config.warnHandler
  // 跟踪
  const trace = getComponentTrace()

  // 如果有app警告处理函数
  if (appWarnHandler) {
    // 调用错误处理
    callWithErrorHandling(
      appWarnHandler,
      instance,
      ErrorCodes.APP_WARN_HANDLER,
      [
        msg + args.join(''),
        instance && instance.proxy,
        trace
          .map(
            ({ vnode }) => `at <${formatComponentName(instance, vnode.type)}>`
          )
          .join('\n'),
        trace
      ]
    )
  } else {
    // 警告的参数
    const warnArgs = [`[Vue warn]: ${msg}`, ...args]
    /* istanbul ignore if */
    if (
      trace.length &&
      // avoid spamming console during tests
      // 避免在测试期间破坏控制台
      !__TEST__
    ) {
      // 警告参数
      warnArgs.push(`\n`, ...formatTrace(trace))
    }
    // 打印警告
    console.warn(...warnArgs)
  }

  // 重置跟踪
  resetTracking()
}

/**
 * 获取组件跟踪
 * @returns 
 */
export function getComponentTrace(): ComponentTraceStack {
  // 当前vnode
  let currentVNode: VNode | null = stack[stack.length - 1]
  if (!currentVNode) {
    return []
  }

  // we can't just use the stack because it will be incomplete during updates
  // that did not start from the root. Re-construct the parent chain using
  // instance parent pointers.
  // 我们不能仅仅使用堆栈，因为它在更新期间是不完整的，没有从根节点开始跟踪
  // 使用实例父组件指针重构父链
  const normalizedStack: ComponentTraceStack = []

  // 是否存在当前节点
  while (currentVNode) {
    // 上一个节点
    const last = normalizedStack[0]
    // 上一个节点等同当前节点
    if (last && last.vnode === currentVNode) {
      // 上个节点递归次数增加
      last.recurseCount++
    } else {
      // 序列化堆栈中放入vnode和递归次数
      normalizedStack.push({
        vnode: currentVNode as ComponentVNode,
        recurseCount: 0
      })
    }
    // 父组件实例
    const parentInstance: ComponentInternalInstance | null =
      currentVNode.component && currentVNode.component.parent
    // 当前vnode 设置为父实例的vnode
    currentVNode = parentInstance && parentInstance.vnode
  }

  // 序列化堆栈
  return normalizedStack
}

/**
 * 格式化跟踪
 * 格式化每行日志
 * 日志输出要进行换行
 * @param trace 
 * @returns 
 */
/* istanbul ignore next */
function formatTrace(trace: ComponentTraceStack): any[] {
  const logs: any[] = []
  trace.forEach((entry, i) => {
    logs.push(...(i === 0 ? [] : [`\n`]), ...formatTraceEntry(entry))
  })
  return logs
}

/**
 * 格式化跟踪组件入口
 * 返回格式类似
 * at <component is-aa="aaa" ... > ... (3 recursive calls)
 * @param param0 
 * @returns 
 */
function formatTraceEntry({ vnode, recurseCount }: TraceEntry): any[] {
  // 后缀，按照递归次数来
  const postfix =
    recurseCount > 0 ? `... (${recurseCount} recursive calls)` : ``
  // 根节点标记
  const isRoot = vnode.component ? vnode.component.parent == null : false
  // 获取组件的开标签
  const open = ` at <${formatComponentName(
    vnode.component,
    vnode.type,
    isRoot
  )}`
  // 闭合标签
  const close = `>` + postfix
  // 有vnode节点的props，则需要把props也放进去给用户看
  return vnode.props
    ? [open, ...formatProps(vnode.props), close]
    : [open + close]
}

/**
 * 格式化props
 * 就是处理props key太多 超过3个的情况
 * @param props 
 * @returns 
 */
/* istanbul ignore next */
function formatProps(props: Data): any[] {
  const res: any[] = []
  const keys = Object.keys(props)
  // 只取前3个去遍历
  keys.slice(0, 3).forEach(key => {
    // 把前3个key方进行，并进行格式化
    res.push(...formatProp(key, props[key]))
  })
  // 如果属性值大于3的话，再放个点点省略后面的
  if (keys.length > 3) {
    res.push(` ...`)
  }
  return res
}

/**
 * 格式化Prop
 * 如果值是字符串，对字符串JSON.stringify
 * 如果要返回原始值，则返回value本身
 * 否则返回 key=value
 * @param key 
 * @param value 
 */
function formatProp(key: string, value: unknown): any[]
function formatProp(key: string, value: unknown, raw: true): any
/* istanbul ignore next */
function formatProp(key: string, value: unknown, raw?: boolean): any {
  if (isString(value)) {
    // 这里不太理解为什么要对字符串stringify化
    value = JSON.stringify(value)
    return raw ? value : [`${key}=${value}`]
  } else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value == null
  ) {
    // 不是数字，不是boolean，值为null
    return raw ? value : [`${key}=${value}`]
  } else if (isRef(value)) {
    // 递归格式化属性key，原始值
    value = formatProp(key, toRaw(value.value), true)
    // 根据需求返回原始值还是 key=Ref<value>
    return raw ? value : [`${key}=Ref<`, value, `>`]
  } else if (isFunction(value)) {
    // 如果值是一个函数
    // 返回 key=fn<value.name> 或者 key=fn
    return [`${key}=fn${value.name ? `<${value.name}>` : ``}`]
  } else {
    // 转化成原始值
    value = toRaw(value)
    return raw ? value : [`${key}=`, value]
  }
}
