//! Recursive-descent parser from tokens to an expression tree. Juxtaposition multiplies (`2x`, `x(x+1)`),
//! `|x|` is `abs(x)`, a function may omit its parentheses (`sin 2x` is `sin(2x)`), and `sin^2 x` / `sin^-1 x`
//! read as a power of the call and as the inverse function. It forgives what people type while thinking:
//! parentheses and bars left open at the end close themselves, stray closing parentheses at the end are
//! dropped, `30°` is in degrees and `log_2 x` takes its base from the subscript.

use std::collections::HashSet;
use std::f64::consts::PI;

use crate::builtins::Builtin;
use crate::error::MathError;
use crate::lexer::Tok;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Callee {
    Builtin(Builtin),
    /// A user function; without arguments, inside `int` or `tangent`, a reference to the function itself (`int(f, 0, 1)`).
    User(String),
    /// `f'(x)`, `f''(x)`: the derivative of the given order of a user function of one variable.
    Derivative(String, usize),
    /// `int(g, a, b)`: the integral of `g` (an expression in x, or a function) from a to b.
    Integral,
    /// `tangent(g, a)`: the tangent line at x = a; `tangent(g, a, b)` the tangent plane at (a, b) in 3D.
    Tangent,
    /// `sum(n, a, b, g)`: Σ of `g` for the index n from a to b; its first argument is the index, a plain name.
    Sum,
    /// `prod(n, a, b, g)`: ∏ of `g` for the index n from a to b.
    Product,
}

