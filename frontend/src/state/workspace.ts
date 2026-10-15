// Workstation state: workspaces (tabs) of panes, link groups, watchlist and command history.
// Persisted to localStorage so a reload restores exactly what was on screen.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Command, Params } from '@/lib/command'
import { BY_CODE, type FunctionCode } from '@/functions/registry'

export const LINK_GROUPS = ['cyan', 'violet', 'lime', 'rose'] as const
export type LinkGroup = (typeof LINK_GROUPS)[number] | null

export interface Pane {
  id: string
  fn: FunctionCode | null
  security?: string
  params: Params
  link: LinkGroup
}

export interface Workspace {
  id: string
  name: string
  panes: Pane[]
  activePaneId: string
  maximizedPaneId: string | null
}

export interface WatchItem {
  symbol: string
  name?: string
}

export const MAX_PANES = 6

const uid = () => Math.random().toString(36).slice(2, 10)

const pane = (fn: FunctionCode | null, extra: Partial<Pane> = {}): Pane => ({
  id: uid(),
  fn,
  params: {},
  link: null,
  ...extra,
})

const workspace = (name: string, panes: Pane[]): Workspace => ({
  id: uid(),
  name,
  panes,
  activePaneId: panes[0].id,
  maximizedPaneId: null,
})

/** First-run layout: one workspace per signature workflow. */
export function defaultWorkspaces(): Workspace[] {
  return [
    workspace('Markets', [
      pane('WEI', { link: 'cyan', security: '^GSPC' }),
      pane('GP', { link: 'cyan', security: '^GSPC', params: { range: '1Y' } }),
      pane('NEWS'),
      pane('FX'),
    ]),
    workspace('Equity · RACE', [
      pane('DES', { link: 'violet', security: 'RACE' }),
      pane('GP', { link: 'violet', security: 'RACE', params: { range: '2Y' } }),
      pane('FA', { link: 'violet', security: 'RACE' }),
      pane('NEWS', { link: 'violet', security: 'RACE' }),
    ]),
    workspace('Rates & Macro', [
      pane('YC', { params: { region: 'US' } }),
      pane('YC', { params: { region: 'EA' } }),
      pane('SOV'),
      pane('ECO'),
    ]),
    workspace('Watchlist', [
      pane('WL', { link: 'lime', security: 'NVDA' }),
      pane('GP', { link: 'lime', security: 'NVDA', params: { range: '1Y' } }),
      pane('CMDTY', { link: 'lime' }),
    ]),
    valuationWorkspace(),
  ]
}

/** Added in layout version 2: the equity valuation workflow. */
function valuationWorkspace(): Workspace {
  return workspace('Valuation · RACE', [
    pane('DCF', { link: 'rose', security: 'RACE' }),
    pane('COMP', { link: 'rose', security: 'RACE' }),
    pane('GP', {
      link: 'rose',
      security: 'RACE',
      params: { range: '5Y', cmp: 'FTSEMIB.MI,^GSPC' },
    }),
    pane('ERN', { link: 'rose', security: 'RACE' }),
  ])
}

const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'ASML', name: 'ASML Holding N.V.' },
  { symbol: 'RACE.MI', name: 'Ferrari N.V. (Milan)' },
  { symbol: 'ISP.MI', name: 'Intesa Sanpaolo' },
  { symbol: 'SAP.DE', name: 'SAP SE' },
  { symbol: 'THYAO.IS', name: 'Turkish Airlines' },
  { symbol: 'BTC-USD', name: 'Bitcoin (USD)' },
]

interface State {
  workspaces: Workspace[]
  activeWorkspaceId: string
  watchlist: WatchItem[]
  history: string[]

  selectWorkspace: (id: string) => void
  cycleWorkspace: (offset: number) => void
  addWorkspace: () => void
  renameWorkspace: (id: string, name: string) => void
  removeWorkspace: (id: string) => void
  resetAll: () => void

  focusPane: (id: string) => void
  focusPaneIndex: (index: number) => void
  closePane: (id?: string) => void
  splitPane: (id?: string) => void
  toggleMaximize: (id?: string) => void
  cycleLink: (id?: string) => void
  setParams: (paneId: string, params: Params) => void
  /** Select a security from a pane: updates it (if security-based) and its linked panes. */
  selectSecurity: (paneId: string, symbol: string) => void
  /** Run a parsed command. Returns an error message, or null on success. */
  run: (command: Command, options?: { newPane?: boolean; raw?: string }) => string | null

