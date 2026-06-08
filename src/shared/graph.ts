import {
  BlueprintGraph,
  BlueprintLink,
  BlueprintNodeInstance,
  BlueprintNodeTemplate,
  BlueprintPortDefinition,
  ValidationIssue
} from "./blueprint";

export function createDefaultGraph(name: string): BlueprintGraph {
  return {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: toStableId(name),
    name,
    description: "Blueprint function.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [],
      outputs: []
    },
    nodes: [
      {
        id: "entry",
        templateId: "builtin.control.entry",
        position: { x: 80, y: 120 },
        inputBindings: {}
      },
      {
        id: "end",
        templateId: "builtin.control.end",
        position: { x: 520, y: 120 },
        inputBindings: {}
      }
    ],
    links: [
      {
        id: "link-entry-end",
        fromNodeId: "entry",
        fromPortId: "then",
        toNodeId: "end",
        toPortId: "exec",
        flowKind: "control"
      }
    ],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}

export function createNodeFromTemplate(template: BlueprintNodeTemplate, x: number, y: number): BlueprintNodeInstance {
  const inputBindings = Object.fromEntries(
    template.inputs.map((port) => [
      port.id,
      {
        portId: port.id,
        sourceKind: "literal" as const,
        literalValue: port.defaultValue ?? defaultValueForPort(port)
      }
    ])
  );

  return {
    id: `${template.id.replace(/[^A-Za-z0-9]/g, "-")}-${Date.now().toString(36)}`,
    templateId: template.id,
    position: { x, y },
    inputBindings
  };
}

