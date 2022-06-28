import { ErrorCodes, callWithErrorHandling } from './errorHandling'
import { isArray, NOOP } from '@vue/shared'
import { ComponentInternalInstance, getComponentName } from './component'
import { warn } from './warning'

export interface SchedulerJob extends Function {
  id?: number
  active?: boolean
  computed?: boolean
  /**
   * Indicates whether the effect is allowed to recursively trigger itself
   * when managed by the scheduler.
   *
   * By default, a job cannot trigger itself because some built-in method calls,
   * e.g. Array.prototype.push actually performs reads as well (#1740) which
   * can lead to confusing infinite loops.
   * The allowed cases are component update functions and watch callbacks.
   * Component update functions may update child component props, which in turn
   * trigger flush: "pre" watch callbacks that mutates state that the parent
   * relies on (#1801). Watch callbacks doesn't track its dependencies so if it
   * triggers itself again, it's likely intentional and it is the user's
   * responsibility to perform recursive state mutation that eventually
   * stabilizes (#1727).
   * 意味着这个副作用被允许循环触发它本身当被调度器管理时
   * 默认情况下，一个任务不允许触发它本身因为一些内置方法的调用。
   * 例如 Array.prototype.push实际上会执行读取操作，这会导致造成无限循环
   * 被允许的情况都是组件更新函数和监听回调函数
   * 组件更新函数可以更新子组件属性，循环触发刷新时，pre 监听回调函数当依赖变化时，其状态发生变化。
   * Watch回调不能跟踪它的依赖，所以如果它再次触发自己，
   * 它可能是故意的并且它是用户负责去循环执行的稳定的状态变化
   */
  allowRecurse?: boolean
  /**
   * Attached by renderer.ts when setting up a component's render effect
   * Used to obtain component information when reporting max recursive updates.
   * dev only.
   * 附加的渲染器。
   * Ts在设置组件渲染效果时使用用于在报告最大递归更新时获取组件信息。
   * 仅开发环境
   */
  ownerInstance?: ComponentInternalInstance
}

export type SchedulerJobs = SchedulerJob | SchedulerJob[]

/** 冲刷标记*/
let isFlushing = false
/** 冲刷等待标记*/
let isFlushPending = false
/** 任务队列*/
const queue: SchedulerJob[] = []
/** 冲刷索引*/
let flushIndex = 0

/** 等待前置冲刷回调队列*/
const pendingPreFlushCbs: SchedulerJob[] = []
/** 执行的前置冲刷回调队列*/
let activePreFlushCbs: SchedulerJob[] | null = null
/** 前置冲刷索引*/
let preFlushIndex = 0
/** 等待的异步冲刷回调队列*/
const pendingPostFlushCbs: SchedulerJob[] = []
/** 执行的异步冲刷回调队列*/
let activePostFlushCbs: SchedulerJob[] | null = null
/** 异步冲刷索引*/
let postFlushIndex = 0

/** 制造微任务*/
const resolvedPromise: Promise<any> = Promise.resolve()
/** 当前冲刷的Promise*/
let currentFlushPromise: Promise<void> | null = null
/** 当前前置的冲刷父任务*/
let currentPreFlushParentJob: SchedulerJob | null = null
/** 递归限制 */
const RECURSION_LIMIT = 100
/**
 * 任务计数器，防止重复执行太多次
 */
type CountMap = Map<SchedulerJob, number>

/**
 * nextTick下一步
 * 当前这次任务执行完毕
 * @param this 
 * @param fn 
 * @returns 
 */
export function nextTick<T = void>(
  this: T,
  fn?: (this: T) => void
): Promise<void> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}

// #2768
// Use binary-search to find a suitable position in the queue,
// so that the queue maintains the increasing order of job's id,
// which can prevent the job from being skipped and also can avoid repeated patching.
/**
 * 使用2分查找在队列中找到一个合适位置
 * 使队列保持jobid的递增序列从而阻止被跳过的任务执行，
 * 同时能够避免重复更新
 * @param id 
 * @returns 
 */
function findInsertionIndex(id: number) {
  // the start index should be `flushIndex + 1`
  // 开始索引未flushIndex+1
  let start = flushIndex + 1
  let end = queue.length

  while (start < end) {
    const middle = (start + end) >>> 1
    const middleJobId = getId(queue[middle])
    middleJobId < id ? (start = middle + 1) : (end = middle)
  }

  return start
}

/**
 * 放入队列中任务，
 * 去掉重复的，允许递归的例外
 * @param job 
 */
