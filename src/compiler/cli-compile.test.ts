import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCompile } from './cli-compile.js'

const here = dirname(fileURLToPath(import.meta.url))
const SPECS_DIR = resolve(here, '../__fixtures__/specs')

let runDir: string

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), 'cli-compile-test-'))
  copyFileSync(resolve(here, '__fixtures__/sample-merged-draft.json'), join(runDir, 'merged-analyzer-prompt-draft.json'))
})

afterEach(() => {
  rmSync(runDir, { recursive: true, force: true })
})

describe('runCompile', () => {
  it('在 <runDir>/compiled 下寫 candidate、diff 與 summary.json，writtenPaths 與實際檔案一致', async () => {
    const result = await runCompile({ runDir, specsDir: SPECS_DIR })
    expect(result.outDir).toBe(join(runDir, 'compiled'))
    expect(result.writtenPaths).toEqual([
      join(runDir, 'compiled/candidates/analyst-tier1.ANALYST_TIER1_SYSTEM.txt'),
      join(runDir, 'compiled/diffs/analyst-tier1.ANALYST_TIER1_SYSTEM.diff'),
      join(runDir, 'compiled/candidates/synthesizer.SYNTHESIZER_SYSTEM.txt'),
      join(runDir, 'compiled/diffs/synthesizer.SYNTHESIZER_SYSTEM.diff'),
      join(runDir, 'compiled/summary.json'),
    ])
    for (const p of result.writtenPaths) expect(existsSync(p)).toBe(true)
    expect(readFileSync(result.writtenPaths[0] ?? '', 'utf8')).toBe(result.candidates[0]?.candidate)
  })

  it('summary.json 列出來源、跳過的 agent 與每份候選的新增行數', async () => {
    const result = await runCompile({ runDir, specsDir: SPECS_DIR })
    const summary = JSON.parse(readFileSync(join(result.outDir, 'summary.json'), 'utf8'))
    expect(summary.sources).toEqual(['skill-financial-analyst'])
    expect(summary.skippedAgents).toEqual(['news-classifier', 'podcast-writer'])
    expect(summary.candidates).toHaveLength(2)
    expect(summary.candidates[0].addedLines).toBeGreaterThan(0)
  })

  it('重跑時先清掉 compiled 下的舊檔，不留已不存在的候選', async () => {
    const stale = join(runDir, 'compiled/candidates/old-agent.OLD_PROMPT.txt')
    mkdirSync(dirname(stale), { recursive: true })
    writeFileSync(stale, 'stale', 'utf8')
    await runCompile({ runDir, specsDir: SPECS_DIR })
    expect(existsSync(stale)).toBe(false)
  })

  it('run 目錄沒有 merged draft 時丟錯', async () => {
    rmSync(join(runDir, 'merged-analyzer-prompt-draft.json'))
    await expect(runCompile({ runDir, specsDir: SPECS_DIR })).rejects.toThrow(/merged-analyzer-prompt-draft\.json/)
  })
})
