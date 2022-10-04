import {
  createStructuralDirectiveTransform,
  TransformContext
} from '../transform'
import {
  NodeTypes,
  ExpressionNode,
  createSimpleExpression,
  SourceLocation,
  SimpleExpressionNode,
  createCallExpression,
  createFunctionExpression,
  createObjectExpression,
  createObjectProperty,
  ForCodegenNode,
  RenderSlotCall,
  SlotOutletNode,
  ElementNode,
  DirectiveNode,
  ForNode,
  PlainElementNode,
  createVNodeCall,
  VNodeCall,
  ForRenderListExpression,
  BlockCodegenNode,
  ForIteratorExpression,
  ConstantTypes,
  createBlockStatement,
  createCompoundExpression
} from '../ast'
import { createCompilerError, ErrorCodes } from '../errors'
import {
  getInnerRange,
  findProp,
  isTemplateNode,
  isSlotOutlet,
  injectProp,
  getVNodeBlockHelper,
  getVNodeHelper,
  findDir
} from '../utils'
import {
  RENDER_LIST,
  OPEN_BLOCK,
  FRAGMENT,
  IS_MEMO_SAME
} from '../runtimeHelpers'
import { processExpression } from './transformExpression'
import { validateBrowserExpression } from '../validateExpression'
import { PatchFlags, PatchFlagNames } from '@vue/shared'

/**
 * v-for
 */
