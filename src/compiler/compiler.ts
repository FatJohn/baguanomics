import type { LoadedSpec } from '../spec/load-specs.js'
import type { MergedDraft } from '../types.js'
import { unifiedDiff } from './line-diff.js'
import { buildResearchBlock } from './research-block.js'

export interface CompiledCandidate {
  agent: string
  promptName: string
  specPath: string
  candidate: string
  diff: string
  droppedFrames: number
  droppedTerms: number
}

/**
 * 純函式：規格檔 × merged draft → 每個 prompt 一份候選與 diff。frame-style 為 none 的 agent
 * 不接研究素材（v0 也只編 decomposer／analyst／synthesizer），規格檔沒有現行 prompt 的跳過。
 */
export function compileCandidates(specs: readonly LoadedSpec[], draft: MergedDraft): CompiledCandidate[] {
  const out: CompiledCandidate[] = []
  for (const spec of specs) {
    if (spec.frameStyle === 'none')
      continue
    const block = buildResearchBlock(draft, spec)
    for (const prompt of spec.prompts) {
      const candidate = `${prompt.text}\n\n${block.text}`
      out.push({
        agent: spec.agent,
        promptName: prompt.name,
        specPath: spec.path,
        candidate,
        diff: unifiedDiff(prompt.text, candidate, {
          from: `${spec.path}#${prompt.name}`,
          to: `candidate/${spec.agent}.${prompt.name}.txt`,
        }),
        droppedFrames: block.droppedFrames,
        droppedTerms: block.droppedTerms,
      })
    }
  }
  return out
}
