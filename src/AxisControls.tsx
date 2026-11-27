import { React } from './runtime'
import type { ReactElement, ReactNode } from 'react'
import { AXIS_UNITS, UNIT_GLYPHS } from './draw'
import { uiText } from './localization'
import { AXIS_SCALES, type AxisScale, type AxisUnits, type Mode } from './model'
import { getStore } from './store'

/** A scale as it is written: lin, or log with the logarithmic axes as a subscript (log_y, log_x, log_xy). */
const SCALE_AXES_TEXT: Record<AxisScale, string> = { linear: '', 'log-y': 'y', 'log-x': 'x', log: 'xy' }

export const ScaleGlyph = ({ scale }: { scale: AxisScale }): ReactElement => (
  <span className="grapher-axis-glyph grapher-scale-glyph">{scale === 'linear' ? 'lin' : <>log<sub>{SCALE_AXES_TEXT[scale]}</sub></>}</span>
)

const UnitGlyph = ({ units }: { units: AxisUnits }): ReactElement => <span className="grapher-axis-glyph" data-long={units === 'scientific' || undefined}>{UNIT_GLYPHS[units]}</span>

type Open = 'units' | 'scale' | null

/**
 * One round button of the graph's control stack that opens its choices as circles continuing the stack below it, like
 * Map's layer picker: picking one keeps the choices open; the button again, Escape or a click elsewhere closes them.
 */
function Picker<T extends string>({ id, label, open, setOpen, value, choices, glyph, name, pick }: {
  id: Exclude<Open, null>
  label: string
  open: Open
  setOpen: (next: Open) => void
  value: T
  choices: readonly T[]
  glyph: (value: T) => ReactNode
  name: (value: T) => string
  pick: (value: T) => void
}): ReactElement {
  const shown = open === id
  return (
    <div className="grapher-picker">
      <button type="button" className={shown ? 'grapher-zoom-button active' : 'grapher-zoom-button'} aria-expanded={shown}
        aria-label={`${label}: ${name(value)}`} title={`${label}: ${name(value)}`} onClick={() => setOpen(shown ? null : id)}>
        {glyph(value)}
      </button>
      {shown ? (
        <div className="grapher-picker-choices" role="group" aria-label={label}>
          {choices.map((choice) => (
            <button key={choice} type="button" className={choice === value ? 'grapher-zoom-button selected' : 'grapher-zoom-button'}
              aria-pressed={choice === value} aria-label={name(choice)} title={name(choice)} onClick={() => pick(choice)}>
              {glyph(choice)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Under the zoom buttons of a graph tab: the axis labels (ℝ, π, °, 10ⁿ) and, on the views that offer it, the axis scale
 * (linear, semi-log, log–log). Each is one round button showing the current choice.
 */
export const AxisControls = ({ graph, mode, units, scale }: { graph: string; mode: Mode; units: AxisUnits; scale?: AxisScale }): ReactElement => {
  const store = getStore()
  const [open, setOpen] = React.useState<Open>(null)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const view = ref.current?.ownerDocument.defaultView
    if (!open || !view) return
    const close = (event: Event): void => {
      if (event.type === 'keydown' ? (event as KeyboardEvent).key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(null)
    }
    view.addEventListener('pointerdown', close, true)
    view.addEventListener('keydown', close)
    return () => {
      view.removeEventListener('pointerdown', close, true)
      view.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div className="grapher-axis-controls" ref={ref}>
      <Picker id="units" label={uiText('units.label')} open={open} setOpen={setOpen} value={units} choices={AXIS_UNITS}
        glyph={(value) => <UnitGlyph units={value} />} name={(value) => uiText(`units.${value}`)} pick={(value) => store.setUnits(graph, mode, value)} />
      {scale ? (
        <Picker id="scale" label={uiText('scale.title')} open={open} setOpen={setOpen} value={scale} choices={AXIS_SCALES}
          glyph={(value) => <ScaleGlyph scale={value} />} name={(value) => uiText(`scale.${value}`)} pick={(value) => store.setScale(graph, mode, value)} />
      ) : null}
    </div>
  )
}
