import type { Digest, SourceKind } from '../types.js'
import { distillToDigest } from './build-digest.js'

export function buildSkillDistillSystemPrompt(forbiddenPhrases: readonly string[]): string {
  const forbiddenList = forbiddenPhrases.map(p => `「${p}」`).join('、')
  return `你是一個「分析框架提煉器」。讀給你的內容是某位分析師 / skill author 的
分析方法論。你的任務是抽出可以**直接用來分析單則財經新聞事件**的 framework
片段、而不是總結原文內容。

輸出 analystFrames 的原則：
1. 每個 frame 必須可被「針對新聞事件」呼叫、而非「針對公司整體體檢」
2. questions 列 3–7 條、具體、可執行（不要「分析影響」這種廢話）
3. whenToApply 要明確、例：「新聞提到央行政策改變時」
4. frames 至少 1 個、最多 8 個

輸出 analysisChecks：
- 若原文提供具體量化檢查（ratio、thresholds）、抽成可執行步驟
- 非必要、原文沒有就空陣列

輸出 vocabulary：
- 抽出原文中的「中性分析詞」、避開 KOL 口語
- avoid list 對應 Taiwan 投信投顧法禁用詞

輸出 compliance.redFlags：
- 該框架特有、易誤踩法規邊界的敘事類型（例：「提及具體持股百分比」）

【Taiwan 投信投顧法合規紅線】
- analystFrames.questions 不得含「建議買 / 賣 / 持有」等指令式
- vocabulary.preferred 不得含個股 ticker + 方向性動詞組合
- 禁用詞（輸出絕不可沿用）：${forbiddenList}

若原文非中英文、輸出繁中（台灣用語）。

輸出：嚴格符合 DigestSchema 的 JSON。`
}

export interface SkillDistillParams {
  sourceSlug: string
  sourceKind: SourceKind
  rawContent: string
  rawSourceRef: Digest['rawSourceRef']
  forbiddenPhrases: readonly string[]
}

export async function distillSkillToDigest(params: SkillDistillParams): Promise<Digest> {
  const systemPrompt = buildSkillDistillSystemPrompt(params.forbiddenPhrases)
  const userContent = `sourceSlug: ${params.sourceSlug}\nsourceKind: ${params.sourceKind}\n\n---\n\n${params.rawContent}`
  return distillToDigest('distill', systemPrompt, userContent, {
    sourceSlug: params.sourceSlug,
    sourceKind: params.sourceKind,
    rawSourceRef: params.rawSourceRef,
  })
}
