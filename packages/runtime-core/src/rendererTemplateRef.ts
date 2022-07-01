import { SuspenseBoundary } from './components/Suspense'
import { VNode, VNodeNormalizedRef, VNodeNormalizedRefAtom } from './vnode'
import {
  EMPTY_OBJ,
  hasOwn,
  isArray,
  isFunction,
  isString,
  remove,
  ShapeFlags
} from '@vue/shared'
import { isAsyncWrapper } from './apiAsyncComponent'
import { getExposeProxy } from './component'
import { warn } from './warning'
import { isRef } from '@vue/reactivity'
import { callWithErrorHandling, ErrorCodes } from './errorHandling'
import { SchedulerJob } from './scheduler'
import { queuePostRenderEffect } from './renderer'

/**
 * Function for handling a template ref
 * 一个方法用来处理template中ref
 */
export function setRef(
  rawRef: VNodeNormalizedRef,
  oldRawRef: VNodeNormalizedRef | null,
  parentSuspense: SuspenseBoundary | null,
  vnode: VNode,
  isUnmount = false
) {
  // 如果rawRef是数组
  if (isArray(rawRef)) {
    // 遍历去设置
    rawRef.forEach((r, i) =>
      setRef(
        r,
        oldRawRef && (isArray(oldRawRef) ? oldRawRef[i] : oldRawRef),
        parentSuspense,
        vnode,
        isUnmount
      )
    )
    return
  }

  // 是异步包装器且没有被卸载
  if (isAsyncWrapper(vnode) && !isUnmount) {
    // when mounting async components, nothing needs to be done,
    // because the template ref is forwarded to inner component
    // 当挂载异步组件时，不需要做任何事
    // 因为模板引用被转发到内部组件
    return
  }

  // ref的value
  // 如果节点类型是有状态组件，则获取组件暴露的代理
  // 如果不是有状态组件也就是函数组件，则获取组节点的元素
  const refValue =
    vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT
      ? getExposeProxy(vnode.component!) || vnode.component!.proxy
      : vnode.el
  // 卸载时的值是null，如果是挂载则值为新挂载的节点
  const value = isUnmount ? null : refValue

  // 从原始的ref中获取 实例和引用
  const { i: owner, r: ref } = rawRef
  // 如果是开发者环境且不是拥有者
  // 警告用户丢失了ref自己的上下文
  // ref不可能被用在挂起的节点上
  // 一个结点使用ref必须被创建在渲染函数内部
  if (__DEV__ && !owner) {
    warn(
      `Missing ref owner context. ref cannot be used on hoisted vnodes. ` +
        `A vnode with ref must be created inside the render function.`
    )
    return
  }
  // 旧的节点上的引用
  const oldRef = oldRawRef && (oldRawRef as VNodeNormalizedRefAtom).r
  // 获取引用
  const refs = owner.refs === EMPTY_OBJ ? (owner.refs = {}) : owner.refs
  // 获取实例的setupState
  const setupState = owner.setupState

  // dynamic ref changed. unset old ref
  // 动态ref修改，重置老的引用
  if (oldRef != null && oldRef !== ref) {
    // 如果旧引用是字符串，则在引用中收集
    if (isString(oldRef)) {
      refs[oldRef] = null
      // 如果setupState中不包含旧的引用
      if (hasOwn(setupState, oldRef)) {
        // setupState的旧引用是空的
        setupState[oldRef] = null
      }
    } else if (isRef(oldRef)) {
      // 旧引用是否是一个Ref，如果是的话 清空它的值
      oldRef.value = null
    }
  }

  // ref是函数
  if (isFunction(ref)) {
    // 调用这个函数，并传入value和refs两个值
    callWithErrorHandling(ref, owner, ErrorCodes.FUNCTION_REF, [value, refs])
  } else {
    // 是否是字符串
    const _isString = isString(ref)
    // 是否是ref
    const _isRef = isRef(ref)
    // 是字符串或者ref
    if (_isString || _isRef) {
      /**
       * 设置ref，收集ref
       */
      const doSet = () => {
        if (rawRef.f) {
          // 获取对应的值
          const existing = _isString ? refs[ref] : ref.value
          if (isUnmount) {
            // 卸载的时候，如果这个值是数组，则移除数组中对应的值
            isArray(existing) && remove(existing, refValue)
          } else {
            // 挂载，不是数组，也都要转化成数组
            if (!isArray(existing)) {
              if (_isString) {
                // 使用的是字符串
                refs[ref] = [refValue]
              } else {
                // 使用的是ref
                ref.value = [refValue]
                if (rawRef.k) refs[rawRef.k] = ref.value
              }
            } else if (!existing.includes(refValue)) {
              // 如果是个数组，数组中不包含当前值，则放进去
              existing.push(refValue)
            }
          }
        } else if (_isString) {
          // 是字符串
          refs[ref] = value
          // 如果setupState拥有ref，设置ref的值
          if (hasOwn(setupState, ref)) {
            setupState[ref] = value
          }
        } else if (isRef(ref)) {
          // 是ref
          ref.value = value
          // 设置ref的值
          if (rawRef.k) refs[rawRef.k] = value
        } else if (__DEV__) {
          // 警告
          warn('Invalid template ref type:', ref, `(${typeof ref})`)
        }
      }
      if (value) {
        // #1789: for non-null values, set them after render
        // null values means this is unmount and it should not overwrite another
        // ref with the same key
        // 因为非空值，在渲染null值后设置它们这意味着这是卸载
        // 并且它不应该覆盖另一个ref使用相同的key
        // 将id设置为-1，意味着它总是可以更早的执行，在队列中
        ;(doSet as SchedulerJob).id = -1
        queuePostRenderEffect(doSet, parentSuspense)
      } else {
        // 去设置ref
        doSet()
      }
    } else if (__DEV__) {
      // 否则警告
      warn('Invalid template ref type:', ref, `(${typeof ref})`)
    }
  }
}
