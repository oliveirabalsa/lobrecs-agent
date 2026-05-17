export interface CostSummary {
  total_tokens_in: number | null
  total_tokens_out: number | null
  total_cost_usd: number | null
  session_count: number
}

export interface PeriodCostRow {
  project_name: string
  model: string
  sessions: number
  total_cost: number
}
