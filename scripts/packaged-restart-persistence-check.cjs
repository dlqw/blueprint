#!/usr/bin/env node
"use strict";

const { chromium, expect } = require("@playwright/test");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const desktopStateKey = "blueprint.desktop.webviewState";
const targetPrefs = {
  gridVisible: false,
  snapToGrid: true,
  minimapVisible: true,
  linkRenderMode: "orthogonal",
  actionBarPlacement: "top",
  language: "zh-CN",
  theme: "graphite",
  shortcuts: {
    "graph.duplicate": "Ctrl+Alt+D"
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (process.platform !== "win32") {
    throw new Error("Packaged restart persistence check currently targets Windows Tauri/WebView2 builds.");
  }

  const skipBuild = process.argv.includes("--skip-build");
  if (!skipBuild) {
    run(process.execPath, [path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", "--no-bundle", "--ci"]);
  }

  const exePath = path.join(repoRoot, "src-tauri", "target", "release", "blueprint-ide.exe");
  if (!fs.existsSync(exePath)) {
    throw new Error(`Packaged executable not found: ${exePath}`);
  }

  let previousStateText;
  let restored = false;

  try {
    const first = await launchPackagedApp(exePath);
    try {
      previousStateText = await first.page.evaluate((key) => window.localStorage.getItem(key), desktopStateKey);
      await writePrefsThroughUi(first.page);
      await expectStoredPrefs(first.page);
    } finally {
      await first.close();
    }

    const second = await launchPackagedApp(exePath);
    try {
      await expectStoredPrefs(second.page);
      await expectPersistedUi(second.page);
      await restoreState(second.page, previousStateText);
      restored = true;
    } finally {
      await second.close();
    }

    console.log("Packaged restart persistence check passed.");
  } finally {
    if (!restored && previousStateText !== undefined) {
      await restorePackagedState(exePath, previousStateText).catch((error) => {
        console.error(`Failed to restore previous packaged app state: ${error.message}`);
      });
    }
  }
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

async function writePrefsThroughUi(page) {
  await editorSettingsButton(page).click();
  await expect(editorSettingsPanel(page)).toBeVisible();
  await page.getByRole("checkbox", { name: /^(网格|Grid)$/ }).uncheck();
  await page.getByRole("checkbox", { name: /^(吸附到网格|Snap to grid)$/ }).check();
  await page.getByRole("checkbox", { name: /^(小地图|Minimap)$/ }).check();
  await page.getByTitle(/^(设置连线模式：orthogonal|Set link mode: orthogonal)$/).click({ force: true });
  await page.getByTitle(/^(将操作栏放到顶部|Place actionbar at top)$/).click({ force: true });
  await page.getByRole("button", { name: /^(石墨|Graphite)$/ }).click({ force: true });
  await shortcutInput(page, "Duplicate Selection").fill(targetPrefs.shortcuts["graph.duplicate"]);
}

async function expectStoredPrefs(page) {
  await page.waitForFunction(
    ({ key, prefs }) => {
      const state = JSON.parse(window.localStorage.getItem(key) ?? "{}");
      return state.editorPrefs?.gridVisible === prefs.gridVisible &&
        state.editorPrefs?.snapToGrid === prefs.snapToGrid &&
        state.editorPrefs?.minimapVisible === prefs.minimapVisible &&
        state.editorPrefs?.linkRenderMode === prefs.linkRenderMode &&
        state.editorPrefs?.actionBarPlacement === prefs.actionBarPlacement &&
        state.editorPrefs?.language === prefs.language &&
        state.editorPrefs?.theme === prefs.theme &&
        state.editorPrefs?.shortcuts?.["graph.duplicate"] === prefs.shortcuts["graph.duplicate"];
    },
    { key: desktopStateKey, prefs: targetPrefs },
    { timeout: 10_000 }
  );
}

async function expectPersistedUi(page) {
  await expect(page.locator(".canvas .grid")).toHaveCount(0);
  await expect(page.locator(".run-actionbar.top")).toBeVisible();
  await expect(page.locator(".shell.theme-graphite")).toBeVisible();
  await editorSettingsButton(page).click();
  await expect(editorSettingsPanel(page)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^(网格|Grid)$/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^(吸附到网格|Snap to grid)$/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^(小地图|Minimap)$/ })).toBeChecked();
  await expect(page.getByTitle(/^(设置连线模式：orthogonal|Set link mode: orthogonal)$/)).toHaveClass(/active/);
  await expect(page.getByTitle(/^(将操作栏放到顶部|Place actionbar at top)$/)).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: /^(石墨|Graphite)$/ })).toHaveClass(/active/);
  await expect(shortcutInput(page, "Duplicate Selection")).toHaveValue(targetPrefs.shortcuts["graph.duplicate"]);
}

function editorSettingsButton(page) {
  return page.getByTitle(/^(编辑器设置|Editor settings)$/).first();
}

function editorSettingsPanel(page) {
  return page.getByRole("dialog", { name: /^(编辑器设置|Editor Settings)$/ });
}

function shortcutInput(page, commandTitle) {
  const translatedTitle = commandTitle === "Duplicate Selection" ? "复制副本" : commandTitle;
  return page.getByLabel(new RegExp(`^(${escapeRegex(translatedTitle)} 的快捷键|Shortcut for ${escapeRegex(commandTitle)})$`));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function restorePackagedState(exePath, previousStateText) {
  const session = await launchPackagedApp(exePath);
  try {
    await restoreState(session.page, previousStateText);
  } finally {
    await session.close();
  }
}

async function restoreState(page, previousStateText) {
  await page.evaluate(
    ({ key, value }) => {
      if (value === null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    },
    { key: desktopStateKey, value: previousStateText }
  );
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
