import { NodeTransform, TransformContext } from '../transform'
import {
  NodeTypes,
  ElementTypes,
  CallExpression,
  ObjectExpression,
  ElementNode,
  DirectiveNode,
  ExpressionNode,
  ArrayExpression,
  createCallExpression,
  createArrayExpression,
  createObjectProperty,
  createSimpleExpression,
  createObjectExpression,
  Property,
  ComponentNode,
  VNodeCall,
  TemplateTextChildNode,
  DirectiveArguments,
  createVNodeCall,
  ConstantTypes
} from '../ast'
import {
  PatchFlags,
  PatchFlagNames,
  isSymbol,
  isOn,
  isObject,
  isReservedProp,
  capitalize,
  camelize,
  isBuiltInDirective
} from '@vue/shared'
import { createCompilerError, ErrorCodes } from '../errors'
import {
  RESOLVE_DIRECTIVE,
  RESOLVE_COMPONENT,
  RESOLVE_DYNAMIC_COMPONENT,
  MERGE_PROPS,
  NORMALIZE_CLASS,
  NORMALIZE_STYLE,
  NORMALIZE_PROPS,
  TO_HANDLERS,
  TELEPORT,
  KEEP_ALIVE,
  SUSPENSE,
  UNREF,
  GUARD_REACTIVE_PROPS
} from '../runtimeHelpers'
import {
  getInnerRange,
  toValidAssetId,
  findProp,
  isCoreComponent,
  isStaticArgOf,
  findDir,
  isStaticExp
} from '../utils'
import { buildSlots } from './vSlot'
import { getConstantType } from './hoistStatic'
import { BindingTypes } from '../options'
import {
  checkCompatEnabled,
  CompilerDeprecationTypes,
  isCompatEnabled
} from '../compat/compatConfig'

// some directive transforms (e.g. v-model) may return a symbol for runtime
// import, which should be used instead of a resolveDirective call.
/**
 * 一些指令转换(例如v-model)可能会返回一个用于运行时导入的符号，
 * 应该使用它来代替resolveDirective调用。
 */
const directiveImportMap = new WeakMap<DirectiveNode, symbol>()

// generate a JavaScript AST for this element's codegen
/**
 * 生成一个js ast用于这个元素代码生成
 * @param node 
 * @param context 
 * @returns 
 */
