//! The text the JavaScript side exchanges with the module. Rows are separated by U+001E and fields by U+001F,
//! which an expression never contains (the plugin strips both before encoding).
//!
//! In: `text, from, to, hidden, from2, to2, levels, step, floor, normal, table, cells, connect, flow` per row (the fields
//! after `hidden` are optional; `normal` is `0` when a tangent plane leaves out its normal vector; `table` is `1` for a
//! table of points, whose `cells` are its x and y texts in turn, separated by U+001D; `connect` is `1` to join its points
//! with a line; `flow` is `1` for a vector field whose arrows drift along it). Out, per row, a kind and its fields:
//! `empty` · `error key param missing,names` · `param name value slider` · `value number` · `function x|y` ·
//! `definition name` · `polar from to` · `curve from to` · `point x y` · `implicit` · `surface x|y|z` ·
//! `curve3 from to` · `point3 x y z` · `region strict|loose` · `cpoint re im name` · `csurface modulus|real` ·
//! `coords given u v ufrom uto vfrom vto` (a surface in curvilinear coordinates; the names are its coordinates) ·
//! `psurface ufrom uto vfrom vto` (a parametric surface in u and v) · `implicit3` (a surface F(x, y, z) = 0) ·
//! `field` and `field3` (vector fields in the plane and in space) · `contour name` (the level curves of `name(x, y)`) ·
//! `integral value from to` (the area under a curve and its signed value) · `volume value 2|3` (a double or triple
//! integral drawn as a solid on the 3D sheet, with its value) · `tangent slope intercept x y` (a tangent line
//! and its point of contact) · `tplane gx gy a b c` (a tangent plane at (a, b, c) with the surface's partial derivatives) ·
//! `table count bad missing` (a table or list of points: how many it draws, the cells that did not evaluate as
//! `2 · row + column` and the undefined names they read, both comma-separated).

use crate::sheet::{MAX_TABLE_ROWS, Outcome, Plot, RowInput, Sheet};

pub const RECORD: char = '\u{1e}';
pub const FIELD: char = '\u{1f}';
pub const CELL: char = '\u{1d}';

pub fn read_rows(text: &str) -> Vec<RowInput> {
    if text.is_empty() {
        return Vec::new();
    }
    text.split(RECORD)
        .map(|record| {
            let mut fields = record.split(FIELD);
            let mut next = || fields.next().unwrap_or_default().to_string();
            let (text, from, to, hidden, from2, to2) = (next(), next(), next(), next(), next(), next());
            let (levels, step, floor, normal) = (next(), next(), next(), next());
            let (table, cells, connect, flow) = (next(), next(), next(), next());
            let table = (table == "1").then(|| {
                let cells: Vec<&str> = if cells.is_empty() { Vec::new() } else { cells.split(CELL).collect() };
                cells.chunks(2).take(MAX_TABLE_ROWS).map(|pair| [pair[0].to_string(), pair.get(1).copied().unwrap_or_default().to_string()]).collect()
            });
            RowInput { text, from, to, hidden: hidden == "1", from2, to2, levels, step, floor: floor == "1", hide_normal: normal == "0", table, connect: connect == "1", flow: flow == "1" }
        })
        .collect()
}

