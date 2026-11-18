//! One sheet of rows, analysed together: parameters (`a = 2`) and user functions (`f(x) = …`) are defined
//! once and resolved in dependency order, then every other row is classified by the variables it uses and
//! compiled against those definitions. The complex sheet evaluates definitions and relations in ℂ.

use std::cell::Cell;
use std::collections::hash_map::Entry;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::f64::consts::{PI, TAU};

use crate::builtins::Builtin;
use crate::calculus;
use crate::complex::{self, C64, CExpr, CUserFn};
use crate::error::MathError;
use crate::eval::{Expr, INTEGRAL_AXES, Scope, UserFn, compile, constant, eval, index_range};
use crate::lexer::{Tok, tokenize};
use crate::parser::{BinOp, Callee, Cond, Node, Relation, Statement, parse};

pub const X: usize = 0;
pub const Y: usize = 1;
pub const T: usize = 2;
pub const THETA: usize = 3;
pub const Z: usize = 4;
/// The radius r of cylindrical coordinates, φ (cylindrical azimuth, spherical polar angle) and the spherical radius ρ;
/// named only on those sheets. The spherical azimuth θ shares the polar sheet's slot.
pub const R: usize = 5;
pub const PHI: usize = 6;
pub const RHO: usize = 7;
const SLOTS: usize = 8;
const RESERVED: [&str; 6] = ["x", "y", "z", "t", "θ", "r"];
/// On the complex sheet `r`, `t` and θ are ordinary names (as in `r e^(iθ)`) and `i` is the imaginary unit.
const RESERVED_COMPLEX: [&str; 4] = ["x", "y", "z", "i"];
/// The cylindrical sheet reads (r, φ, z); θ and ρ are read as φ and r before analysis.
const RESERVED_CYLINDRICAL: [&str; 5] = ["x", "y", "z", "r", "φ"];
/// The spherical sheet reads (ρ, θ, φ); r is read as ρ before analysis.
const RESERVED_SPHERICAL: [&str; 6] = ["x", "y", "z", "ρ", "θ", "φ"];
/// The parameters of a surface `(x(u, v), y(u, v), z(u, v))` on the 3D sheet. They are not reserved: elsewhere, and
/// wherever the sheet defines one of them, they stay ordinary names (sliders).
pub const SURFACE_PARAMETERS: [&str; 2] = ["u", "v"];
/// The most rows a table of points keeps; the sidebar refuses to paste more and says so.
pub const MAX_TABLE_ROWS: usize = 1000;

thread_local! {
    /// Set by `analyze` for the sheet being read.
    static SHEET_MODE: Cell<Mode> = const { Cell::new(Mode::Cartesian) };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Cartesian,
    Trig,
    Polar,
    Parametric,
    Space,
    Complex,
    /// The complex plane as the floor of a 3D sheet: `w = f(z)` rises to |f(z)|, coloured by arg f(z).
    ComplexSpace,
    Cylindrical,
    Spherical,
}

impl Mode {
    pub fn from_index(index: u32) -> Self {
        match index {
            1 => Self::Trig,
            2 => Self::Polar,
            3 => Self::Parametric,
            4 => Self::Space,
            5 => Self::Complex,
            6 => Self::ComplexSpace,
            7 => Self::Cylindrical,
            8 => Self::Spherical,
            _ => Self::Cartesian,
        }
    }

    fn reserved(self) -> &'static [&'static str] {
        match self {
            Self::Complex | Self::ComplexSpace => &RESERVED_COMPLEX,
            Self::Cylindrical => &RESERVED_CYLINDRICAL,
            Self::Spherical => &RESERVED_SPHERICAL,
            _ => &RESERVED,
        }
    }

    fn system(self) -> Option<System> {
        match self {
            Self::Cylindrical => Some(System::Cylindrical),
            Self::Spherical => Some(System::Spherical),
            _ => None,
        }
    }
}

/// Curvilinear coordinates of a 3D sheet, in the mathematics convention: cylindrical (r, φ, z) with the azimuth φ
/// measured in the xy-plane from +x, spherical (ρ, θ, φ) with the azimuth θ from +x and the polar angle φ from +z.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum System {
    Cylindrical,
    Spherical,
}

impl System {
    /// The coordinates in order; a coordinate is its index here.
    pub fn names(self) -> [&'static str; 3] {
        match self {
            Self::Cylindrical => ["r", "φ", "z"],
            Self::Spherical => ["ρ", "θ", "φ"],
        }
    }

    pub fn slots(self) -> [usize; 3] {
        match self {
            Self::Cylindrical => [R, PHI, Z],
            Self::Spherical => [RHO, THETA, PHI],
        }
    }

    /// The coordinate a bare expression gives: the height z (as on the 3D sheet) or the radius ρ (as on the polar one).
    fn bare(self) -> usize {
        match self {
            Self::Cylindrical => 2,
            Self::Spherical => 0,
        }
    }

    /// The two coordinates a surface runs over when `given` is the one its expression gives: angles first (azimuth,
    /// then polar angle), then the radius, then the height; the first takes the row's range, the second its second range.
    pub fn free(self, given: usize) -> [usize; 2] {
        let order = match self {
            Self::Cylindrical => [1, 0, 2],
            Self::Spherical => [1, 2, 0],
        };
        let mut free = order.into_iter().filter(|coord| *coord != given);
        [free.next().unwrap_or(0), free.next().unwrap_or(0)]
    }

    pub fn is_angle(self, coord: usize) -> bool {
        match self {
            Self::Cylindrical => coord == 1,
            Self::Spherical => coord != 0,
        }
    }

    /// The range of a coordinate whose fields are empty: a full turn of the azimuth, [0, π] of the polar angle, radii
    /// from 0 and heights without bound (both are cut to the visible cube when drawn).
    pub fn default_span(self, coord: usize) -> (f64, f64) {
        match (self, coord) {
            (Self::Cylindrical | Self::Spherical, 1) => (0.0, TAU),
            (Self::Spherical, 2) => (0.0, PI),
            (Self::Cylindrical, 2) => (f64::NEG_INFINITY, f64::INFINITY),
            _ => (0.0, f64::INFINITY),
        }
    }

    /// How far a coordinate that is not an angle reaches into the cube [-1, 1]³: the height to its faces, the
    /// cylindrical radius to its vertical edges and the spherical radius to its corners.
    pub fn reach(self, coord: usize) -> f64 {
        match (self, coord) {
            (Self::Cylindrical, 0) => std::f64::consts::SQRT_2,
            (Self::Spherical, 0) => 3_f64.sqrt(),
            _ => 1.0,
        }
    }

    /// The point (x, y, z) of coordinates `c` given in this system's order.
    pub fn cartesian(self, c: [f64; 3]) -> [f64; 3] {
        match self {
            Self::Cylindrical => [c[0] * c[1].cos(), c[0] * c[1].sin(), c[2]],
            Self::Spherical => {
                let ground = c[0] * c[2].sin();
                [ground * c[1].cos(), ground * c[1].sin(), c[0] * c[2].cos()]
            }
        }
    }
}

/// One parameter range of a surface: the coordinate and its bounds, which are infinite where a radius or height is
/// left open to the edge of the cube.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Span {
    pub coord: usize,
    pub from: f64,
    pub to: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RowInput {
    pub text: String,
    /// Start and end of the parameter range of a polar or parametric row; empty means 0 and 2π.
    pub from: String,
    pub to: String,
    pub hidden: bool,
    /// The second parameter range of a surface over two coordinates; empty means that coordinate's default.
    pub from2: String,
    pub to2: String,
    /// Level curves: the most levels to draw (empty means 10) and the step between them (empty means automatic).
    pub levels: String,
    pub step: String,
    /// Draw the level curves of a surface z = f(x, y) on the floor of the cube.
    pub floor: bool,
    /// Leave out the normal vector of a tangent plane (drawn unless the row turns it off).
    pub hide_normal: bool,
    /// A table of points: its cells as (x, y) texts, each a constant expression; the row's text is not read.
    pub table: Option<Vec<[String; 2]>>,
    /// Join a table's or a list's points with a line in the order given.
    pub connect: bool,
    /// Vector fields: let the arrows drift along the field with the sheet's time (see `Sheet::time`).
    pub flow: bool,
}

/// Which level curves to draw: at most `count` round levels across the values in view, or every multiple of `step`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Levels {
    pub count: usize,
    pub step: Option<f64>,
}

/// Level curves drawn when the row does not say how many.
pub const DEFAULT_LEVELS: usize = 10;
/// The most levels a row may ask for.
pub const MAX_LEVELS: usize = 50;

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
    /// `z = f(x, y)`, `x = f(y, z)` or `y = f(x, z)`: `axis` is the one the expression gives; a surface along z may draw
    /// its level curves on the floor of the cube.
    Surface { expr: Expr, axis: Axis3, floor: Option<Levels> },
    /// The level curves of a function `f(x, y) = …` defined on the Cartesian sheet.
    Contour { field: Field, levels: Levels, name: String },
    Curve3 { x: Expr, y: Expr, z: Expr, from: f64, to: f64 },
    /// A vector field `F(x, y) = (P, Q)` or a bare pair in x and y on the Cartesian sheet, drawn as arrows.
    Field { x: Expr, y: Expr },
    /// A vector field `F(x, y, z) = (P, Q, R)` or a bare triple in x, y and z on the 3D sheet.
    Field3 { x: Expr, y: Expr, z: Expr },
    /// `(x(u, v), y(u, v), z(u, v))`: `u` and `v` are the parameter ranges, `slots` the env slots of u and v.
    ParamSurface { x: Expr, y: Expr, z: Expr, u: (f64, f64), v: (f64, f64), slots: [usize; 2] },
    /// `F(x, y, z) = 0` on the 3D sheet, any equation in x, y and z that is not an explicit surface: `left - right`.
    Implicit3(Expr),
    Point3 { x: f64, y: f64, z: f64 },
    /// `w = f(z)` over the complex plane: the height is |f(z)|, or the value itself when the row is real-valued
    /// (`Re(z^2) / 5`), and `hue` is the complex value whose argument colours the surface.
    ComplexSurface { expr: CExpr, hue: CExpr, height: Height },
    /// A surface in cylindrical or spherical coordinates: `given` is the coordinate the expression gives as a
    /// function of the other two, which run over `u` (the row's range) and `v` (its second range).
    CoordSurface { expr: Expr, system: System, given: usize, u: Span, v: Span },
    /// `int(g, a, b)` on the Cartesian sheet: the area between g(x) and the x-axis from a to b, and its signed value.
    Integral { body: Expr, from: f64, to: f64, value: f64 },
    /// A double or triple integral on the 3D sheet, drawn as a solid: x runs over `x`, y between the two `y` bounds (which
    /// may read x) and z between the two `z` bounds (which may read x and y). `int(g, a, b, c, d)` is the solid between
    /// the xy-plane and z = g(x, y), whose signed volume is the value; `int(g, a, b, c, d, e, f)` is the region the
    /// triple integral runs over (`triple`), whose volume is the value when g is 1.
    Volume { x: (f64, f64), y: (Expr, Expr), z: (Expr, Expr), value: f64, triple: bool },
    /// `tangent(g, a)`: the line y = slope · x + intercept touching g at (x, y).
    Tangent { slope: f64, intercept: f64, x: f64, y: f64 },
    /// `tangent(g, a, b)` on the 3D sheet: the plane z = c + gx (x − a) + gy (y − b) touching z = g(x, y) at `point`
    /// = (a, b, c), with the normal (−gx, −gy, 1) drawn when `normal`.
    TangentPlane { point: [f64; 3], gradient: [f64; 2], normal: bool },
    /// A table of points (or a list `[(1, 2), (3, 4)]`): one entry per table row, NaN where that row gives no point
    /// (blank or invalid), which also breaks the line when `connect` joins the points in order. `bad` lists the cells that
    /// did not evaluate (2 · row + column) and `missing` the undefined names they read.
    Table { points: Vec<[f64; 2]>, connect: bool, bad: Vec<usize>, missing: Vec<String> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Height {
    Modulus,
    Real,
}

impl Height {
    pub fn name(self) -> &'static str {
        match self {
            Self::Modulus => "modulus",
            Self::Real => "real",
        }
    }
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
    /// A vector field whose arrows drift along it.
    pub flow: bool,
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
    /// Implicit 3D surfaces already extracted, per row, for the cube they were extracted in (see `space`).
    pub meshes: HashMap<usize, Mesh>,
    /// The time of flowing vector fields, in cycles: an arrow drifts from its lattice point for one cycle, then starts again.
    pub time: f64,
}

