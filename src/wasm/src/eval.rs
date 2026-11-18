//! Compiled expressions: variables resolve to slots of one environment array, user functions to indices.
//! A user-function call evaluates its arguments, writes them into the parameters' slots, evaluates the body and
//! restores the slots, so `f(x + 1)` inside a plot of `x` sees the outer `x` again afterwards and `f(y, x)` swaps.

use std::collections::HashMap;
use std::f64::consts::{E, PI, TAU};

use crate::builtins::Builtin;
use crate::calculus;
use crate::error::MathError;
use crate::parser::{BinOp, Callee, Cmp, Cond, Node};

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Num(f64),
    Slot(usize),
    Neg(Box<Expr>),
    Bin(BinOp, Box<Expr>, Box<Expr>),
    Builtin(Builtin, Vec<Expr>),
    User(usize, Vec<Expr>),
    Fact(Box<Expr>),
    /// `f'(u)`: the derivative of the given order of the user function `index` (of one variable) at `arg`.
    Derivative { index: usize, order: usize, arg: Box<Expr> },
    /// `int(g, a, b)`: ∫ₐᵇ `body` over the variable in `slot`.
    Integral { body: Box<Expr>, slot: usize, from: Box<Expr>, to: Box<Expr> },
    /// `sum(n, a, b, g)` or `prod(n, a, b, g)`: Σ or ∏ of `body` with the index in `slot` running over the integers from a to b.
    Series { product: bool, slot: usize, from: Box<Expr>, to: Box<Expr>, body: Box<Expr> },
    /// `{c₁: v₁, c₂: v₂, v}`: the value of the first branch whose condition holds (no condition always holds), else NaN.
    Piecewise(Vec<(Option<Condition>, Expr)>),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Condition {
    Chain(Vec<Expr>, Vec<Cmp>),
    And(Box<Condition>, Box<Condition>),
    Or(Box<Condition>, Box<Condition>),
}

fn compile_condition(condition: &Cond, scope: &Scope) -> Result<Condition, MathError> {
    Ok(match condition {
        Cond::Chain(operands, cmps) => Condition::Chain(operands.iter().map(|operand| compile(operand, scope)).collect::<Result<_, _>>()?, cmps.clone()),
        Cond::And(a, b) => Condition::And(Box::new(compile_condition(a, scope)?), Box::new(compile_condition(b, scope)?)),
        Cond::Or(a, b) => Condition::Or(Box::new(compile_condition(a, scope)?), Box::new(compile_condition(b, scope)?)),
    })
}

/// Whether a condition holds; a comparison with an undefined side does not. A chain stops at its first false link.
pub fn holds(condition: &Condition, env: &mut [f64], functions: &[UserFn]) -> bool {
    match condition {
        Condition::Chain(operands, cmps) => {
            let mut left = eval(&operands[0], env, functions);
            cmps.iter().zip(&operands[1..]).all(|(cmp, operand)| {
                let right = eval(operand, env, functions);
                let result = cmp.holds(left, right);
                left = right;
                result
            })
        }
        Condition::And(a, b) => holds(a, env, functions) && holds(b, env, functions),
        Condition::Or(a, b) => holds(a, env, functions) || holds(b, env, functions),
    }
}

/// The branch of a piecewise function that applies with the current environment.
pub fn branch(branches: &[(Option<Condition>, Expr)], env: &mut [f64], functions: &[UserFn]) -> Option<usize> {
    branches.iter().position(|(condition, _)| condition.as_ref().is_none_or(|condition| holds(condition, env, functions)))
}

/// The most terms one sum or product adds up: a slider pushed to 10⁶ gives an error (constant bounds) or no value
/// (bounds that change along the curve) instead of a frozen graph.
pub const MAX_TERMS: usize = 1000;

