# Graph Engine Spike Report: <candidate>

Branch: `spike/graph-engine-<candidate>`
Date:
Owner:
Recommendation: `reject | revisit later | propose dedicated migration plan`

## Scope

- Candidate:
- Package/version evaluated:
- Adapter location:
- Shared fixture: `src/shared/graphEngineSpikeFixture.ts`
- Automated smoke test:
- Screenshots or Playwright artifacts:

## Dependency And Bundle Note

| Item | Result |
| --- | --- |
| Added packages |  |
| Direct dependency size notes |  |
| Bundle/build impact |  |
| License concerns |  |
| Runtime/browser constraints |  |

## Acceptance Gates

| Gate | Result (`pass | partial | fail`) | Evidence |
| --- | --- | --- |
| Imports the shared `BlueprintGraph` fixture without schema changes. |  |  |
| Renders all fixture nodes. |  |  |
| Renders control and data links. |  |  |
| Renders selected, disabled, breakpoint, runtime active, and runtime error states. |  |  |
| Supports pan, zoom, select, drag node, connect wire, delete selection, and context menu opening. |  |  |
| Exports node positions and links back to the current graph model without losing input bindings. |  |  |
| Preserves inspector selection and runtime trace lookup by stable Blueprint node id. |  |  |
| Demonstrates a large-graph strategy comparable to current viewport culling. |  |  |
| Runs at least one automated smoke test. |  |  |

## Rejection Gates

| Gate | Triggered? (`yes | no`) | Evidence |
| --- | --- | --- |
| Requires changing Blueprint graph file semantics just to fit the engine. |  |  |
| Loses stable Blueprint node ids or port ids. |  |  |
| Replaces compiler/runtime data contracts. |  |  |
| Requires rewriting core editor commands before basic import/render/export works. |  |  |
| Gives up accessible overlay/dialog/menu behavior already available in React. |  |  |
| Accepts worse large-graph behavior without a clear mitigation path. |  |  |

## Manual Checklist

- [ ] Import fixture.
- [ ] Pan and zoom the graph.
- [ ] Select the fixture selected node.
- [ ] Drag at least one node and export the changed position.
- [ ] Connect a new wire and export it.
- [ ] Delete a selection.
- [ ] Open a node or canvas context menu.
- [ ] Inspect disabled, breakpoint, runtime active, and runtime error states.
- [ ] Verify data-link and control-link hit testing.
- [ ] Verify inspector/runtime lookup still uses Blueprint node ids.

## Findings

### What Worked

-

### Gaps

-

### Migration Cost

-

### Open Questions

-

## Final Recommendation

Summarize whether this candidate should be rejected, revisited later, or moved into a dedicated migration plan. Include the main technical reason.
