import { BlueprintGraph, createPort } from "../shared/blueprint";
import { createDefaultGraph, toStableId } from "../shared/graph";

export interface WorkflowTemplateDefinition {
  id: string;
  name: string;
  description: string;
  defaultGraphName: string;
  category: string;
  tags: string[];
  preview: WorkflowTemplatePreview;
}

export interface WorkflowTemplatePreview {
  nodeCount: number;
  linkCount: number;
  inputCount: number;
  outputCount: number;
  commentCount: number;
}

const workflowTemplates: WorkflowTemplateDefinition[] = [
  {
    id: "empty-function",
    name: "Empty Function",
    description: "Function Entry wired directly to Function End.",
    defaultGraphName: "New Function",
    category: "Foundation",
    tags: ["function", "starter"],
    preview: { nodeCount: 2, linkCount: 1, inputCount: 0, outputCount: 0, commentCount: 0 }
  },
  {
    id: "log-message",
    name: "Log Message",
    description: "Entry, one runtime log call, then end.",
    defaultGraphName: "Log Message",
    category: "Debug",
    tags: ["runtime", "log"],
    preview: { nodeCount: 3, linkCount: 2, inputCount: 0, outputCount: 0, commentCount: 1 }
  },
  {
    id: "boolean-branch",
    name: "Boolean Branch",
    description: "Boolean input routed through true and false log paths.",
    defaultGraphName: "Boolean Branch",
    category: "Control",
    tags: ["branch", "input"],
    preview: { nodeCount: 5, linkCount: 6, inputCount: 1, outputCount: 0, commentCount: 1 }
  },
  {
    id: "blackboard-write",
    name: "Blackboard Write",
    description: "Stores an initial value in a project blackboard key.",
    defaultGraphName: "Set Blackboard Value",
    category: "Data",
    tags: ["blackboard", "state"],
    preview: { nodeCount: 3, linkCount: 2, inputCount: 0, outputCount: 0, commentCount: 1 }
  }
];

export function getWorkflowTemplates(): WorkflowTemplateDefinition[] {
  return workflowTemplates;
}

export function createWorkflowGraph(templateId: string, graphName: string): BlueprintGraph {
  switch (templateId) {
    case "empty-function":
      return withGraphIdentity(createDefaultGraph(graphName), graphName, "Workflow template: empty function.");
    case "log-message":
      return createLogMessageGraph(graphName);
    case "boolean-branch":
      return createBooleanBranchGraph(graphName);
    case "blackboard-write":
      return createBlackboardWriteGraph(graphName);
    default:
      throw new Error(`Unknown workflow template '${templateId}'.`);
  }
}

function createLogMessageGraph(graphName: string): BlueprintGraph {
  return withGraphIdentity({
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: toStableId(graphName),
    name: graphName,
    description: "Workflow template: log a runtime message.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [],
      outputs: []
    },
    nodes: [
      node("entry", "builtin.control.entry", 80, 120, {}),
      node("log", "builtin.debug.log", 320, 120, {
        message: literal("message", `Hello from ${graphName}`)
      }),
      node("end", "builtin.control.end", 580, 120, {})
    ],
    links: [
      controlLink("link-entry-log", "entry", "then", "log", "exec"),
      controlLink("link-log-end", "log", "then", "end", "exec")
    ],
    comments: [
      {
        id: "comment-runtime-path",
        title: "Runtime path",
        position: { x: 48, y: 72 },
        size: { width: 596, height: 150 },
        nodeIds: ["entry", "log", "end"],
        color: "#2a6f97"
      }
    ],
    bookmarks: [{ id: "bookmark-entry", label: "Start", position: { x: 80, y: 120 }, nodeId: "entry" }],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  }, graphName, "Workflow template: log a runtime message.");
}

