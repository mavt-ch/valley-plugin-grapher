/**
 * Grapher — a function plotter with four coordinate systems.
 *   - `grapher.sidebar` (left_sidebar): the coordinate-system switch in the panel header, then the active
 *     sheet's expressions with sliders, ranges and errors.
 *   - `grapher.graph` (main_workspace): the zoomable graph of the active sheet.
 * Parsing, analysis and sampling run in the Rust kernel (`src/wasm`, module `plot`); both views share one store.
 */
import type { ValleyPluginApi, ValleyPluginModule } from '@valley/plugin-sdk'
import { initRuntime } from './runtime'
import { initLocalization } from './localization'
import { injectStyles } from './styles'
import { Sidebar } from './Sidebar'
import { GraphTab } from './GraphView'
import { getStore } from './store'

export function register(api: ValleyPluginApi): () => Promise<void> {
  initLocalization(api)
  initRuntime(api)
  const disposeStyles = injectStyles()
  api.registerView('grapher.sidebar', Sidebar)
  api.registerView('grapher.graph', GraphTab)
  const store = getStore()
  let disposal: Promise<void> | undefined
  return () => {
    if (disposal) return disposal
    disposal = store.flush().catch(() => {}).finally(() => {
      store.dispose()
      disposeStyles()
    })
    return disposal
  }
}

const plugin: ValleyPluginModule = { register }
export default plugin
