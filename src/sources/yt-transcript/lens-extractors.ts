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
      const parsed = LENS_SCHEMAS[lens].parse(raw) as LensOutputMap[T]
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