/// The integers a sum's index runs over: both bounds rounded to the nearest integer (halves away from zero), then
/// the first index and the number of terms; none when a bound is not finite or there are more than `MAX_TERMS`.
/// A last index below the first is an empty range: 0 terms.
pub fn index_range(from: f64, to: f64) -> Option<(f64, usize)> {
    let (first, last) = (from.round(), to.round());
    if !first.is_finite() || !last.is_finite() {
        return None;
    }
    if last < first {
        return Some((first, 0));
    }
    let count = last - first + 1.0;
    (count <= MAX_TERMS as f64).then_some((first, count as usize))
}

#[derive(Clone, Debug)]
pub struct UserFn {
    /// The slot of each parameter, in order.
    pub slots: Vec<usize>,
    pub body: Expr,
}

pub fn constant(name: &str) -> Option<f64> {
    match name {
        "π" => Some(PI),
        "τ" => Some(TAU),
        "e" => Some(E),
        "∞" => Some(f64::INFINITY),
        _ => None,
    }
}

/// What a compiled expression may name: `slots` for variables it is allowed to read, `functions` for calls (each
/// user function's index and number of parameters).
pub struct Scope<'a> {
    pub slots: &'a HashMap<String, usize>,
    pub functions: &'a HashMap<String, (usize, usize)>,
    pub allow: &'a dyn Fn(&str) -> bool,
}

/// The variables of a double or triple integral, outermost first.
pub const INTEGRAL_AXES: [&str; 3] = ["x", "y", "z"];

/// `node` compiled where the first `axes` variables of integration may be read besides what `scope` allows.
pub fn compile_within(node: &Node, scope: &Scope, axes: usize) -> Result<Expr, MathError> {
    let allow = |name: &str| INTEGRAL_AXES[..axes].contains(&name) || (scope.allow)(name);
    compile(node, &Scope { slots: scope.slots, functions: scope.functions, allow: &allow })
}

