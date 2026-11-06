//! One sheet of rows, analysed together: parameters (`a = 2`) and user functions (`f(x) = …`) are defined
//! once and resolved in dependency order, then every other row is classified by the variables it uses and
//! compiled against those definitions. The complex sheet evaluates definitions and relations in ℂ.

use std::cell::Cell;
use std::collections::hash_map::Entry;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::f64::consts::TAU;

use crate::complex::{self, C64, CExpr, CUserFn};
use crate::error::MathError;
use crate::eval::{Expr, Scope, UserFn, compile, constant, eval};
use crate::lexer::{Tok, tokenize};
use crate::parser::{BinOp, Callee, Node, Relation, Statement, parse};

pub const X: usize = 0;
pub const Y: usize = 1;
pub const T: usize = 2;
pub const THETA: usize = 3;
pub const Z: usize = 4;
const RESERVED: [&str; 6] = ["x", "y", "z", "t", "θ", "r"];
/// On the complex sheet `r`, `t` and θ are ordinary names (as in `r e^(iθ)`) and `i` is the imaginary unit.
const RESERVED_COMPLEX: [&str; 4] = ["x", "y", "z", "i"];

thread_local! {
    /// Set by `analyze` for the sheet being read.
    static COMPLEX_NAMES: Cell<bool> = const { Cell::new(false) };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Cartesian,
    Trig,
    Polar,
    Parametric,
    Space,
    Complex,
}

impl Mode {
    pub fn from_index(index: u32) -> Self {
        match index {
            1 => Self::Trig,
            2 => Self::Polar,
            3 => Self::Parametric,
            4 => Self::Space,
            5 => Self::Complex,
            _ => Self::Cartesian,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RowInput {
    pub text: String,
    /// Start and end of the parameter range of a polar or parametric row; empty means 0 and 2π.
    pub from: String,
    pub to: String,
    pub hidden: bool,
}

#[derive(Clone, Debug)]
pub enum Plot {
    /// `y = f(x)`.
    FunctionX(Expr),
    /// `x = g(y)`.
    FunctionY(Expr),
    Polar { r: Expr, from: f64, to: f64 },
    Curve { x: Expr, y: Expr, from: f64, to: f64 },
    Point { x: f64, y: f64 },
    /// `F(x, y) = 0`; on the complex sheet `F(z) = 0`.
    Implicit(Field),
    /// Where the field is negative (`<`, `≤`) or positive (`>`, `≥`); the boundary is drawn too.
    Region { field: Field, relation: Relation },
    /// A complex number on the complex sheet, with the name it was defined under.
    ComplexPoint { re: f64, im: f64, name: String },
    /// `z = f(x, y)`, `x = f(y, z)` or `y = f(x, z)`: `axis` is the one the expression gives.
    Surface { expr: Expr, axis: Axis3 },
    Curve3 { x: Expr, y: Expr, z: Expr, from: f64, to: f64 },
    Point3 { x: f64, y: f64, z: f64 },
}

/// `left - right` of a relation over the plane: real in `x` and `y`, or complex in `z`, which counts only where
/// it is real.
#[derive(Clone, Debug)]
pub enum Field {
    Real(Expr),
    Complex(CExpr),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Axis3 {
    X,
    Y,
    Z,
}

impl Axis3 {
    pub fn name(self) -> &'static str {
        match self {
            Self::X => "x",
            Self::Y => "y",
            Self::Z => "z",
        }
    }

    /// The two axes a surface along this one is a function of.
    pub fn over(self) -> [&'static str; 2] {
        match self {
            Self::X => ["y", "z"],
            Self::Y => ["x", "z"],
            Self::Z => ["x", "y"],
        }
    }
}

#[derive(Clone, Debug)]
pub enum Outcome {
    Empty,
    Error(MathError),
    Parameter { name: String, value: f64, slider: bool },
    Value(f64),
    /// A user function that is not drawn (its parameter is not `x`).
    Definition { name: String },
    Plotted(Plot),
}

#[derive(Clone, Debug)]
pub struct Row {
    pub outcome: Outcome,
    pub hidden: bool,
}

impl Row {
    pub fn plot(&self) -> Option<&Plot> {
        match &self.outcome {
            Outcome::Plotted(plot) => Some(plot),
            _ => None,
        }
    }
}

pub struct Sheet {
    pub env: Vec<f64>,
    pub functions: Vec<UserFn>,
    pub cenv: Vec<C64>,
    pub cfunctions: Vec<CUserFn>,
    pub rows: Vec<Row>,
}

fn is_reserved(name: &str) -> bool {
    if COMPLEX_NAMES.with(Cell::get) { RESERVED_COMPLEX.contains(&name) } else { RESERVED.contains(&name) }
}

/// Free of the plane's variables; the imaginary unit is a constant.
fn plane_free(node: &Node) -> bool {
    variables(node).iter().all(|name| name == "i")
}

fn is_var(node: &Node, name: &str) -> bool {
    matches!(node, Node::Var(found) if found == name)
}

fn collect(node: &Node, names: &mut BTreeSet<String>, calls: &mut BTreeSet<String>) {
    match node {
        Node::Num(_) => {}
        Node::Var(name) => {
            if constant(name).is_none() {
                names.insert(name.clone());
            }
        }
        Node::Neg(arg) | Node::Fact(arg) => collect(arg, names, calls),
        Node::Bin(_, left, right) => {
            collect(left, names, calls);
            collect(right, names, calls);
        }
        Node::Call(callee, args) => {
            if let Callee::User(name) = callee {
                calls.insert(name.clone());
            }
            args.iter().for_each(|arg| collect(arg, names, calls));
        }
        Node::Tuple(items) => items.iter().for_each(|item| collect(item, names, calls)),
    }
}

/// The reserved variables a node reads.
fn variables(node: &Node) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    collect(node, &mut names, &mut BTreeSet::new());
    names.into_iter().filter(|name| is_reserved(name)).collect()
}

fn uses(node: &Node, name: &str) -> bool {
    variables(node).contains(name)
}

fn only(node: &Node, allowed: &[&str]) -> bool {
    variables(node).iter().all(|name| allowed.contains(&name.as_str()))
}

fn rename(node: &mut Node, from: &str, to: &str) {
    match node {
        Node::Num(_) => {}
        Node::Var(name) => {
            if name == from {
                *name = to.to_string();
            }
        }
        Node::Neg(arg) | Node::Fact(arg) => rename(arg, from, to),
        Node::Bin(_, left, right) => {
            rename(left, from, to);
            rename(right, from, to);
        }
        Node::Call(_, args) | Node::Tuple(args) => args.iter_mut().for_each(|arg| rename(arg, from, to)),
    }
}

/// The name a row of the shape `f(v) = …` defines.
fn defined_function(tokens: &[Tok]) -> Option<String> {
    match tokens {
        [Tok::Ident(name), Tok::Op('('), Tok::Ident(param), Tok::Op(')'), Tok::Op('='), ..]
            if !is_reserved(name) && constant(name).is_none() && crate::builtins::Builtin::lookup(name).is_none()
                && name.chars().next().is_some_and(char::is_alphabetic)
                && name.split('_').next().is_some_and(|stem| stem.chars().count() == 1)
                && constant(param).is_none() =>
        {
            Some(name.clone())
        }
        _ => None,
    }
}

enum Definition {
    Parameter(usize),
    Function { row: usize, param: String },
}

enum Resolution {
    Visiting,
    Done,
    Failed,
}

struct Analysis<'a> {
    statements: &'a [Option<Result<Statement, MathError>>],
    definitions: HashMap<String, Definition>,
    duplicates: HashSet<String>,
    slots: HashMap<String, usize>,
    function_index: HashMap<String, usize>,
    env: Vec<f64>,
    functions: Vec<UserFn>,
    complex: bool,
    cenv: Vec<C64>,
    cfunctions: Vec<CUserFn>,
    state: HashMap<String, Resolution>,
    errors: HashMap<String, MathError>,
}

impl Analysis<'_> {
    fn statement(&self, row: usize) -> &Statement {
        match &self.statements[row] {
            Some(Ok(statement)) => statement,
            _ => unreachable!("definitions come from parsed rows"),
        }
    }

