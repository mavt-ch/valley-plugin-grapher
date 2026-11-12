# Grapher

Plot functions in Cartesian, polar, parametric, 3D, cylindrical, spherical and complex coordinates, with live sliders and a zoomable graph.

## Use

Open **Grapher** in the left sidebar. The dropdown in the header picks the view; each one keeps its own expressions. On flat views the **ℝ | π** switch beside it labels the axes in real numbers or in multiples of π (π/2, π, 2π …); only the labels change, so trigonometric functions use the Cartesian view with π selected (an older Trigonometric sheet opens there):

| System | Grid | Typical rows |
| --- | --- | --- |
| Cartesian | decimal, or the x-axis in multiples of π | `y = x^2`, `x = y^2`, `f(x) = sin x`, `tan x`, `x^2 + y^2 = 4`, `(1, 2)` |
| Polar | circles and rays labelled in radians (fractions of π or decimals) | `r = 1 + cos(θ)` (type `theta` or `t` for θ) |
| Parametric | decimal | `(cos(3t), sin(2t))` |
| 3D | cube with floor grid, drag to orbit | `z = x^2 + y^2` or just `x^2 + y^2`, `x = y z`, `(cos t, sin t, t)`, `(1, 2, 3)` |
| Cylindrical | the 3D cube, drag to orbit | `r = 2`, `z = r^2`, `r = 1 + cos(φ)`, `z = φ / 2`, `φ = π/4`, `(r, φ, z)` points |
| Spherical | the 3D cube, drag to orbit | `ρ = 2`, `ρ = 1 + cos(θ)`, `φ = π/4`, `θ = π/3`, `(ρ, θ, φ)` points |
| Complex | Gaussian plane, imaginary axis in multiples of i | `3 - 2i`, `w = 2e^(iπ/3)`, `r(cos φ + i sin φ)`, `\|z + 2\| < 3`, `Re(z) ≥ 1`, `arg(z) < π/4`, `\|z - i\| = \|z + 1\|` |
| Complex 3D | complex plane as the floor of the cube, drag to orbit | `w = (z^2 - 4) / 4`, `f(z) = 1/z`, `Re(z^2)`, `Im(e^z)`, `1 + 2i` |

The cylindrical sheet reads (r, φ, z): r is the distance from the z-axis, φ the azimuth in the xy-plane measured from +x, z the height, so (r, φ, z) is the point (r cos φ, r sin φ, z). A row gives one coordinate as a function of the other two (`r = 2` is a cylinder, `z = r^2` a paraboloid, `z = φ / 2` a helicoid, `φ = π/4` a half-plane); a bare expression gives z, as on the 3D sheet. Under each surface two range rows set the other two coordinates: φ runs from 0 to 2π, while r (from 0) and z left open reach to the edge of the cube, as does `∞` typed as a bound. `phi` and `theta` both read as φ, `rho` as r.

The spherical sheet reads (ρ, θ, φ) in the mathematics convention: ρ is the distance from the origin, θ the azimuth in the xy-plane measured from +x (as φ on the cylindrical sheet) and φ the polar angle measured from +z, so (ρ, θ, φ) is the point (ρ sin φ cos θ, ρ sin φ sin θ, ρ cos φ) and `φ = π/4` is the cone about the positive z-axis. The physics convention swaps the two angle names; the hint text states which is used. A bare expression gives ρ, as on the polar sheet; θ runs from 0 to 2π, φ from 0 to π, and ρ left open reaches to the corners of the cube. `rho`, `theta` and `phi` are typed as words, and `r` reads as ρ. The fresh sheet draws an ice-cream cone: the cap `ρ = 2` with 0 ≤ φ ≤ π/4 on the cone `φ = π/4` with 0 ≤ ρ ≤ 2.

Both are their own views rather than row types of the 3D view because the sheets read the same names differently: on the 3D sheet φ and ρ are free names that become sliders, r is reserved for polar rows, and a bare expression is a function of x and y; a separate view keeps its coordinates reserved, its own surface rule and its own examples without changing what an existing 3D row means.

On the complex 3D sheet `w = f(z)` (or a bare expression in `z`, or `f(z) = …`) rises to |f(z)| and is coloured by arg f(z) around the colour wheel, red for positive real values; a real-valued row such as `Re(z^2) / 5` or `x y / 4` rises to its signed value instead, and a number sits on the floor as a point.