export function validateGraph(graph: BlueprintGraph, templates: BlueprintNodeTemplate[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const linksById = new Map(graph.links.map((link) => [link.id, link]));
  const seenNodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  const seenLinkIds = new Set<string>();
  const duplicateLinkIds = new Set<string>();
  const seenCommentIds = new Set<string>();
  const duplicateCommentIds = new Set<string>();
  const seenBookmarkIds = new Set<string>();
  const duplicateBookmarkIds = new Set<string>();
  const seenBreakpointNodeIds = new Set<string>();
  const duplicateBreakpointNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (seenNodeIds.has(node.id)) {
      duplicateNodeIds.add(node.id);
    }
    seenNodeIds.add(node.id);
  }

  for (const nodeId of duplicateNodeIds) {
    issues.push({ severity: "error", message: `Duplicate node id '${nodeId}'.`, nodeId });
  }

  for (const link of graph.links) {
    if (seenLinkIds.has(link.id)) {
      duplicateLinkIds.add(link.id);
    }
    seenLinkIds.add(link.id);
  }

  for (const linkId of duplicateLinkIds) {
    issues.push({ severity: "error", message: `Duplicate link id '${linkId}'.`, linkId });
  }

  for (const comment of graph.comments ?? []) {
    if (seenCommentIds.has(comment.id)) {
      duplicateCommentIds.add(comment.id);
    }
    seenCommentIds.add(comment.id);
  }

  for (const commentId of duplicateCommentIds) {
    issues.push({ severity: "error", message: `Duplicate comment id '${commentId}'.` });
  }

  for (const bookmark of graph.bookmarks ?? []) {
    if (seenBookmarkIds.has(bookmark.id)) {
      duplicateBookmarkIds.add(bookmark.id);
    }
    seenBookmarkIds.add(bookmark.id);
  }

  for (const bookmarkId of duplicateBookmarkIds) {
    issues.push({ severity: "error", message: `Duplicate bookmark id '${bookmarkId}'.` });
  }

  for (const comment of graph.comments ?? []) {
    for (const nodeId of comment.nodeIds) {
      if (!nodesById.has(nodeId)) {
        issues.push({ severity: "warning", message: `Comment '${comment.title || comment.id}' references missing node '${nodeId}'.` });
      }
    }
  }

  for (const bookmark of graph.bookmarks ?? []) {
    if (bookmark.nodeId && !nodesById.has(bookmark.nodeId)) {
      issues.push({ severity: "warning", message: `Bookmark '${bookmark.label}' references missing node '${bookmark.nodeId}'.` });
    }
  }

  for (const breakpoint of graph.debug?.breakpoints ?? []) {
    if (seenBreakpointNodeIds.has(breakpoint.nodeId)) {
      duplicateBreakpointNodeIds.add(breakpoint.nodeId);
    }
    seenBreakpointNodeIds.add(breakpoint.nodeId);
  }

  for (const nodeId of duplicateBreakpointNodeIds) {
    issues.push({ severity: "error", message: `Duplicate breakpoint for node '${nodeId}'.`, nodeId });
  }

  for (const breakpoint of graph.debug?.breakpoints ?? []) {
    if (!nodesById.has(breakpoint.nodeId)) {
      issues.push({ severity: "warning", message: `Breakpoint references missing node '${breakpoint.nodeId}'.` });
    }
  }

  if (graph.kind !== "macro") {
    const entryCount = graph.nodes.filter((node) => node.templateId === "builtin.control.entry").length;
    if (!entryCount) {
      issues.push({ severity: "error", message: "Function graph requires a Function Entry node." });
    }
    if (entryCount > 1) {
      issues.push({ severity: "error", message: "Function graph can only have one Function Entry node." });
    }
    if (!graph.nodes.some((node) => node.templateId === "builtin.control.end")) {
      issues.push({ severity: "error", message: "Function graph requires a Function End node." });
    }
  }

  for (const node of graph.nodes) {
    const template = getEffectiveTemplateForNode(graph, templates, node);
    if (!template) {
      issues.push({ severity: "error", message: `Missing template '${node.templateId}'.`, nodeId: node.id });
      continue;
    }

    if (template.bodyKind === "blueprintGraph" && isSelfGraphTemplate(graph, template)) {
      issues.push({ severity: "error", message: "Graph cannot contain a node that calls itself.", nodeId: node.id });
    }

    const inputIds = new Set(template.inputs.map((input) => input.id));
    for (const [portId, binding] of Object.entries(node.inputBindings)) {
      if (!inputIds.has(portId)) {
        issues.push({ severity: "warning", message: `Input binding '${portId}' does not match an input port.`, nodeId: node.id, portId });
        continue;
      }
      if (binding.sourceKind === "link") {
        if (!binding.linkId) {
          issues.push({ severity: "error", message: `Link binding for '${node.id}.${portId}' has no link id.`, nodeId: node.id, portId });
          continue;
        }
        const link = linksById.get(binding.linkId);
        if (!link) {
          issues.push({ severity: "error", message: `Link binding for '${node.id}.${portId}' references missing link '${binding.linkId}'.`, nodeId: node.id, portId });
          continue;
        }
        if (link.flowKind !== "data" || link.toNodeId !== node.id || link.toPortId !== portId) {
          issues.push({ severity: "error", message: `Link binding for '${node.id}.${portId}' does not target that input.`, nodeId: node.id, portId, linkId: link.id });
        }
      }
    }

    for (const input of template.inputs) {
      const binding = node.inputBindings[input.id];
      if (!binding) {
        issues.push({ severity: "warning", message: `Input '${input.name}' has no binding.`, nodeId: node.id, portId: input.id });
        continue;
      }

      if (binding.sourceKind === "literal" && !isLiteralCompatible(binding.literalValue, input)) {
        issues.push({ severity: "error", message: `Literal for '${input.name}' does not match ${input.type}.`, nodeId: node.id, portId: input.id });
      }
      if (binding.sourceKind === "literal" && !isLiteralAllowedByOptions(binding.literalValue, input)) {
        issues.push({ severity: "error", message: `Literal for '${input.name}' is not an allowed option.`, nodeId: node.id, portId: input.id });
      }
    }
  }

  const incomingByInput = new Map<string, BlueprintLink[]>();
  const outgoingByControlOutput = new Map<string, BlueprintLink[]>();
  for (const link of graph.links) {
    const fromNode = nodesById.get(link.fromNodeId);
    const toNode = nodesById.get(link.toNodeId);
    if (!fromNode || !toNode) {
      issues.push({ severity: "error", message: "Link endpoint node is missing.", linkId: link.id });
      continue;
    }

    const fromTemplate = getEffectiveTemplateForNode(graph, templates, fromNode);
    const toTemplate = getEffectiveTemplateForNode(graph, templates, toNode);
    if (!fromTemplate || !toTemplate) {
      continue;
    }

    const fromPort = findPort(fromTemplate, link.fromPortId);
    const toPort = findPort(toTemplate, link.toPortId);
    if (!fromPort || !toPort) {
      issues.push({ severity: "error", message: "Link endpoint port is missing.", linkId: link.id });
      continue;
    }

    if (fromPort.direction !== "output" || toPort.direction !== "input") {
      issues.push({ severity: "error", message: "Links must connect output ports to input ports.", linkId: link.id });
    }
    if (fromPort.flowKind !== toPort.flowKind || fromPort.flowKind !== link.flowKind) {
      issues.push({ severity: "error", message: "Link flow kind does not match endpoint ports.", linkId: link.id });
    }
    if (link.flowKind === "data" && !link.contextVariableId) {
      issues.push({ severity: "error", message: "Data links require a context variable id.", linkId: link.id });
    }
    if (link.flowKind === "control" && link.contextVariableId) {
      issues.push({ severity: "error", message: "Control links cannot have a context variable id.", linkId: link.id });
    }
    if (link.flowKind === "data" && !areTypesCompatible(fromPort.type, toPort.type)) {
      issues.push({ severity: "error", message: `Cannot connect ${fromPort.type} to ${toPort.type}.`, linkId: link.id });
    }

    if (link.flowKind === "data") {
      const incomingKey = `${link.toNodeId}.${link.toPortId}`;
      incomingByInput.set(incomingKey, [...(incomingByInput.get(incomingKey) ?? []), link]);
    }
    if (link.flowKind === "control") {
      const outgoingKey = `${link.fromNodeId}.${link.fromPortId}`;
      outgoingByControlOutput.set(outgoingKey, [...(outgoingByControlOutput.get(outgoingKey) ?? []), link]);
    }
  }

  for (const links of incomingByInput.values()) {
    if (links.length > 1) {
      issues.push({
        severity: "error",
        message: `Input '${links[0].toNodeId}.${links[0].toPortId}' has multiple incoming links.`,
        nodeId: links[0].toNodeId,
        portId: links[0].toPortId
      });
    }
  }

  for (const links of outgoingByControlOutput.values()) {
    if (links.length > 1) {
      issues.push({
        severity: "error",
        message: `Control output '${links[0].fromNodeId}.${links[0].fromPortId}' has multiple outgoing links.`,
        nodeId: links[0].fromNodeId,
        portId: links[0].fromPortId
      });
    }
  }

  issues.push(...validateControlFlowShape(graph, templates));
  issues.push(...validateDataFlowShape(graph, templates));
  return issues;
}

