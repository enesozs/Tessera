// The GP chart: candles / line / area, volume, moving averages, dividend & split markers.

import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  PriceScaleMode,
  createSeriesMarkers,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useState } from 'react'
import type { History } from '@/api/types'
import { fmtCompact, fmtPct, fmtPrice, tone, toneClass } from '@/lib/format'
import { C, baseOptions, removeSeries, timeKey, toWallClock, useChart } from './lwc'

export type ChartStyle = 'candles' | 'line' | 'area'

export const SMA_COLORS: Record<number, string> = { 20: '#5aa9ff', 50: '#a78bfa', 200: '#f97316' }

interface Row {
  time: Time
  key: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function sma(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= window) sum -= values[i - window]
    out.push(i >= window - 1 ? sum / window : null)
  }
  return out
}

export function PriceChart({
  history,
  style,
  log,
  adjusted,
  averages,
  visibleFrom,
}: {
  history: History
  style: ChartStyle
  log: boolean
  adjusted: boolean
  averages: number[]
  /** 'YYYY-MM-DD' left edge for daily data; undefined fits everything. */
  visibleFrom?: string
}) {
  const intraday = history.span.startsWith('intraday')
  const [ref, chart] = useChart(baseOptions(intraday))
  const [hover, setHover] = useState<number | null>(null)

  const rows: Row[] = useMemo(
    () =>
      history.bars.map((b) => {
        // Dividend adjustment rescales the whole bar by the adj-close / close ratio.
        const k = adjusted && b.adj_close && b.close ? b.adj_close / b.close : 1
        const time = (
          typeof b.time === 'number' ? toWallClock(b.time, history.timezone) : b.time
        ) as Time
        return {
          time,
          key: timeKey(time),
          open: b.open * k,
          high: b.high * k,
          low: b.low * k,
          close: b.close * k,
          volume: b.volume,
        }
      }),
    [history, adjusted],
  )

  useEffect(() => {
    if (!chart || rows.length === 0) return
    chart.applyOptions({ timeScale: { timeVisible: intraday } })
    chart.priceScale('right').applyOptions({
      mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      scaleMargins: { top: 0.08, bottom: 0.22 },
    })

    const main =
      style === 'candles'
        ? chart.addSeries(CandlestickSeries, {
            upColor: C.up,
            downColor: C.down,
            borderVisible: false,
            wickUpColor: C.up,
            wickDownColor: C.down,
            priceLineColor: C.amber,
          })
        : style === 'area'
          ? chart.addSeries(AreaSeries, {
              lineColor: C.amber,
              topColor: 'rgba(255,176,32,0.22)',
              bottomColor: 'rgba(255,176,32,0.0)',
              lineWidth: 2,
              priceLineColor: C.amber,
            })
          : chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, priceLineColor: C.amber })
    if (style === 'candles')
      main.setData(
        rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
      )
    else main.setData(rows.map((r) => ({ time: r.time, value: r.close })))

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    volume.setData(
      rows.map((r, i) => ({
        time: r.time,
        value: r.volume,
        color:
          r.close >= (rows[i - 1]?.close ?? r.open)
            ? 'rgba(46,194,126,0.35)'
            : 'rgba(255,93,93,0.35)',
      })),
    )

    const closes = rows.map((r) => r.close)
    const overlays = averages.map((n) => {
      const s = chart.addSeries(LineSeries, {
        color: SMA_COLORS[n] ?? C.info,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      const values = sma(closes, n)
      s.setData(
        rows.flatMap((r, i) => (values[i] === null ? [] : [{ time: r.time, value: values[i]! }])),
      )
      return s
    })

    if (!intraday && history.events.length) {
      const markers: SeriesMarker<Time>[] = history.events
        .filter((e) => rows.length && e.time >= rows[0].key)
        .map((e) => ({
          time: e.time as Time,
          position: 'belowBar',
          shape: 'circle',
          color: e.kind === 'split' ? C.info : '#6b7581',
          text: e.kind === 'split' ? `S ${e.value}:1` : 'D',
          size: 0.6,
        }))
      createSeriesMarkers(main, markers)
    }

    if (visibleFrom && !intraday) {
      chart
        .timeScale()
        .setVisibleRange({ from: visibleFrom as Time, to: rows[rows.length - 1].time })
    } else {
      chart.timeScale().fitContent()
    }

    return () => {
      removeSeries(chart, [main, volume, ...overlays])
    }
  }, [chart, rows, style, log, averages, visibleFrom, intraday, history.events])

  useEffect(() => {
    if (!chart) return
    const index = new Map(rows.map((r, i) => [r.key, i]))
    const onMove = (p: MouseEventParams) =>
      setHover(p.time ? (index.get(timeKey(p.time)) ?? null) : null)
    chart.subscribeCrosshairMove(onMove)
    return () => chart.unsubscribeCrosshairMove(onMove)
  }, [chart, rows])

  const i = hover ?? rows.length - 1
  const bar = rows[i]
  const prev = rows[i - 1]
  const change = bar && prev ? bar.close / prev.close - 1 : null

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={ref} className="absolute inset-0" />
      {bar && (
        <div className="pointer-events-none absolute top-1.5 left-2 z-10 flex flex-wrap items-baseline gap-x-2.5 text-[10.5px]">
          <span className="num text-fg-3">
            {intraday
              ? new Date(Number(bar.time) * 1000).toISOString().slice(0, 16).replace('T', ' ')
              : bar.key}
          </span>
          {(['open', 'high', 'low', 'close'] as const).map((k) => (
            <span key={k}>
              <span className="text-fg-3">{k[0].toUpperCase()} </span>
              <span className="num text-fg">{fmtPrice(bar[k])}</span>
            </span>
          ))}
          <span className={`num ${toneClass[tone(change)]}`}>{fmtPct(change)}</span>
          <span>
            <span className="text-fg-3">Vol </span>
            <span className="num text-fg-2">{fmtCompact(bar.volume, 1)}</span>
          </span>
          {averages.map((n) => {
            const v = sma(
              rows.slice(Math.max(0, i - n + 1), i + 1).map((r) => r.close),
              n,
            ).at(-1)
            return (
              <span key={n} style={{ color: SMA_COLORS[n] }}>
                SMA{n} <span className="num">{v ? fmtPrice(v) : '—'}</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
