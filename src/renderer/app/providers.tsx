import type { ReactNode } from 'react'
import { TabsProvider } from '../modules/sessions'

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  return <TabsProvider>{children}</TabsProvider>
}
