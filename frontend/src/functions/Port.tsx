import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { usePortfolio } from '@/api/client'
import type { PortfolioAnalysis, PortfolioRequest } from '@/api/types'
import { AXIS, EChart, TOOLTIP, type EChartsOption } from '@/charts/EChart'
import { LineChart } from '@/charts/LineChart'
import { C } from '@/charts/lwc'
import { isTicker } from '@/lib/command'
import { parseHoldings } from '@/lib/holdings'
import {
  fmtCompact,
  fmtDate,
  fmtFixed,
  fmtPct,
  fmtPrice,
  isNum,
  tone,
  toneClass,
} from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, Empty, SectionTitle, Seg, Spacer, Stat, Toggle, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

type View = 'overview' | 'risk' | 'stress' | 'optimise'
const BASES = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'TRY']

export function Port({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const selectSecurity = useWorkspace((s) => s.selectSecurity)
  const portfolio = useWorkspace((s) => s.portfolio)
  const view = (pane.params.view ?? 'overview') as View
  const lookback = Number(pane.params.lookback ?? 3) as PortfolioRequest['lookback_years']
  const confidence = Number(pane.params.confidence ?? 0.95)
  const [editing, setEditing] = useState(false)

  const request = useMemo<PortfolioRequest | null>(
    () =>
      portfolio.holdings.length
        ? {
            holdings: portfolio.holdings,
            base: portfolio.base,
            benchmark: portfolio.benchmark,
            lookback_years: lookback,
            confidence,
          }
        : null,
    [portfolio, lookback, confidence],
  )
  const query = usePortfolio(request)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Seg
          value={view}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'risk', label: 'Risk' },
            { value: 'stress', label: 'Stress' },
            { value: 'optimise', label: 'Optimise' },
          ]}
          onChange={(v) => setParams(pane.id, { view: v })}
        />
        <Seg
          value={String(lookback)}
          options={['1', '2', '3', '5'].map((y) => ({
            value: y,
            label: `${y}Y`,
            hint: `${y}-year look-back`,
          }))}
          onChange={(v) => setParams(pane.id, { lookback: v })}
        />
        <Seg
          value={String(confidence)}
          options={[
            { value: '0.95', label: '95%' },
            { value: '0.99', label: '99%' },
          ]}
          onChange={(v) => setParams(pane.id, { confidence: v })}
          title="VaR / ES confidence level"
        />
        <Spacer />
        <span className="text-[10.5px] text-fg-3">
          {portfolio.name} · {portfolio.holdings.length} holdings · {portfolio.base} vs{' '}
          {portfolio.benchmark}
        </span>
        <Toggle on={editing} onChange={setEditing}>
          Edit
        </Toggle>
      </Toolbar>
      {editing && <Editor onDone={() => setEditing(false)} />}
      <div className="min-h-0 flex-1">
        <FnFrame
          query={query}
          loadingRows={12}
          idle={<Empty>The portfolio is empty. Click Edit to add holdings.</Empty>}
          errorHint="Check the tickers in Edit; every holding needs Yahoo price history."
        >
          {(a) => (
            <div className="pane-scroll h-full @container">
              {Object.keys(a.excluded).length > 0 && (
                <div className="border-b border-line bg-down/10 px-3 py-1 text-[10.5px] text-down">
                  Excluded:{' '}
                  {Object.entries(a.excluded)
                    .map(([s, e]) => `${s} (${e})`)
                    .join(' · ')}
                </div>
              )}
              {view === 'overview' && (
                <Overview
                  a={a}
                  selected={pane.security}
                  onSelect={(s) => selectSecurity(pane.id, s)}
                />
              )}
              {view === 'risk' && <Risk a={a} />}
              {view === 'stress' && <Stress a={a} />}
              {view === 'optimise' && <Optimise a={a} />}
            </div>
          )}
        </FnFrame>
      </div>
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────────────────

