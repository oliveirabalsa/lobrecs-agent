import { describe, expect, it } from 'vitest'
import {
  validateAgentDispatchParams,
  validateCliEditorTerminalWriteInput,
  validateCreateProjectInput,
  validateCreateThreadInput,
  validateReadMarkdownDocumentInput,
  validateVerificationCommand,
} from './index'

describe('IPC contract validation', () => {
  it('rejects malformed agent dispatch payloads before routing', () => {
    expect(() =>
      validateAgentDispatchParams({
        projectId: 'project-1',
        prompt: '',
        agentId: 'not-real',
      }),
    ).toThrow('Prompt is required')
  })

  it('requires saved project paths to be absolute and not filesystem root', () => {
    expect(() =>
      validateCreateProjectInput({
        name: 'Repo',
        repoPath: '/',
        agentId: 'codex',
        modelTier: 'balanced',
      }),
    ).toThrow('filesystem root')
  })

  it('validates thread mutations as narrow typed payloads', () => {
    expect(() => validateCreateThreadInput({ projectId: 'project-1', title: 42 })).toThrow(
      'Thread title must be a string',
    )
  })

  it('rejects multi-line verification commands', () => {
    expect(() => validateVerificationCommand('rtk npm test\nrm -rf /tmp/outside')).toThrow(
      'single command',
    )
  })

  it('requires markdown repo paths to be absolute when provided', () => {
    expect(() =>
      validateReadMarkdownDocumentInput({ href: 'docs/PLAN.md', repoPath: '../repo' }),
    ).toThrow('Repository path must be an absolute path')
  })

  it('allows terminal control sequences needed for interactive shells', () => {
    expect(
      validateCliEditorTerminalWriteInput({
        sessionId: 'terminal-1',
        data: 'abc\u007f\u001b[D\u0003\r',
      }),
    ).toEqual({
      sessionId: 'terminal-1',
      data: 'abc\u007f\u001b[D\u0003\r',
    })

    expect(() =>
      validateCliEditorTerminalWriteInput({
        sessionId: 'terminal-1',
        data: 'bad\u0000input',
      }),
    ).toThrow('null bytes')
  })
})
