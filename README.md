# baguanomics

讀者：維護 suanomics prompt 的開發者
型別：入口

baguanomics 把財經素材蒸餾成分析框架，再依 suanomics 的目標 prompt 規格檔產出候選 prompt 與 diff。素材來源與蒸餾產物見下方表格。它只寫自己的輸出目錄，不改 suanomics 的任何檔案；要不要把候選內容併進 suanomics，由人看 diff 決定。

## 快速開始

1. 安裝依賴：`pnpm install --frozen-lockfile`（Node 26、pnpm 版本見 `package.json` 的 `packageManager`）。
2. 複製 `.env.example` 為 `.env`，填入 `ANTHROPIC_API_KEY`。
3. 先看估算不花錢：`pnpm distill --specs <suanomics>/docs/prompt-specs --url <YouTube 影片網址> --dry-run`。
4. 真跑蒸餾：拿掉 `--dry-run`，完成後最後一行印出 run 目錄。
5. 編譯候選：`pnpm compile --run <run 目錄> --specs <suanomics>/docs/prompt-specs`。

## 輸入：目標 prompt 規格檔

規格檔是 suanomics 的 `docs/prompt-specs/<agent>.md`，由 suanomics 的測試從程式常數產生。baguanomics 從中讀四樣東西，格式不符就丟錯：

| 內容 | 用途 |
|---|---|
| `- agent:`、`- frame-style:` | 決定研究素材怎麼排；`none` 的 agent 不產候選 |
| `## 現行 prompt` 下每個 prompt 全文 | 候選 prompt 的起點，diff 的基準 |
| `### 禁用語` | distill 的合規清單，也用來濾掉帶禁用語的框架與術語 |
| `### 抽象評價贅詞` | 有的話加一行禁止固定贅尾，且不把這些詞當術語推薦 |

## distill 的來源參數

| 參數 | 來源 |
|---|---|
| `--url <網址>`（可重複） | 指定的 YouTube 影片 |
| `--playlist <直播頁網址>` | 頻道直播頁的前 `--count` 集，預設 5 集 |
| `--skill owner/repo:path` | GitHub 上的 skill markdown |
| `--file <路徑>` | 本機文字檔 |
| 都不給 | `src/sources/default-sources.ts` 的三個 skill markdown |

YouTube 來源走 segmenter、6 個 lens、consolidator、distill 四段；skill 與文字檔只走 distill。

## 花費控制

- 開跑前估算最壞呼叫數與尖峰並行，超過 500 次或尖峰超過 10 時要加 `--yes` 才跑。
- 每次 LLM 呼叫記帳，累計達 `BAGUANOMICS_MAX_USD`（預設 1 美元）就在下一次呼叫前停下。
- run 目錄的 `llm-usage.json` 記每次呼叫的 stage、token 與花費，失敗的 run 也會寫。
- 模型預設 `claude-haiku-5-5`，可用 `BAGUANOMICS_MODEL` 改成 `claude-sonnet-5-5`。

## 輸出

| 路徑（相對 run 目錄） | 內容 |
|---|---|
| `per-source/<slug>.json` | 每個來源的 digest |
| `<slug>-consolidated.md` | YouTube 來源的跨集彙整 |
| `merged-analyzer-prompt-draft.{md,json}` | 合併後的框架、用詞與紅線 |
| `compiled/candidates/<agent>.<PROMPT>.txt` | 候選 prompt：現行全文加「研究素材補充」段 |
| `compiled/diffs/<agent>.<PROMPT>.diff` | 候選對現行 prompt 的 unified diff |
| `compiled/summary.json` | 跳過的 agent、每份候選的新增行數與被濾掉的框架數 |

## 開發

```bash
pnpm test        # vitest
pnpm lint        # ESLint
pnpm type-check  # tsc
pnpm knip        # 未使用的檔案、export 與依賴
```

改 `src/sources/yt-transcript/prompts.ts` 後跑 `pnpm exec tsx scripts/regen-prompts-baseline.ts`，fixture 的 diff 與 prompt 改動放同一個 commit。

## 授權

Apache-2.0，見 `LICENSE`。
