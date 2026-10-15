import clsx from 'clsx'
import { useState } from 'react'
import { useQuotes } from '@/api/client'
import { isTicker } from '@/lib/command'
import { fmtDateTime, fmtPct, fmtPrice } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { Empty, Seg, Spacer, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

export function Alrt({ pane }: FnProps) {
  const alerts = useWorkspace((s) => s.alerts)
  const addAlert = useWorkspace((s) => s.addAlert)
  const removeAlert = useWorkspace((s) => s.removeAlert)
  const selectSecurity = useWorkspace((s) => s.selectSecurity)
  const symbols = [...new Set(alerts.map((a) => a.symbol))]
  const quotes = useQuotes(symbols)
  const last = new Map(quotes.data?.data.map((q) => [q.symbol, q.last]) ?? [])
  const [symbol, setSymbol] = useState(pane.security ?? '')
  const [op, setOp] = useState<'above' | 'below'>('above')
  const [price, setPrice] = useState('')
  const [notify, setNotify] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  )

  const add = () => {
    const s = symbol.trim().toUpperCase()
    const p = Number(price)
    if (!isTicker(s) || !(p > 0)) return
    addAlert({ symbol: s, op, price: p })
    setPrice('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Ticker"
          aria-label="Alert ticker"
          className="num h-[22px] w-24 rounded-[3px] border border-line bg-canvas px-2 text-[11px] text-fg uppercase focus:border-amber-dim focus:outline-none"
        />
        <Seg
          value={op}
          options={[
            { value: 'above', label: 'rises above' },
            { value: 'below', label: 'falls below' },
          ]}
          onChange={setOp}
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Price"
          inputMode="decimal"
          aria-label="Alert price"
          className="num h-[22px] w-24 rounded-[3px] border border-line bg-canvas px-2 text-[11px] text-fg focus:border-amber-dim focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="h-[22px] rounded-[3px] border border-line px-2 text-[10.5px] text-fg-2 hover:text-amber"
        >
          Add
        </button>
        <Spacer />
        {notify === 'default' && (
          <button
            type="button"
            onClick={() => void Notification.requestPermission().then(setNotify)}
            className="h-[22px] rounded-[3px] border border-line px-2 text-[10.5px] text-fg-2 hover:text-amber"
          >
            Enable desktop notifications
          </button>
        )}
        <span className="text-[10.5px] text-fg-3">
          Checked every minute while Tessera is open · delayed prices
        </span>
      </Toolbar>
      {alerts.length === 0 ? (
        <Empty>No alerts. Add one above or type ALRT ADD AAPL &gt; 350.</Empty>
      ) : (
        <div className="pane-scroll min-h-0 flex-1">
          <table className="dt num">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Condition</th>
                <th>Last</th>
                <th title="Distance from the last price to the alert level">Distance</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...alerts].reverse().map((a) => {
                const px = last.get(a.symbol)
                const distance = px ? a.price / px - 1 : null
                return (
                  <tr
                    key={a.id}
                    onClick={() => selectSecurity(pane.id, a.symbol)}
                    className="cursor-pointer"
                  >
                    <td className="text-fg">{a.symbol}</td>
                    <td className="text-fg-2">
                      {a.op === 'above' ? '≥' : '≤'} {fmtPrice(a.price)}
                    </td>
                    <td className="text-fg">{fmtPrice(px)}</td>
                    <td className="text-fg-3">{fmtPct(distance, 1)}</td>
                    <td className={clsx('font-sans', a.triggeredAt ? 'text-amber' : 'text-fg-3')}>
                      {a.triggeredAt
                        ? `Triggered ${fmtDateTime(a.triggeredAt)} at ${fmtPrice(a.triggeredPrice)}`
                        : 'Watching'}
                    </td>
                    <td className="w-6">
                      <button
                        type="button"
                        title="Delete alert"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeAlert(a.id)
                        }}
                        className="text-fg-4 hover:text-down"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