function createBooleanBranchGraph(graphName: string): BlueprintGraph {
  return withGraphIdentity({
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: toStableId(graphName),
    name: graphName,
    description: "Workflow template: route a boolean input through true and false branches.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [createPort("enabled", "Enabled", "output", "data", "boolean", "Branch condition.", "none", true)],
      outputs: []
    },
    nodes: [
      node("entry", "builtin.control.entry", 80, 160, {}),
      node("branch", "builtin.control.branch", 310, 160, {
        condition: linkBinding("condition", "link-entry-enabled-branch")
      }),
      node("log-true", "builtin.debug.log", 570, 90, {
        message: literal("message", "Enabled path")
      }),
      node("log-false", "builtin.debug.log", 570, 230, {
        message: literal("message", "Disabled path")
      }),
      node("end", "builtin.control.end", 840, 160, {})
    ],
    links: [
      controlLink("link-entry-branch", "entry", "then", "branch", "exec"),
      dataLink("link-entry-enabled-branch", "entry", "enabled", "branch", "condition", "enabled"),
      controlLink("link-branch-true", "branch", "true", "log-true", "exec"),
      controlLink("link-branch-false", "branch", "false", "log-false", "exec"),
      controlLink("link-true-end", "log-true", "then", "end", "exec"),
      controlLink("link-false-end", "log-false", "then", "end", "exec")
    ],
    comments: [
      {
        id: "comment-branch",
        title: "Branch example",
        position: { x: 48, y: 54 },
        size: { width: 858, height: 310 },
        nodeIds: ["entry", "branch", "log-true", "log-false", "end"],
        color: "#6a994e"
      }
    ],
    bookmarks: [{ id: "bookmark-branch", label: "Decision", position: { x: 310, y: 160 }, nodeId: "branch" }],
    layout: {
      viewport: { x: 0, y: 0, zoom: 0.92 }
    }
  }, graphName, "Workflow template: route a boolean input through true and false branches.");
}

function createBlackboardWriteGraph(graphName: string): BlueprintGraph {
  return withGraphIdentity({
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: toStableId(graphName),
    name: graphName,
    description: "Workflow template: store an initial project blackboard value.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [],
      outputs: []
    },
    nodes: [
      node("entry", "builtin.control.entry", 80, 120, {}),
      node("set-score", "builtin.blackboard.set", 340, 120, {
        key: literal("key", "score"),
        value: literal("value", 0)
      }),
      node("end", "builtin.control.end", 620, 120, {})
    ],
    links: [
      controlLink("link-entry-set-score", "entry", "then", "set-score", "exec"),
      controlLink("link-set-score-end", "set-score", "then", "end", "exec")
    ],
    comments: [
      {
        id: "comment-blackboard",
        title: "Project state",
        position: { x: 48, y: 72 },
        size: { width: 636, height: 150 },
        nodeIds: ["entry", "set-score", "end"],
        color: "#8e6c8a"
      }
    ],
    bookmarks: [{ id: "bookmark-state", label: "State write", position: { x: 340, y: 120 }, nodeId: "set-score" }],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  }, graphName, "Workflow template: store an initial project blackboard value.");
}

function withGraphIdentity(graph: BlueprintGraph, graphName: string, description: string): BlueprintGraph {
  return {
    ...graph,
    id: toStableId(graphName),
    name: graphName,
    description
  };
}

function node(
  id: string,
  templateId: string,
  x: number,
  y: number,
  inputBindings: BlueprintGraph["nodes"][number]["inputBindings"]
): BlueprintGraph["nodes"][number] {
  return {
    id,
    templateId,
    position: { x, y },
    inputBindings
  };
}

function literal(portId: string, literalValue: unknown): BlueprintGraph["nodes"][number]["inputBindings"][string] {
  return { portId, sourceKind: "literal", literalValue };
}

function linkBinding(portId: string, linkId: string): BlueprintGraph["nodes"][number]["inputBindings"][string] {
  return { portId, sourceKind: "link", linkId };
}

function controlLink(
  id: string,
  fromNodeId: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string
): BlueprintGraph["links"][number] {
  return {
    id,
    fromNodeId,
    fromPortId,
    toNodeId,
    toPortId,
    flowKind: "control"
  };
}

function dataLink(
  id: string,
  fromNodeId: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string,
  contextVariableId: string
): BlueprintGraph["links"][number] {
  return {
    id,
    fromNodeId,
    fromPortId,
    toNodeId,
    toPortId,
    flowKind: "data",
    contextVariableId
  };
}
