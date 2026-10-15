import clsx from 'clsx'
import { useMemo } from 'react'
import { useVolSurface } from '@/api/client'
import type { SmileSlice, VolSurfaceView } from '@/api/types'
import { AXIS, EChart, TOOLTIP, type EChartsOption } from '@/charts/EChart'
import { fmtDate, fmtFixed, fmtPct, isNum } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { SectionTitle, Spacer, Stat, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

export function Ivol({ pane }: FnProps) {
  const query = useVolSurface(pane.security)
  const setParams = useWorkspace((s) => s.setParams)
  const s = query.data?.data
  const index = Math.min(
    Number(pane.params.slice ?? 0) || 0,
    Math.max(0, (s?.slices.length ?? 1) - 1),
  )
  return (
    <FnFrame
      query={query}
      loadingRows={12}
      toolbar={
        <Toolbar>
          <span className="text-[10.5px] text-fg-3">Expiry</span>
          <div className="flex flex-wrap gap-1">
            {s?.slices.map((sl, i) => (
              <button
                key={sl.expiry}
                type="button"
                onClick={() => setParams(pane.id, { slice: String(i) })}
                title={fmtDate(sl.expiry)}
                className={clsx(
                  'num h-[22px] rounded-[3px] border px-1.5 text-[10.5px]',
                  i === index
                    ? 'border-amber-dim bg-raised text-amber'
                    : 'border-line text-fg-3 hover:text-fg',
                )}
              >
                {sl.days}d{sl.butterfly_arbitrage && <span className="ml-0.5 text-down">!</span>}
              </button>
            ))}
          </div>
          <Spacer />
          {s && <span className="text-[10.5px] text-fg-3">prices: {s.price_basis}</span>}
        </Toolbar>
      }
    >
      {(v) => <IvolBody v={v} slice={v.slices[index]} />}
    </FnFrame>
  )
}

function IvolBody({ v, slice }: { v: VolSurfaceView; slice: SmileSlice }) {
  const front = v.slices[0]
  const ivrv =
    front && isNum(v.realized_vol_30d) && v.realized_vol_30d > 0
      ? front.atm_vol / v.realized_vol_30d
      : null
  return (
    <div className="flex h-full min-h-0 flex-col @container">
      <div className="grid shrink-0 grid-cols-2 gap-x-6 border-b border-line px-3 py-1 @3xl:grid-cols-4">
        <Stat label={`ATM IV, ${slice.days}d`}>{fmtPct(slice.atm_vol, 1, false)}</Stat>
        <Stat
          label="Realised vol 30d / 90d"
          title="Annualised close-to-close volatility of daily returns"
        >
          {fmtPct(v.realized_vol_30d, 1, false)} / {fmtPct(v.realized_vol_90d, 1, false)}
        </Stat>
        <Stat
          label="Front IV ÷ 30d RV"
          title="Above 1: options price more movement than recently realised"
        >
          {isNum(ivrv) ? `${fmtFixed(ivrv, 2)}×` : '—'}
        </Stat>
        <Stat
          label="Skew 90–110%"
          title="IV at 90% of the forward minus IV at 110%, from the SVI fit"
        >
          {isNum(slice.skew_90_110) ? `${fmtFixed(slice.skew_90_110 * 100, 1)} pts` : '—'}
        </Stat>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @4xl:grid-cols-[3fr_2fr] @4xl:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col">
          <SectionTitle>
            <span className="px-3">
              Smile · {fmtDate(slice.expiry)} · fwd {fmtFixed(slice.forward, 2)}
            </span>
          </SectionTitle>
          <div className="min-h-0 flex-1">
            <Smile slice={slice} spot={v.spot} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col border-line @4xl:border-l">
          <SectionTitle>
            <span className="px-3">ATM term structure</span>
          </SectionTitle>
          <div className="min-h-[120px] flex-1">
            <Term v={v} />
          </div>
          <div className="pane-scroll hidden max-h-[45%] shrink-0 border-t border-line @4xl:block">
            <SliceTable v={v} current={slice.expiry} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Smile({ slice, spot }: { slice: SmileSlice; spot: number }) {
  const option = useMemo<EChartsOption>(() => {
    const pts = (kind: string, source: string) =>
      slice.points
        .filter((p) => p.kind === kind && p.source === source)
        .map((p) => [p.strike, p.iv * 100])
    return {
      animation: false,
      grid: { left: 42, right: 14, top: 26, bottom: 24 },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#14171b',
        borderColor: '#2b3138',
        textStyle: { color: '#e4e7eb', fontSize: 11 },
        formatter: (p: { seriesName: string; value: number[] }) =>
          `${p.seriesName}<br/>K ${p.value[0].toFixed(2)} · IV ${p.value[1].toFixed(1)}%`,
      },
      legend: {
        top: 2,
        left: 4,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: '#a3acb7', fontSize: 10.5 },
      },
      xAxis: { type: 'value', scale: true, ...AXIS, splitLine: { show: false } },
      yAxis: {
        type: 'value',
        scale: true,
        ...AXIS,
        axisLabel: { ...AXIS.axisLabel, formatter: '{value}%' },
      },
      series: [
        {
          name: 'OTM puts (mid)',
          type: 'scatter',
          symbolSize: 6,
          itemStyle: { color: '#ff5d5d' },
          data: pts('put', 'mid'),
        },
        {
          name: 'OTM calls (mid)',
          type: 'scatter',
          symbolSize: 6,
          itemStyle: { color: '#2ec27e' },
          data: pts('call', 'mid'),
        },
        {
          name: 'Last trades',
          type: 'scatter',
          symbol: 'emptyCircle',
          symbolSize: 6,
          itemStyle: { color: '#a3acb7' },
          data: [...pts('put', 'last'), ...pts('call', 'last')],
        },
        {
          name: 'SVI fit',
          type: 'line',
          showSymbol: false,
          lineStyle: { color: '#ffb020', width: 2 },
          itemStyle: { color: '#ffb020' },
          data: slice.fit_strikes.map((k, i) => [k, slice.fit_iv[i] * 100]),
          markLine: {
            silent: true,
            symbol: 'none',
            label: { color: '#6b7581', fontSize: 9.5, formatter: '{b}' },
            lineStyle: { color: '#49515b', type: 'dashed' },
            data: [{ name: 'spot', xAxis: spot }],
          },
        },
      ],
    }
  }, [slice, spot])
  return <EChart option={option} />
}

function Term({ v }: { v: VolSurfaceView }) {
  const option = useMemo<EChartsOption>(() => {
    const maxDays = Math.max(...v.slices.map((s) => s.days))
    const flat = (name: string, value: number | null, color: string) =>
      isNum(value)
        ? [
            {
              name,
              type: 'line',
              showSymbol: false,
              lineStyle: { color, type: 'dashed', width: 1 },
              itemStyle: { color },
              data: [
                [0, value * 100],
                [maxDays, value * 100],
              ],
            },
          ]
        : []
    return {
      animation: false,
      grid: { left: 42, right: 14, top: 26, bottom: 24 },
      tooltip: { ...TOOLTIP, trigger: 'item', valueFormatter: (x: number) => `${x.toFixed(1)}%` },
      legend: {
        top: 2,
        left: 4,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: '#a3acb7', fontSize: 10.5 },
      },
      xAxis: {
        type: 'value',
        name: 'days',
        nameTextStyle: { color: '#6b7581', fontSize: 9.5 },
        ...AXIS,
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        ...AXIS,
        axisLabel: { ...AXIS.axisLabel, formatter: '{value}%' },
      },
      series: [
        {
          name: 'ATM IV',
          type: 'line',
          symbolSize: 6,
          lineStyle: { color: '#ffb020', width: 2 },
          itemStyle: { color: '#ffb020' },
          data: v.slices.map((s) => [s.days, s.atm_vol * 100]),
        },
        ...flat('RV 30d', v.realized_vol_30d, '#5aa9ff'),
        ...flat('RV 90d', v.realized_vol_90d, '#a78bfa'),
      ],
    }
  }, [v])
  return <EChart option={option} />
}

