// Every colour, radius and duration is an app design token so the plotter tracks both themes and the
// user's accent; curve colours are palette references resolved at draw time.
const CSS = `
.grapher-panel, .grapher-tab { display:flex; flex-direction:column; height:100%; min-height:0; }

/* The sidebar header: the shared 38px panel-header; the view button fills the row up to the bookmark and open buttons. */
.grapher-header { gap:var(--space-2); }
.grapher-header-spacer { flex:1 1 auto; }
.grapher-view-picker { display:inline-flex; align-items:center; gap:6px; flex:1 1 auto; min-width:0; height:26px; text-align:left; padding:0 6px 0 7px;
  border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-color); font:inherit;
  font-size:var(--smaller-font-size); font-weight:500; cursor:pointer; -webkit-app-region:no-drag;
  transition:background-color var(--duration-fast) var(--ease-out); }
.grapher-view-picker:hover, .grapher-view-picker[aria-expanded='true'] { background:var(--hover-bg); }
.grapher-view-picker:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }
.grapher-view-icon { width:16px; height:16px; flex:0 0 auto; color:var(--accent-tint-text); }
.grapher-view-name { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.grapher-view-chevron { width:12px; height:12px; flex:0 0 auto; margin-left:auto; color:var(--text-tertiary); }
.grapher-units { display:inline-flex; align-items:center; flex:0 0 auto; height:24px; padding:2px; box-sizing:border-box;
  border-radius:var(--radius-sm); background:var(--container-color-light); -webkit-app-region:no-drag; }
.grapher-unit { display:inline-flex; align-items:center; justify-content:center; min-width:24px; height:20px; padding:0 5px;
  border:none; border-radius:calc(var(--radius-sm) - 1px); background:transparent; color:var(--text-secondary);
  font-family:'Times New Roman', 'STIX Two Math', serif; font-size:0.875rem; line-height:1; cursor:pointer;
  transition:background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-unit:hover { color:var(--text-color); }
.grapher-unit.active { background:var(--surface-color-alt); color:var(--text-color); box-shadow:0 0 0 1px var(--border-light); }
.grapher-unit:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }

/* The views, in place of the expressions while the view button is open. */
.grapher-views { flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:1px; padding:6px; }
.grapher-view-option { display:grid; grid-template-columns:20px minmax(0, 1fr) 16px; align-items:center; gap:10px; width:100%;
  padding:8px 8px 8px 10px; border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-color);
  font:inherit; text-align:left; cursor:pointer; transition:background-color var(--duration-fast) var(--ease-out); }
.grapher-view-option:hover { background:var(--hover-bg); }
.grapher-view-option.active { background:var(--container-color-light); }
.grapher-view-option:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }
.grapher-view-option-icon { width:18px; height:18px; color:var(--text-secondary); }
.grapher-view-option.active .grapher-view-option-icon { color:var(--accent-tint-text); }
.grapher-view-option-text { display:flex; flex-direction:column; gap:2px; min-width:0; }
.grapher-view-option-name { font-size:var(--smaller-font-size); font-weight:500; }
.grapher-view-option-hint { font-size:0.75rem; color:var(--text-tertiary); line-height:1.35; overflow-wrap:anywhere; }
.grapher-view-option-check { width:14px; height:14px; color:var(--accent-tint-text); }

/* The insert bar: one 38px row of quiet glyph buttons under the header; too many for the width scroll sideways. */
.grapher-insert-bar { display:flex; align-items:center; gap:2px; flex:0 0 var(--app-bar-height); height:var(--app-bar-height);
  box-sizing:border-box; padding:0 var(--space-2); border-bottom:1px solid var(--border-light); overflow-x:auto; overflow-y:hidden;
  white-space:nowrap; scrollbar-width:none; }
.grapher-insert-bar::-webkit-scrollbar { display:none; }
.grapher-insert { display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; min-width:26px; height:26px;
  padding:0 5px; border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); cursor:pointer;
  -webkit-app-region:no-drag; transition:background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-insert:hover { background:var(--hover-bg); color:var(--text-color); }
.grapher-insert:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }
.grapher-insert-glyph { font-family:'Times New Roman', 'STIX Two Math', 'Cambria Math', serif; font-size:0.9375rem; line-height:1; }
.grapher-insert-icon { width:15px; height:15px; }

/* The reference in the right sidebar: groups of syntax, one sentence and an example that inserts itself. */
.grapher-reference { flex:1 1 auto; min-height:0; overflow-y:auto; padding:6px 0 var(--space-3); }
.grapher-ref-search { position:sticky; top:0; z-index:1; border-bottom:1px solid var(--border-light); background:var(--container-color-alt); }
.grapher-ref-empty { margin:0; padding:var(--space-3); font-size:0.75rem; color:var(--text-tertiary); }
.grapher-ref-search .search-field { flex:1 1 auto; width:auto; }
.grapher-ref-all { display:inline-flex; align-items:center; justify-content:center; flex:0 0 26px; width:26px; height:26px; padding:0;
  border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); cursor:pointer;
  transition:background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-ref-all svg { width:15px; height:15px; }
.grapher-ref-all:hover:not(:disabled) { background:var(--hover-bg); color:var(--text-color); }
.grapher-ref-all:disabled { opacity:0.4; cursor:default; }
.grapher-ref-group { padding:0 6px; }
.grapher-ref-heading { display:flex; align-items:center; gap:6px; width:100%; height:28px; padding:0 6px; border:none;
  border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); font:inherit; font-size:var(--smaller-font-size);
  font-weight:500; text-align:left; cursor:pointer; transition:background-color var(--duration-fast) var(--ease-out); }
.grapher-ref-heading:hover { background:var(--hover-bg); color:var(--text-color); }
.grapher-ref-heading:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }
.grapher-ref-chevron { width:12px; height:12px; flex:0 0 auto; color:var(--text-tertiary); transform:rotate(-90deg);
  transition:transform var(--duration-fast) var(--ease-out); }
.grapher-ref-heading[aria-expanded='true'] .grapher-ref-chevron { transform:none; }
.grapher-ref-entries { margin:0 0 6px; padding:0; list-style:none; }
.grapher-ref-entry { display:flex; flex-direction:column; gap:2px; padding:5px 6px 5px 24px; }
.grapher-ref-syntax { font-family:var(--mono-font); font-size:0.8125rem; color:var(--text-color); overflow-wrap:anywhere; }
.grapher-ref-text { font-size:0.75rem; line-height:1.4; color:var(--text-secondary); }
.grapher-ref-examples { display:flex; flex-wrap:wrap; gap:2px 6px; }
.grapher-ref-example { padding:1px 4px; margin-left:-4px; border:none; border-radius:var(--radius-sm); background:transparent;
  color:var(--accent-tint-text); font-family:var(--mono-font); font-size:0.75rem; text-align:left; cursor:pointer; overflow-wrap:anywhere;
  transition:background-color var(--duration-fast) var(--ease-out); }
.grapher-ref-example:hover:not(:disabled) { background:var(--hover-bg); }
.grapher-ref-example:disabled { color:var(--text-tertiary); cursor:default; }
.grapher-ref-example:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }

/* The Notes tab in Properties: the view's icon and name, then the note. */
.grapher-notes-action { display:inline-flex; align-items:center; justify-content:center; flex:0 0 26px; width:26px; height:26px; padding:0;
  border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); cursor:pointer;
  transition:background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-notes-action svg { width:15px; height:15px; }
.grapher-notes-action:hover { background:var(--hover-bg); color:var(--text-color); }
.grapher-notes-bar { display:flex; align-items:center; gap:6px; flex:0 0 var(--app-bar-height); height:var(--app-bar-height);
  box-sizing:border-box; padding:0 var(--space-2) 0 var(--space-3); border-bottom:1px solid var(--border-light); }
.grapher-notes-scope .grapher-unit { font-family:inherit; font-size:0.75rem; }
.grapher-notes-icon { width:15px; height:15px; flex:0 0 15px; color:var(--text-secondary); }
.grapher-notes-title { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:var(--smaller-font-size); font-weight:500; color:var(--text-color); }
.grapher-notes-field, .grapher-notes-field:is(:hover, :focus, :focus-visible) { flex:1 1 auto; min-height:0; width:100%; box-sizing:border-box; margin:0;
  padding:var(--space-3); border:none; outline:none; box-shadow:none; background:transparent; resize:none; color:var(--text-color);
  font:inherit; font-size:var(--smaller-font-size); line-height:1.55; }
.grapher-notes-field::placeholder { color:var(--text-tertiary); }
.grapher-notes-preview { flex:1 1 auto; min-height:0; overflow-y:auto; padding:var(--space-3); font-size:var(--smaller-font-size); }
.grapher-notes-empty { margin:0; color:var(--text-tertiary); }

.grapher-alert { flex:0 0 auto; margin:0; padding:var(--space-2) var(--space-3); border-bottom:1px solid var(--border-light);
  background:var(--danger-tint-bg); color:var(--danger-tint-text); font-size:var(--smaller-font-size); overflow-wrap:anywhere; }

/* ---- the expression list ---- */
.grapher-list { position:relative; flex:1 1 auto; min-height:0; overflow-y:auto; }
.grapher-list[data-dragging] { cursor:grabbing; user-select:none; }
.grapher-row { display:grid; grid-template-columns:46px minmax(0, 1fr) 28px; align-items:start;
  border-bottom:1px solid var(--border-light); }
.grapher-row:focus-within { background:var(--hover-bg); }
.grapher-row[data-dragging] { opacity:0.45; }
.grapher-gutter { display:flex; align-items:center; height:36px; padding-left:4px; box-sizing:border-box; }

/* Gutter, all on the expression's first line: the row number, which turns into the drag grip on hover, then the
   colour swatch (or a warning). The marker shows the gap a dropped row lands in. */
.grapher-handle { position:relative; display:inline-flex; align-items:center; justify-content:center; width:18px; height:36px;
  flex:0 0 auto; padding:0; border:none; background:none; color:var(--text-tertiary); touch-action:none; }
button.grapher-handle { cursor:grab; }
.grapher-list[data-dragging] button.grapher-handle { cursor:grabbing; }
.grapher-grip-icon { position:absolute; width:12px; height:12px; opacity:0; transition:opacity var(--duration-fast) var(--ease-out); }
.grapher-handle .grapher-index { transition:opacity var(--duration-fast) var(--ease-out); }
.grapher-row:hover button.grapher-handle .grapher-index, .grapher-row[data-dragging] .grapher-handle .grapher-index { opacity:0; }
.grapher-row:hover .grapher-grip-icon, .grapher-row[data-dragging] .grapher-grip-icon { opacity:1; }
button.grapher-handle:hover { color:var(--text-color); }
.grapher-mark { display:inline-flex; align-items:center; justify-content:center; width:22px; height:36px; flex:0 0 auto; }
.grapher-drop-marker { position:absolute; left:0; right:0; height:2px; margin-top:-1.5px; background:var(--accent-color); pointer-events:none; z-index:1; }
.grapher-warning { display:inline-flex; color:var(--danger-tint-text); }
.grapher-warning svg { width:15px; height:15px; }
.grapher-swatch-hue { border-color:transparent;
  background:conic-gradient(hsl(0,70%,55%), hsl(60,70%,55%), hsl(120,70%,55%), hsl(180,70%,55%), hsl(240,70%,55%), hsl(300,70%,55%), hsl(360,70%,55%)); }
.grapher-swatch-hue[aria-pressed='false'] { background:transparent; border-color:var(--text-tertiary); }
.grapher-index { font-size:0.6875rem; line-height:1; font-variant-numeric:tabular-nums; color:var(--text-tertiary); }
.grapher-swatch { width:14px; height:14px; padding:0; border:2px solid var(--swatch); border-radius:50%;
  background:var(--swatch); cursor:pointer; transition:background-color var(--duration-fast) var(--ease-out); }
.grapher-swatch[aria-pressed='false'] { background:transparent; }
.grapher-swatch:focus-visible { outline:2px solid var(--accent-color); outline-offset:2px; }
.grapher-row[data-hidden] .grapher-input { color:var(--text-secondary); }

.grapher-row-main { display:flex; flex-direction:column; gap:4px; min-width:0; padding:6px 0; }
.grapher-input { box-sizing:border-box; width:100%; min-width:0; height:24px; margin:0; padding:0 2px; border:none; outline:none;
  background:transparent; color:var(--text-color); font-family:var(--mono-font); font-size:0.8125rem; }
.grapher-input::placeholder { color:var(--text-tertiary); }
/* The row field is borderless: the caret is its only focus sign. The host's base sheet rings every focused input
   (':root :where(input…):focus-visible', also after a programmatic focus such as an insert-bar click), so it is undone here. */
.grapher-panel .grapher-input:is(:focus, :focus-visible) { outline:none; border:none; box-shadow:none; background:transparent; }
.grapher-panel .grapher-bound:is(:focus, :focus-visible) { outline:none; box-shadow:none; }

/* A row not being edited shows its typeset form; the transparent input lies on top, so a click edits it. */
.grapher-field { position:relative; min-width:0; }
.grapher-field[data-typeset] .grapher-input { position:absolute; inset:0; height:100%; opacity:0; }
.grapher-typeset { display:flex; align-items:center; min-height:24px; padding:0 2px; overflow:hidden; pointer-events:none; }
.gm-math { display:inline-flex; align-items:center; flex-wrap:nowrap; white-space:nowrap; color:var(--text-color);
  font-family:'Times New Roman', 'STIX Two Math', 'Cambria Math', serif; font-size:1rem; line-height:1.25; }
.grapher-row[data-hidden] .gm-math { color:var(--text-secondary); }
.gm-var { font-style:italic; padding-right:0.04em; }
.gm-num, .gm-sym, .gm-fn { font-style:normal; }
.gm-vec { font-style:normal; font-weight:700; }
.gm-fn { padding-right:0.18em; }
.gm-call { display:inline-flex; align-items:center; }
.gm-var + .gm-call, .gm-num + .gm-call, .gm-pow + .gm-call, .gm-group + .gm-call { margin-left:0.16em; }
.gm-sign { padding-right:0.04em; }
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
.gm-prime { padding-left:0.04em; }
.gm-int { display:inline-flex; align-items:stretch; padding:0.12em 0; }
.gm-int-sign { display:inline-flex; align-items:center; font-size:1.35em; line-height:1.15; font-style:italic; }
.gm-int-limits { display:inline-flex; flex-direction:column; justify-content:space-between; font-size:0.62em; line-height:1; margin:0 0.32em 0 0.06em; }
.gm-int-from { margin-left:-0.32em; }
.gm-int-body { display:inline-flex; align-items:center; }
.gm-dx { display:inline-flex; align-items:center; margin-left:0.3em; }
.gm-series { display:inline-flex; align-items:center; padding:0.1em 0; }
.gm-series-op { display:inline-flex; flex-direction:column; align-items:center; line-height:1; margin:0 0.2em 0 0.04em; }
.gm-series-sign { font-size:1.4em; line-height:1; }
.gm-series-to, .gm-series-from { display:inline-flex; align-items:center; font-size:0.6em; white-space:nowrap; }
.gm-series-from .gm-rel { padding:0 0.12em; }
.gm-series-body { display:inline-flex; align-items:center; }
.gm-cases { display:inline-flex; align-items:center; padding:0.1em 0; }
.gm-cases-brace { display:inline-block; margin-right:0.18em; line-height:1; }
.gm-cases-rows { display:inline-grid; grid-template-columns:auto auto; column-gap:0.9em; row-gap:0.08em; font-size:0.86em; }
.gm-cases-row { display:contents; }
.gm-cases-value, .gm-cases-condition { display:inline-flex; align-items:center; }
.gm-cases-otherwise { font-style:normal; }
.grapher-delete, .grapher-row-spacer { width:28px; height:36px; }
/* The empty last row: a table of points where the view takes them. */
.grapher-row[data-trailing] { grid-template-columns:46px minmax(0, 1fr) auto; }
.grapher-delete { display:inline-flex; align-items:center; justify-content:center; padding:0; border:none; background:none;
  color:var(--text-tertiary); cursor:pointer; opacity:0; transition:opacity var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-delete svg { width:14px; height:14px; }
.grapher-row:hover .grapher-delete, .grapher-row:focus-within .grapher-delete, .grapher-delete:focus-visible { opacity:1; }
.grapher-delete:hover { color:var(--text-color); }
.grapher-row-menu svg { width:13px; height:13px; }

/* The header's bookmark toggle beside the view button: outlined while closed, filled in the accent tint while the list is open. */
.grapher-bookmarks-toggle { display:inline-flex; align-items:center; justify-content:center; flex:0 0 26px; width:26px; height:26px; padding:0;
  border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); cursor:pointer; -webkit-app-region:no-drag;
  transition:background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-bookmarks-toggle svg { width:14px; height:14px; }
.grapher-bookmarks-toggle:hover { background:var(--hover-bg); color:var(--text-color); }
.grapher-bookmarks-toggle[aria-pressed='true'] { color:var(--accent-tint-text); }
.grapher-bookmarks-toggle:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }

/* The bookmark list (Map's Favorites): a 38px bar, then groups with one level of subgroups and their bookmarks. */
.grapher-bookmarks { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; }
.grapher-bookmarks-bar { display:flex; align-items:center; gap:6px; flex:0 0 var(--app-bar-height); height:var(--app-bar-height); box-sizing:border-box;
  padding:0 var(--space-2) 0 10px; border-bottom:1px solid var(--border-light); }
.grapher-bookmarks-title { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.grapher-bookmarks-bar .panel-tool-btn svg { width:16px; height:16px; }
.grapher-bookmarks-empty { margin:0; padding:var(--space-3); font-size:0.75rem; line-height:1.45; color:var(--text-tertiary); }
.grapher-bookmark-tree { position:relative; flex:1 1 auto; min-height:40px; overflow-y:auto; padding:4px 0 24px; }
.grapher-bookmark-row { position:relative; display:flex; align-items:center; gap:8px; min-width:0; min-height:32px; box-sizing:border-box;
  padding:2px 6px 2px calc(8px + var(--bookmark-depth, 0) * 16px); cursor:pointer; color:var(--text-color);
  -webkit-user-select:none; user-select:none; transition:background-color var(--duration-fast) var(--ease-out); }
.grapher-bookmark-name-field { -webkit-user-select:text; user-select:text; }
.grapher-bookmark-row:hover { background:var(--hover-bg); }
.grapher-bookmark-row:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }
.grapher-bookmark-slot { display:inline-flex; align-items:center; justify-content:center; flex:0 0 14px; width:14px; height:14px; margin-right:-4px; color:var(--text-tertiary); }
button.grapher-bookmark-chevron { padding:0; border:none; border-radius:var(--radius-sm); background:transparent; font:inherit; cursor:pointer; }
button.grapher-bookmark-chevron:hover { color:var(--text-color); }
.grapher-bookmark-slot svg { width:12px; height:12px; transform:rotate(-90deg); transition:transform var(--duration-fast) var(--ease-out); }
.grapher-bookmark-chevron[data-open] svg { transform:none; }
.grapher-bookmark-folder { flex:0 0 15px; width:15px; height:15px; color:var(--text-secondary); }
.grapher-bookmark-name { flex:1 1 auto; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:0.8125rem; font-weight:500; }
.grapher-bookmark-name-field, .grapher-bookmark-name-field:is(:focus, :focus-visible) { flex:1 1 auto; min-width:0; height:24px; padding:0; border:none; outline:none;
  box-shadow:none; background:transparent; color:var(--text-color); font:inherit; font-size:0.8125rem; font-weight:500; }
.grapher-bookmark-expression-field, .grapher-bookmark-expression-field:is(:focus, :focus-visible) { font-family:var(--mono-font); font-weight:400; }
.grapher-bookmark-count { flex:0 0 auto; font-size:0.6875rem; font-variant-numeric:tabular-nums; color:var(--text-tertiary); }
.grapher-bookmark-swatch { flex:0 0 10px; width:10px; height:10px; box-sizing:border-box; border-radius:50%; border:2px solid var(--swatch); background:transparent; }
/* A bookmark the view shown holds: a filled swatch and a tick, never a highlighted row. */
.grapher-bookmark-row.selected .grapher-bookmark-swatch { background:var(--swatch); }
.grapher-bookmark-check { flex:0 0 14px; width:14px; height:14px; color:var(--accent-tint-text); }
.grapher-bookmark-math { flex:1 1 auto; min-width:0; overflow:hidden; display:flex; align-items:center; }
.grapher-bookmark-math .gm-math { font-size:0.9375rem; }
.grapher-bookmark-table { display:inline-flex; align-items:center; gap:6px; font-size:0.8125rem; color:var(--text-secondary); }
.grapher-bookmark-table svg { width:14px; height:14px; }
.grapher-bookmark-view { display:inline-flex; flex:0 0 auto; color:var(--text-tertiary); }
.grapher-bookmark-needs { flex:0 1 auto; min-width:0; max-width:40%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;
  font-family:'Times New Roman', 'STIX Two Math', serif; font-style:italic; font-size:0.8125rem; color:var(--text-tertiary); }
.grapher-bookmark-note { display:inline-flex; flex:0 0 auto; color:var(--text-tertiary); }
.grapher-bookmark-note svg { width:14px; height:14px; }
.grapher-bookmark-view svg { width:14px; height:14px; }
.grapher-bookmark-more { display:inline-flex; align-items:center; justify-content:center; flex:0 0 24px; width:24px; height:24px; padding:0;
  border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-tertiary); cursor:pointer; opacity:0;
  transition:opacity var(--duration-fast) var(--ease-out); }
.grapher-bookmark-more svg { width:15px; height:15px; }
.grapher-bookmark-row:hover .grapher-bookmark-more, .grapher-bookmark-row:focus-within .grapher-bookmark-more, .grapher-bookmark-more:focus-visible { opacity:1; }
.grapher-bookmark-more:hover { background:var(--container-color-alt); color:var(--text-color); }
.grapher-bookmark-row.drop-before::before, .grapher-bookmark-row.drop-after::before { content:''; position:absolute; z-index:2; height:2px; right:0;
  left:calc(8px + var(--bookmark-depth, 0) * 16px); background:var(--accent-color); pointer-events:none; }
.grapher-bookmark-row.drop-before::before { top:0; transform:translateY(-50%); }
.grapher-bookmark-row.drop-after::before { bottom:0; transform:translateY(50%); }
.grapher-bookmark-row.drop-inside, .grapher-bookmark-row.drop-inside:hover { background:var(--accent-tint-bg); box-shadow:inset 0 0 0 1px var(--accent-color); }
.grapher-bookmark-tree.drop-root::after { content:''; position:absolute; left:8px; right:0; bottom:24px; height:2px; background:var(--accent-color); pointer-events:none; }

.grapher-colors { display:flex; flex-direction:column; gap:2px; padding:4px 0; }
.grapher-color-row { position:relative; display:flex; align-items:center; gap:8px; min-height:32px; padding:0 4px; border-radius:var(--radius-sm); }
.grapher-color-row[data-drop-position='before']::before, .grapher-color-row[data-drop-position='after']::before { content:''; position:absolute; left:0; right:0; height:2px;
  background:var(--accent-color); pointer-events:none; }
.grapher-color-row[data-drop-position='before']::before { top:-1px; }
.grapher-color-row[data-drop-position='after']::before { bottom:-1px; }
.grapher-color-row[data-reorder-active] { opacity:0.5; }
.grapher-color-grip { display:inline-flex; align-items:center; justify-content:center; flex:0 0 20px; width:20px; height:24px; padding:0; border:none;
  background:transparent; color:var(--text-tertiary); cursor:grab; }
.grapher-color-grip svg { width:14px; height:14px; }
.grapher-color-dot { flex:0 0 12px; width:12px; height:12px; border-radius:50%; }
.grapher-color-name { flex:1 1 auto; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:var(--smaller-font-size); color:var(--text-color); }
.grapher-color-empty { color:var(--text-tertiary); }
.grapher-color-select { flex:1 1 auto; min-width:0; display:flex; }
.grapher-color-select .select-field { flex:1 1 auto; min-width:0; }

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
.grapher-levels-count { width:40px; }
.grapher-bound:disabled { opacity:0.45; }
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

.grapher-slider-block { display:flex; flex-direction:column; gap:2px; min-width:0; }
/* A slider row has no swatch, so the bar reaches back under the gutter's swatch column and out under the delete button. */
.grapher-row[data-kind='param'] .grapher-slider-block { margin:0 -26px 0 -24px; }
/* The bounds sit under the ends of the bar as small numbers; they show a field only on hover or while typed into. */
.grapher-slider-bounds { display:flex; justify-content:space-between; gap:8px; padding:0 28px; }
.grapher-slider-bound { box-sizing:border-box; width:72px; height:20px; margin:0 -5px; padding:0 4px; border:1px solid transparent;
  border-radius:var(--radius-sm); background:transparent; color:var(--text-tertiary); font-family:var(--mono-font); font-size:0.6875rem; }
.grapher-slider-bound-end { text-align:right; }
.grapher-slider-bound:hover { border-color:var(--border-light); color:var(--text-secondary); }
.grapher-panel .grapher-slider-bound:is(:focus, :focus-visible) { outline:none; box-shadow:none; border-color:var(--accent-color); color:var(--text-color); }
.grapher-panel .grapher-slider-bound[aria-invalid='true'] { border-color:var(--danger-tint-text); }
.grapher-play, .grapher-play-options { display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; width:22px; height:22px;
  padding:0; border:0; border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); cursor:pointer; }
.grapher-play svg { width:12px; height:12px; }
.grapher-play-options svg { width:12px; height:12px; transition:transform var(--duration-fast) var(--ease-out); }
.grapher-play-options[aria-expanded='true'] svg { transform:rotate(180deg); }
.grapher-play:hover, .grapher-play-options:hover { background:var(--hover-bg); color:var(--text-color); }
.grapher-play[aria-pressed='true'] { color:var(--accent-color); }
.grapher-play:focus-visible, .grapher-play-options:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }
.grapher-animation { display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-width:0; padding-left:28px; }
.grapher-options { display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-width:0; }
.grapher-option { display:inline-flex; align-items:center; gap:5px; height:22px; padding:0 6px 0 4px; border:0; border-radius:var(--radius-sm);
  background:transparent; color:var(--text-secondary); font-size:0.6875rem; cursor:pointer; }
.grapher-option:hover { background:var(--hover-bg); color:var(--text-color); }
.grapher-option:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }
.grapher-option-box { display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; width:12px; height:12px;
  border:1px solid var(--border-medium); border-radius:3px; color:var(--accent-tint-text); }
.grapher-option[aria-checked='true'] .grapher-option-box { border-color:var(--accent-color); }
.grapher-option-box svg { width:10px; height:10px; }
/* A table of points: two columns of compact cells under a sticky row of column names; long tables scroll inside. */
.grapher-table { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); max-height:264px; overflow-y:auto;
  border:1px solid var(--border-light); border-radius:var(--radius-sm); }
.grapher-cell { box-sizing:border-box; width:100%; min-width:0; height:22px; margin:0; padding:0 6px; border:0;
  border-bottom:1px solid var(--border-light); background:transparent; color:var(--text-color); font-family:var(--mono-font);
  font-size:0.75rem; font-variant-numeric:tabular-nums; }
.grapher-cell[data-cell$=':0'], .grapher-cell-head:first-child { border-right:1px solid var(--border-light); }
.grapher-table-spacer { grid-column:1 / -1; }
.grapher-cell:focus { outline:1px solid var(--accent-color); outline-offset:-1px; }
.grapher-cell::placeholder { color:var(--text-tertiary); }
.grapher-cell[aria-invalid] { color:var(--danger-tint-text); }
.grapher-cell-head { position:sticky; top:0; z-index:1; background:var(--container-color-alt); color:var(--text-secondary); font-style:italic; }
.grapher-row[data-hidden] .grapher-cell { color:var(--text-secondary); }
.grapher-notice { font-size:var(--smaller-font-size); color:var(--text-secondary); padding:0 2px; }
.grapher-add-table { opacity:0.5; }
.grapher-hint { margin:0; padding:var(--space-3); font-size:0.6875rem; line-height:1.5; color:var(--text-tertiary); }
.grapher-hint-link { padding:0; border:none; background:none; color:var(--accent-tint-text); font:inherit; cursor:pointer; }
.grapher-hint-link:hover { text-decoration:underline; }
.grapher-hint-link:focus-visible { outline:2px solid var(--accent-color); outline-offset:1px; border-radius:var(--radius-sm); }

/* ---- the graph tab ---- */
.grapher-topbar { position:relative; display:flex; align-items:center; box-sizing:border-box; height:var(--app-bar-height);
  min-height:var(--app-bar-height); flex:0 0 var(--app-bar-height); border-bottom:1px solid var(--border-light);
  padding:0 calc(var(--plugin-actions-offset, 0px) + var(--space-3)) 0 calc(var(--plugin-navigation-offset, 0px) + var(--space-3));
  background:var(--container-color-alt); }
.grapher-topbar-title { position:absolute; left:50%; transform:translateX(-50%); color:var(--text-secondary);
  font-size:var(--smaller-font-size); white-space:nowrap; pointer-events:none; }
.grapher-stage { position:relative; display:flex; flex:1 1 auto; min-height:0; }
.grapher-tab { position:relative; }
.grapher-export-notice { position:absolute; left:var(--space-3); bottom:var(--space-3); z-index:1; max-width:calc(100% - 2 * var(--space-3));
  box-sizing:border-box; margin:0; padding:4px 8px; border:1px solid var(--border-light); border-radius:4px;
  background:var(--container-color-alt); color:var(--text-secondary); font-size:var(--smaller-font-size); overflow-wrap:anywhere; }
.grapher-export-failed { color:var(--danger-tint-text); }
.grapher-canvas-wrap { position:relative; flex:1 1 auto; min-width:0; min-height:0; overflow:hidden; }
.grapher-canvas { position:absolute; inset:0; display:block; width:100%; height:100%; background:var(--surface-color-alt);
  cursor:crosshair; touch-action:none; outline:none; }
.grapher-canvas:active { cursor:grabbing; }
.grapher-canvas-space { cursor:grab; }
.grapher-zoom { position:absolute; right:var(--space-3); top:var(--space-3); display:flex; flex-direction:column; gap:8px; z-index:1; }
.grapher-zoom-button { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; padding:0;
  border:1px solid var(--border-light); border-radius:50%; background:var(--container-color-alt); color:var(--text-secondary);
  cursor:pointer; transition:background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-zoom-button svg { width:16px; height:16px; }
.grapher-zoom-button:hover { background:var(--hover-bg); color:var(--text-color); }
.grapher-zoom-button:focus-visible { outline:2px solid var(--accent-color); outline-offset:2px; }
/* The axis labels and scale pickers under the zoom buttons: an open picker shows its choices as circles continuing the
   stack below it (Map's layer picker); the open button and the current choice wear the accent tint over the surface. */
.grapher-axis-controls, .grapher-picker, .grapher-picker-choices { display:flex; flex-direction:column; gap:8px; }
.grapher-zoom-button.active, .grapher-zoom-button.active:hover { color:var(--title-color); border-color:var(--accent-color);
  background:linear-gradient(var(--accent-tint-bg), var(--accent-tint-bg)), var(--container-color-alt); }
.grapher-zoom-button.selected, .grapher-zoom-button.selected:hover { color:var(--title-color);
  background:linear-gradient(var(--accent-tint-bg), var(--accent-tint-bg)), var(--container-color-alt); }
.grapher-axis-glyph { font-family:'Times New Roman', 'STIX Two Math', serif; font-size:1rem; line-height:1; }
.grapher-axis-glyph[data-long] { font-size:0.8125rem; }
.grapher-scale-glyph { font-size:0.8125rem; letter-spacing:-0.01em; }
.grapher-scale-glyph sub { font-size:0.625rem; vertical-align:-0.3em; line-height:0; }

/* A \`\`\`grapher\`\`\` block in a note: the graph at its height, its sliders and messages, then the view and Open in Grapher. */
.grapher-fence { display:flex; flex-direction:column; margin:0.75em 0; border:1px solid var(--border-light); border-radius:var(--radius); background:var(--container-color); overflow:hidden; }
.grapher-fence-stage { position:relative; display:flex; flex:0 0 auto; min-height:0; border-bottom:1px solid var(--border-light); }
.grapher-fence-slider { display:flex; align-items:center; gap:8px; min-width:0; padding:4px 10px 0 6px; }
.grapher-fence-slider-name { flex:0 0 auto; min-width:1.2em; color:var(--text-color); font-family:'Times New Roman', 'STIX Two Math', serif; font-style:italic; font-size:0.9375rem; }
.grapher-fence-slider-value { flex:0 0 auto; min-width:3.5em; text-align:right; font-variant-numeric:tabular-nums; font-size:var(--small-font-size); color:var(--text-secondary); }
.grapher-fence-message { margin:0; padding:6px 12px 0; font-size:var(--small-font-size); color:var(--danger-tint-text); }
.grapher-fence-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:32px; padding:4px 6px 4px 12px; }
.grapher-fence-view { display:inline-flex; align-items:center; gap:6px; min-width:0; font-size:var(--small-font-size); color:var(--text-secondary); }
.grapher-fence-view-icon { width:14px; height:14px; flex:0 0 auto; color:var(--accent-tint-text); }
.grapher-fence-open { flex:0 0 auto; height:24px; padding:0 8px; border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary);
  font:inherit; font-size:var(--small-font-size); cursor:pointer; transition:background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
.grapher-fence-open:hover:not(:disabled) { background:var(--hover-bg); color:var(--text-color); }
.grapher-fence-open:disabled { opacity:0.5; cursor:default; }
.grapher-fence-open:focus-visible { outline:2px solid var(--accent-color); outline-offset:-2px; }

@media (prefers-reduced-motion: reduce) {
  .grapher-view-picker, .grapher-view-option, .grapher-unit, .grapher-insert, .grapher-notes-action, .grapher-ref-all, .grapher-ref-heading, .grapher-ref-chevron, .grapher-ref-example, .grapher-swatch, .grapher-delete, .grapher-grip-icon, .grapher-bookmark-slot svg, .grapher-bookmarks-toggle, .grapher-bookmark-row, .grapher-bookmark-more, .grapher-handle .grapher-index, .grapher-zoom-button, .grapher-play-options svg, .grapher-fence-open { transition:none; }
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
