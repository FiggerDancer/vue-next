import { TransformOptions } from './options'
import {
  RootNode,
  NodeTypes,
  ParentNode,
  TemplateChildNode,
  ElementNode,
  DirectiveNode,
  Property,
  ExpressionNode,
  createSimpleExpression,
  JSChildNode,
  SimpleExpressionNode,
  ElementTypes,
  CacheExpression,
  createCacheExpression,
  TemplateLiteral,
  createVNodeCall,
  ConstantTypes,
  ArrayExpression
} from './ast'
import {
  isString,
  isArray,
  NOOP,
  PatchFlags,
  PatchFlagNames,
  EMPTY_OBJ,
  capitalize,
  camelize
} from '@vue/shared'
import { defaultOnError, defaultOnWarn } from './errors'
import {
  TO_DISPLAY_STRING,
  FRAGMENT,
  helperNameMap,
  CREATE_COMMENT
} from './runtimeHelpers'
import { isVSlot, makeBlock } from './utils'
import { hoistStatic, isSingleElementRoot } from './transforms/hoistStatic'
import { CompilerCompatOptions } from './compat/compatConfig'

// transform 4点核心要素
// 创建transform上下文
// 遍历AST根节点
// 静态提升
// 创建根代码生成节点

// 学习Ast的转化前必须要明白两点：
// Block的概念，Vue将模板切割成一个一个的block tree，使vue的更新速度
// 由模板大小决定，改成了由动态节点数量决定
// 动态组件、svg、foreginObject 标签及动态绑定 kep prop的节点
// 都被视为一个Block
// codeGenNode是为了后续代码的生成

// There are two types of transforms:
//
// - NodeTransform:
//   Transforms that operate directly on a ChildNode. NodeTransforms may mutate,
//   replace or remove the node being processed.
/**
 * 这里有2种类型的转化
 * NodeTransform
 * 直接操作子节点的转化
 * NodeTransform可以操作、替换或者移除被处理的node
 */
export type NodeTransform = (
  node: RootNode | TemplateChildNode,
  context: TransformContext
) => void | (() => void) | (() => void)[]

// - DirectiveTransform:
//   Transforms that handles a single directive attribute on an element.
//   It translates the raw directive into actual props for the VNode.
/**
 * 指令转化
 * 处理一个的单独的指令属性在一个元素上
 * 它将原始指令翻译成Vnode上真实的属性
 */
export type DirectiveTransform = (
  dir: DirectiveNode,
  node: ElementNode,
  context: TransformContext,
  // a platform specific compiler can import the base transform and augment
  // it by passing in this optional argument.
  // 一个平台特定的编译器可以引入一个基础转化并且能够扩充它的可选参数
  augmentor?: (ret: DirectiveTransformResult) => DirectiveTransformResult
) => DirectiveTransformResult

/**
 * 指令转化结果
 */
export interface DirectiveTransformResult {
  props: Property[]
  needRuntime?: boolean | symbol
  ssrTagParts?: TemplateLiteral['elements']
}

// A structural directive transform is technically also a NodeTransform;
// Only v-if and v-for fall into this category.
/**
 * 一个结构化指令转化是技术上的实现是NodeTransform
 * 只有v-if和v-for属于此类
 */
export type StructuralDirectiveTransform = (
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext
) => void | (() => void)

/**
 * 引入Item
 */
export interface ImportItem {
  exp: string | ExpressionNode
  path: string
}

/**
 * TransformContext
 * 转化选项中将filename和编译兼容选项外的全部设置为必传  
 * 合并编译选项
 */
