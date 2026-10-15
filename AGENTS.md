# AGENTS.md — Tessera (financial terminal)

Reference for any agent (or human) working on this project. Read it before changing code and
keep it current: when a roadmap item ships or a decision changes, update this file in the same
change.

---

## 1. Goal

A Bloomberg-inspired, keyboard-first market terminal on free public data: a command line,
tiled and linked panes, dense tables and charts, and honest data provenance. It is a learning
project and a portfolio piece, so priorities are, in order:

1. **Honest data.** Never fabricate or imply real-time data. Every payload carries provenance;
   unsupported features are labelled, not faked.
2. **Correct numbers.** Units, currencies, adjustment method and period are explicit. Derived
   figures (ratios, spreads, YoY) are computed in one visible place and tested.
3. **Terminal ergonomics.** Keyboard first, dense, fast; every function works in any pane.
4. **Extensibility.** Adding a function or a provider touches few files (see §4).

The original vision document is `Financial_Terminal_Ultimate_Project_Blueprint.pdf` (kept by the
owner, not in the repo). Treat it as a menu of ideas, not a spec.

---

## 2. Current state (2026-10-15)

**MVP complete; roadmap phases 1–4 (equity depth, options, fixed income, portfolio) complete.**
23 functions: `DES GP HP FA NEWS FIL DVD ERN DCF COMP OMON IVOL PORT WEI CMDTY MOST WL FX YC
SOV BOND ECO HELP`.

- Phase 1 added: `DCF` (pure model in `tessera/dcf.py`, inputs/defaults with stated sources in
  `tessera/valuation.py`; refuses banks/insurers with a reason, HTTP 422), `COMP` (Yahoo industry
  peers filtered by index weight, or a custom list; medians exclude negative multiples), `GP … VS …`
  compare mode (Lightweight Charts percentage scale), `ERN`, `DVD`, `MOST` (`providers/research.py`).
- Phase 2 added: `OMON` (chain by strike, quotes or Greeks view, ATM-centred, leg detail) and
  `IVOL` (smile + SVI fit per expiry, ATM term structure vs realised vol, skew, butterfly flags)
  in `tessera/options.py`. All analytics come from **derivlab** (project 05): parity forward
  (`data.cleaning`), implied vol, analytic Greeks, `fit_svi`. Discounting uses
  `rates.risk_free_rate(t)` (Treasury par curve → continuous). derivlab is an editable install
  from `../05-derivatives-pricing-lab/backend` (see Makefile); restart `make dev` after
  installing it, the reloader does not pick up new packages.
- Phase 3 added: `BOND` (`tessera/bonds.py`: date-based schedules rolled back from maturity,
  ACT/ACT ICMA and 30/360, accrued, street-convention yield, Macaulay/modified duration,
  convexity, DV01, Z-spread — all cross-checked against QuantLib in `tests/test_bonds.py`;
  ACT/365F and ACT/360 deliberately unsupported) and `tessera/curves.py` (par → zero → 1Y
  forward; U.S. par yields bootstrapped on a half-year grid, ECB spot rates used directly;
  monotone cubic (PCHIP) interpolation so forwards have no jumps). `YC` gains a Zero & fwd
  view; `BOND` reports G-spread and Z-spread to those curves.
- Phase 4 added: `PORT` — `tessera/risk.py` (pure NumPy: Ledoit–Wolf shrinkage checked against
  scikit-learn, Euler risk contributions, historical/parametric/Monte Carlo VaR & ES, max
  drawdown, minimum variance, Spinu risk parity) and `tessera/portfolio.py` (holdings in any
  currency → daily total-return prices in the base currency at ECB rates; stats vs a benchmark,
  exposures, correlation, five historical stress replays with a beta proxy for holdings not yet
  listed, hypothetical equity/FX shocks, in-sample optimised alternatives). The portfolio is
  stored in the browser (`portfolio` in the workspace store, editable by pasting TICKER SHARES).
- Shell: workspace tabs (7 presets: Markets, Equity · RACE, Rates & Macro, Watchlist,
  Valuation · RACE, Options · SPY, Portfolio — the last three added by persisted-state
  migrations, versions 2–4), 1–6 tiled
  resizable panes, maximise, duplicate, link groups (4 colours), command line with autocomplete
  (functions, Yahoo search, examples, history), name→ticker resolution, global shortcuts,
  market-hours clocks, API status. State persists to localStorage (`tessera.workspace`).
- Backend: FastAPI + providers for Yahoo, U.S. Treasury, ECB, FRED, Frankfurter, SEC EDGAR;
  read-through cache with on-disk stale fallback.
