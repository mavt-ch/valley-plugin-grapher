import { describe, expect, it } from 'vitest'
import { MAX_TABLE_ROWS, cellText, isNumber, looksTabular, parseTable } from '../src/table'
import { pasteInto, pastedTable, trimCells } from '../src/Sidebar'
import { createTable, normalizeDocument, withTrailingRow, createRow } from '../src/model'

describe('tables of points', () => {
  it('reads decimal commas and digit groups and leaves expressions as typed', () => {
    expect(['1,5', '-0,25', '1.234,5', "1'234.5", '1 234,5', '1,234,567', '2.5', '−3', '1,5E-3', ' 7 '].map(cellText)).toEqual(['1.5', '-0.25', '1234.5', '1234.5', '1234.5', '1234567', '2.5', '-3', '1.5*10^(-3)', '7'])
    expect(['π/2', '2a', 'sqrt(2)', '', 'x'].map(cellText)).toEqual(['π/2', '2a', 'sqrt(2)', '', 'x'])
    expect([isNumber('3,25'), isNumber('a'), isNumber('')]).toEqual([true, false, false])
  })

  it('parses spreadsheet pastes: tabs, semicolons, a header, blank lines and one column', () => {
    const tabs = parseTable('Zeit [s]\tWeg [m]\n0\t0\n\n0,5\t1,25\r\n1\t5\t9\n')
    expect(tabs).toMatchObject({ head: ['Zeit [s]', 'Weg [m]'], cells: [['0', '0'], ['0.5', '1.25'], ['1', '5']], total: 3, single: false, extra: true })
    expect(parseTable('1;2\n3;4').cells).toEqual([['1', '2'], ['3', '4']])
    expect(parseTable('"1.5","2"\n3,4').cells).toEqual([['1.5', '2'], ['3', '4']])
    expect(parseTable('1 2\n3 4').cells).toEqual([['1', '2'], ['3', '4']])
    expect(parseTable('Höhe\n2\n4\n8')).toMatchObject({ head: ['', 'Höhe'], cells: [['1', '2'], ['2', '4'], ['3', '8']], single: true })
    // A first line of numbers is data, not a header; a line of text under numbers does not make a header either.
    expect(parseTable('1\t2\n3\t4').head).toBeNull()
    expect(parseTable('a\t1\nb\t2').head).toBeNull()
  })

  it('caps long pastes and says what it kept', () => {
    const text = Array.from({ length: 2500 }, (_, index) => `${index}\t${index * 2}`).join('\n')
    const parsed = parseTable(text)
    expect(parsed.cells).toHaveLength(MAX_TABLE_ROWS)
    expect(parsed.total).toBe(2500)
    const { table, notice } = pastedTable(text)
    expect(table.cells).toHaveLength(MAX_TABLE_ROWS)
    expect(notice).toBe('Kept 1000 of 2500 rows: a table holds at most 1000 rows.')
    expect(pastedTable('1\t2').notice).toBeNull()
  })

  it('pastes a block into the cells from where it lands', () => {
    const table = { head: ['x', 'y'] as [string, string], cells: [['1', '1'], ['2', '4']] as [string, string][] }
    expect(pasteInto(table, '5\t25\n6\t36', 1, 0).table.cells).toEqual([['1', '1'], ['5', '25'], ['6', '36']])
    expect(pasteInto(table, '7\n8\n9', 0, 1).table.cells).toEqual([['1', '7'], ['2', '8'], ['', '9']])
    expect(pasteInto(table, 't\ts\n0\t0', 0, 0).table.head).toEqual(['t', 's'])
    expect(pasteInto(table, 't\ts\n0\t0', 1, 0).table.head).toEqual(['x', 'y'])
    const near = pasteInto({ head: ['x', 'y'], cells: [] }, '1\t1\n2\t2\n3\t3', MAX_TABLE_ROWS - 2, 0)
    expect(near.table.cells).toHaveLength(MAX_TABLE_ROWS)
    expect(near.notice).toBe('Kept 2 of 3 rows: a table holds at most 1000 rows.')
    expect(trimCells([['1', ''], ['', ''], [' ', '']])).toEqual([['1', '']])
  })

  it('knows a spreadsheet block from an expression', () => {
    expect(looksTabular('1\t2\n3\t4')).toBe(true)
    expect(looksTabular('x;y\n1;2')).toBe(true)
    expect(looksTabular('1\n2\n3')).toBe(true)
    expect(looksTabular('y = x^2')).toBe(false)
    expect(looksTabular('(1, 2)')).toBe(false)
  })

  it('stores tables additively: older files load, tables and their line switch survive a round trip', () => {
    const older = normalizeDocument({ version: 1, sheets: { cartesian: [{ id: 'a', text: 'y = x', color: 'palette:red', hidden: false, from: '', to: '', slider: { min: -10, max: 10, step: 0.1 } }] } })
    expect(older.sheets.cartesian[0].table).toBeUndefined()
    expect(older.sheets.cartesian[0].connect).toBeUndefined()
    const saved = normalizeDocument(JSON.parse(JSON.stringify({ version: 1, sheets: { cartesian: [{ id: 't', text: '', table: { head: ['t', 's'], cells: [['0', '0'], [1, '2,5'], 'bad'] }, connect: true }] } })))
    const row = saved.sheets.cartesian[0]
    expect(row.table).toEqual({ head: ['t', 's'], cells: [['0', '0'], ['1', '2,5'], ['', '']] })
    expect(row.connect).toBe(true)
    // A table with empty text is a filled row: the sheet still ends in one empty row after it.
    expect(saved.sheets.cartesian.map((entry) => Boolean(entry.table))).toEqual([true, false])
    expect(withTrailingRow([{ ...createRow([]), table: createTable() }])).toHaveLength(2)
    const capped = normalizeDocument({ version: 1, sheets: { cartesian: [{ id: 'c', text: '', table: { cells: Array.from({ length: 1200 }, () => ['1', '1']) } }] } })
    expect(capped.sheets.cartesian[0].table?.cells).toHaveLength(MAX_TABLE_ROWS)
    expect(capped.sheets.cartesian[0].table?.head).toEqual(['x', 'y'])
  })
})
