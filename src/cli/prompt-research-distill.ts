/* eslint-disable no-console -- CLI progress output */
import type { Digest, SourceSpec } from '../types.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { getLlmUsage, resolveModel, totalCostUsd } from '../llm.js'
import { mergeDigests } from '../merger.js'
import { DEFAULT_SOURCES } from '../sources/default-sources.js'
import { dispatchSource } from '../sources/index.js'
import { loadSpecs, unionForbiddenPhrases } from '../spec/load-specs.js'
import { enforceLlmRunBudget, estimateTotalCalls } from './lib/llm-run-budget.js'
import { estimatePromptResearchDistill } from './lib/prompt-research-distill-estimate.js'

export interface DistillOpts {
  specs: string
  url?: string[]
  playlist?: string
  skill?: string
  file?: string
  kind?: SourceSpec['kind']
  count?: number
  out: string
  dryRun: boolean
  /** 批次跑前預算閘門的確認旗標 */
  yes: boolean
}

export function parseSkillAdHoc(arg: string): SourceSpec {
  const [repoRef, pathPart] = arg.split(':')
  const [repoOwner, repoName] = (repoRef ?? '').split('/')
  if (!repoOwner || !repoName || !pathPart)
    throw new Error('--skill expects "owner/repo:path/to/SKILL.md"')
  return {
    kind: 'skill-markdown',
    slug: `adhoc-${repoOwner}-${repoName}`,
    displayName: `${repoOwner}/${repoName}`,
    pipeline: 'light',
    config: { repoOwner, repoName, skillPath: pathPart, ref: 'main' },
  }
}

/** --url／--playlist／--skill／--file／--kind／--count 覆寫全部套用完之後的最終 specs。 */
export function resolveDistillSpecs(opts: DistillOpts): SourceSpec[] {
  let specs: SourceSpec[] = DEFAULT_SOURCES
  if (opts.url && opts.url.length > 0)
    specs = [{ kind: 'yt-transcript', slug: 'adhoc-youtube', displayName: 'YouTube', pipeline: 'deep', config: { videoUrls: opts.url } }]
  else if (opts.playlist)
    specs = [{ kind: 'yt-transcript', slug: 'adhoc-youtube-streams', displayName: 'YouTube streams', pipeline: 'deep', config: { playlistUrl: opts.playlist } }]
  else if (opts.skill)
    specs = [parseSkillAdHoc(opts.skill)]
  else if (opts.file)
    specs = [{ kind: 'custom-text', slug: 'custom', displayName: 'custom', pipeline: 'light', config: { filePath: opts.file } }]
  if (opts.kind)
    specs = specs.filter(s => s.kind === opts.kind)
  if (typeof opts.count === 'number')
    specs = specs.map(s => (s.kind === 'yt-transcript' && s.config.playlistUrl ? { ...s, config: { ...s.config, count: opts.count } } : s))
  return specs
}

export async function runDistill(opts: DistillOpts): Promise<string> {
  const specs = resolveDistillSpecs(opts)
  const forbiddenPhrases = unionForbiddenPhrases(await loadSpecs(resolve(opts.specs)))
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = resolve(opts.out, `${runId}-run`)
  const estimate = estimatePromptResearchDistill(specs)

  if (opts.dryRun) {
    console.log(JSON.stringify({
      runId,
      model: resolveModel(),
      forbiddenPhrases: forbiddenPhrases.length,
      specs: specs.map(s => ({ slug: s.slug, kind: s.kind, pipeline: s.pipeline })),
      estimated_calls: estimateTotalCalls(estimate),
      peak: estimate.peak,
    }, null, 2))
    return runDir
  }

  enforceLlmRunBudget(estimate, {
    confirmed: opts.yes,
    errLog: line => console.error(line),
    exit: code => process.exit(code),
    narrowingHint: '--count 或少給幾個 --url',
  })

  mkdirSync(join(runDir, 'per-source'), { recursive: true })
  const digests: Digest[] = []
  try {
    for (const spec of specs) {
      console.warn(`[run] ${spec.slug} (${spec.kind})`)
      const digest = await dispatchSource(spec, runDir, { forbiddenPhrases })
      digests.push(digest)
      writeFileSync(join(runDir, 'per-source', `${spec.slug}.json`), JSON.stringify(digest, null, 2), 'utf8')
    }
    const { markdown, draft } = mergeDigests(digests, { sources: specs })
    writeFileSync(join(runDir, 'merged-analyzer-prompt-draft.md'), markdown, 'utf8')
    writeFileSync(join(runDir, 'merged-analyzer-prompt-draft.json'), JSON.stringify(draft, null, 2), 'utf8')
  }
  finally {
    // 失敗也要留下已花的錢，事後才對得上帳。
    writeFileSync(join(runDir, 'llm-usage.json'), JSON.stringify({ totalCostUsd: totalCostUsd(), calls: getLlmUsage() }, null, 2), 'utf8')
    console.error(`[llm] ${getLlmUsage().length} 次呼叫，US$${totalCostUsd().toFixed(4)}`)
  }
  console.log(runDir)
  return runDir
}

function parseCli(argv: string[]): DistillOpts {
  const { values } = parseArgs({
    args: argv,
    options: {
      'specs': { type: 'string' },
      'url': { type: 'string', multiple: true },
      'playlist': { type: 'string' },
      'skill': { type: 'string' },
      'file': { type: 'string' },
      'kind': { type: 'string' },
      'count': { type: 'string' },
      'out': { type: 'string', default: 'out' },
      'dry-run': { type: 'boolean', default: false },
      'yes': { type: 'boolean', default: false },
    },
  })
  if (!values.specs)
    throw new Error('需要 --specs <suanomics/docs/prompt-specs 目錄>：禁用語從規格檔讀')
  if (values.kind !== undefined && !['yt-transcript', 'skill-markdown', 'custom-text'].includes(values.kind))
    throw new Error(`--kind 不認得：${values.kind}`)
  return {
    specs: values.specs,
    out: values.out,
    dryRun: values['dry-run'],
    yes: values.yes,
    ...(values.url ? { url: values.url } : {}),
    ...(values.playlist ? { playlist: values.playlist } : {}),
    ...(values.skill ? { skill: values.skill } : {}),
    ...(values.file ? { file: values.file } : {}),
    ...(values.kind ? { kind: values.kind as SourceSpec['kind'] } : {}),
    ...(values.count ? { count: Number.parseInt(values.count, 10) } : {}),
  }
}

// 只在直接執行時跑，測試 import 時不觸發。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDistill(parseCli(process.argv.slice(2))).catch((err: Error) => {
    console.error(err.stack ?? err.message)
    process.exit(1)
  })
}
