import { describe, expect, it, vi } from "vitest";
import {
  capturePointer,
  isolateOverlayContextMenu,
  isolateOverlayEvent,
  preventOverlayDefault,
  releasePointerCapture
} from "./overlayEvents";

describe("overlayEvents", () => {
  it("stops pointer-through propagation", () => {
    const event = { stopPropagation: vi.fn() };

    isolateOverlayEvent(event);

    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("isolates context menus", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

    isolateOverlayContextMenu(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("prevents default overlay gestures", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

    preventOverlayDefault(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("captures and releases pointers when the target supports it", () => {
    const target = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn()
    };

    capturePointer(target, 7);
    releasePointerCapture(target, 7);

    expect(target.setPointerCapture).toHaveBeenCalledWith(7);
    expect(target.hasPointerCapture).toHaveBeenCalledWith(7);
    expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("does not release uncaptured pointers", () => {
    const target = {
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn()
    };

    releasePointerCapture(target, 9);

    expect(target.releasePointerCapture).not.toHaveBeenCalled();
  });
});
