/** Tables of points: reading text pasted from a spreadsheet and the numbers typed into a table's cells. */

/** The most rows a table keeps (the kernel's `MAX_TABLE_ROWS`); a longer paste keeps the first ones and says so. */
export const MAX_TABLE_ROWS = 1000

export type Cells = [x: string, y: string][]

export interface PastedTable {
  /** The column names when the first line was a header (text over numbers). */
  head: [string, string] | null
  cells: Cells
  /** Data lines in the paste, before the cap. */
  total: number
  /** A single column: read as y values at x = 1, 2, 3 … */
  single: boolean
  /** Columns after the second were left out. */
  extra: boolean
}

const MINUS = /[−‒–]/g
/** Digit group marks: spaces (also no-break and thin), apostrophes as in 1'000. */
const GROUPS = /[\s   '’]/g

/**
 * A cell as the kernel reads it: a number written with a decimal comma (`1,5`, `-0,25`, `1.234,5`, `1'234.5`, `1 234,5`)
 * becomes `1.5`, `-0.25`, `1234.5` (and `1,5E-3` `1.5*10^(-3)`); anything else (an expression such as `π/2` or `2a`) is left as typed.
 */
export function cellText(text: string): string {
  const trimmed = text.trim().replace(MINUS, '-')
  const compact = trimmed.replace(GROUPS, '')
  if (!/^[+-]?[\d.,]*\d[\d.,]*(e[+-]?\d+)?$/i.test(compact)) return trimmed
  const [mantissa, exponent = ''] = compact.split(/(?=e)/i)
  const comma = mantissa.lastIndexOf(',')
  const dot = mantissa.lastIndexOf('.')
  let number = mantissa
  if (comma >= 0 && dot >= 0) number = comma > dot ? mantissa.replace(/\./g, '').replace(',', '.') : mantissa.replace(/,/g, '')
  else if (comma >= 0) number = mantissa.split(',').length > 2 ? mantissa.replace(/,/g, '') : mantissa.replace(',', '.')
  else if (mantissa.split('.').length > 2) number = mantissa.replace(/\./g, '')
  // The parser reads e as Euler's number, so a spreadsheet's 1.5E-3 becomes 1.5*10^(-3).
  return exponent ? `${number}*10^(${exponent.slice(1)})` : number
}

/** Whether a field reads as a plain number once its decimal comma is normalised. */
export function isNumber(text: string): boolean {
  const value = cellText(text)
  return value !== '' && Number.isFinite(Number(value))
}

const unquote = (field: string): string => {
  const trimmed = field.trim()
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/""/g, '"').trim() : trimmed
}

/** Text that looks like a block copied from a spreadsheet: several lines, or one line split by a tab or semicolon. */
export function looksTabular(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim())
  if (!lines.length) return false
  if (lines.length === 1) return /[\t;]/.test(lines[0])
  return lines.every((line) => line.split(/[\t;,]|\s+/).filter(Boolean).every(isNumber) || /[\t;]/.test(line))
}

/**
 * Splits pasted text into rows of two cells. Fields are separated by tabs (what a spreadsheet copies), else by
 * semicolons, else by commas (then decimals use points), else by spaces; blank lines are skipped. A first line with text
 * where the next has numbers is a header and names the columns. One column gives y values at x = 1, 2, 3 …
 */
export function parseTable(text: string, limit = MAX_TABLE_ROWS): PastedTable {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim())
  const separator = lines.some((line) => line.includes('\t')) ? '\t' : lines.some((line) => line.includes(';')) ? ';' : lines.some((line) => line.includes(',')) ? ',' : null
  const rows = lines.map((line) => (separator ? line.split(separator) : line.trim().split(/\s+/)).map(unquote))
  let head: [string, string] | null = null
  const numeric = (row: string[]): boolean => row.slice(0, 2).every((field) => !field || isNumber(field)) && row.slice(0, 2).some(Boolean)
  if (rows.length > 1 && rows[0].slice(0, 2).some((field) => field && !isNumber(field)) && rows.slice(1).every(numeric)) {
    const [x = '', y = ''] = rows.shift() ?? []
    head = [x, y]
  }
  const width = rows.reduce((most, row) => Math.max(most, row.reduce((last, field, index) => (field ? index + 1 : last), 0)), 0)
  const single = width === 1
  const kept = rows.slice(0, limit)
  const cells: Cells = kept.map((row, index) => (single ? [String(index + 1), cellText(row[0] ?? '')] : [cellText(row[0] ?? ''), cellText(row[1] ?? '')]))
  if (single && head) head = ['', head[0]]
  return { head, cells, total: rows.length, single, extra: width > 2 }
}