export interface TransformContext
  extends Required<
      Omit<TransformOptions, 'filename' | keyof CompilerCompatOptions>
    >,
    CompilerCompatOptions {
      /**
       * 名称
       */
  selfName: string | null
  /**
   * 根节点
   */
  root: RootNode
  /**
   * 帮助函数
   */
  helpers: Map<symbol, number>
  /**
   * 组件
   */
  components: Set<string>
  /**
   * 指令
   */
  directives: Set<string>
  /**
   * 挂起
   */
  hoists: (JSChildNode | null)[]
  /**
   * 引入项
   */
  imports: ImportItem[]
  /**
   * 临时变量数量
   */
  temps: number
  /**
   * v-once数量
   */
  cached: number
  /**
   * 存储标识符
   */
  identifiers: { [name: string]: number | undefined }
  /**
   * 各作用域数量
   */
  scopes: {
    vFor: number
    vSlot: number
    vPre: number
    vOnce: number
  }
  /**
   * 父节点
   */
  parent: ParentNode | null
  /**
   * 子节点索引
   */
  childIndex: number
  /**
   * 当前节点
   */
  currentNode: RootNode | TemplateChildNode | null
  /**
   * 在v-once中
   */
  inVOnce: boolean
  /**
   * helper函数
   * @param name 
   */
  helper<T extends symbol>(name: T): T
  /**
   * 移除helper
   * @param name 
   */
  removeHelper<T extends symbol>(name: T): void
  /**
   * helper字符串
   * @param name 
   */
  helperString(name: symbol): string
  /**
   * 替换节点
   * @param node 
   */
  replaceNode(node: TemplateChildNode): void
  /**
   * 移除节点
   * @param node 
   */
  removeNode(node?: TemplateChildNode): void
  /**
   * 监听节点移除
   */
  onNodeRemoved(): void
  /**
   * 添加标识符
   * @param exp 
   */
  addIdentifiers(exp: ExpressionNode | string): void
  /**
   * 移除标识符
   * @param exp 
   */
  removeIdentifiers(exp: ExpressionNode | string): void
  /**
   * 挂起
   * @param exp 
   */
  hoist(exp: string | JSChildNode | ArrayExpression): SimpleExpressionNode
  /**
   * 缓存
   * @param exp 
   * @param isVNode 
   */
  cache<T extends JSChildNode>(exp: T, isVNode?: boolean): CacheExpression | T
  /**
   * 常量缓存
   */
  constantCache: Map<TemplateChildNode, ConstantTypes>

  // 2.x Compat only
  /**
   * 2.x 兼容
   */
  filters?: Set<string>
}

/**
 * 创建TransformContext
 * @param root 
 * @param param1 
 * @returns 
 */
