import { ReactiveEffect } from './effect'
import { warn } from './warning'

// 已被激活副作用函数的作用域
let activeEffectScope: EffectScope | undefined

// 副作用函数作用域
export class EffectScope {
  /**
   * @internal
   */
  active = true
  /**
   * @internal
   */
  effects: ReactiveEffect[] = [] // 副作用函数
  /**
   * @internal
   */
  cleanups: (() => void)[] = [] // 清理回调

  /**
   * only assigned by undetached scope
   * @internal
   */
  parent: EffectScope | undefined // 父副作用函数作用域
  /**
   * record undetached scopes
   * @internal
   */
  scopes: EffectScope[] | undefined // 副作用函数作用域
  /**
   * track a child scope's index in its parent's scopes array for optimized
   * removal
   * @internal
   * 在父范围数组中跟踪子范围的索引，以优化删除
   */
  private index: number | undefined

  constructor(detached = false) {
    if (!detached && activeEffectScope) { // 如果不进行提取，且当前副作用函数作用域存在
      this.parent = activeEffectScope // 修改当前父节点，并设置当前作用域的索引值
      this.index =
        (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
          this
        ) - 1
    }
  }

  run<T>(fn: () => T): T | undefined {
    if (this.active) {
      const currentEffectScope = activeEffectScope
      try {
        // 执行前使用当前作用域，执行后回到父作用域
        activeEffectScope = this
        return fn()
      } finally {
        activeEffectScope = currentEffectScope
      }
    } else if (__DEV__) {
      warn(`cannot run an inactive effect scope.`)
    }
  }

  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  on() {
    // 修改当前作用域为当前值
    activeEffectScope = this
  }

  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  off() {
    // 作用域回退
    activeEffectScope = this.parent
  }

  stop(fromParent?: boolean) {
    if (this.active) {
      let i, l
      // 停止当前作用域所有副作用函数
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].stop()
      }
      // 触发回调
      for (i = 0, l = this.cleanups.length; i < l; i++) {
        this.cleanups[i]()
      }
      // 子作用于做同样的处理
      if (this.scopes) {
        for (i = 0, l = this.scopes.length; i < l; i++) {
          this.scopes[i].stop(true)
        }
      }
      // nested scope, dereference from parent to avoid memory leaks、
      // 嵌套作用域，解除对父对象的引用以避免内存泄漏
      if (this.parent && !fromParent) {
        // optimized O(1) removal
        // 优化的O(1)删除,实质是交换了与最后一个元素的数据
        const last = this.parent.scopes!.pop()
        if (last && last !== this) {
          this.parent.scopes![this.index!] = last
          last.index = this.index!
        }
      }
      this.active = false
    }
  }
}

// 返回一个新的effectScope
export function effectScope(detached?: boolean) {
  return new EffectScope(detached)
}

// 当前作用域记录一个新的副作用函数
export function recordEffectScope(
  effect: ReactiveEffect,
  scope: EffectScope | undefined = activeEffectScope
) {
  if (scope && scope.active) {
    scope.effects.push(effect)
  }
}

// 获取当前副作用函数的作用域
export function getCurrentScope() {
  return activeEffectScope
}

// 监听作用域丢弃
export function onScopeDispose(fn: () => void) {
  if (activeEffectScope) {
    activeEffectScope.cleanups.push(fn)
  } else if (__DEV__) {
    warn(
      `onScopeDispose() is called when there is no active effect scope` +
        ` to be associated with.`
    )
  }
}
