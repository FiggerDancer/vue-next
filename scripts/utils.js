const fs = require('fs')
const chalk = require('chalk')

/**
 * 收集编译目标，确定packages下有哪些包需要编译
 */
const targets = (exports.targets = fs.readdirSync('packages').filter(f => {
  // 过滤掉不是文件夹的
  if (!fs.statSync(`packages/${f}`).isDirectory()) {
    return false
  }
  // 引入包中的package.json
  const pkg = require(`../packages/${f}/package.json`)
  // 私有包且没有打包配置的过滤掉
  if (pkg.private && !pkg.buildOptions) {
    return false
  }
  // 剩下的返回出来
  return true
}))

exports.fuzzyMatchTarget = (partialTargets, includeAllMatching) => {
  const matched = []
  partialTargets.forEach(partialTarget => {
    for (const target of targets) {
      if (target.match(partialTarget)) {
        matched.push(target)
        if (!includeAllMatching) {
          break
        }
      }
    }
  })
  if (matched.length) {
    return matched
  } else {
    console.log()
    console.error(
      `  ${chalk.bgRed.white(' ERROR ')} ${chalk.red(
        `Target ${chalk.underline(partialTargets)} not found!`
      )}`
    )
    console.log()

    process.exit(1)
  }
}
