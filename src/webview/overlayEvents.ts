interface PropagationEvent {
  stopPropagation(): void;
}

interface PreventableEvent extends PropagationEvent {
  preventDefault(): void;
}

interface PointerCaptureTarget {
  setPointerCapture?(pointerId: number): void;
  hasPointerCapture?(pointerId: number): boolean;
  releasePointerCapture?(pointerId: number): void;
}

export function isolateOverlayEvent(event: PropagationEvent): void {
  event.stopPropagation();
}

export function isolateOverlayContextMenu(event: PreventableEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function preventOverlayDefault(event: PreventableEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function capturePointer(target: PointerCaptureTarget, pointerId: number): void {
  if (typeof target.setPointerCapture === "function") {
    target.setPointerCapture(pointerId);
  }
}

export function releasePointerCapture(target: PointerCaptureTarget, pointerId: number): void {
  if (
    typeof target.hasPointerCapture === "function" &&
    typeof target.releasePointerCapture === "function" &&
    target.hasPointerCapture(pointerId)
  ) {
    target.releasePointerCapture(pointerId);
  }
}