export const transformElement: NodeTransform = (node, context) => {
  // perform the work on exit, after all child expressions have been
  // processed and merged.
  // 在处理并合并所有子表达式之后，在退出时执行该工作。
  return function postTransformElement() {
    // 节点
    node = context.currentNode!

    if (
      !(
        node.type === NodeTypes.ELEMENT &&
        (node.tagType === ElementTypes.ELEMENT ||
          node.tagType === ElementTypes.COMPONENT)
      )
    ) {
      return
    }

    // 节点标签 props
    const { tag, props } = node
    // 是否是组件
    const isComponent = node.tagType === ElementTypes.COMPONENT

    // The goal of the transform is to create a codegenNode implementing the
    // VNodeCall interface.
    // 转化的目标是创建一个代码生产的节点实现VNodeCall接口
    let vnodeTag = isComponent
      ? resolveComponentType(node as ComponentNode, context)
      : `"${tag}"`

      // 是否是动态组件
    const isDynamicComponent =
      isObject(vnodeTag) && vnodeTag.callee === RESOLVE_DYNAMIC_COMPONENT

    let vnodeProps: VNodeCall['props']
    let vnodeChildren: VNodeCall['children']
    let vnodePatchFlag: VNodeCall['patchFlag']
    let patchFlag: number = 0
    let vnodeDynamicProps: VNodeCall['dynamicProps']
    let dynamicPropNames: string[] | undefined
    let vnodeDirectives: VNodeCall['directives']

    // 是否应该使用block
    let shouldUseBlock =
      // dynamic component may resolve to plain elements
      // 动态组件可以获取到简单元素
      isDynamicComponent ||
      vnodeTag === TELEPORT ||
      vnodeTag === SUSPENSE ||
      (!isComponent &&
        // <svg> and <foreignObject> must be forced into blocks so that block
        // updates inside get proper isSVG flag at runtime. (#639, #643)
        // This is technically web-specific, but splitting the logic out of core
        // leads to too much unnecessary complexity.
        // <svg>和<foreignObject>必须被强制成block中一般内部更新时能够正确的获取svg标记
        // 这是web专有的，但是让它和核心代码区分会导致不必要的复杂性
        (tag === 'svg' || tag === 'foreignObject'))

    // props
    if (props.length > 0) {
      const propsBuildResult = buildProps(node, context)
      // 节点props
      vnodeProps = propsBuildResult.props
      // 更新标记
      patchFlag = propsBuildResult.patchFlag
      // 动态props名称
      dynamicPropNames = propsBuildResult.dynamicPropNames
      // 指令
      const directives = propsBuildResult.directives
      // vnode指令，创建数组表达式
      vnodeDirectives =
        directives && directives.length
          ? (createArrayExpression(
              directives.map(dir => buildDirectiveArgs(dir, context))
            ) as DirectiveArguments)
          : undefined

      if (propsBuildResult.shouldUseBlock) {
        shouldUseBlock = true
      }
    }

    // children
    // 遍历子节点
    if (node.children.length > 0) {
      if (vnodeTag === KEEP_ALIVE) {
        // Although a built-in component, we compile KeepAlive with raw children
        // instead of slot functions so that it can be used inside Transition
        // or other Transition-wrapping HOCs.
        // To ensure correct updates with block optimizations, we need to:
        // 1. Force keep-alive into a block. This avoids its children being
        //    collected by a parent block.
        // 尽管keep-alive是一个内置组件，
        // 但我们编译keep-alive使用原始的子节点而不是插槽函数
        // 以便它可以在transition内部被使用或者其他transition包裹的HOCS
        // 为了确保正确的使用block优化更新，我们需要做：
        // 1. 强制keep-alive转换成block，这避免它的子节点被父级块收集
        shouldUseBlock = true
        // 2. Force keep-alive to always be updated, since it uses raw children.
        // 2. 强制keep-alive总是被更新，因为它使用原始的子节点
        patchFlag |= PatchFlags.DYNAMIC_SLOTS
        // 开发者环境，如果子节点不唯一报错
        if (__DEV__ && node.children.length > 1) {
          context.onError(
            createCompilerError(ErrorCodes.X_KEEP_ALIVE_INVALID_CHILDREN, {
              start: node.children[0].loc.start,
              end: node.children[node.children.length - 1].loc.end,
              source: ''
            })
          )
        }
      }

      // 应该构建作为插槽（组件，不是teleport，不是keep-alive）
      const shouldBuildAsSlots =
        isComponent &&
        // Teleport is not a real component and has dedicated runtime handling
        // teleport不是一个真正的组件并且有专门的运行时处理
        vnodeTag !== TELEPORT &&
        // explained above.
        // 如上所说
        vnodeTag !== KEEP_ALIVE

      if (shouldBuildAsSlots) {
        const { slots, hasDynamicSlots } = buildSlots(node, context)
        vnodeChildren = slots
        // 有动态插槽，增加动态插槽的更新标记
        if (hasDynamicSlots) {
          patchFlag |= PatchFlags.DYNAMIC_SLOTS
        }
      } else if (node.children.length === 1 && vnodeTag !== TELEPORT) {
        const child = node.children[0]
        const type = child.type
        // check for dynamic text children
        // 检查动态文本节点
        const hasDynamicTextChild =
          type === NodeTypes.INTERPOLATION ||
          type === NodeTypes.COMPOUND_EXPRESSION
        if (
          hasDynamicTextChild &&
          getConstantType(child, context) === ConstantTypes.NOT_CONSTANT
        ) {
          // 如果动态文本不是常量，则增加文本更新标记
          patchFlag |= PatchFlags.TEXT
        }
        // pass directly if the only child is a text node
        // (plain / interpolation / expression)
        // 如果只有一个文本节点则直接传值（简单、插槽、表达式）
        if (hasDynamicTextChild || type === NodeTypes.TEXT) {
          vnodeChildren = child as TemplateTextChildNode
        } else {
          vnodeChildren = node.children
        }
      } else {
        vnodeChildren = node.children
      }
    }

    // patchFlag & dynamicPropNames
    // 动态props名称需要更新
    // 更新标记存在
    if (patchFlag !== 0) {
      // 开发者环境收集标记名称方便调试  给 template-explorer用
      if (__DEV__) {
        if (patchFlag < 0) {
          // special flags (negative and mutually exclusive)
          // 特殊标记（否定和互斥）
          vnodePatchFlag = patchFlag + ` /* ${PatchFlagNames[patchFlag]} */`
        } else {
          // bitwise flags
          // 位标记
          const flagNames = Object.keys(PatchFlagNames)
            .map(Number)
            .filter(n => n > 0 && patchFlag & n)
            .map(n => PatchFlagNames[n])
            .join(`, `)
          vnodePatchFlag = patchFlag + ` /* ${flagNames} */`
        }
      } else {
        // 生产环境直接生成出来
        vnodePatchFlag = String(patchFlag)
      }
      if (dynamicPropNames && dynamicPropNames.length) {
        vnodeDynamicProps = stringifyDynamicPropNames(dynamicPropNames)
      }
    }

    node.codegenNode = createVNodeCall(
      context,
      vnodeTag,
      vnodeProps,
      vnodeChildren,
      vnodePatchFlag,
      vnodeDynamicProps,
      vnodeDirectives,
      !!shouldUseBlock,
      false /* disableTracking */,
      isComponent,
      node.loc
    )
  }
}

