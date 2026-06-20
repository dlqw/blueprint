import { expect, test, type Browser, type Page } from "@playwright/test";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const floatingSelectors = [
  ".run-actionbar",
  ".minimap"
];

test.describe("desktop layout smoke", () => {
  test("desktop viewport keeps primary graph surfaces visible and separated", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    await assertLayout(page);
    await expect(page.locator(".topbar .graph-title")).toBeHidden();
    await expect(page.locator(".topbar .lucide-circle-dot")).toHaveCount(0);
    const topbarBox = await visibleBox(page, ".topbar");
    expect(topbarBox.height, "topbar compact height").toBeLessThanOrEqual(44);
    await toolbarOverflowButton(page).click();
    await expect(page.locator(".toolbar-overflow-menu")).toBeVisible();
    await assertInsideViewport(page, ".toolbar-overflow-menu");
    await page.screenshot({ path: test.info().outputPath("layout-desktop.png"), fullPage: true });
  });

  test("minimum Tauri-width viewport avoids floating control overlap", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });
    await openEditor(page);
    await assertLayout(page);
    await toolbarOverflowButton(page).click();
    await expect(page.locator(".toolbar-overflow-menu")).toBeVisible();
    await assertInsideViewport(page, ".toolbar-overflow-menu");
    await page.screenshot({ path: test.info().outputPath("layout-narrow.png"), fullPage: true });
  });

  test("high DPI viewport keeps floating graph controls separated", async ({ browser }) => {
    const page = await highDpiPage(browser);
    try {
      await openEditor(page);
      await assertLayout(page);
      await page.screenshot({ path: test.info().outputPath("layout-high-dpi.png"), fullPage: true });
    } finally {
      await page.context().close();
    }
  });

  test("selection toolbox stays visible and separated at varied graph positions", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((graph) => {
      window.localStorage.setItem("blueprint.desktop.activeGraph", JSON.stringify(graph));
    }, selectionLayoutGraph());
    await openEditor(page);
    await assertLayout(page);

    for (const nodeId of ["near-top-left", "center-log", "near-bottom-right"]) {
      await page.locator(`[data-node-id="${nodeId}"]`).click();
      await expect(page.locator(".selection-toolbox"), `selection toolbox for ${nodeId}`).toBeVisible();
      await assertSelectionToolboxLayout(page);
    }

    await page.screenshot({ path: test.info().outputPath("layout-selection-toolbox.png"), fullPage: true });
  });

  test("pin and wire hit areas stay usable at constrained width", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });
    await page.addInitScript((graph) => {
      window.localStorage.setItem("blueprint.desktop.activeGraph", JSON.stringify(graph));
    }, selectionLayoutGraph());
    await openEditor(page);
    await assertLayout(page);
    await assertPortHitAreas(page);
    await assertWireHitStyles(page);

    const sourcePort = page.locator('[data-node-id="entry"] .port.right.control').first();
    await expect(sourcePort).toBeVisible();
    const box = await sourcePort.boundingBox();
    expect(box).not.toBeNull();
    const startX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const startY = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const endX = startX + 260;
    const endY = startY - 210;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator(".node-panel.pin-aware")).toBeVisible();
    await expect(page.locator(".pin-creation-hint")).toContainText("来自 output control pin");
    await assertInsideViewport(page, ".node-panel");
    await page.screenshot({ path: test.info().outputPath("layout-pin-hit-areas.png"), fullPage: true });
  });

  test("desktop docks remove blueprints and search and stay compact", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((solution) => {
      window.localStorage.setItem("blueprint.desktop.activeSolution", JSON.stringify(solution));
    }, desktopTemplateSourceSolution());
    await openEditor(page);
    await assertLayout(page);

    const leftDockTabs = page.locator(".desktop-nav .desktop-dock-tab-strip button");
    await expect(leftDockTabs).toHaveText([/^(蓝图树|Blueprint Tree)$/, /^(运行|Run)$/, /^(源控制|Source control)$/]);
    await expect(page.locator(".desktop-nav .desktop-dock-tab-strip button", { hasText: /^(蓝图|Blueprints?)$/ })).toHaveCount(0);
    await expect(page.locator(".desktop-nav .desktop-dock-tab-strip button", { hasText: /^(搜索|Search)$/ })).toHaveCount(0);
    await expect(page.locator(".desktop-nav .desktop-dock-header")).toHaveCount(0);

    await page.locator(".desktop-nav .desktop-dock-tab-strip button", { hasText: /^(运行|Run)$/ }).click();
    await expect(page.locator(".desktop-nav .desktop-run-panel")).toBeVisible();
    await expect(page.locator(".desktop-nav .desktop-compact-dock-title")).toBeVisible();
    await expect(page.locator(".desktop-nav .desktop-dock-header")).toHaveCount(0);

    await page.locator(".desktop-nav .desktop-dock-tab-strip button", { hasText: /^(源控制|Source control)$/ }).click();
    await expect(page.locator(".desktop-nav .desktop-source-panel")).toBeVisible();
    await expect(page.locator(".desktop-nav .desktop-source-panel small").first()).toBeVisible();
    await expect(page.locator(".desktop-nav .desktop-dock-header")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath("layout-docks-compact.png"), fullPage: true });
  });

  test("desktop blueprint tree keeps compact file-tree rows", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(({ graph, solution }) => {
      window.localStorage.setItem("blueprint.desktop.activeGraph", JSON.stringify(graph));
      window.localStorage.setItem("blueprint.desktop.activeGraphPath", solution.projects[0].graphs[0].path);
      window.localStorage.setItem("blueprint.desktop.activeSolution", JSON.stringify(solution));
    }, {
      graph: selectionLayoutGraph(),
      solution: desktopTemplateSourceSolution()
    });
    await openEditor(page);
    if (!await page.locator(".desktop-blueprint-tree").isVisible()) {
      await page.locator(".desktop-nav .desktop-dock-tab-strip button", { hasText: /^(蓝图树|Blueprint Tree)$/ }).click();
    }
    await expect(page.locator(".desktop-blueprint-tree")).toBeVisible();
    await expect(page.locator(".desktop-nav .desktop-dock-header")).toHaveCount(0);
    await expect(page.locator(".desktop-tree-project-row svg")).toHaveCount(1);
    await expect(page.locator(".desktop-tree-graph-toggle svg")).toHaveCount(1);
    await expect(page.locator(".desktop-tree-graph > button:not(.desktop-tree-graph-toggle) svg")).toHaveCount(1);

    const nodeBoxes = await page.locator(".desktop-tree-node").evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
    );
    expect(nodeBoxes.length).toBeGreaterThanOrEqual(5);
    for (const box of nodeBoxes) {
      expect(box.width, "blueprint tree node width").toBeGreaterThan(120);
      expect(box.height, "blueprint tree node height").toBeGreaterThanOrEqual(22);
      expect(box.height, "blueprint tree node height").toBeLessThanOrEqual(28);
    }
    await expect(page.locator(".desktop-tree-node svg")).toHaveCount(nodeBoxes.length);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath("layout-blueprint-tree-compact.png"), fullPage: true });
  });

  test("project hub recent solution items keep compact rows", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });
    await page.addInitScript(() => {
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          invoke(command: string) {
            if (command === "blueprint_launch_context") {
              return Promise.resolve({ kind: "hub" });
            }
            return Promise.reject(new Error(`Unhandled invoke: ${command}`));
          }
        }
      });
      window.localStorage.removeItem("blueprint.desktop.solution");
      window.localStorage.removeItem("blueprint.desktop.activeGraph");
      window.localStorage.setItem("blueprint.desktop.recentSolutions", JSON.stringify([
        {
          name: "Gameplay",
          path: "D:\\Project\\blueprint-workspace\\examples\\BlueprintSolution.bsln",
          projects: []
        },
        {
          name: "Very Long Blueprint Solution Name For Layout Debugging",
          path: "D:\\Users\\rdququ\\Documents\\Blueprint Projects\\A very long nested folder name\\Another long folder\\Solution.bsln",
          projects: []
        },
        {
          name: "Tiny",
          path: "C:\\tmp\\Tiny.bsln",
          projects: []
        }
      ]));
    });

    await page.goto("/");
    await expect(page.locator(".project-hub-recent-list button")).toHaveCount(3);
    await expectNoHorizontalOverflow(page);
    await assertInsideViewport(page, ".project-hub");

    const itemBoxes = await page.locator(".project-hub-recent-list button").evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
    );
    for (const box of itemBoxes) {
      expect(box.width, "recent solution item width").toBeGreaterThan(240);
      expect(box.height, "recent solution item height").toBeGreaterThanOrEqual(52);
      expect(box.height, "recent solution item height").toBeLessThanOrEqual(72);
    }

    await page.screenshot({ path: test.info().outputPath("layout-project-hub-recents.png"), fullPage: true });
  });

  test("hub recent solution opens workspace without narrow-window overlap", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });
    await page.addInitScript(({ graph, solution }) => {
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          invoke(command: string, args?: { path?: string }) {
            if (command === "blueprint_launch_context") {
              return Promise.resolve({ kind: "hub" });
            }
            if (command === "blueprint_read_solution" && args?.path === solution.path) {
              return Promise.resolve(solution);
            }
            if (command === "blueprint_read_file") {
              return Promise.resolve(graph);
            }
            if (command === "blueprint_load_project_templates") {
              return Promise.resolve({ ok: true, templates: [] });
            }
            return Promise.reject(new Error(`Unhandled invoke: ${command}`));
          }
        }
      });
      window.localStorage.removeItem("blueprint.desktop.solution");
      window.localStorage.setItem("blueprint.desktop.activeGraph", JSON.stringify(graph));
      window.localStorage.setItem("blueprint.desktop.recentSolutions", JSON.stringify([solution]));
    }, {
      graph: selectionLayoutGraph(),
      solution: desktopTemplateSourceSolution()
    });

    await page.goto("/");
    await page.locator(".project-hub-recent-list button").first().click();
    await expect(activeGraphTitle(page, "Selection Layout")).toBeVisible();
    await assertGraphTabAddButtonCentered(page);
    await page.locator('[data-node-id="center-log"]').click();
    await expect(page.locator(".selection-toolbox")).toBeVisible();
    await assertLayout(page);
    await assertSelectionToolboxLayout(page);
    await expect(page.locator(".desktop-nav")).toBeHidden();
    await expect(page.locator(".desktop-right-dock")).toBeHidden();
    await page.screenshot({ path: test.info().outputPath("layout-hub-to-workspace-narrow.png"), fullPage: true });
  });

  test("editor preferences survive a desktop webview reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);

    await editorSettingsButton(page).click();
    await expect(editorSettingsPanel(page)).toBeVisible();
    await page.getByRole("checkbox", { name: /^(网格|Grid)$/ }).uncheck();
    await page.getByTitle(/^(将操作栏放到顶部|Place actionbar at top)$/).click();
    await page.getByRole("button", { name: /^(石墨|Graphite)$/ }).click();
    await shortcutInput(page, "Duplicate Selection").fill("Ctrl+Alt+D");
    await expect(page.locator(".canvas .grid")).toHaveCount(0);
    await expect(page.locator(".run-actionbar.top")).toBeVisible();
    await expect(page.locator(".shell.theme-graphite")).toBeVisible();

    const storedBeforeReload = await page.evaluate(() => JSON.parse(window.localStorage.getItem("blueprint.desktop.webviewState") ?? "{}"));
    expect(storedBeforeReload.editorPrefs).toMatchObject({
      gridVisible: false,
      actionBarPlacement: "top",
      language: "zh-CN",
      theme: "graphite",
      shortcuts: {
        "graph.duplicate": "Ctrl+Alt+D"
      }
    });

    await page.reload();
    await expect(page.locator(".desktop-shell")).toBeVisible();
    await expect(page.locator(".canvas .grid")).toHaveCount(0);
    await expect(page.locator(".run-actionbar.top")).toBeVisible();
    await expect(page.locator(".shell.theme-graphite")).toBeVisible();
    await editorSettingsButton(page).click();
    await expect(shortcutInput(page, "Duplicate Selection")).toHaveValue("Ctrl+Alt+D");
    await page.screenshot({ path: test.info().outputPath("layout-editor-prefs-reload.png"), fullPage: true });
  });

  test("built-in themes preserve workspace readability across node states", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(({ graph, state }) => {
      window.localStorage.setItem("blueprint.desktop.activeGraph", JSON.stringify(graph));
      window.localStorage.setItem("blueprint.desktop.webviewState", JSON.stringify(state));
    }, {
      graph: themeStateGraph(),
      state: {
        breakpoints: [{ nodeId: "center-log" }],
        runtimeHistory: {
          activeId: "run-1",
          entries: [
            {
              id: "run-1",
              graphId: "selection-layout",
              ok: false,
              message: "Example runtime error",
              text: "Example runtime error",
              durationMs: 12,
              createdAt: 1,
              traces: [
                { graphId: "selection-layout", nodeId: "near-top-left", nodeName: "Top Left", status: "visited", message: "Visited", timestamp: 1 },
                { graphId: "selection-layout", nodeId: "center-log", nodeName: "Center", status: "error", message: "Example runtime error", timestamp: 2 },
                { graphId: "selection-layout", nodeId: "near-bottom-right", nodeName: "Bottom Right", status: "visited", message: "Visited", timestamp: 3 }
              ]
            }
          ]
        },
        editorPrefs: {
          theme: "comfy-dark"
        }
      }
    });
    await openEditor(page);
    await assertLayout(page);
    await expect(page.locator(".topbar .status")).toHaveCount(0);
    await expect(page.locator(".topbar .zoom")).toHaveCount(0);
    await expect(page.locator(".diagnostic-chip")).toHaveCount(0);

    await page.locator('[data-node-id="center-log"]').click();
    await expect(page.locator('[data-node-id="center-log"] .runtime-badge')).toHaveClass(/error/);
    await page.getByTitle("编辑器设置").click();

    const themeCases = [
      { title: "Comfy 深色", className: "theme-comfy-dark", screenshot: "layout-theme-comfy-dark.png" },
      { title: "石墨", className: "theme-graphite", screenshot: "layout-theme-graphite.png" },
      { title: "高对比", className: "theme-high-contrast", screenshot: "layout-theme-high-contrast.png" }
    ] as const;

    for (const themeCase of themeCases) {
      await page.getByRole("button", { name: themeCase.title }).click();
      await expect(page.locator(`.shell.${themeCase.className}`)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(themeCase.screenshot), fullPage: true });
    }
  });

  test("large graph culling keeps navigation surfaces usable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((graph) => {
      window.localStorage.setItem("blueprint.desktop.activeGraph", JSON.stringify(graph));
    }, largeRenderGraph(500));
    await openEditor(page);
    await expect(activeGraphTitle(page, "Large Render")).toBeVisible();
    await assertLayout(page);

    const renderedNodeCount = await page.locator(".canvas .node").count();
    const renderedWireCount = await page.locator(".canvas .wire:not(.preview)").count();
    expect(renderedNodeCount).toBeGreaterThan(0);
    expect(renderedNodeCount).toBeLessThan(220);
    expect(renderedWireCount).toBeGreaterThan(0);
    expect(renderedWireCount).toBeLessThan(260);
    await expect(nodeLimitText(page, 160, 502)).toBeVisible();

    await filterOutlineInput(page).fill("log-499");
    await expect(focusOutlineNodeButton(page, "log-499")).toBeVisible();
    await focusOutlineNodeButton(page, "log-499").click();
    await expect(page.locator('[data-node-id="log-499"]')).toBeVisible();
    await expect(page.locator("[data-link-id='link-498']")).toHaveCount(1);
    await expect(page.locator("[data-link-id='link-499']")).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath("layout-large-graph.png"), fullPage: true });
  });

  test("large graph browser benchmarks stay within culling budget", async ({ browser }) => {
    const samples: Array<{ logCount: number; openMs: number; focusMs: number; renderedNodeCount: number; renderedWireCount: number }> = [];
    for (const logCount of [200, 500, 1000]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      try {
        await page.addInitScript((graph) => {
          window.localStorage.setItem("blueprint.desktop.activeGraph", JSON.stringify(graph));
        }, largeRenderGraph(logCount));

        const openStartedAt = Date.now();
        await openEditor(page);
        await expect(activeGraphTitle(page, "Large Render")).toBeVisible();
        const openMs = Date.now() - openStartedAt;
        const renderedNodeCount = await page.locator(".canvas .node").count();
        const renderedWireCount = await page.locator(".canvas .wire:not(.preview)").count();
        expect(renderedNodeCount).toBeGreaterThan(0);
        expect(renderedNodeCount).toBeLessThan(220);
        expect(renderedWireCount).toBeGreaterThan(0);
        if (logCount > 260) {
          expect(renderedWireCount).toBeLessThan(logCount);
        } else {
          expect(renderedWireCount).toBe(logCount + 1);
        }

        const focusStartedAt = Date.now();
        await filterOutlineInput(page).fill(`log-${logCount - 1}`);
        await focusOutlineNodeButton(page, `log-${logCount - 1}`).click();
        await expect(page.locator(`[data-node-id="log-${logCount - 1}"]`)).toBeVisible();
        const focusMs = Date.now() - focusStartedAt;

        samples.push({ logCount, openMs, focusMs, renderedNodeCount, renderedWireCount });
        expect(openMs, `${logCount} node open time`).toBeLessThan(12_000);
        expect(focusMs, `${logCount} node focus time`).toBeLessThan(5_000);
      } finally {
        await context.close();
      }
    }
    await test.info().attach("large-graph-benchmark.json", {
      body: JSON.stringify(samples, null, 2),
      contentType: "application/json"
    });
  });
});