/// The most primes a derivative takes: `f‴(x)`.
pub const MAX_PRIMES: usize = 3;

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Num(f64),
    Var(String),
    Neg(Box<Node>),
    Bin(BinOp, Box<Node>, Box<Node>),
    Call(Callee, Vec<Node>),
    Fact(Box<Node>),
    Tuple(Vec<Node>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Relation {
    Eq,
    Lt,
    Le,
    Gt,
    Ge,
}

impl Relation {
    pub fn strict(self) -> bool {
        matches!(self, Self::Lt | Self::Gt)
    }
}

/// One row: `left = right` (or `<`, `≤`, `>`, `≥`), or a bare expression in `right`.
#[derive(Clone, Debug, PartialEq)]
pub struct Statement {
    pub left: Option<Node>,
    pub right: Node,
    pub relation: Relation,
}

fn bin(op: BinOp, left: Node, right: Node) -> Node {
    Node::Bin(op, Box::new(left), Box::new(right))
}

fn describe(token: &Tok) -> String {
    match token {
        Tok::Num(value) => value.to_string(),
        Tok::Ident(name) => name.clone(),
        Tok::Op(op) => op.to_string(),
    }
}

/// `functions` names the user functions defined on the sheet, so `f(x)` calls `f` instead of multiplying.
pub fn parse(tokens: &[Tok], functions: &HashSet<String>) -> Result<Statement, MathError> {
    Parser { tokens, pos: 0, bars: 0, functions }.statement()
}

struct Parser<'a> {
    tokens: &'a [Tok],
    pos: usize,
    /// Open `|` bars: inside one, a `|` closes it instead of starting a new factor.
    bars: usize,
    functions: &'a HashSet<String>,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&Tok> {
        self.tokens.get(self.pos)
    }

    fn is_op(&self, op: char) -> bool {
        matches!(self.peek(), Some(Tok::Op(found)) if *found == op)
    }

    fn eat(&mut self, op: char) -> bool {
        let found = self.is_op(op);
        if found {
            self.pos += 1;
        }
        found
    }

    fn unexpected(&self) -> MathError {
        match self.peek() {
            None => MathError::new("error.incomplete", ""),
            Some(token) => MathError::new("error.unexpected", describe(token)),
        }
    }

    fn expect(&mut self, op: char) -> Result<(), MathError> {
        if self.eat(op) { Ok(()) } else { Err(self.unexpected()) }
    }

    /// A closing parenthesis or bar, or the end of the row, which closes everything still open.
    fn close(&mut self, op: char) -> Result<(), MathError> {
        if self.peek().is_none() { Ok(()) } else { self.expect(op) }
    }

    /// Whether the tokens before `end` close more parentheses than they open.
    fn unbalanced(&self, end: usize) -> bool {
        self.tokens[..end].iter().fold(0_i32, |depth, token| match token {
            Tok::Op('(') => depth + 1,
            Tok::Op(')') => depth - 1,
            _ => depth,
        }) < 0
    }

    fn is_function(&self, name: &str) -> bool {
        Builtin::lookup(name).is_some() || self.functions.contains(name)
    }

    fn statement(&mut self) -> Result<Statement, MathError> {
        let mut end = self.tokens.len();
        while end > 0 && self.tokens[end - 1] == Tok::Op(')') && self.unbalanced(end) {
            end -= 1;
        }
        let tokens = self.tokens;
        self.tokens = &tokens[..end];
        let first = self.expr()?;
        let relation = [('=', Relation::Eq), ('<', Relation::Lt), ('≤', Relation::Le), ('>', Relation::Gt), ('≥', Relation::Ge)]
            .into_iter()
            .find(|(op, _)| self.eat(*op))
            .map(|(_, relation)| relation);
        let statement = match relation {
            Some(relation) => Statement { left: Some(first), right: self.expr()?, relation },
            None => Statement { left: None, right: first, relation: Relation::Eq },
        };
        if self.peek().is_some() {
            return Err(self.unexpected());
        }
        Ok(statement)
    }

    fn expr(&mut self) -> Result<Node, MathError> {
        let mut node = self.term()?;
        loop {
            if self.eat('+') {
                node = bin(BinOp::Add, node, self.term()?);
            } else if self.eat('-') {
                node = bin(BinOp::Sub, node, self.term()?);
            } else {
                return Ok(node);
            }
        }
    }

    fn term(&mut self) -> Result<Node, MathError> {
        let mut node = self.unary()?;
        loop {
            if self.eat('*') {
                node = bin(BinOp::Mul, node, self.unary()?);
            } else if self.eat('/') {
                node = bin(BinOp::Div, node, self.unary()?);
            } else if self.starts_factor() {
                node = bin(BinOp::Mul, node, self.power()?);
            } else {
                return Ok(node);
            }
        }
    }

    fn starts_factor(&self) -> bool {
        match self.peek() {
            Some(Tok::Num(_) | Tok::Ident(_) | Tok::Op('(' | '√')) => true,
            Some(Tok::Op('|')) => self.bars == 0,
            _ => false,
        }
    }

    fn unary(&mut self) -> Result<Node, MathError> {
        if self.eat('-') {
            return Ok(Node::Neg(Box::new(self.unary()?)));
        }
        if self.eat('+') {
            return self.unary();
        }
        self.power()
    }

    fn power(&mut self) -> Result<Node, MathError> {
        let base = self.postfix()?;
        if self.eat('^') {
            return Ok(bin(BinOp::Pow, base, self.unary()?));
        }
        Ok(base)
    }

    fn postfix(&mut self) -> Result<Node, MathError> {
        let mut node = self.primary()?;
        loop {
            if self.eat('!') {
                node = Node::Fact(Box::new(node));
            } else if self.eat('°') {
                node = bin(BinOp::Mul, node, Node::Num(PI / 180.0));
            } else {
                return Ok(node);
            }
        }
    }

    fn primary(&mut self) -> Result<Node, MathError> {
        let Some(token) = self.peek().cloned() else {
            return Err(MathError::new("error.incomplete", ""));
        };
        self.pos += 1;
        match token {
            Tok::Num(value) => Ok(Node::Num(value)),
            Tok::Ident(name) => {
                match name.as_str() {
                    "int" | "integral" => return self.special(Callee::Integral, &name, 3, 3),
                    "tangent" => return self.special(Callee::Tangent, &name, 2, 3),
                    "sum" => return self.series(Callee::Sum, &name),
                    "prod" | "product" => return self.series(Callee::Product, &name),
                    _ => {}
                }
                let primes = self.primes();
                if primes > 0 {
                    if !self.functions.contains(&name) {
                        return Err(MathError::new("error.derivative", name));
                    }
                    if primes > MAX_PRIMES {
                        return Err(MathError::new("error.prime", name));
                    }
                    self.pos += primes;
                    return self.call(Callee::Derivative(name.clone(), primes), &name);
                }
                if let Some(builtin) = Builtin::lookup(&name) {
                    return self.call(Callee::Builtin(builtin), &name);
                }
                if self.functions.contains(&name) && self.is_op('(') {
                    return self.call(Callee::User(name.clone()), &name);
                }
                if let Some(base) = name.strip_prefix("log_").and_then(log_base) {
                    return self.logarithm(base, &name);
                }
                Ok(Node::Var(name))
            }
            Tok::Op('(') => {
                let mut items = self.group()?;
                Ok(if items.len() == 1 { items.remove(0) } else { Node::Tuple(items) })
            }
            Tok::Op('|') => {
                self.bars += 1;
                let inner = self.expr()?;
                self.close('|')?;
                self.bars -= 1;
                Ok(Node::Call(Callee::Builtin(Builtin::Abs), vec![inner]))
            }
            Tok::Op('√') => Ok(Node::Call(Callee::Builtin(Builtin::Sqrt), vec![self.postfix()?])),
            Tok::Op('∛') => Ok(Node::Call(Callee::Builtin(Builtin::Cbrt), vec![self.postfix()?])),
            Tok::Op(_) => {
                self.pos -= 1;
                Err(self.unexpected())
            }
        }
    }

    /// The primes written right after the current position, not consumed.
    fn primes(&self) -> usize {
        self.tokens[self.pos..].iter().take_while(|token| **token == Tok::Op('\'')).count()
    }

    /// `int(g, a, b)` or `tangent(g, a)`: the first argument is an expression or the name of a user function, with
    /// primes for its derivative (`int(f', 0, 1)`), which becomes a call without arguments.
    fn special(&mut self, callee: Callee, name: &str, min: usize, max: usize) -> Result<Node, MathError> {
        if !self.eat('(') {
            return Err(MathError::new("error.arity", name));
        }
        let bars = std::mem::replace(&mut self.bars, 0);
        let first = match self.peek().cloned() {
            Some(Tok::Ident(function)) if self.functions.contains(&function) => {
                let primes = self.tokens[self.pos + 1..].iter().take_while(|token| **token == Tok::Op('\'')).count();
                if matches!(self.tokens.get(self.pos + 1 + primes), Some(Tok::Op(',' | ')')) | None) {
                    if primes > MAX_PRIMES {
                        return Err(MathError::new("error.prime", function));
                    }
                    self.pos += 1 + primes;
                    Node::Call(if primes > 0 { Callee::Derivative(function, primes) } else { Callee::User(function) }, Vec::new())
                } else {
                    self.expr()?
                }
            }
            _ => self.expr()?,
        };
        let mut args = vec![first];
        while self.eat(',') {
            args.push(self.expr()?);
        }
        self.close(')')?;
        self.bars = bars;
        if args.len() < min || args.len() > max {
            return Err(MathError::new("error.arity", name));
        }
        Ok(Node::Call(callee, args))
    }

    /// `sum(n, a, b, g)` or `prod(n, a, b, g)`: index, first and last value of the index, then the term.
    fn series(&mut self, callee: Callee, name: &str) -> Result<Node, MathError> {
        if !self.eat('(') {
            return Err(MathError::new("error.arity", name));
        }
        let args = self.group()?;
        if args.len() != 4 {
            return Err(MathError::new("error.arity", name));
        }
        if !matches!(args[0], Node::Var(_)) {
            return Err(MathError::new("error.index", ""));
        }
        Ok(Node::Call(callee, args))
    }

    /// After an opening parenthesis: comma-separated expressions up to the closing one.
    fn group(&mut self) -> Result<Vec<Node>, MathError> {
        let bars = std::mem::replace(&mut self.bars, 0);
        let mut items = vec![self.expr()?];
        while self.eat(',') {
            items.push(self.expr()?);
        }
        self.close(')')?;
        self.bars = bars;
        Ok(items)
    }

    fn call(&mut self, callee: Callee, name: &str) -> Result<Node, MathError> {
        let exponent = if matches!(callee, Callee::Builtin(_)) && self.eat('^') { Some(self.exponent()?) } else { None };
        let args = if self.eat('(') { self.group()? } else { vec![self.argument()?] };
        let (min, max) = match &callee {
            Callee::Builtin(builtin) => builtin.arity(),
            Callee::User(_) | Callee::Derivative(..) => (1, 3),
            Callee::Integral | Callee::Tangent | Callee::Sum | Callee::Product => (0, 0),
        };
        if args.len() < min || args.len() > max {
            return Err(MathError::new("error.arity", name));
        }
        Ok(match (exponent, &callee) {
            (Some(Node::Neg(inner)), Callee::Builtin(builtin)) if *inner == Node::Num(1.0) && builtin.inverse().is_some() => {
                Node::Call(Callee::Builtin(builtin.inverse().unwrap_or(*builtin)), args)
            }
            (Some(exponent), _) => bin(BinOp::Pow, Node::Call(callee, args), exponent),
            (None, _) => Node::Call(callee, args),
        })
    }

    /// `log_b x` as `ln x / ln b`.
    fn logarithm(&mut self, base: f64, name: &str) -> Result<Node, MathError> {
        let mut args = if self.eat('(') { self.group()? } else { vec![self.argument()?] };
        if args.len() != 1 {
            return Err(MathError::new("error.arity", name));
        }
        let ln = Node::Call(Callee::Builtin(Builtin::Ln), vec![args.remove(0)]);
        Ok(bin(BinOp::Div, ln, Node::Num(base.ln())))
    }

    /// The exponent written between a function name and its argument: a number, a variable or a group.
    fn exponent(&mut self) -> Result<Node, MathError> {
        if self.eat('-') {
            return Ok(Node::Neg(Box::new(self.exponent()?)));
        }
        match self.peek().cloned() {
            Some(Tok::Num(value)) => {
                self.pos += 1;
                Ok(Node::Num(value))
            }
            Some(Tok::Op('(')) => {
                self.pos += 1;
                let mut items = self.group()?;
                if items.len() != 1 {
                    return Err(MathError::new("error.tuple", ""));
                }
                Ok(items.remove(0))
            }
            Some(Tok::Ident(name)) if !self.is_function(&name) => {
                self.pos += 1;
                Ok(Node::Var(name))
            }
            _ => Err(self.unexpected()),
        }
    }

    /// The argument of a function written without parentheses: `sin 2x` is `sin(2x)`, `sin x cos x` two calls.
    fn argument(&mut self) -> Result<Node, MathError> {
        let mut node = self.power()?;
        loop {
            let more = match self.peek() {
                Some(Tok::Num(_) | Tok::Op('(')) => true,
                Some(Tok::Ident(name)) => !self.is_function(name),
                _ => false,
            };
            if !more {
                return Ok(node);
            }
            node = bin(BinOp::Mul, node, self.power()?);
        }
    }
}

