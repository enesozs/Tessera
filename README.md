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

Requires Python 3.12+ and Node 20+. The ports differ from the other QuantProjects (8000/5173)
so they can run side by side; override with `make dev API_PORT=… WEB_PORT=…`.

## Functions

| Code | Function | Example |
| --- | --- | --- |
| `DES` | Company profile, quote, valuation and fundamentals | `RACE DES` |
| `GP` | Price chart: candles/line/area, volume, SMA 20/50/200, log, dividend-adjusted | `^GSPC GP 5Y` |
| `HP` | Historical prices with return, realised volatility, drawdown | `RACE.MI HP` |
| `FA` | Income statement, balance sheet, cash flow, derived ratios | `AAPL FA BS Q` |
| `NEWS` | Headlines for a security, or top market news | `NVDA NEWS` |
| `FIL` | SEC EDGAR filings with links to originals | `AAPL FIL` |
| `WEI` | World equity indices by region | `WEI` |
| `CMDTY` | Energy, metals and agriculture futures | `CMDTY` |
| `WL` | Your watchlist (stored in the browser) | `WL ADD ASML` |
| `FX` | ECB reference cross-rate matrix and pair history | `FX EURUSD` |
| `YC` | US Treasury / euro-area curves vs 1W/1M/1Y ago, key spreads | `YC EA ALL` |
| `SOV` | Euro-area 10-year yields and spreads to the Bund | `SOV IT GR` |
| `ECO` | US & euro-area macro dashboard, or any FRED series | `ECO GDPC1` |
| `HELP` | Directory, grammar and keyboard shortcuts | `HELP` |

**Grammar:** `<TICKER>`, `<FUNCTION> [ARGS]`, or `<TICKER> <FUNCTION> [ARGS]`. Enter runs in
the active pane, Shift+Enter in a new one. Typing a company name (`ferrari`) resolves it
through search. Start typing anywhere to reach the command line.

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

## Development

```bash
make test     # pytest + vitest (offline)
make lint     # ruff, pyright, tsc, oxlint, prettier
make e2e      # Playwright smoke test against `make dev` (needs Google Chrome)
make serve    # production build served by FastAPI on :8010
```

See [AGENTS.md](AGENTS.md) for conventions and the roadmap.