Rows not being edited are typeset as in a textbook: `x^2/3` shows a stacked fraction with a superscript, `sqrt(x)` a radical, `theta` θ, `<=` ≤, function names upright and variables italic; clicking a row shows the text to edit. Each row's gutter shows its number, which turns into a grip on hover: drag it to move the row up or down. The colour swatch beside it shows or hides the graph and its context menu picks the colour; the × on the right deletes the row.

Inequalities such as `y > x^2` or `x^2 + y^2 ≤ 4` shade their region, with a dashed boundary when it is excluded. On the complex sheet every number is drawn as an arrow from 0 and shown in both forms (`1 + 1.732i = 2·e^(iπ/3)`), `Re`, `Im`, `conj` and `arg` are available, and a relation in `z` (or its parts `x` and `y`) draws its region, or only its boundary with `=`. A row `a = 1` becomes a slider, and every undefined name offers one. Polar and parametric rows set their range below the input (default 0 to 2π); a surface over two coordinates has two range rows, saved as `from`/`to` and `from2`/`to2` (files without the second pair still load). Rows may use `π`, `e`, `|x|`, `x!`, `sqrt`, `cbrt`, `ln`, `log`, `exp`, the trigonometric, inverse and hyperbolic functions, `min`, `max`, `mod`, `floor`, `ceil`, `round` and `sign`; `2x`, `sin 2x`, `sin^2 x` and `sin^-1 x` read as usual. Input is forgiving: Greek letters and constants may be typed as words in any case (`theta`, `Phi`, `PI`, `inf`), `30°` or `30deg` is in degrees, `log_2 x`, `root(x, 3)`, `∛x`, `x⁻¹` and `f(x) := …` work, parentheses and bars left open at the end close themselves, stray closing parentheses at the end are ignored, `0,5` outside parentheses is a decimal comma, and `x2` means `x²` for the plot variables `x`, `y`, `t` and `θ`. Enter adds a row, Backspace on an empty row removes it, the swatch shows or hides a graph and its context menu picks the colour.

The open-page button in the header opens the graph in the workspace: drag to pan, scroll or pinch to zoom about the pointer, hover a graph to read its coordinates, or use the arrow keys, `+`, `−` and `0` with the graph focused. Sheets are saved to `.valley/plugins/data/grapher/graphs.json`.

## Install

Copy this repository into `<realm>/.valley/plugins/packages/local/grapher`. The compiled `runtime/` (`index.js`, locales and `assets/plot.wasm`) is included; Valley does not install dependencies or compile plugins on load.

## Development

Use Node 24.19.0 and npm 11.17.0, plus rustup: `rust-toolchain.toml` selects Rust 1.99.1 with the `wasm32-unknown-unknown` target, and the build needs binaryen's `wasm-opt` version 133 (`VALLEY_WASM_OPT` or on `PATH`). Run `npm ci` and `npm run check` in this directory; it lints, typechecks, builds the WebAssembly module twice to prove the bytes are reproducible, bundles `runtime/index.js` and runs the tests against the built module. When the Rust source changes, the build reports the new module digest: record it as `runtime.wasm[0].sha256` in `config.json`.

The plotting kernel lives in `src/wasm` (Rust): the lexer and parser, the sheet analysis that resolves parameters and user functions, the adaptive sampler for functions, polar and parametric curves, implicit equations and inequalities (marching squares, joined into polylines, and filled regions), complex arithmetic with principal values for the complex sheet, and the 3D renderer that samples surfaces on a grid, clips surfaces and space curves to the visible cube (surfaces in cylindrical and spherical coordinates on all three axes), projects them for the orbiting camera, shades them and orders them back to front. Run its unit tests from `src/wasm` with host flags, since `.cargo/config.toml` carries the WebAssembly link arguments:

```bash
RUSTFLAGS="-Cdebuginfo=0" cargo test
```

The TypeScript side (`src/`) holds the store, the sidebar and its typesetting (`MathText.tsx`), the plane and 3D canvases, the axis ticks and the localization in five languages. Each view has its own folder under `src/views/` (`cartesian`, `polar`, `parametric`, `space`, `cylindrical`, `spherical`, `complex`, `complexSpace`) with its icon, example rows, kernel mode, grid and default axis labels or 3D axis names, registered in `src/views/index.ts`. A new view adds its id to `src/views/types.ts`, a folder, a registry entry, a kernel mode in `src/wasm/src/sheet.rs` and the locale keys `mode.<id>`, `mode.<id>.hint` and `hint.<id>`.