    /// Resolves every definition `node` depends on; undefined names are reported together as missing.
    fn require(&mut self, nodes: &[&Node], own: &[&str]) -> Result<(), MathError> {
        let mut names = BTreeSet::new();
        let mut calls = BTreeSet::new();
        for node in nodes {
            collect(node, &mut names, &mut calls);
        }
        let mut missing = Vec::new();
        for name in names.iter().chain(calls.iter()) {
            if own.contains(&name.as_str()) || is_reserved(name) {
                continue;
            }
            if self.duplicates.contains(name) {
                return Err(MathError::new("error.dependency", name.clone()));
            }
            if self.definitions.contains_key(name) {
                self.resolve(name).map_err(|error| {
                    if error.key == "error.cycle" { error } else { MathError::new("error.dependency", name.clone()) }
                })?;
            } else {
                missing.push(name.clone());
            }
        }
        if let Some(first) = missing.first() {
            let mut error = MathError::new("error.unknown", first.clone());
            error.missing = missing;
            return Err(error);
        }
        Ok(())
    }

    fn resolve(&mut self, name: &str) -> Result<(), MathError> {
        match self.state.get(name) {
            Some(Resolution::Done) => return Ok(()),
            Some(Resolution::Failed) => return Err(self.errors[name].clone()),
            Some(Resolution::Visiting) => return Err(MathError::new("error.cycle", name)),
            None => {}
        }
        self.state.insert(name.to_string(), Resolution::Visiting);
        let result = self.define(name);
        match &result {
            Ok(()) => {
                self.state.insert(name.to_string(), Resolution::Done);
            }
            Err(error) => {
                self.state.insert(name.to_string(), Resolution::Failed);
                self.errors.insert(name.to_string(), error.clone());
            }
        }
        result
    }

