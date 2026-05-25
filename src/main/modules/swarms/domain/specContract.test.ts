import { describe, expect, it } from 'vitest'
import {
  extractSpecContract,
  buildSpecContext,
  PLANNER_SDD_INSTRUCTION,
  IMPLEMENTER_SPEC_INSTRUCTION,
  VERIFIER_SPEC_INSTRUCTION,
  type SpecContract,
} from './specContract'

const VALID_SPEC: SpecContract = {
  acceptanceCriteria: [
    { id: 'AC-1', description: 'User can log in with email and password', testable: true },
    { id: 'AC-2', description: 'Invalid credentials show an error message', testable: true },
  ],
  interfaces: [
    {
      name: 'authenticateUser',
      signature: '(email: string, password: string) => Promise<AuthResult>',
      file: 'src/auth/authenticate.ts',
    },
  ],
  fileManifest: [
    { path: 'src/auth/authenticate.ts', action: 'create', purpose: 'Authentication logic' },
    { path: 'src/auth/types.ts', action: 'create', purpose: 'Auth type definitions' },
  ],
  testScenarios: [
    { id: 'TS-1', description: 'Valid credentials return a session token', covers: ['AC-1'] },
    { id: 'TS-2', description: 'Invalid password returns error', covers: ['AC-2'] },
  ],
}

function wrapInPlannerOutput(specJson: string): string {
  return [
    '## Approach',
    'We will implement email/password authentication using bcrypt for hashing.',
    '',
    '## Spec Contract',
    '```json',
    specJson,
    '```',
    '',
    '## Rationale',
    'Bcrypt is the standard for password hashing in Node.js applications.',
  ].join('\n')
}

