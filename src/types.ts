import { z } from 'zod'

export const SourceKindSchema = z.enum(['yt-transcript', 'skill-markdown', 'custom-text'])
export type SourceKind = z.infer<typeof SourceKindSchema>

// 搬自 suanomics v0 packages/jobs/src/types.ts（原本是 job queue payload 的一部分）。
export const SourceSpecSchema = z.object({
  kind: SourceKindSchema,
  slug: z.string().min(1),
  displayName: z.string().min(1),
  pipeline: z.enum(['light', 'deep']).default('light'),
  config: z.record(z.string(), z.unknown()),
})
export type SourceSpec = z.infer<typeof SourceSpecSchema>

// knip-ignore -- public API surface for source plugin authors (pipeline config types)
export const PipelineKindSchema = z.enum(['deep', 'light'])
// knip-ignore -- public API type for plugin authors
export type PipelineKind = z.infer<typeof PipelineKindSchema>

// playlistUrl 取頻道直播頁最新 count 集；videoUrls 直接指定影片（任一必填）。
export const YtSourceConfigSchema = z.object({
  playlistUrl: z.string().url().optional(),
  videoUrls: z.array(z.string().url()).min(1).optional(),
  count: z.number().int().positive().default(5),
}).refine(c => (c.playlistUrl === undefined) !== (c.videoUrls === undefined), {
  message: 'yt-transcript 的 config 要恰好提供 playlistUrl 或 videoUrls 其中一個',
})
// knip-ignore -- public API type for source config authors
export type YtSourceConfig = z.infer<typeof YtSourceConfigSchema>

export const SkillSourceConfigSchema = z.object({
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  skillPath: z.string().min(1),
  ref: z.string().default('main'),
})
// knip-ignore -- public API type for source config authors
export type SkillSourceConfig = z.infer<typeof SkillSourceConfigSchema>

export const CustomSourceConfigSchema = z.object({
  filePath: z.string().min(1),
})
// knip-ignore -- public API type for source config authors
export type CustomSourceConfig = z.infer<typeof CustomSourceConfigSchema>

// --- Digest ---

const AnalystFrameSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  whenToApply: z.string().min(1),
  questions: z.array(z.string().min(1)).min(1),
})

const AnalysisCheckSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  inputsNeeded: z.array(z.string()),
})

const VocabularyItemSchema = z.object({
  id: z.string().min(1),
  preferred: z.string().min(1),
  avoid: z.array(z.string()),
  reason: z.string(),
})

const RedFlagItemSchema = z.object({
  id: z.string().min(1),
  rule: z.string().min(1),
})

const ComplianceSchema = z.object({
  redFlags: z.array(RedFlagItemSchema).default([]),
  suggestedDisclaimer: z.string().nullish().transform(v => v ?? undefined),
})

const RawSourceRefSchema = z.object({
  url: z.string().url().nullish().transform(v => v ?? undefined).optional(),
  localPath: z.string().nullish().transform(v => v ?? undefined).optional(),
  commitSha: z.string().nullish().transform(v => v ?? undefined).optional(),
})

export const DigestSchema = z.object({
  sourceSlug: z.string().min(1),
  sourceKind: SourceKindSchema,
  generatedAt: z.string().datetime(),
  analystFrames: z.array(AnalystFrameSchema).min(1),
  analysisChecks: z.array(AnalysisCheckSchema).default([]),
  vocabulary: z.array(VocabularyItemSchema).default([]),
  compliance: ComplianceSchema.optional(),
  rawSourceRef: RawSourceRefSchema,
})
export type Digest = z.infer<typeof DigestSchema>
export type AnalystFrame = z.infer<typeof AnalystFrameSchema>
// knip-ignore -- public API type used by merger and compiler consumers
export type VocabularyItem = z.infer<typeof VocabularyItemSchema>
// knip-ignore -- public API type used by compiler compliance consumers
export type RedFlagItem = z.infer<typeof RedFlagItemSchema>

// --- MergedDraft ---

const FrameItemSchema = z.object({
  id: z.string().min(1),
  sourceSlug: z.string(),
  frame: AnalystFrameSchema,
})

const VocabItemSchema = z.object({
  id: z.string().min(1),
  sourceSlug: z.string(),
  entry: VocabularyItemSchema,
})

const RedFlagDraftItemSchema = z.object({
  id: z.string().min(1),
  sourceSlug: z.string(),
  entry: z.object({
    id: z.string().min(1),
    rule: z.string(),
  }),
})

export const MergedDraftSchema = z.object({
  generatedAt: z.string().datetime(),
  sources: z.array(SourceSpecSchema),
  frames: z.array(z.object({
    groupKey: z.string(),
    items: z.array(FrameItemSchema).min(1),
  })),
  vocabulary: z.array(VocabItemSchema),
  redFlags: z.array(RedFlagDraftItemSchema),
  rawSourceRefs: z.array(z.object({
    sourceSlug: z.string(),
    ref: z.object({
      url: z.string().optional(),
      localPath: z.string().optional(),
      commitSha: z.string().optional(),
    }),
  })),
})
export type MergedDraft = z.infer<typeof MergedDraftSchema>
