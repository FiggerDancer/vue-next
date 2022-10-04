// @ts-check
import path from 'path'
import ts from 'rollup-plugin-typescript2'
import replace from '@rollup/plugin-replace'
import json from '@rollup/plugin-json'

if (!process.env.TARGET) {
  throw new Error('TARGET package must be specified via --environment flag.')
}

const masterVersion = require('./package.json').version
// 获取包的目录 ./packages
const packagesDir = path.resolve(__dirname, 'packages')
// 获取要打包的包的名称，默认是vue ./packages/vue
const packageDir = path.resolve(packagesDir, process.env.TARGET)
// resolve获取 ./packages/vue下的文件
const resolve = p => path.resolve(packageDir, p)
const pkg = require(resolve(`package.json`))
const packageOptions = pkg.buildOptions || {}
const name = packageOptions.filename || path.basename(packageDir)

// ensure TS checks only once for each build
// 确保TS对每个构建只检查一次
let hasTSChecked = false

// 输出的格式
const outputConfigs = {
  // esm全量包，包含编译时
  'esm-bundler': {
    file: resolve(`dist/${name}.esm-bundler.js`),
    format: `es`
  },
  // esm浏览器版全量包，包含编译时
  'esm-browser': {
    file: resolve(`dist/${name}.esm-browser.js`),
    format: `es`
  },
  // commonjs
  cjs: {
    file: resolve(`dist/${name}.cjs.js`),
    format: `cjs`
  },
  // 立即执行函数
  global: {
    file: resolve(`dist/${name}.global.js`),
    format: `iife`
  },
  // runtime-only builds, for main "vue" package only
  // 仅用于运行时构建，仅用于主“vue”包 仅打包运行时
  'esm-bundler-runtime': {
    file: resolve(`dist/${name}.runtime.esm-bundler.js`),
    format: `es`
  },
  // esm 仅打包运行时
  'esm-browser-runtime': {
    file: resolve(`dist/${name}.runtime.esm-browser.js`),
    format: 'es'
  },
  // iife 仅打包运行时
  'global-runtime': {
    file: resolve(`dist/${name}.runtime.global.js`),
    format: 'iife'
  }
}

// 默认格式 esm-bundler 和 cjs
const defaultFormats = ['esm-bundler', 'cjs']
const inlineFormats = process.env.FORMATS && process.env.FORMATS.split(',')
const packageFormats = inlineFormats || packageOptions.formats || defaultFormats
const packageConfigs = process.env.PROD_ONLY
  ? []
  : packageFormats.map(format => createConfig(format, outputConfigs[format]))

// 如果是生产环境
if (process.env.NODE_ENV === 'production') {
  packageFormats.forEach(format => {
    if (packageOptions.prod === false) {
      return
    }
    if (format === 'cjs') {
      packageConfigs.push(createProductionConfig(format))
    }
    if (/^(global|esm-browser)(-runtime)?/.test(format)) {
      packageConfigs.push(createMinifiedConfig(format))
    }
  })
}

export default packageConfigs

