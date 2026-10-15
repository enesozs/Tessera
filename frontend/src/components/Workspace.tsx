import { Fragment, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useActiveWorkspace, type Workspace as WorkspaceState } from '@/state/workspace'
import { Pane } from './Pane'

// Tiling templates by pane count. Leaves are pane indexes in reading order; rows/cols are
// resizable groups. Five or six panes become two rows of three.
type Node = number | { dir: 'row' | 'col'; children: Node[] }
const row = (...children: Node[]): Node => ({ dir: 'row', children })
const col = (...children: Node[]): Node => ({ dir: 'col', children })

const TEMPLATES: Record<number, Node> = {
  1: 0,
  2: row(0, 1),
  3: row(0, col(1, 2)),
  4: col(row(0, 1), row(2, 3)),
  5: col(row(0, 1, 2), row(3, 4)),
  6: col(row(0, 1, 2), row(3, 4, 5)),
}

export function Workspace() {
  const ws = useActiveWorkspace()
  const maximized = ws.panes.find((p) => p.id === ws.maximizedPaneId)

  if (maximized) {
    const index = ws.panes.indexOf(maximized)
    return (
      <div className="h-full p-1">
        <Pane pane={maximized} index={index} active maximized />
      </div>
    )
  }
  return (
    // Keyed by workspace + pane count so a new template starts from even sizes.
    <div className="h-full p-1" key={`${ws.id}:${ws.panes.length}`}>
      {render(TEMPLATES[ws.panes.length] ?? TEMPLATES[6], ws, 'root')}
    </div>
  )
}

function render(node: Node, ws: WorkspaceState, path: string): ReactNode {
  if (typeof node === 'number') {
    const pane = ws.panes[node]
    return pane ? (
      <Pane pane={pane} index={node} active={pane.id === ws.activePaneId} maximized={false} />
    ) : null
  }
  return (
    <Group orientation={node.dir === 'row' ? 'horizontal' : 'vertical'} className="h-full w-full">
      {node.children.map((child, i) => (
        <Fragment key={`${path}.${i}`}>
          {i > 0 && (
            <Separator
              className={
                node.dir === 'row'
                  ? 'group flex w-1 items-center justify-center outline-none'
                  : 'group flex h-1 items-center justify-center outline-none'
              }
            >
              <div
                className={
                  node.dir === 'row'
                    ? 'h-8 w-px rounded bg-transparent transition-colors group-hover:bg-amber/60 group-active:bg-amber'
                    : 'h-px w-8 rounded bg-transparent transition-colors group-hover:bg-amber/60 group-active:bg-amber'
                }
              />
            </Separator>
          )}
          <Panel minSize="12" className="min-h-0 min-w-0">
            {render(child, ws, `${path}.${i}`)}
          </Panel>
        </Fragment>
      ))}
    </Group>
  )
}
