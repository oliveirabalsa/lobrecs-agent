import { projectsStore } from '../../../store'
import type { Project } from '../../../../shared/types'

export function requireProject(projectId: string): Project {
  const project = projectsStore.get(projectId)
  if (!project) throw new Error('Project not found')
  return project
}
