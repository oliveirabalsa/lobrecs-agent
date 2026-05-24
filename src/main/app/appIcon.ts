import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const iconFileName = 'icon.png'

export function getAppIconPath(): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'resources', iconFileName),
    join(process.cwd(), 'resources', iconFileName),
  ]

  return candidates.find((candidate) => existsSync(candidate))
}
