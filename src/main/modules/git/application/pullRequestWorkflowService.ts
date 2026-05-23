import { randomUUID } from 'node:crypto'
import type { MainIpcContext } from '../../shared/ipcContext'
import { requireProject } from '../../projects/application/requireProject'
import { buildProcessEnvironment } from '../../../process/environment'
import { runGit } from '../infrastructure/runGit'
import { buildGhPrCreateArgs, resolveGhCommand } from '../infrastructure/githubCli'
import type {
  GitRemoteInfo,
  CreatePullRequestInput,
  CreatePullRequestFromDraftInput,
  CreatePullRequestResult,
  GeneratePullRequestDraftInput,
  GeneratePullRequestDraftResult,
  GitProviderType,
} from '../../../../shared/contracts/git'
import { getProviderType, isGitHubRemote, isAzureRemote } from '../domain/pullRequest'
import { buildPrDraftPrompt, createDraftTitle } from '../domain/prDraft'
import { loadPrTemplate } from '../domain/prTemplate'
import { getModelForTier } from '../../../router/ModelRouter'
import { deriveActivityEvents } from '../../../session/activity'
import type {
  AgentEvent,
  AgentRuntimeSettings,
  ModelTier,
  SupportedAgentId,
} from '../../../../shared/types'

export class PullRequestWorkflowService {
  constructor(private readonly context: MainIpcContext) {}

  async getRemoteInfo(projectId: string): Promise<GitRemoteInfo> {
    const project = requireProject(projectId)
    const result = await runGit(['remote', 'get-url', 'origin'], project.repoPath)

    if (result.exitCode !== 0) {
      throw new Error('No origin remote configured.')
    }

    const remoteUrl = result.stdout.trim()
    const providerType = getProviderType(remoteUrl)

    if (providerType === 'unsupported') {
      throw new Error('Unsupported remote provider. Only GitHub (github.com) and Azure DevOps (dev.azure.com, visualstudio.com) are supported.')
    }

    const detected = this.detectRemote(remoteUrl, providerType)

    return detected
  }

  async createPullRequest(
    projectId: string,
    input: Omit<CreatePullRequestInput, 'projectId'>,
  ): Promise<CreatePullRequestResult> {
    const remoteInfo = await this.getRemoteInfo(projectId)

    if (remoteInfo.provider === 'github') {
      return this.createGitHubPullRequest(projectId, remoteInfo, input)
    }

    if (remoteInfo.provider === 'azure') {
      return this.createAzurePullRequest(projectId, remoteInfo, input)
    }

    throw new Error('Unsupported remote provider.')
  }

  async generatePrDraft(input: GeneratePullRequestDraftInput): Promise<GeneratePullRequestDraftResult> {
    const project = requireProject(input.projectId)
    const template = await this.resolveTemplate(input.projectId)

    const [commitsResult, diffStatResult, diffResult] = await Promise.all([
      runGit(
        ['log', `origin/${input.baseBranch}..${input.headBranch}`, '--oneline', '--no-merges', '--max-count=20'],
        project.repoPath,
      ).catch(() => ({ exitCode: 0, stdout: '', stderr: '' })),
      runGit(
        ['diff', '--stat', `origin/${input.baseBranch}...${input.headBranch}`],
        project.repoPath,
      ).catch(() => ({ exitCode: 0, stdout: '', stderr: '' })),
      runGit(
        ['diff', `origin/${input.baseBranch}...${input.headBranch}`],
        project.repoPath,
      ).catch(() => ({ exitCode: 0, stdout: '', stderr: '' })),
    ])

    const commits = commitsResult.stdout.trim()
    const diffStat = diffStatResult.stdout.trim()
    let diff = diffResult.stdout.trim()

    const MAX_DIFF_CHARS = 100_000
    if (diff.length > MAX_DIFF_CHARS) {
      diff = diff.slice(0, MAX_DIFF_CHARS) + '\n[diff truncated due to size]'
    }

    const prompt = buildPrDraftPrompt({
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      commits,
      diffStat,
      diff,
      template,
    })

    try {
      const selection = await selectAnalysisAgent(this.context, input.projectId)
      const output = await runPrDraftAgent(this.context, selection, project.repoPath, prompt)

      const jsonMatch = output.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { title?: string; body?: string }
        if (parsed.title && parsed.body) {
          return { title: parsed.title, body: parsed.body }
        }
      }
    } catch {
      // fall through to template fallback
    }

