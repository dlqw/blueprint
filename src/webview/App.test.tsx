import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBuiltinTemplates } from "../shared/builtins";
import { BlueprintGraph, BlueprintNodeTemplate, EditorToHostMessage } from "../shared/blueprint";
import { App } from "./App";

const postedMessages: EditorToHostMessage[] = [];
let hostState: unknown;

beforeEach(() => {
  postedMessages.length = 0;
  hostState = undefined;
  window.blueprintEditorHostApi = {
    postMessage: (message: EditorToHostMessage) => postedMessages.push(message),
    getState: () => hostState,
    setState: (state: unknown) => {
      hostState = state;
    }
  };
});

afterEach(() => {
  vi.useRealTimers();
});

async function clickToolbarOverflowAction(title: string | RegExp): Promise<void> {
  fireEvent.click(screen.getByTitle(/^(工具栏更多|Toolbar overflow)$/));
  fireEvent.click(await screen.findByTitle(title));
}

describe("Blueprint webview App", () => {
  it("requests graph loading on mount and can retry if the host does not answer", () => {
    vi.useFakeTimers();

    render(<App />);

    expect(postedMessages.filter((message) => message.type === "ready")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    fireEvent.click(screen.getByRole("button", { name: /retry load|重试加载/i }));

    expect(postedMessages.filter((message) => message.type === "ready")).toHaveLength(2);
  });

  it("defaults editor settings to Chinese when no language preference exists", async () => {
    const { container } = renderAppWithGraph(sampleGraph(), { defaultLanguage: false });
    await screen.findAllByText("函数入口");

    expect(screen.getByPlaceholderText("查找节点")).toBeInTheDocument();
    expect(screen.getByText("我的蓝图")).toBeInTheDocument();
    expect(screen.getByText("图大纲")).toBeInTheDocument();
    expect(screen.getByLabelText("画布命令")).toBeInTheDocument();
    expect(screen.getByLabelText("小地图")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("工具栏更多"));
    expect(await screen.findByTitle("连线模式：曲线")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("工具栏更多"));

    const logNode = container.querySelector('[data-node-id="log1"]');
    expect(logNode).toBeTruthy();
    fireEvent.contextMenu(logNode as Element, { clientX: 420, clientY: 160 });
    expect(await screen.findByTitle("复制节点选择")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("关闭节点菜单"));

    fireEvent.click(screen.getByTitle("编辑器设置"));

    expect(screen.getByRole("dialog", { name: "编辑器设置" })).toBeInTheDocument();
    expect(screen.getByText("语言")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toHaveClass("active");
  });

  it("localizes built-in node labels, template search, display modes, and runtime trace labels", async () => {
    const { container } = renderAppWithGraph(sampleGraph(), { defaultLanguage: false });
    await screen.findAllByText("函数入口");
    expect(screen.getAllByText("日志").length).toBeGreaterThan(0);

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas, { clientX: 320, clientY: 220 });
    const search = await screen.findByPlaceholderText("搜索节点模板");
    fireEvent.change(search, { target: { value: "日志" } });
    expect((await screen.findAllByText("日志")).length).toBeGreaterThan(0);
    fireEvent.change(search, { target: { value: "Log" } });
    expect((await screen.findAllByText("日志")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Esc" }));

    fireEvent.click(screen.getByTitle("编辑器设置"));
    fireEvent.click(screen.getByRole("button", { name: "原始" }));
    await screen.findAllByText("Function Entry");
    expect(screen.getAllByText("Log").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "双标签" }));
    await screen.findAllByText("函数入口 / Function Entry");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeResult",
        ok: false,
        message: "Boom",
        stdout: "",
        stderr: "Boom",
        durationMs: 12,
        traces: [
          { graphId: "test", nodeId: "log1", nodeName: "Log", status: "error", timestamp: 1 }
        ]
      }
    }));

    expect((await screen.findAllByText("日志 / Log (log1)")).length).toBeGreaterThan(0);
    expect((hostState as { runtimeHistory?: { entries?: Array<{ traces: Array<{ nodeName?: string }> }> } }).runtimeHistory?.entries?.[0]?.traces[0].nodeName).toBe("Log");
  });

  it("loads a graph, renders nodes, and shows inspector fields", async () => {
    const { container } = renderAppWithGraph(sampleGraph());

    await screen.findAllByText("Function Entry");
    expect((container.querySelector(".node") as HTMLElement | null)?.style.getPropertyValue("--node-accent")).toBe("var(--control)");
    fireEvent.click(screen.getAllByText("Log")[0]);

    expect(screen.getByText("Inspector")).toBeInTheDocument();
    expect(screen.getByText("Writes a value to the runtime console.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hello Blueprint")).toBeEnabled();
    expect(screen.getByText("Message to log.")).toBeInTheDocument();
    expect(screen.getByText("message")).toBeInTheDocument();
    expect(screen.getAllByText("input").length).toBeGreaterThan(0);
    expect(screen.getAllByText("data").length).toBeGreaterThan(0);
    expect(screen.getAllByText("string").length).toBeGreaterThan(0);
    expect(screen.getByText('default "Hello Blueprint"')).toBeInTheDocument();
  });

  it("renders ComfyUI-style node state affordances without changing graph data", async () => {
    hostState = {
      breakpoints: [{ nodeId: "log1" }]
    };
    const graph = sampleGraph();
    graph.nodes = graph.nodes.map((node) => node.id === "log1"
      ? { ...node, displayOverrides: { ...node.displayOverrides, disabled: true } }
      : node);
    const { container } = renderAppWithGraph(graph);
    await screen.findAllByText("Function Entry");

    const graphChangeCount = postedMessages.filter((message) => message.type === "graphChanged").length;
    const logNode = container.querySelector('[data-node-id="log1"]');
    expect(logNode).toHaveClass("node", "disabled");
    expect(logNode?.querySelector(".breakpoint-badge")).toBeTruthy();
    expect(container.querySelectorAll(".minimap-node")).toHaveLength(graph.nodes.length);

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeTrace",
        trace: {
          graphId: graph.id,
          nodeId: "log1",
          nodeName: "Log",
          status: "error",
          message: "Boom",
          timestamp: 1
        }
      }
    }));

    await waitFor(() => {
      const runtimeBadge = container.querySelector('[data-node-id="log1"] .runtime-badge');
      expect(runtimeBadge).toHaveClass("error");
      expect(runtimeBadge).toHaveTextContent("!");
    });
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(graphChangeCount);
  });

  it("keeps canvas commands local to the overlay and out of graph data settings", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({})
    } as DOMRect);

    const canvasCommands = screen.getByLabelText("Canvas commands");
    expect(canvasCommands).toBeInTheDocument();
    expect(screen.getByLabelText("Minimap")).toBeInTheDocument();
    expect(container.querySelectorAll("path.wire")).toHaveLength(1);
    expect(container.querySelector("path.wire")?.getAttribute("d")).toContain(" C ");

    const graphChangeCount = postedMessages.filter((message) => message.type === "graphChanged").length;
    await clickToolbarOverflowAction("Link mode: Spline");
    expect(container.querySelector("path.wire")?.getAttribute("d")).toContain(" L ");
    await clickToolbarOverflowAction("Link mode: Straight");
    expect(container.querySelector("path.wire")?.getAttribute("d")).toContain(" H ");
    expect(container.querySelector("path.wire")?.getAttribute("d")).toContain(" V ");
    await clickToolbarOverflowAction("Link mode: Orthogonal");
    expect(container.querySelectorAll("path.wire")).toHaveLength(0);
    fireEvent.click(screen.getByTitle("Show links"));
    expect(container.querySelector("path.wire")?.getAttribute("d")).toContain(" C ");
    fireEvent.click(screen.getByTitle("Hide links"));
    expect(container.querySelectorAll("path.wire")).toHaveLength(0);
    fireEvent.click(screen.getByTitle("Hide minimap"));
    expect(screen.queryByLabelText("Minimap")).not.toBeInTheDocument();
    await waitFor(() => {
      expect((hostState as { editorPrefs?: { minimapVisible?: boolean; linkRenderMode?: string } }).editorPrefs).toEqual(
        expect.objectContaining({ minimapVisible: false, linkRenderMode: "hidden" })
      );
    });
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(graphChangeCount);

    await clickToolbarOverflowAction("Zoom in");
    await waitFor(() => {
      const zoomed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(zoomed?.type).toBe("graphChanged");
      expect(zoomed?.graph.layout.viewport.zoom).toBeGreaterThan(1);
    });

    const beforeLockedWheel = postedMessages.filter((message) => message.type === "graphChanged").length;
    await clickToolbarOverflowAction("Lock viewport");
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(beforeLockedWheel);
  });

  it("keeps secondary graph commands reachable from the toolbar overflow", async () => {
    renderAppWithGraph(overlappedGraphWithLongLink());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    const overflow = await screen.findByRole("menu");
    expect(within(overflow).getByText("Quick")).toBeInTheDocument();
    expect(within(overflow).getByText("Graph flow")).toBeInTheDocument();
    expect(within(overflow).getByText("Refactor")).toBeInTheDocument();
    expect(within(overflow).getByText("Layout")).toBeInTheDocument();

    fireEvent.click(within(overflow).getByTitle("Find Node"));
    expect(screen.getByPlaceholderText("Find nodes")).toHaveFocus();

    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    fireEvent.click(within(await screen.findByRole("menu")).getByTitle(/auto layout/i));

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      expect(graphChanged?.graph.nodes.some((node) => node.displayOverrides?.autoLayoutHub === true)).toBe(true);
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("collapses selected nodes into an embedded macro from the toolbar overflow", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Collapsed Log");
    const { container } = renderAppWithGraph(collapsibleLogGraph());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getAllByText("Log")[0]);
    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    const overflow = container.querySelector(".toolbar-overflow-menu") as HTMLElement;
    expect(overflow).toBeTruthy();
    fireEvent.click(within(overflow).getByTitle("Collapse Selection To Macro"));

    await waitFor(() => {
      const changed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(changed?.type).toBe("graphChanged");
      expect(changed?.graph.localTemplates?.[0]).toMatchObject({
        id: "macro.collapsed-log",
        bodyKind: "macroExpansion"
      });
      expect(changed?.graph.embeddedGraphs?.[0]).toMatchObject({
        id: "collapsed-log",
        kind: "macro"
      });
      expect(changed?.graph.nodes.some((node) => node.id === "log1")).toBe(false);
      expect(changed?.graph.nodes.some((node) => node.id === "macro-collapsed-log")).toBe(true);
      expect(changed?.graph.links).toEqual([
        expect.objectContaining({ fromNodeId: "entry", toNodeId: "macro-collapsed-log" }),
        expect.objectContaining({ fromNodeId: "macro-collapsed-log", toNodeId: "end" })
      ]);
    });
    expect((await screen.findAllByText("Collapsed Log")).length).toBeGreaterThan(0);
    prompt.mockRestore();
  });

  it("requests project-file extraction for a selected collapsed unit", async () => {
    const prompt = vi.spyOn(window, "prompt")
      .mockReturnValueOnce("Collapsed Log")
      .mockReturnValueOnce("Project Trace Log");
    const { container } = renderAppWithGraph(collapsibleLogGraph());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getAllByText("Log")[0]);
    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    fireEvent.click(within(container.querySelector(".toolbar-overflow-menu") as HTMLElement).getByTitle("Collapse Selection To Macro"));
    await waitFor(() => {
      const changed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(changed?.type).toBe("graphChanged");
      expect(changed?.graph.nodes.some((node) => node.id === "macro-collapsed-log")).toBe(true);
    });

    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    fireEvent.click(within(container.querySelector(".toolbar-overflow-menu") as HTMLElement).getByTitle("Extract Collapsed Unit To Project Graph"));

    expect(postedMessages.filter((message) => message.type === "requestExtractCollapsedUnitToProjectGraph").at(-1)).toEqual({
      type: "requestExtractCollapsedUnitToProjectGraph",
      templateId: "macro.collapsed-log",
      graphName: "Project Trace Log"
    });
    prompt.mockRestore();
  });

  it("collapses selected nodes into an embedded function from the toolbar overflow", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Collapsed Function");
    const { container } = renderAppWithGraph(collapsibleLogGraph());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getAllByText("Log")[0]);
    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    const overflow = container.querySelector(".toolbar-overflow-menu") as HTMLElement;
    expect(overflow).toBeTruthy();
    fireEvent.click(within(overflow).getByTitle("Collapse Selection To Function"));

    await waitFor(() => {
      const changed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(changed?.type).toBe("graphChanged");
      expect(changed?.graph.localTemplates?.[0]).toMatchObject({
        id: "graph.collapsed-function",
        bodyKind: "blueprintGraph"
      });
      expect(changed?.graph.embeddedGraphs?.[0]).toMatchObject({
        id: "collapsed-function",
        kind: "function"
      });
      expect(changed?.graph.nodes.some((node) => node.id === "log1")).toBe(false);
      expect(changed?.graph.nodes.some((node) => node.id === "function-collapsed-function")).toBe(true);
      expect(changed?.graph.links).toEqual([
        expect.objectContaining({ fromNodeId: "entry", toNodeId: "function-collapsed-function" }),
        expect.objectContaining({ fromNodeId: "function-collapsed-function", toNodeId: "end" })
      ]);
    });
    expect((await screen.findAllByText("Collapsed Function")).length).toBeGreaterThan(0);
    prompt.mockRestore();
  });

  it("collapses selected nodes from the contextual selection toolbox", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Toolbox Macro");
    renderAppWithGraph(collapsibleLogGraph());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getAllByText("Log")[0]);
    fireEvent.click(within(screen.getByLabelText("Selection toolbox")).getByTitle("Collapse selection to macro"));

    await waitFor(() => {
      const changed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(changed?.type).toBe("graphChanged");
      expect(changed?.graph.localTemplates?.[0]).toMatchObject({
        id: "macro.toolbox-macro",
        bodyKind: "macroExpansion"
      });
      expect(changed?.graph.nodes.some((node) => node.id === "macro-toolbox-macro")).toBe(true);
    });
    prompt.mockRestore();
  });

  it("toggles selected nodes disabled from the contextual selection toolbox", async () => {
    const { container } = renderAppWithGraph(collapsibleLogGraph());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getAllByText("Log")[0]);
    fireEvent.click(within(screen.getByLabelText("Selection toolbox")).getByTitle("Disable selected nodes"));

    await waitFor(() => {
      const changed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(changed?.type).toBe("graphChanged");
      expect(changed?.graph.nodes.find((node) => node.id === "log1")?.displayOverrides?.disabled).toBe(true);
      expect(container.querySelector('[data-node-id="log1"]')).toHaveClass("disabled");
    });

    fireEvent.click(within(screen.getByLabelText("Selection toolbox")).getByTitle("Enable selected nodes"));
    await waitFor(() => {
      const changed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(changed?.type).toBe("graphChanged");
      expect(changed?.graph.nodes.find((node) => node.id === "log1")?.displayOverrides?.disabled).toBe(false);
    });
  });

  it("restores graph editor preferences from host state without changing graph data", async () => {
    hostState = {
      editorPrefs: {
        minimapVisible: false,
        linkRenderMode: "orthogonal",
        gridVisible: false,
        snapToGrid: true,
        actionBarPlacement: "top",
        theme: "graphite"
      }
    };
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    expect(screen.queryByLabelText("Minimap")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    expect(await screen.findByTitle("Link mode: Orthogonal")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    expect(container.querySelector(".grid")).not.toBeInTheDocument();
    expect(container.querySelector(".shell")).toHaveClass("theme-graphite");
    expect(screen.getByLabelText("Run controls")).toHaveClass("top");
    expect(container.querySelector("path.wire")?.getAttribute("d")).toContain(" H ");
    expect(container.querySelector("path.wire")?.getAttribute("d")).toContain(" V ");
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(0);
  });

  it("persists editor settings from the settings panel without changing graph data", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const graphChangeCount = postedMessages.filter((message) => message.type === "graphChanged").length;
    expect(container.querySelector(".grid")).toBeInTheDocument();
    expect(screen.getByLabelText("Run controls")).toHaveClass("bottom");

    fireEvent.click(screen.getByTitle("Editor settings"));
    fireEvent.click(screen.getByLabelText("Grid"));
    fireEvent.click(screen.getByLabelText("Snap to grid"));
    fireEvent.click(screen.getByTitle("Place actionbar at top"));
    fireEvent.click(screen.getByTitle("Align top toolbar center"));
    fireEvent.click(screen.getByTitle("Set link mode: straight"));
    fireEvent.click(screen.getByRole("button", { name: "Graphite" }));

    await waitFor(() => {
      expect(container.querySelector(".grid")).not.toBeInTheDocument();
      expect(container.querySelector(".shell")).toHaveClass("theme-graphite");
      expect(container.querySelector(".topbar")).toHaveClass("toolbar-align-center");
      expect(screen.getByLabelText("Run controls")).toHaveClass("top");
      expect((hostState as { editorPrefs?: Record<string, unknown> }).editorPrefs).toEqual(
        expect.objectContaining({
          gridVisible: false,
          snapToGrid: true,
          actionBarPlacement: "top",
          toolbarAlignment: "center",
          linkRenderMode: "straight",
          theme: "graphite"
        })
      );
    });
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(graphChangeCount);

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });
    const search = await screen.findByPlaceholderText("Search node templates");
    fireEvent.change(search, { target: { value: "Clamp" } });
    fireEvent.click((await screen.findAllByText("Clamp"))[0]);

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      const clampNode = graphChanged?.graph.nodes.find((node) => node.templateId === "builtin.math.clamp");
      expect(clampNode?.position).toEqual({ x: 312, y: 216 });
    });

    fireEvent.click(screen.getByTitle("Reset editor settings"));
    await waitFor(() => {
      expect(screen.getByLabelText("运行控制")).toHaveClass("bottom");
      expect(container.querySelector(".grid")).toBeInTheDocument();
      expect((hostState as { editorPrefs?: Record<string, unknown> }).editorPrefs).toEqual(
        expect.objectContaining({
          gridVisible: true,
          snapToGrid: false,
          actionBarPlacement: "bottom",
          toolbarAlignment: "right",
          linkRenderMode: "spline",
          minimapVisible: true,
          language: "zh-CN",
          theme: "comfy-dark"
        })
      );
    });
  });

  it("exports and imports editor settings without changing graph data", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const graphChangeCount = postedMessages.filter((message) => message.type === "graphChanged").length;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    fireEvent.click(screen.getByTitle("Editor settings"));
    fireEvent.click(screen.getByTitle("Export editor settings"));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({
      format: "blueprint-editor-prefs",
      version: 1,
      editorPrefs: expect.objectContaining({
        gridVisible: true,
        minimapVisible: true,
        actionBarPlacement: "bottom",
        toolbarAlignment: "right",
        linkRenderMode: "spline",
        snapToGrid: false,
        theme: "comfy-dark"
      })
    });
    expect(await screen.findByText("Settings exported")).toBeInTheDocument();

    const prompt = vi.spyOn(window, "prompt").mockReturnValue(JSON.stringify({
      editorPrefs: {
        gridVisible: false,
        minimapVisible: false,
        snapToGrid: true,
        actionBarPlacement: "top",
        toolbarAlignment: "left",
        linkRenderMode: "orthogonal",
        language: "en-US",
        theme: "high-contrast"
      }
    }));
    fireEvent.click(screen.getByTitle("Import editor settings"));

    await waitFor(() => {
      expect(container.querySelector(".grid")).not.toBeInTheDocument();
      expect(container.querySelector(".minimap")).not.toBeInTheDocument();
      expect(container.querySelector(".shell")).toHaveClass("theme-high-contrast");
      expect(container.querySelector(".topbar")).toHaveClass("toolbar-align-left");
      expect(screen.getByLabelText("Run controls")).toHaveClass("top");
      expect((hostState as { editorPrefs?: Record<string, unknown> }).editorPrefs).toEqual(
        expect.objectContaining({
          gridVisible: false,
          minimapVisible: false,
          snapToGrid: true,
          actionBarPlacement: "top",
          toolbarAlignment: "left",
          linkRenderMode: "orthogonal",
          theme: "high-contrast"
        })
      );
    });
    expect(await screen.findByText("Settings imported")).toBeInTheDocument();
    expect(prompt).toHaveBeenCalledWith("Editor settings JSON", expect.stringContaining("blueprint-editor-prefs"));
    prompt.mockRestore();
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(graphChangeCount);
  });

  it("imports, exports, and resets a custom theme without changing graph data", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const graphChangeCount = postedMessages.filter((message) => message.type === "graphChanged").length;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const customTheme = {
      name: "Studio Contrast",
      tokens: {
        bg: "#101114",
        panelStrong: "#20242d",
        text: "#f5f7fb"
      }
    };
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(JSON.stringify({ theme: customTheme }));

    fireEvent.click(screen.getByTitle("Editor settings"));
    fireEvent.click(screen.getByTitle("Import theme JSON"));

    await waitFor(() => {
      const shell = container.querySelector(".shell") as HTMLElement | null;
      expect(shell).toHaveClass("theme-custom");
      expect(shell?.style.getPropertyValue("--bg")).toBe("#101114");
      expect(shell?.style.getPropertyValue("--panel-strong")).toBe("#20242d");
      expect((hostState as { editorPrefs?: Record<string, unknown> }).editorPrefs).toEqual(
        expect.objectContaining({
          theme: "custom",
          customTheme
        })
      );
    });
    expect(await screen.findByText("Theme imported")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Studio Contrast" })).toHaveClass("active");
    expect(prompt).toHaveBeenCalledWith("Theme JSON", expect.stringContaining("blueprint-theme"));

    fireEvent.click(screen.getByTitle("Export theme JSON"));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({
      format: "blueprint-theme",
      version: 1,
      theme: customTheme
    });
    expect(await screen.findByText("Theme exported")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Reset editor settings"));
    await waitFor(() => {
      expect(container.querySelector(".shell")).toHaveClass("theme-comfy-dark");
      expect((hostState as { editorPrefs?: Record<string, unknown> }).editorPrefs).toEqual(
        expect.objectContaining({
          theme: "comfy-dark"
        })
      );
      expect((hostState as { editorPrefs?: Record<string, unknown> }).editorPrefs).toEqual(
        expect.not.objectContaining({
          customTheme: expect.anything()
        })
      );
    });
    prompt.mockRestore();
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(graphChangeCount);
  });

  it("customizes keyboard shortcuts without changing graph data and reports conflicts", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const graphChangeCount = postedMessages.filter((message) => message.type === "graphChanged").length;
    fireEvent.click(screen.getByTitle("Editor settings"));

    const duplicateShortcut = screen.getByLabelText("Shortcut for Duplicate Selection");
    fireEvent.change(duplicateShortcut, { target: { value: "Ctrl+K" } });
    expect(await screen.findByText("Conflicts with Show Command Palette")).toBeInTheDocument();

    fireEvent.change(duplicateShortcut, { target: { value: "Ctrl+Alt+D" } });
    await waitFor(() => {
      expect(screen.queryByText("Conflicts with Show Command Palette")).not.toBeInTheDocument();
      expect((hostState as { editorPrefs?: { shortcuts?: Record<string, string> } }).editorPrefs?.shortcuts).toEqual({
        "graph.duplicate": "Ctrl+Alt+D"
      });
    });

    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(graphChangeCount);

    fireEvent.keyDown(window, { key: "d", ctrlKey: true, altKey: true });
    await waitFor(() => {
      const duplicated = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(duplicated?.type).toBe("graphChanged");
      expect(duplicated?.graph.nodes).toHaveLength(3);
    });
    expect(container.querySelectorAll(".node.selected")).toHaveLength(1);
  });

  it("shows a contextual selection toolbox for common selected-object actions", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    expect(screen.getByLabelText("Selection toolbox")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector(".shell")?.classList.contains("right-collapsed")).toBe(true);
    });
    const graphChangeCount = postedMessages.filter((message) => message.type === "graphChanged").length;
    fireEvent.click(screen.getByTitle("Show selection info"));
    await waitFor(() => {
      expect(container.querySelector(".shell")?.classList.contains("right-collapsed")).toBe(false);
    });
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(graphChangeCount);

    fireEvent.click(screen.getByTitle("Add breakpoint to selected node"));

    await waitFor(() => {
      const breakpointed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(breakpointed?.type).toBe("graphChanged");
      expect(breakpointed?.graph.debug?.breakpoints?.[0].nodeId).toBe("entry");
    });

    fireEvent.click(screen.getByTitle("Create comment from selection"));
    await waitFor(() => {
      const commented = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(commented?.type).toBe("graphChanged");
      expect(commented?.graph.comments?.[0].nodeIds).toEqual(["entry"]);
    });

    fireEvent.click(screen.getByTitle("Set selected comment color #48b9c7"));
    await waitFor(() => {
      const colored = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(colored?.type).toBe("graphChanged");
      expect(colored?.graph.comments?.[0].color).toBe("#48b9c7");
    });

    fireEvent.click(screen.getByTitle("Delete selection"));
    await waitFor(() => {
      const deleted = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(deleted?.type).toBe("graphChanged");
      expect(deleted?.graph.comments).toEqual([]);
      expect(deleted?.graph.nodes).toHaveLength(2);
    });
  });

  it("opens the command palette and toggles docked sidebars", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Run command"), { target: { value: "hide blueprint" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Run command"), { key: "Enter" });

    await waitFor(() => {
      expect(container.querySelector(".shell")?.classList.contains("left-collapsed")).toBe(true);
      expect(screen.getByTitle("Show Blueprints")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector(".shell")?.classList.contains("left-collapsed")).toBe(false);
    });
  });

  it("opens the template package registry, manages favorites, and creates a template node", async () => {
    renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const graphChangeCount = postedMessages.filter((message) => message.type === "graphChanged").length;
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "loadTemplates", templates: [...getBuiltinTemplates(), typeScriptTemplate()] }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "templateRegistrySources",
        sources: [{
          projectPath: "D:/Project/Gameplay/Gameplay.bproj",
          projectName: "Gameplay",
          templateSources: ["src/**/*.ts"],
          templatePackages: [{
            id: "gameplay.nodes",
            name: "Gameplay Nodes",
            version: "1.2.3",
            templateSources: ["src/**/*.ts"],
            i18n: {
              name: { "en-US": "Gameplay Node Pack", "zh-CN": "玩法节点包" }
            }
          }],
          builtinGroups: ["Math", "String"]
        }]
      }
    }));
    await clickToolbarOverflowAction("Template package registry");

    expect(await screen.findByRole("dialog", { name: "Template package registry" })).toBeInTheDocument();
    expect(screen.getByTitle("Inspect template package Built-in TypeScript")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Inspect template package Gameplay Sources"));
    expect(screen.getByText("Gameplay Node Pack 1.2.3")).toBeInTheDocument();
    expect(screen.getByText("src/**/*.ts")).toBeInTheDocument();
    expect(screen.getByText("Math, String")).toBeInTheDocument();
    expect(screen.getByTitle("Inspect template Double")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Inspect template Double"));
    expect(screen.getByText("examples/Gameplay/src/mathNodes.ts#GameplayMathNodes.double")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Inspect template package Built-in TypeScript"));
    expect(screen.getByTitle("Inspect template Function Entry")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Inspect template package TypeScript Templates"));
    expect(screen.getByTitle("Inspect template Double")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Inspect template Double"));
    expect(screen.getByText("examples/Gameplay/src/mathNodes.ts#GameplayMathNodes.double")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Inspect template package Built-in TypeScript"));

    fireEvent.change(screen.getByPlaceholderText("Search templates and sources"), { target: { value: "clamp" } });
    expect(screen.getByTitle("Inspect template Clamp")).toBeInTheDocument();
    expect(screen.queryByTitle("Inspect template Log")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Favorite template Clamp"));
    await waitFor(() => {
      expect((hostState as { palette?: { favoriteTemplateIds?: string[] } }).palette?.favoriteTemplateIds).toEqual(["builtin.math.clamp"]);
    });
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(graphChangeCount);

    fireEvent.click(screen.getByTitle("Create template node Clamp"));
    await waitFor(() => {
      const changed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(changed?.type).toBe("graphChanged");
      expect(changed?.graph.nodes.some((node) => node.templateId === "builtin.math.clamp")).toBe(true);
    });
    expect(screen.queryByRole("dialog", { name: "Template package registry" })).not.toBeInTheDocument();
  });

  it("disables template packages for new node creation without removing template inspection", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "loadTemplates", templates: [...getBuiltinTemplates(), typeScriptTemplate()] }
    }));

    await clickToolbarOverflowAction("Template package registry");
    expect(await screen.findByRole("dialog", { name: "Template package registry" })).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Inspect template package TypeScript Templates"));
    expect(await screen.findByTitle("Inspect template Double")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Disable template package TypeScript Templates"));
    await waitFor(() => {
      expect((hostState as { palette?: { disabledTemplatePackageIds?: string[] } }).palette?.disabledTemplatePackageIds).toEqual(["typescript"]);
    });
    expect(screen.getByTitle("Template package disabled for Double")).toBeDisabled();

    fireEvent.click(screen.getByTitle("Close template registry"));
    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });
    const search = await screen.findByPlaceholderText("Search node templates");
    fireEvent.change(search, { target: { value: "Double" } });

    expect(screen.queryByText("Double")).not.toBeInTheDocument();
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(0);
  });

  it("applies sanitized category accent theme settings", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "themeSettings",
        categoryAccents: {
          Debug: "#ff55aa",
          Control: "url(javascript:alert(1))"
        }
      }
    }));

    await waitFor(() => {
      expect((container.querySelector('[data-node-id="log1"]') as HTMLElement | null)?.style.getPropertyValue("--node-accent")).toBe("#ff55aa");
      expect((container.querySelector('[data-node-id="entry"]') as HTMLElement | null)?.style.getPropertyValue("--node-accent")).toBe("var(--control)");
    });
  });

  it("rejects low contrast category accent theme settings", async () => {
    const { container } = renderAppWithGraph(graphWithMathNode());
    await screen.findAllByText("Function Entry");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "themeSettings",
        categoryAccents: {
          Math: "#20201f"
        }
      }
    }));

    await waitFor(() => {
      expect((container.querySelector('[data-node-id="add"]') as HTMLElement | null)?.style.getPropertyValue("--node-accent")).toBe("var(--cyan)");
    });
  });

  it("finds and frames nodes in the current graph", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({})
    } as DOMRect);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const findInput = await screen.findByPlaceholderText("Find nodes");
    expect(document.activeElement).toBe(findInput);
    fireEvent.change(findInput, { target: { value: "log" } });
    fireEvent.keyDown(findInput, { key: "Enter" });

    await waitFor(() => {
      expect(container.querySelector(".node.selected .node-header strong")?.textContent).toBe("Log");
      const focused = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(focused?.type).toBe("graphChanged");
      expect(focused?.graph.layout.viewport.x).not.toBe(0);
    });

    window.dispatchEvent(new MessageEvent("message", { data: { type: "focusNode", nodeId: "entry" } }));
    await waitFor(() => {
      expect(container.querySelector(".node.selected .node-header strong")?.textContent).toBe("Function Entry");
    });
  });

  it("finds nodes by template source path and shows match context", async () => {
    const graph: BlueprintGraph = {
      ...sampleGraph(),
      nodes: [
        ...sampleGraph().nodes,
        {
          id: "double1",
          templateId: "ts.TypeScript.Math.Double",
          position: { x: 720, y: 220 },
          inputBindings: {}
        }
      ]
    };
    const { container } = renderAppWithGraph(graph);
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "loadTemplates", templates: [...getBuiltinTemplates(), typeScriptTemplate()] }
    }));
    expect(await screen.findAllByText("Double")).not.toHaveLength(0);

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({})
    } as DOMRect);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const findInput = await screen.findByPlaceholderText("Find nodes");
    fireEvent.change(findInput, { target: { value: "mathNodes" } });

    expect(screen.getByText("Source: examples/Gameplay/src/mathNodes.ts#GameplayMathNodes.double")).toBeInTheDocument();
    fireEvent.keyDown(findInput, { key: "Enter" });

    await waitFor(() => {
      expect(container.querySelector(".node.selected .node-header strong")?.textContent).toBe("Double");
    });
  });

  it("navigates nodes and comments from the graph outline", async () => {
    const graph: BlueprintGraph = {
      ...sampleGraph(),
      comments: [
        {
          id: "comment-startup",
          title: "Startup",
          position: { x: 360, y: 70 },
          size: { width: 380, height: 190 },
          nodeIds: ["log1"],
          color: "#48b9c7"
        }
      ]
    };
    const { container } = renderAppWithGraph(graph);
    await screen.findByText("Graph Outline");
    expect(outlineGroupTitles(container)).toEqual(["Control", "Debug"]);

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({})
    } as DOMRect);

    const outlineFilter = screen.getByPlaceholderText("Filter outline");
    fireEvent.change(outlineFilter, { target: { value: "startup" } });
    expect(screen.queryByTitle("Focus outline node log1")).not.toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Focus outline comment Startup"));
    await waitFor(() => {
      expect(container.querySelector(".comment-box.selected .comment-title")?.textContent).toBe("Startup");
      const focused = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(focused?.type).toBe("graphChanged");
      expect(focused?.graph.layout.viewport.zoom).toBeGreaterThan(0.4);
    });

    fireEvent.change(outlineFilter, { target: { value: "log" } });
    expect(screen.queryByTitle("Focus outline comment Startup")).not.toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(outlineGroupTitles(container)).toEqual(["Debug"]);

    fireEvent.click(screen.getByTitle("Focus outline node log1"));
    await waitFor(() => {
      expect(container.querySelector(".node.selected .node-header strong")?.textContent).toBe("Log");
      const focused = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(focused?.type).toBe("graphChanged");
      expect(focused?.graph.layout.viewport.x).not.toBe(0);
    });
  });

  it("renders My Blueprint structure groups in the sidebar", async () => {
    const graph: BlueprintGraph = {
      ...sampleGraph(),
      name: "Compute Score",
      templateMetadata: {
        creationPath: "Blueprints",
        inputs: [
          {
            id: "score",
            name: "Score",
            direction: "input",
            flowKind: "data",
            type: "number",
            description: "Incoming score.",
            editor: "number",
            defaultValue: 0
          }
        ],
        outputs: [
          {
            id: "result",
            name: "Result",
            direction: "output",
            flowKind: "data",
            type: "boolean",
            description: "Whether the score passed.",
            editor: "boolean",
            defaultValue: false
          }
        ]
      }
    };
    const { container } = renderAppWithGraph(graph);
    await screen.findByText("My Blueprint");

    const structure = container.querySelector(".structure-list") as HTMLElement;
    expect(structure).toBeTruthy();
    expect(screen.getByTitle("Active graph Compute Score")).toHaveTextContent("Compute Score");
    expect(screen.getByTitle("Active graph Compute Score")).toHaveTextContent("function");
    expect(structure.textContent).toContain("Score");
    expect(structure.textContent).toContain("Result");
    expect([...container.querySelectorAll(".structure-group-title")].map((element) => element.firstChild?.textContent?.trim())).toEqual([
      "Graphs",
      "Inputs",
      "Outputs",
      "Templates",
      "Macros"
    ]);
    expect(container.querySelector(".structure-item.template")?.textContent).toContain("templates");
    expect(screen.getByText("No macros loaded")).toBeInTheDocument();
  });

  it("renders solution graph structure and requests graph opening", async () => {
    renderAppWithGraph(sampleGraph());
    await screen.findByText("My Blueprint");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "solutionOutline",
        solution: {
          path: "D:/Project/Gameplay/Gameplay.bsln",
          name: "Gameplay",
          activeGraphPath: "D:/Project/Gameplay/graphs/main.bpgraph",
          projects: [{
            path: "D:/Project/Gameplay/Gameplay.bproj",
            name: "Gameplay",
            graphs: [
              { path: "D:/Project/Gameplay/graphs/main.bpgraph", id: "main", name: "Main", kind: "function" },
              { path: "D:/Project/Gameplay/graphs/trace-macro.bpgraph", id: "trace", name: "Trace Macro", kind: "macro" }
            ]
          }]
        }
      }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "solutionGraphIndex",
        index: {
          solutionPath: "D:/Project/Gameplay/Gameplay.bsln",
          graphs: [{
            projectPath: "D:/Project/Gameplay/Gameplay.bproj",
            projectName: "Gameplay",
            graphPath: "D:/Project/Gameplay/graphs/main.bpgraph",
            graphId: "main",
            graphName: "Main",
            graphKind: "function",
            description: "Startup graph.",
            inputNames: [],
            outputNames: [],
            comments: [],
            nodes: []
          }, {
            projectPath: "D:/Project/Gameplay/Gameplay.bproj",
            projectName: "Gameplay",
            graphPath: "D:/Project/Gameplay/graphs/trace-macro.bpgraph",
            graphId: "trace",
            graphName: "Trace Macro",
            graphKind: "macro",
            description: "Trace shared flow.",
            inputNames: ["Message"],
            outputNames: [],
            comments: ["Trace diagnostics"],
            generatedSourceName: "Trace_Macro.ts",
            generatedFunctionName: "Trace_Macro",
            nodes: [{
              id: "trace-log",
              templateId: "builtin.debug.log",
              inputPortIds: ["message"],
              outputPortIds: ["then"],
              generatedTraceRef: "Trace_Macro:trace-log"
            }]
          }]
        }
      }
    }));

    expect(await screen.findByText("Solution")).toBeInTheDocument();
    expect(screen.getByText("Gameplay")).toBeInTheDocument();
    expect(screen.getByTitle("Open solution graph Main")).toHaveClass("active");

    fireEvent.click(screen.getByTitle("Open solution graph Trace Macro"));

    expect(postedMessages.filter((message) => message.type === "requestOpenGraph").at(-1)).toEqual({
      type: "requestOpenGraph",
      graphPath: "D:/Project/Gameplay/graphs/trace-macro.bpgraph"
    });

    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Trace Diagnostics");
    fireEvent.click(screen.getByTitle("Rename solution graph Trace Macro"));
    expect(postedMessages.filter((message) => message.type === "requestRenameSolutionGraph").at(-1)).toEqual({
      type: "requestRenameSolutionGraph",
      graphPath: "D:/Project/Gameplay/graphs/trace-macro.bpgraph",
      nextName: "Trace Diagnostics"
    });
    expect(prompt).toHaveBeenCalledWith("Graph name", "Trace Macro");
    prompt.mockRestore();

    fireEvent.change(screen.getByPlaceholderText("Find nodes"), { target: { value: "trace-log" } });
    expect(await screen.findByText("Solution matches")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Open solution search result Trace Macro trace-log"));

    expect(postedMessages.filter((message) => message.type === "requestOpenGraph").at(-1)).toEqual({
      type: "requestOpenGraph",
      graphPath: "D:/Project/Gameplay/graphs/trace-macro.bpgraph"
    });

    fireEvent.change(screen.getByPlaceholderText("Find nodes"), { target: { value: "Trace_Macro.ts" } });
    expect(await screen.findByText("Generated: Trace_Macro.ts")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Find nodes"), { target: { value: "Trace_Macro:trace-log" } });
    expect(await screen.findByText("Generated: Trace_Macro:trace-log")).toBeInTheDocument();
  });

  it("opens referenced blueprint and macro graphs when subgraph nodes are double-clicked", async () => {
    const graph = {
      ...sampleGraph(),
      nodes: [
        ...sampleGraph().nodes,
        {
          id: "format1",
          templateId: "graph.format-score",
          position: { x: 680, y: 120 },
          inputBindings: {}
        },
        {
          id: "traceMacro1",
          templateId: "macro.trace-macro",
          position: { x: 960, y: 120 },
          inputBindings: {}
        }
      ]
    };
    const { container } = renderAppWithGraph(graph);
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "loadTemplates",
        templates: [...getBuiltinTemplates(), blueprintGraphTemplate(), macroGraphTemplate()]
      }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "solutionOutline",
        solution: {
          path: "D:/Project/Gameplay/Gameplay.bsln",
          name: "Gameplay",
          activeGraphPath: "D:/Project/Gameplay/graphs/main.bpgraph",
          projects: [{
            path: "D:/Project/Gameplay/Gameplay.bproj",
            name: "Gameplay",
            graphs: [
              { path: "D:/Project/Gameplay/graphs/main.bpgraph", id: "main", name: "Main", kind: "function" },
              { path: "D:/Project/Gameplay/graphs/format-score.bpgraph", id: "format-score", name: "Format Score", kind: "function" },
              { path: "D:/Project/Gameplay/graphs/trace-macro.bpgraph", id: "trace-macro", name: "Trace Macro", kind: "macro" }
            ]
          }]
        }
      }
    }));

    await waitFor(() => {
      expect(container.querySelector('[data-node-id="format1"]')).toBeTruthy();
    });
    fireEvent.doubleClick(container.querySelector('[data-node-id="format1"]') as Element);
    expect(postedMessages.filter((message) => message.type === "requestOpenGraph").at(-1)).toEqual({
      type: "requestOpenGraph",
      graphPath: "D:/Project/Gameplay/graphs/format-score.bpgraph"
    });

    fireEvent.doubleClick(container.querySelector('[data-node-id="traceMacro1"]') as Element);
    expect(postedMessages.filter((message) => message.type === "requestOpenGraph").at(-1)).toEqual({
      type: "requestOpenGraph",
      graphPath: "D:/Project/Gameplay/graphs/trace-macro.bpgraph"
    });
  });

  it("limits large graph outline rendering while keeping full-node filtering", async () => {
    const { container } = renderAppWithGraph(largeRenderGraph(260));
    await screen.findByText("Graph Outline");

    expect(container.querySelectorAll(".outline-node-group .outline-item")).toHaveLength(160);
    expect(screen.getByText("Showing 160 of 262 nodes. Filter outline to narrow results.")).toBeInTheDocument();
    expect(screen.queryByTitle("Focus outline node log-259")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Filter outline"), { target: { value: "log-259" } });

    expect(screen.getByText("1/262")).toBeInTheDocument();
    expect(screen.getByTitle("Focus outline node log-259")).toBeInTheDocument();
    expect(screen.queryByText("Showing 160 of 262 nodes. Filter outline to narrow results.")).not.toBeInTheDocument();
  });

  it("shows selected-node references in the Blueprint sidebar", async () => {
    const { container } = renderAppWithGraph(graphWithSecondLogTarget());
    await screen.findByText("Graph Outline");

    fireEvent.click(screen.getByTitle("Focus outline node log1"));

    expect(await screen.findByText("References")).toBeInTheDocument();
    expect(screen.getByText("Incoming Wires")).toBeInTheDocument();
    expect(screen.getByText("Same Template")).toBeInTheDocument();
    expect(screen.getByTitle("Focus reference node entry")).toHaveTextContent("Function Entry");
    expect(screen.getByTitle("Focus reference node log2")).toHaveTextContent("Log");

    const prompt = vi.spyOn(window, "prompt").mockReturnValue("trace-log");
    fireEvent.click(screen.getByTitle("Rename selected node log1"));
    expect(postedMessages.filter((message) => message.type === "requestRenameGraphNodeId").at(-1)).toEqual({
      type: "requestRenameGraphNodeId",
      oldNodeId: "log1",
      nextNodeId: "trace-log"
    });
    expect(prompt).toHaveBeenCalledWith("Rename node id", "log1");
    prompt.mockRestore();

    fireEvent.click(screen.getByTitle("Focus reference node entry"));
    await waitFor(() => {
      expect(container.querySelector('[data-node-id="entry"]')?.classList.contains("selected")).toBe(true);
    });

    fireEvent.click(screen.getByTitle("Focus outline node log1"));
    fireEvent.click(await screen.findByTitle("Select same-template reference nodes"));
    await waitFor(() => {
      expect(container.querySelector('[data-node-id="log1"]')?.classList.contains("selected")).toBe(true);
      expect(container.querySelector('[data-node-id="log2"]')?.classList.contains("selected")).toBe(true);
    });
  });

  it("finds blackboard variable references in the active graph and solution index", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderAppWithGraph(graphWithBlackboardReferences());
    await screen.findByText("Graph Outline");
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "solutionOutline",
        solution: {
          path: "D:/Project/Gameplay/Gameplay.bsln",
          name: "Gameplay",
          activeGraphPath: "D:/Project/Gameplay/graphs/main.bpgraph",
          projects: [{
            path: "D:/Project/Gameplay/Gameplay.bproj",
            name: "Gameplay",
            graphs: [
              { path: "D:/Project/Gameplay/graphs/main.bpgraph", id: "blackboard", name: "Main", kind: "function" },
              { path: "D:/Project/Gameplay/graphs/ai.bpgraph", id: "ai", name: "AI", kind: "function" }
            ]
          }]
        }
      }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "solutionGraphIndex",
        index: {
          solutionPath: "D:/Project/Gameplay/Gameplay.bsln",
          graphs: [{
            projectPath: "D:/Project/Gameplay/Gameplay.bproj",
            projectName: "Gameplay",
            graphPath: "D:/Project/Gameplay/graphs/main.bpgraph",
            graphId: "blackboard",
            graphName: "Main",
            graphKind: "function",
            description: "Active graph.",
            inputNames: [],
            outputNames: [],
            comments: [],
            nodes: []
          }, {
            projectPath: "D:/Project/Gameplay/Gameplay.bproj",
            projectName: "Gameplay",
            graphPath: "D:/Project/Gameplay/graphs/ai.bpgraph",
            graphId: "ai",
            graphName: "AI",
            graphKind: "function",
            description: "AI graph.",
            inputNames: [],
            outputNames: [],
            comments: [],
            nodes: [{
              id: "remote-get-score",
              templateId: "builtin.blackboard.get",
              inputPortIds: ["key"],
              outputPortIds: ["value"],
              blackboardKey: "score",
              blackboardAccess: "get"
            }]
          }]
        }
      }
    }));

    fireEvent.change(screen.getByPlaceholderText("Find nodes"), { target: { value: "score" } });
    expect(await screen.findAllByText("Variable: score")).not.toHaveLength(0);

    fireEvent.click(screen.getByTitle("Focus outline node get-score"));

    expect(await screen.findByText("Variable Uses")).toBeInTheDocument();
    expect(screen.getByTitle("Focus variable reference node set-score")).toHaveTextContent("Set score");
    expect(screen.getByText("Solution Variable")).toBeInTheDocument();
    expect(screen.getByTitle("Open variable reference AI remote-get-score")).toHaveTextContent("Get score");

    const prompt = vi.spyOn(window, "prompt").mockReturnValue("totalScore");
    fireEvent.click(screen.getByTitle("Rename solution variable score"));
    expect(postedMessages.filter((message) => message.type === "requestRenameSolutionBlackboardKey").at(-1)).toEqual({
      type: "requestRenameSolutionBlackboardKey",
      oldKey: "score",
      nextKey: "totalScore"
    });
    prompt.mockRestore();
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "refactorResult",
        ok: true,
        message: "Renamed blackboard variable 'score' to 'totalScore'; 2 node bindings in 2 graphs; 1 project variable in 1 project"
      }
    }));
    expect(await screen.findByText(/Renamed blackboard variable 'score' to 'totalScore'/)).toBeInTheDocument();

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "refactorResult",
        ok: false,
        message: "Refactor failed: Blackboard variable 'totalScore' already exists in project 'Gameplay'."
      }
    }));
    expect(await screen.findByText(/Refactor failed: Blackboard variable 'totalScore' already exists/)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Copy solution variable references"));
    expect(writeText).toHaveBeenCalledWith("Gameplay / AI / remote-get-score / D:/Project/Gameplay/graphs/ai.bpgraph");

    fireEvent.click(screen.getByTitle("Open variable reference AI remote-get-score"));
    expect(postedMessages.filter((message) => message.type === "requestOpenGraph").at(-1)).toEqual({
      type: "requestOpenGraph",
      graphPath: "D:/Project/Gameplay/graphs/ai.bpgraph"
    });
  });

  it("shows solution-wide template and source-file references for a selected node", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderAppWithGraph(graphWithTypeScriptNode());
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "loadTemplates", templates: [...getBuiltinTemplates(), typeScriptTemplate(), typeScriptRoundTemplate()] }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "solutionOutline",
        solution: {
          path: "D:/Project/Gameplay/Gameplay.bsln",
          name: "Gameplay",
          activeGraphPath: "D:/Project/Gameplay/graphs/main.bpgraph",
          projects: [{
            path: "D:/Project/Gameplay/Gameplay.bproj",
            name: "Gameplay",
            graphs: [
              { path: "D:/Project/Gameplay/graphs/main.bpgraph", id: "test", name: "Main", kind: "function" },
              { path: "D:/Project/Gameplay/graphs/utility.bpgraph", id: "utility", name: "Utility", kind: "function" }
            ]
          }]
        }
      }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "solutionGraphIndex",
        index: {
          solutionPath: "D:/Project/Gameplay/Gameplay.bsln",
          graphs: [{
            projectPath: "D:/Project/Gameplay/Gameplay.bproj",
            projectName: "Gameplay",
            graphPath: "D:/Project/Gameplay/graphs/main.bpgraph",
            graphId: "test",
            graphName: "Main",
            graphKind: "function",
            description: "Active graph.",
            inputNames: [],
            outputNames: [],
            comments: [],
            nodes: [{ id: "double1", templateId: "ts.TypeScript.Math.Double", inputPortIds: ["value"], outputPortIds: ["result"] }]
          }, {
            projectPath: "D:/Project/Gameplay/Gameplay.bproj",
            projectName: "Gameplay",
            graphPath: "D:/Project/Gameplay/graphs/utility.bpgraph",
            graphId: "utility",
            graphName: "Utility",
            graphKind: "function",
            description: "Shared helpers.",
            inputNames: [],
            outputNames: [],
            comments: [],
            nodes: [
              { id: "double-remote", templateId: "ts.TypeScript.Math.Double", inputPortIds: ["value"], outputPortIds: ["result"] },
              { id: "round-remote", templateId: "ts.TypeScript.Math.Round", inputPortIds: ["value"], outputPortIds: ["result"] }
            ]
          }]
        }
      }
    }));

    fireEvent.click(await screen.findByTitle("Focus outline node double1"));

    expect(await screen.findByText("Solution Template")).toBeInTheDocument();
    expect(screen.getByText("Source File")).toBeInTheDocument();
    expect(screen.getByTitle("Open template reference Utility double-remote")).toHaveTextContent("Double");
    expect(screen.getByTitle("Open source reference Utility round-remote")).toHaveTextContent("Round");

    const prompt = vi.spyOn(window, "prompt");
    prompt.mockReturnValueOnce("ts.TypeScript.Math.DoubleV2");
    fireEvent.click(screen.getByTitle("Retarget solution template ts.TypeScript.Math.Double"));
    expect(postedMessages.filter((message) => message.type === "requestRetargetSolutionTemplate").at(-1)).toEqual({
      type: "requestRetargetSolutionTemplate",
      oldTemplateId: "ts.TypeScript.Math.Double",
      nextTemplateId: "ts.TypeScript.Math.DoubleV2"
    });
    expect(prompt).toHaveBeenLastCalledWith("Retarget solution template", "ts.TypeScript.Math.Double");

    prompt.mockReturnValueOnce("examples/Gameplay/src/mathNodesV2.ts");
    fireEvent.click(screen.getByTitle("Retarget source file examples/Gameplay/src/mathNodes.ts"));
    expect(postedMessages.filter((message) => message.type === "requestRetargetSolutionTemplateSource").at(-1)).toEqual({
      type: "requestRetargetSolutionTemplateSource",
      oldSourcePath: "examples/Gameplay/src/mathNodes.ts",
      nextSourcePath: "examples/Gameplay/src/mathNodesV2.ts"
    });
    expect(prompt).toHaveBeenLastCalledWith("Retarget source file", "examples/Gameplay/src/mathNodes.ts");
    prompt.mockRestore();

    fireEvent.click(screen.getByTitle("Copy solution template references"));
    expect(writeText).toHaveBeenCalledWith("Gameplay / Utility / double-remote / D:/Project/Gameplay/graphs/utility.bpgraph");

    fireEvent.click(screen.getByTitle("Copy source-file references"));
    expect(writeText).toHaveBeenLastCalledWith("Gameplay / Utility / round-remote / D:/Project/Gameplay/graphs/utility.bpgraph");

    fireEvent.click(screen.getByTitle("Open template reference Utility double-remote"));
    expect(postedMessages.filter((message) => message.type === "requestOpenGraph").at(-1)).toEqual({
      type: "requestOpenGraph",
      graphPath: "D:/Project/Gameplay/graphs/utility.bpgraph"
    });
  });

  it("focuses validation diagnostics on nodes, ports, and links", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({})
    } as DOMRect);

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "validationResult",
        issues: [
          { severity: "warning", message: "Message input is missing.", nodeId: "log1", portId: "message" },
          { severity: "error", message: "Control link is broken.", linkId: "link-entry-log" }
        ]
      }
    }));

    fireEvent.click(await screen.findByRole("button", { name: /warning Message input is missing/ }));
    await waitFor(() => {
      expect(container.querySelector(".node.selected .node-header strong")?.textContent).toBe("Log");
      expect(container.querySelector('button[title^="Message: string"]')?.classList.contains("issue-focus")).toBe(true);
    });

    fireEvent.click(await screen.findByRole("button", { name: /error Control link is broken/ }));
    await waitFor(() => {
      expect(container.querySelector('path[data-link-id="link-entry-log"]')?.classList.contains("selected")).toBe(true);
    });
  });

  it("renders compile diagnostics as focusable issues", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({})
    } as DOMRect);

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "compileResult",
        ok: false,
        message: "Compile failed.",
        issues: [{
          severity: "error",
          message: "Literal for 'Message' does not match string.",
          graphId: "main",
          graphName: "Main",
          sourcePath: "Gameplay/graphs/main.bpgraph",
          nodeId: "log1",
          portId: "message"
        }]
      }
    }));

    const compileDiagnostic = await screen.findByRole("button", { name: /error Literal for 'Message' does not match string/ });
    expect(compileDiagnostic).toHaveTextContent("Gameplay/graphs/main.bpgraph · Main · node log1 · port message");
    fireEvent.click(compileDiagnostic);
    await waitFor(() => {
      expect(container.querySelector(".node.selected .node-header strong")?.textContent).toBe("Log");
      expect(container.querySelector('button[title^="Message: string"]')?.classList.contains("issue-focus")).toBe(true);
    });
  });

  it("requests a run, renders captured output, and restores runtime history", async () => {
    const graph = alignmentGraph();
    const { container } = renderAppWithGraph(graph);
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getByTitle(/run graph/i));
    const runRequest = postedMessages.filter((message) => message.type === "requestRun").at(-1);
    expect(runRequest?.type).toBe("requestRun");
    expect(runRequest?.graph.id).toBe(graph.id);
    expect(screen.getByText("Pending")).toBeInTheDocument();

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeTrace",
        trace: { graphId: graph.id, nodeId: "entry", nodeName: "Function Entry", status: "active", timestamp: 1 }
      }
    }));

    expect(await screen.findByTitle("Running: active")).toHaveTextContent("RUN");
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByTitle("Runtime progress nodes")).toHaveTextContent("1 node");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeTrace",
        trace: { graphId: graph.id, nodeId: "log1", nodeName: "Log", status: "active", timestamp: 2 }
      }
    }));

    await waitFor(() => {
      expect(screen.getAllByTitle("Running: active")).toHaveLength(1);
      expect(screen.getByTitle("Last run: visited")).toHaveTextContent("OK");
      expect(screen.getByTitle("Runtime progress nodes")).toHaveTextContent("2 nodes");
    });

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeResult",
        ok: true,
        message: "Run completed.",
        stdout: "Hello Blueprint\n",
        stderr: "",
        durationMs: 12,
        traces: [
          { graphId: graph.id, nodeId: "entry", nodeName: "Function Entry", status: "visited", timestamp: 1 },
          { graphId: graph.id, nodeId: "branch", nodeName: "Branch", status: "skipped", timestamp: 2 },
          { graphId: graph.id, nodeId: "log1", nodeName: "Log", status: "visited", context: { message: "Hello Blueprint" }, timestamp: 3 }
        ]
      }
    }));

    expect(await screen.findByText(/Run: Hello Blueprint/)).toBeInTheDocument();
    expect(await screen.findAllByTitle("Last run: visited")).toHaveLength(2);
    expect(await screen.findByTitle("Last run: skipped")).toHaveTextContent("SK");
    expect(await screen.findByText("Trace 1/3")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Next runtime trace"));
    expect(await screen.findByText("Trace 2/3")).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector(".node.selected .node-header strong")?.textContent).toBe("Branch");
    });

    fireEvent.click(screen.getByTitle("Show run details"));
    expect(await screen.findByText("Run Details")).toBeInTheDocument();
    expect(await screen.findByText("3/3 traces · 12ms")).toBeInTheDocument();
    expect(await screen.findByText('message: "Hello Blueprint"')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Group runtime traces by status"));
    expect([...container.querySelectorAll(".runtime-detail-group-title strong")].map((element) => element.textContent)).toEqual(["visited", "skipped"]);
    fireEvent.change(screen.getByPlaceholderText("Filter traces"), { target: { value: "hello" } });
    expect(await screen.findByText("1/3 traces · 12ms")).toBeInTheDocument();
    expect(screen.queryByTitle("Inspect runtime trace 2: Branch (branch)")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Filter traces"), { target: { value: "" } });
    fireEvent.click(screen.getByTitle("Filter runtime traces by skipped"));
    expect(await screen.findByText("1/3 traces · 12ms")).toBeInTheDocument();
    expect(screen.getByTitle("Inspect runtime trace 2: Branch (branch)")).toBeInTheDocument();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByTitle("Copy filtered run details as JSON"));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const exported = JSON.parse(writeText.mock.calls[0][0]);
    expect(exported.filter).toEqual({ query: "", status: "skipped", groupBy: "status" });
    expect(exported.traces).toEqual([
      expect.objectContaining({ index: 1, nodeId: "branch", status: "skipped" })
    ]);
    expect(screen.getByTitle("Copy filtered run details as JSON")).toHaveTextContent("Copied");
    fireEvent.click(screen.getByTitle("Filter runtime traces by All"));
    fireEvent.click(screen.getByTitle("Inspect runtime trace 3: Log (log1)"));
    expect(await screen.findByText("Trace 3/3")).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector(".node.selected .node-header strong")?.textContent).toBe("Log");
    });

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeResult",
        ok: false,
        message: "Boom",
        stdout: "",
        stderr: "Boom",
        durationMs: 20,
        traces: [
          { graphId: graph.id, nodeId: "log1", nodeName: "Log", status: "error", message: "Boom", timestamp: 3 }
        ]
      }
    }));

    expect(await screen.findByTitle("Last run: error")).toBeInTheDocument();
    expect(screen.getByText("Runtime error")).toBeInTheDocument();
    expect(screen.getByText(/1 runtime error/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Focus first runtime error"));
    expect(await screen.findByText("Trace 1/1")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Show run details"));
    expect(await screen.findByTitle("Current run compared with the previous run")).toHaveTextContent("vs previous");
    expect(screen.getByTitle("Current run compared with the previous run")).toHaveTextContent("+8ms");
    expect(screen.getByTitle("Current run compared with the previous run")).toHaveTextContent("1 changed · 0 new · 2 missing");
    expect(screen.getByTitle("Filter run differences by All")).toHaveTextContent("All 3");
    expect(screen.getByTitle("Filter run differences by changed")).toHaveTextContent("changed 1");
    expect(screen.getByTitle("Filter run differences by missing")).toHaveTextContent("missing 2");
    expect(screen.getByTitle("Sort run differences by kind")).toHaveClass("active");
    expect(screen.getByTitle("Inspect changed runtime node Log (log1)")).toHaveTextContent("visited -> error");
    expect(screen.getByText("Function Entry (entry)")).toBeInTheDocument();
    expect(screen.getByText("was visited")).toBeInTheDocument();
    expect(screen.getByText("Branch (branch)")).toBeInTheDocument();
    expect(screen.getByText("was skipped")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Sort run differences by node"));
    expect([...container.querySelectorAll(".runtime-compare-item > span")].map((element) => element.textContent)).toEqual([
      "Branch (branch)",
      "Function Entry (entry)",
      "Log (log1)"
    ]);
    fireEvent.click(screen.getByTitle("Copy filtered run comparison as JSON"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const exportedComparison = JSON.parse(writeText.mock.calls[1][0]);
    expect(exportedComparison.filter).toEqual({ kind: "all", sort: "node" });
    expect(exportedComparison.summary).toEqual({
      previousDurationMs: 12,
      durationDeltaMs: 8,
      changed: 1,
      added: 0,
      missing: 2
    });
    expect(exportedComparison.items.map((item: { label: string }) => item.label)).toEqual([
      "Branch (branch)",
      "Function Entry (entry)",
      "Log (log1)"
    ]);
    expect(screen.getByTitle("Copy filtered run comparison as JSON")).toHaveTextContent("Copied");
    fireEvent.click(screen.getByTitle("Filter run differences by missing"));
    expect(screen.queryByTitle("Inspect changed runtime node Log (log1)")).not.toBeInTheDocument();
    expect(screen.getByText("Function Entry (entry)")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Filter run differences by All"));
    const changedDiff = screen.getByTitle("Inspect changed runtime node Log (log1)");
    fireEvent.click(changedDiff);
    expect(changedDiff).toHaveClass("pinned");
    expect(await screen.findByText("Trace 1/1")).toBeInTheDocument();

    expect(screen.getByTitle("Open run history")).toHaveTextContent("2");
    fireEvent.click(screen.getByTitle("Open run history"));
    const historyDialog = await screen.findByRole("dialog", { name: "History" });
    const historyButtons = historyDialog.querySelectorAll(".run-history-item");
    expect(historyButtons).toHaveLength(2);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Failure Baseline");
    fireEvent.click(within(historyDialog).getByTitle("Rename run 1"));
    expect(prompt).toHaveBeenCalledWith("Run label", "");
    expect(await screen.findByText(/Run failed Failure Baseline: Boom/)).toBeInTheDocument();
    expect((hostState as { runtimeHistory?: { entries?: Array<{ label?: string }> } }).runtimeHistory?.entries?.[0].label).toBe("Failure Baseline");
    prompt.mockRestore();
    fireEvent.click(within(historyDialog).getByTitle("Pin run 1"));
    expect((hostState as { runtimeHistory?: { entries?: Array<{ pinned?: boolean }> } }).runtimeHistory?.entries?.[0].pinned).toBe(true);
    expect(within(historyDialog).getByTitle("Unpin run 1")).toBeInTheDocument();

    fireEvent.click(historyDialog.querySelectorAll(".run-history-item")[1]);

    expect(await screen.findByText(/Run: Hello Blueprint/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryAllByTitle("Last run: visited")).toHaveLength(2);
      expect(screen.getByTitle("Last run: skipped")).toHaveTextContent("SK");
    });
    fireEvent.click(within(historyDialog).getByTitle("Delete run 1"));
    expect((hostState as { runtimeHistory?: { entries?: Array<{ label?: string }> } }).runtimeHistory?.entries).toHaveLength(1);
    expect(screen.queryByText("Failure Baseline")).not.toBeInTheDocument();
    fireEvent.click(within(historyDialog).getByTitle("Clear run history"));
    await waitFor(() => {
      expect((hostState as { runtimeHistory?: { entries?: unknown[]; activeId?: string } }).runtimeHistory?.entries).toEqual([]);
      expect((hostState as { runtimeHistory?: { entries?: unknown[]; activeId?: string } }).runtimeHistory?.activeId).toBeUndefined();
      expect(screen.queryByText(/Run: Hello Blueprint/)).not.toBeInTheDocument();
    });
  });

  it("compares runtime node input context changes", async () => {
    const graph = sampleGraph();
    renderAppWithGraph(graph);
    await screen.findAllByText("Function Entry");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeResult",
        ok: true,
        message: "Run A",
        stdout: "Run A\n",
        stderr: "",
        durationMs: 10,
        traces: [
          { graphId: graph.id, nodeId: "log1", nodeName: "Log", status: "visited", context: { message: "A" }, timestamp: 1 }
        ]
      }
    }));
    expect(await screen.findByText(/Run: Run A/)).toBeInTheDocument();

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeResult",
        ok: true,
        message: "Run B",
        stdout: "Run B\n",
        stderr: "",
        durationMs: 13,
        traces: [
          { graphId: graph.id, nodeId: "log1", nodeName: "Log", status: "visited", context: { message: "B" }, timestamp: 2 }
        ]
      }
    }));

    expect(await screen.findByText(/Run: Run B/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Show run details"));
    expect(await screen.findByTitle("Current run compared with the previous run")).toHaveTextContent("1 changed · 0 new · 0 missing");
    expect(screen.getByTitle("Inspect changed runtime node Log (log1)")).toHaveTextContent("context changed");
    expect(screen.getByText("Previous context")).toBeInTheDocument();
    expect(screen.getByText("Current context")).toBeInTheDocument();
    expect(screen.getByText(/"message": "A"/)).toBeInTheDocument();
    expect(screen.getByText(/"message": "B"/)).toBeInTheDocument();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByTitle("Copy runtime difference JSON for Log (log1)"));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const exportedItem = JSON.parse(writeText.mock.calls[0][0]);
    expect(exportedItem.item).toEqual(expect.objectContaining({
      kind: "changed",
      nodeId: "log1",
      previousContext: { message: "A" },
      currentContext: { message: "B" },
      contextChanged: true
    }));
    expect(screen.getByTitle("Copy runtime difference JSON for Log (log1)")).toHaveTextContent("Copied");
  });

  it("sends a cancel request for an active run", async () => {
    renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getByTitle(/run graph/i));
    expect(screen.getByTitle(/cancel run/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(/cancel run/i));
    const cancelRequest = postedMessages.filter((message) => message.type === "requestCancelRun").at(-1);
    expect(cancelRequest?.type).toBe("requestCancelRun");
    expect(screen.getByTitle(/run graph/i)).toBeInTheDocument();

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeResult",
        ok: false,
        message: "Run canceled.",
        stdout: "",
        stderr: "",
        durationMs: 5,
        traces: []
      }
    }));

    expect(await screen.findByText(/Run failed: Run canceled\./)).toBeInTheDocument();
  });

  it("renders queued run counts from runtime queue status messages", async () => {
    renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeQueueStatus",
        status: { running: true, queuedRuns: 2, activeRunId: "run-1" }
      }
    }));

    expect(await screen.findByText("Pending")).toBeInTheDocument();
    expect(screen.getByTitle("Hide run history (1 running, 2 queued)")).toHaveTextContent("History");
    expect(screen.getByTitle("Queued runs")).toHaveTextContent("2 queued");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeQueueStatus",
        status: { running: false, queuedRuns: 2 }
      }
    }));

    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(screen.getByTitle("Hide run history (2 queued)")).toHaveTextContent("History");
    expect(screen.getByTitle(/run graph/i)).toBeInTheDocument();
  });

  it("requests step-mode runs and advances paused runtime steps", async () => {
    const graph = sampleGraph();
    const { container } = renderAppWithGraph(graph);
    await screen.findAllByText("Function Entry");

    const runtimeToolbar = container.querySelectorAll(".topbar .toolbar .toolbar-group")[2] as HTMLElement;
    fireEvent.click(within(runtimeToolbar).getByTitle("Step run"));
    const runRequest = postedMessages.filter((message) => message.type === "requestRun").at(-1);
    expect(runRequest?.type).toBe("requestRun");
    expect(runRequest?.stepMode).toBe(true);
    expect(screen.getByTitle(/step runtime/i)).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeTrace",
        trace: { graphId: graph.id, nodeId: "entry", nodeName: "Function Entry", status: "paused", timestamp: 1 }
      }
    }));

    expect(await screen.findByTitle("Running: paused")).toHaveTextContent("PAU");
    expect(screen.getByText("Paused")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(/step runtime/i));
    expect(postedMessages.filter((message) => message.type === "requestRuntimeStep").at(-1)?.type).toBe("requestRuntimeStep");

    fireEvent.click(screen.getByTitle(/continue runtime/i));
    expect(postedMessages.filter((message) => message.type === "requestRuntimeContinue").at(-1)?.type).toBe("requestRuntimeContinue");
  });

  it("sends selected node breakpoints with run requests and renders breakpoint hits", async () => {
    renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getByTitle("Add breakpoint to selected node"));
    expect(screen.getByTitle("Breakpoint")).toBeInTheDocument();
    expect(screen.getByText("Breakpoints")).toBeInTheDocument();
    expect((hostState as { breakpoints?: unknown[] }).breakpoints).toEqual([{ nodeId: "entry" }]);
    expect(postedMessages.filter((message) => message.type === "graphChanged").at(-1)?.graph.debug?.breakpoints).toEqual([{ nodeId: "entry" }]);

    const conditionInput = screen.getByPlaceholderText("hit >= 2");
    fireEvent.change(conditionInput, { target: { value: "hit >= 2" } });
    expect((hostState as { breakpoints?: unknown[] }).breakpoints).toEqual([{ nodeId: "entry", condition: "hit >= 2" }]);
    fireEvent.blur(conditionInput);
    expect(postedMessages.filter((message) => message.type === "graphChanged").at(-1)?.graph.debug?.breakpoints).toEqual([{ nodeId: "entry", condition: "hit >= 2" }]);

    fireEvent.click(screen.getByTitle(/run graph/i));
    const runRequest = postedMessages.filter((message) => message.type === "requestRun").at(-1);
    expect(runRequest?.type).toBe("requestRun");
    expect(runRequest?.breakpoints).toEqual([{ nodeId: "entry", condition: "hit >= 2" }]);

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "runtimeResult",
        ok: false,
        message: "Breakpoint hit at Function Entry",
        stdout: "",
        stderr: "Breakpoint hit at Function Entry",
        durationMs: 7,
        traces: [
          { graphId: "test", nodeId: "entry", nodeName: "Function Entry", status: "breakpoint", message: "Breakpoint hit at Function Entry", timestamp: 4 }
        ]
      }
    }));

    expect(await screen.findByTitle("Last run: breakpoint")).toHaveTextContent("BP");

    fireEvent.click(screen.getByTitle("Clear breakpoint entry"));
    expect((hostState as { breakpoints?: unknown[] }).breakpoints).toEqual([]);
    expect(postedMessages.filter((message) => message.type === "graphChanged").at(-1)?.graph.debug?.breakpoints).toEqual([]);
    expect(screen.queryByTitle("Breakpoint")).not.toBeInTheDocument();
  });

  it("loads persisted graph debug breakpoints before running", async () => {
    renderAppWithGraph({
      ...sampleGraph(),
      debug: {
        breakpoints: [{ nodeId: "log1", condition: "every 2" }]
      }
    });
    await screen.findAllByText("Function Entry");

    expect(screen.getByDisplayValue("every 2")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(/run graph/i));
    const runRequest = postedMessages.filter((message) => message.type === "requestRun").at(-1);

    expect(runRequest?.type).toBe("requestRun");
    expect(runRequest?.breakpoints).toEqual([{ nodeId: "log1", condition: "every 2" }]);
  });

  it("opens the node creation panel from a blank canvas right click and creates a node", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });

    const search = await screen.findByPlaceholderText("Search node templates");
    fireEvent.change(search, { target: { value: "Clamp" } });
    fireEvent.click((await screen.findAllByText("Clamp"))[0]);

    const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
    expect(graphChanged?.type).toBe("graphChanged");
    expect(graphChanged?.graph.nodes.some((node) => node.templateId === "builtin.math.clamp")).toBe(true);
  });

  it("filters node creation candidates by category", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });

    await screen.findByPlaceholderText("Search node templates");
    fireEvent.click(screen.getByTitle("Filter node templates by Math"));

    const labels = [...container.querySelectorAll(".node-panel .templates .candidate-main strong")].map((element) => element.textContent);
    expect(labels).toContain("Clamp");
    expect(labels).not.toContain("Log");

    fireEvent.click(screen.getByTitle("Filter node templates by All"));
    const allLabels = [...container.querySelectorAll(".node-panel .templates .candidate-main strong")].map((element) => element.textContent);
    expect(allLabels).toContain("Log");
  });

  it("shows port summaries for the active node creation candidate", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });

    const search = await screen.findByPlaceholderText("Search node templates");
    fireEvent.change(search, { target: { value: "Log" } });

    const details = container.querySelector(".node-panel .details");
    expect(details?.textContent).toContain("Control In");
    expect(details?.textContent).toContain("Exec");
    expect(details?.textContent).toContain("Data In");
    expect(details?.textContent).toContain("Message");
    expect(details?.textContent).toContain("string");
  });

  it("supports keyboard node creation and records recent templates", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });

    const search = await screen.findByPlaceholderText("Search node templates");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      expect(graphChanged?.graph.nodes.some((node) => node.templateId === "builtin.control.end")).toBe(true);
      expect((hostState as { palette?: { recentTemplateIds?: string[] } }).palette?.recentTemplateIds?.[0]).toBe("builtin.control.end");
    });
  });

  it("favorites node templates and ranks favorites first", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });

    const search = await screen.findByPlaceholderText("Search node templates");
    fireEvent.change(search, { target: { value: "Log" } });
    fireEvent.click(await screen.findByTitle("Favorite node template"));
    expect((hostState as { palette?: { favoriteTemplateIds?: string[] } }).palette?.favoriteTemplateIds?.[0]).toBe("builtin.debug.log");

    fireEvent.click(screen.getByText("Esc"));
    fireEvent.contextMenu(canvas as Element, { clientX: 360, clientY: 240 });

    await waitFor(() => {
      const firstCandidate = container.querySelector(".node-panel .candidate-main strong");
      expect(firstCandidate?.textContent).toBe("Log");
    });
  });

  it("filters node creation candidates by recent and favorite templates", async () => {
    hostState = {
      palette: {
        recentTemplateIds: ["builtin.control.branch"],
        favoriteTemplateIds: ["builtin.debug.log"]
      }
    };
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });

    const panel = await waitFor(() => {
      const nodePanel = container.querySelector(".node-panel") as HTMLElement | null;
      expect(nodePanel).toBeTruthy();
      return nodePanel as HTMLElement;
    });

    fireEvent.click(within(panel).getByTitle("Filter node templates by Favorites"));
    expect([...panel.querySelectorAll(".candidate-main strong")].map((entry) => entry.textContent)).toEqual(["Log"]);

    fireEvent.click(within(panel).getByTitle("Filter node templates by Recent"));
    expect([...panel.querySelectorAll(".candidate-main strong")].map((entry) => entry.textContent)).toEqual(["Branch"]);
  });

  it("shows node creation empty states without creating a node on enter", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });

    const search = await screen.findByPlaceholderText("Search node templates");
    fireEvent.change(search, { target: { value: "missing-template" } });

    expect(await screen.findByRole("status")).toHaveTextContent("No matching templates");
    expect(screen.getByRole("status")).toHaveTextContent('No templates match "missing-template".');

    const graphChangeCount = postedMessages.filter((message) => message.type === "graphChanged").length;
    fireEvent.keyDown(search, { key: "Enter" });
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(graphChangeCount);
    expect(container.querySelector(".node-panel .candidate-main")).toBeNull();
  });

  it("supports keyboard category switching and page-sized candidate movement", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.contextMenu(canvas as Element, { clientX: 320, clientY: 220 });

    const search = await screen.findByPlaceholderText("Search node templates");
    const panel = await waitFor(() => {
      const nodePanel = container.querySelector(".node-panel") as HTMLElement | null;
      expect(nodePanel).toBeTruthy();
      return nodePanel as HTMLElement;
    });
    const activeTemplateName = () => panel.querySelector(".candidate.active .candidate-main strong")?.textContent;
    const activeCategoryName = () => panel.querySelector(".category-filter.active span")?.textContent;

    expect(activeTemplateName()).toBe("Function Entry");
    fireEvent.keyDown(search, { key: "PageDown" });
    expect(activeTemplateName()).not.toBe("Function Entry");
    fireEvent.keyDown(search, { key: "PageUp" });
    expect(activeTemplateName()).toBe("Function Entry");

    fireEvent.keyDown(search, { key: "ArrowRight", ctrlKey: true });
    await waitFor(() => expect(activeCategoryName()).toBe("Blackboard"));
    expect([...panel.querySelectorAll(".candidate-main strong")].map((entry) => entry.textContent)).toEqual(["Get Blackboard Value", "Set Blackboard Value"]);

    fireEvent.keyDown(search, { key: "ArrowLeft", ctrlKey: true });
    await waitFor(() => expect(activeCategoryName()).toBe("All"));
  });

  it("posts a graph change when the canvas is zoomed", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    expect(canvas).toBeTruthy();
    fireEvent.wheel(canvas as Element, { deltaY: -100, clientX: 300, clientY: 240 });

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      expect(graphChanged?.graph.layout.viewport.zoom).toBeGreaterThan(1);
    });
  });

  it("tracks canvas interaction modes through the interaction reducer", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    expect(canvas).toHaveAttribute("data-interaction", "idle");

    firePointer(canvas, "pointerdown", { pointerId: 11, button: 0, clientX: 120, clientY: 140 });
    await waitFor(() => expect(canvas).toHaveAttribute("data-interaction", "marquee"));
    firePointer(canvas, "pointermove", { pointerId: 11, button: 0, clientX: 220, clientY: 240 });
    firePointer(canvas, "pointerup", { pointerId: 11, button: 0, clientX: 220, clientY: 240 });
    await waitFor(() => expect(canvas).toHaveAttribute("data-interaction", "idle"));

    firePointer(canvas, "pointerdown", { pointerId: 12, button: 1, clientX: 120, clientY: 140 });
    await waitFor(() => expect(canvas).toHaveAttribute("data-interaction", "pan"));
    firePointer(canvas, "pointerup", { pointerId: 12, button: 1, clientX: 130, clientY: 150 });
    await waitFor(() => expect(canvas).toHaveAttribute("data-interaction", "idle"));
  });

  it("renders a minimap and centers the viewport from a minimap click", async () => {
    const graph = largeRenderGraph(20);
    const { container } = renderAppWithGraph(graph);
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({})
    } as DOMRect);

    const minimap = container.querySelector(".minimap") as HTMLElement;
    expect(minimap).toBeTruthy();
    expect(container.querySelectorAll(".minimap-node")).toHaveLength(graph.nodes.length);
    const minimapNodeFills = Array.from(container.querySelectorAll(".minimap-node"), (node) => (node as SVGRectElement).getAttribute("fill") ?? "");
    expect(minimapNodeFills).toContain((container.querySelector('[data-node-id="entry"]') as HTMLElement | null)?.style.getPropertyValue("--node-accent"));
    expect(minimapNodeFills).toContain((container.querySelector('[data-node-id="log-0"]') as HTMLElement | null)?.style.getPropertyValue("--node-accent"));
    vi.spyOn(minimap, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 172,
      bottom: 112,
      width: 172,
      height: 112,
      toJSON: () => ({})
    } as DOMRect);

    fireEvent.pointerDown(minimap, { clientX: 150, clientY: 56, button: 0 });

    await waitFor(() => {
      const moved = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(moved?.type).toBe("graphChanged");
      expect(moved?.graph.layout.viewport.x).toBeLessThan(-1000);
      expect(moved?.graph.layout.viewport.zoom).toBe(graph.layout.viewport.zoom);
    });
  });

  it("opens node creation from a dragged port and auto-connects the new node", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    const entryThenPort = container.querySelector('button[title^="Then: exec"]');
    expect(canvas).toBeTruthy();
    expect(entryThenPort).toBeTruthy();

    fireEvent.pointerDown(entryThenPort as Element, { clientX: 348, clientY: 176, button: 0 });
    fireEvent.pointerUp(canvas as Element, { clientX: 720, clientY: 260, button: 0 });

    const search = await screen.findByPlaceholderText("Search node templates");
    fireEvent.change(search, { target: { value: "Log" } });
    expect(await screen.findByText('Will connect to input "Exec"')).toBeInTheDocument();
    expect(screen.getAllByText("Connects to Exec").length).toBeGreaterThan(0);
    expect(screen.getByText("Auto-connects to Exec (exec)")).toBeInTheDocument();
    const candidate = container.querySelector(".node-panel .templates button");
    expect(candidate).toBeTruthy();
    fireEvent.click(candidate as Element);

    const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
    expect(graphChanged?.type).toBe("graphChanged");
    expect(graphChanged?.graph.nodes.filter((node) => node.templateId === "builtin.debug.log")).toHaveLength(2);
    expect(
      graphChanged?.graph.links.some((link) => link.fromNodeId === "entry" && link.fromPortId === "then" && link.flowKind === "control")
    ).toBe(true);
  });

  it("connects two existing compatible ports directly", async () => {
    const { container } = renderAppWithGraph(disconnectedGraph());
    await screen.findAllByText("Function Entry");

    const entryThenPort = container.querySelector('button[title^="Then: exec"]');
    const logExecPort = container.querySelector('button[title^="Exec: exec"]');
    const logMessagePort = container.querySelector('button[title^="Message: string"]');
    expect(entryThenPort).toBeTruthy();
    expect(logExecPort).toBeTruthy();
    expect(logMessagePort).toBeTruthy();

    fireEvent.pointerDown(entryThenPort as Element, { clientX: 348, clientY: 176, button: 0 });
    await waitFor(() => {
      expect(logExecPort?.classList.contains("compatible")).toBe(true);
      expect(logMessagePort?.classList.contains("incompatible")).toBe(true);
      expect(entryThenPort?.classList.contains("compatible")).toBe(false);
    });
    fireEvent.pointerUp(logExecPort as Element, { clientX: 420, clientY: 176, button: 0 });

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      expect(
        graphChanged?.graph.links.some((link) => link.fromNodeId === "entry" && link.toNodeId === "log1" && link.flowKind === "control")
      ).toBe(true);
    });
  });

  it("unlinks an input from the inspector", async () => {
    renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");
    fireEvent.click(screen.getByText("log1"));

    fireEvent.click(await screen.findByTitle("Disconnect Exec"));

    const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
    expect(graphChanged?.type).toBe("graphChanged");
    expect(graphChanged?.graph.links).toHaveLength(0);
  });

  it("breaks links from a port with Alt click", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const logExecPort = container.querySelector('button[title^="Exec: exec"]');
    expect(logExecPort).toBeTruthy();
    firePointer(logExecPort as Element, "pointerdown", { clientX: 420, clientY: 176, button: 0, altKey: true });

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      expect(graphChanged?.graph.links).toHaveLength(0);
      expect(graphChanged?.graph.nodes).toHaveLength(2);
    });
  });

  it("moves an existing data link from a connected input with Ctrl drag", async () => {
    const { container } = renderAppWithGraph(graphWithSecondLogTarget());
    await screen.findAllByText("Function Entry");

    const messagePorts = container.querySelectorAll('button[title^="Message: string"]');
    expect(messagePorts).toHaveLength(3);

    firePointer(messagePorts[1], "pointerdown", { clientX: 420, clientY: 184, button: 0, ctrlKey: true });
    await waitFor(() => {
      expect(messagePorts[2].classList.contains("compatible")).toBe(true);
    });
    firePointer(messagePorts[2], "pointerup", { clientX: 760, clientY: 184, button: 0 });

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      const nextGraph = graphChanged?.graph;
      const dataLinks = nextGraph?.links.filter((link) => link.fromNodeId === "entry" && link.fromPortId === "message" && link.flowKind === "data") ?? [];
      expect(dataLinks).toHaveLength(1);
      expect(dataLinks[0].id).toBe("link-entry-message-log");
      expect(dataLinks[0].toNodeId).toBe("log2");
      expect(dataLinks[0].toPortId).toBe("message");
      expect(nextGraph?.nodes.find((node) => node.id === "log1")?.inputBindings.message).toBeUndefined();
      expect(nextGraph?.nodes.find((node) => node.id === "log2")?.inputBindings.message).toEqual({
        portId: "message",
        sourceKind: "link",
        linkId: dataLinks[0].id
      });
    });
  });

  it("restores a Ctrl move-link drag when it is dropped on blank canvas", async () => {
    const { container } = renderAppWithGraph(graphWithSecondLogTarget());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas");
    const messagePorts = container.querySelectorAll('button[title^="Message: string"]');
    expect(canvas).toBeTruthy();
    expect(messagePorts).toHaveLength(3);

    firePointer(messagePorts[1], "pointerdown", { clientX: 420, clientY: 184, button: 0, ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector('path[data-link-id="link-entry-message-log"]')).toBeNull();
    });

    firePointer(canvas as Element, "pointerup", { clientX: 640, clientY: 320, button: 0 });

    await waitFor(() => {
      expect(container.querySelector('path[data-link-id="link-entry-message-log"]')).toBeTruthy();
    });
    expect(postedMessages.filter((message) => message.type === "graphChanged")).toHaveLength(0);
  });

  it("breaks links from a port context menu", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const entryThenPort = container.querySelector('button[title^="Then: exec"]');
    expect(entryThenPort).toBeTruthy();
    fireEvent.contextMenu(entryThenPort as Element, { clientX: 340, clientY: 176 });

    fireEvent.click(await screen.findByTitle("Break links for this port"));

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      expect(graphChanged?.graph.links).toHaveLength(0);
      expect(graphChanged?.graph.nodes).toHaveLength(2);
    });
  });

  it("selects and deletes a wire directly on the canvas", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const wire = container.querySelector('path[data-link-id="link-entry-log"]');
    expect(wire).toBeTruthy();
    fireEvent.pointerDown(wire as Element, { button: 0 });
    await waitFor(() => expect(container.querySelector('path[data-link-id="link-entry-log"]')?.classList.contains("selected")).toBe(true));

    fireEvent.keyDown(window, { key: "Delete" });

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      expect(graphChanged?.graph.links).toHaveLength(0);
    });
  });

  it("deletes a wire from the wire context menu", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const wire = container.querySelector('path[data-link-id="link-entry-log"]');
    expect(wire).toBeTruthy();
    fireEvent.contextMenu(wire as Element, { clientX: 320, clientY: 220 });

    expect(await screen.findByText("control wire link-entry-log")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Delete this wire"));

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      expect(graphChanged?.graph.links).toHaveLength(0);
      expect(screen.queryByText("control wire link-entry-log")).not.toBeInTheDocument();
    });
  });

  it("deletes selected nodes and supports copy, paste, and undo", async () => {
    const { container } = renderAppWithGraph({
      ...sampleGraph(),
      bookmarks: [
        { id: "bookmark-log", label: "Log bookmark", position: { x: 480, y: 170 }, nodeId: "log1" },
        { id: "bookmark-view", label: "Viewport bookmark", position: { x: 120, y: 120 } }
      ]
    });
    await screen.findAllByText("Function Entry");
    const logNode = container.querySelector('[data-node-id="log1"]');
    expect(logNode).toBeTruthy();
    fireEvent.pointerDown(logNode as Element, { button: 0 });

    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });

    await waitFor(() => {
      const pasted = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(pasted?.type).toBe("graphChanged");
      expect(pasted?.graph.nodes.filter((node) => node.templateId === "builtin.debug.log")).toHaveLength(2);
    });

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => {
      const undone = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(undone?.graph.nodes.filter((node) => node.templateId === "builtin.debug.log")).toHaveLength(1);
    });

    fireEvent.pointerDown(logNode as Element, { button: 0 });
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => {
      const deleted = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(deleted?.graph.nodes.some((node) => node.id === "log1")).toBe(false);
      expect(deleted?.graph.links.some((link) => link.toNodeId === "log1" || link.fromNodeId === "log1")).toBe(false);
      expect(deleted?.graph.bookmarks).toEqual([{ id: "bookmark-view", label: "Viewport bookmark", position: { x: 120, y: 120 } }]);
    });
  });

  it("copies and pastes comment boxes that fully wrap the selected nodes", async () => {
    renderAppWithGraph(graphWithStartupComment());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getByTitle("Focus outline node entry"));
    fireEvent.click(screen.getByTitle("Focus outline node log1"), { ctrlKey: true });

    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });

    await waitFor(() => {
      const pasted = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(pasted?.type).toBe("graphChanged");
      expect(pasted?.graph.comments).toHaveLength(2);
      const copiedComment = pasted?.graph.comments?.find((comment) => comment.id !== "comment-startup");
      expect(copiedComment?.position).toEqual({ x: 60, y: 110 });
      expect(copiedComment?.nodeIds).toHaveLength(2);
      expect(copiedComment?.nodeIds.every((nodeId) => nodeId.includes("-copy-"))).toBe(true);
    });
  });

  it("toggles breakpoints and creates bookmarks from the node context menu", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const logNode = container.querySelector('[data-node-id="log1"]');
    expect(logNode).toBeTruthy();
    fireEvent.contextMenu(logNode as Element, { clientX: 450, clientY: 150 });
    expect(await screen.findByTitle("Toggle breakpoint on this node")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Toggle breakpoint on this node"));
    expect((hostState as { breakpoints?: unknown[] }).breakpoints).toEqual([{ nodeId: "log1" }]);
    expect(await screen.findByTitle("Breakpoint")).toBeInTheDocument();

    fireEvent.contextMenu(logNode as Element, { clientX: 450, clientY: 150 });
    fireEvent.click(await screen.findByTitle("Add bookmark for this node"));
    await waitFor(() => {
      const bookmarked = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(bookmarked?.type).toBe("graphChanged");
      expect(bookmarked?.graph.bookmarks?.[0].nodeId).toBe("log1");
      expect(bookmarked?.graph.bookmarks?.[0].label).toBe("Log");
    });
  });

  it("duplicates and deletes nodes from the node context menu", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const logNode = container.querySelector('[data-node-id="log1"]');
    expect(logNode).toBeTruthy();
    fireEvent.contextMenu(logNode as Element, { clientX: 450, clientY: 150 });
    fireEvent.click(await screen.findByTitle("Duplicate node selection"));

    await waitFor(() => {
      const duplicated = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(duplicated?.type).toBe("graphChanged");
      expect(duplicated?.graph.nodes.filter((node) => node.templateId === "builtin.debug.log")).toHaveLength(2);
    });

    fireEvent.contextMenu(logNode as Element, { clientX: 450, clientY: 150 });
    fireEvent.click(await screen.findByTitle("Delete node selection"));

    await waitFor(() => {
      const deleted = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(deleted?.graph.nodes.some((node) => node.id === "log1")).toBe(false);
      expect(deleted?.graph.links.some((link) => link.fromNodeId === "log1" || link.toNodeId === "log1")).toBe(false);
    });
  });

  it("breaks node links from the node context menu", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const logNode = container.querySelector('[data-node-id="log1"]');
    expect(logNode).toBeTruthy();
    fireEvent.contextMenu(logNode as Element, { clientX: 450, clientY: 150 });
    fireEvent.click(await screen.findByTitle("Break links for node selection"));

    await waitFor(() => {
      const changed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(changed?.type).toBe("graphChanged");
      expect(changed?.graph.links).toEqual([]);
    });
  });

  it("breaks selected node links from the toolbar and clears data bindings", async () => {
    renderAppWithGraph(overlappedGraphWithLongLink());
    await screen.findAllByText("Function Entry");
    fireEvent.click(screen.getByText("log1"));

    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    const breakLinks = await screen.findByTitle("Break Links For Selected Nodes");
    await waitFor(() => expect(breakLinks).not.toBeDisabled());
    fireEvent.click(breakLinks);

    await waitFor(() => {
      const changed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(changed?.type).toBe("graphChanged");
      expect(changed?.graph.links.map((link) => link.id)).toEqual(["link-entry-branch"]);
      const log = changed?.graph.nodes.find((node) => node.id === "log1");
      expect(log?.inputBindings.message).toBeUndefined();
    });
  });

  it("supports marquee selection, duplicate shortcut, and frame selected", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({})
    } as DOMRect);

    firePointer(canvas, "pointerdown", { clientX: 40, clientY: 80, button: 0 });
    firePointer(canvas, "pointermove", { clientX: 760, clientY: 280, button: 0 });
    await waitFor(() => expect(container.querySelector(".marquee")).toBeTruthy());
    firePointer(canvas, "pointerup", { clientX: 760, clientY: 280, button: 0 });

    await waitFor(() => expect(container.querySelectorAll(".node.selected")).toHaveLength(2));

    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    await waitFor(() => {
      const duplicated = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(duplicated?.type).toBe("graphChanged");
      expect(duplicated?.graph.nodes).toHaveLength(4);
      expect(duplicated?.graph.links).toHaveLength(2);
    });

    fireEvent.keyDown(window, { key: "f" });
    await waitFor(() => {
      const framed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(framed?.type).toBe("graphChanged");
      expect(framed?.graph.layout.viewport.zoom).toBeGreaterThan(1);
      expect(framed?.graph.layout.viewport.x).not.toBe(0);
    });
  });

  it("inserts a manual routing hub for a selected data wire", async () => {
    const { container } = renderAppWithGraph(overlappedGraphWithLongLink());
    await screen.findAllByText("Function Entry");

    const wire = container.querySelector('path[data-link-id="link-entry-message-log"]');
    expect(wire).toBeTruthy();
    fireEvent.pointerDown(wire as Element, { button: 0 });
    await clickToolbarOverflowAction(/insert routing hub for selected wire/i);

    await waitFor(() => {
      const routed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(routed?.type).toBe("graphChanged");
      const nextGraph = routed?.graph;
      const hub = nextGraph?.nodes.find((node) => node.displayOverrides?.manualRoutingHub === true);
      expect(hub?.templateId).toBe("builtin.routing.dataHub");
      expect(nextGraph?.links.some((link) => link.id === "link-entry-message-log")).toBe(false);
      const firstSegment = nextGraph?.links.find((link) => link.fromNodeId === "entry" && link.toNodeId === hub?.id && link.flowKind === "data");
      const secondSegment = nextGraph?.links.find((link) => link.fromNodeId === hub?.id && link.toNodeId === "log1" && link.flowKind === "data");
      expect(firstSegment).toBeTruthy();
      expect(secondSegment).toBeTruthy();
      expect(hub?.inputBindings.value.linkId).toBe(firstSegment?.id);
      const log = nextGraph?.nodes.find((node) => node.id === "log1");
      expect(log?.inputBindings.message.linkId).toBe(secondSegment?.id);
    });
  });

  it("inserts a manual routing hub from the wire context menu", async () => {
    const { container } = renderAppWithGraph(overlappedGraphWithLongLink());
    await screen.findAllByText("Function Entry");

    const wire = container.querySelector('path[data-link-id="link-entry-message-log"]');
    expect(wire).toBeTruthy();
    fireEvent.contextMenu(wire as Element, { clientX: 420, clientY: 240 });
    expect(await screen.findByText("data wire link-entry-message-log")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Insert routing hub into this wire"));

    await waitFor(() => {
      const routed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(routed?.type).toBe("graphChanged");
      const nextGraph = routed?.graph;
      const hub = nextGraph?.nodes.find((node) => node.displayOverrides?.manualRoutingHub === true);
      expect(hub?.templateId).toBe("builtin.routing.dataHub");
      expect(nextGraph?.links.some((link) => link.id === "link-entry-message-log")).toBe(false);
      expect(nextGraph?.links.some((link) => link.fromNodeId === "entry" && link.toNodeId === hub?.id && link.flowKind === "data")).toBe(true);
      expect(nextGraph?.links.some((link) => link.fromNodeId === hub?.id && link.toNodeId === "log1" && link.flowKind === "data")).toBe(true);
    });
  });

  it("inserts a routing hub by double-clicking a wire", async () => {
    const { container } = renderAppWithGraph(overlappedGraphWithLongLink());
    await screen.findAllByText("Function Entry");

    const wire = container.querySelector('path[data-link-id="link-entry-message-log"]');
    expect(wire).toBeTruthy();
    fireEvent.doubleClick(wire as Element);

    await waitFor(() => {
      const routed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(routed?.type).toBe("graphChanged");
      const nextGraph = routed?.graph;
      const hub = nextGraph?.nodes.find((node) => node.displayOverrides?.manualRoutingHub === true);
      expect(hub?.templateId).toBe("builtin.routing.dataHub");
      expect(nextGraph?.links.some((link) => link.id === "link-entry-message-log")).toBe(false);
      expect(nextGraph?.links.some((link) => link.fromNodeId === "entry" && link.toNodeId === hub?.id && link.flowKind === "data")).toBe(true);
      expect(nextGraph?.links.some((link) => link.fromNodeId === hub?.id && link.toNodeId === "log1" && link.flowKind === "data")).toBe(true);
    });
  });

  it("inserts routing hubs for multiple selected wires", async () => {
    const { container } = renderAppWithGraph(overlappedGraphWithLongLink());
    await screen.findAllByText("Function Entry");

    const controlWire = container.querySelector('path[data-link-id="link-entry-branch"]');
    const dataWire = container.querySelector('path[data-link-id="link-entry-message-log"]');
    expect(controlWire).toBeTruthy();
    expect(dataWire).toBeTruthy();
    firePointer(controlWire as Element, "pointerdown", { clientX: 320, clientY: 160, button: 0 });
    await waitFor(() => expect(controlWire?.classList.contains("selected")).toBe(true));
    firePointer(dataWire as Element, "pointerdown", { clientX: 360, clientY: 220, button: 0, ctrlKey: true });
    await waitFor(() => expect(container.querySelectorAll("path.wire.selected")).toHaveLength(2));
    await clickToolbarOverflowAction(/insert routing hub for selected wire/i);

    await waitFor(() => {
      const routed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(routed?.type).toBe("graphChanged");
      const nextGraph = routed?.graph;
      expect(nextGraph?.nodes.filter((node) => node.displayOverrides?.manualRoutingHub === true)).toHaveLength(2);
      expect(nextGraph?.nodes.some((node) => node.templateId === "builtin.routing.controlHub" && node.displayOverrides?.manualRoutingHub === true)).toBe(true);
      expect(nextGraph?.nodes.some((node) => node.templateId === "builtin.routing.dataHub" && node.displayOverrides?.manualRoutingHub === true)).toBe(true);
      expect(nextGraph?.links.some((link) => link.id === "link-entry-branch")).toBe(false);
      expect(nextGraph?.links.some((link) => link.id === "link-entry-message-log")).toBe(false);
      expect(nextGraph?.links).toHaveLength(5);
      const log = nextGraph?.nodes.find((node) => node.id === "log1");
      const logDataLink = nextGraph?.links.find((link) => link.toNodeId === "log1" && link.toPortId === "message");
      expect(log?.inputBindings.message.linkId).toBe(logDataLink?.id);
    });
  });

  it("cleans up a selected routing hub back into a direct wire", async () => {
    const { container } = renderAppWithGraph(overlappedGraphWithLongLink());
    await screen.findAllByText("Function Entry");

    const wire = container.querySelector('path[data-link-id="link-entry-message-log"]');
    expect(wire).toBeTruthy();
    fireEvent.pointerDown(wire as Element, { button: 0 });
    await clickToolbarOverflowAction(/insert routing hub for selected wire/i);

    await waitFor(() => {
      expect(postedMessages.filter((message) => message.type === "graphChanged").at(-1)?.graph.nodes.some((node) => node.displayOverrides?.manualRoutingHub === true)).toBe(true);
    });
    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    const cleanupRoutingHubs = await screen.findByTitle(/clean up selected routing hubs/i);
    await waitFor(() => expect(cleanupRoutingHubs).not.toBeDisabled());
    fireEvent.click(cleanupRoutingHubs);

    await waitFor(() => {
      const cleaned = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(cleaned?.type).toBe("graphChanged");
      const nextGraph = cleaned?.graph;
      expect(nextGraph?.nodes.some((node) => node.displayOverrides?.manualRoutingHub === true)).toBe(false);
      const dataLink = nextGraph?.links.find((link) => link.fromNodeId === "entry" && link.fromPortId === "message" && link.toNodeId === "log1" && link.toPortId === "message");
      expect(dataLink?.flowKind).toBe("data");
      expect(nextGraph?.links).toHaveLength(3);
      expect(nextGraph?.nodes.find((node) => node.id === "log1")?.inputBindings.message.linkId).toBe(dataLink?.id);
    });
  });

  it("aligns and distributes the selected nodes", async () => {
    const { container } = renderAppWithGraph(alignmentGraph());
    await screen.findAllByText("Function Entry");

    const miniItems = container.querySelectorAll(".outline-item");
    expect(miniItems).toHaveLength(3);
    fireEvent.click(miniItems[1], { shiftKey: true });
    fireEvent.click(miniItems[2], { shiftKey: true });

    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    fireEvent.click(within(await screen.findByRole("menu")).getByTitle(/align top/i));
    await waitFor(() => {
      const aligned = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(aligned?.type).toBe("graphChanged");
      expect(new Set(aligned?.graph.nodes.map((node) => node.position.y)).size).toBe(1);
    });

    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    fireEvent.click(within(await screen.findByRole("menu")).getByTitle("Distribute Horizontally"));
    await waitFor(() => {
      const distributed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(distributed?.type).toBe("graphChanged");
      const centers = distributed?.graph.nodes
        .map((node) => node.position.x + 134)
        .sort((a, b) => a - b);
      expect(centers).toHaveLength(3);
      expect((centers?.[1] ?? 0) - (centers?.[0] ?? 0)).toBeCloseTo((centers?.[2] ?? 0) - (centers?.[1] ?? 0), 5);
    });
  });

  it("creates, edits, drags, and deletes a comment box without deleting grouped nodes", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const miniItems = container.querySelectorAll(".outline-item");
    fireEvent.click(miniItems[1], { shiftKey: true });
    await clickToolbarOverflowAction("Create Comment Box");

    await waitFor(() => {
      const created = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(created?.type).toBe("graphChanged");
      expect(created?.graph.comments).toHaveLength(1);
      expect(created?.graph.comments?.[0].nodeIds).toEqual(["entry", "log1"]);
    });

    fireEvent.change(screen.getByDisplayValue("Selection"), { target: { value: "Startup" } });
    await waitFor(() => {
      const renamed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(renamed?.graph.comments?.[0].title).toBe("Startup");
    });

    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "720" } });
    await waitFor(() => {
      const resizedFromInspector = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(resizedFromInspector?.graph.comments?.[0].size.width).toBe(720);
    });

    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "240" } });
    await waitFor(() => {
      const resizedFromInspector = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(resizedFromInspector?.graph.comments?.[0].size.height).toBe(240);
    });

    fireEvent.click(screen.getByTitle("Set selected comment color #48b9c7"));
    await waitFor(() => {
      const recolored = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(recolored?.graph.comments?.[0].color).toBe("#48b9c7");
    });

    const comment = container.querySelector(".comment-box");
    const canvas = container.querySelector(".canvas");
    const resizeHandle = container.querySelector(".comment-resize");
    expect(comment).toBeTruthy();
    expect(canvas).toBeTruthy();
    expect(resizeHandle).toBeTruthy();
    firePointer(resizeHandle as Element, "pointerdown", { clientX: 720, clientY: 240, button: 0 });
    firePointer(canvas as Element, "pointermove", { clientX: 780, clientY: 300, button: 0 });
    firePointer(canvas as Element, "pointerup", { clientX: 780, clientY: 300, button: 0 });

    await waitFor(() => {
      const resizedFromCanvas = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(resizedFromCanvas?.graph.comments?.[0].size).toEqual({ width: 780, height: 300 });
    });

    firePointer(comment as Element, "pointerdown", { clientX: 100, clientY: 100, button: 0 });
    firePointer(canvas as Element, "pointermove", { clientX: 160, clientY: 140, button: 0 });
    firePointer(canvas as Element, "pointerup", { clientX: 160, clientY: 140, button: 0 });

    await waitFor(() => {
      const dragged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(dragged?.graph.comments?.[0].position).toEqual({ x: 104, y: 102 });
      expect(dragged?.graph.nodes.find((node) => node.id === "entry")?.position).toEqual({ x: 140, y: 160 });
      expect(dragged?.graph.nodes.find((node) => node.id === "log1")?.position).toEqual({ x: 480, y: 160 });
    });

    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => {
      const deleted = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(deleted?.graph.comments).toHaveLength(0);
      expect(deleted?.graph.nodes).toHaveLength(2);
    });
  });

  it("re-wraps comments and creates comment bookmarks from the comment context menu", async () => {
    const { container } = renderAppWithGraph(graphWithStartupComment({ position: { x: 0, y: 0 }, size: { width: 120, height: 80 } }));
    await screen.findAllByText("Function Entry");

    const comment = container.querySelector('[data-comment-id="comment-startup"]');
    expect(comment).toBeTruthy();
    fireEvent.contextMenu(comment as Element, { clientX: 180, clientY: 110 });
    fireEvent.click(await screen.findByTitle("Re-wrap this comment around grouped nodes"));

    await waitFor(() => {
      const rewrapped = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(rewrapped?.type).toBe("graphChanged");
      expect(rewrapped?.graph.comments?.[0].position).toEqual({ x: 44, y: 62 });
      expect(rewrapped?.graph.comments?.[0].size).toEqual({ width: 680, height: 212 });
    });

    fireEvent.contextMenu(comment as Element, { clientX: 180, clientY: 110 });
    fireEvent.click(await screen.findByTitle("Add bookmark for this comment"));

    await waitFor(() => {
      const bookmarked = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(bookmarked?.type).toBe("graphChanged");
      expect(bookmarked?.graph.bookmarks?.[0].label).toBe("Startup");
      expect(bookmarked?.graph.bookmarks?.[0].nodeId).toBeUndefined();
      expect(bookmarked?.graph.bookmarks?.[0].position).toEqual({ x: 384, y: 168 });
    });
  });

  it("deletes comments from the comment context menu without deleting grouped nodes", async () => {
    const { container } = renderAppWithGraph(graphWithStartupComment());
    await screen.findAllByText("Function Entry");

    const comment = container.querySelector('[data-comment-id="comment-startup"]');
    expect(comment).toBeTruthy();
    fireEvent.contextMenu(comment as Element, { clientX: 180, clientY: 110 });
    fireEvent.click(await screen.findByTitle("Delete this comment"));

    await waitFor(() => {
      const deleted = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(deleted?.type).toBe("graphChanged");
      expect(deleted?.graph.comments).toEqual([]);
      expect(deleted?.graph.nodes).toHaveLength(2);
    });
  });

  it("creates, focuses, and deletes graph bookmarks", async () => {
    const { container } = renderAppWithGraph(sampleGraph());
    await screen.findAllByText("Function Entry");

    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({})
    } as DOMRect);

    await clickToolbarOverflowAction("Add Bookmark");

    await waitFor(() => {
      const created = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(created?.type).toBe("graphChanged");
      expect(created?.graph.bookmarks).toHaveLength(1);
      expect(created?.graph.bookmarks?.[0].label).toBe("Function Entry");
      expect(created?.graph.bookmarks?.[0].nodeId).toBe("entry");
    });

    expect(await screen.findByText("Bookmarks")).toBeInTheDocument();
    const labelInput = screen.getByLabelText("Bookmark label Function Entry");
    fireEvent.change(labelInput, { target: { value: "Startup view" } });
    fireEvent.blur(labelInput);

    await waitFor(() => {
      const renamed = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(renamed?.type).toBe("graphChanged");
      expect(renamed?.graph.bookmarks?.[0].label).toBe("Startup view");
    });

    fireEvent.click(await screen.findByTitle("Focus bookmark Startup view"));

    await waitFor(() => {
      const focused = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(focused?.type).toBe("graphChanged");
      expect(focused?.graph.layout.viewport.x).not.toBe(0);
    });

    fireEvent.click(screen.getByTitle("Delete bookmark Startup view"));

    await waitFor(() => {
      const deleted = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(deleted?.type).toBe("graphChanged");
      expect(deleted?.graph.bookmarks).toEqual([]);
    });
  });

  it("delegates undo and redo when native editor history is available", async () => {
    renderAppWithGraph(sampleGraph());
    window.dispatchEvent(new MessageEvent("message", { data: { type: "editorCapabilities", nativeUndoRedo: true } }));
    await screen.findAllByText("Function Entry");

    postedMessages.length = 0;
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });

    expect(postedMessages.map((message) => message.type)).toEqual(["requestUndo", "requestRedo", "requestRedo"]);
  });

  it("auto-layout separates nodes left-to-right and inserts routing hubs for long links", async () => {
    renderAppWithGraph(overlappedGraphWithLongLink());
    await screen.findAllByText("Function Entry");

    fireEvent.click(screen.getByTitle("Toolbar overflow"));
    fireEvent.click(await screen.findByTitle("Auto Layout"));

    await waitFor(() => {
      const graphChanged = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(graphChanged?.type).toBe("graphChanged");
      const nextGraph = graphChanged?.graph;
      expect(nextGraph?.nodes.some((node) => node.templateId === "builtin.routing.dataHub" && node.displayOverrides?.autoLayoutHub === true)).toBe(true);

      const entry = nextGraph?.nodes.find((node) => node.id === "entry");
      const branch = nextGraph?.nodes.find((node) => node.id === "branch");
      const log = nextGraph?.nodes.find((node) => node.id === "log1");
      expect(entry && branch && log).toBeTruthy();
      expect(branch?.position.x).toBeGreaterThan(entry?.position.x ?? 0);
      expect(log?.position.x).toBeGreaterThan(branch?.position.x ?? 0);
      expect(overlaps(entry, branch)).toBe(false);
      expect(overlaps(branch, log)).toBe(false);
      expect(overlaps(entry, log)).toBe(false);
      expect(nextGraph?.links.some((link) => link.fromNodeId === "entry" && link.toNodeId.startsWith("auto-hub-") && link.flowKind === "data")).toBe(true);
      expect(log?.inputBindings.message.linkId).toMatch(/-r\d+$/);
    });
  });

  it("renders a large graph within the performance budget", async () => {
    const startedAt = performance.now();
    const { container } = renderAppWithGraph(largeRenderGraph(200));
    await screen.findAllByText("Function Entry");
    const elapsed = performance.now() - startedAt;

    expect(container.querySelectorAll(".node")).toHaveLength(202);
    expect(container.querySelectorAll("path.wire")).toHaveLength(201);
    expect(elapsed).toBeLessThan(3000);
  });

  it("culls offscreen node DOM for very large graphs while preserving navigation surfaces", async () => {
    const { container } = renderAppWithGraph(largeRenderGraph(500));
    await screen.findAllByText("Function Entry");

    expect(container.querySelectorAll(".node").length).toBeLessThan(40);
    expect(container.querySelectorAll("path.wire").length).toBeLessThan(80);
    expect(container.querySelectorAll(".minimap-node")).toHaveLength(502);
    expect(screen.getByText("Showing 160 of 502 nodes. Filter outline to narrow results.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Filter outline"), { target: { value: "log-499" } });
    fireEvent.click(screen.getByTitle("Focus outline node log-499"));

    await waitFor(() => {
      expect(container.querySelector('[data-node-id="log-499"]')?.classList.contains("selected")).toBe(true);
      expect(container.querySelector('path[data-link-id="link-498"]')).toBeTruthy();
      expect(container.querySelector('path[data-link-id="link-499"]')).toBeTruthy();
      const focused = postedMessages.filter((message) => message.type === "graphChanged").at(-1);
      expect(focused?.type).toBe("graphChanged");
      expect(focused?.graph.layout.viewport.x).toBeLessThan(-50000);
    });
  });
});