/**
 * 获取组件类型
 * @param node 
 * @param context 
 * @param ssr 
 * @returns 
 */
export function resolveComponentType(
  node: ComponentNode,
  context: TransformContext,
  ssr = false
) {
  let { tag } = node

  // 1. dynamic component
  // 1. 动态组件
  const isExplicitDynamic = isComponentTag(tag)
  // 获取is prop
  const isProp = findProp(node, 'is')
  if (isProp) {
    // 存在is prop，且是动态组件
    if (
      isExplicitDynamic ||
      (__COMPAT__ &&
        isCompatEnabled(
          CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
          context
        ))
    ) {
      // 获取动态组件的表达式
      const exp =
        isProp.type === NodeTypes.ATTRIBUTE
          ? isProp.value && createSimpleExpression(isProp.value.content, true)
          : isProp.exp
      // 如果是表达式
      if (exp) {
        // 创建调用表达式
        return createCallExpression(context.helper(RESOLVE_DYNAMIC_COMPONENT), [
          exp
        ])
      }
    } else if (
      isProp.type === NodeTypes.ATTRIBUTE &&
      isProp.value!.content.startsWith('vue:')
    ) {
      // <button is="vue:xxx">
      // if not <component>, only is value that starts with "vue:" will be
      // treated as component by the parse phase and reach here, unless it's
      // compat mode where all is values are considered components
      // button is=vue:xxx
      // 如果不是<component> 仅仅是个值用vue:开头将别当成component组件对待除非它是兼容模式，姜蓉模式中所有值都被认为是一个组件
      tag = isProp.value!.content.slice(4)
    }
  }

  // 1.5 v-is (TODO: Deprecate)
  // 1.5 v-is 不建议 不是组件但能找到is指令，当做动态组件处理
  const isDir = !isExplicitDynamic && findDir(node, 'is')
  if (isDir && isDir.exp) {
    return createCallExpression(context.helper(RESOLVE_DYNAMIC_COMPONENT), [
      isDir.exp
    ])
  }

  // 2. built-in components (Teleport, Transition, KeepAlive, Suspense...)
  // 2. 内置组件(teleport, transition, keepalive, suspense)
  const builtIn = isCoreComponent(tag) || context.isBuiltInComponent(tag)
  if (builtIn) {
    // built-ins are simply fallthroughs / have special handling during ssr
    // so we don't need to import their runtime equivalents
    // 内置组件只是在SSR期间进行特殊处理 
    // 所以我们不需要导入它们的运行时等价物
    if (!ssr) context.helper(builtIn)
    return builtIn
  }

  // 3. user component (from setup bindings)
  // this is skipped in browser build since browser builds do not perform
  // binding analysis.
  // 3. 用户组件（来自setup绑定）
  // 在浏览器构建中这被跳过，因为浏览器构建没有执行绑定解析
  if (!__BROWSER__) {
    // 获取来自setup的引用
    const fromSetup = resolveSetupReference(tag, context)
    if (fromSetup) {
      return fromSetup
    }
    const dotIndex = tag.indexOf('.')
    if (dotIndex > 0) {
      // 获取命名空间
      const ns = resolveSetupReference(tag.slice(0, dotIndex), context)
      if (ns) {
        // 通过命名空间计算出setup引用
        return ns + tag.slice(dotIndex)
      }
    }
  }

  // 4. Self referencing component (inferred from filename)
  // 4. 自身递归引用组件，从名字中推断
  if (
    !__BROWSER__ &&
    context.selfName &&
    capitalize(camelize(tag)) === context.selfName
  ) {
    context.helper(RESOLVE_COMPONENT)
    // codegen.ts has special check for __self postfix when generating
    // component imports, which will pass additional `maybeSelfReference` flag
    // to `resolveComponent`.
    // codegen.ts有专门用于自身调用的检查，当生成组件导入的代码时
    // 这将传递额外的 maybeSelfReference 标记给 resolveComponent
    context.components.add(tag + `__self`)
    return toValidAssetId(tag, `component`)
  }

  // 5. user component (resolve)
  // 用户组件 
  context.helper(RESOLVE_COMPONENT)
  context.components.add(tag)
  return toValidAssetId(tag, `component`)
}

