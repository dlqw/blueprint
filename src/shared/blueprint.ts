export type FlowKind = "data" | "control";
export type PortDirection = "input" | "output";
export type PortEditor = "text" | "number" | "boolean" | "select" | "json" | "none";
export type TemplateBodyKind = "typescriptFunction" | "typescriptBuiltin" | "blueprintGraph" | "macroExpansion";
export type LocalizedText = Partial<Record<string, string>>;

export interface BlueprintTemplateLocalization {
  key?: string;
  name?: LocalizedText;
  creationPath?: LocalizedText;
  description?: LocalizedText;
  ports?: Record<string, {
    name?: LocalizedText;
    description?: LocalizedText;
  }>;
}

export interface BlueprintSolution {
  format: "blueprint-solution";
  version: 1;
  name: string;
  projects: BlueprintProjectReference[];
}

export interface BlueprintProjectReference {
  name: string;
  path: string;
}

export interface BlueprintProject {
  format: "blueprint-project";
  version: 1;
  name: string;
  graphs: string[];
  templateSources: string[];
  templatePackages?: BlueprintTemplatePackageManifest[];
  macros?: string[];
  builtins?: {
    typescriptStandardLibrary: boolean;
    groups: string[];
  };
  blackboard?: BlackboardDefinition;
  debug?: BlueprintProjectDebugSettings;
  compiler: {
    outDir: string;
    module: string;
    target: string;
    runtime: string;
  };
}

export interface BlueprintTemplatePackageManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  templateSources: string[];
  builtinGroups?: string[];
  i18n?: {
    name?: LocalizedText;
    description?: LocalizedText;
  };
}

export interface BlueprintProjectDebugSettings {
  breakpointPresets?: BlueprintProjectBreakpointPreset[];
}

export interface BlueprintProjectBreakpointPreset {
  id: string;
  name: string;
  description?: string;
  breakpoints: BlueprintProjectBreakpointPresetEntry[];
}

export interface BlueprintProjectBreakpointPresetEntry {
  graphPath: string;
  nodeId: string;
  enabled?: boolean;
  condition?: string;
}

export interface BlackboardDefinition {
  scope: "project" | "blueprint" | "solution";
  variables: BlackboardVariable[];
}

export interface BlackboardVariable {
  id: string;
  name: string;
  type: BlueprintValueType;
  defaultValue: unknown;
  description: string;
}

export interface BlueprintGraph {
  format: "blueprint-graph";
  version: 1;
  kind?: "function" | "macro";
  id: string;
  name: string;
  description: string;
  templateMetadata?: BlueprintGraphTemplateMetadata;
  localTemplates?: BlueprintNodeTemplate[];
  embeddedGraphs?: BlueprintGraph[];
  nodes: BlueprintNodeInstance[];
  links: BlueprintLink[];
  comments?: BlueprintCommentBox[];
  bookmarks?: BlueprintBookmark[];
  debug?: BlueprintDebugSettings;
  layout: BlueprintLayout;
}

export interface BlueprintDebugSettings {
  breakpoints?: BlueprintBreakpoint[];
}

export interface BlueprintBookmark {
  id: string;
  label: string;
  position: Point;
  nodeId?: string;
}

export interface BlueprintCommentBox {
  id: string;
  title: string;
  position: Point;
  size: {
    width: number;
    height: number;
  };
  nodeIds: string[];
  color?: string;
}

export interface BlueprintGraphTemplateMetadata {
  creationPath?: string;
  inputs: BlueprintPortDefinition[];
  outputs: BlueprintPortDefinition[];
  outputSources?: Record<string, { nodeId: string; portId: string }>;
}

export interface BlueprintLayout {
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
}

export interface BlueprintNodeTemplate {
  id: string;
  name: string;
  creationPath: string;
  description: string;
  inputs: BlueprintPortDefinition[];
  outputs: BlueprintPortDefinition[];
  controlInputs: BlueprintPortDefinition[];
  controlOutputs: BlueprintPortDefinition[];
  bodyKind: TemplateBodyKind;
  bodyRef: string;
  i18n?: BlueprintTemplateLocalization;
  metadata?: Record<string, unknown>;
}

export interface BlueprintPortDefinition {
  id: string;
  name: string;
  direction: PortDirection;
  flowKind: FlowKind;
  type: BlueprintValueType;
  description: string;
  editor: PortEditor;
  defaultValue?: unknown;
  constraints?: {
    options?: Array<string | number | boolean>;
  };
}

export type BlueprintValueType =
  | "exec"
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "null"
  | "undefined"
  | "json"
  | "unknown";

export interface BlueprintNodeInstance {
  id: string;
  templateId: string;
  position: Point;
  inputBindings: Record<string, BlueprintPortBinding>;
  controlBindings?: Record<string, string>;
  displayOverrides?: Record<string, unknown>;
}

export interface BlueprintPortBinding {
  portId: string;
  sourceKind: "literal" | "link";
  literalValue?: unknown;
  linkId?: string;
}

export interface BlueprintLink {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
  flowKind: FlowKind;
  contextVariableId?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
  graphId?: string;
  graphName?: string;
  sourcePath?: string;
  nodeId?: string;
  linkId?: string;
  portId?: string;
}

