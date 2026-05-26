import type {
  AgentApprovalMode,
  AgentThinkingLevel,
  SupportedAgentId,
} from './agents'
import { SUPPORTED_AGENT_IDS } from './agents'
import {
  assertPlainId,
  assertRecord,
  optionalOneOf,
  optionalString,
} from './validation'

export type AgentProfileIssueKind =
  | 'missing-mcp-server'
  | 'unavailable-model'
  | 'unsupported-approval-mode'
  | 'missing-agent-runtime'
  | 'invalid-profile'

export interface AgentProfileVerificationPreferences {
  recipeIds: string[]
  requireCommandPrefix?: boolean
}

export interface AgentProfile {
  id: string
  name: string
  role: string
  instructions: string
  defaultAgentId?: SupportedAgentId
  defaultModel?: string
  approvalMode?: AgentApprovalMode
  thinking?: AgentThinkingLevel
  allowedTools: string[]
  mcpRefs: string[]
  mcpServerNames: string[]
  verification: AgentProfileVerificationPreferences
  filePath: string
  mcpConfigPath?: string
}

export interface AgentProfileIssue {
  profileId: string
  profileName: string
  kind: AgentProfileIssueKind
  message: string
  ref?: string
}

export interface AgentProfileListResult {
  projectId: string
  profiles: AgentProfile[]
  issues: AgentProfileIssue[]
}

export interface AgentProfileDoctorReport {
  projectId: string
  profileCount: number
  issues: AgentProfileIssue[]
}

export const AGENT_PROFILE_APPROVAL_MODES = ['manual', 'auto-safe', 'full'] as const
export const AGENT_PROFILE_THINKING_LEVELS = [
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export function validateAgentProfileId(input: unknown): string {
  return assertPlainId(input, 'Agent profile id')
}

export function validateAgentProfileListInput(input: unknown): { projectId: string } {
  const value = assertRecord(input, 'Agent profile list input')
  return {
    projectId: assertPlainId(value.projectId, 'Project id'),
  }
}

export function validateAgentProfileFrontmatter(input: unknown): {
  name?: string
  role?: string
  agentId?: SupportedAgentId
  model?: string
  approvalMode?: AgentApprovalMode
  thinking?: AgentThinkingLevel
} {
  const value = assertRecord(input, 'Agent profile frontmatter')
  return {
    name: optionalString(value.name, 'Agent profile name', { maxLength: 120 }),
    role: optionalString(value.role, 'Agent profile role', { maxLength: 120 }),
    agentId: optionalOneOf(value.agentId, 'Agent profile agent', SUPPORTED_AGENT_IDS),
    model: optionalString(value.model, 'Agent profile model', { maxLength: 500 }),
    approvalMode: optionalOneOf(
      value.approvalMode,
      'Agent profile approval mode',
      AGENT_PROFILE_APPROVAL_MODES,
    ),
    thinking: optionalOneOf(
      value.thinking,
      'Agent profile thinking',
      AGENT_PROFILE_THINKING_LEVELS,
    ),
  }
}
