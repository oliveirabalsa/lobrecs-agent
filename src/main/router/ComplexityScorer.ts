import type { ModelTier, RoutingSettings } from '../../shared/types'

export interface ScoringResult {
  score: number
  tier: ModelTier
  signals: ScoringSignal[]
  reasoning: string
}

export interface ScoringSignal {
  name: string
  score: number
  weight: number
  matched: boolean
}

export interface ScoringContext {
  repoPath?: string
  recentFailures?: Array<{ prompt: string; tier: ModelTier; failed: boolean }>
  tierThresholds?: RoutingSettings['tierThresholds']
  securityMinimumTier?: ModelTier
  useRecentFailureEscalation?: boolean
}

const SIGNAL_WEIGHTS = {
  length: 0.05,
  reasoningKeywords: 0.3,
  newCreation: 0.2,
  crossService: 0.2,
  fileCount: 0.05,
  history: 0.05,
  riskReview: 0.15,
} as const

const REASONING_KEYWORDS = [
  'architect',
  'architecture',
  'auth',
  'database',
  'design',
  'jwt',
  'kafka',
  'migrate',
  'migration',
  'payment',
  'performance',
  'refactor',
  'scalab',
  'schema',
  'security',
  'strategy',
  'system',
  'tradeoff',
  'new module',
  'new service',
  'from scratch',
]

const NEW_CREATION_KEYWORDS = [
  'add support',
  'build',
  'create',
  'criar',
  'develop',
  'implement',
  'new',
  'novo',
  'from scratch',
]

const CROSS_SERVICE_KEYWORDS = [
  'adapter',
  'api',
  'database',
  'endpoint',
  'integration',
  'ipc',
  'kafka',
  'microservice',
  'module',
  'package',
  'preload',
  'queue',
  'registry',
  'renderer',
  'schema',
  'service',
  'worker',
]

const RISK_REVIEW_KEYWORDS = [
  'audit',
  'injection',
  'secret',
  'secrets',
  'securities',
  'security',
  'security issues',
  'security review',
  'vulnerabilities',
  'vulnerability',
]

const TIER_THRESHOLDS = {
  lightweightMax: 30,
  balancedMax: 65,
  advancedMax: 85,
} as const

export function scoreComplexity(prompt: string, context?: ScoringContext): ScoringResult {
  const normalizedPrompt = prompt.trim()
  const signals: ScoringSignal[] = [
    scoreLengthSignal(normalizedPrompt),
    scoreReasoningKeywords(normalizedPrompt),
    scoreNewCreationKeywords(normalizedPrompt),
    scoreCrossServiceKeywords(normalizedPrompt),
    scoreFileCountEstimate(normalizedPrompt),
    scoreHistorySignal(
      normalizedPrompt,
      context?.useRecentFailureEscalation === false ? undefined : context?.recentFailures,
    ),
    scoreRiskReviewKeywords(normalizedPrompt),
  ]

  const weightedScore = clampScore(
    signals.reduce((acc, signal) => acc + signal.score * signal.weight, 0),
  )
  const riskReview = signals.find((signal) => signal.name === 'risk-review')
  const totalScore = riskReview?.matched ? Math.max(weightedScore, 70) : weightedScore
  const roundedScore = Math.round(totalScore)
  const initialTier = scoreToTierResult(roundedScore, context?.tierThresholds)
  const tier = riskReview?.matched
    ? maxTier(initialTier, context?.securityMinimumTier ?? 'advanced')
    : initialTier

  return {
    score: roundedScore,
    tier,
    signals,
    reasoning: buildReasoning(signals, roundedScore, tier),
  }
}

function scoreLengthSignal(prompt: string): ScoringSignal {
  const words = tokenize(prompt).length
  const score = clampScore((words / 50) * 100)

  return {
    name: 'prompt-length',
    score,
    weight: SIGNAL_WEIGHTS.length,
    matched: words > 20,
  }
}

function scoreReasoningKeywords(prompt: string): ScoringSignal {
  const matches = countKeywordMatches(prompt, REASONING_KEYWORDS)
  const score = clampScore(matches * 35)

  return {
    name: 'reasoning-keywords',
    score,
    weight: SIGNAL_WEIGHTS.reasoningKeywords,
    matched: matches > 0,
  }
}

