import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getBuiltinTemplates } from "./builtins";
import { collapseSelectionToFunction, collapseSelectionToMacro, extractCollapsedUnitToProjectGraph } from "./collapse";
import { compileGraphToProject, compileGraphsToProject } from "./compilerCore";
import type { BlueprintGraph } from "./blueprint";

let lastTempDir: string | undefined;

afterEach(async () => {
  if (lastTempDir) {
    await fs.rm(lastTempDir, { recursive: true, force: true });
    lastTempDir = undefined;
  }
});

describe("compileGraphToProject", () => {
  it("expands embedded macros created by collapse selection", async () => {
    const collapsed = collapseSelectionToMacro(collapsibleLogGraph(), new Set(["log1"]), "Trace Log");
    expect(collapsed.ok).toBe(true);
    if (!collapsed.ok) {
      return;
    }

    lastTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-collapse-"));
    const result = await compileGraphToProject(collapsed.graph, getBuiltinTemplates(), { fsPath: lastTempDir });

    expect(result.ok).toBe(true);
    const generated = await fs.readFile(path.join(lastTempDir, "Test.ts"), "utf8");
    expect(generated).toContain("// Macro macro-trace-log: Trace Log");
    expect(generated).toContain('console.log("Hello Blueprint");');
    const macroCallStarted = generated.indexOf('await traceBlueprintNode("test", "macro-trace-log", "Trace Log"');
    const macroInternalLog = generated.indexOf('await traceBlueprintNode("trace-log", "log1", "Log"');
    const macroCallCompleted = generated.indexOf('traceBlueprintNodeComplete("test", "macro-trace-log", "Trace Log")');
    expect(macroCallStarted).toBeGreaterThanOrEqual(0);
    expect(macroInternalLog).toBeGreaterThan(macroCallStarted);
    expect(macroCallCompleted).toBeGreaterThan(macroInternalLog);
  });

  it("passes collapsed macro inputs into the embedded macro entry outputs", async () => {
    const collapsed = collapseSelectionToMacro(graphWithExternalDataInput(), new Set(["log1"]), "Trace Log", getBuiltinTemplates());
    expect(collapsed.ok).toBe(true);
    if (!collapsed.ok) {
      return;
    }

    lastTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-collapse-input-"));
    const result = await compileGraphToProject(collapsed.graph, getBuiltinTemplates(), { fsPath: lastTempDir });

    expect(result.ok).toBe(true);
    const generated = await fs.readFile(path.join(lastTempDir, "Test.ts"), "utf8");
    expect(generated).toContain("// Macro macro-trace-log: Trace Log");
    expect(generated).toContain('String("Hello") + String("Blueprint")');
  });

  it("emits collapsed macro outputs from embedded source nodes", async () => {
    const collapsed = collapseSelectionToMacro(graphWithExternalDataOutput(), new Set(["log1", "text"]), "Trace Log", getBuiltinTemplates());
    expect(collapsed.ok).toBe(true);
    if (!collapsed.ok) {
      return;
    }

    lastTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-collapse-output-"));
    const result = await compileGraphToProject(collapsed.graph, getBuiltinTemplates(), { fsPath: lastTempDir });

    expect(result.ok).toBe(true);
    const generated = await fs.readFile(path.join(lastTempDir, "Test.ts"), "utf8");
    expect(generated).toContain('blackboard.set("message", String("Hello") + String("Blueprint"));');
  });

  it("emits extracted project-file macro outputs from stored graph metadata", async () => {
    const collapsed = collapseSelectionToMacro(graphWithExternalDataOutput(), new Set(["log1", "text"]), "Trace Log", getBuiltinTemplates());
    expect(collapsed.ok).toBe(true);
    if (!collapsed.ok) {
      return;
    }
    const extracted = extractCollapsedUnitToProjectGraph(collapsed.graph, collapsed.macroTemplate.id, "graphs/trace-log.bpgraph");
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) {
      return;
    }

    lastTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-project-macro-output-"));
    const result = await compileGraphsToProject(
      [extracted.graph, extracted.projectGraph],
      [...getBuiltinTemplates(), extracted.projectTemplate],
      { fsPath: lastTempDir }
    );

    expect(result.ok).toBe(true);
    const generated = await fs.readFile(path.join(lastTempDir, "Test.ts"), "utf8");
    expect(generated).toContain('blackboard.set("message", String("Hello") + String("Blueprint"));');
  });

  it("emits collapsed function calls as embedded graph imports", async () => {
    const collapsed = collapseSelectionToFunction(collapsibleLogGraph(), new Set(["log1"]), "Trace Log");
    expect(collapsed.ok).toBe(true);
    if (!collapsed.ok) {
      return;
    }

    lastTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-collapse-function-"));
    const result = await compileGraphToProject(collapsed.graph, getBuiltinTemplates(), { fsPath: lastTempDir });

    expect(result.ok).toBe(true);
    const parent = await fs.readFile(path.join(lastTempDir, "Test.ts"), "utf8");
    const extracted = await fs.readFile(path.join(lastTempDir, "Trace_Log.ts"), "utf8");
    expect(parent).toContain('import { Trace_Log as Trace_Log_0 } from "./Trace_Log";');
    expect(parent).toContain("await Trace_Log_0(blackboard);");
    expect(extracted).toContain('console.log("Hello Blueprint");');
  });

  it("stores collapsed function return values before downstream data reads", async () => {
    const collapsed = collapseSelectionToFunction(graphWithExternalDataOutput(), new Set(["log1", "text"]), "Trace Log", getBuiltinTemplates());
    expect(collapsed.ok).toBe(true);
    if (!collapsed.ok) {
      return;
    }

    lastTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-collapse-function-output-"));
    const result = await compileGraphToProject(collapsed.graph, getBuiltinTemplates(), { fsPath: lastTempDir });

    expect(result.ok).toBe(true);
    const parent = await fs.readFile(path.join(lastTempDir, "Test.ts"), "utf8");
    const extracted = await fs.readFile(path.join(lastTempDir, "Trace_Log.ts"), "utf8");
    expect(parent).toContain("const __function_trace_log_result = await Trace_Log_0(blackboard);");
    expect(parent).toContain('blackboard.set("message", __function_trace_log_result);');
    expect(extracted).toContain('return String(String("Hello") + String("Blueprint"));');
  });

  it("bypasses disabled control nodes during compilation", async () => {
    const graph: BlueprintGraph = {
      ...collapsibleLogGraph(),
      nodes: collapsibleLogGraph().nodes.map((node) => node.id === "log1"
        ? { ...node, displayOverrides: { disabled: true } }
        : node)
    };

    lastTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-disabled-node-"));
    const result = await compileGraphToProject(graph, getBuiltinTemplates(), { fsPath: lastTempDir });

    expect(result.ok).toBe(true);
    const generated = await fs.readFile(path.join(lastTempDir, "Test.ts"), "utf8");
    expect(generated).toContain("// Node log1: Log (disabled)");
    expect(generated).toContain('await traceBlueprintSkipped("test", "log1", "Log");');
    expect(generated).not.toContain('console.log("Hello Blueprint");');
    expect(generated).toContain("// Node end: Function End");
  });
});

