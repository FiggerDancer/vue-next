// should only use types from @babel/types
// do not import runtime methods
// 应该仅仅用于babel
// 不需要引入运行时的方法
import type {
  Identifier,
  Node,
  Function,
  ObjectProperty,
  BlockStatement,
  Program
} from '@babel/types'
// 简单的工具用于遍历一个estree编译的ast， 例如一个被acorn生成ast树
import { walk } from 'estree-walker'

/**
 * 
 * @param root 
 * @param onIdentifier 
 * @param includeAll 
 * @param parentStack 
 * @param knownIds 
 * @returns 
 */
export function walkIdentifiers(
  root: Node,
  onIdentifier: (
    node: Identifier,
    parent: Node,
    parentStack: Node[],
    isReference: boolean,
    isLocal: boolean
  ) => void,
  includeAll = false,
  parentStack: Node[] = [],
  knownIds: Record<string, number> = Object.create(null)
) {
  // 如果当前环境不是浏览器直接结束
  if (__BROWSER__) {
    return
  }

  // 根节点的表达式
  const rootExp =
    root.type === 'Program' &&
    root.body[0].type === 'ExpressionStatement' &&
    root.body[0].expression


  /* 
   * walk(ast, {
   *  enter(node, parent, prop, index) {},
   *  leave(node, parent, porp, index) {}
   * }) 
   * 
   * 在enter中调用this.skip() 可以组织子节点遍历，或者也可以调用leave函数
   * this.replace(new_node) 在enter或者leave中可以替换当前node使用的一个新的
   * this.remove() 在enter或者leave用来移除当前节点
   **/
  ;(walk as any)(root, {
    enter(node: Node & { scopeIds?: Set<string> }, parent: Node | undefined) {
      // 将父级放到父级栈里
      parent && parentStack.push(parent)
      // 如果存在父级且父级以ts开头，
      // 也就是说是一个ts表达式，且不是以下ts类型
      // 跳过
      if (
        parent &&
        parent.type.startsWith('TS') &&
        parent.type !== 'TSAsExpression' &&
        parent.type !== 'TSNonNullExpression' &&
        parent.type !== 'TSTypeAssertion'
      ) {
        return this.skip()
      }
      // 节点类型是标识符
      if (node.type === 'Identifier') {
        // 是本作用域的
        const isLocal = !!knownIds[node.name]
        // 是引用的
        const isRefed = isReferencedIdentifier(node, parent!, parentStack)
        if (includeAll || (isRefed && !isLocal)) {
          onIdentifier(node, parent!, parentStack, isRefed, isLocal)
        }
      } else if (
        node.type === 'ObjectProperty' &&
        parent!.type === 'ObjectPattern'
      ) {
        // mark property in destructure pattern
        // 在结构模式里 标记属性
        ;(node as any).inPattern = true
      } else if (isFunctionType(node)) {
        // walk function expressions and add its arguments to known identifiers
        // so that we don't prefix them
        // 遍历函数表达式并将其参数添加到已知的标识符中，
        // 这样就不会给它们添加前缀
        walkFunctionParams(node, id => markScopeIdentifier(node, id, knownIds))
      } else if (node.type === 'BlockStatement') {
        // #3445 record block-level local variables
        // 记录块级作用域变量
        // 遍历块级声明
        walkBlockDeclarations(node, id =>
          // 标记作用域标识符
          markScopeIdentifier(node, id, knownIds)
        )
      }
    },
    leave(node: Node & { scopeIds?: Set<string> }, parent: Node | undefined) {
      parent && parentStack.pop()
      // 节点不是根节点且节点有作用域Id
      if (node !== rootExp && node.scopeIds) {
        // 遍历节点的作用域内的已知变量的进行清空，正常情况像 
        /*
          {
            const a = 3
            function find () {
              const a = 4
            }
            find()
          }
        */
        for (const id of node.scopeIds) {
          knownIds[id]--
          if (knownIds[id] === 0) {
            delete knownIds[id]
          }
        }
      }
    }
  })
}

