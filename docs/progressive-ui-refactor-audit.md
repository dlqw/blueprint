# Progressive UI Refactor Completion Audit

Date: 2026-07-04
Branch: `feature/progressive-ui-refactor`

This audit checks the active refactor goal against the current implementation. It treats the current branch as a completed progressive phase, not as a decision to replace the graph engine.

## Requirements And Evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| Use a mature shadcn/Radix-style approach for non-canvas workbench UI. | `src/webview/ui/primitives.tsx` provides typed local primitives for dialogs, menus, panels, tabs, segmented controls, buttons, list rows, search, and form controls. `src/webview/ui/primitives.test.tsx` covers roles, refs, active/disabled state attributes, safe button types, label fallback, and callbacks. | Complete |
| Migrate non-canvas workbench controls to the local primitive layer. | `src/webview/ui/refactorBoundary.test.ts` scans non-primitive webview TSX and keeps raw buttons limited to four specialized `App.tsx` canvas pointer targets. It also keeps raw form controls isolated to primitive internals. | Complete |
| Preserve the self-owned graph canvas and graph behavior core. | `src/webview/ui/refactorBoundary.test.ts` verifies `GraphCanvas`, `canvasController`, `interactionState`, `autoLayout`, `graphEditActions`, `src/shared/blueprint.ts`, and `src/shared/graph.ts` do not import workbench UI primitives. | Complete |
| Improve node visuals without changing graph data, file contracts, or engine semantics. | `docs/progressive-ui-refactor-plan.md` records the CSS-only node visual refresh and minimap parity slices. `tests/layout.smoke.spec.ts` asserts selected, disabled, breakpoint, runtime-error, and minimap affordances across built-in themes. `src/webview/App.test.tsx` is part of the webview regression set. | Complete |
| Reserve FlowGram, litegraph.js, and React Flow for isolated spikes instead of adding them to the main refactor. | `docs/graph-engine-spike-plan.md` defines separate spike branches, guardrails, fixture requirements, acceptance gates, and rejection gates. `docs/graph-engine-spikes/TEMPLATE.md` standardizes candidate reports. `src/shared/graphEngineSpikeFixture.ts` provides the shared BlueprintGraph fixture. | Complete |
| Keep candidate graph-engine dependencies out of this branch. | `src/webview/ui/refactorBoundary.test.ts` blocks FlowGram, litegraph.js, React Flow, and `@xyflow/react` in package manifests and non-test shipped source. The explicit search command `rg -n "flowgram\|litegraph\|@xyflow\|react-flow" package.json package-lock.json src --glob "!**/*.test.ts" --glob "!**/*.test.tsx"` returns no matches. | Complete |
| Keep future primitive contributions tied to CSS tokens and documented rules. | `docs/workbench-ui-primitives.md` documents primitive scope, canvas exceptions, contribution rules, and visual direction. `src/webview/ui/refactorBoundary.test.ts` verifies the guide exists, primitive classes have CSS selectors, and primitive state attributes are backed by CSS selectors. | Complete |
| Keep change history under `changelogs/` with a version-related filename. | `changelogs/0.1.0-progressive-ui-refactor.md` summarizes the refactor phase. | Complete |

## Verification Commands

The following commands are the required verification set for this phase:

- `npm run test:webview -- src/shared/graphEngineSpikeDocs.test.ts src/shared/graphEngineSpikeFixture.test.ts ui/refactorBoundary.test.ts ui/primitives.test.tsx App.test.tsx`
- `npm run typecheck`
- `npm run test:layout`
- `rg -n "flowgram|litegraph|@xyflow|react-flow" package.json package-lock.json src --glob "!**/*.test.ts" --glob "!**/*.test.tsx"`
- `rg -n "ui/primitives|\\.\\/ui\\/primitives|\\.\\.\\/ui\\/primitives" src/webview/GraphCanvas.tsx src/webview/canvasController.ts src/webview/interactionState.ts src/webview/autoLayout.ts src/webview/graphEditActions.ts src/shared/blueprint.ts src/shared/graph.ts`

## Decision

The current branch satisfies the requested progressive UI refactor phase:

- Non-canvas workbench UI now composes a local mature primitive layer.
- The current graph canvas and graph core remain self-owned and independent from the primitive layer.
- Node visuals and minimap parity improved through existing state and CSS.
- FlowGram, litegraph.js, and React Flow are reserved for isolated spikes with shared fixtures and acceptance gates.
- Candidate graph-engine dependencies are absent from the main refactor branch.

The remaining work is review, commit/PR packaging, and any future engine spike branches. Those are follow-up workflow steps, not missing implementation for this phase.
