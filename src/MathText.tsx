import { React } from './runtime'
import type { ReactElement, ReactNode } from 'react'

/**
 * Typeset display of a row, as Desmos and GeoGebra show an expression that is not being edited: `x^2/3` as a
 * stacked fraction with a superscript, `sqrt(x)` under a radical, `theta` as θ, `<=` as ≤, function names upright
 * and variables italic. It reads the same forgiving input as the kernel's lexer but never fails: anything it does
 * not understand is shown as typed. The value of a row is always the kernel's; this only draws the text.
 */

type Tok =
  | { t: 'num'; v: string }
  | { t: 'id'; v: string; sub?: string }
  | { t: 'fn'; v: string; sub?: string }
  | { t: 'sup'; v: string }
  | { t: 'op'; v: string }

type MNode =
  | { k: 'num' | 'var' | 'sym'; text: string; sub?: string }
  | { k: 'fn'; text: string; sub?: string; exp?: MNode; arg?: MNode }
  | { k: 'op'; text: string; relation?: boolean; sign?: boolean }
  | { k: 'seq'; items: MNode[] }
  | { k: 'frac'; top: MNode; bottom: MNode }
  | { k: 'pow'; base: MNode; exp: MNode }
  | { k: 'group'; open: string; close: string; closed: boolean; body: MNode }
  | { k: 'root'; body: MNode; index?: MNode }
  | { k: 'post'; base: MNode; text: string }

const FUNCTIONS = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'asin', 'arccos', 'acos', 'arctan', 'atan', 'arccot', 'acot',
  'sinh', 'cosh', 'tanh', 'coth', 'arsinh', 'arcsinh', 'asinh', 'arcosh', 'arccosh', 'acosh', 'artanh', 'arctanh', 'atanh',
  'sqrt', 'cbrt', 'abs', 'sign', 'sgn', 'ln', 'log', 'lg', 'exp', 'floor', 'ceil', 'round', 'min', 'max', 'mod', 'root',
  'nthroot', 'real', 'imag', 'conj', 'arg'
]
const GREEK: Record<string, string> = {
  epsilon: 'ε', lambda: 'λ', alpha: 'α', gamma: 'γ', delta: 'δ', omega: 'ω', sigma: 'σ', theta: 'θ', beta: 'β', phi: 'φ', rho: 'ρ', tau: 'τ', mu: 'μ', pi: 'π'
}
const WORDS: [string, Tok][] = [
  ...FUNCTIONS.map((word): [string, Tok] => [word, { t: 'fn', v: word }]),
  ...Object.entries(GREEK).map(([word, letter]): [string, Tok] => [word, { t: 'id', v: letter }]),
  ['infinity', { t: 'id', v: '∞' }],
  ['inf', { t: 'id', v: '∞' }],
  ['deg', { t: 'op', v: '°' }]
]
const SUPERSCRIPTS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' }
const DISPLAY_FN: Record<string, string> = { real: 'Re', imag: 'Im', sgn: 'sign', lg: 'log', asin: 'sin⁻¹', acos: 'cos⁻¹', atan: 'tan⁻¹', nthroot: 'root' }
const RELATIONS = new Set(['=', '<', '>', '≤', '≥', '≔'])
const OPERATORS: Record<string, string> = { '-': '−', '−': '−', '+': '+', '*': '·', '×': '·', '·': '·', '⋅': '·', '∗': '·', '<=': '≤', '>=': '≥', '⩽': '≤', '⩾': '≥', ':=': '≔' }

const isLetter = (c: string): boolean => /[A-Za-zΑ-ω]/.test(c)

function splitWord(letters: string, tokens: Tok[]): void {
  let at = 0
  while (at < letters.length) {
    const rest = letters.slice(at).toLowerCase()
    let best: [number, Tok] | null = null
    for (const [word, token] of WORDS) {
      if (rest.startsWith(word) && (!best || word.length > best[0])) best = [word.length, token]
    }
    if (best) {
      tokens.push({ ...best[1] })
      at += best[0]
    } else {
      tokens.push({ t: 'id', v: letters[at] })
      at += 1
    }
  }
}

