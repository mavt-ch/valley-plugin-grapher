import { React, api } from './runtime'
import type { ChangeEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactElement } from 'react'
import { paletteCssValue, paletteRef } from '@valley/plugin-sdk/palette'
import type { UiMenuItem } from '@valley/plugin-sdk'
import type { RowAnalysis } from './engine'
import { Check, ChevronDown, Eye, EyeOff, Grip, Slider, Trash, Warning, X } from './icons'
import { uiText } from './localization'
import { MathText } from './MathText'
import { COLORS, MAIN_GRAPH, MODES, createRow, graphOf, moveRow, rangeVariable, unitsOf, type AxisUnits, type Mode, type Row } from './model'
import { getStore, useGrapher } from './store'
import { formatComplex, formatNumber, formatPolar } from './ticks'
import { viewOf } from './views'

const DRAWN = new Set(['function', 'polar', 'curve', 'point', 'implicit', 'surface', 'curve3', 'point3', 'region', 'cpoint', 'csurface'])

/** The row whose input takes focus on its next render (after Enter adds a row or Backspace removes one). */
let pendingFocus: string | null = null

function stepDigits(step: number): number {
  return Math.max(0, Math.min(10, Math.ceil(-Math.log10(step) - 1e-9)))
}

/** `a = 1.3`: the text a slider writes back into its row. */
export function sliderText(name: string, value: number, step: number): string {
  return `${name} = ${Number(value.toFixed(stepDigits(step)))}`
}

/** Opens a new tab with a fresh graph of its own on the given view. */
export function openNewGraph(mode: Mode, paneId?: string): void {
  const id = getStore().createGraph(mode)
  api.workspace.openMainTab({ instanceId: id, title: uiText('graph.title'), newTab: true, paneId })
}

/** The header's view button: the focused graph's view; it swaps the expression list for the list of views. */
const ViewButton = ({ mode, open, toggle }: { mode: Mode; open: boolean; toggle: () => void }): ReactElement => {
  const Icon = viewOf(mode).icon
  return (
    <button type="button" className="grapher-view-picker" aria-expanded={open} aria-label={uiText('view.choose', { mode: uiText(`mode.${mode}`) })} onClick={toggle}>
      <Icon className="grapher-view-icon" />
      <span className="grapher-view-name">{uiText(`mode.${mode}`)}</span>
      <ChevronDown className="grapher-view-chevron" />
    </button>
  )
}

/** Every view as a full-width choice in place of the expressions; ⌘-click opens the view as a new graph in its own tab. */
const ViewList = ({ graph, mode, close }: { graph: string; mode: Mode; close: () => void }): ReactElement => {
  const store = getStore()
  const listRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus() }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])
    const at = buttons.indexOf(event.target as HTMLButtonElement)
    buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }
  return (
    <div ref={listRef} className="grapher-views" role="radiogroup" aria-label={uiText('mode.label')} onKeyDown={onKeyDown}>
      {MODES.map((candidate) => {
        const Icon = viewOf(candidate).icon
        const checked = candidate === mode
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={checked}
            className={checked ? 'grapher-view-option active' : 'grapher-view-option'}
            onClick={(event) => {
              if (api.ui.hasModKey(event)) openNewGraph(candidate)
              else store.setMode(graph, candidate)
              close()
            }}
          >
            <Icon className="grapher-view-option-icon" />
            <span className="grapher-view-option-text">
              <span className="grapher-view-option-name">{uiText(`mode.${candidate}`)}</span>
              <span className="grapher-view-option-hint">{uiText(`mode.${candidate}.hint`)}</span>
            </span>
            {checked ? <Check className="grapher-view-option-check" /> : <span className="grapher-view-option-check" />}
          </button>
        )
      })}
    </div>
  )
}

