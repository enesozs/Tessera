import clsx from 'clsx'
import { useEffect } from 'react'
import { useQuotes } from '@/api/client'
import { fmtPrice } from '@/lib/format'
import { useToasts } from '@/state/toasts'
import { useWorkspace } from '@/state/workspace'

/** Checks open alerts against delayed quotes (refreshed every minute) and raises toasts. */
export function AlertWatcher() {
  const alerts = useWorkspace((s) => s.alerts)
  const trigger = useWorkspace((s) => s.triggerAlert)
  const push = useToasts((s) => s.push)
  const open = alerts.filter((a) => !a.triggeredAt)
  const symbols = [...new Set(open.map((a) => a.symbol))].sort()
  const { data } = useQuotes(symbols)

  useEffect(() => {
    if (!data) return
    const last = new Map(data.data.map((q) => [q.symbol, q.last]))
    for (const a of open) {
      const px = last.get(a.symbol)
      if (px === undefined) continue
      if (a.op === 'above' ? px >= a.price : px <= a.price) {
        trigger(a.id, px)
        const text = `${a.symbol} ${a.op === 'above' ? 'rose above' : 'fell below'} ${fmtPrice(a.price)} — last ${fmtPrice(px)}`
        push(text, 'alert')
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
          new Notification('Tessera alert', { body: text })
      }
    }
    // `open` is derived from `alerts`; re-check whenever quotes or alerts change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, alerts])
  return null
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed right-3 bottom-8 z-50 flex w-80 flex-col gap-1.5">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={clsx(
            'pointer-events-auto rounded-[3px] border px-3 py-2 text-left text-[11.5px] shadow-xl shadow-black/50',
            t.tone === 'alert'
              ? 'border-amber-dim bg-raised text-amber'
              : 'border-line-strong bg-raised text-fg-2',
          )}
        >
          {t.tone === 'alert' && <span className="mr-1.5 font-semibold">ALERT</span>}
          {t.text}
        </button>
      ))}
    </div>
  )
}