export function tokenizeMath(source: string): Tok[] {
  const tokens: Tok[] = []
  let depth = 0
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (/\s/.test(c)) { i++; continue }
    if (/\d/.test(c) || (c === '.' && /\d/.test(source[i + 1] ?? ''))) {
      let j = i
      while (/\d/.test(source[j] ?? '')) j++
      if (source[j] === '.' || (source[j] === ',' && depth === 0 && /\d/.test(source[j + 1] ?? ''))) {
        j++
        while (/\d/.test(source[j] ?? '')) j++
      }
      tokens.push({ t: 'num', v: source.slice(i, j) })
      i = j
      continue
    }
    if (isLetter(c)) {
      let j = i
      while (j < source.length && isLetter(source[j])) j++
      const run = source.slice(i, j)
      if (run === 'Re') tokens.push({ t: 'fn', v: 'real' })
      else if (run === 'Im') tokens.push({ t: 'fn', v: 'imag' })
      else splitWord(run, tokens)
      i = j
      if (source[i] === '_') {
        const braced = source[i + 1] === '{'
        let k = i + (braced ? 2 : 1)
        const start = k
        while (/[A-Za-z0-9]/.test(source[k] ?? '')) k++
        const last = tokens[tokens.length - 1]
        if (k > start && (last.t === 'id' || last.t === 'fn')) {
          last.sub = source.slice(start, k)
          i = braced && source[k] === '}' ? k + 1 : k
        }
      }
      continue
    }
    if (c in SUPERSCRIPTS) {
      let j = i
      let text = ''
      while (source[j] in SUPERSCRIPTS) text += SUPERSCRIPTS[source[j++]]
      tokens.push({ t: 'sup', v: text })
      i = j
      continue
    }
    const pair = source.slice(i, i + 2)
    if (pair === '<=' || pair === '>=' || pair === ':=') {
      tokens.push({ t: 'op', v: pair })
      i += 2
      continue
    }
    if (c === '(' || c === '[') depth++
    if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    tokens.push({ t: 'op', v: c === '∞' ? '∞' : c })
    i++
  }
  return tokens
}

class Parser {
  private at = 0
  private bars = 0
  constructor(private readonly tokens: Tok[]) {}

  private peek(offset = 0): Tok | undefined { return this.tokens[this.at + offset] }
  private isOp(value: string): boolean { const token = this.peek(); return token?.t === 'op' && token.v === value }

  parse(): MNode {
    const items: MNode[] = []
    while (this.at < this.tokens.length) {
      items.push(this.list())
      // A stray closing bracket or bar is shown as typed and reading continues.
      if (this.at < this.tokens.length) items.push({ k: 'sym', text: (this.tokens[this.at++] as { v: string }).v })
    }
    return seq(items)
  }

  private list(): MNode {
    const items = [this.relation()]
    while (this.isOp(',')) {
      this.at++
      items.push({ k: 'op', text: ',' }, this.relation())
    }
    return seq(items)
  }

  private relation(): MNode {
    const items = [this.sum()]
    for (;;) {
      const token = this.peek()
      if (token?.t !== 'op') break
      const text = OPERATORS[token.v] ?? token.v
      if (!RELATIONS.has(text)) break
      this.at++
      items.push({ k: 'op', text, relation: true }, this.sum())
    }
    return seq(items)
  }

  private sum(): MNode {
    const items: MNode[] = [this.product()]
    while (this.isOp('+') || this.isOp('-') || this.isOp('−')) {
      const text = OPERATORS[(this.tokens[this.at++] as { v: string }).v]
      items.push({ k: 'op', text }, this.product())
    }
    return seq(items)
  }

  /** Juxtaposed factors form a run; `/` puts the run so far over the next factor, as Desmos does while typing. */
  private product(): MNode {
    const items: MNode[] = []
    let run: MNode[] = [this.unary()]
    for (;;) {
      const token = this.peek()
      if (token?.t === 'op' && ['*', '×', '·', '⋅', '∗'].includes(token.v)) {
        this.at++
        items.push(seq(run), { k: 'op', text: '·' })
        run = [this.unary()]
      } else if (token?.t === 'op' && (token.v === '/' || token.v === '÷')) {
        this.at++
        run = [{ k: 'frac', top: this.ungroup(seq(run)), bottom: this.ungroup(this.unary()) }]
      } else if (this.startsFactor()) {
        run.push(this.power())
      } else {
        break
      }
    }
    items.push(seq(run))
    return seq(items)
  }

