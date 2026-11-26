import type { DeepPipelinePromptVars } from '../../pipeline/prompt-vars.js'
import type { Logger } from './logger.js'
import type { SegmenterOutput } from './schemas.js'
import { ZodError } from 'zod'
import { callStructured, LlmOutputError } from '../../llm.js'
import { buildSegmenterSystemPrompt } from './prompts.js'
import { SegmenterResponse } from './response-schemas.js'
import { SegmenterOutputSchema } from './schemas.js'

const TIMEOUT_MS = 120_000
export const SEGMENTER_MAX_ATTEMPTS = 2

export async function runSegmenter(
  transcript: string,
  episodeId: string,
  logger: Logger,
  vars: DeepPipelinePromptVars,
): Promise<SegmenterOutput> {
  let lastErr: unknown = new Error('segmenter failed after retries')
  for (let attempt = 0; attempt < SEGMENTER_MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callStructured({
        stage: 'segmenter',
        system: buildSegmenterSystemPrompt(vars),
        user: `episodeId: ${episodeId}\n\n---\n\n${transcript}`,
        schema: SegmenterResponse,
        timeoutMs: TIMEOUT_MS,
      })
      const parsed = SegmenterOutputSchema.parse(raw)
      logger.emit('segmenter.done', {
        episode: episodeId,
        segments: parsed.segments.length,
        dropped_min: Object.values(parsed.droppedMinutes).reduce((a, b) => a + b, 0),
      })
      return parsed
    }
    catch (err) {
      lastErr = err
      if (err instanceof ZodError || err instanceof LlmOutputError) {
        logger.emit('retry', {
          episode: episodeId,
          stage: 'segmenter',
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
