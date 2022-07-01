// Note: this file is auto concatenated to the end of the bundled d.ts during
// build.
/**
 * 注意:这个文件会自动连接到捆绑的d.ts的末尾构建。
 */

declare module '@vue/reactivity' {
  export interface RefUnwrapBailTypes {
    runtimeCoreBailTypes:
      | VNode
      | {
          // directly bailing on ComponentPublicInstance results in recursion
          // so we use this as a bail hint
          // 直接在组件公共实例结果后面加一个递归的尾巴，
          // 所以我们可以使用这个做一个一个尾巴提示
          $: ComponentInternalInstance
        }
  }
}