function renderAppWithGraph(graph: BlueprintGraph, options: { defaultLanguage?: false | "en-US" } = {}) {
  if (options.defaultLanguage !== false) {
    hostState = withEditorLanguage(hostState, options.defaultLanguage ?? "en-US");
  }
  const result = render(<App />);
  window.dispatchEvent(new MessageEvent("message", { data: { type: "loadTemplates", templates: getBuiltinTemplates() } }));
  window.dispatchEvent(new MessageEvent("message", { data: { type: "loadGraph", graph } }));
  return result;
}

function withEditorLanguage(state: unknown, language: "en-US") {
  const root = state && typeof state === "object" && !Array.isArray(state) ? state as Record<string, unknown> : {};
  const editorPrefs = root.editorPrefs && typeof root.editorPrefs === "object" && !Array.isArray(root.editorPrefs)
    ? root.editorPrefs as Record<string, unknown>
    : {};
  return {
    ...root,
    editorPrefs: {
      ...editorPrefs,
      language: typeof editorPrefs.language === "string" ? editorPrefs.language : language
    }
  };
}

function typeScriptTemplate(): BlueprintNodeTemplate {
  return {
    id: "ts.TypeScript.Math.Double",
    name: "Double",
    creationPath: "TypeScript/Math",
    description: "Multiplies a number by two.",
    inputs: [{
      id: "value",
      name: "value",
      direction: "input",
      flowKind: "data",
      type: "number",
      description: "Parameter value.",
      editor: "number",
      defaultValue: 0
    }],
    outputs: [{
      id: "result",
      name: "Result",
      direction: "output",
      flowKind: "data",
      type: "number",
      description: "Function result.",
      editor: "none"
    }],
    controlInputs: [],
    controlOutputs: [],
    bodyKind: "typescriptFunction",
    bodyRef: "examples/Gameplay/src/mathNodes.ts#GameplayMathNodes.double",
    metadata: {
      source: "examples/Gameplay/src/mathNodes.ts",
      exportName: "GameplayMathNodes",
      memberName: "double"
    }
  };
}