function createConfig(format, output, plugins = []) {
  if (!output) {
    console.log(require('chalk').yellow(`invalid format: "${format}"`))
    process.exit(1)
  }

  const isProductionBuild =
    process.env.__DEV__ === 'false' || /\.prod\.js$/.test(output.file)
  const isBundlerESMBuild = /esm-bundler/.test(format)
  const isBrowserESMBuild = /esm-browser/.test(format)
  const isServerRenderer = name === 'server-renderer'
  const isNodeBuild = format === 'cjs'
  const isGlobalBuild = /global/.test(format)
  const isCompatPackage = pkg.name === '@vue/compat'
  const isCompatBuild = !!packageOptions.compat

  output.exports = isCompatPackage ? 'auto' : 'named'
  output.sourcemap = !!process.env.SOURCE_MAP
  output.externalLiveBindings = false

  if (isGlobalBuild) {
    output.name = packageOptions.name
  }

  const shouldEmitDeclarations =
    pkg.types && process.env.TYPES != null && !hasTSChecked

  const tsPlugin = ts({
    // 是否开启语法检查
    check: process.env.NODE_ENV === 'production' && !hasTSChecked,
    // 编译配置文件 tsconfig.json 的路径
    tsconfig: path.resolve(__dirname, 'tsconfig.json'),
    // 缓存的根路径
    cacheRoot: path.resolve(__dirname, 'node_modules/.rts2_cache'),
    // 覆盖 tsconfig.json 中的一些配置
    tsconfigOverride: {
      compilerOptions: {
        target: isServerRenderer || isNodeBuild ? 'es2019' : 'es2015',
        // 是否开启 source map
        sourceMap: output.sourcemap,
        // 生成类型定义文件
        declaration: shouldEmitDeclarations,
        // 生成类型定义文件的map
        declarationMap: shouldEmitDeclarations
      },
      // 排除测试 TypeScript 文件的编译
      exclude: ['**/__tests__', 'test-dts']
    }
  })
  // we only need to check TS and generate declarations once for each build.
  // it also seems to run into weird issues when checking multiple times
  // during a single build.
  hasTSChecked = true

  // 确定入口文件，运行时打包和非运行时打包是不一样的
  let entryFile = /runtime$/.test(format) ? `src/runtime.ts` : `src/index.ts`

  // the compat build needs both default AND named exports. This will cause
  // Rollup to complain for non-ESM targets, so we use separate entries for
  // esm vs. non-esm builds.
  if (isCompatPackage && (isBrowserESMBuild || isBundlerESMBuild)) {
    entryFile = /runtime$/.test(format)
      ? `src/esm-runtime.ts`
      : `src/esm-index.ts`
  }

  let external = []

  if (isGlobalBuild || isBrowserESMBuild || isCompatPackage) {
    if (!packageOptions.enableNonBrowserBranches) {
      // normal browser builds - non-browser only imports are tree-shaken,
      // they are only listed here to suppress warnings.
      // 正常浏览器构建 非浏览器导入仅仅被摇树
      // 它们列在这里只是为了压制警告。
      external = ['source-map', '@babel/parser', 'estree-walker']
    }
  } else {
    // Node / esm-bundler builds.
    // externalize all direct deps unless it's the compat build.
    // Node/esm-bundler的构建要排除所有相关依赖的第三方库
    // 除非是compat构建
    external = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
      ...['path', 'url', 'stream'] // for @vue/compiler-sfc / server-renderer
    ]
  }

  // we are bundling forked consolidate.js in compiler-sfc which dynamically
  // requires a ton of template engines which should be ignored.
  let cjsIgnores = []
  if (pkg.name === '@vue/compiler-sfc') {
    const consolidatePath = require.resolve('@vue/consolidate/package.json', {
      paths: [packageDir]
    })
    cjsIgnores = [
      ...Object.keys(require(consolidatePath).devDependencies),
      'vm',
      'crypto',
      'react-dom/server',
      'teacup/lib/express',
      'arc-templates/dist/es5',
      'then-pug',
      'then-jade'
    ]
  }

  const nodePlugins =
    (format === 'cjs' && Object.keys(pkg.devDependencies || {}).length) ||
    packageOptions.enableNonBrowserBranches
      ? [
          // @ts-ignore
          require('@rollup/plugin-commonjs')({
            sourceMap: false,
            ignore: cjsIgnores
          }),
          ...(format === 'cjs'
            ? []
            : // @ts-ignore
              [require('rollup-plugin-polyfill-node')()]),
          require('@rollup/plugin-node-resolve').nodeResolve()
        ]
      : []

  return {
    input: resolve(entryFile), // 两个input，一个是runtime.ts,一个是index.ts
    // Global and Browser ESM builds inlines everything so that they can be
    // used alone.
    external,
    plugins: [
      json({
        namedExports: false
      }),
      tsPlugin,
      createReplacePlugin(
        isProductionBuild,
        isBundlerESMBuild,
        isBrowserESMBuild,
        // isBrowserBuild?
        (isGlobalBuild || isBrowserESMBuild || isBundlerESMBuild) &&
          !packageOptions.enableNonBrowserBranches,
        isGlobalBuild,
        isNodeBuild,
        isCompatBuild,
        isServerRenderer
      ),
      ...nodePlugins,
      ...plugins
    ],
    output,
    onwarn: (msg, warn) => {
      if (!/Circular/.test(msg)) {
        warn(msg)
      }
    },
    treeshake: {
      moduleSideEffects: false
    }
  }
}

