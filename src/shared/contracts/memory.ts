export const PROJECT_MEMORY_VERSION = 1

export type ProjectKnowledgeKind =
  | 'architecture'
  | 'workflow'
  | 'preference'
  | 'failure'
  | 'general'

export type ProjectKnowledgeSource = 'manual' | 'user-feedback' | 'system'

export interface ProjectKnowledgeEntry {
  id: string
  kind: ProjectKnowledgeKind
  summary: string
  details?: string
  source: ProjectKnowledgeSource
  sourceSessionId?: string
  createdAt: number
  updatedAt: number
}

export interface ProjectMemoryFile {
  version: typeof PROJECT_MEMORY_VERSION
  entries: ProjectKnowledgeEntry[]
}

export interface CreateProjectKnowledgeInput {
  projectId: string
  kind?: ProjectKnowledgeKind
  summary: string
  details?: string
  source?: ProjectKnowledgeSource
  sourceSessionId?: string
}

export interface DeleteProjectKnowledgeInput {
  projectId: string
  entryId: string
}
