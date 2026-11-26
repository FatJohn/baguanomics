import type { SourceSpec } from '../../types.js'
import type { LlmRunEstimate, LlmRunTerm } from './llm-run-budget.js'
import { DISTILL_MAX_ATTEMPTS } from '../../distillers/build-digest.js'
import { LLM_SDK_MAX_RETRIES } from '../../llm.js'
import { EPISODE_CONCURRENCY } from '../../pipeline/deep-pipeline.js'
import { CONSOLIDATOR_MAX_ATTEMPTS } from '../../sources/yt-transcript/consolidator.js'
import { LENS_CONCURRENCY, LENS_MAX_ATTEMPTS } from '../../sources/yt-transcript/lens-extractors.js'
import { SEGMENTER_MAX_ATTEMPTS } from '../../sources/yt-transcript/segmenter.js'
import { term } from './llm-run-term.js'

// callsPerUnit 記各 stage 自己的業務重試上限（輸出不符 schema 才重試）；AI SDK 對網路錯誤與
// 429 的 maxRetries 只反映在 httpMultiplier，不重複計入 calls（兩層相乘會雙重計算）。

const LENS_COUNT = 6
const HTTP_MULTIPLIER = LLM_SDK_MAX_RETRIES + 1
/** YtSourceConfigSchema 的 count 預設值（types.ts）。 */
const DEFAULT_COUNT = 5

/** 指定影片時就是影片數；直播頁來源用 config.count 當開跑前已知的上界（頁面集數可能更少）。 */
function episodeCount(spec: SourceSpec): number {
  const urls = spec.config.videoUrls
  if (Array.isArray(urls))
    return urls.length
  const raw = spec.config.count
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_COUNT
}

function ytTerms(spec: SourceSpec): { terms: LlmRunTerm[], peak: number } {
  const count = episodeCount(spec)
  const perEpisode = SEGMENTER_MAX_ATTEMPTS + LENS_COUNT * LENS_MAX_ATTEMPTS
  return {
    terms: [
      term(`${spec.slug}（${count} 集，每集 segmenter + 6 lens 共 ${perEpisode} 次上限）`, count, perEpisode, HTTP_MULTIPLIER, 'segmenter.ts SEGMENTER_MAX_ATTEMPTS、lens-extractors.ts LENS_MAX_ATTEMPTS'),
      term(`${spec.slug} consolidator（每個 run 一次）`, 1, CONSOLIDATOR_MAX_ATTEMPTS, HTTP_MULTIPLIER, 'consolidator.ts CONSOLIDATOR_MAX_ATTEMPTS'),
      term(`${spec.slug} distill（每個 run 一次）`, 1, DISTILL_MAX_ATTEMPTS, HTTP_MULTIPLIER, 'build-digest.ts DISTILL_MAX_ATTEMPTS'),
    ],
    peak: Math.min(count, EPISODE_CONCURRENCY) * Math.min(LENS_COUNT, LENS_CONCURRENCY),
  }
}

/** @param specs CLI 覆寫全部套用完之後的最終 specs。 */
export function estimatePromptResearchDistill(specs: readonly SourceSpec[]): LlmRunEstimate {
  const terms: LlmRunTerm[] = []
  let peak = 1
  for (const spec of specs) {
    if (spec.kind === 'yt-transcript') {
      const built = ytTerms(spec)
      terms.push(...built.terms)
      peak = Math.max(peak, built.peak)
    }
    else {
      terms.push(term(`${spec.slug}（${spec.kind}，light pipeline）`, 1, DISTILL_MAX_ATTEMPTS, HTTP_MULTIPLIER, 'build-digest.ts DISTILL_MAX_ATTEMPTS'))
    }
  }
  return {
    script: 'distill',
    terms,
    peak,
    peakBasis: `deep-pipeline.ts EPISODE_CONCURRENCY=${EPISODE_CONCURRENCY} × lens-extractors.ts LENS_CONCURRENCY=${LENS_CONCURRENCY} `
      + '兩層巢狀並行；多個 source 之間序列跑，peak 取最大值不加總',
    caveats: [
      'callsPerUnit 假設每個 stage 都重試到上限；任一 stage 重試到底仍失敗時整包 throw，實際呼叫只會更少。',
      '直播頁來源的 count 是設定上界，頁面集數不足時實際更少。',
      '不含抓字幕、watch 頁與 skill markdown 這些非 LLM 網路請求。',
    ],
  }
}
