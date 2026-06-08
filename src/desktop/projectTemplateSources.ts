import { BlueprintProject, BlueprintTemplatePackageManifest } from "../shared/blueprint";

export function addProjectTemplateSource(project: BlueprintProject, source: string): BlueprintProject {
  const normalized = normalizeTemplateSource(source);
  if (!normalized || project.templateSources.includes(normalized)) {
    return project;
  }
  return {
    ...project,
    templateSources: [...project.templateSources, normalized]
  };
}

export function removeProjectTemplateSource(project: BlueprintProject, source: string): BlueprintProject {
  const normalized = normalizeTemplateSource(source);
  return {
    ...project,
    templateSources: project.templateSources.filter((candidate) => candidate !== normalized)
  };
}

export function importProjectTemplatePackage(
  project: BlueprintProject,
  manifest: BlueprintTemplatePackageManifest
): BlueprintProject {
  const normalized = normalizeTemplatePackageManifest(manifest);
  const templateSources = mergeUnique(project.templateSources, normalized.templateSources);
  const existingPackages = project.templatePackages ?? [];
  const templatePackages = [
    normalized,
    ...existingPackages.filter((candidate) => candidate.id !== normalized.id)
  ];
  const builtinGroups = normalized.builtinGroups ?? [];
  const builtins = builtinGroups.length
    ? {
        typescriptStandardLibrary: project.builtins?.typescriptStandardLibrary ?? true,
        groups: mergeUnique(project.builtins?.groups ?? [], builtinGroups)
      }
    : project.builtins;

  return {
    ...project,
    templateSources,
    templatePackages,
    builtins
  };
}

export function normalizeTemplatePackageManifest(manifest: BlueprintTemplatePackageManifest): BlueprintTemplatePackageManifest {
  const id = manifest.id.trim();
  const name = manifest.name.trim();
  const version = manifest.version.trim();
  if (!id || !name || !version) {
    throw new Error("Template package manifests require id, name, and version.");
  }
  const templateSources = mergeUnique([], manifest.templateSources.map(normalizeTemplateSource)).filter(Boolean);
  const builtinGroups = mergeUnique([], (manifest.builtinGroups ?? []).map((group) => group.trim()).filter(Boolean));
  if (!templateSources.length && !builtinGroups.length) {
    throw new Error(`Template package '${id}' must declare templateSources or builtinGroups.`);
  }
  return {
    id,
    name,
    version,
    description: manifest.description?.trim() || undefined,
    templateSources,
    builtinGroups
  };
}

export function normalizeTemplateSource(source: string): string {
  return source.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function mergeUnique(current: string[], incoming: string[]): string[] {
  return [...current, ...incoming].filter((value, index, values) => value && values.indexOf(value) === index);
}
