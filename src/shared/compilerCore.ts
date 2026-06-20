import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BlackboardDefinition, BlackboardVariable, BlueprintGraph, BlueprintLink, BlueprintNodeInstance, BlueprintNodeTemplate, ValidationIssue, sanitizeIdentifier } from "./blueprint";
import { findPort, getEffectiveTemplateForNode, validateGraph } from "./graph";

export interface CompilerPath {
  fsPath: string;
}

function joinCompilerPath(base: CompilerPath, ...parts: string[]): CompilerPath {
  return { fsPath: path.join(base.fsPath, ...parts) };
}

export interface CompileResult {
  ok: boolean;
  message: string;
  issues: ValidationIssue[];
  outputFiles: CompilerPath[];
}

export interface CompileOptions {
  blackboard?: BlackboardDefinition;
  graphSourcePaths?: Map<BlueprintGraph, string>;
  workspaceRoot?: string;
}

export async function compileGraphToProject(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  outputDirectory: CompilerPath,
  options: CompileOptions = {}
): Promise<CompileResult> {
  return compileGraphsToProject([graph], templates, outputDirectory, options);
}

export async function compileGraphsToProject(
  graphs: BlueprintGraph[],
  templates: BlueprintNodeTemplate[],
  outputDirectory: CompilerPath,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const graphLibrary = expandEmbeddedGraphs(graphs);
  const templateLibrary = mergeGraphLocalTemplates(templates, graphLibrary);
  const issues = validateGraphsForCompilation(graphLibrary, templateLibrary, options);
  if (issues.length) {
    return {
      ok: false,
      message: issues.map((issue) => formatCompileIssue(issue)).join("\n"),
      issues,
      outputFiles: []
    };
  }

  await fs.mkdir(outputDirectory.fsPath, { recursive: true });
  const runtimeUri = joinCompilerPath(outputDirectory, "runtime.ts");
  await fs.writeFile(runtimeUri.fsPath, runtimeSource(options.blackboard), "utf8");
  const graphUris: CompilerPath[] = [];
  for (const graph of graphLibrary.filter((candidate) => candidate.kind !== "macro")) {
    const graphUri = joinCompilerPath(outputDirectory, `${sanitizeIdentifier(graph.name)}.ts`);
    await fs.writeFile(graphUri.fsPath, generateGraphSource(graph, templateLibrary, outputDirectory, graphLibrary, options), "utf8");
    graphUris.push(graphUri);
  }

  return {
    ok: true,
    message: `Generated ${graphUris.length} blueprint file(s) and runtime.ts in ${outputDirectory.fsPath}.`,
    issues: [],
    outputFiles: [runtimeUri, ...graphUris]
  };
}

function expandEmbeddedGraphs(graphs: BlueprintGraph[]): BlueprintGraph[] {
  const expanded: BlueprintGraph[] = [];
  const visit = (graph: BlueprintGraph) => {
    expanded.push(graph);
    for (const embedded of graph.embeddedGraphs ?? []) {
      visit(embedded);
    }
  };
  graphs.forEach(visit);
  return expanded;
}

function mergeGraphLocalTemplates(templates: BlueprintNodeTemplate[], graphs: BlueprintGraph[]): BlueprintNodeTemplate[] {
  return [...new Map([
    ...templates,
    ...graphs.flatMap((graph) => graph.localTemplates ?? [])
  ].map((template) => [template.id, template])).values()];
}

export function validateGraphsForCompilation(
  graphs: BlueprintGraph[],
  templates: BlueprintNodeTemplate[],
  options: CompileOptions = {}
): ValidationIssue[] {
  return [
    ...graphs.flatMap((graph) => validateGraph(graph, templates).filter((issue) => issue.severity === "error").map((issue) => graphIssue(graph, issue, options))),
    ...validateGraphLibrary(graphs, templates, options).filter((issue) => issue.severity === "error"),
    ...validateBlackboardDefinition(options.blackboard).filter((issue) => issue.severity === "error"),
    ...validateBlackboardUsage(graphs, templates, options.blackboard, options).filter((issue) => issue.severity === "error")
  ];
}

function validateGraphLibrary(graphs: BlueprintGraph[], templates: BlueprintNodeTemplate[], options: CompileOptions): ValidationIssue[] {
  return [
    ...validateGraphIdentityConflicts(graphs, options),
    ...validateTemplateSignatureDrift(graphs, templates, options),
    ...validateMacroRecursion(graphs, templates, options)
  ];
}

function validateGraphIdentityConflicts(graphs: BlueprintGraph[], options: CompileOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const graphsById = new Map<string, BlueprintGraph[]>();
  const outputFiles = new Map<string, { displayName: string; graphs: BlueprintGraph[] }>();

  for (const graph of graphs) {
    graphsById.set(graph.id, [...(graphsById.get(graph.id) ?? []), graph]);

    if (graph.kind === "macro") {
      continue;
    }

    const outputName = `${sanitizeIdentifier(graph.name)}.ts`;
    const outputKey = outputName.toLowerCase();
    const existing = outputFiles.get(outputKey);
    outputFiles.set(outputKey, {
      displayName: existing?.displayName ?? outputName,
      graphs: [...(existing?.graphs ?? []), graph]
    });
  }

  for (const [id, duplicateGraphs] of graphsById.entries()) {
    if (duplicateGraphs.length <= 1) {
      continue;
    }
    for (const graph of duplicateGraphs) {
      issues.push(graphIssue(graph, { severity: "error", message: `Duplicate graph id '${id}'.` }, options));
    }
  }

  const runtimeOutput = outputFiles.get("runtime.ts");
  if (runtimeOutput) {
    for (const graph of runtimeOutput.graphs) {
      issues.push(graphIssue(graph, { severity: "error", message: "Generated graph output 'runtime.ts' is reserved for the Blueprint runtime." }, options));
    }
  }

  for (const { displayName, graphs: collidingGraphs } of outputFiles.values()) {
    if (collidingGraphs.length > 1) {
      for (const graph of collidingGraphs) {
        issues.push(graphIssue(graph, { severity: "error", message: `Generated graph output '${displayName}' is used by multiple graphs.` }, options));
      }
    }
  }

  return issues;
}

