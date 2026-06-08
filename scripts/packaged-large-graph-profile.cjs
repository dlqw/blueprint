#!/usr/bin/env node
"use strict";

const { chromium, expect } = require("@playwright/test");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const desktopGraphKey = "blueprint.desktop.activeGraph";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (process.platform !== "win32") {
    throw new Error("Packaged large-graph profiling currently targets Windows Tauri/WebView2 builds.");
  }

  const skipBuild = process.argv.includes("--skip-build");
  if (!skipBuild) {
    run(process.execPath, [path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", "--no-bundle", "--ci"]);
  }

  const exePath = path.join(repoRoot, "src-tauri", "target", "release", "blueprint-ide.exe");
  if (!fs.existsSync(exePath)) {
    throw new Error(`Packaged executable not found: ${exePath}`);
  }

  const logCounts = parseLogCounts();
  const session = await launchPackagedApp(exePath);
  let previousGraphText;
  let restored = false;

  try {
    previousGraphText = await session.page.evaluate((key) => window.localStorage.getItem(key), desktopGraphKey);
    const samples = [];
    for (const logCount of logCounts) {
      samples.push(await profileLargeGraph(session.page, logCount));
    }
    await restoreGraph(session.page, previousGraphText);
    restored = true;
    console.log(JSON.stringify({ samples }, null, 2));
    console.log("Packaged large-graph profile passed.");
  } finally {
    if (!restored && previousGraphText !== undefined) {
      await restoreGraph(session.page, previousGraphText).catch((error) => {
        console.error(`Failed to restore previous packaged graph state: ${error.message}`);
      });
    }
    await session.close();
  }
}

function parseLogCounts() {
  const value = process.argv.find((arg) => arg.startsWith("--counts="))?.slice("--counts=".length);
  if (!value) {
    return [500, 1000];
  }
  const counts = value.split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0);
  if (!counts.length) {
    throw new Error(`No valid --counts values found in '${value}'.`);
  }
  return counts;
}

async function profileLargeGraph(page, logCount) {
  await page.evaluate(
    ({ key, graph }) => {
      window.localStorage.setItem(key, JSON.stringify(graph));
    },
    { key: desktopGraphKey, graph: largeRenderGraph(logCount) }
  );

  const openStartedAt = Date.now();
  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Large Render").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".canvas")).toBeVisible({ timeout: 20_000 });
  const openMs = Date.now() - openStartedAt;

  const renderedNodeCount = await page.locator(".canvas .node").count();
  const renderedWireCount = await page.locator(".canvas .wire:not(.preview)").count();
  expect(renderedNodeCount, `${logCount} node rendered DOM count`).toBeGreaterThan(0);
  expect(renderedNodeCount, `${logCount} node rendered DOM count`).toBeLessThan(220);
  expect(renderedWireCount, `${logCount} wire rendered DOM count`).toBeGreaterThan(0);
  if (logCount > 260) {
    expect(renderedWireCount, `${logCount} wire rendered DOM count`).toBeLessThan(logCount);
  } else {
    expect(renderedWireCount, `${logCount} wire rendered DOM count`).toBe(logCount + 1);
  }
  await expect(nodeLimitText(page, 160, logCount + 2)).toBeVisible();

  const focusStartedAt = Date.now();
  await filterOutlineInput(page).fill(`log-${logCount - 1}`);
  await focusOutlineNodeButton(page, `log-${logCount - 1}`).click();
  await expect(page.locator(`[data-node-id="log-${logCount - 1}"]`)).toBeVisible({ timeout: 10_000 });
  const focusMs = Date.now() - focusStartedAt;

  const adjacentWireCount = await page.locator(`[data-link-id='link-${logCount - 2}'], [data-link-id='link-${logCount - 1}']`).count();
  expect(adjacentWireCount, `${logCount} focused adjacent wire count`).toBe(2);
  expect(openMs, `${logCount} packaged open time`).toBeLessThan(20_000);
  expect(focusMs, `${logCount} packaged focus time`).toBeLessThan(8_000);

  return {
    logCount,
    openMs,
    focusMs,
    renderedNodeCount,
    renderedWireCount,
    adjacentWireCount
  };
}

