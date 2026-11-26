import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadSpecs } from '../spec/load-specs.js'
import { MergedDraftSchema } from '../types.js'
import { compileCandidates } from './compiler.js'

const here = dirname(fileURLToPath(import.meta.url))
const SPECS_DIR = resolve(here, '../__fixtures__/specs')
const draft = MergedDraftSchema.parse(JSON.parse(
  readFileSync(resolve(here, '__fixtures__/sample-merged-draft.json'), 'utf-8'),
))

describe('compileCandidates', () => {
  it('frame-style 為 none 的 agent 不產候選，其餘每個 prompt 一份', async () => {
    const out = compileCandidates(await loadSpecs(SPECS_DIR), draft)
    expect(out.map(c => `${c.agent}.${c.promptName}`)).toEqual([
      'analyst-tier1.ANALYST_TIER1_SYSTEM',
      'synthesizer.SYNTHESIZER_SYSTEM',
    ])
  })

  it('候選 = 現行 prompt 原文 + 研究素材段，diff 只有新增行', async () => {
    const specs = await loadSpecs(SPECS_DIR)
    const [analyst] = compileCandidates(specs, draft)
    const original = specs.find(s => s.agent === 'analyst-tier1')?.prompts[0]?.text ?? ''
    expect(analyst?.candidate.startsWith(`${original}\n\n## 研究素材補充（baguanomics）`)).toBe(true)
    const body = (analyst?.diff ?? '').split('\n').filter(l => /^[-+ ]/.test(l) && !/^(?:---|\+\+\+) /.test(l))
    expect(body.some(l => l.startsWith('+'))).toBe(true)
    expect(body.some(l => l.startsWith('-'))).toBe(false)
    expect(analyst?.diff).toContain(`--- ${analyst?.specPath}#ANALYST_TIER1_SYSTEM`)
  })
})