describe('extractSpecContract', () => {
  it('extracts a valid spec from markdown with fenced JSON block', () => {
    const output = wrapInPlannerOutput(JSON.stringify(VALID_SPEC, null, 2))
    const spec = extractSpecContract(output)

    expect(spec).not.toBeNull()
    expect(spec!.acceptanceCriteria).toHaveLength(2)
    expect(spec!.acceptanceCriteria[0].id).toBe('AC-1')
    expect(spec!.interfaces).toHaveLength(1)
    expect(spec!.fileManifest).toHaveLength(2)
    expect(spec!.testScenarios).toHaveLength(2)
  })

  it('extracts spec from raw JSON without markdown wrapping', () => {
    const spec = extractSpecContract(JSON.stringify(VALID_SPEC))
    expect(spec).not.toBeNull()
    expect(spec!.acceptanceCriteria[0].id).toBe('AC-1')
  })

  it('returns null for output without a spec contract', () => {
    const output = 'Here is my plan:\n1. Do this\n2. Do that'
    expect(extractSpecContract(output)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    const output = '## Spec Contract\n```json\n{invalid json}\n```'
    expect(extractSpecContract(output)).toBeNull()
  })

  it('returns null when acceptanceCriteria is missing', () => {
    const spec = { interfaces: [], fileManifest: [], testScenarios: [] }
    const output = wrapInPlannerOutput(JSON.stringify(spec))
    expect(extractSpecContract(output)).toBeNull()
  })

  it('returns null when acceptanceCriteria is empty', () => {
    const spec = { acceptanceCriteria: [], interfaces: [], fileManifest: [], testScenarios: [] }
    const output = wrapInPlannerOutput(JSON.stringify(spec))
    expect(extractSpecContract(output)).toBeNull()
  })

  it('defaults testable to true when omitted', () => {
    const spec = {
      acceptanceCriteria: [{ id: 'AC-1', description: 'Something works' }],
    }
    const result = extractSpecContract(wrapInPlannerOutput(JSON.stringify(spec)))
    expect(result!.acceptanceCriteria[0].testable).toBe(true)
  })

  it('preserves testable: false when explicitly set', () => {
    const spec = {
      acceptanceCriteria: [{ id: 'AC-1', description: 'Design is clean', testable: false }],
    }
    const result = extractSpecContract(wrapInPlannerOutput(JSON.stringify(spec)))
    expect(result!.acceptanceCriteria[0].testable).toBe(false)
  })

  it('tolerates missing optional arrays', () => {
    const spec = {
      acceptanceCriteria: [{ id: 'AC-1', description: 'Works', testable: true }],
    }
    const result = extractSpecContract(wrapInPlannerOutput(JSON.stringify(spec)))
    expect(result!.interfaces).toEqual([])
    expect(result!.fileManifest).toEqual([])
    expect(result!.testScenarios).toEqual([])
  })

  it('skips malformed interface entries', () => {
    const spec = {
      acceptanceCriteria: [{ id: 'AC-1', description: 'Works', testable: true }],
      interfaces: [
        { name: 'good', signature: 'fn()', file: 'a.ts' },
        { name: 'bad' },
        'not an object',
      ],
    }
    const result = extractSpecContract(wrapInPlannerOutput(JSON.stringify(spec)))
    expect(result!.interfaces).toHaveLength(1)
    expect(result!.interfaces[0].name).toBe('good')
  })

  it('skips file manifest entries with invalid action', () => {
    const spec = {
      acceptanceCriteria: [{ id: 'AC-1', description: 'Works', testable: true }],
      fileManifest: [
        { path: 'a.ts', action: 'create', purpose: 'new file' },
        { path: 'b.ts', action: 'rename', purpose: 'invalid action' },
      ],
    }
    const result = extractSpecContract(wrapInPlannerOutput(JSON.stringify(spec)))
    expect(result!.fileManifest).toHaveLength(1)
  })
})

describe('buildSpecContext', () => {
  it('formats spec into a readable text block', () => {
    const context = buildSpecContext(VALID_SPEC)

    expect(context).toContain('--- Spec Contract (binding) ---')
    expect(context).toContain('AC-1: User can log in with email and password')
    expect(context).toContain('authenticateUser (src/auth/authenticate.ts)')
    expect(context).toContain('[create] src/auth/authenticate.ts')
    expect(context).toContain('TS-1: Valid credentials return a session token (covers: AC-1)')
    expect(context).toContain('--- End Spec Contract ---')
  })

  it('marks non-testable criteria', () => {
    const spec: SpecContract = {
      acceptanceCriteria: [{ id: 'AC-1', description: 'Looks good', testable: false }],
      interfaces: [],
      fileManifest: [],
      testScenarios: [],
    }
    const context = buildSpecContext(spec)
    expect(context).toContain('[non-testable]')
  })

  it('omits empty sections', () => {
    const spec: SpecContract = {
      acceptanceCriteria: [{ id: 'AC-1', description: 'Works', testable: true }],
      interfaces: [],
      fileManifest: [],
      testScenarios: [],
    }
    const context = buildSpecContext(spec)
    expect(context).not.toContain('Interface Contracts:')
    expect(context).not.toContain('File Manifest:')
    expect(context).not.toContain('Test Scenarios:')
  })
})

describe('SDD instruction constants', () => {
  it('planner instruction includes spec format', () => {
    expect(PLANNER_SDD_INSTRUCTION).toContain('acceptanceCriteria')
    expect(PLANNER_SDD_INSTRUCTION).toContain('interfaces')
    expect(PLANNER_SDD_INSTRUCTION).toContain('fileManifest')
    expect(PLANNER_SDD_INSTRUCTION).toContain('testScenarios')
  })

  it('implementer instruction references the spec contract', () => {
    expect(IMPLEMENTER_SPEC_INSTRUCTION).toContain('Spec Contract')
    expect(IMPLEMENTER_SPEC_INSTRUCTION).toContain('acceptance criterion')
  })

  it('verifier instruction includes PASS/FAIL reporting', () => {
    expect(VERIFIER_SPEC_INSTRUCTION).toContain('PASS or FAIL')
    expect(VERIFIER_SPEC_INSTRUCTION).toContain('compliance score')
  })
})
