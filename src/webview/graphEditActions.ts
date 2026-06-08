import {
  BlueprintBookmark,
  BlueprintBreakpoint,
  BlueprintCommentBox,
  BlueprintLink,
  BlueprintNodeInstance,
  BlueprintGraph,
  BlueprintPortDefinition,
  FlowKind,
  Point
} from "../shared/blueprint";

export interface GraphSelectionIds {
  nodeIds: Set<string>;
  linkIds: Set<string>;
  commentIds: Set<string>;
}

export interface GraphClipboard {
  nodes: BlueprintGraph["nodes"];
  links: BlueprintGraph["links"];
  comments: BlueprintCommentBox[];
}

export interface GraphDeletionResult {
  graph: BlueprintGraph;
  nextSelectedNodeIds: Set<string>;
}

export interface GraphClipboardMutationResult {
  graph: BlueprintGraph;
  clipboard: GraphClipboard;
  nextSelectedNodeIds: Set<string>;
}

export interface GraphCommentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphCommentCreationResult {
  graph: BlueprintGraph;
  comment: BlueprintCommentBox;
}

export interface GraphBookmarkCreationResult {
  graph: BlueprintGraph;
  bookmark: BlueprintBookmark;
}

export type GraphAlignMode = "left" | "right" | "top" | "bottom";
export type GraphDistributeMode = "horizontal" | "vertical";

export interface GraphNodeBounds {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphRoutingHubInsertionOptions {
  controlHubTemplateId: string;
  dataHubTemplateId: string;
  hubWidth: number;
  hubHeight: number;
  midpointsByLinkId: Map<string, Point>;
  suffixFactory?: (link: BlueprintLink) => string;
}

export interface GraphRoutingHubInsertionResult {
  graph: BlueprintGraph;
  insertedNodeIds: Set<string>;
}

export interface GraphRoutingHubCleanupCandidate {
  node: BlueprintNodeInstance;
  incoming: BlueprintLink;
  outgoing: BlueprintLink;
}

export interface GraphRoutingHubCleanupOptions {
  selectedNodeIds: Set<string>;
  isRoutingHubNode(node: BlueprintNodeInstance): boolean;
  createDirectLink(candidate: GraphRoutingHubCleanupCandidate): BlueprintLink | undefined;
}

export interface GraphRoutingHubCleanupResult {
  graph: BlueprintGraph;
  removedNodeIds: Set<string>;
  selectedLinkIds: Set<string>;
}

export function linkIdsForPort(graph: BlueprintGraph, nodeId: string, port: Pick<BlueprintPortDefinition, "id" | "direction">): Set<string> {
  return new Set(
    graph.links
      .filter((link) =>
        port.direction === "input"
          ? link.toNodeId === nodeId && link.toPortId === port.id
          : link.fromNodeId === nodeId && link.fromPortId === port.id
      )
      .map((link) => link.id)
  );
}

export function incidentLinkIds(graph: BlueprintGraph, nodeIds: Set<string>): Set<string> {
  return new Set(graph.links.filter((link) => nodeIds.has(link.fromNodeId) || nodeIds.has(link.toNodeId)).map((link) => link.id));
}

export function removeLinks(graph: BlueprintGraph, linkIds: Set<string>): BlueprintGraph {
  if (!linkIds.size) {
    return graph;
  }
  const links = graph.links.filter((link) => !linkIds.has(link.id));
  const nodes = graph.nodes.map((node) => ({
    ...node,
    inputBindings: Object.fromEntries(
      Object.entries(node.inputBindings).filter(([, binding]) => binding.sourceKind !== "link" || !binding.linkId || !linkIds.has(binding.linkId))
    )
  }));
  return { ...graph, nodes, links };
}

export function removeComments(graph: BlueprintGraph, commentIds: Set<string>): BlueprintGraph {
  if (!commentIds.size) {
    return graph;
  }
  return {
    ...graph,
    comments: graphComments(graph).filter((comment) => !commentIds.has(comment.id))
  };
}

export function removeNodes(graph: BlueprintGraph, nodeIds: Set<string>): BlueprintGraph {
  if (!nodeIds.size) {
    return graph;
  }
  const graphWithoutLinks = removeLinks(graph, incidentLinkIds(graph, nodeIds));
  const comments = graphComments(graphWithoutLinks).map((comment) => ({
    ...comment,
    nodeIds: comment.nodeIds.filter((nodeId) => !nodeIds.has(nodeId))
  }));
  const bookmarks = graphBookmarks(graphWithoutLinks).filter((bookmark) => !bookmark.nodeId || !nodeIds.has(bookmark.nodeId));
  const breakpoints = normalizeBreakpoints(graphWithoutLinks.debug?.breakpoints ?? []).filter((breakpoint) => !nodeIds.has(breakpoint.nodeId));
  return {
    ...graphWithoutLinks,
    nodes: graphWithoutLinks.nodes.filter((node) => !nodeIds.has(node.id)),
    comments,
    bookmarks,
    debug: graphWithoutLinks.debug ? { ...graphWithoutLinks.debug, breakpoints } : graphWithoutLinks.debug
  };
}

export function deleteGraphNodes(graph: BlueprintGraph, nodeIds: Set<string>): GraphDeletionResult {
  const next = removeNodes(graph, nodeIds);
  return {
    graph: next,
    nextSelectedNodeIds: firstNodeSelection(next)
  };
}

export function deleteGraphSelection(graph: BlueprintGraph, selection: GraphSelectionIds): GraphDeletionResult {
  const graphWithoutLinks = removeLinks(graph, selection.linkIds);
  const graphWithoutComments = removeComments(graphWithoutLinks, selection.commentIds);
  const next = removeNodes(graphWithoutComments, selection.nodeIds);
  return {
    graph: next,
    nextSelectedNodeIds: firstNodeSelection(next)
  };
}

export function copyGraphSelection(graph: BlueprintGraph, nodeIds: Set<string>): GraphClipboard | undefined {
  if (!nodeIds.size) {
    return undefined;
  }
  const nodes = graph.nodes.filter((node) => nodeIds.has(node.id));
  if (!nodes.length) {
    return undefined;
  }
  const copiedNodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: graph.links.filter((link) => copiedNodeIds.has(link.fromNodeId) && copiedNodeIds.has(link.toNodeId)),
    comments: graphComments(graph).filter((comment) => comment.nodeIds.length && comment.nodeIds.every((nodeId) => copiedNodeIds.has(nodeId)))
  };
}