function typeScriptRoundTemplate(): BlueprintNodeTemplate {
  const template = typeScriptTemplate();
  return {
    ...template,
    id: "ts.TypeScript.Math.Round",
    name: "Round",
    description: "Rounds a number.",
    bodyRef: "examples/Gameplay/src/mathNodes.ts#GameplayMathNodes.round",
    metadata: {
      source: "examples/Gameplay/src/mathNodes.ts",
      exportName: "GameplayMathNodes",
      memberName: "round"
    }
  };
}

function blueprintGraphTemplate(): BlueprintNodeTemplate {
  return {
    id: "graph.format-score",
    name: "Format Score",
    creationPath: "Blueprints/Gameplay",
    description: "Formats the current score.",
    inputs: [],
    outputs: [],
    controlInputs: [],
    controlOutputs: [],
    bodyKind: "blueprintGraph",
    bodyRef: "examples/Gameplay/graphs/format-score.bpgraph",
    metadata: {
      source: "examples/Gameplay/graphs/format-score.bpgraph"
    }
  };
}

function macroGraphTemplate(): BlueprintNodeTemplate {
  return {
    id: "macro.trace-macro",
    name: "Trace Macro",
    creationPath: "Macros/Debug",
    description: "Trace macro.",
    inputs: [],
    outputs: [],
    controlInputs: [],
    controlOutputs: [],
    bodyKind: "macroExpansion",
    bodyRef: "examples/Gameplay/graphs/trace-macro.bpgraph",
    metadata: {
      source: "examples/Gameplay/graphs/trace-macro.bpgraph"
    }
  };
}