function validateBlackboardDefinition(blackboard: BlackboardDefinition | undefined): ValidationIssue[] {
  if (!blackboard) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const variable of blackboard.variables ?? []) {
    if (!variable.id.trim()) {
      issues.push({ severity: "error", message: "Blackboard variable id cannot be empty." });
    } else if (!isValidBlackboardVariableId(variable.id)) {
      issues.push({ severity: "error", message: `Blackboard variable '${variable.name}' has invalid id '${variable.id}'.` });
    }

    if (seenIds.has(variable.id)) {
      duplicateIds.add(variable.id);
    }
    seenIds.add(variable.id);

    if (!isBlackboardValueCompatible(variable.defaultValue, variable.type)) {
      issues.push({
        severity: "error",
        message: `Blackboard variable '${variable.name}' default value does not match ${variable.type}.`
      });
    }
  }

  for (const id of duplicateIds) {
    issues.push({ severity: "error", message: `Duplicate blackboard variable id '${id}'.` });
  }

  return issues;
}

function validateBlackboardUsage(
  graphs: BlueprintGraph[],
  templates: BlueprintNodeTemplate[],
  blackboard: BlackboardDefinition | undefined,
  options: CompileOptions
): ValidationIssue[] {
  if (!blackboard) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const variablesById = new Map((blackboard.variables ?? []).map((variable) => [variable.id, variable]));

  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const template = getEffectiveTemplateForNode(graph, templates, node);
      if (template?.bodyKind !== "typescriptBuiltin" || (template.bodyRef !== "blackboard.get" && template.bodyRef !== "blackboard.set")) {
        continue;
      }

      const keyBinding = node.inputBindings.key;
      if (keyBinding?.sourceKind !== "literal" || typeof keyBinding.literalValue !== "string") {
        continue;
      }

      const key = keyBinding.literalValue;
      const variable = variablesById.get(key);
      if (!variable) {
        issues.push(graphIssue(graph, {
          severity: "error",
          message: `Blackboard key '${key}' used by node '${node.id}' is not declared.`,
          nodeId: node.id,
          portId: "key"
        }, options));
        continue;
      }

      const valueBinding = node.inputBindings.value;
      if (template.bodyRef === "blackboard.set" && valueBinding?.sourceKind === "literal" && !isBlackboardValueCompatible(valueBinding.literalValue, variable.type)) {
        issues.push(graphIssue(graph, {
          severity: "error",
          message: `Blackboard key '${key}' on node '${node.id}' receives a value that does not match ${variable.type}.`,
          nodeId: node.id,
          portId: "value"
        }, options));
      }
    }
  }

  return issues;
}

function isValidBlackboardVariableId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id);
}

function isBlackboardValueCompatible(value: unknown, type: BlackboardVariable["type"]): boolean {
  switch (type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "bigint":
      return typeof value === "bigint" || (typeof value === "string" && /^-?\d+$/.test(value));
    case "null":
      return value === null;
    case "undefined":
      return value === undefined;
    case "json":
    case "unknown":
      return true;
    default:
      return false;
  }
}

function validateTemplateSignatureDrift(graphs: BlueprintGraph[], templates: BlueprintNodeTemplate[], options: CompileOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const template of templates.filter((candidate) => candidate.bodyKind === "blueprintGraph" || candidate.bodyKind === "macroExpansion")) {
    const graph = findGraphForTemplate(graphs, template);
    if (!graph) {
      continue;
    }
    const metadata = graph.templateMetadata;
    if (!metadata) {
      continue;
    }
    if (!samePortSignature(template.inputs, metadata.inputs) || !samePortSignature(template.outputs, metadata.outputs)) {
      issues.push(graphIssue(graph, {
        severity: "error",
        message: `Template '${template.name}' does not match the signature of graph '${graph.name}'.`
      }, options));
    }
  }
  return issues;
}

function validateMacroRecursion(graphs: BlueprintGraph[], templates: BlueprintNodeTemplate[], options: CompileOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const reported = new Set<string>();
  const macroGraphs = graphs.filter((graph) => graph.kind === "macro");

  const visit = (graph: BlueprintGraph, stack: BlueprintGraph[]) => {
    const cycleStart = stack.findIndex((candidate) => candidate.id === graph.id);
    if (cycleStart >= 0) {
      const cycle = [...stack.slice(cycleStart), graph].map((candidate) => candidate.name).join(" -> ");
      if (!reported.has(cycle)) {
        reported.add(cycle);
        issues.push(graphIssue(graph, { severity: "error", message: `Macro recursion detected: ${cycle}.` }, options));
      }
      return;
    }

    for (const node of graph.nodes) {
      const template = getEffectiveTemplateForNode(graph, templates, node);
      if (template?.bodyKind !== "macroExpansion") {
        continue;
      }
      const target = findGraphForTemplate(macroGraphs, template);
      if (target) {
        visit(target, [...stack, graph]);
      }
    }
  };

  for (const graph of macroGraphs) {
    visit(graph, []);
  }
  return issues;
}

