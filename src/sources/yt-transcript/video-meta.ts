import type { VideoRef } from './playlist-resolver.js'

/**
 * 單支影片的標題與發布時間：讀 watch 頁的 og:title 與 itemprop datePublished。
 * 讀不到時標題退回 videoId、發布時間退回 fallbackPublishedAt，不讓 metadata 擋住整條 distill。
 */
export function parseWatchPageMeta(html: string): { title?: string, publishedAt?: string } {
  const title = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]
  const date = html.match(/<meta itemprop="datePublished" content="([^"]*)"/)?.[1]
  const published = date ? new Date(date) : undefined
  return {
    ...(title ? { title: decodeEntities(title) } : {}),
    ...(published && !Number.isNaN(published.getTime()) ? { publishedAt: published.toISOString() } : {}),
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export async function fetchVideoRef(
  videoId: string,
  durationSec: number,
  fallbackPublishedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoRef> {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  let meta: { title?: string, publishedAt?: string } = {}
  try {
    const res = await fetchImpl(url, { headers: { 'accept-language': 'zh-TW' }, signal: AbortSignal.timeout(15_000) })
    if (res.ok)
      meta = parseWatchPageMeta(await res.text())
  }
  catch {
    // metadata 只用於報告標示，抓不到不中斷
  }
  return {
    videoId,
    title: meta.title ?? videoId,
    url,
    publishedAt: meta.publishedAt ?? fallbackPublishedAt,
    durationSec,
  }
}
