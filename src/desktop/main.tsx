import * as React from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { Bug, ChevronDown, ChevronRight, CircleDot, ClipboardPaste, Command, Copy, FileJson, FolderOpen, GitBranch, Maximize2, Minus, Package as PackageIcon, PanelLeft, PanelRight, Play, Plus, Redo2, RefreshCw, Search, Settings, Trash2, Undo2, X } from "lucide-react";
import { getBuiltinTemplates } from "../shared/builtins";
import { extractCollapsedUnitToProjectGraph } from "../shared/collapse";
import {
  BlueprintGraph,
  BlueprintGraphSearchEntry,
  BlueprintBreakpointSpec,
  BlueprintNodeInstance,
  BlueprintNodeTemplate,
  BlueprintProject,
  RuntimeTraceEvent,
  BlueprintSolutionGraphSearchIndex,
  BlueprintSolutionOutline,
  EditorToHostMessage,
  HostToEditorMessage,
  sanitizeIdentifier,
  TemplateRegistrySourceSummary
} from "../shared/blueprint";
import { validateGraph } from "../shared/graph";
import { renameNodeIdInGraph } from "../shared/nodeRefactor";
import { createTemplateSourceRetargetPlan, retargetTemplateIdInGraph, retargetTemplateSourceInGraph, templatesHaveCompatibleInterface } from "../shared/templateRefactor";
import { App } from "../webview/App";
import { createTranslator, defaultLocale } from "../webview/i18n";
import "../webview/styles.css";
import "./desktop.css";
import { renameBlackboardKeyInGraph, renameBlackboardKeyInProject } from "./blackboardRefactor";
import { isBlueprintGraph, isBlueprintProject } from "./blueprintFileGuards";
import { createDesktopWebviewApi, desktopGraphKey, desktopSolutionKey, readJsonStorage, writeJsonStorage } from "./desktopWebviewState";
import { desktopSampleGraph } from "./sampleGraph";
import { BlueprintGraphSummary, BlueprintLaunchContext, BlueprintSolutionSummary, BlueprintSolutionTemplateId, tauriBlueprintHost } from "./tauriBlueprintHost";

interface BlueprintShellStatus {
  shell: string;
  version: string;
  primary_path: boolean;
}

const builtinTemplates = getBuiltinTemplates();
const desktopT = createTranslator(defaultLocale);
const hubWindowSize = new LogicalSize(760, 420);
const hubWindowMinSize = new LogicalSize(720, 400);
const workspaceWindowSize = new LogicalSize(1400, 900);
let activeTemplates = builtinTemplates;
let activeGraphPath: string | undefined;
let activeGraph: BlueprintGraph = readStoredGraph() ?? desktopSampleGraph;
let templateLoadRequestId = 0;
let solutionGraphIndexRequestId = 0;
let runtimeRunSequence = 0;
let activeRuntimeRun: PendingRuntimeRun | undefined;
let activePreviewRuntimeRun: PreviewRuntimeRun | undefined;
const pendingRuntimeRuns: PendingRuntimeRun[] = [];
const desktopRecentSolutionsKey = "blueprint.desktop.recentSolutions";
let updateSelectedGraphPathFromEditor: ((path: string) => void) | undefined;
let updateSolutionFromEditor: ((solution: BlueprintSolutionSummary) => void) | undefined;

type DesktopLeftDockTab = "tree" | "run" | "source";
type DesktopRightDockTab = "commands" | "debug" | "settings" | "inspector";
type DesktopDockTab = DesktopLeftDockTab | DesktopRightDockTab;
type DesktopDockSide = "left" | "right";

const desktopDockTabMime = "application/x-blueprint-dock-tab";
const defaultLeftDockTabs: DesktopDockTab[] = ["tree", "run", "source"];
const defaultRightDockTabs: DesktopDockTab[] = ["commands", "debug", "settings", "inspector"];

interface PendingRuntimeRun {
  id: string;
  graph: BlueprintGraph;
  graphPath?: string;
  breakpoints?: BlueprintBreakpointSpec[];
  stepMode?: boolean;
}

interface PreviewRuntimeRun {
  id: string;
  graph: BlueprintGraph;
  nodes: BlueprintNodeInstance[];
  traces: RuntimeTraceEvent[];
  index: number;
  stepMode: boolean;
  continueRuntime: boolean;
  paused: boolean;
  canceled: boolean;
  startedAt: number;
  timer?: number;
}

interface BlueprintRuntimeTracePayload {
  runId?: string;
  trace: RuntimeTraceEvent;
}

interface BlueprintRuntimeResultPayload {
  runId?: string;
  ok: boolean;
  message: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  traces: RuntimeTraceEvent[];
}

interface DesktopRunStatus {
  phase: "idle" | "compiling" | "running" | "ok" | "error";
  message: string;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}

interface SolutionBlackboardRenameSummary {
  oldKey: string;
  nextKey: string;
  projectFilesChanged: number;
  projectVariablesChanged: number;
  graphFilesChanged: number;
  nodeBindingsChanged: number;
}

interface SolutionTemplateRetargetSummary {
  oldTemplateId: string;
  nextTemplateId: string;
  graphFilesChanged: number;
  nodeTemplatesChanged: number;
}

interface SolutionTemplateSourceRetargetSummary {
  oldSourcePath: string;
  nextSourcePath: string;
  mappedTemplateIds: number;
  unmatchedTemplateIds: number;
  graphFilesChanged: number;
  nodeTemplatesChanged: number;
}

const desktopApi = createDesktopWebviewApi((message) => {
  void handleEditorMessage(message);
});

window.blueprintEditorHostApi = desktopApi;

void listen<BlueprintRuntimeTracePayload>("blueprint-runtime-trace", (event) => {
  sendToEditor({ type: "runtimeTrace", runId: event.payload.runId, trace: event.payload.trace });
}).catch((error: unknown) => {
  console.warn("Runtime trace events are unavailable.", error);
});

void listen<BlueprintRuntimeResultPayload>("blueprint-runtime-result", (event) => {
  completeRuntimeRun(event.payload);
}).catch((error: unknown) => {
  console.warn("Runtime result events are unavailable.", error);
});

function hasTauriWindowRuntime(): boolean {
  const internals = (window as typeof window & {
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
  }).__TAURI_INTERNALS__;
  return Boolean(internals?.metadata?.currentWindow?.label);
}

function sendToEditor(message: HostToEditorMessage): void {
  window.postMessage(message, "*");
}

async function loadInitialGraph(): Promise<BlueprintGraph> {
  const graphPath = new URLSearchParams(window.location.search).get("graphPath") ?? undefined;
  if (graphPath) {
    const file = await tauriBlueprintHost.readBlueprintFile(graphPath);
    if (isBlueprintGraph(file)) {
      activeGraphPath = graphPath;
      return file;
    }
    console.error(`Desktop graphPath does not point to a .bpgraph file: ${graphPath}`);
  }

  const status = await invoke<BlueprintShellStatus>("blueprint_shell_status").catch(() => undefined);
  return {
    ...activeGraph,
    description: status?.primary_path
      ? `${activeGraph.description} ${desktopT("desktop.hostPrefix")}${status.shell} ${status.version}.`
      : activeGraph.description
  };
}

async function bootstrapDesktopEditor(): Promise<void> {
  activeGraph = await loadInitialGraph().catch((error: unknown) => {
    console.error(error);
    return desktopSampleGraph;
  });

  publishGraph(activeGraph);
}

function publishGraph(graph: BlueprintGraph): void {
  activeGraph = graph;
  writeJsonStorage(desktopGraphKey, graph);
  sendToEditor({ type: "editorCapabilities", nativeUndoRedo: false });
  sendToEditor({ type: "themeSettings", categoryAccents: {} });
  sendToEditor({ type: "loadTemplates", templates: activeTemplates });
  sendToEditor({ type: "solutionOutline", solution: solutionOutlineFromSolution(readStoredSolution()) });
  sendToEditor({ type: "templateRegistrySources", sources: templateRegistrySourcesFromSolution(readStoredSolution()) });
  void publishSolutionGraphIndex(readStoredSolution());
  sendToEditor({ type: "loadGraph", graph });
  sendToEditor({ type: "validationResult", issues: validateGraph(graph, activeTemplates) });
}

async function loadGraphPath(path: string): Promise<BlueprintGraph> {
  const file = await tauriBlueprintHost.readBlueprintFile(path);
  if (!isBlueprintGraph(file)) {
    throw new Error(desktopT("desktop.error.selectedFileNotGraph", { graphPath: path }));
  }
  activeGraphPath = path;
  publishGraph(file);
  return file;
}

async function handleEditorMessage(message: EditorToHostMessage): Promise<void> {
  if (message.type === "ready") {
    await bootstrapDesktopEditor();
    return;
  }

  if (message.type === "graphChanged") {
    activeGraph = message.graph;
    writeJsonStorage(desktopGraphKey, message.graph);
    if (activeGraphPath) {
      await tauriBlueprintHost.writeBlueprintFile(activeGraphPath, message.graph).catch((error: unknown) => console.error(error));
      void publishSolutionGraphIndex(readStoredSolution());
    }
    sendToEditor({ type: "validationResult", issues: validateGraph(message.graph, activeTemplates) });
    return;
  }

  if (message.type === "requestTemplates") {
    sendToEditor({ type: "loadTemplates", templates: activeTemplates });
    return;
  }

  if (message.type === "requestValidation") {
    sendToEditor({ type: "validationResult", issues: validateGraph(message.graph, activeTemplates) });
    return;
  }

  if (message.type === "requestOpenGraph") {
    await loadGraphPath(message.graphPath).catch((error: unknown) => console.error(error));
    updateSelectedGraphPathFromEditor?.(message.graphPath);
    return;
  }

  if (message.type === "requestRenameSolutionGraph") {
    try {
      const result = await renameSolutionGraph(message.graphPath, message.nextName);
      sendToEditor({ type: "refactorResult", ok: true, message: result });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(error);
      sendToEditor({ type: "refactorResult", ok: false, message: desktopT("desktop.error.graphRenameFailed", { error: errorMessage }) });
    }
    return;
  }

  if (message.type === "requestRenameGraphNodeId") {
    try {
      const result = await renameActiveGraphNodeId(message.oldNodeId, message.nextNodeId);
      sendToEditor({ type: "refactorResult", ok: true, message: result.message });
      if (result.nextNodeId) {
        sendToEditor({ type: "focusNode", nodeId: result.nextNodeId });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(error);
      sendToEditor({ type: "refactorResult", ok: false, message: desktopT("desktop.error.nodeRenameFailed", { error: errorMessage }) });
    }
    return;
  }

  if (message.type === "requestRenameSolutionBlackboardKey") {
    try {
      const result = await renameSolutionBlackboardKey(message.oldKey, message.nextKey);
      sendToEditor({ type: "refactorResult", ok: true, message: blackboardRenameMessage(result) });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(error);
      sendToEditor({ type: "refactorResult", ok: false, message: desktopT("desktop.error.refactorFailed", { error: errorMessage }) });
    }
    return;
  }

  if (message.type === "requestRetargetSolutionTemplate") {
    try {
      const result = await retargetSolutionTemplate(message.oldTemplateId, message.nextTemplateId);
      sendToEditor({ type: "refactorResult", ok: true, message: templateRetargetMessage(result) });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(error);
      sendToEditor({ type: "refactorResult", ok: false, message: desktopT("desktop.error.templateRefactorFailed", { error: errorMessage }) });
    }
    return;
  }

  if (message.type === "requestRetargetSolutionTemplateSource") {
    try {
      const result = await retargetSolutionTemplateSource(message.oldSourcePath, message.nextSourcePath);
      sendToEditor({ type: "refactorResult", ok: true, message: templateSourceRetargetMessage(result) });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(error);
      sendToEditor({ type: "refactorResult", ok: false, message: desktopT("desktop.error.sourceRefactorFailed", { error: errorMessage }) });
    }
    return;
  }

  if (message.type === "requestExtractCollapsedUnitToProjectGraph") {
    try {
      const result = await extractCollapsedUnitToProjectFile(message.templateId, message.graphName);
      sendToEditor({ type: "refactorResult", ok: true, message: result });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(error);
      sendToEditor({ type: "refactorResult", ok: false, message: desktopT("desktop.error.extractCollapsedUnitFailed", { error: errorMessage }) });
    }
    return;
  }

  if (message.type === "requestCompile") {
    const result = await tauriBlueprintHost.compileGraph(message.graph, activeGraphPath).catch((error: unknown) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      issues: []
    }));
    sendToEditor({ type: "compileResult", ok: result.ok, message: result.message, issues: result.issues });
    return;
  }

  if (message.type === "requestRun") {
    enqueueRuntimeRun(message.graph, {
      runId: message.runId,
      breakpoints: message.breakpoints,
      stepMode: message.stepMode
    });
    return;
  }

  if (message.type === "requestRuntimeStep") {
    if (!hasTauriWindowRuntime()) {
      stepPreviewRuntimeRun(activeRuntimeRun?.id);
      return;
    }
    await tauriBlueprintHost.runtimeStep(activeRuntimeRun?.id).catch((error: unknown) => {
      console.error(error);
    });
    return;
  }

  if (message.type === "requestRuntimeContinue") {
    if (!hasTauriWindowRuntime()) {
      continuePreviewRuntimeRun(activeRuntimeRun?.id);
      return;
    }
    await tauriBlueprintHost.runtimeContinue(activeRuntimeRun?.id).catch((error: unknown) => {
      console.error(error);
    });
    return;
  }

  if (message.type === "requestCancelRun") {
    pendingRuntimeRuns.length = 0;
    if (!hasTauriWindowRuntime()) {
      cancelPreviewRuntimeRun(activeRuntimeRun?.id);
      if (!activeRuntimeRun) {
        publishRuntimeQueueStatus();
      }
      return;
    }
    await tauriBlueprintHost.cancelRuntimeRun(activeRuntimeRun?.id).catch((error: unknown) => {
      console.error(error);
    });
    if (!activeRuntimeRun) {
      publishRuntimeQueueStatus();
    }
    return;
  }
}

