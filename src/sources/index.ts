import type { TranscriptInput } from '../pipeline/deep-pipeline.js'
import type { Digest, SourceSpec } from '../types.js'
import type { VideoRef } from './yt-transcript/index.js'
import { distillCustomToDigest } from '../distillers/custom-to-digest.js'
import { distillSkillToDigest } from '../distillers/skill-to-digest.js'
import { runDeepPipeline } from '../pipeline/deep-pipeline.js'
import { YT_PROMPT_VARS } from '../pipeline/prompt-vars.js'
import {
  CustomSourceConfigSchema,
  SkillSourceConfigSchema,
  YtSourceConfigSchema,
} from '../types.js'
import { readCustomText } from './custom-text.js'
import { pMap } from './dispatch-helpers.js'
import { fetchSkillMarkdown } from './skill-markdown.js'
import {
  applySelectionFlags,
  extractVideoId,
  fetchStreamsPage,
  fetchTranscript,
  fetchVideoRef,
  parseStreamsHtml,
} from './yt-transcript/index.js'

/** 每次 distill 都要的領域約束；禁用語來自 suanomics 目標 prompt 規格檔。 */
export interface DistillContext {
  forbiddenPhrases: readonly string[]
}

async function dispatchSkill(spec: SourceSpec, ctx: DistillContext): Promise<Digest> {
  const cfg = SkillSourceConfigSchema.parse(spec.config)
  const fetched = await fetchSkillMarkdown(cfg)
  return distillSkillToDigest({
    sourceSlug: spec.slug,
    sourceKind: 'skill-markdown',
    rawContent: fetched.content,
    rawSourceRef: { url: fetched.url },
    forbiddenPhrases: ctx.forbiddenPhrases,
  })
}

async function dispatchCustom(spec: SourceSpec, ctx: DistillContext): Promise<Digest> {
  const cfg = CustomSourceConfigSchema.parse(spec.config)
  const r = readCustomText(cfg)
  return distillCustomToDigest({
    sourceSlug: spec.slug,
    rawContent: r.content,
    localPath: r.localPath,
    forbiddenPhrases: ctx.forbiddenPhrases,
  })
}

async function toTranscriptInput(v: VideoRef): Promise<TranscriptInput> {
  const t = await fetchTranscript(v.videoId)
  return {
    episodeId: v.videoId,
    title: v.title,
    url: v.url,
    publishedAt: v.publishedAt,
    durationSec: v.durationSec,
    transcriptText: t.text,
  }
}

// 指定影片時沒有直播頁的 metadata：片長取最後一段字幕的時間，標題與發布時間讀 watch 頁。
async function videoInputFromUrl(url: string): Promise<TranscriptInput> {
  const videoId = extractVideoId(url)
  if (!videoId)
    throw new Error(`不是可辨識的 YouTube 影片網址：${url}`)
  const t = await fetchTranscript(videoId)
  const durationSec = t.segments.at(-1)?.offsetSec ?? 0
  const ref = await fetchVideoRef(videoId, durationSec, new Date().toISOString())
  return {
    episodeId: videoId,
    title: ref.title,
    url: ref.url,
    publishedAt: ref.publishedAt,
    durationSec,
    transcriptText: t.text,
  }
}

async function dispatchYt(spec: SourceSpec, runDir: string, ctx: DistillContext): Promise<Digest> {
  const cfg = YtSourceConfigSchema.parse(spec.config)
  // fetchTranscript 限 concurrency 3 避免 rate limit；LLM stage 的 concurrency 由 runDeepPipeline 處理。
  let inputs: TranscriptInput[]
  if (cfg.videoUrls) {
    inputs = await pMap(cfg.videoUrls, 3, videoInputFromUrl)
  }
  else {
    const html = await fetchStreamsPage(cfg.playlistUrl ?? '')
    const videos = applySelectionFlags(parseStreamsHtml(html), { count: cfg.count })
    inputs = await pMap(videos, 3, toTranscriptInput)
  }
  return runDeepPipeline(inputs, spec, runDir, { ...YT_PROMPT_VARS, forbiddenPhrases: ctx.forbiddenPhrases })
}

export async function dispatchSource(spec: SourceSpec, runDir: string, ctx: DistillContext): Promise<Digest> {
  if (spec.kind === 'yt-transcript' && spec.pipeline !== 'deep')
    throw new Error('deep pipeline required for yt-transcript')
  if (spec.kind === 'skill-markdown')
    return dispatchSkill(spec, ctx)
  if (spec.kind === 'custom-text')
    return dispatchCustom(spec, ctx)
  if (spec.kind === 'yt-transcript')
    return dispatchYt(spec, runDir, ctx)
  throw new Error(`unknown source kind: ${String(spec.kind)}`)
}
