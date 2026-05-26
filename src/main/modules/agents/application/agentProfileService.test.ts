import Database from 'better-sqlite3'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, setDbForTests } from '../../../store/db'
import { projectsStore } from '../../../store/projects'
import {
  listAgentProfiles,
  promptWithAgentProfile,
} from './agentProfileService'
import type { AdapterCapability, AgentModelCatalog } from '../../../../shared/types'

describe('agentProfileService', () => {
  let repoPath: string

  beforeEach(async () => {
    setDbForTests(new Database(':memory:'))
    repoPath = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent-profiles-'))
  })

  afterEach(async () => {
    closeDb()
    await rm(repoPath, { recursive: true, force: true })
  })

  it('loads markdown profiles with scoped mcp refs and diagnostics', async () => {
    const project = projectsStore.create({
      name: 'Profile repo',
      repoPath,
      agentId: 'codex',
      modelTier: 'balanced',
    })
    const profileDir = path.join(repoPath, '.lobrecs', 'agents', 'reviewer')
    await mkdir(profileDir, { recursive: true })
    await writeFile(
      path.join(profileDir, 'AGENT.md'),
      [
        '---',
        'name: Reviewer',
        'role: Code reviewer',
        'agentId: codex',
        'model: gpt-5.3-codex',
        'approvalMode: manual',
        'allowedTools: [read, shell]',
        'mcpRefs:',
        '  - github',
        'verificationRecipeIds: [test]',
        '---',
        'Review for regressions and missing tests.',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      path.join(profileDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'github-mcp' } } }),
      'utf8',
    )

    const result = await listAgentProfiles({
      projectId: project.id,
      capabilities: [capability('codex')],
      modelCatalogs: [catalog('codex', ['gpt-5.3-codex'])],
    })

    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0]).toMatchObject({
      id: 'reviewer',
      name: 'Reviewer',
      role: 'Code reviewer',
      defaultAgentId: 'codex',
      defaultModel: 'gpt-5.3-codex',
      approvalMode: 'manual',
      allowedTools: ['read', 'shell'],
      mcpRefs: ['github'],
      mcpServerNames: ['github'],
      verification: { recipeIds: ['test'] },
    })
    expect(result.issues).toEqual([])
  })

  it('reports missing mcp refs and unavailable models', async () => {
    const project = projectsStore.create({
      name: 'Broken profile repo',
      repoPath,
      agentId: 'codex',
      modelTier: 'balanced',
    })
    const profileDir = path.join(repoPath, '.lobrecs', 'agents', 'debugger')
    await mkdir(profileDir, { recursive: true })
    await writeFile(
      path.join(profileDir, 'AGENT.md'),
      [
        '---',
        'name: Debugger',
        'role: Debugger',
        'agentId: codex',
        'model: missing-model',
        'mcpRefs: [linear]',
        '---',
        'Trace root causes.',
      ].join('\n'),
      'utf8',
    )

    const result = await listAgentProfiles({
      projectId: project.id,
      capabilities: [capability('codex')],
      modelCatalogs: [catalog('codex', ['gpt-5.3-codex'])],
    })

    expect(result.issues.map((issue) => issue.kind)).toEqual([
      'unavailable-model',
      'missing-mcp-server',
    ])
  })

  it('prepends profile instructions to a user prompt', () => {
    const prompt = promptWithAgentProfile('Fix the bug', {
      id: 'reviewer',
      name: 'Reviewer',
      role: 'Code reviewer',
      instructions: 'Review carefully.',
      allowedTools: ['read'],
      mcpRefs: ['github'],
      mcpServerNames: ['github'],
      verification: { recipeIds: ['test'] },
      filePath: '/repo/.lobrecs/agents/reviewer/AGENT.md',
    })

    expect(prompt).toContain('[Agent Profile: Reviewer]')
    expect(prompt).toContain('Allowed tools: read')
    expect(prompt).toContain('Scoped MCP refs: github')
    expect(prompt).toContain('User task:\nFix the bug')
  })
})

function capability(agentId: 'codex'): AdapterCapability {
  return {
    agentId,
    name: 'Codex',
    installed: true,
    supportsStreamingJson: true,
    supportsResume: false,
    supportsFileAttachments: false,
    supportsCustomAgents: false,
    supportsMcp: true,
    supportsApprovalMode: true,
    supportsModelListing: true,
  }
}

function catalog(agentId: 'codex', modelIds: string[]): AgentModelCatalog {
  return {
    agentId,
    name: 'Codex',
    installed: true,
    models: modelIds.map((id) => ({
      id,
      label: id,
      agentId,
      tier: 'balanced',
      source: 'cli',
    })),
  }
}