export function findTemplate(templates: BlueprintNodeTemplate[], templateId: string): BlueprintNodeTemplate | undefined {
  return templates.find((template) => template.id === templateId);
}

export function getEffectiveTemplateForNode(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  node: BlueprintNodeInstance
): BlueprintNodeTemplate | undefined {
  const template = findTemplate([...templates, ...(graph.localTemplates ?? [])], node.templateId);
  if (!template) {
    return undefined;
  }

  if (node.templateId === "builtin.control.entry") {
    return {
      ...template,
      outputs: (graph.templateMetadata?.inputs ?? []).map((port) => ({
        ...port,
        direction: "output",
        flowKind: "data",
        editor: "none"
      }))
    };
  }

  if (node.templateId === "builtin.control.end") {
    return {
      ...template,
      inputs: (graph.templateMetadata?.outputs ?? []).map((port) => ({
        ...port,
        direction: "input",
        flowKind: "data"
      }))
    };
  }

  return template;
}

export function findPort(template: BlueprintNodeTemplate, portId: string): BlueprintPortDefinition | undefined {
  return [...template.inputs, ...template.outputs, ...template.controlInputs, ...template.controlOutputs].find((port) => port.id === portId);
}

export function findLinksForNode(graph: BlueprintGraph, nodeId: string): BlueprintLink[] {
  return graph.links.filter((link) => link.fromNodeId === nodeId || link.toNodeId === nodeId);
}

export function toStableId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blueprint";
}