export function pasteGraphClipboard(graph: BlueprintGraph, clipboard: GraphClipboard, suffix = Date.now().toString(36)): GraphClipboardMutationResult {
  const clone = cloneGraphClipboard(clipboard, graph, suffix);
  return {
    graph: {
      ...graph,
      nodes: [...graph.nodes, ...clone.nodes],
      links: [...graph.links, ...clone.links],
      comments: [...graphComments(graph), ...clone.comments]
    },
    clipboard: clone,
    nextSelectedNodeIds: new Set(clone.nodes.map((node) => node.id))
  };
}

export function duplicateGraphNodes(graph: BlueprintGraph, nodeIds: Set<string>, suffix = Date.now().toString(36)): GraphClipboardMutationResult | undefined {
  const clipboard = copyGraphSelection(graph, nodeIds);
  return clipboard ? pasteGraphClipboard(graph, clipboard, suffix) : undefined;
}

export function cloneGraphClipboard(clipboard: GraphClipboard, graph: BlueprintGraph, suffix = Date.now().toString(36)): GraphClipboard {
  const nodeIdMap = new Map(clipboard.nodes.map((node, index) => [node.id, `${node.id}-copy-${suffix}-${index}`]));
  const linkIdMap = new Map(clipboard.links.map((link, index) => [link.id, `${link.id}-copy-${suffix}-${index}`]));
  const existingNodeIds = new Set(graph.nodes.map((node) => node.id));
  const existingCommentIds = new Set(graphComments(graph).map((comment) => comment.id));

  const nodes = clipboard.nodes.map((node) => {
    const id = uniqueId(nodeIdMap.get(node.id) ?? `${node.id}-copy-${suffix}`, existingNodeIds);
    nodeIdMap.set(node.id, id);
    existingNodeIds.add(id);
    const inputBindings = Object.fromEntries(
      Object.entries(node.inputBindings)
        .map(([portId, binding]) => {
          if (binding.sourceKind === "link") {
            const linkId = binding.linkId ? linkIdMap.get(binding.linkId) : undefined;
            return linkId ? [portId, { ...binding, linkId }] : undefined;
          }
          return [portId, binding];
        })
        .filter((entry): entry is [string, (typeof node.inputBindings)[string]] => Boolean(entry))
    );
    return {
      ...node,
      id,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      inputBindings
    };
  });

  const links = clipboard.links
    .map((link) => {
      const fromNodeId = nodeIdMap.get(link.fromNodeId);
      const toNodeId = nodeIdMap.get(link.toNodeId);
      const id = linkIdMap.get(link.id);
      if (!fromNodeId || !toNodeId || !id) {
        return undefined;
      }
      const cloned = {
        ...link,
        id,
        fromNodeId,
        toNodeId
      };
      if (link.flowKind === "data") {
        cloned.contextVariableId = `${link.contextVariableId ?? link.id}-copy-${suffix}`;
      } else {
        delete cloned.contextVariableId;
      }
      return cloned;
    })
    .filter((link): link is BlueprintGraph["links"][number] => Boolean(link));

  const comments = clipboard.comments
    .map((comment, index): BlueprintCommentBox | undefined => {
      const remappedNodeIds = comment.nodeIds
        .map((nodeId) => nodeIdMap.get(nodeId))
        .filter((nodeId): nodeId is string => Boolean(nodeId));
      if (!remappedNodeIds.length) {
        return undefined;
      }
      const id = uniqueId(`${comment.id}-copy-${suffix}-${index}`, existingCommentIds);
      existingCommentIds.add(id);
      return {
        ...comment,
        id,
        position: { x: comment.position.x + 40, y: comment.position.y + 40 },
        nodeIds: remappedNodeIds
      };
    })
    .filter((comment): comment is BlueprintCommentBox => Boolean(comment));

  return { nodes, links, comments };
}

