import type { Digest, SourceKind } from '../types.js'
import type { DigestResponse } from './digest-response-schema.js'
import { ZodError } from 'zod'
import { callStructured, LlmOutputError } from '../llm.js'
import { DigestSchema } from '../types.js'
import { DigestResponseSchema } from './digest-response-schema.js'
import { hashFrameId, hashRedFlagId, hashVocabId } from './id-utils.js'

/** 模型輸出不符 schema 時的總嘗試次數；網路與 429 由 SDK 的 maxRetries 處理，不在這層重試。 */
export const DISTILL_MAX_ATTEMPTS = 3

export interface DigestMeta {
  sourceSlug: string
  sourceKind: SourceKind
  rawSourceRef: Digest['rawSourceRef']
}

// id 不讓 LLM 產生（不穩定），parse 後以內容雜湊補上。
export function toDigest(res: DigestResponse, meta: DigestMeta): Digest {
  return DigestSchema.parse({
    sourceSlug: meta.sourceSlug,
    sourceKind: meta.sourceKind,
    generatedAt: new Date().toISOString(),
    rawSourceRef: meta.rawSourceRef,
    analystFrames: res.analystFrames.map(f => ({ ...f, id: hashFrameId(f.name, f.whenToApply) })),
    analysisChecks: res.analysisChecks,
    vocabulary: res.vocabulary.map(v => ({ ...v, id: hashVocabId(v.preferred) })),
    compliance: {
      redFlags: res.compliance.redFlags.map(rule => ({ id: hashRedFlagId(rule), rule })),
      suggestedDisclaimer: res.compliance.suggestedDisclaimer,
    },
  })
}

export async function distillToDigest(stage: string, system: string, user: string, meta: DigestMeta): Promise<Digest> {
  let lastErr: unknown = new Error(`${stage} failed after retries`)
  for (let attempt = 0; attempt < DISTILL_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await callStructured({ stage, system, user, schema: DigestResponseSchema })
      return toDigest(res, meta)
    }
    catch (err) {
      lastErr = err
      if (err instanceof LlmOutputError || err instanceof ZodError)
        continue
      throw err
    }
  }
  throw lastErr
}
