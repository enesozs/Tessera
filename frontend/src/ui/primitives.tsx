import clsx from 'clsx'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import type { Provenance } from '@/api/types'
import { fmtAgo, fmtDate, fmtDateTime, isNum, tone, toneClass } from '@/lib/format'

/** Segmented control: the toolbar idiom for every pane option. */
export function Seg<T extends string>({
  value,
  options,
  onChange,
  title,
}: {
  value: T
  options: readonly (T | { value: T; label: ReactNode; hint?: string })[]
  onChange: (v: T) => void
  title?: string
}) {
  return (
    <div
      className="flex items-center rounded-[3px] border border-line bg-canvas p-px"
      title={title}
    >
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o, hint: undefined } : o
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.hint}
            onClick={() => onChange(opt.value)}
            className={clsx(
              'h-[20px] rounded-[2px] px-1.5 text-[10.5px] font-medium tracking-wide transition-colors',
              active
                ? 'bg-raised text-amber shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
                : 'text-fg-3 hover:text-fg',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function Toggle({
  on,
  onChange,
  children,
  title,
  color,
}: {
  on: boolean
  onChange: (on: boolean) => void
  children: ReactNode
  title?: string
  color?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => onChange(!on)}
      className={clsx(
        'flex h-[22px] items-center gap-1 rounded-[3px] border px-1.5 text-[10.5px] font-medium tracking-wide transition-colors',
        on ? 'border-line-strong bg-raised text-fg' : 'border-line text-fg-3 hover:text-fg-2',
      )}
    >
      {color && (
        <span
          className="size-1.5 rounded-full"
          style={{ background: on ? color : 'var(--color-fg-4)' }}
        />
      )}
      {children}
    </button>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2 py-1">
      {children}
    </div>
  )
}

export function Spacer() {
  return <div className="flex-1" />
}

/** Signed number coloured by direction. */
export function Delta({
  value,
  children,
  className,
}: {
  value: number | null | undefined
  children: ReactNode
  className?: string
}) {
  return <span className={clsx('num', toneClass[tone(value)], className)}>{children}</span>
}

export function Spark({
  values,
  width = 72,
  height = 18,
  color,
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (values.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const pts = values.map(
    (v, i) =>
      `${(i * step).toFixed(1)},${(height - 1 - ((v - min) / span) * (height - 2)).toFixed(1)}`,
  )
  const stroke =
    color ?? (values[values.length - 1] >= values[0] ? 'var(--color-up)' : 'var(--color-down)')
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Horizontal position of `value` within [low, high] — the 52-week range bar. */
export function RangeBar({
  low,
  high,
  value,
}: {
  low: number | null
  high: number | null
  value: number | null
}) {
  if (!isNum(low) || !isNum(high) || !isNum(value) || high <= low) return null
  const pct = Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100))
  return (
    <div className="relative h-1 w-full rounded-full bg-line">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-amber-dim"
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber"
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}

const FRESHNESS_LABEL: Record<Provenance['freshness'], string> = {
  delayed: 'Delayed',
  end_of_day: 'End of day',
  reference: 'Reference rate',
  periodic: 'Periodic release',
  filing: 'Company filings',
}

/** Footer line under every pane: source, freshness, as-of time and caveats. */
export function ProvenanceBar({ meta, extra }: { meta?: Provenance; extra?: ReactNode }) {
  if (!meta) return <div className="h-[22px] shrink-0 border-t border-line" />
  const asOf = meta.as_of
    ? meta.freshness === 'delayed'
      ? fmtDateTime(meta.as_of)
      : fmtDate(meta.as_of)
    : null
  return (
    <div className="flex h-[22px] shrink-0 items-center gap-2 overflow-hidden border-t border-line px-2 text-[10.5px] text-fg-3">
      {meta.stale && (
        <span
          className="rounded-[2px] bg-amber/15 px-1 font-semibold text-amber"
          title="The provider did not respond; showing the last good copy from cache."
        >
          STALE
        </span>
      )}
      <span className="shrink-0">
        {meta.source_url ? (
          <a
            href={meta.source_url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-fg-2 hover:underline"
          >
            {meta.source}
          </a>
        ) : (
          meta.source
        )}
      </span>
      <span className="text-fg-4">·</span>
      <span className="shrink-0">{FRESHNESS_LABEL[meta.freshness]}</span>
      {asOf && (
        <>
          <span className="text-fg-4">·</span>
          <span className="num shrink-0">as of {asOf}</span>
        </>
      )}
      {extra && <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">{extra}</span>}
      <span className="flex-1" />
      {meta.notes.length > 0 && (
        <span
          className="cursor-help truncate text-fg-4 hover:text-fg-3"
          title={meta.notes.join('\n')}
        >
          ⓘ {meta.notes[0]}
        </span>
      )}
      <span
        className="num shrink-0 text-fg-4"
        title={`Retrieved ${fmtDateTime(meta.retrieved_at)}`}
      >
        {fmtAgo(meta.retrieved_at)}
      </span>
    </div>
  )
}

export function Loading({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-3.5" style={{ width: `${92 - ((i * 37) % 40)}%` }} />
      ))}
    </div>
  )
}

export function ErrorState({ error, hint }: { error: unknown; hint?: ReactNode }) {
  const api = error instanceof ApiError ? error : null
  const title =
    api?.status === 404
      ? 'No data'
      : api?.status === 503
        ? 'Not configured'
        : api?.status === 0
          ? 'Offline'
          : 'Provider error'
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center">
      <div className="text-[11px] font-semibold tracking-[0.12em] text-down uppercase">{title}</div>
      <div className="max-w-md text-fg-2">
        {error instanceof Error ? error.message : String(error)}
      </div>
      {hint && <div className="max-w-md text-fg-3">{hint}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-fg-3">
      {children}
    </div>
  )
}

/** Label/value pair used in dense stat grids. */
export function Stat({
  label,
  children,
  title,
}: {
  label: ReactNode
  children: ReactNode
  title?: string
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b border-line/60 py-[3px]"
      title={title}
    >
      <span className="truncate text-fg-3">{label}</span>
      <span className="num shrink-0 text-fg">{children}</span>
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-3 mb-1 flex items-center justify-between text-[10.5px] font-semibold tracking-[0.08em] text-amber uppercase first:mt-0">
      <span>{children}</span>
      {right}
    </div>
  )
}
