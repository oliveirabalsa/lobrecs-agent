/**
 * Audible "the agent needs you" alert.
 *
 * The chime is synthesized at runtime with the Web Audio API — there is no
 * bundled `.mp3`/`.wav`, so it behaves identically in dev and packaged builds
 * and adds nothing to the asset graph.
 *
 * Two pieces live here:
 *  - `playAttentionSound()` — the plumbing. Just makes the noise.
 *  - `shouldPlayAttentionSound()` — the *policy*. Decides whether a given
 *    moment is worth interrupting the user. That call is subjective, so it is
 *    kept small and isolated for easy tuning.
 */

/** The agent states worth a sound. */
export type AttentionEvent = 'question' | 'approval' | 'session-complete' | 'error'

// One AudioContext is reused for the lifetime of the renderer. Creating one
// per chime leaks contexts and eventually trips the browser's hard limit.
let sharedContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!sharedContext) sharedContext = new Ctor()
  return sharedContext
}

/**
 * Plays a soft two-note rising chime. Safe to call from anywhere in the
 * renderer; silently no-ops if Web Audio is unavailable or still blocked
 * (e.g. before the first user gesture).
 */
export function playAttentionSound(): void {
  const ctx = getAudioContext()
  if (!ctx) return
  // Autoplay policy may leave the context suspended until a user gesture.
  if (ctx.state === 'suspended') void ctx.resume()

  const now = ctx.currentTime
  // E5 then A5 — a short, friendly upward "blip-blip".
  ;[659.25, 880].forEach((frequency, index) => {
    const start = now + index * 0.13
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.value = frequency

    // Fast attack, exponential decay — a pluck, not a sustained buzz.
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32)

    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.34)
  })
}

/**
 * Policy: should `event` actually play a sound right now?
 *
 * This is the one genuinely subjective call in the feature — interrupting
 * someone with noise is a UX trade-off, not a mechanical one. The default
 * below is a reasonable starting point; tune it to taste:
 *
 *  - `question` / `approval` block the agent until you act, so they earn a
 *    sound even when you are already looking at the app.
 *  - `session-complete` / `error` are informational — only worth a sound
 *    when the window is in the background and you would otherwise miss it.
 *
 * @param event         What the agent just did.
 * @param windowFocused Whether the app window currently has OS focus.
 */
export function shouldPlayAttentionSound(
  event: AttentionEvent,
  windowFocused: boolean,
): boolean {
  if (event === 'question' || event === 'approval') return true
  return !windowFocused
}