pub fn compile(node: &Node, scope: &Scope) -> Result<Expr, MathError> {
    Ok(match node {
        Node::Num(value) => Expr::Num(*value),
        Node::Var(name) => match (constant(name), scope.slots.get(name)) {
            (Some(value), _) => Expr::Num(value),
            (None, Some(slot)) if (scope.allow)(name) => Expr::Slot(*slot),
            _ => return Err(MathError::new("error.unknown", name.clone())),
        },
        Node::Neg(arg) => Expr::Neg(Box::new(compile(arg, scope)?)),
        Node::Bin(op, left, right) => Expr::Bin(*op, Box::new(compile(left, scope)?), Box::new(compile(right, scope)?)),
        Node::Call(Callee::Builtin(builtin), args) => {
            Expr::Builtin(*builtin, args.iter().map(|arg| compile(arg, scope)).collect::<Result<_, _>>()?)
        }
        // `f` alone, inside `int` or `tangent`: f called with x (and y, z for more parameters).
        Node::Call(Callee::User(name), args) if args.is_empty() => match scope.functions.get(name) {
            Some((index, arity)) => Expr::User(*index, reference(scope, *arity)),
            None => return Err(MathError::new("error.unknown", name.clone())),
        },
        Node::Call(Callee::User(name), args) => match scope.functions.get(name) {
            Some((index, arity)) if *arity == args.len() => Expr::User(*index, args.iter().map(|arg| compile(arg, scope)).collect::<Result<_, _>>()?),
            Some(_) => return Err(MathError::new("error.arity", name.clone())),
            None => return Err(MathError::new("error.unknown", name.clone())),
        },
        Node::Call(Callee::Derivative(name, order), args) => match (scope.functions.get(name), args.as_slice()) {
            (Some((index, 1)), []) => Expr::Derivative { index: *index, order: *order, arg: Box::new(reference(scope, 1).remove(0)) },
            (Some((index, 1)), [arg]) => Expr::Derivative { index: *index, order: *order, arg: Box::new(compile(arg, scope)?) },
            (Some((_, 1)), _) => return Err(MathError::new("error.arity", name.clone())),
            _ => return Err(MathError::new("error.derivative", name.clone())),
        },
        Node::Call(Callee::Integral, args) => match args.as_slice() {
            [body, from, to] => {
                let slot = scope.slots.get("x").copied().ok_or_else(|| MathError::new("error.unsupported", ""))?;
                // The integrand's x is its own variable of integration, whatever the row around it may read.
                let inner = Scope { slots: scope.slots, functions: scope.functions, allow: &|name| name == "x" || (scope.allow)(name) };
                Expr::Integral { body: Box::new(compile(body, &inner)?), slot, from: Box::new(compile(from, scope)?), to: Box::new(compile(to, scope)?) }
            }
            // `int(g, a, b, c, d)` and `int(g, a, b, c, d, e, f)`: x runs from a to b outermost, y from c to d (which
            // may read x) inside it and z from e to f (which may read x and y) innermost.
            [body, bounds @ ..] if bounds.len() == 4 || bounds.len() == 6 => {
                let depth = bounds.len() / 2;
                let mut slots = Vec::with_capacity(depth);
                for axis in &INTEGRAL_AXES[..depth] {
                    slots.push(scope.slots.get(*axis).copied().ok_or_else(|| MathError::new("error.unsupported", ""))?);
                }
                let mut expr = compile_within(body, scope, depth)?;
                for level in (0..depth).rev() {
                    let (from, to) = (compile_within(&bounds[2 * level], scope, level)?, compile_within(&bounds[2 * level + 1], scope, level)?);
                    expr = Expr::Integral { body: Box::new(expr), slot: slots[level], from: Box::new(from), to: Box::new(to) };
                }
                expr
            }
            _ => return Err(MathError::new("error.arity", "int")),
        },
        Node::Call(Callee::Tangent, _) => return Err(MathError::new("error.tangentRow", "")),
        Node::Call(callee @ (Callee::Sum | Callee::Product), args) => match args.as_slice() {
            [Node::Var(index), from, to, body] => {
                let slot = match (constant(index), scope.slots.get(index)) {
                    (None, Some(slot)) => *slot,
                    _ => return Err(MathError::new("error.index", index.clone())),
                };
                // The index is the term's own variable, whatever the row around it may read.
                let inner = Scope { slots: scope.slots, functions: scope.functions, allow: &|name| name == index || (scope.allow)(name) };
                Expr::Series {
                    product: *callee == Callee::Product,
                    slot,
                    from: Box::new(compile(from, scope)?),
                    to: Box::new(compile(to, scope)?),
                    body: Box::new(compile(body, &inner)?),
                }
            }
            _ => return Err(MathError::new("error.arity", if *callee == Callee::Sum { "sum" } else { "prod" })),
        },
        Node::Fact(arg) => Expr::Fact(Box::new(compile(arg, scope)?)),
        Node::Tuple(_) => return Err(MathError::new("error.tuple", "")),
        Node::Piecewise(branches) => Expr::Piecewise(
            branches
                .iter()
                .map(|(condition, value)| Ok((condition.as_ref().map(|condition| compile_condition(condition, scope)).transpose()?, compile(value, scope)?)))
                .collect::<Result<_, MathError>>()?,
        ),
    })
}

/// The arguments a function referenced by its name alone is called with: x, then y and z.
fn reference(scope: &Scope, arity: usize) -> Vec<Expr> {
    ["x", "y", "z"].iter().take(arity).map(|name| scope.slots.get(*name).map_or(Expr::Num(f64::NAN), |slot| Expr::Slot(*slot))).collect()
}

