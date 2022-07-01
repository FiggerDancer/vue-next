/* eslint-disable no-restricted-globals */
import {
  ConcreteComponent,
  ComponentInternalInstance,
  ComponentOptions,
  InternalRenderFunction,
  ClassComponent,
  isClassComponent
} from './component'
import { queueJob, queuePostFlushCb } from './scheduler'
import { extend, getGlobalThis } from '@vue/shared'

/**
 * 热更新组件
 */
type HMRComponent = ComponentOptions | ClassComponent

/**
 * 是否正在热更新
 */
export let isHmrUpdating = false

/**
 * 热更新脏组件
 */
export const hmrDirtyComponents = new Set<ConcreteComponent>()

/**
 * 热更新运行时
 */
export interface HMRRuntime {
  createRecord: typeof createRecord
  rerender: typeof rerender
  reload: typeof reload
}

// Expose the HMR runtime on the global object
// This makes it entirely tree-shakable without polluting the exports and makes
// it easier to be used in toolings like vue-loader
// Note: for a component to be eligible for HMR it also needs the __hmrId option
// to be set so that its instances can be registered / removed.
// 暴露给热更新运行时在一个全局对象上
// 这会使它在没有污染导出值时完整地进行摇树
// 使它更简单地被使用在工具中像vue-loader
// 注意:对于一个符合HMR条件的组件，它还需要设置__hmrId选项
// 所以它的实例可能被注册或者移除
if (__DEV__) {
  getGlobalThis().__VUE_HMR_RUNTIME__ = {
    createRecord: tryWrap(createRecord),
    rerender: tryWrap(rerender),
    reload: tryWrap(reload)
  } as HMRRuntime
}

const map: Map<
  string,
  {
    // the initial component definition is recorded on import - this allows us
    // to apply hot updates to the component even when there are no actively
    // rendered instance.
    // 初始化组件定义被记录在import
    // 这允许我们对于组件使用热更新
    // 即使这时该组件还没有渲染激活的实例
    initialDef: ComponentOptions
    instances: Set<ComponentInternalInstance>
  }
> = new Map()

/**
 * 注册热更新
 * 往对应的热更新id中添加要更新的实例
 * @param instance 
 */
export function registerHMR(instance: ComponentInternalInstance) {
  // id
  const id = instance.type.__hmrId!
  // 记录
  let record = map.get(id)
  // 如果该实例没有记录过
  if (!record) {
    // 创建记录用的map
    createRecord(id, instance.type as HMRComponent)
    // 记录
    record = map.get(id)!
  }
  // 记录的实例列表中添加实例
  record.instances.add(instance)
}

/**
 * 解除实例的热更新注册
 * @param instance 
 */
export function unregisterHMR(instance: ComponentInternalInstance) {
  map.get(instance.type.__hmrId!)!.instances.delete(instance)
}

/**
 * 创建记录
 * @param id 
 * @param initialDef 
 * @returns 
 */
function createRecord(id: string, initialDef: HMRComponent): boolean {
  // 如果map中存在该id，则返回false，不需要再创建这个热更新点
  if (map.has(id)) {
    return false
  }
  // 否则的话  需要创建一个新的
  map.set(id, {
    initialDef: normalizeClassComponent(initialDef),
    instances: new Set()
  })
  // 然后返回一个true
  return true
}

/**
 * 序列化组件class
 * 组件是一个class组件，则返回组件的component.__vccOpts
 * 否则返回组件本身
 * @param component 
 * @returns 
 */
function normalizeClassComponent(component: HMRComponent): ComponentOptions {
  return isClassComponent(component) ? component.__vccOpts : component
}

/**
 * 重新渲染
 * @param id 
 * @param newRender 新渲染器
 * @returns 
 */
function rerender(id: string, newRender?: Function) {
  // 记录
  const record = map.get(id)
  if (!record) {
    return
  }

  // update initial record (for not-yet-rendered component)
  // 更新初始化的record（因为还没渲染的组件）
  record.initialDef.render = newRender

  // Create a snapshot which avoids the set being mutated during updates
  // 创建一个快照可以避免Set在更新期间被操作
  ;[...record.instances].forEach(instance => {
    // 新的渲染函数
    if (newRender) {
      // 赋值新的渲染函数
      instance.render = newRender as InternalRenderFunction
      // 对实例进行序列化，然后将渲染函数赋值给它
      normalizeClassComponent(instance.type as HMRComponent).render = newRender
    }
    // 实例的渲染缓存
    instance.renderCache = []
    // this flag forces child components with slot content to update
    // 这个标记强制子组件使用插槽内容来更新
    isHmrUpdating = true
    // 实例更新
    instance.update()
    // 不是热更新
    isHmrUpdating = false
  })
}