export const transformFor = createStructuralDirectiveTransform(
  'for',
  (node, dir, context) => {
    const { helper, removeHelper } = context
    return processFor(node, dir, context, forNode => {
      // create the loop render function expression now, and add the
      // iterator on exit after all children have been traversed
      // 创建循环渲染函数表达式，
      // 并且在所有子节点遍历完毕退出时，增加迭代器
      const renderExp = createCallExpression(helper(RENDER_LIST), [
        forNode.source
      ]) as ForRenderListExpression
      // 是template
      const isTemplate = isTemplateNode(node)
      // v-memo
      const memo = findDir(node, 'memo')
      // key
      const keyProp = findProp(node, `key`)
      // key的value表达式
      const keyExp =
        keyProp &&
        (keyProp.type === NodeTypes.ATTRIBUTE
          ? createSimpleExpression(keyProp.value!.content, true)
          : keyProp.exp!)
      // key属性
      const keyProperty = keyProp ? createObjectProperty(`key`, keyExp!) : null

      if (!__BROWSER__ && isTemplate) {
        // #2085 / #5288 process :key and v-memo expressions need to be
        // processed on `<template v-for>`. In this case the node is discarded
        // and never traversed so its binding expressions won't be processed
        // by the normal transforms.
        // 处理 在<template v-for>:key和v-memo表达式需要被处理
        // 这种情况下node被废弃并且从来不会遍历
        // 所以它的绑定表达式不会被正常的转化处理
        if (memo) {
          // 处理表达式
          memo.exp = processExpression(
            memo.exp! as SimpleExpressionNode,
            context
          )
        }
        // key属性且key的属性不是attr
        if (keyProperty && keyProp!.type !== NodeTypes.ATTRIBUTE) {
          // 处理表达式
          keyProperty.value = processExpression(
            keyProperty.value as SimpleExpressionNode,
            context
          )
        }
      }

      // 是静态的fragment，简单表达式且是常量
      const isStableFragment =
        forNode.source.type === NodeTypes.SIMPLE_EXPRESSION &&
        forNode.source.constType > ConstantTypes.NOT_CONSTANT
      // fragment标记，是静态Fragment，有key，无key三种
      const fragmentFlag = isStableFragment
        ? PatchFlags.STABLE_FRAGMENT
        : keyProp
        ? PatchFlags.KEYED_FRAGMENT
        : PatchFlags.UNKEYED_FRAGMENT

      // for节点代码
      forNode.codegenNode = createVNodeCall(
        context,
        helper(FRAGMENT),
        undefined,
        renderExp,
        fragmentFlag +
          (__DEV__ ? ` /* ${PatchFlagNames[fragmentFlag]} */` : ``),
        undefined,
        undefined,
        true /* isBlock */,
        !isStableFragment /* disableTracking */,
        false /* isComponent */,
        node.loc
      ) as ForCodegenNode

      return () => {
        // finish the codegen now that all children have been traversed
        // 所有的子节点遍历完成后立刻结束代码生成
        let childBlock: BlockCodegenNode
        const { children } = forNode

        // check <template v-for> key placement
        // 检查<template v-for>key 占位
        if ((__DEV__ || !__BROWSER__) && isTemplate) {
          // 子节点遍历
          node.children.some(c => {
            if (c.type === NodeTypes.ELEMENT) {
              const key = findProp(c, 'key')
              if (key) {
                context.onError(
                  createCompilerError(
                    ErrorCodes.X_V_FOR_TEMPLATE_KEY_PLACEMENT,
                    key.loc
                  )
                )
                return true
              }
            }
          })
        }

        // 子节点个数大于1需要fragment包裹，或者只有
        // 一个子节点，但是子节点不是元素
        const needFragmentWrapper =
          children.length !== 1 || children[0].type !== NodeTypes.ELEMENT
        // 插槽出口
        const slotOutlet = isSlotOutlet(node)
          ? node
          : isTemplate &&
            node.children.length === 1 &&
            isSlotOutlet(node.children[0])
          ? (node.children[0] as SlotOutletNode) // api-extractor somehow fails to infer this
          : null

        // 是插槽出口
        if (slotOutlet) {
          // <slot v-for="..."> or <template v-for="..."><slot/></template>
          // <slot v-for=""> 或者 
          // <template v-for="..."><slot/></template>
          childBlock = slotOutlet.codegenNode as RenderSlotCall
          if (isTemplate && keyProperty) {
            // <template v-for="..." :key="..."><slot/></template>
            // we need to inject the key to the renderSlot() call.
            // the props for renderSlot is passed as the 3rd argument.
            // 是<template>节点则我们需要注入key到renderSlot中
            // renderSlot的属性作为第三个参数传递。
            injectProp(childBlock, keyProperty, context)
          }
        } else if (needFragmentWrapper) {
          // <template v-for="..."> with text or multi-elements
          // 使用text或者多个元素
          // should generate a fragment block for each loop
          // 应该生成一个fragment block用于每次循环
          childBlock = createVNodeCall(
            context,
            helper(FRAGMENT),
            keyProperty ? createObjectExpression([keyProperty]) : undefined,
            node.children,
            PatchFlags.STABLE_FRAGMENT +
              (__DEV__
                ? ` /* ${PatchFlagNames[PatchFlags.STABLE_FRAGMENT]} */`
                : ``),
            undefined,
            undefined,
            true,
            undefined,
            false /* isComponent */
          )
        } else {
          // Normal element v-for. Directly use the child's codegenNode
          // but mark it as a block.
          // 普通元素 v-for 直接使用子节点代码
          // 但是将它标记为block
          childBlock = (children[0] as PlainElementNode)
            .codegenNode as VNodeCall
          if (isTemplate && keyProperty) {
            injectProp(childBlock, keyProperty, context)
          }
          if (childBlock.isBlock !== !isStableFragment) {
            if (childBlock.isBlock) {
              // switch from block to vnode
              // 从block切换到vnode
              removeHelper(OPEN_BLOCK)
              removeHelper(
                getVNodeBlockHelper(context.inSSR, childBlock.isComponent)
              )
            } else {
              // switch from vnode to block
              // 从vnode切换到block
              removeHelper(
                getVNodeHelper(context.inSSR, childBlock.isComponent)
              )
            }
          }
          childBlock.isBlock = !isStableFragment
          if (childBlock.isBlock) {
            helper(OPEN_BLOCK)
            helper(getVNodeBlockHelper(context.inSSR, childBlock.isComponent))
          } else {
            helper(getVNodeHelper(context.inSSR, childBlock.isComponent))
          }
        }

        // v-memo
        if (memo) {
          const loop = createFunctionExpression(
            createForLoopParams(forNode.parseResult, [
              createSimpleExpression(`_cached`)
            ])
          )
          loop.body = createBlockStatement([
            createCompoundExpression([`const _memo = (`, memo.exp!, `)`]),
            createCompoundExpression([
              `if (_cached`,
              ...(keyExp ? [` && _cached.key === `, keyExp] : []),
              ` && ${context.helperString(
                IS_MEMO_SAME
              )}(_cached, _memo)) return _cached`
            ]),
            createCompoundExpression([`const _item = `, childBlock as any]),
            createSimpleExpression(`_item.memo = _memo`),
            createSimpleExpression(`return _item`)
          ])
          renderExp.arguments.push(
            loop as ForIteratorExpression,
            createSimpleExpression(`_cache`),
            createSimpleExpression(String(context.cached++))
          )
        } else {
          renderExp.arguments.push(
            createFunctionExpression(
              createForLoopParams(forNode.parseResult),
              childBlock,
              true /* force newline */
            ) as ForIteratorExpression
          )
        }
      }
    })
  }
)