function enqueueRuntimeRun(graph: BlueprintGraph, options: { runId?: string; breakpoints?: BlueprintBreakpointSpec[]; stepMode?: boolean } = {}): void {
  pendingRuntimeRuns.push({
    id: options.runId ?? `run-${++runtimeRunSequence}`,
    graph,
    graphPath: activeGraphPath,
    breakpoints: options.breakpoints,
    stepMode: options.stepMode
  });
  publishRuntimeQueueStatus();
  void drainRuntimeRunQueue();
}

async function drainRuntimeRunQueue(): Promise<void> {
  if (activeRuntimeRun) {
    return;
  }
  const nextRun = pendingRuntimeRuns.shift();
  if (!nextRun) {
    publishRuntimeQueueStatus();
    return;
  }

  activeRuntimeRun = nextRun;
  publishRuntimeQueueStatus();
  if (!hasTauriWindowRuntime()) {
    startPreviewRuntimeRun(nextRun);
    return;
  }
  await tauriBlueprintHost.runGraph(nextRun.graph, nextRun.graphPath, {
    runId: nextRun.id,
    breakpoints: nextRun.breakpoints,
    stepMode: nextRun.stepMode,
    streamEvents: true
  }).catch((error: unknown) => {
    completeRuntimeRun({
      runId: nextRun.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      stdout: "",
      stderr: "",
      durationMs: 0,
      traces: []
    });
  });
}

function startPreviewRuntimeRun(run: PendingRuntimeRun): void {
  activePreviewRuntimeRun = {
    id: run.id,
    graph: run.graph,
    nodes: previewRuntimeNodeOrder(run.graph),
    traces: [],
    index: 0,
    stepMode: run.stepMode === true,
    continueRuntime: false,
    paused: false,
    canceled: false,
    startedAt: Date.now()
  };
  schedulePreviewRuntimeRun(activePreviewRuntimeRun, 120);
}

function schedulePreviewRuntimeRun(session: PreviewRuntimeRun, delayMs: number): void {
  window.clearTimeout(session.timer);
  session.timer = window.setTimeout(() => advancePreviewRuntimeRun(session.id), delayMs);
}

function advancePreviewRuntimeRun(runId: string): void {
  const session = activePreviewRuntimeRun;
  if (!session || session.id !== runId || session.canceled || session.paused) {
    return;
  }
  const node = session.nodes[session.index];
  if (!node) {
    completePreviewRuntimeRun(session, {
      ok: true,
      message: "Preview run completed.",
      stdout: "Preview run completed.\n",
      stderr: ""
    });
    return;
  }

  const template = activeTemplates.find((candidate) => candidate.id === node.templateId);
  const baseTrace = {
    graphId: session.graph.id,
    nodeId: node.id,
    nodeName: template?.name ?? node.id,
    timestamp: Date.now() - session.startedAt
  };
  const activeTrace: RuntimeTraceEvent = { ...baseTrace, status: "active" };
  emitPreviewRuntimeTrace(session, activeTrace);

  if (previewBreakpointHit(node.id)) {
    const breakpointTrace: RuntimeTraceEvent = { ...baseTrace, status: "breakpoint", message: `Preview breakpoint hit at ${node.id}`, timestamp: Date.now() - session.startedAt };
    emitPreviewRuntimeTrace(session, breakpointTrace);
    completePreviewRuntimeRun(session, {
      ok: false,
      message: breakpointTrace.message ?? "Preview breakpoint hit.",
      stdout: "",
      stderr: breakpointTrace.message ?? "Preview breakpoint hit."
    });
    return;
  }

  if (session.stepMode && !session.continueRuntime) {
    const pausedTrace: RuntimeTraceEvent = { ...baseTrace, status: "paused", timestamp: Date.now() - session.startedAt };
    emitPreviewRuntimeTrace(session, pausedTrace);
    session.paused = true;
    return;
  }

  schedulePreviewRuntimeVisit(session, node.id, baseTrace);
}

function schedulePreviewRuntimeVisit(session: PreviewRuntimeRun, nodeId: string, baseTrace: Omit<RuntimeTraceEvent, "status">): void {
  window.clearTimeout(session.timer);
  session.timer = window.setTimeout(() => {
    if (activePreviewRuntimeRun?.id !== session.id || session.canceled || session.paused) {
      return;
    }
    emitPreviewRuntimeTrace(session, { ...baseTrace, status: "visited", timestamp: Date.now() - session.startedAt });
    if (session.nodes[session.index]?.id === nodeId) {
      session.index += 1;
    }
    schedulePreviewRuntimeRun(session, 180);
  }, 260);
}

function stepPreviewRuntimeRun(runId: string | undefined): void {
  const session = activePreviewRuntimeRun;
  if (!session || (runId && session.id !== runId)) {
    return;
  }
  if (session.paused) {
    session.paused = false;
    const node = session.nodes[session.index];
    const template = node ? activeTemplates.find((candidate) => candidate.id === node.templateId) : undefined;
    if (node) {
      emitPreviewRuntimeTrace(session, {
        graphId: session.graph.id,
        nodeId: node.id,
        nodeName: template?.name ?? node.id,
        status: "visited",
        timestamp: Date.now() - session.startedAt
      });
      session.index += 1;
    }
  }
  schedulePreviewRuntimeRun(session, 120);
}

function continuePreviewRuntimeRun(runId: string | undefined): void {
  const session = activePreviewRuntimeRun;
  if (!session || (runId && session.id !== runId)) {
    return;
  }
  session.continueRuntime = true;
  stepPreviewRuntimeRun(runId);
}

function cancelPreviewRuntimeRun(runId: string | undefined): void {
  const session = activePreviewRuntimeRun;
  if (!session || (runId && session.id !== runId)) {
    activeRuntimeRun = undefined;
    return;
  }
  session.canceled = true;
  window.clearTimeout(session.timer);
  completePreviewRuntimeRun(session, {
    ok: false,
    message: "Run canceled.",
    stdout: "",
    stderr: ""
  });
}

function completePreviewRuntimeRun(session: PreviewRuntimeRun, result: { ok: boolean; message: string; stdout: string; stderr: string }): void {
  if (activePreviewRuntimeRun?.id === session.id) {
    activePreviewRuntimeRun = undefined;
  }
  completeRuntimeRun({
    runId: session.id,
    ok: result.ok,
    message: result.message,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - session.startedAt,
    traces: session.traces
  });
}

function emitPreviewRuntimeTrace(session: PreviewRuntimeRun, trace: RuntimeTraceEvent): void {
  session.traces.push(trace);
  sendToEditor({ type: "runtimeTrace", runId: session.id, trace });
}

function previewBreakpointHit(nodeId: string): boolean {
  return (activeRuntimeRun?.breakpoints ?? []).some((breakpoint) => {
    if (typeof breakpoint === "string") {
      return breakpoint === nodeId;
    }
    return breakpoint.nodeId === nodeId && breakpoint.enabled !== false;
  });
}

function previewRuntimeNodeOrder(graph: BlueprintGraph): BlueprintNodeInstance[] {
  const executableNodes = graph.nodes.filter((node) => !previewNodeDisabled(node));
  const executableNodeIds = new Set(executableNodes.map((node) => node.id));
  const nodesById = new Map(executableNodes.map((node) => [node.id, node]));
  const controlLinks = graph.links.filter((link) => link.flowKind !== "data" && executableNodeIds.has(link.fromNodeId) && executableNodeIds.has(link.toNodeId));
  const linkedTargets = new Set(controlLinks.map((link) => link.toNodeId));
  const entry = executableNodes.find((node) => !linkedTargets.has(node.id)) ?? executableNodes[0];
  if (!entry) {
    return [];
  }
  const ordered: BlueprintNodeInstance[] = [];
  const visited = new Set<string>();
  let current: BlueprintNodeInstance | undefined = entry;
  while (current && !visited.has(current.id)) {
    ordered.push(current);
    visited.add(current.id);
    const nextLink = controlLinks.find((link) => link.fromNodeId === current?.id);
    current = nextLink ? nodesById.get(nextLink.toNodeId) : undefined;
  }
  return [
    ...ordered,
    ...executableNodes.filter((node) => !visited.has(node.id))
  ];
}

function previewNodeDisabled(node: BlueprintNodeInstance): boolean {
  return node.displayOverrides?.disabled === true;
}

function completeRuntimeRun(result: BlueprintRuntimeResultPayload): void {
  if (result.runId && (!activeRuntimeRun || activeRuntimeRun.id !== result.runId)) {
    return;
  }
  sendToEditor({ type: "runtimeResult", ...result });
  activeRuntimeRun = undefined;
  publishRuntimeQueueStatus();
  void drainRuntimeRunQueue();
}

function publishRuntimeQueueStatus(): void {
  sendToEditor({
    type: "runtimeQueueStatus",
    status: {
      running: Boolean(activeRuntimeRun),
      queuedRuns: pendingRuntimeRuns.length,
      activeRunId: activeRuntimeRun?.id
    }
  });
}

function readStoredGraph(): BlueprintGraph | undefined {
  const value = readJsonStorage(desktopGraphKey);
  return isBlueprintGraph(value) ? value : undefined;
}

function readStoredSolution(): BlueprintSolutionSummary | undefined {
  const value = readJsonStorage(desktopSolutionKey);
  return isBlueprintSolutionSummary(value) ? value : undefined;
}

function isBlueprintSolutionSummary(value: unknown): value is BlueprintSolutionSummary {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { name?: unknown }).name === "string" &&
    Array.isArray((value as { projects?: unknown }).projects)
  );
}

function readRecentSolutions(): BlueprintSolutionSummary[] {
  const value = readJsonStorage(desktopRecentSolutionsKey);
  return Array.isArray(value) ? value.filter(isBlueprintSolutionSummary).slice(0, 8) : [];
}

function rememberRecentSolution(solution: BlueprintSolutionSummary): BlueprintSolutionSummary[] {
  const next = [
    solution,
    ...readRecentSolutions().filter((candidate) => candidate.path !== solution.path)
  ].slice(0, 8);
  writeJsonStorage(desktopRecentSolutionsKey, next);
  return next;
}

function publishTemplateRegistrySources(solution: BlueprintSolutionSummary | undefined): void {
  sendToEditor({ type: "templateRegistrySources", sources: templateRegistrySourcesFromSolution(solution) });
}

function publishSolutionOutline(solution: BlueprintSolutionSummary | undefined): void {
  sendToEditor({ type: "solutionOutline", solution: solutionOutlineFromSolution(solution) });
}

