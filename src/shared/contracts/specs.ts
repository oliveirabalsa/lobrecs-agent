import type { SupportedAgentId } from './agents'
import type { RunMode } from './runs'
import {
  assertOneOf,
  assertPlainId,
  assertRecord,
  assertString,
  optionalString,
} from './validation'

export type SpecStatus = 'draft' | 'approved' | 'running' | 'reviewing' | 'verified' | 'failed'

export const SPEC_ARTIFACT_KINDS = ['prd', 'techspec', 'tasks', 'review', 'memory'] as const
export const PRIMARY_SPEC_ARTIFACT_KINDS = ['prd', 'techspec', 'tasks', 'memory'] as const

export type SpecArtifactKind = typeof SPEC_ARTIFACT_KINDS[number]
export type PrimarySpecArtifactKind = typeof PRIMARY_SPEC_ARTIFACT_KINDS[number]
export type SpecArtifactFrontmatterValue = string | number | boolean | null
export type SpecArtifactFrontmatter = Record<string, SpecArtifactFrontmatterValue>

export interface SpecArtifact {
  id: string
  specId: string
  kind: SpecArtifactKind
  version: number
  title: string
  filePath: string
  relativePath: string
  frontmatter: SpecArtifactFrontmatter
  markdown: string
  updatedAt?: number
}

export interface ReadSpecArtifactInput {
  specId: string
  artifactId: string
}

export interface WriteSpecArtifactInput {
  specId: string
  kind: SpecArtifactKind
  markdown: string
  artifactId?: string
  title?: string
}

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
  selectedAgentProfiles: string[]
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
  selectedAgentProfiles?: string[]
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
  selectedAgentProfiles?: string[]
  runMode?: RunMode
  requirements?: string[]
  acceptanceCriteria?: string[]
}

export function validateReadSpecArtifactInput(input: unknown): ReadSpecArtifactInput {
  const value = assertRecord(input, 'Spec artifact input')
  return {
    specId: assertPlainId(value.specId, 'Spec id'),
    artifactId: assertArtifactId(value.artifactId, 'Artifact id'),
  }
}

export function validateWriteSpecArtifactInput(input: unknown): WriteSpecArtifactInput {
  const value = assertRecord(input, 'Spec artifact write input')
  return {
    specId: assertPlainId(value.specId, 'Spec id'),
    artifactId:
      value.artifactId === undefined || value.artifactId === null
        ? undefined
        : assertArtifactId(value.artifactId, 'Artifact id'),
    kind: assertOneOf(value.kind, 'Artifact kind', SPEC_ARTIFACT_KINDS),
    title: optionalString(value.title, 'Artifact title', { maxLength: 160 }),
    markdown: assertString(value.markdown, 'Artifact markdown', {
      maxLength: 2_000_000,
      allowEmpty: true,
    }),
  }
}

function assertArtifactId(value: unknown, label: string): string {
  const id = assertString(value, label, { maxLength: 220 })
  if (!/^[a-zA-Z0-9._:-]+$/.test(id)) {
    throw new Error(`${label} contains unsupported characters.`)
  }
  return id
}
