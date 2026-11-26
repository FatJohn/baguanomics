import type { PromptSpec } from './parse-spec.js'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePromptSpec } from './parse-spec.js'

export interface LoadedSpec extends PromptSpec {
  path: string
}

export async function loadSpecs(dir: string): Promise<LoadedSpec[]> {
  const names = (await readdir(dir)).filter(n => n.endsWith('.md') && n !== 'README.md').sort()
  if (names.length === 0)
    throw new Error(`${dir} 底下沒有規格檔（*.md）`)
  return Promise.all(names.map(async (name) => {
    const path = join(dir, name)
    return { ...parsePromptSpec(await readFile(path, 'utf8'), path), path }
  }))
}

/**
 * distill 用的禁用語：各規格檔的禁用語取聯集。suanomics 端每份規格檔都帶同一份 shared 清單，
 * 取聯集是為了任一份多帶的詞也不會被漏掉。
 */
export function unionForbiddenPhrases(specs: readonly PromptSpec[]): string[] {
  const all = new Set<string>()
  for (const s of specs) {
    for (const p of s.forbiddenPhrases) all.add(p)
  }
  if (all.size === 0)
    throw new Error('規格檔沒有任何禁用語，拒絕在沒有合規清單的情況下跑 distill')
  return [...all]
}
