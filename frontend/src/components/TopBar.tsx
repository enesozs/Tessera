import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useWorkspace } from '@/state/workspace'

// Regular continuous-trading hours in exchange-local time. Holidays and half-days are not
// modelled, hence "approx." in the tooltip.
const MARKETS: { code: string; city: string; tz: string; sessions: [number, number][] }[] = [
  { code: 'NY', city: 'New York · NYSE', tz: 'America/New_York', sessions: [[9.5, 16]] },
  { code: 'LDN', city: 'London · LSE', tz: 'Europe/London', sessions: [[8, 16.5]] },
  { code: 'MIL', city: 'Milan · Borsa Italiana', tz: 'Europe/Rome', sessions: [[9, 17.5]] },
  { code: 'IST', city: 'Istanbul · Borsa Istanbul', tz: 'Europe/Istanbul', sessions: [[10, 18]] },
  {
    code: 'HK',
    city: 'Hong Kong · HKEX',
    tz: 'Asia/Hong_Kong',
    sessions: [
      [9.5, 12],
      [13, 16],
    ],
  },
  {
    code: 'TYO',
    city: 'Tokyo · TSE',
    tz: 'Asia/Tokyo',
    sessions: [
      [9, 11.5],
      [12.5, 15.5],
    ],
  },
]

function localParts(now: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  return {
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    label: `${parts.hour}:${parts.minute}`,
  }
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function Clocks() {
  const now = useNow()
  return (
    <div className="hidden items-center gap-3 lg:flex">
      {MARKETS.map((m) => {
        const p = localParts(now, m.tz)
        const t = p.hour + p.minute / 60
        const weekday = !['Sat', 'Sun'].includes(p.weekday)
        const open = weekday && m.sessions.some(([a, b]) => t >= a && t < b)
        return (
          <div
            key={m.code}
            className="flex items-center gap-1"
            title={`${m.city} — ${open ? 'open' : 'closed'} (regular hours, approx.; holidays not modelled)`}
          >
            <span
              className={clsx(
                'size-1.5 rounded-full',
                open ? 'bg-up shadow-[0_0_6px_var(--color-up)]' : 'bg-fg-4',
              )}
            />
            <span className="text-[10px] font-semibold tracking-wider text-fg-3">{m.code}</span>
            <span className="num text-[11px] text-fg-2">{p.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2 pr-2">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect x="1" y="1" width="6" height="6" rx="1" fill="#ffb020" />
        <rect x="9" y="1" width="6" height="6" rx="1" fill="#ffb020" opacity=".45" />
        <rect x="1" y="9" width="6" height="6" rx="1" fill="#ffb020" opacity=".45" />
        <rect x="9" y="9" width="6" height="6" rx="1" fill="#ffb020" opacity=".8" />
      </svg>
      <span className="text-[12px] font-bold tracking-[0.28em] text-fg">TESSERA</span>
    </div>
  )
}

function Tabs() {
  const workspaces = useWorkspace((s) => s.workspaces)
  const activeId = useWorkspace((s) => s.activeWorkspaceId)
  const select = useWorkspace((s) => s.selectWorkspace)
  const add = useWorkspace((s) => s.addWorkspace)
  const rename = useWorkspace((s) => s.renameWorkspace)
  const remove = useWorkspace((s) => s.removeWorkspace)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto" aria-label="Workspaces">
      {workspaces.map((w, i) => {
        const active = w.id === activeId
        return (
          <div
            key={w.id}
            className={clsx(
              'group flex h-[24px] shrink-0 items-center gap-1.5 rounded-[3px] px-2 text-[11px]',
              active
                ? 'bg-raised text-fg shadow-[inset_0_-1px_0_var(--color-amber)]'
                : 'text-fg-3 hover:bg-raised/60 hover:text-fg-2',
            )}
          >
            {editing === w.id ? (
              <input
                autoFocus
                defaultValue={w.name}
                onBlur={(e) => {
                  rename(w.id, e.target.value.trim() || w.name)
                  setEditing(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                }}
                className="w-28 bg-transparent text-fg outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => select(w.id)}
                onDoubleClick={() => setEditing(w.id)}
                title="Double-click to rename · Alt [ / ] to switch"
              >
                <span className="num mr-1.5 text-[10px] text-fg-4">{i + 1}</span>
                {w.name}
              </button>
            )}
            {workspaces.length > 1 && (
              <button
                type="button"
                onClick={() => remove(w.id)}
                title="Close workspace"
                className="text-fg-4 opacity-0 group-hover:opacity-100 hover:text-down"
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      <button
        type="button"
        onClick={add}
        title="New workspace"
        className="h-[24px] shrink-0 rounded-[3px] px-2 text-[13px] text-fg-3 hover:bg-raised hover:text-amber"
      >
        +
      </button>
    </nav>
  )
}

export function TopBar() {
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-3 border-b border-line bg-canvas px-2.5">
      <Logo />
      <Tabs />
      <div className="flex-1" />
      <Clocks />
    </div>
  )
}
