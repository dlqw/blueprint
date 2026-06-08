import { BlueprintGraph, BlueprintProject } from "../shared/blueprint";

export function isBlueprintGraph(value: unknown): value is BlueprintGraph {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { format?: unknown }).format === "blueprint-graph" &&
      Array.isArray((value as { nodes?: unknown }).nodes) &&
      Array.isArray((value as { links?: unknown }).links)
  );
}

export function isBlueprintProject(value: unknown): value is BlueprintProject {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { format?: unknown }).format === "blueprint-project" &&
      Array.isArray((value as { graphs?: unknown }).graphs) &&
      Array.isArray((value as { templateSources?: unknown }).templateSources)
  );
}
