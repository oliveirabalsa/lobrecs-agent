import { ipcMain } from 'electron'
import { getDb } from '../../../store'
import type { MainIpcContext } from '../../shared/ipcContext'
import { listProviderUsage } from '../application/providerUsage'

export function registerCostHandlers(context: MainIpcContext): void {
  ipcMain.handle('cost:by-project', async (_event, projectId: string) =>
    getDb()
      .prepare(
        `
          SELECT
            COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
            COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
            COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
            COUNT(*) AS session_count
          FROM sessions
          WHERE project_id = ?
        `,
      )
      .get(projectId),
  )
  ipcMain.handle('cost:by-period', async (_event, days: number) => {
    const normalizedDays = Math.max(1, Math.min(365, Math.floor(Number(days) || 30)))
    const since = Date.now() - normalizedDays * 24 * 60 * 60 * 1000

    return getDb()
      .prepare(
        `
          SELECT
            p.name AS project_name,
            s.model AS model,
            COUNT(s.id) AS sessions,
            COALESCE(SUM(s.cost_usd), 0) AS total_cost
          FROM sessions s
          JOIN projects p ON p.id = s.project_id
          WHERE s.created_at >= ?
          GROUP BY p.id, s.model
          ORDER BY total_cost DESC
        `,
      )
      .all(since)
  })
  ipcMain.handle('cost:provider-usage', async () =>
    listProviderUsage(getDb(), context.adapters, Date.now(), {
      runtimes: context.settingsService.getGlobal().agents.runtimes,
    }),
  )
}
