import type { SourceSpec } from '../../types.js'
import type { LlmRunEstimate } from './llm-run-budget.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_FORBIDDEN_PHRASES } from '../../__fixtures__/forbidden-phrases.js'
import { DISTILL_MAX_ATTEMPTS } from '../../distillers/build-digest.js'
import { LLM_SDK_MAX_RETRIES, LlmOutputError } from '../../llm.js'
import { CONSOLIDATOR_MAX_ATTEMPTS } from '../../sources/yt-transcript/consolidator.js'
import { LENS_MAX_ATTEMPTS } from '../../sources/yt-transcript/lens-extractors.js'
import { SEGMENTER_MAX_ATTEMPTS } from '../../sources/yt-transcript/segmenter.js'
import { estimateTotalCalls } from './llm-run-budget.js'
import { estimatePromptResearchDistill } from './prompt-research-distill-estimate.js'

function ytSpec(count: number, slug = 'yt'): SourceSpec {
  return { kind: 'yt-transcript', slug, displayName: slug, pipeline: 'deep', config: { playlistUrl: 'https://x/streams', count } }
}
function ytVideosSpec(videoUrls: string[], slug = 'yt'): SourceSpec {
  return { kind: 'yt-transcript', slug, displayName: slug, pipeline: 'deep', config: { videoUrls } }
}
function skillSpec(slug = 'skill'): SourceSpec {
  return { kind: 'skill-markdown', slug, displayName: slug, pipeline: 'light', config: { repoOwner: 'o', repoName: 'r', skillPath: 'p', ref: 'main' } }
}
function customTextSpec(filePath: string, slug = 'custom'): SourceSpec {
  return { kind: 'custom-text', slug, displayName: slug, pipeline: 'light', config: { filePath } }
}

// llm-run-budget.ts 沒 export HTTP 最壞值的算法，這裡照它的公式重算，只為斷言報告會印的數字。
function httpWorstCase(e: LlmRunEstimate): number {
  return e.terms.reduce((sum, t) => sum + t.units * t.callsPerUnit * t.httpMultiplier, 0)
}

const YT_PER_EPISODE = SEGMENTER_MAX_ATTEMPTS + 6 * LENS_MAX_ATTEMPTS
const YT_PER_RUN = CONSOLIDATOR_MAX_ATTEMPTS + DISTILL_MAX_ATTEMPTS

describe('estimatePromptResearchDistill：公式', () => {
  it('yt-transcript count=5 → 76（5 × (2 segmenter + 12 lens) + 3 consolidator + 3 distill）', () => {
    expect(estimateTotalCalls(estimatePromptResearchDistill([ytSpec(5)]))).toBe(76)
  })

  it('videoUrls 來源以影片數為集數', () => {
    const e = estimatePromptResearchDistill([ytVideosSpec(['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://www.youtube.com/watch?v=bbbbbbbbbbb'])])
    expect(estimateTotalCalls(e)).toBe(2 * YT_PER_EPISODE + YT_PER_RUN)
  })

  it('config 沒帶合法 count 時 fallback 到 YtSourceConfigSchema 的預設值 5', () => {
    const spec: SourceSpec = { kind: 'yt-transcript', slug: 'y', displayName: 'y', pipeline: 'deep', config: { playlistUrl: 'https://x/streams' } }
    expect(estimateTotalCalls(estimatePromptResearchDistill([spec]))).toBe(76)
  })

  it('skill-markdown／custom-text 固定 DISTILL_MAX_ATTEMPTS 次', () => {
    expect(estimateTotalCalls(estimatePromptResearchDistill([skillSpec()]))).toBe(DISTILL_MAX_ATTEMPTS)
  })

  it('多個 source 加總', () => {
    const e = estimatePromptResearchDistill([ytSpec(5), skillSpec('a'), skillSpec('b')])
    expect(estimateTotalCalls(e)).toBe(76 + 2 * DISTILL_MAX_ATTEMPTS)
  })

  it('hTTP 最壞值 = 業務重試上限 × (SDK maxRetries + 1)', () => {
    expect(httpWorstCase(estimatePromptResearchDistill([ytSpec(5)]))).toBe(76 * (LLM_SDK_MAX_RETRIES + 1))
  })
})

