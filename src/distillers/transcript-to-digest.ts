import type { DeepPipelinePromptVars } from '../pipeline/prompt-vars.js'
import type { EpisodeL3 } from '../sources/yt-transcript/schemas.js'
import type { Digest, SourceKind } from '../types.js'
import { distillToDigest } from './build-digest.js'

/**
 * Builds the system prompt that asks the LLM to extract a Digest JSON from the
 * consolidated md. yt-transcript 與 podcast-rss 共用、source-specific 字眼透過
 * `vars` 注入。yt 帶 `YT_PROMPT_VARS` 時與重構前 byte-for-byte 一致。
 *
 * 來源標籤從 `digestTitlePrefix` 第一個 token 取出（yt='YT' / podcast='Podcast'）、
 * 與 consolidator 輸出的 markdown title 同步、保持 LLM 看到的字眼一致。
 */
export function buildTranscriptToDigestPrompt(vars: DeepPipelinePromptVars): string {
  const sourceLabel = vars.digestTitlePrefix.split(' ')[0] ?? vars.sourceKindLabel
  return `你收到一份來自 ${sourceLabel} KOL ${vars.episodeWord} 7 集的「萬言 Digest」markdown、由 consolidator 產出。
你的任務：把這份 markdown 萃取成嚴格符合 DigestSchema 的 JSON。

抽取原則：
1. analystFrames：把 digest Section 2 的 10-15 條「Frame N」mapping 成 DigestSchema.analystFrames
   - 每個 frame 的 name 取自 Section 2 的「Frame N：<招式一句話命名>」
   - description 從「邏輯敘事」段落節錄（≤ 200 字）
   - whenToApply 從「適用情境」節錄
   - questions：從 frame 的內容改寫成 3-5 條具體可執行 questions（針對單則新聞事件）
2. vocabulary：從 digest 全文抽出中性分析詞 vs KOL 口語對照、最多 10 組
3. compliance.redFlags：digest Section 6 的合規重點
4. 回應嚴格 DigestSchema JSON。

【禁止】輸出含「建議買/賣/持有」等指令式；不得含個股 ticker + 方向性動詞組合。`
}

export function extractVideoIdsFromEpisodes(episodes: readonly EpisodeL3[]): string[] {
  return episodes.map(ep => ep.episodeId)
}

export interface TranscriptToDigestParams {
  sourceSlug: string
  sourceKind: SourceKind
  consolidatedMarkdown: string
  episodes: readonly EpisodeL3[]
  promptVars: DeepPipelinePromptVars
}

export async function distillTranscriptToDigest(params: TranscriptToDigestParams): Promise<Digest> {
  const systemPrompt = buildTranscriptToDigestPrompt(params.promptVars)
  const userContent = `sourceSlug: ${params.sourceSlug}\n\n---\n\n${params.consolidatedMarkdown}`
  return distillToDigest('distill', systemPrompt, userContent, {
    sourceSlug: params.sourceSlug,
    sourceKind: params.sourceKind,
    rawSourceRef: { url: params.episodes[0]?.url },
  })
}
