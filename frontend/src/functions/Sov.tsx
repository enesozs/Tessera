import { useMemo } from 'react'
import { useSovereign } from '@/api/client'
import type { SovereignYields } from '@/api/types'
import { LineChart } from '@/charts/LineChart'
import { PALETTE } from '@/charts/lwc'
import { fmtFixed, fmtMonth, isNum, tone, toneClass } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Seg, Spacer, Toggle, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

const COUNTRIES = ['IT', 'FR', 'ES', 'PT', 'GR', 'NL', 'BE', 'AT', 'IE', 'FI'] as const
const DEFAULT = 'IT,FR,ES,GR'
const RANGES = { '5Y': 5, '10Y': 10, '20Y': 20, MAX: 40 } as const

const colorOf = (country: string) =>
  country === 'DE'
    ? '#e4e7eb'
    : PALETTE[COUNTRIES.indexOf(country as (typeof COUNTRIES)[number]) % PALETTE.length]

// A widening spread is a deterioration, so it is shown in red.
const widening = (d: number | null) => tone(isNum(d) ? -d : null)

const bpFormat = (v: number) => `${v.toFixed(0)}bp`
const pctFormat = (v: number) => `${v.toFixed(2)}%`

export function Sov({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const selected = useMemo(
    () => (pane.params.countries ?? DEFAULT).split(',').filter(Boolean),
    [pane.params.countries],
  )
  const mode = (pane.params.mode ?? 'spread') as 'spread' | 'yield'
  const range = (pane.params.range ?? '10Y') as keyof typeof RANGES
  const query = useSovereign(selected.length ? selected : ['IT'])

  const toggle = (c: string) => {
    const next = selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]
    setParams(pane.id, { countries: next.join(',') })
  }

  return (
    <FnFrame
      query={query}
      toolbar={
        <Toolbar>
          <Seg
            value={mode}
            options={[
              { value: 'spread', label: 'Spread vs Bund' },
              { value: 'yield', label: '10Y yield' },
            ]}
            onChange={(v) => setParams(pane.id, { mode: v })}
          />
          <Seg
            value={range}
            options={Object.keys(RANGES) as (keyof typeof RANGES)[]}
            onChange={(v) => setParams(pane.id, { range: v })}
          />
          <Spacer />
          <div className="flex flex-wrap gap-1">
            {COUNTRIES.map((c) => (
              <Toggle
                key={c}
                on={selected.includes(c)}
                onChange={() => toggle(c)}
                color={colorOf(c)}
              >
                {c}
              </Toggle>
            ))}
          </div>
        </Toolbar>
      }
    >
      {(d) => <SovBody d={d} selected={selected} mode={mode} years={RANGES[range]} />}
    </FnFrame>
  )
}

function SovBody({
  d,
  selected,
  mode,
  years,
}: {
  d: SovereignYields
  selected: string[]
  mode: 'spread' | 'yield'
  years: number
}) {
  const lines = useMemo(() => {
    const shown = d.series.filter((s) =>
      mode === 'yield'
        ? s.country === 'DE' || selected.includes(s.country)
        : selected.includes(s.country),
    )
    return shown.map((s) => ({
      id: s.country,
      name: s.country,
      color: colorOf(s.country),
      width: s.country === 'IT' ? 2 : 1.5,
      points: d.months.flatMap((m, i) => {
        const v = mode === 'spread' ? s.spread_bp[i] : s.yields[i]
        return isNum(v) ? [{ time: `${m}-01`, value: v }] : []
      }),
    }))
  }, [d, selected, mode])

  const last = d.months.at(-1)
  const from = useMemo(() => {
    if (!last) return undefined
    return `${Number(last.slice(0, 4)) - years}${last.slice(4)}-01`
  }, [last, years])

  const n = d.months.length
  const change = (values: (number | null)[], back: number) => {
    const a = values[n - 1]
    const b = values[n - 1 - back]
    return isNum(a) && isNum(b) ? a - b : null
  }

  return (
    <div className="flex h-full min-h-0 flex-col @container">
      <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
        <div className="min-h-[180px] flex-[3]">
          <LineChart
            lines={lines}
            format={mode === 'spread' ? bpFormat : pctFormat}
            visibleFrom={from}
            zeroLine={mode === 'spread'}
          />
        </div>
        <div className="pane-scroll flex-[2] border-t border-line @3xl:border-t-0 @3xl:border-l">
          <table className="dt num">
            <thead>
              <tr>
                <th>{last ? fmtMonth(last) : ''}</th>
                <th>10Y %</th>
                <th title="Spread to Germany, basis points">Sprd bp</th>
                <th title="Spread change over 1 month">Δ1M</th>
                <th title="Spread change over 12 months">Δ1Y</th>
              </tr>
            </thead>
            <tbody>
              {d.series.map((s) => {
                const d1 = change(s.spread_bp, 1)
                const d12 = change(s.spread_bp, 12)
                return (
                  <tr key={s.country}>
                    <td className="font-sans text-fg-2">
                      <span
                        className="mr-1.5 inline-block size-1.5 rounded-full"
                        style={{ background: colorOf(s.country) }}
                      />
                      {s.name}
                    </td>
                    <td className="text-fg">{fmtFixed(s.yields[n - 1], 2)}</td>
                    <td className="text-fg">
                      {s.country === 'DE' ? '—' : fmtFixed(s.spread_bp[n - 1], 0)}
                    </td>
                    <td className={toneClass[widening(d1)]}>
                      {s.country === 'DE' ? '' : fmtFixed(d1, 0)}
                    </td>
                    <td className={toneClass[widening(d12)]}>
                      {s.country === 'DE' ? '' : fmtFixed(d12, 0)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="px-2 py-2 text-[10.5px] leading-snug text-fg-3">
            Monthly averages. A widening spread (positive Δ) means investors demand more over the
            Bund to hold that country's debt.
          </p>
        </div>
      </div>
    </div>
  )
}