export function updateGraphCommentTitle(graph: BlueprintGraph, commentId: string, title: string): BlueprintGraph {
  return {
    ...graph,
    comments: graphComments(graph).map((comment) => (comment.id === commentId ? { ...comment, title } : comment))
  };
}

export function updateGraphCommentSize(graph: BlueprintGraph, comment: BlueprintCommentBox, size: { width: number; height: number }): BlueprintGraph {
  const width = Number.isFinite(size.width) ? size.width : comment.size.width;
  const height = Number.isFinite(size.height) ? size.height : comment.size.height;
  return {
    ...graph,
    comments: graphComments(graph).map((candidate) =>
      candidate.id === comment.id
        ? {
            ...candidate,
            size: {
              width: Math.round(clamp(width, 120, 2400)),
              height: Math.round(clamp(height, 80, 1800))
            }
          }
        : candidate
    )
  };
}

export function updateGraphCommentColor(graph: BlueprintGraph, commentId: string, color: string): BlueprintGraph {
  return {
    ...graph,
    comments: graphComments(graph).map((comment) => (comment.id === commentId ? { ...comment, color } : comment))
  };
}

export function replaceGraphComment(graph: BlueprintGraph, comment: BlueprintCommentBox): BlueprintGraph {
  return {
    ...graph,
    comments: graphComments(graph).map((candidate) => (candidate.id === comment.id ? comment : candidate))
  };
}