/** Beside the open-graph button on every view: label the axes in real numbers or in multiples of π; only the labels change. */
const UnitsSwitch = ({ graph, mode, units }: { graph: string; mode: Mode; units: AxisUnits }): ReactElement => {
  const store = getStore()
  return (
    <div className="grapher-units" role="radiogroup" aria-label={uiText('units.label')}>
      {(['decimal', 'pi'] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          role="radio"
          aria-checked={units === candidate}
          className={units === candidate ? 'grapher-unit active' : 'grapher-unit'}
          aria-label={uiText(`units.${candidate}`)}
          {...api.ui.tooltip(uiText(`units.${candidate}`))}
          onClick={() => store.setUnits(graph, mode, candidate)}
        >
          {candidate === 'pi' ? 'π' : 'ℝ'}
        </button>
      ))}
    </div>
  )
}

interface RowProps {
  mode: Mode
  row: Row
  index: number
  trailing: boolean
  analysis: RowAnalysis | undefined
  edit: (change: (row: Row) => Row) => void
  insertAfter: () => void
  remove: (focus: 'previous' | 'next') => void
  addSlider: (name: string) => void
  dragging: boolean
  startDrag: (event: PointerEvent<HTMLButtonElement>) => void
}

const SliderControl = ({ row, analysis, edit }: Pick<RowProps, 'row' | 'analysis' | 'edit'>): ReactElement | null => {
  if (analysis?.kind !== 'param' || !analysis.slider || analysis.name === undefined || analysis.value === undefined) return null
  const name = analysis.name
  const { step } = row.slider
  const min = Math.min(row.slider.min, analysis.value)
  const max = Math.max(row.slider.max, analysis.value)
  const fill = max > min ? ((analysis.value - min) / (max - min)) * 100 : 0
  const bound = (key: 'min' | 'max') => (event: ChangeEvent<HTMLInputElement>): void => {
    const value = Number(event.target.value)
    if (event.target.value.trim() === '' || !Number.isFinite(value)) return
    const next = { ...row.slider, [key]: value }
    if (next.min < next.max) edit((current) => ({ ...current, slider: next }))
  }
  return (
    <div className="grapher-slider">
      <input className="grapher-bound" type="number" step="any" value={formatBound(min)} onChange={bound('min')} aria-label={uiText('slider.min', { name })} />
      <input
        className="grapher-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={analysis.value}
        style={{ ['--slider-fill' as string]: `${fill}%` }}
        aria-label={uiText('slider.value', { name })}
        onChange={(event) => {
          const value = Number(event.target.value)
          edit((current) => ({ ...current, text: sliderText(name, value, step) }))
        }}
      />
      <input className="grapher-bound" type="number" step="any" value={formatBound(max)} onChange={bound('max')} aria-label={uiText('slider.max', { name })} />
    </div>
  )
}

const formatBound = (value: number): string => String(Number(value.toPrecision(8)))

const RangeControl = ({ row, analysis, edit }: Pick<RowProps, 'row' | 'analysis' | 'edit'>): ReactElement | null => {
  if (analysis?.kind !== 'polar' && analysis?.kind !== 'curve' && analysis?.kind !== 'curve3') return null
  const variable = rangeVariable(analysis.kind)
  const field = (key: 'from' | 'to', placeholder: string): ReactElement => (
    <input
      className="grapher-bound grapher-range-bound"
      value={row[key]}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      aria-label={uiText(key === 'from' ? 'range.from' : 'range.to', { name: variable })}
      onChange={(event) => {
        const value = event.target.value
        edit((current) => ({ ...current, [key]: value }))
      }}
    />
  )
  return (
    <div className="grapher-domain">
      {field('from', '0')}
      <span className="grapher-domain-variable">≤ {variable} ≤</span>
      {field('to', '2π')}
    </div>
  )
}