function graphIssue(graph: BlueprintGraph, issue: ValidationIssue, options: CompileOptions): ValidationIssue {
  return {
    ...issue,
    graphId: issue.graphId ?? graph.id,
    graphName: issue.graphName ?? graph.name,
    sourcePath: issue.sourcePath ?? options.graphSourcePaths?.get(graph)
  };
}

export function formatCompileIssue(issue: ValidationIssue): string {
  const location = [
    issue.sourcePath,
    issue.graphName || issue.graphId,
    issue.nodeId ? `node ${issue.nodeId}` : "",
    issue.linkId ? `link ${issue.linkId}` : "",
    issue.portId ? `port ${issue.portId}` : ""
  ].filter(Boolean).join(" | ");
  return location ? `[${location}] ${issue.message}` : issue.message;
}

function samePortSignature(templatePorts: BlueprintNodeTemplate["inputs"], graphPorts: BlueprintNodeTemplate["inputs"]): boolean {
  if (templatePorts.length !== graphPorts.length) {
    return false;
  }
  return templatePorts.every((port, index) => {
    const graphPort = graphPorts[index];
    return graphPort && port.id === graphPort.id && port.type === graphPort.type && port.flowKind === graphPort.flowKind;
  });
}

interface CompilerContext {
  graph: BlueprintGraph;
  templates: BlueprintNodeTemplate[];
  outputDirectory: CompilerPath;
  graphLibrary: BlueprintGraph[];
  importAliases: Map<string, string>;
  graphAliases: Map<string, string>;
  controlFlow: ControlFlowPlan;
  macroInputs?: Map<string, string>;
}

interface ControlFlowPlan {
  nextByNodeAndPort: Map<string, BlueprintNodeInstance>;
  successorsByNode: Map<string, BlueprintNodeInstance[]>;
}

