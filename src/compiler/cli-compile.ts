import type { CompiledCandidate } from './compiler.js'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadSpecs } from '../spec/load-specs.js'
import { MergedDraftSchema } from '../types.js'
import { compileCandidates } from './compiler.js'

export interface RunCompileParams {
  /** distill 的 run 目錄，內含 merged-analyzer-prompt-draft.json */
  runDir: string
  /** suanomics 的 docs/prompt-specs 目錄 */
  specsDir: string
}

export interface RunCompileResult {
  outDir: string
  candidates: CompiledCandidate[]
  writtenPaths: string[]
}

/** 讀 draft 與規格檔，寫 <runDir>/compiled/ 下的 candidate、diff 與 summary.json。不覆蓋 suanomics 的任何檔案。 */
export async function runCompile(p: RunCompileParams): Promise<RunCompileResult> {
  const draftPath = resolve(p.runDir, 'merged-analyzer-prompt-draft.json')
  const draft = MergedDraftSchema.parse(JSON.parse(await readFile(draftPath, 'utf8')))
  const specs = await loadSpecs(resolve(p.specsDir))
  const candidates = compileCandidates(specs, draft)

  const outDir = resolve(p.runDir, 'compiled')
  // 每次重建：agent 改名或改成 none 後，舊候選留著會被當成這次的結果。
  await rm(outDir, { recursive: true, force: true })
  await mkdir(join(outDir, 'candidates'), { recursive: true })
  await mkdir(join(outDir, 'diffs'), { recursive: true })
  const writtenPaths: string[] = []
  for (const c of candidates) {
    const base = `${c.agent}.${c.promptName}`
    const candidatePath = join(outDir, 'candidates', `${base}.txt`)
    const diffPath = join(outDir, 'diffs', `${base}.diff`)
    await writeFile(candidatePath, c.candidate, 'utf8')
    await writeFile(diffPath, c.diff, 'utf8')
    writtenPaths.push(candidatePath, diffPath)
  }
  const summaryPath = join(outDir, 'summary.json')
  const summary = {
    draft: draftPath,
    specsDir: resolve(p.specsDir),
    sources: draft.sources.map(s => s.slug),
    skippedAgents: specs.filter(s => s.frameStyle === 'none' || s.prompts.length === 0).map(s => s.agent),
    candidates: candidates.map(c => ({
      agent: c.agent,
      prompt: c.promptName,
      spec: c.specPath,
      addedLines: c.diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
      droppedFrames: c.droppedFrames,
      droppedTerms: c.droppedTerms,
    })),
  }
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  writtenPaths.push(summaryPath)
  return { outDir, candidates, writtenPaths }
}