/**
 * 
 * @param name 
 * @param context 
 * @returns 
 */
function resolveSetupReference(name: string, context: TransformContext) {
  // 获取绑定值
  const bindings = context.bindingMetadata
  // 没有绑定值或者绑定值不是setup脚本中的
  if (!bindings || bindings.__isScriptSetup === false) {
    return
  }

  // 小驼峰
  const camelName = camelize(name)
  // 大驼峰
  const PascalName = capitalize(camelName)
  // 检查绑定值中存在该名称的哪种形式并返回
  const checkType = (type: BindingTypes) => {
    if (bindings[name] === type) {
      return name
    }
    if (bindings[camelName] === type) {
      return camelName
    }
    if (bindings[PascalName] === type) {
      return PascalName
    }
  }

  // 看是否存在常量
  const fromConst = checkType(BindingTypes.SETUP_CONST)
  if (fromConst) {
    return context.inline
      ? // in inline mode, const setup bindings (e.g. imports) can be used as-is
      // 在内联模式下，const setup绑定(例如导入)可以按原样使用
        fromConst
      : `$setup[${JSON.stringify(fromConst)}]`
  }

  // from可能是一个ref
  const fromMaybeRef =
    checkType(BindingTypes.SETUP_LET) ||
    checkType(BindingTypes.SETUP_REF) ||
    checkType(BindingTypes.SETUP_MAYBE_REF)
  if (fromMaybeRef) {
    return context.inline
      ? // setup scope bindings that may be refs need to be unrefed
      // setup作用域绑定可能是引用，需要取消引用
        `${context.helperString(UNREF)}(${fromMaybeRef})`
      : `$setup[${JSON.stringify(fromMaybeRef)}]`
  }
}

/**
 * Props表达式，可以是一个Object表达式，可以是调用表达式，可以是个表达式节点
 */
export type PropsExpression = ObjectExpression | CallExpression | ExpressionNode

/**
 * 构建props
 * @param node 
 * @param context 
 * @param props 
 * @param ssr 
 * @returns 
 */