async function openEditor(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect(page.locator(".node").first()).toBeVisible();
  await expect(page.locator(".canvas")).toBeVisible();
}

function toolbarOverflowButton(page: Page) {
  return page.getByTitle(/^(工具栏更多|Toolbar overflow)$/);
}

function editorSettingsButton(page: Page) {
  return page.getByTitle(/^(编辑器设置|Editor settings)$/).first();
}

function editorSettingsPanel(page: Page) {
  return page.getByRole("dialog", { name: /^(编辑器设置|Editor Settings)$/ });
}

function shortcutInput(page: Page, commandTitle: string) {
  const translatedTitle = commandTitle === "Duplicate Selection" ? "复制副本" : commandTitle;
  return page.getByLabel(new RegExp(`^(${escapeRegex(translatedTitle)} 的快捷键|Shortcut for ${escapeRegex(commandTitle)})$`));
}

function filterOutlineInput(page: Page) {
  return page.getByPlaceholder(/^(筛选大纲|Filter outline)$/);
}

function activeGraphTitle(page: Page, name: string) {
  void name;
  return page.locator(".canvas");
}

function focusOutlineNodeButton(page: Page, nodeId: string) {
  return page.getByTitle(new RegExp(`^(聚焦大纲节点|Focus outline node) ${escapeRegex(nodeId)}$`));
}