pub fn eval(expr: &Expr, env: &mut [f64], functions: &[UserFn]) -> f64 {
    match expr {
        Expr::Num(value) => *value,
        Expr::Slot(slot) => env[*slot],
        Expr::Neg(arg) => -eval(arg, env, functions),
        Expr::Bin(op, left, right) => {
            let a = eval(left, env, functions);
            let b = eval(right, env, functions);
            match op {
                BinOp::Add => a + b,
                BinOp::Sub => a - b,
                BinOp::Mul => a * b,
                BinOp::Div => a / b,
                BinOp::Pow => real_pow(a, b),
            }
        }
        Expr::Builtin(builtin, args) => match args.as_slice() {
            [arg] => builtin.apply1(eval(arg, env, functions)),
            _ => {
                let values: Vec<f64> = args.iter().map(|arg| eval(arg, env, functions)).collect();
                builtin.apply(&values)
            }
        },
        Expr::User(index, args) => {
            let function = &functions[*index];
            if let ([arg], [slot]) = (args.as_slice(), function.slots.as_slice()) {
                let value = eval(arg, env, functions);
                let saved = std::mem::replace(&mut env[*slot], value);
                let result = eval(&function.body, env, functions);
                env[*slot] = saved;
                return result;
            }
            let values: Vec<f64> = args.iter().map(|arg| eval(arg, env, functions)).collect();
            let saved: Vec<f64> = function.slots.iter().zip(&values).map(|(slot, value)| std::mem::replace(&mut env[*slot], *value)).collect();
            let result = eval(&function.body, env, functions);
            for (slot, value) in function.slots.iter().zip(saved).rev() {
                env[*slot] = value;
            }
            result
        }
        Expr::Fact(arg) => factorial(eval(arg, env, functions)),
        Expr::Derivative { index, order, arg } => {
            let at = eval(arg, env, functions);
            calculus::derivative(&functions[*index], *order, at, env, functions)
        }
        Expr::Integral { body, slot, from, to } => {
            let (a, b) = (eval(from, env, functions), eval(to, env, functions));
            calculus::integrate(body, *slot, a, b, env, functions)
        }
        Expr::Series { product, slot, from, to, body } => {
            let Some((first, count)) = index_range(eval(from, env, functions), eval(to, env, functions)) else { return f64::NAN };
            let saved = env[*slot];
            let mut total = if *product { 1.0 } else { 0.0 };
            for k in 0..count {
                env[*slot] = first + k as f64;
                let term = eval(body, env, functions);
                total = if *product { total * term } else { total + term };
            }
            env[*slot] = saved;
            total
        }
        Expr::Piecewise(branches) => match branch(branches, env, functions) {
            Some(index) => eval(&branches[index].1, env, functions),
            None => f64::NAN,
        },
    }
}

/// `powf`, except that a negative base with a rational exponent of odd denominator keeps its real root:
/// `(-8)^(1/3)` is `-2` and `x^(2/3)` is defined left of zero.
pub fn real_pow(base: f64, exponent: f64) -> f64 {
    if base >= 0.0 || base.is_nan() || !exponent.is_finite() || exponent.fract() == 0.0 {
        return base.powf(exponent);
    }
    for denominator in (1..=15).step_by(2) {
        let numerator = exponent * f64::from(denominator);
        let rounded = numerator.round();
        if (numerator - rounded).abs() < 1e-9 {
            let magnitude = (-base).powf(exponent);
            return if rounded.rem_euclid(2.0) == 0.0 { magnitude } else { -magnitude };
        }
    }
    f64::NAN
}

pub fn factorial(n: f64) -> f64 {
    if n.fract() == 0.0 {
        if n < 0.0 {
            return f64::NAN;
        }
        if n <= 170.0 {
            return (2..=n as u32).fold(1.0, |product, k| product * f64::from(k));
        }
        return f64::INFINITY;
    }
    gamma(n + 1.0)
}

