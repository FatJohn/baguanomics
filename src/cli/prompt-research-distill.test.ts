import type { Digest } from '../types.js'
import type { DistillOpts } from './prompt-research-distill.js'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDistillSpecs } from './prompt-research-distill.js'

// 斷言實際被呼叫的那一層（dispatchSource／mergeDigests），不是只斷言 resolveDistillSpecs 的結果；
// DEFAULT_SOURCES 用真的，「不帶 flag 時跑幾個 source」也是要鎖住的事。

const SPECS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/specs')

const { dispatchSourceMock, mergeDigestsMock } = vi.hoisted(() => ({
  dispatchSourceMock: vi.fn(),
  mergeDigestsMock: vi.fn(),
}))

vi.mock('../sources/index.js', () => ({ dispatchSource: dispatchSourceMock }))
vi.mock('../merger.js', () => ({ mergeDigests: mergeDigestsMock }))

class FakeProcessExit extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

function fakeDigest(slug: string): Digest {
  return {
    sourceSlug: slug,
    sourceKind: 'skill-markdown',
    generatedAt: new Date().toISOString(),
    analystFrames: [{ id: 'frame-1', name: 'n', description: 'd', whenToApply: 'w', questions: ['q'] }],
    analysisChecks: [],
    vocabulary: [],
    rawSourceRef: {},
  }
}

function baseOpts(out: string, over: Partial<DistillOpts> = {}): DistillOpts {
  return { specs: SPECS_DIR, out, dryRun: false, yes: false, ...over }
}

const PLAYLIST = 'https://www.youtube.com/@x/streams'

describe('prompt-research-distill：預算閘門擋在 dispatchSource 之前', () => {
  let outDir: string

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'prd-cli-test-'))
    dispatchSourceMock.mockReset().mockImplementation(async (spec: { slug: string }) => fakeDigest(spec.slug))
    mergeDigestsMock.mockReset().mockReturnValue({ markdown: '# merged', draft: { sources: [] } })
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new FakeProcessExit(code)
    }) as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(outDir, { recursive: true, force: true })
  })

  it('--playlist + --count=100（估算 1406 次超標）且沒有 --yes → exit(3)、dispatchSource 0 次', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')

    await expect(runDistill(baseOpts(outDir, { playlist: PLAYLIST, count: 100 }))).rejects.toThrow(FakeProcessExit)

    expect(dispatchSourceMock).not.toHaveBeenCalled()
    expect(mergeDigestsMock).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(3)
    // 縮小範圍的提示要指向這支腳本真的有的參數。
    const errLines = vi.mocked(console.error).mock.calls.map(c => String(c[0]))
    expect(errLines.some(l => l.includes('--count'))).toBe(true)
  })

  it('--playlist + --count=5（估算 76 次、尖峰 9）沒有 --yes 也放行', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')

    await runDistill(baseOpts(outDir, { playlist: PLAYLIST, count: 5 }))

    expect(dispatchSourceMock).toHaveBeenCalledTimes(1)
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('超標但帶 --yes → 放行，dispatchSource 收到規格檔禁用語的聯集', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')

    await runDistill(baseOpts(outDir, { playlist: PLAYLIST, count: 100, yes: true }))

    expect(dispatchSourceMock).toHaveBeenCalledTimes(1)
    expect(mergeDigestsMock).toHaveBeenCalledTimes(1)
    const ctx = dispatchSourceMock.mock.calls[0]?.[2] as { forbiddenPhrases: string[] }
    expect([...ctx.forbiddenPhrases].sort()).toEqual(['保證獲利', '建議買', '建議賣'].sort())
  })

  it('不帶任何來源 flag（DEFAULT_SOURCES 3 個 skill-markdown）放行並跑 3 次', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')

    await runDistill(baseOpts(outDir))

    expect(dispatchSourceMock).toHaveBeenCalledTimes(3)
  })

  it('--dry-run 不受閘門管、也不呼叫 dispatchSource', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')

    await runDistill(baseOpts(outDir, { playlist: PLAYLIST, count: 100, dryRun: true }))

    expect(dispatchSourceMock).not.toHaveBeenCalled()
  })

  it('dispatchSource 失敗時仍寫出 llm-usage.json', async () => {
    dispatchSourceMock.mockRejectedValueOnce(new Error('boom'))
    const { runDistill } = await import('./prompt-research-distill.js')

    await expect(runDistill(baseOpts(outDir, { file: '/tmp/x.txt' }))).rejects.toThrow('boom')

    const [runName] = readdirSync(outDir)
    const usagePath = join(outDir, runName ?? '', 'llm-usage.json')
    expect(existsSync(usagePath)).toBe(true)
    expect(JSON.parse(readFileSync(usagePath, 'utf8'))).toMatchObject({ totalCostUsd: 0, calls: [] })
  })
})

describe('resolveDistillSpecs', () => {
  it('預設（無 flag）回傳 DEFAULT_SOURCES', () => {
    const specs = resolveDistillSpecs(baseOpts('/tmp/x'))
    expect(specs.every(s => s.kind === 'skill-markdown')).toBe(true)
    expect(specs.length).toBe(3)
  })

  it('--url 可重複，合成一個 videoUrls 來源；--count 不套用到指定影片', () => {
    const urls = ['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://youtu.be/bbbbbbbbbbb']
    const specs = resolveDistillSpecs(baseOpts('/tmp/x', { url: urls, count: 7 }))
    expect(specs).toEqual([
      expect.objectContaining({ kind: 'yt-transcript', pipeline: 'deep', config: { videoUrls: urls } }),
    ])
  })

  it('--playlist + --count 覆寫 config.count', () => {
    const specs = resolveDistillSpecs(baseOpts('/tmp/x', { playlist: PLAYLIST, count: 7 }))
    expect(specs).toEqual([
      expect.objectContaining({ kind: 'yt-transcript', config: { playlistUrl: PLAYLIST, count: 7 } }),
    ])
  })

  it('--skill 解析 owner/repo:path', () => {
    const specs = resolveDistillSpecs(baseOpts('/tmp/x', { skill: 'o/r:a/SKILL.md' }))
    expect(specs).toEqual([
      expect.objectContaining({ kind: 'skill-markdown', config: { repoOwner: 'o', repoName: 'r', skillPath: 'a/SKILL.md', ref: 'main' } }),
    ])
  })

  it('--file 產生 custom-text 來源', () => {
    const specs = resolveDistillSpecs(baseOpts('/tmp/x', { file: './notes.md' }))
    expect(specs).toEqual([expect.objectContaining({ kind: 'custom-text', config: { filePath: './notes.md' } })])
  })
})
