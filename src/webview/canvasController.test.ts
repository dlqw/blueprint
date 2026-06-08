import { describe, expect, it } from "vitest";
import {
  centerViewportOnGraphPoint,
  fitBoundsToCanvas,
  panViewport,
  safeCanvasSize,
  screenToGraphPoint,
  withCenteredViewport,
  withFittedViewport,
  zoomViewportAtCanvasCenter,
  zoomViewportAtCanvasPoint
} from "./canvasController";

describe("canvasController", () => {
  it("converts screen coordinates into graph coordinates", () => {
    expect(screenToGraphPoint({ x: 260, y: 190 }, { left: 10, top: 20 }, { x: 50, y: 30, zoom: 2 })).toEqual({
      x: 100,
      y: 70
    });
  });

  it("zooms around a canvas point while preserving the graph point under the pointer", () => {
    const viewport = { x: 50, y: 40, zoom: 1 };
    const next = zoomViewportAtCanvasPoint(viewport, { x: 250, y: 140 }, 2);

    expect(next).toEqual({ x: -150, y: -60, zoom: 2 });
    expect(screenToGraphPoint({ x: 250, y: 140 }, { left: 0, top: 0 }, viewport)).toEqual(
      screenToGraphPoint({ x: 250, y: 140 }, { left: 0, top: 0 }, next)
    );
  });

  it("zooms around the canvas center and clamps zoom limits", () => {
    expect(zoomViewportAtCanvasCenter({ x: 0, y: 0, zoom: 1 }, { width: 1000, height: 600 }, 12)).toEqual({
      x: -600,
      y: -360,
      zoom: 2.2
    });
  });

  it("centers a graph point in the canvas", () => {
    expect(centerViewportOnGraphPoint({ x: 200, y: 80 }, { width: 1000, height: 600 }, 1.5)).toEqual({
      x: 200,
      y: 180,
      zoom: 1.5
    });
  });

  it("fits graph bounds into the canvas with padding", () => {
    expect(fitBoundsToCanvas({ x: 100, y: 50, width: 400, height: 200 }, { width: 1000, height: 600 }, 200)).toEqual({
      x: -100,
      y: 0,
      zoom: 2
    });
  });

  it("returns graph copies with fitted and centered viewports", () => {
    const graph = {
      id: "graph",
      layout: {
        viewport: { x: 10, y: 20, zoom: 1 }
      },
      nodes: [{ id: "node-a" }]
    };

    const fitted = withFittedViewport(graph, { x: 100, y: 50, width: 400, height: 200 }, { width: 1000, height: 600 }, 200);
    expect(fitted).not.toBe(graph);
    expect(fitted.nodes).toBe(graph.nodes);
    expect(fitted.layout.viewport).toEqual({ x: -100, y: 0, zoom: 2 });
    expect(graph.layout.viewport).toEqual({ x: 10, y: 20, zoom: 1 });

    const centered = withCenteredViewport(graph, { x: 200, y: 80 }, { width: 1000, height: 600 }, 1.5);
    expect(centered.layout.viewport).toEqual({ x: 200, y: 180, zoom: 1.5 });
  });

  it("pans from a pointer delta without changing zoom", () => {
    expect(panViewport({ x: 20, y: 30 }, { x: 75, y: 10 }, { x: 100, y: 80 }, 1.25)).toEqual({
      x: 155,
      y: 60,
      zoom: 1.25
    });
  });

  it("normalizes missing canvas sizes with a fallback", () => {
    expect(safeCanvasSize({ width: 0, height: Number.NaN }, { width: 800, height: 500 })).toEqual({
      width: 800,
      height: 500
    });
  });
});
