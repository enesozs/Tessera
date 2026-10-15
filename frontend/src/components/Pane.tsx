import clsx from 'clsx'
import { Component, type ReactNode } from 'react'
import { useProfile } from '@/api/client'
import { COMPONENTS } from '@/functions'
import { BY_CODE, FUNCTIONS } from '@/functions/registry'
import { parseCommand } from '@/lib/command'
import { useWorkspace, type LinkGroup, type Pane as PaneState } from '@/state/workspace'
import { ErrorState } from '@/ui/primitives'

export const LINK_COLOR: Record<NonNullable<LinkGroup>, string> = {
  cyan: 'var(--color-link-cyan)',
  violet: 'var(--color-link-violet)',
  lime: 'var(--color-link-lime)',
  rose: 'var(--color-link-rose)',
}

export function Pane({
  pane,
  index,
  active,
  maximized,
}: {
  pane: PaneState
  index: number
  active: boolean
  maximized: boolean
}) {
  const focusPane = useWorkspace((s) => s.focusPane)
  const closePane = useWorkspace((s) => s.closePane)
  const toggleMaximize = useWorkspace((s) => s.toggleMaximize)
  const cycleLink = useWorkspace((s) => s.cycleLink)
  const splitPane = useWorkspace((s) => s.splitPane)
  const spec = pane.fn ? BY_CODE[pane.fn] : null
  const Body = pane.fn ? COMPONENTS[pane.fn] : null

  return (
    <section
      onMouseDown={() => !active && focusPane(pane.id)}
      className={clsx(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-[3px] border bg-surface',
        active ? 'border-amber-dim shadow-[0_0_0_1px_rgba(255,176,32,0.12)]' : 'border-line',
      )}
      aria-label={`Pane ${index + 1}`}
    >
      <header
        onDoubleClick={() => toggleMaximize(pane.id)}
        className={clsx(
          'flex h-[26px] shrink-0 items-center gap-2 border-b border-line px-1.5 select-none',
          active ? 'bg-raised' : 'bg-surface',
        )}
      >
        <span
          className={clsx('num w-3.5 text-center text-[10px]', active ? 'text-amber' : 'text-fg-4')}
        >
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => cycleLink(pane.id)}
          title={
            pane.link ? `Linked (${pane.link}) — click to change` : 'Not linked — click to link'
          }
          className="flex size-3.5 items-center justify-center rounded-full border"
          style={{
            borderColor: pane.link ? LINK_COLOR[pane.link] : 'var(--color-fg-4)',
            background: pane.link
              ? `color-mix(in srgb, ${LINK_COLOR[pane.link]} 35%, transparent)`
              : 'transparent',
          }}
        />
        {spec && (
          <span className="num text-[11px] font-bold tracking-wide text-amber">{spec.code}</span>
        )}
        {pane.security && (spec?.security || !spec) && (
          <span className="num text-[11px] font-medium text-fg">{pane.security}</span>
        )}
        <span className="truncate text-[11px] text-fg-3">
          {spec?.title ?? 'Empty pane'}
          {spec?.security && pane.security && <SecurityName symbol={pane.security} />}
        </span>
        <span className="flex-1" />
        <HeaderButton title="Duplicate pane (Alt N)" onClick={() => splitPane(pane.id)}>
          <path d="M3 3h6v6H3zM6 1h5v5" />
        </HeaderButton>
        <HeaderButton
          title={maximized ? 'Restore (Alt M)' : 'Maximise (Alt M)'}
          onClick={() => toggleMaximize(pane.id)}
        >
          {maximized ? (
            <path d="M4 1v3H1M8 1v3h3M4 11V8H1M8 11V8h3" />
          ) : (
            <path d="M1 4V1h3M8 1h3v3M1 8v3h3M11 8v3H8" />
          )}
        </HeaderButton>
        <HeaderButton title="Close pane (Alt W)" onClick={() => closePane(pane.id)}>
          <path d="M2 2l8 8M10 2l-8 8" />
        </HeaderButton>
      </header>
      <div className="min-h-0 flex-1">
        <ErrorBoundary key={`${pane.fn}:${pane.security}`}>
          {Body ? <Body pane={pane} active={active} /> : <EmptyPane />}
        </ErrorBoundary>
      </div>
    </section>
  )
}

/** Company name next to the ticker, from the (shared, cached) profile query. */
function SecurityName({ symbol }: { symbol: string }) {
  const { data } = useProfile(symbol)
  return data ? <span className="text-fg-2"> · {data.data.name}</span> : null
}

function HeaderButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex size-5 items-center justify-center rounded-[2px] text-fg-4 hover:bg-hover hover:text-fg"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      >
        {children}
      </svg>
    </button>
  )
}

function EmptyPane() {
  const run = useWorkspace((s) => s.run)
  const picks = ['WEI', 'RACE DES', 'AAPL GP', 'YC US', 'SOV', 'ECO', 'FX', 'NEWS', 'WL', 'HELP']
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-fg-3">
        Type a command — <span className="text-fg-2">ticker</span>,{' '}
        <span className="text-fg-2">function</span>, or both.
      </div>
      <div className="flex max-w-md flex-wrap justify-center gap-1.5">
        {picks.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => run(parseCommand(c), { raw: c })}
            className="num rounded-[3px] border border-line px-2 py-0.5 text-[11px] text-fg-2 hover:border-amber-dim hover:text-amber"
          >
            {c}
          </button>
        ))}
      </div>
      <div className="text-[10.5px] text-fg-4">
        {FUNCTIONS.length} functions · HELP lists them all
      </div>
    </div>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? (
      <ErrorState
        error={this.state.error}
        hint="This pane crashed while rendering; other panes are unaffected."
      />
    ) : (
      this.props.children
    )
  }
}
