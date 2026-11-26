import type { LensName } from './prompts.js'
import { z } from 'zod'

// 傳給 Output.object 的回應形狀。刻意不放長度、數量與數值範圍：SDK 端用這份嚴格驗證，
// 超限就整筆丟失；限制留給 schemas.ts 的領域 schema，違反時由各 stage 的重試迴圈處理，
// 例外是 lens 的條數：超出上限由 lens-extractors.ts 截斷，不重試。

const segmentRef = z.object({ startSec: z.number().int(), endSec: z.number().int() })

export const SegmenterResponse = z.object({
  episodeId: z.string(),
  durationSec: z.number().int(),
  segments: z.array(z.object({
    startSec: z.number().int(),
    endSec: z.number().int(),
    topic: z.enum(['market', 'macro_event', 'joke', 'ad', 'chitchat', 'other']),
    headline: z.string(),
    relevance: z.number(),
  })),
  keptTopics: z.array(z.enum(['market', 'macro_event', 'joke', 'ad', 'chitchat', 'other'])),
  droppedMinutes: z.object({ joke: z.number(), ad: z.number(), chitchat: z.number(), other: z.number() }),
})

export const LENS_RESPONSE_SCHEMAS: Record<LensName, z.ZodType> = {
  events: z.object({
    episodeId: z.string(),
    events: z.array(z.object({ title: z.string(), date: z.string().nullable(), description: z.string(), segmentRef })),
  }),
  cited_sources: z.object({
    episodeId: z.string(),
    sources: z.array(z.object({
      name: z.string(),
      type: z.enum(['gov', 'academic', 'media', 'corporate', 'market_data', 'other']),
      context: z.string(),
    })),
  }),
  entities: z.object({
    episodeId: z.string(),
    entities: z.array(z.object({
      kind: z.enum(['sector', 'macro_indicator', 'country_region', 'commodity']),
      name: z.string(),
      mentionCount: z.number().int(),
      context: z.string(),
    })),
  }),
  reasoning_chains: z.object({
    episodeId: z.string(),
    chains: z.array(z.object({
      premise: z.string(),
      steps: z.array(z.string()),
      conclusion: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
    })),
  }),
  impacts: z.object({
    episodeId: z.string(),
    impacts: z.array(z.object({
      sector: z.string(),
      direction: z.enum(['positive', 'negative', 'mixed', 'uncertain']),
      timeHorizon: z.enum(['short', 'medium', 'long']),
      reasoning: z.string(),
    })),
  }),
  analyst_frames: z.object({
    episodeId: z.string(),
    frames: z.array(z.object({
      framePattern: z.string(),
      whenApplicable: z.string(),
      exampleQuote: z.string(),
      strength: z.enum(['primary', 'secondary', 'passing']),
    })),
  }),
}

export const ConsolidatorResponse = z.object({ markdown: z.string() })
