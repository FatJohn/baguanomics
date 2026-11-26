import { z } from 'zod'

// 傳給 Output.object 的 Digest 回應形狀；id、sourceSlug、generatedAt 等由程式補上，不讓模型產生。
export const DigestResponseSchema = z.object({
  analystFrames: z.array(z.object({
    name: z.string(),
    description: z.string(),
    whenToApply: z.string(),
    questions: z.array(z.string()),
  })),
  analysisChecks: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    inputsNeeded: z.array(z.string()),
  })),
  vocabulary: z.array(z.object({
    preferred: z.string(),
    avoid: z.array(z.string()),
    reason: z.string(),
  })),
  compliance: z.object({
    redFlags: z.array(z.string()),
    suggestedDisclaimer: z.string().nullable(),
  }),
})
export type DigestResponse = z.infer<typeof DigestResponseSchema>
