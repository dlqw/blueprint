import { describe, expect, it } from "vitest";
import { BlueprintProject } from "../shared/blueprint";
import {
  addProjectTemplateSource,
  importProjectTemplatePackage,
  normalizeTemplatePackageManifest,
  normalizeTemplateSource,
  removeProjectTemplateSource
} from "./projectTemplateSources";

const project: BlueprintProject = {
  format: "blueprint-project",
  version: 1,
  name: "Gameplay",
  graphs: ["graphs/main.bpgraph"],
  templateSources: ["src/**/*.ts"],
  compiler: {
    outDir: "generated",
    module: "ESNext",
    target: "ES2022",
    runtime: "tsx"
  }
};

describe("project template sources", () => {
  it("normalizes template source globs", () => {
    expect(normalizeTemplateSource("  src\\blueprints\\**\\*.ts  ")).toBe("src/blueprints/**/*.ts");
  });

  it("adds unique template sources without mutating the project", () => {
    const updated = addProjectTemplateSource(project, " src/ai/**/*.ts ");

    expect(updated.templateSources).toEqual(["src/**/*.ts", "src/ai/**/*.ts"]);
    expect(project.templateSources).toEqual(["src/**/*.ts"]);
    expect(addProjectTemplateSource(updated, "src/ai/**/*.ts")).toBe(updated);
  });

  it("removes template sources by normalized source glob", () => {
    const updated = removeProjectTemplateSource(
      { ...project, templateSources: ["src/**/*.ts", "src/ai/**/*.ts"] },
      "src\\ai\\**\\*.ts"
    );

    expect(updated.templateSources).toEqual(["src/**/*.ts"]);
  });

  it("imports template package manifests into source globs and builtin groups", () => {
    const updated = importProjectTemplatePackage(project, {
      id: " gameplay.math ",
      name: " Gameplay Math ",
      version: " 1.0.0 ",
      description: " Math helpers ",
      templateSources: [" src/math/**/*.ts ", "src/**/*.ts"],
      builtinGroups: ["Math", "String", "Math"]
    });

    expect(updated.templateSources).toEqual(["src/**/*.ts", "src/math/**/*.ts"]);
    expect(updated.templatePackages).toEqual([{
      id: "gameplay.math",
      name: "Gameplay Math",
      version: "1.0.0",
      description: "Math helpers",
      templateSources: ["src/math/**/*.ts", "src/**/*.ts"],
      builtinGroups: ["Math", "String"]
    }]);
    expect(updated.builtins?.groups).toEqual(["Math", "String"]);
    expect(project.templateSources).toEqual(["src/**/*.ts"]);
  });

  it("rejects empty template package manifests", () => {
    expect(() => normalizeTemplatePackageManifest({
      id: "",
      name: "Empty",
      version: "1.0.0",
      templateSources: []
    })).toThrow("require id");
    expect(() => normalizeTemplatePackageManifest({
      id: "empty",
      name: "Empty",
      version: "1.0.0",
      templateSources: []
    })).toThrow("must declare");
  });
});
