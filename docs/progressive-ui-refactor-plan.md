# Progressive UI Refactor Plan

This plan defines the staged UI modernization path for Blueprint IDE. It intentionally separates workbench component polish from graph-engine replacement so visual quality can improve without destabilizing Blueprint graph semantics.

## Current Direction

Blueprint IDE should keep the existing React/Tauri app, current `.bsln`, `.bproj`, and `.bpgraph` contracts, and the self-owned graph canvas while adopting a more mature component architecture for the workbench. The design target is a dense, quiet desktop IDE: compact controls, clear focus states, low-radius operational surfaces, tokenized colors, and predictable keyboard/mouse behavior.

## Decisions

| Date | Decision | Status |
| --- | --- | --- |
| 2026-07-03 | Do not replace the current graph canvas as part of the first UI refactor phase. | Approved |
| 2026-07-03 | Start with local React UI primitives inspired by shadcn/Radix composition while preserving the existing CSS token system. | In progress |
| 2026-07-03 | Treat FlowGram, litegraph.js, and React Flow as separate spikes with explicit import/export and interaction acceptance gates. | Planned |

## Phase 1: Workbench UI Foundation

Scope:

- Introduce local, typed React primitives under `src/webview/ui`.
- Prefer composition patterns compatible with shadcn/Radix: small components, explicit props, accessible roles, and token-driven styling.
- Migrate non-canvas overlays and panels first: command palette, settings, template registry, toolbar overflow, node find, inspector controls, and run/history panels.
- Keep visual styling in `styles.css` and existing theme tokens unless a broader CSS architecture decision is made.

Out of scope:

- No graph engine replacement.
- No Tailwind requirement until the project explicitly decides to adopt it.
- No mutation of graph/project file formats for visual-only work.

Verification:

- Primitive behavior tests for shared roles, active states, and backdrop dismissal.
- Existing component tests for each migrated surface.
- `npm run typecheck`.
- `npm run test:webview` or targeted Vitest coverage for touched surfaces.
- Playwright layout checks for migrated surfaces when visual geometry changes.

## Phase 2: Node Visual Refresh

Scope:

- Keep `GraphCanvas`, `canvasController`, `interactionState`, `autoLayout`, and `graphEditActions` as the behavior core.
- Restyle node DOM, node headers, ports, runtime badges, disabled/breakpoint/error states, and minimap parity through existing graph data.
- Extract reusable node visual helpers only when they reduce duplication or clarify hit-area/state ownership.

Out of scope:

- No alternate graph schema.
- No Canvas2D rewrite.
- No replacement of current compiler/runtime bindings.

Verification:

- Node state tests in `src/webview/App.test.tsx`.
- Layout smoke screenshots for selected, disabled, breakpoint, runtime-active/error, and large-graph states.
- Confirm visual/settings actions do not emit graph-data changes.

## Phase 3: Graph Engine Spikes

Each candidate must be evaluated outside the main refactor path.
Detailed guardrails, fixture requirements, acceptance gates, and per-candidate reporting rules live in `docs/graph-engine-spike-plan.md`.

| Candidate | Why evaluate | Main risk |
| --- | --- | --- |
| FlowGram | Complete workflow editor architecture, plugins, forms, variables, and React playground packages. | Large framework surface and data-model mismatch with Blueprint files. |
| litegraph.js | Mature Canvas2D node editor with Blueprint-like history and compact graph rendering. | Canvas2D rendering model conflicts with current React DOM nodes, CSS themes, selectors, and accessibility. |
| React Flow / `@xyflow/react` | React-native node graph library with custom nodes/edges and a mature ecosystem. | Existing Blueprint-specific interaction, culling, routing hubs, runtime states, and minimap behavior need adapter work. |

Spike acceptance gates:

- Import a representative `BlueprintGraph` without changing the file schema.
- Render at least 20 nodes with control/data links and stable port positions.
- Support pan, zoom, select, drag node, connect wire, delete, and context menu behavior.
- Preserve runtime active/error/breakpoint/disabled visual states.
- Export changes back into the existing graph model without losing bindings.
- Demonstrate a path for large graph performance comparable to current culling behavior.

## Initial Implementation Slices