// target-agnostic transform used for both Client and SSR
/**
 * 客户端和SSR都使用目标不可知变换
 * @param node 
 * @param dir 
 * @param context 
 * @param processCodegen 
 * @returns 
 */
export function processFor(
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext,
  processCodegen?: (forNode: ForNode) => (() => void) | undefined
) {
  if (!dir.exp) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_FOR_NO_EXPRESSION, dir.loc)
    )
    return
  }

  const parseResult = parseForExpression(
    // can only be simple expression because vFor transform is applied
    // before expression transform.
    // 只能是简单的表达式，因为在表达式转换之前应用了vFor变换。
    dir.exp as SimpleExpressionNode,
    context
  )

  if (!parseResult) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION, dir.loc)
    )
    return
  }

  const { addIdentifiers, removeIdentifiers, scopes } = context
  const { source, value, key, index } = parseResult

  const forNode: ForNode = {
    type: NodeTypes.FOR,
    loc: dir.loc,
    source,
    valueAlias: value,
    keyAlias: key,
    objectIndexAlias: index,
    parseResult,
    children: isTemplateNode(node) ? node.children : [node]
  }

  context.replaceNode(forNode)

  // bookkeeping
  // 记账
  scopes.vFor++
  if (!__BROWSER__ && context.prefixIdentifiers) {
    // scope management
    // 作用域管理
    // inject identifiers to context
    // 注入标识符到上下文
    value && addIdentifiers(value)
    key && addIdentifiers(key)
    index && addIdentifiers(index)
  }

  // 生成代码，并获取生成代码的退出回调函数
  const onExit = processCodegen && processCodegen(forNode)

  return () => {
    // 离开v-for节点
    scopes.vFor--
    if (!__BROWSER__ && context.prefixIdentifiers) {
      // 移除标识符
      value && removeIdentifiers(value)
      key && removeIdentifiers(key)
      index && removeIdentifiers(index)
    }
    if (onExit) onExit()
  }
}

// for别名正则
const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/
// This regex doesn't cover the case if key or index aliases have destructuring,
// but those do not make sense in the first place, so this works in practice.
// 如果key或者index的别名存在解构则正则不能覆盖这种情况
// 但这些从一开始就没有意义，所以这在实践中是可行的。
const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
const stripParensRE = /^\(|\)$/g

/**
 * v-for解析结果 (value, key, index) in source
 * source 
 * value
 * key
 * index
 */
export interface ForParseResult {
  source: ExpressionNode
  value: ExpressionNode | undefined
  key: ExpressionNode | undefined
  index: ExpressionNode | undefined
}

/**
 * 解析for表达式
 * @param input 
 * @param context 
 * @returns 
 */