  addToWatchlist: (item: WatchItem) => void
  removeFromWatchlist: (symbol: string) => void
}

type Draft = Pick<State, 'workspaces' | 'activeWorkspaceId' | 'watchlist' | 'history'>

function current(s: Draft): Workspace {
  return s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? s.workspaces[0]
}

function updateWorkspace(s: Draft, fn: (w: Workspace) => Workspace): Partial<Draft> {
  const ws = current(s)
  return { workspaces: s.workspaces.map((w) => (w.id === ws.id ? fn(w) : w)) }
}

/** Set `symbol` on a pane and on every linked security pane (and linked source panes). */
function broadcast(ws: Workspace, sourceId: string, symbol: string): Workspace {
  const source = ws.panes.find((p) => p.id === sourceId)
  if (!source) return ws
  return {
    ...ws,
    panes: ws.panes.map((p) => {
      const linked = p.id === sourceId || (source.link !== null && p.link === source.link)
      if (!linked || !p.fn) return p
      const spec = BY_CODE[p.fn]
      return spec.security || spec.source ? { ...p, security: symbol } : p
    }),
  }
}

/** Security a new security-function should use when none was typed. */
function inheritedSecurity(ws: Workspace, target: Pane): string | undefined {
  if (target.security) return target.security
  if (target.link) return ws.panes.find((p) => p.link === target.link && p.security)?.security
  return undefined
}

