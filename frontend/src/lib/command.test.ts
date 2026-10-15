import { describe, expect, it } from 'vitest'
import { parseCommand } from './command'

describe('parseCommand', () => {
  it('loads a bare ticker into the pane', () => {
    expect(parseCommand(' race ')).toEqual({ kind: 'security', security: 'RACE' })
    expect(parseCommand('^gspc')).toEqual({ kind: 'security', security: '^GSPC' })
  })

  it('runs ticker + function with arguments', () => {
    expect(parseCommand('aapl fa bs q')).toMatchObject({
      kind: 'function',
      fn: 'FA',
      security: 'AAPL',
      params: { statement: 'balance', period: 'quarterly' },
    })
  })

  it('treats a function code in second position as the function', () => {
    expect(parseCommand('HP DES')).toMatchObject({ kind: 'function', fn: 'DES', security: 'HP' })
    expect(parseCommand('HP')).toMatchObject({ kind: 'function', fn: 'HP', security: undefined })
  })

  it('parses market functions', () => {
    expect(parseCommand('yc eu all')).toMatchObject({
      fn: 'YC',
      params: { region: 'EA', issuers: 'ALL' },
    })
    expect(parseCommand('fx eurusd')).toMatchObject({
      fn: 'FX',
      params: { base: 'EUR', quote: 'USD' },
    })
    expect(parseCommand('fx usd eur try')).toMatchObject({ params: { currencies: 'USD,EUR,TRY' } })
    expect(parseCommand('sov it gr de')).toMatchObject({ params: { countries: 'IT,GR' } })
    expect(parseCommand('eco us.cpi')).toMatchObject({ params: { series: 'US.CPI' } })
  })

  it('parses compare, peer and movers arguments', () => {
    expect(parseCommand('race gp 2y vs stla ^gspc')).toMatchObject({
      fn: 'GP',
      security: 'RACE',
      params: { range: '2Y', cmp: 'STLA,^GSPC' },
    })
    expect(parseCommand('RACE GP VS')).toMatchObject({ kind: 'error' })
    expect(parseCommand('race comp p911.de stla')).toMatchObject({
      fn: 'COMP',
      params: { peers: 'P911.DE,STLA' },
    })
    expect(parseCommand('race comp')).toMatchObject({ params: { peers: '' } })
    expect(parseCommand('most losers')).toMatchObject({ fn: 'MOST', params: { kind: 'losers' } })
    expect(parseCommand('RACE DCF')).toMatchObject({ fn: 'DCF', security: 'RACE' })
  })

  it('turns watchlist verbs into actions', () => {
    expect(parseCommand('wl add nvda')).toMatchObject({
      fn: 'WL',
      action: { type: 'watchlist-add', symbol: 'NVDA' },
    })
  })

  it('reports helpful errors', () => {
    expect(parseCommand('RACE FOO')).toMatchObject({ kind: 'error' })
    expect(parseCommand('RACE YC')).toMatchObject({
      kind: 'error',
      message: 'YC does not take a security',
    })
    expect(parseCommand('GP 7Y')).toMatchObject({ kind: 'error' })
    expect(parseCommand('FX EUR')).toMatchObject({ kind: 'error' })
    expect(parseCommand('')).toEqual({ kind: 'empty' })
  })
})
