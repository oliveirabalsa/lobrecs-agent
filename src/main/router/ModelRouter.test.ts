import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../modules/settings'
import { ModelRouter, type AdapterRegistry } from './ModelRouter'

function createRegistry(installed: Record<string, boolean>): AdapterRegistry {
  return {
    get(agentId) {
      const isInstalled = installed[agentId]

      if (isInstalled === undefined) {
        return undefined
      }

      return {
        isInstalled: () => isInstalled,
      }
    },
  }
}

describe('ModelRouter', () => {
  it('uses override model when specified', async () => {
    const router = new ModelRouter()
    const decision = await router.route({
      prompt: 'anything',
      modelOverride: 'claude-opus-4-7',
    })

    expect(decision.model).toBe('claude-opus-4-7')
    expect(decision.reasoning).toContain('Manual override')
  })

  it('routes simple task to lightweight', async () => {
    const router = new ModelRouter()
    const decision = await router.route({ prompt: 'fix typo in README' })

    expect(decision.tier).toBe('lightweight')
    expect(decision.agentId).toBe('opencode')
    expect(decision.model).toBe('minimax-coding-plan/MiniMax-M2')
  })

  it('uses an installed preferred agent with MODEL_MAP', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({ opencode: true, codex: true, 'claude-code': true }),
    })
    const decision = await router.route({
      prompt: 'fix typo in README',
      preferredAgentId: 'codex',
    })

    expect(decision.agentId).toBe('codex')
    expect(decision.model).toBe('gpt-5.3-codex-spark')
  })

  it('ignores preferredAgentId when autoAgentSelection is true', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({ codex: true, opencode: true, 'claude-code': true }),
    })
    const decision = await router.route({
      prompt: 'fix typo in README',
      preferredAgentId: 'codex',
      autoAgentSelection: true,
    })

    expect(decision.agentId).toBe('opencode')
    expect(decision.model).toBe('minimax-coding-plan/MiniMax-M2')
  })

  it('routes complex prompts via AUTO mode to Codex before Claude', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({ codex: true, 'claude-code': true }),
    })
    const decision = await router.route({
      prompt:
        'design and implement a new authentication microservice with JWT, kafka integration, and a thorough security review of the existing code',
      preferredAgentId: 'codex',
      autoAgentSelection: true,
    })

    expect(['advanced', 'frontier']).toContain(decision.tier)
    expect(decision.agentId).toBe('codex')
  })

  it('routes installed Antigravity preferences through the Antigravity model map', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({ antigravity: true, 'claude-code': true }),
    })
    const decision = await router.route({
      prompt: 'fix typo in README',
      preferredAgentId: 'antigravity',
    })

    expect(decision.agentId).toBe('antigravity')
    expect(decision.model).toBe('gemini-2.0-flash-lite')
  })

  it('uses live Codex catalog models instead of stale static fallbacks', async () => {
    const router = new ModelRouter({
      adapterRegistry: {
        get(agentId) {
          if (agentId !== 'codex') return { isInstalled: () => true }
          return {
            isInstalled: () => true,
            listModels: async () => [
              {
                id: 'gpt-5.4-mini',
                label: 'GPT-5.4 Mini',
                agentId: 'codex',
                tier: 'lightweight',
                source: 'cli',
              },
              {
                id: 'gpt-5.5',
                label: 'GPT-5.5',
                agentId: 'codex',
                tier: 'frontier',
                source: 'cli',
              },
            ],
          }
        },
      },
    })

    const decision = await router.route({
      prompt: 'fix typo in README',
      preferredAgentId: 'codex',
    })

    expect(decision.model).toBe('gpt-5.4-mini')
  })

  it('falls back to claude-code when the preferred agent is unavailable', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({ codex: false, 'claude-code': true }),
    })
    const decision = await router.route({
      prompt: 'fix typo in README',
      preferredAgentId: 'codex',
    })

    expect(decision.agentId).toBe('claude-code')
  })

  it('falls back to another installed adapter when preferred and default adapters are unavailable', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({
        codex: false,
        'claude-code': false,
        opencode: true,
      }),
    })
    const decision = await router.route({
      prompt: 'fix typo in README',
      preferredAgentId: 'codex',
    })

    expect(decision.agentId).toBe('opencode')
    expect(decision.model).toBe('minimax-coding-plan/MiniMax-M2')
  })

  it('does not dispatch an unavailable adapter just because it has a manual override', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({
        codex: false,
        'claude-code': false,
        opencode: true,
      }),
    })
    const decision = await router.route({
      prompt: 'fix complex routing bug',
      preferredAgentId: 'codex',
      modelOverride: 'gpt-5.5',
    })

    expect(decision.agentId).toBe('opencode')
    expect(decision.model).toBe('minimax-coding-plan/MiniMax-M2.7')
    expect(decision.reasoning).toContain('unavailable')
  })

  it('keeps frontier tasks off opencode when a stronger adapter is available', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({ opencode: true, codex: true, 'claude-code': false }),
    })
    const decision = await router.route({
      prompt:
        'design and implement a new microservice with Kafka integration, security review, database schema, API endpoint, adapter registry, packages, src/main/router/ModelRouter.ts, src/main/cost/pricing.ts, src/shared/types.ts, package.json, electron.vite.config.ts, and migration strategy',
      preferredAgentId: 'opencode',
      recentFailures: [
        {
          prompt:
            'design and implement a new microservice with Kafka integration, security review, database schema, API endpoint, adapter registry, packages, and migration strategy',
          tier: 'advanced',
          failed: true,
        },
      ],
    })

    expect(decision.tier).toBe('frontier')
    expect(decision.agentId).toBe('codex')
    expect(decision.model).toBe('gpt-5.5')
  })

  it('routes security investigation prompts to a stronger Claude model', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({ 'claude-code': true }),
    })
    const decision = await router.route({
      prompt: 'I want to check code securities issues, go each piece of the code and investigate',
      preferredAgentId: 'claude-code',
    })

    expect(decision.agentId).toBe('claude-code')
    expect(decision.tier).toBe('advanced')
    expect(decision.model).toBe('claude-opus-4-7')
  })

  it('uses settings-backed model maps and disabled agent routing', async () => {
    const router = new ModelRouter({
      adapterRegistry: createRegistry({
        codex: true,
        'claude-code': true,
        opencode: true,
      }),
      settingsProvider: () => ({
        ...DEFAULT_APP_SETTINGS,
        agents: {
          ...DEFAULT_APP_SETTINGS.agents,
          defaultAgentId: 'codex',
          fallbackAgentId: 'opencode',
          enabledAgentIds: ['codex', 'opencode'],
          runtimes: {
            ...DEFAULT_APP_SETTINGS.agents.runtimes,
            'claude-code': {
              ...DEFAULT_APP_SETTINGS.agents.runtimes['claude-code'],
              enabled: false,
            },
          },
          modelMap: {
            ...DEFAULT_APP_SETTINGS.agents.modelMap,
            codex: {
              ...DEFAULT_APP_SETTINGS.agents.modelMap.codex,
              lightweight: 'custom-codex-light',
            },
          },
        },
      }),
    })

    const decision = await router.route({
      prompt: 'fix typo',
      preferredAgentId: 'claude-code',
    })

    expect(decision.agentId).toBe('codex')
    expect(decision.model).toBe('custom-codex-light')
  })

  describe('image-aware routing', () => {
    it('routes to an image-capable agent if the preferred agent resolved model does not support images', async () => {
      const router = new ModelRouter({
        adapterRegistry: createRegistry({
          codex: true,
          opencode: true,
          'claude-code': true,
        }),
      })

      const decision = await router.route({
        prompt: 'analyze UI layout',
        preferredAgentId: 'opencode', // MiniMax models don't support images
        requiresImageSupport: true,
      })

      expect(decision.agentId).toBe('codex')
      expect(decision.model).toBe('gpt-5.3-codex-spark')
    })

    it('stays on opencode if model override supports images', async () => {
      const router = new ModelRouter({
        adapterRegistry: createRegistry({
          opencode: true,
          'claude-code': true,
        }),
      })

      const decision = await router.route({
        prompt: 'analyze UI layout',
        preferredAgentId: 'opencode',
        modelOverride: 'gpt-4o',
        requiresImageSupport: true,
      })

      expect(decision.agentId).toBe('opencode')
      expect(decision.model).toBe('gpt-4o')
    })

    it('throws when model override does not support images', async () => {
      const router = new ModelRouter({
        adapterRegistry: createRegistry({
          opencode: true,
        }),
      })

      await expect(
        router.route({
          prompt: 'analyze UI layout',
          preferredAgentId: 'opencode',
          modelOverride: 'minimax-coding-plan/MiniMax-M2',
          requiresImageSupport: true,
        })
      ).rejects.toThrow('Manual image-capable model required')
    })

    it('routes to antigravity with gemini models when image support is required', async () => {
      const router = new ModelRouter({
        adapterRegistry: createRegistry({
          antigravity: true,
          opencode: true,
        }),
      })

      const decision = await router.route({
        prompt: 'process layout screenshot',
        preferredAgentId: 'antigravity',
        requiresImageSupport: true,
      })

      expect(decision.agentId).toBe('antigravity')
      expect(decision.model).toBe('gemini-2.0-flash-lite')
    })
  })
})