export function createTransformContext(
  root: RootNode,
  {
    filename = '',
    prefixIdentifiers = false,
    hoistStatic = false,
    cacheHandlers = false,
    nodeTransforms = [],
    directiveTransforms = {},
    transformHoist = null,
    isBuiltInComponent = NOOP,
    isCustomElement = NOOP,
    expressionPlugins = [],
    scopeId = null,
    slotted = true,
    ssr = false,
    inSSR = false,
    ssrCssVars = ``,
    bindingMetadata = EMPTY_OBJ,
    inline = false,
    isTS = false,
    onError = defaultOnError,
    onWarn = defaultOnWarn,
    compatConfig
  }: TransformOptions
): TransformContext {
  // 名称匹配
  const nameMatch = filename.replace(/\?.*$/, '').match(/([^/\\]+)\.\w+$/)
  const context: TransformContext = {
    // options
    // 选项
    // 名称
    selfName: nameMatch && capitalize(camelize(nameMatch[1])),
    prefixIdentifiers,
    hoistStatic,
    cacheHandlers,
    nodeTransforms,
    directiveTransforms,
    transformHoist,
    isBuiltInComponent,
    isCustomElement,
    expressionPlugins,
    scopeId,
    slotted,
    ssr,
    inSSR,
    ssrCssVars,
    bindingMetadata,
    inline,
    isTS,
    onError,
    onWarn,
    compatConfig,

    // state
    root,
    helpers: new Map(),
    components: new Set(),
    directives: new Set(),
    hoists: [],
    imports: [],
    constantCache: new Map(),
    temps: 0,
    cached: 0,
    identifiers: Object.create(null),
    scopes: {
      vFor: 0,
      vSlot: 0,
      vPre: 0,
      vOnce: 0
    },
    parent: null,
    currentNode: root,
    childIndex: 0,
    inVOnce: false,

    // methods
    /**
     * 帮助方法
     * 设置注册方法时增加对应次数
     * @param name 
     * @returns 
     */
    helper(name) {
      const count = context.helpers.get(name) || 0
      context.helpers.set(name, count + 1)
      return name
    },
    /**
     * 移除帮助函数时
     * @param name 
     */
    removeHelper(name) {
      const count = context.helpers.get(name)
      if (count) {
        const currentCount = count - 1
        if (!currentCount) {
          context.helpers.delete(name)
        } else {
          context.helpers.set(name, currentCount)
        }
      }
    },
    /**
     * 获取帮助字符串
     * @param name 
     * @returns 
     */
    helperString(name) {
      return `_${helperNameMap[context.helper(name)]}`
    },
    /**
     * 替换当前节点
     * @param node 
     */
    replaceNode(node) {
      /* istanbul ignore if */
      if (__DEV__) {
        if (!context.currentNode) {
          throw new Error(`Node being replaced is already removed.`)
        }
        if (!context.parent) {
          throw new Error(`Cannot replace root node.`)
        }
      }
      context.parent!.children[context.childIndex] = context.currentNode = node
    },
    // 移除节点
    removeNode(node) {
      if (__DEV__ && !context.parent) {
        throw new Error(`Cannot remove root node.`)
      }
      const list = context.parent!.children
      const removalIndex = node
        ? list.indexOf(node)
        : context.currentNode
        ? context.childIndex
        : -1
      /* istanbul ignore if */
      if (__DEV__ && removalIndex < 0) {
        throw new Error(`node being removed is not a child of current parent`)
      }
      if (!node || node === context.currentNode) {
        // current node removed
        // 当前节点被移除
        context.currentNode = null
        context.onNodeRemoved()
      } else {
        // sibling node removed
        // 兄弟节点别移除
        if (context.childIndex > removalIndex) {
          context.childIndex--
          context.onNodeRemoved()
        }
      }
      context.parent!.children.splice(removalIndex, 1)
    },
    onNodeRemoved: () => {},
    addIdentifiers(exp) {
      // identifier tracking only happens in non-browser builds.
      // 标识符跟踪仅仅发生在非浏览器构建中
      if (!__BROWSER__) {
        if (isString(exp)) {
          addId(exp)
        } else if (exp.identifiers) {
          exp.identifiers.forEach(addId)
        } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          addId(exp.content)
        }
      }
    },
    removeIdentifiers(exp) {
      // 非浏览器
      if (!__BROWSER__) {
        // 表达式是字符串
        if (isString(exp)) {
          // 移除表达式的标识符
          removeId(exp)
        } else if (exp.identifiers) {
          // 如果不是字符串，则是对象，有标识符，从对象找标识符，移除该标识符
          exp.identifiers.forEach(removeId)
        } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          // 简答表达式，以表达式内容为id
          removeId(exp.content)
        }
      }
    },
    hoist(exp) {
      // 创建简单表达式
      if (isString(exp)) exp = createSimpleExpression(exp)
      // 挂起中存放表达式
      context.hoists.push(exp)
      // 创建简单表达式
      const identifier = createSimpleExpression(
        `_hoisted_${context.hoists.length}`,
        false,
        exp.loc,
        ConstantTypes.CAN_HOIST
      )
      // 标识符中挂载表达式
      identifier.hoisted = exp
      // 返回标识符
      return identifier
    },
    cache(exp, isVNode = false) {
      // 创建缓存表达式，缓存表达式
      return createCacheExpression(context.cached++, exp, isVNode)
    }
  }

  
  if (__COMPAT__) {
    context.filters = new Set()
  }

  /**
   * 添加标识符，并且标记标识符使用次数
   * @param id 
   */
  function addId(id: string) {
    const { identifiers } = context
    if (identifiers[id] === undefined) {
      identifiers[id] = 0
    }
    identifiers[id]!++
  }

  // 从上下文标识符中删除标识符
  function removeId(id: string) {
    context.identifiers[id]!--
  }

  return context
}