    fn define(&mut self, name: &str) -> Result<(), MathError> {
        let (row, param) = match &self.definitions[name] {
            Definition::Parameter(row) => (*row, None),
            Definition::Function { row, param } => (*row, Some(param.clone())),
        };
        if self.complex {
            let body = self.statement(row).right.clone();
            let own: Vec<&str> = param.iter().map(String::as_str).collect();
            self.require(&[&body], &own)?;
            match param {
                None => {
                    let value = self.constant_c(&body)?;
                    let slot = self.slots[name];
                    self.cenv[slot] = value;
                    self.env[slot] = if value.is_real() { value.re } else { f64::NAN };
                }
                Some(param) => {
                    let allowed = param.clone();
                    let expr = self.compile_c(&body, &move |name| name == allowed || !is_reserved(name))?;
                    let index = self.function_index[name];
                    self.cfunctions[index] = CUserFn { slot: self.slots[&param], body: expr };
                }
            }
            return Ok(());
        }
        match param {
            None => {
                let right = self.statement(row).right.clone();
                self.require(&[&right], &[])?;
                let expr = self.compile(&right, &|name| !is_reserved(name))?;
                let value = eval(&expr, &mut self.env, &self.functions);
                self.env[self.slots[name]] = value;
            }
            Some(param) => {
                let body = self.statement(row).right.clone();
                self.require(&[&body], &[param.as_str()])?;
                let allowed = param.clone();
                let expr = self.compile(&body, &move |name| name == allowed || !is_reserved(name))?;
                let index = self.function_index[name];
                self.functions[index] = UserFn { slot: self.slots[&param], body: expr };
            }
        }
        Ok(())
    }

    fn compile(&self, node: &Node, allow: &dyn Fn(&str) -> bool) -> Result<Expr, MathError> {
        compile(node, &Scope { slots: &self.slots, functions: &self.function_index, allow })
    }

    fn compile_c(&self, node: &Node, allow: &dyn Fn(&str) -> bool) -> Result<CExpr, MathError> {
        complex::compile(node, &Scope { slots: &self.slots, functions: &self.function_index, allow })
    }

    /// A constant complex expression evaluated with the sheet's definitions.
    fn constant_c(&mut self, node: &Node) -> Result<C64, MathError> {
        self.require(&[node], &[])?;
        let expr = self.compile_c(node, &|name| !is_reserved(name))?;
        Ok(complex::eval(&expr, &mut self.cenv, &self.cfunctions))
    }

    /// A constant expression (a point coordinate, a range bound) evaluated with the sheet's parameters.
    fn constant(&mut self, node: &Node) -> Result<f64, MathError> {
        self.require(&[node], &[])?;
        let expr = self.compile(node, &|name| !is_reserved(name))?;
        Ok(eval(&expr, &mut self.env, &self.functions))
    }

    fn range(&mut self, input: &RowInput) -> Result<(f64, f64), MathError> {
        let bound = |analysis: &mut Self, text: &str, fallback: f64| -> Result<f64, MathError> {
            if text.trim().is_empty() {
                return Ok(fallback);
            }
            let statement = tokenize(text).and_then(|tokens| parse(&tokens, &HashSet::new()))?;
            if statement.left.is_some() {
                return Err(MathError::new("error.unexpected", "="));
            }
            analysis.constant(&statement.right)
        };
        let from = bound(self, &input.from, 0.0)?;
        let to = bound(self, &input.to, TAU)?;
        if !from.is_finite() || !to.is_finite() || from == to {
            return Err(MathError::new("error.range", ""));
        }
        Ok((from, to))
    }

