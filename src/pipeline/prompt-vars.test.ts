import { describe, expect, it } from 'vitest'
import { TEST_YT_VARS } from '../__fixtures__/forbidden-phrases.js'

describe('yT_PROMPT_VARS', () => {
  it('declares sourceKindLabel as "YouTube" (platform-only, episode-type suffix supplied by episodeWord)', () => {
    // 此值為「平台名」、不含 episode-type 後綴。原 yt prompts 中 segmenter 用
    // 「YouTube 直播」、consolidator 用「YouTube」、為求 byte-for-byte 保留兩處字面、
    // sourceKindLabel 設成 'YouTube'、segmenter 模板額外串上 episodeWord。
    expect(TEST_YT_VARS.sourceKindLabel).toBe('YouTube')
  })

  it('declares episodeWord as "直播"', () => {
    expect(TEST_YT_VARS.episodeWord).toBe('直播')
  })

  it('declares digestTitlePrefix as "YT Analyst Digest"', () => {
    expect(TEST_YT_VARS.digestTitlePrefix).toBe('YT Analyst Digest')
  })
})
