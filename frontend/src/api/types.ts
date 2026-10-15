// Mirrors backend/src/tessera models. Keep in sync when a response model changes.

export type Freshness = 'delayed' | 'end_of_day' | 'reference' | 'periodic' | 'filing'

export interface Provenance {
  source: string
  source_url: string | null
  freshness: Freshness
  as_of: string | null
  retrieved_at: string
  stale: boolean
  notes: string[]
}

export interface Envelope<T> {
  data: T
  meta: Provenance
}

export interface SecurityHit {
  symbol: string
  name: string
  exchange: string | null
  type: string | null
  sector: string | null
}

export interface Profile {
  symbol: string
  name: string
  quote_type: string | null
  exchange: string | null
  currency: string | null
  financial_currency: string | null
  country: string | null
  sector: string | null
  industry: string | null
  website: string | null
  employees: number | null
  summary: string | null
  officers: { name: string; title: string | null }[]
  timezone: string | null
  market_time: string | null
  market_state: string | null
  price: number | null
  previous_close: number | null
  change: number | null
  change_pct: number | null
  open: number | null
  day_low: number | null
  day_high: number | null
  low_52w: number | null
  high_52w: number | null
  volume: number | null
  avg_volume_3m: number | null
  market_cap: number | null
  enterprise_value: number | null
  shares_outstanding: number | null
  float_shares: number | null
  trailing_pe: number | null
  forward_pe: number | null
  price_to_book: number | null
  ev_to_ebitda: number | null
  ev_to_revenue: number | null
  eps_ttm: number | null
  eps_forward: number | null
  dividend_yield: number | null
  payout_ratio: number | null
  beta: number | null
  revenue_ttm: number | null
  ebitda: number | null
  gross_margin: number | null
  operating_margin: number | null
  profit_margin: number | null
  return_on_equity: number | null
  return_on_assets: number | null
  debt_to_equity: number | null
  current_ratio: number | null
  total_cash: number | null
  total_debt: number | null
  free_cash_flow: number | null
  target_mean_price: number | null
  analyst_count: number | null
  recommendation: string | null
}

export type Span = 'intraday1d' | 'intraday5d' | 'daily' | 'weekly'

export interface Bar {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  adj_close: number | null
  volume: number
}

export interface History {
  symbol: string
  span: Span
  interval: string
  currency: string | null
  timezone: string | null
  bars: Bar[]
  events: { time: string; kind: 'dividend' | 'split'; value: number }[]
}

export type StatementKind = 'income' | 'balance' | 'cashflow'
export type PeriodKind = 'annual' | 'quarterly'

export interface StatementRow {
  key: string
  label: string
  emphasis: boolean
  indent: number
  unit: 'currency' | 'per_share' | 'shares'
  values: (number | null)[]
}

export interface Statements {
  symbol: string
  statement: StatementKind
  period: PeriodKind
  currency: string | null
  periods: string[]
  rows: StatementRow[]
}

export interface Headline {
  title: string
  link: string
  published_at: string | null
  summary: string | null
}

export interface Filing {
  form: string
  filed: string
  report_date: string | null
  description: string | null
  url: string
  major: boolean
}

export interface Filings {
  symbol: string
  cik: number
  company: string
  filings: Filing[]
}

export interface Quote {
  symbol: string
  last: number
  previous_close: number | null
  change: number | null
  change_pct: number | null
  change_1m_pct: number | null
  change_ytd_pct: number | null
  high_52w: number | null
  low_52w: number | null
  as_of: string
  spark: number[]
}

export interface Monitor {
  id: string
  groups: {
    name: string
    rows: { symbol: string; name: string; tag: string; quote: Quote | null }[]
  }[]
}

export interface CurveSnapshot {
  label: string
  date: string
  yields: (number | null)[]
}

export interface YieldCurve {
  region: 'US' | 'EA'
  name: string
  basis: string
  tenors: string[]
  tenor_years: number[]
  snapshots: CurveSnapshot[]
  history: { dates: string[]; series: Record<string, (number | null)[]> }
}

export interface SovereignYields {
  benchmark: string
  months: string[]
  series: {
    country: string
    name: string
    yields: (number | null)[]
    spread_bp: (number | null)[]
  }[]
}

export interface FxMatrix {
  currencies: string[]
  date: string
  previous_date: string
  rates: number[][]
  change_pct: number[][]
}

export interface FxHistory {
  base: string
  quote: string
  points: { date: string; rate: number }[]
}

export interface Observation {
  date: string
  value: number
}

export interface MacroSeries {
  id: string
  title: string
  region: string
  source: string
  source_key: string
  frequency: string
  units: string
  transform: string
  higher_is_better: boolean | null
  observations: Observation[]
}

export interface MacroSummary {
  id: string
  title: string
  region: string
  source: string
  frequency: string
  units: string
  higher_is_better: boolean | null
  latest: Observation | null
  previous: Observation | null
  spark: number[]
}

