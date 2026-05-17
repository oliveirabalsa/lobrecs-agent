import { BridgeUnavailableScreen } from './BridgeUnavailableScreen'
import { AppProviders } from './providers'
import { RendererApp } from './RendererApp'

export function App() {
  if (!window.agentforge) {
    return <BridgeUnavailableScreen />
  }

  return (
    <AppProviders>
      <RendererApp />
    </AppProviders>
  )
}
