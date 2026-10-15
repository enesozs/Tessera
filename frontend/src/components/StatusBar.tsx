import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useHealth } from '@/api/client'
import { parseCommand } from '@/lib/command'
import { useActiveWorkspace, useWorkspace } from '@/state/workspace'

export function StatusBar() {
  const health = useHealth()
  const ws = useActiveWorkspace()
  const run = useWorkspace((s) => s.run)
  const resetAll = useWorkspace((s) => s.resetAll)
  const [utc, setUtc] = useState(() => new Date().toISOString().slice(11, 16))
  useEffect(() => {
    const t = setInterval(() => setUtc(new Date().toISOString().slice(11, 16)), 15_000)
    return () => clearInterval(t)
  }, [])

  const ok = health.isSuccess
  return (
    <footer className="flex h-[22px] shrink-0 items-center gap-3 border-t border-line bg-canvas px-2.5 text-[10.5px] text-fg-3">
      <span
        className="flex items-center gap-1.5"
        title={ok ? 'API reachable' : 'API unreachable — start it with `make dev`'}
      >
        <span
          className={clsx(
            'size-1.5 rounded-full',
            ok ? 'bg-up' : health.isPending ? 'bg-fg-4' : 'bg-down',
          )}
        />
        {ok ? 'API connected' : health.isPending ? 'Connecting…' : 'API offline'}
      </span>
      <span className="text-fg-4">|</span>
      <span>Delayed & end-of-day data from public sources · not for trading</span>
      <span className="flex-1" />
      <span className="hidden sm:inline">
        {ws.name} · {ws.panes.length} pane{ws.panes.length === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        className="hover:text-amber"
        onClick={() => run(parseCommand('HELP'), { raw: 'HELP' })}
      >
        HELP
      </button>
      <button
        type="button"
        className="hover:text-amber"
        title="Restore the default workspaces and watchlist"
        onClick={() => {
          if (confirm('Reset all workspaces and the watchlist to the defaults?')) resetAll()
        }}
      >
        Reset layout
      </button>
      <span className="num text-fg-2">{utc} UTC</span>
    </footer>
  )
}