export function parseForExpression(
  input: SimpleExpressionNode,
  context: TransformContext
): ForParseResult | undefined {
  // 位置
  const loc = input.loc
  // 内容
  const exp = input.content
  // 匹配到正则别名
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return

  // LHS (value, key, index) 
  // RHS source
  const [, LHS, RHS] = inMatch


  const result: ForParseResult = {
    source: createAliasExpression(
      loc,
      RHS.trim(),
      exp.indexOf(RHS, LHS.length)
    ),
    value: undefined,
    key: undefined,
    index: undefined
  }
  if (!__BROWSER__ && context.prefixIdentifiers) {
    result.source = processExpression(
      result.source as SimpleExpressionNode,
      context
    )
  }
  if (__DEV__ && __BROWSER__) {
    validateBrowserExpression(result.source as SimpleExpressionNode, context)
  }

  // 取出value
  let valueContent = LHS.trim().replace(stripParensRE, '').trim()
  const trimmedOffset = LHS.indexOf(valueContent)

  // 取出迭代器 key index
  const iteratorMatch = valueContent.match(forIteratorRE)
  if (iteratorMatch) {
    valueContent = valueContent.replace(forIteratorRE, '').trim()

    // key
    const keyContent = iteratorMatch[1].trim()
    let keyOffset: number | undefined
    if (keyContent) {
      keyOffset = exp.indexOf(keyContent, trimmedOffset + valueContent.length)
      result.key = createAliasExpression(loc, keyContent, keyOffset)
      if (!__BROWSER__ && context.prefixIdentifiers) {
        result.key = processExpression(result.key, context, true)
      }
      if (__DEV__ && __BROWSER__) {
        validateBrowserExpression(
          result.key as SimpleExpressionNode,
          context,
          true
        )
      }
    }

    // index
    if (iteratorMatch[2]) {
      const indexContent = iteratorMatch[2].trim()

      if (indexContent) {
        result.index = createAliasExpression(
          loc,
          indexContent,
          exp.indexOf(
            indexContent,
            result.key
              ? keyOffset! + keyContent.length
              : trimmedOffset + valueContent.length
          )
        )
        if (!__BROWSER__ && context.prefixIdentifiers) {
          result.index = processExpression(result.index, context, true)
        }
        if (__DEV__ && __BROWSER__) {
          validateBrowserExpression(
            result.index as SimpleExpressionNode,
            context,
            true
          )
        }
      }
    }
  }

  // value
  if (valueContent) {
    result.value = createAliasExpression(loc, valueContent, trimmedOffset)
    if (!__BROWSER__ && context.prefixIdentifiers) {
      result.value = processExpression(result.value, context, true)
    }
    if (__DEV__ && __BROWSER__) {
      validateBrowserExpression(
        result.value as SimpleExpressionNode,
        context,
        true
      )
    }
  }

  return result
}

/**
 * 创建别名表达式
 * @param range 
 * @param content 
 * @param offset 
 * @returns 
 */
function createAliasExpression(
  range: SourceLocation,
  content: string,
  offset: number
): SimpleExpressionNode {
  return createSimpleExpression(
    content,
    false,
    getInnerRange(range, offset, content.length)
  )
}

/**
 * 创建for循环参数
 * @param param0 
 * @param memoArgs 
 * @returns 
 */
export function createForLoopParams(
  { value, key, index }: ForParseResult,
  memoArgs: ExpressionNode[] = []
): ExpressionNode[] {
  return createParamsList([value, key, index, ...memoArgs])
}

/**
 * 创建参数列表
 * @param args 
 * @returns 
 */
function createParamsList(
  args: (ExpressionNode | undefined)[]
): ExpressionNode[] {
  let i = args.length
  while (i--) {
    if (args[i]) break
  }
  return args
    .slice(0, i + 1)
    .map((arg, i) => arg || createSimpleExpression(`_`.repeat(i + 1), false))
}
