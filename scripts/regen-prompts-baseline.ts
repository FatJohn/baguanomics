// 重生 yt-prompts-baseline.json（byte-for-byte fixture）。
// prompts.ts 有意圖的改動後跑這支、fixture diff 與 prompt diff 同 commit。
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXTURE_FORBIDDEN_PHRASES } from '../src/__fixtures__/forbidden-phrases.js'
import { YT_PROMPT_VARS } from '../src/pipeline/prompt-vars.js'
import { buildConsolidatorSystemPrompt, buildLensExtractorSystemPrompt, buildSegmenterSystemPrompt } from '../src/sources/yt-transcript/prompts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const vars = { ...YT_PROMPT_VARS, forbiddenPhrases: FIXTURE_FORBIDDEN_PHRASES }
const out: Record<string, string> = { segmenter: buildSegmenterSystemPrompt(vars) }
const lenses = ['events', 'cited_sources', 'entities', 'reasoning_chains', 'impacts', 'analyst_frames'] as const
for (const lens of lenses)
  out[`lens_${lens}`] = buildLensExtractorSystemPrompt(lens, vars)
out.consolidator = buildConsolidatorSystemPrompt(vars)
writeFileSync(
  resolve(__dirname, '../src/pipeline/__fixtures__/yt-prompts-baseline.json'),
  `${JSON.stringify(out, null, 2)}\n`,
)
