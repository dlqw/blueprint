const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

main().catch((error) => {
  writeJson({ ok: false, message: error instanceof Error ? error.message : String(error), issues: [] });
  process.exitCode = 1;
});

async function main() {
  const request = JSON.parse(fs.readFileSync(0, "utf8"));
  const { compileGraphsToProject } = require("../dist/shared/compilerCore.js");
  const { getBuiltinTemplates } = require("../dist/shared/builtins.js");
  const { extractBlueprintTemplatesFromTypeScript } = require("../dist/shared/templateSource.js");
  const { graphToNodeTemplate } = require("../dist/shared/projectGraphTemplates.js");

  const graph = request.graph;
  const action = request.action === "run" ? "run" : "compile";
  if (request.action === "templates") {
    const projectPath = typeof request.projectPath === "string" ? request.projectPath : undefined;
    writeJson({ ok: true, templates: projectPath ? loadProjectTemplates(projectPath, extractBlueprintTemplatesFromTypeScript, graphToNodeTemplate).templates : [] });
    return;
  }

  const graphPath = typeof request.graphPath === "string" ? request.graphPath : undefined;
  const outputDir = graphPath
    ? path.resolve(path.dirname(graphPath), "..", "generated")
    : path.join(root, "dist", "desktop-generated");
  const projectPath = graphPath ? findProjectPathForGraph(graphPath) : undefined;
  const projectBundle = projectPath ? loadProjectTemplates(projectPath, extractBlueprintTemplatesFromTypeScript, graphToNodeTemplate) : emptyProjectTemplateBundle();
  const graphPathKey = graphPath ? path.resolve(graphPath).toLowerCase() : undefined;
  const projectGraphs = projectBundle.graphs.filter((entry) => path.resolve(entry.path).toLowerCase() !== graphPathKey);
  const graphLibrary = [graph, ...projectGraphs.map((entry) => entry.graph)];
  const templates = [
    ...getBuiltinTemplates(),
    ...projectBundle.templates
  ];
  const graphSourcePaths = new Map([[graph, graphPath ?? graph.name ?? graph.id ?? "desktop.bpgraph"]]);
  for (const entry of projectGraphs) {
    graphSourcePaths.set(entry.graph, entry.path);
  }

  const result = await compileGraphsToProject(graphLibrary, templates, { fsPath: outputDir }, {
    blackboard: projectBundle.project?.blackboard,
    workspaceRoot: root,
    graphSourcePaths
  });

  if (action === "compile" || !result.ok) {
    writeJson({
      ok: result.ok,
      message: result.message,
      issues: result.issues ?? [],
      outputFiles: (result.outputFiles ?? []).map((file) => file.fsPath)
    });
    return;
  }

  const entry = (result.outputFiles ?? []).map((file) => file.fsPath).find((filePath) => path.basename(filePath) !== "runtime.ts");
  if (!entry) {
    writeJson({
      ok: false,
      message: "No generated graph entry file was produced.",
      stdout: "",
      stderr: "",
      durationMs: 0,
      traces: [],
      issues: []
    });
    return;
  }

  const started = Date.now();
  const run = spawnSync("npx", ["tsx", path.basename(entry)], {
    cwd: path.dirname(entry),
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  writeJson({
    ok: run.status === 0,
    message: run.status === 0 ? `Ran ${path.basename(entry)}.` : `Run failed with exit code ${run.status ?? 1}.`,
    stdout: run.stdout,
    stderr: run.stderr,
    durationMs: Date.now() - started,
    traces: [],
    issues: []
  });
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

function findProjectPathForGraph(graphPath) {
  const projectDirectory = path.resolve(path.dirname(graphPath), "..");
  const projectPath = fs.readdirSync(projectDirectory)
    .filter((entry) => entry.endsWith(".bproj"))
    .map((entry) => path.join(projectDirectory, entry))[0];
  return projectPath;
}

function loadProjectTemplates(projectPath, extractBlueprintTemplatesFromTypeScript, graphToNodeTemplate) {
  const projectDirectory = path.dirname(projectPath);
  const project = readJson(projectPath);
  const graphEntries = loadProjectGraphs(project, projectDirectory);
  const graphTemplates = graphEntries.map((entry) => graphToNodeTemplate(entry.graph, sourceRef(entry.path)));
  const sources = Array.isArray(project.templateSources) ? project.templateSources.filter((source) => typeof source === "string") : [];
  const typeScriptTemplates = sources
    .flatMap((source) => expandTemplateSource(projectDirectory, source))
    .flatMap((sourcePath) => {
      const sourceText = fs.readFileSync(sourcePath, "utf8");
      return extractBlueprintTemplatesFromTypeScript(sourceText, sourceRef(sourcePath));
    });
  return {
    project,
    graphs: graphEntries,
    templates: [...graphTemplates, ...typeScriptTemplates]
  };
}

function emptyProjectTemplateBundle() {
  return {
    project: undefined,
    graphs: [],
    templates: []
  };
}

function loadProjectGraphs(project, projectDirectory) {
  const references = [
    ...(Array.isArray(project.graphs) ? project.graphs : []),
    ...(Array.isArray(project.macros) ? project.macros : [])
  ].filter((reference) => typeof reference === "string");
  const seen = new Set();
  return references.flatMap((reference) => {
    const graphPath = path.resolve(projectDirectory, reference);
    const key = graphPath.toLowerCase();
    if (seen.has(key) || !fs.existsSync(graphPath)) {
      return [];
    }
    seen.add(key);
    return [{ path: graphPath, graph: readJson(graphPath) }];
  });
}

function sourceRef(sourcePath) {
  return path.relative(root, sourcePath).replace(/\\/g, "/");
}

function expandTemplateSource(projectDirectory, pattern) {
  const normalized = pattern.replace(/\\/g, "/");
  if (normalized.endsWith("/**/*.ts")) {
    const directory = path.resolve(projectDirectory, normalized.slice(0, -"**/*.ts".length));
    return listTypeScriptFiles(directory);
  }
  if (normalized.endsWith("*.ts")) {
    const directory = path.resolve(projectDirectory, path.dirname(normalized));
    return fs.existsSync(directory)
      ? fs.readdirSync(directory).filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx")).map((entry) => path.join(directory, entry))
      : [];
  }
  const sourcePath = path.resolve(projectDirectory, normalized);
  return fs.existsSync(sourcePath) ? [sourcePath] : [];
}

function listTypeScriptFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(entryPath);
    }
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) ? [entryPath] : [];
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
