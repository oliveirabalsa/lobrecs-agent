import { MODEL_MAP } from '../../../../shared/types'
import type { AppSettings, SwarmTemplate, VerificationRecipe } from '../../../../shared/types'

export const DEFAULT_VERIFICATION_RECIPES: VerificationRecipe[] = [
  {
    id: 'build',
    label: 'Build',
    command: 'rtk npm run build',
    scope: 'build',
    description: 'Type-check and build production assets.',
  },
  {
    id: 'test',
    label: 'Tests',
    command: 'rtk npm test',
    scope: 'test',
    description: 'Run the Vitest suite.',
  },
  {
    id: 'lint',
    label: 'Lint',
    command: 'rtk npm run lint',
    scope: 'lint',
    description: 'Run project linting when a lint script exists.',
  },
  {
    id: 'ui-check',
    label: 'UI Check',
    command: 'rtk npm run preview',
    scope: 'ui',
    description: 'Launch a preview build for manual or browser signoff.',
  },
]

export const DEFAULT_SWARM_ROLE_PROMPTS: Record<string, string> = {
  planner:
    'Analyze the task deeply and produce a concrete implementation plan: which files to create or modify, what logic to add, and why. Your output feeds directly into the implementer.',
  implementer:
    'Follow the plan precisely. Write complete, production-ready code. Do not leave placeholders or skip steps.',
  reviewer:
    'Review the implementation for correctness, bugs, edge cases, and code quality. Be specific and actionable in your feedback.',
}

export const DEFAULT_SWARM_TEMPLATES: SwarmTemplate[] = [
  {
    id: 'security-quality',
    label: 'Security + Quality Review',
    strategy: 'parallel',
    agents: [
      {
        role: 'security analyzer',
        agentId: 'claude-code',
        promptSuffix: 'Focus on security vulnerabilities, secret handling, and unsafe IO.',
      },
      {
        role: 'code quality',
        agentId: 'codex',
        promptSuffix: 'Focus on correctness, maintainability, and missing tests.',
      },
    ],
  },
  {
    id: 'plan-implement-review',
    label: 'Plan -> Implement -> Review',
    strategy: 'sequential',
    agents: [
      {
        role: 'planner',
        agentId: 'claude-code',
        promptSuffix: DEFAULT_SWARM_ROLE_PROMPTS.planner,
      },
      {
        role: 'implementer',
        agentId: 'codex',
        promptSuffix: DEFAULT_SWARM_ROLE_PROMPTS.implementer,
      },
      {
        role: 'reviewer',
        agentId: 'claude-code',
        promptSuffix: DEFAULT_SWARM_ROLE_PROMPTS.reviewer,
      },
    ],
  },
  {
    id: 'multi-approach',
    label: 'Multi-approach',
    strategy: 'parallel',
    agents: [
      { role: 'approach a', agentId: 'claude-code' },
      { role: 'approach b', agentId: 'codex' },
      { role: 'approach c', agentId: 'opencode' },
    ],
  },
]

export const DEFAULT_APP_SETTINGS: AppSettings = {
  schemaVersion: 1,
  general: {
    appName: 'Lobrecs Agent',
    startOnLaunch: false,
    openLastProjectOnLaunch: true,
    enableDesktopNotifications: true,
    checkForUpdates: true,
  },
  agents: {
    defaultAgentId: 'claude-code',
    fallbackAgentId: 'claude-code',
    enabledAgentIds: ['claude-code', 'codex', 'opencode'],
    runtimes: {
      'claude-code': {
        enabled: true,
        command: '',
        permissionMode: 'dangerous',
        extraArgs: [],
      },
      codex: {
        enabled: true,
        command: '',
        permissionMode: 'dangerous',
        extraArgs: [],
      },
      opencode: {
        enabled: true,
        command: '',
        permissionMode: 'dangerous',
        extraArgs: [],
      },
    },
    modelMap: {
      'claude-code': { ...MODEL_MAP['claude-code'] },
      codex: { ...MODEL_MAP.codex },
      opencode: { ...MODEL_MAP.opencode },
    },
    imageAttachments: {
      maxCount: 8,
      maxSizeMb: 20,
    },
  },
  routing: {
    tierThresholds: {
      lightweightMax: 30,
      balancedMax: 65,
      advancedMax: 85,
    },
    securityMinimumTier: 'advanced',
    allowOpenCodeForFrontier: false,
    useRecentFailureEscalation: true,
  },
  execution: {
    worktreeIsolation: false,
    autoApplyCompletedDiffs: true,
    defaultApprovalMode: 'dangerous',
    maxQueuedMessagesPerThread: 20,
    commandPrefix: 'rtk',
    warnWhenCommandMissingPrefix: true,
    sessionOutputRetentionDays: 30,
  },
  swarms: {
    defaultStrategy: 'parallel',
    maxAgents: 8,
    maxReviewerIterations: 3,
    defaultAgents: [
      { role: 'implementer', agentId: 'claude-code' },
      { role: 'reviewer', agentId: 'codex' },
    ],
    rolePrompts: { ...DEFAULT_SWARM_ROLE_PROMPTS },
    templates: DEFAULT_SWARM_TEMPLATES.map((template) => ({
      ...template,
      agents: template.agents.map((agent) => ({ ...agent })),
    })),
  },
  specs: {
    defaultAgentIds: ['codex'],
    defaultRunMode: 'local',
    defaultVerificationRecipeIds: ['build', 'test'],
    targetFileLimit: 12,
    requireApprovalBeforeRun: true,
  },
  verification: {
    recipes: DEFAULT_VERIFICATION_RECIPES.map((recipe) => ({ ...recipe })),
    requireCommandPrefix: true,
    maxOutputBytes: 512_000,
    defaultTimeoutSeconds: 120,
  },
  costs: {
    currency: 'USD',
    monthlyBudgetUsd: 50,
    warnAtPercent: 80,
    pricing: {
      'claude-haiku-4-5-20251001': { inputPer1M: 0.8, outputPer1M: 4 },
      'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
      'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 25 },
      'claude-opus-4-6': { inputPer1M: 15, outputPer1M: 75 },
      'gpt-5.3-codex-spark': { inputPer1M: 0.25, outputPer1M: 1 },
      'gpt-5.3-codex': { inputPer1M: 0.5, outputPer1M: 2.5 },
      'gpt-5.4-mini': { inputPer1M: 0.5, outputPer1M: 2 },
      'gpt-5.4': { inputPer1M: 2, outputPer1M: 8 },
      'gpt-5.5': { inputPer1M: 15, outputPer1M: 30 },
      minimax: { inputPer1M: 0.1, outputPer1M: 0.3 },
      'minimax-coding-plan/MiniMax-M2': { inputPer1M: 0.1, outputPer1M: 0.3 },
      'minimax-coding-plan/MiniMax-M2.5': { inputPer1M: 0.1, outputPer1M: 0.3 },
      'minimax-coding-plan/MiniMax-M2.7': { inputPer1M: 0.1, outputPer1M: 0.3 },
    },
  },
  ui: {
    compactMode: false,
    sidebarDefaultWidth: 260,
    rightPanelDefaultOpen: false,
    rightPanelDefaultMode: 'diff',
    terminalDefaultHeight: 260,
    showCostBadges: true,
    showTokenCounts: true,
  },
  editor: {
    defaultEditorId: '',
    cliEditorId: 'shell',
    fontSize: 13,
    tabSize: 2,
    wordWrap: true,
    formatOnSave: false,
  },
}