export function buildProps(
  node: ElementNode,
  context: TransformContext,
  props: ElementNode['props'] = node.props,
  ssr = false
): {
  props: PropsExpression | undefined
  directives: DirectiveNode[]
  patchFlag: number
  dynamicPropNames: string[]
  shouldUseBlock: boolean
} {
  const { tag, loc: elementLoc, children } = node
  // 是动态组件
  const isComponent = node.tagType === ElementTypes.COMPONENT
  // 属性
  let properties: ObjectExpression['properties'] = []
  // 合并参数
  const mergeArgs: PropsExpression[] = []
  // 运行时指令
  const runtimeDirectives: DirectiveNode[] = []
  // 有子节点
  const hasChildren = children.length > 0
  let shouldUseBlock = false

  // patchFlag analysis
  // 更新解析补丁
  let patchFlag = 0
  // 包含template ref
  let hasRef = false
  // 包含类名绑定
  let hasClassBinding = false
  // 包含样式绑定
  let hasStyleBinding = false
  // 包含注水事件绑定
  let hasHydrationEventBinding = false
  // 有动态的key
  let hasDynamicKeys = false
  // 有vnode钩子
  let hasVnodeHook = false
  // 动态prop名称
  const dynamicPropNames: string[] = []

  // 分析更新标记
  const analyzePatchFlag = ({ key, value }: Property) => {
    // 是静态表达式
    if (isStaticExp(key)) {
      // key的名称
      const name = key.content
      // 是事件处理器
      const isEventHandler = isOn(name)
      if (
        !isComponent &&
        isEventHandler &&
        // omit the flag for click handlers because hydration gives click
        // dedicated fast path.
        // 省略点击处理程序的标志，
        // 因为水合为点击提供了专用的快速路径。
        name.toLowerCase() !== 'onclick' &&
        // omit v-model handlers
        // 省略v-model处理程序
        name !== 'onUpdate:modelValue' &&
        // omit onVnodeXXX hooks
        // 省略onVnodeXXX钩子
        // 不是保留的prop
        !isReservedProp(name)
      ) {
        // 有混合的事件绑定
        hasHydrationEventBinding = true
      }

      // 是事件处理器且保留了prop
      if (isEventHandler && isReservedProp(name)) {
        hasVnodeHook = true
      }

      if (
        value.type === NodeTypes.JS_CACHE_EXPRESSION ||
        ((value.type === NodeTypes.SIMPLE_EXPRESSION ||
          value.type === NodeTypes.COMPOUND_EXPRESSION) &&
          getConstantType(value, context) > 0)
      ) {
        // skip if the prop is a cached handler or has constant value
        // 如果prop是一个缓存处理器或者是常量跳过
        return
      }

      if (name === 'ref') {
        hasRef = true
      } else if (name === 'class') {
        hasClassBinding = true
      } else if (name === 'style') {
        hasStyleBinding = true
      } else if (name !== 'key' && !dynamicPropNames.includes(name)) {
        // name不是key且不是动态prop
        dynamicPropNames.push(name)
      }

      // treat the dynamic class and style binding of the component as dynamic props
      // 将动态类名和组件的样式绑定当做动态props处理
      if (
        isComponent &&
        (name === 'class' || name === 'style') &&
        !dynamicPropNames.includes(name)
      ) {
        dynamicPropNames.push(name)
      }
    } else {
      // 有动态key
      hasDynamicKeys = true
    }
  }
  
  // 遍历props
  for (let i = 0; i < props.length; i++) {
    // static attribute
    // 静态attr
    const prop = props[i]
    // 节点类型type
    if (prop.type === NodeTypes.ATTRIBUTE) {
      // 获取prop的信息
      const { loc, name, value } = prop
      let isStatic = true
      // 如过是template ref 
      if (name === 'ref') {
        hasRef = true
        // 上下文作用域 v-for的分支大于0
        if (context.scopes.vFor > 0) {
          // 属性收集
          properties.push(
            createObjectProperty(
              createSimpleExpression('ref_for', true),
              createSimpleExpression('true')
            )
          )
        }
        // in inline mode there is no setupState object, so we can't use string
        // keys to set the ref. Instead, we need to transform it to pass the
        // actual ref instead.
        // 在内联模式中不存在非setupState的对象，所以我们不能
        // 使用字符串key来设置ref
        // 我们需要转化它通过真实的ref
        if (
          !__BROWSER__ &&
          value &&
          context.inline &&
          context.bindingMetadata[value.content]
        ) {
          isStatic = false
          properties.push(
            createObjectProperty(
              createSimpleExpression('ref_key', true),
              createSimpleExpression(value.content, true, value.loc)
            )
          )
        }
      }
      // skip is on <component>, or is="vue:xxx"
      // 跳过动态组件
      if (
        name === 'is' &&
        (isComponentTag(tag) ||
          (value && value.content.startsWith('vue:')) ||
          (__COMPAT__ &&
            isCompatEnabled(
              CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
              context
            )))
      ) {
        continue
      }
      properties.push(
        createObjectProperty(
          createSimpleExpression(
            name,
            true,
            getInnerRange(loc, 0, name.length)
          ),
          createSimpleExpression(
            value ? value.content : '',
            isStatic,
            value ? value.loc : loc
          )
        )
      )
    } else {
      // directives
      // 指令
      const { name, arg, exp, loc } = prop
      const isVBind = name === 'bind'
      const isVOn = name === 'on'

      // skip v-slot - it is handled by its dedicated transform.
      // 跳过v-slot 它有专用的转换处理
      if (name === 'slot') {
        // 不是组件
        if (!isComponent) {
          context.onError(
            createCompilerError(ErrorCodes.X_V_SLOT_MISPLACED, loc)
          )
        }
        continue
      }
      // skip v-once/v-memo - they are handled by dedicated transforms.
      // 跳过v-once/v-memo 他们有专有的转换器法处理
      if (name === 'once' || name === 'memo') {
        continue
      }
      // skip v-is and :is on <component>
      // 跳过v-is和:is在动态组件上的
      if (
        name === 'is' ||
        (isVBind &&
          isStaticArgOf(arg, 'is') &&
          (isComponentTag(tag) ||
            (__COMPAT__ &&
              isCompatEnabled(
                CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
                context
              ))))
      ) {
        continue
      }
      // skip v-on in SSR compilation
      // 在ssr中跳过v-on
      if (isVOn && ssr) {
        continue
      }

      if (
        // #938: elements with dynamic keys should be forced into blocks
        // 元素使用动态的key应该被强制转化为块
        (isVBind && isStaticArgOf(arg, 'key')) ||
        // inline before-update hooks need to force block so that it is invoked
        // before children
        // 内联更新钩子需要强制变成块，因为它的更新触发需要在子节点的更新钩子触发前触发
        (isVOn && hasChildren && isStaticArgOf(arg, 'vue:before-update'))
      ) {
        shouldUseBlock = true
      }

      // 是v-bind且ref是静态参数
      // 上下文作用域v-for存在
      if (isVBind && isStaticArgOf(arg, 'ref') && context.scopes.vFor > 0) {
        properties.push(
          createObjectProperty(
            createSimpleExpression('ref_for', true),
            createSimpleExpression('true')
          )
        )
      }

      // special case for v-bind and v-on with no argument
      // 特殊情况v-bind和v-on没有参数
      if (!arg && (isVBind || isVOn)) {
        hasDynamicKeys = true
        // 表达式
        if (exp) {
          // 清空属性
          if (properties.length) {
            // 合并参数
            mergeArgs.push(
              createObjectExpression(dedupeProperties(properties), elementLoc)
            )
            properties = []
          }
          // v-bind
          if (isVBind) {
            if (__COMPAT__) {
              // 2.x v-bind object order compat
              // 2.x v-bind 对象顺序兼容
              if (__DEV__) {
                const hasOverridableKeys = mergeArgs.some(arg => {
                  if (arg.type === NodeTypes.JS_OBJECT_EXPRESSION) {
                    return arg.properties.some(({ key }) => {
                      if (
                        key.type !== NodeTypes.SIMPLE_EXPRESSION ||
                        !key.isStatic
                      ) {
                        return true
                      }
                      return (
                        key.content !== 'class' &&
                        key.content !== 'style' &&
                        !isOn(key.content)
                      )
                    })
                  } else {
                    // dynamic expression
                    return true
                  }
                })
                if (hasOverridableKeys) {
                  checkCompatEnabled(
                    CompilerDeprecationTypes.COMPILER_V_BIND_OBJECT_ORDER,
                    context,
                    loc
                  )
                }
              }

              if (
                isCompatEnabled(
                  CompilerDeprecationTypes.COMPILER_V_BIND_OBJECT_ORDER,
                  context
                )
              ) {
                mergeArgs.unshift(exp)
                continue
              }
            }

            mergeArgs.push(exp)
          } else {
            // v-on="obj" -> toHandlers(obj)
            mergeArgs.push({
              type: NodeTypes.JS_CALL_EXPRESSION,
              loc,
              callee: context.helper(TO_HANDLERS),
              arguments: [exp]
            })
          }
        } else {
          context.onError(
            createCompilerError(
              isVBind
                ? ErrorCodes.X_V_BIND_NO_EXPRESSION
                : ErrorCodes.X_V_ON_NO_EXPRESSION,
              loc
            )
          )
        }
        continue
      }

      // 指令转化
      const directiveTransform = context.directiveTransforms[name]
      if (directiveTransform) {
        // has built-in directive transform.
        // 有内置的指令转化
        const { props, needRuntime } = directiveTransform(prop, node, context)
        // 非ssr环境遍历每个prop
        !ssr && props.forEach(analyzePatchFlag)
        // 放入属性
        properties.push(...props)
        // 需要运行时
        if (needRuntime) {
          // 运行时指令放入prop
          runtimeDirectives.push(prop)
          if (isSymbol(needRuntime)) {
            directiveImportMap.set(prop, needRuntime)
          }
        }
      } else if (!isBuiltInDirective(name)) {
        // no built-in transform, this is a user custom directive.
        // 非内置转化，这是一个用户自定义指令
        runtimeDirectives.push(prop)
        // custom dirs may use beforeUpdate so they need to force blocks
        // to ensure before-update gets called before children update
        // 自定义指令可以使用beforeUpdate所以他们需要强制转成block以保证before-update在子节点的更新前调用
        if (hasChildren) {
          shouldUseBlock = true
        }
      }
    }
  }

  // props表达式
  let propsExpression: PropsExpression | undefined = undefined

  // has v-bind="object" or v-on="object", wrap with mergeProps
  // 有v-bind="object"或者v-on="object",是用mergeProps包裹
  if (mergeArgs.length) {
    if (properties.length) {
      mergeArgs.push(
        createObjectExpression(dedupeProperties(properties), elementLoc)
      )
    }
    if (mergeArgs.length > 1) {
      propsExpression = createCallExpression(
        context.helper(MERGE_PROPS),
        mergeArgs,
        elementLoc
      )
    } else {
      // single v-bind with nothing else - no need for a mergeProps call
      // 一个v-bind，不需要调用mergeProps
      propsExpression = mergeArgs[0]
    }
  } else if (properties.length) {
    propsExpression = createObjectExpression(
      dedupeProperties(properties),
      elementLoc
    )
  }

  // patchFlag analysis
  // 更新标记分析
  // 有动态的keys，全props更新
  if (hasDynamicKeys) {
    patchFlag |= PatchFlags.FULL_PROPS
  } else {
    // 有类名绑定，但不是组件
    if (hasClassBinding && !isComponent) {
      patchFlag |= PatchFlags.CLASS
    }
    // 有style绑定但不是组件
    if (hasStyleBinding && !isComponent) {
      patchFlag |= PatchFlags.STYLE
    }
    // 有动态prop名称
    if (dynamicPropNames.length) {
      patchFlag |= PatchFlags.PROPS
    }
    // 有注水的事件绑定
    if (hasHydrationEventBinding) {
      patchFlag |= PatchFlags.HYDRATE_EVENTS
    }
  }
  // 不是block且有template ref或者有 vnode hook，或者
  // 运行时指令 
  // 且补丁标记为0或者注水
  if (
    !shouldUseBlock &&
    (patchFlag === 0 || patchFlag === PatchFlags.HYDRATE_EVENTS) &&
    (hasRef || hasVnodeHook || runtimeDirectives.length > 0)
  ) {
    // 需要更新
    patchFlag |= PatchFlags.NEED_PATCH
  }

  // pre-normalize props, SSR is skipped for now
  // 预序列化props，SSR现在被跳过
  if (!context.inSSR && propsExpression) {
    switch (propsExpression.type) {
      case NodeTypes.JS_OBJECT_EXPRESSION:
        // means that there is no v-bind,
        // but still need to deal with dynamic key binding
        // 意味着那没有v-bind
        // 但依然需要处理动态key绑定
        let classKeyIndex = -1
        let styleKeyIndex = -1
        let hasDynamicKey = false

        // 遍历props表达式的属性
        for (let i = 0; i < propsExpression.properties.length; i++) {
          // 获取属性的键
          const key = propsExpression.properties[i].key
          // 键是静态表达式
          if (isStaticExp(key)) {
            // 获取类名、style在properites中的索引
            // 键的是类名
            if (key.content === 'class') {
              classKeyIndex = i
            } else if (key.content === 'style') {
              // 键的是style
              styleKeyIndex = i
            }
          } else if (!key.isHandlerKey) {
            // 键不是处理器则说明是存在动态的键
            hasDynamicKey = true
          }
        }

        // 类名prop props表达式的属性类名在属性列表中的索引
        // 获取类名prop和style Prop
        const classProp = propsExpression.properties[classKeyIndex]
        const styleProp = propsExpression.properties[styleKeyIndex]

        // no dynamic key
        // 没有动态的键
        if (!hasDynamicKey) {
          // 类名prop且类名prop的值不是静态表达式
          if (classProp && !isStaticExp(classProp.value)) {
            // 类名prop的值
            // 创建调用表达式
            classProp.value = createCallExpression(
              context.helper(NORMALIZE_CLASS),
              [classProp.value]
            )
          }
          // style prop 且 不是静态表达式
          if (
            styleProp &&
            !isStaticExp(styleProp.value) &&
            // the static style is compiled into an object,
            // so use `hasStyleBinding` to ensure that it is a dynamic style binding
            // 静态样式被编译成对象，所以使用`有样式绑定`来确保
            // 它是一个动态样式绑定
            (hasStyleBinding ||
              // v-bind:style and style both exist,
              // v-bind:style with static literal object
              // v-bind: style和style都退出
              // v-bind:style存在静态的字面量对象
              styleProp.value.type === NodeTypes.JS_ARRAY_EXPRESSION)
          ) {
            // style的prop的值
            styleProp.value = createCallExpression(
              context.helper(NORMALIZE_STYLE),
              [styleProp.value]
            )
          }
        } else {
          // dynamic key binding, wrap with `normalizeProps`
          // 动态键的绑定，使用 `序列化props`包裹
          propsExpression = createCallExpression(
            context.helper(NORMALIZE_PROPS),
            [propsExpression]
          )
        }
        break
      case NodeTypes.JS_CALL_EXPRESSION:
        // mergeProps call, do nothing
        // 合并props调用，不做任何事
        break
      default:
        // single v-bind
        // 单个 v-bind
        propsExpression = createCallExpression(
          context.helper(NORMALIZE_PROPS),
          [
            createCallExpression(context.helper(GUARD_REACTIVE_PROPS), [
              propsExpression
            ])
          ]
        )
        break
    }
  }

  return {
    // props表达式
    props: propsExpression,
    // 指令
    directives: runtimeDirectives,
    // 更新标记
    patchFlag,
    // 动态prop名称
    dynamicPropNames,
    // 应该转化成块
    shouldUseBlock
  }
}