/**
 * 是否是引用标识符
 * @param id 
 * @param parent 
 * @param parentStack 
 * @returns 
 */
export function isReferencedIdentifier(
  id: Identifier,
  parent: Node | null,
  parentStack: Node[]
) {
  // 浏览器环境返回false
  if (__BROWSER__) {
    return false
  }

  // 没有父节点返回true
  if (!parent) {
    return true
  }

  // is a special keyword but parsed as identifier
  // 是一个特殊的关键字但是解析成一个标识符，返回false
  // arguments
  if (id.name === 'arguments') {
    return false
  }

  // 是引用
  if (isReferenced(id, parent)) {
    return true
  }

  // babel's isReferenced check returns false for ids being assigned to, so we
  // need to cover those cases here
  // babel的是否isReferenced返回false因为ids被分配，
  // 所以这里我们需要覆盖一些情况
  switch (parent.type) {
    case 'AssignmentExpression':
    case 'AssignmentPattern':
      return true
    case 'ObjectPattern':
    case 'ArrayPattern':
      return isInDestructureAssignment(parent, parentStack)
  }

  return false
}

/**
 * 是在解构表达式中
 * @param parent 
 * @param parentStack 
 * @returns 
 */
export function isInDestructureAssignment(
  parent: Node,
  parentStack: Node[]
): boolean {
  // 如果父节点类型是ObjectProperty或者父节点类型是ArrayPattern
  if (
    parent &&
    (parent.type === 'ObjectProperty' || parent.type === 'ArrayPattern')
  ) {
    let i = parentStack.length
    while (i--) {
      const p = parentStack[i]
      if (p.type === 'AssignmentExpression') {
        return true
      } else if (p.type !== 'ObjectProperty' && !p.type.endsWith('Pattern')) {
        break
      }
    }
  }
  return false
}

/**
 * 遍历函数的参数
 * @param node 
 * @param onIdent 
 */
export function walkFunctionParams(
  node: Function,
  onIdent: (id: Identifier) => void
) {
  for (const p of node.params) {
    // 提取参数节点的标识符
    for (const id of extractIdentifiers(p)) {
      onIdent(id)
    }
  }
}

/**
 * 遍历块声明
 * @param block 
 * @param onIdent 
 */
export function walkBlockDeclarations(
  block: BlockStatement | Program,
  onIdent: (node: Identifier) => void
) {
  // 遍历块中的语句
  for (const stmt of block.body) {
    // 语句类型是变量声明
    if (stmt.type === 'VariableDeclaration') {
      // declare语句声明
      if (stmt.declare) continue
      // 遍历语句声明
      for (const decl of stmt.declarations) {
        // 提取标识符
        for (const id of extractIdentifiers(decl.id)) {
          onIdent(id)
        }
      }
    } else if (
      stmt.type === 'FunctionDeclaration' ||
      stmt.type === 'ClassDeclaration'
    ) {
      if (stmt.declare || !stmt.id) continue
      onIdent(stmt.id)
    }
  }
}

/**
 * 提取标识符
 * @param param 
 * @param nodes 
 * @returns 
 */
export function extractIdentifiers(
  param: Node,
  nodes: Identifier[] = []
): Identifier[] {
  switch (param.type) {
    // 标识符
    case 'Identifier':
      nodes.push(param)
      break

    // 成员表达式
    case 'MemberExpression':
      let object: any = param
      while (object.type === 'MemberExpression') {
        object = object.object
      }
      nodes.push(object)
      break

    // 对象模式
    case 'ObjectPattern':
      for (const prop of param.properties) {
        // 剩余元素
        if (prop.type === 'RestElement') {
          extractIdentifiers(prop.argument, nodes)
        } else {
          extractIdentifiers(prop.value, nodes)
        }
      }
      break

    // 数组模式
    case 'ArrayPattern':
      param.elements.forEach(element => {
        if (element) extractIdentifiers(element, nodes)
      })
      break

    // 剩余元素
    case 'RestElement':
      extractIdentifiers(param.argument, nodes)
      break

    // 赋值模式
    case 'AssignmentPattern':
      extractIdentifiers(param.left, nodes)
      break
  }

  return nodes
}

