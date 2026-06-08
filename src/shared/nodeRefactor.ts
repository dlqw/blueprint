import type { BlueprintGraph } from "./blueprint";

export interface RenameNodeIdResult {
  ok: true;
  graph: BlueprintGraph;
  changed: boolean;
  oldNodeId: string;
  nextNodeId: string;
}

export interface RenameNodeIdFailure {
  ok: false;
  issues: string[];
}

export type RenameNodeIdOutcome = RenameNodeIdResult | RenameNodeIdFailure;

export function renameNodeIdInGraph(graph: BlueprintGraph, oldNodeId: string, nextNodeId: string): RenameNodeIdOutcome {
  const from = oldNodeId.trim();
  const to = nextNodeId.trim();
  const issues: string[] = [];

  if (!from || !to) {
    issues.push("Node ids cannot be empty.");
  }
  if (!graph.nodes.some((node) => node.id === from)) {
    issues.push(`Node '${from}' was not found.`);
  }
  if (from !== to && graph.nodes.some((node) => node.id === to)) {
    issues.push(`Node '${to}' already exists.`);
  }
  if (issues.length) {
    return { ok: false, issues };
  }
  if (from === to) {
    return { ok: true, graph, changed: false, oldNodeId: from, nextNodeId: to };
  }

  return {
    ok: true,
    changed: true,
    oldNodeId: from,
    nextNodeId: to,
    graph: {
      ...graph,
      templateMetadata: graph.templateMetadata
        ? {
            ...graph.templateMetadata,
            outputSources: renameOutputSourceNodeIds(graph.templateMetadata.outputSources, from, to)
          }
        : graph.templateMetadata,
      nodes: graph.nodes.map((node) => (node.id === from ? { ...node, id: to } : node)),
      links: graph.links.map((link) => ({
        ...link,
        fromNodeId: link.fromNodeId === from ? to : link.fromNodeId,
        toNodeId: link.toNodeId === from ? to : link.toNodeId
      })),
      comments: graph.comments?.map((comment) => ({
        ...comment,
        nodeIds: comment.nodeIds.map((nodeId) => (nodeId === from ? to : nodeId))
      })),
      bookmarks: graph.bookmarks?.map((bookmark) => (bookmark.nodeId === from ? { ...bookmark, nodeId: to } : bookmark)),
      debug: graph.debug
        ? {
            ...graph.debug,
            breakpoints: graph.debug.breakpoints?.map((breakpoint) => (breakpoint.nodeId === from ? { ...breakpoint, nodeId: to } : breakpoint))
          }
        : graph.debug
    }
  };
}

function renameOutputSourceNodeIds(
  outputSources: Record<string, { nodeId: string; portId: string }> | undefined,
  oldNodeId: string,
  nextNodeId: string
): Record<string, { nodeId: string; portId: string }> | undefined {
  if (!outputSources) {
    return outputSources;
  }
  return Object.fromEntries(
    Object.entries(outputSources).map(([portId, source]) => [
      portId,
      {
        ...source,
        nodeId: source.nodeId === oldNodeId ? nextNodeId : source.nodeId
      }
    ])
  );
}
