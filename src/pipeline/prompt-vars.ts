/**
 * Source-aware prompt template variables for the shared deep pipeline.
 *
 * segmenter / lens / consolidator prompts 的 source-specific 字眼參數化；
 * v0 另有 podcast-rss 版本，搬到 baguanomics 時因語音轉文字只有 Gemini 版而拿掉。
 */
export interface DeepPipelinePromptVars {
  /** 用於 segmenter / consolidator 開頭定位、例：「財經 ___ 的段落分類員」 */
  sourceKindLabel: string
  /** 用於 lens prompt 內「這集 ___」字眼 */
  episodeWord: string
  /** consolidator 輸出 digest 的 markdown title prefix */
  digestTitlePrefix: string
  /** 投信投顧法禁用語，來自 suanomics 目標 prompt 規格檔（ADR 0008），由 CLI 讀檔後注入 */
  forbiddenPhrases: readonly string[]
}

export type SourcePromptVars = Omit<DeepPipelinePromptVars, 'forbiddenPhrases'>

export const YT_PROMPT_VARS: SourcePromptVars = {
  // 平台名（不含 episode-type 後綴）— 為了讓 segmenter / consolidator 的 yt prompt
  // 字面與重構前 byte-for-byte 一致：原 segmenter 是「財經 YouTube 直播」、原 consolidator
  // 是「財經 YouTube KOL」、兩處共用詞是 `YouTube`、`直播` 由 `episodeWord` 補上。
  sourceKindLabel: 'YouTube',
  episodeWord: '直播',
  digestTitlePrefix: 'YT Analyst Digest',
}
