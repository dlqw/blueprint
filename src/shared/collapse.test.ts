import { describe, expect, it } from "vitest";
import { getBuiltinTemplates } from "./builtins";
import { collapseSelectionToFunction, collapseSelectionToMacro, extractCollapsedUnitToProjectGraph } from "./collapse";
import { validateGraph } from "./graph";
import type { BlueprintGraph } from "./blueprint";

describe("collapseSelectionToMacro", () => {
  it("replaces a single-entry selection with an embedded macro node", () => {
    const graph = collapsibleLogGraph();
    const result = collapseSelectionToMacro(graph, new Set(["log1"]), "Trace Log");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.macroTemplate).toMatchObject({
      id: "macro.trace-log",
      bodyKind: "macroExpansion",
      bodyRef: "embedded:trace-log"
    });
    expect(result.macroGraph.kind).toBe("macro");
    expect(result.macroGraph.nodes.map((node) => node.id)).toEqual(["entry", "log1"]);
    expect(result.graph.localTemplates?.map((template) => template.id)).toContain("macro.trace-log");
    expect(result.graph.embeddedGraphs?.map((embedded) => embedded.id)).toContain("trace-log");
    expect(result.graph.nodes.map((node) => node.id).sort()).toEqual(["end", "entry", "macro-trace-log"]);
    expect(result.graph.links).toEqual([
      expect.objectContaining({ fromNodeId: "entry", toNodeId: "macro-trace-log", flowKind: "control" }),
      expect.objectContaining({ fromNodeId: "macro-trace-log", toNodeId: "end", flowKind: "control" })
    ]);
    expect(validateGraph(result.graph, getBuiltinTemplates()).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("turns incoming data wires into macro inputs", () => {
    const graph = graphWithExternalDataInput();
    const result = collapseSelectionToMacro(graph, new Set(["log1"]), "Trace Log", getBuiltinTemplates());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.macroTemplate.inputs).toEqual([
      expect.objectContaining({ id: "log1-message", name: "Message", type: "string" })
    ]);
    expect(result.graph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNodeId: "entry", toNodeId: "macro-trace-log", flowKind: "control" }),
      expect.objectContaining({ fromNodeId: "text", toNodeId: "macro-trace-log", toPortId: "log1-message", flowKind: "data" }),
      expect.objectContaining({ fromNodeId: "macro-trace-log", toNodeId: "end", flowKind: "control" })
    ]));
    expect(result.macroGraph.links).toEqual([
      expect.objectContaining({ fromNodeId: "entry", fromPortId: "log1-message", toNodeId: "log1", toPortId: "message", flowKind: "data" }),
      expect.objectContaining({ fromNodeId: "entry", fromPortId: "then", toNodeId: "log1", flowKind: "control" })
    ]);
    expect(result.macroGraph.nodes.find((node) => node.id === "log1")?.inputBindings.message).toEqual({
      portId: "message",
      sourceKind: "link",
      linkId: "link-entry-log1-message"
    });
    expect(validateGraph(result.graph, getBuiltinTemplates()).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("turns outgoing data wires into macro outputs", () => {
    const graph = graphWithExternalDataOutput();
    const result = collapseSelectionToMacro(graph, new Set(["log1", "text"]), "Trace Log", getBuiltinTemplates());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.macroTemplate.outputs).toEqual([
      expect.objectContaining({ id: "text-result", name: "Result", type: "string" })
    ]);
    expect(result.macroTemplate.metadata?.outputSources).toEqual({
      "text-result": { nodeId: "text", portId: "result" }
    });
    expect(result.graph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNodeId: "macro-trace-log", fromPortId: "text-result", toNodeId: "set", toPortId: "value", flowKind: "data" })
    ]));
    expect(result.graph.nodes.find((node) => node.id === "set")?.inputBindings.value).toEqual({
      portId: "value",
      sourceKind: "link",
      linkId: "link-text-set"
    });
    expect(validateGraph(result.graph, getBuiltinTemplates()).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("prepares embedded macros for project-file extraction", () => {
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

    expect(extracted.graph.localTemplates).toBeUndefined();
    expect(extracted.graph.embeddedGraphs).toBeUndefined();
    expect(extracted.graph.nodes.map((node) => node.templateId)).toContain("macro.trace-log");
    expect(extracted.projectGraph.kind).toBe("macro");
    expect(extracted.projectGraph.templateMetadata?.outputSources).toEqual({
      "text-result": { nodeId: "text", portId: "result" }
    });
    expect(extracted.projectTemplate).toMatchObject({
      id: "macro.trace-log",
      bodyKind: "macroExpansion",
      bodyRef: "graphs/trace-log.bpgraph",
      metadata: {
        source: "graphs/trace-log.bpgraph",
        outputSources: {
          "text-result": { nodeId: "text", portId: "result" }
        }
      }
    });
    expect(validateGraph(extracted.graph, [...getBuiltinTemplates(), extracted.projectTemplate]).filter((issue) => issue.severity === "error")).toEqual([]);
  });
});

