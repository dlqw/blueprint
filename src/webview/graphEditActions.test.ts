import { describe, expect, it } from "vitest";
import { BlueprintGraph } from "../shared/blueprint";
import {
  alignGraphNodes,
  cleanupRoutingHubs,
  copyGraphSelection,
  createGraphBookmark,
  createGraphCommentBox,
  deleteGraphBookmark,
  deleteGraphNodes,
  deleteGraphSelection,
  duplicateGraphNodes,
  distributeGraphNodes,
  insertRoutingHubsForLinks,
  linkIdsForPort,
  pasteGraphClipboard,
  removeLinks,
  renameGraphBookmark,
  replaceGraphComment,
  updateGraphCommentColor,
  updateGraphCommentSize,
  updateGraphCommentTitle
} from "./graphEditActions";

describe("graph edit actions", () => {
  it("finds and removes links for a port without leaving stale input bindings", () => {
    const graph = editGraph();

    const linkIds = linkIdsForPort(graph, "entry", { id: "then", direction: "output" });
    expect([...linkIds]).toEqual(["entry-log"]);

    const next = removeLinks(graph, linkIds);
    expect(next.links.map((link) => link.id)).toEqual(["log-end"]);
    expect(next.nodes.find((node) => node.id === "log")?.inputBindings.message).toEqual({
      portId: "message",
      sourceKind: "literal",
      literalValue: "hello"
    });
    expect(next.nodes.find((node) => node.id === "log")?.inputBindings.exec).toBeUndefined();
  });

  it("deletes nodes and cleans references owned by graph metadata", () => {
    const result = deleteGraphNodes(editGraph(), new Set(["log"]));

    expect(result.graph.nodes.map((node) => node.id)).toEqual(["entry", "end"]);
    expect(result.graph.links).toEqual([]);
    expect(result.graph.comments).toEqual([{ id: "comment", title: "Flow", position: { x: 40, y: 40 }, size: { width: 400, height: 160 }, nodeIds: ["entry"] }]);
    expect(result.graph.bookmarks).toEqual([{ id: "entry-view", label: "Entry", position: { x: 0, y: 0 }, nodeId: "entry" }]);
    expect(result.graph.debug?.breakpoints).toEqual([{ nodeId: "entry" }]);
    expect([...result.nextSelectedNodeIds]).toEqual(["entry"]);
  });

  it("deletes mixed graph selections in a single pure operation", () => {
    const result = deleteGraphSelection(editGraph(), {
      nodeIds: new Set(["entry"]),
      linkIds: new Set(["log-end"]),
      commentIds: new Set(["comment"])
    });

    expect(result.graph.nodes.map((node) => node.id)).toEqual(["log", "end"]);
    expect(result.graph.links).toEqual([]);
    expect(result.graph.comments).toEqual([]);
    expect(result.graph.bookmarks).toEqual([{ id: "log-view", label: "Log", position: { x: 120, y: 0 }, nodeId: "log" }]);
    expect(result.graph.debug?.breakpoints).toEqual([{ nodeId: "log", enabled: false }]);
    expect([...result.nextSelectedNodeIds]).toEqual(["log"]);
  });

  it("copies and pastes selected nodes with internal links and grouped comments", () => {
    const graph = editGraph();
    const clipboard = copyGraphSelection(graph, new Set(["entry", "log"]));
    expect(clipboard?.nodes.map((node) => node.id)).toEqual(["entry", "log"]);
    expect(clipboard?.links.map((link) => link.id)).toEqual(["entry-log"]);
    expect(clipboard?.comments.map((comment) => comment.id)).toEqual(["comment"]);

    const pasted = pasteGraphClipboard(graph, clipboard!, "fixed");
    expect(pasted.graph.nodes.map((node) => node.id)).toContain("entry-copy-fixed-0");
    expect(pasted.graph.nodes.map((node) => node.id)).toContain("log-copy-fixed-1");
    expect(pasted.graph.links.at(-1)).toEqual({
      id: "entry-log-copy-fixed-0",
      fromNodeId: "entry-copy-fixed-0",
      fromPortId: "then",
      toNodeId: "log-copy-fixed-1",
      toPortId: "exec",
      flowKind: "control"
    });
    expect(pasted.graph.nodes.find((node) => node.id === "log-copy-fixed-1")?.inputBindings.exec).toEqual({
      portId: "exec",
      sourceKind: "link",
      linkId: "entry-log-copy-fixed-0"
    });
    expect(pasted.graph.comments?.at(-1)).toMatchObject({
      id: "comment-copy-fixed-0",
      position: { x: 80, y: 80 },
      nodeIds: ["entry-copy-fixed-0", "log-copy-fixed-1"]
    });
    expect([...pasted.nextSelectedNodeIds]).toEqual(["entry-copy-fixed-0", "log-copy-fixed-1"]);
  });

  it("duplicates node selections through the same clipboard transform", () => {
    const duplicated = duplicateGraphNodes(editGraph(), new Set(["log", "end"]), "dupe");

    expect(duplicated?.graph.nodes.map((node) => node.id)).toContain("log-copy-dupe-0");
    expect(duplicated?.graph.nodes.map((node) => node.id)).toContain("end-copy-dupe-1");
    expect(duplicated?.graph.links.at(-1)).toMatchObject({
      id: "log-end-copy-dupe-0",
      fromNodeId: "log-copy-dupe-0",
      toNodeId: "end-copy-dupe-1"
    });
    expect(duplicated?.graph.comments?.map((comment) => comment.id)).toEqual(["comment"]);
    expect([...duplicated!.nextSelectedNodeIds]).toEqual(["log-copy-dupe-0", "end-copy-dupe-1"]);
  });

  it("creates and updates comments with bounded sizes", () => {
    const created = createGraphCommentBox(editGraph(), { x: 100, y: 120, width: 80, height: 40 }, ["entry"], "new");

    expect(created.comment).toEqual({
      id: "comment-new",
      title: "Selection",
      position: { x: 64, y: 62 },
      size: { width: 260, height: 160 },
      nodeIds: ["entry"],
      color: "#d9a441"
    });

    const titled = updateGraphCommentTitle(created.graph, "comment-new", "Renamed");
    const sized = updateGraphCommentSize(titled, created.comment, { width: Number.NaN, height: 9000 });
    const colored = updateGraphCommentColor(sized, "comment-new", "#48b9c7");
    const comment = colored.comments?.find((candidate) => candidate.id === "comment-new");

    expect(comment?.title).toBe("Renamed");
    expect(comment?.size).toEqual({ width: 260, height: 1800 });
    expect(comment?.color).toBe("#48b9c7");
  });

  it("replaces comments and manages bookmarks through pure graph edits", () => {
    const graph = editGraph();
    const replaced = replaceGraphComment(graph, {
      id: "comment",
      title: "Wrapped",
      position: { x: 8, y: 9 },
      size: { width: 200, height: 100 },
      nodeIds: ["end"],
      color: "#111111"
    });
    expect(replaced.comments?.[0]).toMatchObject({ title: "Wrapped", nodeIds: ["end"] });

    const createdBookmark = createGraphBookmark(replaced, "Log Center", { x: 240, y: 80 }, "log", "new");
    expect(createdBookmark.bookmark).toEqual({ id: "bookmark-new", label: "Log Center", position: { x: 240, y: 80 }, nodeId: "log" });

    const renamed = renameGraphBookmark(createdBookmark.graph, "bookmark-new", "  Bookmark Label  ");
    expect(renamed.bookmarks?.find((bookmark) => bookmark.id === "bookmark-new")?.label).toBe("Bookmark Label");

    const deleted = deleteGraphBookmark(renamed, "bookmark-new");
    expect(deleted.bookmarks?.some((bookmark) => bookmark.id === "bookmark-new")).toBe(false);
  });

  it("aligns and distributes nodes using precomputed render bounds", () => {
    const graph = editGraph();
    const bounds = [
      { nodeId: "entry", x: 0, y: 20, width: 50, height: 40 },
      { nodeId: "log", x: 300, y: 80, width: 100, height: 80 },
      { nodeId: "end", x: 600, y: 40, width: 50, height: 40 }
    ];

    const aligned = alignGraphNodes(graph, bounds.slice(0, 2), "right");
    expect(aligned?.nodes.find((node) => node.id === "entry")?.position.x).toBe(350);
    expect(aligned?.nodes.find((node) => node.id === "log")?.position.x).toBe(300);

    const distributed = distributeGraphNodes(graph, bounds, "horizontal");
    expect(distributed?.nodes.find((node) => node.id === "entry")?.position).toEqual({ x: 0, y: 0 });
    expect(distributed?.nodes.find((node) => node.id === "log")?.position).toEqual({ x: 275, y: 0 });
    expect(distributed?.nodes.find((node) => node.id === "end")?.position).toEqual({ x: 600, y: 0 });
  });

  it("inserts manual routing hubs and rewires control and data links", () => {
    const graph: BlueprintGraph = {
      ...editGraph(),
      nodes: editGraph().nodes.map((node) =>
        node.id === "log"
          ? {
              ...node,
              inputBindings: {
                ...node.inputBindings,
                message: { portId: "message", sourceKind: "link", linkId: "data-link" }
              }
            }
          : node
      ),
      links: [
        ...editGraph().links,
        { id: "data-link", fromNodeId: "entry", fromPortId: "then", toNodeId: "log", toPortId: "message", flowKind: "data", contextVariableId: "ctx" }
      ]
    };
    const result = insertRoutingHubsForLinks(graph, new Set(["entry-log", "data-link"]), {
      controlHubTemplateId: "builtin.routing.controlHub",
      dataHubTemplateId: "builtin.routing.dataHub",
      hubWidth: 28,
      hubHeight: 28,
      midpointsByLinkId: new Map([
        ["entry-log", { x: 100, y: 80 }],
        ["data-link", { x: 140, y: 120 }]
      ]),
      suffixFactory: (link) => `fixed-${link.id}`
    });

    expect([...result!.insertedNodeIds]).toEqual(["manual-hub-entry-log-fixed-entry-log", "manual-hub-data-link-fixed-data-link"]);
    expect(result?.graph.nodes.find((node) => node.id === "manual-hub-entry-log-fixed-entry-log")).toMatchObject({
      templateId: "builtin.routing.controlHub",
      position: { x: 86, y: 66 },
      inputBindings: {},
      displayOverrides: { compact: true, manualRoutingHub: true }
    });
    expect(result?.graph.nodes.find((node) => node.id === "manual-hub-data-link-fixed-data-link")).toMatchObject({
      templateId: "builtin.routing.dataHub",
      position: { x: 126, y: 106 },
      inputBindings: { value: { portId: "value", sourceKind: "link", linkId: "data-link-hub-in" } }
    });
    expect(result?.graph.links.map((link) => link.id)).toEqual(["log-end", "entry-log-hub-in", "entry-log-hub-out", "data-link-hub-in", "data-link-hub-out"]);
    expect(result?.graph.links.find((link) => link.id === "data-link-hub-in")?.contextVariableId).toBe("ctx-manual-0");
    expect(result?.graph.links.find((link) => link.id === "data-link-hub-out")?.contextVariableId).toBe("ctx-manual-1");
    expect(result?.graph.nodes.find((node) => node.id === "log")?.inputBindings.message).toEqual({
      portId: "message",
      sourceKind: "link",
      linkId: "data-link-hub-out"
    });
  });

  it("cleans up selected routing hubs back into direct links", () => {
    const graph: BlueprintGraph = {
      ...editGraph(),
      nodes: editGraph().nodes.map((node) =>
        node.id === "log"
          ? {
              ...node,
              inputBindings: {
                ...node.inputBindings,
                message: { portId: "message", sourceKind: "link", linkId: "data-link" }
              }
            }
          : node
      ),
      links: [
        ...editGraph().links,
        { id: "data-link", fromNodeId: "entry", fromPortId: "then", toNodeId: "log", toPortId: "message", flowKind: "data", contextVariableId: "ctx" }
      ]
    };
    const inserted = insertRoutingHubsForLinks(graph, new Set(["data-link"]), {
      controlHubTemplateId: "builtin.routing.controlHub",
      dataHubTemplateId: "builtin.routing.dataHub",
      hubWidth: 28,
      hubHeight: 28,
      midpointsByLinkId: new Map([["data-link", { x: 140, y: 120 }]]),
      suffixFactory: () => "fixed"
    })!;

    const cleaned = cleanupRoutingHubs(inserted.graph, {
      selectedNodeIds: new Set(["manual-hub-data-link-fixed"]),
      isRoutingHubNode: (node) => node.displayOverrides?.manualRoutingHub === true,
      createDirectLink: ({ incoming, outgoing }) => ({
        id: "direct",
        fromNodeId: incoming.fromNodeId,
        fromPortId: incoming.fromPortId,
        toNodeId: outgoing.toNodeId,
        toPortId: outgoing.toPortId,
        flowKind: incoming.flowKind,
        contextVariableId: "direct-context"
      })
    });

    expect([...cleaned!.removedNodeIds]).toEqual(["manual-hub-data-link-fixed"]);
    expect([...cleaned!.selectedLinkIds]).toEqual(["data-link-hub-out"]);
    expect(cleaned?.graph.nodes.some((node) => node.id === "manual-hub-data-link-fixed")).toBe(false);
    expect(cleaned?.graph.links.find((link) => link.id === "data-link-hub-in")).toBeUndefined();
    expect(cleaned?.graph.links.find((link) => link.id === "data-link-hub-out")).toEqual({
      id: "data-link-hub-out",
      fromNodeId: "entry",
      fromPortId: "then",
      toNodeId: "log",
      toPortId: "message",
      flowKind: "data",
      contextVariableId: "ctx-manual-1"
    });
    expect(cleaned?.graph.nodes.find((node) => node.id === "log")?.inputBindings.message).toEqual({
      portId: "message",
      sourceKind: "link",
      linkId: "data-link-hub-out"
    });
  });
});

