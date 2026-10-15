// The function registry: every terminal command, its arguments and its help text.
// Components live in ./index.tsx so this file stays importable by the parser and tests.

export type FunctionCode =
  | 'DES'
  | 'GP'
  | 'HP'
  | 'FA'
  | 'NEWS'
  | 'FIL'
  | 'WEI'
  | 'CMDTY'
  | 'WL'
  | 'FX'
  | 'YC'
  | 'SOV'
  | 'ECO'
  | 'HELP'

export type Category = 'Security' | 'Markets' | 'Rates & FX' | 'Macro' | 'Terminal'

export interface FunctionSpec {
  code: FunctionCode
  title: string
  category: Category
  /** Operates on a security (ticker) — receives link-group updates. */
  security: boolean
  /** Broadcasts a security selection to linked panes (monitors, watchlist). */
  source?: boolean
  summary: string
  syntax: string
  examples: string[]
}

export const FUNCTIONS: FunctionSpec[] = [
  {
    code: 'DES',
    title: 'Description',
    category: 'Security',
    security: true,
    summary: 'Company profile, quote, valuation and fundamentals snapshot.',
    syntax: '<TICKER> DES',
    examples: ['RACE DES', 'ASML DES'],
  },
  {
    code: 'GP',
    title: 'Price chart',
    category: 'Security',
    security: true,
    summary: 'Interactive candlestick / line chart with volume, moving averages and log scale.',
    syntax: '<TICKER> GP',
    examples: ['RACE GP', '^GSPC GP', 'BTC-USD GP'],
  },
  {
    code: 'HP',
    title: 'Historical prices',
    category: 'Security',
    security: true,
    summary: 'Daily OHLCV table with returns, range statistics and realised volatility.',
    syntax: '<TICKER> HP',
    examples: ['RACE.MI HP'],
  },
  {
    code: 'FA',
    title: 'Financial analysis',
    category: 'Security',
    security: true,
    summary: 'Income statement, balance sheet, cash flow and derived ratios; annual or quarterly.',
    syntax: '<TICKER> FA [IS|BS|CF|RATIOS] [Q]',
    examples: ['RACE FA', 'AAPL FA BS Q', 'MSFT FA RATIOS'],
  },
  {
    code: 'NEWS',
    title: 'News',
    category: 'Security',
    security: true,
    summary: 'Latest headlines for a security, or top market headlines with no security.',
    syntax: '[<TICKER>] NEWS',
    examples: ['NEWS', 'NVDA NEWS'],
  },
  {
    code: 'FIL',
    title: 'SEC filings',
    category: 'Security',
    security: true,
    summary: 'Recent EDGAR filings (10-K, 10-Q, 8-K, 20-F…) with links to the originals.',
    syntax: '<TICKER> FIL',
    examples: ['AAPL FIL', 'RACE FIL'],
  },
  {
    code: 'WEI',
    title: 'World equity indices',
    category: 'Markets',
    security: false,
    source: true,
    summary:
      'Major indices by region with daily, 1-month and YTD moves. Click to drive linked panes.',
    syntax: 'WEI',
    examples: ['WEI'],
  },
  {
    code: 'CMDTY',
    title: 'Commodities',
    category: 'Markets',
    security: false,
    source: true,
    summary: 'Front-month futures across energy, metals and agriculture.',
    syntax: 'CMDTY',
    examples: ['CMDTY'],
  },
  {
    code: 'WL',
    title: 'Watchlist',
    category: 'Markets',
    security: false,
    source: true,
    summary: 'Your own list of securities, saved in this browser. Add with WL ADD <TICKER>.',
    syntax: 'WL [ADD|DEL <TICKER>]',
    examples: ['WL', 'WL ADD NVDA'],
  },
  {
    code: 'FX',
    title: 'FX cross rates',
    category: 'Rates & FX',
    security: false,
    summary: 'ECB reference cross-rate matrix; pick any pair for its history.',
    syntax: 'FX [<CCY> …] | FX <BASE><QUOTE>',
    examples: ['FX', 'FX EURUSD', 'FX USD EUR TRY JPY'],
  },
  {
    code: 'YC',
    title: 'Yield curve',
    category: 'Rates & FX',
    security: false,
    summary: 'U.S. Treasury or euro-area government curve vs 1W/1M/1Y ago, with key spreads.',
    syntax: 'YC [US|EA] [ALL]',
    examples: ['YC US', 'YC EA', 'YC EA ALL'],
  },
  {
    code: 'SOV',
    title: 'Euro sovereign spreads',
    category: 'Rates & FX',
    security: false,
    summary: '10-year government yields across the euro area and their spread to the Bund.',
    syntax: 'SOV [<COUNTRY> …]',
    examples: ['SOV', 'SOV IT GR'],
  },
  {
    code: 'ECO',
    title: 'Economic data',
    category: 'Macro',
    security: false,
    summary: 'US & euro-area macro dashboard; open any tile, or any FRED series by id.',
    syntax: 'ECO [<SERIES>]',
    examples: ['ECO', 'ECO US.CPI', 'ECO GDPC1'],
  },
  {
    code: 'HELP',
    title: 'Help',
    category: 'Terminal',
    security: false,
    summary: 'Function directory, command grammar and keyboard shortcuts.',
    syntax: 'HELP',
    examples: ['HELP'],
  },
]

export const BY_CODE = Object.fromEntries(FUNCTIONS.map((f) => [f.code, f])) as Record<
  FunctionCode,
  FunctionSpec
>

export function isFunctionCode(token: string): token is FunctionCode {
  return token in BY_CODE
}
