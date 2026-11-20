import { React, api } from './runtime'
import type { ReactElement } from 'react'
import { Eye, FolderOpen, Pencil } from './icons'
import { uiText } from './localization'
import { MAIN_GRAPH, graphIdOf, graphOf } from './model'
import { viewOf } from './views'
import { getStore, useGrapher } from './store'

/** The Properties segment of a graph tab: the graph's notes. */
export const NOTES_SEGMENT = 'grapher.notes'

/** The Notes tab's icon, which the host draws in the icon colour: Material Icons "edit_note" (Google, Apache-2.0), the path
 * react-icons ships as `MdEditNote`. */
export const EDIT_NOTE_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 10h11v2H3zm0-2h11V6H3zm0 8h7v-2H3zm15.01-3.13.71-.71a.996.996 0 0 1 1.41 0l.71.71c.39.39.39 1.02 0 1.41l-.71.71zm-.71.71-5.3 5.3V21h2.12l5.3-5.3z"/></svg>')}`

/**
 * Grapher's Notes tab in Properties: one Markdown note per graph, written in a plain full-height text area and kept as
 * written; the header row switches to the host's Markdown reading view and back. While the bookmark list is open, the
 * folder clicked last has its own notes here: the header's Graph | Folder switch goes between the two.
 */
export const Notes = ({ tab }: { tab?: string }): ReactElement => {
  const store = getStore()
  const { loaded, document, active, noteFolder } = useGrapher()
  // The described tab's graph; the focused one without a tab. The header names the graph's view.
  const id = tab ? graphIdOf(document, tab) : active ?? MAIN_GRAPH
  const folder = noteFolder ? document.bookmarks?.groups.find((group) => group.id === noteFolder) : undefined
  const [scope, setScope] = React.useState<'graph' | 'folder'>('folder')
  // A folder clicked in the bookmark list brings its notes forward.
  React.useEffect(() => { if (noteFolder) setScope('folder') }, [noteFolder])
  const onFolder = folder !== undefined && scope === 'folder'
  const text = onFolder ? folder.note ?? '' : document.notes?.[id] ?? ''
  const [preview, setPreview] = React.useState(false)
  const mode = graphOf(document, id).mode
  const name = onFolder ? folder.name || uiText('bookmarks.unnamed') : uiText(`mode.${mode}`)
  const ViewIcon = viewOf(mode).icon
  const label = uiText(preview ? 'notes.edit' : 'notes.preview')
  const write = (value: string): void => {
    if (onFolder) store.setBookmarkGroupNote(folder.id, value)
    else store.setNote(id, value)
  }
  return (
    <div className="grapher-panel grapher-notes">
      <div className="grapher-notes-bar">
        {onFolder ? <FolderOpen className="grapher-notes-icon" /> : <ViewIcon className="grapher-notes-icon" />}
        <span className="grapher-notes-title">{name}</span>
        <span className="grapher-header-spacer" />
        {folder ? (
          <div className="grapher-units grapher-notes-scope" role="radiogroup" aria-label={uiText('notes.scope')}>
            {(['graph', 'folder'] as const).map((candidate) => (
              <button key={candidate} type="button" role="radio" aria-checked={scope === candidate}
                className={scope === candidate ? 'grapher-unit active' : 'grapher-unit'}
                {...api.ui.tooltip(uiText(candidate === 'graph' ? 'notes.graphHint' : 'notes.folderHint', { name: folder.name || uiText('bookmarks.unnamed') }))}
                onClick={() => setScope(candidate)}>
                {uiText(`notes.${candidate}`)}
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className="grapher-notes-action" aria-pressed={preview} aria-label={label} title={label} onClick={() => setPreview((on) => !on)}>
          {preview ? <Pencil /> : <Eye />}
        </button>
      </div>
      {!loaded ? null : preview ? (
        <div className="grapher-notes-preview">
          {text.trim() ? <api.ui.MarkdownView value={text} context={{}} /> : <p className="grapher-notes-empty">{uiText('notes.empty')}</p>}
        </div>
      ) : (
        <textarea
          key={onFolder ? `folder:${folder.id}` : `graph:${id}`}
          className="grapher-notes-field"
          value={text}
          placeholder={uiText('notes.placeholder', { name })}
          aria-label={uiText('notes.label', { name })}
          spellCheck
          onChange={(event) => write(event.target.value)}
          onBlur={() => { void store.flush() }}
        />
      )}
    </div>
  )
}
