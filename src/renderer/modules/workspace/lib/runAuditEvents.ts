export const RUN_AUDIT_UPDATED_EVENT = 'lobrecs:run-audit-updated'

export function emitRunAuditUpdated(sessionId: string): void {
  window.dispatchEvent(
    new CustomEvent(RUN_AUDIT_UPDATED_EVENT, {
      detail: { sessionId },
    }),
  )
}

export function isRunAuditUpdatedEvent(
  event: Event,
): event is CustomEvent<{ sessionId?: string }> {
  return event instanceof CustomEvent && event.type === RUN_AUDIT_UPDATED_EVENT
}