describe("collapseSelectionToFunction", () => {
  it("replaces a single-entry selection with an embedded function node", () => {
    const graph = collapsibleLogGraph();
    const result = collapseSelectionToFunction(graph, new Set(["log1"]), "Trace Log");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.functionTemplate).toMatchObject({
      id: "graph.trace-log",
      bodyKind: "blueprintGraph",
      bodyRef: "embedded:trace-log"
    });
    expect(result.functionGraph.kind).toBe("function");
    expect(result.functionGraph.nodes.map((node) => node.id)).toEqual(["entry", "log1", "end"]);
    expect(result.graph.localTemplates?.map((template) => template.id)).toContain("graph.trace-log");
    expect(result.graph.embeddedGraphs?.map((embedded) => embedded.id)).toContain("trace-log");
    expect(result.graph.nodes.map((node) => node.id).sort()).toEqual(["end", "entry", "function-trace-log"]);
    expect(result.graph.links).toEqual([
      expect.objectContaining({ fromNodeId: "entry", toNodeId: "function-trace-log", flowKind: "control" }),
      expect.objectContaining({ fromNodeId: "function-trace-log", toNodeId: "end", flowKind: "control" })
    ]);
    expect(validateGraph(result.graph, getBuiltinTemplates()).filter((issue) => issue.severity === "error")).toEqual([]);
    expect(validateGraph(result.functionGraph, getBuiltinTemplates()).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("turns incoming data wires into function inputs", () => {
    const graph = graphWithExternalDataInput();
    const result = collapseSelectionToFunction(graph, new Set(["log1"]), "Trace Log", getBuiltinTemplates());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.functionTemplate.inputs).toEqual([
      expect.objectContaining({ id: "log1-message", name: "Message", type: "string" })
    ]);
    expect(result.graph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNodeId: "text", toNodeId: "function-trace-log", toPortId: "log1-message", flowKind: "data" })
    ]));
    expect(result.functionGraph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNodeId: "entry", fromPortId: "log1-message", toNodeId: "log1", toPortId: "message", flowKind: "data" }),
      expect.objectContaining({ fromNodeId: "entry", fromPortId: "then", toNodeId: "log1", flowKind: "control" }),
      expect.objectContaining({ fromNodeId: "log1", toNodeId: "end", flowKind: "control" })
    ]));
    expect(validateGraph(result.graph, getBuiltinTemplates()).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("turns outgoing data wires into function outputs returned by Function End", () => {
    const graph = graphWithExternalDataOutput();
    const result = collapseSelectionToFunction(graph, new Set(["log1", "text"]), "Trace Log", getBuiltinTemplates());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.functionTemplate.outputs).toEqual([
      expect.objectContaining({ id: "text-result", name: "Result", type: "string" })
    ]);
    expect(result.graph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNodeId: "function-trace-log", fromPortId: "text-result", toNodeId: "set", toPortId: "value", flowKind: "data" })
    ]));
    expect(result.functionGraph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromNodeId: "text", fromPortId: "result", toNodeId: "end", toPortId: "text-result", flowKind: "data" })
    ]));
    expect(result.functionGraph.nodes.find((node) => node.id === "end")?.inputBindings["text-result"]).toEqual({
      portId: "text-result",
      sourceKind: "link",
      linkId: "link-text-text-result-end"
    });
    expect(validateGraph(result.graph, getBuiltinTemplates()).filter((issue) => issue.severity === "error")).toEqual([]);
    expect(validateGraph(result.functionGraph, getBuiltinTemplates()).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("prepares embedded functions for project-file extraction", () => {
    const collapsed = collapseSelectionToFunction(collapsibleLogGraph(), new Set(["log1"]), "Trace Log", getBuiltinTemplates());
    expect(collapsed.ok).toBe(true);
    if (!collapsed.ok) {
      return;
    }

    const extracted = extractCollapsedUnitToProjectGraph(collapsed.graph, collapsed.functionTemplate.id, "graphs/trace-log.bpgraph");

    expect(extracted.ok).toBe(true);
    if (!extracted.ok) {
      return;
    }

    expect(extracted.graph.localTemplates).toBeUndefined();
    expect(extracted.graph.embeddedGraphs).toBeUndefined();
    expect(extracted.projectGraph.kind).toBe("function");
    expect(extracted.projectTemplate).toMatchObject({
      id: "graph.trace-log",
      bodyKind: "blueprintGraph",
      bodyRef: "graphs/trace-log.bpgraph",
      metadata: {
        source: "graphs/trace-log.bpgraph"
      }
    });
    expect(validateGraph(extracted.graph, [...getBuiltinTemplates(), extracted.projectTemplate]).filter((issue) => issue.severity === "error")).toEqual([]);
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
