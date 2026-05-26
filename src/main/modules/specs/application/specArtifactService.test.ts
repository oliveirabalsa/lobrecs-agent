import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Spec } from '../../../../shared/types'
import { SpecArtifactService } from './specArtifactService'

let repoPath: string
let service: SpecArtifactService

describe('SpecArtifactService', () => {
  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-spec-artifacts-'))
    service = new SpecArtifactService()
  })

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true })
  })

  it('creates markdown workflow artifacts for a spec', async () => {
    const artifacts = await service.listArtifacts(specFixture(), repoPath)

    expect(artifacts.map((artifact) => artifact.kind)).toEqual([
      'prd',
      'techspec',
      'tasks',
      'memory',
    ])
    expect(artifacts[0]).toMatchObject({
      id: 'prd',
      specId: 'spec-1',
      version: 1,
      relativePath: expect.stringMatching(/^\.lobrecs\/workflows\/checkout-flow-spec-1/),
    })
    await expect(readFile(path.join(repoPath, artifacts[0].relativePath), 'utf8')).resolves.toContain(
      'specId: "spec-1"',
    )
  })

  it('increments artifact versions when writing markdown', async () => {
    await service.listArtifacts(specFixture(), repoPath)

    const updated = await service.writeArtifact(specFixture(), repoPath, {
      specId: 'spec-1',
      kind: 'prd',
      artifactId: 'prd',
      markdown: '# Updated PRD',
    })

    expect(updated.version).toBe(2)
    expect(updated.markdown).toBe('# Updated PRD')
  })

  it('stores review artifacts under the reviews directory', async () => {
    const review = await service.writeArtifact(specFixture(), repoPath, {
      specId: 'spec-1',
      kind: 'review',
      title: 'Review Round 1',
      markdown: '# Findings',
    })

    expect(review).toMatchObject({
      id: 'review:review-round-1',
      kind: 'review',
      relativePath: expect.stringContaining('/reviews/review-round-1.md'),
    })
  })

  it('rejects malformed frontmatter before returning artifacts', async () => {
    const spec = specFixture()
    const workflowDir = path.join(repoPath, '.lobrecs/workflows/checkout-flow-spec-1')
    await service.listArtifacts(spec, repoPath)
    await writeFile(
      path.join(workflowDir, 'prd.md'),
      ['---', 'specId: "wrong-spec"', 'kind: "prd"', 'version: 1', '---', '# Bad'].join('\n'),
      'utf8',
    )

    await expect(service.listArtifacts(spec, repoPath)).rejects.toThrow(
      'belongs to another spec',
    )
  })
})

function specFixture(): Spec {
  return {
    id: 'spec-1',
    projectId: 'project-1',
    title: 'Checkout Flow',
    goal: 'Ship a reviewable checkout workflow.',
    context: 'The flow needs repo-owned artifacts.',
    constraints: '',
    doneWhen: '',
    targetFiles: ['src/checkout.ts'],
    selectedAgents: ['codex'],
    selectedAgentProfiles: [],
    runMode: 'local',
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
    requirements: [
      {
        id: 'requirement-1',
        specId: 'spec-1',
        body: 'Persist artifacts',
        position: 0,
        satisfied: false,
      },
    ],
    acceptanceCriteria: [
      {
        id: 'criterion-1',
        specId: 'spec-1',
        body: 'Artifacts are readable from the repo',
        position: 0,
        verified: false,
      },
    ],
  }
}
