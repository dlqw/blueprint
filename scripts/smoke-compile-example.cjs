const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "examples", "Gameplay", "generated");

const { compileGraphsToProject } = require("../dist/shared/compilerCore.js");
const { getBuiltinTemplates } = require("../dist/shared/builtins.js");
const { createPort } = require("../dist/shared/blueprint.js");
const { graphToNodeTemplate } = require("../dist/shared/projectGraphTemplates.js");

const project = readJson("examples/Gameplay/Gameplay.bproj");
const graphEntries = loadProjectGraphs(project, path.join(root, "examples/Gameplay"));
const graphs = graphEntries.map((entry) => entry.graph);
const templates = [
  ...getBuiltinTemplates(),
  ...graphEntries.map((entry) => graphToNodeTemplate(entry.graph, sourceRef(entry.path))),
  ...typeScriptTemplates()
];

compileGraphsToProject(graphs, templates, { fsPath: outputDir }, { blackboard: project.blackboard, workspaceRoot: root })
  .then((result) => {
    if (!result.ok) {
      console.error(result.message);
      process.exitCode = 1;
      return;
    }

    const typecheck = spawnSync("npx", ["tsc", "-p", "examples/Gameplay/tsconfig.json", "--noEmit"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32"
    });
    if (typecheck.status !== 0) {
      process.stdout.write(typecheck.stdout);
      process.stderr.write(typecheck.stderr);
      process.exitCode = typecheck.status ?? 1;
      return;
    }

    const run = spawnSync("npx", ["tsx", "Main.ts"], {
      cwd: outputDir,
      encoding: "utf8",
      shell: process.platform === "win32"
    });

    if (run.status !== 0) {
      process.stdout.write(run.stdout);
      process.stderr.write(run.stderr);
      process.exitCode = run.status ?? 1;
      return;
    }

    const output = run.stdout.trim();
    const expected = ["Trace macro expanded", "Score: 42", "Announce blueprint called"];
    const missing = expected.filter((line) => !output.includes(line));
    if (missing.length) {
      console.error(`Smoke output missing: ${missing.join(", ")}`);
      console.error(output);
      process.exitCode = 1;
      return;
    }

    console.log(output);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
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
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{ path: graphPath, graph: JSON.parse(fs.readFileSync(graphPath, "utf8")) }];
  });
}

function sourceRef(sourcePath) {
  return path.relative(root, sourcePath).replace(/\\/g, "/");
}

function typeScriptTemplates() {
  return [
    {
      id: "ts.TypeScript.Math.Double",
      name: "Double",
      creationPath: "TypeScript/Math",
      description: "Multiplies a number by two.",
      inputs: [createPort("value", "value", "input", "data", "number", "Parameter value.", "number", 0)],
      outputs: [createPort("result", "Result", "output", "data", "number", "Function result.", "none")],
      controlInputs: [],
      controlOutputs: [],
      bodyKind: "typescriptFunction",
      bodyRef: "examples/Gameplay/src/mathNodes.ts#GameplayMathNodes.double",
      metadata: {
        exportName: "GameplayMathNodes",
        memberName: "double",
        source: "examples/Gameplay/src/mathNodes.ts"
      }
    },
    {
      id: "ts.TypeScript.String.Format.Score",
      name: "Format Score",
      creationPath: "TypeScript/String",
      description: "Formats a numeric score for display.",
      inputs: [createPort("score", "score", "input", "data", "number", "Parameter score.", "number", 0)],
      outputs: [createPort("result", "Result", "output", "data", "string", "Function result.", "none")],
      controlInputs: [],
      controlOutputs: [],
      bodyKind: "typescriptFunction",
      bodyRef: "examples/Gameplay/src/mathNodes.ts#GameplayMathNodes.formatScore",
      metadata: {
        exportName: "GameplayMathNodes",
        memberName: "formatScore",
        source: "examples/Gameplay/src/mathNodes.ts"
      }
    }
  ];
}