function nodeLimitText(page: Page, visible: number, total: number) {
  return page.getByText(new RegExp(`^(正在显示 ${visible} / ${total} 个节点。筛选大纲可缩小结果。|Showing ${visible} of ${total} nodes\\. Filter outline to narrow results\\.)$`));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function highDpiPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2
  });
  return context.newPage();
}

async function assertLayout(page: Page): Promise<void> {
  await expectNoHorizontalOverflow(page);
  for (const selector of [
    ".desktop-shell",
    ".desktop-editor",
    ".topbar",
    ".canvas",
    ".toolbar-view-controls",
    ".run-actionbar",
    ".minimap"
  ]) {
    await assertInsideViewport(page, selector);
  }
  await assertInsideViewportWhenVisible(page, ".desktop-nav");
  await assertInsideViewportWhenVisible(page, ".desktop-right-dock");

  const boxes = await Promise.all(floatingSelectors.map((selector) => visibleBox(page, selector)));
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      expect(overlapArea(boxes[leftIndex], boxes[rightIndex]), `${floatingSelectors[leftIndex]} overlaps ${floatingSelectors[rightIndex]}`).toBe(0);
    }
  }
}

async function assertSelectionToolboxLayout(page: Page): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await assertInsideViewport(page, ".selection-toolbox");
  const toolbox = await visibleBox(page, ".selection-toolbox");
  for (const selector of floatingSelectors) {
    const other = await visibleBox(page, selector);
    expect(
      overlapArea(toolbox, other),
      `.selection-toolbox overlaps ${selector}: ${JSON.stringify({ toolbox, other })}`
    ).toBe(0);
  }
}