export function queueJob(job: SchedulerJob) {
  // the dedupe search uses the startIndex argument of Array.includes()
  // by default the search index includes the current job that is being run
  // so it cannot recursively trigger itself again.
  // if the job is a watch() callback, the search will start with a +1 index to
  // allow it recursively trigger itself - it is the user's responsibility to
  // ensure it doesn't end up in an infinite loop.
  // 重复数据删除搜索使用Array.includes()的startIndex参数。
  // 默认情况下搜索的索引包含当前正在运行的项目，这样它就不会再运行它自己了
  // 如果job是一个watch的回调，搜索将以+1索引开始
  // 允许它递归地触发自己-这是用户的责任 
  // 确保它不会在无限循环中结束。
  if (
    // 队列长度为空，队列中检查到不允许递归的函数，则删除它，否则正常置入队列中，
    // 每次置入完成调用冲刷队列的方法，冲刷将在当前冲刷任务执行完毕后，执行等待中的
    (!queue.length ||
      !queue.includes(
        job,
        isFlushing && job.allowRecurse ? flushIndex + 1 : flushIndex
      )) &&
    job !== currentPreFlushParentJob
  ) {
    if (job.id == null) {
      queue.push(job)
    } else {
      queue.splice(findInsertionIndex(job.id), 0, job)
    }
    queueFlush()
  }
}

/**
 * 如果没有正在刷新且没有正在等待
 * 将正在等待设置为true
 * 下一个微任务开始时，执行等待中的任务
 */
function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

/**
 * 使job失效
 * @param job 
 */
export function invalidateJob(job: SchedulerJob) {
  const i = queue.indexOf(job)
  if (i > flushIndex) {
    queue.splice(i, 1)
  }
}

/**
 * 进入队列回调
 * 将回调加入到队列中，如果无执行中队列，则执行新队列
 * @param cb 回调
 * @param activeQueue 正在执行的队列
 * @param pendingQueue 等待执行的队列
 * @param index 索引
 */
function queueCb(
  cb: SchedulerJobs,
  activeQueue: SchedulerJob[] | null,
  pendingQueue: SchedulerJob[],
  index: number
) {
  // 回调函数是否是数组，不是数组的话，放在等待执行的回调中
  if (!isArray(cb)) {
    if (
      !activeQueue ||
      !activeQueue.includes(cb, cb.allowRecurse ? index + 1 : index)
    ) {
      pendingQueue.push(cb)
    }
  } else {
    // if cb is an array, it is a component lifecycle hook which can only be
    // triggered by a job, which is already deduped in the main queue, so
    // we can skip duplicate check here to improve perf
    // 如果回调是一个数组，它是只能由一个job触发的组件生命周期钩子，
    // 它已经在主要队列中将重复的数据删除了，所以我们可以跳过重复的检查来提高性能
    pendingQueue.push(...cb)
  }
  queueFlush()
}

/**
 * pre队列冲刷回调
 * @param cb 
 */
export function queuePreFlushCb(cb: SchedulerJob) {
  queueCb(cb, activePreFlushCbs, pendingPreFlushCbs, preFlushIndex)
}

/**
 * 队列
 * @param cb 
 */
export function queuePostFlushCb(cb: SchedulerJobs) {
  queueCb(cb, activePostFlushCbs, pendingPostFlushCbs, postFlushIndex)
}

/**
 * 排干前置
 * @param seen 
 * @param parentJob 
 */
export function flushPreFlushCbs(
  seen?: CountMap,
  parentJob: SchedulerJob | null = null
) {
  // 存在等待中的
  if (pendingPreFlushCbs.length) {
    currentPreFlushParentJob = parentJob
    // 对等待中的去重
    activePreFlushCbs = [...new Set(pendingPreFlushCbs)]
    // 删除等待中的
    pendingPreFlushCbs.length = 0
    if (__DEV__) {
      seen = seen || new Map()
    }
    // 遍历，检查是否是重复的，如果不重复执行
    for (
      preFlushIndex = 0;
      preFlushIndex < activePreFlushCbs.length;
      preFlushIndex++
    ) {
      if (
        __DEV__ &&
        checkRecursiveUpdates(seen!, activePreFlushCbs[preFlushIndex])
      ) {
        continue
      }
      activePreFlushCbs[preFlushIndex]()
    }
    activePreFlushCbs = null
    preFlushIndex = 0
    currentPreFlushParentJob = null
    // recursively flush until it drains
    // 递归执行直到被排出，有就排
    flushPreFlushCbs(seen, parentJob)
  }
}

/**
 * 排干后置
 * @param seen 
 * @returns 
 */
