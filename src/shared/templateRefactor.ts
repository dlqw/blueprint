import type { BlueprintGraph, BlueprintNodeTemplate, BlueprintPortDefinition } from "./blueprint";

export interface RetargetTemplateIdInGraphResult {
  graph: BlueprintGraph;
  changedNodeIds: string[];
}

export interface TemplateSourceRetargetPlan {
  oldSourcePath: string;
  nextSourcePath: string;
  templateIdMap: Map<string, string>;
  sourceTemplateIds: string[];
  unmatchedTemplateIds: string[];
}

export function retargetTemplateIdInGraph(
  graph: BlueprintGraph,
  oldTemplateId: string,
  nextTemplateId: string
): RetargetTemplateIdInGraphResult {
  const from = oldTemplateId.trim();
  const to = nextTemplateId.trim();
  if (!from || !to || from === to) {
    return { graph, changedNodeIds: [] };
  }

  const changedNodeIds: string[] = [];
  const nodes = graph.nodes.map((node) => {
    if (node.templateId !== from) {
      return node;
    }
    changedNodeIds.push(node.id);
    return {
      ...node,
      templateId: to
    };
  });

  return changedNodeIds.length ? { graph: { ...graph, nodes }, changedNodeIds } : { graph, changedNodeIds };
}

export function createTemplateSourceRetargetPlan(
  templates: BlueprintNodeTemplate[],
  oldSourcePath: string,
  nextSourcePath: string
): TemplateSourceRetargetPlan {
  const from = normalizeTemplateSourcePath(oldSourcePath);
  const to = normalizeTemplateSourcePath(nextSourcePath);
  const oldTemplates = templates.filter((template) => normalizeTemplateSourcePath(templateSourcePath(template)) === from);
  const nextTemplates = templates.filter((template) => normalizeTemplateSourcePath(templateSourcePath(template)) === to);
  const nextByKey = new Map(nextTemplates.map((template) => [templateSourceMatchKey(template), template]));
  const templateIdMap = new Map<string, string>();
  const unmatchedTemplateIds: string[] = [];

  for (const template of oldTemplates) {
    const candidate = nextByKey.get(templateSourceMatchKey(template));
    if (candidate && candidate.id !== template.id && templatesHaveCompatibleInterface(template, candidate)) {
      templateIdMap.set(template.id, candidate.id);
    } else {
      unmatchedTemplateIds.push(template.id);
    }
  }

  return {
    oldSourcePath: from,
    nextSourcePath: to,
    templateIdMap,
    sourceTemplateIds: oldTemplates.map((template) => template.id),
    unmatchedTemplateIds
  };
}

export function retargetTemplateSourceInGraph(
  graph: BlueprintGraph,
  templateIdMap: Map<string, string>
): RetargetTemplateIdInGraphResult {
  const changedNodeIds: string[] = [];
  const nodes = graph.nodes.map((node) => {
    const nextTemplateId = templateIdMap.get(node.templateId);
    if (!nextTemplateId) {
      return node;
    }
    changedNodeIds.push(node.id);
    return {
      ...node,
      templateId: nextTemplateId
    };
  });

  return changedNodeIds.length ? { graph: { ...graph, nodes }, changedNodeIds } : { graph, changedNodeIds };
}

export function templateSourcePath(template: BlueprintNodeTemplate | undefined): string | undefined {
  const source = template?.metadata?.source;
  if (typeof source === "string" && source) {
    return source;
  }
  const bodyRef = template?.bodyRef;
  if (template?.bodyKind === "typescriptFunction" && bodyRef?.includes("#")) {
    return bodyRef.split("#")[0];
  }
  return undefined;
}

function normalizeTemplateSourcePath(sourcePath: string | undefined): string {
  return (sourcePath ?? "").trim().replace(/\\/g, "/");
}

function templateSourceMatchKey(template: BlueprintNodeTemplate): string {
  const memberName = template.metadata?.memberName;
  if (typeof memberName === "string" && memberName.trim()) {
    return `member:${memberName.trim()}`;
  }
  const bodyMemberName = template.bodyKind === "typescriptFunction" && template.bodyRef.includes("#")
    ? template.bodyRef.split("#").at(-1)?.trim()
    : undefined;
  if (bodyMemberName) {
    return `member:${bodyMemberName}`;
  }
  return `name:${template.name.trim()}`;
}

export function templatesHaveCompatibleInterface(left: BlueprintNodeTemplate, right: BlueprintNodeTemplate): boolean {
  return portListSignature(left.inputs) === portListSignature(right.inputs) &&
    portListSignature(left.outputs) === portListSignature(right.outputs) &&
    portListSignature(left.controlInputs) === portListSignature(right.controlInputs) &&
    portListSignature(left.controlOutputs) === portListSignature(right.controlOutputs);
}

function portListSignature(ports: BlueprintPortDefinition[]): string {
  return ports.map((port) => [
    port.id,
    port.direction,
    port.flowKind,
    port.type
  ].join(":")).join("|");
}
