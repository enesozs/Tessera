import { parseCommand } from '@/lib/command'
import { useWorkspace } from '@/state/workspace'
import { SectionTitle } from '@/ui/primitives'
import { FUNCTIONS, type Category } from './registry'

export const SHORTCUTS: [string, string][] = [
  ['/  or  Ctrl K', 'Focus the command line (or just start typing)'],
  ['Enter', 'Run in the active pane'],
  ['Shift Enter', 'Run in a new pane'],
  ['Tab', 'Accept the highlighted suggestion'],
  ['↑ ↓', 'Move through suggestions / history'],
  ['Esc', 'Leave the command line'],
  ['Alt 1 … 6', 'Focus pane 1 … 6'],
  ['Alt M', 'Maximise / restore the active pane'],
  ['Alt N', 'Duplicate the active pane'],
  ['Alt W', 'Close the active pane'],
  ['Alt L', 'Cycle the active pane’s link colour'],
  ['Alt [  /  Alt ]', 'Previous / next workspace'],
]

const SOURCES: [string, string, string][] = [
  [
    'Yahoo Finance',
    'Equities, indices, futures, statements, news',
    'Delayed / end of day; unofficial API for personal & educational use',
  ],
  ['U.S. Treasury', 'Daily par yield curve', 'Official, end of day'],
  [
    'European Central Bank',
    'Euro-area yield curves, sovereign 10Y, macro',
    'Official; curves daily, sovereign yields monthly',
  ],
  [
    'FRED (St. Louis Fed)',
    'U.S. and euro-area macro series',
    'Official releases, revised over time',
  ],
  ['Frankfurter / ECB', 'FX reference rates', 'One fixing per business day, ~14:15 CET'],
  ['SEC EDGAR', 'Company filings', 'Official; needs SEC_USER_AGENT'],
]

const CATEGORIES: Category[] = [
  'Security',
  'Valuation',
  'Markets',
  'Rates & FX',
  'Macro',
  'Terminal',
]

export function Help() {
  const run = useWorkspace((s) => s.run)
  return (
    <div className="pane-scroll h-full px-3 py-2 @container">
      <p className="max-w-3xl leading-relaxed text-fg-2">
        Tessera is a keyboard-first market terminal built on free public data. Type a command in the
        bar above: a <span className="text-amber">ticker</span>, a{' '}
        <span className="text-amber">function</span>, or both — e.g. <Cmd onRun={run}>RACE GP</Cmd>,{' '}
        <Cmd onRun={run}>YC EA</Cmd>, <Cmd onRun={run}>AAPL FA BS Q</Cmd>. Panes sharing a link
        colour follow each other: pick a security in one and the others update.
      </p>
      <div className="mt-2 grid gap-x-8 @4xl:grid-cols-[3fr_2fr]">
        <div>
          {CATEGORIES.map((cat) => (
            <div key={cat}>
              <SectionTitle>{cat}</SectionTitle>
              <table className="dt mb-2">
                <tbody>
                  {FUNCTIONS.filter((f) => f.category === cat).map((f) => (
                    <tr key={f.code}>
                      <td className="num w-14 font-semibold text-amber">{f.code}</td>
                      <td className="!text-left whitespace-normal">
                        <div className="text-fg">{f.title}</div>
                        <div className="text-fg-3">{f.summary}</div>
                      </td>
                      <td className="!text-left align-top">
                        <div className="num text-fg-3">{f.syntax}</div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {f.examples.map((e) => (
                            <Cmd key={e} onRun={run}>
                              {e}
                            </Cmd>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div>
          <SectionTitle>Keyboard</SectionTitle>
          <table className="dt mb-3">
            <tbody>
              {SHORTCUTS.map(([k, v]) => (
                <tr key={k}>
                  <td className="num w-32 text-fg">{k}</td>
                  <td className="!text-left text-fg-2">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <SectionTitle>Data sources</SectionTitle>
          <table className="dt mb-3">
            <tbody>
              {SOURCES.map(([name, what, how]) => (
                <tr key={name}>
                  <td className="!text-left align-top whitespace-normal">
                    <div className="text-fg">{name}</div>
                    <div className="text-fg-3">{what}</div>
                  </td>
                  <td className="!text-left align-top whitespace-normal text-fg-3">{how}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="leading-relaxed text-fg-3">
            Every pane footer states its source, freshness and as-of time. Nothing here is real-time
            or investment advice. Tessera is an independent project, not affiliated with Bloomberg
            L.P. or any data provider. Charts by TradingView Lightweight Charts™ and Apache ECharts.
          </p>
        </div>
      </div>
    </div>
  )
}

function Cmd({
  children,
  onRun,
}: {
  children: string
  onRun: ReturnType<typeof useWorkspace.getState>['run']
}) {
  return (
    <button
      type="button"
      onClick={() => onRun(parseCommand(children), { raw: children })}
      className="num rounded-[2px] border border-line bg-canvas px-1 text-[10.5px] text-fg-2 hover:border-amber-dim hover:text-amber"
    >
      {children}
    </button>
  )
}
