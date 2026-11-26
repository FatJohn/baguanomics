import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TEST_YT_VARS } from '../../__fixtures__/forbidden-phrases.js'
import { callStructured, LlmOutputError } from '../../llm.js'
import { LENS_CONCURRENCY, runAllLenses, runLens } from './lens-extractors.js'
import { createLogger } from './logger.js'

vi.mock('../../llm.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../llm.js')>()),
  callStructured: vi.fn(),
}))

const mockCall = vi.mocked(callStructured)

const VALID_EVENTS = {
  episodeId: 'ep1',
  events: [
    {
      title: '美國 CPI 公布',
      date: '2026-04-20',
      description: '美國公布最新 CPI 數據，市場關注通膨路徑變化。',
      segmentRef: { startSec: 120, endSec: 180 },
    },
  ],
}

const INVALID_ENTITIES = {
  episodeId: 'ep1',
  entities: [
    {
      kind: 'ticker',
      name: '2330',
      mentionCount: 2,
      context: '主持人提到台股權值股。',
    },
  ],
}

const VALID_ENTITIES = {
  episodeId: 'ep1',
  entities: [
    {
      kind: 'sector',
      name: '半導體',
      mentionCount: 2,
      context: '主持人提到半導體產業景氣循環。',
    },
  ],
}

function mockReturns(...responses: unknown[]) {
  for (const r of responses) mockCall.mockResolvedValueOnce(r)
}

interface CallParams { stage: string }

const EMPTY_KEY: Record<string, string> = {
  'lens:events': 'events',
  'lens:cited_sources': 'sources',
  'lens:entities': 'entities',
  'lens:reasoning_chains': 'chains',
  'lens:impacts': 'impacts',
  'lens:analyst_frames': 'frames',
}

/** 依 stage 辨識這次呼叫是哪個 lens，回傳一組通過該 lens schema 的空陣列回應。 */
function lensSuccessFor(params: CallParams): unknown {
  const key = EMPTY_KEY[params.stage]
  if (!key)
    throw new Error(`unclassified lens call in test mock: ${params.stage}`)
  return { episodeId: 'ep1', [key]: [] }
}

describe('runLens', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lens-'))
    mockCall.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('shouldValidateAndReturnForEvents', async () => {
    mockReturns(VALID_EVENTS)
    const logger = createLogger({ runId: 'r1', runDir: dir })
    const result = await runLens('events', 'fake transcript', 'ep1', logger, TEST_YT_VARS)
    expect(result.episodeId).toBe('ep1')
    expect(result.events[0]?.title).toBe('美國 CPI 公布')
    logger.close()
  })

  it('shouldRejectEntitiesWithTickerKind', async () => {
    mockReturns(INVALID_ENTITIES, VALID_ENTITIES)
    const logger = createLogger({ runId: 'r2', runDir: dir })
    const result = await runLens('entities', 'fake transcript', 'ep1', logger, TEST_YT_VARS)
    expect(mockCall).toHaveBeenCalledTimes(2)
    expect(result.entities[0]?.kind).toBe('sector')
    logger.close()
  })

  it('truncates items beyond the lens limit instead of retrying', async () => {
    const impact = { sector: '半導體', direction: 'positive', timeHorizon: 'short', reasoning: '需求回溫。' }
    mockReturns({ episodeId: 'ep1', impacts: Array.from({ length: 15 }).fill(impact) })
    const logger = createLogger({ runId: 'r3', runDir: dir })
    const result = await runLens('impacts', 'fake transcript', 'ep1', logger, TEST_YT_VARS)
    expect(mockCall).toHaveBeenCalledTimes(1)
    expect(result.impacts).toHaveLength(12)
    logger.close()
  })
})

describe('runAllLenses', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lens-all-'))
    mockCall.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // 6 個 lens 上限並行 LENS_CONCURRENCY（=3）跑，不是 Promise.all 一次全開——改回
  // Promise.all 會讓 maxActive 變成 6，這條斷言會紅。
  it('caps concurrent lens calls at LENS_CONCURRENCY and preserves LENS_ORDER in the result', async () => {
    let active = 0
    let maxActive = 0
    mockCall.mockImplementation(async (params: CallParams) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 20))
      active--
      return lensSuccessFor(params)
    })

    const logger = createLogger({ runId: 'r-all', runDir: dir })
    const result = await runAllLenses('fake transcript', 'ep1', logger, TEST_YT_VARS)
    logger.close()

    expect(mockCall).toHaveBeenCalledTimes(6)
    expect(maxActive).toBe(LENS_CONCURRENCY)
    expect(Object.keys(result)).toEqual([
      'events',
      'cited_sources',
      'entities',
      'reasoning_chains',
      'impacts',
      'analyst_frames',
    ])
  })

  // 錯誤語意要跟原本 Promise.all 一致：任一 lens 重試到底仍失敗，整包最終要 reject。
  it('rejects when one lens exhausts retries, matching Promise.all error semantics', async () => {
    mockCall.mockImplementation(async (params: CallParams) => {
      if (params.stage === 'lens:entities')
        throw new LlmOutputError(params.stage, new Error('bad'))
      return lensSuccessFor(params)
    })

    const logger = createLogger({ runId: 'r-all-fail', runDir: dir })
    await expect(runAllLenses('fake transcript', 'ep1', logger, TEST_YT_VARS)).rejects.toThrow()
    logger.close()
  })
})