function firePointer(
  element: Element,
  type: string,
  init: { clientX: number; clientY: number; button?: number; pointerId?: number; altKey?: boolean; ctrlKey?: boolean }
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
    pointerId: init.pointerId ?? 1,
    altKey: init.altKey ?? false,
    ctrlKey: init.ctrlKey ?? false
  });
  fireEvent(element, event);
}

function outlineGroupTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".outline-subgroup-title")].map((element) => element.firstChild?.textContent?.trim() ?? "");
}

function overlaps(
  a: BlueprintGraph["nodes"][number] | undefined,
  b: BlueprintGraph["nodes"][number] | undefined
): boolean {
  if (!a || !b) {
    return true;
  }
  const width = 268;
  const height = 102;
  return !(
    a.position.x + width <= b.position.x ||
    b.position.x + width <= a.position.x ||
    a.position.y + height <= b.position.y ||
    b.position.y + height <= a.position.y
  );
}

function sampleGraph(): BlueprintGraph {
  return {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: "test",
    name: "Test",
    description: "Test graph.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [],
      outputs: []
    },
    nodes: [
      {
        id: "entry",
        templateId: "builtin.control.entry",
        position: { x: 80, y: 120 },
        inputBindings: {}
      },
      {
        id: "log1",
        templateId: "builtin.debug.log",
        position: { x: 420, y: 120 },
        inputBindings: {
          message: {
            portId: "message",
            sourceKind: "literal",
            literalValue: "Hello Blueprint"
          }
        }
      }
    ],
    links: [
      {
        id: "link-entry-log",
        fromNodeId: "entry",
        fromPortId: "then",
        toNodeId: "log1",
        toPortId: "exec",
        flowKind: "control"
      }
    ],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}

