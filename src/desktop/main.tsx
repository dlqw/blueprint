import * as React from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Code2, FileJson, FolderOpen, Library, Package as PackageIcon, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { getBuiltinTemplates } from "../shared/builtins";
import { extractCollapsedUnitToProjectGraph } from "../shared/collapse";
import {
  BlueprintGraph,
  BlueprintGraphSearchEntry,
  BlueprintProject,
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
import { addProjectTemplateSource, importProjectTemplatePackage, removeProjectTemplateSource } from "./projectTemplateSources";
import { desktopSampleGraph } from "./sampleGraph";
import { BlueprintGraphSummary, BlueprintSolutionSummary, tauriBlueprintHost } from "./tauriBlueprintHost";
import { createWorkflowGraph, getWorkflowTemplates, WorkflowTemplateDefinition } from "./workflowTemplates";

interface BlueprintShellStatus {
  shell: string;
  version: string;
  primary_path: boolean;
}

const builtinTemplates = getBuiltinTemplates();
const workflowTemplates = getWorkflowTemplates();
const desktopT = createTranslator(defaultLocale);
let activeTemplates = builtinTemplates;
let activeGraphPath: string | undefined;
let activeGraph: BlueprintGraph = readStoredGraph() ?? desktopSampleGraph;
let templateLoadRequestId = 0;
let solutionGraphIndexRequestId = 0;
let runtimeRunSequence = 0;
let activeRuntimeRun: PendingRuntimeRun | undefined;
const pendingRuntimeRuns: PendingRuntimeRun[] = [];
let updateSelectedGraphPathFromEditor: ((path: string) => void) | undefined;
let updateSolutionFromEditor: ((solution: BlueprintSolutionSummary) => void) | undefined;

interface PendingRuntimeRun {
  id: string;
  graph: BlueprintGraph;
  graphPath?: string;
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
    enqueueRuntimeRun(message.graph);
    return;
  }
}

function enqueueRuntimeRun(graph: BlueprintGraph): void {
  pendingRuntimeRuns.push({
    id: `run-${++runtimeRunSequence}`,
    graph,
    graphPath: activeGraphPath
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
  const result = await tauriBlueprintHost.runGraph(nextRun.graph, nextRun.graphPath).catch((error: unknown) => ({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    stdout: "",
    stderr: "",
    durationMs: 0,
    traces: [],
    issues: []
  }));
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
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { path?: unknown }).path === "string" &&
    Array.isArray((value as { projects?: unknown }).projects)
  ) {
    return value as BlueprintSolutionSummary;
  }
  return undefined;
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

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <DesktopShell />
    </React.StrictMode>
  );
}