export interface RuntimeTraceEvent {
  graphId: string;
  nodeId: string;
  nodeName?: string;
  status: "visited" | "active" | "paused" | "breakpoint" | "error" | "skipped";
  message?: string;
  context?: Record<string, unknown>;
  timestamp?: number;
}

export interface RuntimeQueueStatus {
  running: boolean;
  queuedRuns: number;
  activeRunId?: string;
}

export interface BlueprintBreakpoint {
  nodeId: string;
  enabled?: boolean;
  condition?: string;
}

export interface TemplateRegistrySourceSummary {
  projectPath: string;
  projectName: string;
  templateSources: string[];
  templatePackages?: BlueprintTemplatePackageManifest[];
  builtinGroups: string[];
}

export interface BlueprintSolutionOutline {
  path: string;
  name: string;
  activeGraphPath?: string;
  projects: BlueprintProjectOutline[];
}

export interface BlueprintProjectOutline {
  path: string;
  name: string;
  graphs: BlueprintGraphOutline[];
}

export interface BlueprintGraphOutline {
  path: string;
  id: string;
  name: string;
  kind: string;
}

export interface BlueprintSolutionGraphSearchIndex {
  solutionPath: string;
  graphs: BlueprintGraphSearchEntry[];
}

export interface BlueprintGraphSearchEntry {
  projectPath: string;
  projectName: string;
  graphPath: string;
  graphId: string;
  graphName: string;
  graphKind: string;
  description: string;
  inputNames: string[];
  outputNames: string[];
  comments: string[];
  generatedSourceName?: string;
  generatedFunctionName?: string;
  nodes: BlueprintNodeSearchEntry[];
}

export interface BlueprintNodeSearchEntry {
  id: string;
  templateId: string;
  inputPortIds: string[];
  outputPortIds: string[];
  blackboardKey?: string;
  blackboardAccess?: "get" | "set";
  generatedTraceRef?: string;
}

export type BlueprintBreakpointSpec = string | BlueprintBreakpoint;

export type EditorToHostMessage =
  | { type: "ready" }
  | { type: "graphChanged"; graph: BlueprintGraph }
  | { type: "requestUndo" }
  | { type: "requestRedo" }
  | { type: "requestTemplates" }
  | { type: "requestValidation"; graph: BlueprintGraph }
  | { type: "requestCompile"; graph: BlueprintGraph }
  | { type: "requestRun"; graph: BlueprintGraph; breakpoints?: BlueprintBreakpointSpec[]; stepMode?: boolean }
  | { type: "requestCancelRun" }
  | { type: "requestRuntimeStep" }
  | { type: "requestRuntimeContinue" }
  | { type: "requestOpenGraph"; graphPath: string }
  | { type: "requestRenameSolutionGraph"; graphPath: string; nextName: string }
  | { type: "requestRenameGraphNodeId"; oldNodeId: string; nextNodeId: string }
  | { type: "requestExtractCollapsedUnitToProjectGraph"; templateId: string; graphName: string }
  | { type: "requestRenameSolutionBlackboardKey"; oldKey: string; nextKey: string }
  | { type: "requestRetargetSolutionTemplate"; oldTemplateId: string; nextTemplateId: string }
  | { type: "requestRetargetSolutionTemplateSource"; oldSourcePath: string; nextSourcePath: string };

export type HostToEditorMessage =
  | { type: "loadGraph"; graph: BlueprintGraph }
  | { type: "loadTemplates"; templates: BlueprintNodeTemplate[] }
  | { type: "solutionOutline"; solution?: BlueprintSolutionOutline }
  | { type: "solutionGraphIndex"; index?: BlueprintSolutionGraphSearchIndex }
  | { type: "templateRegistrySources"; sources: TemplateRegistrySourceSummary[] }
  | { type: "themeSettings"; categoryAccents: Record<string, string> }
  | { type: "editorCapabilities"; nativeUndoRedo: boolean }
  | { type: "validationResult"; issues: ValidationIssue[] }
  | { type: "compileResult"; ok: boolean; message: string; issues?: ValidationIssue[] }
  | { type: "refactorResult"; ok: boolean; message: string }
  | { type: "runtimeQueueStatus"; status: RuntimeQueueStatus }
  | { type: "runtimeTrace"; trace: RuntimeTraceEvent }
  | { type: "runtimeResult"; ok: boolean; message: string; stdout: string; stderr: string; durationMs: number; traces: RuntimeTraceEvent[]; issues?: ValidationIssue[] }
  | { type: "focusNode"; nodeId: string };

export function createPort(
  id: string,
  name: string,
  direction: PortDirection,
  flowKind: FlowKind,
  type: BlueprintValueType,
  description: string,
  editor: PortEditor,
  defaultValue?: unknown
): BlueprintPortDefinition {
  return { id, name, direction, flowKind, type, description, editor, defaultValue };
}

export function sanitizeIdentifier(value: string, fallback = "blueprint"): string {
  const normalized = value.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^[^A-Za-z_$]+/, "");
  return normalized || fallback;
}