async function publishSolutionGraphIndex(solution: BlueprintSolutionSummary | undefined): Promise<void> {
  const requestId = ++solutionGraphIndexRequestId;
  if (!solution) {
    sendToEditor({ type: "solutionGraphIndex", index: undefined });
    return;
  }

  const graphs = (await Promise.all(solution.projects.flatMap((project) =>
    project.graphs.map(async (graphSummary): Promise<BlueprintGraphSearchEntry | undefined> => {
      const graph = activeGraphPath === graphSummary.path
        ? activeGraph
        : await tauriBlueprintHost.readBlueprintFile(graphSummary.path).catch((error: unknown) => {
            console.error(error);
            return undefined;
          });
      if (!isBlueprintGraph(graph)) {
        return undefined;
      }
      const generatedFunctionName = sanitizeIdentifier(graph.name);
      return {
        projectPath: project.path,
        projectName: project.name,
        graphPath: graphSummary.path,
        graphId: graph.id,
        graphName: graph.name,
        graphKind: graph.kind ?? graphSummary.kind,
        description: graph.description,
        inputNames: (graph.templateMetadata?.inputs ?? []).map((port) => port.name),
        outputNames: (graph.templateMetadata?.outputs ?? []).map((port) => port.name),
        comments: (graph.comments ?? []).map((comment) => [comment.title, comment.id].filter(Boolean).join(" ")),
        generatedSourceName: `${generatedFunctionName}.ts`,
        generatedFunctionName,
        nodes: graph.nodes.map((node) => ({
          id: node.id,
          templateId: node.templateId,
          inputPortIds: Object.keys(node.inputBindings),
          outputPortIds: Object.values(node.controlBindings ?? {}),
          generatedTraceRef: `${generatedFunctionName}:${node.id}`,
          ...blackboardReferenceForSearchIndex(node)
        }))
      };
    })
  ))).filter((entry): entry is BlueprintGraphSearchEntry => Boolean(entry));

  if (requestId !== solutionGraphIndexRequestId) {
    return;
  }
  sendToEditor({ type: "solutionGraphIndex", index: { solutionPath: solution.path, graphs } satisfies BlueprintSolutionGraphSearchIndex });
}

function blackboardReferenceForSearchIndex(node: BlueprintGraph["nodes"][number]): { blackboardKey: string; blackboardAccess: "get" | "set" } | Record<string, never> {
  if (node.templateId !== "builtin.blackboard.get" && node.templateId !== "builtin.blackboard.set") {
    return {};
  }
  const keyBinding = node.inputBindings.key;
  if (keyBinding?.sourceKind !== "literal" || typeof keyBinding.literalValue !== "string" || !keyBinding.literalValue.trim()) {
    return {};
  }
  return {
    blackboardKey: keyBinding.literalValue,
    blackboardAccess: node.templateId === "builtin.blackboard.get" ? "get" : "set"
  };
}

async function renameSolutionBlackboardKey(oldKey: string, nextKey: string): Promise<SolutionBlackboardRenameSummary> {
  const solution = readStoredSolution();
  const from = oldKey.trim();
  const to = nextKey.trim();
  if (!solution) {
    throw new Error(desktopT("desktop.error.noSolutionLoaded"));
  }
  if (!from || !to) {
    throw new Error(desktopT("desktop.error.blackboardNamesEmpty"));
  }
  if (from === to) {
    return {
      oldKey: from,
      nextKey: to,
      projectFilesChanged: 0,
      projectVariablesChanged: 0,
      graphFilesChanged: 0,
      nodeBindingsChanged: 0
    };
  }

  const projectRenames = await Promise.all(solution.projects.map(async (projectSummary) => {
    const project = await tauriBlueprintHost.readBlueprintFile(projectSummary.path);
    if (!isBlueprintProject(project)) {
      throw new Error(desktopT("desktop.error.selectedFileNotProject", { projectPath: projectSummary.path }));
    }
    return {
      path: projectSummary.path,
      ...renameBlackboardKeyInProject(project, from, to)
    };
  }));

  const graphRenames = await Promise.all(solution.projects.flatMap((project) =>
    project.graphs.map(async (graphSummary) => {
      const graph = activeGraphPath === graphSummary.path
        ? activeGraph
        : await tauriBlueprintHost.readBlueprintFile(graphSummary.path);
      if (!isBlueprintGraph(graph)) {
        throw new Error(desktopT("desktop.error.selectedFileNotGraph", { graphPath: graphSummary.path }));
      }
      return {
        path: graphSummary.path,
        ...renameBlackboardKeyInGraph(graph, from, to)
      };
    })
  ));

  await Promise.all(projectRenames
    .filter((entry) => entry.changedVariableIds.length)
    .map((entry) => tauriBlueprintHost.writeBlueprintFile(entry.path, entry.project)));
  await Promise.all(graphRenames
    .filter((entry) => entry.changedNodeIds.length)
    .map((entry) => tauriBlueprintHost.writeBlueprintFile(entry.path, entry.graph)));

  const activeGraphRename = activeGraphPath
    ? graphRenames.find((entry) => entry.path === activeGraphPath && entry.changedNodeIds.length)
    : undefined;
  if (activeGraphRename) {
    publishGraph(activeGraphRename.graph);
  } else {
    void publishSolutionGraphIndex(solution);
  }

  return {
    oldKey: from,
    nextKey: to,
    projectFilesChanged: projectRenames.filter((entry) => entry.changedVariableIds.length).length,
    projectVariablesChanged: projectRenames.reduce((count, entry) => count + entry.changedVariableIds.length, 0),
    graphFilesChanged: graphRenames.filter((entry) => entry.changedNodeIds.length).length,
    nodeBindingsChanged: graphRenames.reduce((count, entry) => count + entry.changedNodeIds.length, 0)
  };
}

async function retargetSolutionTemplate(oldTemplateId: string, nextTemplateId: string): Promise<SolutionTemplateRetargetSummary> {
  const solution = readStoredSolution();
  const from = oldTemplateId.trim();
  const to = nextTemplateId.trim();
  if (!solution) {
    throw new Error(desktopT("desktop.error.noSolutionLoaded"));
  }
  if (!from || !to) {
    throw new Error(desktopT("desktop.error.templateIdsEmpty"));
  }
  if (from === to) {
    return {
      oldTemplateId: from,
      nextTemplateId: to,
      graphFilesChanged: 0,
      nodeTemplatesChanged: 0
    };
  }
  const oldTemplate = activeTemplates.find((template) => template.id === from);
  const nextTemplate = activeTemplates.find((template) => template.id === to);
  if (!nextTemplate) {
    throw new Error(desktopT("desktop.error.templateNotLoaded", { templateId: to }));
  }
  if (oldTemplate && !templatesHaveCompatibleInterface(oldTemplate, nextTemplate)) {
    throw new Error(desktopT("desktop.error.templateNotCompatible", { nextTemplateId: to, oldTemplateId: from }));
  }

  const graphRetargets = await Promise.all(solution.projects.flatMap((project) =>
    project.graphs.map(async (graphSummary) => {
      const graph = activeGraphPath === graphSummary.path
        ? activeGraph
        : await tauriBlueprintHost.readBlueprintFile(graphSummary.path);
      if (!isBlueprintGraph(graph)) {
        throw new Error(desktopT("desktop.error.selectedFileNotGraph", { graphPath: graphSummary.path }));
      }
      return {
        path: graphSummary.path,
        ...retargetTemplateIdInGraph(graph, from, to)
      };
    })
  ));

  await writeChangedGraphsAndRefresh(solution, graphRetargets);

  return {
    oldTemplateId: from,
    nextTemplateId: to,
    graphFilesChanged: graphRetargets.filter((entry) => entry.changedNodeIds.length).length,
    nodeTemplatesChanged: graphRetargets.reduce((count, entry) => count + entry.changedNodeIds.length, 0)
  };
}

async function retargetSolutionTemplateSource(oldSourcePath: string, nextSourcePath: string): Promise<SolutionTemplateSourceRetargetSummary> {
  const solution = readStoredSolution();
  if (!solution) {
    throw new Error(desktopT("desktop.error.noSolutionLoaded"));
  }
  const plan = createTemplateSourceRetargetPlan(activeTemplates, oldSourcePath, nextSourcePath);
  if (!plan.oldSourcePath || !plan.nextSourcePath) {
    throw new Error(desktopT("desktop.error.templateSourcePathsEmpty"));
  }
  if (plan.oldSourcePath === plan.nextSourcePath) {
    return {
      oldSourcePath: plan.oldSourcePath,
      nextSourcePath: plan.nextSourcePath,
      mappedTemplateIds: 0,
      unmatchedTemplateIds: 0,
      graphFilesChanged: 0,
      nodeTemplatesChanged: 0
    };
  }
  if (!plan.sourceTemplateIds.length) {
    throw new Error(desktopT("desktop.error.noLoadedTemplatesUseSource", { sourcePath: plan.oldSourcePath }));
  }
  if (!plan.templateIdMap.size) {
    throw new Error(desktopT("desktop.error.noCompatibleTemplatesForSource", { nextSourcePath: plan.nextSourcePath, oldSourcePath: plan.oldSourcePath }));
  }

  const graphRetargets = await Promise.all(solution.projects.flatMap((project) =>
    project.graphs.map(async (graphSummary) => {
      const graph = activeGraphPath === graphSummary.path
        ? activeGraph
        : await tauriBlueprintHost.readBlueprintFile(graphSummary.path);
      if (!isBlueprintGraph(graph)) {
        throw new Error(desktopT("desktop.error.selectedFileNotGraph", { graphPath: graphSummary.path }));
      }
      return {
        path: graphSummary.path,
        ...retargetTemplateSourceInGraph(graph, plan.templateIdMap)
      };
    })
  ));

  await writeChangedGraphsAndRefresh(solution, graphRetargets);

  return {
    oldSourcePath: plan.oldSourcePath,
    nextSourcePath: plan.nextSourcePath,
    mappedTemplateIds: plan.templateIdMap.size,
    unmatchedTemplateIds: plan.unmatchedTemplateIds.length,
    graphFilesChanged: graphRetargets.filter((entry) => entry.changedNodeIds.length).length,
    nodeTemplatesChanged: graphRetargets.reduce((count, entry) => count + entry.changedNodeIds.length, 0)
  };
}

async function writeChangedGraphsAndRefresh(
  solution: BlueprintSolutionSummary,
  graphChanges: Array<{ path: string; graph: BlueprintGraph; changedNodeIds: string[] }>
): Promise<void> {
  await Promise.all(graphChanges
    .filter((entry) => entry.changedNodeIds.length)
    .map((entry) => tauriBlueprintHost.writeBlueprintFile(entry.path, entry.graph)));

  const activeGraphChange = activeGraphPath
    ? graphChanges.find((entry) => entry.path === activeGraphPath && entry.changedNodeIds.length)
    : undefined;
  if (activeGraphChange) {
    publishGraph(activeGraphChange.graph);
  } else {
    void publishSolutionGraphIndex(solution);
  }
}

async function renameSolutionGraph(graphPath: string, nextName: string): Promise<string> {
  const solution = readStoredSolution();
  if (!solution) {
    throw new Error(desktopT("desktop.error.openSolutionBeforeRenameGraphs"));
  }
  const name = nextName.trim();
  if (!name) {
    throw new Error(desktopT("desktop.error.graphNameEmpty"));
  }
  const project = solution.projects.find((candidate) => candidate.graphs.some((graph) => graph.path === graphPath));
  const currentGraph = project?.graphs.find((graph) => graph.path === graphPath);
  if (!project || !currentGraph) {
    throw new Error(desktopT("desktop.error.graphNotInSolution", { graphPath }));
  }
  if (currentGraph.name === name) {
    return desktopT("desktop.result.graphAlreadyNamed", { name });
  }

  const renamed = await tauriBlueprintHost.renameGraph(project.path, graphPath, name);
  const nextSolution = await tauriBlueprintHost.readBlueprintSolution(solution.path);
  writeJsonStorage(desktopSolutionKey, nextSolution);
  updateSolutionFromEditor?.(nextSolution);
  await publishTemplatesForSolution(nextSolution);

  if (activeGraphPath === graphPath) {
    await loadGraphPath(renamed.path);
    updateSelectedGraphPathFromEditor?.(renamed.path);
  } else {
    publishSolutionOutline(nextSolution);
    publishTemplateRegistrySources(nextSolution);
    void publishSolutionGraphIndex(nextSolution);
  }

  return desktopT("desktop.result.renamedGraph", { oldName: currentGraph.name, nextName: renamed.name });
}