// Dedupe props in an object literal.
// Literal duplicated attributes would have been warned during the parse phase,
// however, it's possible to encounter duplicated `onXXX` handlers with different
// modifiers. We also need to merge static and dynamic class / style attributes.
// - onXXX handlers / style: merge into array
// - class: merge into single expression with concatenation
/**
 * 去重一个对象字面量上重复的prop
 * 字面量重复的attr将会在解析阶段警告
 * 然而，它依然存在onXXX处理器用不同的修饰器
 * 我们需要合并静态和动态的类名样式attr
 * onXXX处理器或者样式使用数组合并
 * 类名，合并成一个单独的表达式
 * @param properties 
 * @returns 
 */
function dedupeProperties(properties: Property[]): Property[] {
  // 已知props
  const knownProps: Map<string, Property> = new Map()
  // 去重
  const deduped: Property[] = []
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]
    // dynamic keys are always allowed
    // 动态的key总是被允许的
    if (prop.key.type === NodeTypes.COMPOUND_EXPRESSION || !prop.key.isStatic) {
      deduped.push(prop)
      continue
    }
    // 名
    const name = prop.key.content
    // 存在
    const existing = knownProps.get(name)
    // prop已存在
    if (existing) {
      if (name === 'style' || name === 'class' || isOn(name)) {
        // 合并数组
        mergeAsArray(existing, prop)
      }
      // unexpected duplicate, should have emitted error during parse
      // 不被期待的副本，应该已经在解析期间触发了错误
    } else {
      knownProps.set(name, prop)
      deduped.push(prop)
    }
  }
  // 去重后的数组
  return deduped
}

