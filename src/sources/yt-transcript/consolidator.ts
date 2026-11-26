import type { DeepPipelinePromptVars } from '../../pipeline/prompt-vars.js'
import type { Logger } from './logger.js'
import type { EpisodeL3 } from './schemas.js'
import { callStructured, LlmOutputError } from '../../llm.js'
import { containsForbiddenPhrase, containsTickerDirection } from '../../vendor/compliance.js'
import { buildConsolidatorSystemPrompt } from './prompts.js'
import { ConsolidatorResponse } from './response-schemas.js'

const TIMEOUT_MS = 300_000
// prompt 要求至少一萬中文字；加上 adaptive thinking，16000 的預設上限會截斷。
const MAX_OUTPUT_TOKENS = 32_000
// 3 = initial + 2 retries
export const CONSOLIDATOR_MAX_ATTEMPTS = 3

function scan(text: string, forbiddenPhrases: readonly string[]): string | null {
  const forbidden = containsForbiddenPhrase(text, forbiddenPhrases)
  if (forbidden.hit)
    return `forbidden:${forbidden.phrase ?? 'unknown'}`

  const tickerDirection = containsTickerDirection(text)
  if (tickerDirection.hit)
    return `ticker_direction:${tickerDirection.ticker ?? tickerDirection.company ?? 'unknown'}+${tickerDirection.verb ?? 'unknown'}`

  return null
}

export async function runConsolidator(
  episodes: readonly EpisodeL3[],
  runId: string,
  logger: Logger,
  vars: DeepPipelinePromptVars,
): Promise<string> {
  const input = JSON.stringify({ runId, episodes }, null, 2)
  let lastErr: unknown = new Error('consolidator failed after retries')

  for (let attempt = 0; attempt < CONSOLIDATOR_MAX_ATTEMPTS; attempt++) {
    try {
      const { markdown } = await callStructured({
        stage: 'consolidator',
        system: buildConsolidatorSystemPrompt(vars),
        user: input,
        schema: ConsolidatorResponse,
        timeoutMs: TIMEOUT_MS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
      if (!markdown)
        throw new Error('empty response')
      const violation = scan(markdown, vars.forbiddenPhrases)
      if (violation)
        throw new Error(`compliance:${violation}`)

      logger.emit('consolidator.done', { runId, chars: markdown.length })
      return markdown
    }
    catch (err) {
      lastErr = err
      const retryable = err instanceof LlmOutputError
        || (err instanceof Error && (err.message.startsWith('compliance:') || err.message === 'empty response'))
      if (retryable) {
        logger.emit('retry', {
          stage: 'consolidator',
          runId,
          attempt: attempt + 1,
          reason: err.message,
        }, 'warn')
        continue
      }
      throw err
    }
  }

  throw lastErr
}
