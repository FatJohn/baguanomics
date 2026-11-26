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

  it('rejects a forbidden phrase taken from the spec list, not a built-in list', async () => {
    mockReturns(COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '自訂禁語出現'), COMPLIANT_SUPPLEMENT)
    const logger = createLogger({ runId: 'run-4', runDir: dir })
    await runConsolidator(SAMPLE_L3, 'run-4', logger, { ...TEST_YT_VARS, forbiddenPhrases: ['自訂禁語'] })
    expect(mockCall).toHaveBeenCalledTimes(2)
    logger.close()
  })
})