- Slice 1 creates `src/webview/ui/primitives.tsx` and migrates the command palette to those primitives. This proves the component direction on a contained overlay while leaving graph canvas behavior untouched.
- Slice 2 migrates the node find dialog to the same dialog, header, search, icon button, and list action primitives. This validates reuse on a second non-canvas overlay with focus management and graph-navigation actions.
- Slice 3 migrates the toolbar overflow menu to menu surface, menu section, and menu action primitives. This keeps command grouping and menu roles intact while moving compact command menus toward the same shadcn/Radix-style composition layer.
- Slice 4 migrates the template registry overlay shell, title bar, close button, and search field to the shared dialog, header, icon button, and search primitives while leaving package/template selection logic unchanged.
- Slice 5 migrates the editor settings shell and title close action to the shared dialog, header, and icon button primitives while preserving the settings tabs, persistence, import/export, and graph-data isolation behavior.
- Slice 6 migrates the editor settings tab list and tab triggers to shared tabs primitives while preserving the current tab pages and settings state transitions.
- Slice 7 migrates editor settings segmented option groups to shared segmented control primitives while preserving preference updates and host-state persistence.
- Slice 8 adds `docs/graph-engine-spike-plan.md` so FlowGram, litegraph.js, and React Flow can be evaluated later through isolated spikes rather than folded into this workbench UI refactor.
- Slice 9 adds direct UI primitive tests for dialog, search, menu, tabs, segmented, and active action behavior so future workbench surfaces can reuse the primitives with less regression risk.
- Slice 10 migrates template registry detail action buttons to the shared icon button primitive while preserving package enable, favorite, and create-node behavior.
- Slice 11 migrates editor settings checkbox rows to a shared checkbox row primitive while preserving grid, snap, minimap, and main toolbar preference updates.
- Slice 12 migrates editor settings footer command buttons to a shared command button primitive while preserving export, import, reset, and transfer status behavior.
- Slice 13 migrates editor settings shortcut reset buttons to the shared command button primitive while preserving shortcut editing and conflict messaging.
- Slice 14 adds a shared panel header primitive and migrates inspector dock chrome, collapsed dock buttons, and the bottom run panel toggle to shared primitives while preserving panel open/close behavior.
- Slice 15 migrates the floating run action bar buttons to the shared command button primitive while preserving run, step, continue, log toggle, drag isolation, queue counts, and reset-position behavior.
- Slice 16 migrates run console toolbar actions and runtime history item tools to shared command/icon button primitives while preserving copy, clear, rename, pin, and delete behavior.
- Slice 17 migrates runtime error summary and trace stepper controls to the shared command button primitive while preserving first-error focus, previous/current/next trace navigation, and disabled edge states.
- Slice 18 migrates runtime details toggle, copy actions, comparison filters, comparison sort buttons, trace status filters, and trace group filters to the shared command button primitive while preserving filter/sort state transitions. Runtime comparison item rows and trace detail rows remain specialized list controls.
- Slice 19 migrates Inspector linked-port unlink actions to the shared command button primitive while preserving read-only disablement and the existing unlink callback path.
- Slice 20 migrates main toolbar icon buttons to the shared icon button primitive while preserving command callbacks, active states, disabled viewport states, run/cancel styling, and toolbar overflow/settings toggles.
- Slice 21 migrates run console issue-row copy buttons and runtime comparison item copy buttons to shared icon/command button primitives while preserving copy status feedback and specialized row selection controls.
- Slice 22 migrates node creation overlay close, category filter, and favorite toggle buttons to shared command/icon button primitives while preserving candidate pick behavior, keyboard navigation, and resize handle behavior.
- Slice 23 migrates node creation candidate pick rows to the shared command button primitive while preserving candidate DOM labels, mouse hover activation, pick behavior, and the specialized resize handle.
- Slice 24 migrates runtime console issue focus rows, runtime history selection rows, trace rows, and runtime detail trace rows to the shared command button primitive while preserving row DOM labels, run selection, issue focus, and trace stepping behavior.
- Slice 25 migrates Blueprint sidebar chrome, tabs, searches, graph/find/outline/reference rows, bookmark actions, and breakpoint actions to shared panel, tabs, search, command, and icon button primitives while preserving existing sidebar class contracts, selection/focus callbacks, and graph-data isolation.
- Slice 26 migrates the contextual selection toolbox, comment color swatches, and canvas edge context menus to shared icon/command button primitives while preserving overlay isolation, menu command callbacks, graph edit actions, and current canvas behavior.
- Slice 27 migrates loading retry, template registry package/template selection rows, Inspector issue focus rows, and runtime comparison inspect rows to shared command button primitives while preserving existing row DOM labels, focus callbacks, and runtime/validation behavior. The remaining raw App buttons are specialized pointer targets: comment resize handle, minimap recenter surface, port hit target, and node creation resize handle.
- Slice 28 starts Phase 2 with a CSS-only node visual refresh: node shells, headers, runtime badges, breakpoint affordances, execution/data row surfaces, and port pins gain stronger accent layering and focus/selection affordances while preserving `BlueprintNode`, `GraphCanvas`, port hit targets, node dimensions, and graph-data behavior.
- Slice 29 adds minimap parity for selected, disabled, breakpoint, and runtime node states by deriving minimap classes from existing graph/runtime state. This keeps minimap projection, viewport recentering, node bounds, graph data, and the current canvas engine unchanged.
- Slice 30 strengthens Playwright layout coverage for the Phase 2 node visual work: the built-in theme smoke test now asserts selected, disabled, breakpoint, runtime-error, and minimap parity affordances remain visible with nonzero layout boxes across every built-in theme, without changing graph data, canvas behavior, or adding graph-engine dependencies.
- Slice 31 adds shared `TextInput`, `NumberInput`, and `SelectInput` primitives and migrates non-canvas workbench form fields in the sidebar, editor settings, node creation search, comment inspector, runtime trace filter, and inspector port editors. Specialized canvas pointer targets, color pickers, and checkbox controls keep their current implementations.
- Slice 32 closes the remaining non-canvas input gap by adding shared `CheckboxInput` and `ColorInput` primitives for inspector boolean ports and comment custom-color controls. Raw inputs are now isolated to primitive internals; the remaining raw App buttons are still specialized canvas pointer targets.
- Slice 33 gives the shared input primitives their own compact base styles for text, number, select, checkbox, color, focus, and disabled states so future workbench fields can compose the primitives without relying on panel-specific selectors.
- Slice 34 adds automated boundary tests for the progressive refactor: raw buttons across non-primitive webview TSX must remain limited to the App canvas pointer targets for comment resize, minimap recenter, port hit testing, and node creation resize; raw form controls across non-primitive webview TSX must stay inside local primitive internals; canvas and graph core modules must stay independent from workbench UI primitives; FlowGram, litegraph.js, React Flow, and `@xyflow/react` must stay out of package manifests and all non-test shipped `src` source.
- Slice 35 adds a typed shared graph-engine spike fixture in `src/shared/graphEngineSpikeFixture.ts` with 20+ nodes, control/data links, selected/disabled/breakpoint/runtime states, a routing hub, and offscreen nodes so future FlowGram, litegraph.js, and React Flow spikes evaluate the same BlueprintGraph without schema changes.
- Slice 36 adds `docs/graph-engine-spikes/TEMPLATE.md` so future FlowGram, litegraph.js, and React Flow reports use the same acceptance gate table, rejection gate table, dependency note, manual checklist, artifact fields, and recommendation format.
- Slice 37 adds shared doc consistency tests for the graph-engine spike plan and report template so the shared fixture path, required sections, acceptance gates, rejection gates, and template-copy requirement stay aligned over time.
- Slice 38 adds `docs/workbench-ui-primitives.md` and boundary-test coverage for the local primitive architecture, contribution rules, canvas exceptions, CSS-token styling direction, and graph-engine dependency guardrails.
- Slice 39 upgrades local button primitives with ref forwarding and safe default `type="button"` semantics while preserving explicit submit/reset overrides and existing workbench call sites.
- Slice 40 adds a primitive style contract test so every `ui-*` class exported by `src/webview/ui/primitives.tsx` must be backed by a selector in `src/webview/styles.css`.
- Slice 41 upgrades structural primitives such as dialog frames, headers, menu surfaces, tab lists, segmented controls, and checkbox rows with ref forwarding so future focus management, positioning, and measurement can compose through the primitive layer.
- Slice 42 improves icon-only workbench controls by deriving an `aria-label` from a string `title` on `IconButton` when callers do not provide an explicit accessible label.
- Slice 43 adds Radix-style `data-state="active|inactive"` attributes to active-aware local primitives while preserving existing `active` class names and call-site behavior.
- Slice 44 adds Radix-style `data-disabled` markers to disabled-capable local primitives while preserving native `disabled` behavior and existing disabled selectors.
- Slice 45 wires the new primitive `data-state` and `data-disabled` attributes into base CSS selectors and boundary tests so state attributes are visually supported rather than only present in DOM.
- Slice 46 adds `docs/progressive-ui-refactor-audit.md` to map the active refactor goal to current evidence, required verification commands, and the decision that this branch completes the progressive UI refactor phase without graph-engine replacement.