function Editor({ onDone }: { onDone: () => void }) {
  const portfolio = useWorkspace((s) => s.portfolio)
  const setPortfolio = useWorkspace((s) => s.setPortfolio)
  const [text, setText] = useState(
    portfolio.holdings.map((h) => `${h.symbol} ${h.shares}`).join('\n'),
  )
  const [base, setBase] = useState(portfolio.base)
  const [benchmark, setBenchmark] = useState(portfolio.benchmark)
  const [name, setName] = useState(portfolio.name)
  const parsed = parseHoldings(text)

  return (
    <div className="grid shrink-0 gap-3 border-b border-line bg-raised/40 px-3 py-2 @container sm:grid-cols-[1fr_220px]">
      <label className="flex flex-col gap-1 text-[10.5px] text-fg-3">
        Holdings — one per line: TICKER SHARES (paste from a spreadsheet works)
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          spellCheck={false}
          aria-label="Holdings"
          className="num rounded-[3px] border border-line bg-canvas p-2 text-[11.5px] text-fg uppercase focus:border-amber-dim focus:outline-none"
        />
        {parsed.errors.length > 0 && (
          <span className="text-down">Ignored: {parsed.errors.join(' · ')}</span>
        )}
      </label>
      <div className="flex flex-col gap-2 text-[10.5px] text-fg-3">
        <label className="flex flex-col gap-1">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-[24px] rounded-[3px] border border-line bg-canvas px-2 text-[11px] text-fg focus:border-amber-dim focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          Base currency
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="num h-[24px] rounded-[3px] border border-line bg-canvas px-1.5 text-[11px] text-fg"
          >
            {BASES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Benchmark
          <input
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value.toUpperCase())}
            className="num h-[24px] rounded-[3px] border border-line bg-canvas px-2 text-[11px] text-fg focus:border-amber-dim focus:outline-none"
          />
        </label>
        <div className="mt-auto flex gap-1.5">
          <button
            type="button"
            disabled={!parsed.holdings.length || !isTicker(benchmark)}
            onClick={() => {
              setPortfolio({
                holdings: parsed.holdings,
                base,
                benchmark,
                name: name.trim() || 'Portfolio',
              })
              onDone()
            }}
            className="h-[24px] flex-1 rounded-[3px] border border-amber-dim bg-amber/10 text-[11px] text-amber enabled:hover:bg-amber/20 disabled:opacity-40"
          >
            Apply ({parsed.holdings.length})
          </button>
          <button
            type="button"
            onClick={onDone}
            className="h-[24px] rounded-[3px] border border-line px-2 text-[11px] text-fg-2 hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Views ─────────────────────────────────────────────────────────────────────

const pct = (v: number | null | undefined, d = 1) => fmtPct(v, d, false)

function Headline({ a }: { a: PortfolioAnalysis }) {
  const s = a.stats
  return (
    <div className="grid gap-x-6 border-b border-line px-3 py-2 @xl:grid-cols-2 @4xl:grid-cols-4">
      <Stat label={`Value (${a.base})`}>{fmtPrice(a.value, 0)}</Stat>
      <Stat
        label="Return, annualised"
        title={`${fmtDate(a.start)} – ${fmtDate(a.end)}, total return in ${a.base}`}
      >
        <Delta value={s.return}>{fmtPct(s.return, 1)}</Delta>
        <span className="ml-1.5 text-fg-3">vs {pct(s.benchmark_return)}</span>
      </Stat>
      <Stat label="Volatility" title="Annualised standard deviation of daily returns">
        {pct(s.volatility)} <span className="text-fg-3">vs {pct(s.benchmark_volatility)}</span>
      </Stat>
      <Stat label="Max drawdown">
        <Delta value={s.max_drawdown}>{fmtPct(s.max_drawdown, 1)}</Delta>
        <span className="ml-1.5 text-fg-3">vs {fmtPct(s.benchmark_max_drawdown, 1)}</span>
      </Stat>
      <Stat label="Sharpe / Sortino" title={`Risk-free ${pct(a.rf, 2)}`}>
        {fmtFixed(s.sharpe, 2)} / {fmtFixed(s.sortino, 2)}
      </Stat>
      <Stat label={`Beta / correlation to ${a.benchmark}`}>
        {fmtFixed(s.beta, 2)} / {fmtFixed(s.correlation, 2)}
      </Stat>
      <Stat label="Tracking error / info ratio">
        {pct(s.tracking_error)} / {fmtFixed(s.information_ratio, 2)}
      </Stat>
      <Stat
        label="Effective N / div. ratio"
        title="1/HHI of weights · weighted asset vol ÷ portfolio vol"
      >
        {fmtFixed(a.diversification.effective_n, 1)} /{' '}
        {fmtFixed(a.diversification.diversification_ratio, 2)}
      </Stat>
    </div>
  )
}

function Overview({
  a,
  selected,
  onSelect,
}: {
  a: PortfolioAnalysis
  selected?: string
  onSelect: (s: string) => void
}) {
  const lines = useMemo(
    () => [
      {
        id: 'p',
        name: 'Portfolio',
        color: C.amber,
        width: 2,
        points: a.performance.dates.map((d, i) => ({ time: d, value: a.performance.portfolio[i] })),
      },
      {
        id: 'b',
        name: a.benchmark,
        color: '#94a3b8',
        points: a.performance.dates.map((d, i) => ({ time: d, value: a.performance.benchmark[i] })),
      },
    ],
    [a],
  )
  return (
    <>
      <Headline a={a} />
      <div className="h-[220px] border-b border-line">
        <LineChart lines={lines} format={(v) => v.toFixed(1)} />
      </div>
      <table className="dt num">
        <thead>
          <tr>
            <th>Holding</th>
            <th>Ccy</th>
            <th>Shares</th>
            <th>Price ({a.base})</th>
            <th>Value</th>
            <th>Weight</th>
            <th title="Share of portfolio volatility (Euler contribution)">Risk</th>
            <th title="Total return over the look-back, in the base currency">Return</th>
            <th>Vol</th>
            <th>Beta</th>
          </tr>
        </thead>
        <tbody>
          {a.positions.map((p) => (
            <tr
              key={p.symbol}
              onClick={() => onSelect(p.symbol)}
              className={clsx('cursor-pointer', selected === p.symbol && '[&>td]:!bg-amber/10')}
            >
              <td className="max-w-0 min-w-44 truncate font-sans">
                <span className={selected === p.symbol ? 'text-amber' : 'text-fg'}>{p.name}</span>
                <span className="num ml-2 text-[10.5px] text-fg-3">{p.symbol}</span>
              </td>
              <td className="text-fg-3">{p.currency}</td>
              <td className="text-fg-2">{fmtFixed(p.shares, p.shares % 1 ? 2 : 0)}</td>
              <td className="text-fg-2">{fmtPrice(p.price)}</td>
              <td className="text-fg">{fmtCompact(p.value, 1)}</td>
              <td className="text-fg">{pct(p.weight)}</td>
              <td className={p.risk_share > p.weight * 1.25 ? 'text-amber' : 'text-fg-2'}>
                {pct(p.risk_share)}
              </td>
              <td>
                <Delta value={p.period_return}>{fmtPct(p.period_return, 1)}</Delta>
              </td>
              <td className="text-fg-2">{pct(p.volatility)}</td>
              <td className="text-fg-2">{fmtFixed(p.beta, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[10.5px] text-fg-4">
        Risk share in amber where a holding contributes notably more volatility than its weight.
        Betas of non-U.S. listings are understated against a U.S. benchmark because their markets
        close at different times.
      </p>
    </>
  )
}

function Risk({ a }: { a: PortfolioAnalysis }) {
  const conf = `${Math.round(a.confidence * 100)}%`
  return (
    <>
      <Headline a={a} />
      <div className="grid gap-x-6 px-3 py-2 @4xl:grid-cols-2">
        <div>
          <SectionTitle>1-day Value at Risk & Expected Shortfall, {conf}</SectionTitle>
          <table className="dt num">
            <thead>
              <tr>
                <th>Method</th>
                <th>VaR %</th>
                <th>ES %</th>
                <th>VaR {a.base}</th>
                <th>ES {a.base}</th>
                <th title="√10 scaling of 1-day VaR">10-day VaR</th>
              </tr>
            </thead>
            <tbody>
              {a.var.map((v) => (
                <tr key={v.method}>
                  <td className="font-sans text-fg-2 capitalize">{v.method}</td>
                  <td className="text-fg">{pct(v.var_pct, 2)}</td>
                  <td className="text-fg">{pct(v.es_pct, 2)}</td>
                  <td className="text-down/90">{fmtCompact(v.var_amount, 1)}</td>
                  <td className="text-down/90">{fmtCompact(v.es_amount, 1)}</td>
                  <td className="text-fg-2">{fmtCompact(v.var_10d_amount, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10.5px] leading-relaxed text-fg-4">
            VaR: the loss exceeded on only {Math.round((1 - a.confidence) * 100)}% of days. ES: the
            average loss on those days. Historical uses the {a.days} realised days; parametric and
            Monte Carlo assume normal returns with a Ledoit–Wolf covariance (shrinkage{' '}
            {fmtFixed(a.shrinkage, 2)}), so they understate fat tails.
          </p>
          <SectionTitle>Weight vs risk contribution</SectionTitle>
          <div className="h-[260px]">
            <RiskBars a={a} />
          </div>
        </div>
        <div>
          <SectionTitle>Correlation (daily returns)</SectionTitle>
          <div className="h-[300px]">
            <Heatmap a={a} />
          </div>
          <div className="grid gap-x-6 @xl:grid-cols-3">
            {(['sector', 'country', 'currency'] as const).map((k) => (
              <div key={k}>
                <SectionTitle>{k}</SectionTitle>
                {a.exposures[k].map((e) => (
                  <div key={e.name} className="flex items-center gap-2 py-[2px]">
                    <span className="w-24 truncate text-fg-2" title={e.name}>
                      {e.name}
                    </span>
                    <div className="h-1.5 flex-1 rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-amber/70"
                        style={{ width: `${e.weight * 100}%` }}
                      />
                    </div>
                    <span className="num w-11 text-right text-fg">{pct(e.weight)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function RiskBars({ a }: { a: PortfolioAnalysis }) {
  const option = useMemo<EChartsOption>(() => {
    const ps = [...a.positions].reverse()
    return {
      animation: false,
      grid: { left: 70, right: 14, top: 22, bottom: 20 },
      tooltip: { ...TOOLTIP, valueFormatter: (v: number) => `${v.toFixed(1)}%` },
      legend: {
        top: 0,
        left: 4,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: '#a3acb7', fontSize: 10.5 },
      },
      xAxis: { type: 'value', ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: '{value}%' } },
      yAxis: {
        type: 'category',
        data: ps.map((p) => p.symbol),
        ...AXIS,
        splitLine: { show: false },
      },
      series: [
        {
          name: 'Weight',
          type: 'bar',
          barGap: '10%',
          itemStyle: { color: '#49515b' },
          data: ps.map((p) => p.weight * 100),
        },
        {
          name: 'Risk contribution',
          type: 'bar',
          itemStyle: { color: '#ffb020' },
          data: ps.map((p) => p.risk_share * 100),
        },
      ],
    }
  }, [a])
  return <EChart option={option} />
}

function Heatmap({ a }: { a: PortfolioAnalysis }) {
  const option = useMemo<EChartsOption>(() => {
    const { symbols, matrix } = a.correlation
    return {
      animation: false,
      grid: { left: 70, right: 10, top: 6, bottom: 58 },
      tooltip: {
        backgroundColor: '#14171b',
        borderColor: '#2b3138',
        textStyle: { color: '#e4e7eb', fontSize: 11 },
        formatter: (p: { value: [number, number, number] }) =>
          `${symbols[p.value[0]]} / ${symbols[p.value[1]]}: ${p.value[2].toFixed(2)}`,
      },
      xAxis: {
        type: 'category',
        data: symbols,
        ...AXIS,
        axisLabel: { ...AXIS.axisLabel, rotate: 45 },
        splitLine: { show: false },
      },
      yAxis: { type: 'category', data: symbols, ...AXIS, splitLine: { show: false } },
      visualMap: {
        min: -1,
        max: 1,
        show: false,
        inRange: { color: ['#2563eb', '#14171b', '#ffb020'] },
      },
      series: [
        {
          type: 'heatmap',
          data: matrix.flatMap((row, i) => row.map((v, j) => [i, j, v])),
          label: {
            show: symbols.length <= 12,
            color: '#e4e7eb',
            fontSize: 9,
            formatter: (p: { value: number[] }) => p.value[2].toFixed(1),
          },
        },
      ],
    }
  }, [a])
  return <EChart option={option} />
}

function Stress({ a }: { a: PortfolioAnalysis }) {
  return (
    <div className="px-3 py-2">
      <SectionTitle>Historical episodes, replayed on today's weights</SectionTitle>
      <table className="dt num">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Window</th>
            <th>Portfolio</th>
            <th>P&L ({a.base})</th>
            <th title={`Benchmark total return converted into ${a.base}`}>
              {a.benchmark} ({a.base})
            </th>
            <th className="!text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {a.stress.map((s) => (
            <tr key={s.name}>
              <td className="font-sans text-fg">{s.name}</td>
              <td className="text-fg-3">
                {fmtDate(s.start)} → {fmtDate(s.end)}
              </td>
              <td className={toneClass[tone(s.portfolio_return)]}>
                {fmtPct(s.portfolio_return, 1)}
              </td>
              <td className={toneClass[tone(s.pnl)]}>{fmtCompact(s.pnl, 1)}</td>
              <td className={toneClass[tone(s.benchmark_return)]}>
                {fmtPct(s.benchmark_return, 1)}
              </td>
              <td className="!text-left font-sans text-[10.5px] text-fg-3">
                {s.proxied.length
                  ? `beta proxy for ${s.proxied.join(', ')} (not trading then)`
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <SectionTitle>Hypothetical shocks</SectionTitle>
      <table className="dt num">
        <thead>
          <tr>
            <th>Shock</th>
            <th>Portfolio</th>
            <th>P&L ({a.base})</th>
          </tr>
        </thead>
        <tbody>
          {a.shocks.map((s) => (
            <tr key={s.name}>
              <td className="font-sans text-fg">{s.name}</td>
              <td className={toneClass[tone(s.return)]}>{fmtPct(s.return, 1)}</td>
              <td className={toneClass[tone(s.pnl)]}>{fmtCompact(s.pnl, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10.5px] leading-relaxed text-fg-4">
        Episodes use each holding's actual total return in {a.base} over the window. A stronger base
        currency hurts foreign holdings when translated back; the currency shocks isolate that
        effect.
      </p>
    </div>
  )
}

function Optimise({ a }: { a: PortfolioAnalysis }) {
  const symbols = a.positions.map((p) => p.symbol)
  return (
    <div className="px-3 py-2">
      <SectionTitle>Alternatives from the same covariance</SectionTitle>
      <table className="dt num">
        <thead>
          <tr>
            <th>Portfolio</th>
            <th>Volatility</th>
            <th title="Historical mean return over the look-back — a poor forecast">
              Exp. return*
            </th>
            <th>Sharpe*</th>
            <th>Effective N</th>
            <th>Max drawdown</th>
          </tr>
        </thead>
        <tbody>
          {a.optimised.map((o) => (
            <tr key={o.name}>
              <td className={clsx('font-sans', o.name === 'Current' ? 'text-amber' : 'text-fg')}>
                {o.name}
              </td>
              <td className="text-fg">{pct(o.volatility)}</td>
              <td className="text-fg-2">{pct(o.expected_return)}</td>
              <td className="text-fg-2">{fmtFixed(o.sharpe, 2)}</td>
              <td className="text-fg-2">{fmtFixed(o.effective_n, 1)}</td>
              <td className={toneClass[tone(o.max_drawdown)]}>{fmtPct(o.max_drawdown, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SectionTitle>Weights</SectionTitle>
      <table className="dt num">
        <thead>
          <tr>
            <th>Holding</th>
            {a.optimised.map((o) => (
              <th key={o.name}>{o.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((s) => (
            <tr key={s}>
              <td className="text-fg-2">{s}</td>
              {a.optimised.map((o) => {
                const w = o.weights[s] ?? 0
                const cur = a.optimised[0].weights[s] ?? 0
                return (
                  <td
                    key={o.name}
                    className={
                      o.name === 'Current'
                        ? 'text-fg'
                        : w > cur + 0.02
                          ? 'text-up'
                          : w < cur - 0.02
                            ? 'text-down/90'
                            : 'text-fg-2'
                    }
                  >
                    {isNum(w) && w > 0.0005 ? pct(w) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10.5px] leading-relaxed text-fg-4">
        *In-sample: fitted to the same {a.days} days they are evaluated on, so they flatter the
        optimised portfolios. Minimum variance concentrates in low-volatility, low-correlation
        holdings; risk parity gives every holding the same volatility contribution. Long only, fully
        invested, no transaction costs.
      </p>
    </div>
  )
}
