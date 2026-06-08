import { describe, expect, it } from "vitest";
import type { BlueprintGraph } from "./blueprint";
import { renameNodeIdInGraph } from "./nodeRefactor";

describe("renameNodeIdInGraph", () => {
  it("renames node ids and every graph-owned node reference", () => {
    const result = renameNodeIdInGraph(refactorGraph(), "log", "trace-log");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.changed).toBe(true);
    expect(result.graph.nodes.map((node) => node.id)).toEqual(["entry", "trace-log", "end"]);
    expect(result.graph.links).toEqual([
      expect.objectContaining({ fromNodeId: "entry", toNodeId: "trace-log" }),
      expect.objectContaining({ fromNodeId: "trace-log", toNodeId: "end" })
    ]);
    expect(result.graph.comments?.[0].nodeIds).toEqual(["entry", "trace-log"]);
    expect(result.graph.bookmarks?.find((bookmark) => bookmark.id === "log-view")?.nodeId).toBe("trace-log");
    expect(result.graph.debug?.breakpoints).toEqual([{ nodeId: "trace-log", condition: "hit >= 2" }]);
    expect(result.graph.templateMetadata?.outputSources).toEqual({
      message: { nodeId: "trace-log", portId: "then" }
    });
  });

  it("rejects missing or colliding node ids", () => {
    expect(renameNodeIdInGraph(refactorGraph(), "missing", "next")).toEqual({
      ok: false,
      issues: ["Node 'missing' was not found."]
    });
    expect(renameNodeIdInGraph(refactorGraph(), "log", "entry")).toEqual({
      ok: false,
      issues: ["Node 'entry' already exists."]
    });
  });
});

function refactorGraph(): BlueprintGraph {
  return {
    format: "blueprint-graph",
    version: 1,
    kind: "macro",
    id: "refactor",
    name: "Refactor",
    description: "Node refactor test.",
    templateMetadata: {
      creationPath: "Macros",
      inputs: [],
      outputs: [],
      outputSources: {
        message: { nodeId: "log", portId: "then" }
      }
    },
    nodes: [
      { id: "entry", templateId: "builtin.control.entry", position: { x: 0, y: 0 }, inputBindings: {} },
      { id: "log", templateId: "builtin.debug.log", position: { x: 240, y: 0 }, inputBindings: {} },
      { id: "end", templateId: "builtin.control.end", position: { x: 480, y: 0 }, inputBindings: {} }
    ],
    links: [
      { id: "entry-log", fromNodeId: "entry", fromPortId: "then", toNodeId: "log", toPortId: "exec", flowKind: "control" },
      { id: "log-end", fromNodeId: "log", fromPortId: "then", toNodeId: "end", toPortId: "exec", flowKind: "control" }
    ],
    comments: [{ id: "comment", title: "Flow", position: { x: 0, y: 0 }, size: { width: 300, height: 120 }, nodeIds: ["entry", "log"] }],
    bookmarks: [{ id: "log-view", label: "Log", position: { x: 240, y: 0 }, nodeId: "log" }],
    debug: {
      breakpoints: [{ nodeId: "log", condition: "hit >= 2" }]
    },
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}