function collapsibleLogGraph(): BlueprintGraph {
  const graph = sampleGraph();
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "end",
        templateId: "builtin.control.end",
        position: { x: 760, y: 120 },
        inputBindings: {}
      }
    ],
    links: [
      ...graph.links,
      {
        id: "link-log-end",
        fromNodeId: "log1",
        fromPortId: "then",
        toNodeId: "end",
        toPortId: "exec",
        flowKind: "control"
      }
    ]
  };
}

function graphWithTypeScriptNode(): BlueprintGraph {
  const graph = sampleGraph();
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "double1",
        templateId: "ts.TypeScript.Math.Double",
        position: { x: 680, y: 120 },
        inputBindings: {
          value: {
            portId: "value",
            sourceKind: "literal",
            literalValue: 2
          }
        }
      }
    ]
  };
}

function graphWithBlackboardReferences(): BlueprintGraph {
  const graph = sampleGraph();
  return {
    ...graph,
    id: "blackboard",
    nodes: [
      ...graph.nodes,
      {
        id: "set-score",
        templateId: "builtin.blackboard.set",
        position: { x: 680, y: 80 },
        inputBindings: {
          key: {
            portId: "key",
            sourceKind: "literal",
            literalValue: "score"
          },
          value: {
            portId: "value",
            sourceKind: "literal",
            literalValue: 42
          }
        }
      },
      {
        id: "get-score",
        templateId: "builtin.blackboard.get",
        position: { x: 680, y: 240 },
        inputBindings: {
          key: {
            portId: "key",
            sourceKind: "literal",
            literalValue: "score"
          }
        }
      }
    ]
  };
}