function collapsibleLogGraph(): BlueprintGraph {
  return {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: "test",
    name: "Test",
    description: "Test graph.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [],
      outputs: []
    },
    nodes: [
      { id: "entry", templateId: "builtin.control.entry", position: { x: 80, y: 120 }, inputBindings: {} },
      {
        id: "log1",
        templateId: "builtin.debug.log",
        position: { x: 420, y: 120 },
        inputBindings: {
          message: { portId: "message", sourceKind: "literal", literalValue: "Hello Blueprint" }
        }
      },
      { id: "end", templateId: "builtin.control.end", position: { x: 760, y: 120 }, inputBindings: {} }
    ],
    links: [
      { id: "link-entry-log", fromNodeId: "entry", fromPortId: "then", toNodeId: "log1", toPortId: "exec", flowKind: "control" },
      { id: "link-log-end", fromNodeId: "log1", fromPortId: "then", toNodeId: "end", toPortId: "exec", flowKind: "control" }
    ],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}

function graphWithExternalDataInput(): BlueprintGraph {
  const graph = collapsibleLogGraph();
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "text",
        templateId: "builtin.string.concat",
        position: { x: 240, y: 300 },
        inputBindings: {
          a: { portId: "a", sourceKind: "literal", literalValue: "Hello" },
          b: { portId: "b", sourceKind: "literal", literalValue: "Blueprint" }
        }
      }
    ],
    links: [
      ...graph.links,
      {
        id: "link-text-log",
        fromNodeId: "text",
        fromPortId: "result",
        toNodeId: "log1",
        toPortId: "message",
        flowKind: "data",
        contextVariableId: "ctx-text-log"
      }
    ]
  };
}

function graphWithExternalDataOutput(): BlueprintGraph {
  const graph = graphWithExternalDataInput();
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "set",
        templateId: "builtin.blackboard.set",
        position: { x: 900, y: 300 },
        inputBindings: {
          key: { portId: "key", sourceKind: "literal", literalValue: "message" },
          value: { portId: "value", sourceKind: "link", linkId: "link-text-set" }
        }
      }
    ],
    links: [
      ...graph.links.filter((link) => link.id !== "link-log-end"),
      {
        id: "link-log-set",
        fromNodeId: "log1",
        fromPortId: "then",
        toNodeId: "set",
        toPortId: "exec",
        flowKind: "control"
      },
      {
        id: "link-set-end",
        fromNodeId: "set",
        fromPortId: "then",
        toNodeId: "end",
        toPortId: "exec",
        flowKind: "control"
      },
      {
        id: "link-text-set",
        fromNodeId: "text",
        fromPortId: "result",
        toNodeId: "set",
        toPortId: "value",
        flowKind: "data",
        contextVariableId: "ctx-text-set"
      }
    ]
  };
}
