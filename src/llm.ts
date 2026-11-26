import type { z } from 'zod'
import process from 'node:process'
import { anthropic } from '@ai-sdk/anthropic'
import { generateText, NoObjectGeneratedError, Output } from 'ai'

/**
 * 本工具唯一的 LLM 呼叫入口：AI SDK 的 generateText 加 Output.object。
 * 每次呼叫都記進 process 內的帳本並對照花費上限；超過上限就在打 API 之前擋下。
 */

const DEFAULT_MODEL = 'claude-haiku-5-5'
const DEFAULT_MAX_USD = 1
// Haiku／Sonnet 5.5 預設開 adaptive thinking，thinking token 也算在 max_tokens 內，上限太低會截斷輸出。
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000
/** 網路錯誤與 429 由 AI SDK 自己重試的次數；預算估算用它算 HTTP 最壞值。 */
export const LLM_SDK_MAX_RETRIES = 2

interface ModelPrice { input: number, output: number } // USD per 1M tokens

// 價格取自 suanomics apps/pipeline/src/agents/pricing.ts（PRICE_VERSION 2026-10-06）。
// Haiku 5.5 的 prompt 超過 100K token 時單價變 5 倍，表上只記 100K 以內的價。
const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50 },
  'claude-sonnet-5-5': { input: 2.00, output: 10.00 },
}
const CACHE_RATES = { write: 1.25, read: 0.1 }

export interface LlmUsageEntry {
  stage: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

const ledger: LlmUsageEntry[] = []

export function getLlmUsage(): readonly LlmUsageEntry[] {
  return ledger
}

export function totalCostUsd(): number {
  return ledger.reduce((sum, e) => sum + e.costUsd, 0)
}

/** 測試用：清空帳本。 */
export function resetLlmUsage(): void {
  ledger.length = 0
}

export function resolveModel(env: Record<string, string | undefined> = process.env): string {
  const model = env.BAGUANOMICS_MODEL || DEFAULT_MODEL
  if (!MODEL_PRICING[model])
    throw new Error(`BAGUANOMICS_MODEL 沒有價格可估：${model}（可用：${Object.keys(MODEL_PRICING).join('、')}）`)
  return model
}

function maxUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.BAGUANOMICS_MAX_USD
  if (raw === undefined || raw === '')
    return DEFAULT_MAX_USD
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`BAGUANOMICS_MAX_USD 要是正數，收到 ${raw}`)
  return n
}

interface SdkUsage {
  inputTokens: number | undefined
  outputTokens: number | undefined
  inputTokenDetails?: {
    noCacheTokens: number | undefined
    cacheReadTokens: number | undefined
    cacheWriteTokens: number | undefined
  }
}

export function computeCostUsd(model: string, usage: SdkUsage): number {
  const price = MODEL_PRICING[model]
  if (!price)
    throw new Error(`沒有這個 model 的價格：${model}`)
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0
  const noCache = usage.inputTokenDetails?.noCacheTokens ?? (usage.inputTokens ?? 0) - cacheRead - cacheWrite
  const inputUnits = noCache + cacheWrite * CACHE_RATES.write + cacheRead * CACHE_RATES.read
  return (inputUnits * price.input + (usage.outputTokens ?? 0) * price.output) / 1_000_000
}

function record(stage: string, model: string, usage: SdkUsage): void {
  ledger.push({
    stage,
    model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: computeCostUsd(model, usage),
  })
}

/** 模型回了東西但不符 schema；呼叫端可重試，token 已計費並記進帳本。 */
export class LlmOutputError extends Error {
  constructor(stage: string, cause: unknown) {
    super(`${stage}: LLM 輸出不符 schema`, { cause })
    this.name = 'LlmOutputError'
  }
}

export interface CallStructuredParams<T> {
  stage: string
  system: string
  user: string
  schema: z.ZodType<T>
  timeoutMs?: number
  maxOutputTokens?: number
}

export async function callStructured<T>(p: CallStructuredParams<T>): Promise<T> {
  const model = resolveModel()
  const cap = maxUsd()
  const spent = totalCostUsd()
  if (spent >= cap)
    throw new Error(`已花 US$${spent.toFixed(4)}，達到 BAGUANOMICS_MAX_USD 上限 US$${cap}，停止呼叫（stage ${p.stage}）`)

  try {
    const result = await generateText({
      model: anthropic(model),
      system: p.system,
      prompt: p.user,
      output: Output.object({ schema: p.schema }),
      maxOutputTokens: p.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      maxRetries: LLM_SDK_MAX_RETRIES,
      ...(p.timeoutMs !== undefined ? { timeout: p.timeoutMs } : {}),
    })
    record(p.stage, model, result.usage)
    return result.output
  }
  catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      if (err.usage)
        record(p.stage, model, err.usage)
      throw new LlmOutputError(p.stage, err)
    }
    throw err
  }
}