    fn plot(&mut self, mode: Mode, row: usize, input: &RowInput) -> Result<Outcome, MathError> {
        let statement = self.statement(row).clone();
        let mut nodes = vec![&statement.right];
        if let Some(left) = &statement.left {
            nodes.push(left);
        }
        self.require(&nodes, &[])?;
        if mode == Mode::Complex {
            return self.plot_complex(&statement);
        }
        if mode == Mode::Space {
            return self.plot_space(&statement, input);
        }
        if let (Some(left), right) = (&statement.left, &statement.right)
            && statement.relation != Relation::Eq
        {
            let planar = only(left, &["x", "y"]) && only(right, &["x", "y"]) && !(variables(left).is_empty() && variables(right).is_empty());
            if !planar || !matches!(mode, Mode::Cartesian | Mode::Trig) {
                return Err(MathError::new("error.unsupported", ""));
            }
            let difference = Node::Bin(BinOp::Sub, Box::new(left.clone()), Box::new(right.clone()));
            let field = Field::Real(self.compile(&difference, &|name| name == "x" || name == "y" || !is_reserved(name))?);
            return Ok(Outcome::Plotted(Plot::Region { field, relation: statement.relation }));
        }
        let function = |analysis: &Self, node: &Node, variable: &'static str| -> Result<Expr, MathError> {
            analysis.compile(node, &move |name| name == variable || !is_reserved(name))
        };
        let plot = match (&statement.left, &statement.right) {
            (None, Node::Tuple(items)) => match items.as_slice() {
                [x, y] if only(x, &["t"]) && only(y, &["t"]) && (uses(x, "t") || uses(y, "t")) => {
                    let (from, to) = self.range(input)?;
                    Plot::Curve { x: function(self, x, "t")?, y: function(self, y, "t")?, from, to }
                }
                [x, y] if variables(x).is_empty() && variables(y).is_empty() => {
                    Plot::Point { x: self.constant(x)?, y: self.constant(y)? }
                }
                [_, _] => return Err(MathError::new("error.pair", "")),
                _ => return Err(MathError::new("error.tuple", "")),
            },
            (None, expr) => {
                let used = variables(expr);
                if used.is_empty() {
                    return Ok(Outcome::Value(self.constant(expr)?));
                }
                if only(expr, &["x"]) {
                    Plot::FunctionX(function(self, expr, "x")?)
                } else if only(expr, &["θ"]) {
                    let (from, to) = self.range(input)?;
                    Plot::Polar { r: function(self, expr, "θ")?, from, to }
                } else if mode == Mode::Parametric && only(expr, &["t"]) {
                    return Err(MathError::new("error.pair", ""));
                } else {
                    return Err(MathError::new("error.unsupported", ""));
                }
            }
            (Some(left), right) => {
                if let Node::Var(name) = left
                    && constant(name).is_some()
                {
                    return Err(MathError::new("error.reserved", name.clone()));
                }
                if is_var(left, "y") && only(right, &["x"]) {
                    Plot::FunctionX(function(self, right, "x")?)
                } else if is_var(right, "y") && only(left, &["x"]) {
                    Plot::FunctionX(function(self, left, "x")?)
                } else if is_var(left, "x") && only(right, &["y"]) {
                    Plot::FunctionY(function(self, right, "y")?)
                } else if is_var(right, "x") && only(left, &["y"]) {
                    Plot::FunctionY(function(self, left, "y")?)
                } else if (is_var(left, "r") && only(right, &["θ"])) || (is_var(right, "r") && only(left, &["θ"])) {
                    let expr = if is_var(left, "r") { right } else { left };
                    let (from, to) = self.range(input)?;
                    Plot::Polar { r: function(self, expr, "θ")?, from, to }
                } else if only(left, &["x", "y"]) && only(right, &["x", "y"]) && !(variables(left).is_empty() && variables(right).is_empty()) {
                    let difference = Node::Bin(BinOp::Sub, Box::new(left.clone()), Box::new(right.clone()));
                    Plot::Implicit(Field::Real(self.compile(&difference, &|name| name == "x" || name == "y" || !is_reserved(name))?))
                } else {
                    return Err(MathError::new("error.unsupported", ""));
                }
            }
        };
        Ok(Outcome::Plotted(plot))
    }

    /// Rows of the complex sheet: numbers in any notation become points, relations in `z` (or its parts `x`
    /// and `y`) become curves (`=`) or shaded regions.
    fn plot_complex(&mut self, statement: &Statement) -> Result<Outcome, MathError> {
        let point = |value: C64| Outcome::Plotted(Plot::ComplexPoint { re: value.re, im: if value.is_real() { 0.0 } else { value.im }, name: String::new() });
        match (&statement.left, &statement.right) {
            (None, Node::Tuple(items)) => match items.as_slice() {
                [re, im] if plane_free(re) && plane_free(im) => {
                    let (re, im) = (self.constant_c(re)?, self.constant_c(im)?);
                    if re.is_real() && im.is_real() { Ok(point(C64::new(re.re, im.re))) } else { Err(MathError::new("error.unsupported", "")) }
                }
                _ => Err(MathError::new("error.tuple", "")),
            },
            (None, expr) if plane_free(expr) => Ok(point(self.constant_c(expr)?)),
            (None, _) => Err(MathError::new("error.relation", "")),
            (Some(left), right) => {
                if let Node::Var(name) = left
                    && (constant(name).is_some() || name == "i")
                {
                    return Err(MathError::new("error.reserved", name.clone()));
                }
                if statement.relation == Relation::Eq && is_var(left, "z") && plane_free(right) {
                    return Ok(point(self.constant_c(right)?));
                }
                if plane_free(left) && plane_free(right) {
                    return Err(MathError::new("error.unsupported", ""));
                }
                let difference = Node::Bin(BinOp::Sub, Box::new(left.clone()), Box::new(right.clone()));
                let field = Field::Complex(self.compile_c(&difference, &|name| !is_reserved(name) || matches!(name, "x" | "y" | "z"))?);
                Ok(Outcome::Plotted(if statement.relation == Relation::Eq { Plot::Implicit(field) } else { Plot::Region { field, relation: statement.relation } }))
            }
        }
    }

    /// Rows of a 3D sheet: surfaces over two axes, space curves and points.
    fn plot_space(&mut self, statement: &Statement, input: &RowInput) -> Result<Outcome, MathError> {
        if statement.relation != Relation::Eq {
            return Err(MathError::new("error.unsupported", ""));
        }
        let over = |analysis: &Self, node: &Node, axes: [&'static str; 2]| -> Result<Expr, MathError> {
            analysis.compile(node, &move |name| axes.contains(&name) || !is_reserved(name))
        };
        let surface = |analysis: &Self, node: &Node, axis: Axis3| -> Result<Outcome, MathError> {
            Ok(Outcome::Plotted(Plot::Surface { expr: over(analysis, node, axis.over())?, axis }))
        };
        match (&statement.left, &statement.right) {
            (None, Node::Tuple(items)) => match items.as_slice() {
                [x, y, z] if [x, y, z].iter().all(|item| only(item, &["t"])) && [x, y, z].iter().any(|item| uses(item, "t")) => {
                    let (from, to) = self.range(input)?;
                    let along = |analysis: &Self, node: &Node| analysis.compile(node, &|name| name == "t" || !is_reserved(name));
                    Ok(Outcome::Plotted(Plot::Curve3 { x: along(self, x)?, y: along(self, y)?, z: along(self, z)?, from, to }))
                }
                [x, y, z] if [x, y, z].iter().all(|item| variables(item).is_empty()) => {
                    Ok(Outcome::Plotted(Plot::Point3 { x: self.constant(x)?, y: self.constant(y)?, z: self.constant(z)? }))
                }
                _ => Err(MathError::new("error.triple", "")),
            },
            (None, expr) => {
                if variables(expr).is_empty() {
                    Ok(Outcome::Value(self.constant(expr)?))
                } else if only(expr, &["x", "y"]) {
                    surface(self, expr, Axis3::Z)
                } else {
                    Err(MathError::new("error.unsupported", ""))
                }
            }
            (Some(left), right) => {
                if let Node::Var(name) = left
                    && constant(name).is_some()
                {
                    return Err(MathError::new("error.reserved", name.clone()));
                }
                for axis in [Axis3::Z, Axis3::X, Axis3::Y] {
                    if is_var(left, axis.name()) && only(right, &axis.over()) {
                        return surface(self, right, axis);
                    }
                    if is_var(right, axis.name()) && only(left, &axis.over()) {
                        return surface(self, left, axis);
                    }
                }
                Err(MathError::new("error.unsupported", ""))
            }
        }
    }
}

