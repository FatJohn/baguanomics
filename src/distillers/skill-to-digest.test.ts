import { describe, expect, it } from 'vitest'
import { FIXTURE_FORBIDDEN_PHRASES } from '../__fixtures__/forbidden-phrases.js'
import { buildSkillDistillSystemPrompt } from './skill-to-digest.js'

describe('buildSkillDistillSystemPrompt', () => {
  it('includes the phrase "分析框架提煉器"', () => {
    const p = buildSkillDistillSystemPrompt(FIXTURE_FORBIDDEN_PHRASES)
    expect(p).toContain('分析框架提煉器')
  })

  it('禁用詞清單來自傳入的參數，不寫死', () => {
    const p = buildSkillDistillSystemPrompt(['測試禁語甲', '測試禁語乙'])
    expect(p).toContain('禁用詞（輸出絕不可沿用）：「測試禁語甲」、「測試禁語乙」')
    expect(p).not.toContain('「建議買」')
  })

  it('instructs frames are per-news-event, not per-company', () => {
    const p = buildSkillDistillSystemPrompt(FIXTURE_FORBIDDEN_PHRASES)
    expect(p).toContain('新聞事件')
  })
})