async function assertPortHitAreas(page: Page): Promise<void> {
  const portBoxes = await page.locator(".canvas .node:not(.routing-hub) .port").evaluateAll((ports) =>
    ports.map((port) => {
      const rect = port.getBoundingClientRect();
      return {
        title: port.getAttribute("title") ?? "",
        width: rect.width,
        height: rect.height
      };
    })
  );
  expect(portBoxes.length).toBeGreaterThan(0);
  for (const box of portBoxes) {
    expect(box.height, `${box.title} port height`).toBeGreaterThanOrEqual(28);
    expect(box.width, `${box.title} port width`).toBeGreaterThanOrEqual(28);
  }
}

async function assertWireHitStyles(page: Page): Promise<void> {
  const wireStyles = await page.locator(".canvas .wire:not(.preview)").evaluateAll((wires) =>
    wires.map((wire) => {
      const styles = window.getComputedStyle(wire);
      return {
        id: wire.getAttribute("data-link-id") ?? "",
        strokeWidth: Number.parseFloat(styles.strokeWidth),
        pointerEvents: styles.pointerEvents
      };
    })
  );
  expect(wireStyles.length).toBeGreaterThan(0);
  for (const style of wireStyles) {
    expect(style.strokeWidth, `${style.id} wire stroke width`).toBeGreaterThanOrEqual(3);
    expect(style.pointerEvents, `${style.id} wire pointer events`).toBe("stroke");
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

async function assertInsideViewportWhenVisible(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector).first();
  if (await locator.isVisible()) {
    await assertInsideViewport(page, selector);
  }
}

async function assertInsideViewport(page: Page, selector: string): Promise<void> {
  const box = await visibleBox(page, selector);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box.x, `${selector} left`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${selector} top`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${selector} right`).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  expect(box.y + box.height, `${selector} bottom`).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
}

