import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useMacroDashboard, useMacroSeries } from '@/api/client'
import type { MacroSeries, MacroSummary } from '@/api/types'
import { LineChart } from '@/charts/LineChart'
import { C } from '@/charts/lwc'
import { fmtDate, fmtFixed, isNum } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Seg, Spacer, Spark, Stat, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

const REGIONS = { US: 'United States', EA: 'Euro area' } as const

/** Direction colour only where "up" has an unambiguous meaning (growth, jobs). */
function changeClass(delta: number | null, higherIsBetter: boolean | null) {
  if (!isNum(delta) || delta === 0 || higherIsBetter === null) return 'text-fg-2'
  return delta > 0 === higherIsBetter ? 'text-up' : 'text-down'
}

const decimalsFor = (units: string) => (units.startsWith('k') ? 0 : 2)

export function Eco({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const series = pane.params.series
  return series ? (
    <SeriesView id={series} onBack={() => setParams(pane.id, { series: '' })} />
  ) : (
    <Dashboard onOpen={(id) => setParams(pane.id, { series: id })} />
  )
}

function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const query = useMacroDashboard()
  const [draft, setDraft] = useState('')
  return (
    <FnFrame
      query={query}
      loadingRows={12}
      toolbar={
        <Toolbar>
          <span className="text-[10.5px] text-fg-3">Click a tile for the full history</span>
          <Spacer />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) onOpen(draft.trim().toUpperCase())
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Any FRED series id (e.g. GDPC1)"
              className="num h-[22px] w-56 rounded-[3px] border border-line bg-canvas px-2 text-[11px] text-fg uppercase placeholder:text-fg-4 placeholder:normal-case focus:border-amber-dim focus:outline-none"
            />
          </form>
        </Toolbar>
      }
    >
      {(tiles) => (
        <div className="pane-scroll h-full p-2 @container">
          {(Object.keys(REGIONS) as (keyof typeof REGIONS)[]).map((region) => (
            <section key={region} className="mb-3">
              <h3 className="mb-1.5 px-0.5 text-[10.5px] font-semibold tracking-[0.08em] text-amber uppercase">
                {REGIONS[region]}
              </h3>
              <div className="grid grid-cols-1 gap-1.5 @md:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4">
                {tiles
                  .filter((t) => t.region === region)
                  .map((t) => (
                    <Tile key={t.id} t={t} onOpen={() => onOpen(t.id)} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </FnFrame>
  )
}

function Tile({ t, onOpen }: { t: MacroSummary; onOpen: () => void }) {
  const delta = t.latest && t.previous ? t.latest.value - t.previous.value : null
  const d = decimalsFor(t.units)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-[3px] border border-line bg-raised/40 px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-raised"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-fg-2 group-hover:text-fg">{t.title}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="num text-[16px] font-medium text-fg">
            {t.latest ? fmtFixed(t.latest.value, d) : '—'}
          </span>
          <span className="text-[10.5px] whitespace-nowrap text-fg-3">{t.units}</span>
          <span
            className={clsx(
              'num text-[10.5px] whitespace-nowrap',
              changeClass(delta, t.higher_is_better),
            )}
          >
            {isNum(delta)
              ? `${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${fmtFixed(Math.abs(delta), d)}`
              : ''}
          </span>
        </div>
        <div className="num mt-0.5 text-[10px] text-fg-4">
          {t.latest ? fmtDate(t.latest.date) : '—'} · {t.frequency} · {t.source.split(',')[0]}
        </div>
      </div>
      <Spark values={t.spark} width={84} height={30} color={C.info} />
    </button>
  )
}

const RANGES = { '2Y': 2, '5Y': 5, '10Y': 10, '15Y': 15 } as const

function SeriesView({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useMacroSeries(id)
  const [range, setRange] = useState<keyof typeof RANGES>('10Y')
  return (
    <FnFrame
      query={query}
      toolbar={
        <Toolbar>
          <button
            type="button"
            onClick={onBack}
            className="h-[22px] rounded-[3px] border border-line px-2 text-[10.5px] text-fg-2 hover:text-fg"
          >
            ← Dashboard
          </button>
          <span className="truncate font-medium text-fg">{query.data?.data.title ?? id}</span>
          {query.data && (
            <span className="num text-[10.5px] text-fg-3">
              {query.data.data.source_key} · {query.data.data.units || 'as published'}
            </span>
          )}
          <Spacer />
          <Seg
            value={range}
            options={Object.keys(RANGES) as (keyof typeof RANGES)[]}
            onChange={setRange}
          />
        </Toolbar>
      }
    >
      {(s) => <SeriesBody s={s} years={RANGES[range]} />}
    </FnFrame>
  )
}

function SeriesBody({ s, years }: { s: MacroSeries; years: number }) {
  const lines = useMemo(
    () => [
      {
        id: s.id,
        name: s.title,
        color: C.amber,
        points: s.observations.map((o) => ({ time: o.date, value: o.value })),
      },
    ],
    [s],
  )
  const obs = s.observations
  const last = obs.at(-1)
  const from = last ? `${Number(last.date.slice(0, 4)) - years}${last.date.slice(4)}` : undefined
  const yearAgo = last
    ? [...obs]
        .reverse()
        .find((o) => o.date <= `${Number(last.date.slice(0, 4)) - 1}${last.date.slice(4)}`)
    : undefined
  const visible = from ? obs.filter((o) => o.date >= from) : obs
  const values = visible.map((o) => o.value)
  const d = decimalsFor(s.units)
  const format = useMemo(() => (v: number) => v.toFixed(d), [d])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-2 gap-x-6 border-b border-line px-3 py-1.5 @container sm:grid-cols-4">
        <Stat label={`Latest (${last ? fmtDate(last.date) : '—'})`}>
          {fmtFixed(last?.value, d)}
        </Stat>
        <Stat label="Previous">{fmtFixed(obs.at(-2)?.value, d)}</Stat>
        <Stat label="A year earlier">{fmtFixed(yearAgo?.value, d)}</Stat>
        <Stat label={`Range (${years}Y)`}>
          {values.length
            ? `${fmtFixed(Math.min(...values), d)} – ${fmtFixed(Math.max(...values), d)}`
            : '—'}
        </Stat>
      </div>
      <div className="min-h-0 flex-1">
        <LineChart
          lines={lines}
          format={format}
          visibleFrom={from}
          zeroLine={values.some((v) => v < 0)}
        />
      </div>
      <div className="shrink-0 border-t border-line px-3 py-1 text-[10.5px] text-fg-3">
        {s.transform} · {s.frequency}
      </div>
    </div>
  )
}
