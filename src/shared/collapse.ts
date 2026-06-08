import {
  BlueprintCommentBox,
  BlueprintGraph,
  BlueprintLink,
  BlueprintNodeInstance,
  BlueprintNodeTemplate,
  BlueprintPortDefinition,
  createPort
} from "./blueprint";
import { getEffectiveTemplateForNode, toStableId } from "./graph";
import { graphToNodeTemplate } from "./projectGraphTemplates";

export interface CollapseSelectionResult {
  ok: true;
  graph: BlueprintGraph;
  extractedGraph: BlueprintGraph;
  template: BlueprintNodeTemplate;
  nodeId: string;
}

export interface CollapseSelectionToMacroResult extends CollapseSelectionResult {
  macroGraph: BlueprintGraph;
  macroTemplate: BlueprintNodeTemplate;
  macroNodeId: string;
}

export interface CollapseSelectionToFunctionResult extends CollapseSelectionResult {
  functionGraph: BlueprintGraph;
  functionTemplate: BlueprintNodeTemplate;
  functionNodeId: string;
}

export interface CollapseSelectionFailure {
  ok: false;
  issues: string[];
}

export type CollapseSelectionToMacroFailure = CollapseSelectionFailure;
export type CollapseSelectionToFunctionFailure = CollapseSelectionFailure;

export type CollapseSelectionToMacroOutcome = CollapseSelectionToMacroResult | CollapseSelectionToMacroFailure;
export type CollapseSelectionToFunctionOutcome = CollapseSelectionToFunctionResult | CollapseSelectionToFunctionFailure;

export interface ExtractCollapsedUnitToProjectGraphResult {
  ok: true;
  graph: BlueprintGraph;
  projectGraph: BlueprintGraph;
  projectTemplate: BlueprintNodeTemplate;
}

export type ExtractCollapsedUnitToProjectGraphOutcome = ExtractCollapsedUnitToProjectGraphResult | CollapseSelectionFailure;

interface MacroInputMapping {
  link: BlueprintLink;
  port: BlueprintPortDefinition;
  internalLinkId: string;
}

interface MacroOutputMapping {
  link: BlueprintLink;
  port: BlueprintPortDefinition;
  source: {
    nodeId: string;
    portId: string;
  };
}

