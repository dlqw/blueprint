import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "./i18n";
import { RunActionBar } from "./RunActionBar";

function renderRunActionBar(props: Partial<Parameters<typeof RunActionBar>[0]> = {}) {
  const defaults = {
    running: false,
    runtimeState: "idle" as const,
    placement: "bottom" as const,
    bottomPanelOpen: false,
    runtimeHistoryCount: 2,
    runtimeProgressCount: 0,
    queuedRunCount: 0,
    errorCount: 0,
    warningCount: 0,
    t: createTranslator("en-US"),
    onRun: vi.fn(),
    onCancel: vi.fn(),
    onStep: vi.fn(),
    onContinue: vi.fn(),
    onToggleLogs: vi.fn()
  };
  const onCanvasPointerDown = vi.fn();
  const result = render(
    <div data-testid="canvas" onPointerDown={onCanvasPointerDown}>
      <RunActionBar {...defaults} {...props} />
    </div>
  );
  return { ...result, onCanvasPointerDown, props: defaults };
}

describe("RunActionBar", () => {
  it("keeps pointer events from reaching the canvas", () => {
    const { onCanvasPointerDown } = renderRunActionBar();
    const bar = screen.getByLabelText("Run controls");

    vi.spyOn(bar.parentElement!, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 500,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      left: 280,
      top: 430,
      right: 520,
      bottom: 472,
      width: 240,
      height: 42,
      x: 280,
      y: 430,
      toJSON: () => ({})
    });

    fireEvent.pointerDown(bar, { button: 0, pointerId: 0, clientX: 400, clientY: 450 });

    expect(onCanvasPointerDown).not.toHaveBeenCalled();
  });

  it("keeps buttons clickable while blocking pointer-through", () => {
    const { onCanvasPointerDown, props } = renderRunActionBar();

    fireEvent.pointerDown(screen.getByTitle("Queue graph run"), { button: 0, pointerId: 1 });
    fireEvent.click(screen.getByTitle("Queue graph run"));

    expect(onCanvasPointerDown).not.toHaveBeenCalled();
    expect(props.onRun).toHaveBeenCalledTimes(1);
  });

  it("shows runtime progress node counts while a run is active", () => {
    renderRunActionBar({ running: true, runtimeState: "running", runtimeProgressCount: 3 });

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByTitle("Runtime progress nodes")).toHaveTextContent("3 nodes");
  });

  it("shows queued run counts from the runtime protocol", () => {
    renderRunActionBar({ running: true, runtimeState: "running", queuedRunCount: 2 });

    expect(screen.getByTitle("Show run history (1 running, 2 queued)")).toHaveTextContent("History");
    expect(screen.getByTitle("Show run history (1 running, 2 queued)")).toHaveTextContent("2");
    expect(screen.getByTitle("Queued runs")).toHaveTextContent("2 queued");
  });

  it("clamps dragged position and can reset to the default placement", () => {
    renderRunActionBar();
    const bar = screen.getByLabelText("Run controls");

    vi.spyOn(bar.parentElement!, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 500,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      left: 280,
      top: 430,
      right: 520,
      bottom: 472,
      width: 240,
      height: 42,
      x: 280,
      y: 430,
      toJSON: () => ({})
    });

    firePointer(bar, "pointerdown", { button: 0, pointerId: 7, clientX: 400, clientY: 450 });
    firePointer(bar, "pointermove", { pointerId: 7, clientX: 1200, clientY: 900 });

    expect(bar.style.getPropertyValue("--run-actionbar-x")).toBe("272px");
    expect(bar.style.getPropertyValue("--run-actionbar-y")).toBe("20px");

    fireEvent.click(screen.getByTitle("Reset run controls position"));

    expect(bar.style.getPropertyValue("--run-actionbar-x")).toBe("0px");
    expect(bar.style.getPropertyValue("--run-actionbar-y")).toBe("0px");
  });
});

function firePointer(element: Element, type: string, init: { clientX: number; clientY: number; button?: number; pointerId?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
    pointerId: init.pointerId ?? 1
  });
  fireEvent(element, event);
}
