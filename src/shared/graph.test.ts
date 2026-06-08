import { describe, expect, it } from "vitest";
import { getBuiltinTemplates } from "./builtins";
import { BlueprintGraph } from "./blueprint";
import { createDefaultGraph, validateGraph } from "./graph";

describe("validateGraph graph-level checks", () => {
  it("reports duplicate node ids and missing function boundaries", () => {
    const graph: BlueprintGraph = {
      ...createDefaultGraph("Invalid"),
      nodes: [
        { id: "same", templateId: "builtin.debug.log", position: { x: 0, y: 0 }, inputBindings: {} },
        { id: "same", templateId: "builtin.debug.log", position: { x: 240, y: 0 }, inputBindings: {} }
      ],
      links: []
    };

    const messages = validateGraph(graph, getBuiltinTemplates()).map((issue) => issue.message);
    expect(messages).toContain("Duplicate node id 'same'.");
    expect(messages).toContain("Function graph requires a Function Entry node.");
    expect(messages).toContain("Function graph requires a Function End node.");
  });

  it("reports multiple data links into one input", () => {
    const graph: BlueprintGraph = {
      ...createDefaultGraph("Multiple Data Inputs"),
      nodes: [
        {
          id: "a",
          templateId: "builtin.string.concat",
          position: { x: 0, y: 0 },
          inputBindings: {
            a: { portId: "a", sourceKind: "literal", literalValue: "A" },
            b: { portId: "b", sourceKind: "literal", literalValue: "B" }
          }
        },
        {
          id: "b",
          templateId: "builtin.string.concat",
          position: { x: 0, y: 160 },
          inputBindings: {
            a: { portId: "a", sourceKind: "literal", literalValue: "C" },
            b: { portId: "b", sourceKind: "literal", literalValue: "D" }
          }
        },
        {
          id: "log",
          templateId: "builtin.debug.log",
          position: { x: 420, y: 0 },
          inputBindings: {
            message: { portId: "message", sourceKind: "link", linkId: "link-a-log" }
          }
        },
        ...createDefaultGraph("Multiple Data Inputs").nodes
      ],
      links: [
        {
          id: "link-a-log",
          fromNodeId: "a",
          fromPortId: "result",
          toNodeId: "log",
          toPortId: "message",
          flowKind: "data",
          contextVariableId: "ctx-a"
        },
        {
          id: "link-b-log",
          fromNodeId: "b",
          fromPortId: "result",
          toNodeId: "log",
          toPortId: "message",
          flowKind: "data",
          contextVariableId: "ctx-b"
        }
      ]
    };

    expect(validateGraph(graph, getBuiltinTemplates()).some((issue) => issue.message === "Input 'log.message' has multiple incoming links.")).toBe(true);
  });

  it("reports stale bindings, duplicate link ids, multiple entries, and self graph calls", () => {
    const graph: BlueprintGraph = {
      ...createDefaultGraph("Self Graph"),
      id: "self-graph",
      name: "Self Graph",
      nodes: [
        ...createDefaultGraph("Self Graph").nodes,
        {
          id: "entry2",
          templateId: "builtin.control.entry",
          position: { x: 0, y: 200 },
          inputBindings: {}
        },
        {
          id: "log",
          templateId: "builtin.debug.log",
          position: { x: 320, y: 0 },
          inputBindings: {
            message: { portId: "message", sourceKind: "link", linkId: "missing-link" },
            ghost: { portId: "ghost", sourceKind: "literal", literalValue: "stale" }
          }
        },
        {
          id: "self",
          templateId: "graph.self-graph",
          position: { x: 640, y: 0 },
          inputBindings: {}
        }
      ],
      links: [
        {
          id: "dup",
          fromNodeId: "entry",
          fromPortId: "then",
          toNodeId: "end",
          toPortId: "exec",
          flowKind: "control"
        },
        {
          id: "dup",
          fromNodeId: "entry2",
          fromPortId: "then",
          toNodeId: "log",
          toPortId: "exec",
          flowKind: "control"
        }
      ]
    };

    const messages = validateGraph(graph, [...getBuiltinTemplates(), selfGraphTemplate()]).map((issue) => issue.message);
    expect(messages).toContain("Duplicate link id 'dup'.");
    expect(messages).toContain("Function graph can only have one Function Entry node.");
    expect(messages).toContain("Input binding 'ghost' does not match an input port.");
    expect(messages).toContain("Link binding for 'log.message' references missing link 'missing-link'.");
    expect(messages).toContain("Graph cannot contain a node that calls itself.");
  });

  it("warns when comments or bookmarks reference missing nodes", () => {
    const graph: BlueprintGraph = {
      ...createDefaultGraph("Stale Navigation"),
      comments: [
        {
          id: "comment-stale",
          title: "Old Group",
          position: { x: 0, y: 0 },
          size: { width: 240, height: 160 },
          nodeIds: ["entry", "missing-node"]
        },
        {
          id: "comment-stale",
          title: "Duplicate Group",
          position: { x: 20, y: 20 },
          size: { width: 180, height: 120 },
          nodeIds: ["entry"]
        }
      ],
      bookmarks: [
        {
          id: "bookmark-stale",
          label: "Old Target",
          position: { x: 0, y: 0 },
          nodeId: "missing-bookmark-node"
        },
        {
          id: "bookmark-stale",
          label: "Duplicate Target",
          position: { x: 20, y: 20 }
        }
      ]
    };

    const issues = validateGraph(graph, getBuiltinTemplates());
    expect(issues).toContainEqual({
      severity: "error",
      message: "Duplicate comment id 'comment-stale'."
    });
    expect(issues).toContainEqual({
      severity: "error",
      message: "Duplicate bookmark id 'bookmark-stale'."
    });
    expect(issues).toContainEqual({
      severity: "warning",
      message: "Comment 'Old Group' references missing node 'missing-node'."
    });
    expect(issues).toContainEqual({
      severity: "warning",
      message: "Bookmark 'Old Target' references missing node 'missing-bookmark-node'."
    });
  });

  it("reports duplicate and stale debug breakpoints", () => {
    const graph: BlueprintGraph = {
      ...createDefaultGraph("Stale Debug"),
      debug: {
        breakpoints: [
          { nodeId: "entry" },
          { nodeId: "entry", condition: "hit >= 2" },
          { nodeId: "missing-breakpoint-node" }
        ]
      }
    };

    const issues = validateGraph(graph, getBuiltinTemplates());
    expect(issues).toContainEqual({
      severity: "error",
      message: "Duplicate breakpoint for node 'entry'.",
      nodeId: "entry"
    });
    expect(issues).toContainEqual({
      severity: "warning",
      message: "Breakpoint references missing node 'missing-breakpoint-node'."
    });
  });

  it("reports literals outside constrained port options", () => {
    const graph: BlueprintGraph = {
      ...createDefaultGraph("Blackboard Options"),
      nodes: [
        ...createDefaultGraph("Blackboard Options").nodes,
        {
          id: "getScore",
          templateId: "builtin.blackboard.get",
          position: { x: 280, y: 160 },
          inputBindings: {
            key: { portId: "key", sourceKind: "literal", literalValue: "missing" }
          }
        }
      ]
    };

    const messages = validateGraph(graph, templatesWithBlackboardKeyOptions()).map((issue) => issue.message);
    expect(messages).toContain("Literal for 'Key' is not an allowed option.");
  });

  it("warns about pure data nodes with unused outputs", () => {
    const graph: BlueprintGraph = {
      ...createDefaultGraph("Unused Data"),
      nodes: [
        ...createDefaultGraph("Unused Data").nodes,
        {
          id: "unusedAdd",
          templateId: "builtin.math.add",
          position: { x: 260, y: 160 },
          inputBindings: {
            a: { portId: "a", sourceKind: "literal", literalValue: 1 },
            b: { portId: "b", sourceKind: "literal", literalValue: 2 }
          }
        }
      ]
    };

    expect(validateGraph(graph, getBuiltinTemplates()).some((issue) => issue.message === "Data node 'unusedAdd' has no used outputs.")).toBe(true);
  });

  it("warns when data links only feed unreachable control flow", () => {
    const graph: BlueprintGraph = {
      ...createDefaultGraph("Unreachable Data Consumer"),
      nodes: [
        ...createDefaultGraph("Unreachable Data Consumer").nodes,
        {
          id: "add",
          templateId: "builtin.math.add",
          position: { x: 260, y: 160 },
          inputBindings: {
            a: { portId: "a", sourceKind: "literal", literalValue: 1 },
            b: { portId: "b", sourceKind: "literal", literalValue: 2 }
          }
        },
        {
          id: "unreachableLog",
          templateId: "builtin.debug.log",
          position: { x: 520, y: 160 },
          inputBindings: {
            message: { portId: "message", sourceKind: "link", linkId: "link-add-log" }
          }
        }
      ],
      links: [
        ...createDefaultGraph("Unreachable Data Consumer").links,
        {
          id: "link-add-log",
          fromNodeId: "add",
          fromPortId: "result",
          toNodeId: "unreachableLog",
          toPortId: "message",
          flowKind: "data",
          contextVariableId: "ctx-add-log"
        }
      ]
    };

    const messages = validateGraph(graph, getBuiltinTemplates()).map((issue) => issue.message);
    expect(messages).toContain("Control node 'unreachableLog' is unreachable from Function Entry.");
    expect(messages).toContain("Data node 'add' is not used by reachable control flow.");
  });

  it("validates a large control-flow graph within the performance budget", () => {
    const graph = largeControlGraph(500);
    const startedAt = performance.now();
    const issues = validateGraph(graph, getBuiltinTemplates());
    const elapsed = performance.now() - startedAt;

    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(elapsed).toBeLessThan(1500);
  });
});