// ── Valuation & research ──────────────────────────────────────────────────────

export interface DcfAssumptions {
  years: number
  revenue_growth_start: number
  terminal_growth: number
  ebit_margin_start: number
  ebit_margin_target: number
  tax_rate: number
  da_pct_revenue: number
  capex_pct_revenue: number
  nwc_pct_delta_revenue: number
  risk_free: number
  equity_risk_premium: number
  beta: number
  cost_of_debt: number
  mid_year: boolean
}

export interface CapitalStructure {
  base_revenue: number
  market_cap: number
  total_debt: number
  cash: number
  minority_interest: number
  shares: number
}

export interface HistoryYear {
  period: string
  revenue: number | null
  growth: number | null
  ebit: number | null
  margin: number | null
  tax_rate: number | null
  da: number | null
  capex: number | null
  delta_nwc: number | null
  fcff: number | null
}

export interface DcfInputs {
  symbol: string
  name: string
  currency: string
  financial_currency: string
  fx_rate: number
  price: number
  base_period: string
  capital: CapitalStructure
  history: HistoryYear[]
  defaults: DcfAssumptions
  sources: Partial<Record<keyof DcfAssumptions, string>>
}

export interface ProjectionYear {
  year: number
  revenue: number
  growth: number
  ebit: number
  margin: number
  taxes: number
  nopat: number
  da: number
  capex: number
  delta_nwc: number
  fcff: number
  discount_factor: number
  present_value: number
}

export interface DcfResult {
  symbol: string
  currency: string
  financial_currency: string
  fx_rate: number
  price: number
  valuation: {
    wacc: {
      cost_of_equity: number
      cost_of_debt_after_tax: number
      weight_equity: number
      weight_debt: number
      wacc: number
    }
    projection: ProjectionYear[]
    terminal_fcff: number
    terminal_value: number
    pv_terminal_value: number
    sum_pv_fcff: number
    enterprise_value: number
    equity_value: number
    per_share: number
    terminal_share_of_ev: number
    implied_exit_ev_ebitda: number | null
  }
  per_share_quote: number
  upside: number | null
  sensitivity: { waccs: number[]; growths: number[]; per_share: (number | null)[][] }
}

export const COMP_METRICS = [
  'market_cap_usd',
  'trailing_pe',
  'forward_pe',
  'ev_to_ebitda',
  'ev_to_revenue',
  'price_to_book',
  'dividend_yield',
  'gross_margin',
  'operating_margin',
  'profit_margin',
  'return_on_equity',
  'revenue_growth',
  'beta',
] as const
export type CompMetric = (typeof COMP_METRICS)[number]

export type CompRow = {
  symbol: string
  name: string
  is_target: boolean
  country: string | null
  currency: string | null
  price: number | null
  error: string | null
} & Record<CompMetric, number | null>

export interface Comps {
  symbol: string
  industry: string | null
  peers_source: 'industry' | 'user'
  rows: CompRow[]
  median: Record<CompMetric, number | null>
}

export interface Estimate {
  period: string
  avg: number | null
  low: number | null
  high: number | null
  analysts: number | null
  year_ago: number | null
  growth: number | null
}

export interface Earnings {
  symbol: string
  currency: string | null
  next_date: string | null
  history: {
    date: string
    eps_estimate: number | null
    eps_actual: number | null
    surprise_pct: number | null
  }[]
  revenue_estimates: Estimate[]
  eps_estimates: Estimate[]
  eps_revisions: {
    period: string
    current: number | null
    days_7: number | null
    days_30: number | null
    days_60: number | null
    days_90: number | null
  }[]
}

export interface Dividends {
  symbol: string
  currency: string | null
  payments: { date: string; amount: number }[]
  annual: { year: number; total: number; payments: number; growth: number | null }[]
  splits: { date: string; ratio: number }[]
  next_ex_date: string | null
  next_pay_date: string | null
  trailing_12m: number | null
}

export type MoverKind = 'gainers' | 'losers' | 'actives'