function SliceTable({ v, current }: { v: VolSurfaceView; current: string }) {
  return (
    <table className="dt num">
      <thead>
        <tr>
          <th>Expiry</th>
          <th>Days</th>
          <th>ATM IV</th>
          <th title="IV(90%) − IV(110%), vol points">Skew</th>
          <th title="Quotes used after cleaning">Pts</th>
          <th title="SVI fit error, vol points">RMSE</th>
          <th title="Butterfly arbitrage in the fitted smile">Arb</th>
        </tr>
      </thead>
      <tbody>
        {v.slices.map((s) => (
          <tr key={s.expiry} className={clsx(s.expiry === current && '[&>td]:!bg-amber/10')}>
            <td className="text-fg-2">{fmtDate(s.expiry)}</td>
            <td className="text-fg-3">{s.days}</td>
            <td className="text-fg">{fmtPct(s.atm_vol, 1, false)}</td>
            <td className="text-fg-2">
              {isNum(s.skew_90_110) ? fmtFixed(s.skew_90_110 * 100, 1) : '—'}
            </td>
            <td
              className="text-fg-3"
              title={
                Object.entries(s.dropped)
                  .map(([k, n]) => `${n} ${k}`)
                  .join('\n') || 'nothing dropped'
              }
            >
              {s.points.length}
            </td>
            <td className="text-fg-3">{isNum(s.rmse) ? fmtFixed(s.rmse * 100, 2) : '—'}</td>
            <td className={s.butterfly_arbitrage ? 'text-down' : 'text-fg-4'}>
              {s.butterfly_arbitrage ? 'yes' : 'no'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
