import { ipcMain } from 'electron'
import { projectsStore, specsStore } from '../../../store'
import type { CreateSpecInput, UpdateSpecInput } from '../../../../shared/types'
import type { MainIpcContext } from '../../shared/ipcContext'
import { suggestSpecDraft } from '../application/draftSuggestAgent'
import { specArtifactService } from '../application/specArtifactService'
import {
  validateReadSpecArtifactInput,
  validateSpecId,
  validateWriteSpecArtifactInput,
} from '../../../../shared/types'

export function registerSpecHandlers(context: MainIpcContext): void {
  ipcMain.handle('specs:list', async (_event, projectId: string) => specsStore.list(projectId))
  ipcMain.handle('specs:get', async (_event, specId: string) => specsStore.get(specId))
  ipcMain.handle('specs:create', async (_event, data: CreateSpecInput) =>
    specsStore.create(data),
  )
  ipcMain.handle('specs:update', async (_event, specId: string, data: UpdateSpecInput) =>
    specsStore.update(specId, data),
  )
  ipcMain.handle('specs:approve', async (_event, specId: string) =>
    specsStore.approve(specId),
  )
  ipcMain.handle(
    'specs:draft-suggest',
    async (_event, { projectId, title, goal }: { projectId: string; title: string; goal: string }) =>
      suggestSpecDraft(context, projectId, title, goal),
  )
  ipcMain.handle('specs:list-artifacts', async (_event, rawSpecId: unknown) => {
    const { spec, repoPath } = requireSpecProject(validateSpecId(rawSpecId))
    return specArtifactService.listArtifacts(spec, repoPath)
  })
  ipcMain.handle('specs:read-artifact', async (_event, rawInput: unknown) => {
    const input = validateReadSpecArtifactInput(rawInput)
    const { spec, repoPath } = requireSpecProject(input.specId)
    return specArtifactService.readArtifact(spec, repoPath, input.artifactId)
  })
  ipcMain.handle('specs:write-artifact', async (_event, rawInput: unknown) => {
    const input = validateWriteSpecArtifactInput(rawInput)
    const { spec, repoPath } = requireSpecProject(input.specId)
    return specArtifactService.writeArtifact(spec, repoPath, input)
  })
}

function requireSpecProject(specId: string) {
  const spec = specsStore.get(specId)
  if (!spec) throw new Error(`Spec not found: ${specId}`)

  const project = projectsStore.get(spec.projectId)
  if (!project) throw new Error(`Project not found: ${spec.projectId}`)

  return { spec, repoPath: project.repoPath }
}