async function renameActiveGraphNodeId(oldNodeId: string, nextNodeId: string): Promise<{ message: string; nextNodeId?: string }> {
  if (!activeGraphPath) {
    throw new Error(desktopT("desktop.error.openFileBackedGraphBeforeRenameNode"));
  }
  const result = renameNodeIdInGraph(activeGraph, oldNodeId, nextNodeId);
  if (!result.ok) {
    throw new Error(result.issues.join("\n"));
  }
  if (!result.changed) {
    return { message: desktopT("desktop.result.nodeAlreadyNamed", { nodeId: result.nextNodeId }), nextNodeId: result.nextNodeId };
  }

  await tauriBlueprintHost.writeBlueprintFile(activeGraphPath, result.graph);
  publishGraph(result.graph);
  return { message: desktopT("desktop.result.renamedNode", { oldNodeId: result.oldNodeId, nextNodeId: result.nextNodeId }), nextNodeId: result.nextNodeId };
}

function blackboardRenameMessage(result: SolutionBlackboardRenameSummary): string {
  if (!result.projectVariablesChanged && !result.nodeBindingsChanged) {
    return desktopT("desktop.result.noBlackboardReferences", { key: result.oldKey });
  }
  return [
    desktopT("desktop.result.renamedBlackboard", { oldKey: result.oldKey, nextKey: result.nextKey }),
    desktopT("desktop.result.blackboardNodeBindings", { nodeBindings: result.nodeBindingsChanged, graphs: result.graphFilesChanged }),
    desktopT("desktop.result.blackboardProjectVariables", { projectVariables: result.projectVariablesChanged, projects: result.projectFilesChanged })
  ].join("; ");
}

function templateRetargetMessage(result: SolutionTemplateRetargetSummary): string {
  if (!result.nodeTemplatesChanged) {
    return desktopT("desktop.result.noTemplateNodes", { templateId: result.oldTemplateId });
  }
  return desktopT("desktop.result.retargetedTemplate", { oldTemplateId: result.oldTemplateId, nextTemplateId: result.nextTemplateId, nodes: result.nodeTemplatesChanged, graphs: result.graphFilesChanged });
}

function templateSourceRetargetMessage(result: SolutionTemplateSourceRetargetSummary): string {
  if (!result.nodeTemplatesChanged) {
    return desktopT("desktop.result.noSourceTemplateNodes", { sourcePath: result.oldSourcePath });
  }
  const skipped = result.unmatchedTemplateIds
    ? desktopT("desktop.result.sourceTemplateNoCompatibleTarget", { count: result.unmatchedTemplateIds })
    : "";
  return `${desktopT("desktop.result.retargetedSource", { oldSourcePath: result.oldSourcePath, nextSourcePath: result.nextSourcePath, nodes: result.nodeTemplatesChanged, graphs: result.graphFilesChanged, mappings: result.mappedTemplateIds })}${skipped}`;
}

async function extractCollapsedUnitToProjectFile(templateId: string, graphName: string): Promise<string> {
  const solution = readStoredSolution();
  if (!solution || !activeGraphPath) {
    throw new Error(desktopT("desktop.error.openFileBackedSolutionBeforeExtracting"));
  }
  const project = solution.projects.find((candidate) => candidate.graphs.some((graph) => graph.path === activeGraphPath));
  if (!project) {
    throw new Error(desktopT("desktop.error.activeGraphNotInSolution", { graphPath: activeGraphPath }));
  }
  const name = graphName.trim();
  if (!name) {
    throw new Error(desktopT("desktop.error.projectGraphNameEmpty"));
  }

  const created = await tauriBlueprintHost.createGraph(project.path, name);
  const relativeGraphPath = relativeProjectPath(project.path, created.path);
  const extracted = extractCollapsedUnitToProjectGraph(activeGraph, templateId, relativeGraphPath);
  if (!extracted.ok) {
    throw new Error(extracted.issues.join("\n"));
  }

  const projectFile = await tauriBlueprintHost.readBlueprintFile(project.path);
  if (!isBlueprintProject(projectFile)) {
    throw new Error(desktopT("desktop.error.selectedFileNotProject", { projectPath: project.path }));
  }
  const nextProject = withProjectGraphReference(projectFile, relativeGraphPath, extracted.projectGraph.kind === "macro" ? "macro" : "function");

  await tauriBlueprintHost.writeBlueprintFile(created.path, extracted.projectGraph);
  await tauriBlueprintHost.writeBlueprintFile(project.path, nextProject);
  await tauriBlueprintHost.writeBlueprintFile(activeGraphPath, extracted.graph);
  activeGraph = extracted.graph;

  const nextSolution = await tauriBlueprintHost.readBlueprintSolution(solution.path);
  writeJsonStorage(desktopSolutionKey, nextSolution);
  updateSolutionFromEditor?.(nextSolution);
  await publishTemplatesForSolution(nextSolution);
  publishGraph(extracted.graph);

  return desktopT("desktop.result.extractedCollapsedUnit", { name: extracted.projectGraph.name, path: relativeGraphPath });
}

function withProjectGraphReference(project: BlueprintProject, relativeGraphPath: string, kind: "function" | "macro"): BlueprintProject {
  const normalized = normalizeReference(relativeGraphPath);
  const graphRefs = (project.graphs ?? []).filter((entry) => normalizeReference(entry) !== normalized);
  const macroRefs = (project.macros ?? []).filter((entry) => normalizeReference(entry) !== normalized);
  return {
    ...project,
    graphs: kind === "macro" ? graphRefs : [...graphRefs, relativeGraphPath],
    macros: kind === "macro" ? [...macroRefs, relativeGraphPath] : macroRefs
  };
}

function relativeProjectPath(projectPath: string, childPath: string): string {
  const projectDirectory = parentDirectory(projectPath);
  const normalizedProjectDirectory = normalizeReference(projectDirectory);
  const normalizedChildPath = normalizeReference(childPath);
  return normalizedChildPath.startsWith(`${normalizedProjectDirectory}/`)
    ? normalizedChildPath.slice(normalizedProjectDirectory.length + 1)
    : normalizedChildPath;
}

function parentDirectory(filePath: string): string {
  const normalized = normalizeReference(filePath);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function normalizeReference(value: string): string {
  return value.replace(/\\/g, "/");
}

async function publishTemplatesForSolution(solution: BlueprintSolutionSummary | undefined): Promise<void> {
  const requestId = ++templateLoadRequestId;
  const projectTemplates = solution
    ? (await Promise.all(solution.projects.map((project) =>
        tauriBlueprintHost.loadProjectTemplates(project.path)
          .then((result) => result.templates)
          .catch((error: unknown) => {
            console.error(error);
            return [];
          })
      ))).flat()
    : [];
  if (requestId !== templateLoadRequestId) {
    return;
  }
  activeTemplates = mergeTemplatesById([...builtinTemplates, ...projectTemplates]);
  sendToEditor({ type: "loadTemplates", templates: activeTemplates });
  if (activeGraph) {
    sendToEditor({ type: "validationResult", issues: validateGraph(activeGraph, activeTemplates) });
  }
}

function templateRegistrySourcesFromSolution(solution: BlueprintSolutionSummary | undefined): TemplateRegistrySourceSummary[] {
  return (solution?.projects ?? []).map((project) => ({
    projectPath: project.path,
    projectName: project.name,
    templateSources: project.templateSources ?? [],
    templatePackages: project.templatePackages ?? [],
    builtinGroups: project.builtins?.groups ?? []
  }));
}

function solutionOutlineFromSolution(solution: BlueprintSolutionSummary | undefined): BlueprintSolutionOutline | undefined {
  return solution
    ? {
        path: solution.path,
        name: solution.name,
        activeGraphPath,
        projects: solution.projects.map((project) => ({
          path: project.path,
          name: project.name,
          graphs: project.graphs.map((graph) => ({
            path: graph.path,
            id: graph.id,
            name: graph.name,
            kind: graph.kind
          }))
        }))
      }
    : undefined;
}

function mergeTemplatesById(templates: typeof activeTemplates): typeof activeTemplates {
  return [...new Map(templates.map((template) => [template.id, template])).values()];
}

function defaultSolutionNameFromFolder(folderPath: string): string {
  const name = folderPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.trim();
  return name || desktopT("desktop.default.solutionName");
}

function promptValidProjectName(defaultName: string): string | undefined {
  let nextDefault = defaultName || desktopT("desktop.default.projectName");
  for (;;) {
    const projectName = window.prompt(desktopT("desktop.prompt.firstProjectName"), nextDefault)?.trim();
    if (!projectName) {
      return undefined;
    }
    const validationError = validateProjectName(projectName);
    if (!validationError) {
      return projectName;
    }
    window.alert(validationError);
    nextDefault = projectName;
  }
}

function validateProjectName(projectName: string): string | undefined {
  if (!projectName.trim()) {
    return desktopT("desktop.error.projectNameRequired");
  }
  if (projectName.length > 64) {
    return desktopT("desktop.error.projectNameTooLong");
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(projectName) || projectName.endsWith(".") || projectName.endsWith(" ")) {
    return desktopT("desktop.error.projectNameInvalidChars");
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(projectName)) {
    return desktopT("desktop.error.projectNameReserved");
  }
  return undefined;
}

function promptSolutionTemplate(): BlueprintSolutionTemplateId | undefined {
  const raw = window.prompt(desktopT("desktop.prompt.solutionTemplate"), "hello-world")?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (raw === "empty" || raw === "hello-world") {
    return raw;
  }
  window.alert(desktopT("desktop.error.solutionTemplateInvalid"));
  return promptSolutionTemplate();
}

function solutionFileName(solutionName: string): string {
  const stem = solutionName
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\.+$/g, "")
    .trim();
  return `${stem || "BlueprintSolution"}.bsln`;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <DesktopShell />
    </React.StrictMode>
  );
}

