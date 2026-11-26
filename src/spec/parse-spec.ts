/**
 * 讀 suanomics 的「目標 prompt 規格」檔（docs/prompt-specs/<agent>.md）。
 * 格式由 suanomics 的產生器決定；這裡只認下列結構，認不出就丟錯，不猜：
 * - `- agent: \`<name>\``、`- frame-style: \`<style>\`` 兩行基本資料
 * - `## 現行 prompt` 底下每個 `### \`<EXPORT_NAME>\`` 接一個至少五個反引號的 text fence
 * - `### 禁用語`、`### 抽象評價贅詞` 底下的 `- ` 條列
 */

export const FRAME_STYLES = ['decomposer', 'analyst', 'synthesizer', 'none'] as const
export type FrameStyle = (typeof FRAME_STYLES)[number]

export interface SpecPrompt {
  name: string
  text: string
}

export interface PromptSpec {
  agent: string
  frameStyle: FrameStyle
  prompts: SpecPrompt[]
  forbiddenPhrases: string[]
  garnishTerms: string[]
}

function meta(lines: string[], key: string, file: string): string {
  const re = new RegExp(`^- ${key}: \`([^\`]+)\`$`)
  for (const line of lines) {
    const m = line.match(re)
    if (m?.[1])
      return m[1]
  }
  throw new Error(`${file}: 找不到 \`- ${key}: \`...\`\` 這行`)
}

function isFrameStyle(v: string): v is FrameStyle {
  return (FRAME_STYLES as readonly string[]).includes(v)
}

// prompt 全文裡常有 `#` 標題與條列，標記每一行是否落在 fence 內（含開頭與收尾行），找段落時跳過。
function fencedLines(lines: string[]): boolean[] {
  const fenced: boolean[] = []
  let open: string | null = null
  for (const line of lines) {
    const ticks = line.match(/^(`{3,})/)?.[1]
    if (open === null) {
      if (ticks)
        open = ticks
      fenced.push(ticks !== undefined)
    }
    else {
      fenced.push(true)
      if (ticks && ticks.length >= open.length && line.trim() === ticks)
        open = null
    }
  }
  return fenced
}

function sectionRange(lines: string[], fenced: boolean[], heading: string): [number, number] | null {
  const start = lines.findIndex((l, i) => l === heading && !fenced[i])
  if (start < 0)
    return null
  const level = heading.match(/^#+/)?.[0].length ?? 2
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i]?.match(/^(#+) /)
    if (!fenced[i] && m?.[1] && m[1].length <= level) {
      end = i
      break
    }
  }
  return [start + 1, end]
}

function bullets(lines: string[], fenced: boolean[], heading: string): string[] {
  const range = sectionRange(lines, fenced, heading)
  if (!range)
    return []
  const out: string[] = []
  for (let i = range[0]; i < range[1]; i++) {
    const line = lines[i] ?? ''
    if (!fenced[i] && line.startsWith('- '))
      out.push(line.slice(2))
  }
  return out
}

function parsePrompts(lines: string[], fenced: boolean[], file: string): SpecPrompt[] {
  const range = sectionRange(lines, fenced, '## 現行 prompt')
  if (!range)
    throw new Error(`${file}: 找不到「## 現行 prompt」段`)
  const prompts: SpecPrompt[] = []
  for (let i = range[0]; i < range[1]; i++) {
    const name = lines[i]?.match(/^### `([^`]+)`$/)?.[1]
    if (!name)
      continue
    const fenceLine = lines.slice(i + 1).findIndex(l => l.trim() !== '') + i + 1
    const fence = lines[fenceLine]?.match(/^(`{5,})text$/)?.[1]
    if (!fence)
      throw new Error(`${file}: ${name} 後面要接至少五個反引號的 text fence`)
    const close = lines.indexOf(fence, fenceLine + 1)
    if (close < 0)
      throw new Error(`${file}: ${name} 的 fence 沒有收尾`)
    prompts.push({ name, text: lines.slice(fenceLine + 1, close).join('\n') })
    i = close
  }
  return prompts
}

export function parsePromptSpec(markdown: string, file = 'spec'): PromptSpec {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const fenced = fencedLines(lines)
  const frameStyle = meta(lines, 'frame-style', file)
  if (!isFrameStyle(frameStyle))
    throw new Error(`${file}: frame-style 要是 ${FRAME_STYLES.join('／')}，收到 ${frameStyle}`)
  return {
    agent: meta(lines, 'agent', file),
    frameStyle,
    prompts: parsePrompts(lines, fenced, file),
    forbiddenPhrases: bullets(lines, fenced, '### 禁用語'),
    garnishTerms: bullets(lines, fenced, '### 抽象評價贅詞'),
  }
}