  private startsFactor(): boolean {
    const token = this.peek()
    if (!token) return false
    if (token.t === 'num' || token.t === 'id' || token.t === 'fn') return true
    return token.t === 'op' && (['(', '[', '√', '∛', '∞'].includes(token.v) || (token.v === '|' && this.bars === 0))
  }

  private unary(): MNode {
    if (this.isOp('-') || this.isOp('−') || this.isOp('+')) {
      const sign = OPERATORS[(this.tokens[this.at++] as { v: string }).v]
      return seq([{ k: 'op', text: sign === '+' ? '+' : '−', sign: true }, this.unary()])
    }
    return this.power()
  }

  private power(): MNode {
    const base = this.postfix()
    if (this.isOp('^')) {
      this.at++
      return { k: 'pow', base, exp: this.exponent() }
    }
    return base
  }

  private exponent(): MNode {
    if (this.isOp('-') || this.isOp('−')) {
      this.at++
      return seq([{ k: 'op', text: '−', sign: true }, this.exponent()])
    }
    return this.ungroup(this.power())
  }

  /** `x^(n+1)` and `a/(b+c)` drop the brackets the layout already shows. */
  private ungroup(node: MNode): MNode {
    return node.k === 'group' && node.open === '(' ? node.body : node
  }

  private postfix(): MNode {
    let node = this.primary()
    for (;;) {
      const token = this.peek()
      if (token?.t === 'sup') {
        this.at++
        node = { k: 'pow', base: node, exp: { k: 'num', text: token.v.replace('-', '−') } }
      } else if (token?.t === 'op' && ['!', '°', "'"].includes(token.v)) {
        this.at++
        node = { k: 'post', base: node, text: token.v }
      } else {
        return node
      }
    }
  }

  private group(open: string, close: string): MNode {
    const body = this.isOp(close) ? seq([]) : this.list()
    const closed = this.isOp(close)
    if (closed) this.at++
    return { k: 'group', open, close, closed, body }
  }

  private primary(): MNode {
    const token = this.peek()
    if (!token) return seq([])
    this.at++
    switch (token.t) {
      case 'num': return { k: 'num', text: token.v }
      case 'id': return { k: token.v === 'π' || token.v === '∞' ? 'sym' : 'var', text: token.v, sub: token.sub }
      case 'fn': return this.call(token)
      case 'sup': return { k: 'num', text: token.v }
      case 'op':
        if (token.v === '(') return this.group('(', ')')
        if (token.v === '[') return this.group('[', ']')
        if (token.v === '|') {
          this.bars++
          const body = this.isOp('|') ? seq([]) : this.sum()
          this.bars--
          const closed = this.isOp('|')
          if (closed) this.at++
          return { k: 'group', open: '|', close: '|', closed, body }
        }
        if (token.v === '√') return { k: 'root', body: this.ungroup(this.power()) }
        if (token.v === '∛') return { k: 'root', body: this.ungroup(this.power()), index: { k: 'num', text: '3' } }
        if (token.v === '∞') return { k: 'sym', text: '∞' }
        return { k: 'sym', text: OPERATORS[token.v] ?? token.v }
    }
  }

  private call(token: Extract<Tok, { t: 'fn' }>): MNode {
    const exp = this.isOp('^') ? (this.at++, this.exponent()) : undefined
    const paren = this.isOp('(')
    const arg = paren ? (this.at++, this.group('(', ')')) : this.startsFactor() ? this.power() : undefined
    const inner = arg && arg.k === 'group' ? arg : null
    const args = inner ? splitArgs(inner.body) : []
    switch (token.v) {
      case 'sqrt': if (arg) return { k: 'root', body: inner ? inner.body : arg }; break
      case 'cbrt': if (arg) return { k: 'root', body: inner ? inner.body : arg, index: { k: 'num', text: '3' } }; break
      case 'root':
      case 'nthroot': if (args.length === 2) return { k: 'root', body: args[0], index: args[1] }; break
      case 'abs': if (inner) return { k: 'group', open: '|', close: '|', closed: inner.closed, body: inner.body }; break
    }
    return { k: 'fn', text: DISPLAY_FN[token.v] ?? token.v, sub: token.sub, exp, arg }
  }
}