fn number(value: f64) -> String {
    if value.is_nan() {
        "NaN".into()
    } else if value.is_infinite() {
        if value > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else {
        format!("{value}")
    }
}

pub fn write_outcomes(sheet: &Sheet) -> String {
    let field = FIELD.to_string();
    sheet
        .rows
        .iter()
        .map(|row| {
            let fields: Vec<String> = match &row.outcome {
                Outcome::Empty => vec!["empty".into()],
                Outcome::Error(error) => vec!["error".into(), error.key.into(), error.param.clone(), error.missing.join(",")],
                Outcome::Parameter { name, value, slider } => vec!["param".into(), name.clone(), number(*value), if *slider { "1" } else { "0" }.into()],
                Outcome::Value(value) => vec!["value".into(), number(*value)],
                Outcome::Definition { name } => vec!["definition".into(), name.clone()],
                Outcome::Plotted(Plot::FunctionX(_)) => vec!["function".into(), "x".into()],
                Outcome::Plotted(Plot::FunctionY(_)) => vec!["function".into(), "y".into()],
                Outcome::Plotted(Plot::Polar { from, to, .. }) => vec!["polar".into(), number(*from), number(*to)],
                Outcome::Plotted(Plot::Curve { from, to, .. }) => vec!["curve".into(), number(*from), number(*to)],
                Outcome::Plotted(Plot::Point { x, y }) => vec!["point".into(), number(*x), number(*y)],
                Outcome::Plotted(Plot::Implicit(_)) => vec!["implicit".into()],
                Outcome::Plotted(Plot::Region { relation, .. }) => vec!["region".into(), if relation.strict() { "strict" } else { "loose" }.into()],
                Outcome::Plotted(Plot::ComplexPoint { re, im, name }) => vec!["cpoint".into(), number(*re), number(*im), name.clone()],
                Outcome::Plotted(Plot::Surface { axis, .. }) => vec!["surface".into(), axis.name().into()],
                Outcome::Plotted(Plot::Curve3 { from, to, .. }) => vec!["curve3".into(), number(*from), number(*to)],
                Outcome::Plotted(Plot::Point3 { x, y, z }) => vec!["point3".into(), number(*x), number(*y), number(*z)],
                Outcome::Plotted(Plot::ComplexSurface { height, .. }) => vec!["csurface".into(), height.name().into()],
                Outcome::Plotted(Plot::Implicit3(_)) => vec!["implicit3".into()],
                Outcome::Plotted(Plot::Field { .. }) => vec!["field".into()],
                Outcome::Plotted(Plot::Field3 { .. }) => vec!["field3".into()],
                Outcome::Plotted(Plot::Contour { name, .. }) => vec!["contour".into(), name.clone()],
                Outcome::Plotted(Plot::Integral { value, from, to, .. }) => vec!["integral".into(), number(*value), number(*from), number(*to)],
                Outcome::Plotted(Plot::Volume { value, triple, .. }) => vec!["volume".into(), number(*value), if *triple { "3" } else { "2" }.into()],
                Outcome::Plotted(Plot::Tangent { slope, intercept, x, y }) => vec!["tangent".into(), number(*slope), number(*intercept), number(*x), number(*y)],
                Outcome::Plotted(Plot::TangentPlane { point, gradient, .. }) => {
                    vec!["tplane".into(), number(gradient[0]), number(gradient[1]), number(point[0]), number(point[1]), number(point[2])]
                }
                Outcome::Plotted(Plot::Table { points, bad, missing, .. }) => {
                    let count = points.iter().filter(|point| point.iter().all(|value| value.is_finite())).count();
                    vec!["table".into(), count.to_string(), bad.iter().map(usize::to_string).collect::<Vec<_>>().join(","), missing.join(",")]
                }
                Outcome::Plotted(Plot::ParamSurface { u, v, .. }) => vec!["psurface".into(), number(u.0), number(u.1), number(v.0), number(v.1)],
                Outcome::Plotted(Plot::CoordSurface { system, given, u, v, .. }) => {
                    let names = system.names();
                    vec!["coords".into(), names[*given].into(), names[u.coord].into(), names[v.coord].into(), number(u.from), number(u.to), number(v.from), number(v.to)]
                }
            };
            fields.join(&field)
        })
        .collect::<Vec<_>>()
        .join(&RECORD.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::{Mode, analyze};

    #[test]
    fn rows_round_trip_through_the_text_protocol() {
        let rows = read_rows("y = a x\u{1f}\u{1f}\u{1f}0\u{1e}a = 2\u{1f}\u{1f}\u{1f}1\u{1e}r = 2\u{1f}0\u{1f}π\u{1f}0\u{1e}\u{1f}\u{1f}\u{1f}0\u{1e}k");
        assert_eq!(rows.len(), 5);
        assert!(rows[1].hidden);
        assert_eq!(rows[2].to, "π");
        let text = write_outcomes(&analyze(Mode::Cartesian, &rows));
        let records: Vec<&str> = text.split(RECORD).collect();
        assert_eq!(records[0], "function\u{1f}x");
        assert_eq!(records[1], "param\u{1f}a\u{1f}2\u{1f}1");
        assert!(records[2].starts_with("polar\u{1f}0\u{1f}3.14159"));
        assert_eq!(records[3], "empty");
        assert_eq!(records[4], "error\u{1f}error.unknown\u{1f}k\u{1f}k");
        assert!(read_rows("").is_empty());
        assert_eq!(number(f64::NEG_INFINITY), "-Infinity");
    }

    #[test]
    fn surfaces_in_coordinates_read_a_second_range() {
        let rows = read_rows("r = 2\u{1f}\u{1f}π\u{1f}0\u{1f}-1\u{1f}3\u{1e}z = r^2\u{1f}\u{1f}\u{1f}0");
        assert_eq!((rows[0].from2.as_str(), rows[0].to2.as_str()), ("-1", "3"));
        assert!(rows[1].from2.is_empty() && rows[1].to2.is_empty());
        let text = write_outcomes(&analyze(Mode::Cylindrical, &rows));
        let records: Vec<&str> = text.split(RECORD).collect();
        assert!(records[0].starts_with("coords\u{1f}r\u{1f}φ\u{1f}z\u{1f}0\u{1f}3.14159"), "{}", records[0]);
        assert!(records[0].ends_with("\u{1f}-1\u{1f}3"));
        assert_eq!(records[1], "coords\u{1f}z\u{1f}φ\u{1f}r\u{1f}0\u{1f}6.283185307179586\u{1f}0\u{1f}Infinity");
        let torus = write_outcomes(&analyze(Mode::Space, &read_rows("((2 + cos v) cos u, (2 + cos v) sin u, sin v)\u{1f}\u{1f}π\u{1f}0\u{1f}-1\u{1f}")));
        assert_eq!(torus, "psurface\u{1f}0\u{1f}3.141592653589793\u{1f}-1\u{1f}6.283185307179586");
        let planes = read_rows("tangent(x y, 1, 2)\u{1f}\u{1f}\u{1f}0\u{1f}\u{1f}\u{1f}\u{1f}\u{1f}0\u{1f}0\u{1e}tangent(x y, 1, 2)");
        assert!(planes[0].hide_normal && !planes[1].hide_normal);
        assert_eq!(write_outcomes(&analyze(Mode::Space, &planes[..1])), "tplane\u{1f}2\u{1f}1\u{1f}1\u{1f}2\u{1f}2");
        let tables = read_rows("\u{1f}\u{1f}\u{1f}0\u{1f}\u{1f}\u{1f}\u{1f}\u{1f}0\u{1f}1\u{1f}1\u{1f}1\u{1d}2\u{1d}3\u{1d}k\u{1d}5\u{1f}1\u{1e}\u{1f}\u{1f}\u{1f}0\u{1f}\u{1f}\u{1f}\u{1f}\u{1f}0\u{1f}1\u{1f}1\u{1f}\u{1f}0");
        assert_eq!(tables[0].table.as_deref().map(<[_]>::len), Some(3));
        assert_eq!(tables[0].table.as_ref().unwrap()[2], ["5".to_string(), String::new()]);
        assert!(tables[0].connect && !tables[1].connect && tables[1].table.as_ref().is_some_and(Vec::is_empty));
        assert_eq!(write_outcomes(&analyze(Mode::Cartesian, &tables)), "table\u{1f}1\u{1f}3\u{1f}k\u{1e}table\u{1f}0\u{1f}\u{1f}");
        let sphere = write_outcomes(&analyze(Mode::Spherical, &read_rows("φ = π/4")));
        assert_eq!(sphere, "coords\u{1f}φ\u{1f}θ\u{1f}ρ\u{1f}0\u{1f}6.283185307179586\u{1f}0\u{1f}Infinity");
    }
}
