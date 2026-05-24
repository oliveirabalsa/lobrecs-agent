import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_STORAGE_KEY,
  markOnboardingComplete,
  markOnboardingSkipped,
  readOnboardingProgress,
  resetOnboarding,
  saveOnboardingStep,
  shouldShowOnboarding,
  type OnboardingStorage,
} from './onboardingState'

function createStorage(): OnboardingStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

describe('onboarding state', () => {
  it('shows onboarding when no progress is stored', () => {
    expect(shouldShowOnboarding(createStorage())).toBe(true)
  })

  it('persists the current step without completing the flow', () => {
    const storage = createStorage()

    saveOnboardingStep(storage, 'project', 100)

    expect(readOnboardingProgress(storage)).toEqual({
      completed: false,
      skipped: false,
      step: 'project',
      updatedAt: 100,
    })
    expect(shouldShowOnboarding(storage)).toBe(true)
  })

  it('hides onboarding after completion or skip', () => {
    const completed = createStorage()
    const skipped = createStorage()

    markOnboardingComplete(completed, 200)
    markOnboardingSkipped(skipped, 300)

    expect(shouldShowOnboarding(completed)).toBe(false)
    expect(shouldShowOnboarding(skipped)).toBe(false)
  })

  it('can reset onboarding for replay', () => {
    const storage = createStorage()
    markOnboardingComplete(storage, 200)

    resetOnboarding(storage)

    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull()
    expect(shouldShowOnboarding(storage)).toBe(true)
  })

  it('falls back to the first step when stored data is invalid', () => {
    const storage = createStorage()
    storage.setItem(ONBOARDING_STORAGE_KEY, '{"step":"unknown","updatedAt":"soon"}')

    expect(readOnboardingProgress(storage)).toEqual({
      completed: false,
      skipped: false,
      step: 'agents',
      updatedAt: 0,
    })
  })
})