export function createGraphCommentBox(
  graph: BlueprintGraph,
  targetBounds: GraphCommentBounds,
  nodeIds: string[],
  suffix = Date.now().toString(36),
  labels: { selection: string; comment: string } = { selection: "Selection", comment: "Comment" }
): GraphCommentCreationResult {
  const padding = 36;
  const existingCommentIds = new Set(graphComments(graph).map((comment) => comment.id));
  const comment: BlueprintCommentBox = {
    id: uniqueId(`comment-${suffix}`, existingCommentIds),
    title: nodeIds.length ? labels.selection : labels.comment,
    position: {
      x: targetBounds.x - padding,
      y: targetBounds.y - padding - 22
    },
    size: {
      width: Math.max(260, targetBounds.width + padding * 2),
      height: Math.max(160, targetBounds.height + padding * 2 + 22)
    },
    nodeIds,
    color: "#d9a441"
  };
  return {
    graph: {
      ...graph,
      comments: [...graphComments(graph), comment]
    },
    comment
  };
}

export function createGraphBookmark(
  graph: BlueprintGraph,
  label: string,
  position: { x: number; y: number },
  nodeId?: string,
  suffix = Date.now().toString(36)
): GraphBookmarkCreationResult {
  const existingIds = new Set(graphBookmarks(graph).map((bookmark) => bookmark.id));
  const bookmark: BlueprintBookmark = {
    id: uniqueId(`bookmark-${suffix}`, existingIds),
    label,
    position,
    nodeId
  };
  return {
    graph: {
      ...graph,
      bookmarks: [...graphBookmarks(graph), bookmark]
    },
    bookmark
  };
}

export function deleteGraphBookmark(graph: BlueprintGraph, bookmarkId: string): BlueprintGraph {
  return {
    ...graph,
    bookmarks: graphBookmarks(graph).filter((bookmark) => bookmark.id !== bookmarkId)
  };
}

export function renameGraphBookmark(graph: BlueprintGraph, bookmarkId: string, label: string, fallbackLabel = "Bookmark"): BlueprintGraph {
  const normalized = label.trim() || fallbackLabel;
  const bookmarks = graphBookmarks(graph);
  if (bookmarks.find((bookmark) => bookmark.id === bookmarkId)?.label === normalized) {
    return graph;
  }
  return {
    ...graph,
    bookmarks: bookmarks.map((bookmark) => (bookmark.id === bookmarkId ? { ...bookmark, label: normalized } : bookmark))
  };
}

export function alignGraphNodes(graph: BlueprintGraph, bounds: GraphNodeBounds[], mode: GraphAlignMode): BlueprintGraph | undefined {
  if (bounds.length < 2) {
    return undefined;
  }
  const left = Math.min(...bounds.map((entry) => entry.x));
  const right = Math.max(...bounds.map((entry) => entry.x + entry.width));
  const top = Math.min(...bounds.map((entry) => entry.y));
  const bottom = Math.max(...bounds.map((entry) => entry.y + entry.height));
  const boundsByNodeId = new Map(bounds.map((entry) => [entry.nodeId, entry]));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const entry = boundsByNodeId.get(node.id);
      if (!entry) {
        return node;
      }
      if (mode === "left") {
        return { ...node, position: { ...node.position, x: left } };
      }
      if (mode === "right") {
        return { ...node, position: { ...node.position, x: right - entry.width } };
      }
      if (mode === "top") {
        return { ...node, position: { ...node.position, y: top } };
      }
      return { ...node, position: { ...node.position, y: bottom - entry.height } };
    })
  };
}