export function flushPostFlushCbs(seen?: CountMap) {
  if (pendingPostFlushCbs.length) {
    // 去重
    const deduped = [...new Set(pendingPostFlushCbs)]
    pendingPostFlushCbs.length = 0

    // #1947 already has active queue, nested flushPostFlushCbs call
    // 如果已经有正在执行的队列，嵌套的flushPostFlushCbs调用
    if (activePostFlushCbs) {
      activePostFlushCbs.push(...deduped)
      return
    }

    // 没有新弄一个
    activePostFlushCbs = deduped
    if (__DEV__) {
      seen = seen || new Map()
    }

    // 根据id排序
    activePostFlushCbs.sort((a, b) => getId(a) - getId(b))

    // 检查递归次数，在限制范围内可以执行，否则不执行
    for (
      postFlushIndex = 0;
      postFlushIndex < activePostFlushCbs.length;
      postFlushIndex++
    ) {
      if (
        __DEV__ &&
        checkRecursiveUpdates(seen!, activePostFlushCbs[postFlushIndex])
      ) {
        continue
      }
      activePostFlushCbs[postFlushIndex]()
    }
    activePostFlushCbs = null
    postFlushIndex = 0
  }
}

// 获取任务的Id
const getId = (job: SchedulerJob): number =>
  job.id == null ? Infinity : job.id

/**
 * 刷新job
 * @param seen 用来存储本次任务中用到的副作用，防止重复调用
 */
function flushJobs(seen?: CountMap) {
  // 将刷新等待置为false
  isFlushPending = false
  // 将正在刷新置为true
  isFlushing = true
  if (__DEV__) {
    seen = seen || new Map()
  }

  // Pre刷新（前置刷新）
  flushPreFlushCbs(seen)

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child so its render effect will have smaller
  //    priority number)
  // 2. If a component is unmounted during a parent component's update,
  //    its update can be skipped.
  // 在刷新前对队列排序，确保
  // 1. 组件由父组件到子组件被更新（因为父组件总是在子组件创建前创建，所以它的渲染副作用将有更小的优先级数字）
  // 2. 如果一个组件在父组件更新时被卸载，它的更新被跳过
  queue.sort((a, b) => getId(a) - getId(b))

  // conditional usage of checkRecursiveUpdate must be determined out of
  // try ... catch block since Rollup by default de-optimizes treeshaking
  // inside try-catch. This can leave all warning code unshaked. Although
  // they would get eventually shaken by a minifier like terser, some minifiers
  // would fail to do that (e.g. https://github.com/evanw/esbuild/issues/1610)
  // 检查循环更新的条件一定是在try catch代码块之外，因为rollup默认不会优化摇树try-catch
  // 这可能会留下所有未摇树的代码警告
  // 尽管他们可以被像terser的压缩器摇树
  // 但是一些摇树依然会失败
  const check = __DEV__
    ? (job: SchedulerJob) => checkRecursiveUpdates(seen!, job)
    : NOOP

  // 循环调用队列
  try {
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      // 拿到要执行的job
      const job = queue[flushIndex]
      if (job && job.active !== false) {
        // 开发者环境下：
        // 超出次数限制，则警告并直接跳过该job
        if (__DEV__ && check(job)) {
          continue
        }
        // console.log(`running:`, job.id)
        // 调用带有错误处理的函数
        callWithErrorHandling(job, null, ErrorCodes.SCHEDULER)
      }
    }
  } finally {
    // 清空数组
    flushIndex = 0
    queue.length = 0

    // 异步执行回调
    flushPostFlushCbs(seen)

    // 调度标记设置为false
    isFlushing = false
    // 当前调度的Promise清空
    currentFlushPromise = null
    // some postFlushCb queued jobs!
    // keep flushing until it drains.
    //  一些postFlushCb排队作业! 一直冲洗，直到排水为止。
    if (
      queue.length ||
      pendingPreFlushCbs.length ||
      pendingPostFlushCbs.length
    ) {
      flushJobs(seen)
    }
  }
}

/**
 * 检查递归更新，每次检查，都会在缓存计数器中+1进行记录，
 * 防止调用太多次，次数超出上限，就会警告并停止继续调用
 * @param seen 
 * @param fn 
 * @returns 
 */
function checkRecursiveUpdates(seen: CountMap, fn: SchedulerJob) {
  // 缓存中没有这个函数
  if (!seen.has(fn)) {
    // 设置这个函数调用次数为1
    seen.set(fn, 1)
  } else {
    // 获取函数的调用次数
    const count = seen.get(fn)!
    // 大于循环上限
    if (count > RECURSION_LIMIT) {
      // 获取副作用依赖的组件实例
      const instance = fn.ownerInstance
      // 获取组件名称
      const componentName = instance && getComponentName(instance.type)
      // 进行警告，最大递归更新xxx
      warn(
        `Maximum recursive updates exceeded${
          componentName ? ` in component <${componentName}>` : ``
        }. ` +
          `This means you have a reactive effect that is mutating its own ` +
          `dependencies and thus recursively triggering itself. Possible sources ` +
          `include component template, render function, updated hook or ` +
          `watcher source function.`
      )
      // 并返回true，让程序停止继续调用
      return true
    } else {
      // 次数+1
      seen.set(fn, count + 1)
    }
  }
}