/**
 * 合并作为一个数组
 * @param existing 已经存在的
 * @param incoming 即将合并进来的
 */
function mergeAsArray(existing: Property, incoming: Property) {
  // 存在的值的类型是数组表达式
  if (existing.value.type === NodeTypes.JS_ARRAY_EXPRESSION) {
    // 存在的值的元素放入新元素
    existing.value.elements.push(incoming.value)
  } else {
    // 存在的值
    existing.value = createArrayExpression(
      [existing.value, incoming.value],
      existing.loc
    )
  }
}

/**
 * 构建指令参数
 * @param dir ]
 * @param context 
 * @returns 
 */
export function buildDirectiveArgs(
  dir: DirectiveNode,
  context: TransformContext
): ArrayExpression {
  // 指令参数
  const dirArgs: ArrayExpression['elements'] = []
  // 运行时
  const runtime = directiveImportMap.get(dir)
  if (runtime) {
    // built-in directive with runtime
    // 运行时内置指令
    dirArgs.push(context.helperString(runtime))
  } else {
    // user directive.
    // see if we have directives exposed via <script setup>
    // 用户自定义的指令
    // 看是否我们有通过<script setup>暴露的指令
    const fromSetup =
      !__BROWSER__ && resolveSetupReference('v-' + dir.name, context)
    if (fromSetup) {
      dirArgs.push(fromSetup)
    } else {
      // inject statement for resolving directive
      // 注入语句用于获取指令
      context.helper(RESOLVE_DIRECTIVE)
      context.directives.add(dir.name)
      dirArgs.push(toValidAssetId(dir.name, `directive`))
    }
  }
  // 指令位置
  const { loc } = dir
  // 指令表达式
  if (dir.exp) dirArgs.push(dir.exp)
  // 指令参数
  if (dir.arg) {
    // 如果没有指令表达式
    if (!dir.exp) {
      dirArgs.push(`void 0`)
    }
    // 放入参数
    dirArgs.push(dir.arg)
  }
  // 遍历修饰符
  if (Object.keys(dir.modifiers).length) {
    if (!dir.arg) {
      // 指令无参数也没有表达式
      if (!dir.exp) {
        dirArgs.push(`void 0`)
      }
      dirArgs.push(`void 0`)
    }
    // 创建简单表达式true
    const trueExpression = createSimpleExpression(`true`, false, loc)
    // 创建对象表达式并收集
    dirArgs.push(
      createObjectExpression(
        // 指令修饰器创建对象属性
        dir.modifiers.map(modifier =>
          createObjectProperty(modifier, trueExpression)
        ),
        loc
      )
    )
  }
  // 创建数组表达式
  return createArrayExpression(dirArgs, dir.loc)
}

/**
 * 字符串化动态prop名称
 * [{'prop1':'123'}]
 * @param props 
 * @returns 
 */
function stringifyDynamicPropNames(props: string[]): string {
  let propsNamesString = `[`
  for (let i = 0, l = props.length; i < l; i++) {
    propsNamesString += JSON.stringify(props[i])
    if (i < l - 1) propsNamesString += ', '
  }
  return propsNamesString + `]`
}

/**
 * 是动态组件标签
 * @param tag 
 * @returns 
 */
function isComponentTag(tag: string) {
  return tag === 'component' || tag === 'Component'
}
