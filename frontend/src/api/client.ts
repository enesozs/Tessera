import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import type {
  Comps,
  DcfAssumptions,
  DcfInputs,
  DcfResult,
  Dividends,
  Earnings,
  Envelope,
  Filings,
  FxHistory,
  FxMatrix,
  Headline,
  History,
  MacroSeries,
  MacroSummary,
  Monitor,
  Mover,
  MoverKind,
  PeriodKind,
  Profile,
  Quote,
  SecurityHit,
  SovereignYields,
  Span,
  StatementKind,
  Statements,
  YieldCurve,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly kind: string
  constructor(status: number, message: string, kind: string) {
    super(message)
    this.status = status
    this.kind = kind
  }
}

async function get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') query.set(k, v)
  const qs = query.toString()
  return request<T>(`/api${path}${qs ? `?${qs}` : ''}`)
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new ApiError(0, 'Cannot reach the Tessera API. Is the backend running?', 'Network')
  }
  if (!response.ok) {
    let detail = response.statusText
    let kind = 'HTTP'
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) detail = 'Invalid request'
      kind = body.kind ?? kind
    } catch {
      /* non-JSON error page */
    }
    throw new ApiError(response.status, detail, kind)
  }
  return response.json() as Promise<T>
}

const MIN = 60_000

// Server caches mirror provider freshness; client staleTime only avoids re-asking too often.
export const useSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: () => get<Envelope<SecurityHit[]>>('/search', { q }),
    enabled: q.length > 0,
    staleTime: 10 * MIN,
    placeholderData: keepPreviousData,
  })

export const useProfile = (symbol: string | undefined) =>
  useQuery({
    queryKey: ['profile', symbol],
    queryFn: () => get<Envelope<Profile>>('/securities/profile', { symbol }),
    enabled: !!symbol,
    staleTime: MIN,
    refetchInterval: 2 * MIN,
  })

export const useHistory = (symbol: string | undefined, span: Span) =>
  useQuery({
    queryKey: ['history', symbol, span],
    queryFn: () => get<Envelope<History>>('/securities/history', { symbol, span }),
    enabled: !!symbol,
    staleTime: span.startsWith('intraday') ? MIN : 10 * MIN,
    refetchInterval: span.startsWith('intraday') ? 2 * MIN : false,
    placeholderData: (prev) => (prev?.data.symbol === symbol ? prev : undefined),
  })

/** Several histories at once (GP compare mode); results in the order of `symbols`. */
export const useHistories = (symbols: string[], span: Span) =>
  useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ['history', symbol, span],
      queryFn: () => get<Envelope<History>>('/securities/history', { symbol, span }),
      staleTime: span.startsWith('intraday') ? MIN : 10 * MIN,
    })),
  })

export const useFinancials = (
  symbol: string | undefined,
  statement: StatementKind,
  period: PeriodKind,
) =>
  useQuery({
    queryKey: ['financials', symbol, statement, period],
    queryFn: () =>
      get<Envelope<Statements>>('/securities/financials', { symbol, statement, period }),
    enabled: !!symbol,
    staleTime: 60 * MIN,
  })

export const useFilings = (symbol: string | undefined) =>
  useQuery({
    queryKey: ['filings', symbol],
    queryFn: () => get<Envelope<Filings>>('/securities/filings', { symbol }),
    enabled: !!symbol,
    staleTime: 30 * MIN,
    retry: false,
  })

export const useNews = (symbol: string | undefined) =>
  useQuery({
    queryKey: ['news', symbol ?? null],
    queryFn: () => get<Envelope<Headline[]>>('/news', { symbol }),
    staleTime: 3 * MIN,
    refetchInterval: 5 * MIN,
  })

export const useQuotes = (symbols: string[]) =>
  useQuery({
    queryKey: ['quotes', symbols],
    queryFn: () => get<Envelope<Quote[]>>('/quotes', { symbols: symbols.join(',') }),
    enabled: symbols.length > 0,
    staleTime: MIN,
    refetchInterval: 2 * MIN,
    placeholderData: keepPreviousData,
  })

