import type { AgentId, ModelTier } from './agents'
import { SUPPORTED_AGENT_IDS } from './agents'
import {
  assertAbsolutePath,
  assertOneOf,
  assertPlainId,
  assertRecord,
  assertString,
  optionalString,
} from './validation'

const MODEL_TIERS = ['lightweight', 'balanced', 'advanced', 'frontier'] as const

export interface Project {
  id: string
  name: string
  repoPath: string
  agentId: AgentId
  modelTier: ModelTier
  context?: string | null
  createdAt: number
  updatedAt: number
}

export function validateProjectId(input: unknown): string {
  return assertPlainId(input, 'Project id')
}

export function validateCreateProjectInput(
  input: unknown,
): Omit<Project, 'id' | 'createdAt' | 'updatedAt'> {
  const value = assertRecord(input, 'Project input')
  const repoPath = assertAbsolutePath(value.repoPath, 'Repository path')
  if (isFilesystemRoot(repoPath)) {
    throw new Error('Repository path cannot be the filesystem root.')
  }

  return {
    name: assertString(value.name, 'Project name', { maxLength: 160 }),
    repoPath,
    agentId: assertOneOf(value.agentId, 'Agent id', SUPPORTED_AGENT_IDS) as AgentId,
    modelTier: assertOneOf(value.modelTier, 'Model tier', MODEL_TIERS) as ModelTier,
    context:
      value.context === null
        ? null
        : optionalString(value.context, 'Project context', {
            maxLength: 200_000,
            allowEmpty: true,
          }),
  }
}

export function validateUpdateProjectInput(input: unknown): Partial<Project> {
  const value = assertRecord(input, 'Project update')
  const update: Partial<Project> = {}

  if (value.name !== undefined) {
    update.name = assertString(value.name, 'Project name', { maxLength: 160 })
  }
  if (value.repoPath !== undefined) {
    update.repoPath = assertAbsolutePath(value.repoPath, 'Repository path')
    if (isFilesystemRoot(update.repoPath)) {
      throw new Error('Repository path cannot be the filesystem root.')
    }
  }
  if (value.agentId !== undefined) {
    update.agentId = assertOneOf(value.agentId, 'Agent id', SUPPORTED_AGENT_IDS) as AgentId
  }
  if (value.modelTier !== undefined) {
    update.modelTier = assertOneOf(value.modelTier, 'Model tier', MODEL_TIERS) as ModelTier
  }
  if (value.context !== undefined) {
    update.context =
      value.context === null
        ? null
        : optionalString(value.context, 'Project context', {
            maxLength: 200_000,
            allowEmpty: true,
          })
  }

  return update
}

function isFilesystemRoot(repoPath: string): boolean {
  return /^\/+$/.test(repoPath)
}
