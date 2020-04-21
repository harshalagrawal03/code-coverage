// helper functions to use from "task.js" plugins code
// that need access to the file system

// @ts-check
/// <reference types="cypress" />
const { readFileSync, writeFileSync, existsSync } = require('fs')
const { isAbsolute, resolve, join } = require('path')
const debug = require('debug')('code-coverage')
const chalk = require('chalk')
const globby = require('globby')
const { combineNycOptions, defaultNycOptions } = require('./common-utils')

function readNycOptions(workingDirectory) {
  const pkgFilename = join(workingDirectory, 'package.json')
  const pkg = existsSync(pkgFilename)
    ? JSON.parse(readFileSync(pkgFilename, 'utf8'))
    : {}
  const pkgNycOptions = pkg.nyc || {}

  const nycrcFilename = join(workingDirectory, '.nycrc')
  const nycrc = existsSync(nycrcFilename)
    ? JSON.parse(readFileSync(nycrcFilename, 'utf8'))
    : {}

  const nycrcJsonFilename = join(workingDirectory, '.nycrc.json')
  const nycrcJson = existsSync(nycrcJsonFilename)
    ? JSON.parse(readFileSync(nycrcJsonFilename, 'utf8'))
    : {}

  const nycOptions = combineNycOptions({
    pkgNycOptions,
    nycrc,
    nycrcJson,
    defaultNycOptions
  })
  debug('combined NYC options %o', nycOptions)

  return nycOptions
}

function checkAllPathsNotFound(nycFilename) {
  const nycCoverage = JSON.parse(readFileSync(nycFilename, 'utf8'))

  const coverageKeys = Object.keys(nycCoverage)
  if (!coverageKeys.length) {
    debug('⚠️ file %s has no coverage information', nycFilename)
    return
  }

  const allFilesAreMissing = coverageKeys.every((key, k) => {
    const coverage = nycCoverage[key]
    return !existsSync(coverage.path)
  })

  debug(
    'in file %s all files are not found? %o',
    nycFilename,
    allFilesAreMissing
  )
  return allFilesAreMissing
}

/**
 * A small debug utility to inspect paths saved in NYC output JSON file
 */
function showNycInfo(nycFilename) {
  const nycCoverage = JSON.parse(readFileSync(nycFilename, 'utf8'))

  const coverageKeys = Object.keys(nycCoverage)
  if (!coverageKeys.length) {
    console.error(
      '⚠️ file %s has no coverage information',
      chalk.yellow(nycFilename)
    )
    console.error(
      'Did you forget to instrument your web application? Read %s',
      chalk.blue(
        'https://github.com/cypress-io/code-coverage#instrument-your-application'
      )
    )
    return
  }
  debug('NYC file %s has %d key(s)', nycFilename, coverageKeys.length)

  const maxPrintKeys = 3
  const showKeys = coverageKeys.slice(0, maxPrintKeys)

  showKeys.forEach((key, k) => {
    const coverage = nycCoverage[key]

    // printing a few found keys and file paths from the coverage file
    // will make debugging any problems much much easier
    if (k < maxPrintKeys) {
      debug('%d key %s file path %s', k + 1, key, coverage.path)
    }
  })
}

/**
 * Looks at all coverage objects in the given JSON coverage file
 * and if the file is relative, and exists, changes its path to
 * be absolute.
 */
function resolveRelativePaths(nycFilename) {
  const nycCoverage = JSON.parse(readFileSync(nycFilename, 'utf8'))

  const coverageKeys = Object.keys(nycCoverage)
  if (!coverageKeys.length) {
    debug('⚠️ file %s has no coverage information', nycFilename)
    return
  }
  debug('NYC file %s has %d key(s)', nycFilename, coverageKeys.length)

  let changed

  coverageKeys.forEach((key, k) => {
    const coverage = nycCoverage[key]

    if (!coverage.path) {
      debug('key %s does not have path', key)
      return
    }

    if (!isAbsolute(coverage.path)) {
      if (existsSync(coverage.path)) {
        debug('resolving path %s', coverage.path)
        coverage.path = resolve(coverage.path)
        changed = true
      }
      return
    }

    // path is absolute, let's check if it exists
    if (!existsSync(coverage.path)) {
      debug('⚠️ cannot find file %s with hash %s', coverage.path, coverage.hash)
    }
  })

  if (changed) {
    debug('saving updated file %s', nycFilename)
    writeFileSync(
      nycFilename,
      JSON.stringify(nycCoverage, null, 2) + '\n',
      'utf8'
    )
  }
}

/**
 * @param {string[]} filepaths
 * @returns {string | undefined} common prefix that corresponds to current folder
 */