function createReplacePlugin(
  isProduction,
  isBundlerESMBuild,
  isBrowserESMBuild,
  isBrowserBuild,
  isGlobalBuild,
  isNodeBuild,
  isCompatBuild,
  isServerRenderer
) {
  const replacements = {
    __COMMIT__: `"${process.env.COMMIT}"`,
    __VERSION__: `"${masterVersion}"`,
    __DEV__: isBundlerESMBuild
      ? // preserve to be handled by bundlers
      // 保存由打包器处理
        `(process.env.NODE_ENV !== 'production')`
      : // hard coded dev/prod builds 
      // 硬编码
        !isProduction,
    // this is only used during Vue's internal tests
    // 仅在Vue.js内部测试用
    __TEST__: false,
    // If the build is expected to run directly in the browser (global / esm builds)
    // global/esm构建，直接在浏览器端运行
    __BROWSER__: isBrowserBuild,
    __GLOBAL__: isGlobalBuild,
    __ESM_BUNDLER__: isBundlerESMBuild,
    __ESM_BROWSER__: isBrowserESMBuild,
    // is targeting Node (SSR)?
    // 目标Node.js
    __NODE_JS__: isNodeBuild,
    // need SSR-specific branches?
    // 需要SSR特定分支
    __SSR__: isNodeBuild || isBundlerESMBuild || isServerRenderer,

    // for compiler-sfc browser build inlined deps
    ...(isBrowserESMBuild
      ? {
          'process.env': '({})',
          'process.platform': '""',
          'process.stdout': 'null'
        }
      : {}),

    // 2.x compat build
    __COMPAT__: isCompatBuild,

    // feature flags
    __FEATURE_SUSPENSE__: true,
    __FEATURE_OPTIONS_API__: isBundlerESMBuild ? `__VUE_OPTIONS_API__` : true,
    __FEATURE_PROD_DEVTOOLS__: isBundlerESMBuild
      ? `__VUE_PROD_DEVTOOLS__`
      : false,
    ...(isProduction && isBrowserBuild
      ? {
          'context.onError(': `/*#__PURE__*/ context.onError(`,
          'emitError(': `/*#__PURE__*/ emitError(`,
          'createCompilerError(': `/*#__PURE__*/ createCompilerError(`,
          'createDOMCompilerError(': `/*#__PURE__*/ createDOMCompilerError(`
        }
      : {})
  }
  // allow inline overrides like
  //__RUNTIME_COMPILE__=true yarn build runtime-core
  // 允许内联参数覆盖上述配置
  Object.keys(replacements).forEach(key => {
    if (key in process.env) {
      replacements[key] = process.env[key]
    }
  })
  return replace({
    // 替换的对象位置
    // @ts-ignore
    values: replacements,
    // 阻止赋值操作等号左侧的替换
    preventAssignment: true
  })
}

function createProductionConfig(format) {
  return createConfig(format, {
    file: resolve(`dist/${name}.${format}.prod.js`),
    format: outputConfigs[format].format
  })
}

function createMinifiedConfig(format) {
  const { terser } = require('rollup-plugin-terser')
  return createConfig(
    format,
    {
      // 把压缩后的目标文件名后缀替换为.prod.js
      file: outputConfigs[format].file.replace(/\.js$/, '.prod.js'),
      format: outputConfigs[format].format
    },
    [
      terser({
        // 在压缩ES模块的时候开启
        module: /^esm/.test(format),
        compress: {
          ecma: 2015,
          // 假定对象属性访问，如foo.bar或者foo["bar"]没有任何副作用
          pure_getters: true
        },
        // 解决Safari 10 循环迭代器错误
        safari10: true
      })
    ]
  )
}
