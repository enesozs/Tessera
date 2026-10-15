// GP compare mode: several securities rebased to 0% at the left edge of the visible range.

import {
  LineSeries,
  PriceScaleMode,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useState } from 'react'
import { fmtPct, tone, toneClass } from '@/lib/format'
import { baseOptions, removeSeries, timeKey, useChart } from './lwc'

export interface CompareLine {
  symbol: string
  color: string
  points: { time: Time; value: number }[]
}

/** Percent change of each line from its first point on/after `from` to the point at `at`. */
export function rebased(line: CompareLine, from: string | null, at: string | null): number | null {
  const keys = line.points.map((p) => timeKey(p.time))
  const start = from ? keys.findIndex((k) => k >= from) : 0
  if (start < 0) return null
  let end = line.points.length - 1
  if (at) {
    end = -1
    for (let i = 0; i < keys.length && keys[i] <= at; i++) end = i
  }
  if (end < start) return null
  return line.points[end].value / line.points[start].value - 1
}

export function CompareChart({
  lines,
  intraday,
  visibleFrom,
}: {
  lines: CompareLine[]
  intraday: boolean
  visibleFrom?: string
}) {
  const [ref, chart] = useChart(baseOptions(intraday))
  const [hover, setHover] = useState<string | null>(null)
  const [from, setFrom] = useState<string | null>(null)

  useEffect(() => {
    if (!chart || lines.length === 0) return
    // Percentage mode rebases every series to its first visible value — exactly a
    // relative-performance chart, and it re-rebases as you pan or zoom.
    chart
      .priceScale('right')
      .applyOptions({ mode: PriceScaleMode.Percentage, scaleMargins: { top: 0.08, bottom: 0.08 } })
    const series: ISeriesApi<'Line'>[] = lines.map((l, i) => {
      const s = chart.addSeries(LineSeries, {
        color: l.color,
        lineWidth: i === 0 ? 2 : 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerRadius: 3,
      })
      s.setData(l.points)
      return s
    })
    const last = lines[0].points.at(-1)?.time
    if (visibleFrom && last && !intraday)
      chart.timeScale().setVisibleRange({ from: visibleFrom as Time, to: last })
    else chart.timeScale().fitContent()
    return () => removeSeries(chart, series)
  }, [chart, lines, visibleFrom, intraday])

  useEffect(() => {
    if (!chart) return
    const onMove = (p: MouseEventParams) => setHover(p.time ? timeKey(p.time) : null)
    const onRange = () => {
      const r = chart.timeScale().getVisibleRange()
      setFrom(r ? timeKey(r.from) : null)
    }
    chart.subscribeCrosshairMove(onMove)
    chart.timeScale().subscribeVisibleTimeRangeChange(onRange)
    return () => {
      chart.unsubscribeCrosshairMove(onMove)
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange)
    }
  }, [chart])

  const changes = useMemo(() => lines.map((l) => rebased(l, from, hover)), [lines, from, hover])

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={ref} className="absolute inset-0" />
      <div className="pointer-events-none absolute top-1.5 left-2 z-10 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px]">
        <span className="text-fg-3">
          % since{' '}
          {from
            ? intraday
              ? new Date(Number(from) * 1000).toISOString().slice(0, 16).replace('T', ' ')
              : from
            : 'start'}
          {hover && !intraday ? ` → ${hover}` : ''}
        </span>
        {lines.map((l, i) => (
          <span key={l.symbol} className="flex items-center gap-1">
            <span className="h-0.5 w-2.5 rounded" style={{ background: l.color }} />
            <span className="text-fg-2">{l.symbol}</span>
            <span className={`num ${toneClass[tone(changes[i])]}`}>{fmtPct(changes[i], 1)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
