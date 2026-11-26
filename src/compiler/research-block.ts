import type { PromptSpec } from '../spec/parse-spec.js'
import type { MergedDraft } from '../types.js'
import type { CollectedFrame } from './collect.js'
import { containsForbiddenPhrase, containsTickerDirection } from '../vendor/compliance.js'
import { collectFramesFromDraft } from './collect.js'

/**
 * 把 distill 的 frames／vocabulary／redFlags 依規格檔的 frame-style 排成一段，接在現行 prompt 後面。
 * 各 style 渲染哪些欄位沿用 v0 的 decomposer／analyst／synthesizer builder；v0 寫死的角色說明
 * 由規格檔的現行 prompt 取代。帶禁用語或個股方向組合的 frame 與術語整條丟掉，不讓候選 prompt
 * 夾帶違規字眼；redFlags 本身就是「不得這樣寫」的規則，會引用禁用語，所以不過濾。
 */

export interface ResearchBlock {
  text: string
  droppedFrames: number
  droppedTerms: number
}

function violates(text: string, forbidden: readonly string[]): boolean {
  return containsForbiddenPhrase(text, forbidden).hit || containsTickerDirection(text).hit
}

function frameText(f: CollectedFrame): string {
  return [f.name, f.description, f.whenToApply, ...f.questions].join('\n')
}

function renderFrame(f: CollectedFrame, style: PromptSpec['frameStyle']): string[] {
  const lines = ['', `### [from: ${f.sourceSlug}] ${f.name}`]
  if (style === 'decomposer')
    lines.push(`**whenToApply**: ${f.whenToApply}`)
  lines.push(`description: ${f.description}`)
  if (style !== 'synthesizer' && f.questions.length > 0) {
    lines.push('questions:')
    for (const q of f.questions) lines.push(`  - ${q}`)
  }
  return lines
}

function vocabularyLines(draft: MergedDraft, spec: PromptSpec): { lines: string[], dropped: number } {
  const garnish = new Set(spec.garnishTerms)
  const terms = draft.vocabulary.map(v => v.entry.preferred).filter(p => !garnish.has(p))
  const kept = terms.filter(t => !violates(t, spec.forbiddenPhrases))
  const lines: string[] = []
  if (spec.garnishTerms.length > 0)
    lines.push(`- 嚴禁固定贅尾：不要把抽象評價詞（${spec.garnishTerms.join(' / ')}）當每條 mechanism 的固定收尾、或反覆堆砌不帶新資訊。每句都要有具體實體 / 數字 / 機制。`)
  if (kept.length > 0)
    lines.push(`- 下列精準術語在真正貼切時可用（不強迫、不灌水）：${kept.join('、')}。`)
  return { lines, dropped: terms.length - kept.length }
}

export function buildResearchBlock(draft: MergedDraft, spec: PromptSpec): ResearchBlock {
  const allFrames = collectFramesFromDraft(draft)
  const frames = allFrames.filter(f => !violates(frameText(f), spec.forbiddenPhrases))
  const vocab = vocabularyLines(draft, spec)

  const out: string[] = ['## 研究素材補充（baguanomics）']
  if (vocab.lines.length > 0)
    out.push('', '### 用詞', ...vocab.lines)
  if (spec.frameStyle === 'synthesizer' && draft.redFlags.length > 0) {
    out.push('', '### Red Flags')
    for (const r of draft.redFlags) out.push(`- [from: ${r.sourceSlug}] ${r.entry.rule}`)
  }
  if (frames.length > 0) {
    out.push('', '### 分析框架')
    for (const f of frames) out.push(...renderFrame(f, spec.frameStyle))
  }
  return { text: out.join('\n'), droppedFrames: allFrames.length - frames.length, droppedTerms: vocab.dropped }
}