export function distributeGraphNodes(graph: BlueprintGraph, bounds: GraphNodeBounds[], mode: GraphDistributeMode): BlueprintGraph | undefined {
  if (bounds.length < 3) {
    return undefined;
  }
  const sorted = [...bounds].sort((a, b) =>
    mode === "horizontal"
      ? a.x + a.width / 2 - (b.x + b.width / 2)
      : a.y + a.height / 2 - (b.y + b.height / 2)
  );
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) {
    return undefined;
  }

  const firstCenter = mode === "horizontal" ? first.x + first.width / 2 : first.y + first.height / 2;
  const lastCenter = mode === "horizontal" ? last.x + last.width / 2 : last.y + last.height / 2;
  const step = (lastCenter - firstCenter) / Math.max(sorted.length - 1, 1);
  const positionByNodeId = new Map<string, { x: number; y: number }>();
  sorted.forEach((entry, index) => {
    const center = firstCenter + step * index;
    const node = graph.nodes.find((candidate) => candidate.id === entry.nodeId);
    if (!node) {
      return;
    }
    positionByNodeId.set(entry.nodeId, {
      x: mode === "horizontal" ? center - entry.width / 2 : node.position.x,
      y: mode === "vertical" ? center - entry.height / 2 : node.position.y
    });
  });

  return {
    ...graph,
    nodes: graph.nodes.map((node) => (positionByNodeId.has(node.id) ? { ...node, position: positionByNodeId.get(node.id)! } : node))
  };
}

export function insertRoutingHubsForLinks(
  graph: BlueprintGraph,
  linkIds: Set<string>,
  options: GraphRoutingHubInsertionOptions
): GraphRoutingHubInsertionResult | undefined {
  if (!linkIds.size) {
    return undefined;
  }

  const selectedLinks = graph.links.filter((link) => linkIds.has(link.id));
  if (!selectedLinks.length) {
    return undefined;
  }

  const existingNodeIds = new Set(graph.nodes.map((node) => node.id));
  const existingLinkIds = new Set(graph.links.map((link) => link.id));
  const insertedNodes: BlueprintNodeInstance[] = [];
  const replacementLinks: BlueprintLink[] = [];
  const replacedLinkIds = new Set(selectedLinks.map((link) => link.id));

  for (const link of selectedLinks) {
    const suffix = options.suffixFactory?.(link) ?? Date.now().toString(36);
    const hubId = uniqueId(`manual-hub-${slug(link.id)}-${suffix}`, existingNodeIds);
    existingNodeIds.add(hubId);
    const firstLinkId = uniqueId(`${link.id}-hub-in`, existingLinkIds);
    existingLinkIds.add(firstLinkId);
    const secondLinkId = uniqueId(`${link.id}-hub-out`, existingLinkIds);
    existingLinkIds.add(secondLinkId);
    const midpoint = options.midpointsByLinkId.get(link.id) ?? { x: 0, y: 0 };

    insertedNodes.push({
      id: hubId,
      templateId: link.flowKind === "control" ? options.controlHubTemplateId : options.dataHubTemplateId,
      position: {
        x: midpoint.x - options.hubWidth / 2,
        y: midpoint.y - options.hubHeight / 2
      },
      inputBindings:
        link.flowKind === "data"
          ? { value: { portId: "value", sourceKind: "link", linkId: firstLinkId } }
          : {},
      displayOverrides: { compact: true, manualRoutingHub: true }
    });
    replacementLinks.push(
      createLinkSegment(link, firstLinkId, link.fromNodeId, link.fromPortId, hubId, inputPortId(link.flowKind), 0),
      createLinkSegment(link, secondLinkId, hubId, outputPortId(link.flowKind), link.toNodeId, link.toPortId, 1)
    );
  }

  const links = [...graph.links.filter((link) => !replacedLinkIds.has(link.id)), ...replacementLinks];
  const nodes = syncDataLinkBindings([...graph.nodes, ...insertedNodes], links);
  return {
    graph: { ...graph, nodes, links },
    insertedNodeIds: new Set(insertedNodes.map((node) => node.id))
  };
}