/// The base in `log_2`, `log_10` or `log_e`.
fn log_base(text: &str) -> Option<f64> {
    if text.eq_ignore_ascii_case("e") {
        return Some(std::f64::consts::E);
    }
    text.parse::<f64>().ok().filter(|base| *base > 0.0 && *base != 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::tokenize;

    fn read(source: &str) -> Statement {
        let functions: HashSet<String> = ["f".to_string()].into();
        parse(&tokenize(source).unwrap(), &functions).unwrap()
    }

    fn var(name: &str) -> Node {
        Node::Var(name.into())
    }

    fn call(builtin: Builtin, arg: Node) -> Node {
        Node::Call(Callee::Builtin(builtin), vec![arg])
    }

    #[test]
    fn precedence_and_implicit_products() {
        assert_eq!(read("2x^2").right, bin(BinOp::Mul, Node::Num(2.0), bin(BinOp::Pow, var("x"), Node::Num(2.0))));
        assert_eq!(read("-x^2").right, Node::Neg(Box::new(bin(BinOp::Pow, var("x"), Node::Num(2.0)))));
        assert_eq!(read("2^3^2").right, bin(BinOp::Pow, Node::Num(2.0), bin(BinOp::Pow, Node::Num(3.0), Node::Num(2.0))));
        assert_eq!(read("x(x+1)").right, bin(BinOp::Mul, var("x"), bin(BinOp::Add, var("x"), Node::Num(1.0))));
        assert_eq!(read("1 - 2 - 3").right, bin(BinOp::Sub, bin(BinOp::Sub, Node::Num(1.0), Node::Num(2.0)), Node::Num(3.0)));
    }

    #[test]
    fn functions_without_parentheses_and_powers() {
        assert_eq!(read("sin 2x").right, call(Builtin::Sin, bin(BinOp::Mul, Node::Num(2.0), var("x"))));
        assert_eq!(read("sin x cos x").right, bin(BinOp::Mul, call(Builtin::Sin, var("x")), call(Builtin::Cos, var("x"))));
        assert_eq!(read("sin^2 x").right, bin(BinOp::Pow, call(Builtin::Sin, var("x")), Node::Num(2.0)));
        assert_eq!(read("sin^-1(x)").right, call(Builtin::Asin, var("x")));
    }

    #[test]
    fn bars_tuples_and_user_functions() {
        assert_eq!(read("|x|").right, call(Builtin::Abs, var("x")));
        assert_eq!(read("|x||y|").right, bin(BinOp::Mul, call(Builtin::Abs, var("x")), call(Builtin::Abs, var("y"))));
        assert_eq!(read("(1, 2)").right, Node::Tuple(vec![Node::Num(1.0), Node::Num(2.0)]));
        let definition = read("f(x) = x^2");
        assert_eq!(definition.left, Some(Node::Call(Callee::User("f".into()), vec![var("x")])));
        assert_eq!(read("g(x)").right, bin(BinOp::Mul, var("g"), var("x")));
    }

    #[test]
    fn malformed_rows_name_their_problem() {
        let fail = |source: &str| parse(&tokenize(source).unwrap(), &HashSet::new()).unwrap_err().key;
        assert_eq!(fail("2 +"), "error.incomplete");
        assert_eq!(fail(")x"), "error.unexpected");
        assert_eq!(fail("(x))(y"), "error.unexpected");
        assert_eq!(fail("mod(1)"), "error.arity");
        assert_eq!(fail("x = 1 = 2"), "error.unexpected");
    }

    #[test]
    fn derivatives_integrals_and_tangents() {
        let derivative = |name: &str, order: usize, arg: Node| Node::Call(Callee::Derivative(name.into(), order), vec![arg]);
        assert_eq!(read("f'(x)").right, derivative("f", 1, var("x")));
        assert_eq!(read("f''(2x) + 1").right, bin(BinOp::Add, derivative("f", 2, bin(BinOp::Mul, Node::Num(2.0), var("x"))), Node::Num(1.0)));
        assert_eq!(read("f‴ x").right, derivative("f", 3, var("x")));
        let reference = |callee: Callee| Node::Call(callee, Vec::new());
        assert_eq!(read("int(f, 0, 1)").right, Node::Call(Callee::Integral, vec![reference(Callee::User("f".into())), Node::Num(0.0), Node::Num(1.0)]));
        assert_eq!(read("∫(f', a, b)").right, Node::Call(Callee::Integral, vec![reference(Callee::Derivative("f".into(), 1)), var("a"), var("b")]));
        assert_eq!(read("integral(x^2, 0, 1").right, Node::Call(Callee::Integral, vec![bin(BinOp::Pow, var("x"), Node::Num(2.0)), Node::Num(0.0), Node::Num(1.0)]));
        assert_eq!(read("int(f(x)^2, 0, 1)").right, Node::Call(Callee::Integral, vec![bin(BinOp::Pow, Node::Call(Callee::User("f".into()), vec![var("x")]), Node::Num(2.0)), Node::Num(0.0), Node::Num(1.0)]));
        assert_eq!(read("tangent(f, a)").right, Node::Call(Callee::Tangent, vec![reference(Callee::User("f".into())), var("a")]));
        assert_eq!(read("tangent(f, a, b)").right, Node::Call(Callee::Tangent, vec![reference(Callee::User("f".into())), var("a"), var("b")]));
        let fail = |source: &str| parse(&tokenize(source).unwrap(), &["f".to_string()].into()).unwrap_err();
        assert_eq!(fail("g'(x)").key, "error.derivative");
        assert_eq!(fail("sin'(x)").key, "error.derivative");
        assert_eq!(fail("f''''(x)").key, "error.prime");
        assert_eq!(fail("int(f, 1)").key, "error.arity");
        assert_eq!(fail("tangent(f)").key, "error.arity");
        assert_eq!(fail("int x").key, "error.arity");
    }

    #[test]
    fn sums_and_products_take_index_bounds_and_term() {
        let series = |callee: Callee, args: Vec<Node>| Node::Call(callee, args);
        let term = bin(BinOp::Div, bin(BinOp::Pow, var("x"), var("n")), Node::Fact(Box::new(var("n"))));
        assert_eq!(read("sum(n, 0, N, x^n / n!)").right, series(Callee::Sum, vec![var("n"), Node::Num(0.0), var("N"), term.clone()]));
        assert_eq!(read("Σ(n, 0, N, x^n / n!").right, series(Callee::Sum, vec![var("n"), Node::Num(0.0), var("N"), term]));
        assert_eq!(read("2prod(k, 1, 3, k)").right, bin(BinOp::Mul, Node::Num(2.0), series(Callee::Product, vec![var("k"), Node::Num(1.0), Node::Num(3.0), var("k")])));
        assert_eq!(read("∏(k, 1, m + 1, k)").right, series(Callee::Product, vec![var("k"), Node::Num(1.0), bin(BinOp::Add, var("m"), Node::Num(1.0)), var("k")]));
        let fail = |source: &str| parse(&tokenize(source).unwrap(), &HashSet::new()).unwrap_err().key;
        assert_eq!(fail("sum(n, 0, 3)"), "error.arity");
        assert_eq!(fail("sum n"), "error.arity");
        assert_eq!(fail("sum(2n, 0, 3, n)"), "error.index");
    }
}
