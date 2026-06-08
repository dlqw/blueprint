import {
  BlueprintCommentBox,
  BlueprintGraph,
  BlueprintLink,
  BlueprintNodeInstance,
  BlueprintNodeTemplate,
  BlueprintPortDefinition,
  FlowKind,
  Point
} from "../shared/blueprint";
import { findPort, getEffectiveTemplateForNode } from "../shared/graph";

export const NODE_WIDTH = 268;
export const HEADER_HEIGHT = 30;
export const ROW_HEIGHT = 28;
export const HUB_WIDTH = 46;
export const HUB_HEIGHT = 36;

const columnGap = 460;
const rowGap = 70;
const layoutOrigin: Point = { x: 80, y: 80 };
const dataHubTemplateId = "builtin.routing.dataHub";
const controlHubTemplateId = "builtin.routing.controlHub";

export function applyAutoLayout(graph: BlueprintGraph, templates: BlueprintNodeTemplate[]): BlueprintGraph {
  const collapsed = collapseAutoLayoutHubs(graph);
  const ranks = rankNodes(collapsed);
  const orderedColumns = orderColumns(collapsed, ranks);
  const positionedNodes = positionNodes(collapsed, templates, ranks, orderedColumns);
  const routed = insertRoutingHubs({ ...collapsed, nodes: positionedNodes }, templates, ranks);
  const nodes = applyDataLinkBindings(routed.nodes, routed.links);
  const nextGraph = {
    ...graph,
    nodes,
    links: routed.links,
    layout: {
      ...graph.layout,
      viewport: { ...graph.layout.viewport, x: 0, y: 0, zoom: 1 }
    }
  };
  return {
    ...nextGraph,
    comments: layoutComments(nextGraph, graph.comments ?? [], templates)
  };
}

export function isAutoLayoutHubNode(node: BlueprintNodeInstance): boolean {
  return node.displayOverrides?.autoLayoutHub === true;
}

export function isRoutingHubTemplate(template: BlueprintNodeTemplate | undefined): boolean {
  return template?.metadata?.routingHub === true;
}

export function renderedNodeWidth(template: BlueprintNodeTemplate | undefined, node?: BlueprintNodeInstance): number {
  return isRoutingHubTemplate(template) || node?.displayOverrides?.compact === true ? HUB_WIDTH : NODE_WIDTH;
}

export function renderedNodeHeight(template: BlueprintNodeTemplate | undefined, node?: BlueprintNodeInstance): number {
  if (isRoutingHubTemplate(template) || node?.displayOverrides?.compact === true) {
    return HUB_HEIGHT;
  }
  const dataRows = Math.max(template?.inputs.length ?? 0, template?.outputs.length ?? 0);
  return HEADER_HEIGHT + 36 + dataRows * ROW_HEIGHT;
}

export function portLocalPoint(template: BlueprintNodeTemplate, port: BlueprintPortDefinition): Point {
  if (isRoutingHubTemplate(template)) {
    return { x: port.direction === "input" ? 0 : HUB_WIDTH, y: HUB_HEIGHT / 2 };
  }

  const allInputs = [...template.controlInputs, ...template.inputs];
  const allOutputs = [...template.controlOutputs, ...template.outputs];
  const collection = port.direction === "input" ? allInputs : allOutputs;
  const index = Math.max(0, collection.findIndex((candidate) => candidate.id === port.id));
  return {
    x: port.direction === "input" ? 0 : NODE_WIDTH,
    y: HEADER_HEIGHT + 18 + index * ROW_HEIGHT
  };
}

function collapseAutoLayoutHubs(graph: BlueprintGraph): BlueprintGraph {
  const hubIds = new Set(graph.nodes.filter(isAutoLayoutHubNode).map((node) => node.id));
  if (!hubIds.size) {
    return graph;
  }

  const nodes = graph.nodes.filter((node) => !hubIds.has(node.id));
  const links: BlueprintLink[] = graph.links.filter((link) => !hubIds.has(link.fromNodeId) && !hubIds.has(link.toNodeId));
  const seen = new Set(links.map((link) => link.id));

  for (const link of graph.links) {
    if (hubIds.has(link.fromNodeId) || !hubIds.has(link.toNodeId)) {
      continue;
    }

    const collapsed = followHubChain(link, graph.links, hubIds);
    if (!collapsed || seen.has(collapsed.id)) {
      continue;
    }
    seen.add(collapsed.id);
    links.push(collapsed);
  }

  return { ...graph, nodes, links };
}