export interface Mover {
  symbol: string
  name: string
  exchange: string | null
  currency: string | null
  price: number | null
  change_pct: number | null
  volume: number | null
  avg_volume_3m: number | null
  market_cap: number | null
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface OptionLeg {
  contract: string
  bid: number | null
  ask: number | null
  last: number | null
  volume: number | null
  open_interest: number | null
  last_trade: string | null
  in_the_money: boolean
  price: number | null
  price_source: 'mid' | 'last' | null
  iv: number | null
  yahoo_iv: number | null
  delta: number | null
  gamma: number | null
  theta_per_day: number | null
  vega_per_point: number | null
}

export interface OptionChainView {
  symbol: string
  currency: string | null
  spot: number
  expiries: string[]
  expiry: string
  days: number
  t: number
  rate: number
  dividend_yield: number
  forward: number
  forward_method: string
  atm_strike: number | null
  rows: { strike: number; call: OptionLeg | null; put: OptionLeg | null }[]
  totals: {
    call_volume: number
    put_volume: number
    call_open_interest: number
    put_open_interest: number
    put_call_volume: number | null
    put_call_open_interest: number | null
  }
}

export interface SmileSlice {
  expiry: string
  days: number
  t: number
  forward: number
  atm_vol: number
  points: { strike: number; log_moneyness: number; iv: number; kind: string; source: string }[]
  fit_strikes: number[]
  fit_iv: number[]
  rmse: number | null
  butterfly_arbitrage: boolean
  skew_90_110: number | null
  dropped: Record<string, number>
}

export interface VolSurfaceView {
  symbol: string
  spot: number
  price_basis: string
  rate: number
  slices: SmileSlice[]
  realized_vol_30d: number | null
  realized_vol_90d: number | null
}

// ── Fixed income ──────────────────────────────────────────────────────────────

export interface CurveAnalytics {
  years: number[]
  par: number[]
  zero: number[]
  forward_1y: (number | null)[]
  method: string
}

export type DayCount = 'ACT/ACT' | '30/360'

export interface BondRequest {
  coupon: number
  maturity: string
  frequency: 1 | 2 | 4 | 12
  day_count: DayCount
  quote: 'price' | 'yield'
  value: number
  curve: 'US' | 'EA'
}

export interface BondAnalysis {
  settlement: string
  previous_coupon: string
  next_coupon: string
  days_accrued: number
  accrued: number
  clean: number
  dirty: number
  ytm: number
  current_yield: number | null
  risk: { macaulay: number; modified: number; convexity: number; dv01: number }
  cash_flows: {
    date: string
    coupon: number
    principal: number
    t: number
    present_value: number
  }[]
  shocks: {
    bp: number
    clean: number
    change: number
    duration_estimate: number
    duration_convexity_estimate: number
  }[]
  price_yield: [number, number][]
  benchmark: {
    curve: string
    years: number
    par_yield: number | null
    g_spread_bp: number | null
    z_spread_bp: number | null
  }
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

export interface PortfolioRequest {
  holdings: { symbol: string; shares: number }[]
  base: string
  benchmark: string
  lookback_years: 1 | 2 | 3 | 5
  confidence: number
}

export interface PortfolioPosition {
  symbol: string
  name: string
  sector: string | null
  country: string | null
  currency: string
  shares: number
  price: number
  value: number
  weight: number
  period_return: number
  volatility: number
  beta: number
  risk_share: number
}

export interface PortfolioAnalysis {
  base: string
  benchmark: string
  value: number
  start: string
  end: string
  days: number
  rf: number
  positions: PortfolioPosition[]
  excluded: Record<string, string>
  stats: Record<string, number | null>
  var: {
    method: string
    var_pct: number
    es_pct: number
    var_amount: number
    es_amount: number
    var_10d_amount: number
  }[]
  confidence: number
  exposures: Record<'sector' | 'country' | 'currency', { name: string; weight: number }[]>
  correlation: { symbols: string[]; matrix: number[][] }
  shrinkage: number
  diversification: { effective_n: number; diversification_ratio: number }
  stress: {
    name: string
    start: string
    end: string
    portfolio_return: number
    pnl: number
    benchmark_return: number | null
    proxied: string[]
  }[]
  shocks: { name: string; return: number; pnl: number }[]
  performance: { dates: string[]; portfolio: number[]; benchmark: number[] }
  optimised: {
    name: string
    weights: Record<string, number>
    volatility: number
    expected_return: number
    sharpe: number
    effective_n: number
    max_drawdown: number
  }[]
}

// ── Screener ──────────────────────────────────────────────────────────────────

export interface ScreenRow {
  symbol: string
  name: string
  exchange: string | null
  currency: string | null
  price: number | null
  change_pct: number | null
  market_cap: number | null
  trailing_pe: number | null
  forward_pe: number | null
  price_to_book: number | null
  dividend_yield: number | null
  perf_52w: number | null
  volume: number | null
}

export interface ScreenResult {
  query: string
  total: number
  sort: string
  rows: ScreenRow[]
  warnings: string[]
}

export interface ScreenField {
  name: string
  label: string
  kind: 'category' | 'money' | 'percent' | 'number'
  group: string
}

// ── ASK ───────────────────────────────────────────────────────────────────────

export interface AskToolCall {
  tool: string
  input: Record<string, unknown>
  ok: boolean
  source: string | null
  as_of: string | null
  error: string | null
}

export interface AskAnswer {
  question: string
  answer: string
  model: string
  steps: number
  stop_reason: string
  tool_calls: AskToolCall[]
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
}