function DesktopShell(): JSX.Element {
  const [mode, setMode] = React.useState<"loading" | "hub" | "workspace">("loading");
  const [solution, setSolution] = React.useState<BlueprintSolutionSummary | undefined>();
  const [selectedGraphPath, setSelectedGraphPath] = React.useState<string | undefined>(activeGraphPath);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [launchFolder, setLaunchFolder] = React.useState<{ path: string; error?: string } | undefined>();
  const [recentSolutions, setRecentSolutions] = React.useState<BlueprintSolutionSummary[]>(() => readRecentSolutions());
  const [expandedProjectPaths, setExpandedProjectPaths] = React.useState<Set<string>>(new Set());
  const [leftDockOpen, setLeftDockOpen] = React.useState(true);
  const [leftDockTabs, setLeftDockTabs] = React.useState<DesktopDockTab[]>(defaultLeftDockTabs);
  const [leftDockTab, setLeftDockTab] = React.useState<DesktopDockTab>("tree");
  const [rightDockOpen, setRightDockOpen] = React.useState(false);
  const [rightDockTabs, setRightDockTabs] = React.useState<DesktopDockTab[]>(defaultRightDockTabs);
  const [rightDockTab, setRightDockTab] = React.useState<DesktopDockTab>("inspector");
  const [leftDockWidth, setLeftDockWidth] = React.useState(292);
  const [rightDockWidth, setRightDockWidth] = React.useState(300);
  const [dockResize, setDockResize] = React.useState<{ side: "left" | "right"; startX: number; startWidth: number } | undefined>();
  const [dockDropSide, setDockDropSide] = React.useState<DesktopDockSide | undefined>();
  const [desktopRunStatus, setDesktopRunStatus] = React.useState<DesktopRunStatus>({
    phase: "idle",
    message: desktopT("desktop.run.idle")
  });
  const [graphTabOrder, setGraphTabOrder] = React.useState<string[]>([]);

  React.useEffect(() => {
    updateSelectedGraphPathFromEditor = setSelectedGraphPath;
    updateSolutionFromEditor = setSolution;
    return () => {
      updateSelectedGraphPathFromEditor = undefined;
      updateSolutionFromEditor = undefined;
    };
  }, []);

  React.useEffect(() => {
    publishSolutionOutline(solution);
    publishTemplateRegistrySources(solution);
    void publishSolutionGraphIndex(solution);
    void publishTemplatesForSolution(solution);
  }, [solution]);

  React.useEffect(() => {
    setExpandedProjectPaths(new Set(solution?.projects.map((project) => project.path) ?? []));
  }, [solution]);

  React.useEffect(() => {
    const graphPaths = solution?.projects.flatMap((project) => project.graphs.map((graph) => graph.path)) ?? [];
    setGraphTabOrder((current) => [
      ...current.filter((path) => graphPaths.includes(path)),
      ...graphPaths.filter((path) => !current.includes(path))
    ]);
  }, [solution]);

  React.useEffect(() => {
    if (!leftDockTabs.includes(leftDockTab)) {
      const nextTab = leftDockTabs[0];
      if (nextTab) {
        setLeftDockTab(nextTab);
      } else {
        setLeftDockOpen(false);
      }
    }
  }, [leftDockTab, leftDockTabs]);

  React.useEffect(() => {
    if (!rightDockTabs.includes(rightDockTab)) {
      const nextTab = rightDockTabs[0];
      if (nextTab) {
        setRightDockTab(nextTab);
      } else {
        setRightDockOpen(false);
      }
    }
  }, [rightDockTab, rightDockTabs]);

  React.useEffect(() => {
    if (!hasTauriWindowRuntime()) {
      return;
    }
    const appWindow = getCurrentWindow();
    void (async () => {
      if (mode === "workspace") {
        await appWindow.setMinSize(new LogicalSize(960, 640));
        await appWindow.setFullscreen(false);
        await appWindow.setSize(workspaceWindowSize);
        await appWindow.maximize();
        return;
      }
      await appWindow.setFullscreen(false);
      await appWindow.unmaximize();
      await appWindow.setMinSize(hubWindowMinSize);
      await appWindow.setSize(hubWindowSize);
      await appWindow.center();
    })().catch((error) => console.error(error));
  }, [mode]);

  const openSolutionSummary = React.useCallback(async (nextSolution: BlueprintSolutionSummary): Promise<void> => {
    setSolution(nextSolution);
    writeJsonStorage(desktopSolutionKey, nextSolution);
    setRecentSolutions(rememberRecentSolution(nextSolution));
    const firstGraph = nextSolution.projects.flatMap((project) => project.graphs)[0];
    if (firstGraph) {
      await loadGraphPath(firstGraph.path);
      setSelectedGraphPath(firstGraph.path);
    } else {
      setSelectedGraphPath(undefined);
    }
    setLaunchFolder(undefined);
    setMode("workspace");
  }, []);

  const loadSolution = React.useCallback(async (path: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await openSolutionSummary(await tauriBlueprintHost.readBlueprintSolution(path));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setBusy(false);
    }
  }, [openSolutionSummary]);

  const applyLaunchContext = React.useCallback(async (context: BlueprintLaunchContext): Promise<void> => {
    if (context.kind === "solution") {
      await openSolutionSummary(context.solution);
      return;
    }
    if (context.kind === "folder") {
      setLaunchFolder({ path: context.folderPath, error: context.error });
      setMode("hub");
      return;
    }
    setLaunchFolder(undefined);
    setMode("hub");
  }, [openSolutionSummary]);

  React.useEffect(() => {
    let cancelled = false;
    void tauriBlueprintHost.getLaunchContext()
      .then(async (context) => {
        if (!cancelled) {
          await applyLaunchContext(context);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSolution(readStoredSolution());
          setMode("workspace");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyLaunchContext]);

  const chooseSolution = React.useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: desktopT("desktop.fileFilter.solution"), extensions: ["bsln"] }]
      });
      if (typeof selected === "string") {
        await loadSolution(selected);
      }
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusy(false);
    }
  }, [loadSolution]);

  const createSolution = React.useCallback(async (preferredTemplateId?: BlueprintSolutionTemplateId) => {
    setBusy(true);
    setError(undefined);
    try {
      const selectedFolder = await open({
        directory: true,
        multiple: false,
        title: desktopT("desktop.selectEmptySolutionFolder")
      });
      if (typeof selectedFolder !== "string") {
        return;
      }
      const solutionName = defaultSolutionNameFromFolder(selectedFolder);
      const projectName = promptValidProjectName(solutionName);
      if (!projectName) {
        return;
      }
      const templateId = preferredTemplateId ?? promptSolutionTemplate();
      if (!templateId) {
        return;
      }
      const solutionPath = `${selectedFolder.replace(/[\\/]$/, "")}/${solutionFileName(solutionName)}`;
      await openSolutionSummary(await tauriBlueprintHost.createSolution(solutionPath, solutionName, projectName, templateId));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
    }
  }, [openSolutionSummary]);

  const openGraph = React.useCallback(async (graph: BlueprintGraphSummary) => {
    setBusy(true);
    setError(undefined);
    try {
      await loadGraphPath(graph.path);
      setSelectedGraphPath(graph.path);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusy(false);
    }
  }, []);

  const createProject = React.useCallback(async () => {
    if (!solution) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const projectName = window.prompt(desktopT("desktop.prompt.projectName"), desktopT("desktop.default.projectName"))?.trim();
      if (!projectName) {
        return;
      }
      const nextSolution = await tauriBlueprintHost.createProject(solution.path, projectName);
      setSolution(nextSolution);
      writeJsonStorage(desktopSolutionKey, nextSolution);
      const createdProject = nextSolution.projects[nextSolution.projects.length - 1];
      const firstGraph = createdProject?.graphs[0];
      if (firstGraph) {
        await loadGraphPath(firstGraph.path);
        setSelectedGraphPath(firstGraph.path);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
    }
  }, [solution]);

  const createGraph = React.useCallback(
    async (projectPath: string) => {
      if (!solution) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const graphName = window.prompt(desktopT("desktop.prompt.graphName"), desktopT("desktop.default.graphName"))?.trim();
        if (!graphName) {
          return;
        }
        const graph = await tauriBlueprintHost.createGraph(projectPath, graphName);
        const nextSolution = await tauriBlueprintHost.readBlueprintSolution(solution.path);
        setSolution(nextSolution);
        writeJsonStorage(desktopSolutionKey, nextSolution);
        await loadGraphPath(graph.path);
        setSelectedGraphPath(graph.path);
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : String(createError));
      } finally {
        setBusy(false);
      }
    },
    [solution]
  );

  const compileActiveGraph = React.useCallback(async () => {
    setDesktopRunStatus({ phase: "compiling", message: desktopT("desktop.run.compiling") });
    const result = await tauriBlueprintHost.compileGraph(activeGraph, activeGraphPath).catch((error: unknown) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      issues: undefined,
      outputFiles: undefined
    }));
    if (result.issues) {
      sendToEditor({ type: "validationResult", issues: result.issues });
    }
    setDesktopRunStatus({
      phase: result.ok ? "ok" : "error",
      message: result.message,
      stdout: result.outputFiles?.join("\n")
    });
  }, []);

  const runActiveGraph = React.useCallback(async () => {
    setDesktopRunStatus({ phase: "running", message: desktopT("desktop.run.running") });
    const result = await tauriBlueprintHost.runGraph(activeGraph, activeGraphPath, { runId: `desktop-run-${Date.now().toString(36)}` }).catch((error: unknown) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      stdout: "",
      stderr: "",
      durationMs: 0,
      traces: [],
      issues: undefined
    }));
    if (result.issues) {
      sendToEditor({ type: "validationResult", issues: result.issues });
    }
    sendToEditor({ type: "runtimeResult", ...result });
    setDesktopRunStatus({
      phase: result.ok ? "ok" : "error",
      message: result.message,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    });
  }, []);

  const toggleProjectExpanded = React.useCallback((projectPath: string) => {
    setExpandedProjectPaths((current) => {
      const next = new Set(current);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  }, []);
  const moveDockTabToSide = React.useCallback((tab: DesktopDockTab, side: DesktopDockSide) => {
    setLeftDockTabs((current) => side === "left"
      ? [...current.filter((candidate) => candidate !== tab), tab]
      : current.filter((candidate) => candidate !== tab));
    setRightDockTabs((current) => side === "right"
      ? [...current.filter((candidate) => candidate !== tab), tab]
      : current.filter((candidate) => candidate !== tab));
    if (side === "left") {
      setLeftDockTab(tab);
      setLeftDockOpen(true);
      return;
    }
    setRightDockTab(tab);
    setRightDockOpen(true);
  }, []);

  const activateLeftDock = React.useCallback((tab: DesktopDockTab) => {
    if (!leftDockTabs.includes(tab)) {
      moveDockTabToSide(tab, "left");
    }
    setLeftDockTab(tab);
    setLeftDockOpen((current) => leftDockTab === tab ? !current : true);
  }, [leftDockTab, leftDockTabs, moveDockTabToSide]);
  const activateRightDock = React.useCallback((tab: DesktopDockTab) => {
    if (!rightDockTabs.includes(tab)) {
      moveDockTabToSide(tab, "right");
    }
    setRightDockTab(tab);
    setRightDockOpen((current) => rightDockTab === tab ? !current : true);
  }, [rightDockTab, rightDockTabs, moveDockTabToSide]);
  const moveGraphTab = React.useCallback((fromPath: string, toPath: string) => {
    if (fromPath === toPath) {
      return;
    }
    setGraphTabOrder((current) => {
      const next = current.filter((path) => path !== fromPath);
      const targetIndex = Math.max(0, next.indexOf(toPath));
      next.splice(targetIndex, 0, fromPath);
      return next;
    });
  }, []);
  const startDockResize = React.useCallback((side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDockResize({ side, startX: event.clientX, startWidth: side === "left" ? leftDockWidth : rightDockWidth });
  }, [leftDockWidth, rightDockWidth]);
  const resizeDock = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dockResize) {
      return;
    }
    const delta = event.clientX - dockResize.startX;
    if (dockResize.side === "left") {
      setLeftDockWidth(Math.round(Math.min(460, Math.max(220, dockResize.startWidth + delta))));
    } else {
      setRightDockWidth(Math.round(Math.min(480, Math.max(240, dockResize.startWidth - delta))));
    }
  }, [dockResize]);
  const stopDockResize = React.useCallback(() => {
    if (dockResize?.side === "left" && leftDockWidth <= 232) {
      setLeftDockOpen(false);
      setLeftDockWidth(292);
    }
    if (dockResize?.side === "right" && rightDockWidth <= 252) {
      setRightDockOpen(false);
      setRightDockWidth(300);
    }
    setDockResize(undefined);
  }, [dockResize, leftDockWidth, rightDockWidth]);

  const startDockTabDrag = React.useCallback((side: DesktopDockSide, tab: DesktopDockTab, event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(desktopDockTabMime, JSON.stringify({ side, tab }));
  }, []);

  const handleDockDragOver = React.useCallback((side: DesktopDockSide, event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes(desktopDockTabMime)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDockDropSide(side);
  }, []);

  const clearDockDropSide = React.useCallback((event?: React.DragEvent) => {
    if (event?.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setDockDropSide(undefined);
  }, []);

  const handleDockDrop = React.useCallback((side: DesktopDockSide, event: React.DragEvent) => {
    const rawPayload = event.dataTransfer.getData(desktopDockTabMime);
    if (!rawPayload) {
      return;
    }
    event.preventDefault();
    setDockDropSide(undefined);
    try {
      const payload = JSON.parse(rawPayload) as { tab?: DesktopDockTab };
      if (payload.tab && isDesktopDockTab(payload.tab)) {
        moveDockTabToSide(payload.tab, side);
      }
    } catch (error) {
      console.error(error);
    }
  }, [moveDockTabToSide]);

  const unorderedGraphTabs = solution?.projects.flatMap((project) =>
    project.graphs.map((graph) => ({
      projectName: project.name,
      projectPath: project.path,
      graph
    }))
  ) ?? [];
  const graphTabIndex = new Map(graphTabOrder.map((path, index) => [path, index]));
  const graphTabs = [...unorderedGraphTabs].sort((a, b) => (graphTabIndex.get(a.graph.path) ?? Number.MAX_SAFE_INTEGER) - (graphTabIndex.get(b.graph.path) ?? Number.MAX_SAFE_INTEGER));
  const shellClassName = [
    "desktop-shell",
    leftDockOpen ? "" : "left-dock-collapsed",
    rightDockOpen ? "" : "right-dock-collapsed"
  ].filter(Boolean).join(" ");
  const desktopShellStyle = {
    "--desktop-left-dock-width": `${leftDockWidth}px`,
    "--desktop-right-dock-width": `${rightDockWidth}px`
  } as React.CSSProperties;
  const selectedGraphSummary = graphTabs.find((entry) => entry.graph.path === selectedGraphPath)?.graph;

  const titleBar = (
    <DesktopTitleBar
      busy={busy}
      mode={mode === "workspace" ? "workspace" : "hub"}
      solution={solution}
      selectedGraphPath={selectedGraphPath}
      onCreateSolution={createSolution}
      onOpenSolution={chooseSolution}
      onCreateProject={solution ? createProject : undefined}
      onRefreshSolution={solution ? () => void loadSolution(solution.path) : undefined}
      leftDockOpen={leftDockOpen}
      rightDockOpen={rightDockOpen}
      onActivateLeftDock={activateLeftDock}
      onActivateRightDock={activateRightDock}
      onToggleLeftDock={() => setLeftDockOpen((current) => !current)}
      onToggleRightDock={() => setRightDockOpen((current) => !current)}
      onCompileGraph={compileActiveGraph}
      onRunGraph={runActiveGraph}
    />
  );

  if (mode === "loading") {
    return (
      <div className="desktop-frame">
        {titleBar}
        <ProjectHub
          busy
          loading
          error={error}
          launchFolder={launchFolder}
          recentSolutions={recentSolutions}
          onCreateSolution={createSolution}
          onCreateSolutionTemplate={(templateId) => createSolution(templateId)}
          onOpenSolution={chooseSolution}
          onOpenRecentSolution={(path) => void loadSolution(path)}
        />
      </div>
    );
  }
  if (mode === "hub") {
    return (
      <div className="desktop-frame">
        {titleBar}
        <ProjectHub
          busy={busy}
          error={error}
          launchFolder={launchFolder}
          recentSolutions={recentSolutions}
          onCreateSolution={createSolution}
          onCreateSolutionTemplate={(templateId) => createSolution(templateId)}
          onOpenSolution={chooseSolution}
          onOpenRecentSolution={(path) => void loadSolution(path)}
        />
      </div>
    );
  }

  return (
    <div className="desktop-frame">
      {titleBar}
      <div className={shellClassName} style={desktopShellStyle}>
      <aside className="desktop-activity-bar left" aria-label={desktopT("desktop.activity.left")}>
        <button type="button" className={leftDockOpen && leftDockTab === "tree" ? "active" : undefined} onClick={() => activateLeftDock("tree")} title={desktopT("desktop.activity.project")} aria-label={desktopT("desktop.activity.project")}>
          <PanelLeft size={17} />
        </button>
        <button type="button" className={leftDockOpen && leftDockTab === "run" ? "active" : undefined} onClick={() => activateLeftDock("run")} title={desktopT("desktop.activity.run")} aria-label={desktopT("desktop.activity.run")}>
          <Play size={17} />
        </button>
        <button type="button" className={leftDockOpen && leftDockTab === "source" ? "active" : undefined} onClick={() => activateLeftDock("source")} title={desktopT("desktop.activity.source")} aria-label={desktopT("desktop.activity.source")}>
          <GitBranch size={17} />
        </button>
      </aside>
      <aside
        className={dockDropSide === "left" ? "desktop-nav desktop-dock-panel dock-drop-target" : "desktop-nav desktop-dock-panel"}
        aria-label={desktopT("desktop.navigation")}
        onDragOver={(event) => handleDockDragOver("left", event)}
        onDragLeave={clearDockDropSide}
        onDrop={(event) => handleDockDrop("left", event)}
      >
        <DesktopDockTabStrip
          side="left"
          tabs={leftDockTabs}
          activeTab={leftDockTab}
          onActivate={activateLeftDock}
          onDragStart={startDockTabDrag}
        />
        <DesktopDockPanelContent
          tab={leftDockTab}
          busy={busy}
          error={error}
          solution={solution}
          selectedGraphPath={selectedGraphPath}
          activeGraph={activeGraph}
          templates={activeTemplates}
          runStatus={desktopRunStatus}
          expandedProjectPaths={expandedProjectPaths}
          onToggleProject={toggleProjectExpanded}
          onOpenGraph={openGraph}
          onCreateGraph={createGraph}
          onCompileGraph={compileActiveGraph}
          onRunGraph={runActiveGraph}
        />
      </aside>
      <div
        className="desktop-dock-splitter left"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={(event) => startDockResize("left", event)}
        onPointerMove={resizeDock}
        onPointerUp={stopDockResize}
        onPointerCancel={stopDockResize}
        onDoubleClick={() => setLeftDockOpen(false)}
      />
      <main className="desktop-editor">
        <div className="desktop-graph-tabs" role="tablist" aria-label={desktopT("desktop.graphTabs")}>
          {graphTabs.map(({ projectName, graph }) => (
            <button
              key={graph.path}
              type="button"
              role="tab"
              aria-selected={graph.path === selectedGraphPath}
              className={graph.path === selectedGraphPath ? "active" : undefined}
              title={graph.path}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-blueprint-graph-tab", graph.path);
              }}
              onDragOver={(event) => {
                if (Array.from(event.dataTransfer.types).includes("application/x-blueprint-graph-tab")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                const fromPath = event.dataTransfer.getData("application/x-blueprint-graph-tab");
                if (fromPath) {
                  event.preventDefault();
                  moveGraphTab(fromPath, graph.path);
                }
              }}
              onClick={() => void openGraph(graph)}
            >
              <FileJson size={14} />
              <span>{graph.name}</span>
              <small>{projectName}</small>
            </button>
          ))}
          {solution ? (
            <button type="button" className="desktop-graph-tab-add" onClick={() => {
              const projectPath = graphTabs.find((entry) => entry.graph.path === selectedGraphPath)?.projectPath ?? solution.projects[0]?.path;
              if (projectPath) {
                void createGraph(projectPath);
              }
            }} disabled={busy} title={desktopT("desktop.newGraphTitle")}>
              <Plus size={14} />
            </button>
          ) : null}
        </div>
        <div className="desktop-editor-content">
          <App externalDockPanels />
        </div>
      </main>
      <div
        className="desktop-dock-splitter right"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={(event) => startDockResize("right", event)}
        onPointerMove={resizeDock}
        onPointerUp={stopDockResize}
        onPointerCancel={stopDockResize}
        onDoubleClick={() => setRightDockOpen(false)}
      />
      <aside
        className={dockDropSide === "right" ? "desktop-right-dock desktop-dock-panel dock-drop-target" : "desktop-right-dock desktop-dock-panel"}
        aria-label={desktopT("desktop.activity.right")}
        onDragOver={(event) => handleDockDragOver("right", event)}
        onDragLeave={clearDockDropSide}
        onDrop={(event) => handleDockDrop("right", event)}
      >
        <DesktopDockTabStrip
          side="right"
          tabs={rightDockTabs}
          activeTab={rightDockTab}
          onActivate={activateRightDock}
          onDragStart={startDockTabDrag}
        />
        <DesktopDockPanelContent
          tab={rightDockTab}
          busy={busy}
          error={error}
          solution={solution}
          selectedGraphPath={selectedGraphPath}
          selectedGraph={selectedGraphSummary}
          activeGraph={activeGraph}
          templates={activeTemplates}
          runStatus={desktopRunStatus}
          expandedProjectPaths={expandedProjectPaths}
          onToggleProject={toggleProjectExpanded}
          onOpenGraph={(graph) => void openGraph(graph)}
          onCreateGraph={createGraph}
          onCompileGraph={compileActiveGraph}
          onRunGraph={runActiveGraph}
          onRefreshSolution={solution ? () => void loadSolution(solution.path) : undefined}
        />
      </aside>
      <aside className="desktop-activity-bar right" aria-label={desktopT("desktop.activity.right")}>
        <button type="button" className={rightDockOpen && rightDockTab === "commands" ? "active" : undefined} onClick={() => activateRightDock("commands")} title={desktopT("desktop.activity.commands")} aria-label={desktopT("desktop.activity.commands")}>
          <Command size={17} />
        </button>
        <button type="button" className={rightDockOpen && rightDockTab === "debug" ? "active" : undefined} onClick={() => activateRightDock("debug")} title={desktopT("desktop.activity.debug")} aria-label={desktopT("desktop.activity.debug")}>
          <Bug size={17} />
        </button>
        <button type="button" className={rightDockOpen && rightDockTab === "settings" ? "active" : undefined} onClick={() => activateRightDock("settings")} title={desktopT("desktop.activity.settings")} aria-label={desktopT("desktop.activity.settings")}>
          <Settings size={17} />
        </button>
        <button type="button" className={rightDockOpen && rightDockTab === "inspector" ? "active" : undefined} onClick={() => activateRightDock("inspector")} title={desktopT("desktop.activity.inspector")} aria-label={desktopT("desktop.activity.inspector")}>
          <PanelRight size={17} />
        </button>
      </aside>
      </div>
    </div>
  );
}

