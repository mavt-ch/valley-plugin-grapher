// Every colour, radius and duration is an app design token so the plotter tracks both themes and the
// user's accent; curve colours are palette references resolved at draw time.
const CSS = `
.grapher-panel, .grapher-tab { display:flex; flex-direction:column; height:100%; min-height:0; }

/* The sidebar header: the shared 38px panel-header holding the coordinate-system switch. */
.grapher-header { gap:var(--space-2); }
.grapher-modes { display:flex; align-items:center; gap:2px; min-width:0; -webkit-app-region:no-drag; }
.grapher-mode { display:inline-flex; align-items:center; justify-content:center; width:28px; height:26px; flex:0 0 auto;
  padding:0; border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); cursor:pointer;
  transition:background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-mode svg { width:16px; height:16px; }
.grapher-mode:hover { background:var(--hover-bg); color:var(--text-color); }
.grapher-mode.active { background:var(--accent-tint-bg); color:var(--accent-tint-text); }
.grapher-mode:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }

.grapher-alert { flex:0 0 auto; margin:0; padding:var(--space-2) var(--space-3); border-bottom:1px solid var(--border-light);
  background:var(--danger-tint-bg); color:var(--danger-tint-text); font-size:var(--smaller-font-size); overflow-wrap:anywhere; }

/* ---- the expression list ---- */
.grapher-list { position:relative; flex:1 1 auto; min-height:0; overflow-y:auto; }
.grapher-list[data-dragging] { cursor:grabbing; user-select:none; }
.grapher-row { display:grid; grid-template-columns:16px 26px minmax(0, 1fr) 26px; align-items:start;
  border-bottom:1px solid var(--border-light); }
.grapher-row:focus-within { background:var(--hover-bg); }
.grapher-row[data-dragging] { opacity:0.45; }
.grapher-gutter { display:flex; flex-direction:column; align-items:center; gap:3px; padding-top:5px; min-height:34px; box-sizing:border-box; }

/* The drag handle at the left edge of every typed row; the marker shows the gap a dropped row lands in. */
.grapher-grip, .grapher-grip-spacer { width:16px; height:34px; }
.grapher-grip { display:inline-flex; align-items:center; justify-content:center; padding:0 0 0 2px; border:none; background:none;
  color:var(--text-tertiary); cursor:grab; opacity:0.45; touch-action:none;
  transition:opacity var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-grip svg { width:12px; height:12px; }
.grapher-row:hover .grapher-grip, .grapher-row[data-dragging] .grapher-grip { opacity:1; }
.grapher-grip:hover { color:var(--text-color); }
.grapher-list[data-dragging] .grapher-grip { cursor:grabbing; }
.grapher-drop-marker { position:absolute; left:0; right:0; height:2px; margin-top:-1.5px; background:var(--accent-color); pointer-events:none; z-index:1; }
.grapher-warning { display:inline-flex; color:var(--danger-tint-text); }
.grapher-warning svg { width:15px; height:15px; }
.grapher-swatch-hue { border-color:transparent;
  background:conic-gradient(hsl(0,70%,55%), hsl(60,70%,55%), hsl(120,70%,55%), hsl(180,70%,55%), hsl(240,70%,55%), hsl(300,70%,55%), hsl(360,70%,55%)); }
.grapher-swatch-hue[aria-pressed='false'] { background:transparent; border-color:var(--text-tertiary); }
.grapher-index { font-size:0.625rem; line-height:1; font-variant-numeric:tabular-nums; color:var(--text-tertiary); }
.grapher-swatch { width:16px; height:16px; padding:0; border:2px solid var(--swatch); border-radius:50%;
  background:var(--swatch); cursor:pointer; transition:background-color var(--duration-fast) var(--ease-out); }
.grapher-swatch[aria-pressed='false'] { background:transparent; }
.grapher-swatch:focus-visible { outline:2px solid var(--accent-color); outline-offset:2px; }
.grapher-row[data-hidden] .grapher-input { color:var(--text-secondary); }

.grapher-row-main { display:flex; flex-direction:column; gap:4px; min-width:0; padding:6px 0; }
.grapher-input { box-sizing:border-box; width:100%; min-width:0; height:24px; margin:0; padding:0 2px; border:none; outline:none;
  background:transparent; color:var(--text-color); font-family:var(--mono-font); font-size:0.8125rem; }
.grapher-input::placeholder { color:var(--text-tertiary); }

/* A row not being edited shows its typeset form; the transparent input lies on top, so a click edits it. */
.grapher-field { position:relative; min-width:0; }
.grapher-field[data-typeset] .grapher-input { position:absolute; inset:0; height:100%; opacity:0; }
.grapher-typeset { display:flex; align-items:center; min-height:24px; padding:0 2px; overflow:hidden; pointer-events:none; }
.gm-math { display:inline-flex; align-items:center; flex-wrap:nowrap; white-space:nowrap; color:var(--text-color);
  font-family:'Times New Roman', 'STIX Two Math', 'Cambria Math', serif; font-size:1rem; line-height:1.25; }
.grapher-row[data-hidden] .gm-math { color:var(--text-secondary); }
.gm-var { font-style:italic; padding-right:0.04em; }
.gm-num, .gm-sym, .gm-fn { font-style:normal; }
.gm-fn { padding-right:0.18em; }
.gm-call { display:inline-flex; align-items:center; }
.gm-call > .gm-sup { margin-left:-0.14em; margin-right:0.14em; }
.gm-op { padding:0 0.22em; }
.gm-rel { padding:0 0.3em; }
.gm-comma { padding-right:0.25em; }
.gm-sub { font-size:0.7em; vertical-align:-0.25em; font-style:normal; }
.gm-pow { display:inline-flex; align-items:flex-start; }
.gm-sup { font-size:0.72em; line-height:1; align-self:flex-start; margin-top:-0.15em; }
.gm-frac { display:inline-flex; flex-direction:column; align-items:center; vertical-align:middle; margin:0 0.12em; font-size:0.86em; }
.gm-frac-top, .gm-frac-bottom { display:inline-flex; align-items:center; padding:0 0.15em; }
.gm-frac-top { border-bottom:1px solid currentColor; padding-bottom:0.08em; }
.gm-frac-bottom { padding-top:0.08em; }
.gm-group { display:inline-flex; align-items:center; }
.gm-paren { display:inline-block; }
.gm-paren-tall { transform:scaleY(1.9); }
.gm-ghost { opacity:0.35; }
.gm-root { display:inline-flex; align-items:stretch; }
.gm-root-index { font-size:0.6em; margin-right:-0.35em; align-self:flex-start; }
.gm-radical { display:inline-flex; align-items:flex-end; }
.gm-radicand { display:inline-flex; align-items:center; border-top:1px solid currentColor; padding:0.06em 0.12em 0 0.06em; margin-top:0.08em; }
.grapher-delete, .grapher-row-spacer { width:26px; height:34px; }
.grapher-delete { display:inline-flex; align-items:center; justify-content:center; padding:0; border:none; background:none;
  color:var(--text-tertiary); cursor:pointer; opacity:0; transition:opacity var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-delete svg { width:14px; height:14px; }
.grapher-row:hover .grapher-delete, .grapher-row:focus-within .grapher-delete, .grapher-delete:focus-visible { opacity:1; }
.grapher-delete:hover { color:var(--text-color); }

.grapher-error { display:flex; flex-direction:column; gap:4px; font-size:var(--smaller-font-size); color:var(--danger-tint-text); }
.grapher-chips { display:flex; flex-wrap:wrap; gap:4px; }
.grapher-chip { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border:1px solid var(--border-medium);
  border-radius:var(--radius-sm); background:transparent; color:var(--text-color); font-size:var(--smaller-font-size); cursor:pointer; }
.grapher-chip svg { width:12px; height:12px; }
.grapher-chip:hover { background:var(--hover-bg); }
.grapher-value { font-family:var(--mono-font); font-size:var(--smaller-font-size); color:var(--text-secondary); padding:0 2px; }

.grapher-slider, .grapher-domain { display:flex; align-items:center; gap:6px; min-width:0; }
.grapher-bound { box-sizing:border-box; width:52px; flex:0 0 auto; height:22px; padding:0 4px; border:1px solid var(--border-light);
  border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); font-family:var(--mono-font); font-size:0.6875rem;
  text-align:center; -moz-appearance:textfield; }
.grapher-bound::-webkit-outer-spin-button, .grapher-bound::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
.grapher-bound:focus { outline:none; border-color:var(--accent-color); color:var(--text-color); }
.grapher-range-bound { width:64px; }
.grapher-domain-variable { font-family:var(--mono-font); font-size:0.75rem; color:var(--text-secondary); white-space:nowrap; }

/* Same 2px line and 10px thumb as the app's media slider; the fill comes from --slider-fill. */
.grapher-range { --slider-fill:0%; -webkit-appearance:none; appearance:none; flex:1 1 auto; min-width:40px; height:14px;
  margin:0; background:transparent; cursor:pointer; }
.grapher-range::-webkit-slider-runnable-track { height:14px;
  background-image:linear-gradient(var(--accent-color), var(--accent-color)), linear-gradient(var(--container-color-light), var(--container-color-light));
  background-size:var(--slider-fill) 2px, 100% 2px; background-position:left center, left center; background-repeat:no-repeat; }
.grapher-range::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:10px; height:10px; margin-top:2px;
  border-radius:50%; background:var(--accent-color); }
.grapher-range:focus-visible { outline:2px solid var(--accent-color); outline-offset:2px; border-radius:var(--radius-sm); }

.grapher-hint { margin:0; padding:var(--space-3); font-size:0.6875rem; line-height:1.5; color:var(--text-tertiary); }
.grapher-menu-swatch { display:inline-block; width:12px; height:12px; border-radius:50%; }

/* ---- the graph tab ---- */
.grapher-topbar { position:relative; display:flex; align-items:center; box-sizing:border-box; height:var(--app-bar-height);
  min-height:var(--app-bar-height); flex:0 0 var(--app-bar-height); border-bottom:1px solid var(--border-light);
  padding:0 calc(var(--plugin-actions-offset, 0px) + var(--space-3)) 0 calc(var(--plugin-navigation-offset, 0px) + var(--space-3));
  background:var(--container-color-alt); }
.grapher-topbar-title { position:absolute; left:50%; transform:translateX(-50%); color:var(--text-secondary);
  font-size:var(--smaller-font-size); white-space:nowrap; pointer-events:none; }
.grapher-stage { position:relative; display:flex; flex:1 1 auto; min-height:0; }
.grapher-canvas-wrap { position:relative; flex:1 1 auto; min-width:0; min-height:0; overflow:hidden; }
.grapher-canvas { position:absolute; inset:0; display:block; width:100%; height:100%; background:var(--surface-color-alt);
  cursor:crosshair; touch-action:none; outline:none; }
.grapher-canvas:active { cursor:grabbing; }
.grapher-canvas-space { cursor:grab; }
.grapher-zoom { position:absolute; right:var(--space-3); top:var(--space-3); display:flex; flex-direction:column; gap:6px; z-index:1; }
.grapher-zoom-button { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; padding:0;
  border:1px solid var(--border-light); border-radius:50%; background:var(--container-color-alt); color:var(--text-secondary);
  cursor:pointer; transition:background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-zoom-button svg { width:15px; height:15px; }
.grapher-zoom-button:hover { background:var(--hover-bg); color:var(--text-color); }
.grapher-zoom-button:focus-visible { outline:2px solid var(--accent-color); outline-offset:2px; }

@media (prefers-reduced-motion: reduce) {
  .grapher-mode, .grapher-swatch, .grapher-delete, .grapher-grip, .grapher-zoom-button { transition:none; }
}
`

export function injectStyles(): () => void {
  const id = 'grapher-styles'
  // Rewrite in place, so a hot reload never keeps a stale sheet.
  const existing = document.getElementById(id)
  const element = existing ?? document.createElement('style')
  element.id = id
  if (element.textContent !== CSS) element.textContent = CSS
  if (!existing) document.head.appendChild(element)
  return () => {
    if (document.getElementById(id) === element) element.remove()
  }
}
