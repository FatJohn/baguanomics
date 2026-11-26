import { describe, expect, it, vi } from 'vitest'
import { fetchVideoRef, parseWatchPageMeta } from './video-meta.js'

describe('parseWatchPageMeta', () => {
  it('reads og:title and datePublished', () => {
    const html = '<meta property="og:title" content="盤前解析 &amp; 利率"><meta itemprop="datePublished" content="2026-11-20T00:30:00-08:00">'
    expect(parseWatchPageMeta(html)).toEqual({ title: '盤前解析 & 利率', publishedAt: '2026-11-20T08:30:00.000Z' })
  })

  it('returns empty when tags are missing or date is invalid', () => {
    expect(parseWatchPageMeta('<meta itemprop="datePublished" content="not-a-date">')).toEqual({})
  })
})

describe('fetchVideoRef', () => {
  it('falls back to videoId and the given time when the page fetch fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const ref = await fetchVideoRef('abc12345678', 600, '2026-11-26T00:00:00.000Z', fetchImpl)
    expect(ref).toEqual({
      videoId: 'abc12345678',
      title: 'abc12345678',
      url: 'https://www.youtube.com/watch?v=abc12345678',
      publishedAt: '2026-11-26T00:00:00.000Z',
      durationSec: 600,
    })
  })
})