function seq(items: MNode[]): MNode {
  const flat = items.flatMap((item) => (item.k === 'seq' ? item.items : [item]))
  return flat.length === 1 ? flat[0] : { k: 'seq', items: flat }
}

/** The arguments of `root(a, n)`, split at its top-level commas. */
function splitArgs(body: MNode): MNode[] {
  const items = body.k === 'seq' ? body.items : [body]
  const args: MNode[][] = [[]]
  for (const item of items) {
    if (item.k === 'op' && item.text === ',') args.push([])
    else args[args.length - 1].push(item)
  }
  return args.map(seq)
}

const tall = (node: MNode): boolean => {
  switch (node.k) {
    case 'frac': return true
    case 'seq': return node.items.some(tall)
    case 'pow': return tall(node.base)
    case 'group': return tall(node.body)
    case 'root': return tall(node.body)
    case 'post': return tall(node.base)
    case 'fn': return node.arg ? tall(node.arg) : false
    default: return false
  }
}

function render(node: MNode, key: string | number = 0): ReactNode {
  switch (node.k) {
    case 'num': return <span key={key} className="gm-num">{node.text}</span>
    case 'sym': return <span key={key} className="gm-sym">{node.text}</span>
    case 'var':
      return <span key={key} className="gm-var">{node.text}{node.sub ? <sub className="gm-sub">{node.sub}</sub> : null}</span>
    case 'op':
      return <span key={key} className={node.relation ? 'gm-op gm-rel' : node.sign ? 'gm-sign' : node.text === ',' ? 'gm-comma' : 'gm-op'}>{node.text}</span>
    case 'seq': return <React.Fragment key={key}>{node.items.map((item, index) => render(item, index))}</React.Fragment>
    case 'frac':
      return (
        <span key={key} className="gm-frac">
          <span className="gm-frac-top">{render(node.top)}</span>
          <span className="gm-frac-bottom">{render(node.bottom)}</span>
        </span>
      )
    case 'pow': return <span key={key} className="gm-pow">{render(node.base)}<sup className="gm-sup">{render(node.exp)}</sup></span>
    case 'group': {
      const big = tall(node.body) ? ' gm-paren-tall' : ''
      return (
        <span key={key} className="gm-group">
          <span className={`gm-paren${big}`}>{node.open}</span>
          {render(node.body)}
          <span className={`gm-paren${big}${node.closed ? '' : ' gm-ghost'}`}>{node.close}</span>
        </span>
      )
    }
    case 'root':
      return (
        <span key={key} className="gm-root">
          {node.index ? <sup className="gm-root-index">{render(node.index)}</sup> : null}
          <span className="gm-radical">√</span>
          <span className="gm-radicand">{render(node.body)}</span>
        </span>
      )
    case 'post': return <span key={key}>{render(node.base)}<span className="gm-sym">{node.text}</span></span>
    case 'fn':
      return (
        <span key={key} className="gm-call">
          <span className="gm-fn">{node.text}{node.sub ? <sub className="gm-sub">{node.sub}</sub> : null}</span>
          {node.exp ? <sup className="gm-sup">{render(node.exp)}</sup> : null}
          {node.arg ? (node.arg.k === 'group' ? render(node.arg) : <span className="gm-fn-arg">{render(node.arg)}</span>) : null}
        </span>
      )
  }
}

export function parseMath(source: string): MNode {
  return new Parser(tokenizeMath(source)).parse()
}

export const MathText = ({ text }: { text: string }): ReactElement => {
  const node = React.useMemo(() => {
    try {
      return parseMath(text)
    } catch {
      return { k: 'sym', text } as MNode
    }
  }, [text])
  return <span className="gm-math" aria-hidden>{render(node)}</span>
}