function DesktopShell(): JSX.Element {
  const [solution, setSolution] = React.useState<BlueprintSolutionSummary | undefined>(() => readStoredSolution());
  const [selectedGraphPath, setSelectedGraphPath] = React.useState<string | undefined>(activeGraphPath);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [expandedTemplateProjectPath, setExpandedTemplateProjectPath] = React.useState<string | undefined>();
  const [expandedSourceProjectPath, setExpandedSourceProjectPath] = React.useState<string | undefined>();

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

  const loadSolution = React.useCallback(async (path: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const nextSolution = await tauriBlueprintHost.readBlueprintSolution(path);
      setSolution(nextSolution);
      writeJsonStorage(desktopSolutionKey, nextSolution);
      const firstGraph = nextSolution.projects.flatMap((project) => project.graphs)[0];
      if (firstGraph) {
        await loadGraphPath(firstGraph.path);
        setSelectedGraphPath(firstGraph.path);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setBusy(false);
    }
  }, []);

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

  const createSolution = React.useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const solutionName = window.prompt(desktopT("desktop.prompt.solutionName"), desktopT("desktop.default.solutionName"))?.trim();
      if (!solutionName) {
        return;
      }
      const projectName = window.prompt(desktopT("desktop.prompt.firstProjectName"), desktopT("desktop.default.projectName"))?.trim();
      if (!projectName) {
        return;
      }
      const selected = await save({
        defaultPath: `${solutionName}.bsln`,
        filters: [{ name: desktopT("desktop.fileFilter.solution"), extensions: ["bsln"] }]
      });
      if (typeof selected !== "string") {
        return;
      }
      const nextSolution = await tauriBlueprintHost.createSolution(selected, solutionName, projectName);
      setSolution(nextSolution);
      writeJsonStorage(desktopSolutionKey, nextSolution);
      const firstGraph = nextSolution.projects.flatMap((project) => project.graphs)[0];
      if (firstGraph) {
        await loadGraphPath(firstGraph.path);
        setSelectedGraphPath(firstGraph.path);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
    }
  }, []);

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

  const createGraphFromTemplate = React.useCallback(
    async (projectPath: string, template: WorkflowTemplateDefinition) => {
      if (!solution) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const graphName = window.prompt(desktopT("desktop.prompt.graphName"), workflowTemplateDefaultGraphName(template))?.trim();
        if (!graphName) {
          return;
        }
        const graph = await tauriBlueprintHost.createGraph(projectPath, graphName);
        await tauriBlueprintHost.writeBlueprintFile(graph.path, createWorkflowGraph(template.id, graphName));
        const nextSolution = await tauriBlueprintHost.readBlueprintSolution(solution.path);
        setSolution(nextSolution);
        writeJsonStorage(desktopSolutionKey, nextSolution);
        await loadGraphPath(graph.path);
        setSelectedGraphPath(graph.path);
        setExpandedTemplateProjectPath(undefined);
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : String(createError));
      } finally {
        setBusy(false);
      }
    },
    [solution]
  );

  const addTemplateSource = React.useCallback(
    async (projectPath: string) => {
      if (!solution) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const source = window.prompt(desktopT("desktop.prompt.templateSourceGlob"), "src/**/*.ts")?.trim();
        if (!source) {
          return;
        }
        const projectFile = await tauriBlueprintHost.readBlueprintFile(projectPath);
        if (!isBlueprintProject(projectFile)) {
          throw new Error(desktopT("desktop.error.selectedFileNotProject", { projectPath }));
        }
        const nextProject = addProjectTemplateSource(projectFile, source);
        if (nextProject !== projectFile) {
          await tauriBlueprintHost.writeBlueprintFile(projectPath, nextProject);
        }
        const nextSolution = await tauriBlueprintHost.readBlueprintSolution(solution.path);
        setSolution(nextSolution);
        writeJsonStorage(desktopSolutionKey, nextSolution);
      } catch (sourceError) {
        setError(sourceError instanceof Error ? sourceError.message : String(sourceError));
      } finally {
        setBusy(false);
      }
    },
    [solution]
  );

  const importTemplatePackage = React.useCallback(
    async (projectPath: string) => {
      if (!solution) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const manifestText = window.prompt(desktopT("desktop.prompt.templatePackageManifestJson"), JSON.stringify({
          id: "gameplay.templates",
          name: desktopT("desktop.default.templatePackageName"),
          version: "1.0.0",
          templateSources: ["src/**/*.ts"],
          builtinGroups: []
        }, null, 2))?.trim();
        if (!manifestText) {
          return;
        }
        const manifest = JSON.parse(manifestText) as Parameters<typeof importProjectTemplatePackage>[1];
        const projectFile = await tauriBlueprintHost.readBlueprintFile(projectPath);
        if (!isBlueprintProject(projectFile)) {
          throw new Error(desktopT("desktop.error.selectedFileNotProject", { projectPath }));
        }
        const nextProject = importProjectTemplatePackage(projectFile, manifest);
        await tauriBlueprintHost.writeBlueprintFile(projectPath, nextProject);
        const nextSolution = await tauriBlueprintHost.readBlueprintSolution(solution.path);
        setSolution(nextSolution);
        writeJsonStorage(desktopSolutionKey, nextSolution);
      } catch (sourceError) {
        setError(sourceError instanceof Error ? sourceError.message : String(sourceError));
      } finally {
        setBusy(false);
      }
    },
    [solution]
  );

  const removeTemplateSource = React.useCallback(
    async (projectPath: string, source: string) => {
      if (!solution || !window.confirm(desktopT("desktop.confirm.removeTemplateSource", { source }))) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const projectFile = await tauriBlueprintHost.readBlueprintFile(projectPath);
        if (!isBlueprintProject(projectFile)) {
          throw new Error(desktopT("desktop.error.selectedFileNotProject", { projectPath }));
        }
        await tauriBlueprintHost.writeBlueprintFile(projectPath, removeProjectTemplateSource(projectFile, source));
        const nextSolution = await tauriBlueprintHost.readBlueprintSolution(solution.path);
        setSolution(nextSolution);
        writeJsonStorage(desktopSolutionKey, nextSolution);
      } catch (sourceError) {
        setError(sourceError instanceof Error ? sourceError.message : String(sourceError));
      } finally {
        setBusy(false);
      }
    },
    [solution]
  );

  const renameProject = React.useCallback(
    async (projectPath: string, currentName: string) => {
      if (!solution) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const projectName = window.prompt(desktopT("desktop.prompt.projectName"), currentName)?.trim();
        if (!projectName || projectName === currentName) {
          return;
        }
        const nextSolution = await tauriBlueprintHost.renameProject(solution.path, projectPath, projectName);
        setSolution(nextSolution);
        writeJsonStorage(desktopSolutionKey, nextSolution);
      } catch (renameError) {
        setError(renameError instanceof Error ? renameError.message : String(renameError));
      } finally {
        setBusy(false);
      }
    },
    [solution]
  );

  const deleteProject = React.useCallback(
    async (projectPath: string, projectName: string) => {
      if (!solution || !window.confirm(desktopT("desktop.confirm.deleteProject", { project: projectName }))) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const nextSolution = await tauriBlueprintHost.deleteProject(solution.path, projectPath);
        setSolution(nextSolution);
        writeJsonStorage(desktopSolutionKey, nextSolution);
        const nextGraph = nextSolution.projects.flatMap((project) => project.graphs)[0];
        if (nextGraph) {
          await loadGraphPath(nextGraph.path);
          setSelectedGraphPath(nextGraph.path);
        } else {
          setSelectedGraphPath(undefined);
        }
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      } finally {
        setBusy(false);
      }
    },
    [solution]
  );

  const renameGraph = React.useCallback(
    async (projectPath: string, graph: BlueprintGraphSummary) => {
      if (!solution) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const graphName = window.prompt(desktopT("desktop.prompt.graphName"), graph.name)?.trim();
        if (!graphName || graphName === graph.name) {
          return;
        }
        const renamed = await tauriBlueprintHost.renameGraph(projectPath, graph.path, graphName);
        const nextSolution = await tauriBlueprintHost.readBlueprintSolution(solution.path);
        setSolution(nextSolution);
        writeJsonStorage(desktopSolutionKey, nextSolution);
        if (graph.path === selectedGraphPath) {
          await loadGraphPath(renamed.path);
          setSelectedGraphPath(renamed.path);
        }
      } catch (renameError) {
        setError(renameError instanceof Error ? renameError.message : String(renameError));
      } finally {
        setBusy(false);
      }
    },
    [selectedGraphPath, solution]
  );

  const deleteGraph = React.useCallback(
    async (projectPath: string, graph: BlueprintGraphSummary) => {
      if (!solution || !window.confirm(desktopT("desktop.confirm.deleteGraph", { graph: graph.name }))) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        await tauriBlueprintHost.deleteGraph(projectPath, graph.path);
        const nextSolution = await tauriBlueprintHost.readBlueprintSolution(solution.path);
        setSolution(nextSolution);
        writeJsonStorage(desktopSolutionKey, nextSolution);
        if (graph.path === selectedGraphPath) {
          const nextGraph = nextSolution.projects.flatMap((project) => project.graphs)[0];
          if (nextGraph) {
            await loadGraphPath(nextGraph.path);
            setSelectedGraphPath(nextGraph.path);
          } else {
            setSelectedGraphPath(undefined);
          }
        }
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      } finally {
        setBusy(false);
      }
    },
    [selectedGraphPath, solution]
  );

  return (
    <div className="desktop-shell">
      <aside className="desktop-nav" aria-label={desktopT("desktop.navigation")}>
        <div className="desktop-nav-title">
          <WorkflowMark />
          <div>
            <strong>Blueprint IDE</strong>
            <span>{desktopT("desktop.subtitle")}</span>
          </div>
        </div>
        <div className="desktop-nav-actions">
          <button type="button" onClick={createSolution} disabled={busy} title={desktopT("desktop.newSolutionTitle")}>
            <Plus size={15} />
            <span>{desktopT("desktop.newSolution")}</span>
          </button>
          <button type="button" onClick={chooseSolution} disabled={busy} title={desktopT("desktop.openSolutionTitle")}>
            <FolderOpen size={15} />
            <span>{desktopT("desktop.openSolution")}</span>
          </button>
          {solution ? (
            <button type="button" onClick={() => void loadSolution(solution.path)} disabled={busy} title={desktopT("desktop.refreshSolution")}>
              <RefreshCw size={15} />
            </button>
          ) : null}
        </div>
        <div className="desktop-solution-meta">
          <span>{solution?.name ?? desktopT("desktop.noSolutionSelected")}</span>
          {solution ? <small title={solution.path}>{solution.path}</small> : null}
        </div>
        {solution ? (
          <button type="button" className="desktop-wide-action" onClick={createProject} disabled={busy} title={desktopT("desktop.newProjectTitle")}>
            <Plus size={14} />
            <span>{desktopT("desktop.newProject")}</span>
          </button>
        ) : null}
        <div className="desktop-project-list">
          {solution?.projects.map((project) => (
            <section key={project.path} className="desktop-project">
              <div className="desktop-project-heading">
                <h2>{project.name}</h2>
                <button type="button" onClick={() => void createGraph(project.path)} disabled={busy} title={desktopT("desktop.newGraphInProject", { project: project.name })}>
                  <Plus size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExpandedSourceProjectPath(undefined);
                    setExpandedTemplateProjectPath((current) => current === project.path ? undefined : project.path);
                  }}
                  disabled={busy}
                  title={desktopT("desktop.workflowTemplatesForProject", { project: project.name })}
                >
                  <Library size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExpandedTemplateProjectPath(undefined);
                    setExpandedSourceProjectPath((current) => current === project.path ? undefined : project.path);
                  }}
                  disabled={busy}
                  title={desktopT("desktop.templateSourcesForProject", { project: project.name })}
                >
                  <Code2 size={13} />
                </button>
                <button type="button" onClick={() => void renameProject(project.path, project.name)} disabled={busy} title={desktopT("desktop.rename", { name: project.name })}>
                  <Pencil size={13} />
                </button>
                <button type="button" onClick={() => void deleteProject(project.path, project.name)} disabled={busy} title={desktopT("desktop.delete", { name: project.name })}>
                  <Trash2 size={13} />
                </button>
              </div>
              {expandedTemplateProjectPath === project.path ? (
                <div className="desktop-template-browser" aria-label={desktopT("desktop.workflowTemplatesForProject", { project: project.name })}>
                  {workflowTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => void createGraphFromTemplate(project.path, template)}
                      disabled={busy}
                      title={workflowTemplateDescription(template)}
                    >
                      <span className="desktop-template-name">{workflowTemplateName(template)}</span>
                      <small className="desktop-template-category">{workflowTemplateCategory(template)}</small>
                      <span className="desktop-template-description">{workflowTemplateDescription(template)}</span>
                      <span className="desktop-template-preview">
                        {workflowTemplatePreviewText(template)}
                      </span>
                      <span className="desktop-template-tags">
                        {template.tags.map((tag) => <small key={tag}>{tag}</small>)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {expandedSourceProjectPath === project.path ? (
                <div className="desktop-template-sources" aria-label={desktopT("desktop.templateSourcesForProject", { project: project.name })}>
                  <button type="button" className="desktop-template-source-add" onClick={() => void addTemplateSource(project.path)} disabled={busy} title={desktopT("desktop.addTemplateSourceToProject", { project: project.name })}>
                    <Plus size={13} />
                    <span>{desktopT("desktop.addSource")}</span>
                  </button>
                  <button type="button" className="desktop-template-source-add" onClick={() => void importTemplatePackage(project.path)} disabled={busy} title={desktopT("desktop.importTemplatePackageToProject", { project: project.name })}>
                    <PackageIcon size={13} />
                    <span>{desktopT("desktop.importPackage")}</span>
                  </button>
                  {project.templateSources.length ? project.templateSources.map((source) => (
                    <div key={source} className="desktop-template-source" title={source}>
                      <span>{source}</span>
                      <button type="button" onClick={() => void removeTemplateSource(project.path, source)} disabled={busy} title={desktopT("desktop.removeTemplateSource", { source })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )) : <span className="desktop-template-source-empty">{desktopT("desktop.noTemplateSources")}</span>}
                </div>
              ) : null}
              {project.graphs.map((graph) => (
                <div
                  key={graph.path}
                  className={graph.path === selectedGraphPath ? "desktop-graph active" : "desktop-graph"}
                  title={graph.path}
                >
                  <button type="button" className="desktop-graph-open" onClick={() => void openGraph(graph)}>
                    <FileJson size={14} />
                    <span>{graph.name}</span>
                    <small>{graph.kind}</small>
                  </button>
                  <button type="button" className="desktop-graph-action" onClick={() => void renameGraph(project.path, graph)} disabled={busy} title={desktopT("desktop.rename", { name: graph.name })}>
                    <Pencil size={12} />
                  </button>
                  <button type="button" className="desktop-graph-action" onClick={() => void deleteGraph(project.path, graph)} disabled={busy} title={desktopT("desktop.delete", { name: graph.name })}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
        {error ? <div className="desktop-error">{error}</div> : null}
      </aside>
      <main className="desktop-editor">
        <App />
      </main>
    </div>
  );
}

function WorkflowMark(): JSX.Element {
  return <div className="desktop-mark">BP</div>;
}

function workflowTemplateName(template: WorkflowTemplateDefinition): string {
  return desktopT(`workflowTemplate.${template.id}.name`);
}

function workflowTemplateDescription(template: WorkflowTemplateDefinition): string {
  return desktopT(`workflowTemplate.${template.id}.description`);
}

function workflowTemplateDefaultGraphName(template: WorkflowTemplateDefinition): string {
  return desktopT(`workflowTemplate.${template.id}.defaultGraphName`);
}

function workflowTemplateCategory(template: WorkflowTemplateDefinition): string {
  return desktopT(`workflowTemplate.${template.id}.category`);
}

function workflowTemplatePreviewText(template: WorkflowTemplateDefinition): string {
  return [
    desktopT("desktop.preview.nodes", { count: template.preview.nodeCount }),
    desktopT("desktop.preview.wires", { count: template.preview.linkCount }),
    desktopT("desktop.preview.inputs", { count: template.preview.inputCount }),
    desktopT("desktop.preview.outputs", { count: template.preview.outputCount })
  ].join(" · ");
}
