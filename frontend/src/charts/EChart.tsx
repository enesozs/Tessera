// Thin ECharts wrapper (tree-shaken build) for charts whose x-axis is not time, e.g. tenors.

import { LineChart as ELine, BarChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

echarts.use([
  ELine,
  BarChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
  CanvasRenderer,
])

export type EChartsOption = echarts.EChartsCoreOption

export const AXIS = {
  axisLine: { lineStyle: { color: '#1f242a' } },
  axisTick: { show: false },
  axisLabel: { color: '#6b7581', fontFamily: 'JetBrains Mono Variable', fontSize: 10 },
  splitLine: { lineStyle: { color: '#13161a' } },
}

export const TOOLTIP = {
  trigger: 'axis',
  backgroundColor: '#14171b',
  borderColor: '#2b3138',
  textStyle: { color: '#e4e7eb', fontSize: 11, fontFamily: 'JetBrains Mono Variable' },
  axisPointer: { lineStyle: { color: '#49515b', type: 'dashed' } },
}

export function EChart({ option }: { option: EChartsOption }) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const c = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chart.current = c
    const observer = new ResizeObserver(() => c.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={ref} className="h-full min-h-0 w-full" />
}
