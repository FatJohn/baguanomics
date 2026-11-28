import type { DeepPipelinePromptVars } from '../../pipeline/prompt-vars.js'
import type { Logger } from './logger.js'
import type { EpisodeL3 } from './schemas.js'
import { callStructured, LlmOutputError } from '../../llm.js'
import { containsTickerDirection } from '../../vendor/compliance.js'
import { buildConsolidatorRevisionUserPrompt, buildConsolidatorSystemPrompt } from './prompts.js'
import { ConsolidatorResponse } from './response-schemas.js'

const TIMEOUT_MS = 300_000
// prompt 要求至少一萬中文字；加上 adaptive thinking，16000 的預設上限會截斷。
const MAX_OUTPUT_TOKENS = 32_000
// 3 = initial + 2 retries
export const CONSOLIDATOR_MAX_ATTEMPTS = 3

interface Violation { reason: string, feedback: string[] }

function scan(text: string, forbiddenPhrases: readonly string[]): Violation | null {
  const hitPhrases = forbiddenPhrases.filter(p => text.includes(p))
  if (hitPhrases.length > 0)
    return { reason: `forbidden:${hitPhrases[0]}`, feedback: hitPhrases.map(p => `「${p}」`) }

  const tickerDirection = containsTickerDirection(text)
  if (tickerDirection.hit) {
    const target = tickerDirection.ticker ?? tickerDirection.company ?? 'unknown'
    const verb = tickerDirection.verb ?? 'unknown'
    return {
      reason: `ticker_direction:${target}+${verb}`,
      feedback: [`個股「${target}」與方向詞「${verb}」相鄰：「${tickerDirection.snippet ?? ''}」`],
    }
  }

  return null
}

class ComplianceError extends Error {
  constructor(readonly violation: Violation, readonly draft: string) {
    super(`compliance:${violation.reason}`)
  }
}

export async function runConsolidator(
  episodes: readonly EpisodeL3[],
  runId: string,
  logger: Logger,
  vars: DeepPipelinePromptVars,
): Promise<string> {
  const input = JSON.stringify({ runId, episodes }, null, 2)
  let lastErr: unknown = new Error('consolidator failed after retries')
  // 盲重試重寫一萬字、每次命中不同禁用語而不收斂（#2）；改成帶命中清單改寫上一版。
  let revision: { draft: string, hits: string[] } | null = null

  for (let attempt = 0; attempt < CONSOLIDATOR_MAX_ATTEMPTS; attempt++) {
    try {
      const { markdown } = await callStructured({
        stage: 'consolidator',
        system: buildConsolidatorSystemPrompt(vars),
        user: revision ? buildConsolidatorRevisionUserPrompt(revision.draft, revision.hits) : input,
        schema: ConsolidatorResponse,
        timeoutMs: TIMEOUT_MS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
      if (!markdown)
        throw new Error('empty response')
      const violation = scan(markdown, vars.forbiddenPhrases)
      if (violation)
        throw new ComplianceError(violation, markdown)

      logger.emit('consolidator.done', { runId, chars: markdown.length })
      return markdown
    }
    catch (err) {
      lastErr = err
      if (err instanceof ComplianceError) {
        const earlier: string[] = revision?.hits.filter(h => !err.violation.feedback.includes(h)) ?? []
        revision = { draft: err.draft, hits: [...err.violation.feedback, ...earlier] }
      }
      const retryable = err instanceof LlmOutputError
        || err instanceof ComplianceError
        || (err instanceof Error && err.message === 'empty response')
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
