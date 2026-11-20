import { React, api } from './runtime'
import type { ReactElement } from 'react'
import { Eye, Pencil } from './icons'
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
 * written; the header row switches to the host's Markdown reading view and back.
 */
export const Notes = ({ tab }: { tab?: string }): ReactElement => {
  const store = getStore()
  const { loaded, document, active } = useGrapher()
  // The described tab's graph; the focused one without a tab. The header names the graph's view.
  const id = tab ? graphIdOf(document, tab) : active ?? MAIN_GRAPH
  const text = document.notes?.[id] ?? ''
  const [preview, setPreview] = React.useState(false)
  const mode = graphOf(document, id).mode
  const name = uiText(`mode.${mode}`)
  const ViewIcon = viewOf(mode).icon
  const label = uiText(preview ? 'notes.edit' : 'notes.preview')
  return (
    <div className="grapher-panel grapher-notes">
      <div className="grapher-notes-bar">
        <ViewIcon className="grapher-notes-icon" />
        <span className="grapher-notes-title">{name}</span>
        <span className="grapher-header-spacer" />
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
          className="grapher-notes-field"
          value={text}
          placeholder={uiText('notes.placeholder', { name })}
          aria-label={uiText('notes.label', { name })}
          spellCheck
          onChange={(event) => store.setNote(id, event.target.value)}
          onBlur={() => { void store.flush() }}
        />
      )}
    </div>
  )
}
