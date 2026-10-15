// Command-line grammar.
//
//   <TICKER>                 load a security into the target pane (keeps its function)
//   <TICKER> <FN> [ARGS…]    run a security function, e.g. "RACE GP", "AAPL FA BS Q"
//   <FN> [ARGS…]             run a function, e.g. "YC EA", "FX EURUSD", "ECO US.CPI"
//
// A token in second position that is a function code wins, so tickers that collide with
// codes still work: "HP DES" describes Helmerich & Payne, while "HP" alone opens HP.

import { BY_CODE, isFunctionCode, type FunctionCode } from '@/functions/registry'

export type Params = Record<string, string>

export type Command =
  | { kind: 'empty' }
  | { kind: 'security'; security: string }
  | { kind: 'function'; fn: FunctionCode; security?: string; params: Params; action?: Action }
  | { kind: 'error'; message: string }

export type Action = { type: 'watchlist-add' | 'watchlist-remove'; symbol: string }

const TICKER = /^[A-Z0-9][A-Z0-9.=^-]{0,23}$|^\^[A-Z0-9.-]{1,23}$/
const CURRENCY = /^[A-Z]{3}$/

export function isTicker(token: string): boolean {
  return TICKER.test(token)
}

export function tokenize(input: string): string[] {
  return input.trim().toUpperCase().split(/\s+/).filter(Boolean)
}

export function parseCommand(input: string): Command {
  const tokens = tokenize(input)
  if (tokens.length === 0) return { kind: 'empty' }
  const [first, second, ...rest] = tokens

  if (second !== undefined && isFunctionCode(second)) {
    const spec = BY_CODE[second]
    if (!spec.security) return { kind: 'error', message: `${second} does not take a security` }
    if (!isTicker(first)) return { kind: 'error', message: `"${first}" is not a valid ticker` }
    return withArgs(second, rest, first)
  }
  if (isFunctionCode(first)) return withArgs(first, tokens.slice(1))
  if (tokens.length === 1) {
    return isTicker(first)
      ? { kind: 'security', security: first }
      : { kind: 'error', message: `"${first}" is not a valid ticker` }
  }
  return { kind: 'error', message: `Unknown function "${second}". Type HELP for the list.` }
}

function withArgs(fn: FunctionCode, args: string[], security?: string): Command {
  const parsed = parseArgs(fn, args)
  if ('error' in parsed) return { kind: 'error', message: parsed.error }
  return { kind: 'function', fn, security, params: parsed.params, action: parsed.action }
}

type ArgResult = { params: Params; action?: Action } | { error: string }

const GP_RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'MAX']
const STATEMENTS: Record<string, string> = {
  IS: 'income',
  INC: 'income',
  BS: 'balance',
  CF: 'cashflow',
  RATIOS: 'ratios',
  R: 'ratios',
}

export function parseArgs(fn: FunctionCode, args: string[]): ArgResult {
  const params: Params = {}
  const unknown = (a: string) => ({ error: `${fn}: unexpected argument "${a}"` })

  switch (fn) {
    case 'GP': {
      const vs = args.indexOf('VS')
      const own = vs >= 0 ? args.slice(0, vs) : args
      for (const a of own) {
        if (GP_RANGES.includes(a)) params.range = a
        else return unknown(a)
      }
      if (vs >= 0) {
        const others = args.slice(vs + 1)
        const bad = others.find((a) => !isTicker(a))
        if (bad) return { error: `GP: "${bad}" is not a valid ticker` }
        if (!others.length) return { error: 'GP: add tickers after VS, e.g. RACE GP VS STLA' }
        params.cmp = others.slice(0, 5).join(',')
      }
      return { params }
    }
    case 'COMP': {
      const bad = args.find((a) => !isTicker(a))
      if (bad) return { error: `COMP: "${bad}" is not a valid ticker` }
      params.peers = args.slice(0, 12).join(',')
      return { params }
    }
    case 'MOST': {
      if (args.length > 1) return unknown(args[1])
      const kinds: Record<string, string> = {
        GAINERS: 'gainers',
        LOSERS: 'losers',
        ACTIVES: 'actives',
        ACTIVE: 'actives',
      }
      if (args.length && !(args[0] in kinds)) return unknown(args[0])
      if (args.length) params.kind = kinds[args[0]]
      return { params }
    }
    case 'FA':
      for (const a of args) {
        if (a in STATEMENTS) params.statement = STATEMENTS[a]
        else if (a === 'Q' || a === 'QUARTERLY') params.period = 'quarterly'
        else if (a === 'A' || a === 'ANNUAL') params.period = 'annual'
        else return unknown(a)
      }
      return { params }
    case 'YC':
      for (const a of args) {
        if (a === 'US' || a === 'EA' || a === 'EU') params.region = a === 'EU' ? 'EA' : a
        else if (a === 'ALL' || a === 'AAA') params.issuers = a
        else return unknown(a)
      }
      return { params }
    case 'SOV': {
      const bad = args.find((a) => !/^[A-Z]{2}$/.test(a))
      if (bad) return unknown(bad)
      if (args.length) params.countries = args.filter((a) => a !== 'DE').join(',')
      return { params }
    }
    case 'FX': {
      if (args.length === 1 && /^[A-Z]{6}$/.test(args[0])) {
        params.base = args[0].slice(0, 3)
        params.quote = args[0].slice(3)
        return { params }
      }
      const bad = args.find((a) => !CURRENCY.test(a))
      if (bad) return unknown(bad)
      if (args.length === 1) return { error: 'FX: give a pair (FX EURUSD) or 2+ currencies' }
      if (args.length) params.currencies = args.join(',')
      return { params }
    }
    case 'ECO':
      if (args.length > 1) return unknown(args[1])
      if (args.length) params.series = args[0]
      return { params }
    case 'WL': {
      if (args.length === 0) return { params }
      const [verb, symbol] = args
      const type =
        verb === 'ADD'
          ? 'watchlist-add'
          : verb === 'DEL' || verb === 'RM'
            ? 'watchlist-remove'
            : null
      if (!type || !symbol || !isTicker(symbol) || args.length > 2)
        return { error: 'WL: use WL ADD <TICKER> or WL DEL <TICKER>' }
      return { params, action: { type, symbol } }
    }
    default:
      return args.length ? unknown(args[0]) : { params }
  }
}