- Tests: 82 backend (pytest, offline — a hand-computed DCF, a synthetic Heston chain through
  cleaning → SVI, bonds vs QuantLib, Ledoit–Wolf vs scikit-learn), 9 frontend (vitest, command
  grammar), Playwright smoke test across every workspace and function, including a DCF edit
  round-trip (`make e2e`).

---

## 3. Running

`make install`, then `make dev` → UI http://localhost:5180, API http://localhost:8010
(docs at `/docs`). Ports are deliberately not 8000/5173: project 05 uses those.
`SEC_USER_AGENT` in `.env` enables `FIL`; without it FIL shows a configuration message.

---

## 4. Architecture

```
frontend/src/
  api/          client.ts (fetch + one TanStack Query hook per endpoint), types.ts (mirrors backend)
  state/        workspace.ts — Zustand store: workspaces, panes, link groups, watchlist, history
  lib/          command.ts (grammar → Command, unit-tested), format.ts (all number/date formatting)
  functions/    registry.ts (codes, help text), index.tsx (code → component), one file per function
  components/   shell: TopBar, CommandBar, Workspace (tiling), Pane (chrome + error boundary), StatusBar
  charts/       lwc.ts + PriceChart + LineChart (Lightweight Charts), EChart (ECharts, tenor axes)
  ui/           primitives (Seg, Toggle, Stat, Spark, ProvenanceBar…), FnFrame (loading/error/footer)

backend/src/
  tessera/          models.py (Envelope, Provenance), cache.py, http.py, errors.py, markets.py
  tessera/providers yahoo.py, rates.py (Treasury + ECB curves, sovereign), macro.py (FRED + ECB),
                    fx.py (Frankfurter), sec.py (EDGAR), ecb.py (SDMX helpers)
  tessera_api/      main.py — routes only; maps TesseraError subclasses to 404/502/503
```

**Adding a function:** add the code + help to `functions/registry.ts`, argument parsing to
`parseArgs` in `lib/command.ts` (with a test), a component in `functions/`, and register it in
`functions/index.tsx`. Use `FnFrame` so loading, errors and provenance are consistent.

**Adding a provider/endpoint:** a function in `tessera/providers/` returning `Envelope[Model]`,
decorated with `@cached(ttl)`; a route in `tessera_api/main.py`; types + hook in `api/`.
Pure parsing/transform functions are separated from network calls so they can be tested offline.

**Pane model:** `{fn, security, params, link}`. `params` is a flat string map shared by the
command line (`parseArgs`) and the function's own toolbar. Security functions receive link-group
broadcasts; "source" functions (WEI, CMDTY, WL) broadcast their selected row.

---

## 5. Conventions

- Python: ruff (format + lint), pyright standard; tests offline (`TESSERA_NO_DISK_CACHE=1` in conftest).
- TypeScript strict, oxlint, prettier (no semicolons, single quotes, width 100).
- Fractions in data (0.0123), percent in macro/yield series (as published); formatting only in `lib/format.ts`.
- Colour: amber = command/focus, green/red = direction, link hues = pane wiring. A widening
  credit spread is red. Macro changes are coloured only when "up" is unambiguous (`higher_is_better`).
- Charts: callers must memoise `lines`/`averages` arrays (a new array rebuilds the series).
- Commits only at milestones, with a descriptive body (owner preference).

---

## 6. Roadmap (proposed — owner decides the order)

1. ~~**Equity depth:** `DCF`, `COMP`, `GP` compare, `DVD`, `ERN`, `MOST`~~ — done.
2. ~~**Fixed income:** `BOND`, bootstrapped zero/forward curves, shock P&L~~ — done. Next:
   callable bonds / yield-to-worst, key-rate durations, inflation-linked bonds.
3. ~~**Options:** `OMON`, `IVOL` via project 05's `derivlab`~~ — done. Next: strategy payoff
   builder on live chain prices, IV history per ticker (needs our own storage).
4. ~~**Portfolio:** `PORT`~~ — done. Next: transactions and cost basis (realised/unrealised P&L),
   several named portfolios, factor exposures, Brinson attribution.
5. **Query & alerts:** `QUERY` screening language over a cached universe, price/macro alerts.
6. **Platform:** Postgres for point-in-time storage, Docker, deploy (static UI + hosted API).
7. **AI:** `ASK` — Claude with typed tools over the terminal's own endpoints, cited answers.

Known limitations: Yahoo is unofficial and may change or rate-limit; statements are not
point-in-time; sovereign yields are monthly; market clocks ignore holidays.