async function restoreGraph(page, previousGraphText) {
  await page.evaluate(
    ({ key, value }) => {
      if (value === null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    },
    { key: desktopGraphKey, value: previousGraphText }
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    const suffix = result.error ? `: ${result.error.message}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${suffix}`);
  }
}

async function launchPackagedApp(exePath) {
  const port = await getFreePort();
  const existingBrowserArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
  const browserArgs = `${existingBrowserArgs} --remote-debugging-port=${port}`.trim();
  const proc = spawn(exePath, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArgs
    },
    stdio: "ignore",
    windowsHide: true
  });

  let browser;
  try {
    const endpoint = await waitForWebViewEndpoint(port);
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = await waitForPage(context);
    await page.waitForSelector(".desktop-shell", { timeout: 20_000 });
    await page.waitForSelector(".node", { timeout: 20_000 });
    return {
      page,
      close: async () => {
        await browser.close().catch(() => {});
        await stopProcess(proc);
      }
    };
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await stopProcess(proc);
    throw error;
  }
}

async function waitForPage(context) {
  const existing = context.pages()[0];
  if (existing) {
    return existing;
  }
  return context.waitForEvent("page", { timeout: 20_000 });
}

async function waitForWebViewEndpoint(port) {
  const url = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return await getJson(url);
    } catch {
      await delay(500);
    }
  }
  throw new Error(`WebView2 remote debugging endpoint did not respond on port ${port}`);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(1_000, () => {
      request.destroy(new Error("Timed out waiting for remote debugging endpoint"));
    });
    request.on("error", reject);
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Failed to allocate a local port"));
        } else {
          resolve(address.port);
        }
      });
    });
    server.on("error", reject);
  });
}

async function stopProcess(proc) {
  if (proc.exitCode !== null) {
    return;
  }
  proc.kill();
  await Promise.race([
    new Promise((resolve) => proc.once("exit", resolve)),
    delay(2_000)
  ]);
  if (proc.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function filterOutlineInput(page) {
  return page.getByPlaceholder(/^(筛选大纲|Filter outline)$/);
}

function focusOutlineNodeButton(page, nodeId) {
  return page.getByTitle(new RegExp(`^(聚焦大纲节点|Focus outline node) ${escapeRegex(nodeId)}$`));
}

function nodeLimitText(page, visible, total) {
  return page.getByText(new RegExp(`^(正在显示 ${visible} / ${total} 个节点。筛选大纲可缩小结果。|Showing ${visible} of ${total} nodes\\. Filter outline to narrow results\\.)$`));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function largeRenderGraph(logCount) {
  const nodes = [{
    id: "entry",
    templateId: "builtin.control.entry",
    position: { x: 80, y: 80 },
    inputBindings: {}
  }];
  for (let index = 0; index < logCount; index += 1) {
    nodes.push({
      id: `log-${index}`,
      templateId: "builtin.debug.log",
      position: { x: 420 + index * 320, y: 80 },
      inputBindings: {
        message: { portId: "message", sourceKind: "literal", literalValue: `message ${index}` }
      }
    });
  }
  nodes.push({
    id: "end",
    templateId: "builtin.control.end",
    position: { x: 420 + logCount * 320, y: 80 },
    inputBindings: {}
  });

  return {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: "large-render",
    name: "Large Render",
    description: "Large render graph.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [],
      outputs: []
    },
    nodes,
    links: nodes.slice(0, -1).map((node, index) => ({
      id: `link-${index}`,
      fromNodeId: node.id,
      fromPortId: "then",
      toNodeId: nodes[index + 1].id,
      toPortId: "exec",
      flowKind: "control"
    })),
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}
