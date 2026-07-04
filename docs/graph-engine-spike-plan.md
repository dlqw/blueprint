# Graph Engine Spike Plan

This plan reserves evaluation space for FlowGram, litegraph.js, and React Flow without mixing graph-engine replacement into the progressive workbench UI refactor.

## Guardrails

- Run each engine spike on its own branch named `spike/graph-engine-<candidate>`.
- Do not add candidate dependencies to the main UI refactor branch.
- Do not change `.bsln`, `.bproj`, `.bpgraph`, or schema contracts for a spike.
- Do not replace `GraphCanvas`, `canvasController`, `interactionState`, `autoLayout`, or `graphEditActions` in the main product path during a spike.
- Keep adapters isolated under a spike-only folder such as `src/webview/graphEngineSpikes/<candidate>`.
- Remove spike-only code before merging the progressive UI refactor unless a separate review explicitly accepts the engine direction.

## Shared Fixture

Every candidate must import the representative fixture from `src/shared/graphEngineSpikeFixture.ts`:

- At least 20 nodes.
- Both control and data links.
- One selected node.
- One disabled node.
- One breakpoint node.
- One runtime active state and one runtime error state.
- One routing hub or reroute-equivalent case.
- Enough offscreen nodes to evaluate viewport behavior.

The fixture is generated from the existing `BlueprintGraph` type and must not require a new file format. Candidate spikes may adapt the fixture into their own engine data model, but the adapter must preserve Blueprint node ids, port ids, input bindings, breakpoints, and runtime trace node ids.

## Candidate Matrix

| Candidate | Spike purpose | Expected adapter work | Primary risk |
| --- | --- | --- | --- |
| FlowGram | Evaluate a full workflow editor framework with forms, plugins, variables, history, and React playground packages. | Map Blueprint templates, ports, links, runtime status, commands, and template metadata into FlowGram's document and node model. | Framework/data-model gravity may force Blueprint file or compiler semantics to bend around FlowGram. |
| litegraph.js | Evaluate mature Canvas2D node editing, compact graph rendering, and Blueprint-like editor behavior. | Map Blueprint nodes and ports into LiteGraph nodes, bridge Canvas2D hit testing to existing inspector/runtime actions, and preserve theme/runtime states. | Canvas2D rendering conflicts with current React DOM nodes, CSS token styling, accessibility roles, test selectors, and componentized overlays. |
| React Flow / `@xyflow/react` | Evaluate a React-native graph library with custom nodes, edges, viewport, and ecosystem support. | Map Blueprint nodes/links to React Flow nodes/edges, implement custom node/port rendering, and adapt current command/selection/runtime states. | Existing Blueprint-specific gestures, routing hubs, culling, minimap behavior, and compiler bindings may require heavy adapters. |

## Acceptance Gates

A spike is viable only if it demonstrates all of the following:

- Imports the shared `BlueprintGraph` fixture without schema changes.
- Renders all fixture nodes, control/data links, selected state, disabled state, breakpoint state, runtime active state, and runtime error state.
- Supports pan, zoom, select, drag node, connect wire, delete selection, and context menu opening.
- Exports node positions and links back to the current graph model without losing input bindings.
- Preserves existing inspector selection and runtime trace lookup by Blueprint node id.
- Demonstrates a credible large-graph strategy comparable to current viewport culling.
- Runs through a documented manual checklist and at least one automated smoke test.

## Rejection Gates

Reject the candidate for mainline replacement if the spike requires any of these:

- Changing Blueprint graph file semantics just to fit the engine.
- Losing stable Blueprint node ids or port ids.
- Replacing compiler/runtime data contracts.
- Rewriting core editor commands before basic import/render/export works.
- Giving up accessible overlay/dialog/menu behavior already available in React.
- Accepting worse large-graph behavior without a clear mitigation path.

## Output Required Per Spike

Each spike must produce:

- A short markdown report under `docs/graph-engine-spikes/<candidate>.md`, copied from `docs/graph-engine-spikes/TEMPLATE.md`.
- A dependency and bundle-size note.
- Screenshots or Playwright artifacts for the shared fixture.
- A table of acceptance gate results.
- A table of rejection gate results.
- A recommendation: reject, revisit later, or propose a dedicated migration plan.
