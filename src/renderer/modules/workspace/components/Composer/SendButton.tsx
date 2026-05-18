import { Button } from '../../../../components/ui'

interface SendButtonProps {
  /** True when a session is currently running; renders as a stop button. */
  running: boolean
  /** True when the composer has content to submit. Ignored while running. */
  canSend: boolean
  loading?: boolean
  onSend: () => void
  onStop?: () => void
}

/**
 * Large circular send/stop button. Swaps icon based on the session state:
 * — Idle: paper-plane (submit draft)
 * — Running: square (cancel session)
 */
export function SendButton({ running, canSend, loading, onSend, onStop }: SendButtonProps) {
  const disabled = running ? !onStop : !canSend
  const label = running ? 'Stop running session' : 'Send message'
  return (
    <Button
      variant="circle"
      size="lg"
      aria-label={label}
      disabled={disabled}
      loading={loading}
      leadingIcon={running ? <StopIcon /> : <SendIcon />}
      onClick={running ? onStop : onSend}
    />
  )
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}
