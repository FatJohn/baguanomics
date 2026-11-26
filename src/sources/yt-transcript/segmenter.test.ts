import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TEST_YT_VARS } from '../../__fixtures__/forbidden-phrases.js'
import { callStructured, LlmOutputError } from '../../llm.js'
import { createLogger } from './logger.js'
import { runSegmenter } from './segmenter.js'

vi.mock('../../llm.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../llm.js')>()),
  callStructured: vi.fn(),
}))

const mockCall = vi.mocked(callStructured)

const VALID_OUTPUT = {
  episodeId: 'ep1',
  durationSec: 3600,
  segments: [
    { startSec: 0, endSec: 1800, topic: 'market', headline: 'intro', relevance: 0.9 },
    { startSec: 1800, endSec: 3600, topic: 'joke', headline: 'ad', relevance: 0.1 },
  ],
  keptTopics: ['market', 'macro_event'],
  droppedMinutes: { joke: 30, ad: 0, chitchat: 0, other: 0 },
}

function mockReturns(...responses: unknown[]) {
  for (const r of responses) mockCall.mockResolvedValueOnce(r)
}

describe('runSegmenter', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seg-'))
    mockCall.mockReset()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns the validated output and tags the call as the segmenter stage', async () => {
    mockReturns(VALID_OUTPUT)
    const logger = createLogger({ runId: 'r1', runDir: dir })
    const result = await runSegmenter('fake transcript', 'ep1', logger, TEST_YT_VARS)
    expect(result.episodeId).toBe('ep1')
    expect(result.segments).toHaveLength(2)
    expect(mockCall.mock.calls[0]?.[0]).toMatchObject({ stage: 'segmenter', user: 'episodeId: ep1\n\n---\n\nfake transcript' })
    logger.close()
  })

  it('shouldRetryOnceWhenFirstResponseIsInvalidSchema', async () => {
    mockReturns({ invalid: true }, VALID_OUTPUT)
    const logger = createLogger({ runId: 'r2', runDir: dir })
    const result = await runSegmenter('t', 'ep1', logger, TEST_YT_VARS)
    expect(mockCall).toHaveBeenCalledTimes(2)
    expect(result.episodeId).toBe('ep1')
    logger.close()
  })

  it('retries LlmOutputError and throws after SEGMENTER_MAX_ATTEMPTS', async () => {
    mockCall.mockRejectedValue(new LlmOutputError('segmenter', new Error('bad')))
    const logger = createLogger({ runId: 'r3', runDir: dir })
    await expect(runSegmenter('t', 'ep1', logger, TEST_YT_VARS)).rejects.toBeInstanceOf(LlmOutputError)
    expect(mockCall).toHaveBeenCalledTimes(2)
    logger.close()
  })

  it('does not retry non-output errors such as network failures', async () => {
    mockCall.mockRejectedValue(new Error('ECONNRESET'))
    const logger = createLogger({ runId: 'r4', runDir: dir })
    await expect(runSegmenter('t', 'ep1', logger, TEST_YT_VARS)).rejects.toThrow('ECONNRESET')
    expect(mockCall).toHaveBeenCalledTimes(1)
    logger.close()
  })
})