function editGraph(): BlueprintGraph {
  return {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: "edit",
    name: "Edit",
    description: "Graph edit helper test.",
    templateMetadata: {
      creationPath: "Tests",
      inputs: [],
      outputs: []
    },
    nodes: [
      { id: "entry", templateId: "builtin.control.entry", position: { x: 0, y: 0 }, inputBindings: {} },
      {
        id: "log",
        templateId: "builtin.debug.log",
        position: { x: 240, y: 0 },
        inputBindings: {
          exec: { portId: "exec", sourceKind: "link", linkId: "entry-log" },
          message: { portId: "message", sourceKind: "literal", literalValue: "hello" }
        }
      },
      {
        id: "end",
        templateId: "builtin.control.end",
        position: { x: 480, y: 0 },
        inputBindings: {
          exec: { portId: "exec", sourceKind: "link", linkId: "log-end" }
        }
      }
    ],
    links: [
      { id: "entry-log", fromNodeId: "entry", fromPortId: "then", toNodeId: "log", toPortId: "exec", flowKind: "control" },
      { id: "log-end", fromNodeId: "log", fromPortId: "then", toNodeId: "end", toPortId: "exec", flowKind: "control" }
    ],
    comments: [{ id: "comment", title: "Flow", position: { x: 40, y: 40 }, size: { width: 400, height: 160 }, nodeIds: ["entry", "log"] }],
    bookmarks: [
      { id: "entry-view", label: "Entry", position: { x: 0, y: 0 }, nodeId: "entry" },
      { id: "log-view", label: "Log", position: { x: 120, y: 0 }, nodeId: "log" }
    ],
    debug: {
      breakpoints: [
        { nodeId: "entry" },
        { nodeId: "log", enabled: false },
        { nodeId: "log", condition: "duplicate" },
        { nodeId: "" }
      ]
    },
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}
