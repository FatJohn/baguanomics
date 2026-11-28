import type { EpisodeL3 } from './schemas.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TEST_YT_VARS } from '../../__fixtures__/forbidden-phrases.js'
import { callStructured } from '../../llm.js'
import { runConsolidator } from './consolidator.js'
import { createLogger } from './logger.js'

vi.mock('../../llm.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../llm.js')>()),
  callStructured: vi.fn(),
}))

const mockCall = vi.mocked(callStructured)

const SAMPLE_L3: EpisodeL3[] = [{
  episodeId: 'ep1',
  title: 'Ep1',
  url: 'https://x.test/1',
  publishedAt: '2026-04-21T00:00:00Z',
  durationSec: 3600,
  segmenter: {
    episodeId: 'ep1',
    durationSec: 3600,
    segments: [{ startSec: 0, endSec: 60, topic: 'market', headline: 'h', relevance: 0.9 }],
    keptTopics: ['market'],
    droppedMinutes: { joke: 0, ad: 0, chitchat: 0, other: 0 },
  },
  events: [],
  citedSources: [],
  entities: [],
  reasoningChains: [],
  impacts: [],
  analystFrames: [],
}]

const COMPLIANT_SUPPLEMENT = `# YT Analyst Digest · run-1

## 1. Top Macro Themes This Week
- 無關鍵事件
## 2. Cross-Episode Analyst Frames
- 無
## 3. Sector-Level Impact Map
- 無
## 4. Key Events Referenced
- 無
## 5. Cited Sources
- 無
## 6. Compliance Note
本 supplement 為 AI 工具從公開 KOL 直播萃取之分析模式參考、非投資建議、不含個股方向性評論。`

const UNCOMPLIANT_SUPPLEMENT = COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '台積電偏多格局延續')

function userOfCall(index: number): string {
  return mockCall.mock.calls[index]?.[0].user ?? ''
}

function mockReturns(...markdowns: string[]) {
  for (const markdown of markdowns) mockCall.mockResolvedValueOnce({ markdown })
}