function scoreNewCreationKeywords(prompt: string): ScoringSignal {
  const matches = countKeywordMatches(prompt, NEW_CREATION_KEYWORDS)
  const score = matches === 0 ? 0 : matches === 1 ? 60 : 100

  return {
    name: 'new-creation',
    score,
    weight: SIGNAL_WEIGHTS.newCreation,
    matched: matches > 0,
  }
}

function scoreCrossServiceKeywords(prompt: string): ScoringSignal {
  const matches = countKeywordMatches(prompt, CROSS_SERVICE_KEYWORDS)
  const score = matches === 0 ? 0 : matches === 1 ? 50 : matches === 2 ? 75 : 100

  return {
    name: 'cross-service',
    score,
    weight: SIGNAL_WEIGHTS.crossService,
    matched: matches > 0,
  }
}

function scoreFileCountEstimate(prompt: string): ScoringSignal {
  const filePattern =
    /(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|go|py|rs|kt|java|sql|yaml|yml|json|md)\b/gi
  const matches = new Set(prompt.match(filePattern) ?? []).size
  const score = clampScore(matches * 25)

  return {
    name: 'file-count',
    score,
    weight: SIGNAL_WEIGHTS.fileCount,
    matched: matches > 1,
  }
}

function scoreRiskReviewKeywords(prompt: string): ScoringSignal {
  const matches = countKeywordMatches(prompt, RISK_REVIEW_KEYWORDS)
  const score = matches === 0 ? 0 : matches === 1 ? 80 : 100

  return {
    name: 'risk-review',
    score,
    weight: SIGNAL_WEIGHTS.riskReview,
    matched: matches > 0,
  }
}

function scoreHistorySignal(
  prompt: string,
  recentFailures?: Array<{ prompt: string; tier: ModelTier; failed: boolean }>,
): ScoringSignal {
  if (!recentFailures?.length) {
    return {
      name: 'history',
      score: 0,
      weight: SIGNAL_WEIGHTS.history,
      matched: false,
    }
  }

  const similarFailures = recentFailures.filter(
    (failure) =>
      failure.failed &&
      failure.tier !== 'frontier' &&
      cosineSimilaritySimple(prompt, failure.prompt) > 0.5,
  )
  const score = similarFailures.length === 0 ? 0 : similarFailures.length === 1 ? 80 : 100

  return {
    name: 'history',
    score,
    weight: SIGNAL_WEIGHTS.history,
    matched: similarFailures.length > 0,
  }
}

function cosineSimilaritySimple(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))

  if (setA.size === 0 || setB.size === 0) {
    return 0
  }

  const intersectionSize = [...setA].filter((token) => setB.has(token)).length
  return intersectionSize / Math.sqrt(setA.size * setB.size)
}

function scoreToTierResult(
  score: number,
  thresholds: ScoringContext['tierThresholds'] = TIER_THRESHOLDS,
): ModelTier {
  if (score <= thresholds.lightweightMax) {
    return 'lightweight'
  }
  if (score <= thresholds.balancedMax) {
    return 'balanced'
  }
  if (score <= thresholds.advancedMax) {
    return 'advanced'
  }
  return 'frontier'
}

function maxTier(current: ModelTier, minimum: ModelTier): ModelTier {
  const tiers: ModelTier[] = ['lightweight', 'balanced', 'advanced', 'frontier']
  return tiers.indexOf(current) >= tiers.indexOf(minimum) ? current : minimum
}

function buildReasoning(signals: ScoringSignal[], score: number, tier: ModelTier): string {
  const activeSignals = signals.filter((signal) => signal.matched).map((signal) => signal.name)

  if (activeSignals.length === 0) {
    return `Simple task: score ${score}, using ${tier} tier`
  }

  return `Signals: ${activeSignals.join(', ')}. Score ${score}, using ${tier} tier`
}

function countKeywordMatches(prompt: string, keywords: string[]): number {
  const lower = prompt.toLowerCase()
  return keywords.filter((keyword) => lower.includes(keyword)).length
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_-]+/i)
    .filter(Boolean)
}

function clampScore(score: number): number {
  if (!Number.isFinite(score) || score < 0) {
    return 0
  }

  return Math.min(100, score)
}
