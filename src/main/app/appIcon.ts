import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const iconFileName = 'lobrecs-agent-logo.png'

export function getAppIconPath(): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'resources', iconFileName),
    join(process.cwd(), 'resources', iconFileName),
  ]

  return candidates.find((candidate) => existsSync(candidate))
}
