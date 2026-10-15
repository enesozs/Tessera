import clsx from 'clsx'
import { useMemo } from 'react'
import { useCurve } from '@/api/client'
import type { YieldCurve } from '@/api/types'
import { AXIS, EChart, TOOLTIP, type EChartsOption } from '@/charts/EChart'
import { LineChart } from '@/charts/LineChart'
import { PALETTE } from '@/charts/lwc'
import { fmtBpFromPct, fmtDate, fmtFixed, isNum, tone, toneClass } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Seg, Spacer, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

const SNAPSHOT_STYLE: Record<string, { color: string; width: number; dashed?: boolean }> = {
  Latest: { color: '#ffb020', width: 2.5 },
  '1W ago': { color: '#5aa9ff', width: 1.5 },
  '1M ago': { color: '#a78bfa', width: 1.5 },
  '1Y ago': { color: '#6b7581', width: 1.5, dashed: true },
}

// Spreads quoted in basis points: long tenor minus short tenor.
const SPREADS: [string, string, string][] = [
  ['2s10s', '2Y', '10Y'],
  ['3m10y', '3M', '10Y'],
  ['5s30s', '5Y', '30Y'],
]

export function Yc({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const region = (pane.params.region ?? 'US') as 'US' | 'EA'
  const issuers = (pane.params.issuers ?? 'AAA') as 'AAA' | 'ALL'
  const view = pane.params.view ?? 'curve'
  const query = useCurve(region, issuers)

  return (
    <FnFrame
      query={query}
      loadingRows={10}
      toolbar={
        <Toolbar>
          <Seg
            value={region}
            options={[
              { value: 'US', label: 'US Treasury' },
              { value: 'EA', label: 'Euro area' },
            ]}
            onChange={(v) => setParams(pane.id, { region: v })}
          />
          {region === 'EA' && (
            <Seg
              value={issuers}
              options={[
                {
                  value: 'AAA',
                  label: 'AAA',
                  hint: 'Curve fitted to AAA-rated euro-area government bonds',
                },
                {
                  value: 'ALL',
                  label: 'All issuers',
                  hint: 'Curve fitted to all euro-area central government bonds',
                },
              ]}
              onChange={(v) => setParams(pane.id, { issuers: v })}
            />
          )}
          <Spacer />
          <Seg
            value={view}
            options={[
              { value: 'curve', label: 'Curve' },
              { value: 'history', label: '1Y history' },
            ]}
            onChange={(v) => setParams(pane.id, { view: v })}
          />
        </Toolbar>
      }
    >
      {(c) => (view === 'history' ? <History c={c} /> : <Curve c={c} />)}
    </FnFrame>
  )
}

function Curve({ c }: { c: YieldCurve }) {
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 44, right: 14, top: 28, bottom: 24 },
      tooltip: {
        ...TOOLTIP,
        valueFormatter: (v: number | null) => (isNum(v) ? `${v.toFixed(3)}%` : '—'),
      },
      legend: {
        top: 4,
        left: 8,
        itemWidth: 12,
        itemHeight: 2,
        textStyle: { color: '#a3acb7', fontSize: 10.5 },
        data: c.snapshots.map((s) => s.label),
      },
      xAxis: {
        type: 'category',
        data: c.tenors,
        boundaryGap: false,
        ...AXIS,
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        ...AXIS,
        axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${v.toFixed(2)}` },
      },
      series: c.snapshots.map((s) => {
        const st = SNAPSHOT_STYLE[s.label] ?? { color: '#94a3b8', width: 1 }
        return {
          name: s.label,
          type: 'line',
          data: s.yields,
          connectNulls: true,
          symbol: s.label === 'Latest' ? 'circle' : 'none',
          symbolSize: 4,
          lineStyle: { color: st.color, width: st.width, type: st.dashed ? 'dashed' : 'solid' },
          itemStyle: { color: st.color },
          z: s.label === 'Latest' ? 10 : 1,
        }
      }),
    }),
    [c],
  )

  const latest = c.snapshots[0]
  const at = (label: string, tenor: string) => {
    const snap = c.snapshots.find((s) => s.label === label)
    const i = c.tenors.indexOf(tenor)
    return snap && i >= 0 ? snap.yields[i] : null
  }
  const spread = (label: string, short: string, long: string) => {
    const a = at(label, long)
    const b = at(label, short)
    return isNum(a) && isNum(b) ? (a - b) * 100 : null
  }

  return (
    <div className="flex h-full min-h-0 flex-col @container">
      <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
        <div className="min-h-[180px] flex-[3]">
          <EChart option={option} />
        </div>
        <div className="pane-scroll flex-[2] border-t border-line @3xl:border-t-0 @3xl:border-l">
          <table className="dt num">
            <thead>
              <tr>
                <th>Tenor</th>
                <th title={fmtDate(latest.date)}>Yield %</th>
                {c.snapshots.slice(1).map((s) => (
                  <th key={s.label} title={`Change since ${fmtDate(s.date)}, basis points`}>
                    Δ{s.label.replace(' ago', '')} bp
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.tenors.map((t, i) => (
                <tr key={t}>
                  <td className="text-fg-2">{t}</td>
                  <td className="text-fg">{fmtFixed(latest.yields[i], 3)}</td>
                  {c.snapshots.slice(1).map((s) => {
                    const a = latest.yields[i]
                    const b = s.yields[i]
                    const d = isNum(a) && isNum(b) ? a - b : null
                    return (
                      <td key={s.label} className={toneClass[tone(d)]}>
                        {fmtBpFromPct(d)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="group">
                <td colSpan={2 + c.snapshots.length - 1}>Spreads, bp</td>
              </tr>
              {SPREADS.map(([name, short, long]) => {
                const now = spread('Latest', short, long)
                return (
                  <tr key={name}>
                    <td className="text-fg-2">{name}</td>
                    <td
                      className={clsx(isNum(now) && now < 0 ? 'text-down' : 'text-fg')}
                      title={isNum(now) && now < 0 ? 'Inverted' : undefined}
                    >
                      {isNum(now) ? now.toFixed(1) : '—'}
                    </td>
                    {c.snapshots.slice(1).map((s) => {
                      const then = spread(s.label, short, long)
                      const d = isNum(now) && isNum(then) ? now - then : null
                      return (
                        <td key={s.label} className={toneClass[tone(d)]}>
                          {isNum(d)
                            ? `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(0)}`
                            : '—'}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="px-2 py-2 text-[10.5px] leading-snug text-fg-3">{c.basis}.</p>
        </div>
      </div>
    </div>
  )
}

const pctFormat = (v: number) => `${v.toFixed(2)}%`

function History({ c }: { c: YieldCurve }) {
  const lines = useMemo(
    () =>
      Object.entries(c.history.series).map(([tenor, values], i) => ({
        id: tenor,
        name: tenor,
        color: PALETTE[i],
        points: c.history.dates.flatMap((d, j) =>
          isNum(values[j]) ? [{ time: d, value: values[j]! }] : [],
        ),
      })),
    [c],
  )
  return <LineChart lines={lines} format={pctFormat} />
}