function isDesktopDockTab(tab: string): tab is DesktopDockTab {
  return [...defaultLeftDockTabs, ...defaultRightDockTabs].includes(tab as DesktopDockTab);
}

function isLeftDockTab(tab: DesktopDockTab): tab is DesktopLeftDockTab {
  return defaultLeftDockTabs.includes(tab);
}

function isRightDockTab(tab: DesktopDockTab): tab is DesktopRightDockTab {
  return defaultRightDockTabs.includes(tab);
}

function desktopDockTabTitle(tab: DesktopDockTab): string {
  const titleKey = tab === "tree"
    ? "desktop.dock.tree"
    : tab === "run"
      ? "desktop.dock.run"
      : tab === "source"
        ? "desktop.dock.source"
        : tab === "commands"
          ? "desktop.dock.commands"
          : tab === "debug"
            ? "desktop.dock.debug"
            : tab === "settings"
              ? "desktop.dock.settings"
              : "desktop.dock.inspector";
  return desktopT(titleKey);
}

function DesktopDockTabStrip(props: {
  side: DesktopDockSide;
  tabs: DesktopDockTab[];
  activeTab: DesktopDockTab;
  onActivate(tab: DesktopDockTab): void;
  onDragStart(side: DesktopDockSide, tab: DesktopDockTab, event: React.DragEvent): void;
}): JSX.Element {
  return (
    <div className="desktop-dock-tab-strip" role="tablist" aria-label={props.side === "left" ? desktopT("desktop.activity.left") : desktopT("desktop.activity.right")}>
      {props.tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={props.activeTab === tab}
          className={props.activeTab === tab ? "active" : undefined}
          draggable
          onDragStart={(event) => props.onDragStart(props.side, tab, event)}
          onClick={() => props.onActivate(tab)}
          title={desktopDockTabTitle(tab)}
        >
          {desktopDockTabTitle(tab)}
        </button>
      ))}
      {props.tabs.length ? null : <span>{desktopT("desktop.dock.empty")}</span>}
    </div>
  );
}

type DesktopDockPanelContentProps = {
  tab: DesktopDockTab;
  busy: boolean;
  error?: string;
  solution?: BlueprintSolutionSummary;
  selectedGraphPath?: string;
  selectedGraph?: BlueprintGraphSummary;
  activeGraph: BlueprintGraph;
  templates: BlueprintNodeTemplate[];
  runStatus: DesktopRunStatus;
  expandedProjectPaths: Set<string>;
  onToggleProject(projectPath: string): void;
  onOpenGraph(graph: BlueprintGraphSummary): void | Promise<void>;
  onCreateGraph(projectPath: string): Promise<void>;
  onCompileGraph(): Promise<void>;
  onRunGraph(): Promise<void>;
  onRefreshSolution?: () => void;
};

