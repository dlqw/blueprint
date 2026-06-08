import type { Point } from "../shared/blueprint";

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasRect extends CanvasSize {
  left: number;
  top: number;
}

export interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoomLimits {
  min: number;
  max: number;
}

export interface ViewportLayoutContainer {
  layout: {
    viewport: GraphViewport;
  };
}

export const defaultZoomLimits: ZoomLimits = { min: 0.35, max: 2.2 };

export function screenToGraphPoint(client: Point, rect: Pick<CanvasRect, "left" | "top"> | undefined, viewport: GraphViewport): Point {
  const clientX = Number.isFinite(client.x) ? client.x : 0;
  const clientY = Number.isFinite(client.y) ? client.y : 0;
  return {
    x: (clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom,
    y: (clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom
  };
}

export function centerViewportOnGraphPoint(point: Point, size: CanvasSize, zoom: number): GraphViewport {
  return {
    x: size.width / 2 - point.x * zoom,
    y: size.height / 2 - point.y * zoom,
    zoom
  };
}

export function zoomViewportAtCanvasPoint(
  viewport: GraphViewport,
  canvasPoint: Point,
  nextZoom: number,
  limits: ZoomLimits = defaultZoomLimits
): GraphViewport {
  const zoom = clamp(nextZoom, limits.min, limits.max);
  const graphPoint = {
    x: (canvasPoint.x - viewport.x) / viewport.zoom,
    y: (canvasPoint.y - viewport.y) / viewport.zoom
  };
  return {
    x: canvasPoint.x - graphPoint.x * zoom,
    y: canvasPoint.y - graphPoint.y * zoom,
    zoom
  };
}

export function zoomViewportAtCanvasCenter(
  viewport: GraphViewport,
  size: CanvasSize,
  nextZoom: number,
  limits: ZoomLimits = defaultZoomLimits
): GraphViewport {
  return zoomViewportAtCanvasPoint(viewport, { x: size.width / 2, y: size.height / 2 }, nextZoom, limits);
}

export function fitBoundsToCanvas(
  bounds: ViewportBounds,
  size: CanvasSize,
  padding: number,
  limits: ZoomLimits = defaultZoomLimits
): GraphViewport {
  const availableWidth = Math.max(1, size.width - padding);
  const availableHeight = Math.max(1, size.height - padding);
  const zoom = clamp(Math.min(availableWidth / Math.max(bounds.width, 1), availableHeight / Math.max(bounds.height, 1)), limits.min, limits.max);
  return {
    x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom
  };
}

export function withFittedViewport<T extends ViewportLayoutContainer>(
  graph: T,
  bounds: ViewportBounds,
  size: CanvasSize,
  padding: number,
  limits: ZoomLimits = defaultZoomLimits
): T {
  return {
    ...graph,
    layout: {
      ...graph.layout,
      viewport: fitBoundsToCanvas(bounds, size, padding, limits)
    }
  };
}

export function withCenteredViewport<T extends ViewportLayoutContainer>(graph: T, point: Point, size: CanvasSize, zoom: number): T {
  return {
    ...graph,
    layout: {
      ...graph.layout,
      viewport: centerViewportOnGraphPoint(point, size, zoom)
    }
  };
}

export function panViewport(start: Point, current: Point, viewport: Pick<GraphViewport, "x" | "y">, zoom: number): GraphViewport {
  return {
    x: viewport.x + current.x - start.x,
    y: viewport.y + current.y - start.y,
    zoom
  };
}

export function safeCanvasSize(rect: Pick<CanvasSize, "width" | "height"> | undefined, fallback: CanvasSize): CanvasSize {
  return {
    width: Math.max(1, rect?.width || fallback.width),
    height: Math.max(1, rect?.height || fallback.height)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
