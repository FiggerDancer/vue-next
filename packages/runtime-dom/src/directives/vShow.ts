import { ObjectDirective } from '@vue/runtime-core'

interface VShowElement extends HTMLElement {
  // _vod = vue original display
  // _vod vue原始的display属性
  _vod: string
}

export const vShow: ObjectDirective<VShowElement> = {
  beforeMount(el, { value }, { transition }) {
    // 挂载前，如果display为none则将该值设置为空，否则设置为display的值
    el._vod = el.style.display === 'none' ? '' : el.style.display
    // 有动画且显示执行动画
    if (transition && value) {
      // 为执行动画做准备  添加 enter-from
      transition.beforeEnter(el)
    } else {
      // 如果没有动画则直接设置
      setDisplay(el, value)
    }
  },
  mounted(el, { value }, { transition }) {
    // 有动画执行动画， 添加enter-active
    if (transition && value) {
      transition.enter(el)
    }
  },
  // 更新
  updated(el, { value, oldValue }, { transition }) {
    if (!value === !oldValue) return
    // v-show值发生变化，
    if (transition) {
      if (value) {
        // 从无到有
        transition.beforeEnter(el)
        setDisplay(el, true)
        transition.enter(el)
      } else {
        // 从有到无
        transition.leave(el, () => {
          setDisplay(el, false)
        })
      }
    } else {
      setDisplay(el, value)
    }
  },
  beforeUnmount(el, { value }) {
    // display设置
    setDisplay(el, value)
  }
}

// 设置display的值
function setDisplay(el: VShowElement, value: unknown): void {
  el.style.display = value ? el._vod : 'none'
}

// SSR vnode transforms, only used when user includes client-oriented render
// function in SSR
// SSR节点转化，仅仅当用户在ssr中使用浏览器导向的渲染函数时使用
export function initVShowForSSR() {
  vShow.getSSRProps = ({ value }) => {
    // 如果没有设置值，则获取到的是display:none
    if (!value) {
      return { style: { display: 'none' } }
    }
  }
}
