import { React, api } from './runtime'
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { paletteCssValue, paletteRef } from '@valley/plugin-sdk/palette'
import type { UiMenuItem } from '@valley/plugin-sdk'
import type { RowAnalysis } from './engine'
import { Cartesian, Eye, EyeOff, Parametric, Polar, Slider, Space, Trash, Trig, X } from './icons'
import { uiText } from './localization'
import { COLORS, MODES, createRow, rangeVariable, type Mode, type Row } from './model'
import { getStore, useGrapher } from './store'
import { formatNumber } from './ticks'

const MODE_ICONS: Record<Mode, (props: { className?: string }) => ReactElement> = { cartesian: Cartesian, trig: Trig, polar: Polar, parametric: Parametric, space: Space }
const PLACEHOLDERS: Record<Mode, string> = { cartesian: 'y = x^2', trig: 'y = sin(2x)', polar: 'r = 2cos(3θ)', parametric: '(cos t, sin(2t))', space: 'z = x^2 + y^2' }

/** The row whose input takes focus on its next render (after Enter adds a row or Backspace removes one). */
let pendingFocus: string | null = null

function stepDigits(step: number): number {
  return Math.max(0, Math.min(10, Math.ceil(-Math.log10(step) - 1e-9)))
}

/** `a = 1.3`: the text a slider writes back into its row. */
export function sliderText(name: string, value: number, step: number): string {
  return `${name} = ${Number(value.toFixed(stepDigits(step)))}`
}

const ModeSwitch = ({ mode }: { mode: Mode }): ReactElement => {
  const store = getStore()
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const next = MODES[(MODES.indexOf(mode) + delta + MODES.length) % MODES.length]
    store.setMode(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus()
  }
  return (
    <div className="grapher-modes" role="radiogroup" aria-label={uiText('mode.label')} onKeyDown={onKeyDown}>
      {MODES.map((candidate) => {
        const Icon = MODE_ICONS[candidate]
        const active = candidate === mode
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-mode={candidate}
            className={active ? 'grapher-mode active' : 'grapher-mode'}
            onClick={() => store.setMode(candidate)}
            {...api.ui.tooltip(`${uiText(`mode.${candidate}`)} — ${uiText(`mode.${candidate}.hint`)}`)}
            aria-label={uiText(`mode.${candidate}`)}
          >
            <Icon />
          </button>
        )
      })}
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
  React.useEffect(() => {
    if (pendingFocus !== row.id) return
    pendingFocus = null
    const input = inputRef.current
    input?.focus()
    input?.setSelectionRange(input.value.length, input.value.length)
  })
  const drawn = analysis ? ['function', 'polar', 'curve', 'point', 'implicit', 'surface', 'curve3', 'point3'].includes(analysis.kind) : false
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
    <div className="grapher-row" role="listitem" data-kind={analysis?.kind ?? 'empty'} data-hidden={row.hidden || undefined}>
      <div className="grapher-gutter">
        <span className="grapher-index">{index + 1}</span>
        {drawn ? (
          <button
            type="button"
            className="grapher-swatch"
            style={{ ['--swatch' as string]: color }}
            aria-pressed={!row.hidden}
            aria-label={uiText(row.hidden ? 'row.show' : 'row.hide')}
            title={uiText('row.swatch')}
            onClick={() => edit((current) => ({ ...current, hidden: !current.hidden }))}
            onContextMenu={openMenu}
          />
        ) : null}
      </div>
      <div className="grapher-row-main">
        <input
          ref={inputRef}
          data-row-input=""
          className="grapher-input"
          value={row.text}
          placeholder={trailing ? PLACEHOLDERS[mode] : ''}
          spellCheck={false}
          autoComplete="off"
          aria-label={uiText('row.input', { index: index + 1 })}
          aria-invalid={analysis?.kind === 'error' || undefined}
          onChange={(event) => {
            const text = event.target.value
            edit((current) => ({ ...current, text }))
          }}
          onKeyDown={onKeyDown}
          onContextMenu={trailing ? undefined : openMenu}
        />
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

/** Left sidebar: the coordinate-system switch in the 38px header, then the active sheet's expressions. */
export const Sidebar = (): ReactElement => {
  const store = getStore()
  const { loaded, document, engine, problems } = useGrapher()
  const mode = document.mode
  const rows = document.sheets[mode]
  const analyses = React.useMemo(() => (engine ? engine.analyze(mode, rows) : []), [engine, mode, rows])
  const editRow = (id: string) => (change: (row: Row) => Row): void => {
    store.updateRows(mode, (current) => current.map((row) => (row.id === id ? change(row) : row)))
  }
  const insertAfter = (index: number) => (): void => {
    store.updateRows(mode, (current) => {
      const row = createRow(current)
      pendingFocus = row.id
      return [...current.slice(0, index + 1), row, ...current.slice(index + 1)]
    })
  }
  const remove = (index: number) => (focus: 'previous' | 'next'): void => {
    store.updateRows(mode, (current) => {
      const target = focus === 'previous' ? current[index - 1] : current[index + 1]
      pendingFocus = target?.id ?? null
      return current.filter((_, at) => at !== index)
    })
  }
  const addSlider = (name: string): void => {
    store.updateRows(mode, (current) => {
      const filled = current.filter((row) => row.text.trim())
      return [...filled, { ...createRow(filled), text: `${name} = 1` }]
    })
  }
  return (
    <div className="grapher-panel">
      <div className="panel-header grapher-header">
        <ModeSwitch mode={mode} />
        <button
          type="button"
          className="plugin-open-page"
          onClick={(event) => api.workspace.openMainTab({ title: uiText('graph.title'), newTab: api.ui.hasModKey(event) })}
          aria-label={uiText('graph.open')}
          title={uiText('graph.open')}
        />
      </div>
      {problems.filter((problem) => problem.key !== 'problem.engine').map((problem) => (
        <p key={problem.key} role="alert" className="grapher-alert">{uiText(problem.key, { message: problem.message })}</p>
      ))}
      {loaded ? (
        <div className="grapher-list" role="list" aria-label={uiText('list.label', { mode: uiText(`mode.${mode}`) })}>
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
            />
          ))}
          <p className="grapher-hint">{uiText(`hint.${mode}`)}</p>
        </div>
      ) : (
        <api.ui.ContentLoader compact />
      )}
    </div>
  )
}
