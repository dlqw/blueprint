const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");

main().catch((error) => {
  writeJson({ ok: false, message: error instanceof Error ? error.message : String(error), issues: [] });
  process.exitCode = 1;
});

async function main() {
  const request = await readBridgeRequest();
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

  if (action === "compile") {
    writeJson({
      ok: result.ok,
      message: result.message,
      issues: result.issues ?? [],
      outputFiles: (result.outputFiles ?? []).map((file) => file.fsPath)
    });
    return;
  }

  if (!result.ok) {
    emitRuntimeResult({
      runId: request.runId,
      ok: false,
      message: result.message,
      stdout: "",
      stderr: "",
      durationMs: 0,
      traces: [],
      issues: result.issues ?? []
    }, request.streamEvents === true);
    return;
  }

  const entry = (result.outputFiles ?? []).map((file) => file.fsPath).find((filePath) => path.basename(filePath) !== "runtime.ts");
  if (!entry) {
    emitRuntimeResult({
      runId: request.runId,
      ok: false,
      message: "No generated graph entry file was produced.",
      stdout: "",
      stderr: "",
      durationMs: 0,
      traces: [],
      issues: []
    }, request.streamEvents === true);
    return;
  }

  const started = Date.now();
  await runGeneratedEntry(entry, request, started);
}

function runGeneratedEntry(entry, request, started) {
  const traces = [];
  const stdoutChunks = [];
  const stderrChunks = [];
  const tracePrefix = "__BLUEPRINT_TRACE__";
  const streamEvents = request.streamEvents === true;
  const run = spawn("npx", ["tsx", path.basename(entry)], {
    cwd: path.dirname(entry),
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      BLUEPRINT_TRACE: "1",
      BLUEPRINT_STEP: request.stepMode ? "1" : undefined,
      BLUEPRINT_BREAKPOINTS: Array.isArray(request.breakpoints) ? JSON.stringify(request.breakpoints) : undefined
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stderrRemainder = "";
  run.stdout.on("data", (chunk) => {
    stdoutChunks.push(String(chunk));
  });
  run.stderr.on("data", (chunk) => {
    stderrRemainder = consumeTraceLines(`${stderrRemainder}${String(chunk)}`, tracePrefix, traces, stderrChunks, request.runId, streamEvents);
  });
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  let controlRemainder = "";
  process.stdin.on("data", (chunk) => {
    if (!run.stdin.writable) {
      return;
    }
    controlRemainder = `${controlRemainder}${String(chunk)}`;
    const commands = controlRemainder.split(/\r?\n/);
    controlRemainder = commands.pop() ?? "";
    for (const rawCommand of commands) {
      const command = rawCommand.trim().toLowerCase();
      if (command === "step" || command === "continue" || command === "resume") {
        run.stdin.write(`${command}\n`);
      } else if (command === "cancel") {
        run.kill();
      }
    }
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      emitRuntimeResult(payload, streamEvents);
      resolve();
    };
    run.on("error", (error) => {
      finish({
        runId: request.runId,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        stdout: stdoutChunks.join(""),
        stderr: [...stderrChunks, stderrRemainder].join(""),
        durationMs: Date.now() - started,
        traces,
        issues: []
      });
    });
    run.on("close", (code, signal) => {
      if (stderrRemainder) {
        stderrChunks.push(stderrRemainder);
      }
      const canceled = signal === "SIGTERM" || signal === "SIGKILL";
      finish({
        runId: request.runId,
        ok: code === 0 && !canceled,
        message: canceled ? "Run canceled." : code === 0 ? `Ran ${path.basename(entry)}.` : `Run failed with exit code ${code ?? 1}.`,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        durationMs: Date.now() - started,
        traces,
        issues: []
      });
    });
  });
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

function writeEvent(event, payload) {
  process.stdout.write(`${JSON.stringify({ event, payload })}\n`);
}

function emitRuntimeResult(payload, streamEvents) {
  if (streamEvents) {
    writeEvent("runtimeResult", payload);
    return;
  }
  writeJson(payload);
}

function consumeTraceLines(buffer, tracePrefix, traces, stderrChunks, runId, streamEvents) {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith(tracePrefix)) {
      stderrChunks.push(`${line}\n`);
      continue;
    }
    try {
      const trace = JSON.parse(line.slice(tracePrefix.length));
      traces.push(trace);
      if (streamEvents) {
        writeEvent("runtimeTrace", { runId, trace });
      }
    } catch {
      stderrChunks.push(`${line}\n`);
    }
  }
  return remainder;
}

function readBridgeRequest() {
  return new Promise((resolve, reject) => {
    let input = "";
    const finish = () => {
      const firstLine = input.split(/\r?\n/)[0]?.trim() || input.trim();
      try {
        resolve(JSON.parse(firstLine));
      } catch (error) {
        reject(error);
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
      if (input.includes("\n")) {
        process.stdin.pause();
        process.stdin.removeAllListeners("end");
        process.stdin.removeAllListeners("data");
        finish();
      }
    });
    process.stdin.on("end", finish);
  });
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