describe('runConsolidator', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cons-'))
    mockCall.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('shouldReturnSupplementWhenCompliant', async () => {
    mockReturns(COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-1', runDir: dir })
    const result = await runConsolidator(SAMPLE_L3, 'run-1', logger, TEST_YT_VARS)
    expect(result).toContain('Top Macro Themes')
    expect(result).toContain('Compliance Note')
    logger.close()
  })

  it('shouldRetryWhenContainsTickerDirection', async () => {
    mockReturns(UNCOMPLIANT_SUPPLEMENT, COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-2', runDir: dir })
    const result = await runConsolidator(SAMPLE_L3, 'run-2', logger, TEST_YT_VARS)
    expect(result).not.toContain('台積電偏多')
    expect(mockCall).toHaveBeenCalledTimes(2)
    logger.close()
  })

  it('throws the compliance error after CONSOLIDATOR_MAX_ATTEMPTS uncompliant outputs', async () => {
    mockReturns(UNCOMPLIANT_SUPPLEMENT, UNCOMPLIANT_SUPPLEMENT, UNCOMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-3', runDir: dir })
    await expect(runConsolidator(SAMPLE_L3, 'run-3', logger, TEST_YT_VARS)).rejects.toThrow(/^compliance:forbidden:偏多/)
    expect(mockCall).toHaveBeenCalledTimes(3)
    logger.close()
  })

  it('passes every hit phrase and the previous draft to the next attempt', async () => {
    const draft = COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '值得追蹤的主軸、市場看空情緒')
    mockReturns(draft, COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-5', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-5', logger, TEST_YT_VARS)
    const retryUser = userOfCall(1)
    expect(retryUser).toContain('「值得追蹤」')
    expect(retryUser).toContain('「看空」')
    expect(retryUser).toContain('值得追蹤的主軸、市場看空情緒')
    logger.close()
  })

  it('keeps earlier hits in the feedback when a revision hits a new phrase', async () => {
    mockReturns(
      COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '值得追蹤'),
      COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '做空'),
      COMPLIANT_SUPPLEMENT,
    )
    const logger = createLogger({ runId: 'run-6', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-6', logger, TEST_YT_VARS)
    const thirdUser = userOfCall(2)
    expect(thirdUser).toContain('「做空」')
    expect(thirdUser).toContain('「值得追蹤」')
    logger.close()
  })

  it('names the ticker and verb when a revision is asked for a ticker-direction hit', async () => {
    const custom = { ...TEST_YT_VARS, forbiddenPhrases: [] }
    mockReturns(COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '台積電偏多格局'), COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-7', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-7', logger, custom)
    const retryUser = userOfCall(1)
    expect(retryUser).toContain('台積電')
    expect(retryUser).toContain('偏多')
    logger.close()
  })

  it('reports ticker-direction hits alongside forbidden phrases in the same feedback', async () => {
    mockReturns(COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '值得追蹤；台積電轉多'), COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-9', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-9', logger, { ...TEST_YT_VARS, forbiddenPhrases: ['值得追蹤'] })
    expect(userOfCall(1)).toContain('「值得追蹤」')
    expect(userOfCall(1)).toContain('「台積電」')
    logger.close()
  })

  it('reports every ticker-direction pair, not only the first', async () => {
    mockReturns(COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '台積電轉多。\n其他段落文字很多很多很多很多很多很多很多。\n鴻海轉空'), COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-10', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-10', logger, { ...TEST_YT_VARS, forbiddenPhrases: [] })
    expect(userOfCall(1)).toContain('「台積電」')
    expect(userOfCall(1)).toContain('「鴻海」')
    logger.close()
  })

  it.each([
    ['a second ticker shares the masked verb', '台積電轉多甲乙丙丁戊己庚辛轉多甲乙丙丁戊己庚辛壬癸子丑寅卯辰鴻海'],
    ['two tickers pair with one verb', '鴻海甲乙丙丁戊己庚辛壬癸子丑寅卯辰台積電轉多'],
  ])('reports every pair when %s', async (_, body) => {
    mockReturns(COMPLIANT_SUPPLEMENT.replace('無關鍵事件', body), COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-12', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-12', logger, { ...TEST_YT_VARS, forbiddenPhrases: [] })
    expect(userOfCall(1)).toContain('「台積電」')
    expect(userOfCall(1)).toContain('「鴻海」')
    logger.close()
  })

  it('keeps each feedback item on one line when the snippet spans a line break', async () => {
    mockReturns(COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '台積電\n轉多'), COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-13', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-13', logger, { ...TEST_YT_VARS, forbiddenPhrases: [] })
    const line = userOfCall(1).split('\n').find(l => l.includes('個股「台積電」'))
    expect(line).toMatch(/」$/)
    logger.close()
  })

  it('keeps revising the last flagged draft after an empty response', async () => {
    mockReturns(COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '值得追蹤'), '', COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-14', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-14', logger, TEST_YT_VARS)
    expect(userOfCall(2)).toContain('「值得追蹤」')
    logger.close()
  })

  it('does not repeat a ticker-direction pair whose surrounding text changed', async () => {
    mockReturns(
      COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '台積電轉多 A'),
      COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '台積電轉多 B'),
      COMPLIANT_SUPPLEMENT,
    )
    const logger = createLogger({ runId: 'run-11', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-11', logger, { ...TEST_YT_VARS, forbiddenPhrases: [] })
    expect(userOfCall(2).split('「台積電」').length - 1).toBe(1)
    logger.close()
  })

  it('retries from the L3 input when the failure is not a compliance hit', async () => {
    mockCall.mockResolvedValueOnce({ markdown: '' })
    mockReturns(COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-8', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-8', logger, TEST_YT_VARS)
    expect(userOfCall(1)).toBe(userOfCall(0))
    logger.close()
  })

  it('rejects a forbidden phrase taken from the spec list, not a built-in list', async () => {
    mockReturns(COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '自訂禁語出現'), COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-4', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-4', logger, { ...TEST_YT_VARS, forbiddenPhrases: ['自訂禁語'] })
    expect(mockCall).toHaveBeenCalledTimes(2)
    logger.close()
  })
})
