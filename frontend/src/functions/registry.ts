// The function registry: every terminal command, its arguments and its help text.
// Components live in ./index.tsx so this file stays importable by the parser and tests.

export type FunctionCode =
  | 'DES'
  | 'GP'
  | 'HP'
  | 'FA'
  | 'NEWS'
  | 'FIL'
  | 'DCF'
  | 'COMP'
  | 'ERN'
  | 'DVD'
  | 'MOST'
  | 'OMON'
  | 'IVOL'
  | 'BOND'
  | 'PORT'
  | 'EQS'
  | 'ALRT'
  | 'WEI'
  | 'CMDTY'
  | 'WL'
  | 'FX'
  | 'YC'
  | 'SOV'
  | 'ECO'
  | 'HELP'

export type Category =
  | 'Security'
  | 'Valuation'
  | 'Options'
  | 'Portfolio'
  | 'Markets'
  | 'Rates & FX'
  | 'Macro'
  | 'Terminal'

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
    summary:
      'Interactive candlestick / line chart with volume, moving averages and log scale. Add VS tickers to compare % performance.',
    syntax: '<TICKER> GP [RANGE] [VS <TICKER> …]',
    examples: ['RACE GP', '^GSPC GP 5Y', 'RACE GP VS STLA ^GSPC'],
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
    code: 'DVD',
    title: 'Dividends & splits',
    category: 'Security',
    security: true,
    summary:
      'Dividend history, annual totals and growth, trailing yield, upcoming dates and splits.',
    syntax: '<TICKER> DVD',
    examples: ['AAPL DVD', 'ISP.MI DVD'],
  },
  {
    code: 'ERN',
    title: 'Earnings & estimates',
    category: 'Security',
    security: true,
    summary:
      'Next report date, EPS surprises vs consensus, revenue/EPS estimates and their revisions.',
    syntax: '<TICKER> ERN',
    examples: ['RACE ERN', 'NVDA ERN'],
  },
  {
    code: 'DCF',
    title: 'Discounted cash flow',
    category: 'Valuation',
    security: true,
    summary:
      'FCFF valuation from reported financials with sourced, editable assumptions, EV bridge and WACC × growth sensitivity.',
    syntax: '<TICKER> DCF',
    examples: ['RACE DCF', 'MSFT DCF'],
  },
  {
    code: 'COMP',
    title: 'Peer comparison',
    category: 'Valuation',
    security: true,
    summary:
      'Multiples, margins and growth against industry peers (or your own list), with peer medians.',
    syntax: '<TICKER> COMP [<PEER> …]',
    examples: ['RACE COMP', 'RACE COMP P911.DE STLA TM MBG.DE'],
  },
  {
    code: 'OMON',
    title: 'Option monitor',
    category: 'Options',
    security: true,
    summary:
      'Calls and puts by strike for one expiry: quotes, volume, open interest, implied vol and Greeks computed with derivlab.',
    syntax: '<TICKER> OMON [YYYY-MM-DD]',
    examples: ['AAPL OMON', 'SPY OMON'],
  },
  {
    code: 'IVOL',
    title: 'Implied volatility',
    category: 'Options',
    security: true,
    summary:
      'Volatility smile per expiry with an SVI fit, ATM term structure vs realised volatility, skew and arbitrage checks.',
    syntax: '<TICKER> IVOL',
    examples: ['SPY IVOL', 'NVDA IVOL'],
  },
  {
    code: 'PORT',
    title: 'Portfolio risk',
    category: 'Portfolio',
    security: false,
    source: true,
    summary:
      'Holdings in any currency → value, exposures, risk contributions, VaR/ES (3 methods), historical stress replays and optimised alternatives.',
    syntax: 'PORT [OVERVIEW|RISK|STRESS|OPT]',
    examples: ['PORT', 'PORT RISK', 'PORT STRESS'],
  },
  {
    code: 'EQS',
    title: 'Equity screener',
    category: 'Markets',
    security: false,
    source: true,
    summary:
      'Screen any market on 30+ fundamental fields with a query language; runs on Yahoo’s server-side screener.',
    syntax: 'EQS <condition>  |  FIND EQUITIES WHERE <condition>',
    examples: [
      'EQS COUNTRY = IT AND ROE > 15%',
      'FIND EQUITIES WHERE COUNTRY = US AND PE < 12 AND DIVYIELD > 4%',
    ],
  },
  {
    code: 'ALRT',
    title: 'Price alerts',
    category: 'Markets',
    security: false,
    source: true,
    summary: 'Alerts when a price crosses a level; checked every minute while Tessera is open.',
    syntax: 'ALRT [ADD <TICKER> >|< <PRICE> | DEL <TICKER>]',
    examples: ['ALRT', 'ALRT ADD AAPL > 350', 'ALRT ADD RACE.MI < 300'],
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
    code: 'MOST',
    title: 'Market movers',
    category: 'Markets',
    security: false,
    source: true,
    summary: 'Top U.S. gainers, losers and most active stocks today, with relative volume.',
    syntax: 'MOST [GAINERS|LOSERS|ACTIVES]',
    examples: ['MOST', 'MOST LOSERS'],
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
    code: 'BOND',
    title: 'Bond calculator',
    category: 'Rates & FX',
    security: false,
    summary:
      'Price ↔ yield on real dates, accrued interest, durations, convexity, DV01, G- and Z-spread to the curve, shock P&L.',
    syntax: 'BOND [<COUPON%> <YYYY-MM-DD>] [P <PRICE> | Y <YIELD%>]',
    examples: ['BOND', 'BOND 4.25 2036-08-15 P 95.5', 'BOND 5.5 2031-03-15 Y 6.1'],
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
