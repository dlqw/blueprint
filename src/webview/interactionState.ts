import type { Point } from "../shared/blueprint";

export type InteractionMenuKind = "nodeCreation" | "wire" | "node" | "comment" | "port" | "toolbar" | "settings" | "templateRegistry" | "nodeFind";

export type CanvasInteraction =
  | { kind: "idle" }
  | { kind: "pan"; pointerId: number; start: Point; viewport: Point }
  | { kind: "marquee"; pointerId: number; start: Point; current: Point; additive: boolean }
  | { kind: "dragWire"; pointerId?: number; nodeId: string; portId: string; movingLinkId?: string }
  | { kind: "dragNodes"; pointerId?: number; nodeIds: string[] }
  | { kind: "dragComments"; pointerId?: number; commentIds: string[]; nodeIds: string[] }
  | { kind: "resizeComment"; pointerId?: number; commentId: string }
  | { kind: "menuOpen"; menu: InteractionMenuKind };

export type CanvasInteractionAction =
  | { type: "startPan"; pointerId: number; start: Point; viewport: Point }
  | { type: "startMarquee"; pointerId: number; start: Point; additive: boolean }
  | { type: "updateMarquee"; pointerId: number; current: Point }
  | { type: "startDragWire"; pointerId?: number; nodeId: string; portId: string; movingLinkId?: string }
  | { type: "startDragNodes"; pointerId?: number; nodeIds: string[] }
  | { type: "startDragComments"; pointerId?: number; commentIds: string[]; nodeIds: string[] }
  | { type: "startResizeComment"; pointerId?: number; commentId: string }
  | { type: "openMenu"; menu: InteractionMenuKind }
  | { type: "end"; pointerId?: number }
  | { type: "cancel" };

export const idleInteractionState: CanvasInteraction = { kind: "idle" };

export function canvasInteractionReducer(state: CanvasInteraction, action: CanvasInteractionAction): CanvasInteraction {
  switch (action.type) {
    case "startPan":
      return { kind: "pan", pointerId: action.pointerId, start: action.start, viewport: action.viewport };
    case "startMarquee":
      return { kind: "marquee", pointerId: action.pointerId, start: action.start, current: action.start, additive: action.additive };
    case "updateMarquee":
      return state.kind === "marquee" && state.pointerId === action.pointerId ? { ...state, current: action.current } : state;
    case "startDragWire":
      return { kind: "dragWire", pointerId: action.pointerId, nodeId: action.nodeId, portId: action.portId, movingLinkId: action.movingLinkId };
    case "startDragNodes":
      return { kind: "dragNodes", pointerId: action.pointerId, nodeIds: action.nodeIds };
    case "startDragComments":
      return { kind: "dragComments", pointerId: action.pointerId, commentIds: action.commentIds, nodeIds: action.nodeIds };
    case "startResizeComment":
      return { kind: "resizeComment", pointerId: action.pointerId, commentId: action.commentId };
    case "openMenu":
      return { kind: "menuOpen", menu: action.menu };
    case "end":
      return shouldEndInteraction(state, action.pointerId) ? idleInteractionState : state;
    case "cancel":
      return idleInteractionState;
  }
}

function shouldEndInteraction(state: CanvasInteraction, pointerId: number | undefined): boolean {
  if (state.kind === "idle") {
    return false;
  }
  if (state.kind === "menuOpen" || pointerId === undefined) {
    return true;
  }
  return "pointerId" in state && state.pointerId === pointerId;
}