/**
 * 标记作用域标识符
 * @param node 
 * @param child 
 * @param knownIds 
 * @returns 
 */
function markScopeIdentifier(
  node: Node & { scopeIds?: Set<string> },
  child: Identifier,
  knownIds: Record<string, number>
) {
  const { name } = child
  // 节点的作用域Id中包含这个变量名
  if (node.scopeIds && node.scopeIds.has(name)) {
    return
  }
  // 已知变量名称增加，如果没有的话设置为1
  if (name in knownIds) {
    knownIds[name]++
  } else {
    knownIds[name] = 1
  }
  // 作用域Id中添加对应的变量名称
  ;(node.scopeIds || (node.scopeIds = new Set())).add(name)
}

/**
 * 是否是函数类型
 * 函数表达式/函数声明/Method
 * @param node 
 * @returns 
 */
export const isFunctionType = (node: Node): node is Function => {
  return /Function(?:Expression|Declaration)$|Method$/.test(node.type)
}

/**
 * 是否是静态属性
 * ObjectProperty|ObjectMethod且node没有计算属性
 */
export const isStaticProperty = (node: Node): node is ObjectProperty =>
  node &&
  (node.type === 'ObjectProperty' || node.type === 'ObjectMethod') &&
  !node.computed

/**
 * 是静态属性PropertyKey
 * @param node 
 * @param parent 
 * @returns 
 */
export const isStaticPropertyKey = (node: Node, parent: Node) =>
  isStaticProperty(parent) && parent.key === node

/**
 * Copied from https://github.com/babel/babel/blob/main/packages/babel-types/src/validators/isReferenced.ts
 * To avoid runtime dependency on @babel/types (which includes process references)
 * This file should not change very often in babel but we may need to keep it
 * up-to-date from time to time.
 *
 * https://github.com/babel/babel/blob/main/LICENSE
 * 
 * 拷贝自 https://github.com/babel/babel/blob/main/packages/babel-types/src/validators/isReferenced.ts
 * 为了避免运行时依赖@babel/types 包含过程引用
 * 这个文件应该不会经常改变再babel中，但我们需要一直维护它
 */