function followHubChain(firstLink: BlueprintLink, links: BlueprintLink[], hubIds: Set<string>): BlueprintLink | undefined {
  let current = firstLink;
  const visited = new Set<string>();

  while (hubIds.has(current.toNodeId)) {
    if (visited.has(current.toNodeId)) {
      return undefined;
    }
    visited.add(current.toNodeId);
    const next = links.find((candidate) => candidate.fromNodeId === current.toNodeId && candidate.flowKind === firstLink.flowKind);
    if (!next) {
      return undefined;
    }
    current = next;
  }

  return {
    id: baseLinkId(firstLink.id),
    fromNodeId: firstLink.fromNodeId,
    fromPortId: firstLink.fromPortId,
    toNodeId: current.toNodeId,
    toPortId: current.toPortId,
    flowKind: firstLink.flowKind,
    contextVariableId: firstLink.flowKind === "data" ? baseContextId(firstLink.contextVariableId ?? current.contextVariableId ?? firstLink.id) : undefined
  };
}

function rankNodes(graph: BlueprintGraph): Map<string, number> {
  const incoming = new Map<string, BlueprintLink[]>();
  for (const node of graph.nodes) {
    incoming.set(node.id, []);
  }
  for (const link of graph.links) {
    incoming.get(link.toNodeId)?.push(link);
  }

  const ranks = new Map<string, number>();
  const visiting = new Set<string>();
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  const compute = (nodeId: string): number => {
    if (ranks.has(nodeId)) {
      return ranks.get(nodeId) ?? 0;
    }
    if (visiting.has(nodeId)) {
      return ranks.get(nodeId) ?? 0;
    }

    visiting.add(nodeId);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    let rank = node?.templateId === "builtin.control.entry" ? 0 : 0;
    for (const link of incoming.get(nodeId) ?? []) {
      if (nodeIds.has(link.fromNodeId)) {
        rank = Math.max(rank, compute(link.fromNodeId) + 1);
      }
    }
    visiting.delete(nodeId);
    ranks.set(nodeId, rank);
    return rank;
  };

  for (const node of graph.nodes) {
    compute(node.id);
  }

  const minRank = Math.min(0, ...ranks.values());
  for (const [nodeId, rank] of ranks) {
    ranks.set(nodeId, rank - minRank);
  }
  return ranks;
}