/// Lanczos approximation (g = 7, nine coefficients), reflected below one half.
fn gamma(x: f64) -> f64 {
    const COEFFICIENTS: [f64; 9] = [
        0.999_999_999_999_809_9,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];
    if x < 0.5 {
        return PI / ((PI * x).sin() * gamma(1.0 - x));
    }
    let x = x - 1.0;
    let t = x + 7.5;
    let sum = COEFFICIENTS.iter().enumerate().skip(1).fold(COEFFICIENTS[0], |sum, (i, c)| sum + c / (x + i as f64));
    (2.0 * PI).sqrt() * t.powf(x + 0.5) * (-t).exp() * sum
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::tokenize;
    use crate::parser::parse;
    use std::collections::HashSet;

    fn value(source: &str, x: f64) -> f64 {
        let statement = parse(&tokenize(source).unwrap(), &HashSet::new()).unwrap();
        let slots: HashMap<String, usize> = [("x".to_string(), 0)].into();
        let functions = HashMap::new();
        let scope = Scope { slots: &slots, functions: &functions, allow: &|_| true };
        let expr = compile(&statement.right, &scope).unwrap();
        eval(&expr, &mut [x], &[])
    }

    #[test]
    fn arithmetic_and_constants() {
        assert_eq!(value("2x^2 + 1", 3.0), 19.0);
        assert!((value("sin(π/2)", 0.0) - 1.0).abs() < 1e-12);
        assert!((value("2πx", 1.0) - TAU).abs() < 1e-12);
        assert_eq!(value("|x - 5|", 2.0), 3.0);
        assert_eq!(value("1/x", 0.0), f64::INFINITY);
        assert!(value("sqrt(x)", -1.0).is_nan());
    }

    #[test]
    fn real_roots_of_negative_numbers() {
        assert!((real_pow(-8.0, 1.0 / 3.0) + 2.0).abs() < 1e-12);
        assert!((real_pow(-8.0, 2.0 / 3.0) - 4.0).abs() < 1e-12);
        assert!(real_pow(-2.0, 0.5).is_nan());
        assert_eq!(real_pow(-2.0, 3.0), -8.0);
    }

    #[test]
    fn factorials_extend_through_gamma() {
        assert_eq!(factorial(5.0), 120.0);
        assert_eq!(factorial(0.0), 1.0);
        assert!((factorial(0.5) - PI.sqrt() / 2.0).abs() < 1e-10);
        assert!(factorial(-1.0).is_nan());
        assert_eq!(value("3!", 0.0), 6.0);
    }

    #[test]
    fn unknown_names_and_tuples_are_refused() {
        let statement = parse(&tokenize("a x").unwrap(), &HashSet::new()).unwrap();
        let slots: HashMap<String, usize> = [("x".to_string(), 0)].into();
        let functions = HashMap::new();
        let scope = Scope { slots: &slots, functions: &functions, allow: &|_| true };
        assert_eq!(compile(&statement.right, &scope).unwrap_err().key, "error.unknown");
        let tuple = parse(&tokenize("2(1, 2)").unwrap(), &HashSet::new()).unwrap();
        assert_eq!(compile(&tuple.right, &scope).unwrap_err().key, "error.tuple");
    }

    #[test]
    fn forgiving_input_still_evaluates() {
        let close = |source: &str, x: f64, expected: f64| {
            let got = value(source, x);
            assert!((got - expected).abs() < 1e-9, "{source} at {x}: {got} != {expected}");
        };
        close("sin(30°)", 0.0, 0.5);
        close("sin(x", PI / 2.0, 1.0);
        close("(x+1)(x-1", 3.0, 8.0);
        close("|x - 2", 0.0, 2.0);
        close("x^2)", 3.0, 9.0);
        close("x^2))", 3.0, 9.0);
        close("log_2 8", 0.0, 3.0);
        close("log_10(1000)", 0.0, 3.0);
        close("log_e e", 0.0, 1.0);
        close("sqrt x", 9.0, 3.0);
        close("ln x", E, 1.0);
        close("∛x", -8.0, -2.0);
        close("root(x, 3)", 27.0, 3.0);
        close("0,5x", 4.0, 2.0);
        close("x2 + 1", 3.0, 10.0);
        close("e^x", 0.0, 1.0);
        close("x⁻¹", 4.0, 0.25);
        close("2pi", 0.0, TAU);
        close("Sin(x) + PI", 0.0, PI);
        close("2^3^2", 0.0, 512.0);
        close("1/inf", 0.0, 0.0);
        close("cos(180deg)", 0.0, -1.0);
    }
}