/// One polygon in world coordinates with its normal.
pub type Face = (Vec<[f64; 3]>, Option<[f64; 3]>);

/// The polygons of an implicit surface in world coordinates with their normals, extracted for the cube [-range, range]³;
/// orbiting reuses them, zooming extracts them again.
#[derive(Clone, Debug, Default)]
pub struct Mesh {
    pub range: f64,
    pub polygons: Vec<Face>,
}

const PLANE: [&str; 2] = ["x", "y"];
const SPACE: [&str; 3] = ["x", "y", "z"];

/// Every item reads only `axes`, and at least one reads one of them: the components of a vector field.
fn in_plane_or_space(items: &[Node], axes: &[&str]) -> bool {
    items.iter().all(|item| only(item, axes)) && items.iter().any(|item| !variables(item).is_empty())
}

fn is_reserved(name: &str) -> bool {
    SHEET_MODE.with(Cell::get).reserved().contains(&name)
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
            if let Callee::User(name) | Callee::Derivative(name, _) = callee {
                calls.insert(name.clone());
            }
            match (callee, args.split_first()) {
                // The integrand of `int` and the function of `tangent` read x (and y in 3D) as their own variables.
                // A double or triple integral binds x, y (and z): its integrand reads them all, the bounds of y read x and
                // the bounds of z read x and y.
                (Callee::Integral, Some((body, rest))) if rest.len() > 2 => {
                    let depth = rest.len() / 2;
                    for (index, arg) in std::iter::once(body).chain(rest).enumerate() {
                        let bound = if index == 0 { depth } else { (index - 1) / 2 };
                        let mut inner = BTreeSet::new();
                        collect(arg, &mut inner, calls);
                        names.extend(inner.into_iter().filter(|name| !INTEGRAL_AXES[..bound].contains(&name.as_str())));
                    }
                }
                (Callee::Integral | Callee::Tangent, Some((body, rest))) => {
                    let mut inner = BTreeSet::new();
                    collect(body, &mut inner, calls);
                    names.extend(inner.into_iter().filter(|name| !BOUND.contains(&name.as_str())));
                    rest.iter().for_each(|arg| collect(arg, names, calls));
                }
                // The term of a sum or product reads its index as its own variable; the bounds read the row's names.
                (Callee::Sum | Callee::Product, Some((Node::Var(index), rest))) => {
                    let (bounds, term) = rest.split_at(rest.len().saturating_sub(1));
                    bounds.iter().for_each(|arg| collect(arg, names, calls));
                    let mut inner = BTreeSet::new();
                    term.iter().for_each(|arg| collect(arg, &mut inner, calls));
                    names.extend(inner.into_iter().filter(|name| name != index));
                }
                _ => args.iter().for_each(|arg| collect(arg, names, calls)),
            }
        }
        Node::Tuple(items) => items.iter().for_each(|item| collect(item, names, calls)),
        Node::Piecewise(branches) => {
            for (condition, value) in branches {
                condition.iter().flat_map(Cond::nodes).for_each(|node| collect(node, names, calls));
                collect(value, names, calls);
            }
        }
    }
}

/// The index names of the sums and products inside `node`, outermost first.
fn indices(node: &Node, out: &mut Vec<String>) {
    match node {
        Node::Num(_) | Node::Var(_) => {}
        Node::Neg(arg) | Node::Fact(arg) => indices(arg, out),
        Node::Bin(_, left, right) => {
            indices(left, out);
            indices(right, out);
        }
        Node::Call(callee, args) => {
            if let (Callee::Sum | Callee::Product, Some(Node::Var(index))) = (callee, args.first()) {
                out.push(index.clone());
            }
            args.iter().for_each(|arg| indices(arg, out));
        }
        Node::Tuple(items) => items.iter().for_each(|item| indices(item, out)),
        Node::Piecewise(branches) => {
            for (condition, value) in branches {
                condition.iter().flat_map(Cond::nodes).for_each(|node| indices(node, out));
                indices(value, out);
            }
        }
    }
}

/// The variables the first argument of `int` and `tangent` binds.
const BOUND: [&str; 2] = ["x", "y"];

/// A number as an error message shows it: at most six decimals, a real minus sign.
fn short(value: f64) -> String {
    let text = format!("{value:.6}");
    let text = if text.contains('.') { text.trim_end_matches('0').trim_end_matches('.') } else { &text };
    text.replace('-', "−")
}

/// Every name a node reads, reserved or not, constants left out.
fn names(node: &Node) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    collect(node, &mut names, &mut BTreeSet::new());
    names
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
        Node::Piecewise(branches) => {
            for (condition, value) in branches {
                condition.iter_mut().flat_map(Cond::nodes_mut).for_each(|node| rename(node, from, to));
                rename(value, from, to);
            }
        }
    }
}

const TO_REAL: [Builtin; 4] = [Builtin::Real, Builtin::Imag, Builtin::Abs, Builtin::Arg];

/// Real wherever it is defined: built from numbers, `x`, `y`, parameters and `Re`, `Im`, `abs` or `arg` of anything.
fn real_valued(node: &Node) -> bool {
    match node {
        Node::Num(_) => true,
        Node::Var(name) => !matches!(name.as_str(), "z" | "i"),
        Node::Neg(arg) | Node::Fact(arg) => real_valued(arg),
        Node::Bin(_, left, right) => real_valued(left) && real_valued(right),
        Node::Call(Callee::Builtin(builtin), args) => TO_REAL.contains(builtin) || args.iter().all(real_valued),
        Node::Call(Callee::Sum | Callee::Product, args) => args.iter().all(real_valued),
        Node::Piecewise(branches) => branches.iter().all(|(condition, value)| condition.iter().flat_map(Cond::nodes).all(real_valued) && real_valued(value)),
        Node::Call(Callee::User(_) | Callee::Derivative(..) | Callee::Integral | Callee::Tangent, _) | Node::Tuple(_) => false,
    }
}

/// The first complex argument of `Re`, `Im`, `abs` or `arg` inside a real-valued row.
fn complex_part(node: &Node) -> Option<&Node> {
    match node {
        Node::Call(Callee::Builtin(builtin), args) if TO_REAL.contains(builtin) && args.len() == 1 => Some(&args[0]),
        Node::Neg(arg) | Node::Fact(arg) => complex_part(arg),
        Node::Bin(_, left, right) => complex_part(left).or_else(|| complex_part(right)),
        Node::Call(_, args) | Node::Tuple(args) => args.iter().find_map(complex_part),
        Node::Piecewise(branches) => branches.iter().find_map(|(condition, value)| condition.iter().flat_map(Cond::nodes).find_map(complex_part).or_else(|| complex_part(value))),
        _ => None,
    }
}

/// The most parameters a user function takes: `f(x)`, `f(x, y)`, `F(x, y, z)`.
const MAX_PARAMS: usize = 3;

/// The name a row of the shape `f(v) = …`, `f(x, y) = …` or `F(x, y, z) = …` defines: one to three distinct names.
fn defined_function(tokens: &[Tok]) -> Option<String> {
    let [Tok::Ident(name), Tok::Op('('), rest @ ..] = tokens else { return None };
    if is_reserved(name) || constant(name).is_some() || crate::builtins::Builtin::lookup(name).is_some()
        || !name.chars().next().is_some_and(char::is_alphabetic)
        || !name.split('_').next().is_some_and(|stem| stem.chars().count() == 1)
    {
        return None;
    }
    let mut params: Vec<&str> = Vec::new();
    let mut at = 0;
    loop {
        let Some(Tok::Ident(param)) = rest.get(at) else { return None };
        if constant(param).is_some() || params.contains(&param.as_str()) {
            return None;
        }
        params.push(param);
        match rest.get(at + 1) {
            Some(Tok::Op(',')) if params.len() < MAX_PARAMS => at += 2,
            Some(Tok::Op(')')) => break,
            _ => return None,
        }
    }
    matches!(rest.get(at + 2), Some(Tok::Op('='))).then(|| name.clone())
}

/// The parameters of `f(a, b, …)` on the left of a definition, when each is a plain name.
fn params_of(args: &[Node]) -> Option<Vec<String>> {
    args.iter().map(|arg| if let Node::Var(name) = arg { Some(name.clone()) } else { None }).collect()
}

/// `F(x, y) = (P, Q)` or `F(x, y, z) = (P, Q, R)`: a vector field, named by a definition whose body is a tuple; its parameters.
fn field_params(statement: &Statement) -> Option<Vec<String>> {
    match (&statement.left, &statement.right) {
        (Some(Node::Call(Callee::User(_), args)), Node::Tuple(_)) if statement.relation == Relation::Eq => params_of(args),
        _ => None,
    }
}