function orderColumns(graph: BlueprintGraph, ranks: Map<string, number>): BlueprintNodeInstance[][] {
  const originalOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const columns = new Map<number, BlueprintNodeInstance[]>();
  for (const node of graph.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    columns.set(rank, [...(columns.get(rank) ?? []), node]);
  }

  const orderedRanks = [...columns.keys()].sort((a, b) => a - b);
  const rowByNode = new Map(graph.nodes.map((node) => [node.id, originalOrder.get(node.id) ?? 0]));
  for (let pass = 0; pass < 4; pass += 1) {
    for (const rank of orderedRanks) {
      const column = columns.get(rank) ?? [];
      column.sort((a, b) => {
        const aScore = medianNeighborRow(graph.links.filter((link) => link.toNodeId === a.id), rowByNode, originalOrder.get(a.id) ?? 0);
        const bScore = medianNeighborRow(graph.links.filter((link) => link.toNodeId === b.id), rowByNode, originalOrder.get(b.id) ?? 0);
        return aScore - bScore || (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
      });
      column.forEach((node, index) => rowByNode.set(node.id, index));
    }
  }

  return orderedRanks.map((rank) => columns.get(rank) ?? []);
}

function positionNodes(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  ranks: Map<string, number>,
  columns: BlueprintNodeInstance[][]
): BlueprintNodeInstance[] {
  const positioned = new Map<string, BlueprintNodeInstance>();

  for (const column of columns) {
    let cursorY = layoutOrigin.y;
    for (const node of column) {
      const template = getEffectiveTemplateForNode(graph, templates, node);
      const height = renderedNodeHeight(template, node);
      const desiredY = desiredAlignedY(graph, templates, positioned, node);
      const y = Math.max(cursorY, Number.isFinite(desiredY) ? desiredY : cursorY);
      const positionedNode = {
        ...node,
        position: {
          x: layoutOrigin.x + (ranks.get(node.id) ?? 0) * columnGap,
          y
        }
      };
      positioned.set(node.id, positionedNode);
      cursorY = y + height + rowGap;
    }
  }

  return graph.nodes.map((node) => positioned.get(node.id) ?? node);
}

function desiredAlignedY(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  positioned: Map<string, BlueprintNodeInstance>,
  node: BlueprintNodeInstance
): number {
  const template = getEffectiveTemplateForNode(graph, templates, node);
  if (!template) {
    return Number.NaN;
  }

  const candidates: number[] = [];
  for (const link of graph.links.filter((candidate) => candidate.toNodeId === node.id)) {
    const sourceNode = positioned.get(link.fromNodeId);
    const sourceTemplate = sourceNode ? getEffectiveTemplateForNode(graph, templates, sourceNode) : undefined;
    const sourcePort = sourceTemplate ? findPort(sourceTemplate, link.fromPortId) : undefined;
    const targetPort = findPort(template, link.toPortId);
    if (!sourceNode || !sourceTemplate || !sourcePort || !targetPort) {
      continue;
    }

    const sourceLocal = portLocalPoint(sourceTemplate, sourcePort);
    const targetLocal = portLocalPoint(template, targetPort);
    candidates.push(sourceNode.position.y + sourceLocal.y - targetLocal.y);
  }

  return median(candidates);
}

function insertRoutingHubs(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], ranks: Map<string, number>): Pick<BlueprintGraph, "nodes" | "links"> {
  const nodes = [...graph.nodes];
  const links: BlueprintLink[] = [];
  const lanesByGutter = new Map<number, number[]>();
  const graphWithPositionedNodes = { ...graph, nodes };

  for (const link of graph.links) {
    const fromRank = ranks.get(link.fromNodeId) ?? 0;
    const toRank = ranks.get(link.toNodeId) ?? fromRank;
    const gap = toRank - fromRank;
    if (gap <= 1) {
      links.push(link);
      continue;
    }

    const laneY = laneForLink(graphWithPositionedNodes, templates, link);
    let previousNodeId = link.fromNodeId;
    let previousPortId = link.fromPortId;

    for (let step = 1; step < gap; step += 1) {
      const segmentId = `${link.id}-r${step - 1}`;
      const hubId = `auto-hub-${slug(link.id)}-${step}`;
      const gutterRank = fromRank + step - 1;
      const y = reserveLane(lanesByGutter, gutterRank, laneY - HUB_HEIGHT / 2);
      const hub: BlueprintNodeInstance = {
        id: hubId,
        templateId: link.flowKind === "control" ? controlHubTemplateId : dataHubTemplateId,
        position: {
          x: layoutOrigin.x + gutterRank * columnGap + NODE_WIDTH + (columnGap - NODE_WIDTH - HUB_WIDTH) / 2,
          y
        },
        inputBindings:
          link.flowKind === "data"
            ? { value: { portId: "value", sourceKind: "link", linkId: segmentId } }
            : {},
        displayOverrides: { autoLayoutHub: true, compact: true }
      };
      nodes.push(hub);
      links.push(createSegment(link, segmentId, previousNodeId, previousPortId, hubId, inputPortId(link.flowKind), step - 1));
      previousNodeId = hubId;
      previousPortId = outputPortId(link.flowKind);
    }

    const finalStep = gap - 1;
    links.push(createSegment(link, `${link.id}-r${finalStep}`, previousNodeId, previousPortId, link.toNodeId, link.toPortId, finalStep));
  }

  return { nodes, links };
}

function laneForLink(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], link: BlueprintLink): number {
  const from = absolutePortPoint(graph, templates, link.fromNodeId, link.fromPortId);
  const to = absolutePortPoint(graph, templates, link.toNodeId, link.toPortId);
  return median([from?.y, to?.y].filter((value): value is number => typeof value === "number"));
}