describe('estimatePromptResearchDistill：peak（EPISODE_CONCURRENCY=3 × LENS_CONCURRENCY=3 兩層巢狀）', () => {
  it('count=1 → 3、count=2 → 6、count=3 與 100 都封頂 9', () => {
    expect(estimatePromptResearchDistill([ytSpec(1)]).peak).toBe(3)
    expect(estimatePromptResearchDistill([ytSpec(2)]).peak).toBe(6)
    expect(estimatePromptResearchDistill([ytSpec(3)]).peak).toBe(9)
    expect(estimatePromptResearchDistill([ytSpec(100)]).peak).toBe(9)
  })

  it('skill-markdown 無扇出，peak=1；多個 source 取最大值不加總', () => {
    expect(estimatePromptResearchDistill([skillSpec()]).peak).toBe(1)
    expect(estimatePromptResearchDistill([ytSpec(1), skillSpec()]).peak).toBe(3)
  })
})

// mock 邊界：callStructured（LLM）與抓字幕／watch 頁，其餘真跑 dispatchSource。
// 探針讓目標 stage 永遠回不合格輸出，數丟例外前被呼叫幾次：這個數字由各 stage 的重試迴圈決定，
// 鎖的是「估算用的常數 === 程式實際行為」。

type StageBehavior
  = | { kind: 'succeed-after', failsBefore: number }
    | { kind: 'always-bad' }

const llmState = vi.hoisted(() => ({
  calls: {} as Record<string, number>,
  behaviors: {} as Record<string, StageBehavior>,
}))

const LENS_SUCCESS: Record<string, unknown> = {
  'lens:events': { episodeId: 'ep1', events: [] },
  'lens:cited_sources': { episodeId: 'ep1', sources: [] },
  'lens:entities': { episodeId: 'ep1', entities: [] },
  'lens:reasoning_chains': { episodeId: 'ep1', chains: [] },
  'lens:impacts': { episodeId: 'ep1', impacts: [] },
  'lens:analyst_frames': { episodeId: 'ep1', frames: [] },
}

function successFor(stage: string): unknown {
  if (stage === 'segmenter') {
    return {
      episodeId: 'ep1',
      durationSec: 600,
      segments: [{ startSec: 0, endSec: 10, topic: 'other', headline: 'h', relevance: 0.5 }],
      keptTopics: [],
      droppedMinutes: { joke: 0, ad: 0, chitchat: 0, other: 0 },
    }
  }
  if (stage === 'consolidator')
    return { markdown: '測試 consolidated markdown output，無違規字眼' }
  if (stage === 'distill') {
    return {
      analystFrames: [{ name: 'a', description: 'd', whenToApply: 'w', questions: ['q'] }],
      analysisChecks: [],
      vocabulary: [],
      compliance: { redFlags: [], suggestedDisclaimer: null },
    }
  }
  if (stage in LENS_SUCCESS)
    return LENS_SUCCESS[stage]
  throw new Error(`unclassified stage in test mock: ${stage}`)
}

vi.mock('../../llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../llm.js')>()
  return {
    ...actual,
    callStructured: async ({ stage }: { stage: string }): Promise<unknown> => {
      const n = (llmState.calls[stage] ?? 0) + 1
      llmState.calls[stage] = n
      const behavior = llmState.behaviors[stage] ?? { kind: 'succeed-after', failsBefore: 0 }
      if (behavior.kind === 'always-bad' || n <= behavior.failsBefore)
        throw new actual.LlmOutputError(stage, new Error('probe'))
      return successFor(stage)
    },
  }
})

