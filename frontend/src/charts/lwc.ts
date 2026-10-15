// Shared Lightweight Charts setup: theme, time conversion, and a React hook that owns a chart.

import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type ChartOptions,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'

export const C = {
  text: '#6b7581',
  grid: '#13161a',
  border: '#1f242a',
  cross: '#49515b',
  label: '#2b3138',
  up: '#2ec27e',
  down: '#ff5d5d',
  amber: '#ffb020',
  info: '#5aa9ff',
}

/** Distinct, dark-background-safe series colours, in assignment order. */
export const PALETTE = [
  '#ffb020',
  '#5aa9ff',
  '#a78bfa',
  '#2ec27e',
  '#fb7185',
  '#22d3ee',
  '#a3e635',
  '#f97316',
  '#e879f9',
  '#94a3b8',
]

export function baseOptions(intraday = false): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: C.text,
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      fontSize: 10,
      attributionLogo: true,
    },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.border },
    timeScale: {
      borderColor: C.border,
      timeVisible: intraday,
      secondsVisible: false,
      rightOffset: 3,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: C.cross, labelBackgroundColor: C.label, style: LineStyle.Dashed },
      horzLine: { color: C.cross, labelBackgroundColor: C.label, style: LineStyle.Dashed },
    },
    localization: { locale: 'en-US' },
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/**
 * Lightweight Charts renders timestamps as UTC. To show exchange-local session times we
 * shift each instant by its zone offset ("wall-clock" time), which keeps DST correct.
 */
export function toWallClock(unixSeconds: number, timeZone: string | null): UTCTimestamp {
  if (!timeZone) return unixSeconds as UTCTimestamp
  let fmt = formatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, fmt)
  }
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(unixSeconds * 1000)).map((p) => [p.type, p.value]),
  )
  return (Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  ) / 1000) as UTCTimestamp
}

export function timeKey(t: Time): string {
  if (typeof t === 'number') return String(t)
  if (typeof t === 'string') return t
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

// React runs effect cleanups in declaration order, so on unmount the chart is disposed
// before the effects that added series get to remove them.
const disposed = new WeakSet<IChartApi>()

/** Remove series from a chart unless the chart itself has already been disposed. */
export function removeSeries(chart: IChartApi, series: ISeriesApi<SeriesType>[]) {
  if (disposed.has(chart)) return
  for (const s of series) chart.removeSeries(s)
}

/** Create a chart in a container for the component's lifetime. */
export function useChart(options: DeepPartial<ChartOptions>) {
  const ref = useRef<HTMLDivElement>(null)
  const [chart, setChart] = useState<IChartApi | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const c = createChart(ref.current, options)
    setChart(c)
    return () => {
      setChart(null)
      disposed.add(c)
      c.remove()
    }
    // Options are applied once; callers use chart.applyOptions for changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return [ref, chart] as const
}
