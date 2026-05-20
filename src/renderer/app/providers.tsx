import type { ReactNode } from 'react'
import { ThemeProvider } from '../hooks/useTheme'
import { SettingsProvider } from '../modules/settings'
import { TabsProvider } from '../modules/sessions'

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <TabsProvider>{children}</TabsProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}
