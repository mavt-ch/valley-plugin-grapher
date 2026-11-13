/**
 * Grapher — a function plotter with four coordinate systems.
 *   - `grapher.sidebar` (left_sidebar): the coordinate-system switch in the panel header, then the active
 *     sheet's expressions with sliders, ranges and errors.
 *   - `grapher.reference` (right_sidebar): every feature with its syntax and examples, the focused view's groups first.
 *   - `grapher.graph` (main_workspace): one tab per graph; each tab keeps its own view and sheets, and the sidebar
 *     edits the focused one.
 * Parsing, analysis and sampling run in the Rust kernel (`src/wasm`, module `plot`); both views share one store.
 */
import type { ValleyPluginApi, ValleyPluginModule } from '@valley/plugin-sdk'
import { initRuntime } from './runtime'
import { initLocalization } from './localization'
import { injectStyles } from './styles'
import { Sidebar, openNewGraph } from './Sidebar'
import { GraphTab } from './GraphView'
import { Reference } from './Reference'
import { getStore } from './store'
import { provideGraphSurface } from './exporting'

export function register(api: ValleyPluginApi): () => Promise<void> {
  initLocalization(api)
  initRuntime(api)
  const disposeStyles = injectStyles()
  api.registerView('grapher.sidebar', Sidebar)
  api.registerView('grapher.graph', GraphTab)
  api.registerView('grapher.reference', Reference)
  const store = getStore()
  // + in the tab strip of a Grapher tab opens another graph with its own sheets, on the focused graph's view.
  const offNewTab = api.workspace.registerNewTabHandler(({ paneId }) => openNewGraph(store.graph(store.getSnapshot().active).mode, paneId))
  // The graph tab's three-dot menu offers the export of what it shows.
  const offSurface = provideGraphSurface(api, store)
  let disposal: Promise<void> | undefined
  return () => {
    if (disposal) return disposal
    offNewTab()
    offSurface()
    disposal = store.flush().catch(() => {}).finally(() => {
      store.dispose()
      disposeStyles()
    })
    return disposal
  }
}

const plugin: ValleyPluginModule = { register }
export default plugin