function generateGraphSource(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  outputDirectory: CompilerPath,
  graphLibrary: BlueprintGraph[],
  options: CompileOptions
): string {
  const functionName = sanitizeIdentifier(graph.name);
  const context: CompilerContext = {
    graph,
    templates,
    outputDirectory,
    graphLibrary,
    importAliases: collectTypeScriptImports(graphLibrary, templates, outputDirectory, options.workspaceRoot),
    graphAliases: collectGraphImports(graph, templates),
    controlFlow: buildControlFlowPlan(graph)
  };
  const imports = [
    "import { BlueprintBlackboard, createDefaultBlackboard, traceBlueprintError, traceBlueprintNode, traceBlueprintSkipped } from \"./runtime\";",
    "import { pathToFileURL } from \"node:url\";",
    ...[...context.importAliases.entries()].map(([bodyRef, alias]) => {
      const template = templates.find((candidate) => candidate.bodyRef === bodyRef);
      return `import { ${String(template?.metadata?.exportName ?? "unknown")} as ${alias} } from "${importPathForTemplate(template, outputDirectory, options.workspaceRoot)}";`;
    }),
    ...[...context.graphAliases.entries()].map(([bodyRef, alias]) => {
      const template = templates.find((candidate) => candidate.bodyRef === bodyRef);
      const exportName = sanitizeIdentifier(template?.name ?? "blueprint");
      return `import { ${exportName} as ${alias} } from "./${exportName}";`;
    })
  ];
  const lines = [
    ...imports,
    "",
    `export async function ${functionName}(${parameterListForGraph(graph)}): ${returnTypeForGraph(graph)} {`
  ];

  const emitted = new Set<string>();
  const entry = graph.nodes.find((node) => node.templateId === "builtin.control.entry") ?? graph.nodes[0];
  emitFromNode(entry, context, lines, emitted, "  ", "return");

  lines.push("}");
  lines.push("");
  lines.push("if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {");
  lines.push(`  ${functionName}().catch((error) => {`);
  lines.push("    traceBlueprintError(error);");
  lines.push("    console.error(error);");
  lines.push("    process.exitCode = 1;");
  lines.push("  });");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function parameterListForGraph(graph: BlueprintGraph): string {
  const parameters = ["blackboard: BlueprintBlackboard = createDefaultBlackboard()"];
  for (const input of graph.templateMetadata?.inputs ?? []) {
    parameters.push(`${sanitizeIdentifier(input.id, "input")}: ${typeScriptType(input.type)} = ${literalExpression(input.defaultValue ?? defaultValueForType(input.type))}`);
  }
  return parameters.join(", ");
}

function returnTypeForGraph(graph: BlueprintGraph): string {
  const outputs = graph.templateMetadata?.outputs ?? [];
  if (!outputs.length) {
    return "Promise<void>";
  }
  if (outputs.length === 1) {
    return `Promise<${typeScriptType(outputs[0].type)}>`;
  }
  const properties = outputs.map((output) => `${sanitizeIdentifier(output.id, "output")}: ${typeScriptType(output.type)}`).join("; ");
  return `Promise<{ ${properties} }>`;
}

function emitFromNode(
  node: BlueprintNodeInstance | undefined,
  context: CompilerContext,
  lines: string[],
  emitted: Set<string>,
  indent: string,
  endMode: "return" | "stop"
): void {
  if (!node || emitted.has(node.id)) {
    return;
  }
  emitted.add(node.id);

  const template = getEffectiveTemplateForNode(context.graph, context.templates, node);
  if (!template) {
    lines.push(`${indent}// Missing template: ${node.templateId}`);
    return;
  }

  if (isNodeDisabled(node) && template.bodyRef !== "control.entry" && template.bodyRef !== "control.end") {
    lines.push(`${indent}// Node ${node.id}: ${template.name} (disabled)`);
    lines.push(`${indent}await traceBlueprintSkipped(${JSON.stringify(context.graph.id)}, ${JSON.stringify(node.id)}, ${JSON.stringify(template.name)});`);
    emitFromNode(findNextNode(context, node), context, lines, emitted, indent, endMode);
    return;
  }

  lines.push(`${indent}// Node ${node.id}: ${template.name}`);
  lines.push(`${indent}await traceBlueprintNode(${JSON.stringify(context.graph.id)}, ${JSON.stringify(node.id)}, ${JSON.stringify(template.name)}${traceContextArgument(node, template, context)});`);
  switch (template.bodyRef) {
    case "control.entry":
      break;
    case "routing.controlHub":
      break;
    case "control.end":
      if (endMode === "return") {
        emitReturnForEndNode(node, context, lines, indent);
      }
      return;
    case "console.log":
      lines.push(`${indent}console.log(${expressionForInput(node, "message", context)});`);
      break;
    case "blackboard.set":
      lines.push(`${indent}blackboard.set(${expressionForInput(node, "key", context)}, ${expressionForInput(node, "value", context)});`);
      break;
    case "control.branch": {
      const trueNode = findNextNode(context, node, "true");
      const falseNode = findNextNode(context, node, "false");
      const conditionName = `__branch_${sanitizeIdentifier(node.id, "branch")}`;
      lines.push(`${indent}const ${conditionName} = Boolean(${expressionForInput(node, "condition", context)});`);
      lines.push(`${indent}if (${conditionName}) {`);
      emitSkippedPathTrace(falseNode, context, lines, `${indent}  `);
      emitFromNode(trueNode, context, lines, new Set(emitted), `${indent}  `, endMode);
      lines.push(`${indent}} else {`);
      emitSkippedPathTrace(trueNode, context, lines, `${indent}  `);
      emitFromNode(falseNode, context, lines, new Set(emitted), `${indent}  `, endMode);
      lines.push(`${indent}}`);
      return;
    }
    case "control.forRange": {
      const loopNode = findNextNode(context, node, "loop");
      const completedNode = findNextNode(context, node, "completed");
      lines.push(`${indent}for (let index = ${expressionForInput(node, "start", context)}; index < ${expressionForInput(node, "end", context)}; index += 1) {`);
      emitFromNode(loopNode, context, lines, new Set(emitted), `${indent}  `, endMode);
      lines.push(`${indent}}`);
      emitFromNode(completedNode, context, lines, emitted, indent, endMode);
      return;
    }
    default:
      if (template.bodyKind === "macroExpansion") {
        emitMacroExpansion(node, template, context, lines, indent);
        break;
      }
      if (template.bodyKind === "blueprintGraph") {
        const call = callExpressionForTemplateNode(node, template, context);
        if (template.outputs.length) {
          lines.push(`${indent}const ${resultVariableForNode(node)} = await ${call};`);
        } else {
          lines.push(`${indent}await ${call};`);
        }
        break;
      }
      if (template.controlInputs.length || template.controlOutputs.length) {
        lines.push(`${indent}// ${template.bodyRef} is not implemented yet.`);
      }
      break;
  }

  emitFromNode(findNextNode(context, node), context, lines, emitted, indent, endMode);
}

function emitSkippedPathTrace(
  node: BlueprintNodeInstance | undefined,
  context: CompilerContext,
  lines: string[],
  indent: string,
  visited = new Set<string>()
): void {
  if (!node || visited.has(node.id)) {
    return;
  }
  visited.add(node.id);

  const template = getEffectiveTemplateForNode(context.graph, context.templates, node);
  if (!template) {
    return;
  }
  lines.push(`${indent}await traceBlueprintSkipped(${JSON.stringify(context.graph.id)}, ${JSON.stringify(node.id)}, ${JSON.stringify(template.name)});`);

  for (const successor of context.controlFlow.successorsByNode.get(node.id) ?? []) {
    emitSkippedPathTrace(successor, context, lines, indent, visited);
  }
}

function traceContextArgument(node: BlueprintNodeInstance, template: BlueprintNodeTemplate, context: CompilerContext): string {
  if (!template.inputs.length) {
    return "";
  }
  const entries = template.inputs.map((port) => `${JSON.stringify(port.id)}: ${expressionForInput(node, port.id, context)}`);
  return `, { ${entries.join(", ")} }`;
}

function emitMacroExpansion(
  node: BlueprintNodeInstance,
  template: BlueprintNodeTemplate,
  context: CompilerContext,
  lines: string[],
  indent: string
): void {
  const macroGraph = findGraphForTemplate(context.graphLibrary, template);
  if (!macroGraph) {
    lines.push(`${indent}// Missing macro graph: ${template.bodyRef}`);
    return;
  }

  lines.push(`${indent}// Macro ${node.id}: ${template.name}`);
  const macroInputs = new Map(template.inputs.map((port) => [port.id, expressionForInput(node, port.id, context)]));
  const macroEntry = macroGraph.nodes.find((candidate) => candidate.templateId === "builtin.control.entry") ?? macroGraph.nodes[0];
  emitFromNode(macroEntry, { ...context, graph: macroGraph, controlFlow: buildControlFlowPlan(macroGraph), macroInputs }, lines, new Set<string>(), indent, "stop");
}

function buildControlFlowPlan(graph: BlueprintGraph): ControlFlowPlan {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nextByNodeAndPort = new Map<string, BlueprintNodeInstance>();
  const successorsByNode = new Map<string, BlueprintNodeInstance[]>();
  for (const link of graph.links) {
    if (link.flowKind !== "control") {
      continue;
    }
    const next = nodesById.get(link.toNodeId);
    if (next) {
      nextByNodeAndPort.set(controlFlowKey(link.fromNodeId, link.fromPortId), next);
      nextByNodeAndPort.set(controlFlowKey(link.fromNodeId), next);
      const successors = successorsByNode.get(link.fromNodeId) ?? [];
      successors.push(next);
      successorsByNode.set(link.fromNodeId, successors);
    }
  }
  return { nextByNodeAndPort, successorsByNode };
}

function findNextNode(context: CompilerContext, node: BlueprintNodeInstance, fromPortId?: string): BlueprintNodeInstance | undefined {
  return context.controlFlow.nextByNodeAndPort.get(controlFlowKey(node.id, fromPortId));
}

function controlFlowKey(nodeId: string, portId = "then"): string {
  return `${nodeId}.${portId}`;
}

function readInput(node: BlueprintNodeInstance, portId: string): unknown {
  return node.inputBindings[portId]?.literalValue;
}

function expressionForInput(node: BlueprintNodeInstance, portId: string, context: CompilerContext): string {
  const targetType = getEffectiveTemplateForNode(context.graph, context.templates, node)?.inputs.find((port) => port.id === portId)?.type;
  const binding = node.inputBindings[portId];
  if (binding?.sourceKind === "link" && binding.linkId) {
    const link = context.graph.links.find((candidate) => candidate.id === binding.linkId);
    if (link) {
      return coerceExpression(expressionForLink(link, context), targetType);
    }
  }

  const incomingLink = context.graph.links.find((candidate) => candidate.flowKind === "data" && candidate.toNodeId === node.id && candidate.toPortId === portId);
  if (incomingLink) {
    return coerceExpression(expressionForLink(incomingLink, context), targetType);
  }

  return literalExpression(readInput(node, portId));
}

function coerceExpression(expression: string, targetType: string | undefined): string {
  switch (targetType) {
    case "number":
      return `Number(${expression})`;
    case "string":
      return `String(${expression})`;
    case "boolean":
      return `Boolean(${expression})`;
    default:
      return expression;
  }
}

function expressionForLink(link: BlueprintLink, context: CompilerContext): string {
  const sourceNode = context.graph.nodes.find((node) => node.id === link.fromNodeId);
  if (!sourceNode) {
    return "undefined";
  }
  return expressionForNodeOutput(sourceNode, link.fromPortId, context);
}

function expressionForNodeOutput(node: BlueprintNodeInstance, outputPortId: string, context: CompilerContext): string {
  const template = getEffectiveTemplateForNode(context.graph, context.templates, node);
  if (!template) {
    return "undefined";
  }
  if (isNodeDisabled(node)) {
    const output = template.outputs.find((port) => port.id === outputPortId);
    return literalExpression(defaultValueForType(output?.type ?? "unknown"));
  }

  switch (template.bodyRef) {
    case "control.entry":
      return context.macroInputs?.get(outputPortId) ?? sanitizeIdentifier(outputPortId, "input");
    case "math.add":
      return `(${expressionForInput(node, "a", context)} + ${expressionForInput(node, "b", context)})`;
    case "Math.min(Math.max(value, min), max)":
      return `Math.min(Math.max(${expressionForInput(node, "value", context)}, ${expressionForInput(node, "min", context)}), ${expressionForInput(node, "max", context)})`;
    case "string.concat":
      return `String(${expressionForInput(node, "a", context)}) + String(${expressionForInput(node, "b", context)})`;
    case "JSON.stringify":
      return `JSON.stringify(${expressionForInput(node, "value", context)})`;
    case "blackboard.get":
      return `blackboard.get(${expressionForInput(node, "key", context)})`;
    case "control.forRange":
      return outputPortId === "index" ? "index" : "undefined";
    case "routing.dataHub":
      return expressionForInput(node, "value", context);
    default:
      break;
  }

  if (template.bodyKind === "typescriptFunction") {
    return callExpressionForTemplateNode(node, template, context);
  }

  if (template.bodyKind === "blueprintGraph") {
    const call = isControlFlowNode(node, context)
      ? resultVariableForNode(node)
      : `(await ${callExpressionForTemplateNode(node, template, context)})`;
    if (template.outputs.length > 1) {
      const output = template.outputs.find((port) => port.id === outputPortId);
      return output ? `${call}.${sanitizeIdentifier(output.id, "output")}` : "undefined";
    }
    return call;
  }

  if (template.bodyKind === "macroExpansion") {
    const macroGraph = findGraphForTemplate(context.graphLibrary, template);
    const outputSource = macroOutputSource(template, outputPortId);
    const sourceNode = macroGraph?.nodes.find((candidate) => candidate.id === outputSource?.nodeId);
    if (macroGraph && outputSource && sourceNode) {
      const macroInputs = new Map(template.inputs.map((port) => [port.id, expressionForInput(node, port.id, context)]));
      return expressionForNodeOutput(sourceNode, outputSource.portId, {
        ...context,
        graph: macroGraph,
        controlFlow: buildControlFlowPlan(macroGraph),
        macroInputs
      });
    }
  }

  return outputPortId ? "undefined" : "undefined";
}

function macroOutputSource(template: BlueprintNodeTemplate, outputPortId: string): { nodeId: string; portId: string } | undefined {
  const outputSources = template.metadata?.outputSources;
  if (!outputSources || typeof outputSources !== "object") {
    return undefined;
  }
  const candidate = (outputSources as Record<string, unknown>)[outputPortId];
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  return typeof record.nodeId === "string" && typeof record.portId === "string"
    ? { nodeId: record.nodeId, portId: record.portId }
    : undefined;
}

function emitReturnForEndNode(node: BlueprintNodeInstance, context: CompilerContext, lines: string[], indent: string): void {
  const outputs = context.graph.templateMetadata?.outputs ?? [];
  if (!outputs.length) {
    lines.push(`${indent}return;`);
    return;
  }

  if (outputs.length === 1) {
    lines.push(`${indent}return ${expressionForInput(node, outputs[0].id, context)};`);
    return;
  }

  const properties = outputs.map((output) => `${sanitizeIdentifier(output.id, "output")}: ${expressionForInput(node, output.id, context)}`).join(", ");
  lines.push(`${indent}return { ${properties} };`);
}

function callExpressionForTemplateNode(node: BlueprintNodeInstance, template: BlueprintNodeTemplate, context: CompilerContext): string {
  const args = template.inputs.map((port) => expressionForInput(node, port.id, context)).join(", ");

  if (template.bodyKind === "typescriptFunction") {
    const alias = context.importAliases.get(template.bodyRef);
    const memberName = typeof template.metadata?.memberName === "string" ? template.metadata.memberName : undefined;
    return memberName ? `${alias ?? sanitizeIdentifier(template.name)}.${memberName}(${args})` : `${alias ?? sanitizeIdentifier(template.name)}(${args})`;
  }

  const alias = context.graphAliases.get(template.bodyRef) ?? sanitizeIdentifier(template.name);
  const suffix = args ? `, ${args}` : "";
  return `${alias}(blackboard${suffix})`;
}

function resultVariableForNode(node: BlueprintNodeInstance): string {
  return `__${sanitizeIdentifier(node.id, "node")}_result`;
}

function isControlFlowNode(node: BlueprintNodeInstance, context: CompilerContext): boolean {
  return context.graph.links.some((link) => link.flowKind === "control" && (link.fromNodeId === node.id || link.toNodeId === node.id));
}

function isNodeDisabled(node: BlueprintNodeInstance): boolean {
  return node.displayOverrides?.disabled === true;
}

function findGraphForTemplate(graphs: BlueprintGraph[], template: BlueprintNodeTemplate): BlueprintGraph | undefined {
  const source = typeof template.metadata?.source === "string" ? template.metadata.source : template.bodyRef;
  return graphs.find((graph) => graph.id === template.id.replace(/^(graph|macro)\./, "") || graph.name === template.name || source.endsWith(`${graph.id}.bpgraph`));
}

function literalExpression(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function typeScriptType(type: string): string {
  switch (type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "bigint":
      return "bigint";
    case "null":
      return "null";
    case "undefined":
    case "exec":
      return "void";
    case "json":
      return "unknown";
    default:
      return "unknown";
  }
}

function defaultValueForType(type: string): unknown {
  switch (type) {
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

function collectGraphImports(graph: BlueprintGraph, templates: BlueprintNodeTemplate[]): Map<string, string> {
  const imports = new Map<string, string>();
  for (const node of graph.nodes) {
    const template = getEffectiveTemplateForNode(graph, templates, node);
    if (template?.bodyKind !== "blueprintGraph" || template.name === graph.name) {
      continue;
    }
    imports.set(template.bodyRef, `${sanitizeIdentifier(template.name)}_${imports.size}`);
  }
  return imports;
}

function collectTypeScriptImports(
  graphs: BlueprintGraph[],
  templates: BlueprintNodeTemplate[],
  outputDirectory: CompilerPath,
  workspaceRoot?: string
): Map<string, string> {
  const imports = new Map<string, string>();
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const template = getEffectiveTemplateForNode(graph, templates, node);
      if (template?.bodyKind === "typescriptFunction" && importPathForTemplate(template, outputDirectory, workspaceRoot)) {
        imports.set(template.bodyRef, `${sanitizeIdentifier(template.name)}_${imports.size}`);
      }
    }
  }
  return imports;
}

function importPathForTemplate(template: BlueprintNodeTemplate | undefined, outputDirectory: CompilerPath, workspaceRoot?: string): string {
  const source = typeof template?.metadata?.source === "string" ? template.metadata.source : undefined;
  if (!source) {
    return "";
  }

  const absoluteSource = path.isAbsolute(source) ? source : path.resolve(workspaceRoot ?? process.cwd(), source);
  const relative = path.relative(outputDirectory.fsPath, absoluteSource).replace(/\\/g, "/").replace(/\.tsx?$/, "");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

export function describeGraph(graph: BlueprintGraph, templates: BlueprintNodeTemplate[]): string {
  const lines = [`Blueprint ${graph.name}`, ""];
  for (const node of graph.nodes) {
    const template = getEffectiveTemplateForNode(graph, templates, node);
    lines.push(`- ${node.id}: ${template?.name ?? node.templateId}`);
  }

  for (const link of graph.links) {
    lines.push(`- link ${describeLink(link, graph, templates)}`);
  }

  return lines.join("\n");
}

function describeLink(link: BlueprintLink, graph: BlueprintGraph, templates: BlueprintNodeTemplate[]): string {
  const fromNode = graph.nodes.find((node) => node.id === link.fromNodeId);
  const toNode = graph.nodes.find((node) => node.id === link.toNodeId);
  const fromTemplate = fromNode ? getEffectiveTemplateForNode(graph, templates, fromNode) : undefined;
  const toTemplate = toNode ? getEffectiveTemplateForNode(graph, templates, toNode) : undefined;
  const fromPort = fromTemplate ? findPort(fromTemplate, link.fromPortId) : undefined;
  const toPort = toTemplate ? findPort(toTemplate, link.toPortId) : undefined;
  return `${fromNode?.id ?? "?"}.${fromPort?.name ?? link.fromPortId} -> ${toNode?.id ?? "?"}.${toPort?.name ?? link.toPortId}`;
}

function runtimeSource(blackboard?: BlackboardDefinition): string {
  const initializers = (blackboard?.variables ?? [])
    .map((variable) => `  blackboard.set(${JSON.stringify(variable.id)}, ${literalExpression(variable.defaultValue)});`)
    .join("\n");

  return `export class BlueprintBlackboard {
  private readonly values = new Map<string, unknown>();

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

export function createDefaultBlackboard(): BlueprintBlackboard {
  const blackboard = new BlueprintBlackboard();
${initializers}
  return blackboard;
}

const tracePrefix = "__BLUEPRINT_TRACE__";
let activeTraceNode: { graphId: string; nodeId: string; nodeName: string } | undefined;
const breakpointHits = new Map<string, number>();
type TraceContext = Record<string, unknown>;
let pendingStepResolvers: Array<() => void> = [];
let stdinStarted = false;
let continueRuntime = false;

interface TraceBreakpoint {
  nodeId: string;
  enabled?: boolean;
  condition?: string;
}

export async function traceBlueprintNode(graphId: string, nodeId: string, nodeName: string, context: TraceContext = {}): Promise<void> {
  if (process.env.BLUEPRINT_TRACE !== "1") {
    return;
  }
  activeTraceNode = { graphId, nodeId, nodeName };
  console.error(\`\${tracePrefix}\${JSON.stringify({ graphId, nodeId, nodeName, status: "visited", context, timestamp: Date.now() })}\`);
  await waitForRuntimeStep(graphId, nodeId, nodeName, context);
  const breakpoint = traceBlueprintBreakpoint(graphId, nodeId, nodeName, context);
  if (breakpoint) {
    activeTraceNode = undefined;
    const conditionSuffix = breakpoint.condition ? \` (\${breakpoint.condition})\` : "";
    const message = \`Breakpoint hit at \${nodeName}\${conditionSuffix}\`;
    console.error(\`\${tracePrefix}\${JSON.stringify({ graphId, nodeId, nodeName, status: "breakpoint", message, context, timestamp: Date.now() })}\`);
    throw new Error(message);
  }
}

export async function traceBlueprintSkipped(graphId: string, nodeId: string, nodeName: string): Promise<void> {
  if (process.env.BLUEPRINT_TRACE !== "1") {
    return;
  }
  console.error(\`\${tracePrefix}\${JSON.stringify({ graphId, nodeId, nodeName, status: "skipped", timestamp: Date.now() })}\`);
  await waitForRuntimeStep(graphId, nodeId, nodeName);
}

async function waitForRuntimeStep(graphId: string, nodeId: string, nodeName: string, context: TraceContext = {}): Promise<void> {
  if (process.env.BLUEPRINT_STEP !== "1") {
    return;
  }
  startStepInput();
  if (continueRuntime) {
    return;
  }
  process.stdin.ref?.();
  process.stdin.resume();
  console.error(\`\${tracePrefix}\${JSON.stringify({ graphId, nodeId, nodeName, status: "paused", context, timestamp: Date.now() })}\`);
  await new Promise<void>((resolve) => pendingStepResolvers.push(resolve));
  process.stdin.pause();
  process.stdin.unref?.();
}

function startStepInput(): void {
  if (stdinStarted) {
    return;
  }
  stdinStarted = true;
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  let commandRemainder = "";
  process.stdin.on("data", (chunk) => {
    commandRemainder = \`\${commandRemainder}\${String(chunk)}\`;
    const commands = commandRemainder.split(/\\r?\\n/);
    commandRemainder = commands.pop() ?? "";
    for (const rawCommand of commands) {
      const command = rawCommand.trim().toLowerCase();
      if (command === "continue" || command === "resume") {
        continueRuntime = true;
        while (pendingStepResolvers.length) {
          pendingStepResolvers.shift()?.();
        }
        process.stdin.pause();
        process.stdin.unref?.();
        process.stdin.removeAllListeners("data");
        return;
      }
      if (command === "step") {
        pendingStepResolvers.shift()?.();
        if (!pendingStepResolvers.length) {
          process.stdin.pause();
          process.stdin.unref?.();
        }
      }
    }
  });
}

function traceBlueprintBreakpoint(graphId: string, nodeId: string, nodeName: string, context: TraceContext): TraceBreakpoint | undefined {
  if (!process.env.BLUEPRINT_BREAKPOINTS) {
    return undefined;
  }
  try {
    const breakpoints = JSON.parse(process.env.BLUEPRINT_BREAKPOINTS) as unknown;
    if (!Array.isArray(breakpoints)) {
      return undefined;
    }
    const hitCount = (breakpointHits.get(nodeId) ?? 0) + 1;
    breakpointHits.set(nodeId, hitCount);
    for (const candidate of breakpoints) {
      const breakpoint = normalizeTraceBreakpoint(candidate);
      if (!breakpoint || breakpoint.nodeId !== nodeId || breakpoint.enabled === false) {
        continue;
      }
      if (matchesTraceBreakpointCondition(breakpoint.condition, hitCount, graphId, nodeId, nodeName, context)) {
        return breakpoint;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function normalizeTraceBreakpoint(value: unknown): TraceBreakpoint | undefined {
  if (typeof value === "string") {
    return value ? { nodeId: value } : undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.nodeId !== "string" || !record.nodeId) {
    return undefined;
  }
  return {
    nodeId: record.nodeId,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    condition: typeof record.condition === "string" ? record.condition.trim() || undefined : undefined
  };
}

function matchesTraceBreakpointCondition(condition: string | undefined, hitCount: number, graphId: string, nodeId: string, nodeName: string, context: TraceContext): boolean {
  const normalized = condition?.trim();
  if (!normalized) {
    return true;
  }
  if (normalized === nodeId || normalized === nodeName || normalized === graphId) {
    return true;
  }
  const comparison = /^(?:hit|hits)?\\s*(>=|<=|==|=|>|<)\\s*(\\d+)$/.exec(normalized);
  if (comparison) {
    return compareBreakpointHitCount(hitCount, comparison[1], Number(comparison[2]));
  }
  const every = /^every\\s+(\\d+)$/.exec(normalized);
  if (every) {
    const interval = Number(every[1]);
    return interval > 0 && hitCount % interval === 0;
  }
  return matchesTraceContextCondition(normalized, context);
}

function compareBreakpointHitCount(hitCount: number, operator: string, expected: number): boolean {
  switch (operator) {
    case ">":
      return hitCount > expected;
    case ">=":
      return hitCount >= expected;
    case "<":
      return hitCount < expected;
    case "<=":
      return hitCount <= expected;
    case "=":
    case "==":
      return hitCount === expected;
    default:
      return false;
  }
}

function matchesTraceContextCondition(condition: string, context: TraceContext): boolean {
  const method = /^([A-Za-z_$][\\w$.-]*)\\.(includes|contains|startsWith|endsWith)\\((["'\`])([\\s\\S]*)\\3\\)$/.exec(condition);
  if (method) {
    const value = readTraceContextValue(context, method[1]);
    const expected = method[4];
    if (typeof value === "string") {
      if (method[2] === "contains" || method[2] === "includes") {
        return value.includes(expected);
      }
      if (method[2] === "startsWith") {
        return value.startsWith(expected);
      }
      if (method[2] === "endsWith") {
        return value.endsWith(expected);
      }
    }
    if (Array.isArray(value) && (method[2] === "contains" || method[2] === "includes")) {
      return value.includes(expected);
    }
    return false;
  }

  const comparison = /^([A-Za-z_$][\\w$.-]*)\\s*(===|!==|==|!=|>=|<=|>|<)\\s*(.+)$/.exec(condition);
  if (comparison) {
    const left = readTraceContextValue(context, comparison[1]);
    const right = parseTraceConditionLiteral(comparison[3]);
    return compareTraceValues(left, comparison[2], right);
  }

  const truthy = /^!?[A-Za-z_$][\\w$.-]*$/.exec(condition);
  if (truthy) {
    const negate = condition.startsWith("!");
    const key = negate ? condition.slice(1) : condition;
    const value = Boolean(readTraceContextValue(context, key));
    return negate ? !value : value;
  }

  return false;
}

function readTraceContextValue(context: TraceContext, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in value) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, context);
}

function parseTraceConditionLiteral(raw: string): unknown {
  const value = raw.trim();
  const quoted = /^(["'\`])([\\s\\S]*)\\1$/.exec(value);
  if (quoted) {
    return quoted[2];
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (/^-?\\d+(?:\\.\\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function compareTraceValues(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case "===":
    case "==":
      return Object.is(left, right);
    case "!==":
    case "!=":
      return !Object.is(left, right);
    case ">":
      return typeof left === "number" && typeof right === "number" && left > right;
    case ">=":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "<":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "<=":
      return typeof left === "number" && typeof right === "number" && left <= right;
    default:
      return false;
  }
}

export function traceBlueprintError(error: unknown): void {
  if (process.env.BLUEPRINT_TRACE !== "1" || !activeTraceNode) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(\`\${tracePrefix}\${JSON.stringify({ ...activeTraceNode, status: "error", message, timestamp: Date.now() })}\`);
}
`;
}
