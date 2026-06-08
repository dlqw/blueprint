import { describe, expect, it } from "vitest";
import { canvasInteractionReducer, idleInteractionState } from "./interactionState";

describe("canvasInteractionReducer", () => {
  it("keeps canvas pointer modes mutually exclusive", () => {
    const marquee = canvasInteractionReducer(idleInteractionState, {
      type: "startMarquee",
      pointerId: 1,
      start: { x: 10, y: 12 },
      additive: false
    });
    expect(marquee).toEqual({
      kind: "marquee",
      pointerId: 1,
      start: { x: 10, y: 12 },
      current: { x: 10, y: 12 },
      additive: false
    });

    expect(canvasInteractionReducer(marquee, {
      type: "startPan",
      pointerId: 2,
      start: { x: 20, y: 24 },
      viewport: { x: -100, y: -60 }
    })).toEqual({
      kind: "pan",
      pointerId: 2,
      start: { x: 20, y: 24 },
      viewport: { x: -100, y: -60 }
    });
  });

  it("updates and ends only the matching pointer interaction", () => {
    const state = canvasInteractionReducer(idleInteractionState, {
      type: "startMarquee",
      pointerId: 7,
      start: { x: 0, y: 0 },
      additive: true
    });

    const ignoredMove = canvasInteractionReducer(state, {
      type: "updateMarquee",
      pointerId: 8,
      current: { x: 100, y: 100 }
    });
    expect(ignoredMove).toBe(state);

    const moved = canvasInteractionReducer(state, {
      type: "updateMarquee",
      pointerId: 7,
      current: { x: 100, y: 100 }
    });
    expect(moved).toEqual(expect.objectContaining({ kind: "marquee", current: { x: 100, y: 100 } }));
    expect(canvasInteractionReducer(moved, { type: "end", pointerId: 8 })).toBe(moved);
    expect(canvasInteractionReducer(moved, { type: "end", pointerId: 7 })).toBe(idleInteractionState);
  });

  it("uses cancel and menu actions as explicit escape transitions", () => {
    const dragging = canvasInteractionReducer(idleInteractionState, {
      type: "startDragWire",
      nodeId: "entry",
      portId: "then",
      movingLinkId: "link-entry-log"
    });
    expect(dragging).toEqual({
      kind: "dragWire",
      nodeId: "entry",
      portId: "then",
      movingLinkId: "link-entry-log"
    });

    expect(canvasInteractionReducer(dragging, { type: "openMenu", menu: "nodeCreation" })).toEqual({
      kind: "menuOpen",
      menu: "nodeCreation"
    });
    expect(canvasInteractionReducer(dragging, { type: "openMenu", menu: "templateRegistry" })).toEqual({
      kind: "menuOpen",
      menu: "templateRegistry"
    });
    expect(canvasInteractionReducer(dragging, { type: "cancel" })).toBe(idleInteractionState);
  });

  it("cancels and pointer-ends drag and resize modes without leaking stale interactions", () => {
    const dragWire = canvasInteractionReducer(idleInteractionState, {
      type: "startDragWire",
      pointerId: 3,
      nodeId: "entry",
      portId: "then"
    });
    const dragNodes = canvasInteractionReducer(idleInteractionState, {
      type: "startDragNodes",
      pointerId: 4,
      nodeIds: ["log1", "log2"]
    });
    const dragComments = canvasInteractionReducer(idleInteractionState, {
      type: "startDragComments",
      pointerId: 5,
      commentIds: ["comment-a"],
      nodeIds: ["log1"]
    });
    const resizeComment = canvasInteractionReducer(idleInteractionState, {
      type: "startResizeComment",
      pointerId: 6,
      commentId: "comment-a"
    });

    expect(canvasInteractionReducer(dragWire, { type: "end", pointerId: 99 })).toBe(dragWire);
    expect(canvasInteractionReducer(dragNodes, { type: "end", pointerId: 99 })).toBe(dragNodes);
    expect(canvasInteractionReducer(dragComments, { type: "end", pointerId: 99 })).toBe(dragComments);
    expect(canvasInteractionReducer(resizeComment, { type: "end", pointerId: 99 })).toBe(resizeComment);

    expect(canvasInteractionReducer(dragWire, { type: "end", pointerId: 3 })).toBe(idleInteractionState);
    expect(canvasInteractionReducer(dragNodes, { type: "end", pointerId: 4 })).toBe(idleInteractionState);
    expect(canvasInteractionReducer(dragComments, { type: "end", pointerId: 5 })).toBe(idleInteractionState);
    expect(canvasInteractionReducer(resizeComment, { type: "end", pointerId: 6 })).toBe(idleInteractionState);

    expect(canvasInteractionReducer(dragWire, { type: "cancel" })).toBe(idleInteractionState);
    expect(canvasInteractionReducer(dragNodes, { type: "cancel" })).toBe(idleInteractionState);
    expect(canvasInteractionReducer(dragComments, { type: "cancel" })).toBe(idleInteractionState);
    expect(canvasInteractionReducer(resizeComment, { type: "cancel" })).toBe(idleInteractionState);
  });
});