function disconnectedGraph(): BlueprintGraph {
  const graph = sampleGraph();
  return {
    ...graph,
    links: []
  };
}

function graphWithSecondLogTarget(): BlueprintGraph {
  const graph = overlappedGraphWithLongLink();
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "log2",
        templateId: "builtin.debug.log",
        position: { x: 760, y: 80 },
        inputBindings: {
          message: {
            portId: "message",
            sourceKind: "literal",
            literalValue: "Next target"
          }
        }
      }
    ]
  };
}

function graphWithMathNode(): BlueprintGraph {
  const graph = sampleGraph();
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "add",
        templateId: "builtin.math.add",
        position: { x: 760, y: 120 },
        inputBindings: {
          a: { portId: "a", sourceKind: "literal", literalValue: 1 },
          b: { portId: "b", sourceKind: "literal", literalValue: 2 }
        }
      }
    ]
  };
}

function graphWithStartupComment(overrides: Partial<NonNullable<BlueprintGraph["comments"]>[number]> = {}): BlueprintGraph {
  return {
    ...sampleGraph(),
    comments: [
      {
        id: "comment-startup",
        title: "Startup",
        position: { x: 20, y: 70 },
        size: { width: 300, height: 160 },
        nodeIds: ["entry", "log1"],
        color: "#48b9c7",
        ...overrides
      }
    ]
  };
}