function validateControlFlowShape(graph: BlueprintGraph, templates: BlueprintNodeTemplate[]): ValidationIssue[] {
  const entry = graph.nodes.find((node) => node.templateId === "builtin.control.entry");
  if (!entry) {
    return [];
  }

  const controlNodes = graph.nodes.filter((node) => {
    const template = getEffectiveTemplateForNode(graph, templates, node);
    return Boolean(template && (template.controlInputs.length || template.controlOutputs.length));
  });
  const controlNodeIds = new Set(controlNodes.map((node) => node.id));
  const outgoing = new Map<string, BlueprintLink[]>();
  for (const link of graph.links.filter((candidate) => candidate.flowKind === "control")) {
    outgoing.set(link.fromNodeId, [...(outgoing.get(link.fromNodeId) ?? []), link]);
  }

  const reachable = collectReachableControlNodeIds(graph, templates) ?? new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleNodes = new Set<string>();

  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      cycleNodes.add(nodeId);
      return;
    }
    if (visited.has(nodeId)) {
      return;
    }
    visiting.add(nodeId);
    for (const link of outgoing.get(nodeId) ?? []) {
      if (controlNodeIds.has(link.toNodeId)) {
        visit(link.toNodeId);
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  visit(entry.id);

  const issues: ValidationIssue[] = [];
  for (const node of controlNodes) {
    if (!reachable.has(node.id)) {
      issues.push({ severity: "warning", message: `Control node '${node.id}' is unreachable from Function Entry.`, nodeId: node.id });
    }
  }
  for (const nodeId of cycleNodes) {
    issues.push({ severity: "error", message: "Control flow contains a cycle; use a loop node for repeated execution.", nodeId });
  }
  return issues;
}

function validateDataFlowShape(graph: BlueprintGraph, templates: BlueprintNodeTemplate[]): ValidationIssue[] {
  const linkedOutputs = new Set(
    graph.links
      .filter((link) => link.flowKind === "data")
      .map((link) => `${link.fromNodeId}.${link.fromPortId}`)
  );
  const reachableControlNodes = collectReachableControlNodeIds(graph, templates);
  const requiredDataNodes = reachableControlNodes ? collectRequiredDataNodeIds(graph, reachableControlNodes) : undefined;
  const issues: ValidationIssue[] = [];

  for (const node of graph.nodes) {
    const template = getEffectiveTemplateForNode(graph, templates, node);
    if (!template || !template.outputs.length || template.controlInputs.length || template.controlOutputs.length) {
      continue;
    }
    const hasUsedOutput = template.outputs.some((output) => linkedOutputs.has(`${node.id}.${output.id}`));
    if (!hasUsedOutput) {
      issues.push({ severity: "warning", message: `Data node '${node.id}' has no used outputs.`, nodeId: node.id });
      continue;
    }
    if (requiredDataNodes && !requiredDataNodes.has(node.id)) {
      issues.push({ severity: "warning", message: `Data node '${node.id}' is not used by reachable control flow.`, nodeId: node.id });
    }
  }

  return issues;
}

function collectReachableControlNodeIds(graph: BlueprintGraph, templates: BlueprintNodeTemplate[]): Set<string> | undefined {
  const entry = graph.nodes.find((node) => node.templateId === "builtin.control.entry");
  if (!entry) {
    return undefined;
  }

  const controlNodeIds = new Set(
    graph.nodes
      .filter((node) => {
        const template = getEffectiveTemplateForNode(graph, templates, node);
        return Boolean(template && (template.controlInputs.length || template.controlOutputs.length));
      })
      .map((node) => node.id)
  );
  const outgoing = new Map<string, BlueprintLink[]>();
  for (const link of graph.links.filter((candidate) => candidate.flowKind === "control")) {
    outgoing.set(link.fromNodeId, [...(outgoing.get(link.fromNodeId) ?? []), link]);
  }

  const reachable = new Set<string>();
  const stack = [entry.id];
  while (stack.length) {
    const nodeId = stack.pop();
    if (!nodeId || reachable.has(nodeId)) {
      continue;
    }
    reachable.add(nodeId);
    for (const link of outgoing.get(nodeId) ?? []) {
      if (controlNodeIds.has(link.toNodeId)) {
        stack.push(link.toNodeId);
      }
    }
  }

  return reachable;
}

function collectRequiredDataNodeIds(graph: BlueprintGraph, reachableControlNodes: Set<string>): Set<string> {
  const incomingDataByTarget = new Map<string, BlueprintLink[]>();
  for (const link of graph.links.filter((candidate) => candidate.flowKind === "data")) {
    const key = `${link.toNodeId}.${link.toPortId}`;
    incomingDataByTarget.set(key, [...(incomingDataByTarget.get(key) ?? []), link]);
  }

  const stack = graph.links.filter((link) => link.flowKind === "data" && reachableControlNodes.has(link.toNodeId));
  const required = new Set<string>();
  const seenLinks = new Set<string>();
  while (stack.length) {
    const link = stack.pop();
    if (!link || seenLinks.has(link.id)) {
      continue;
    }
    seenLinks.add(link.id);
    required.add(link.fromNodeId);

    const sourceNode = graph.nodes.find((node) => node.id === link.fromNodeId);
    for (const portId of Object.keys(sourceNode?.inputBindings ?? {})) {
      stack.push(...(incomingDataByTarget.get(`${link.fromNodeId}.${portId}`) ?? []));
    }
  }

  return required;
}

function isSelfGraphTemplate(graph: BlueprintGraph, template: BlueprintNodeTemplate): boolean {
  const graphTemplateId = `graph.${graph.id}`;
  const source = typeof template.metadata?.source === "string" ? template.metadata.source : template.bodyRef;
  return template.id === graphTemplateId || template.name === graph.name || source.endsWith(`${graph.id}.bpgraph`);
}

function defaultValueForPort(port: BlueprintPortDefinition): unknown {
  switch (port.type) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "json":
      return {};
    default:
      return "";
  }
}

function isLiteralCompatible(value: unknown, port: BlueprintPortDefinition): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  switch (port.type) {
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "json":
    case "unknown":
      return true;
    default:
      return true;
  }
}

function isLiteralAllowedByOptions(value: unknown, port: BlueprintPortDefinition): boolean {
  const options = port.constraints?.options;
  if (!options?.length || value === undefined || value === null) {
    return true;
  }
  return options.includes(value as string | number | boolean);
}

function areTypesCompatible(fromType: string, toType: string): boolean {
  return toType === "unknown" || fromType === "unknown" || fromType === toType;
}
