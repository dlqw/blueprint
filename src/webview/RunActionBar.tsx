import { GripVertical, ListChecks, Play, RotateCcw, Square, StepForward, TerminalSquare } from "lucide-react";
import { type CSSProperties, type PointerEvent, useRef, useState } from "react";
import type { Translator } from "./i18n";
import { capturePointer, isolateOverlayEvent, releasePointerCapture } from "./overlayEvents";

type BarOffset = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: BarOffset;
  barRect: DOMRect;
  containerRect: DOMRect;
};

type RunActionBarStyle = CSSProperties & {
  "--run-actionbar-x": string;
  "--run-actionbar-y": string;
};

export type RunActionBarRuntimeState = "idle" | "queued" | "pending" | "running" | "paused" | "error";
export type RunActionBarPlacement = "bottom" | "top";

const viewportInset = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button"));
}

export function RunActionBar(props: {
  running: boolean;
  runtimeState: RunActionBarRuntimeState;
  placement: RunActionBarPlacement;
  bottomPanelOpen: boolean;
  runtimeHistoryCount: number;
  runtimeProgressCount: number;
  queuedRunCount: number;
  errorCount: number;
  warningCount: number;
  t: Translator;
  onRun(): void;
  onCancel(): void;
  onStep(): void;
  onContinue(): void;
  onToggleLogs(): void;
}): JSX.Element {
  const [offset, setOffset] = useState<BarOffset>({ x: 0, y: 0 });
  const dragRef = useRef<DragState | undefined>();
  const activeJobs = (props.running ? 1 : 0) + props.queuedRunCount;
  const progressClassName = props.running ? "run-action-progress active" : "run-action-progress";
  const validationStatus = props.errorCount ? "error" : props.warningCount ? "warning" : "idle";
  const statusClassName = props.runtimeState !== "idle" ? props.runtimeState : validationStatus;
  const statusText = runtimeStateText(props.runtimeState, props.t) ?? (props.errorCount ? props.t("common.errors", { count: props.errorCount }) : props.warningCount ? props.t("common.warnings", { count: props.warningCount }) : props.t("runtime.idle"));
  const queueText = props.queuedRunCount > 0 ? props.t("runControls.queuedCount", { count: props.queuedRunCount }) : undefined;
  const progressText = props.running && props.runtimeProgressCount > 0
    ? props.t("runControls.nodeCount", { count: props.runtimeProgressCount })
    : undefined;
  const hasCustomOffset = offset.x !== 0 || offset.y !== 0;
  const barStyle: RunActionBarStyle = {
    "--run-actionbar-x": `${offset.x}px`,
    "--run-actionbar-y": `${offset.y}px`
  };
  const className = ["run-actionbar", props.placement, dragRef.current ? "dragging" : ""].filter(Boolean).join(" ");

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    isolateOverlayEvent(event);
    if (event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffset: offset,
      barRect: event.currentTarget.getBoundingClientRect(),
      containerRect: container.getBoundingClientRect()
    };
    capturePointer(event.currentTarget, event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    isolateOverlayEvent(event);
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    const minDeltaX = drag.containerRect.left + viewportInset - drag.barRect.left;
    const maxDeltaX = drag.containerRect.right - viewportInset - drag.barRect.right;
    const minDeltaY = drag.containerRect.top + viewportInset - drag.barRect.top;
    const maxDeltaY = drag.containerRect.bottom - viewportInset - drag.barRect.bottom;
    setOffset({
      x: drag.startOffset.x + clamp(deltaX, minDeltaX, maxDeltaX),
      y: drag.startOffset.y + clamp(deltaY, minDeltaY, maxDeltaY)
    });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    isolateOverlayEvent(event);
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = undefined;
      releasePointerCapture(event.currentTarget, event.pointerId);
    }
  };

  return (
    <div
      className={className}
      style={barStyle}
      aria-label={props.t("runControls.label")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={isolateOverlayEvent}
      onContextMenu={isolateOverlayEvent}
    >
      <span className="run-action-grip" aria-hidden="true">
        <GripVertical size={14} />
      </span>
      {hasCustomOffset ? (
        <button type="button" className="run-action-button icon-only" title={props.t("runControls.resetPosition")} onClick={() => setOffset({ x: 0, y: 0 })}>
          <RotateCcw size={15} />
        </button>
      ) : null}
      <button
        type="button"
        className={props.running ? "run-action-button active" : "run-action-button primary"}
        title={props.running ? props.t("runControls.interruptRun") : props.t("runControls.queueRun")}
        onClick={props.running ? props.onCancel : props.onRun}
      >
        {props.running ? <Square size={15} /> : <Play size={15} />}
        <span>{props.running ? props.t("runControls.stop") : props.t("runControls.run")}</span>
      </button>
      <button
        type="button"
        className="run-action-button"
        title={props.running ? props.t("runControls.stepActiveRuntime") : props.t("runControls.queueStepRun")}
        onClick={props.onStep}
      >
        <StepForward size={15} />
        <span>{props.running ? props.t("runControls.step") : props.t("runControls.stepRun")}</span>
      </button>
      {props.running ? (
        <button type="button" className="run-action-button" title={props.t("runControls.continueActiveRuntime")} onClick={props.onContinue}>
          <Play size={15} />
          <span>{props.t("runControls.continue")}</span>
        </button>
      ) : null}
      <button
        type="button"
        className={props.bottomPanelOpen ? "run-action-count active" : "run-action-count"}
        title={runCountTitle(props.bottomPanelOpen, props.running, props.queuedRunCount, props.t)}
        onClick={props.onToggleLogs}
      >
        <ListChecks size={14} />
        <span>{activeJobs}</span>
        <small>{props.runtimeHistoryCount}</small>
      </button>
      <button
        type="button"
        className={props.bottomPanelOpen ? "run-action-button active" : "run-action-button"}
        title={props.bottomPanelOpen ? props.t("runControls.collapseLogs") : props.t("runControls.expandLogs")}
        onClick={props.onToggleLogs}
      >
        <TerminalSquare size={15} />
      </button>
      <span className={`run-action-status ${statusClassName}`}>{statusText}</span>
      {queueText ? <span className="run-action-queue-count" title={props.t("runControls.queuedRuns")}>{queueText}</span> : null}
      {progressText ? <span className="run-action-progress-count" title={props.t("runControls.progressNodes")}>{progressText}</span> : null}
      <span className={progressClassName} aria-hidden="true" />
    </div>
  );
}

function runtimeStateText(state: RunActionBarRuntimeState, t: Translator): string | undefined {
  switch (state) {
    case "queued":
      return t("runtime.queued");
    case "pending":
      return t("runtime.pending");
    case "running":
      return t("runtime.running");
    case "paused":
      return t("runtime.paused");
    case "error":
      return t("runtime.error");
    case "idle":
      return undefined;
  }
}

function runCountTitle(bottomPanelOpen: boolean, running: boolean, queuedRunCount: number, t: Translator): string {
  const details = [
    running ? t("runControls.runningCount", { count: 1 }) : undefined,
    queuedRunCount ? t("runControls.queuedCount", { count: queuedRunCount }) : undefined
  ].filter(Boolean).join(", ");
  const action = bottomPanelOpen ? t("runControls.hideHistory") : t("runControls.showHistory");
  return details ? `${action} (${details})` : action;
}
