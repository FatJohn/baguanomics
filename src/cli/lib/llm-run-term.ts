import type { LlmRunTerm } from './llm-run-budget.js'

export function term(label: string, units: number, callsPerUnit: number, httpMultiplier: number, basis: string): LlmRunTerm {
  return { label, units, callsPerUnit, httpMultiplier, basis }
}
