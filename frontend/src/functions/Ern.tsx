import { useMemo } from 'react'
import { useEarnings } from '@/api/client'
import type { Earnings, Estimate } from '@/api/types'
import { AXIS, EChart, TOOLTIP, type EChartsOption } from '@/charts/EChart'
import { fmtCompact, fmtDate, fmtFixed, fmtPct, isNum, tone, toneClass } from '@/lib/format'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, SectionTitle } from '@/ui/primitives'
import type { FnProps } from './types'

const PERIOD_LABEL: Record<string, string> = {
  '0q': 'Current qtr',
  '+1q': 'Next qtr',
  '0y': 'Current FY',
  '+1y': 'Next FY',
}

export function Ern({ pane }: FnProps) {
  const query = useEarnings(pane.security)
  return <FnFrame query={query}>{(e) => <ErnBody e={e} />}</FnFrame>
}

function ErnBody({ e }: { e: Earnings }) {
  const reported = useMemo(() => e.history.filter((h) => isNum(h.eps_actual)).slice(-12), [e])
  const beats = reported.filter((h) => isNum(h.surprise_pct) && h.surprise_pct! > 0).length
  const days = e.next_date
    ? Math.ceil((new Date(`${e.next_date}T00:00:00`).getTime() - Date.now()) / 86_400_000)
    : null

  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 40, right: 12, top: 26, bottom: 22 },
      tooltip: {
        ...TOOLTIP,
        valueFormatter: (v: number | null) => (isNum(v) ? v.toFixed(2) : '—'),
      },
      legend: {
        data: ['Actual', 'Estimate'],
        top: 2,
        left: 4,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: '#a3acb7', fontSize: 10.5 },
      },
      xAxis: {
        type: 'category',
        data: reported.map((h) => h.date.slice(0, 7)),
        ...AXIS,
        splitLine: { show: false },
      },
      yAxis: { type: 'value', scale: true, ...AXIS },
      series: [
        {
          name: 'Actual',
          type: 'bar',
          barWidth: '45%',
          itemStyle: { color: '#2ec27e' },
          data: reported.map((h) => ({
            value: h.eps_actual,
            itemStyle: { color: (h.surprise_pct ?? 0) >= 0 ? '#2ec27e' : '#ff5d5d' },
          })),
        },
        {
          // The consensus is a marker on top of each bar: above the bar top = a miss.
          name: 'Estimate',
          type: 'scatter',
          symbol: 'rect',
          symbolSize: [22, 2],
          itemStyle: { color: '#e4e7eb' },
          z: 10,
          data: reported.map((h) => h.eps_estimate),
        },
      ],
    }),
    [reported],
  )

  return (
    <div className="pane-scroll h-full px-3 py-2 @container">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-line pb-2">
        <div>
          <span className="text-[10.5px] tracking-wide text-fg-3 uppercase">Next report </span>
          <span className="num text-[15px] text-amber">
            {e.next_date ? fmtDate(e.next_date) : 'not scheduled'}
          </span>
          {isNum(days) && days >= 0 && <span className="ml-2 text-fg-3">in {days} days</span>}
        </div>
        <div>
          <span className="text-[10.5px] tracking-wide text-fg-3 uppercase">Beat rate </span>
          <span className="num text-fg">
            {beats}/{reported.length}
          </span>
          <span className="ml-1 text-fg-3">quarters above consensus</span>
        </div>
        {e.currency && <span className="text-[10.5px] text-fg-3">EPS in {e.currency}</span>}
      </div>

      <div className="grid gap-x-6 @4xl:grid-cols-2">
        <div>
          <SectionTitle>EPS: actual vs consensus</SectionTitle>
          <div className="h-[200px]">{reported.length > 0 && <EChart option={option} />}</div>
          <table className="dt num mt-1">
            <thead>
              <tr>
                <th>Reported</th>
                <th>Estimate</th>
                <th>Actual</th>
                <th>Surprise</th>
              </tr>
            </thead>
            <tbody>
              {[...e.history]
                .reverse()
                .slice(0, 12)
                .map((h) => (
                  <tr key={h.date}>
                    <td className="text-fg-2">{fmtDate(h.date)}</td>
                    <td className="text-fg-2">{fmtFixed(h.eps_estimate)}</td>
                    <td className="text-fg">
                      {isNum(h.eps_actual) ? (
                        fmtFixed(h.eps_actual)
                      ) : (
                        <span className="text-amber/80">upcoming</span>
                      )}
                    </td>
                    <td>
                      <Delta value={h.surprise_pct}>{fmtPct(h.surprise_pct, 1)}</Delta>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div>
          <EstimateTable title="Revenue estimates" rows={e.revenue_estimates} money />
          <EstimateTable title="EPS estimates" rows={e.eps_estimates} />
          {e.eps_revisions.length > 0 && (
            <>
              <SectionTitle>EPS estimate revisions</SectionTitle>
              <table className="dt num">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Now</th>
                    <th>7d ago</th>
                    <th>30d ago</th>
                    <th>90d ago</th>
                    <th title="Change in the consensus over 90 days">Δ90d</th>
                  </tr>
                </thead>
                <tbody>
                  {e.eps_revisions.map((r) => {
                    const d =
                      isNum(r.current) && isNum(r.days_90) && r.days_90 !== 0
                        ? r.current / r.days_90 - 1
                        : null
                    return (
                      <tr key={r.period}>
                        <td className="font-sans text-fg-2">
                          {PERIOD_LABEL[r.period] ?? r.period}
                        </td>
                        <td className="text-fg">{fmtFixed(r.current)}</td>
                        <td className="text-fg-2">{fmtFixed(r.days_7)}</td>
                        <td className="text-fg-2">{fmtFixed(r.days_30)}</td>
                        <td className="text-fg-2">{fmtFixed(r.days_90)}</td>
                        <td className={toneClass[tone(d)]}>{fmtPct(d, 1)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function EstimateTable({
  title,
  rows,
  money,
}: {
  title: string
  rows: Estimate[]
  money?: boolean
}) {
  if (!rows.length) return null
  const f = (v: number | null) => (money ? fmtCompact(v, 2) : fmtFixed(v))
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <table className="dt num">
        <thead>
          <tr>
            <th>Period</th>
            <th>Average</th>
            <th>Low</th>
            <th>High</th>
            <th>Year ago</th>
            <th>Growth</th>
            <th title="Number of analysts">#</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period}>
              <td className="font-sans text-fg-2">{PERIOD_LABEL[r.period] ?? r.period}</td>
              <td className="text-fg">{f(r.avg)}</td>
              <td className="text-fg-3">{f(r.low)}</td>
              <td className="text-fg-3">{f(r.high)}</td>
              <td className="text-fg-3">{f(r.year_ago)}</td>
              <td>
                <Delta value={r.growth}>{fmtPct(r.growth, 1)}</Delta>
              </td>
              <td className="text-fg-3">{r.analysts ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