pub fn analyze(mode: Mode, inputs: &[RowInput]) -> Sheet {
    COMPLEX_NAMES.with(|flag| flag.set(mode == Mode::Complex));
    let tokens: Vec<Option<Result<Vec<Tok>, MathError>>> =
        inputs.iter().map(|input| (!input.text.trim().is_empty()).then(|| tokenize(&input.text))).collect();
    let user_functions: HashSet<String> = tokens.iter().flatten().flatten().filter_map(|tokens| defined_function(tokens)).collect();
    let statements: Vec<Option<Result<Statement, MathError>>> = tokens
        .into_iter()
        .map(|tokens| {
            tokens.map(|tokens| {
                tokens.and_then(|tokens| parse(&tokens, &user_functions)).map(|mut statement| {
                    // In polar coordinates `t` is a second spelling of θ, except in a parametric pair.
                    if mode == Mode::Polar && !matches!(statement.right, Node::Tuple(_)) {
                        rename(&mut statement.right, "t", "θ");
                        if let Some(left) = statement.left.as_mut() {
                            rename(left, "t", "θ");
                        }
                    }
                    statement
                })
            })
        })
        .collect();

    let mut definitions = HashMap::new();
    let mut duplicates = HashSet::new();
    let mut definition_rows = HashMap::new();
    for (row, statement) in statements.iter().enumerate() {
        let Some(Ok(statement)) = statement else { continue };
        let definition = match &statement.left {
            Some(Node::Var(name)) if statement.relation == Relation::Eq && !is_reserved(name) && constant(name).is_none() && plane_free(&statement.right) => {
                Some((name.clone(), Definition::Parameter(row)))
            }
            Some(Node::Call(Callee::User(name), args)) if statement.relation == Relation::Eq => match args.as_slice() {
                [Node::Var(param)] => Some((name.clone(), Definition::Function { row, param: param.clone() })),
                _ => None,
            },
            _ => None,
        };
        if let Some((name, definition)) = definition {
            definition_rows.insert(row, name.clone());
            if definitions.insert(name.clone(), definition).is_some() {
                duplicates.insert(name);
            }
        }
    }
    for name in &duplicates {
        definitions.remove(name);
    }

    let mut slots: HashMap<String, usize> = [("x", X), ("y", Y), ("t", T), ("θ", THETA), ("z", Z)].map(|(name, slot)| (name.to_string(), slot)).into();
    let mut env = vec![0.0; 5];
    let mut cenv = vec![C64::real(0.0); 5];
    let mut cfunctions = Vec::new();
    let mut function_index = HashMap::new();
    let mut functions = Vec::new();
    let mut names: Vec<&String> = definitions.keys().collect();
    names.sort();
    for name in names {
        let param = match &definitions[name] {
            Definition::Parameter(_) => name.clone(),
            Definition::Function { param, .. } => {
                function_index.insert(name.clone(), functions.len());
                functions.push(UserFn { slot: 0, body: Expr::Num(f64::NAN) });
                cfunctions.push(CUserFn { slot: 0, body: CExpr::Num(C64::NAN) });
                param.clone()
            }
        };
        if let Entry::Vacant(entry) = slots.entry(param) {
            entry.insert(env.len());
            env.push(f64::NAN);
            cenv.push(C64::NAN);
        }
    }

    let mut analysis = Analysis {
        statements: &statements,
        definitions,
        duplicates,
        slots,
        function_index,
        env,
        functions,
        complex: mode == Mode::Complex,
        cenv,
        cfunctions,
        state: HashMap::new(),
        errors: HashMap::new(),
    };
    let mut rows = Vec::with_capacity(inputs.len());
    for (row, input) in inputs.iter().enumerate() {
        let outcome = match (&statements[row], definition_rows.get(&row)) {
            (None, _) => Outcome::Empty,
            (Some(Err(error)), _) => Outcome::Error(error.clone()),
            (Some(Ok(_)), Some(name)) if analysis.duplicates.contains(name) => Outcome::Error(MathError::new("error.duplicate", name.clone())),
            (Some(Ok(statement)), Some(name)) => match analysis.resolve(name) {
                Err(error) => Outcome::Error(error),
                Ok(()) => match &analysis.definitions[name] {
                    Definition::Parameter(_) if analysis.complex && !analysis.cenv[analysis.slots[name]].is_real() => {
                        let value = analysis.cenv[analysis.slots[name]];
                        Outcome::Plotted(Plot::ComplexPoint { re: value.re, im: value.im, name: name.clone() })
                    }
                    Definition::Parameter(_) => Outcome::Parameter {
                        name: name.clone(),
                        value: analysis.env[analysis.slots[name]],
                        slider: match &statement.right {
                            Node::Num(_) => true,
                            Node::Neg(inner) => matches!(**inner, Node::Num(_)),
                            _ => false,
                        },
                    },
                    Definition::Function { param, .. } if param == "x" && !analysis.complex => {
                        let index = analysis.function_index[name];
                        Outcome::Plotted(Plot::FunctionX(analysis.functions[index].body.clone()))
                    }
                    Definition::Function { .. } => Outcome::Definition { name: name.clone() },
                },
            },
            (Some(Ok(_)), None) => analysis.plot(mode, row, input).unwrap_or_else(Outcome::Error),
        };
        rows.push(Row { outcome, hidden: input.hidden });
    }
    Sheet { env: analysis.env, functions: analysis.functions, cenv: analysis.cenv, cfunctions: analysis.cfunctions, rows }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheet(mode: Mode, texts: &[&str]) -> Sheet {
        let inputs: Vec<RowInput> = texts.iter().map(|text| RowInput { text: text.to_string(), ..RowInput::default() }).collect();
        analyze(mode, &inputs)
    }

    fn at(sheet: &mut Sheet, row: usize, slot: usize, value: f64) -> f64 {
        let expr = match sheet.rows[row].plot() {
            Some(Plot::FunctionX(expr) | Plot::FunctionY(expr) | Plot::Implicit(Field::Real(expr))) => expr.clone(),
            Some(Plot::Polar { r, .. }) => r.clone(),
            other => panic!("row {row} is not a function: {other:?}"),
        };
        sheet.env[slot] = value;
        eval(&expr, &mut sheet.env, &sheet.functions)
    }

    fn error(sheet: &Sheet, row: usize) -> &MathError {
        match &sheet.rows[row].outcome {
            Outcome::Error(error) => error,
            other => panic!("row {row} has no error: {other:?}"),
        }
    }

    #[test]
    fn functions_of_x_in_three_spellings() {
        let mut sheet = sheet(Mode::Cartesian, &["x^2", "y = 2x + 1", "f(x) = 3x", "x = y^2", ""]);
        assert_eq!(at(&mut sheet, 0, X, 3.0), 9.0);
        assert_eq!(at(&mut sheet, 1, X, 3.0), 7.0);
        assert_eq!(at(&mut sheet, 2, X, 3.0), 9.0);
        assert!(matches!(sheet.rows[3].plot(), Some(Plot::FunctionY(_))));
        assert_eq!(at(&mut sheet, 3, Y, 2.0), 4.0);
        assert!(matches!(sheet.rows[4].outcome, Outcome::Empty));
    }

    #[test]
    fn parameters_feed_functions_in_any_order() {
        let mut sheet = sheet(Mode::Cartesian, &["y = a x + b", "a = 2", "b = a + 1", "g(u) = u^2 + a", "g(x) - 1"]);
        assert_eq!(at(&mut sheet, 0, X, 1.0), 5.0);
        assert!(matches!(&sheet.rows[1].outcome, Outcome::Parameter { name, value, slider: true } if name == "a" && *value == 2.0));
        assert!(matches!(&sheet.rows[2].outcome, Outcome::Parameter { value, slider: false, .. } if *value == 3.0));
        assert!(matches!(&sheet.rows[3].outcome, Outcome::Definition { name } if name == "g"));
        assert_eq!(at(&mut sheet, 4, X, 3.0), 10.0);
    }

    #[test]
    fn undefined_duplicate_and_circular_names() {
        let sheet = sheet(Mode::Cartesian, &["y = k x + m", "c = 1", "c = 2", "p = q", "q = p + 1", "y = c x"]);
        assert_eq!(error(&sheet, 0).key, "error.unknown");
        assert_eq!(error(&sheet, 0).missing, ["k", "m"]);
        assert_eq!(error(&sheet, 1).key, "error.duplicate");
        assert_eq!(error(&sheet, 2).key, "error.duplicate");
        assert_eq!(error(&sheet, 3).key, "error.cycle");
        assert_eq!(error(&sheet, 5).key, "error.dependency");
    }

    #[test]
    fn values_points_curves_and_implicit_equations() {
        let mut sheet = sheet(Mode::Cartesian, &["2 + 3", "(1, a)", "a = 4", "(cos t, sin t)", "x^2 + y^2 = 1", "(x, 1)", "e = 3"]);
        assert!(matches!(sheet.rows[0].outcome, Outcome::Value(value) if value == 5.0));
        assert!(matches!(sheet.rows[1].plot(), Some(Plot::Point { x, y }) if *x == 1.0 && *y == 4.0));
        assert!(matches!(sheet.rows[3].plot(), Some(Plot::Curve { from, to, .. }) if *from == 0.0 && *to == TAU));
        sheet.env[Y] = 0.0;
        assert_eq!(at(&mut sheet, 4, X, 1.0), 0.0);
        assert_eq!(error(&sheet, 5).key, "error.pair");
        assert_eq!(error(&sheet, 6).key, "error.reserved");
    }

    #[test]
    fn polar_rows_accept_theta_and_t() {
        let inputs = [
            RowInput { text: "r = 1 + cos(θ)".into(), ..RowInput::default() },
            RowInput { text: "2 sin(3t)".into(), from: "0".into(), to: "π".into(), hidden: true },
            RowInput { text: "r = θ".into(), from: "1".into(), to: "1".into(), hidden: false },
        ];
        let mut sheet = analyze(Mode::Polar, &inputs);
        assert_eq!(at(&mut sheet, 0, THETA, 0.0), 2.0);
        assert!(matches!(sheet.rows[1].plot(), Some(Plot::Polar { to, .. }) if *to == std::f64::consts::PI));
        assert!(sheet.rows[1].hidden);
        assert_eq!(error(&sheet, 2).key, "error.range");
    }

    #[test]
    fn parametric_sheets_want_pairs() {
        let sheet = sheet(Mode::Parametric, &["cos t", "(2cos t, sin(2t))"]);
        assert_eq!(error(&sheet, 0).key, "error.pair");
        assert!(matches!(sheet.rows[1].plot(), Some(Plot::Curve { .. })));
    }

    #[test]
    fn words_for_greek_letters_and_definitions() {
        let mut polar = sheet(Mode::Polar, &["r = theta/2", "r = 1 + Cos(Theta"]);
        assert_eq!(at(&mut polar, 0, THETA, 4.0), 2.0);
        assert_eq!(at(&mut polar, 1, THETA, 0.0), 2.0);
        let cartesian = sheet(Mode::Cartesian, &["y = phi x", "f(x) := x^2", "(cos t, sin t"]);
        assert_eq!(error(&cartesian, 0).missing, ["φ"]);
        assert!(matches!(cartesian.rows[1].plot(), Some(Plot::FunctionX(_))));
        assert!(matches!(cartesian.rows[2].plot(), Some(Plot::Curve { .. })));
    }

    #[test]
    fn space_sheets_read_surfaces_curves_and_points() {
        let sheet = sheet(Mode::Space, &["y^2 + x^2 + y^2", "z = 2", "x = y z", "y = x^2", "(cos t, sin t, t)", "(1, 2, 3)", "(1, 2)", "x^2 + y^2 + z^2 = 1", "3 + 4"]);
        assert!(matches!(sheet.rows[0].plot(), Some(Plot::Surface { axis: Axis3::Z, .. })));
        assert!(matches!(sheet.rows[1].plot(), Some(Plot::Surface { axis: Axis3::Z, .. })));
        assert!(matches!(sheet.rows[2].plot(), Some(Plot::Surface { axis: Axis3::X, .. })));
        assert!(matches!(sheet.rows[3].plot(), Some(Plot::Surface { axis: Axis3::Y, .. })));
        assert!(matches!(sheet.rows[4].plot(), Some(Plot::Curve3 { .. })));
        assert!(matches!(sheet.rows[5].plot(), Some(Plot::Point3 { x, y, z }) if (*x, *y, *z) == (1.0, 2.0, 3.0)));
        assert_eq!(error(&sheet, 6).key, "error.triple");
        assert_eq!(error(&sheet, 7).key, "error.unsupported");
        assert!(matches!(sheet.rows[8].outcome, Outcome::Value(value) if value == 7.0));
    }

    fn complex_point(sheet: &Sheet, row: usize) -> (f64, f64, String) {
        match sheet.rows[row].plot() {
            Some(Plot::ComplexPoint { re, im, name }) => (*re, *im, name.clone()),
            other => panic!("row {row} is not a complex point: {other:?}"),
        }
    }

    #[test]
    fn complex_sheets_read_numbers_in_every_notation_and_relations() {
        let sheet = sheet(Mode::Complex, &[
            "w = 2e^(iπ/3)", "cos(φ) + i sin(φ)", "φ = 0.8", "3 - 2i", "|z + 2| < 3", "|z - w| = 1", "Re(z) ≥ 1", "z^2", "z = 1 + i",
            "(1, 2)", "r e^(iθ)", "r = 2", "θ = π/4", "arg(z) < π/4", "x^2 + y^2 > 4", "5 < 3", "i = 2",
        ]);
        let (re, im, name) = complex_point(&sheet, 0);
        assert!((re - 1.0).abs() < 1e-12 && (im - 3.0_f64.sqrt()).abs() < 1e-12 && name == "w");
        let (re, im, _) = complex_point(&sheet, 1);
        assert!((re - 0.8_f64.cos()).abs() < 1e-12 && (im - 0.8_f64.sin()).abs() < 1e-12);
        assert!(matches!(&sheet.rows[2].outcome, Outcome::Parameter { slider: true, .. }));
        assert_eq!(complex_point(&sheet, 3).0..complex_point(&sheet, 3).1, 3.0..-2.0);
        assert!(matches!(sheet.rows[4].plot(), Some(Plot::Region { relation: Relation::Lt, field: Field::Complex(_) })));
        assert!(matches!(sheet.rows[5].plot(), Some(Plot::Implicit(Field::Complex(_)))));
        assert!(matches!(sheet.rows[6].plot(), Some(Plot::Region { relation: Relation::Ge, .. })));
        assert_eq!(error(&sheet, 7).key, "error.relation");
        assert_eq!(complex_point(&sheet, 8).0..complex_point(&sheet, 8).1, 1.0..1.0);
        assert_eq!(complex_point(&sheet, 9).0..complex_point(&sheet, 9).1, 1.0..2.0);
        let (re, im, _) = complex_point(&sheet, 10);
        assert!((re - 2.0_f64.sqrt()).abs() < 1e-12 && (im - 2.0_f64.sqrt()).abs() < 1e-12);
        assert!(matches!(sheet.rows[13].plot(), Some(Plot::Region { .. })));
        assert!(matches!(sheet.rows[14].plot(), Some(Plot::Region { relation: Relation::Gt, .. })));
        assert_eq!(error(&sheet, 15).key, "error.unsupported");
        assert_eq!(error(&sheet, 16).key, "error.reserved");
    }

    #[test]
    fn inequalities_shade_cartesian_sheets_only() {
        let cartesian = sheet(Mode::Cartesian, &["y > x^2", "x^2 + y^2 ≤ 4", "y < 2x + a", "a = 1", "i = 2"]);
        assert!(matches!(cartesian.rows[0].plot(), Some(Plot::Region { relation: Relation::Gt, field: Field::Real(_) })));
        assert!(matches!(cartesian.rows[1].plot(), Some(Plot::Region { relation: Relation::Le, .. })));
        assert!(matches!(cartesian.rows[2].plot(), Some(Plot::Region { relation: Relation::Lt, .. })));
        assert!(matches!(&cartesian.rows[4].outcome, Outcome::Parameter { name, .. } if name == "i"));
        let polar = sheet(Mode::Polar, &["r < 2"]);
        assert_eq!(error(&polar, 0).key, "error.unsupported");
    }
}
