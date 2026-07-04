# Workbench UI Primitives

Blueprint IDE uses local React primitives for the non-canvas workbench UI. The goal is to keep the desktop IDE dense, accessible, and token-driven while preserving the current graph canvas and Blueprint file/runtime contracts.

## Scope

Use `src/webview/ui/primitives.tsx` for workbench surfaces such as:

- Dialogs, palettes, settings, registries, menus, and overlays.
- Sidebar, inspector, run console, history, and dock chrome.
- Non-canvas form fields, tabs, segmented controls, command buttons, icon buttons, list rows, and panel headers.

Keep these areas out of the primitive layer:

- Canvas hit targets that own pointer geometry, such as ports, resize handles, minimap recentering, and graph drag/connect targets.
- Graph behavior modules: `GraphCanvas`, `canvasController`, `interactionState`, `autoLayout`, and `graphEditActions`.
- Shared graph, compiler, runtime, schema, and file format contracts.

## Rules

- Compose non-canvas controls from local primitives before adding raw `button`, `input`, `select`, or `textarea` elements.
- Keep raw form controls inside primitive internals unless a test documents a canvas-specific exception.
- Style primitives and migrated surfaces through existing CSS tokens in `src/webview/styles.css`; do not require Tailwind for this phase.
- Prefer explicit accessible roles and labels for dialogs, menus, tabs, inputs, and command rows.
- Keep primitive props typed and boring: forward native element props, expose only state that maps to reusable behavior, and avoid graph-specific data in primitive APIs.
- Preserve existing class names and DOM labels when tests or workflows depend on them.
- Do not import UI primitives from canvas or graph core modules.
- Do not add FlowGram, litegraph.js, React Flow, or `@xyflow/react` to this branch. Evaluate them only on `spike/graph-engine-<candidate>` branches.

## Adding Or Migrating A Surface

1. Pick the closest existing primitive from `src/webview/ui/primitives.tsx`.
2. Add a new primitive only when at least two workbench surfaces can reuse the behavior or when it centralizes an accessibility/styling rule.
3. Keep graph data mutations and command callbacks in the owning feature component; primitives should stay presentational and event-forwarding.
4. Add focused Vitest coverage for new primitive behavior and component-specific state transitions.
5. Add or update Playwright layout coverage when visual geometry, node state affordances, or workbench panel layout changes.
6. Update `docs/progressive-ui-refactor-plan.md` and `changelogs/0.1.0-progressive-ui-refactor.md` for completed refactor slices.

## Visual Direction

The workbench should read as a production desktop IDE: compact controls, clear focus rings, low-radius surfaces, strong disabled states, predictable hover/active affordances, and color drawn from theme tokens. Avoid marketing-page patterns, decorative cards, and one-off control styling that cannot be reused across panels.
