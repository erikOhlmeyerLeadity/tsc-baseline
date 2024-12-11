#!/usr/bin/env node

import { Command } from 'commander'
import {
  addHashToBaseline,
  getNewErrors,
  parseTypeScriptErrors,
  getTotalErrorsCount,
  toHumanReadableText,
  writeTypeScriptErrorsToFile,
  readBaselineErrorsFile,
  isBaselineVersionCurrent,
  getErrorSummaryMap,
  getBaselineFileVersion,
  formatForGitLab,
  CURRENT_BASELINE_VERSION
} from './util'
import { resolve } from 'path'
import { rmSync } from 'fs'
;(async () => {
  const program = new Command()

  program
    .name('tsc-baseline')
    .description(
      'Save a baseline of TypeScript errors and compare new errors against it.Useful for type-safe feature development in TypeScript projects that have a lot of errors. This tool will filter out errors that are already in the baseline and only show new errors.'
    )

  let stdin = ''

  program.option(
    '-p --path <path>',
    `Path to file to save baseline errors to. Defaults to .tsc-baseline.json`
  )

  program.option(
    '--ignoreMessages',
    'Ignores specific type error messages and only counts errors by code.'
  )

  program.option(
    '--gitlab',
    'Output errors in GitLab Code Quality Report format'
  )

  const getConfig = () => {
    const config = program.opts()
    return {
      path: resolve(process.cwd(), config.path || '.tsc-baseline.json'),
      ignoreMessages: config.ignoreMessages || false,
      gitlab: config.gitlab || false
    }
  }

  program.command('save [message]').action((message) => {
    if (stdin) {
      message = stdin
      if (message) {
        const config = getConfig()
        const errorOptions = {
          ignoreMessages: config.ignoreMessages
        }
        writeTypeScriptErrorsToFile(
          parseTypeScriptErrors(message, errorOptions).errorSummaryMap,
          config.path,
          errorOptions
        )
        console.log("\nSaved baseline errors to '" + config.path + "'")
      }
    }
  })

  program.command('add [hash]').action((hash) => {
    if (!hash) {
      console.error('Missing hash')
    } else {
      const config = getConfig()
      addHashToBaseline(hash, config.path)
    }
  })

  program.command('check [message]').action((message) => {
    if (stdin) {
      message = stdin
      if (message) {
        const config = getConfig()
        let baselineFile
        try {
          baselineFile = readBaselineErrorsFile(config.path)
        } catch (err) {
          console.error(
            `
Unable to read the .tsc-baseline.json file at "${config.path}".

Has the baseline file been properly saved with the 'save' command?
`
          )
          process.exit(1)
        }
        if (!isBaselineVersionCurrent(baselineFile)) {
          const baselineFileVersion = getBaselineFileVersion(baselineFile)
          if (baselineFileVersion < CURRENT_BASELINE_VERSION) {
            console.error(
              `
The .tsc-baseline.json file at "${config.path}"
is out of date for this version of tsc-baseline.

Please update the baseline file using the 'save' command.
`
            )
            process.exit(1)
          } else {
            console.error(
              `
The .tsc-baseline.json file at "${config.path}"
is from a future version of tsc-baseline.

Are your installed packages up to date?
`
            )
            process.exit(1)
          }
        }

        const oldErrorSummaries = getErrorSummaryMap(baselineFile)
        const errorOptions = {
          ignoreMessages: baselineFile.meta.ignoreMessages
        }
        const { specificErrorsMap, errorSummaryMap } = parseTypeScriptErrors(
          message,
          errorOptions
        )
        const newErrorSummaries = getNewErrors(
          oldErrorSummaries,
          errorSummaryMap
        )
        const newErrorsCount = getTotalErrorsCount(newErrorSummaries)
        const oldErrorsCount = getTotalErrorsCount(oldErrorSummaries)

        const newErrorsCountMessage = `${newErrorsCount} new error${
          newErrorsCount === 1 ? '' : 's'
        } found`

        if (config.gitlab) {
          const gitLabFormattedErrors = formatForGitLab(newErrorSummaries)
          console.log(JSON.stringify(gitLabFormattedErrors, null, 2))
        } else {
          console.error(`${newErrorsCount > 0 ? '\nNew errors found:' : ''}
${toHumanReadableText(newErrorSummaries, specificErrorsMap, errorOptions)}

${newErrorsCountMessage}. ${oldErrorsCount} error${
            oldErrorsCount === 1 ? '' : 's'
          } already in baseline.`)
        }
        if (newErrorsCount > 0) {
          // Exit with a failure code so new errors fail CI by default
          process.exit(1)
        }
      }
    }
  })

  program.command('clear').action(() => {
    const config = getConfig()
    rmSync(config.path)
    console.log("Removed baseline file '" + config.path + "'")
  })

  if (process.stdin.isTTY) {
    program.parse(process.argv)
  } else {
    process.stdin.on('readable', function () {
      // @ts-ignore
      const chunk = this.read()
      if (chunk !== null) {
        stdin += chunk
      }
    })
    process.stdin.on('end', function () {
      program.parse(process.argv)
    })
  }

  try {
    await program.parseAsync(process.argv)
  } catch (err: any) {
    console.error(err.message)
  }
})()
