import type { PromptSpec } from '../spec/parse-spec.js'
import type { MergedDraft } from '../types.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MergedDraftSchema } from '../types.js'
import { buildResearchBlock } from './research-block.js'

const here = dirname(fileURLToPath(import.meta.url))
const baseDraft = MergedDraftSchema.parse(JSON.parse(
  readFileSync(resolve(here, '__fixtures__/sample-merged-draft.json'), 'utf-8'),
))

function spec(over: Partial<PromptSpec> = {}): PromptSpec {
  return { agent: 'a', frameStyle: 'analyst', prompts: [], forbiddenPhrases: ['建議買'], garnishTerms: [], ...over }
}

function withFrameDescription(draft: MergedDraft, description: string): MergedDraft {
  const clone = structuredClone(draft)
  const item = clone.frames[0]?.items[0]
  if (item)
    item.frame.description = description
  return clone
}

function withVocab(draft: MergedDraft, preferred: string[]): MergedDraft {
  const clone = structuredClone(draft)
  clone.vocabulary = preferred.map((p, i) => ({ id: `v${i}`, sourceSlug: 's', entry: { id: `v${i}`, preferred: p, avoid: [], reason: 'r' } }))
  return clone
}

describe('buildResearchBlock：依 frame-style 渲染', () => {
  it('analyst：列 description 與 questions，不列 whenToApply 與 Red Flags', () => {
    const { text } = buildResearchBlock(baseDraft, spec({ frameStyle: 'analyst' }))
    expect(text.startsWith('## 研究素材補充（baguanomics）')).toBe(true)
    expect(text).toContain('### [from: skill-financial-analyst] 5-phase scoping workflow')
    expect(text).toContain('  - 哪些 sector 直接受衝擊？')
    expect(text).not.toContain('**whenToApply**')
    expect(text).not.toContain('### Red Flags')
  })

  it('decomposer：多列 whenToApply', () => {
    const { text } = buildResearchBlock(baseDraft, spec({ frameStyle: 'decomposer' }))
    expect(text).toContain('**whenToApply**: 央行政策改變時')
    expect(text).toContain('questions:')
  })

  it('synthesizer：列 Red Flags，不列 questions', () => {
    const { text } = buildResearchBlock(baseDraft, spec({ frameStyle: 'synthesizer' }))
    expect(text).toContain('### Red Flags\n- [from: skill-financial-analyst] 個股 ticker + 方向性動詞 — 禁')
    expect(text).not.toContain('questions:')
  })
})

describe('buildResearchBlock：合規過濾', () => {
  it('frame 含規格檔禁用語時整條丟掉並計數', () => {
    const draft = withFrameDescription(baseDraft, '遇到升息就建議買')
    const block = buildResearchBlock(draft, spec())
    expect(block.droppedFrames).toBe(1)
    expect(block.text).not.toContain('5-phase scoping workflow')
    expect(block.text).toContain('ratio-check')
  })

  it('frame 含個股加方向性動詞時整條丟掉', () => {
    const block = buildResearchBlock(withFrameDescription(baseDraft, '台積電看多'), spec())
    expect(block.droppedFrames).toBe(1)
  })

  it('禁用語清單來自規格檔：同一段文字換一份清單就不丟', () => {
    const draft = withFrameDescription(baseDraft, '遇到升息就建議買')
    expect(buildResearchBlock(draft, spec({ forbiddenPhrases: ['別的詞'] })).droppedFrames).toBe(0)
  })

  it('術語含禁用語時丟掉並計數，其餘列出', () => {
    const block = buildResearchBlock(withVocab(baseDraft, ['殖利率曲線', '建議買進']), spec())
    expect(block.droppedTerms).toBe(1)
    expect(block.text).toContain('下列精準術語在真正貼切時可用（不強迫、不灌水）：殖利率曲線。')
  })

  it('規格檔有抽象評價贅詞時加禁止贅尾那行，且贅詞不當術語列出', () => {
    const block = buildResearchBlock(withVocab(baseDraft, ['值得關注', '殖利率曲線']), spec({ garnishTerms: ['值得關注'] }))
    expect(block.text).toContain('嚴禁固定贅尾：不要把抽象評價詞（值得關注）')
    expect(block.text).toContain('：殖利率曲線。')
    expect(block.droppedTerms).toBe(0)
  })
})
