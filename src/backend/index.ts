import type { PluginBackendApi } from '@valley/plugin-sdk'
import { profileIcons, type IconStorage } from './icons'

/** Grapher's backend: only the profile icon folder (`.valley/assets/icons/grapher-icon/`), which the UI cannot reach. */
export function register(api: PluginBackendApi): () => Promise<void> {
  const off = api.rpc.handle('icons', (payload) => profileIcons(api.storage as unknown as IconStorage, (payload as { defaults?: Record<string, string> } | undefined)?.defaults ?? {}))
  return async () => { off() }
}