function DesktopDockPanelContent(props: DesktopDockPanelContentProps): JSX.Element {
  if (isLeftDockTab(props.tab)) {
    return (
      <DesktopLeftDockPanel
        tab={props.tab}
        busy={props.busy}
        error={props.error}
        solution={props.solution}
        selectedGraphPath={props.selectedGraphPath}
        activeGraph={props.activeGraph}
        templates={props.templates}
        runStatus={props.runStatus}
        expandedProjectPaths={props.expandedProjectPaths}
        onToggleProject={props.onToggleProject}
        onOpenGraph={props.onOpenGraph}
        onCreateGraph={props.onCreateGraph}
        onCompileGraph={props.onCompileGraph}
        onRunGraph={props.onRunGraph}
      />
    );
  }
  if (isRightDockTab(props.tab)) {
    return (
      <DesktopRightDockPanel
        tab={props.tab}
        solution={props.solution}
        selectedGraph={props.selectedGraph}
        activeGraph={props.activeGraph}
        templates={props.templates}
        runStatus={props.runStatus}
        onCompileGraph={props.onCompileGraph}
        onRunGraph={props.onRunGraph}
        onRefreshSolution={props.onRefreshSolution}
      />
    );
  }
  throw new Error(`Unsupported dock tab: ${props.tab}`);
}

function DesktopLeftDockPanel(props: {
  tab: DesktopLeftDockTab;
  busy: boolean;
  error?: string;
  solution?: BlueprintSolutionSummary;
  selectedGraphPath?: string;
  activeGraph: BlueprintGraph;
  templates: BlueprintNodeTemplate[];
  runStatus: DesktopRunStatus;
  expandedProjectPaths: Set<string>;
  onToggleProject(projectPath: string): void;
  onOpenGraph(graph: BlueprintGraphSummary): void;
  onCreateGraph(projectPath: string): Promise<void>;
  onCompileGraph(): Promise<void>;
  onRunGraph(): Promise<void>;
}): JSX.Element {
  if (props.tab === "tree") {
    return (
      <DesktopBlueprintTreePanel
        solution={props.solution}
        selectedGraphPath={props.selectedGraphPath}
        activeGraph={props.activeGraph}
        templates={props.templates}
        expandedProjectPaths={props.expandedProjectPaths}
        onToggleProject={props.onToggleProject}
        onOpenGraph={props.onOpenGraph}
      />
    );
  }
  if (props.tab === "run") {
    return (
      <DesktopRunDockPanel
        activeGraph={props.activeGraph}
        selectedGraphPath={props.selectedGraphPath}
        runStatus={props.runStatus}
        onCompileGraph={props.onCompileGraph}
        onRunGraph={props.onRunGraph}
      />
    );
  }
  return <DesktopSourceDockPanel solution={props.solution} />;
}

function DesktopBlueprintTreePanel(props: {
  solution?: BlueprintSolutionSummary;
  selectedGraphPath?: string;
  activeGraph: BlueprintGraph;
  templates: BlueprintNodeTemplate[];
  expandedProjectPaths: Set<string>;
  onToggleProject(projectPath: string): void;
  onOpenGraph(graph: BlueprintGraphSummary): void;
}): JSX.Element {
  const [outlineFilter, setOutlineFilter] = React.useState("");
  const [collapsedGraphPaths, setCollapsedGraphPaths] = React.useState<Set<string>>(() => new Set());
  const normalizedOutlineFilter = outlineFilter.trim().toLowerCase();
  const templateById = new Map(props.templates.map((template) => [template.id, template]));
  const toggleGraphCollapsed = React.useCallback((graphPath: string) => {
    setCollapsedGraphPaths((current) => {
      const next = new Set(current);
      if (next.has(graphPath)) {
        next.delete(graphPath);
      } else {
        next.add(graphPath);
      }
      return next;
    });
  }, []);
  const filteredTreeNodes = props.activeGraph.nodes.filter((node) => {
    if (!normalizedOutlineFilter) {
      return true;
    }
    const template = templateById.get(node.templateId);
    return `${node.id} ${node.templateId} ${template?.name ?? ""}`.toLowerCase().includes(normalizedOutlineFilter);
  });
  const visibleTreeNodes = filteredTreeNodes.slice(0, 160);
  const hiddenTreeNodeCount = Math.max(0, filteredTreeNodes.length - visibleTreeNodes.length);
  const renderActiveGraphNodes = () => (
    <div className="desktop-tree-nodes">
      {hiddenTreeNodeCount ? (
        <span className="desktop-tree-empty">{desktopT("sidebar.showingNodesLimit", { visible: visibleTreeNodes.length, total: filteredTreeNodes.length })}</span>
      ) : null}
      {visibleTreeNodes.length ? visibleTreeNodes.map((node) => {
        const template = templateById.get(node.templateId);
        return (
          <button key={node.id} type="button" className="desktop-tree-node" title={desktopT("sidebar.focusOutlineNode", { nodeId: node.id })} onClick={() => sendToEditor({ type: "focusNode", nodeId: node.id })}>
            <CircleDot size={10} />
            <span>{template?.name ?? node.templateId}</span>
            <small>{node.id}</small>
          </button>
        );
      }) : <span className="desktop-tree-empty">{desktopT("desktop.dock.noActiveGraph")}</span>}
    </div>
  );
  return (
    <>
      <div className="desktop-blueprint-tree">
        <input
          type="search"
          className="desktop-tree-filter"
          value={outlineFilter}
          onChange={(event) => setOutlineFilter(event.currentTarget.value)}
          placeholder={desktopT("sidebar.filterOutline")}
        />
        {props.solution ? props.solution.projects.map((project) => (
          <section key={project.path} className="desktop-tree-project">
            <button type="button" className="desktop-tree-project-row" onClick={() => props.onToggleProject(project.path)}>
              {props.expandedProjectPaths.has(project.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>{project.name}</span>
            </button>
            {props.expandedProjectPaths.has(project.path) ? (
              <div className="desktop-tree-children">
                {project.graphs.map((graph) => {
                  const activeGraph = isActiveTreeGraph(graph, props);
                  const collapsed = collapsedGraphPaths.has(graph.path);
                  return (
                  <section key={graph.path} className={activeGraph ? "desktop-tree-graph active" : "desktop-tree-graph"}>
                    <button type="button" className="desktop-tree-graph-toggle" onClick={() => toggleGraphCollapsed(graph.path)} title={collapsed ? desktopT("desktop.expandProject", { project: graph.name }) : desktopT("desktop.collapseProject", { project: graph.name })}>
                      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                    <button type="button" onClick={() => props.onOpenGraph(graph)} title={graph.path}>
                      <FileJson size={14} />
                      <span>{graph.name}</span>
                      <small>{graph.kind}</small>
                    </button>
                    {activeGraph && !collapsed ? renderActiveGraphNodes() : null}
                  </section>
                  );
                })}
              </div>
            ) : null}
          </section>
        )) : (
          <section className="desktop-tree-project">
            <div className="desktop-tree-graph active">
              <button type="button" className="desktop-tree-graph-toggle" disabled>
                <ChevronDown size={12} />
              </button>
              <button type="button" disabled>
                <FileJson size={14} />
                <span>{props.activeGraph.name}</span>
                <small>{props.activeGraph.id}</small>
              </button>
              {renderActiveGraphNodes()}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function isActiveTreeGraph(graph: BlueprintGraphSummary, props: {
  solution?: BlueprintSolutionSummary;
  selectedGraphPath?: string;
  activeGraph: BlueprintGraph;
}): boolean {
  if (graph.path === props.selectedGraphPath) {
    return true;
  }
  const graphCount = props.solution?.projects.reduce((count, project) => count + project.graphs.length, 0) ?? 0;
  return !props.selectedGraphPath && graphCount === 1;
}

function DesktopRunDockPanel(props: {
  activeGraph: BlueprintGraph;
  selectedGraphPath?: string;
  runStatus: DesktopRunStatus;
  onCompileGraph(): Promise<void>;
  onRunGraph(): Promise<void>;
}): JSX.Element {
  const busy = props.runStatus.phase === "compiling" || props.runStatus.phase === "running";
  return (
    <div className="desktop-run-panel">
      <div className="desktop-compact-dock-title">
        <strong>{desktopT("desktop.dock.run")}</strong>
      </div>
      <div className="desktop-run-actions">
        <button type="button" onClick={() => void props.onCompileGraph()} disabled={busy}>
          <Command size={14} />
          <span>{desktopT("desktop.run.compile")}</span>
        </button>
        <button type="button" onClick={() => void props.onRunGraph()} disabled={busy}>
          <Play size={14} />
          <span>{desktopT("desktop.run.run")}</span>
        </button>
      </div>
      <div className={`desktop-run-status ${props.runStatus.phase}`}>
        <strong>{desktopT(`desktop.run.phase.${props.runStatus.phase}`)}</strong>
        <span>{props.runStatus.message}</span>
        {typeof props.runStatus.durationMs === "number" ? <small>{props.runStatus.durationMs} ms</small> : null}
      </div>
      {props.runStatus.stdout ? <pre>{props.runStatus.stdout}</pre> : null}
      {props.runStatus.stderr ? <pre className="error">{props.runStatus.stderr}</pre> : null}
    </div>
  );
}

function DesktopSourceDockPanel(props: {
  solution?: BlueprintSolutionSummary;
}): JSX.Element {
  return (
    <div className="desktop-source-panel">
      {props.solution ? props.solution.projects.map((project) => (
        <section key={project.path}>
          <div className="desktop-compact-dock-title">
            <strong>{project.name}</strong>
          </div>
            {project.templateSources.length ? project.templateSources.map((source) => (
              <small key={source}>{source}</small>
            )) : <small>{desktopT("desktop.source.noSources")}</small>}
            {project.templatePackages?.length ? project.templatePackages.map((pack) => (
              <small key={pack.id}>{pack.name} {pack.version}</small>
            )) : null}
        </section>
      )) : <span>{desktopT("desktop.dock.noSolution")}</span>}
    </div>
  );
}

function DesktopRightDockPanel(props: {
  tab: DesktopRightDockTab;
  solution?: BlueprintSolutionSummary;
  selectedGraph?: BlueprintGraphSummary;
  activeGraph: BlueprintGraph;
  templates: BlueprintNodeTemplate[];
  runStatus: DesktopRunStatus;
  onCompileGraph(): Promise<void>;
  onRunGraph(): Promise<void>;
  onRefreshSolution?: () => void;
}): JSX.Element {
  const titleKey = props.tab === "commands" ? "desktop.dock.commands" : props.tab === "debug" ? "desktop.dock.debug" : props.tab === "settings" ? "desktop.dock.settings" : "desktop.dock.inspector";
  return (
    <div className="desktop-right-dock-body">
      <div className="desktop-compact-dock-title">
        <strong>{desktopT(titleKey)}</strong>
      </div>
        {props.tab === "commands" ? (
          <>
            {props.onRefreshSolution ? <button type="button" onClick={props.onRefreshSolution}><RefreshCw size={14} />{desktopT("desktop.refreshSolution")}</button> : null}
            <button type="button" onClick={() => void props.onCompileGraph()}><Command size={14} />{desktopT("desktop.run.compile")}</button>
            <button type="button" onClick={() => void props.onRunGraph()}><Play size={14} />{desktopT("desktop.run.run")}</button>
            <span>{props.runStatus.message}</span>
          </>
        ) : null}
        {props.tab === "debug" ? (
          <>
            <span>{desktopT("desktop.dock.nodes")}: {props.activeGraph.nodes.length}</span>
            <span>{desktopT("desktop.dock.links")}: {props.activeGraph.links.length}</span>
          </>
        ) : null}
        {props.tab === "settings" ? (
          <>
            <span>{desktopT("desktop.dock.currentGraph")}: {props.activeGraph.name}</span>
            <span>{desktopT("desktop.dock.solution")}: {props.solution ? props.solution.name : desktopT("desktop.dock.noSolution")}</span>
            <span>{desktopT("desktop.dock.templates")}: {props.templates.length}</span>
          </>
        ) : null}
        {props.tab === "inspector" ? (
          <>
            <span>{desktopT("desktop.dock.currentGraph")}: {props.activeGraph.name}</span>
            <span>{desktopT("desktop.dock.nodes")}: {props.activeGraph.nodes.length}</span>
            <span>{desktopT("desktop.dock.ports")}: {props.activeGraph.nodes.reduce((count, node) => {
              const template = props.templates.find((candidate) => candidate.id === node.templateId);
              return count + (template ? template.inputs.length + template.outputs.length + template.controlInputs.length + template.controlOutputs.length : 0);
            }, 0)}</span>
          </>
        ) : null}
    </div>
  );
}

function DesktopTitleBar(props: {
  busy: boolean;
  mode: "hub" | "workspace";
  solution?: BlueprintSolutionSummary;
  selectedGraphPath?: string;
  onCreateSolution(): void;
  onOpenSolution(): void;
  onCreateProject?: () => void;
  onRefreshSolution?: () => void;
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  onActivateLeftDock(tab: DesktopDockTab): void;
  onActivateRightDock(tab: DesktopDockTab): void;
  onToggleLeftDock(): void;
  onToggleRightDock(): void;
  onCompileGraph(): Promise<void>;
  onRunGraph(): Promise<void>;
}): JSX.Element {
  const [openMenu, setOpenMenu] = React.useState<"file" | "edit" | "view" | "run" | "help" | undefined>();
  const workspaceContextLabel = props.solution?.name ?? desktopT("desktop.previewGraphOpen");
  const handleWindowError = React.useCallback((error: unknown) => {
    console.error(error);
  }, []);
  const runMenuAction = React.useCallback((action: () => void) => {
    setOpenMenu(undefined);
    action();
  }, []);
  const copyText = React.useCallback((value?: string) => {
    if (!value) {
      return;
    }
    void navigator.clipboard?.writeText(value).catch((error: unknown) => console.error(error));
  }, []);
  const runEditorCommand = React.useCallback((commandId: string) => {
    sendToEditor({ type: "runCommand", commandId });
  }, []);
  const minimizeWindow = React.useCallback(() => {
    void getCurrentWindow().minimize().catch(handleWindowError);
  }, [handleWindowError]);
  const maximizeWindow = React.useCallback(() => {
    void getCurrentWindow().toggleMaximize().catch(handleWindowError);
  }, [handleWindowError]);
  const closeWindow = React.useCallback(() => {
    void getCurrentWindow().close().catch(handleWindowError);
  }, [handleWindowError]);
  const startWindowDrag = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    void getCurrentWindow().startDragging().catch(handleWindowError);
  }, [handleWindowError]);

  return (
    <header className="desktop-titlebar" onPointerDown={startWindowDrag}>
      <div className="desktop-titlebar-brand">
        <WorkflowMark />
        <span>Blueprint IDE</span>
      </div>
      <nav className="desktop-main-menu" aria-label={desktopT("desktop.mainMenu")}>
        <div className="desktop-menu-root">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "file"}
            onClick={() => setOpenMenu((current) => current === "file" ? undefined : "file")}
            disabled={props.busy}
          >
            {desktopT("desktop.menu.file")}
          </button>
          {openMenu === "file" ? (
            <div className="desktop-menu-popover" role="menu">
              <button type="button" role="menuitem" onClick={() => runMenuAction(props.onCreateSolution)}>
                <Plus size={14} />
                <span>{desktopT("desktop.newSolution")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(props.onOpenSolution)}>
                <FolderOpen size={14} />
                <span>{desktopT("desktop.openSolution")}</span>
              </button>
              {props.onCreateProject ? (
                <button type="button" role="menuitem" onClick={() => runMenuAction(props.onCreateProject ?? (() => undefined))}>
                  <Plus size={14} />
                  <span>{desktopT("desktop.newProject")}</span>
                </button>
              ) : null}
              {props.onRefreshSolution ? (
                <button type="button" role="menuitem" onClick={() => runMenuAction(props.onRefreshSolution ?? (() => undefined))}>
                  <RefreshCw size={14} />
                  <span>{desktopT("desktop.refreshSolution")}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="desktop-menu-root">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "edit"}
            onClick={() => setOpenMenu((current) => current === "edit" ? undefined : "edit")}
            disabled={props.busy || props.mode !== "workspace"}
          >
            {desktopT("desktop.menu.edit")}
          </button>
          {openMenu === "edit" ? (
            <div className="desktop-menu-popover wide" role="menu">
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => runEditorCommand("workbench.commandPalette"))}>
                <Command size={14} />
                <span>{desktopT("commands.workbench.commandPalette")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => runEditorCommand("graph.undo"))}>
                <Undo2 size={14} />
                <span>{desktopT("commands.graph.undo")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => runEditorCommand("graph.redo"))}>
                <Redo2 size={14} />
                <span>{desktopT("commands.graph.redo")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => runEditorCommand("graph.copy"))}>
                <Copy size={14} />
                <span>{desktopT("commands.graph.copySelection")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => runEditorCommand("graph.paste"))}>
                <ClipboardPaste size={14} />
                <span>{desktopT("commands.graph.pasteSelection")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => runEditorCommand("graph.duplicate"))}>
                <Copy size={14} />
                <span>{desktopT("commands.graph.duplicateSelection")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => runEditorCommand("graph.delete"))}>
                <Trash2 size={14} />
                <span>{desktopT("commands.graph.deleteSelection")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => runEditorCommand("graph.findNode"))}>
                <Search size={14} />
                <span>{desktopT("desktop.menu.findNode")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => props.onActivateRightDock("commands"))}>
                <Command size={14} />
                <span>{desktopT("desktop.menu.openCommands")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => copyText(props.selectedGraphPath))} disabled={!props.selectedGraphPath}>
                <FileJson size={14} />
                <span>{desktopT("desktop.menu.copyGraphPath")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => copyText(props.solution?.path))} disabled={!props.solution}>
                <FileJson size={14} />
                <span>{desktopT("desktop.menu.copySolutionPath")}</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="desktop-menu-root">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "view"}
            onClick={() => setOpenMenu((current) => current === "view" ? undefined : "view")}
            disabled={props.busy || props.mode !== "workspace"}
          >
            {desktopT("desktop.menu.view")}
          </button>
          {openMenu === "view" ? (
            <div className="desktop-menu-popover wide" role="menu">
              <button type="button" role="menuitem" onClick={() => runMenuAction(props.onToggleLeftDock)}>
                <PanelLeft size={14} />
                <span>{props.leftDockOpen ? desktopT("desktop.menu.hideLeftDock") : desktopT("desktop.menu.showLeftDock")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(props.onToggleRightDock)}>
                <PanelRight size={14} />
                <span>{props.rightDockOpen ? desktopT("desktop.menu.hideRightDock") : desktopT("desktop.menu.showRightDock")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => props.onActivateLeftDock("tree"))}>
                <PanelLeft size={14} />
                <span>{desktopT("desktop.dock.tree")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => props.onActivateRightDock("commands"))}>
                <Command size={14} />
                <span>{desktopT("desktop.dock.commands")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => props.onActivateRightDock("inspector"))}>
                <PanelRight size={14} />
                <span>{desktopT("desktop.dock.inspector")}</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="desktop-menu-root">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "run"}
            onClick={() => setOpenMenu((current) => current === "run" ? undefined : "run")}
            disabled={props.busy || props.mode !== "workspace"}
          >
            {desktopT("desktop.menu.run")}
          </button>
          {openMenu === "run" ? (
            <div className="desktop-menu-popover" role="menu">
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => void props.onCompileGraph())}>
                <Command size={14} />
                <span>{desktopT("desktop.run.compile")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => void props.onRunGraph())}>
                <Play size={14} />
                <span>{desktopT("desktop.run.run")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => props.onActivateLeftDock("run"))}>
                <PanelLeft size={14} />
                <span>{desktopT("desktop.menu.openRunDock")}</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="desktop-menu-root">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "help"}
            onClick={() => setOpenMenu((current) => current === "help" ? undefined : "help")}
          >
            {desktopT("desktop.menu.help")}
          </button>
          {openMenu === "help" ? (
            <div className="desktop-menu-popover wide" role="menu">
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => window.alert(desktopT("desktop.menu.aboutMessage")))}>
                <Command size={14} />
                <span>{desktopT("desktop.menu.about")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </nav>
      <div className="desktop-titlebar-context">
        <span>{props.mode === "hub" ? desktopT("desktop.hub.title") : workspaceContextLabel}</span>
      </div>
      <div className="desktop-titlebar-actions">
        {props.onRefreshSolution ? (
          <button type="button" onClick={props.onRefreshSolution} disabled={props.busy} title={desktopT("desktop.refreshSolution")} aria-label={desktopT("desktop.refreshSolution")}>
            <RefreshCw size={13} />
          </button>
        ) : null}
      </div>
      <div className="desktop-window-controls">
        <button type="button" onClick={minimizeWindow} title={desktopT("desktop.window.minimize")} aria-label={desktopT("desktop.window.minimize")}>
          <Minus size={14} />
        </button>
        <button type="button" onClick={maximizeWindow} title={desktopT("desktop.window.maximize")} aria-label={desktopT("desktop.window.maximize")}>
          <Maximize2 size={13} />
        </button>
        <button type="button" className="close" onClick={closeWindow} title={desktopT("desktop.window.close")} aria-label={desktopT("desktop.window.close")}>
          <X size={14} />
        </button>
      </div>
    </header>
  );
}

