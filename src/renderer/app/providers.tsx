import type { ReactNode } from 'react'
import { SettingsProvider } from '../modules/settings'
import { TabsProvider } from '../modules/sessions'

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <SettingsProvider>
      <TabsProvider>{children}</TabsProvider>
    </SettingsProvider>
  )
}
