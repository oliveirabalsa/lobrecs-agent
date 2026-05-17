export function BridgeUnavailableScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <div className="max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-xl shadow-black/30">
        <div className="text-sm font-semibold text-zinc-100">Renderer bridge unavailable</div>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          The preload bridge did not load, so the renderer cannot access projects, sessions, or
          agent controls yet.
        </p>
        <p className="mt-3 font-mono text-xs leading-5 text-zinc-500">
          Expected window.agentforge from src/preload/index.ts
        </p>
      </div>
    </div>
  )
}