/**
 * 重载
 * @param id 
 * @param newComp 
 * @returns 
 */
function reload(id: string, newComp: HMRComponent) {
  // 获取该次热更新的记录
  const record = map.get(id)
  // 没有在缓存中找到这个进度，则停止执行重新加载
  if (!record) return

  // 序列组件
  newComp = normalizeClassComponent(newComp)
  // update initial def (for not-yet-rendered components)
  // 更新内部的定义（用于还没渲染的组件）
  updateComponentDef(record.initialDef, newComp)

  // create a snapshot which avoids the set being mutated during updates
  // 创建一个快照避免在更新时操作Set
  const instances = [...record.instances]

  // 遍历实例
  for (const instance of instances) {
    const oldComp = normalizeClassComponent(instance.type as HMRComponent)

    // 将热更新脏组件更新
    if (!hmrDirtyComponents.has(oldComp)) {
      // 1. Update existing comp definition to match new one
      // 更新存在的组件定义来匹配新的，就是把旧的更新成新的
      if (oldComp !== record.initialDef) {
        updateComponentDef(oldComp, newComp)
      }
      // 2. mark definition dirty. This forces the renderer to replace the
      // component on patch.
      // 标记定义脏组件，强制渲染器在patch的时候替换这些组件
      hmrDirtyComponents.add(oldComp)
    }

    // 3. invalidate options resolution cache
    // 使options解析缓存失效
    instance.appContext.optionsCache.delete(instance.type as any)

    // 4. actually update
    // 真实更新
    if (instance.ceReload) {
      // custom element
      // 自定义元素
      hmrDirtyComponents.add(oldComp)
      instance.ceReload((newComp as any).styles)
      hmrDirtyComponents.delete(oldComp)
    } else if (instance.parent) {
      // 4. Force the parent instance to re-render. This will cause all updated
      // components to be unmounted and re-mounted. Queue the update so that we
      // don't end up forcing the same parent to re-render multiple times.
      // 强制父实例重新渲染，这将引起所有被更新的组件被卸载和重新挂载
      // 走队列更新，所以我们不需要强制相同的父组件重新渲染多次
      queueJob(instance.parent.update)
      // instance is the inner component of an async custom element
      // invoke to reset styles
      // 实例是一个异步自定义元素的内部组件调用重置样式表
      if (
        (instance.parent.type as ComponentOptions).__asyncLoader &&
        instance.parent.ceReload
      ) {
        // 重载样式表
        instance.parent.ceReload((newComp as any).styles)
      }
    } else if (instance.appContext.reload) {
      // root instance mounted via createApp() has a reload method
      // 根节点实例被挂载
      instance.appContext.reload()
    } else if (typeof window !== 'undefined') {
      // root instance inside tree created via raw render(). Force reload.
      // 树中的根实例通过raw render()创建。直接重新加载页面
      window.location.reload()
    } else {
      // 警告
      console.warn(
        '[HMR] Root or manually mounted instance modified. Full reload required.'
      )
    }
  }

  // 5. make sure to cleanup dirty hmr components after update
  // 保证清理掉脏的热更新组件在更新后
  queuePostFlushCb(() => {
    for (const instance of instances) {
      hmrDirtyComponents.delete(
        normalizeClassComponent(instance.type as HMRComponent)
      )
    }
  })
}

/**
 * 更新组件的定义
 * 使用新组件的选项覆盖旧的
 * 遍历旧组件选项中的key，若key不等于__file且 key不存在新的组件选项中
 * 删除该key
 * @param oldComp 
 * @param newComp 
 */
function updateComponentDef(
  oldComp: ComponentOptions,
  newComp: ComponentOptions
) {
  extend(oldComp, newComp)
  for (const key in oldComp) {
    if (key !== '__file' && !(key in newComp)) {
      delete (oldComp as any)[key]
    }
  }
}

/**
 * 尝试对函数进行包装
 * 返回新的函数
 * 包装主要是针对函数进行错误处理
 * @param fn 
 * @returns 
 */
function tryWrap(fn: (id: string, arg: any) => any): Function {
  return (id: string, arg: any) => {
    try {
      return fn(id, arg)
    } catch (e: any) {
      console.error(e)
      console.warn(
        `[HMR] Something went wrong during Vue component hot-reload. ` +
          `Full reload required.`
      )
    }
  }
}
