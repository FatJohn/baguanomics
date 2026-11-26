import { describe, expect, it } from 'vitest'
import { FIXTURE_FORBIDDEN_PHRASES } from '../__fixtures__/forbidden-phrases.js'
import { dispatchSource } from './index.js'

const ctx = { forbiddenPhrases: FIXTURE_FORBIDDEN_PHRASES }

describe('dispatchSource', () => {
  it('throws for unknown kind', async () => {
    // eslint-disable-next-line ts/no-explicit-any -- intentionally testing unknown kind at runtime
    const spec = { kind: 'xyz' as any, slug: 's', displayName: 'd', pipeline: 'light' as const, config: {} }
    await expect(dispatchSource(spec, '.', ctx)).rejects.toThrow(/unknown source kind/i)
  })

  it('rejects yt-transcript with light pipeline', async () => {
    const spec = { kind: 'yt-transcript' as const, slug: 's', displayName: 'd', pipeline: 'light' as const, config: { playlistUrl: 'https://youtube.com/a' } }
    await expect(dispatchSource(spec, '.', ctx)).rejects.toThrow(/deep pipeline required for yt-transcript/i)
  })

  it('rejects yt-transcript config with both playlistUrl and videoUrls', async () => {
    const spec = { kind: 'yt-transcript' as const, slug: 's', displayName: 'd', pipeline: 'deep' as const, config: { playlistUrl: 'https://youtube.com/a', videoUrls: ['https://youtu.be/abc12345678'] } }
    await expect(dispatchSource(spec, '.', ctx)).rejects.toThrow(/恰好提供/)
  })

  it('rejects a video url that is not a YouTube video', async () => {
    const spec = { kind: 'yt-transcript' as const, slug: 's', displayName: 'd', pipeline: 'deep' as const, config: { videoUrls: ['https://example.com/watch?v=abc12345678'] } }
    await expect(dispatchSource(spec, '.', ctx)).rejects.toThrow(/不是可辨識的 YouTube 影片網址/)
  })
})
