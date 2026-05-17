import { describe, expect, it } from 'vitest'
import { scoreComplexity } from './ComplexityScorer'

describe('scoreComplexity', () => {
  it('rates a simple bug fix as lightweight', () => {
    const result = scoreComplexity('fix the typo in the button label')

    expect(result.tier).toBe('lightweight')
    expect(result.score).toBeLessThan(30)
  })

  it('rates a refactor as balanced', () => {
    const result = scoreComplexity('refactor the auth service to use JWT tokens')

    expect(['balanced', 'advanced']).toContain(result.tier)
  })

  it('rates a system design as advanced or frontier', () => {
    const result = scoreComplexity(
      'design and implement a new microservice for payment processing with Kafka integration and security review',
    )

    expect(['advanced', 'frontier']).toContain(result.tier)
    expect(result.score).toBeGreaterThan(60)
  })

  it('routes security audits to advanced or stronger models', () => {
    const result = scoreComplexity('check code security issues and vulnerabilities across the repo')

    expect(['advanced', 'frontier']).toContain(result.tier)
    expect(result.signals.find((signal) => signal.name === 'risk-review')?.matched).toBe(true)
  })

  it('returns signals array with all weights', () => {
    const result = scoreComplexity('anything')
    const totalWeight = result.signals.reduce((acc, signal) => acc + signal.weight, 0)

    expect(totalWeight).toBeCloseTo(1.0, 1)
  })

  it('raises the score when a similar non-frontier task failed recently', () => {
    const baseline = scoreComplexity('refactor auth token validation')
    const withHistory = scoreComplexity('refactor auth token validation', {
      recentFailures: [
        {
          prompt: 'refactor auth token validation',
          tier: 'lightweight',
          failed: true,
        },
      ],
    })

    expect(withHistory.score).toBeGreaterThan(baseline.score)
    expect(withHistory.signals.find((signal) => signal.name === 'history')?.matched).toBe(true)
  })
})