enum Definition {
    Parameter(usize),
    Function { row: usize, params: Vec<String> },
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
    function_index: HashMap<String, (usize, usize)>,
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
        let mut bound: Vec<String> = own.iter().map(|name| (*name).to_string()).collect();
        for node in nodes {
            self.count_terms(node, &mut bound)?;
        }
        Ok(())
    }

    /// Refuses a sum or product whose constant bounds span more than `MAX_TERMS` terms, so a slider at 10⁶ shows an
    /// error rather than freezing the graph. Bounds that read a plot variable, a function's parameter or an outer index
    /// (`bound`) vary along the curve and are left to evaluation, which gives no value above the cap.
    fn count_terms(&mut self, node: &Node, bound: &mut Vec<String>) -> Result<(), MathError> {
        match node {
            Node::Num(_) | Node::Var(_) => Ok(()),
            Node::Neg(arg) | Node::Fact(arg) => self.count_terms(arg, bound),
            Node::Bin(_, left, right) => {
                self.count_terms(left, bound)?;
                self.count_terms(right, bound)
            }
            Node::Call(Callee::Sum | Callee::Product, args) if args.len() == 4 => {
                let Node::Var(index) = &args[0] else { return Err(MathError::new("error.index", "")) };
                if is_reserved(index) || constant(index).is_some() {
                    return Err(MathError::new("error.index", index.clone()));
                }
                let (from, to) = (&args[1], &args[2]);
                self.count_terms(from, bound)?;
                self.count_terms(to, bound)?;
                let fixed = |node: &Node| names(node).iter().all(|name| !is_reserved(name) && !bound.contains(name));
                if fixed(from) && fixed(to) {
                    let (a, b) = (self.constant(from)?, self.constant(to)?);
                    if index_range(a, b).is_none() {
                        let count = b.round() - a.round() + 1.0;
                        let shown = if count.is_finite() { format!("{count}") } else { "∞".to_string() };
                        return Err(MathError::new("error.terms", shown));
                    }
                }
                bound.push(index.clone());
                let result = self.count_terms(&args[3], bound);
                bound.pop();
                result
            }
            Node::Call(_, args) | Node::Tuple(args) => args.iter().try_for_each(|arg| self.count_terms(arg, bound)),
            Node::Piecewise(branches) => branches.iter().try_for_each(|(condition, value)| {
                condition.iter().flat_map(Cond::nodes).try_for_each(|node| self.count_terms(node, bound))?;
                self.count_terms(value, bound)
            }),
        }
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
        let (row, params) = match &self.definitions[name] {
            Definition::Parameter(row) => (*row, None),
            Definition::Function { row, params } => (*row, Some(params.clone())),
        };
        if self.complex {
            let body = self.statement(row).right.clone();
            let own: Vec<&str> = params.iter().flatten().map(String::as_str).collect();
            self.require(&[&body], &own)?;
            match params {
                None => {
                    let value = self.constant_c(&body)?;
                    let slot = self.slots[name];
                    self.cenv[slot] = value;
                    self.env[slot] = if value.is_real() { value.re } else { f64::NAN };
                }
                Some(params) => {
                    let slots = params.iter().map(|param| self.slots[param]).collect();
                    let expr = self.compile_c(&body, &move |name| params.iter().any(|param| param == name) || !is_reserved(name))?;
                    let index = self.function_index[name].0;
                    self.cfunctions[index] = CUserFn { slots, body: expr };
                }
            }
            return Ok(());
        }
        match params {
            None => {
                let right = self.statement(row).right.clone();
                self.require(&[&right], &[])?;
                let expr = self.compile(&right, &|name| !is_reserved(name))?;
                let value = eval(&expr, &mut self.env, &self.functions);
                self.env[self.slots[name]] = value;
            }
            Some(params) => {
                let body = self.statement(row).right.clone();
                let own: Vec<&str> = params.iter().map(String::as_str).collect();
                self.require(&[&body], &own)?;
                let slots = params.iter().map(|param| self.slots[param]).collect();
                let expr = self.compile(&body, &move |name| params.iter().any(|param| param == name) || !is_reserved(name))?;
                let index = self.function_index[name].0;
                self.functions[index] = UserFn { slots, body: expr };
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

    /// The level curves a row asks for: its count (empty or unreadable means the default, clamped to 1 … 50) and its
    /// step, a positive constant expression, or automatic when empty.
    fn levels(&mut self, input: &RowInput) -> Result<Levels, MathError> {
        let count = input.levels.trim().parse::<f64>().ok().filter(|count| count.is_finite()).map_or(DEFAULT_LEVELS, |count| (count.round() as usize).clamp(1, MAX_LEVELS));
        if input.step.trim().is_empty() {
            return Ok(Levels { count, step: None });
        }
        let statement = tokenize(&input.step).and_then(|tokens| parse(&tokens, &HashSet::new()))?;
        if statement.left.is_some() {
            return Err(MathError::new("error.unexpected", "="));
        }
        let step = self.constant(&statement.right)?;
        if !(step.is_finite() && step > 0.0) {
            return Err(MathError::new("error.step", ""));
        }
        Ok(Levels { count, step: Some(step) })
    }

    fn range(&mut self, input: &RowInput) -> Result<(f64, f64), MathError> {
        self.bounds(&input.from, &input.to, (0.0, TAU), true)
    }

    /// A range typed into two fields, each falling back to its default when empty; only `finite` ranges refuse ±∞.
    fn bounds(&mut self, from: &str, to: &str, fallback: (f64, f64), finite: bool) -> Result<(f64, f64), MathError> {
        let bound = |analysis: &mut Self, text: &str, fallback: f64| -> Result<f64, MathError> {
            if text.trim().is_empty() {
                return Ok(fallback);
            }
            analysis.cell(text)
        };
        let from = bound(self, from, fallback.0)?;
        let to = bound(self, to, fallback.1)?;
        let valid = |value: f64| if finite { value.is_finite() } else { !value.is_nan() };
        if !valid(from) || !valid(to) || from == to {
            return Err(MathError::new("error.range", ""));
        }
        Ok((from, to))
    }

    /// A constant expression typed into a field of its own (a range bound, a table cell), with the sheet's parameters.
    fn cell(&mut self, text: &str) -> Result<f64, MathError> {
        let statement = tokenize(text).and_then(|tokens| parse(&tokens, &HashSet::new()))?;
        if statement.left.is_some() {
            return Err(MathError::new("error.unexpected", "="));
        }
        self.constant(&statement.right)
    }

    /// A table of points on a plane sheet: every cell is evaluated on its own, so one bad cell costs only its point.
    fn table(&mut self, mode: Mode, cells: &[[String; 2]], connect: bool) -> Outcome {
        if !matches!(mode, Mode::Cartesian | Mode::Trig | Mode::Polar | Mode::Parametric) {
            return Outcome::Error(MathError::new("error.table", ""));
        }
        let mut points = Vec::with_capacity(cells.len().min(MAX_TABLE_ROWS));
        let (mut bad, mut missing) = (Vec::new(), BTreeSet::new());
        for (index, pair) in cells.iter().take(MAX_TABLE_ROWS).enumerate() {
            let mut point = [f64::NAN; 2];
            for (column, text) in pair.iter().enumerate() {
                if text.trim().is_empty() {
                    continue;
                }
                match self.cell(text) {
                    Ok(value) if value.is_finite() => point[column] = value,
                    Ok(_) => bad.push(2 * index + column),
                    Err(error) => {
                        missing.extend(error.missing);
                        bad.push(2 * index + column);
                    }
                }
            }
            points.push(point);
        }
        Outcome::Plotted(Plot::Table { points, connect, bad, missing: missing.into_iter().collect() })
    }

    /// A triple on the 3D sheet that reads both u and v and no reserved variable is a parametric surface, unless the
    /// sheet defines u or v: then the triple keeps the meaning it had before (a point with sliders).
    fn sweeps(&self, statement: &Statement) -> bool {
        let (None, Node::Tuple(items)) = (&statement.left, &statement.right) else { return false };
        if items.len() != 3 || items.iter().any(|item| !variables(item).is_empty()) {
            return false;
        }
        let used: BTreeSet<String> = items.iter().flat_map(names).collect();
        SURFACE_PARAMETERS.iter().all(|name| used.contains(*name) && !self.definitions.contains_key(*name) && !self.duplicates.contains(*name))
    }

    fn plot(&mut self, mode: Mode, row: usize, input: &RowInput) -> Result<Outcome, MathError> {
        let statement = self.statement(row).clone();
        // `w = f(z)` names its surface; only the right side has to resolve.
        if mode == Mode::ComplexSpace {
            return self.plot_complex_space(&statement);
        }
        // `F(x, y) = (P, Q)` names its field; only the components have to resolve.
        if let Some(params) = field_params(&statement) {
            return self.plot_field(mode, &statement.right, &params);
        }
        // `int(f, …)` or `tangent(f, …)` with an f that is neither a function nor a parameter.
        if let (None, Node::Call(Callee::Integral | Callee::Tangent, args)) = (&statement.left, &statement.right)
            && let Some(Node::Var(name)) = args.first()
            && !is_reserved(name)
            && constant(name).is_none()
            && !self.definitions.contains_key(name)
            && !self.duplicates.contains(name)
        {
            return Err(MathError::new("error.function", name.clone()));
        }
        let mut nodes = vec![&statement.right];
        if let Some(left) = &statement.left {
            nodes.push(left);
        }
        let own: &[&str] = if mode == Mode::Space && self.sweeps(&statement) { &SURFACE_PARAMETERS } else { &[] };
        self.require(&nodes, own)?;
        if let (None, Node::Call(callee @ (Callee::Integral | Callee::Tangent), args)) = (&statement.left, &statement.right) {
            match (callee, mode) {
                (Callee::Integral, Mode::Cartesian | Mode::Trig) if args.len() == 3 => return self.integral(args),
                (Callee::Integral, Mode::Space) if args.len() > 3 => return self.volume(args),
                // Elsewhere a double or triple integral is its value, like any expression without variables.
                (Callee::Integral, _) if args.len() > 3 => {}
                (_, Mode::Cartesian | Mode::Trig) => return self.tangent(args),
                (Callee::Tangent, Mode::Space) => return self.tangent_plane(args, input),
                (Callee::Tangent, _) => return Err(MathError::new("error.unsupported", "")),
                _ => {}
            }
        }
        if mode == Mode::Complex {
            return self.plot_complex(&statement);
        }
        if mode == Mode::Space {
            return self.plot_space(&statement, input);
        }
        if let Some(system) = mode.system() {
            return self.plot_coords(&statement, input, system);
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
            // `[(1, 2), (3, 4)]`: a list of constant points draws like a table.
            (None, Node::Tuple(items)) if items.iter().all(|item| matches!(item, Node::Tuple(pair) if pair.len() == 2 && pair.iter().all(|value| variables(value).is_empty()))) => {
                let mut points = Vec::with_capacity(items.len());
                for item in items {
                    let Node::Tuple(pair) = item else { unreachable!("checked above") };
                    points.push([self.constant(&pair[0])?, self.constant(&pair[1])?]);
                }
                Plot::Table { points, connect: input.connect, bad: Vec::new(), missing: Vec::new() }
            }
            (None, Node::Tuple(items)) => match items.as_slice() {
                [x, y] if only(x, &["t"]) && only(y, &["t"]) && (uses(x, "t") || uses(y, "t")) => {
                    let (from, to) = self.range(input)?;
                    Plot::Curve { x: function(self, x, "t")?, y: function(self, y, "t")?, from, to }
                }
                [x, y] if variables(x).is_empty() && variables(y).is_empty() => {
                    Plot::Point { x: self.constant(x)?, y: self.constant(y)? }
                }
                // A pair in x and y is a vector field (it read as an error before).
                [_, _] if matches!(mode, Mode::Cartesian | Mode::Trig) && in_plane_or_space(items, &PLANE) => return self.field(items, &PLANE),
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

    /// `int(g, a, b)` as a row of its own: g as an expression in x, and its value from a to b (either may be ±∞).
    fn integral(&mut self, args: &[Node]) -> Result<Outcome, MathError> {
        let [body, from, to] = args else { return Err(MathError::new("error.arity", "int")) };
        let body = self.compile(body, &|name| name == "x" || !is_reserved(name))?;
        let (from, to) = (self.constant(from)?, self.constant(to)?);
        if from.is_nan() || to.is_nan() {
            return Err(MathError::new("error.range", ""));
        }
        let value = calculus::integrate(&body, X, from, to, &mut self.env, &self.functions);
        Ok(Outcome::Plotted(Plot::Integral { body, from, to, value }))
    }

    /// `int(g, a, b, c, d)` or `int(g, a, b, c, d, e, f)` as a row of the 3D sheet: its value and the solid it runs over.
    /// The bounds of x are numbers and finite, since they span the solid.
    fn volume(&mut self, args: &[Node]) -> Result<Outcome, MathError> {
        let [body, from, to, bounds @ ..] = args else { return Err(MathError::new("error.arity", "int")) };
        let triple = bounds.len() == 4;
        let x = (self.constant(from)?, self.constant(to)?);
        if !x.0.is_finite() || !x.1.is_finite() {
            return Err(MathError::new("error.range", ""));
        }
        let within = |analysis: &Self, node: &Node, axes: usize| analysis.compile(node, &move |name| INTEGRAL_AXES[..axes].contains(&name) || !is_reserved(name));
        let y = (within(self, &bounds[0], 1)?, within(self, &bounds[1], 1)?);
        let body = within(self, body, if triple { 3 } else { 2 })?;
        let (z, integrand) = if triple { ((within(self, &bounds[2], 2)?, within(self, &bounds[3], 2)?), body) } else { ((Expr::Num(0.0), body.clone()), body) };
        let over = |body: Expr, slot: usize, (from, to): &(Expr, Expr)| Expr::Integral { body: Box::new(body), slot, from: Box::new(from.clone()), to: Box::new(to.clone()) };
        let inner = if triple { over(integrand, Z, &z) } else { integrand };
        let value = calculus::integrate(&over(inner, Y, &y), X, x.0, x.1, &mut self.env, &self.functions);
        Ok(Outcome::Plotted(Plot::Volume { x, y, z, value, triple }))
    }

    /// `tangent(g, a)`: the slope g'(a) and the point (a, g(a)); refused where g is undefined or has no derivative.
    fn tangent(&mut self, args: &[Node]) -> Result<Outcome, MathError> {
        let [body, at] = args else { return Err(MathError::new("error.arity", "tangent")) };
        let body = self.compile(body, &|name| name == "x" || !is_reserved(name))?;
        let x = self.constant(at)?;
        let jet = calculus::taylor(&body, X, x, 1, &mut self.env, &self.functions);
        let (y, slope) = (jet.value(), jet.derivative(1));
        if !(x.is_finite() && y.is_finite() && slope.is_finite()) {
            return Err(MathError::new("error.tangent", format!("x = {}", short(x))));
        }
        Ok(Outcome::Plotted(Plot::Tangent { slope, intercept: y - slope * x, x, y }))
    }

    /// `tangent(g, a, b)` on the 3D sheet: g(a, b) and the partial derivatives there, each exact along one axis.
    fn tangent_plane(&mut self, args: &[Node], input: &RowInput) -> Result<Outcome, MathError> {
        let [body, at_x, at_y] = args else { return Err(MathError::new("error.arity", "tangent")) };
        let body = self.compile(body, &|name| name == "x" || name == "y" || !is_reserved(name))?;
        let (a, b) = (self.constant(at_x)?, self.constant(at_y)?);
        self.env[Y] = b;
        let along_x = calculus::taylor(&body, X, a, 1, &mut self.env, &self.functions);
        self.env[X] = a;
        let along_y = calculus::taylor(&body, Y, b, 1, &mut self.env, &self.functions);
        let (c, gradient) = (along_x.value(), [along_x.derivative(1), along_y.derivative(1)]);
        if ![a, b, c, gradient[0], gradient[1]].iter().all(|value| value.is_finite()) {
            return Err(MathError::new("error.tangent", format!("({}, {})", short(a), short(b))));
        }
        Ok(Outcome::Plotted(Plot::TangentPlane { point: [a, b, c], gradient, normal: !input.hide_normal }))
    }

    /// `F(x, y) = (P, Q)` on the Cartesian sheet or `F(x, y, z) = (P, Q, R)` on the 3D sheet; anything else named
    /// like a field (other parameters, other sheets, a tuple of the wrong length) is refused with the rule.
    fn plot_field(&mut self, mode: Mode, right: &Node, params: &[String]) -> Result<Outcome, MathError> {
        let axes: &[&str] = match mode {
            Mode::Cartesian | Mode::Trig => &PLANE,
            Mode::Space => &SPACE,
            _ => return Err(MathError::new("error.field", "")),
        };
        let Node::Tuple(items) = right else { return Err(MathError::new("error.field", "")) };
        if params.len() != axes.len() || params.iter().zip(axes).any(|(param, axis)| param != axis) || items.len() != axes.len() {
            return Err(MathError::new("error.field", ""));
        }
        self.require(&[right], &[])?;
        self.field(items, axes)
    }

    /// The arrows of a field whose components read only `axes`.
    fn field(&mut self, items: &[Node], axes: &[&'static str]) -> Result<Outcome, MathError> {
        let axes: Vec<&'static str> = axes.to_vec();
        let component = |analysis: &Self, node: &Node| analysis.compile(node, &|name| axes.contains(&name) || !is_reserved(name));
        Ok(Outcome::Plotted(match items {
            [x, y] => Plot::Field { x: component(self, x)?, y: component(self, y)? },
            [x, y, z] => Plot::Field3 { x: component(self, x)?, y: component(self, y)?, z: component(self, z)? },
            _ => return Err(MathError::new("error.field", "")),
        }))
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

    /// Rows of the complex 3D sheet: `w = f(z)` or a bare expression in `z` (or `x` and `y`) becomes a surface over
    /// the plane, and a number becomes a point on the floor.
    fn plot_complex_space(&mut self, statement: &Statement) -> Result<Outcome, MathError> {
        if statement.relation != Relation::Eq {
            return Err(MathError::new("error.unsupported", ""));
        }
        let body = match (&statement.left, &statement.right) {
            (None, Node::Tuple(_)) => return Err(MathError::new("error.tuple", "")),
            (None, expr) => expr,
            (Some(Node::Var(name)), right) if !matches!(name.as_str(), "x" | "y" | "z") => {
                if constant(name).is_some() || name == "i" {
                    return Err(MathError::new("error.reserved", name.clone()));
                }
                right
            }
            _ => return Err(MathError::new("error.unsupported", "")),
        };
        self.require(&[body], &[])?;
        if plane_free(body) {
            let value = self.constant_c(body)?;
            return Ok(Outcome::Plotted(Plot::ComplexPoint { re: value.re, im: if value.is_real() { 0.0 } else { value.im }, name: String::new() }));
        }
        let allow = |name: &str| !is_reserved(name) || matches!(name, "x" | "y" | "z");
        // A real-valued row such as `Re(z^2) / 5` rises to its signed value, coloured by the complex value inside.
        let (height, hue) = if real_valued(body) { (Height::Real, complex_part(body).unwrap_or(body)) } else { (Height::Modulus, body) };
        let expr = self.compile_c(body, &allow)?;
        let hue = self.compile_c(hue, &allow)?;
        Ok(Outcome::Plotted(Plot::ComplexSurface { expr, hue, height }))
    }

    /// Rows of a cylindrical or spherical sheet: one coordinate as a function of the other two (or a bare expression
    /// for the height z or the radius ρ), and constant triples as points.
    fn plot_coords(&mut self, statement: &Statement, input: &RowInput, system: System) -> Result<Outcome, MathError> {
        if statement.relation != Relation::Eq {
            return Err(MathError::new("error.unsupported", ""));
        }
        let names = system.names();
        let free_names = |given: usize| system.free(given).map(|coord| names[coord]);
        let (given, body) = match (&statement.left, &statement.right) {
            (None, Node::Tuple(items)) => {
                return match items.as_slice() {
                    [a, b, c] if [a, b, c].iter().all(|item| variables(item).is_empty()) => {
                        let [x, y, z] = system.cartesian([self.constant(a)?, self.constant(b)?, self.constant(c)?]);
                        Ok(Outcome::Plotted(Plot::Point3 { x, y, z }))
                    }
                    _ => Err(MathError::new("error.unsupported", "")),
                };
            }
            (None, expr) if variables(expr).is_empty() => return Ok(Outcome::Value(self.constant(expr)?)),
            (None, expr) if only(expr, &free_names(system.bare())) => (system.bare(), expr),
            (None, _) => return Err(MathError::new("error.unsupported", "")),
            (Some(left), right) => {
                if let Node::Var(name) = left
                    && constant(name).is_some()
                {
                    return Err(MathError::new("error.reserved", name.clone()));
                }
                // `z = r` gives z; only when the left side is no coordinate does the right one name it.
                let found = (0..3)
                    .find(|coord| is_var(left, names[*coord]) && only(right, &free_names(*coord)))
                    .map(|coord| (coord, right))
                    .or_else(|| (0..3).find(|coord| is_var(right, names[*coord]) && only(left, &free_names(*coord))).map(|coord| (coord, left)));
                found.ok_or_else(|| MathError::new("error.unsupported", ""))?
            }
        };
        let [u, v] = system.free(given);
        let over = free_names(given);
        let expr = self.compile(body, &move |name| over.contains(&name) || !is_reserved(name))?;
        let span = |analysis: &mut Self, coord: usize, from: &str, to: &str| -> Result<Span, MathError> {
            let (from, to) = analysis.bounds(from, to, system.default_span(coord), system.is_angle(coord))?;
            Ok(Span { coord, from, to })
        };
        let u = span(self, u, &input.from, &input.to)?;
        let v = span(self, v, &input.from2, &input.to2)?;
        Ok(Outcome::Plotted(Plot::CoordSurface { expr, system, given, u, v }))
    }

    /// Rows of a 3D sheet: surfaces over two axes, space curves and points.
    fn plot_space(&mut self, statement: &Statement, input: &RowInput) -> Result<Outcome, MathError> {
        if statement.relation != Relation::Eq {
            return Err(MathError::new("error.unsupported", ""));
        }
        let over = |analysis: &Self, node: &Node, axes: [&'static str; 2]| -> Result<Expr, MathError> {
            analysis.compile(node, &move |name| axes.contains(&name) || !is_reserved(name))
        };
        // Level curves on the floor belong to surfaces along z; their settings are read only where they apply.
        let floor = if input.floor { Some(self.levels(input)) } else { None };
        let surface = |analysis: &Self, node: &Node, axis: Axis3| -> Result<Outcome, MathError> {
            let floor = if axis == Axis3::Z { floor.clone().transpose()? } else { None };
            Ok(Outcome::Plotted(Plot::Surface { expr: over(analysis, node, axis.over())?, axis, floor }))
        };
        match (&statement.left, &statement.right) {
            (None, Node::Tuple(items)) if self.sweeps(statement) => {
                let u = self.bounds(&input.from, &input.to, (0.0, TAU), true)?;
                let v = self.bounds(&input.from2, &input.to2, (0.0, TAU), true)?;
                let sweep = |analysis: &Self, node: &Node| analysis.compile(node, &|name| SURFACE_PARAMETERS.contains(&name) || !is_reserved(name));
                let slots = SURFACE_PARAMETERS.map(|name| self.slots[name]);
                Ok(Outcome::Plotted(Plot::ParamSurface { x: sweep(self, &items[0])?, y: sweep(self, &items[1])?, z: sweep(self, &items[2])?, u, v, slots }))
            }
            (None, Node::Tuple(items)) => match items.as_slice() {
                [x, y, z] if [x, y, z].iter().all(|item| only(item, &["t"])) && [x, y, z].iter().any(|item| uses(item, "t")) => {
                    let (from, to) = self.range(input)?;
                    let along = |analysis: &Self, node: &Node| analysis.compile(node, &|name| name == "t" || !is_reserved(name));
                    Ok(Outcome::Plotted(Plot::Curve3 { x: along(self, x)?, y: along(self, y)?, z: along(self, z)?, from, to }))
                }
                [x, y, z] if [x, y, z].iter().all(|item| variables(item).is_empty()) => {
                    Ok(Outcome::Plotted(Plot::Point3 { x: self.constant(x)?, y: self.constant(y)?, z: self.constant(z)? }))
                }
                // A triple in x, y and z is a vector field (it read as an error before).
                [_, _, _] if in_plane_or_space(items, &SPACE) => self.field(items, &SPACE),
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
                // Any other equation in x, y and z is the zero set of left − right.
                let space = ["x", "y", "z"];
                if only(left, &space) && only(right, &space) && !(variables(left).is_empty() && variables(right).is_empty()) {
                    let difference = Node::Bin(BinOp::Sub, Box::new(left.clone()), Box::new(right.clone()));
                    return Ok(Outcome::Plotted(Plot::Implicit3(self.compile(&difference, &|name| space.contains(&name) || !is_reserved(name))?)));
                }
                Err(MathError::new("error.unsupported", ""))
            }
        }
    }
}

pub fn analyze(mode: Mode, inputs: &[RowInput]) -> Sheet {
    let complex_names = matches!(mode, Mode::Complex | Mode::ComplexSpace);
    SHEET_MODE.with(|current| current.set(mode));
    // Other spellings of a coordinate: t for θ on the polar sheet (except in a parametric pair), θ and ρ for φ and
    // r on the cylindrical sheet, r for ρ on the spherical one.
    let aliases: &[(&str, &str)] = match mode {
        Mode::Polar => &[("t", "θ")],
        Mode::Cylindrical => &[("θ", "φ"), ("ρ", "r")],
        Mode::Spherical => &[("r", "ρ")],
        _ => &[],
    };
    let tokens: Vec<Option<Result<Vec<Tok>, MathError>>> =
        inputs.iter().map(|input| (input.table.is_none() && !input.text.trim().is_empty()).then(|| tokenize(&input.text))).collect();
    let user_functions: HashSet<String> = tokens.iter().flatten().flatten().filter_map(|tokens| defined_function(tokens)).collect();
    let statements: Vec<Option<Result<Statement, MathError>>> = tokens
        .into_iter()
        .map(|tokens| {
            tokens.map(|tokens| {
                tokens.and_then(|tokens| parse(&tokens, &user_functions)).map(|mut statement| {
                    if !(mode == Mode::Polar && matches!(statement.right, Node::Tuple(_))) {
                        for (from, to) in aliases {
                            rename(&mut statement.right, from, to);
                            if let Some(left) = statement.left.as_mut() {
                                rename(left, from, to);
                            }
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
            // A tuple body is a vector field, drawn by its row rather than defined.
            Some(Node::Call(Callee::User(name), args)) if statement.relation == Relation::Eq && !matches!(statement.right, Node::Tuple(_)) => {
                params_of(args).map(|params| (name.clone(), Definition::Function { row, params }))
            }
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
    if let Some(system) = mode.system() {
        for (name, slot) in system.names().into_iter().zip(system.slots()) {
            slots.insert(name.to_string(), slot);
        }
    }
    let mut env = vec![0.0; SLOTS];
    let mut cenv = vec![C64::real(0.0); SLOTS];
    if mode == Mode::Space {
        for name in SURFACE_PARAMETERS {
            slots.insert(name.to_string(), env.len());
            env.push(0.0);
            cenv.push(C64::real(0.0));
        }
    }
    let mut cfunctions = Vec::new();
    let mut function_index = HashMap::new();
    let mut functions = Vec::new();
    let mut names: Vec<&String> = definitions.keys().collect();
    names.sort();
    for name in names {
        let params = match &definitions[name] {
            Definition::Parameter(_) => vec![name.clone()],
            Definition::Function { params, .. } => {
                function_index.insert(name.clone(), (functions.len(), params.len()));
                functions.push(UserFn { slots: Vec::new(), body: Expr::Num(f64::NAN) });
                cfunctions.push(CUserFn { slots: Vec::new(), body: CExpr::Num(C64::NAN) });
                params.clone()
            }
        };
        for param in params {
            if let Entry::Vacant(entry) = slots.entry(param) {
                entry.insert(env.len());
                env.push(f64::NAN);
                cenv.push(C64::NAN);
            }
        }
    }

    // Every sum's or product's index gets a slot of its own unless its name already has one.
    let mut series_indices = Vec::new();
    for statement in statements.iter().flatten().flatten() {
        indices(&statement.right, &mut series_indices);
        if let Some(left) = &statement.left {
            indices(left, &mut series_indices);
        }
    }
    for index in series_indices {
        if constant(&index).is_none()
            && let Entry::Vacant(entry) = slots.entry(index)
        {
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
        complex: complex_names,
        cenv,
        cfunctions,
        state: HashMap::new(),
        errors: HashMap::new(),
    };
    let mut rows = Vec::with_capacity(inputs.len());
    for (row, input) in inputs.iter().enumerate() {
        if let Some(cells) = &input.table {
            rows.push(Row { outcome: analysis.table(mode, cells, input.connect), hidden: input.hidden, flow: false });
            continue;
        }
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
                    Definition::Function { params, .. } if params == &["z"] && mode == Mode::ComplexSpace => {
                        let body = analysis.cfunctions[analysis.function_index[name].0].body.clone();
                        Outcome::Plotted(Plot::ComplexSurface { expr: body.clone(), hue: body, height: Height::Modulus })
                    }
                    // `f(x, y) = …` draws its level curves on the Cartesian sheet and its surface z = f(x, y) in 3D.
                    Definition::Function { params, .. } if params == &["x", "y"] && matches!(mode, Mode::Cartesian | Mode::Trig) => {
                        let body = analysis.functions[analysis.function_index[name].0].body.clone();
                        match analysis.levels(input) {
                            Ok(levels) => Outcome::Plotted(Plot::Contour { field: Field::Real(body), levels, name: name.clone() }),
                            Err(error) => Outcome::Error(error),
                        }
                    }
                    Definition::Function { params, .. } if params == &["x", "y"] && mode == Mode::Space => {
                        let expr = analysis.functions[analysis.function_index[name].0].body.clone();
                        match input.floor.then(|| analysis.levels(input)).transpose() {
                            Ok(floor) => Outcome::Plotted(Plot::Surface { expr, axis: Axis3::Z, floor }),
                            Err(error) => Outcome::Error(error),
                        }
                    }
                    Definition::Function { params, .. } if params == &["x"] && !analysis.complex => {
                        let index = analysis.function_index[name].0;
                        Outcome::Plotted(Plot::FunctionX(analysis.functions[index].body.clone()))
                    }
                    Definition::Function { .. } => Outcome::Definition { name: name.clone() },
                },
            },
            (Some(Ok(_)), None) => analysis.plot(mode, row, input).unwrap_or_else(Outcome::Error),
        };
        rows.push(Row { outcome, hidden: input.hidden, flow: input.flow });
    }
    Sheet { env: analysis.env, functions: analysis.functions, cenv: analysis.cenv, cfunctions: analysis.cfunctions, rows, meshes: HashMap::new(), time: 0.0 }
}

#[cfg(test)]
mod tests {
    use std::f64::consts::PI;

    use super::*;
    use crate::eval::factorial;

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
    fn complex_3d_rows_become_surfaces_and_floor_points() {
        let sheet = sheet(Mode::ComplexSpace, &["w = z^2", "f(z) = conj(z)", "Re(z^3) / 5 - 1", "w_1 = 1 + i", "abs(z) < 1", "z = 2", "r e^(iθ)", "r = 2", "θ = 1", "x y / 4"]);
        assert!(matches!(sheet.rows[0].plot(), Some(Plot::ComplexSurface { height: Height::Modulus, .. })), "{:?}", sheet.rows[0].outcome);
        assert!(matches!(sheet.rows[1].plot(), Some(Plot::ComplexSurface { height: Height::Modulus, .. })));
        assert!(matches!(sheet.rows[2].plot(), Some(Plot::ComplexSurface { height: Height::Real, .. })));
        assert!(matches!(sheet.rows[3].plot(), Some(Plot::ComplexPoint { re, im, .. }) if *re == 1.0 && *im == 1.0));
        assert_eq!(error(&sheet, 4).key, "error.unsupported");
        assert_eq!(error(&sheet, 5).key, "error.unsupported");
        assert!(matches!(sheet.rows[6].plot(), Some(Plot::ComplexPoint { .. })));
        assert!(matches!(sheet.rows[9].plot(), Some(Plot::ComplexSurface { height: Height::Real, .. })));
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
        let mut sheet = sheet(Mode::Cartesian, &["2 + 3", "(1, a)", "a = 4", "(cos t, sin t)", "x^2 + y^2 = 1", "(x, t)", "e = 3"]);
        assert!(matches!(sheet.rows[0].outcome, Outcome::Value(value) if value == 5.0));
        assert!(matches!(sheet.rows[1].plot(), Some(Plot::Point { x, y }) if *x == 1.0 && *y == 4.0));
        assert!(matches!(sheet.rows[3].plot(), Some(Plot::Curve { from, to, .. }) if *from == 0.0 && *to == TAU));
        sheet.env[Y] = 0.0;
        assert_eq!(at(&mut sheet, 4, X, 1.0), 0.0);
        assert_eq!(error(&sheet, 5).key, "error.pair");
        assert_eq!(error(&sheet, 6).key, "error.reserved");
    }

    #[test]
    fn vector_fields_in_the_plane_and_in_space() {
        let mut plane = sheet(Mode::Cartesian, &[
            "F(x, y) = (-y, x)", "(-y, x)", "(1, 2)", "(cos t, sin t)", "(x, t)", "G(x) = (x, 1)", "F_2(x, y) = (k y, x)", "H(x, y) = (1, 2, 3)", "(x, 1)", "E(y, x) = (x, y)",
        ]);
        assert!(matches!(plane.rows[0].plot(), Some(Plot::Field { .. })), "{:?}", plane.rows[0].outcome);
        assert!(matches!(plane.rows[1].plot(), Some(Plot::Field { .. })));
        assert!(matches!(plane.rows[2].plot(), Some(Plot::Point { .. })));
        assert!(matches!(plane.rows[3].plot(), Some(Plot::Curve { .. })));
        assert_eq!(error(&plane, 4).key, "error.pair");
        assert_eq!(error(&plane, 5).key, "error.field");
        assert_eq!(error(&plane, 6).missing, ["k"]);
        assert_eq!(error(&plane, 7).key, "error.field");
        assert!(matches!(plane.rows[8].plot(), Some(Plot::Field { .. })));
        assert_eq!(error(&plane, 9).key, "error.field");
        let Some(Plot::Field { x, y }) = plane.rows[0].plot().cloned() else { unreachable!() };
        (plane.env[X], plane.env[Y]) = (1.0, 2.0);
        assert_eq!((eval(&x, &mut plane.env, &plane.functions), eval(&y, &mut plane.env, &plane.functions)), (-2.0, 1.0));
        // Only the Cartesian sheet reads a pair in x and y as a field.
        assert_eq!(error(&sheet(Mode::Parametric, &["(-y, x)"]), 0).key, "error.pair");
        assert_eq!(error(&sheet(Mode::Polar, &["F(x, y) = (-y, x)"]), 0).key, "error.field");
        let space = sheet(Mode::Space, &["F(x, y, z) = (-y, x, z / 4)", "(y, -x, 1)", "F(x, y) = (1, 2)", "(1, 2, 3)", "(cos t, sin t, t)", "(u cos v, u sin v, v)", "(x, y, t)"]);
        assert!(matches!(space.rows[0].plot(), Some(Plot::Field3 { .. })), "{:?}", space.rows[0].outcome);
        assert!(matches!(space.rows[1].plot(), Some(Plot::Field3 { .. })));
        assert_eq!(error(&space, 2).key, "error.field");
        assert!(matches!(space.rows[3].plot(), Some(Plot::Point3 { .. })));
        assert!(matches!(space.rows[4].plot(), Some(Plot::Curve3 { .. })));
        assert!(matches!(space.rows[5].plot(), Some(Plot::ParamSurface { .. })));
        assert_eq!(error(&space, 6).key, "error.triple");
    }

    #[test]
    fn user_functions_take_up_to_three_parameters() {
        let mut sheet = sheet(Mode::Cartesian, &["f(x, y) = x y + 1", "f(2, 3)", "h(x) = f(x, 2) - 1", "g(a, b, c) = a + 2b + 3c", "g(1, 1, 1)", "f(1)", "k(x, x) = x"]);
        assert!(matches!(sheet.rows[0].plot(), Some(Plot::Contour { name, .. }) if name == "f"), "{:?}", sheet.rows[0].outcome);
        assert!(matches!(sheet.rows[1].outcome, Outcome::Value(value) if value == 7.0));
        assert_eq!(at(&mut sheet, 2, X, 3.0), 6.0);
        assert!(matches!(sheet.rows[4].outcome, Outcome::Value(value) if value == 6.0));
        assert_eq!(error(&sheet, 5).key, "error.arity");
        assert!(matches!(sheet.rows[6].outcome, Outcome::Error(_)));
        // f(y, x) swaps its arguments and leaves x and y as they were.
        let mut swap = self::sheet(Mode::Cartesian, &["f(x, y) = x - 2y", "x = f(y, x)"]);
        let Some(Plot::Implicit(Field::Real(expr))) = swap.rows[1].plot().cloned() else { panic!("{:?}", swap.rows[1].outcome) };
        (swap.env[X], swap.env[Y]) = (1.0, 5.0);
        assert_eq!(eval(&expr, &mut swap.env, &swap.functions), 1.0 - (5.0 - 2.0));
        assert_eq!((swap.env[X], swap.env[Y]), (1.0, 5.0));
        let complex = self::sheet(Mode::Complex, &["f(z, w) = z w", "f(i, i)"]);
        assert!(matches!(complex.rows[1].plot(), Some(Plot::ComplexPoint { re, im, .. }) if *re == -1.0 && *im == 0.0), "{:?}", complex.rows[1].outcome);
    }

    #[test]
    fn functions_of_x_and_y_draw_level_curves_and_surfaces() {
        let input = |text: &str, levels: &str, step: &str, floor: bool| RowInput { text: text.into(), levels: levels.into(), step: step.into(), floor, ..RowInput::default() };
        let plane = analyze(Mode::Cartesian, &[
            input("f(x, y) = x^2 - y^2", "", "", false), input("g(x, y) = x y", "5", "0.5", false), input("h(x, y) = x + y", "", "-1", false),
            input("k(x, y) = x - y", "abc", "q", false), input("m(x, y) = x", "500", "", false), input("f(x, 2)", "", "", false), input("n(a, b) = a b", "", "", false),
        ]);
        let levels = |sheet: &Sheet, row: usize| match sheet.rows[row].plot() {
            Some(Plot::Contour { levels, .. }) => *levels,
            other => panic!("row {row} draws no level curves: {other:?}"),
        };
        assert_eq!(levels(&plane, 0), Levels { count: DEFAULT_LEVELS, step: None });
        assert!(matches!(plane.rows[0].plot(), Some(Plot::Contour { name, .. }) if name == "f"));
        assert_eq!(levels(&plane, 1), Levels { count: 5, step: Some(0.5) });
        assert_eq!(error(&plane, 2).key, "error.step");
        assert_eq!(error(&plane, 3).missing, ["q"]);
        assert_eq!(levels(&plane, 4).count, MAX_LEVELS);
        // A two-variable function stays callable, and one in other names is only defined.
        assert!(matches!(plane.rows[5].plot(), Some(Plot::FunctionX(_))));
        assert!(matches!(&plane.rows[6].outcome, Outcome::Definition { name } if name == "n"));
        assert!(matches!(&sheet(Mode::Polar, &["f(x, y) = x y"]).rows[0].outcome, Outcome::Definition { .. }));
        let space = analyze(Mode::Space, &[
            input("f(x, y) = x^2 - y^2", "", "", false), input("g(x, y) = x y", "4", "", true), input("z = x y", "", "2", true), input("x^2 + y^2", "", "", true), input("x = y z", "", "", true), input("z = x", "", "0", true),
        ]);
        assert!(matches!(space.rows[0].plot(), Some(Plot::Surface { axis: Axis3::Z, floor: None, .. })), "{:?}", space.rows[0].outcome);
        assert!(matches!(space.rows[1].plot(), Some(Plot::Surface { floor: Some(Levels { count: 4, step: None }), .. })));
        assert!(matches!(space.rows[2].plot(), Some(Plot::Surface { floor: Some(Levels { step: Some(2.0), .. }), .. })));
        assert!(matches!(space.rows[3].plot(), Some(Plot::Surface { floor: Some(_), .. })));
        assert!(matches!(space.rows[4].plot(), Some(Plot::Surface { axis: Axis3::X, floor: None, .. })));
        assert_eq!(error(&space, 5).key, "error.step");
    }

    #[test]
    fn derivatives_of_defined_functions() {
        let mut sheet = sheet(Mode::Cartesian, &[
            "f(x) = sin x", "f'(x)", "f''(x)", "y = f'(x) + 1", "g(x) = f'(x)", "g'(x)", "h(t) = t^3", "h'(x)", "h''(2)", "h‴(x)", "k'(x)", "p(x, y) = x y", "p'(x)", "f''''(x)", "h'(2x)",
        ]);
        for (row, x, expected) in [(1, 0.7, 0.7_f64.cos()), (2, 0.7, -0.7_f64.sin()), (3, 0.7, 0.7_f64.cos() + 1.0), (4, 2.0, 2.0_f64.cos()), (5, 2.0, -2.0_f64.sin()), (7, -1.5, 6.75), (9, 4.0, 6.0), (14, 1.5, 27.0)] {
            let got = at(&mut sheet, row, X, x);
            assert!((got - expected).abs() < 1e-12, "row {row} at {x}: {got} != {expected}");
        }
        assert!(matches!(sheet.rows[8].outcome, Outcome::Value(value) if (value - 12.0).abs() < 1e-12));
        assert_eq!(error(&sheet, 10).key, "error.derivative");
        assert_eq!(error(&sheet, 12).key, "error.derivative");
        assert_eq!(error(&sheet, 13).key, "error.prime");
        // Derivatives are real: the complex sheets refuse them.
        assert_eq!(error(&self::sheet(Mode::Complex, &["f(z) = z^2", "f'(1)"]), 1).key, "error.unsupported");
    }

    #[test]
    fn sums_and_products_over_an_index_range() {
        let value = |sheet: &Sheet, row: usize| match sheet.rows[row].outcome {
            Outcome::Value(value) => value,
            ref other => panic!("row {row} is no value: {other:?}"),
        };
        // Taylor series of sin and e^x with a slider N; the index n offers no chip, N does.
        for n in [3.0, 7.0, 12.0] {
            let n_row = format!("N = {n}");
            let mut sheet = sheet(Mode::Cartesian, &[&n_row, "y = sum(n, 0, N, (-1)^n x^(2n+1) / (2n+1)!)", "Σ(n, 0, N, x^n / n!)"]);
            let terms = |x: f64, odd: bool| (0..=n as i32).map(|k| if odd { (-1.0_f64).powi(k) * x.powi(2 * k + 1) / factorial(f64::from(2 * k + 1)) } else { x.powi(k) / factorial(f64::from(k)) }).sum::<f64>();
            for x in [-2.0, 0.3, 1.7] {
                assert!((at(&mut sheet, 1, X, x) - terms(x, true)).abs() < 1e-12);
                assert!((at(&mut sheet, 2, X, x) - terms(x, false)).abs() < 1e-12);
            }
        }
        let close = sheet(Mode::Cartesian, &["N = 12", "sum(n, 0, N, (-1)^n x^(2n+1) / (2n+1)!)"]);
        let mut close = close;
        assert!((at(&mut close, 1, X, 2.0) - 2.0_f64.sin()).abs() < 1e-9);
        let missing = sheet(Mode::Cartesian, &["sum(n, 0, N, x^n / n!)", "prod(k, 1, m, k)"]);
        assert_eq!(error(&missing, 0).missing, ["N"]);
        assert_eq!(error(&missing, 1).missing, ["m"]);
        // Fourier square wave: ±1 away from the jumps.
        let mut wave = sheet(Mode::Cartesian, &["N = 400", "4/π · sum(k, 0, N, sin((2k+1)x) / (2k+1))"]);
        assert!((at(&mut wave, 1, X, 1.0) - 1.0).abs() < 0.01);
        assert!((at(&mut wave, 1, X, -2.0) + 1.0).abs() < 0.01);
        // Finite products, rounding, empty ranges, the cap.
        let sheet = sheet(Mode::Cartesian, &[
            "prod(k, 1, 5, k)", "product(k, 1, 4, 1 - 1/(k+1)^2)", "sum(k, 1, 3.6, k)", "sum(k, 0.5, 2.4, k)", "sum(k, 5, 1, k)", "prod(k, 5, 1, k)",
            "sum(k, 1, 10^6, k)", "sum(k, 1, inf, 1/k^2)", "sum(k, 1, 1000, 1) + sum(k, 0, 1000, 1)", "sum(x, 0, 3, x)", "sum(π, 0, 3, 1)", "sum(i, 1, 3, sum(j, 1, i, j))", "a = 2", "∏(k, a, a + 2, k)",
        ]);
        assert_eq!(value(&sheet, 0), 120.0);
        assert!((value(&sheet, 1) - 0.6).abs() < 1e-12);
        assert_eq!(value(&sheet, 2), 10.0);
        assert_eq!(value(&sheet, 3), 3.0);
        assert_eq!(value(&sheet, 4), 0.0);
        assert_eq!(value(&sheet, 5), 1.0);
        assert_eq!((error(&sheet, 6).key, error(&sheet, 6).param.as_str()), ("error.terms", "1000000"));
        assert_eq!((error(&sheet, 7).key, error(&sheet, 7).param.as_str()), ("error.terms", "∞"));
        assert_eq!((error(&sheet, 8).key, error(&sheet, 8).param.as_str()), ("error.terms", "1001"));
        assert_eq!(error(&sheet, 9).key, "error.index");
        assert_eq!(error(&sheet, 10).key, "error.index");
        assert_eq!(value(&sheet, 11), 10.0);
        assert_eq!(value(&sheet, 13), 24.0);
    }

    #[test]
    fn sums_inside_functions_integrals_derivatives_and_surfaces() {
        let mut sheet = sheet(Mode::Cartesian, &["N = 10", "f(x) = sum(n, 0, N, x^n / n!)", "f'(x)", "int(f, 0, 1)", "g(m) = sum(k, 1, m, k)", "g(4)", "h(x) = sum(k, 0, x, 1)", "int(sum(k, 1, 3, k x^(k-1)), 0, 1)"]);
        assert!((at(&mut sheet, 2, X, 0.5) - (0..10).map(|n| 0.5_f64.powi(n) / factorial(f64::from(n))).sum::<f64>()).abs() < 1e-12);
        match sheet.rows[3].plot() {
            Some(Plot::Integral { value, .. }) => assert!((value - (1..=11).map(|n| 1.0 / factorial(f64::from(n))).sum::<f64>()).abs() < 1e-12),
            other => panic!("{other:?}"),
        }
        assert!(matches!(sheet.rows[5].outcome, Outcome::Value(value) if value == 10.0));
        // Bounds that read x vary along the curve: evaluation caps them instead of the row.
        assert_eq!(at(&mut sheet, 6, X, 2.2), 3.0);
        assert!(at(&mut sheet, 6, X, 1e7).is_nan());
        match sheet.rows[7].plot() {
            Some(Plot::Integral { value, .. }) => assert!((value - 3.0).abs() < 1e-12),
            other => panic!("{other:?}"),
        }
        let mut space = self::sheet(Mode::Space, &["z = sum(k, 1, 3, x^k y)"]);
        let Some(Plot::Surface { expr, .. }) = space.rows[0].plot().cloned() else { panic!("{:?}", space.rows[0].outcome) };
        space.env[X] = 2.0;
        space.env[Y] = 0.5;
        assert_eq!(eval(&expr, &mut space.env, &space.functions), 7.0);
        let complex = self::sheet(Mode::Complex, &["prod(k, 1, 2, i)", "sum(n, 0, 3, i^n)"]);
        assert!(matches!(complex.rows[0].outcome, Outcome::Plotted(Plot::ComplexPoint { re, im, .. }) if (re + 1.0).abs() < 1e-12 && im == 0.0), "{:?}", complex.rows[0].outcome);
        assert!(matches!(complex.rows[1].outcome, Outcome::Plotted(Plot::ComplexPoint { re, im, .. }) if re.abs() < 1e-12 && im.abs() < 1e-12));
    }

    #[test]
    fn piecewise_functions_take_the_first_true_branch() {
        let mut sheet = sheet(Mode::Cartesian, &[
            "{x < 0: −x, x ≥ 0: x^2}", "y = {x < 0: −x, x^2}", "f(x) = {0 ≤ x < 1: x, 1 ≤ x <= 2: 2 - x}", "f(x) + 1", "{x < -1 or x > 1: 1, x = 0: 5, x != 0.5 and x > 0: 2}",
            "f'(x)", "int(f, 0, 2)", "{x < 0: 1, x < 1: 2, 3}", "z = {x < 0: 1, 0}", "g(x) = {x < 0: sum(k, 1, 3, k), N}", "{x: 1}", "{x + 1}^2", "y = 2 {x < 0: -1, 1}",
        ]);
        for (row, x, expected) in [(0, -2.0, 2.0), (0, 3.0, 9.0), (1, -0.5, 0.5), (1, 0.5, 0.25), (2, 0.25, 0.25), (2, 1.5, 0.5), (3, 1.5, 1.5), (4, 2.0, 1.0), (4, 0.0, 5.0), (4, 0.7, 2.0), (5, 0.5, 1.0), (5, 1.5, -1.0), (7, -1.0, 1.0), (7, 0.5, 2.0), (7, 9.0, 3.0), (11, 2.0, 9.0), (12, -3.0, -2.0)] {
            let got = at(&mut sheet, row, X, x);
            assert!((got - expected).abs() < 1e-12, "row {row} at {x}: {got} != {expected}");
        }
        // No true branch: undefined, a gap in the curve.
        for (row, x) in [(2, -0.5), (2, 2.5), (4, 0.5), (4, -0.5)] {
            assert!(at(&mut sheet, row, X, x).is_nan(), "row {row} at {x}");
        }
        match sheet.rows[6].plot() {
            Some(Plot::Integral { value, .. }) => assert!((value - 1.0).abs() < 1e-9, "{value}"),
            other => panic!("{other:?}"),
        }
        assert_eq!(error(&sheet, 8).key, "error.unsupported");
        assert_eq!(error(&sheet, 9).missing, ["N"]);
        assert_eq!(error(&sheet, 10).key, "error.condition");
        let mut space = self::sheet(Mode::Space, &["z = {x^2 + y^2 < 4: 4 - x^2 - y^2, 0}"]);
        let Some(Plot::Surface { expr, .. }) = space.rows[0].plot().cloned() else { panic!("{:?}", space.rows[0].outcome) };
        space.env[X] = 1.0;
        space.env[Y] = 1.0;
        assert_eq!(eval(&expr, &mut space.env, &space.functions), 2.0);
        space.env[X] = 3.0;
        assert_eq!(eval(&expr, &mut space.env, &space.functions), 0.0);
        assert_eq!(error(&self::sheet(Mode::Complex, &["{1 < 2: 1, 2}"]), 0).key, "error.unsupported");
    }

    #[test]
    fn integral_rows_carry_their_signed_value() {
        let input = |text: &str| RowInput { text: text.into(), ..RowInput::default() };
        let sheet = analyze(Mode::Cartesian, &[
            input("f(x) = x^2"), input("int(f, 0, 1)"), input("∫(sin x, 0, 2π)"), input("integral(x, -1, 3)"), input("int(f, 1, 0)"), input("int(f, a, a)"), input("a = 2"),
            input("int(f, 0, b)"), input("int(q, 0, 1)"), input("int(e^(-x^2), -inf, inf)"), input("2 int(f, 0, 3)"), input("F(x) = int(f, 0, x)"), input("F'(x)"), input("int(f', 0, 2)"), input("int(x y, 0, 1)"), input("int(f, 0)"),
        ]);
        let value = |row: usize| match sheet.rows[row].plot() {
            Some(Plot::Integral { value, .. }) => *value,
            other => panic!("row {row} is no integral: {other:?}"),
        };
        assert!((value(1) - 1.0 / 3.0).abs() < 1e-13);
        assert!(value(2).abs() < 1e-12, "{}", value(2));
        assert!((value(3) - 4.0).abs() < 1e-13);
        assert!((value(4) + 1.0 / 3.0).abs() < 1e-13);
        assert_eq!(value(5), 0.0);
        assert_eq!(error(&sheet, 7).missing, ["b"]);
        assert_eq!(error(&sheet, 8).key, "error.function");
        assert!((value(9) - PI.sqrt()).abs() < 1e-10);
        assert!(matches!(sheet.rows[10].outcome, Outcome::Value(value) if (value - 18.0).abs() < 1e-12), "{:?}", sheet.rows[10].outcome);
        assert!((value(13) - 4.0).abs() < 1e-13);
        assert_eq!(error(&sheet, 14).key, "error.unknown");
        assert_eq!(error(&sheet, 15).key, "error.arity");
        // An integral with a variable bound is a function of x, and its derivative the integrand.
        let mut sheet = sheet;
        assert!((at(&mut sheet, 11, X, 3.0) - 9.0).abs() < 1e-12);
        assert!((at(&mut sheet, 12, X, 1.5) - 2.25).abs() < 1e-12);
    }

    #[test]
    fn tangent_rows_touch_their_function() {
        let sheet = sheet(Mode::Cartesian, &["f(x) = x^2", "tangent(f, 1)", "tangent(f, a)", "tangent(sin x, π)", "tangent(|x|, 0)", "tangent(g, 1)", "tangent(f', 2)", "tangent(sqrt x, -1)", "y = tangent(f, 1)", "tangent(f, 1, 2)"]);
        assert!(matches!(sheet.rows[1].plot(), Some(Plot::Tangent { slope, intercept, x, y }) if (*slope, *intercept, *x, *y) == (2.0, -1.0, 1.0, 1.0)), "{:?}", sheet.rows[1].outcome);
        assert_eq!(error(&sheet, 2).missing, ["a"]);
        let Some(Plot::Tangent { slope, intercept, .. }) = sheet.rows[3].plot() else { panic!("{:?}", sheet.rows[3].outcome) };
        assert!((slope + 1.0).abs() < 1e-12 && (intercept - PI).abs() < 1e-12);
        assert_eq!(error(&sheet, 4).key, "error.tangent");
        assert_eq!(error(&sheet, 4).param, "x = 0");
        assert_eq!(error(&sheet, 5).key, "error.function");
        assert!(matches!(sheet.rows[6].plot(), Some(Plot::Tangent { slope, x, y, .. }) if (*slope, *x, *y) == (2.0, 2.0, 4.0)));
        assert_eq!(error(&sheet, 7).param, "x = −1");
        assert_eq!(error(&sheet, 8).key, "error.tangentRow");
        assert_eq!(error(&sheet, 9).key, "error.arity");
    }

    #[test]
    fn tangent_planes_touch_surfaces_in_3d() {
        let inputs: Vec<RowInput> = [
            "f(x, y) = x^2 + y^2", "tangent(f, 1, 2)", "tangent(x y / 4, a, b)", "a = 2", "tangent(sqrt(x^2 + y^2), 0, 0)", "tangent(f, 1)", "tangent(g, 1, 2)", "tangent(f, a, c)", "tangent(sin(x) cos(y), π, 0)",
        ].iter().map(|text| RowInput { text: text.to_string(), ..RowInput::default() }).collect();
        let mut inputs = inputs;
        inputs[8].hide_normal = true;
        let sheet = analyze(Mode::Space, &inputs);
        assert!(matches!(sheet.rows[1].plot(), Some(Plot::TangentPlane { point, gradient, normal: true }) if *point == [1.0, 2.0, 5.0] && *gradient == [2.0, 4.0]), "{:?}", sheet.rows[1].outcome);
        assert_eq!(error(&sheet, 2).missing, ["b"]);
        assert_eq!(error(&sheet, 4).key, "error.tangent");
        assert_eq!(error(&sheet, 4).param, "(0, 0)");
        assert_eq!(error(&sheet, 5).key, "error.arity");
        assert_eq!(error(&sheet, 6).key, "error.function");
        assert_eq!(error(&sheet, 7).missing, ["c"]);
        let Some(Plot::TangentPlane { point, gradient, normal: false }) = sheet.rows[8].plot() else { panic!("{:?}", sheet.rows[8].outcome) };
        assert!((point[2]).abs() < 1e-12 && (gradient[0] + 1.0).abs() < 1e-12 && gradient[1].abs() < 1e-12);
        let defined = self::sheet(Mode::Space, &["tangent(x y / 4, a, b)", "a = 2", "b = -4"]);
        assert!(matches!(defined.rows[0].plot(), Some(Plot::TangentPlane { point, gradient, .. }) if *point == [2.0, -4.0, -2.0] && *gradient == [-1.0, 0.5]));
        // The other 3D sheets have no tangent planes, and a plane needs two coordinates.
        assert_eq!(error(&self::sheet(Mode::Cylindrical, &["tangent(r, 1, 2)"]), 0).key, "error.unsupported");
        assert_eq!(error(&self::sheet(Mode::Cartesian, &["f(x) = x", "tangent(f, 1, 2)"]), 1).key, "error.arity");
    }

    #[test]
    fn polar_rows_accept_theta_and_t() {
        let inputs = [
            RowInput { text: "r = 1 + cos(θ)".into(), ..RowInput::default() },
            RowInput { text: "2 sin(3t)".into(), from: "0".into(), to: "π".into(), hidden: true, ..RowInput::default() },
            RowInput { text: "r = θ".into(), from: "1".into(), to: "1".into(), ..RowInput::default() },
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

    fn table(mode: Mode, texts: &[&str], cells: &[[&str; 2]]) -> Sheet {
        let mut inputs: Vec<RowInput> = texts.iter().map(|text| RowInput { text: text.to_string(), ..RowInput::default() }).collect();
        let cells = cells.iter().map(|[x, y]| [x.to_string(), y.to_string()]).collect();
        inputs.push(RowInput { text: "a = 1".into(), table: Some(cells), connect: true, ..RowInput::default() });
        analyze(mode, &inputs)
    }

    #[test]
    fn tables_evaluate_each_cell_with_the_sheets_parameters() {
        let sheet = table(Mode::Cartesian, &["a = 2"], &[["1", "2"], ["π", "a^2"], ["", ""], ["3", "q"], ["x", "1/0"], ["-1.5*10^1", ""]]);
        let Some(Plot::Table { points, connect, bad, missing }) = sheet.rows[1].plot() else { panic!("{:?}", sheet.rows[1].outcome) };
        assert!(*connect);
        assert_eq!(points[0], [1.0, 2.0]);
        assert_eq!(points[1], [PI, 4.0]);
        assert!(points[2].iter().all(|value| value.is_nan()), "a blank row gives no point");
        assert_eq!(points[3][0], 3.0);
        assert!(points[3][1].is_nan() && points[5][1].is_nan());
        assert_eq!(points[5][0], -15.0);
        // q is undefined (offered as a slider), x is a variable of the sheet, 1/0 is not finite.
        assert_eq!(bad, &[7, 8, 9]);
        assert_eq!(missing, &["q".to_string()]);
        // The row's own text is not read: "a = 1" in a table row defines nothing, so a stays 2.
        assert!(matches!(sheet.rows[0].outcome, Outcome::Parameter { value, .. } if value == 2.0));
        // Polar and parametric sheets take tables too (Cartesian x and y); 3D and complex sheets refuse them.
        assert!(matches!(table(Mode::Polar, &[], &[["1", "1"]]).rows[0].plot(), Some(Plot::Table { .. })));
        assert!(matches!(table(Mode::Parametric, &[], &[["1", "1"]]).rows[0].plot(), Some(Plot::Table { .. })));
        for mode in [Mode::Space, Mode::Complex, Mode::Cylindrical] {
            assert_eq!(error(&table(mode, &[], &[["1", "1"]]), 0).key, "error.table");
        }
        let long: Vec<[&str; 2]> = (0..MAX_TABLE_ROWS + 50).map(|_| ["1", "2"]).collect();
        let Some(Plot::Table { points, .. }) = table(Mode::Cartesian, &[], &long).rows[0].plot().cloned() else { panic!() };
        assert_eq!(points.len(), MAX_TABLE_ROWS);
    }

    #[test]
    fn lists_of_constant_points_draw_like_tables() {
        let sheet = self::sheet(Mode::Cartesian, &["b = 3", "[(1, 2), (b, -1), (0, 0)]", "[(1, 2), (x, 1)]", "((1, 2), (3, 4))"]);
        let Some(Plot::Table { points, connect, bad, .. }) = sheet.rows[1].plot() else { panic!("{:?}", sheet.rows[1].outcome) };
        assert_eq!(points, &[[1.0, 2.0], [3.0, -1.0], [0.0, 0.0]]);
        assert!(!connect && bad.is_empty());
        assert!(matches!(sheet.rows[2].outcome, Outcome::Error(_)), "a point in x is not a list of points");
        assert!(matches!(sheet.rows[3].plot(), Some(Plot::Table { points, .. }) if points.len() == 2));
        assert_eq!(error(&self::sheet(Mode::Cartesian, &["[(1, 2), (k, 1)]"]), 0).missing, vec!["k".to_string()]);
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
        assert!(matches!(sheet.rows[7].plot(), Some(Plot::Implicit3(_))));
        assert!(matches!(sheet.rows[8].outcome, Outcome::Value(value) if value == 7.0));
    }

    #[test]
    fn other_equations_in_x_y_and_z_are_implicit_surfaces() {
        let mut sheet = sheet(Mode::Space, &[
            "x^2 + y^2 + z^2 = 4", "x^2 + y^2 = z^2", "x^2/4 + y^2 + z^2/9 = 1", "x^2 + y^2 - z^2 = 1", "z^2 - x^2 - y^2 = 1", "x^2 + y^2 = k", "k = 2",
            "z = x y", "x = y^2 + z^2", "y = 3", "x y z = 1", "x^2 + y^2 + z^2 < 4", "x + t = 1", "1 = 2", "x^2 + y^2 + z^2",
        ]);
        for row in [0, 1, 2, 3, 4, 5, 10] {
            assert!(matches!(sheet.rows[row].plot(), Some(Plot::Implicit3(_))), "row {row}: {:?}", sheet.rows[row].outcome);
        }
        // Explicit surfaces keep their faster path.
        assert!(matches!(sheet.rows[7].plot(), Some(Plot::Surface { axis: Axis3::Z, .. })));
        assert!(matches!(sheet.rows[8].plot(), Some(Plot::Surface { axis: Axis3::X, .. })));
        assert!(matches!(sheet.rows[9].plot(), Some(Plot::Surface { axis: Axis3::Y, .. })));
        for row in [11, 12, 13, 14] {
            assert_eq!(error(&sheet, row).key, "error.unsupported", "row {row}");
        }
        let Some(Plot::Implicit3(field)) = sheet.rows[0].plot().cloned() else { unreachable!() };
        (sheet.env[X], sheet.env[Y], sheet.env[Z]) = (2.0, 0.0, 0.0);
        assert_eq!(eval(&field, &mut sheet.env, &sheet.functions), 0.0);
        let Some(Plot::Implicit3(field)) = sheet.rows[5].plot().cloned() else { unreachable!() };
        (sheet.env[X], sheet.env[Y]) = (1.0, 1.0);
        assert_eq!(eval(&field, &mut sheet.env, &sheet.functions), 0.0);
        // Equations in x, y, z stay unsupported on the other 3D sheets.
        assert_eq!(error(&self::sheet(Mode::Cylindrical, &["x^2 + y^2 + z^2 = 4"]), 0).key, "error.unsupported");
    }

    #[test]
    fn triples_in_u_and_v_are_parametric_surfaces_unless_the_sheet_defines_them() {
        let mut sheet = sheet(Mode::Space, &[
            "((2 + cos v) cos u, (2 + cos v) sin u, sin v)", "(u cos v, u sin v, u)", "(u, v, t)", "(u, 1, 2)", "(cos t, sin t, t)", "(1, 2, 3)", "(a u, v, 0)", "a = 2",
        ]);
        assert!(matches!(sheet.rows[0].plot(), Some(Plot::ParamSurface { u, v, .. }) if *u == (0.0, TAU) && *v == (0.0, TAU)), "{:?}", sheet.rows[0].outcome);
        assert!(matches!(sheet.rows[1].plot(), Some(Plot::ParamSurface { .. })));
        // A triple that also reads t, or only one of u and v, keeps its old reading: u and v are undefined names.
        assert_eq!(error(&sheet, 2).missing, ["u", "v"]);
        assert_eq!(error(&sheet, 3).missing, ["u"]);
        assert!(matches!(sheet.rows[4].plot(), Some(Plot::Curve3 { .. })));
        assert!(matches!(sheet.rows[5].plot(), Some(Plot::Point3 { .. })));
        assert!(matches!(sheet.rows[6].plot(), Some(Plot::ParamSurface { .. })));
        let Some(Plot::ParamSurface { x, slots, .. }) = sheet.rows[0].plot().cloned() else { unreachable!() };
        sheet.env[slots[0]] = 0.0;
        sheet.env[slots[1]] = 0.0;
        assert_eq!(eval(&x, &mut sheet.env, &sheet.functions), 3.0);
        // Where the sheet defines u and v, the triple is a point at their values, as before.
        let defined = self::sheet(Mode::Space, &["(u cos v, u sin v, v)", "u = 2", "v = 0"]);
        assert!(matches!(defined.rows[0].plot(), Some(Plot::Point3 { x, y, z }) if (*x, *y, *z) == (2.0, 0.0, 0.0)), "{:?}", defined.rows[0].outcome);
        assert!(matches!(&defined.rows[1].outcome, Outcome::Parameter { name, slider: true, .. } if name == "u"));
        // u and v stay ordinary names on every other sheet.
        assert_eq!(error(&self::sheet(Mode::Cylindrical, &["(u cos v, u sin v, u)"]), 0).missing, ["u", "v"]);
        let input = |from: &str, to: &str, from2: &str, to2: &str| RowInput { text: "(u cos v, u sin v, v)".into(), from: from.into(), to: to.into(), from2: from2.into(), to2: to2.into(), hidden: false, ..RowInput::default() };
        let ranged = analyze(Mode::Space, &[input("-1", "1", "0", "4π"), input("0", "∞", "", ""), input("", "", "k", "1")]);
        assert!(matches!(ranged.rows[0].plot(), Some(Plot::ParamSurface { u, v, .. }) if *u == (-1.0, 1.0) && *v == (0.0, 4.0 * PI)));
        assert_eq!(error(&ranged, 1).key, "error.range");
        assert_eq!(error(&ranged, 2).missing, ["k"]);
    }

    fn coords(sheet: &Sheet, row: usize) -> (usize, Span, Span) {
        match sheet.rows[row].plot() {
            Some(Plot::CoordSurface { given, u, v, .. }) => (*given, *u, *v),
            other => panic!("row {row} is no coordinate surface: {other:?}"),
        }
    }

    #[test]
    fn cylindrical_rows_give_one_coordinate_over_the_other_two() {
        let mut sheet = sheet(Mode::Cylindrical, &[
            "r = 2", "z = r^2", "r = 1 + cos(φ)", "z = phi / 2", "φ = π/4", "r^2 / 4", "z = r", "rho = 1 + cos(theta)", "r = a z", "a = 0.5", "x = 1",
            "(2, π/2, 3)", "r < 2", "y = r", "f(u) = u^2", "r = f(φ)",
        ]);
        let (given, u, v) = coords(&sheet, 0);
        assert_eq!((given, u, v), (0, Span { coord: 1, from: 0.0, to: TAU }, Span { coord: 2, from: f64::NEG_INFINITY, to: f64::INFINITY }));
        assert_eq!(coords(&sheet, 1), (2, Span { coord: 1, from: 0.0, to: TAU }, Span { coord: 0, from: 0.0, to: f64::INFINITY }));
        assert_eq!(coords(&sheet, 2).0, 0);
        assert_eq!(coords(&sheet, 3).0, 2);
        assert_eq!(coords(&sheet, 4), (1, Span { coord: 0, from: 0.0, to: f64::INFINITY }, Span { coord: 2, from: f64::NEG_INFINITY, to: f64::INFINITY }));
        // A bare expression is the height, and `z = r` gives z rather than r.
        assert_eq!(coords(&sheet, 5).0, 2);
        assert_eq!(coords(&sheet, 6).0, 2);
        // ρ and θ are other spellings of r and φ; parameters stay sliders.
        assert_eq!(coords(&sheet, 7).0, 0);
        assert_eq!(coords(&sheet, 8).0, 0);
        assert!(matches!(&sheet.rows[9].outcome, Outcome::Parameter { name, slider: true, .. } if name == "a"));
        assert_eq!(error(&sheet, 10).key, "error.unsupported");
        assert!(matches!(sheet.rows[11].plot(), Some(Plot::Point3 { x, y, z }) if x.abs() < 1e-12 && (*y - 2.0).abs() < 1e-12 && *z == 3.0));
        assert_eq!(error(&sheet, 12).key, "error.unsupported");
        assert_eq!(error(&sheet, 13).key, "error.unsupported");
        assert_eq!(coords(&sheet, 15).0, 0);
        let Some(Plot::CoordSurface { expr, .. }) = sheet.rows[2].plot().cloned() else { unreachable!() };
        sheet.env[PHI] = 0.0;
        assert_eq!(eval(&expr, &mut sheet.env, &sheet.functions), 2.0);
        let Some(Plot::CoordSurface { expr, .. }) = sheet.rows[15].plot().cloned() else { unreachable!() };
        sheet.env[PHI] = 3.0;
        assert_eq!(eval(&expr, &mut sheet.env, &sheet.functions), 9.0);
    }

    #[test]
    fn cylindrical_ranges_take_angles_finite_and_heights_open() {
        let input = |text: &str, from: &str, to: &str, from2: &str, to2: &str| RowInput { text: text.into(), from: from.into(), to: to.into(), from2: from2.into(), to2: to2.into(), hidden: false, ..RowInput::default() };
        let sheet = analyze(Mode::Cylindrical, &[
            input("r = 2", "0", "π", "-1", "3"),
            input("r = 2", "", "", "-inf", "∞"),
            input("r = 2", "0", "∞", "", ""),
            input("z = φ / 2", "0", "4π", "", "k"),
            input("r = 2", "", "", "1", "1"),
        ]);
        let (_, u, v) = coords(&sheet, 0);
        assert_eq!((u.from, u.to, v.from, v.to), (0.0, PI, -1.0, 3.0));
        assert_eq!(coords(&sheet, 1).2, Span { coord: 2, from: f64::NEG_INFINITY, to: f64::INFINITY });
        assert_eq!(error(&sheet, 2).key, "error.range");
        assert_eq!(error(&sheet, 3).missing, ["k"]);
        assert_eq!(error(&sheet, 4).key, "error.range");
        assert_eq!(System::Cylindrical.cartesian([2.0, PI, 1.0]).map(|value| (value * 1e9).round() / 1e9), [-2.0, 0.0, 1.0]);
    }

    #[test]
    fn spherical_rows_read_the_mathematics_convention() {
        let mut sheet = sheet(Mode::Spherical, &[
            "ρ = 2", "rho = 1 + cos(theta)", "φ = π/4", "phi = pi/4", "θ = π/3", "1 + cos(φ)", "r = 3", "ρ = a", "a = 1.5", "(2, 0, π/2)", "z = 1", "ρ > 1",
        ]);
        assert_eq!(coords(&sheet, 0), (0, Span { coord: 1, from: 0.0, to: TAU }, Span { coord: 2, from: 0.0, to: PI }));
        assert_eq!(coords(&sheet, 1).0, 0);
        // φ = π/4 is the cone about +z, swept over the azimuth θ and the radius ρ.
        assert_eq!(coords(&sheet, 2), (2, Span { coord: 1, from: 0.0, to: TAU }, Span { coord: 0, from: 0.0, to: f64::INFINITY }));
        assert_eq!(coords(&sheet, 3).0, 2);
        assert_eq!(coords(&sheet, 4), (1, Span { coord: 2, from: 0.0, to: PI }, Span { coord: 0, from: 0.0, to: f64::INFINITY }));
        // A bare expression is the radius, and r is another spelling of ρ.
        assert_eq!(coords(&sheet, 5).0, 0);
        assert_eq!(coords(&sheet, 6).0, 0);
        assert_eq!(coords(&sheet, 7).0, 0);
        assert!(matches!(&sheet.rows[8].outcome, Outcome::Parameter { name, slider: true, .. } if name == "a"));
        assert!(matches!(sheet.rows[9].plot(), Some(Plot::Point3 { x, y, z }) if (*x - 2.0).abs() < 1e-12 && y.abs() < 1e-12 && z.abs() < 1e-12));
        assert_eq!(error(&sheet, 10).key, "error.unsupported");
        assert_eq!(error(&sheet, 11).key, "error.unsupported");
        let Some(Plot::CoordSurface { expr, .. }) = sheet.rows[1].plot().cloned() else { unreachable!() };
        sheet.env[THETA] = PI;
        assert_eq!(eval(&expr, &mut sheet.env, &sheet.functions), 0.0);
        // θ turns from +x towards +y in the xy-plane; φ tips away from +z.
        let at = |c: [f64; 3]| System::Spherical.cartesian(c).map(|value| (value * 1e9).round() / 1e9);
        assert_eq!(at([2.0, 0.0, 0.0]), [0.0, 0.0, 2.0]);
        assert_eq!(at([2.0, PI / 2.0, PI / 2.0]), [0.0, 2.0, 0.0]);
        assert_eq!(at([2.0, 0.0, PI]), [0.0, 0.0, -2.0]);
        let inputs = [RowInput { text: "ρ = 2".into(), from2: "0".into(), to2: "π/4".into(), ..RowInput::default() }, RowInput { text: "φ = π/4".into(), to2: "∞".into(), from: "0".into(), to: "inf".into(), ..RowInput::default() }];
        let ranged = analyze(Mode::Spherical, &inputs);
        assert_eq!(coords(&ranged, 0).2, Span { coord: 2, from: 0.0, to: PI / 4.0 });
        assert_eq!(error(&ranged, 1).key, "error.range");
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

    #[test]
    fn double_and_triple_integrals_have_values_and_solids() {
        let value = |sheet: &Sheet, row: usize| match sheet.rows[row].plot() {
            Some(Plot::Volume { value, .. }) => *value,
            other => panic!("row {row} is no volume: {other:?}"),
        };
        let texts = [
            "int(x y, 0, 1, 0, 2)",
            "int(4 - x^2 - y^2, -1, 1, -1, 1)",
            "int(1, 0, 1, 0, x)",
            "int(1, 0, 2, 0, 3, 0, 4)",
            "int(x y z, 0, 1, 0, 1, 0, 1)",
            "int(1, -2, 2, -sqrt(4 - x^2), sqrt(4 - x^2), -sqrt(4 - x^2 - y^2), sqrt(4 - x^2 - y^2))",
            "f(x, y) = x + y",
            "int(f, 0, 1, 0, 1)",
            "int(1, 0, a, 0, 1)",
            "int(1, 0, inf, 0, 1)",
            "2 int(x y, 0, 1, 0, 2)",
        ];
        let space = sheet(Mode::Space, &texts);
        let sheet_3d = &space;
        assert!((value(sheet_3d, 0) - 1.0).abs() < 1e-9);
        assert!((value(sheet_3d, 1) - 40.0 / 3.0).abs() < 1e-9);
        assert!((value(sheet_3d, 2) - 0.5).abs() < 1e-9);
        assert!((value(sheet_3d, 3) - 24.0).abs() < 1e-9);
        assert!((value(sheet_3d, 4) - 0.125).abs() < 1e-9);
        // The ball of radius 2: the bounds meet the surface with vertical tangents, which the shared budget still resolves.
        assert!((value(sheet_3d, 5) - 32.0 * PI / 3.0).abs() < 1e-3, "{}", value(sheet_3d, 5));
        assert!((value(sheet_3d, 7) - 1.0).abs() < 1e-9);
        assert!(matches!(space.rows[3].plot(), Some(Plot::Volume { triple: true, .. })) && matches!(space.rows[0].plot(), Some(Plot::Volume { triple: false, .. })));
        match &space.rows[8].outcome {
            Outcome::Error(error) => assert_eq!((error.key, error.missing.clone()), ("error.unknown", vec!["a".to_string()])),
            _ => panic!("an undefined bound is an error"),
        }
        assert!(matches!(&space.rows[9].outcome, Outcome::Error(error) if error.key == "error.range"));
        assert!(matches!(space.rows[10].outcome, Outcome::Value(value) if (value - 2.0).abs() < 1e-9));
        // On the flat sheet they are values; four or six arguments are refused.
        let flat = sheet(Mode::Cartesian, &["int(x y, 0, 1, 0, x)", "int(x, 0, 1, 2)", "int(x^2, 0, 3)"]);
        assert!(matches!(flat.rows[0].outcome, Outcome::Value(value) if (value - 0.125).abs() < 1e-9));
        assert!(matches!(&flat.rows[1].outcome, Outcome::Error(error) if error.key == "error.arity"));
        assert!(matches!(flat.rows[2].plot(), Some(Plot::Integral { .. })));
    }
}