function isReferenced(node: Node, parent: Node, grandparent?: Node): boolean {
  switch (parent.type) {
    // yes: PARENT[NODE]
    // yes: NODE.child
    // no: parent.NODE
    // .符号
    // 成员表达式
    case 'MemberExpression':
    // 成员选项表达式
    case 'OptionalMemberExpression':
      if (parent.property === node) {
        // 是计算属性则是引用值，否则是非引用值
        return !!parent.computed
      }
      // 是对象的话是引用值
      return parent.object === node
    // jsx成员表达式
    case 'JSXMemberExpression':
      return parent.object === node
    // no: let NODE = init;
    // yes: let id = NODE;
    // 变量声明
    case 'VariableDeclarator':
      return parent.init === node

    // yes: () => NODE
    // no: (NODE) => {}
    // 箭头函数表达式
    case 'ArrowFunctionExpression':
      return parent.body === node

    // no: class { #NODE; }
    // no: class { get #NODE() {} }
    // no: class { #NODE() {} }
    // no: class { fn() { return this.#NODE; } }
    // 私有名
    case 'PrivateName':
      return false

    // no: class { NODE() {} }
    // yes: class { [NODE]() {} }
    // no: class { foo(NODE) {} }
    // Class方法，私有方法，对象方法
    case 'ClassMethod':
    case 'ClassPrivateMethod':
    case 'ObjectMethod':
      if (parent.key === node) {
        return !!parent.computed
      }
      return false

    // yes: { [NODE]: "" }
    // no: { NODE: "" }
    // depends: { NODE }
    // depends: { key: NODE }
    // 对象的属性
    case 'ObjectProperty':
      if (parent.key === node) {
        return !!parent.computed
      }
      // parent.value === node
      return !grandparent || grandparent.type !== 'ObjectPattern'
    // no: class { NODE = value; }
    // yes: class { [NODE] = value; }
    // yes: class { key = NODE; }
    // 类的属性
    case 'ClassProperty':
      if (parent.key === node) {
        return !!parent.computed
      }
      return true
    // 类私有属性
    case 'ClassPrivateProperty':
      return parent.key !== node

    // no: class NODE {}
    // yes: class Foo extends NODE {}
    // 类声明
    case 'ClassDeclaration':
    // 类表达式
    case 'ClassExpression':
      return parent.superClass === node

    // yes: left = NODE;
    // no: NODE = right;
    // 赋值表达式
    case 'AssignmentExpression':
      return parent.right === node

    // no: [NODE = foo] = [];
    // yes: [foo = NODE] = [];
    // 赋值模式
    case 'AssignmentPattern':
      return parent.right === node

    // no: NODE: for (;;) {}
    // for语句
    case 'LabeledStatement':
      return false

    // no: try {} catch (NODE) {}
    // try catch从句
    case 'CatchClause':
      return false

    // no: function foo(...NODE) {}
    // 剩余元素
    case 'RestElement':
      return false

    // break语句，continue语句
    case 'BreakStatement':
    case 'ContinueStatement':
      return false

    // no: function NODE() {}
    // no: function foo(NODE) {}
    // 函数声明
    // 函数表达式
    case 'FunctionDeclaration':
    case 'FunctionExpression':
      return false

    // no: export NODE from "foo";
    // no: export * as NODE from "foo";
    // 导出命名空间访问符
    // 导出默认访问符
    case 'ExportNamespaceSpecifier':
    case 'ExportDefaultSpecifier':
      return false

    // no: export { foo as NODE };
    // yes: export { NODE as foo };
    // no: export { NODE as foo } from "foo";
    // 导出访问符
    case 'ExportSpecifier':
      // @ts-expect-error
      if (grandparent?.source) {
        return false
      }
      return parent.local === node

    // no: import NODE from "foo";
    // no: import * as NODE from "foo";
    // no: import { NODE as foo } from "foo";
    // no: import { foo as NODE } from "foo";
    // no: import NODE from "bar";
    // 引入默认访问符
    case 'ImportDefaultSpecifier':
    // 引入命名空间访问符
    case 'ImportNamespaceSpecifier':
    // 引入访问符
    case 'ImportSpecifier':
      return false

    // no: import "foo" assert { NODE: "json" }
    // 引入属性
    case 'ImportAttribute':
      return false

    // no: <div NODE="foo" />
    // jsx属性
    case 'JSXAttribute':
      return false

    // no: [NODE] = [];
    // no: ({ NODE }) = [];
    // 对象模式，数组模式
    case 'ObjectPattern':
    case 'ArrayPattern':
      return false

    // no: new.NODE
    // no: NODE.target
    // 新的节点
    // 节点target
    case 'MetaProperty':
      return false

    // yes: type X = { someProperty: NODE }
    // no: type X = { NODE: OtherType }
    // 对象类型属性
    case 'ObjectTypeProperty':
      return parent.key !== node

    // yes: enum X { Foo = NODE }
    // no: enum X { NODE }
    // ts枚举成员
    case 'TSEnumMember':
      return parent.id !== node

    // yes: { [NODE]: value }
    // no: { NODE: value }
    // ts属性标签
    case 'TSPropertySignature':
      if (parent.key === node) {
        // 计算属性
        return !!parent.computed
      }

      return true
  }

  return true
}
