// Multi-series time line chart with a hover legend (FX history, spreads, macro, curve history).

import {
  LineSeries,
  LineStyle,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { baseOptions, removeSeries, timeKey, useChart } from './lwc'

export interface LineDef {
  id: string
  name: string
  color: string
  points: { time: string; value: number }[]
  width?: number
  dashed?: boolean
}

const twoDecimals = (v: number) => v.toFixed(2)

/** `lines` must be memoised by the caller: a new array rebuilds every series. */
export function LineChart({
  lines,
  format = twoDecimals,
  visibleFrom,
  zeroLine = false,
}: {
  lines: LineDef[]
  format?: (v: number) => string
  /** 'YYYY-MM-DD' left edge of the initial view; fits all data when omitted. */
  visibleFrom?: string
  zeroLine?: boolean
}) {
  const [ref, chart] = useChart(baseOptions())
  const [hover, setHover] = useState<string | null>(null)
  const formatRef = useRef(format)
  formatRef.current = format

  const lookup = useMemo(
    () => lines.map((l) => new Map(l.points.map((p) => [p.time, p.value]))),
    [lines],
  )

  useEffect(() => {
    if (!chart) return
    chart.applyOptions({
      localization: { locale: 'en-US', priceFormatter: (v: number) => formatRef.current(v) },
    })
    const series: ISeriesApi<'Line'>[] = lines.map((l) => {
      const s = chart.addSeries(LineSeries, {
        color: l.color,
        lineWidth: (l.width ?? 1.5) as 1,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerRadius: 3,
      })
      s.setData(l.points.map((p) => ({ time: p.time as Time, value: p.value })))
      return s
    })
    if (zeroLine && series[0])
      series[0].createPriceLine({
        price: 0,
        color: '#3a4149',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
      })
    const last = lines
      .flatMap((l) => l.points.slice(-1).map((p) => p.time))
      .sort()
      .at(-1)
    if (visibleFrom && last)
      chart.timeScale().setVisibleRange({ from: visibleFrom as Time, to: last as Time })
    else chart.timeScale().fitContent()
    return () => removeSeries(chart, series)
  }, [chart, lines, visibleFrom, zeroLine])

  useEffect(() => {
    if (!chart) return
    const onMove = (p: MouseEventParams) => setHover(p.time ? timeKey(p.time) : null)
    chart.subscribeCrosshairMove(onMove)
    return () => chart.unsubscribeCrosshairMove(onMove)
  }, [chart])

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={ref} className="absolute inset-0" />
      <div className="pointer-events-none absolute top-1.5 left-2 z-10 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px]">
        {hover && <span className="num text-fg-3">{hover}</span>}
        {lines.map((l, i) => {
          const value = hover ? lookup[i].get(hover) : l.points.at(-1)?.value
          return (
            <span key={l.id} className="flex items-center gap-1">
              <span className="h-0.5 w-2.5 rounded" style={{ background: l.color }} />
              <span className="text-fg-2">{l.name}</span>
              <span className="num text-fg">{value === undefined ? '—' : format(value)}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
