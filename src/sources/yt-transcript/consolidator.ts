import type { DeepPipelinePromptVars } from '../../pipeline/prompt-vars.js'
import type { Logger } from './logger.js'
import type { EpisodeL3 } from './schemas.js'
import { callStructured, LlmOutputError } from '../../llm.js'
import { findTickerDirections } from '../../vendor/compliance.js'
import { buildConsolidatorRevisionUserPrompt, buildConsolidatorSystemPrompt } from './prompts.js'
import { ConsolidatorResponse } from './response-schemas.js'

const TIMEOUT_MS = 300_000
// prompt 要求至少一萬中文字；加上 adaptive thinking，16000 的預設上限會截斷。
const MAX_OUTPUT_TOKENS = 32_000
// 3 = initial + 2 retries
export const CONSOLIDATOR_MAX_ATTEMPTS = 3

interface Hit { key: string, kind: 'phrase' | 'ticker', text: string }
interface Violation { reason: string, hits: Hit[] }

function allTickerDirections(text: string): Hit[] {
  const hits: Hit[] = []
  for (const found of findTickerDirections(text)) {
    const target = found.ticker ?? found.company ?? 'unknown'
    const verb = found.verb ?? 'unknown'
    const key = `ticker_direction:${target}+${verb}`
    if (!hits.some(h => h.key === key))
      hits.push({ key, kind: 'ticker', text: `個股「${target}」與方向詞「${verb}」：「${(found.snippet ?? '').replace(/\s+/g, ' ')}」` })
  }
  return hits
}

function scan(text: string, forbiddenPhrases: readonly string[]): Violation | null {
  const hits: Hit[] = [
    ...forbiddenPhrases.filter(p => text.includes(p)).map(p => ({ key: `forbidden:${p}`, kind: 'phrase' as const, text: `「${p}」` })),
    ...allTickerDirections(text),
  ]
  const first = hits[0]
  return first ? { reason: first.key, hits } : null
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
  // 整份重寫一萬字每次會撞到不同禁用語、重試不收斂；只改寫上一版命中的句子才收斂。
  let revision: { draft: string, hits: Hit[] } | null = null

  for (let attempt = 0; attempt < CONSOLIDATOR_MAX_ATTEMPTS; attempt++) {
    try {
      const { markdown } = await callStructured({
        stage: 'consolidator',
        system: buildConsolidatorSystemPrompt(vars),
        user: revision
          ? buildConsolidatorRevisionUserPrompt(
              revision.draft,
              revision.hits.filter(h => h.kind === 'phrase').map(h => h.text),
              revision.hits.filter(h => h.kind === 'ticker').map(h => h.text),
            )
          : input,
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
        const current = err.violation.hits
        const earlier: Hit[] = revision?.hits.filter(h => !current.some(c => c.key === h.key)) ?? []
        revision = { draft: err.draft, hits: [...current, ...earlier] }
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
