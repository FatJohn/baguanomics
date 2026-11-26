import type { TranscriptSegment } from 'youtube-transcript-plus'
import { YoutubeTranscript } from 'youtube-transcript-plus'

// 合併自 suanomics v0 的兩份 fetcher：packages/prompt-research 的 transcript-fetcher.ts
// （帶時間戳、餵 deep pipeline）與 apps/server/src/transcript/youtube.ts（網址解析、語系
// fallback、錯誤分類）。

// 11 個字元的 YouTube video id：英數 + _ + -
const VIDEO_ID_PATTERN = /^[\w-]{11}$/

export function extractVideoId(url: string): string | null {
  if (!url)
    return null
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()

  if (host === 'youtu.be') {
    const id = parsed.pathname.replace(/^\//, '')
    return VIDEO_ID_PATTERN.test(id) ? id : null
  }

  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v') ?? ''
      return VIDEO_ID_PATTERN.test(id) ? id : null
    }
    // /shorts/{id} or /live/{id}（直播存檔）
    const pathMatch = parsed.pathname.match(/^\/(?:shorts|live)\/([\w-]+)/)
    if (pathMatch) {
      const id = pathMatch[1] ?? ''
      return VIDEO_ID_PATTERN.test(id) ? id : null
    }
  }

  return null
}

export type YoutubeErrorReason = 'no_transcript' | 'not_found' | 'fetch_failed'

export class YoutubeError extends Error {
  public readonly reason: YoutubeErrorReason

  constructor(reason: YoutubeErrorReason, message: string) {
    super(message)
    this.name = 'YoutubeError'
    this.reason = reason
  }
}

interface RenderedSegment { offsetSec: number, text: string }

export interface FetchedTranscript {
  videoId: string
  text: string
  chars: number
  segments: RenderedSegment[]
  language: string
}

// 語系優先：zh-TW → zh-CN → en。套件抓不到指定語系字幕會 throw；三者皆無時以最後一個 error 分類。
const LANGUAGE_PRIORITY = ['zh-TW', 'zh-CN', 'en'] as const

// 透過 error message 字串分類，兼容 youtube-transcript 和 youtube-transcript-plus 的錯誤類別。
function classifyError(err: unknown): YoutubeErrorReason {
  const msg = err instanceof Error ? err.message : String(err)
  if (/Transcripts? (?:is|are) disabled|No transcripts? are available|transcript.*not.*available/i.test(msg))
    return 'no_transcript'
  if (/Video unavailable|video not found|is no longer available|Invalid YouTube video ID/i.test(msg))
    return 'not_found'
  return 'fetch_failed'
}

// youtube-transcript-plus v2 回傳的 TranscriptSegment.offset 單位已是「秒」，
// 非舊版 v1 的 milliseconds，請勿再除 1000。
function render(items: TranscriptSegment[]): RenderedSegment[] {
  return items
    .map<RenderedSegment>(it => ({ offsetSec: Math.floor(it.offset), text: it.text.trim() }))
    .filter(s => s.text.length > 0)
}

export async function fetchTranscript(videoId: string): Promise<FetchedTranscript> {
  let lastError: unknown = null
  for (const lang of LANGUAGE_PRIORITY) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(videoId, { lang })
      const segments = render(items)
      // 某些影片 captionTracks 存在但內容為空，視同沒有字幕。
      if (segments.length === 0)
        throw new Error('No transcripts are available')
      const text = segments.map(s => `[${formatTimestamp(s.offsetSec)}] ${s.text}`).join('\n')
      return { videoId, text, chars: text.length, segments, language: items[0]?.lang ?? lang }
    }
    catch (err) {
      lastError = err
      // 影片不存在或 id 無效時試其他語系是浪費，且後續 error 可能誤分類。
      if (classifyError(err) === 'not_found')
        break
    }
  }
  const msg = lastError instanceof Error ? lastError.message : 'unknown'
  throw new YoutubeError(classifyError(lastError), `fetchTranscript failed: ${msg}`)
}

function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
