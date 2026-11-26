// 搬自 suanomics v0 apps/server/src/agents/fanout-concurrency.ts，只留批次腳本預算閘用的兩個門檻；
// 數字對齊 suanomics AGENTS.md「超過 500 次呼叫或尖峰並行超過 10 就分批跑」。
export const MAX_SAFE_LLM_PEAK = 10
export const MAX_SAFE_LLM_CALLS_PER_RUN = 500
