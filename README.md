# Blueprint IDE

Blueprint IDE is a Tauri 2 desktop visual node editor for TypeScript-oriented Blueprint projects. It uses `.bsln`, `.bproj`, and `.bpgraph` JSON files, a React graph editor, shared TypeScript compiler/runtime code, and a Rust command bridge for local file and process operations.

## Current Shape

- Desktop shell: `src-tauri` plus `src/desktop`.
- Shared graph model, validation, built-ins, and compiler core: `src/shared`.
- React graph editor surface: `src/webview`, hosted through a neutral editor host API and styled as a ComfyUI-like dark, compact, canvas-first workspace.
- Viewport math and canvas coordinate policy: `src/webview/canvasController.ts`.
- Canvas interaction mode reducer: `src/webview/interactionState.ts`.
- Floating overlay event isolation helpers: `src/webview/overlayEvents.ts`.
- Desktop compiler bridge: `scripts/desktop-blueprint-bridge.cjs`, packaged with `dist/shared`.
- Schemas: `schemas/*.schema.json`.
- Example workspace: `examples/Gameplay`.
- Legacy editor-integration material has been moved under `archive/`.

## Commands

```sh
npm install
npm run typecheck
npm run test:webview
npm run playwright:install
npm run test:layout
npm run test:packaged-persistence
npm run test:packaged-profile
npm run smoke
npm run desktop:dev
npm run tauri:dev
npm run tauri:build
```

`npm run build` compiles `dist/shared` and the desktop frontend in `dist/desktop`. `npm run smoke` compiles the shared compiler core and runs the Gameplay example through the Node bridge. `npm run test:layout` runs Playwright layout screenshots, Selection Toolbox non-overlap checks, desktop template-source panel coverage, editor-preference reload persistence, plus large-graph browser benchmarks for 200, 500, and 1000 log nodes. `npm run test:packaged-persistence` builds a no-bundle release Tauri executable, drives it through WebView2 remote debugging with Playwright, restarts it, and verifies editor preferences survive the packaged-app restart while restoring the previous local desktop state. `npm run test:packaged-profile` uses the same packaged-app path to profile 500/1000 node large graphs in release WebView2, verify culling budgets, measure open/focus time, and restore the previous local active graph.

## Desktop Workflow

Use the desktop shell to create or open a `.bsln` solution, add projects, create empty graphs or new graphs from the project-level workflow template browser with category, tag, node/wire, and input/output previews, rename or delete graph/project entries, edit nodes on the canvas, compile the active graph, and run generated TypeScript. Graph edits are persisted to the selected `.bpgraph` file when a file-backed graph is active.

The editor uses a ComfyUI-style dark neutral visual shell with compact top controls, subtle bordered floating panels, bottom/right canvas affordances, restrained accents, icon-forward controls, and compact ComfyUI-like node cards with accent title bars, rounded bodies, round slot pins, and readable selected/disabled/runtime states. It defaults supported catalog-backed UI surfaces to Chinese, keeps English fallback strings available, and exposes language, built-in theme switching, and custom theme import/export in editor settings. It supports node search with template/source-path/blackboard-variable/generated-reference match context plus solution-wide graph/node matches, My Blueprint-style active graph and solution/project graph structure groups with click-to-open and host-backed rename actions for graph entries, graph outline filtering, selected-node references including solution-wide same-template, same-source-file, and blackboard-variable matches, host-backed selected-node id rename with link/comment/bookmark/breakpoint reference updates, solution reference copy-list plus blackboard-variable rename, template retarget, and compatible source-family retarget actions with result/error feedback, plus current-graph reference-group select-all actions, bookmarks, breakpoints, direct port linking, Alt port disconnect, Ctrl move-link from connected input pins, pin-aware node creation hints, recent/favorite filters, explicit empty states, and keyboard category/page navigation in the node creation panel, wire editing, double-click/batch routing hubs, routing hub cleanup, comment boxes, copy/paste, duplicate, align/distribute, disabling selected nodes with compile-time bypass semantics, collapsing eligible single-entry selections with data inputs and outputs into embedded macro templates or embedded function graph calls from the tiered toolbar overflow or the contextual selection toolbox, minimap navigation, viewport node and wire DOM culling for very large graphs, canvas fit/zoom/link visibility controls, desktop project template-source management for `.bproj` `templateSources`, a template package registry for inspecting project template source globs, browsing source packages, extracting decorated TypeScript templates from project `templateSources`, favoriting templates, enabling or disabling template packages for new node creation, and creating available templates, an editor settings panel for grid, snap, minimap, actionbar placement, link rendering preferences, interface language, built-in interface theme, custom theme import/export, customizable keyboard shortcuts with conflict warnings, and settings import/export, spline/straight/orthogonal/hidden link render modes, contextual selection actions with inspector info access, auto layout, compile diagnostics, a draggable and resettable run actionbar, pending/queued/running/paused/runtime-error run status with host-protocol queued-run counts and active trace-progress counts, runtime output, runtime error summaries, trace inspection, run-history comparison, and a compact run history popover for selecting, renaming, pinning, deleting, or clearing stored runs.

Collapsed macro and function workflows store generated reusable templates and graph bodies inside the active `.bpgraph` through `localTemplates` and `embeddedGraphs`, so the extracted unit can render, validate, compile, and be reused without adding a separate project file. A selected collapsed node can also be extracted into a project `.bpgraph`; the desktop host writes the graph file, updates `.bproj` graph/macro references, removes the embedded copy from the active graph, preserves macro output metadata, refreshes templates, and the desktop bridge exposes project `.bpgraph` function/macro files as reusable templates during template load and compile/run.

## Packaging Notes

The Tauri bundle includes:

- `scripts/desktop-blueprint-bridge.cjs`
- `dist/shared/`

Run `npm run build` before packaging if you are not invoking `tauri build`, because the Tauri config calls `npm run desktop:build` automatically only during Tauri builds.
