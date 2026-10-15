# Tessera

A keyboard-first financial terminal in the browser, inspired by the Bloomberg Terminal's
workflow and built entirely on free public data.

Type `RACE GP` and a pane draws Ferrari's price chart. Type `YC EA` for the euro-area
government curve, `SOV IT GR` for BTP–Bund and Greek spreads, `AAPL FA RATIOS` for Apple's
margins and returns. Panes tile, resize, maximise and link together: pick a security in one
linked pane and the others follow.

Every number carries its source, freshness and as-of time in the pane footer. Nothing is
presented as real time, and nothing is fabricated.

> Independent educational project. Not affiliated with Bloomberg L.P. or any data provider.
> Not investment advice.

## Quick start

```bash
make install        # Python venv + npm packages
cp .env.example .env   # optional: set SEC_USER_AGENT to enable SEC filings (FIL)
make dev            # API on :8010, UI on http://localhost:5180
```

Requires Python 3.12+, Node 20+ and the sibling project `../05-derivatives-pricing-lab`, whose
pricing library (`derivlab`) computes the option analytics; `make install` installs it. The ports differ from the other QuantProjects (8000/5173)
so they can run side by side; override with `make dev API_PORT=… WEB_PORT=…`.

## Functions

| Code | Function | Example |
| --- | --- | --- |
| `DES` | Company profile, quote, valuation and fundamentals | `RACE DES` |
| `GP` | Price chart: candles/line/area, volume, SMA 20/50/200, log, dividend-adjusted; `VS` compares % performance | `RACE GP 5Y VS FTSEMIB.MI ^GSPC` |
| `HP` | Historical prices with return, realised volatility, drawdown | `RACE.MI HP` |
| `FA` | Income statement, balance sheet, cash flow, derived ratios | `AAPL FA BS Q` |
| `NEWS` | Headlines for a security, or top market news | `NVDA NEWS` |
| `FIL` | SEC EDGAR filings with links to originals | `AAPL FIL` |
| `DVD` | Dividend history, annual totals, growth, yield, splits | `AAPL DVD` |
| `ERN` | Next report date, EPS surprises, consensus estimates and revisions | `RACE ERN` |
| `DCF` | FCFF valuation with sourced, editable assumptions and sensitivity grid | `RACE DCF` |
| `COMP` | Multiples, margins and growth vs industry or custom peers | `RACE COMP P911.DE STLA` |
| `MOST` | Top U.S. gainers, losers and most active | `MOST LOSERS` |
| `OMON` | Option chain by strike: quotes, volume, OI, implied vol and Greeks | `SPY OMON` |
| `IVOL` | Volatility smile with SVI fit, ATM term structure vs realised vol, skew | `NVDA IVOL` |
| `PORT` | Portfolio in any currency mix: exposures, risk contributions, VaR/ES, stress replays, optimised alternatives | `PORT RISK` |
| `EQS` | Screen any market on 30+ fundamentals with a query language | `FIND EQUITIES WHERE COUNTRY = IT AND ROE > 15%` |
| `ALRT` | Price alerts (toast + optional desktop notification) | `ALRT ADD AAPL > 350` |
| `WEI` | World equity indices by region | `WEI` |
| `CMDTY` | Energy, metals and agriculture futures | `CMDTY` |
| `WL` | Your watchlist (stored in the browser) | `WL ADD ASML` |
| `FX` | ECB reference cross-rate matrix and pair history | `FX EURUSD` |
| `YC` | US Treasury / euro-area curves vs 1W/1M/1Y ago, key spreads; bootstrapped zero & 1Y forward curves | `YC EA ALL` |
| `BOND` | Bond calculator on real dates: price ↔ yield, accrued, durations, convexity, DV01, G/Z-spread, shocks | `BOND 4.25 2036-08-15 P 95.5` |
| `SOV` | Euro-area 10-year yields and spreads to the Bund | `SOV IT GR` |
| `ECO` | US & euro-area macro dashboard, or any FRED series | `ECO GDPC1` |
| `HELP` | Directory, grammar and keyboard shortcuts | `HELP` |

**Grammar:** `<TICKER>`, `<FUNCTION> [ARGS]`, or `<TICKER> <FUNCTION> [ARGS]`. Enter runs in
the active pane, Shift+Enter in a new one. Typing a company name (`ferrari`) resolves it
through search. Start typing anywhere to reach the command line.

**Every pane** can export its tables as CSV (⤓) or pop out into its own window for a second
monitor (↗). **Share** (top bar) copies a link that recreates the current workspace — layout and
settings only, no data.

**Keyboard:** `Alt 1–6` focus a pane · `Alt M` maximise · `Alt N` duplicate · `Alt W` close ·
`Alt L` cycle link colour · `Alt [ ]` switch workspace · `/` or `Ctrl K` command line.

## Data sources

| Source | Used for | Nature |
| --- | --- | --- |
| Yahoo Finance (via `yfinance`, RSS) | Equities, indices, futures, statements, news | Delayed / end of day; unofficial, personal & educational use |
| U.S. Treasury | Daily par yield curve | Official |
| European Central Bank Data Portal | Euro-area curves, sovereign 10Y, euro-area macro | Official |
| FRED (St. Louis Fed) | US & euro-area macro series | Official |
| Frankfurter (mirror of ECB fixings) | FX reference rates | Official reference rates |
| SEC EDGAR | Company filings | Official; needs a contact User-Agent |

Provider responses are cached on disk (`backend/.cache/`). If a provider is down, the last good
copy is served and the pane footer shows **STALE**.

## Architecture

```
frontend/  React 19 + TypeScript + Vite + Tailwind 4
           TanStack Query (server state) · Zustand (workspace state, persisted)
           Lightweight Charts (time series) · ECharts (tenor curves)
              │  fetch /api/*  (Vite proxy in dev; FastAPI serves dist/ in `make serve`)
              ▼
backend/src/tessera_api/   FastAPI routes — validation and HTTP errors only
backend/src/tessera/       providers/ (yahoo, rates, macro, fx, sec, ecb) · cache · models
```

Every endpoint returns `{data, meta}` where `meta` is the provenance record (source, URL,
freshness, as-of, retrieved-at, stale flag, methodology notes).

## Deployment

```bash
make docker       # one image: built UI + API (needs Docker running; context is ../)
make docker-run   # http://localhost:8010, provider cache kept in the `tessera-data` volume
```

The API compresses responses, sets basic security headers and rate-limits each client
(`TESSERA_RATE_LIMIT` requests per minute, default 300; 0 disables) so a public instance cannot
exhaust the free providers' quotas. Other settings: `SEC_USER_AGENT`, `TESSERA_CACHE_DIR`,
`TESSERA_STATIC_DIR`. CI (`.github/workflows/ci.yml`) lints, type-checks, tests and builds both
halves on every push once the repository is on GitHub.

## Development

```bash
make test     # pytest + vitest (offline)
make lint     # ruff, pyright, tsc, oxlint, prettier
make e2e      # Playwright smoke test against `make dev` (needs Google Chrome)
make serve    # production build served by FastAPI on :8010
```

See [AGENTS.md](AGENTS.md) for conventions and the roadmap.