export const useMonitor = (id: 'WEI' | 'CMDTY') =>
  useQuery({
    queryKey: ['monitor', id],
    queryFn: () => get<Envelope<Monitor>>(`/monitors/${id}`),
    staleTime: MIN,
    refetchInterval: 2 * MIN,
  })

export const useCurve = (region: 'US' | 'EA', issuers: 'AAA' | 'ALL') =>
  useQuery({
    queryKey: ['curve', region, issuers],
    queryFn: () => get<Envelope<YieldCurve>>('/rates/curve', { region, issuers }),
    staleTime: 30 * MIN,
  })

export const useSovereign = (countries: string[]) =>
  useQuery({
    queryKey: ['sovereign', countries],
    queryFn: () =>
      get<Envelope<SovereignYields>>('/rates/sovereign', { countries: countries.join(',') }),
    staleTime: 60 * MIN,
    placeholderData: keepPreviousData,
  })

export const useFxMatrix = (currencies: string[]) =>
  useQuery({
    queryKey: ['fx-matrix', currencies],
    queryFn: () => get<Envelope<FxMatrix>>('/fx/matrix', { currencies: currencies.join(',') }),
    staleTime: 30 * MIN,
  })

export const useFxHistory = (base: string, quote: string) =>
  useQuery({
    queryKey: ['fx-history', base, quote],
    queryFn: () => get<Envelope<FxHistory>>('/fx/history', { base, quote }),
    enabled: base !== quote,
    staleTime: 60 * MIN,
    placeholderData: keepPreviousData,
  })

export const useMacroDashboard = () =>
  useQuery({
    queryKey: ['macro-dashboard'],
    queryFn: () => get<Envelope<MacroSummary[]>>('/macro/dashboard'),
    staleTime: 60 * MIN,
  })

export const useMacroSeries = (id: string | undefined) =>
  useQuery({
    queryKey: ['macro-series', id],
    queryFn: () => get<Envelope<MacroSeries>>('/macro/series', { id }),
    enabled: !!id,
    staleTime: 60 * MIN,
  })

export const useHealth = () =>
  useQuery({
    queryKey: ['health'],
    queryFn: () => get<{ status: string }>('/health'),
    refetchInterval: 30_000,
    retry: false,
  })

export const useDcfInputs = (symbol: string | undefined) =>
  useQuery({
    queryKey: ['dcf-inputs', symbol],
    queryFn: () => get<Envelope<DcfInputs>>('/valuation/dcf/inputs', { symbol }),
    enabled: !!symbol,
    staleTime: 30 * MIN,
  })

export const useDcfValue = (symbol: string | undefined, assumptions: DcfAssumptions | undefined) =>
  useQuery({
    queryKey: ['dcf', symbol, assumptions],
    queryFn: () => post<Envelope<DcfResult>>('/valuation/dcf', { symbol, assumptions }),
    enabled: !!symbol && !!assumptions,
    staleTime: 30 * MIN,
    placeholderData: (prev) => (prev?.data.symbol === symbol ? prev : undefined),
  })

export const useComps = (symbol: string | undefined, peers: string) =>
  useQuery({
    queryKey: ['comps', symbol, peers],
    queryFn: () => get<Envelope<Comps>>('/valuation/comps', { symbol, peers }),
    enabled: !!symbol,
    staleTime: 10 * MIN,
  })

export const useEarnings = (symbol: string | undefined) =>
  useQuery({
    queryKey: ['earnings', symbol],
    queryFn: () => get<Envelope<Earnings>>('/securities/earnings', { symbol }),
    enabled: !!symbol,
    staleTime: 60 * MIN,
  })

export const useDividends = (symbol: string | undefined) =>
  useQuery({
    queryKey: ['dividends', symbol],
    queryFn: () => get<Envelope<Dividends>>('/securities/dividends', { symbol }),
    enabled: !!symbol,
    staleTime: 60 * MIN,
  })

export const useMovers = (kind: MoverKind) =>
  useQuery({
    queryKey: ['movers', kind],
    queryFn: () => get<Envelope<Mover[]>>('/movers', { kind }),
    staleTime: MIN,
    refetchInterval: 2 * MIN,
  })

export const fetchSearch = (q: string) => get<Envelope<SecurityHit[]>>('/search', { q })