export const useWorkspace = create<State>()(
  persist(
    (set, get) => {
      const initial = defaultWorkspaces()
      return {
        workspaces: initial,
        activeWorkspaceId: initial[0].id,
        watchlist: DEFAULT_WATCHLIST,
        history: [],

        selectWorkspace: (id) => set({ activeWorkspaceId: id }),
        cycleWorkspace: (offset) =>
          set((s) => {
            const i = s.workspaces.findIndex((w) => w.id === s.activeWorkspaceId)
            const n = s.workspaces.length
            return { activeWorkspaceId: s.workspaces[(i + offset + n) % n].id }
          }),
        addWorkspace: () =>
          set((s) => {
            const ws = workspace(`Workspace ${s.workspaces.length + 1}`, [pane(null)])
            return { workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id }
          }),
        renameWorkspace: (id, name) =>
          set((s) => ({
            workspaces: s.workspaces.map((w) =>
              w.id === id ? { ...w, name: name.slice(0, 32) } : w,
            ),
          })),
        removeWorkspace: (id) =>
          set((s) => {
            if (s.workspaces.length === 1) return s
            const i = s.workspaces.findIndex((w) => w.id === id)
            const workspaces = s.workspaces.filter((w) => w.id !== id)
            const activeWorkspaceId =
              s.activeWorkspaceId === id ? workspaces[Math.max(0, i - 1)].id : s.activeWorkspaceId
            return { workspaces, activeWorkspaceId }
          }),
        resetAll: () => {
          const ws = defaultWorkspaces()
          set({ workspaces: ws, activeWorkspaceId: ws[0].id, watchlist: DEFAULT_WATCHLIST })
        },

        focusPane: (id) => set((s) => updateWorkspace(s, (w) => ({ ...w, activePaneId: id }))),
        focusPaneIndex: (index) =>
          set((s) =>
            updateWorkspace(s, (w) =>
              w.panes[index]
                ? {
                    ...w,
                    activePaneId: w.panes[index].id,
                    maximizedPaneId: w.maximizedPaneId ? w.panes[index].id : null,
                  }
                : w,
            ),
          ),
        closePane: (id) =>
          set((s) =>
            updateWorkspace(s, (w) => {
              const target = id ?? w.activePaneId
              if (w.panes.length === 1) {
                const blank = pane(null)
                return { ...w, panes: [blank], activePaneId: blank.id, maximizedPaneId: null }
              }
              const i = w.panes.findIndex((p) => p.id === target)
              const panes = w.panes.filter((p) => p.id !== target)
              return {
                ...w,
                panes,
                activePaneId:
                  w.activePaneId === target ? panes[Math.max(0, i - 1)].id : w.activePaneId,
                maximizedPaneId: w.maximizedPaneId === target ? null : w.maximizedPaneId,
              }
            }),
          ),
        splitPane: (id) =>
          set((s) =>
            updateWorkspace(s, (w) => {
              if (w.panes.length >= MAX_PANES) return w
              const source = w.panes.find((p) => p.id === (id ?? w.activePaneId))
              const copy = source ? { ...source, id: uid() } : pane(null)
              const i = w.panes.findIndex((p) => p.id === source?.id)
              const panes = [...w.panes]
              panes.splice(i + 1, 0, copy)
              return { ...w, panes, activePaneId: copy.id, maximizedPaneId: null }
            }),
          ),
        toggleMaximize: (id) =>
          set((s) =>
            updateWorkspace(s, (w) => {
              const target = id ?? w.activePaneId
              return {
                ...w,
                activePaneId: target,
                maximizedPaneId: w.maximizedPaneId ? null : target,
              }
            }),
          ),
        cycleLink: (id) =>
          set((s) =>
            updateWorkspace(s, (w) => ({
              ...w,
              panes: w.panes.map((p) => {
                if (p.id !== (id ?? w.activePaneId)) return p
                const order: LinkGroup[] = [...LINK_GROUPS, null]
                return { ...p, link: order[(order.indexOf(p.link) + 1) % order.length] }
              }),
            })),
          ),
        setParams: (paneId, params) =>
          set((s) =>
            updateWorkspace(s, (w) => ({
              ...w,
              panes: w.panes.map((p) =>
                p.id === paneId ? { ...p, params: { ...p.params, ...params } } : p,
              ),
            })),
          ),
        selectSecurity: (paneId, symbol) =>
          set((s) => updateWorkspace(s, (w) => broadcast(w, paneId, symbol))),

        run: (command, options = {}) => {
          if (command.kind === 'empty') return null
          if (command.kind === 'error') return command.message
          const s = get()
          let ws = current(s)
          let target = ws.panes.find((p) => p.id === ws.activePaneId) ?? ws.panes[0]

          if (options.newPane) {
            if (ws.panes.length >= MAX_PANES)
              return `At most ${MAX_PANES} panes per workspace — close one first (Alt+W)`
            const fresh = pane(null, { link: target.link })
            ws = { ...ws, panes: [...ws.panes, fresh] }
            target = fresh
          }

          let next: Pane
          if (command.kind === 'security') {
            const keepFn = target.fn && BY_CODE[target.fn].security
            next = { ...target, fn: keepFn ? target.fn : 'DES', security: command.security }
            if (!keepFn) next.params = {}
          } else {
            const spec = BY_CODE[command.fn]
            const security =
              command.security ?? (spec.security ? inheritedSecurity(ws, target) : target.security)
            if (spec.security && !security && command.fn !== 'NEWS')
              return `${command.fn} needs a security — e.g. RACE ${command.fn}`
            next = { ...target, fn: command.fn, security, params: command.params }
            if (command.action) {
              const { type, symbol } = command.action
              if (type === 'watchlist-add') s.addToWatchlist({ symbol })
              else s.removeFromWatchlist(symbol)
            }
          }

          ws = {
            ...ws,
            panes: ws.panes.map((p) => (p.id === target.id ? next : p)),
            activePaneId: target.id,
            maximizedPaneId: ws.maximizedPaneId ? target.id : null,
          }
          // A newly typed security propagates through the pane's link group.
          if (command.security) ws = broadcast(ws, target.id, command.security)

          const history = options.raw
            ? [options.raw, ...get().history.filter((h) => h !== options.raw)].slice(0, 50)
            : get().history
          set((st) => ({
            workspaces: st.workspaces.map((w) => (w.id === ws.id ? ws : w)),
            history,
          }))
          return null
        },

        addToWatchlist: (item) =>
          set((s) =>
            s.watchlist.some((w) => w.symbol === item.symbol)
              ? s
              : { watchlist: [...s.watchlist, item] },
          ),
        removeFromWatchlist: (symbol) =>
          set((s) => ({ watchlist: s.watchlist.filter((w) => w.symbol !== symbol) })),
      }
    },
    {
      name: 'tessera.workspace',
      version: 2,
      // Saved layouts are kept on upgrade; new preset workspaces are appended.
      migrate: (persisted, version) => {
        const state = persisted as Draft
        if (version < 2 && Array.isArray(state.workspaces))
          state.workspaces.push(valuationWorkspace())
        return state
      },
      partialize: (s) => ({
        workspaces: s.workspaces,
        activeWorkspaceId: s.activeWorkspaceId,
        watchlist: s.watchlist,
        history: s.history,
      }),
    },
  ),
)

export function useActiveWorkspace(): Workspace {
  return useWorkspace((s) => current(s))
}
