import { React, api } from './runtime'
import type { ReactElement } from 'react'
import { Eye, Pencil } from './icons'
import { uiText } from './localization'
import { MAIN_GRAPH, profileOf } from './model'
import { ProfileGlyph } from './Sidebar'
import { getStore, useGrapher } from './store'

/** The Properties segment of a graph tab: the profile's notes. */
export const NOTES_SEGMENT = 'grapher.notes'

/**
 * Grapher's Notes tab in Properties: one Markdown note per profile, written in a plain full-height text area and kept as
 * written; the header row switches to the host's Markdown reading view and back.
 */
export const Notes = ({ tab }: { tab?: string }): ReactElement => {
  const store = getStore()
  const { loaded, document, active } = useGrapher()
  // The described tab's profile, followed live as the tab switches profiles; the focused one without a tab.
  const id = tab ? profileOf(document, tab) : active ?? MAIN_GRAPH
  const text = document.notes?.[id] ?? ''
  const [preview, setPreview] = React.useState(false)
  const name = store.profileName(id)
  const label = uiText(preview ? 'notes.edit' : 'notes.preview')
  return (
    <div className="grapher-panel grapher-notes">
      <div className="grapher-notes-bar">
        <ProfileGlyph profile={id} className="grapher-notes-icon" />
        <span className="grapher-notes-title">{name}</span>
        <span className="grapher-header-spacer" />
        <button type="button" className="grapher-profile-action" aria-pressed={preview} aria-label={label} title={label} onClick={() => setPreview((on) => !on)}>
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
