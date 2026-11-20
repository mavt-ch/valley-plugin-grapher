import { React, api } from './runtime'
import type { ReactElement } from 'react'
import { paletteCssValue, paletteRef, runtimePaletteSnapshot, subscribeRuntimePalette } from '@valley/plugin-sdk/palette'
import { Grip, Plus, X } from './icons'
import { uiText } from './localization'
import { COLORS, readColorOrder } from './model'

/** The plugin setting that holds the colour order (palette ids). */
export const COLOR_ORDER_SETTING = 'colors'

/** A palette colour's name: Grapher's own word for its seven colours, else the palette's name, else the id. */
export function colorName(id: string): string {
  const key = `color.${id}`
  const own = uiText(key)
  if (own !== key) return own
  return runtimePaletteSnapshot().colors.find((color) => color.id === id)?.name || id
}

/** A value read again whenever its source says it changed (a snapshot may be a fresh object on every read). */
function useSubscribed<T>(subscribe: (listener: () => void) => () => void, read: () => T): T {
  const [value, setValue] = React.useState(read)
  React.useEffect(() => {
    setValue(read)
    return subscribe(() => setValue(read))
  }, [])
  return value
}

const usePalette = (): readonly { id: string }[] => useSubscribed(subscribeRuntimePalette, () => runtimePaletteSnapshot().colors)
const useColorOrder = (): string[] => useSubscribed(api.settings.subscribe, () => readColorOrder(api.settings.get()[COLOR_ORDER_SETTING]))

/**
 * Settings → Grapher: the order new expressions take their colours in. The list holds palette colours; dragging (or the
 * grip with the arrow keys) reorders it, × takes a colour out (the last one stays) and the add row puts another palette
 * colour at the end.
 */
export const SettingsView = (): ReactElement => {
  const { Button, IconButton, Row, Section, SelectField, useReorderDrag } = api.ui.settings
  const palette = usePalette()
  const order = useColorOrder()
  const save = (next: readonly string[]): void => { void api.settings.set(COLOR_ORDER_SETTING, [...next]) }
  const rest = palette.map((color) => color.id).filter((id) => !order.includes(id))
  const [adding, setAdding] = React.useState('')
  const pick = rest.includes(adding) ? adding : rest[0] ?? ''
  const reorder = useReorderDrag({
    items: order,
    getId: (id) => id,
    getLabel: colorName,
    indicatorOnly: true,
    onReorder: (next) => save(next)
  })
  const isDefault = order.length === COLORS.length && order.every((id, index) => id === COLORS[index])
  return (
    <Section>
      <Row title={uiText('settings.colors.title')} description={uiText('settings.colors.description')}
        extra={<Button disabled={isDefault} onClick={() => save(COLORS)}>{uiText('settings.colors.reset')}</Button>} />
      <div className="grapher-colors" role="list" aria-label={uiText('settings.colors.title')}>
        {order.map((id) => {
          const name = colorName(id)
          const row = reorder.getRowProps(id)
          return (
            <div key={id} {...row} className="grapher-color-row" role="listitem">
              <button {...reorder.getHandleProps(id)} type="button" className="grapher-color-grip" aria-label={uiText('settings.colors.move', { name })}><Grip /></button>
              <span className="grapher-color-dot" style={{ background: paletteCssValue(paletteRef(id)) }} aria-hidden />
              <span className="grapher-color-name">{name}</span>
              <IconButton ariaLabel={uiText('settings.colors.remove', { name })} disabled={order.length <= 1} onClick={() => save(order.filter((entry) => entry !== id))}><X /></IconButton>
            </div>
          )
        })}
        <div className="grapher-color-row grapher-color-add">
          <span className="grapher-color-grip" aria-hidden />
          {rest.length ? (
            <span className="grapher-color-select">
              <SelectField value={pick} onChange={setAdding} ariaLabel={uiText('settings.colors.addLabel')}
                options={rest.map((id) => ({ value: id, label: colorName(id), color: paletteRef(id) }))} />
            </span>
          ) : <span className="grapher-color-name grapher-color-empty">{uiText('settings.colors.all')}</span>}
          <IconButton ariaLabel={uiText('settings.colors.add')} disabled={!pick} onClick={() => { if (pick) save([...order, pick]) }}><Plus /></IconButton>
        </div>
        {reorder.liveRegion}
      </div>
    </Section>
  )
}
