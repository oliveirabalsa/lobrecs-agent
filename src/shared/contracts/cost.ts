import type { SupportedAgentId } from './agents'

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

export interface ProviderUsageLimit {
  status: 'available' | 'unavailable' | 'error'
  label: string
  detail: string
  resetsAt: number | null
  usedPercent?: number | null
  source?: string
}

export interface ProviderUsageRow {
  agentId: SupportedAgentId
  name: string
  installed: boolean
  sessions: number
  tokensIn: number
  tokensOut: number
  totalCostUsd: number
  limit: ProviderUsageLimit
}

export interface ProviderUsageSummary {
  generatedAt: number
  periodStartedAt: number
  periodEndsAt: number
  providers: ProviderUsageRow[]
}
