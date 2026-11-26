import { NoObjectGeneratedError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { callStructured, computeCostUsd, getLlmUsage, LlmOutputError, resetLlmUsage, resolveModel, totalCostUsd } from './llm.js'

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextMock }
})

const schema = z.object({ ok: z.boolean() })
const params = { stage: 's', system: 'sys', user: 'u', schema }

describe('resolveModel', () => {
  it('預設 claude-haiku-5-5，可由 BAGUANOMICS_MODEL 覆寫', () => {
    expect(resolveModel({})).toBe('claude-haiku-5-5')
    expect(resolveModel({ BAGUANOMICS_MODEL: 'claude-sonnet-5-5' })).toBe('claude-sonnet-5-5')
  })

  it('沒有價格的 model 直接拒絕', () => {
    expect(() => resolveModel({ BAGUANOMICS_MODEL: 'claude-opus-5-5' })).toThrow(/沒有價格可估/)
  })
})

describe('computeCostUsd', () => {
  it('依每百萬 token 單價計算', () => {
    expect(computeCostUsd('claude-haiku-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.6)
  })

  it('cache 讀寫依倍率計價', () => {
    const cost = computeCostUsd('claude-haiku-5-5', {
      inputTokens: 3_000_000,
      outputTokens: 0,
      inputTokenDetails: { noCacheTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
    })
    expect(cost).toBeCloseTo(0.1 + 0.01 + 0.125)
  })
})

describe('callStructured', () => {
  beforeEach(() => {
    resetLlmUsage()
    generateTextMock.mockReset()
    vi.unstubAllEnvs()
  })

  it('回傳 output 並記帳', async () => {
    generateTextMock.mockResolvedValue({ output: { ok: true }, usage: { inputTokens: 1000, outputTokens: 100 } })
    await expect(callStructured(params)).resolves.toEqual({ ok: true })
    expect(getLlmUsage()).toEqual([{ stage: 's', model: 'claude-haiku-5-5', inputTokens: 1000, outputTokens: 100, costUsd: expect.any(Number) }])
    expect(generateTextMock.mock.calls[0]?.[0]).toMatchObject({ system: 'sys', prompt: 'u', maxRetries: 2 })
  })

  it('noObjectGeneratedError 轉成 LlmOutputError，已用的 token 仍記帳', async () => {
    generateTextMock.mockRejectedValue(new NoObjectGeneratedError({
      message: 'bad',
      text: '{}',
      response: { id: 'r', timestamp: new Date(), modelId: 'm' },
      usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550, inputTokenDetails: { noCacheTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 50, reasoningTokens: 0 } },
      finishReason: 'stop',
    }))
    await expect(callStructured(params)).rejects.toBeInstanceOf(LlmOutputError)
    expect(getLlmUsage()).toHaveLength(1)
  })

  it('其他錯誤原樣拋出、不轉成可重試錯誤', async () => {
    generateTextMock.mockRejectedValue(new Error('network'))
    await expect(callStructured(params)).rejects.toThrow('network')
    await expect(callStructured(params)).rejects.not.toBeInstanceOf(LlmOutputError)
  })

  it('累計花費達 BAGUANOMICS_MAX_USD 時在打 API 前擋下', async () => {
    vi.stubEnv('BAGUANOMICS_MAX_USD', '0.0001')
    generateTextMock.mockResolvedValue({ output: { ok: true }, usage: { inputTokens: 1_000_000, outputTokens: 0 } })
    await callStructured(params)
    expect(totalCostUsd()).toBeGreaterThan(0.0001)
    await expect(callStructured(params)).rejects.toThrow(/BAGUANOMICS_MAX_USD/)
    expect(generateTextMock).toHaveBeenCalledTimes(1)
  })

  it('bAGUANOMICS_MAX_USD 不是正數時拒絕', async () => {
    vi.stubEnv('BAGUANOMICS_MAX_USD', '-1')
    await expect(callStructured(params)).rejects.toThrow(/要是正數/)
  })
})
