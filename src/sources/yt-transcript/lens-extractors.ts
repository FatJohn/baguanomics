import type { ZodType } from 'zod'
import type { DeepPipelinePromptVars } from '../../pipeline/prompt-vars.js'
import type { Logger } from './logger.js'
import type { LensName } from './prompts.js'
import type { AnalystFramesLens, CitedSourcesLens, EntitiesLens, EventsLens, ImpactsLens, ReasoningChainsLens } from './schemas.js'
import { ZodError } from 'zod'
import { callStructured, LlmOutputError } from '../../llm.js'
import { pMap } from '../dispatch-helpers.js'
import { buildLensExtractorSystemPrompt } from './prompts.js'
import { LENS_RESPONSE_SCHEMAS } from './response-schemas.js'
import {
  AnalystFramesLensSchema,
  CitedSourcesLensSchema,
  EntitiesLensSchema,
  EventsLensSchema,
  ImpactsLensSchema,
  LENS_ITEM_LIMITS,
  ReasoningChainsLensSchema,
} from './schemas.js'

const TIMEOUT_MS = 90_000
export const LENS_MAX_ATTEMPTS = 2

export interface LensOutputMap {
  events: EventsLens
  cited_sources: CitedSourcesLens
  entities: EntitiesLens
  reasoning_chains: ReasoningChainsLens
  impacts: ImpactsLens
  analyst_frames: AnalystFramesLens
}

export type AllLensesOutput = { [K in LensName]: LensOutputMap[K] }

type LensSchemaMap = { [K in LensName]: ZodType<LensOutputMap[K]> }

const LENS_ORDER = [
  'events',
  'cited_sources',
  'entities',
  'reasoning_chains',
  'impacts',
  'analyst_frames',
] as const satisfies readonly LensName[]

const LENS_SCHEMAS: LensSchemaMap = {
  events: EventsLensSchema,
  cited_sources: CitedSourcesLensSchema,
  entities: EntitiesLensSchema,
  reasoning_chains: ReasoningChainsLensSchema,
  impacts: ImpactsLensSchema,
  analyst_frames: AnalystFramesLensSchema,
}

const LENS_ITEM_KEYS = {
  events: 'events',
  cited_sources: 'sources',
  entities: 'entities',
  reasoning_chains: 'chains',
  impacts: 'impacts',
  analyst_frames: 'frames',
} as const satisfies { [K in LensName]: keyof LensOutputMap[K] & string }

// 回應 schema 不帶數量上限（見 response-schemas.ts），條數只靠 prompt 約束；
// 2026-11-26 實跑 Haiku 在 impacts 連續三次超過 12 條，重試無效，所以超出的部分直接截掉。
function capItems(lens: LensName, raw: unknown, onTruncate: (count: number, limit: number) => void): unknown {
  if (typeof raw !== 'object' || raw === null)
    return raw
  const key = LENS_ITEM_KEYS[lens]
  const items = (raw as Record<string, unknown>)[key]
  const limit = LENS_ITEM_LIMITS[lens]
  if (!Array.isArray(items) || items.length <= limit)
    return raw
  onTruncate(items.length, limit)
  return { ...raw, [key]: items.slice(0, limit) }
}

// 合規檢查只在 consolidator 輸出層做（Layer 4）。
// Lens 層只要結構正確（Zod schema pass）即可、允許包含 KOL 原話中的字眼、
// consolidator 再負責改寫成合規中性敘述。
export async function runLens<T extends LensName>(
  lens: T,
  transcript: string,
  episodeId: string,
  logger: Logger,
  vars: DeepPipelinePromptVars,
): Promise<LensOutputMap[T]> {
  let lastErr: unknown = new Error(`lens ${lens} failed after retries`)
  for (let attempt = 0; attempt < LENS_MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callStructured({
        stage: `lens:${lens}`,
        system: buildLensExtractorSystemPrompt(lens, vars),
        user: `episodeId: ${episodeId}\n\n---\n\n${transcript}`,
        schema: LENS_RESPONSE_SCHEMAS[lens],
        timeoutMs: TIMEOUT_MS,
      })
      const capped = capItems(lens, raw, (count, limit) =>
        logger.emit('lens.truncated', { episode: episodeId, lens, count, limit }, 'warn'))
      const parsed = LENS_SCHEMAS[lens].parse(capped) as LensOutputMap[T]
      logger.emit('lens.done', { episode: episodeId, lens })
      return parsed
    }
    catch (err) {
      lastErr = err
      if (err instanceof ZodError || err instanceof LlmOutputError) {
        logger.emit('retry', {
          episode: episodeId,
          stage: `lens:${lens}`,
          attempt: attempt + 1,
          reason: err instanceof ZodError ? 'schema' : 'llm_output',
        }, 'warn')
        continue
      }
      throw err
    }
  }
  throw lastErr
}

/**
 * 6 個 lens 同時最多打幾個 LLM 請求。與 deep-pipeline.ts 的 EPISODE_CONCURRENCY（=3）
 * 相乘就是這支腳本的尖峰並行（見 src/cli/lib/prompt-research-distill-estimate.ts）。
 */
export const LENS_CONCURRENCY = 3

export async function runAllLenses(
  transcript: string,
  episodeId: string,
  logger: Logger,
  vars: DeepPipelinePromptVars,
): Promise<AllLensesOutput> {
  const results = await pMap(
    LENS_ORDER,
    LENS_CONCURRENCY,
    async lens => [lens, await runLens(lens, transcript, episodeId, logger, vars)] as const,
  )
  return Object.fromEntries(results) as AllLensesOutput
}
