import { describe, expect, it } from 'vitest'
import {
  buildAgentPrompt,
  buildManagedPhaseOutput,
  buildSwarmThreadTitle,
} from './swarmHelpers'

describe('swarmHelpers', () => {
  describe('buildAgentPrompt', () => {
    it('wraps role in bracket notation', () => {
      const result = buildAgentPrompt(
        'Do something',
        { role: 'implementer', agentId: 'claude-code' },
      )
      expect(result).toContain('[Role: implementer]')
    })

    it('includes base prompt after role', () => {
      const result = buildAgentPrompt(
        'Fix the bug',
        { role: 'reviewer', agentId: 'codex' },
      )
      expect(result).toContain('Fix the bug')
    })

    it('appends previous output with context label', () => {
      const result = buildAgentPrompt(
        'Continue work',
        { role: 'implementer', agentId: 'claude-code' },
        'previous output here',
        { contextLabel: 'Context from previous step' },
      )
      expect(result).toContain('Context from previous step:')
      expect(result).toContain('previous output here')
    })

    it('uses default context label when not provided', () => {
      const result = buildAgentPrompt(
        'Continue',
        { role: 'implementer', agentId: 'claude-code' },
        'output',
      )
      expect(result).toContain('Context from previous step:')
    })

    it('appends promptSuffix when provided', () => {
      const result = buildAgentPrompt(
        'Build',
        { role: 'implementer', agentId: 'claude-code', promptSuffix: 'Be careful' },
      )
      expect(result).toContain('Be careful')
    })

    it('appends extraInstruction when provided', () => {
      const result = buildAgentPrompt(
        'Review',
        { role: 'reviewer', agentId: 'codex' },
        undefined,
        { extraInstruction: 'Check for bugs' },
      )
      expect(result).toContain('Check for bugs')
    })
  })

  describe('buildManagedPhaseOutput', () => {
    it('returns empty string for empty sessions', () => {
      expect(buildManagedPhaseOutput([])).toBe('')
    })

    it('formats session role and output', () => {
      const result = buildManagedPhaseOutput([
        { role: 'planner', output: 'Plan text' },
      ])
      expect(result).toContain('[planner]')
      expect(result).toContain('Plan text')
    })

    it('filters sessions without output', () => {
      const result = buildManagedPhaseOutput([
        { role: 'planner', output: 'Plan text' },
        { role: 'implementer' },
      ])
      expect(result).not.toContain('[implementer]')
    })

    it('joins multiple sessions with double newlines', () => {
      const result = buildManagedPhaseOutput([
        { role: 'planner', output: 'Plan' },
        { role: 'implementer', output: 'Impl' },
      ])
      expect(result).toContain('\n\n')
    })
  })

  describe('buildSwarmThreadTitle', () => {
    it('uses Swarm prefix for parallel strategy', () => {
      const result = buildSwarmThreadTitle({
        projectId: 'p1',
        prompt: 'Review code',
        strategy: 'parallel',
        agents: [],
      })
      expect(result).toBe('Swarm: Review code')
    })

    it('uses Sequential swarm prefix for sequential strategy', () => {
      const result = buildSwarmThreadTitle({
        projectId: 'p1',
        prompt: 'Refactor',
        strategy: 'sequential',
        agents: [],
      })
      expect(result).toBe('Sequential swarm: Refactor')
    })

    it('uses Managed swarm prefix for managed strategy', () => {
      const result = buildSwarmThreadTitle({
        projectId: 'p1',
        prompt: 'Build feature',
        strategy: 'managed',
        agents: [],
      })
      expect(result).toBe('Managed swarm: Build feature')
    })

    it('uses Multitask prefix for multitask strategy', () => {
      const result = buildSwarmThreadTitle({
        projectId: 'p1',
        prompt: 'Process items',
        strategy: 'multitask',
        agents: [],
      })
      expect(result).toBe('Multitask: Process items')
    })

    it('truncates title to 200 characters', () => {
      const longPrompt = 'A'.repeat(250)
      const result = buildSwarmThreadTitle({
        projectId: 'p1',
        prompt: longPrompt,
        strategy: 'parallel',
        agents: [],
      })
      expect(result.length).toBe(200)
    })

    it('uses just prefix when prompt is empty', () => {
      const result = buildSwarmThreadTitle({
        projectId: 'p1',
        prompt: '   ',
        strategy: 'parallel',
        agents: [],
      })
      expect(result).toBe('Swarm')
    })
  })
})
