import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadSpecs, unionForbiddenPhrases } from './load-specs.js'

const SPECS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/specs')

describe('loadSpecs', () => {
  it('依檔名排序讀目錄內所有規格檔，帶上路徑', async () => {
    const specs = await loadSpecs(SPECS_DIR)
    expect(specs.map(s => s.agent)).toEqual(['analyst-tier1', 'news-classifier', 'podcast-writer', 'synthesizer'])
    expect(specs[0]?.path).toBe(join(SPECS_DIR, 'analyst-tier1.md'))
  })

  it('略過 README.md；沒有規格檔時丟錯', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'load-specs-'))
    try {
      writeFileSync(join(dir, 'README.md'), '# 說明', 'utf8')
      await expect(loadSpecs(dir)).rejects.toThrow(/沒有規格檔/)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('unionForbiddenPhrases', () => {
  it('取各規格檔禁用語的聯集', async () => {
    expect(unionForbiddenPhrases(await loadSpecs(SPECS_DIR)).sort()).toEqual(['保證獲利', '建議買', '建議賣'].sort())
  })

  it('全部規格檔都沒有禁用語時拒絕', () => {
    expect(() => unionForbiddenPhrases([{ agent: 'a', frameStyle: 'none', prompts: [], forbiddenPhrases: [], garnishTerms: [] }])).toThrow(/沒有任何禁用語/)
  })
})
