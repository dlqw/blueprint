import { invoke } from "@tauri-apps/api/core";
import { BlueprintBreakpointSpec, BlueprintGraph, BlueprintNodeTemplate, BlueprintProject, BlueprintSolution, BlueprintTemplatePackageManifest, RuntimeTraceEvent, ValidationIssue } from "../shared/blueprint";

export type BlueprintFile = BlueprintSolution | BlueprintProject | BlueprintGraph;

export interface BlueprintSolutionSummary {
  path: string;
  name: string;
  projects: BlueprintProjectSummary[];
}

export interface BlueprintProjectSummary {
  path: string;
  name: string;
  templateSources: string[];
  templatePackages?: BlueprintTemplatePackageManifest[];
  builtins?: {
    typescriptStandardLibrary: boolean;
    groups: string[];
  };
  graphs: BlueprintGraphSummary[];
}

export interface BlueprintGraphSummary {
  path: string;
  id: string;
  name: string;
  kind: string;
}

export interface BlueprintDesktopHost {
  getLaunchContext(): Promise<BlueprintLaunchContext>;
  readBlueprintFile(path: string): Promise<BlueprintFile>;
  writeBlueprintFile(path: string, value: BlueprintFile): Promise<void>;
  readBlueprintSolution(path: string): Promise<BlueprintSolutionSummary>;
  loadProjectTemplates(projectPath: string): Promise<BlueprintDesktopTemplatesResult>;
  compileGraph(graph: BlueprintGraph, graphPath?: string): Promise<BlueprintDesktopCompileResult>;
  runGraph(graph: BlueprintGraph, graphPath?: string, options?: BlueprintDesktopRunOptions): Promise<BlueprintDesktopRunResult>;
  runtimeStep(runId?: string): Promise<void>;
  runtimeContinue(runId?: string): Promise<void>;
  cancelRuntimeRun(runId?: string): Promise<void>;
  createSolution(path: string, solutionName: string, projectName: string, templateId: BlueprintSolutionTemplateId): Promise<BlueprintSolutionSummary>;
  createProject(solutionPath: string, projectName: string): Promise<BlueprintSolutionSummary>;
  renameProject(solutionPath: string, projectPath: string, projectName: string): Promise<BlueprintSolutionSummary>;
  deleteProject(solutionPath: string, projectPath: string): Promise<BlueprintSolutionSummary>;
  createGraph(projectPath: string, graphName: string): Promise<BlueprintGraphSummary>;
  renameGraph(projectPath: string, graphPath: string, graphName: string): Promise<BlueprintGraphSummary>;
  deleteGraph(projectPath: string, graphPath: string): Promise<void>;
}

export type BlueprintLaunchContext =
  | { kind: "hub" }
  | { kind: "folder"; folderPath: string; error?: string }
  | { kind: "solution"; solution: BlueprintSolutionSummary };

export type BlueprintSolutionTemplateId = "empty" | "hello-world";

export interface BlueprintDesktopCompileResult {
  ok: boolean;
  message: string;
  issues?: ValidationIssue[];
  outputFiles?: string[];
}

export interface BlueprintDesktopTemplatesResult {
  ok: boolean;
  templates: BlueprintNodeTemplate[];
  message?: string;
}

export interface BlueprintDesktopRunResult {
  runId?: string;
  ok: boolean;
  message: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  traces: RuntimeTraceEvent[];
  issues?: ValidationIssue[];
}

export interface BlueprintDesktopRunOptions {
  runId?: string;
  breakpoints?: BlueprintBreakpointSpec[];
  stepMode?: boolean;
  streamEvents?: boolean;
}

export const tauriBlueprintHost: BlueprintDesktopHost = {
  getLaunchContext() {
    return invoke<BlueprintLaunchContext>("blueprint_launch_context");
  },
  readBlueprintFile(path) {
    return invoke<BlueprintFile>("blueprint_read_file", { path });
  },
  writeBlueprintFile(path, value) {
    return invoke<void>("blueprint_write_file", { path, value });
  },
  readBlueprintSolution(path) {
    return invoke<BlueprintSolutionSummary>("blueprint_read_solution", { path });
  },
  loadProjectTemplates(projectPath) {
    return invoke<BlueprintDesktopTemplatesResult>("blueprint_load_project_templates", { projectPath });
  },
  compileGraph(graph, graphPath) {
    return invoke<BlueprintDesktopCompileResult>("blueprint_compile_graph", { graph, graphPath });
  },
  runGraph(graph, graphPath, options) {
    return invoke<BlueprintDesktopRunResult>("blueprint_run_graph", {
      graph,
      graphPath,
      runId: options?.runId,
      breakpoints: options?.breakpoints,
      stepMode: options?.stepMode,
      streamEvents: options?.streamEvents
    });
  },
  runtimeStep(runId) {
    return invoke<void>("blueprint_runtime_step", { runId });
  },
  runtimeContinue(runId) {
    return invoke<void>("blueprint_runtime_continue", { runId });
  },
  cancelRuntimeRun(runId) {
    return invoke<void>("blueprint_cancel_runtime_run", { runId });
  },
  createSolution(path, solutionName, projectName, templateId) {
    return invoke<BlueprintSolutionSummary>("blueprint_create_solution", { path, solutionName, projectName, templateId });
  },
  createProject(solutionPath, projectName) {
    return invoke<BlueprintSolutionSummary>("blueprint_create_project", { solutionPath, projectName });
  },
  renameProject(solutionPath, projectPath, projectName) {
    return invoke<BlueprintSolutionSummary>("blueprint_rename_project", { solutionPath, projectPath, projectName });
  },
  deleteProject(solutionPath, projectPath) {
    return invoke<BlueprintSolutionSummary>("blueprint_delete_project", { solutionPath, projectPath });
  },
  createGraph(projectPath, graphName) {
    return invoke<BlueprintGraphSummary>("blueprint_create_graph", { projectPath, graphName });
  },
  renameGraph(projectPath, graphPath, graphName) {
    return invoke<BlueprintGraphSummary>("blueprint_rename_graph", { projectPath, graphPath, graphName });
  },
  deleteGraph(projectPath, graphPath) {
    return invoke<void>("blueprint_delete_graph", { projectPath, graphPath });
  }
};