/**
 * 转化
 * @param root 
 * @param options 
 */
export function transform(root: RootNode, options: TransformOptions) {
  // 上下文
  const context = createTransformContext(root, options)
  // 遍历节点
  traverseNode(root, context)
  // 挂起静态节点
  if (options.hoistStatic) {
    hoistStatic(root, context)
  }
  // 不是ssr，就创建根代码生成器
  if (!options.ssr) {
    createRootCodegen(root, context)
  }
  // finalize meta information
  // 完成meta信息
  root.helpers = [...context.helpers.keys()]
  root.components = [...context.components]
  root.directives = [...context.directives]
  root.imports = context.imports
  root.hoists = context.hoists
  root.temps = context.temps
  root.cached = context.cached

  // 兼容，根节点过滤器设定
  if (__COMPAT__) {
    root.filters = [...context.filters!]
  }
}

/**
 * 创建根节点代码生成器
 * @param root 
 * @param context 
 */
function createRootCodegen(root: RootNode, context: TransformContext) {
  const { helper } = context
  const { children } = root
  if (children.length === 1) {
    const child = children[0]
    // if the single child is an element, turn it into a block.
    // 如果只有一个根节点且是一个元素，将它转化成一个block
    if (isSingleElementRoot(root, child) && child.codegenNode) {
      // single element root is never hoisted so codegenNode will never be
      // SimpleExpressionNode
      // 单独的元素根节点永远不会挂起，所以代码生成的节点将永远不是一个简单表达式节点
      const codegenNode = child.codegenNode
      // 代码生成的节点是VNode
      if (codegenNode.type === NodeTypes.VNODE_CALL) {
        makeBlock(codegenNode, context)
      }
      // 根节点上的代码生成节点
      root.codegenNode = codegenNode
    } else {
      // - single <slot/>, IfNode, ForNode: already blocks.
      // - single text node: always patched.
      // root codegen falls through via genNode()
      // 单个<slot/> IfNode, ForNode: 已经blocks
      // 单个文本节点 总是更新
      // 根节点的代码生成回退到通过生成节点
      root.codegenNode = child
    }
  } else if (children.length > 1) {
    // root has multiple nodes - return a fragment block.
    // 根节点有多个节点返回一个fragment block
    // 更新标记
    let patchFlag = PatchFlags.STABLE_FRAGMENT
    // 更新标记文本
    let patchFlagText = PatchFlagNames[PatchFlags.STABLE_FRAGMENT]
    // check if the fragment actually contains a single valid child with
    // the rest being comments
    // 检查fragment是否包含一个单独有效的子节点，然后剩下的都是注释
    if (
      __DEV__ &&
      children.filter(c => c.type !== NodeTypes.COMMENT).length === 1
    ) {
      // 开发者环境且子节点中包含注释意外的节点要增加开发者环境fragment的标记
      patchFlag |= PatchFlags.DEV_ROOT_FRAGMENT
      patchFlagText += `, ${PatchFlagNames[PatchFlags.DEV_ROOT_FRAGMENT]}`
    }
    // 生成根节点的vnode
    root.codegenNode = createVNodeCall(
      context,
      helper(FRAGMENT),
      undefined,
      root.children,
      patchFlag + (__DEV__ ? ` /* ${patchFlagText} */` : ``),
      undefined,
      undefined,
      true,
      undefined,
      false /* isComponent 是组件 */
    )
  } else {
    // no children = noop. codegen will return null.
    // 无子节点 则是空函数 代码生成将返回空
  }
}

/**
 * 遍历子节点
 * @param parent 
 * @param context 
 */