function overlappedGraphWithLongLink(): BlueprintGraph {
  return {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: "auto-layout-test",
    name: "Auto Layout Test",
    description: "Overlapped graph with a long data link.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [
        {
          id: "message",
          name: "Message",
          direction: "output",
          flowKind: "data",
          type: "string",
          description: "Message input.",
          editor: "none",
          defaultValue: "Hello"
        }
      ],
      outputs: []
    },
    nodes: [
      {
        id: "entry",
        templateId: "builtin.control.entry",
        position: { x: 80, y: 80 },
        inputBindings: {}
      },
      {
        id: "branch",
        templateId: "builtin.control.branch",
        position: { x: 80, y: 80 },
        inputBindings: {
          condition: {
            portId: "condition",
            sourceKind: "literal",
            literalValue: true
          }
        }
      },
      {
        id: "log1",
        templateId: "builtin.debug.log",
        position: { x: 80, y: 80 },
        inputBindings: {
          message: {
            portId: "message",
            sourceKind: "link",
            linkId: "link-entry-message-log"
          }
        }
      }
    ],
    links: [
      {
        id: "link-entry-branch",
        fromNodeId: "entry",
        fromPortId: "then",
        toNodeId: "branch",
        toPortId: "exec",
        flowKind: "control"
      },
      {
        id: "link-branch-log",
        fromNodeId: "branch",
        fromPortId: "true",
        toNodeId: "log1",
        toPortId: "exec",
        flowKind: "control"
      },
      {
        id: "link-entry-message-log",
        fromNodeId: "entry",
        fromPortId: "message",
        toNodeId: "log1",
        toPortId: "message",
        flowKind: "data",
        contextVariableId: "ctx-entry-message-log"
      }
    ],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}

function alignmentGraph(): BlueprintGraph {
  return {
    ...sampleGraph(),
    id: "alignment",
    name: "Alignment",
    nodes: [
      {
        id: "entry",
        templateId: "builtin.control.entry",
        position: { x: 80, y: 260 },
        inputBindings: {}
      },
      {
        id: "branch",
        templateId: "builtin.control.branch",
        position: { x: 560, y: 80 },
        inputBindings: {
          condition: {
            portId: "condition",
            sourceKind: "literal",
            literalValue: true
          }
        }
      },
      {
        id: "log1",
        templateId: "builtin.debug.log",
        position: { x: 300, y: 420 },
        inputBindings: {
          message: {
            portId: "message",
            sourceKind: "literal",
            literalValue: "Hello Blueprint"
          }
        }
      }
    ],
    links: []
  };
}

function largeRenderGraph(logCount: number): BlueprintGraph {
  const nodes: BlueprintGraph["nodes"] = [
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
      flowKind: "control" as const
    })),
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}