vi.mock('../../sources/yt-transcript/transcript-fetcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sources/yt-transcript/transcript-fetcher.js')>()
  return {
    ...actual,
    fetchTranscript: async (videoId: string) => ({
      videoId,
      text: '[0:00] 逐字稿內容',
      chars: 11,
      segments: [{ offsetSec: 600, text: '逐字稿內容' }],
      language: 'zh-TW',
    }),
  }
})

vi.mock('../../sources/yt-transcript/video-meta.js', () => ({
  fetchVideoRef: async (videoId: string, durationSec: number, publishedAt: string) => ({
    videoId,
    title: 't',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt,
    durationSec,
  }),
}))

const ONE_VIDEO = ytVideosSpec(['https://www.youtube.com/watch?v=7-V-NWQpF7I'])

async function runProbe(spec: SourceSpec = ONE_VIDEO): Promise<unknown> {
  const { dispatchSource } = await import('../../sources/index.js')
  const runDir = mkdtempSync(join(tmpdir(), 'prd-estimate-test-'))
  try {
    return await dispatchSource(spec, runDir, { forbiddenPhrases: FIXTURE_FORBIDDEN_PHRASES })
  }
  finally {
    rmSync(runDir, { recursive: true, force: true })
  }
}

describe('estimatePromptResearchDistill：mock callStructured，真跑 dispatchSource', () => {
  beforeEach(() => {
    llmState.calls = {}
    llmState.behaviors = {}
  })

  it('每個 stage 都重試到最後一次才成功時，總呼叫數等於估算（1 支影片 → 20）', async () => {
    const lensBehavior: StageBehavior = { kind: 'succeed-after', failsBefore: LENS_MAX_ATTEMPTS - 1 }
    llmState.behaviors = {
      segmenter: { kind: 'succeed-after', failsBefore: SEGMENTER_MAX_ATTEMPTS - 1 },
      ...Object.fromEntries(Object.keys(LENS_SUCCESS).map(k => [k, lensBehavior])),
      consolidator: { kind: 'succeed-after', failsBefore: CONSOLIDATOR_MAX_ATTEMPTS - 1 },
      distill: { kind: 'succeed-after', failsBefore: DISTILL_MAX_ATTEMPTS - 1 },
    }

    const digest = await runProbe() as { analystFrames: unknown[] }
    expect(digest.analystFrames.length).toBeGreaterThan(0)

    const total = Object.values(llmState.calls).reduce((a, b) => a + b, 0)
    expect(total).toBe(estimateTotalCalls(estimatePromptResearchDistill([ONE_VIDEO])))
    expect(total).toBe(20)
  })

  it.each([
    ['segmenter', SEGMENTER_MAX_ATTEMPTS],
    ['lens:events', LENS_MAX_ATTEMPTS],
    ['consolidator', CONSOLIDATOR_MAX_ATTEMPTS],
    ['distill', DISTILL_MAX_ATTEMPTS],
  ])('探針｜%s 永遠回不合格輸出 → 丟例外前呼叫次數等於估算常數', async (stage, expected) => {
    llmState.behaviors = { [stage]: { kind: 'always-bad' } }
    await expect(runProbe()).rejects.toThrow(LlmOutputError)
    expect(llmState.calls[stage]).toBe(expected)
  })

  it('探針｜custom-text distill 永遠回不合格輸出 → DISTILL_MAX_ATTEMPTS 次', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prd-custom-text-'))
    const filePath = join(dir, 'source.txt')
    writeFileSync(filePath, '測試素材：分析框架的原始內容', 'utf8')
    try {
      llmState.behaviors = { distill: { kind: 'always-bad' } }
      await expect(runProbe(customTextSpec(filePath))).rejects.toThrow(LlmOutputError)
      expect(llmState.calls.distill).toBe(DISTILL_MAX_ATTEMPTS)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
