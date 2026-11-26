import { describe, expect, it } from 'vitest'
import { parsePromptSpec } from './parse-spec.js'

const FENCE = '`````'

function spec(body: string): string {
  return ['# x', '', '- agent: `analyst-tier1`', '- frame-style: `analyst`', '', body].join('\n')
}

describe('parsePromptSpec', () => {
  it('讀出 agent、frame-style、多個 prompt 全文、禁用語與贅詞', () => {
    const md = spec([
      '## 現行 prompt',
      '',
      '### `A_SYSTEM`',
      '',
      `${FENCE}text`,
      '第一行',
      '```json',
      '{}',
      '```',
      FENCE,
      '',
      '### `B_SYSTEM`',
      '',
      `${FENCE}text`,
      '乙',
      FENCE,
      '',
      '## 合規',
      '',
      '### 禁用語',
      '',
      '- 建議買',
      '- 保證獲利',
      '',
      '### 抽象評價贅詞',
      '',
      '- 值得關注',
    ].join('\n'))
    const parsed = parsePromptSpec(md)
    expect(parsed.agent).toBe('analyst-tier1')
    expect(parsed.frameStyle).toBe('analyst')
    expect(parsed.prompts).toEqual([
      { name: 'A_SYSTEM', text: '第一行\n```json\n{}\n```' },
      { name: 'B_SYSTEM', text: '乙' },
    ])
    expect(parsed.forbiddenPhrases).toEqual(['建議買', '保證獲利'])
    expect(parsed.garnishTerms).toEqual(['值得關注'])
  })

  it('cRLF 換行也讀得出', () => {
    const md = spec(['## 現行 prompt', '', '### `A`', `${FENCE}text`, '甲', FENCE].join('\n')).replace(/\n/g, '\r\n')
    expect(parsePromptSpec(md).prompts).toEqual([{ name: 'A', text: '甲' }])
  })

  it('現行 prompt 段沒有 prompt 時回空陣列（例如尚未移植的 agent）', () => {
    expect(parsePromptSpec(spec('## 現行 prompt\n\n尚未移植。')).prompts).toEqual([])
  })

  it('缺 agent 行時丟錯', () => {
    expect(() => parsePromptSpec('- frame-style: `none`\n\n## 現行 prompt', 'f.md')).toThrow('f.md: 找不到 `- agent:')
  })

  it('frame-style 不在清單內時丟錯', () => {
    expect(() => parsePromptSpec('- agent: `a`\n- frame-style: `weird`\n\n## 現行 prompt')).toThrow(/frame-style 要是/)
  })

  it('缺「## 現行 prompt」段時丟錯', () => {
    expect(() => parsePromptSpec(spec('## 別的'))).toThrow(/找不到「## 現行 prompt」段/)
  })

  it('prompt 標題後面不是五個以上反引號的 text fence 時丟錯', () => {
    expect(() => parsePromptSpec(spec('## 現行 prompt\n\n### `A`\n\n```text\n甲\n```'))).toThrow(/至少五個反引號/)
  })

  it('fence 沒收尾時丟錯', () => {
    expect(() => parsePromptSpec(spec(`## 現行 prompt\n\n### \`A\`\n\n${FENCE}text\n甲`))).toThrow(/沒有收尾/)
  })
})
