/* eslint-disable no-console -- CLI output */
import process from 'node:process'
import { parseArgs } from 'node:util'
import { runCompile } from '../compiler/cli-compile.js'

const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    specs: { type: 'string' },
  },
})

if (!values.run || !values.specs) {
  console.error('用法：pnpm compile --run <distill 的 run 目錄> --specs <suanomics/docs/prompt-specs/agents>')
  process.exit(2)
}

runCompile({ runDir: values.run, specsDir: values.specs })
  .then((r) => {
    console.log(JSON.stringify({ outDir: r.outDir, candidates: r.candidates.map(c => `${c.agent}.${c.promptName}`) }, null, 2))
  })
  .catch((err: Error) => {
    console.error(err.stack ?? err.message)
    process.exit(1)
  })
