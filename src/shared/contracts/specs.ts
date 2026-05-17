import type { SupportedAgentId } from './agents'
import type { RunMode } from './runs'

export type SpecStatus = 'draft' | 'approved' | 'running' | 'reviewing' | 'verified' | 'failed'

export interface SpecRequirement {
  id: string
  specId: string
  body: string
  position: number
  satisfied: boolean
}

export interface AcceptanceCriterion {
  id: string
  specId: string
  body: string
  position: number
  verified: boolean
}

export interface Spec {
  id: string
  projectId: string
  title: string
  goal: string
  context: string
  constraints: string
  doneWhen: string
  targetFiles: string[]
  selectedAgents: SupportedAgentId[]
  runMode: RunMode
  status: SpecStatus
  approvedAt?: number
  createdAt: number
  updatedAt: number
  requirements: SpecRequirement[]
  acceptanceCriteria: AcceptanceCriterion[]
}

export interface CreateSpecInput {
  projectId: string
  title: string
  goal: string
  context?: string
  constraints?: string
  doneWhen?: string
  targetFiles?: string[]
  selectedAgents?: SupportedAgentId[]
  runMode?: RunMode
  requirements?: string[]
  acceptanceCriteria?: string[]
}

export interface UpdateSpecInput {
  title?: string
  goal?: string
  context?: string
  constraints?: string
  doneWhen?: string
  targetFiles?: string[]
  selectedAgents?: SupportedAgentId[]
  runMode?: RunMode
  requirements?: string[]
  acceptanceCriteria?: string[]
}