export function collapseSelectionToMacro(
  graph: BlueprintGraph,
  selectedNodeIds: Set<string>,
  macroName: string,
  templates: BlueprintNodeTemplate[] = []
): CollapseSelectionToMacroOutcome {
  const issues = validateCollapseSelection(graph, selectedNodeIds);
  if (!macroName.trim()) {
    issues.push("Macro name cannot be empty.");
  }
  const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
  if (issues.length) {
    return { ok: false, issues };
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const incomingControl = graph.links.find((link) => link.flowKind === "control" && !selectedIds.has(link.fromNodeId) && selectedIds.has(link.toNodeId));
  const outgoingControl = graph.links.find((link) => link.flowKind === "control" && selectedIds.has(link.fromNodeId) && !selectedIds.has(link.toNodeId));
  const incomingData = graph.links.filter((link) => link.flowKind === "data" && !selectedIds.has(link.fromNodeId) && selectedIds.has(link.toNodeId));
  const outgoingData = graph.links.filter((link) => link.flowKind === "data" && selectedIds.has(link.fromNodeId) && !selectedIds.has(link.toNodeId));
  const macroInputs = createMacroInputPorts(graph, templates, incomingData);
  const macroOutputs = createMacroOutputPorts(graph, templates, outgoingData);
  const macroId = uniqueId(toStableId(macroName), new Set([
    graph.id,
    ...(graph.embeddedGraphs ?? []).map((embedded) => embedded.id),
    ...(graph.localTemplates ?? []).map((template) => template.id.replace(/^(graph|macro)\./, ""))
  ]));
  const macroNodeId = uniqueId(`macro-${macroId}`, new Set(graph.nodes.filter((node) => !selectedIds.has(node.id)).map((node) => node.id)));
  const macroTemplate = createMacroTemplate(macroId, macroName, macroInputs.map((entry) => entry.port), macroOutputs);
  const macroGraph = createMacroGraph(graph, selectedNodes, selectedIds, incomingControl, incomingData, macroInputs, macroOutputs, macroId, macroName);
  const macroNode = createMacroNode(macroNodeId, macroId, selectedNodes, incomingData, macroInputs);
  const outerLinks = graph.links.filter((link) => !selectedIds.has(link.fromNodeId) && !selectedIds.has(link.toNodeId));
  for (const [index, link] of incomingData.entries()) {
    const macroInput = macroInputs[index];
    outerLinks.push({ ...link, toNodeId: macroNodeId, toPortId: macroInput.port.id });
  }
  for (const [index, link] of outgoingData.entries()) {
    const macroOutput = macroOutputs[index];
    outerLinks.push({ ...link, fromNodeId: macroNodeId, fromPortId: macroOutput.port.id });
  }
  if (incomingControl) {
    outerLinks.push({ ...incomingControl, toNodeId: macroNodeId, toPortId: "exec" });
  }
  if (outgoingControl) {
    outerLinks.push({ ...outgoingControl, fromNodeId: macroNodeId, fromPortId: "then" });
  }

  return {
    ok: true,
    graph: {
      ...graph,
      localTemplates: [...(graph.localTemplates ?? []), macroTemplate],
      embeddedGraphs: [...(graph.embeddedGraphs ?? []), macroGraph],
      nodes: [...graph.nodes.filter((node) => !selectedIds.has(node.id)), macroNode],
      links: outerLinks,
      comments: updateCommentsForCollapsedSelection(graph.comments, selectedIds, macroNodeId),
      bookmarks: (graph.bookmarks ?? []).filter((bookmark) => !bookmark.nodeId || !selectedIds.has(bookmark.nodeId)),
      debug: graph.debug
        ? { ...graph.debug, breakpoints: (graph.debug.breakpoints ?? []).filter((breakpoint) => !selectedIds.has(breakpoint.nodeId)) }
        : graph.debug
    },
    macroGraph,
    macroTemplate,
    macroNodeId,
    extractedGraph: macroGraph,
    template: macroTemplate,
    nodeId: macroNodeId
  };
}

export function collapseSelectionToFunction(
  graph: BlueprintGraph,
  selectedNodeIds: Set<string>,
  functionName: string,
  templates: BlueprintNodeTemplate[] = []
): CollapseSelectionToFunctionOutcome {
  const issues = validateCollapseSelection(graph, selectedNodeIds);
  if (!functionName.trim()) {
    issues.push("Function name cannot be empty.");
  }
  const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
  if (issues.length) {
    return { ok: false, issues };
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const incomingControl = graph.links.find((link) => link.flowKind === "control" && !selectedIds.has(link.fromNodeId) && selectedIds.has(link.toNodeId));
  const outgoingControl = graph.links.find((link) => link.flowKind === "control" && selectedIds.has(link.fromNodeId) && !selectedIds.has(link.toNodeId));
  const incomingData = graph.links.filter((link) => link.flowKind === "data" && !selectedIds.has(link.fromNodeId) && selectedIds.has(link.toNodeId));
  const outgoingData = graph.links.filter((link) => link.flowKind === "data" && selectedIds.has(link.fromNodeId) && !selectedIds.has(link.toNodeId));
  const functionInputs = createMacroInputPorts(graph, templates, incomingData);
  const functionOutputs = createMacroOutputPorts(graph, templates, outgoingData);
  const functionId = uniqueId(toStableId(functionName), new Set([
    graph.id,
    ...(graph.embeddedGraphs ?? []).map((embedded) => embedded.id),
    ...(graph.localTemplates ?? []).map((template) => template.id.replace(/^(graph|macro)\./, ""))
  ]));
  const functionNodeId = uniqueId(`function-${functionId}`, new Set(graph.nodes.filter((node) => !selectedIds.has(node.id)).map((node) => node.id)));
  const functionTemplate = createFunctionTemplate(functionId, functionName, functionInputs.map((entry) => entry.port), functionOutputs);
  const functionGraph = createFunctionGraph(
    graph,
    selectedNodes,
    selectedIds,
    incomingControl,
    outgoingControl,
    incomingData,
    functionInputs,
    functionOutputs,
    functionId,
    functionName
  );
  const functionNode = createFunctionNode(functionNodeId, functionId, selectedNodes, incomingData, functionInputs);
  const outerLinks = graph.links.filter((link) => !selectedIds.has(link.fromNodeId) && !selectedIds.has(link.toNodeId));
  for (const [index, link] of incomingData.entries()) {
    const functionInput = functionInputs[index];
    outerLinks.push({ ...link, toNodeId: functionNodeId, toPortId: functionInput.port.id });
  }
  for (const [index, link] of outgoingData.entries()) {
    const functionOutput = functionOutputs[index];
    outerLinks.push({ ...link, fromNodeId: functionNodeId, fromPortId: functionOutput.port.id });
  }
  if (incomingControl) {
    outerLinks.push({ ...incomingControl, toNodeId: functionNodeId, toPortId: "exec" });
  }
  if (outgoingControl) {
    outerLinks.push({ ...outgoingControl, fromNodeId: functionNodeId, fromPortId: "then" });
  }

  return {
    ok: true,
    graph: {
      ...graph,
      localTemplates: [...(graph.localTemplates ?? []), functionTemplate],
      embeddedGraphs: [...(graph.embeddedGraphs ?? []), functionGraph],
      nodes: [...graph.nodes.filter((node) => !selectedIds.has(node.id)), functionNode],
      links: outerLinks,
      comments: updateCommentsForCollapsedSelection(graph.comments, selectedIds, functionNodeId),
      bookmarks: (graph.bookmarks ?? []).filter((bookmark) => !bookmark.nodeId || !selectedIds.has(bookmark.nodeId)),
      debug: graph.debug
        ? { ...graph.debug, breakpoints: (graph.debug.breakpoints ?? []).filter((breakpoint) => !selectedIds.has(breakpoint.nodeId)) }
        : graph.debug
    },
    extractedGraph: functionGraph,
    template: functionTemplate,
    nodeId: functionNodeId,
    functionGraph,
    functionTemplate,
    functionNodeId
  };
}

export function extractCollapsedUnitToProjectGraph(
  graph: BlueprintGraph,
  templateId: string,
  projectGraphSource: string
): ExtractCollapsedUnitToProjectGraphOutcome {
  const template = (graph.localTemplates ?? []).find((candidate) => candidate.id === templateId);
  if (!template) {
    return { ok: false, issues: [`Local collapsed template '${templateId}' was not found.`] };
  }

  const embeddedId = embeddedGraphIdForTemplate(template);
  if (!embeddedId) {
    return { ok: false, issues: [`Template '${templateId}' is not backed by an embedded graph.`] };
  }

  const embeddedGraph = (graph.embeddedGraphs ?? []).find((candidate) => candidate.id === embeddedId);
  if (!embeddedGraph) {
    return { ok: false, issues: [`Embedded graph '${embeddedId}' was not found.`] };
  }

  const projectGraph = cloneGraphWithTemplateMetadata(embeddedGraph, template);
  const nextLocalTemplates = (graph.localTemplates ?? []).filter((candidate) => candidate.id !== template.id);
  const nextEmbeddedGraphs = (graph.embeddedGraphs ?? []).filter((candidate) => candidate.id !== embeddedGraph.id);

  return {
    ok: true,
    graph: {
      ...graph,
      localTemplates: nextLocalTemplates.length ? nextLocalTemplates : undefined,
      embeddedGraphs: nextEmbeddedGraphs.length ? nextEmbeddedGraphs : undefined
    },
    projectGraph,
    projectTemplate: graphToNodeTemplate(projectGraph, projectGraphSource)
  };
}

function validateCollapseSelection(graph: BlueprintGraph, selectedNodeIds: Set<string>): string[] {
  const issues: string[] = [];
  if (!selectedNodeIds.size) {
    issues.push("Select at least one node to collapse.");
  }

  const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
  const missingCount = selectedNodeIds.size - selectedNodes.length;
  if (missingCount > 0) {
    issues.push("Selection contains nodes that are not in the graph.");
  }
  if (selectedNodes.some((node) => node.templateId === "builtin.control.entry" || node.templateId === "builtin.control.end")) {
    issues.push("Function Entry and Function End cannot be collapsed into a macro.");
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const incomingControl = graph.links.filter((link) => link.flowKind === "control" && !selectedIds.has(link.fromNodeId) && selectedIds.has(link.toNodeId));
  const outgoingControl = graph.links.filter((link) => link.flowKind === "control" && selectedIds.has(link.fromNodeId) && !selectedIds.has(link.toNodeId));
  if (incomingControl.length !== 1) {
    issues.push("Collapse to macro requires exactly one incoming control wire.");
  }
  if (outgoingControl.length > 1) {
    issues.push("Collapse to macro supports at most one outgoing control wire.");
  }
  return issues;
}

function createFunctionTemplate(
  functionId: string,
  functionName: string,
  inputs: BlueprintPortDefinition[],
  outputs: MacroOutputMapping[]
): BlueprintNodeTemplate {
  return {
    id: `graph.${functionId}`,
    name: functionName,
    creationPath: "Blueprints/Collapsed",
    description: `Collapsed function ${functionName}.`,
    inputs,
    outputs: outputs.map((entry) => entry.port),
    controlInputs: [createPort("exec", "Exec", "input", "control", "exec", "Execution input.", "none")],
    controlOutputs: [createPort("then", "Then", "output", "control", "exec", "Execution output.", "none")],
    bodyKind: "blueprintGraph",
    bodyRef: `embedded:${functionId}`,
    metadata: {
      source: `embedded:${functionId}`
    }
  };
}

function createMacroInputPorts(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  incomingData: BlueprintLink[]
): MacroInputMapping[] {
  const existingIds = new Set<string>();
  return incomingData.map((link) => {
    const targetNode = graph.nodes.find((node) => node.id === link.toNodeId);
    const targetTemplate = targetNode ? getEffectiveTemplateForNode(graph, templates, targetNode) : undefined;
    const targetPort = targetTemplate?.inputs.find((port) => port.id === link.toPortId);
    const id = uniqueId(toStableId(`${link.toNodeId}-${link.toPortId}`), existingIds);
    existingIds.add(id);
    return {
      link,
      internalLinkId: "",
      port: {
        id,
        name: targetPort?.name ?? link.toPortId,
        direction: "input",
        flowKind: "data",
        type: targetPort?.type ?? "unknown",
        description: targetPort?.description ?? `Collapsed input for ${link.toNodeId}.${link.toPortId}.`,
        editor: targetPort?.editor ?? "json",
        defaultValue: targetPort?.defaultValue
      }
    };
  });
}

function createMacroOutputPorts(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  outgoingData: BlueprintLink[]
): MacroOutputMapping[] {
  const existingIds = new Set<string>();
  return outgoingData.map((link) => {
    const sourceNode = graph.nodes.find((node) => node.id === link.fromNodeId);
    const sourceTemplate = sourceNode ? getEffectiveTemplateForNode(graph, templates, sourceNode) : undefined;
    const sourcePort = sourceTemplate?.outputs.find((port) => port.id === link.fromPortId);
    const id = uniqueId(toStableId(`${link.fromNodeId}-${link.fromPortId}`), existingIds);
    existingIds.add(id);
    return {
      link,
      source: {
        nodeId: link.fromNodeId,
        portId: link.fromPortId
      },
      port: {
        id,
        name: sourcePort?.name ?? link.fromPortId,
        direction: "output",
        flowKind: "data",
        type: sourcePort?.type ?? "unknown",
        description: sourcePort?.description ?? `Collapsed output for ${link.fromNodeId}.${link.fromPortId}.`,
        editor: "none"
      }
    };
  });
}

function createMacroTemplate(
  macroId: string,
  macroName: string,
  inputs: BlueprintPortDefinition[],
  outputs: MacroOutputMapping[]
): BlueprintNodeTemplate {
  return {
    id: `macro.${macroId}`,
    name: macroName,
    creationPath: "Macros/Collapsed",
    description: `Collapsed macro ${macroName}.`,
    inputs,
    outputs: outputs.map((entry) => entry.port),
    controlInputs: [createPort("exec", "Exec", "input", "control", "exec", "Execution input.", "none")],
    controlOutputs: [createPort("then", "Then", "output", "control", "exec", "Execution output.", "none")],
    bodyKind: "macroExpansion",
    bodyRef: `embedded:${macroId}`,
    metadata: {
      source: `embedded:${macroId}`,
      outputSources: Object.fromEntries(outputs.map((entry) => [entry.port.id, entry.source]))
    }
  };
}

function createMacroGraph(
  graph: BlueprintGraph,
  selectedNodes: BlueprintNodeInstance[],
  selectedIds: Set<string>,
  incomingControl: BlueprintLink | undefined,
  incomingData: BlueprintLink[],
  macroInputs: MacroInputMapping[],
  macroOutputs: MacroOutputMapping[],
  macroId: string,
  macroName: string
): BlueprintGraph {
  const bounds = selectedNodePositionBounds(selectedNodes);
  const entry: BlueprintNodeInstance = {
    id: "entry",
    templateId: "builtin.control.entry",
    position: { x: bounds.x - 320, y: bounds.y },
    inputBindings: {}
  };
  const internalLinks = graph.links
    .filter((link) => selectedIds.has(link.fromNodeId) && selectedIds.has(link.toNodeId))
    .map(cloneLink);
  for (const [index, link] of incomingData.entries()) {
    const macroInput = macroInputs[index];
    macroInput.internalLinkId = uniqueId(`link-entry-${link.toNodeId}-${link.toPortId}`, new Set(internalLinks.map((candidate) => candidate.id)));
    internalLinks.push({
      id: macroInput.internalLinkId,
      fromNodeId: entry.id,
      fromPortId: macroInput.port.id,
      toNodeId: link.toNodeId,
      toPortId: link.toPortId,
      flowKind: "data",
      contextVariableId: link.contextVariableId
    });
  }
  if (incomingControl) {
    internalLinks.push({
      id: uniqueId(`link-entry-${incomingControl.toNodeId}`, new Set(internalLinks.map((link) => link.id))),
      fromNodeId: entry.id,
      fromPortId: "then",
      toNodeId: incomingControl.toNodeId,
      toPortId: incomingControl.toPortId,
      flowKind: "control"
    });
  }

  return {
    format: "blueprint-graph",
    version: 1,
    kind: "macro",
    id: macroId,
    name: macroName,
    description: `Collapsed macro extracted from ${graph.name}.`,
    templateMetadata: {
      creationPath: "Macros/Collapsed",
      inputs: macroInputs.map((entry) => entry.port),
      outputs: macroOutputs.map((entry) => entry.port),
      outputSources: Object.fromEntries(macroOutputs.map((entry) => [entry.port.id, entry.source]))
    },
    nodes: [entry, ...selectedNodes.map((node) => cloneNodeForMacro(node, incomingData, macroInputs))],
    links: internalLinks,
    comments: (graph.comments ?? [])
      .filter((comment) => comment.nodeIds.some((nodeId) => selectedIds.has(nodeId)))
      .map((comment) => ({ ...comment, nodeIds: comment.nodeIds.filter((nodeId) => selectedIds.has(nodeId)) })),
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}

function embeddedGraphIdForTemplate(template: BlueprintNodeTemplate): string | undefined {
  if (template.bodyRef.startsWith("embedded:")) {
    return template.bodyRef.slice("embedded:".length);
  }
  const source = typeof template.metadata?.source === "string" ? template.metadata.source : undefined;
  return source?.startsWith("embedded:") ? source.slice("embedded:".length) : undefined;
}

function cloneGraphWithTemplateMetadata(graph: BlueprintGraph, template: BlueprintNodeTemplate): BlueprintGraph {
  return {
    ...graph,
    templateMetadata: {
      creationPath: graph.templateMetadata?.creationPath,
      inputs: (graph.templateMetadata?.inputs ?? []).map((port) => ({ ...port })),
      outputs: (graph.templateMetadata?.outputs ?? []).map((port) => ({ ...port })),
      outputSources: isOutputSourceMap(template.metadata?.outputSources)
        ? cloneOutputSourceMap(template.metadata.outputSources)
        : graph.templateMetadata?.outputSources
          ? cloneOutputSourceMap(graph.templateMetadata.outputSources)
          : undefined
    },
    nodes: graph.nodes.map(cloneNode),
    links: graph.links.map(cloneLink),
    comments: graph.comments?.map((comment) => ({ ...comment, position: { ...comment.position }, size: { ...comment.size }, nodeIds: [...comment.nodeIds] })),
    bookmarks: graph.bookmarks?.map((bookmark) => ({ ...bookmark, position: { ...bookmark.position } })),
    debug: graph.debug
      ? { ...graph.debug, breakpoints: graph.debug.breakpoints?.map((breakpoint) => ({ ...breakpoint })) }
      : undefined,
    layout: {
      viewport: { ...graph.layout.viewport }
    }
  };
}

function isOutputSourceMap(value: unknown): value is Record<string, { nodeId: string; portId: string }> {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const source = entry as Record<string, unknown>;
    return typeof source.nodeId === "string" && typeof source.portId === "string";
  });
}

function cloneOutputSourceMap(value: Record<string, { nodeId: string; portId: string }>): Record<string, { nodeId: string; portId: string }> {
  return Object.fromEntries(Object.entries(value).map(([portId, source]) => [portId, { ...source }]));
}

function createFunctionGraph(
  graph: BlueprintGraph,
  selectedNodes: BlueprintNodeInstance[],
  selectedIds: Set<string>,
  incomingControl: BlueprintLink | undefined,
  outgoingControl: BlueprintLink | undefined,
  incomingData: BlueprintLink[],
  functionInputs: MacroInputMapping[],
  functionOutputs: MacroOutputMapping[],
  functionId: string,
  functionName: string
): BlueprintGraph {
  const bounds = selectedNodePositionBounds(selectedNodes);
  const entry: BlueprintNodeInstance = {
    id: "entry",
    templateId: "builtin.control.entry",
    position: { x: bounds.x - 320, y: bounds.y },
    inputBindings: {}
  };
  const end: BlueprintNodeInstance = {
    id: "end",
    templateId: "builtin.control.end",
    position: { x: bounds.x + 360, y: bounds.y },
    inputBindings: {}
  };
  const internalLinks = graph.links
    .filter((link) => selectedIds.has(link.fromNodeId) && selectedIds.has(link.toNodeId))
    .map(cloneLink);
  for (const [index, link] of incomingData.entries()) {
    const functionInput = functionInputs[index];
    functionInput.internalLinkId = uniqueId(`link-entry-${link.toNodeId}-${link.toPortId}`, new Set(internalLinks.map((candidate) => candidate.id)));
    internalLinks.push({
      id: functionInput.internalLinkId,
      fromNodeId: entry.id,
      fromPortId: functionInput.port.id,
      toNodeId: link.toNodeId,
      toPortId: link.toPortId,
      flowKind: "data",
      contextVariableId: link.contextVariableId
    });
  }
  for (const [index, output] of functionOutputs.entries()) {
    const internalLinkId = uniqueId(`link-${output.source.nodeId}-${output.port.id}-end`, new Set(internalLinks.map((candidate) => candidate.id)));
    internalLinks.push({
      id: internalLinkId,
      fromNodeId: output.source.nodeId,
      fromPortId: output.source.portId,
      toNodeId: end.id,
      toPortId: output.port.id,
      flowKind: "data",
      contextVariableId: output.link.contextVariableId ?? `ctx-${functionId}-output-${index}`
    });
    end.inputBindings[output.port.id] = {
      portId: output.port.id,
      sourceKind: "link",
      linkId: internalLinkId
    };
  }
  if (incomingControl) {
    internalLinks.push({
      id: uniqueId(`link-entry-${incomingControl.toNodeId}`, new Set(internalLinks.map((link) => link.id))),
      fromNodeId: entry.id,
      fromPortId: "then",
      toNodeId: incomingControl.toNodeId,
      toPortId: incomingControl.toPortId,
      flowKind: "control"
    });
  }
  if (outgoingControl) {
    internalLinks.push({
      id: uniqueId(`link-${outgoingControl.fromNodeId}-end`, new Set(internalLinks.map((link) => link.id))),
      fromNodeId: outgoingControl.fromNodeId,
      fromPortId: outgoingControl.fromPortId,
      toNodeId: end.id,
      toPortId: "exec",
      flowKind: "control"
    });
  }

  return {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: functionId,
    name: functionName,
    description: `Collapsed function extracted from ${graph.name}.`,
    templateMetadata: {
      creationPath: "Blueprints/Collapsed",
      inputs: functionInputs.map((entry) => entry.port),
      outputs: functionOutputs.map((entry) => entry.port)
    },
    nodes: [entry, ...selectedNodes.map((node) => cloneNodeForMacro(node, incomingData, functionInputs)), end],
    links: internalLinks,
    comments: (graph.comments ?? [])
      .filter((comment) => comment.nodeIds.some((nodeId) => selectedIds.has(nodeId)))
      .map((comment) => ({ ...comment, nodeIds: comment.nodeIds.filter((nodeId) => selectedIds.has(nodeId)) })),
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}

function createMacroNode(
  macroNodeId: string,
  macroId: string,
  selectedNodes: BlueprintNodeInstance[],
  incomingData: BlueprintLink[],
  macroInputs: MacroInputMapping[]
): BlueprintNodeInstance {
  const bounds = selectedNodePositionBounds(selectedNodes);
  return {
    id: macroNodeId,
    templateId: `macro.${macroId}`,
    position: { x: bounds.x, y: bounds.y },
    inputBindings: Object.fromEntries(incomingData.map((link, index) => [
      macroInputs[index].port.id,
      { portId: macroInputs[index].port.id, sourceKind: "link" as const, linkId: link.id }
    ]))
  };
}

function createFunctionNode(
  functionNodeId: string,
  functionId: string,
  selectedNodes: BlueprintNodeInstance[],
  incomingData: BlueprintLink[],
  functionInputs: MacroInputMapping[]
): BlueprintNodeInstance {
  const bounds = selectedNodePositionBounds(selectedNodes);
  return {
    id: functionNodeId,
    templateId: `graph.${functionId}`,
    position: { x: bounds.x, y: bounds.y },
    inputBindings: Object.fromEntries(incomingData.map((link, index) => [
      functionInputs[index].port.id,
      { portId: functionInputs[index].port.id, sourceKind: "link" as const, linkId: link.id }
    ]))
  };
}

function updateCommentsForCollapsedSelection(
  comments: BlueprintCommentBox[] | undefined,
  selectedIds: Set<string>,
  macroNodeId: string
): BlueprintCommentBox[] | undefined {
  if (!comments) {
    return comments;
  }
  return comments.map((comment) => {
    const retained = comment.nodeIds.filter((nodeId) => !selectedIds.has(nodeId));
    return comment.nodeIds.some((nodeId) => selectedIds.has(nodeId))
      ? { ...comment, nodeIds: [...retained, macroNodeId] }
      : comment;
  });
}

function selectedNodePositionBounds(nodes: BlueprintNodeInstance[]): { x: number; y: number } {
  return {
    x: Math.min(...nodes.map((node) => node.position.x)),
    y: Math.min(...nodes.map((node) => node.position.y))
  };
}

function cloneNode(node: BlueprintNodeInstance): BlueprintNodeInstance {
  return {
    ...node,
    position: { ...node.position },
    inputBindings: Object.fromEntries(Object.entries(node.inputBindings).map(([portId, binding]) => [portId, { ...binding }])),
    controlBindings: node.controlBindings ? { ...node.controlBindings } : undefined,
    displayOverrides: node.displayOverrides ? { ...node.displayOverrides } : undefined
  };
}

function cloneNodeForMacro(
  node: BlueprintNodeInstance,
  incomingData: BlueprintLink[],
  macroInputs: MacroInputMapping[]
): BlueprintNodeInstance {
  const clone = cloneNode(node);
  for (const [index, link] of incomingData.entries()) {
    if (link.toNodeId === node.id) {
      clone.inputBindings[link.toPortId] = {
        portId: link.toPortId,
        sourceKind: "link",
        linkId: macroInputs[index].internalLinkId
      };
    }
  }
  return clone;
}

function cloneLink(link: BlueprintLink): BlueprintLink {
  return { ...link };
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