function selfGraphTemplate() {
  return {
    id: "graph.self-graph",
    name: "Self Graph",
    creationPath: "Blueprints",
    description: "Self graph template.",
    inputs: [],
    outputs: [],
    controlInputs: [],
    controlOutputs: [],
    bodyKind: "blueprintGraph" as const,
    bodyRef: "self-graph.bpgraph",
    metadata: { source: "self-graph.bpgraph" }
  };
}

function templatesWithBlackboardKeyOptions() {
  return getBuiltinTemplates().map((template) => {
    if (template.id !== "builtin.blackboard.get") {
      return template;
    }
    return {
      ...template,
      inputs: template.inputs.map((input) => input.id === "key" ? { ...input, constraints: { options: ["score"] } } : input)
    };
  });
}

function largeControlGraph(logCount: number): BlueprintGraph {
  const graph = createDefaultGraph("Large Validation");
  const nodes: BlueprintGraph["nodes"] = [
    {
      id: "entry",
      templateId: "builtin.control.entry",
      position: { x: 0, y: 0 },
      inputBindings: {}
    }
  ];
  for (let index = 0; index < logCount; index += 1) {
    nodes.push({
      id: `log-${index}`,
      templateId: "builtin.debug.log",
      position: { x: 260 + index * 260, y: 0 },
      inputBindings: {
        message: { portId: "message", sourceKind: "literal", literalValue: `message ${index}` }
      }
    });
  }
  nodes.push({
    id: "end",
    templateId: "builtin.control.end",
    position: { x: 260 + logCount * 260, y: 0 },
    inputBindings: {}
  });

  return {
    ...graph,
    nodes,
    links: nodes.slice(0, -1).map((node, index) => ({
      id: `link-${index}`,
      fromNodeId: node.id,
      fromPortId: node.id === "entry" ? "then" : "then",
      toNodeId: nodes[index + 1].id,
      toPortId: "exec",
      flowKind: "control" as const
    }))
  };
}