function findCommonRoot(filepaths) {
  if (!filepaths.length) {
    debug('cannot find common root without any files')
    return
  }

  // assuming / as file separator
  const splitParts = filepaths.map(name => name.split('/'))
  const lengths = splitParts.map(arr => arr.length)
  const shortestLength = Math.min.apply(null, lengths)
  debug('shorted file path has %d parts', shortestLength)

  const cwd = process.cwd()
  let commonPrefix = []
  let foundCurrentFolder

  for (let k = 0; k < shortestLength; k += 1) {
    const part = splitParts[0][k]
    const prefix = commonPrefix.concat(part).join('/')
    debug('testing prefix %o', prefix)
    const allFilesStart = filepaths.every(name => name.startsWith(prefix))
    if (!allFilesStart) {
      debug('stopped at non-common prefix %s', prefix)
      break
    }

    commonPrefix.push(part)

    const removedPrefixNames = filepaths.map(filepath =>
      filepath.slice(prefix.length)
    )
    debug('removedPrefix %o', removedPrefixNames)
    const foundAllPaths = removedPrefixNames.every(filepath =>
      existsSync(join(cwd, filepath))
    )
    debug('all files found at %s? %o', prefix, foundAllPaths)
    if (foundAllPaths) {
      debug('found prefix that matches current folder: %s', prefix)
      foundCurrentFolder = prefix
      break
    }
  }

  return foundCurrentFolder
}

function tryFindingLocalFiles(nycFilename) {
  const nycCoverage = JSON.parse(readFileSync(nycFilename, 'utf8'))
  const coverageKeys = Object.keys(nycCoverage)
  const filenames = coverageKeys.map(key => nycCoverage[key].path)
  const commonFolder = findCommonRoot(filenames)
  if (!commonFolder) {
    debug('could not find common folder %s', commonFolder)
    return
  }
  const cwd = process.cwd()
  debug(
    'found common folder %s that matches current working directory %s',
    commonFolder,
    cwd
  )
  const length = commonFolder.length
  let changed

  coverageKeys.forEach(key => {
    const from = nycCoverage[key].path
    if (from.startsWith(commonFolder)) {
      const to = join(cwd, from.slice(length))
      nycCoverage[key].path = to
      debug('replaced %s -> %s', from, to)
      changed = true
    }
  })

  if (changed) {
    debug('saving updated file %s', nycFilename)
    writeFileSync(
      nycFilename,
      JSON.stringify(nycCoverage, null, 2) + '\n',
      'utf8'
    )
  }
}

/**
 * If the website or unit tests did not load ALL files we need to
 * include, then we should include the missing files ourselves
 * before generating the report.
 *
 * @see https://github.com/cypress-io/code-coverage/issues/207
 */
function includeAllFiles(nycFilename, nycOptions) {
  debug('include all files options: %o', {
    all: nycOptions.all,
    include: nycOptions.include,
    exclude: nycOptions.exclude
  })

  let patterns = []
  if (Array.isArray(nycOptions.include)) {
    patterns = patterns.concat(nycOptions.include)
  } else if (typeof nycOptions.include === 'string') {
    patterns.push(nycOptions.include)
  }

  if (Array.isArray(nycOptions.exclude)) {
    const negated = nycOptions.exclude.map(s => '!' + s)
    patterns = patterns.concat(negated)
  } else if (typeof nycOptions.exclude === 'string') {
    patterns.push('!' + nycOptions.exclude)
  }
  // always exclude node_modules
  // https://github.com/istanbuljs/nyc#including-files-within-node_modules
  patterns.push('!**/node_modules/**')

  debug('searching files to include using patterns %o', patterns)

  const allFiles = globby.sync(patterns, { absolute: true })
  debug('found these files %o', allFiles)

  const nycCoverage = JSON.parse(readFileSync(nycFilename, 'utf8'))
  const coverageKeys = Object.keys(nycCoverage)
  const coveredPaths = coverageKeys.map(key => nycCoverage[key].path)
  debug('coverage has the following paths %o', coveredPaths)

  let changed
  allFiles.forEach(fullPath => {
    if (coveredPaths.includes(fullPath)) {
      // all good, this file exists in coverage object
      return
    }
    debug('adding empty coverage for file %s', fullPath)
    changed = true
    // insert placeholder object for now
    nycCoverage[fullPath] = {
      path: fullPath,
      statementMap: {},
      fnMap: {},
      branchMap: {},
      s: {},
      f: {},
      b: {}
    }
  })

  if (changed) {
    debug('saving updated file %s', nycFilename)
    writeFileSync(
      nycFilename,
      JSON.stringify(nycCoverage, null, 2) + '\n',
      'utf8'
    )
  }
}

module.exports = {
  showNycInfo,
  resolveRelativePaths,
  checkAllPathsNotFound,
  tryFindingLocalFiles,
  readNycOptions,
  includeAllFiles
}
