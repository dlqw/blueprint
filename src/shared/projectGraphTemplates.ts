import { BlueprintGraph, BlueprintNodeTemplate, createPort } from "./blueprint";

export function graphToNodeTemplate(graph: BlueprintGraph, sourcePath?: string): BlueprintNodeTemplate {
  const isMacro = graph.kind === "macro";
  const outputSources = graph.templateMetadata?.outputSources;
  const metadata: Record<string, unknown> = sourcePath ? { source: normalizeTemplateSource(sourcePath) } : {};
  if (isMacro && outputSources) {
    metadata.outputSources = outputSources;
  }

  return {
    id: `${isMacro ? "macro" : "graph"}.${graph.id}`,
    name: graph.name,
    creationPath: graph.templateMetadata?.creationPath ?? (isMacro ? "Macros" : "Blueprints"),
    description: graph.description,
    inputs: graph.templateMetadata?.inputs ?? [],
    outputs: graph.templateMetadata?.outputs ?? [],
    controlInputs: [createPort("exec", "Exec", "input", "control", "exec", "Execution input.", "none")],
    controlOutputs: [createPort("then", "Then", "output", "control", "exec", "Execution output.", "none")],
    bodyKind: isMacro ? "macroExpansion" : "blueprintGraph",
    bodyRef: sourcePath ? normalizeTemplateSource(sourcePath) : `${isMacro ? "macro" : "graph"}:${graph.id}`,
    metadata
  };
}

function normalizeTemplateSource(sourcePath: string): string {
  return sourcePath.replace(/\\/g, "/");
}