const Details = (props: RowProps): ReactElement | null => {
  const { analysis, row } = props
  if (!analysis || !row.text.trim()) return null
  switch (analysis.kind) {
    case 'error': {
      const error = analysis.error
      if (!error) return null
      return (
        <div className="grapher-error" role="status">
          <span>{uiText(error.key, { name: error.param })}</span>
          {error.missing.length ? (
            <span className="grapher-chips">
              {error.missing.map((name) => (
                <button key={name} type="button" className="grapher-chip" onClick={() => props.addSlider(name)}>
                  <Slider />
                  {uiText('row.addSlider', { name })}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      )
    }
    case 'value':
      return <div className="grapher-value">= {formatNumber(analysis.value ?? Number.NaN, 8)}</div>
    case 'cpoint': {
      const [re, im] = [analysis.x ?? Number.NaN, analysis.y ?? Number.NaN]
      return <div className="grapher-value">= {formatComplex(re, im, 6)} = {formatPolar(re, im, 6)}</div>
    }
    case 'param':
      return analysis.slider ? <SliderControl {...props} /> : <div className="grapher-value">= {formatNumber(analysis.value ?? Number.NaN, 8)}</div>
    case 'polar':
    case 'curve':
    case 'curve3':
      return <RangeControl {...props} />
    default:
      return null
  }
}

const ExpressionRow = (props: RowProps): ReactElement => {
  const { mode, row, index, trailing, analysis, edit } = props
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [editing, setEditing] = React.useState(false)
  React.useEffect(() => {
    if (pendingFocus !== row.id) return
    pendingFocus = null
    const input = inputRef.current
    input?.focus()
    input?.setSelectionRange(input.value.length, input.value.length)
  })
  const drawn = analysis ? DRAWN.has(analysis.kind) : false
  const typeset = !editing && row.text.trim() !== ''
  const error = analysis?.kind === 'error' && analysis.error ? uiText(analysis.error.key, { name: analysis.error.param }) : null
  const color = paletteCssValue(row.color)
  const openMenu = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    const items: UiMenuItem[] = [
      { id: 'visibility', label: uiText(row.hidden ? 'row.show' : 'row.hide'), icon: row.hidden ? <Eye /> : <EyeOff />, onSelect: () => edit((current) => ({ ...current, hidden: !current.hidden })) },
      { type: 'separator' },
      ...COLORS.map((id): UiMenuItem => ({
        id: `color:${id}`,
        type: 'radio',
        checked: row.color === paletteRef(id),
        label: uiText(`color.${id}`),
        icon: <span className="grapher-menu-swatch" style={{ background: paletteCssValue(paletteRef(id)) }} />,
        onSelect: () => edit((current) => ({ ...current, color: paletteRef(id) }))
      })),
      ...(trailing ? [] : [{ type: 'separator' } as UiMenuItem, { id: 'delete', label: uiText('row.delete'), icon: <Trash />, danger: true, onSelect: () => props.remove('next') }])
    ]
    void api.ui.openMenu(items, { x: event.clientX, y: event.clientY })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const list = event.currentTarget.closest('.grapher-list')
    const move = (delta: number): void => {
      const inputs = Array.from(list?.querySelectorAll<HTMLInputElement>('input[data-row-input]') ?? [])
      const target = inputs[index + delta]
      if (!target) return
      event.preventDefault()
      target.focus()
    }
    if (event.key === 'Enter' && !trailing) {
      event.preventDefault()
      props.insertAfter()
    } else if (event.key === 'Backspace' && !event.currentTarget.value && !trailing) {
      event.preventDefault()
      props.remove(index > 0 ? 'previous' : 'next')
    } else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'ArrowDown') move(1)
  }
  return (
    <div className="grapher-row" role="listitem" data-row-index={index} data-kind={analysis?.kind ?? 'empty'} data-hidden={row.hidden || undefined} data-dragging={props.dragging || undefined}>
      <div className="grapher-gutter">
        {trailing ? <span className="grapher-handle"><span className="grapher-index">{index + 1}</span></span> : (
          <button
            type="button"
            className="grapher-handle"
            tabIndex={-1}
            aria-label={uiText('row.drag')}
            title={uiText('row.drag')}
            onPointerDown={props.startDrag}
          >
            <span className="grapher-index">{index + 1}</span>
            <Grip className="grapher-grip-icon" />
          </button>
        )}
        <span className="grapher-mark">
        {error ? (
          <span className="grapher-warning" role="img" aria-label={error} {...api.ui.tooltip(error)}><Warning /></span>
        ) : drawn ? (
          <button
            type="button"
            className={analysis?.kind === 'csurface' ? 'grapher-swatch grapher-swatch-hue' : 'grapher-swatch'}
            style={{ ['--swatch' as string]: color }}
            aria-pressed={!row.hidden}
            aria-label={uiText(row.hidden ? 'row.show' : 'row.hide')}
            title={uiText('row.swatch')}
            onClick={() => edit((current) => ({ ...current, hidden: !current.hidden }))}
            onContextMenu={openMenu}
          />
        ) : null}
        </span>
      </div>
      <div className="grapher-row-main">
        <div className="grapher-field" data-typeset={typeset || undefined}>
        {typeset ? <div className="grapher-typeset"><MathText text={row.text} /></div> : null}
        <input
          ref={inputRef}
          data-row-input=""
          className="grapher-input"
          value={row.text}
          placeholder={trailing ? viewOf(mode).placeholder : ''}
          spellCheck={false}
          autoComplete="off"
          aria-label={uiText('row.input', { index: index + 1 })}
          aria-invalid={analysis?.kind === 'error' || undefined}
          onChange={(event) => {
            const text = event.target.value
            edit((current) => ({ ...current, text }))
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onContextMenu={trailing ? undefined : openMenu}
        />
        </div>
        <Details {...props} />
      </div>
      {trailing ? <span className="grapher-row-spacer" /> : (
        <button type="button" className="grapher-delete" aria-label={uiText('row.delete')} title={uiText('row.delete')} onClick={() => props.remove('next')}>
          <X />
        </button>
      )}
    </div>
  )
}

/** Left sidebar: the focused graph's view button, axis labels and open button in the 38px header, then its expressions. */
export const Sidebar = (): ReactElement => {
  const store = getStore()
  const { loaded, document, active, engine, problems } = useGrapher()
  const graph = graphOf(document, active)
  const mode = graph.mode
  const rows = graph.sheets[mode]
  const units = unitsOf(graph, mode)
  const [choosing, setChoosing] = React.useState(false)
  React.useEffect(() => setChoosing(false), [active])
  const analyses = React.useMemo(() => (engine ? engine.analyze(mode, rows) : []), [engine, mode, rows])
  const editRow = (id: string) => (change: (row: Row) => Row): void => {
    store.updateRows(active, mode, (current) => current.map((row) => (row.id === id ? change(row) : row)))
  }
  const insertAfter = (index: number) => (): void => {
    store.updateRows(active, mode, (current) => {
      const row = createRow(current)
      pendingFocus = row.id
      return [...current.slice(0, index + 1), row, ...current.slice(index + 1)]
    })
  }
  const remove = (index: number) => (focus: 'previous' | 'next'): void => {
    store.updateRows(active, mode, (current) => {
      const target = focus === 'previous' ? current[index - 1] : current[index + 1]
      pendingFocus = target?.id ?? null
      return current.filter((_, at) => at !== index)
    })
  }
  const listRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ pointer: number; from: number; to: number } | null>(null)
  const [drag, setDrag] = React.useState<{ from: number; to: number; marker: number } | null>(null)
  /** The gap (0 … typed rows) nearest the pointer, and the y of its separator line inside the list. */
  const gapAt = (clientY: number): { gap: number; marker: number } | null => {
    const list = listRef.current
    if (!list) return null
    const elements = Array.from(list.querySelectorAll<HTMLElement>('[data-row-index]')).slice(0, rows.length - 1)
    if (!elements.length) return null
    let gap = 0
    elements.forEach((element, at) => {
      const rect = element.getBoundingClientRect()
      if (clientY > rect.top + rect.height / 2) gap = at + 1
    })
    const marker = gap < elements.length ? elements[gap].offsetTop : elements[gap - 1].offsetTop + elements[gap - 1].offsetHeight
    return { gap, marker }
  }
  const startDrag = (index: number) => (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const found = gapAt(event.clientY)
    dragRef.current = { pointer: event.pointerId, from: index, to: index }
    setDrag({ from: index, to: index, marker: found?.marker ?? 0 })
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    const list = listRef.current
    if (!current || current.pointer !== event.pointerId || !list) return
    const bounds = list.getBoundingClientRect()
    if (event.clientY < bounds.top + 24) list.scrollTop -= 8
    else if (event.clientY > bounds.bottom - 24) list.scrollTop += 8
    const found = gapAt(event.clientY)
    if (!found) return
    current.to = found.gap
    setDrag({ from: current.from, to: found.gap, marker: found.marker })
  }
  const endDrag = (commit: boolean) => (event: PointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    if (!current || current.pointer !== event.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (commit && current.to !== current.from && current.to !== current.from + 1) store.updateRows(active, mode, (all) => moveRow(all, current.from, Math.min(current.to, all.length - 1)))
  }
  const showMarker = drag !== null && drag.to !== drag.from && drag.to !== drag.from + 1
  const addSlider = (name: string): void => {
    store.updateRows(active, mode, (current) => {
      const filled = current.filter((row) => row.text.trim())
      return [...filled, { ...createRow(filled), text: `${name} = 1` }]
    })
  }
  return (
    <div className="grapher-panel">
      <div className="panel-header grapher-header">
        <ViewButton mode={mode} open={choosing} toggle={() => setChoosing((open) => !open)} />
        <span className="grapher-header-spacer" />
        {!choosing ? <UnitsSwitch graph={active} mode={mode} units={units} /> : null}
        <button
          type="button"
          className="plugin-open-page"
          onClick={(event) => {
            if (api.ui.hasModKey(event)) openNewGraph(mode)
            else api.workspace.openMainTab({ instanceId: active === MAIN_GRAPH ? store.forkGraph(MAIN_GRAPH) : active, title: uiText('graph.title') })
          }}
          aria-label={uiText('graph.open')}
          title={uiText('graph.open')}
        />
      </div>
      {problems.filter((problem) => problem.key !== 'problem.engine').map((problem) => (
        <p key={problem.key} role="alert" className="grapher-alert">{uiText(problem.key, { message: problem.message })}</p>
      ))}
      {loaded && choosing ? (
        <ViewList graph={active} mode={mode} close={() => setChoosing(false)} />
      ) : loaded ? (
        <div
          ref={listRef}
          className="grapher-list"
          role="list"
          aria-label={uiText('list.label', { mode: uiText(`mode.${mode}`) })}
          data-dragging={drag ? '' : undefined}
          onPointerMove={moveDrag}
          onPointerUp={endDrag(true)}
          onPointerCancel={endDrag(false)}
        >
          {rows.map((row, index) => (
            <ExpressionRow
              key={row.id}
              mode={mode}
              row={row}
              index={index}
              trailing={index === rows.length - 1 && !row.text.trim()}
              analysis={analyses[index]}
              edit={editRow(row.id)}
              insertAfter={insertAfter(index)}
              remove={remove(index)}
              addSlider={addSlider}
              dragging={drag?.from === index}
              startDrag={startDrag(index)}
            />
          ))}
          {showMarker ? <div className="grapher-drop-marker" style={{ top: drag.marker }} aria-hidden /> : null}
          <p className="grapher-hint">{uiText(`hint.${mode}`)}</p>
        </div>
      ) : (
        <api.ui.ContentLoader compact />
      )}
    </div>
  )
}