async function assertGraphTabAddButtonCentered(page: Page): Promise<void> {
  const buttonBox = await visibleBox(page, ".desktop-graph-tab-add");
  const iconBox = await visibleBox(page, ".desktop-graph-tab-add svg");
  const buttonCenter = { x: buttonBox.x + buttonBox.width / 2, y: buttonBox.y + buttonBox.height / 2 };
  const iconCenter = { x: iconBox.x + iconBox.width / 2, y: iconBox.y + iconBox.height / 2 };
  expect(Math.abs(buttonCenter.x - iconCenter.x), "graph tab add icon horizontal center").toBeLessThanOrEqual(1);
  expect(Math.abs(buttonCenter.y - iconCenter.y), "graph tab add icon vertical center").toBeLessThanOrEqual(1);
}

async function visibleBox(page: Page, selector: string): Promise<Box> {
  const locator = page.locator(selector).first();
  await expect(locator, selector).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, selector).not.toBeNull();
  return box as Box;
}

function overlapArea(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return Math.round(x * y);
}

function largeRenderGraph(logCount: number) {
  const nodes = [
    {
      id: "entry",
      templateId: "builtin.control.entry",
      position: { x: 80, y: 80 },
      inputBindings: {}
    }
  ];
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

function selectionLayoutGraph() {
  return {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: "selection-layout",
    name: "Selection Layout",
    description: "Selection toolbox layout graph.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [],
      outputs: []
    },
    nodes: [
      {
        id: "near-top-left",
        templateId: "builtin.debug.log",
        position: { x: 20, y: 24 },
        inputBindings: {
          message: { portId: "message", sourceKind: "literal", literalValue: "top left" }
        }
      },
      {
        id: "center-log",
        templateId: "builtin.debug.log",
        position: { x: 420, y: 260 },
        inputBindings: {
          message: { portId: "message", sourceKind: "literal", literalValue: "center" }
        }
      },
      {
        id: "near-bottom-right",
        templateId: "builtin.debug.log",
        position: { x: 880, y: 585 },
        inputBindings: {
          message: { portId: "message", sourceKind: "literal", literalValue: "bottom right" }
        }
      },
      {
        id: "entry",
        templateId: "builtin.control.entry",
        position: { x: 20, y: 220 },
        inputBindings: {}
      },
      {
        id: "end",
        templateId: "builtin.control.end",
        position: { x: 1120, y: 260 },
        inputBindings: {}
      }
    ],
    links: [
      {
        id: "link-entry-center",
        fromNodeId: "entry",
        fromPortId: "then",
        toNodeId: "center-log",
        toPortId: "exec",
        flowKind: "control"
      },
      {
        id: "link-center-end",
        fromNodeId: "center-log",
        fromPortId: "then",
        toNodeId: "end",
        toPortId: "exec",
        flowKind: "control"
      }
    ],
    layout: {
      viewport: { x: 18, y: 24, zoom: 1 }
    }
  };
}

function themeStateGraph() {
  const graph = selectionLayoutGraph();
  graph.nodes = graph.nodes.map((node) =>
    node.id === "near-top-left"
      ? { ...node, displayOverrides: { ...(node.displayOverrides ?? {}), disabled: true } }
      : node
  );
  return graph;
}

function desktopTemplateSourceSolution() {
  return {
    path: "D:/Project/Gameplay/BlueprintSolution.bsln",
    name: "BlueprintSolution",
    projects: [
      {
        path: "D:/Project/Gameplay/Gameplay.bproj",
        name: "Gameplay",
        templateSources: ["src/**/*.ts", "src/ai/**/*.ts"],
        builtins: {
          typescriptStandardLibrary: true,
          groups: ["Math", "String"]
        },
        graphs: [
          {
            path: "D:/Project/Gameplay/graphs/main.bpgraph",
            id: "main",
            name: "Main",
            kind: "function"
          }
        ]
      }
    ]
  };
}
