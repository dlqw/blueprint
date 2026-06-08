import type { CSSProperties, MouseEventHandler, PointerEventHandler, ReactNode, RefObject, WheelEventHandler } from "react";

interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

type GridStyle = CSSProperties & {
  "--grid-minor-size": string;
  "--grid-major-size": string;
  "--grid-minor-position": string;
  "--grid-major-position": string;
};

const minorGridWorldSize = 24;
const majorGridWorldSize = minorGridWorldSize * 5;

function gridOffset(value: number, screenStep: number): number {
  return Math.round(((value % screenStep) + screenStep) % screenStep);
}

export function viewportGridStyle(viewport: GraphViewport): GridStyle {
  const minorGridSize = minorGridWorldSize * viewport.zoom;
  const majorGridSize = majorGridWorldSize * viewport.zoom;
  return {
    "--grid-minor-size": `${minorGridSize}px ${minorGridSize}px`,
    "--grid-major-size": `${majorGridSize}px ${majorGridSize}px`,
    "--grid-minor-position": `${gridOffset(viewport.x, minorGridSize)}px ${gridOffset(viewport.y, minorGridSize)}px`,
    "--grid-major-position": `${gridOffset(viewport.x, majorGridSize)}px ${gridOffset(viewport.y, majorGridSize)}px`
  };
}

export function GraphCanvas(props: {
  canvasRef: RefObject<HTMLDivElement>;
  viewport: GraphViewport;
  gridVisible: boolean;
  interactionKind: string;
  wires: ReactNode;
  graphLayer: ReactNode;
  overlays?: ReactNode;
  onWheel: WheelEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onContextMenu: MouseEventHandler<HTMLDivElement>;
}): JSX.Element {
  const transform = `translate(${props.viewport.x}px, ${props.viewport.y}px) scale(${props.viewport.zoom})`;
  const svgTransform = `translate(${props.viewport.x} ${props.viewport.y}) scale(${props.viewport.zoom})`;
  const gridStyle = viewportGridStyle(props.viewport);

  return (
    <div
      ref={props.canvasRef}
      className="canvas"
      onWheel={props.onWheel}
      onPointerMove={props.onPointerMove}
      onPointerDown={props.onPointerDown}
      onPointerUp={props.onPointerUp}
      onContextMenu={props.onContextMenu}
      data-interaction={props.interactionKind}
    >
      {props.gridVisible ? <div className="grid" style={gridStyle} /> : null}
      <svg className="wires">
        <g transform={svgTransform}>{props.wires}</g>
      </svg>
      <div className="graph-layer" style={{ transform }}>
        {props.graphLayer}
      </div>
      {props.overlays}
    </div>
  );
}