function absolutePortPoint(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], nodeId: string, portId: string): Point | undefined {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const template = node ? getEffectiveTemplateForNode(graph, templates, node) : undefined;
  const port = template ? findPort(template, portId) : undefined;
  if (!node || !template || !port) {
    return undefined;
  }
  const local = portLocalPoint(template, port);
  return { x: node.position.x + local.x, y: node.position.y + local.y };
}

function createSegment(
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
    contextVariableId: source.flowKind === "data" ? `${source.contextVariableId ?? source.id}-r${index}` : undefined
  };
}

function applyDataLinkBindings(nodes: BlueprintNodeInstance[], links: BlueprintLink[]): BlueprintNodeInstance[] {
  const dataLinks = links.filter((link) => link.flowKind === "data");
  return nodes.map((node) => {
    const incoming = dataLinks.filter((link) => link.toNodeId === node.id);
    if (!incoming.length) {
      return node;
    }

    const inputBindings = { ...node.inputBindings };
    for (const link of incoming) {
      inputBindings[link.toPortId] = { portId: link.toPortId, sourceKind: "link", linkId: link.id };
    }
    return { ...node, inputBindings };
  });
}

function layoutComments(graph: BlueprintGraph, comments: BlueprintCommentBox[], templates: BlueprintNodeTemplate[]): BlueprintCommentBox[] | undefined {
  if (!comments.length) {
    return graph.comments;
  }

  const nodeIds = new Set(graph.nodes.filter((node) => !isAutoLayoutHubNode(node)).map((node) => node.id));
  return comments.map((comment) => {
    const targetNodeIds = comment.nodeIds.filter((nodeId) => nodeIds.has(nodeId));
    if (!targetNodeIds.length) {
      return comment;
    }

    const targetNodes = graph.nodes.filter((node) => targetNodeIds.includes(node.id));
    const bounds = boundsForNodes(graph, templates, targetNodes);
    if (!bounds) {
      return { ...comment, nodeIds: targetNodeIds };
    }

    const padding = 36;
    const titleHeight = 22;
    return {
      ...comment,
      nodeIds: targetNodeIds,
      position: {
        x: bounds.x - padding,
        y: bounds.y - padding - titleHeight
      },
      size: {
        width: Math.max(260, bounds.width + padding * 2),
        height: Math.max(160, bounds.height + padding * 2 + titleHeight)
      }
    };
  });
}

function boundsForNodes(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  nodes: BlueprintNodeInstance[]
): { x: number; y: number; width: number; height: number } | undefined {
  if (!nodes.length) {
    return undefined;
  }

  const rects = nodes.map((node) => {
    const template = getEffectiveTemplateForNode(graph, templates, node);
    return {
      x: node.position.x,
      y: node.position.y,
      width: renderedNodeWidth(template, node),
      height: renderedNodeHeight(template, node)
    };
  });
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function reserveLane(lanesByGutter: Map<number, number[]>, gutterRank: number, desiredY: number): number {
  const lanes = lanesByGutter.get(gutterRank) ?? [];
  let y = desiredY;
  while (lanes.some((lane) => Math.abs(lane - y) < HUB_HEIGHT + 12)) {
    y += HUB_HEIGHT + 12;
  }
  lanes.push(y);
  lanesByGutter.set(gutterRank, lanes);
  return y;
}

function medianNeighborRow(links: BlueprintLink[], rowByNode: Map<string, number>, fallback: number): number {
  const value = median(links.map((link) => rowByNode.get(link.fromNodeId)).filter((candidate): candidate is number => typeof candidate === "number"));
  return Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  if (!values.length) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function inputPortId(flowKind: FlowKind): string {
  return flowKind === "control" ? "exec" : "value";
}

function outputPortId(flowKind: FlowKind): string {
  return flowKind === "control" ? "then" : "out";
}

function baseLinkId(id: string): string {
  return id.replace(/-r\d+$/, "");
}

function baseContextId(id: string): string {
  return id.replace(/-r\d+$/, "");
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}
