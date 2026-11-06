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
    User(String),
}

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

/// One row: `left = right`, or a bare expression in `right`.
#[derive(Clone, Debug, PartialEq)]
pub struct Statement {
    pub left: Option<Node>,
    pub right: Node,
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
        let statement = if self.eat('=') {
            Statement { left: Some(first), right: self.expr()? }
        } else {
            Statement { left: None, right: first }
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
            Callee::User(_) => (1, 1),
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
}