export function traverseChildren(
  parent: ParentNode,
  context: TransformContext
) {
  let i = 0
  // 移除节点
  const nodeRemoved = () => {
    i--
  }
  // 遍历父节点的所有子节点，如果子节点是一个字符串过，设置上下文中的节点信息
  // 对子节点转化
  for (; i < parent.children.length; i++) {
    const child = parent.children[i]
    if (isString(child)) continue
    context.parent = parent
    context.childIndex = i
    context.onNodeRemoved = nodeRemoved
    traverseNode(child, context)
  }
}

/**
 * 对节点转化并进一步遍历子节点
 * @param node 
 * @param context 
 * @returns 
 */
export function traverseNode(
  node: RootNode | TemplateChildNode,
  context: TransformContext
) {
  // 上下文当前节点
  context.currentNode = node
  // apply transform plugins
  // 应用transform插件
  const { nodeTransforms } = context
  const exitFns = []
  for (let i = 0; i < nodeTransforms.length; i++) {
    const onExit = nodeTransforms[i](node, context)
    if (onExit) {
      if (isArray(onExit)) {
        exitFns.push(...onExit)
      } else {
        exitFns.push(onExit)
      }
    }
    if (!context.currentNode) {
      // node was removed
      // 节点已经被移除
      return
    } else {
      // node may have been replaced
      // 节点可能已经被替换
      node = context.currentNode
    }
  }

  switch (node.type) {
    case NodeTypes.COMMENT:
      if (!context.ssr) {
        // inject import for the Comment symbol, which is needed for creating
        // comment nodes with `createVNode`
        // 注入import用于注释symbol，这被用于使用createVNode创建注释节点
        context.helper(CREATE_COMMENT)
      }
      break
    case NodeTypes.INTERPOLATION:
      // 不需要遍历，但我们需要注入toString帮助函数，转化插值
      // no need to traverse, but we need to inject toString helper
      if (!context.ssr) {
        context.helper(TO_DISPLAY_STRING)
      }
      break

    // for container types, further traverse downwards
    // 对于容器类型，进一步向下遍历
    case NodeTypes.IF:
      for (let i = 0; i < node.branches.length; i++) {
        traverseNode(node.branches[i], context)
      }
      break
    case NodeTypes.IF_BRANCH:
    case NodeTypes.FOR:
    case NodeTypes.ELEMENT:
    case NodeTypes.ROOT:
      // 遍历子节点
      traverseChildren(node, context)
      break
  }

  // exit transforms
  // 退出转化
  context.currentNode = node
  // 遍历执行之前放进去的转化node的方法
  let i = exitFns.length
  while (i--) {
    exitFns[i]()
  }
}

/**
 * 创建结化指令转化
 * @param name 
 * @param fn 
 * @returns 
 */
export function createStructuralDirectiveTransform(
  name: string | RegExp,
  fn: StructuralDirectiveTransform
): NodeTransform {
  // 是否匹配指令函数，返回值为boolean函数
  const matches = isString(name)
    ? (n: string) => n === name
    : (n: string) => name.test(n)

  return (node, context) => {
    // 节点类型为元素
    if (node.type === NodeTypes.ELEMENT) {
      const { props } = node
      // structural directive transforms are not concerned with slots
      // as they are handled separately in vSlot.ts
      // 结构化指令转化无关slots当他们在v-slot中分别处理时
      if (node.tagType === ElementTypes.TEMPLATE && props.some(isVSlot)) {
        return
      }
      // 退出方法
      const exitFns = []
      // 遍历属性
      for (let i = 0; i < props.length; i++) {
        const prop = props[i]
        // 属性类型为指令且这个名字是匹配指令
        if (prop.type === NodeTypes.DIRECTIVE && matches(prop.name)) {
          // structural directives are removed to avoid infinite recursion
          // also we remove them *before* applying so that it can further
          // traverse itself in case it moves the node around
          // 结构化指令被移除为了避免无限循环
          // 我们移除他们要在fn方法被调用之前，方便它能够进一步的遍历它本身，以防它移动节点
          props.splice(i, 1)
          i--
          const onExit = fn(node, prop, context)
          if (onExit) exitFns.push(onExit)
        }
      }
      return exitFns
    }
  }
}