function ProjectHub(props: {
  busy: boolean;
  loading?: boolean;
  error?: string;
  launchFolder?: { path: string; error?: string };
  recentSolutions: BlueprintSolutionSummary[];
  onCreateSolution(): void;
  onCreateSolutionTemplate(templateId: BlueprintSolutionTemplateId): void;
  onOpenSolution(): void;
  onOpenRecentSolution(path: string): void;
}): JSX.Element {
  return (
    <main className="project-hub" aria-label={desktopT("desktop.hub.title")}>
      <section className="project-hub-main">
        <aside className="project-hub-recents">
          <header className="project-hub-title">
            <span>{desktopT("desktop.hub.kicker")}</span>
            <h1>{desktopT("desktop.hub.title")}</h1>
          </header>
          <strong>{desktopT("desktop.hub.recent")}</strong>
          <div className="project-hub-recent-list">
            {props.recentSolutions.length ? props.recentSolutions.map((solution) => (
              <button key={solution.path} type="button" onClick={() => props.onOpenRecentSolution(solution.path)} disabled={props.busy || props.loading}>
                <FileJson size={15} />
                <span>{solution.name}</span>
                <small>{solution.path}</small>
              </button>
            )) : <span className="project-hub-empty">{desktopT("desktop.hub.noRecent")}</span>}
          </div>
        </aside>
        <section className="project-hub-start">
          <p>{desktopT("desktop.hub.description")}</p>
          <div className="project-hub-actions">
            <button type="button" onClick={props.onOpenSolution} disabled={props.busy || props.loading}>
              <FolderOpen size={18} />
              <span>{desktopT("desktop.openSolution")}</span>
            </button>
            <button type="button" onClick={props.onCreateSolution} disabled={props.busy || props.loading}>
              <Plus size={18} />
              <span>{desktopT("desktop.newSolution")}</span>
            </button>
          </div>
          <div className="project-hub-templates" aria-label={desktopT("desktop.hub.templates")}>
            <strong>{desktopT("desktop.hub.templates")}</strong>
            <button type="button" onClick={() => props.onCreateSolutionTemplate("empty")} disabled={props.busy || props.loading}>
              <PackageIcon size={15} />
              <span>{desktopT("desktop.hub.template.empty")}</span>
              <small>{desktopT("desktop.hub.template.emptyDescription")}</small>
            </button>
            <button type="button" onClick={() => props.onCreateSolutionTemplate("hello-world")} disabled={props.busy || props.loading}>
              <PackageIcon size={15} />
              <span>{desktopT("desktop.hub.template.helloWorld")}</span>
              <small>{desktopT("desktop.hub.template.helloWorldDescription")}</small>
            </button>
          </div>
          {props.launchFolder ? (
            <div className="project-hub-panel warning">
              <strong>{desktopT("desktop.hub.folderFallback")}</strong>
              <span title={props.launchFolder.path}>{props.launchFolder.path}</span>
              {props.launchFolder.error ? <small>{props.launchFolder.error}</small> : null}
            </div>
          ) : null}
          {props.loading ? <div className="project-hub-status">{desktopT("desktop.hub.loading")}</div> : null}
          {props.error ? <div className="desktop-error">{props.error}</div> : null}
        </section>
      </section>
    </main>
  );
}

function WorkflowMark(): JSX.Element {
  return <div className="desktop-mark">BP</div>;
}