export function cleanupRoutingHubs(graph: BlueprintGraph, options: GraphRoutingHubCleanupOptions): GraphRoutingHubCleanupResult | undefined {
  if (!options.selectedNodeIds.size) {
    return undefined;
  }

  let links = graph.links;
  const removedNodeIds = new Set<string>();
  const selectedLinkIds = new Set<string>();

  for (const node of graph.nodes) {
    if (!options.selectedNodeIds.has(node.id) || !options.isRoutingHubNode(node)) {
      continue;
    }

    const incoming = links.filter((link) => link.toNodeId === node.id);
    const outgoing = links.filter((link) => link.fromNodeId === node.id);
    if (incoming.length !== 1 || outgoing.length !== 1 || incoming[0].flowKind !== outgoing[0].flowKind) {
      continue;
    }

    const directLink = options.createDirectLink({ node, incoming: incoming[0], outgoing: outgoing[0] });
    if (!directLink) {
      continue;
    }

    const replacementLink: BlueprintLink = {
      ...directLink,
      id: outgoing[0].id,
      contextVariableId: directLink.flowKind === "data" ? outgoing[0].contextVariableId ?? incoming[0].contextVariableId ?? directLink.contextVariableId : undefined
    };
    links = [...links.filter((link) => link.id !== incoming[0].id && link.id !== outgoing[0].id), replacementLink];
    removedNodeIds.add(node.id);
    selectedLinkIds.add(replacementLink.id);
  }

  if (!removedNodeIds.size) {
    return undefined;
  }

  const nodes = syncDataLinkBindings(graph.nodes.filter((node) => !removedNodeIds.has(node.id)), links);
  return {
    graph: { ...graph, nodes, links },
    removedNodeIds,
    selectedLinkIds
  };
}

function firstNodeSelection(graph: BlueprintGraph): Set<string> {
  return new Set(graph.nodes[0]?.id ? [graph.nodes[0].id] : []);
}

function createLinkSegment(
  source: BlueprintLink,
  id: string,
  fromNodeId: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string,
  index: number
): BlueprintLink {
  return {
    id,
    fromNodeId,
    fromPortId,
    toNodeId,
    toPortId,
    flowKind: source.flowKind,
    contextVariableId: source.flowKind === "data" ? `${source.contextVariableId ?? source.id}-manual-${index}` : undefined
  };
}

function syncDataLinkBindings(nodes: BlueprintNodeInstance[], links: BlueprintLink[]): BlueprintNodeInstance[] {
  const linkIds = new Set(links.map((link) => link.id));
  const dataLinksByTarget = new Map<string, BlueprintLink>();
  for (const link of links) {
    if (link.flowKind === "data") {
      dataLinksByTarget.set(`${link.toNodeId}:${link.toPortId}`, link);
    }
  }

  return nodes.map((node) => {
    const inputBindings = Object.fromEntries(
      Object.entries(node.inputBindings).filter(([, binding]) => binding.sourceKind !== "link" || !binding.linkId || linkIds.has(binding.linkId))
    );
    for (const link of dataLinksByTarget.values()) {
      if (link.toNodeId === node.id) {
        inputBindings[link.toPortId] = { portId: link.toPortId, sourceKind: "link", linkId: link.id };
      }
    }
    return { ...node, inputBindings };
  });
}

function inputPortId(flowKind: FlowKind): string {
  return flowKind === "control" ? "exec" : "value";
}

function outputPortId(flowKind: FlowKind): string {
  return flowKind === "control" ? "then" : "out";
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function uniqueId(base: string, existingIds: Set<string>): string {
  if (!existingIds.has(base)) {
    return base;
  }
  let index = 1;
  while (existingIds.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function graphComments(graph: BlueprintGraph): BlueprintCommentBox[] {
  return graph.comments ?? [];
}

function graphBookmarks(graph: BlueprintGraph): BlueprintBookmark[] {
  return graph.bookmarks ?? [];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeBreakpoints(breakpoints: BlueprintBreakpoint[]): BlueprintBreakpoint[] {
  const seen = new Set<string>();
  return breakpoints.flatMap((breakpoint) => {
    if (!breakpoint.nodeId || seen.has(breakpoint.nodeId)) {
      return [];
    }
    seen.add(breakpoint.nodeId);
    return [{
      nodeId: breakpoint.nodeId,
      enabled: typeof breakpoint.enabled === "boolean" ? breakpoint.enabled : undefined,
      condition: breakpoint.condition?.trim() || undefined
    }];
  });
}
