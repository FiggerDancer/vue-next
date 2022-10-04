import { CompilerOptions } from './options'
import { baseParse } from './parse'
import { transform, NodeTransform, DirectiveTransform } from './transform'
import { generate, CodegenResult } from './codegen'
import { RootNode } from './ast'
import { isString, extend } from '@vue/shared'
import { transformIf } from './transforms/vIf'
import { transformFor } from './transforms/vFor'
import { transformExpression } from './transforms/transformExpression'
import { transformSlotOutlet } from './transforms/transformSlotOutlet'
import { transformElement } from './transforms/transformElement'
import { transformOn } from './transforms/vOn'
import { transformBind } from './transforms/vBind'
import { trackSlotScopes, trackVForSlotScopes } from './transforms/vSlot'
import { transformText } from './transforms/transformText'
import { transformOnce } from './transforms/vOnce'
import { transformModel } from './transforms/vModel'
import { transformFilter } from './compat/transformFilter'
import { defaultOnError, createCompilerError, ErrorCodes } from './errors'
import { transformMemo } from './transforms/vMemo'

/**
 * 转化预设
 */
export type TransformPreset = [
  NodeTransform[],
  Record<string, DirectiveTransform>
]

/**
 * 生成基本的转化预设
 * @param prefixIdentifiers 前缀标识符
 * @returns 一堆转化函数
 * [
 *  [
 *    v-once, 
 *    v-if,
 *    v-memo,
 *    v-for
 *    filter
 *    trackVForSlotScopes, 
 *    表达式,
 *    插槽，
 *    元素，
 *    作用域，
 *    文本
 *  ],
 *  {
 *    v-on,
 *    v-bind,
 *    v-model,
 *  }
 * ]
 */
export function getBaseTransformPreset(
  prefixIdentifiers?: boolean
): TransformPreset {
  return [
    [
      transformOnce,
      transformIf,
      transformMemo,
      transformFor,
      ...(__COMPAT__ ? [transformFilter] : []),
      ...(!__BROWSER__ && prefixIdentifiers
        ? [
            // order is important
            trackVForSlotScopes,
            transformExpression
          ]
        : __BROWSER__ && __DEV__
        ? [transformExpression]
        : []),
      transformSlotOutlet,
      transformElement,
      trackSlotScopes,
      transformText
    ],
    {
      on: transformOn,
      bind: transformBind,
      model: transformModel
    }
  ]
}

// we name it `baseCompile` so that higher order compilers like
// @vue/compiler-dom can export `compile` while re-exporting everything else.
// 我们命名它 `baseCompile` 所以它具有更高的编译优先级像 @vue/compiler-dom
// 当导出 compile 同时可以重新导出任何东西
/**
 *
 *
 * @export
 * @param {(string | RootNode)} template 模板
 * @param {CompilerOptions} [options={}] 选项
 * @return {*}  {CodegenResult}
 */
export function baseCompile(
  template: string | RootNode,
  options: CompilerOptions = {}
): CodegenResult {
  const onError = options.onError || defaultOnError
  const isModuleMode = options.mode === 'module'
  /* istanbul ignore if */
  if (__BROWSER__) {
    // 如果是浏览器环境，且前缀标识符选项是true
    if (options.prefixIdentifiers === true) {
      // 创建一个编译器错误并对该错误进行监听
      onError(createCompilerError(ErrorCodes.X_PREFIX_ID_NOT_SUPPORTED))
    } else if (isModuleMode) {
      // 是模块模式，则对应创建模块模式的报错信息
      onError(createCompilerError(ErrorCodes.X_MODULE_MODE_NOT_SUPPORTED))
    }
  }

  // 是否有前缀标识符
  const prefixIdentifiers =
    !__BROWSER__ && (options.prefixIdentifiers === true || isModuleMode)
  // 没有前缀标识符且有缓存处理函数
  if (!prefixIdentifiers && options.cacheHandlers) {
    onError(createCompilerError(ErrorCodes.X_CACHE_HANDLER_NOT_SUPPORTED))
  }
  // 作用域Id且不是一个模块模式，添加错误监听
  if (options.scopeId && !isModuleMode) {
    onError(createCompilerError(ErrorCodes.X_SCOPE_ID_NOT_SUPPORTED))
  }

  /** 
   * 如果template是个字符串，
   * 则对其进行基本解析生成ast语法树，
   * 否则说明已经是转化后的结果了直接返回本身
   * 
   * 解析tempalte生成ast 
   * */ 
  const ast = isString(template) ? baseParse(template, options) : template
  /* 从基础转化预设中获取节点转化和指令转化方法 */
  const [nodeTransforms, directiveTransforms] =
    getBaseTransformPreset(prefixIdentifiers)

  // 非浏览器且是ts  
  if (!__BROWSER__ && options.isTS) {
    // 表达式插件
    const { expressionPlugins } = options
    // 没有表达式插件或者表达式插件里没有ts，无论如何要把ts加进去
    if (!expressionPlugins || !expressionPlugins.includes('typescript')) {
      // 表达式插件 typescript
      options.expressionPlugins = [...(expressionPlugins || []), 'typescript']
    }
  }

  // ast转换
  transform(
    ast,
    extend({}, options, { // 转化的配置项
      prefixIdentifiers,
      nodeTransforms: [
        ...nodeTransforms, // 节点转化
        ...(options.nodeTransforms || []) // user transforms // 用户提供的转化
      ],
      directiveTransforms: extend(
        {},
        directiveTransforms, // 指令转化
        options.directiveTransforms || {} // user transforms // 用户配置的自定义指令
      )
    })
  )

  // 生成代码
  return generate(
    ast,
    extend({}, options, {
      prefixIdentifiers
    })
  )
}