    return {
      title: createDraftTitle(input.headBranch, input.baseBranch),
      body: template,
    }
  }

  async createPrFromDraft(
    input: CreatePullRequestFromDraftInput,
  ): Promise<CreatePullRequestResult> {
    return this.createPullRequest(input.projectId, {
      title: input.title,
      body: input.body,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
    })
  }

  async resolveTemplate(projectId: string): Promise<string> {
    const project = requireProject(projectId)
    const remoteInfo = await this.getRemoteInfo(projectId)
    return loadPrTemplate(project.repoPath, remoteInfo.provider)
  }

  private detectRemote(remoteUrl: string, providerType: GitProviderType): GitRemoteInfo {
    const cleaned = remoteUrl.replace(/\.git$/, '').trim()

    if (providerType === 'github') {
      const httpsMatch = cleaned.match(/^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/.]+)/)
      if (httpsMatch) {
        return { url: cleaned, provider: 'github', owner: httpsMatch[1], repo: httpsMatch[2] }
      }

      const sshMatch = cleaned.match(/^git@github\.com:([^/]+)\/([^/.]+)/)
      if (sshMatch) {
        return { url: cleaned, provider: 'github', owner: sshMatch[1], repo: sshMatch[2] }
      }
    }

    if (providerType === 'azure') {
      const httpsMatch = cleaned.match(/^https?:\/\/([^@]+)@?\.?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/)
      if (httpsMatch) {
        const [, , org, project, repo] = httpsMatch
        return { url: cleaned, provider: 'azure', owner: `${org}/${project}`, repo }
      }

      const vsMatch = cleaned.match(/^https?:\/\/[^@]*@?visualstudio\.com\/([^/]+)\/_git\/([^/]+)/)
      if (vsMatch) {
        return { url: cleaned, provider: 'azure', owner: vsMatch[1], repo: vsMatch[2] }
      }

      const sshMatch = cleaned.match(/^git@dev\.azure\.com:([^/]+)\/([^/.]+)/)
      if (sshMatch) {
        return { url: cleaned, provider: 'azure', owner: sshMatch[1], repo: sshMatch[2] }
      }
    }

    return { url: cleaned, provider: 'unsupported', owner: '', repo: '' }
  }

  private async createGitHubPullRequest(
    projectId: string,
    remoteInfo: GitRemoteInfo,
    input: Omit<CreatePullRequestInput, 'projectId'>,
  ): Promise<CreatePullRequestResult> {
    const project = requireProject(projectId)
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null

    if (token) {
      const apiUrl = `https://api.github.com/repos/${remoteInfo.owner}/${remoteInfo.repo}/pulls`
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.headBranch,
          base: input.baseBranch,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`GitHub API error: ${response.status} - ${error}`)
      }

      const data = await response.json() as { html_url: string; number: number }
      return { url: data.html_url, number: data.number }
    }

    return this.createGitHubPrViaCli(project.repoPath, input)
  }

  private async createGitHubPrViaCli(
    repoPath: string,
    input: Omit<CreatePullRequestInput, 'projectId'>,
  ): Promise<CreatePullRequestResult> {
    const { spawn } = await import('node:child_process')
    const command = resolveGhCommand()
    const env = buildProcessEnvironment()

    return new Promise((resolve, reject) => {
      const child = spawn(
        command,
        buildGhPrCreateArgs(input),
        { cwd: repoPath, env, stdio: ['pipe', 'pipe', 'pipe'] },
      )

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(new Error(
            'GitHub CLI was not found from the app process. Install `gh`, set GH_COMMAND to its full path, or set GITHUB_TOKEN/GH_TOKEN.',
          ))
          return
        }

        reject(new Error(error.message))
      })
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `gh pr create failed: ${code}`))
          return
        }

        const urlMatch = stdout.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)
        if (urlMatch) {
          const numberMatch = urlMatch[0].match(/\/pull\/(\d+)/)
          resolve({ url: urlMatch[0], number: numberMatch ? parseInt(numberMatch[1], 10) : 0 })
        } else {
          reject(new Error('Could not parse PR URL from gh output'))
        }
      })
    })
  }

  private async createAzurePullRequest(
    projectId: string,
    remoteInfo: GitRemoteInfo,
    input: Omit<CreatePullRequestInput, 'projectId'>,
  ): Promise<CreatePullRequestResult> {
    const token = process.env.AZURE_DEVOPS_PAT ?? process.env.AZURE_DEVOPS_TOKEN ?? process.env.AZURE_TOKEN

    if (!token) {
      throw new Error('Azure DevOps PAT not configured. Set AZURE_DEVOPS_PAT, AZURE_DEVOPS_TOKEN, or AZURE_TOKEN environment variable.')
    }

    const parts = remoteInfo.owner.split('/')
    if (parts.length !== 2) {
      throw new Error('Invalid Azure DevOps remote format. Expected {org}/{project}.')
    }

    const [org, project] = parts
    const repo = remoteInfo.repo
    const apiUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/pullrequests?api-version=7.1`

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: input.title,
        description: input.body,
        sourceRefName: `refs/heads/${input.headBranch}`,
        targetRefName: `refs/heads/${input.baseBranch}`,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Azure DevOps API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as { pullRequestId: number; remoteUrl: string }
    return { url: data.remoteUrl, number: data.pullRequestId }
  }

}

interface AnalysisAgentSelection {
  agentId: SupportedAgentId
  model: string
  runtimeSettings: AgentRuntimeSettings
}

interface AssistantTranscriptState {
  assistantText: string
  streamedText: string
}

const ANALYSIS_CANDIDATES: ReadonlyArray<{ agentId: SupportedAgentId; tier: ModelTier }> = [
  { agentId: 'codex', tier: 'lightweight' },
  { agentId: 'antigravity', tier: 'lightweight' },
  { agentId: 'opencode', tier: 'advanced' },
  { agentId: 'opencode', tier: 'balanced' },
  { agentId: 'claude-code', tier: 'lightweight' },
]

async function selectAnalysisAgent(
  context: MainIpcContext,
  projectId: string,
): Promise<AnalysisAgentSelection> {
  const settings = context.settingsService.getEffective(projectId).settings
  const enabledAgents = settings.agents.enabledAgentIds.filter(
    (agentId) => settings.agents.runtimes[agentId].enabled !== false,
  )

  for (const candidate of ANALYSIS_CANDIDATES) {
    if (!enabledAgents.includes(candidate.agentId)) continue
    const adapter = context.adapters.get(candidate.agentId)
    if (!adapter) continue

    try {
      if (!(await adapter.isInstalled())) continue
    } catch {
      continue
    }

    return {
      agentId: candidate.agentId,
      model: getModelForTier(candidate.agentId, candidate.tier, settings),
      runtimeSettings: {
        ...context.settingsService.getAgentRuntime(candidate.agentId, projectId),
        permissionMode: 'read-only',
      },
    }
  }

  for (const agentId of enabledAgents) {
    const adapter = context.adapters.get(agentId)
    if (!adapter) continue

    try {
      if (!(await adapter.isInstalled())) continue
    } catch {
      continue
    }

    return {
      agentId,
      model: getModelForTier(agentId, 'lightweight', settings),
      runtimeSettings: {
        ...context.settingsService.getAgentRuntime(agentId, projectId),
        permissionMode: 'read-only',
      },
    }
  }

  throw new Error('No lightweight analysis model is available. Enable Codex, Antigravity, or OpenCode first.')
}

async function runPrDraftAgent(
  context: MainIpcContext,
  selection: AnalysisAgentSelection,
  repoPath: string,
  prompt: string,
): Promise<string> {
  const adapter = context.adapters.get(selection.agentId)
  if (!adapter) {
    throw new Error(`Agent adapter is unavailable: ${selection.agentId}`)
  }

  const session = await adapter.dispatch({
    sessionId: `git-pr-draft-${randomUUID()}`,
    prompt,
    repoPath,
    model: selection.model,
    runtimeSettings: selection.runtimeSettings,
  })

  return new Promise((resolve, reject) => {
    const transcript: AssistantTranscriptState = {
      assistantText: '',
      streamedText: '',
    }
    const stderr: string[] = []
    let settled = false

    const timeout = setTimeout(() => {
      session.cancel()
      settleWithError(new Error('PR suggestion analysis timed out.'))
    }, 45_000)

    const settleWithError = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }

    const settleWithSuccess = (text: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(text)
    }

    session.events.on('event', (event: AgentEvent) => {
      if (event.type === 'stderr') {
        const text = extractTextFromPayload(event.payload)
        if (text.trim()) stderr.push(text.trim())
        return
      }

      if (event.type === 'error') {
        settleWithError(new Error(extractTextFromPayload(event.payload) || 'Analysis failed.'))
        return
      }

      for (const activityEvent of deriveActivityEvents(event)) {
        const payload = activityEvent.payload
        if (!isAssistantActivityMessage(payload)) continue

        if (payload.stream) {
          transcript.streamedText += payload.text
        } else {
          transcript.assistantText = payload.text
        }
      }

      if (event.type !== 'session-complete') return

      if (completionFailed(event.payload)) {
        settleWithError(
          new Error(
            extractTextFromPayload(event.payload) ||
              stderr.at(-1) ||
              'The agent failed to analyze the diff.',
          ),
        )
        return
      }

      const finalText = transcript.assistantText.trim() || transcript.streamedText.trim()
      if (!finalText) {
        settleWithError(new Error(stderr.at(-1) || 'The agent returned an empty response.'))
        return
      }

      settleWithSuccess(finalText)
    })
  })
}

function extractTextFromPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!isRecord(payload)) return ''

  if (typeof payload.text === 'string') return payload.text

  for (const field of ['message', 'content', 'delta', 'output', 'result', 'summary', 'error', 'item']) {
    const value = payload[field]
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      const nested = value.map((item) => extractTextFromPayload(item)).join('')
      if (nested) return nested
    }
    if (isRecord(value)) {
      const nested = extractTextFromPayload(value)
      if (nested) return nested
    }
  }

  return ''
}

function completionFailed(payload: unknown): boolean {
  if (!isRecord(payload)) return false
  if (payload.subtype === 'error' || payload.is_error === true) return true
  if (payload.status === 'error' || payload.status === 'cancelled') return true

  const exitCode = payload.exitCode ?? payload.exit_code
  return typeof exitCode === 'number' && exitCode !== 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAssistantActivityMessage(
  payload: unknown,
): payload is { kind: 'message'; role: 'assistant'; text: string; stream?: boolean } {
  return (
    isRecord(payload) &&
    payload.kind === 'message' &&
    payload.role === 'assistant' &&
    typeof payload.text === 'string'
  )
}
