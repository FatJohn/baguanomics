import { describe, expect, it } from 'vitest'
import { unifiedDiff } from './line-diff.js'

const labels = { from: 'a', to: 'b' }

describe('unifiedDiff', () => {
  it('內容相同時回空字串', () => {
    expect(unifiedDiff('x\ny', 'x\ny', labels)).toBe('')
  })

  it('尾端新增產生單一 hunk，行號從 1 起算', () => {
    expect(unifiedDiff('a\nb', 'a\nb\nc', labels)).toBe('--- a\n+++ b\n@@ -1,2 +1,3 @@\n a\n b\n+c\n')
  })

  it('中間替換同時有 - 與 +，前後各保留 context 行', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n')
    const after = ['1', '2', '3', '4', 'X', '6', '7', '8', '9'].join('\n')
    expect(unifiedDiff(before, after, labels, 1)).toBe('--- a\n+++ b\n@@ -4,3 +4,3 @@\n 4\n-5\n+X\n 6\n')
  })

  it('相距超過兩倍 context 的變更拆成兩個 hunk', () => {
    const before = Array.from({ length: 20 }, (_, i) => String(i)).join('\n')
    const after = before.replace(/^1$/m, 'A').replace(/^18$/m, 'B')
    const hunks = unifiedDiff(before, after, labels).split('\n').filter(l => l.startsWith('@@'))
    expect(hunks).toEqual(['@@ -1,5 +1,5 @@', '@@ -16,5 +16,5 @@'])
  })
})
