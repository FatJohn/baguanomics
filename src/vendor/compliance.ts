// 台灣投信投顧法合規 helper，搬自 suanomics packages/shared/src/compliance.ts。
// 禁用詞清單不在這裡：它是 suanomics 目標 prompt 規格檔的內容，由呼叫端傳入（ADR 0008）。

export interface ForbiddenMatch {
  hit: boolean
  phrase?: string
}

export function containsForbiddenPhrase(text: string, phrases: readonly string[]): ForbiddenMatch {
  for (const phrase of phrases) {
    if (text.includes(phrase))
      return { hit: true, phrase }
  }
  return { hit: false }
}

// ===== Ticker / 公司名 + 方向性動詞 組合偵測 =====

const TW_STOCK_NAMES = Object.freeze([
  '台積電',
  '鴻海',
  '聯發科',
  '大立光',
  '台達電',
  '廣達',
  '國泰金',
  '富邦金',
  '兆豐金',
  '中信金',
  '玉山金',
  '中租',
  '統一',
  '南亞',
  '可成',
  '台塑',
  '台化',
  '中華電',
  '台灣大',
  '遠傳',
  '中鋼',
  '群創',
  '友達',
  '和碩',
  '華碩',
  '宏碁',
  '緯創',
  '仁寶',
  '英業達',
] as const)

const DIRECTION_VERBS = Object.freeze([
  '看多',
  '看空',
  '偏多',
  '偏空',
  '做多',
  '做空',
  '轉多',
  '轉空',
  '增持',
  '減持',
  '加碼',
  '減碼',
] as const)

// 第三方市場主體：方向詞若被這些主體歸因（前方短窗內）→ 事實陳述、非個人化指示
// 注意：只放「他方機構主體」。不可加「散戶/投資人」這種＝讀者本身的詞——
// 那會讓「建議散戶加碼台積電」這類對讀者的個人化指示漏接（且會切斷 建議加碼 連續詞偵測）。
const ACTOR_SUBJECTS = Object.freeze([
  '外資',
  '法人',
  '投信',
  '自營商',
  '主力',
  '分析師',
  '避險基金',
  '壽險',
  '三大法人',
  '內資',
  '國安基金',
  '公股',
] as const)

const ATTRIBUTION_WINDOW = 8

const TICKER_REGEX = /(?<!\d)\d{4,6}(?!\d)/g
const PROXIMITY = 25

// 數字緊接這些單位後綴 → 是跌點/價格/年月日、不是股號、不列入 ticker
const UNIT_SUFFIXES = new Set(['點', '元', '%', '％', '年', '月', '日', '檔', '萬', '億', '倍', '季'])

export interface TickerDirectionMatch {
  hit: boolean
  ticker?: string
  company?: string
  verb?: string
  snippet?: string
}

interface Position { start: number, end: number, value: string }

function findTickers(text: string): Position[] {
  const positions: Position[] = []
  let match: RegExpExecArray | null
  TICKER_REGEX.lastIndex = 0
  // eslint-disable-next-line no-cond-assign -- canonical RegExp.exec loop idiom
  while ((match = TICKER_REGEX.exec(text)) !== null) {
    const end = match.index + match[0].length
    const nextChar = text[end]
    if (nextChar !== undefined && UNIT_SUFFIXES.has(nextChar))
      continue
    positions.push({ start: match.index, end, value: match[0] })
  }
  return positions
}

function findTerms(text: string, terms: readonly string[]): Position[] {
  const positions: Position[] = []
  for (const term of terms) {
    let idx = text.indexOf(term)
    while (idx !== -1) {
      positions.push({ start: idx, end: idx + term.length, value: term })
      idx = text.indexOf(term, idx + term.length)
    }
  }
  return positions
}

function buildSnippet(text: string, a: Position, b: Position): string {
  const start = Math.max(0, Math.min(a.start, b.start) - 10)
  const end = Math.min(text.length, Math.max(a.end, b.end) + 10)
  return text.slice(start, end)
}

// 方向詞前方 ≤ATTRIBUTION_WINDOW 字內出現任一 actor → 視為第三方歸因（事實放行）
function isAttributed(verb: Position, actors: Position[]): boolean {
  return actors.some((a) => {
    const gap = verb.start - a.end
    return gap >= 0 && gap <= ATTRIBUTION_WINDOW
  })
}

export function findTickerDirections(text: string): TickerDirectionMatch[] {
  const tickers = findTickers(text)
  const companies = findTerms(text, TW_STOCK_NAMES)
  const actors = findTerms(text, ACTOR_SUBJECTS)
  const verbs = findTerms(text, DIRECTION_VERBS).filter(v => !isAttributed(v, actors))
  const matches: TickerDirectionMatch[] = []

  for (const verb of verbs) {
    for (const target of [...tickers, ...companies]) {
      const distance = Math.min(
        Math.abs(verb.start - target.end),
        Math.abs(target.start - verb.end),
      )
      if (distance <= PROXIMITY) {
        const isTicker = tickers.includes(target)
        matches.push({
          hit: true,
          verb: verb.value,
          snippet: buildSnippet(text, target, verb),
          ...(isTicker ? { ticker: target.value } : { company: target.value }),
        })
      }
    }
  }
  return matches
}

export function containsTickerDirection(text: string): TickerDirectionMatch {
  return findTickerDirections(text)[0] ?? { hit: false }
}
