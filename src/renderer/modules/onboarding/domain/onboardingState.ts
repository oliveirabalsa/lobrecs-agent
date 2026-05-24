export const ONBOARDING_STORAGE_KEY = 'lobrecs.onboarding.v1'

export const ONBOARDING_STEPS = ['agents', 'credentials', 'project', 'swarm'] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export interface OnboardingProgress {
  completed: boolean
  skipped: boolean
  step: OnboardingStep
  updatedAt: number
}

export type OnboardingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const DEFAULT_PROGRESS: OnboardingProgress = {
  completed: false,
  skipped: false,
  step: 'agents',
  updatedAt: 0,
}

export function readOnboardingProgress(
  storage: OnboardingStorage | null | undefined,
): OnboardingProgress {
  if (!storage) return { ...DEFAULT_PROGRESS }

  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PROGRESS }

    const parsed = JSON.parse(raw) as Partial<OnboardingProgress>
    const step = isOnboardingStep(parsed.step) ? parsed.step : DEFAULT_PROGRESS.step

    return {
      completed: parsed.completed === true,
      skipped: parsed.skipped === true,
      step,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return { ...DEFAULT_PROGRESS }
  }
}

export function shouldShowOnboarding(storage: OnboardingStorage | null | undefined): boolean {
  const progress = readOnboardingProgress(storage)
  return !progress.completed && !progress.skipped
}

export function saveOnboardingStep(
  storage: OnboardingStorage | null | undefined,
  step: OnboardingStep,
  now = Date.now(),
): OnboardingProgress {
  const next: OnboardingProgress = {
    completed: false,
    skipped: false,
    step,
    updatedAt: now,
  }
  writeProgress(storage, next)
  return next
}

export function markOnboardingComplete(
  storage: OnboardingStorage | null | undefined,
  now = Date.now(),
): OnboardingProgress {
  const next: OnboardingProgress = {
    completed: true,
    skipped: false,
    step: 'swarm',
    updatedAt: now,
  }
  writeProgress(storage, next)
  return next
}

export function markOnboardingSkipped(
  storage: OnboardingStorage | null | undefined,
  now = Date.now(),
): OnboardingProgress {
  const progress = readOnboardingProgress(storage)
  const next: OnboardingProgress = {
    completed: false,
    skipped: true,
    step: progress.step,
    updatedAt: now,
  }
  writeProgress(storage, next)
  return next
}

export function resetOnboarding(storage: OnboardingStorage | null | undefined): void {
  try {
    storage?.removeItem(ONBOARDING_STORAGE_KEY)
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function writeProgress(
  storage: OnboardingStorage | null | undefined,
  progress: OnboardingProgress,
): void {
  try {
    storage?.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // Keep onboarding usable even when persistence is unavailable.
  }
}

function isOnboardingStep(value: unknown): value is OnboardingStep {
  return ONBOARDING_STEPS.includes(value as OnboardingStep)
}
