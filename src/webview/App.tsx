import {
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  CircleDot,
  Command,
  Copy,
  Focus,
  GitBranch,
  Eye,
  EyeOff,
  Info,
  Lock,
  Map as MapIcon,
  MoreHorizontal,
  Package as PackageIcon,
  Pencil,
  Pin,
  Play,
  Plus,
  Power,
  RotateCcw,
  Route,
  RouteOff,
  Search,
  Settings,
  Square,
  Star,
  StepForward,
  StickyNote,
  TerminalSquare,
  Trash2,
  Unlink,
  Unlock,
  Workflow,
  XCircle,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { type CSSProperties, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  BlueprintBookmark,
  BlueprintBreakpoint,
  BlueprintCommentBox,
  BlueprintGraph,
  BlueprintLink,
  BlueprintNodeInstance,
  BlueprintNodeTemplate,
  BlueprintPortDefinition,
  BlueprintSolutionGraphSearchIndex,
  BlueprintSolutionOutline,
  HostToEditorMessage,
  FlowKind,
  Point,
  RuntimeQueueStatus,
  RuntimeTraceEvent,
  sanitizeIdentifier,
  TemplateBodyKind,
  TemplateRegistrySourceSummary,
  ValidationIssue
} from "../shared/blueprint";
import { createNodeFromTemplate, findPort, getEffectiveTemplateForNode } from "../shared/graph";
import { collapseSelectionToFunction, collapseSelectionToMacro } from "../shared/collapse";
import { builtinNodeI18nCatalog } from "../shared/nodeI18nCatalog";
import { localizePort, localizeTemplate, templateSearchText } from "../shared/templateI18n";
import { applyAutoLayout, HUB_HEIGHT, HUB_WIDTH, portLocalPoint, renderedNodeHeight, renderedNodeWidth, isRoutingHubTemplate } from "./autoLayout";
import { BlueprintSidebar } from "./BlueprintSidebar";
import {
  panViewport,
  safeCanvasSize,
  screenToGraphPoint,
  withCenteredViewport,
  withFittedViewport,
  zoomViewportAtCanvasCenter as calculateZoomViewportAtCanvasCenter,
  zoomViewportAtCanvasPoint
} from "./canvasController";
import { CommandPalette } from "./CommandPalette";
import { applyShortcutPrefs, commandShortcuts, EditorCommand, shortcutConflictTitles, shortcutLabel, shortcutMatchesEvent } from "./commands";
import {
  defaultGraphEditorPrefs,
  linkRenderModes,
  mainToolbarActionIds,
  mergeGraphEditorPrefsState,
  nodeLabelModes,
  readGraphEditorPrefs,
  readGraphEditorPrefsFromText,
  serializeGraphEditorPrefs,
  toolbarAlignments,
  type GraphEditorPrefs,
  type LinkRenderMode,
  type MainToolbarActionId,
  type NodeLabelMode,
  type ToolbarAlignment
} from "./editorPrefs";
import { createEditorHostClient } from "./editorHostClient";
import { fuzzySearchTokens, fuzzyTextMatches, fuzzyValuesMatchTokens, scoreFuzzySearchValues } from "./fuzzySearch";
import {
  alignGraphNodes,
  cleanupRoutingHubs,
  copyGraphSelection,
  createGraphBookmark,
  createGraphCommentBox,
  deleteGraphBookmark,
  deleteGraphNodes,
  deleteGraphSelection,
  distributeGraphNodes,
  duplicateGraphNodes,
  incidentLinkIds,
  insertRoutingHubsForLinks,
  linkIdsForPort,
  pasteGraphClipboard,
  renameGraphBookmark,
  replaceGraphComment,
  removeComments,
  removeLinks,
  updateGraphCommentColor,
  updateGraphCommentSize,
  updateGraphCommentTitle,
  type GraphAlignMode,
  type GraphClipboard,
  type GraphDistributeMode
} from "./graphEditActions";
import { GraphCanvas } from "./GraphCanvas";
import { getEditorHostApi } from "./hostApi";
import { InspectorPanel } from "./InspectorPanel";
import { createTranslator, fallbackLocale, supportedLocales, type Locale, type Translator } from "./i18n";
import { defaultCustomTheme, editorThemes, readCustomThemeFromText, serializeCustomTheme, themeClassName, themeStyle } from "./themes";
import { canvasInteractionReducer, idleInteractionState } from "./interactionState";
import { capturePointer, isolateOverlayContextMenu, isolateOverlayEvent, preventOverlayDefault } from "./overlayEvents";
import { RunActionBar, type RunActionBarRuntimeState } from "./RunActionBar";
import { RuntimePanel } from "./RuntimePanel";

interface DragPort {
  nodeId: string;
  portId: string;
  direction: "input" | "output";
  flowKind: FlowKind;
  type: string;
  movingLink?: BlueprintLink;
}

function localizedTemplateText(template: BlueprintNodeTemplate | undefined, locale: Locale) {
  return localizeTemplate(template, locale, fallbackLocale, builtinNodeI18nCatalog);
}

function localizedPortText(template: BlueprintNodeTemplate | undefined, port: BlueprintPortDefinition, locale: Locale) {
  return localizePort(template, port, locale, fallbackLocale, builtinNodeI18nCatalog);
}

function localizedTemplateSearchText(template: BlueprintNodeTemplate, locale: Locale): string {
  return templateSearchText(template, locale, fallbackLocale, builtinNodeI18nCatalog);
}

function displayTemplateText(template: BlueprintNodeTemplate | undefined, locale: Locale, mode: NodeLabelMode) {
  const localized = localizedTemplateText(template, locale);
  const source = {
    name: template?.name ?? localized.name,
    creationPath: template?.creationPath ?? localized.creationPath,
    description: template?.description ?? localized.description
  };
  return {
    name: displayText(localized.name, source.name, mode),
    creationPath: displayText(localized.creationPath, source.creationPath, mode),
    description: displayText(localized.description, source.description, mode)
  };
}

function displayPortText(template: BlueprintNodeTemplate | undefined, port: BlueprintPortDefinition, locale: Locale, mode: NodeLabelMode) {
  const localized = localizedPortText(template, port, locale);
  return {
    name: displayText(localized.name, port.name, mode),
    description: displayText(localized.description, port.description, mode)
  };
}

function displayText(localized: string, source: string, mode: NodeLabelMode): string {
  if (mode === "source") {
    return source;
  }
  if (mode === "both" && localized && source && localized !== source) {
    return `${localized} / ${source}`;
  }
  return localized || source;
}

interface NodePanelState {
  open: boolean;
  screen: Point;
  graph: Point;
  sourcePort?: DragPort;
}

interface NodePanelSize {
  width: number;
  height: number;
}

interface PanelSizes {
  left: number;
  right: number;
  bottom: number;
}

interface PanelResizeState {
  kind: "left" | "right" | "bottom";
  startX: number;
  startY: number;
  startSizes: PanelSizes;
  shellWidth: number;
  shellHeight: number;
}

interface GraphHistory {
  past: BlueprintGraph[];
  future: BlueprintGraph[];
}

interface RefactorResultMessage {
  ok: boolean;
  message: string;
}

interface NodePalettePrefs {
  recentTemplateIds: string[];
  favoriteTemplateIds: string[];
  disabledTemplatePackageIds: string[];
}

interface ToolbarOverflowAction {
  id: string;
  title: string;
  section: string;
  tier: "secondary" | "overflow";
  icon: ReactNode;
  run(): void;
  disabled?: boolean;
}

type CategoryAccentMap = Record<string, string>;
interface TemplateCategorySummary {
  id: string;
  name: string;
  count: number;
}

interface MarqueeSelection {
  start: Point;
  current: Point;
  additive: boolean;
}

interface DraggingComments {
  comments: Array<{ commentId: string; offset: Point }>;
  nodes: Array<{ nodeId: string; offset: Point }>;
}

interface ResizingComment {
  commentId: string;
  start: Point;
  size: {
    width: number;
    height: number;
  };
}

interface WireContextMenuState {
  linkId: string;
  screen: Point;
}

interface NodeContextMenuState {
  nodeId: string;
  nodeIds: string[];
  screen: Point;
}

interface CommentContextMenuState {
  commentId: string;
  screen: Point;
}

interface PortContextMenuState {
  nodeId: string;
  portId: string;
  screen: Point;
}

interface NodeFindResult {
  node: BlueprintNodeInstance;
  template?: BlueprintNodeTemplate;
  score: number;
  matchLabel?: string;
}

interface SolutionGraphFindResult {
  graphPath: string;
  graphName: string;
  graphKind: string;
  projectName: string;
  nodeId?: string;
  template?: BlueprintNodeTemplate;
  score: number;
  matchLabel?: string;
}

interface RuntimeHistoryEntry {
  id: string;
  graphId?: string;
  label?: string;
  pinned?: boolean;
  ok: boolean;
  message: string;
  text: string;
  durationMs: number;
  traces: RuntimeTraceEvent[];
  createdAt: number;
}

interface RuntimeRunComparison {
  previousDurationMs: number;
  durationDeltaMs: number;
  changed: number;
  added: number;
  missing: number;
  items: RuntimeRunComparisonItem[];
}

interface RuntimeRunComparisonItem {
  kind: "changed" | "new" | "missing";
  graphId: string;
  nodeId: string;
  label: string;
  currentStatus?: RuntimeTraceEvent["status"];
  previousStatus?: RuntimeTraceEvent["status"];
  currentContext?: Record<string, unknown>;
  previousContext?: Record<string, unknown>;
  contextChanged?: boolean;
  traceIndex?: number;
}

type RuntimeTraceStatusFilter = "all" | RuntimeTraceEvent["status"];
type RuntimeComparisonFilter = "all" | RuntimeRunComparisonItem["kind"];
type RuntimeComparisonSort = "kind" | "node" | "status";
type RuntimeTraceGroupBy = "none" | "node" | "status";
type RuntimeTraceLabeler = (trace: RuntimeTraceEvent) => string;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const emptyPanel: NodePanelState = {
  open: false,
  screen: { x: 0, y: 0 },
  graph: { x: 0, y: 0 }
};
const defaultNodePanelSize: NodePanelSize = { width: 680, height: 316 };

type AlignMode = GraphAlignMode;
type DistributeMode = GraphDistributeMode;
type PortCompatibility = "compatible" | "incompatible";

const controlHubTemplateId = "builtin.routing.controlHub";
const dataHubTemplateId = "builtin.routing.dataHub";
const maxRecentTemplates = 8;
const allTemplateCategoryId = "all";
const favoriteTemplateCategoryId = "favorites";
const recentTemplateCategoryId = "recent";
const maxRuntimeHistory = 5;
const graphLoadRetryDelayMs = 1200;
const runtimeTraceStatusFilters: RuntimeTraceEvent["status"][] = ["visited", "paused", "skipped", "breakpoint", "error", "active"];
const runtimeTraceGroupOptions: RuntimeTraceGroupBy[] = ["none", "node", "status"];
const runtimeComparisonFilters: RuntimeRunComparisonItem["kind"][] = ["changed", "new", "missing"];
const outlineNodeRenderLimit = 160;
const canvasNodeCullThreshold = 260;
const canvasNodeCullMargin = 420;
const snapGridWorldSize = 24;
const commentColorPalette = ["#d9a441", "#48b9c7", "#7ac46c", "#e05f50", "#b48cff", "#d98b45"];
const fallbackCommentColor = commentColorPalette[0];
const nodeAccentContrastBackground = "#1d1d1c";
const minimumNodeAccentContrast = 2.25;
const builtinCategoryAccents: CategoryAccentMap = {
  control: "var(--control)",
  routing: "var(--muted)",
  blackboard: "var(--green)",
  debug: "var(--amber)",
  math: "var(--cyan)",
  string: "var(--data)",
  json: "#b48cff",
  typescript: "#d98b45",
  blueprints: "var(--text)",
  macros: "var(--text)"
};

export interface AppProps {
  externalDockPanels?: boolean;
}

export function App(props: AppProps = {}): JSX.Element {
  const externalDockPanels = props.externalDockPanels === true;
  const hostApi = getEditorHostApi();
  const hostClient = useMemo(() => createEditorHostClient(hostApi), [hostApi]);
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeFindInputRef = useRef<HTMLInputElement>(null);
  const nodeFindDialogInputRef = useRef<HTMLInputElement>(null);
  const interactionStartGraph = useRef<BlueprintGraph | undefined>();
  const marqueeRef = useRef<MarqueeSelection | undefined>();
  const graphRef = useRef<BlueprintGraph | undefined>();
  const templatesRef = useRef<BlueprintNodeTemplate[]>([]);
  const editorCommandsRef = useRef<EditorCommand[]>([]);
  const initialEditorPrefs = useMemo(() => readGraphEditorPrefs(hostClient.getState()), [hostClient]);
  const [canvasInteraction, dispatchCanvasInteraction] = useReducer(canvasInteractionReducer, idleInteractionState);
  const [graph, setGraph] = useState<BlueprintGraph | undefined>();
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [templates, setTemplates] = useState<BlueprintNodeTemplate[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());
  const [selectedCommentIds, setSelectedCommentIds] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<GraphClipboard | undefined>();
  const [history, setHistory] = useState<GraphHistory>({ past: [], future: [] });
  const [nativeUndoRedo, setNativeUndoRedo] = useState(false);
  const [nodePanel, setNodePanel] = useState<NodePanelState>(emptyPanel);
  const [nodeFindQuery, setNodeFindQuery] = useState("");
  const [nodeFindDialogOpen, setNodeFindDialogOpen] = useState(false);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [search, setSearch] = useState("");
  const [activeTemplateCategory, setActiveTemplateCategory] = useState(allTemplateCategoryId);
  const [activeCandidateIndex, setActiveCandidateIndex] = useState(0);
  const [nodePanelSize, setNodePanelSize] = useState<NodePanelSize>(defaultNodePanelSize);
  const [palettePrefs, setPalettePrefs] = useState<NodePalettePrefs>(() => readPalettePrefs(hostClient.getState()));
  const [dragPort, setDragPort] = useState<DragPort | undefined>();
  const [pointerGraph, setPointerGraph] = useState<Point>({ x: 0, y: 0 });
  const [panning, setPanning] = useState<{ start: Point; viewport: Point } | undefined>();
  const [draggingNodes, setDraggingNodes] = useState<Array<{ nodeId: string; offset: Point }> | undefined>();
  const [draggingComments, setDraggingComments] = useState<DraggingComments | undefined>();
  const [resizingComment, setResizingComment] = useState<ResizingComment | undefined>();
  const [wireMenu, setWireMenu] = useState<WireContextMenuState | undefined>();
  const [nodeMenu, setNodeMenu] = useState<NodeContextMenuState | undefined>();
  const [commentMenu, setCommentMenu] = useState<CommentContextMenuState | undefined>();
  const [portMenu, setPortMenu] = useState<PortContextMenuState | undefined>();
  const [marquee, setMarquee] = useState<MarqueeSelection | undefined>();
  const [focusedIssueKey, setFocusedIssueKey] = useState<string | undefined>();
  const [compileMessage, setCompileMessage] = useState("");
  const [runtimeOutput, setRuntimeOutput] = useState<RuntimeHistoryEntry | undefined>();
  const [runtimeHistory, setRuntimeHistory] = useState<RuntimeHistoryEntry[]>([]);
  const [runtimeNodeStatus, setRuntimeNodeStatus] = useState<Map<string, RuntimeTraceEvent>>(new Map());
  const [runtimeQueueStatus, setRuntimeQueueStatus] = useState<RuntimeQueueStatus>({ running: false, queuedRuns: 0 });
  const [refactorResult, setRefactorResult] = useState<RefactorResultMessage | undefined>();
  const [activeRuntimeTraceIndex, setActiveRuntimeTraceIndex] = useState<number | undefined>();
  const [isRuntimeRunning, setIsRuntimeRunning] = useState(false);
  const activeRuntimeRunIdRef = useRef<string | undefined>();
  const [breakpoints, setBreakpoints] = useState<BlueprintBreakpoint[]>(() => readBreakpoints(hostClient.getState()));
  const [categoryAccents, setCategoryAccents] = useState<CategoryAccentMap>({});
  const [templateRegistrySources, setTemplateRegistrySources] = useState<TemplateRegistrySourceSummary[]>([]);
  const [solutionOutline, setSolutionOutline] = useState<BlueprintSolutionOutline | undefined>();
  const [solutionGraphIndex, setSolutionGraphIndex] = useState<BlueprintSolutionGraphSearchIndex | undefined>();
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 600 });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [toolbarOverflowOpen, setToolbarOverflowOpen] = useState(false);
  const [editorSettingsOpen, setEditorSettingsOpen] = useState(false);
  const [templateRegistryOpen, setTemplateRegistryOpen] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(!externalDockPanels);
  const [rightPanelOpen, setRightPanelOpen] = useState(!externalDockPanels);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [panelSizes, setPanelSizes] = useState<PanelSizes>({ left: 260, right: 320, bottom: 210 });
  const [panelResize, setPanelResize] = useState<PanelResizeState | undefined>();
  const [editorPrefs, setEditorPrefs] = useState<GraphEditorPrefs>(() => initialEditorPrefs);
  const [viewportLocked, setViewportLocked] = useState(false);
  const minimapVisible = editorPrefs.minimapVisible;
  const linkRenderMode = editorPrefs.linkRenderMode;
  const gridVisible = editorPrefs.gridVisible;
  const snapToGrid = editorPrefs.snapToGrid;
  const actionBarPlacement = editorPrefs.actionBarPlacement;
  const toolbarAlignment = editorPrefs.toolbarAlignment;
  const t = useMemo(() => createTranslator(editorPrefs.language), [editorPrefs.language]);
  useEffect(() => {
    if (externalDockPanels) {
      setLeftPanelOpen(false);
      setRightPanelOpen(false);
    }
  }, [externalDockPanels]);
  const startPanelResize = useCallback((kind: PanelResizeState["kind"], event: React.PointerEvent<HTMLDivElement>) => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    event.preventDefault();
    capturePointer(event.currentTarget, event.pointerId);
    setPanelResize({
      kind,
      startX: event.clientX,
      startY: event.clientY,
      startSizes: panelSizes,
      shellWidth: rect.width,
      shellHeight: rect.height
    });
  }, [panelSizes]);
  const resizePanels = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panelResize) {
      return;
    }
    event.preventDefault();
    const leftBasis = leftPanelOpen ? panelResize.startSizes.left : 44;
    const rightBasis = rightPanelOpen ? panelResize.startSizes.right : 44;
    setPanelSizes((current) => {
      if (panelResize.kind === "left") {
        const maxLeft = Math.max(188, Math.min(520, panelResize.shellWidth - rightBasis - 332));
        return { ...current, left: Math.round(clamp(panelResize.startSizes.left + event.clientX - panelResize.startX, 188, maxLeft)) };
      }
      if (panelResize.kind === "right") {
        const maxRight = Math.max(240, Math.min(560, panelResize.shellWidth - leftBasis - 332));
        return { ...current, right: Math.round(clamp(panelResize.startSizes.right - (event.clientX - panelResize.startX), 240, maxRight)) };
      }
      const maxBottom = Math.max(120, Math.min(420, panelResize.shellHeight - 260));
      return { ...current, bottom: Math.round(clamp(panelResize.startSizes.bottom - (event.clientY - panelResize.startY), 120, maxBottom)) };
    });
  }, [leftPanelOpen, panelResize, rightPanelOpen]);
  const stopPanelResize = useCallback(() => {
    setPanelResize(undefined);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const paletteCommand = editorCommandsRef.current.find((command) => command.id === "workbench.commandPalette");
      if (paletteCommand && commandShortcuts(paletteCommand).some((shortcut) => shortcutMatchesEvent(shortcut, event))) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (commandPaletteOpen || isEditableTarget(event.target)) {
        return;
      }

      const command = editorCommandsRef.current.find((candidate) =>
        !candidate.disabled && commandShortcuts(candidate).some((shortcut) => shortcutMatchesEvent(shortcut, event))
      );
      if (!command) {
        return;
      }
      event.preventDefault();
      command.run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandPaletteOpen]);

  const updateEditorPrefs = useCallback((updates: Partial<GraphEditorPrefs>) => {
    setEditorPrefs((current) => ({ ...current, ...updates }));
  }, []);

  const exportEditorPrefs = useCallback(async (): Promise<boolean> => {
    try {
      await writeTextToClipboard(serializeGraphEditorPrefs(editorPrefs));
      return true;
    } catch {
      return false;
    }
  }, [editorPrefs]);

  const importEditorPrefs = useCallback((text: string): boolean => {
    try {
      setEditorPrefs(readGraphEditorPrefsFromText(text));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const state = hostClient.getState();
    const storedPrefs = readGraphEditorPrefs(state);
    if (
      storedPrefs.minimapVisible === editorPrefs.minimapVisible &&
      storedPrefs.linkRenderMode === editorPrefs.linkRenderMode &&
      storedPrefs.gridVisible === editorPrefs.gridVisible &&
      storedPrefs.snapToGrid === editorPrefs.snapToGrid &&
      storedPrefs.actionBarPlacement === editorPrefs.actionBarPlacement &&
      storedPrefs.toolbarAlignment === editorPrefs.toolbarAlignment &&
      storedPrefs.nodeLabelMode === editorPrefs.nodeLabelMode &&
      storedPrefs.language === editorPrefs.language &&
      storedPrefs.theme === editorPrefs.theme &&
      mainToolbarActionsEqual(storedPrefs.mainToolbarActions, editorPrefs.mainToolbarActions) &&
      shortcutPrefsEqual(storedPrefs.shortcuts, editorPrefs.shortcuts)
    ) {
      return;
    }
    hostClient.setState(mergeGraphEditorPrefsState(state, editorPrefs));
  }, [editorPrefs, hostClient]);

  const persistRuntimeHistoryState = useCallback((history: RuntimeHistoryEntry[], activeId?: string) => {
    const entries = limitRuntimeHistory(history, activeId);
    hostClient.setState({
      ...recordFromUnknown(hostClient.getState()),
      runtimeHistory: {
        activeId,
        entries
      }
    });
  }, [hostClient]);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph?.id]);

  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  const graphTemplates = useMemo(
    () => mergeTemplatesById([...templates, ...(graph?.localTemplates ?? [])]),
    [graph?.localTemplates, templates]
  );
  const openReferencedGraph = useCallback((template: BlueprintNodeTemplate | undefined) => {
    const graphPath = referencedGraphPathForTemplate(template, solutionOutline, solutionGraphIndex);
    if (graphPath) {
      hostClient.requestOpenGraph(graphPath);
    }
  }, [hostClient, solutionGraphIndex, solutionOutline]);
  const selectedNodeId = useMemo(() => [...selectedNodeIds][0], [selectedNodeIds]);
  const selectedNode = useMemo(() => graph?.nodes.find((node) => node.id === selectedNodeId), [graph, selectedNodeId]);
  const selectedCommentId = useMemo(() => [...selectedCommentIds][0], [selectedCommentIds]);
  const selectedComment = useMemo(() => graphComments(graph).find((comment) => comment.id === selectedCommentId), [graph, selectedCommentId]);
  const selectedTemplate = useMemo(() => (graph && selectedNode ? getEffectiveTemplateForNode(graph, graphTemplates, selectedNode) : undefined), [graph, graphTemplates, selectedNode]);
  const nodeFindResults = useMemo(() => (graph ? findNodesInGraph(graph, graphTemplates, nodeFindQuery, t, editorPrefs.language) : []), [editorPrefs.language, graph, graphTemplates, nodeFindQuery, t]);
  const solutionFindResults = useMemo(
    () => findInSolutionGraphIndex(solutionGraphIndex, graphTemplates, nodeFindQuery, solutionOutline?.activeGraphPath, t, editorPrefs.language),
    [editorPrefs.language, graphTemplates, nodeFindQuery, solutionGraphIndex, solutionOutline?.activeGraphPath, t]
  );
  const graphOutlineNodes = useMemo(
    () =>
      graph
        ? graph.nodes
            .map((node) => ({ node, template: getEffectiveTemplateForNode(graph, graphTemplates, node) }))
            .sort((a, b) => a.node.position.x - b.node.position.x || a.node.position.y - b.node.position.y || a.node.id.localeCompare(b.node.id))
        : [],
    [graph, graphTemplates]
  );
  const graphOutlineComments = useMemo(() => graphComments(graph), [graph]);
  const filteredGraphOutlineNodes = useMemo(
    () => filterOutlineNodes(graphOutlineNodes, outlineQuery, editorPrefs.language),
    [editorPrefs.language, graphOutlineNodes, outlineQuery]
  );
  const visibleGraphOutlineNodes = useMemo(
    () => filteredGraphOutlineNodes.slice(0, outlineNodeRenderLimit),
    [filteredGraphOutlineNodes]
  );
  const filteredGraphOutlineNodeGroups = useMemo(
    () => groupOutlineNodesByCategory(visibleGraphOutlineNodes, t, editorPrefs.language),
    [editorPrefs.language, visibleGraphOutlineNodes, t]
  );
  const filteredGraphOutlineComments = useMemo(
    () => filterOutlineComments(graphOutlineComments, outlineQuery),
    [graphOutlineComments, outlineQuery]
  );
  const breakpointNodeIds = useMemo(() => new Set(breakpoints.map((breakpoint) => breakpoint.nodeId)), [breakpoints]);
  const favoriteTemplateIds = useMemo(() => new Set(palettePrefs.favoriteTemplateIds), [palettePrefs.favoriteTemplateIds]);
  const disabledTemplatePackageIds = useMemo(() => new Set(palettePrefs.disabledTemplatePackageIds), [palettePrefs.disabledTemplatePackageIds]);
  const creationTemplates = useMemo(
    () => graphTemplates.filter((template) => templateAvailableForCreation(template, disabledTemplatePackageIds, templateRegistrySources)),
    [disabledTemplatePackageIds, graphTemplates, templateRegistrySources]
  );
  const rankedTemplateCandidates = useMemo(() => rankedTemplates(creationTemplates, search, nodePanel.sourcePort, palettePrefs, editorPrefs.language), [creationTemplates, editorPrefs.language, nodePanel.sourcePort, palettePrefs, search]);
  const categories = useMemo(() => templateCategorySummaries(rankedTemplateCandidates, palettePrefs, t, editorPrefs.language), [editorPrefs.language, palettePrefs, rankedTemplateCandidates, t]);
  const candidates = useMemo(
    () => activeTemplateCategory === allTemplateCategoryId
      ? rankedTemplateCandidates
      : rankedTemplateCandidates.filter((template) => templateMatchesPaletteCategory(template, activeTemplateCategory, palettePrefs)),
    [activeTemplateCategory, palettePrefs, rankedTemplateCandidates]
  );

  useEffect(() => {
    setActiveCandidateIndex(0);
  }, [nodePanel.open, search, nodePanel.sourcePort, candidates.length]);

  useEffect(() => {
    if (!nodePanel.open) {
      setActiveTemplateCategory(allTemplateCategoryId);
      return;
    }
    if (!categories.some((category) => category.id === activeTemplateCategory)) {
      setActiveTemplateCategory(allTemplateCategoryId);
    }
  }, [activeTemplateCategory, categories, nodePanel.open]);

  const commitGraph = useCallback(
    (next: BlueprintGraph, previousOverride?: BlueprintGraph) => {
      graphRef.current = next;
      setGraph((current) => {
        const previous = previousOverride ?? current;
        if (previous && previous !== next) {
          setHistory((historyState) => ({ past: [...historyState.past, previous].slice(-80), future: [] }));
        }
        hostClient.notifyGraphChanged(next);
        return next;
      });
    },
    [hostClient]
  );

  const updateLocalGraph = useCallback((next: BlueprintGraph) => {
    graphRef.current = next;
    setGraph(next);
  }, []);

  const restoreGraph = useCallback((next: BlueprintGraph) => {
    graphRef.current = next;
    setGraph(next);
    hostClient.notifyGraphChanged(next);
  }, [hostClient]);

  const focusNodeById = useCallback(
    (nodeId: string) => {
      const currentGraph = graphRef.current;
      const node = currentGraph?.nodes.find((candidate) => candidate.id === nodeId);
      if (!currentGraph || !node) {
        return;
      }

      setSelectedNodeIds(new Set([nodeId]));
      setSelectedLinkIds(new Set());
      setSelectedCommentIds(new Set());

      const bounds = nodeBounds(currentGraph, templatesRef.current, node);
      const rect = canvasRef.current?.getBoundingClientRect();
      const size = safeCanvasSize(rect, { width: 1, height: 1 });
      commitGraph(withFittedViewport(currentGraph, bounds, size, 160, { min: 0.55, max: 1.35 }));
    },
    [commitGraph]
  );

  const focusLinkById = useCallback(
    (linkId: string) => {
      const currentGraph = graphRef.current;
      const link = currentGraph?.links.find((candidate) => candidate.id === linkId);
      if (!currentGraph || !link) {
        return;
      }

      setSelectedNodeIds(new Set());
      setSelectedLinkIds(new Set([linkId]));
      setSelectedCommentIds(new Set());

      const linkedNodes = currentGraph.nodes.filter((node) => node.id === link.fromNodeId || node.id === link.toNodeId);
      if (!linkedNodes.length) {
        return;
      }

      const bounds = boundsForNodes(currentGraph, templatesRef.current, linkedNodes);
      const rect = canvasRef.current?.getBoundingClientRect();
      const size = safeCanvasSize(rect, { width: 1, height: 1 });
      commitGraph(withFittedViewport(currentGraph, bounds, size, 180, { min: 0.45, max: 1.25 }));
    },
    [commitGraph]
  );

  const focusIssue = useCallback(
    (issue: ValidationIssue) => {
      setFocusedIssueKey(issueKey(issue));
      if (issue.nodeId) {
        focusNodeById(issue.nodeId);
      } else if (issue.linkId) {
        focusLinkById(issue.linkId);
      }
    },
    [focusLinkById, focusNodeById]
  );

  const openNodeFindDialog = useCallback(() => {
    setEditorSettingsOpen(false);
    setTemplateRegistryOpen(false);
    setToolbarOverflowOpen(false);
    setNodeFindDialogOpen(true);
    dispatchCanvasInteraction({ type: "openMenu", menu: "nodeFind" });
    window.setTimeout(() => {
      nodeFindDialogInputRef.current?.focus();
      nodeFindDialogInputRef.current?.select();
    }, 0);
  }, []);

  const closeNodeFindDialog = useCallback(() => {
    setNodeFindDialogOpen(false);
    dispatchCanvasInteraction({ type: "cancel" });
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent<HostToEditorMessage>) => {
      const message = event.data;
      if (message.type === "loadGraph") {
        const restoredRuntime = readRuntimeHistoryState(hostClient.getState(), message.graph.id);
        graphRef.current = message.graph;
        setGraph(message.graph);
        setLoadingTimedOut(false);
        setRuntimeNodeStatus(runtimeStatusByNodeId(message.graph.id, restoredRuntime.active?.traces ?? []));
        setRuntimeOutput(restoredRuntime.active);
        setRefactorResult(undefined);
        setActiveRuntimeTraceIndex(undefined);
        setIsRuntimeRunning(false);
        setRuntimeQueueStatus({ running: false, queuedRuns: 0 });
        setRuntimeHistory(restoredRuntime.history);
        setWireMenu(undefined);
        setNodeMenu(undefined);
        setCommentMenu(undefined);
        setPortMenu(undefined);
        setBreakpoints(readBreakpoints(hostClient.getState(), message.graph).filter((breakpoint) => message.graph.nodes.some((node) => node.id === breakpoint.nodeId)));
        setSelectedNodeIds((current) => {
          const retained = [...current].filter((nodeId) => message.graph.nodes.some((node) => node.id === nodeId));
          return new Set(retained.length ? retained : message.graph.nodes[0]?.id ? [message.graph.nodes[0].id] : []);
        });
        setSelectedLinkIds((current) => new Set([...current].filter((linkId) => message.graph.links.some((link) => link.id === linkId))));
        setSelectedCommentIds((current) => new Set([...current].filter((commentId) => graphComments(message.graph).some((comment) => comment.id === commentId))));
        setHistory({ past: [], future: [] });
      } else if (message.type === "loadTemplates") {
        templatesRef.current = message.templates;
        setTemplates(message.templates);
      } else if (message.type === "templateRegistrySources") {
        setTemplateRegistrySources(message.sources);
      } else if (message.type === "solutionOutline") {
        setSolutionOutline(message.solution);
      } else if (message.type === "solutionGraphIndex") {
        setSolutionGraphIndex(message.index);
      } else if (message.type === "editorCapabilities") {
        setNativeUndoRedo(message.nativeUndoRedo);
      } else if (message.type === "themeSettings") {
        setCategoryAccents(normalizeCategoryAccentMap(message.categoryAccents));
      } else if (message.type === "validationResult") {
        setIssues(message.issues);
      } else if (message.type === "compileResult") {
        setCompileMessage(message.message);
        setRefactorResult(undefined);
        setRuntimeOutput(undefined);
        setActiveRuntimeTraceIndex(undefined);
        if (!message.ok && message.issues?.length) {
          setFocusedIssueKey(undefined);
          setIssues(message.issues);
        }
      } else if (message.type === "refactorResult") {
        setRefactorResult({ ok: message.ok, message: message.message });
        setRuntimeOutput(undefined);
        setActiveRuntimeTraceIndex(undefined);
      } else if (message.type === "runtimeQueueStatus") {
        setRuntimeQueueStatus(message.status);
        setIsRuntimeRunning(message.status.running);
      } else if (message.type === "runtimeResult") {
        if (message.runId && activeRuntimeRunIdRef.current && message.runId !== activeRuntimeRunIdRef.current) {
          return;
        }
        activeRuntimeRunIdRef.current = undefined;
        setIsRuntimeRunning(false);
        setRuntimeQueueStatus((current) => current.queuedRuns ? { ...current, running: false } : { running: false, queuedRuns: 0 });
        setRefactorResult(undefined);
        const entry: RuntimeHistoryEntry = {
          id: `run-${Date.now().toString(36)}-${message.durationMs}`,
          graphId: graphRef.current?.id,
          ok: message.ok,
          message: message.message,
          text: formatRuntimeText(message.stdout, message.stderr, message.message),
          durationMs: message.durationMs,
          traces: message.traces,
          createdAt: Date.now()
        };
        setRuntimeOutput(entry);
        setActiveRuntimeTraceIndex(message.traces.length ? 0 : undefined);
        setRuntimeHistory((current) => {
          const next = limitRuntimeHistory([entry, ...current.filter((candidate) => candidate.id !== entry.id)], entry.id);
          persistRuntimeHistoryState(next, entry.id);
          return next;
        });
        setRuntimeNodeStatus(runtimeStatusByNodeId(graphRef.current?.id, message.traces));
        const interruptTrace = [...message.traces].reverse().find((trace) => trace.status === "breakpoint" || trace.status === "error");
        if (interruptTrace) {
          focusNodeById(interruptTrace.nodeId);
        }
        if (!message.ok && message.issues?.length) {
          setFocusedIssueKey(undefined);
          setIssues(message.issues);
        }
      } else if (message.type === "runtimeTrace") {
        if (message.runId && activeRuntimeRunIdRef.current && message.runId !== activeRuntimeRunIdRef.current) {
          return;
        }
        setRuntimeNodeStatus((current) => applyRuntimeTraceStatus(graphRef.current?.id, current, message.trace));
      } else if (message.type === "focusNode") {
        focusNodeById(message.nodeId);
      } else if (message.type === "runCommand") {
        const command = editorCommandsRef.current.find((candidate) => candidate.id === message.commandId);
        if (command && !command.disabled) {
          command.run();
        }
      }
    };

    window.addEventListener("message", listener);
    hostClient.notifyReady();
    return () => window.removeEventListener("message", listener);
  }, [focusNodeById, persistRuntimeHistoryState, hostClient]);

  useEffect(() => {
    if (graph) {
      setLoadingTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadingTimedOut(true), graphLoadRetryDelayMs);
    return () => window.clearTimeout(timer);
  }, [graph]);

  const persistPalettePrefs = useCallback(
    (next: NodePalettePrefs) => {
      setPalettePrefs(next);
      hostClient.setState({ ...recordFromUnknown(hostClient.getState()), palette: next });
    },
    [hostClient]
  );

  const persistBreakpoints = useCallback(
    (next: BlueprintBreakpoint[], options: { commitToGraph?: boolean } = {}) => {
      const normalized = normalizeBreakpoints(next);
      setBreakpoints(normalized);
      hostClient.setState({ ...recordFromUnknown(hostClient.getState()), breakpoints: normalized });
      if (options.commitToGraph) {
        const currentGraph = graphRef.current;
        if (currentGraph) {
          commitGraph(withDebugBreakpoints(currentGraph, normalized));
        }
      }
    },
    [commitGraph, hostClient]
  );

  const recordRecentTemplate = useCallback(
    (templateId: string) => {
      persistPalettePrefs({
        ...palettePrefs,
        recentTemplateIds: [templateId, ...palettePrefs.recentTemplateIds.filter((id) => id !== templateId)].slice(0, maxRecentTemplates)
      });
    },
    [palettePrefs, persistPalettePrefs]
  );

  const toggleFavoriteTemplate = useCallback(
    (templateId: string) => {
      const favoriteTemplateIds = palettePrefs.favoriteTemplateIds.includes(templateId)
        ? palettePrefs.favoriteTemplateIds.filter((id) => id !== templateId)
        : [templateId, ...palettePrefs.favoriteTemplateIds];
      persistPalettePrefs({ ...palettePrefs, favoriteTemplateIds });
    },
    [palettePrefs, persistPalettePrefs]
  );

  const toggleTemplatePackageEnabled = useCallback(
    (packageId: string) => {
      if (packageId === "all") {
        return;
      }
      const disabledTemplatePackageIds = palettePrefs.disabledTemplatePackageIds.includes(packageId)
        ? palettePrefs.disabledTemplatePackageIds.filter((id) => id !== packageId)
        : [packageId, ...palettePrefs.disabledTemplatePackageIds];
      persistPalettePrefs({ ...palettePrefs, disabledTemplatePackageIds });
    },
    [palettePrefs, persistPalettePrefs]
  );

  const undoGraph = useCallback(() => {
    if (nativeUndoRedo) {
      hostClient.requestUndo();
      return;
    }
    if (!graph || !history.past.length) {
      return;
    }
    const previous = history.past.at(-1);
    if (!previous) {
      return;
    }
    setHistory({ past: history.past.slice(0, -1), future: [graph, ...history.future].slice(0, 80) });
    restoreGraph(previous);
  }, [graph, history, hostClient, nativeUndoRedo, restoreGraph]);

  const redoGraph = useCallback(() => {
    if (nativeUndoRedo) {
      hostClient.requestRedo();
      return;
    }
    if (!graph || !history.future.length) {
      return;
    }
    const next = history.future[0];
    setHistory({ past: [...history.past, graph].slice(-80), future: history.future.slice(1) });
    restoreGraph(next);
  }, [graph, history, hostClient, nativeUndoRedo, restoreGraph]);

  const screenToGraph = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const viewport = graph?.layout.viewport ?? { x: 0, y: 0, zoom: 1 };
      return screenToGraphPoint({ x: clientX, y: clientY }, rect, viewport);
    },
    [graph?.layout.viewport]
  );

  const maybeSnapPoint = useCallback(
    (point: Point): Point => snapToGrid ? snapPointToGrid(point, snapGridWorldSize) : point,
    [snapToGrid]
  );

  const updateViewport = useCallback(
    (viewport: BlueprintGraph["layout"]["viewport"]) => {
      if (!graph) {
        return;
      }
      commitGraph({ ...graph, layout: { ...graph.layout, viewport } });
    },
    [commitGraph, graph]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) {
      return;
    }

    const updateCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      setCanvasSize({
        width: Math.max(1, rect.width || 1),
        height: Math.max(1, rect.height || 1)
      });
    };

    updateCanvasSize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateCanvasSize);
    observer?.observe(canvas);
    window.addEventListener("resize", updateCanvasSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateCanvasSize);
    };
  }, [graph?.id]);

  const centerViewportOnGraphPoint = useCallback(
    (point: Point) => {
      if (!graph) {
        return;
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      const size = safeCanvasSize(rect, canvasSize);
      commitGraph(withCenteredViewport(graph, point, size, graph.layout.viewport.zoom));
    },
    [canvasSize.height, canvasSize.width, commitGraph, graph]
  );

  const zoomViewportAtCanvasCenter = useCallback(
    (nextZoom: number) => {
      if (!graph || viewportLocked) {
        return;
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      const size = safeCanvasSize(rect, canvasSize);
      commitGraph({
        ...graph,
        layout: {
          ...graph.layout,
          viewport: calculateZoomViewportAtCanvasCenter(graph.layout.viewport, size, nextZoom)
        }
      });
    },
    [canvasSize.height, canvasSize.width, commitGraph, graph, viewportLocked]
  );

  const fitGraphToCanvas = useCallback(() => {
    if (!graph || !graph.nodes.length || viewportLocked) {
      return;
    }
    const bounds = boundsForRects([
      ...graph.nodes.map((node) => nodeBounds(graph, templates, node)),
      ...graphComments(graph).map((comment) => ({
        x: comment.position.x,
        y: comment.position.y,
        width: comment.size.width,
        height: comment.size.height
      }))
    ]);
    const rect = canvasRef.current?.getBoundingClientRect();
    const size = safeCanvasSize(rect, canvasSize);
    commitGraph(withFittedViewport(graph, bounds, size, 112));
  }, [canvasSize.height, canvasSize.width, commitGraph, graph, templates, viewportLocked]);

  const focusCommentById = useCallback(
    (commentId: string) => {
      const currentGraph = graphRef.current;
      const comment = graphComments(currentGraph).find((candidate) => candidate.id === commentId);
      if (!currentGraph || !comment) {
        return;
      }

      setSelectedNodeIds(new Set());
      setSelectedLinkIds(new Set());
      setSelectedCommentIds(new Set([commentId]));

      const rect = canvasRef.current?.getBoundingClientRect();
      const size = safeCanvasSize(rect, { width: 1, height: 1 });
      commitGraph(withFittedViewport(
        currentGraph,
        { x: comment.position.x, y: comment.position.y, width: comment.size.width, height: comment.size.height },
        size,
        180,
        { min: 0.45, max: 1.25 }
      ));
    },
    [commitGraph]
  );

  const onWheel = (event: React.WheelEvent) => {
    if (!graph) {
      return;
    }
    if (viewportLocked) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    const oldViewport = graph.layout.viewport;
    const oldZoom = oldViewport.zoom;
    const nextZoom = clamp(oldZoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.35, 2.2);
    const pointerX = event.clientX - (rect?.left ?? 0);
    const pointerY = event.clientY - (rect?.top ?? 0);
    updateViewport(zoomViewportAtCanvasPoint(oldViewport, { x: pointerX, y: pointerY }, nextZoom));
  };

  const onCanvasPointerMove = (event: React.PointerEvent) => {
    const graphPoint = screenToGraph(event.clientX, event.clientY);
    setPointerGraph(graphPoint);

    if (panning && graph) {
      updateLocalGraph({
        ...graph,
        layout: {
          ...graph.layout,
          viewport: panViewport(panning.start, { x: event.clientX, y: event.clientY }, panning.viewport, graph.layout.viewport.zoom)
        }
      });
    }

    if (draggingNodes?.length && graph) {
      const offsetsByNodeId = new Map(draggingNodes.map((draggingNode) => [draggingNode.nodeId, draggingNode.offset]));
      const nodes = graph.nodes.map((node) =>
        offsetsByNodeId.has(node.id)
          ? { ...node, position: maybeSnapPoint({ x: graphPoint.x - offsetsByNodeId.get(node.id)!.x, y: graphPoint.y - offsetsByNodeId.get(node.id)!.y }) }
          : node
      );
      updateLocalGraph({ ...graph, nodes });
    }

    if (draggingComments?.comments.length && graph) {
      const commentOffsetsById = new Map(draggingComments.comments.map((draggingComment) => [draggingComment.commentId, draggingComment.offset]));
      const nodeOffsetsById = new Map(draggingComments.nodes.map((draggingNode) => [draggingNode.nodeId, draggingNode.offset]));
      const comments = graphComments(graph).map((comment) =>
        commentOffsetsById.has(comment.id)
          ? { ...comment, position: maybeSnapPoint({ x: graphPoint.x - commentOffsetsById.get(comment.id)!.x, y: graphPoint.y - commentOffsetsById.get(comment.id)!.y }) }
          : comment
      );
      const nodes = graph.nodes.map((node) =>
        nodeOffsetsById.has(node.id)
          ? { ...node, position: maybeSnapPoint({ x: graphPoint.x - nodeOffsetsById.get(node.id)!.x, y: graphPoint.y - nodeOffsetsById.get(node.id)!.y }) }
          : node
      );
      updateLocalGraph({ ...graph, nodes, comments });
    }

    if (resizingComment && graph) {
      const comments = graphComments(graph).map((comment) =>
        comment.id === resizingComment.commentId
          ? {
              ...comment,
              size: {
                width: Math.round(clamp(resizingComment.size.width + graphPoint.x - resizingComment.start.x, 120, 2400)),
                height: Math.round(clamp(resizingComment.size.height + graphPoint.y - resizingComment.start.y, 80, 1800))
              }
            }
          : comment
      );
      updateLocalGraph({ ...graph, comments });
    }

    if (marqueeRef.current) {
      const nextMarquee = { ...marqueeRef.current, current: graphPoint };
      marqueeRef.current = nextMarquee;
      dispatchCanvasInteraction({ type: "updateMarquee", pointerId: event.pointerId, current: graphPoint });
      setMarquee(nextMarquee);
    }
  };

  const onCanvasPointerDown = (event: React.PointerEvent) => {
    if (!graph) {
      return;
    }
    setWireMenu(undefined);
    setNodeMenu(undefined);
    setCommentMenu(undefined);
    setPortMenu(undefined);
    if (event.button === 1 && !viewportLocked) {
      event.preventDefault();
      capturePointer(event.currentTarget, event.pointerId);
      interactionStartGraph.current = graph;
      dispatchCanvasInteraction({
        type: "startPan",
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        viewport: { x: graph.layout.viewport.x, y: graph.layout.viewport.y }
      });
      setPanning({
        start: { x: event.clientX, y: event.clientY },
        viewport: { x: graph.layout.viewport.x, y: graph.layout.viewport.y }
      });
      return;
    }

    if (!viewportLocked && event.button !== 1 && event.button !== 2 && isBlankCanvasTarget(event.target)) {
      event.preventDefault();
      capturePointer(event.currentTarget, event.pointerId);
      const graphPoint = screenToGraph(event.clientX, event.clientY);
      const additive = Boolean(event.ctrlKey || event.metaKey || event.shiftKey);
      if (!additive) {
        setSelectedNodeIds(new Set());
        setSelectedLinkIds(new Set());
        setSelectedCommentIds(new Set());
      }
      const nextMarquee = { start: graphPoint, current: graphPoint, additive };
      marqueeRef.current = nextMarquee;
      dispatchCanvasInteraction({
        type: "startMarquee",
        pointerId: event.pointerId,
        start: graphPoint,
        additive
      });
      setMarquee(nextMarquee);
    }
  };

  const onCanvasPointerUp = (event: React.PointerEvent) => {
    const activeMarquee = marqueeRef.current;
    if (activeMarquee && graph) {
      const rect = normalizeRect(activeMarquee.start, activeMarquee.current);
      const marqueeNodeIds = graph.nodes
        .filter((node) => rectIntersects(rect, nodeBounds(graph, templates, node)))
        .map((node) => node.id);
      setSelectedNodeIds((selectedIds) => new Set(activeMarquee.additive ? [...selectedIds, ...marqueeNodeIds] : marqueeNodeIds));
      setSelectedLinkIds(new Set());
      marqueeRef.current = undefined;
      dispatchCanvasInteraction({ type: "end", pointerId: event.pointerId });
      setMarquee(undefined);
      return;
    }
    if (dragPort && graph) {
      if (dragPort.movingLink && interactionStartGraph.current && isBlankCanvasTarget(event.target)) {
        updateLocalGraph(interactionStartGraph.current);
      } else {
        setNodePanel({
          open: true,
          screen: { x: event.clientX, y: event.clientY },
          graph: maybeSnapPoint(screenToGraph(event.clientX, event.clientY)),
          sourcePort: dragPort
        });
        setSearch("");
      }
    }
    if (draggingNodes?.length && graph) {
      commitGraph(graph, interactionStartGraph.current);
    }
    if (draggingComments?.comments.length && graph) {
      commitGraph(graph, interactionStartGraph.current);
    }
    if (resizingComment && graph) {
      commitGraph(graph, interactionStartGraph.current);
    }
    if (panning && graph) {
      commitGraph(graph, interactionStartGraph.current);
    }
    dispatchCanvasInteraction({ type: "end", pointerId: event.pointerId });
    interactionStartGraph.current = undefined;
    marqueeRef.current = undefined;
    setDragPort(undefined);
    setPanning(undefined);
    setDraggingNodes(undefined);
    setDraggingComments(undefined);
    setResizingComment(undefined);
  };

  const openContextPanel = (event: React.MouseEvent) => {
    event.preventDefault();
    if (!graph) {
      return;
    }
    setWireMenu(undefined);
    setNodeMenu(undefined);
    setCommentMenu(undefined);
    setPortMenu(undefined);
    dispatchCanvasInteraction({ type: "openMenu", menu: "nodeCreation" });
    setNodePanel({
      open: true,
      screen: { x: event.clientX, y: event.clientY },
      graph: maybeSnapPoint(screenToGraph(event.clientX, event.clientY))
    });
    setSearch("");
  };

  const addTemplateNodeAt = (template: BlueprintNodeTemplate, position: Point, sourcePort?: DragPort) => {
    if (!graph) {
      return;
    }

    const nodePosition = maybeSnapPoint(position);
    const node = createNodeFromTemplate(template, nodePosition.x, nodePosition.y);
    const nextGraph: BlueprintGraph = { ...graph, nodes: [...graph.nodes, node] };
    const link = sourcePort ? createLinkForNewNode(sourcePort, node, template) : undefined;
    if (link) {
      nextGraph.links = [...nextGraph.links, link];
      if (link.flowKind === "data" && link.toNodeId === node.id) {
        node.inputBindings[link.toPortId] = { portId: link.toPortId, sourceKind: "link", linkId: link.id };
      }
      if (link.flowKind === "data" && sourcePort && link.toNodeId === sourcePort.nodeId) {
        const nodes = nextGraph.nodes.map((candidate) =>
          candidate.id === sourcePort.nodeId
            ? {
                ...candidate,
                inputBindings: {
                  ...candidate.inputBindings,
                  [link.toPortId]: { portId: link.toPortId, sourceKind: "link" as const, linkId: link.id }
                }
              }
            : candidate
        );
        nextGraph.nodes = nodes;
      }
    }

    setSelectedNodeIds(new Set([node.id]));
    setNodePanel(emptyPanel);
    dispatchCanvasInteraction({ type: "cancel" });
    recordRecentTemplate(template.id);
    commitGraph(nextGraph);
  };

  const addNode = (template: BlueprintNodeTemplate) => {
    addTemplateNodeAt(template, nodePanel.graph, nodePanel.sourcePort);
  };

  const addTemplateFromRegistry = (template: BlueprintNodeTemplate) => {
    addTemplateNodeAt(template, {
      x: (canvasSize.width / 2 - viewport.x) / viewport.zoom,
      y: (canvasSize.height / 2 - viewport.y) / viewport.zoom
    });
    setTemplateRegistryOpen(false);
  };

  const selectNode = (nodeId: string, additive = false) => {
    setFocusedIssueKey(undefined);
    if (!additive) {
      setSelectedLinkIds(new Set());
      setSelectedCommentIds(new Set());
    }
    setSelectedNodeIds((current) => {
      if (!additive) {
        return new Set([nodeId]);
      }
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next.size ? next : new Set([nodeId]);
    });
  };

  const selectNodes = (nodeIds: string[]) => {
    const uniqueNodeIds = nodeIds.filter((nodeId, index) => nodeIds.indexOf(nodeId) === index);
    if (!uniqueNodeIds.length) {
      return;
    }
    setFocusedIssueKey(undefined);
    setSelectedLinkIds(new Set());
    setSelectedCommentIds(new Set());
    setSelectedNodeIds(new Set(uniqueNodeIds));
  };

  const selectLink = (linkId: string, additive = false) => {
    setFocusedIssueKey(undefined);
    if (!additive) {
      setSelectedNodeIds(new Set());
      setSelectedCommentIds(new Set());
    }
    setSelectedLinkIds((current) => {
      if (!additive) {
        return new Set([linkId]);
      }
      const next = new Set(current);
      if (next.has(linkId)) {
        next.delete(linkId);
      } else {
        next.add(linkId);
      }
      return next;
    });
  };

  const openWireContextMenu = (linkId: string, event: React.MouseEvent<SVGPathElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setNodePanel(emptyPanel);
    setNodeMenu(undefined);
    setCommentMenu(undefined);
    setPortMenu(undefined);
    setSelectedNodeIds(new Set());
    setSelectedCommentIds(new Set());
    setSelectedLinkIds(new Set([linkId]));
    dispatchCanvasInteraction({ type: "openMenu", menu: "wire" });
    setWireMenu({ linkId, screen: { x: event.clientX, y: event.clientY } });
  };

  const openNodeContextMenu = (nodeId: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const targetNodeIds = selectedNodeIds.has(nodeId) ? [...selectedNodeIds] : [nodeId];
    setNodePanel(emptyPanel);
    setWireMenu(undefined);
    setCommentMenu(undefined);
    setPortMenu(undefined);
    setSelectedNodeIds(new Set(targetNodeIds));
    setSelectedLinkIds(new Set());
    setSelectedCommentIds(new Set());
    dispatchCanvasInteraction({ type: "openMenu", menu: "node" });
    setNodeMenu({ nodeId, nodeIds: targetNodeIds, screen: { x: event.clientX, y: event.clientY } });
  };

  const openCommentContextMenu = (commentId: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setNodePanel(emptyPanel);
    setWireMenu(undefined);
    setNodeMenu(undefined);
    setPortMenu(undefined);
    setSelectedNodeIds(new Set());
    setSelectedLinkIds(new Set());
    setSelectedCommentIds(new Set([commentId]));
    dispatchCanvasInteraction({ type: "openMenu", menu: "comment" });
    setCommentMenu({ commentId, screen: { x: event.clientX, y: event.clientY } });
  };

  const openPortContextMenu = (nodeId: string, portId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setNodePanel(emptyPanel);
    setWireMenu(undefined);
    setNodeMenu(undefined);
    setCommentMenu(undefined);
    setSelectedNodeIds(new Set([nodeId]));
    setSelectedLinkIds(new Set());
    setSelectedCommentIds(new Set());
    dispatchCanvasInteraction({ type: "openMenu", menu: "port" });
    setPortMenu({ nodeId, portId, screen: { x: event.clientX, y: event.clientY } });
  };

  const selectComment = (commentId: string, additive = false) => {
    setFocusedIssueKey(undefined);
    if (!additive) {
      setSelectedNodeIds(new Set());
      setSelectedLinkIds(new Set());
    }
    setSelectedCommentIds((current) => {
      if (!additive) {
        return new Set([commentId]);
      }
      const next = new Set(current);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next.size ? next : new Set([commentId]);
    });
  };

  const updateLiteral = (node: BlueprintNodeInstance, port: BlueprintPortDefinition, value: unknown) => {
    if (!graph) {
      return;
    }
    const nodes = graph.nodes.map((candidate) =>
      candidate.id === node.id
        ? {
            ...candidate,
            inputBindings: {
              ...candidate.inputBindings,
              [port.id]: { portId: port.id, sourceKind: "literal" as const, literalValue: normalizeLiteral(value, port) }
            }
          }
        : candidate
    );
    commitGraph({ ...graph, nodes });
  };

  const updateCommentTitle = (comment: BlueprintCommentBox, title: string) => {
    if (!graph) {
      return;
    }
    commitGraph(updateGraphCommentTitle(graph, comment.id, title));
  };

  const updateCommentSize = (comment: BlueprintCommentBox, size: { width: number; height: number }) => {
    if (!graph) {
      return;
    }
    commitGraph(updateGraphCommentSize(graph, comment, size));
  };

  const updateCommentColor = (comment: BlueprintCommentBox, color: string) => {
    if (!graph) {
      return;
    }
    commitGraph(updateGraphCommentColor(graph, comment.id, color));
  };

  const connectDraggedPort = (targetPort: DragPort) => {
    if (!graph || !dragPort) {
      return;
    }

    const createdLink = createLinkBetweenExistingPorts(graph, templates, dragPort, targetPort);
    setDragPort(undefined);
    if (!createdLink) {
      if (dragPort.movingLink && interactionStartGraph.current) {
        updateLocalGraph(interactionStartGraph.current);
        interactionStartGraph.current = undefined;
      }
      dispatchCanvasInteraction({ type: "cancel" });
      return;
    }

    const link = dragPort.movingLink
      ? {
          ...createdLink,
          id: dragPort.movingLink.id,
          contextVariableId: createdLink.flowKind === "data" ? dragPort.movingLink.contextVariableId ?? createdLink.contextVariableId : undefined
        }
      : createdLink;
    const previousGraph = dragPort.movingLink ? interactionStartGraph.current : undefined;
    interactionStartGraph.current = undefined;
    dispatchCanvasInteraction({ type: "cancel" });
    commitGraph(applyLinkChange(graph, link), previousGraph);
  };

  const unlinkPort = (node: BlueprintNodeInstance, port: BlueprintPortDefinition) => {
    if (!graph) {
      return;
    }
    const link = graph.links.find((candidate) => candidate.toNodeId === node.id && candidate.toPortId === port.id);
    if (!link) {
      return;
    }
    setSelectedLinkIds((current) => new Set([...current].filter((linkId) => linkId !== link.id)));
    commitGraph(removeLinks(graph, new Set([link.id])));
  };

  const breakLinksForPort = useCallback(
    (node: BlueprintNodeInstance, port: BlueprintPortDefinition) => {
      if (!graph) {
        return;
      }
      const linkIds = linkIdsForPort(graph, node.id, port);
      if (!linkIds.size) {
        return;
      }
      setDragPort(undefined);
      dispatchCanvasInteraction({ type: "cancel" });
      setSelectedLinkIds(new Set());
      setWireMenu(undefined);
      setPortMenu(undefined);
      commitGraph(removeLinks(graph, linkIds));
    },
    [commitGraph, graph]
  );

  const startMoveInputLinkDrag = useCallback(
    (node: BlueprintNodeInstance, port: BlueprintPortDefinition): boolean => {
      if (!graph || port.direction !== "input") {
        return false;
      }

      const link = graph.links.find((candidate) => candidate.toNodeId === node.id && candidate.toPortId === port.id);
      if (!link) {
        return false;
      }

      const sourcePort = resolvePort(graph, templates, {
        nodeId: link.fromNodeId,
        portId: link.fromPortId,
        direction: "output",
        flowKind: link.flowKind,
        type: port.type
      });
      if (!sourcePort || sourcePort.direction !== "output") {
        return false;
      }

      interactionStartGraph.current = graph;
      dispatchCanvasInteraction({
        type: "startDragWire",
        nodeId: link.fromNodeId,
        portId: link.fromPortId,
        movingLinkId: link.id
      });
      setDragPort({
        nodeId: link.fromNodeId,
        portId: link.fromPortId,
        direction: "output",
        flowKind: link.flowKind,
        type: sourcePort.type,
        movingLink: link
      });
      setSelectedLinkIds(new Set());
      setWireMenu(undefined);
      setPortMenu(undefined);
      updateLocalGraph(removeLinks(graph, new Set([link.id])));
      return true;
    },
    [graph, templates, updateLocalGraph]
  );

  const breakLinksForNodeIds = useCallback(
    (nodeIds: Set<string>) => {
      if (!graph || !nodeIds.size) {
        return;
      }
      const linkIds = incidentLinkIds(graph, nodeIds);
      if (!linkIds.size) {
        return;
      }
      setDragPort(undefined);
      dispatchCanvasInteraction({ type: "cancel" });
      setSelectedLinkIds(new Set());
      setWireMenu(undefined);
      setNodeMenu(undefined);
      setPortMenu(undefined);
      commitGraph(removeLinks(graph, linkIds));
    },
    [commitGraph, graph]
  );

  const breakLinksForSelection = useCallback(() => {
    breakLinksForNodeIds(selectedNodeIds);
  }, [breakLinksForNodeIds, selectedNodeIds]);

  const deleteLinkById = useCallback(
    (linkId: string) => {
      if (!graph) {
        return;
      }
      setSelectedLinkIds(new Set());
      setWireMenu(undefined);
      commitGraph(removeLinks(graph, new Set([linkId])));
    },
    [commitGraph, graph]
  );

  const deleteNodeIds = useCallback(
    (nodeIds: Set<string>) => {
      if (!graph || !nodeIds.size) {
        return;
      }
      const deletion = deleteGraphNodes(graph, nodeIds);
      setSelectedNodeIds(deletion.nextSelectedNodeIds);
      setSelectedLinkIds(new Set());
      setSelectedCommentIds(new Set());
      setNodeMenu(undefined);
      commitGraph(deletion.graph);
    },
    [commitGraph, graph]
  );

  const deleteCommentById = useCallback(
    (commentId: string) => {
      if (!graph) {
        return;
      }
      setSelectedCommentIds(new Set());
      setSelectedNodeIds(new Set());
      setSelectedLinkIds(new Set());
      setCommentMenu(undefined);
      commitGraph(removeComments(graph, new Set([commentId])));
    },
    [commitGraph, graph]
  );

  const deleteSelection = useCallback(() => {
    if (!graph || (!selectedNodeIds.size && !selectedLinkIds.size && !selectedCommentIds.size)) {
      return;
    }
    const deletion = deleteGraphSelection(graph, {
      nodeIds: selectedNodeIds,
      linkIds: selectedLinkIds,
      commentIds: selectedCommentIds
    });
    setSelectedNodeIds(deletion.nextSelectedNodeIds);
    setSelectedLinkIds(new Set());
    setSelectedCommentIds(new Set());
    setCommentMenu(undefined);
    commitGraph(deletion.graph);
  }, [commitGraph, graph, selectedCommentIds, selectedLinkIds, selectedNodeIds]);

  const copySelection = useCallback(() => {
    if (!graph || !selectedNodeIds.size) {
      return;
    }
    const nextClipboard = copyGraphSelection(graph, selectedNodeIds);
    if (nextClipboard) {
      setClipboard(nextClipboard);
    }
  }, [graph, selectedNodeIds]);

  const pasteSelection = useCallback(() => {
    if (!graph || !clipboard?.nodes.length) {
      return;
    }
    const pasted = pasteGraphClipboard(graph, clipboard);
    setSelectedNodeIds(pasted.nextSelectedNodeIds);
    commitGraph(pasted.graph);
  }, [clipboard, commitGraph, graph]);

  const duplicateNodeIds = useCallback((targetNodeIds: Set<string>) => {
    if (!graph || !targetNodeIds.size) {
      return;
    }
    const duplicated = duplicateGraphNodes(graph, targetNodeIds);
    if (!duplicated) {
      return;
    }
    setSelectedNodeIds(duplicated.nextSelectedNodeIds);
    setSelectedLinkIds(new Set());
    setSelectedCommentIds(new Set());
    setNodeMenu(undefined);
    commitGraph(duplicated.graph);
  }, [commitGraph, graph]);

  const duplicateSelection = useCallback(() => {
    duplicateNodeIds(selectedNodeIds);
  }, [duplicateNodeIds, selectedNodeIds]);

  const frameSelection = useCallback(() => {
    if (!graph) {
      return;
    }
    const selectedLinkNodeIds = new Set(
      graph.links
        .filter((link) => selectedLinkIds.has(link.id))
        .flatMap((link) => [link.fromNodeId, link.toNodeId])
    );
    const selectedRects = [
      ...graph.nodes
        .filter((node) => selectedNodeIds.has(node.id) || selectedLinkNodeIds.has(node.id))
        .map((node) => nodeBounds(graph, templates, node)),
      ...graphComments(graph)
        .filter((comment) => selectedCommentIds.has(comment.id))
        .map((comment) => ({ x: comment.position.x, y: comment.position.y, width: comment.size.width, height: comment.size.height }))
    ];
    const targetRects = selectedRects.length ? selectedRects : graph.nodes.map((node) => nodeBounds(graph, templates, node));
    if (!targetRects.length) {
      return;
    }
    const bounds = boundsForRects(targetRects);
    const rect = canvasRef.current?.getBoundingClientRect();
    const size = safeCanvasSize(rect, { width: 1, height: 1 });
    commitGraph(withFittedViewport(graph, bounds, size, 96));
  }, [commitGraph, graph, selectedCommentIds, selectedLinkIds, selectedNodeIds, templates]);

  const createCommentBox = useCallback(() => {
    if (!graph) {
      return;
    }

    const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
    const fallback = commentFallbackBounds(graph);
    const targetBounds = selectedNodes.length ? boundsForNodes(graph, templates, selectedNodes) : fallback;
    const result = createGraphCommentBox(graph, targetBounds, selectedNodes.map((node) => node.id), undefined, {
      selection: t("comment.selection"),
      comment: t("comment.fallback")
    });

    setSelectedNodeIds(new Set());
    setSelectedLinkIds(new Set());
    setSelectedCommentIds(new Set([result.comment.id]));
    commitGraph(result.graph);
  }, [commitGraph, graph, selectedNodeIds, t, templates]);

  const collapseSelectionToMacroGraph = useCallback(() => {
    if (!graph || !selectedNodeIds.size) {
      return;
    }
    const macroName = window.prompt(t("prompts.macroName"), t("prompts.collapsedMacroDefault"))?.trim();
    if (!macroName) {
      return;
    }
    const result = collapseSelectionToMacro(graph, selectedNodeIds, macroName, graphTemplates);
    if (!result.ok) {
      setCompileMessage(result.issues.join("\n"));
      return;
    }
    setSelectedNodeIds(new Set([result.macroNodeId]));
    setSelectedLinkIds(new Set());
    setSelectedCommentIds(new Set());
    commitGraph(result.graph);
  }, [commitGraph, graph, graphTemplates, selectedNodeIds, t]);

  const collapseSelectionToFunctionGraph = useCallback(() => {
    if (!graph || !selectedNodeIds.size) {
      return;
    }
    const functionName = window.prompt(t("prompts.functionName"), t("prompts.collapsedFunctionDefault"))?.trim();
    if (!functionName) {
      return;
    }
    const result = collapseSelectionToFunction(graph, selectedNodeIds, functionName, graphTemplates);
    if (!result.ok) {
      setCompileMessage(result.issues.join("\n"));
      return;
    }
    setSelectedNodeIds(new Set([result.functionNodeId]));
    setSelectedLinkIds(new Set());
    setSelectedCommentIds(new Set());
    commitGraph(result.graph);
  }, [commitGraph, graph, graphTemplates, selectedNodeIds, t]);

  const selectedCollapsedTemplate = useMemo(() => {
    if (!graph || selectedNodeIds.size !== 1) {
      return undefined;
    }
    const selectedNode = graph.nodes.find((node) => selectedNodeIds.has(node.id));
    return selectedNode ? graph.localTemplates?.find((template) => template.id === selectedNode.templateId) : undefined;
  }, [graph, selectedNodeIds]);

  const extractSelectedCollapsedUnitToProjectGraph = useCallback(() => {
    if (!selectedCollapsedTemplate) {
      return;
    }
    const graphName = window.prompt(t("prompts.projectGraphName"), selectedCollapsedTemplate.name)?.trim();
    if (!graphName) {
      return;
    }
    hostClient.requestExtractCollapsedUnitToProjectGraph(selectedCollapsedTemplate.id, graphName);
  }, [hostClient, selectedCollapsedTemplate, t]);

  const toggleDisableSelectedNodes = useCallback(() => {
    if (!graph || !selectedNodeIds.size) {
      return;
    }
    const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
    const disable = selectedNodes.some((node) => node.displayOverrides?.disabled !== true);
    commitGraph({
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (!selectedNodeIds.has(node.id)) {
          return node;
        }
        return {
          ...node,
          displayOverrides: {
            ...(node.displayOverrides ?? {}),
            disabled: disable
          }
        };
      })
    });
  }, [commitGraph, graph, selectedNodeIds]);

  const selectedNodesDisabled = graph
    ? graph.nodes.filter((node) => selectedNodeIds.has(node.id)).every((node) => node.displayOverrides?.disabled === true)
    : false;

  const createBookmark = useCallback(() => {
    if (!graph) {
      return;
    }

    const selectedBounds = selectedNode ? nodeBounds(graph, templates, selectedNode) : undefined;
    const rect = canvasRef.current?.getBoundingClientRect();
    const viewport = graph.layout.viewport;
    const size = safeCanvasSize(rect, canvasSize);
    const position = selectedBounds
      ? { x: selectedBounds.x + selectedBounds.width / 2, y: selectedBounds.y + selectedBounds.height / 2 }
      : screenToGraphPoint({ x: (rect?.left ?? 0) + size.width / 2, y: (rect?.top ?? 0) + size.height / 2 }, rect, viewport);
    const label = selectedNode
      ? selectedTemplate?.name ?? selectedNode.id
      : t("bookmark.view", { count: graphBookmarks(graph).length + 1 });
    commitGraph(createGraphBookmark(graph, label, position, selectedNode?.id).graph);
  }, [canvasSize.height, canvasSize.width, commitGraph, graph, selectedNode, selectedTemplate, t, templates]);

  const focusBookmark = useCallback(
    (bookmark: BlueprintBookmark) => {
      if (bookmark.nodeId && graph?.nodes.some((node) => node.id === bookmark.nodeId)) {
        focusNodeById(bookmark.nodeId);
        return;
      }
      centerViewportOnGraphPoint(bookmark.position);
    },
    [centerViewportOnGraphPoint, focusNodeById, graph?.nodes]
  );

  const deleteBookmark = useCallback(
    (bookmarkId: string) => {
      if (!graph) {
        return;
      }
      commitGraph(deleteGraphBookmark(graph, bookmarkId));
    },
    [commitGraph, graph]
  );

  const renameBookmark = useCallback(
    (bookmarkId: string, label: string) => {
      if (!graph) {
        return;
      }
      const next = renameGraphBookmark(graph, bookmarkId, label, t("bookmark.fallback"));
      if (next !== graph) {
        commitGraph(next);
      }
    },
    [commitGraph, graph, t]
  );

  const createBookmarkForNodeId = useCallback(
    (nodeId: string) => {
      if (!graph) {
        return;
      }
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) {
        return;
      }
      const template = getEffectiveTemplateForNode(graph, templates, node);
      const bounds = nodeBounds(graph, templates, node);
      setNodeMenu(undefined);
      commitGraph(createGraphBookmark(graph, template?.name ?? node.id, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, node.id).graph);
    },
    [commitGraph, graph, templates]
  );

  const createBookmarkForCommentId = useCallback(
    (commentId: string) => {
      if (!graph) {
        return;
      }
      const comment = graphComments(graph).find((candidate) => candidate.id === commentId);
      if (!comment) {
        return;
      }
      setCommentMenu(undefined);
      commitGraph(createGraphBookmark(graph, comment.title || t("comment.fallback"), {
        x: comment.position.x + comment.size.width / 2,
        y: comment.position.y + comment.size.height / 2
      }).graph);
    },
    [commitGraph, graph, t]
  );

  const rewrapCommentById = useCallback(
    (commentId: string) => {
      if (!graph) {
        return;
      }
      const comments = graphComments(graph);
      const comment = comments.find((candidate) => candidate.id === commentId);
      if (!comment) {
        return;
      }
      const groupedNodeIds = new Set(comment.nodeIds);
      const groupedNodes = graph.nodes.filter((node) => groupedNodeIds.has(node.id));
      if (!groupedNodes.length) {
        return;
      }

      const nextComment = wrapCommentAroundNodes(graph, templates, comment, groupedNodes);
      setSelectedCommentIds(new Set([commentId]));
      setSelectedNodeIds(new Set());
      setSelectedLinkIds(new Set());
      setCommentMenu(undefined);
      commitGraph(replaceGraphComment(graph, nextComment));
    },
    [commitGraph, graph, templates]
  );

  const insertRoutingHubForLinkIds = useCallback((linkIds: Set<string>) => {
    if (!graph || !linkIds.size) {
      return;
    }

    const selectedLinks = graph.links.filter((link) => linkIds.has(link.id));
    if (!selectedLinks.length) {
      return;
    }

    const midpointsByLinkId = new Map(selectedLinks.map((link) => [link.id, midpointForLink(graph, templates, link)]));
    const result = insertRoutingHubsForLinks(graph, linkIds, {
      controlHubTemplateId,
      dataHubTemplateId,
      hubWidth: HUB_WIDTH,
      hubHeight: HUB_HEIGHT,
      midpointsByLinkId
    });
    if (!result) {
      return;
    }
    setSelectedNodeIds(result.insertedNodeIds);
    setSelectedLinkIds(new Set());
    setWireMenu(undefined);
    commitGraph(result.graph);
  }, [commitGraph, graph, templates]);

  const insertRoutingHub = useCallback(() => {
    insertRoutingHubForLinkIds(selectedLinkIds);
  }, [insertRoutingHubForLinkIds, selectedLinkIds]);

  const cleanupSelectedRoutingHubs = useCallback(() => {
    if (!graph || !selectedNodeIds.size) {
      return;
    }

    const result = cleanupRoutingHubs(graph, {
      selectedNodeIds,
      isRoutingHubNode,
      createDirectLink: ({ incoming, outgoing }) => {
        const sourcePort = resolvePort(graph, templates, {
          nodeId: incoming.fromNodeId,
          portId: incoming.fromPortId,
          direction: "output",
          flowKind: incoming.flowKind,
          type: "unknown"
        });
        const targetPort = resolvePort(graph, templates, {
          nodeId: outgoing.toNodeId,
          portId: outgoing.toPortId,
          direction: "input",
          flowKind: outgoing.flowKind,
          type: "unknown"
        });
        if (!sourcePort || !targetPort) {
          return undefined;
        }
        return createLinkBetweenExistingPorts(
          graph,
          templates,
          {
            nodeId: incoming.fromNodeId,
            portId: incoming.fromPortId,
            direction: "output",
            flowKind: incoming.flowKind,
            type: sourcePort.type
          },
          {
            nodeId: outgoing.toNodeId,
            portId: outgoing.toPortId,
            direction: "input",
            flowKind: outgoing.flowKind,
            type: targetPort.type
          }
        );
      }
    });
    if (!result) {
      return;
    }

    setSelectedNodeIds(new Set());
    setSelectedCommentIds(new Set());
    setSelectedLinkIds(result.selectedLinkIds);
    commitGraph(result.graph);
  }, [commitGraph, graph, selectedNodeIds, templates]);

  const alignSelection = useCallback(
    (mode: AlignMode) => {
      if (!graph || selectedNodeIds.size < 2) {
        return;
      }

      const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
      const bounds = selectedNodes.map((node) => {
        const bounds = nodeBounds(graph, templates, node);
        return { nodeId: node.id, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      });
      const next = alignGraphNodes(graph, bounds, mode);
      if (next) {
        commitGraph(next);
      }
    },
    [commitGraph, graph, selectedNodeIds, templates]
  );

  const distributeSelection = useCallback(
    (mode: DistributeMode) => {
      if (!graph || selectedNodeIds.size < 3) {
        return;
      }

      const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
      const bounds = selectedNodes.map((node) => {
        const bounds = nodeBounds(graph, templates, node);
        return { nodeId: node.id, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      });
      const next = distributeGraphNodes(graph, bounds, mode);
      if (next) {
        commitGraph(next);
      }
    },
    [commitGraph, graph, selectedNodeIds, templates]
  );

  const requestCompile = () => {
    if (graph) {
      hostClient.requestCompileGraph(graph);
    }
  };

  const requestRun = () => {
    if (graph) {
      const runId = `run-${Date.now().toString(36)}`;
      activeRuntimeRunIdRef.current = runId;
      setIsRuntimeRunning(true);
      setRuntimeQueueStatus({ running: true, queuedRuns: 0 });
      setRuntimeNodeStatus(new Map());
      setRuntimeOutput(undefined);
      setActiveRuntimeTraceIndex(undefined);
      hostClient.requestRunGraph(graph, { runId, breakpoints: breakpointsForRun(graph, breakpoints) });
    }
  };

  const requestStepRun = () => {
    if (graph) {
      const runId = `run-${Date.now().toString(36)}`;
      activeRuntimeRunIdRef.current = runId;
      setIsRuntimeRunning(true);
      setRuntimeQueueStatus({ running: true, queuedRuns: 0 });
      setRuntimeNodeStatus(new Map());
      setRuntimeOutput(undefined);
      setActiveRuntimeTraceIndex(undefined);
      hostClient.requestRunGraph(graph, { runId, breakpoints: breakpointsForRun(graph, breakpoints), stepMode: true });
    }
  };

  const requestRuntimeStep = () => {
    hostClient.requestRuntimeStep();
  };

  const requestRuntimeContinue = () => {
    hostClient.requestRuntimeContinue();
  };

  const requestCancelRun = () => {
    setIsRuntimeRunning(false);
    setRuntimeQueueStatus({ running: false, queuedRuns: 0 });
    hostClient.requestCancelRun();
  };

  const toggleBreakpointForNodeId = (nodeId: string | undefined) => {
    if (!nodeId) {
      return;
    }
    const exists = breakpoints.some((breakpoint) => breakpoint.nodeId === nodeId);
    const next = exists
      ? breakpoints.filter((breakpoint) => breakpoint.nodeId !== nodeId)
      : [...breakpoints, { nodeId }];
    setNodeMenu(undefined);
    persistBreakpoints(next, { commitToGraph: true });
  };

  const setBreakpointCondition = (nodeId: string, condition: string, options: { commitToGraph?: boolean } = {}) => {
    const normalized = condition.trim();
    const next = breakpoints.some((breakpoint) => breakpoint.nodeId === nodeId)
      ? breakpoints.map((breakpoint) => breakpoint.nodeId === nodeId ? { ...breakpoint, condition: normalized || undefined } : breakpoint)
      : [...breakpoints, { nodeId, condition: normalized || undefined }];
    persistBreakpoints(next, options);
  };

  const toggleBreakpointEnabled = (nodeId: string) => {
    const next = breakpoints.map((breakpoint) => breakpoint.nodeId === nodeId
      ? { ...breakpoint, enabled: breakpoint.enabled === false ? true : false }
      : breakpoint);
    persistBreakpoints(next, { commitToGraph: true });
  };

  const toggleBreakpoint = () => {
    toggleBreakpointForNodeId(selectedNodeId);
  };

  const clearBreakpoint = (nodeId: string) => {
    const next = breakpoints.filter((breakpoint) => breakpoint.nodeId !== nodeId);
    persistBreakpoints(next, { commitToGraph: true });
  };

  const focusBreakpoint = (nodeId: string) => {
    focusNodeById(nodeId);
  };

  const selectRuntimeHistory = (entry: RuntimeHistoryEntry) => {
    setRuntimeOutput(entry);
    setActiveRuntimeTraceIndex(entry.traces.length ? 0 : undefined);
    setRuntimeNodeStatus(runtimeStatusByNodeId(graph?.id, entry.traces));
    persistRuntimeHistoryState(runtimeHistory, entry.id);
  };

  const renameRuntimeHistory = (entry: RuntimeHistoryEntry) => {
    const nextLabel = window.prompt(t("prompts.runLabel"), entry.label ?? "");
    if (nextLabel === null) {
      return;
    }
    const label = nextLabel.trim() || undefined;
    const nextHistory = runtimeHistory.map((candidate) => (candidate.id === entry.id ? { ...candidate, label } : candidate));
    setRuntimeHistory(nextHistory);
    setRuntimeOutput((current) => (current?.id === entry.id ? { ...current, label } : current));
    persistRuntimeHistoryState(nextHistory, runtimeOutput?.id ?? entry.id);
  };

  const toggleRuntimeHistoryPin = (entry: RuntimeHistoryEntry) => {
    const nextHistory = runtimeHistory.map((candidate) => (candidate.id === entry.id ? { ...candidate, pinned: !candidate.pinned } : candidate));
    setRuntimeHistory(nextHistory);
    setRuntimeOutput((current) => (current?.id === entry.id ? { ...current, pinned: !entry.pinned } : current));
    persistRuntimeHistoryState(nextHistory, runtimeOutput?.id);
  };

  const deleteRuntimeHistory = (entry: RuntimeHistoryEntry) => {
    const nextHistory = runtimeHistory.filter((candidate) => candidate.id !== entry.id);
    const nextActive = runtimeOutput?.id === entry.id ? nextHistory[0] : runtimeOutput;
    setRuntimeHistory(nextHistory);
    setRuntimeOutput(nextActive);
    setActiveRuntimeTraceIndex(nextActive?.traces.length ? 0 : undefined);
    setRuntimeNodeStatus(runtimeStatusByNodeId(graph?.id, nextActive?.traces ?? []));
    persistRuntimeHistoryState(nextHistory, nextActive?.id);
  };

  const clearRuntimeHistory = () => {
    setRuntimeHistory([]);
    setRuntimeOutput(undefined);
    setActiveRuntimeTraceIndex(undefined);
    setRuntimeNodeStatus(new Map());
    persistRuntimeHistoryState([], undefined);
  };

  const selectRuntimeTraceStep = (index: number) => {
    if (!runtimeOutput?.traces.length) {
      return;
    }
    const safeIndex = clamp(Math.round(index), 0, runtimeOutput.traces.length - 1);
    const trace = runtimeOutput.traces[safeIndex];
    setActiveRuntimeTraceIndex(safeIndex);
    setRuntimeNodeStatus(runtimeStatusByNodeId(graph?.id, runtimeOutput.traces, trace));
    if (graph?.id && trace.graphId !== graph.id) {
      return;
    }
    if (graph?.nodes.some((node) => node.id === trace.nodeId)) {
      setSelectedNodeIds(new Set([trace.nodeId]));
      setSelectedLinkIds(new Set());
      setSelectedCommentIds(new Set());
    }
  };

  const autoLayout = () => {
    if (!graph) {
      return;
    }

    const next = applyAutoLayout(graph, templates);
    setSelectedNodeIds((current) => {
      const retained = [...current].filter((nodeId) => next.nodes.some((node) => node.id === nodeId));
      return new Set(retained.length ? retained : next.nodes[0]?.id ? [next.nodes[0].id] : []);
    });
    commitGraph(next);
  };

  if (!graph) {
    return (
      <div className="loading">
        <div className="loading-panel">
          <div>{t("loading.graph")}</div>
          {loadingTimedOut ? (
            <button className="tool-button" onClick={() => {
              setLoadingTimedOut(false);
              hostClient.notifyReady();
            }}>
              <RotateCcw size={16} /> {t("loading.retry")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const breakpointNodes = graph.nodes.filter((node) => breakpointNodeIds.has(node.id));
  const bookmarks = graphBookmarks(graph);
  const viewport = graph.layout.viewport;
  const linksVisible = linkRenderMode !== "hidden";
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const runtimeActionState = runtimeSurfaceState(isRuntimeRunning, runtimeQueueStatus.queuedRuns, runtimeNodeStatus, runtimeOutput);
  const runtimeProgressCount = isRuntimeRunning ? runtimeNodeStatus.size : 0;
  const canAlignSelection = selectedNodeIds.size >= 2;
  const canDistributeSelection = selectedNodeIds.size >= 3;
  const selectedNodeLinkCount = incidentLinkIds(graph, selectedNodeIds).size;
  const canCleanupRoutingHubs = graph.nodes.some((node) => selectedNodeIds.has(node.id) && isRoutingHubNode(node));
  const canCollapseSelectionToMacro = selectedNodeIds.size > 0;
  const canCollapseSelectionToFunction = selectedNodeIds.size > 0;
  const canExtractCollapsedUnitToProjectGraph = Boolean(selectedCollapsedTemplate);
  const canToggleDisableSelection = selectedNodeIds.size > 0;
  const portMenuTarget = portMenu ? resolvePortMenuTarget(graph, templates, portMenu) : undefined;
  const portMenuLinkCount = portMenuTarget ? linkIdsForPort(graph, portMenuTarget.node.id, portMenuTarget.port).size : 0;
  const selectionBounds = selectionBoundsForGraph(graph, templates, selectedNodeIds, selectedCommentIds, selectedLinkIds);
  const selectionToolboxTopLimit = actionBarPlacement === "top" ? 126 : 96;
  const selectionToolboxBottomReserve = Math.max(
    224,
    actionBarPlacement === "bottom" ? 118 : 64,
    minimapVisible ? 168 : 64
  );
  const selectionToolboxPosition = selectionBounds
    ? (() => {
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        const canvasLeft = canvasRect?.left ?? 0;
        const canvasTop = canvasRect?.top ?? 0;
        const canvasWidth = canvasRect?.width ?? canvasSize.width;
        const canvasHeight = canvasRect?.height ?? canvasSize.height;
        const viewportWidth = typeof window === "undefined" ? canvasLeft + canvasWidth : window.innerWidth;
        const viewportHeight = typeof window === "undefined" ? canvasTop + canvasHeight : window.innerHeight;
        const selectionTop = selectionBounds.y * viewport.zoom + viewport.y;
        const selectionHeight = selectionBounds.height * viewport.zoom;
        const preferredY = selectionTop - 48;
        const fallbackBelowY = selectionTop + selectionHeight + 10;
        const toolboxWidth = 350;
        const toolboxHeight = 44;
        const actionBarRect = typeof document === "undefined" ? undefined : document.querySelector(".run-actionbar")?.getBoundingClientRect();
        const minimapRect = typeof document === "undefined" ? undefined : document.querySelector(".minimap")?.getBoundingClientRect();
        const actionBarAvoidanceMaxY = actionBarPlacement === "bottom" && actionBarRect
          ? actionBarRect.top - 8 - toolboxHeight
          : Number.POSITIVE_INFINITY;
        const minimapAvoidanceMaxX = minimapVisible && minimapRect ? minimapRect.left - 8 - toolboxWidth : Number.POSITIVE_INFINITY;
        const maxToolboxX = Math.min(viewportWidth - toolboxWidth, canvasLeft + canvasWidth - toolboxWidth, minimapAvoidanceMaxX);
        const maxToolboxY = Math.min(viewportHeight - toolboxHeight, canvasTop + canvasHeight - selectionToolboxBottomReserve, actionBarAvoidanceMaxY);
        return {
          x: clamp(
            canvasLeft + selectionBounds.x * viewport.zoom + viewport.x + selectionBounds.width * viewport.zoom / 2 - toolboxWidth / 2,
            Math.max(12, canvasLeft + 12),
            Math.max(Math.max(12, canvasLeft + 12), maxToolboxX)
          ),
          y: clamp(
            canvasTop + (preferredY < selectionToolboxTopLimit ? fallbackBelowY : preferredY),
            Math.max(12, canvasTop + selectionToolboxTopLimit),
            Math.max(Math.max(12, canvasTop + selectionToolboxTopLimit), maxToolboxY)
          )
        };
      })()
    : undefined;
  const visibleCanvasNodes = visibleNodesForCanvas(graph, templates, viewport, canvasSize, selectedNodeIds, runtimeNodeStatus, focusedIssueKey, issues);
  const visibleCanvasLinks = visibleLinksForCanvas(graph, templates, viewport, canvasSize, selectedNodeIds, selectedLinkIds, runtimeNodeStatus, focusedIssueKey, issues);
  const commandCategories = {
    workbench: t("commands.category.workbench"),
    graph: t("commands.category.graph"),
    edit: t("commands.category.edit"),
    view: t("commands.category.view"),
    layout: t("commands.category.layout"),
    run: t("commands.category.run"),
    debug: t("commands.category.debug")
  };
  const baseEditorCommands = [
    {
      id: "workbench.commandPalette",
      title: t("commands.workbench.commandPalette"),
      category: commandCategories.workbench,
      shortcut: "Ctrl+K",
      alternateShortcuts: ["Ctrl+Shift+P"],
      run: () => setCommandPaletteOpen(true),
      keywords: ["search", "commands"]
    },
    {
      id: "workbench.toggleLeftPanel",
      title: leftPanelOpen ? t("commands.workbench.hideSidebar") : t("commands.workbench.showSidebar"),
      category: commandCategories.workbench,
      shortcut: "Ctrl+1",
      run: () => setLeftPanelOpen((current) => !current),
      keywords: ["dock", "sidebar", "outline"]
    },
    {
      id: "workbench.toggleRightPanel",
      title: rightPanelOpen ? t("commands.workbench.hideInspector") : t("commands.workbench.showInspector"),
      category: commandCategories.workbench,
      shortcut: "Ctrl+2",
      run: () => setRightPanelOpen((current) => !current),
      keywords: ["dock", "inspector"]
    },
    {
      id: "workbench.toggleBottomPanel",
      title: bottomPanelOpen ? t("commands.workbench.collapseLogs") : t("commands.workbench.expandLogs"),
      category: commandCategories.workbench,
      shortcut: "Ctrl+`",
      alternateShortcuts: ["Ctrl+3"],
      run: () => setBottomPanelOpen((current) => !current),
      keywords: ["terminal", "logs", "output"]
    },
    {
      id: "workbench.editorSettings",
      title: t("commands.workbench.prefsPanel"),
      category: commandCategories.workbench,
      run: () => {
        setTemplateRegistryOpen(false);
        setToolbarOverflowOpen(false);
        setEditorSettingsOpen(true);
        dispatchCanvasInteraction({ type: "openMenu", menu: "settings" });
      },
      keywords: ["preferences", "grid", "snap", "actionbar"]
    },
    {
      id: "workbench.templateRegistry",
      title: t("commands.workbench.templateRegistry"),
      category: commandCategories.workbench,
      run: () => {
        setEditorSettingsOpen(false);
        setToolbarOverflowOpen(false);
        setTemplateRegistryOpen(true);
        dispatchCanvasInteraction({ type: "openMenu", menu: "templateRegistry" });
      },
      keywords: ["templates", "packages", "nodes", "registry"]
    },
    {
      id: "graph.addNode",
      title: t("commands.graph.addNode"),
      category: commandCategories.graph,
      shortcut: "A",
      run: () => setNodePanel({ open: true, screen: { x: 280, y: 120 }, graph: maybeSnapPoint(screenToGraph(280, 120)) }),
      keywords: ["palette", "create"]
    },
    {
      id: "graph.findNode",
      title: t("commands.graph.findNode"),
      category: commandCategories.graph,
      shortcut: "Ctrl+F",
      run: openNodeFindDialog,
      keywords: ["search", "outline"]
    },
    { id: "graph.undo", title: t("commands.graph.undo"), category: commandCategories.edit, shortcut: "Ctrl+Z", run: undoGraph, disabled: !nativeUndoRedo && !history.past.length },
    { id: "graph.redo", title: t("commands.graph.redo"), category: commandCategories.edit, shortcut: "Ctrl+Shift+Z", alternateShortcuts: ["Ctrl+Y"], run: redoGraph, disabled: !nativeUndoRedo && !history.future.length },
    { id: "graph.copy", title: t("commands.graph.copySelection"), category: commandCategories.edit, shortcut: "Ctrl+C", run: copySelection, disabled: !selectedNodeIds.size && !selectedCommentIds.size },
    { id: "graph.paste", title: t("commands.graph.pasteSelection"), category: commandCategories.edit, shortcut: "Ctrl+V", run: pasteSelection, disabled: !clipboard },
    { id: "graph.duplicate", title: t("commands.graph.duplicateSelection"), category: commandCategories.edit, shortcut: "Ctrl+D", run: duplicateSelection, disabled: !selectedNodeIds.size && !selectedCommentIds.size },
    { id: "graph.delete", title: t("commands.graph.deleteSelection"), category: commandCategories.edit, shortcut: "Delete", alternateShortcuts: ["Backspace"], run: deleteSelection, disabled: !selectedNodeIds.size && !selectedLinkIds.size && !selectedCommentIds.size },
    { id: "graph.frameSelection", title: t("commands.graph.frameSelection"), category: commandCategories.view, shortcut: "F", run: frameSelection, disabled: !selectedNodeIds.size && !selectedLinkIds.size && !selectedCommentIds.size },
    { id: "graph.autoLayout", title: t("commands.graph.autoLayout"), category: commandCategories.graph, run: autoLayout, disabled: !graph.nodes.length },
    { id: "graph.collapseSelectionToMacro", title: t("commands.graph.collapseSelectionToMacro"), category: commandCategories.graph, run: collapseSelectionToMacroGraph, disabled: !canCollapseSelectionToMacro },
    { id: "graph.collapseSelectionToFunction", title: t("commands.graph.collapseSelectionToFunction"), category: commandCategories.graph, run: collapseSelectionToFunctionGraph, disabled: !canCollapseSelectionToFunction },
    { id: "graph.extractCollapsedUnitToProjectGraph", title: t("commands.graph.extractCollapsedUnit"), category: commandCategories.graph, run: extractSelectedCollapsedUnitToProjectGraph, disabled: !canExtractCollapsedUnitToProjectGraph },
    { id: "graph.insertRoutingHub", title: t("commands.graph.insertRoutingHub"), category: commandCategories.graph, run: insertRoutingHub, disabled: !selectedLinkIds.size },
    { id: "graph.cleanupRoutingHubs", title: t("commands.graph.cleanupRoutingHubs"), category: commandCategories.graph, run: cleanupSelectedRoutingHubs, disabled: !canCleanupRoutingHubs },
    { id: "graph.breakSelectedLinks", title: t("commands.graph.breakSelectedLinks"), category: commandCategories.graph, run: breakLinksForSelection, disabled: !selectedNodeLinkCount },
    { id: "graph.createComment", title: t("commands.graph.createCommentBox"), category: commandCategories.graph, run: createCommentBox },
    { id: "graph.addBookmark", title: t("commands.graph.addBookmark"), category: commandCategories.graph, run: createBookmark },
    { id: "graph.alignLeft", title: t("commands.graph.alignLeft"), category: commandCategories.layout, run: () => alignSelection("left"), disabled: !canAlignSelection },
    { id: "graph.alignRight", title: t("commands.graph.alignRight"), category: commandCategories.layout, run: () => alignSelection("right"), disabled: !canAlignSelection },
    { id: "graph.alignTop", title: t("commands.graph.alignTop"), category: commandCategories.layout, run: () => alignSelection("top"), disabled: !canAlignSelection },
    { id: "graph.alignBottom", title: t("commands.graph.alignBottom"), category: commandCategories.layout, run: () => alignSelection("bottom"), disabled: !canAlignSelection },
    { id: "graph.distributeHorizontal", title: t("commands.graph.distributeHorizontal"), category: commandCategories.layout, run: () => distributeSelection("horizontal"), disabled: !canDistributeSelection },
    { id: "graph.distributeVertical", title: t("commands.graph.distributeVertical"), category: commandCategories.layout, run: () => distributeSelection("vertical"), disabled: !canDistributeSelection },
    { id: "runtime.compile", title: t("commands.runtime.compile"), category: commandCategories.run, shortcut: "Ctrl+Shift+B", run: requestCompile },
    { id: "runtime.run", title: isRuntimeRunning ? t("commands.runtime.cancelRun") : t("commands.runtime.runGraph"), category: commandCategories.run, shortcut: "Ctrl+Enter", run: isRuntimeRunning ? requestCancelRun : requestRun },
    { id: "runtime.stepRun", title: isRuntimeRunning ? t("commands.runtime.stepRuntime") : t("commands.runtime.stepRun"), category: commandCategories.run, shortcut: "Ctrl+Shift+Enter", run: isRuntimeRunning ? requestRuntimeStep : requestStepRun },
    { id: "runtime.continue", title: t("commands.runtime.continue"), category: commandCategories.run, run: requestRuntimeContinue, disabled: !isRuntimeRunning },
    { id: "runtime.toggleBreakpoint", title: t("commands.runtime.toggleBreakpoint"), category: commandCategories.debug, run: toggleBreakpoint, disabled: !selectedNodeId },
    { id: "graph.validate", title: t("commands.runtime.validate"), category: commandCategories.run, run: () => hostClient.requestValidation(graph) }
  ] satisfies EditorCommand[];
  const editorCommands = applyShortcutPrefs(baseEditorCommands, editorPrefs.shortcuts);
  editorCommandsRef.current = editorCommands;
  const shellClassName = [
    "shell",
    themeClassName(editorPrefs.theme),
    externalDockPanels ? "external-dock-panels" : "",
    leftPanelOpen ? "" : "left-collapsed",
    rightPanelOpen ? "" : "right-collapsed",
    bottomPanelOpen ? "" : "bottom-collapsed"
  ].filter(Boolean).join(" ");
  const shellStyle = {
    ...themeStyle(editorPrefs.theme, editorPrefs.customTheme),
    "--left-panel-width": externalDockPanels ? "0px" : leftPanelOpen ? `${panelSizes.left}px` : "48px",
    "--right-panel-width": externalDockPanels ? "0px" : rightPanelOpen ? `${panelSizes.right}px` : "48px",
    "--bottom-panel-height": bottomPanelOpen ? `${panelSizes.bottom}px` : "34px",
    "--left-splitter-width": externalDockPanels ? "0px" : leftPanelOpen ? "6px" : "0px",
    "--right-splitter-width": externalDockPanels ? "0px" : rightPanelOpen ? "6px" : "0px",
    "--bottom-splitter-height": bottomPanelOpen ? "6px" : "0px"
  } as CSSProperties;
  const outputStatus = <strong className="run-panel-title">{t("runPanel.logs")}</strong>;
  const outputSummary = (
    <DiagnosticStrip
      issues={issues}
      focusedIssueKey={focusedIssueKey}
      compileMessage={compileMessage}
      refactorResult={refactorResult}
      runtimeOutput={runtimeOutput}
      runtimeHistory={runtimeHistory}
      activeRuntimeTraceIndex={activeRuntimeTraceIndex}
      t={t}
      traceLabel={runtimeTraceLabeler(graph, graphTemplates, editorPrefs.language, editorPrefs.nodeLabelMode)}
      onIssueFocus={focusIssue}
      onRuntimeHistorySelect={selectRuntimeHistory}
      onRuntimeHistoryRename={renameRuntimeHistory}
      onRuntimeHistoryPin={toggleRuntimeHistoryPin}
      onRuntimeHistoryDelete={deleteRuntimeHistory}
      onRuntimeHistoryClear={clearRuntimeHistory}
      onRuntimeTraceStep={selectRuntimeTraceStep}
    />
  );
  const outputDetails = (
    <>
      {runtimeOutput ? (
        <pre className={runtimeOutput.ok ? "run-log ok" : "run-log error"}>{runtimeOutput.text || runtimeOutput.message}</pre>
      ) : issues.length ? (
        <RunLogIssueList issues={issues} t={t} onIssueFocus={focusIssue} />
      ) : (
        <pre className="run-log">{compileMessage || t("common.ready")}</pre>
      )}
    </>
  );
  const toolbarOverflowActions: ToolbarOverflowAction[] = [
    { id: "compile", title: t("commands.runtime.compile"), section: t("toolbarOverflow.quick"), tier: "secondary", icon: <TerminalSquare size={14} />, run: requestCompile },
    { id: "validate", title: t("commands.runtime.validate"), section: t("toolbarOverflow.quick"), tier: "secondary", icon: <CheckCircle2 size={14} />, run: () => hostClient.requestValidation(graph) },
    {
      id: "findNode",
      title: t("commands.graph.findNode"),
      section: t("toolbarOverflow.quick"),
      tier: "secondary",
      icon: <Search size={14} />,
      run: openNodeFindDialog
    },
    { id: "templateRegistry", title: t("toolbar.templateRegistry"), section: t("toolbarOverflow.quick"), tier: "secondary", icon: <PackageIcon size={14} />, run: () => {
      setEditorSettingsOpen(false);
      setToolbarOverflowOpen(false);
      setTemplateRegistryOpen(true);
      dispatchCanvasInteraction({ type: "openMenu", menu: "templateRegistry" });
    } },
    { id: "zoomOut", title: t("canvasCommands.zoomOut"), section: t("toolbarOverflow.quick"), tier: "secondary", icon: <ZoomOut size={14} />, run: () => zoomViewportAtCanvasCenter(viewport.zoom / 1.15), disabled: viewportLocked },
    { id: "zoomIn", title: t("canvasCommands.zoomIn"), section: t("toolbarOverflow.quick"), tier: "secondary", icon: <ZoomIn size={14} />, run: () => zoomViewportAtCanvasCenter(viewport.zoom * 1.15), disabled: viewportLocked },
    { id: "linkMode", title: t("canvasCommands.linkMode", { mode: t(`linkRenderMode.${linkRenderMode}`) }), section: t("toolbarOverflow.quick"), tier: "secondary", icon: <Route size={14} />, run: () => updateEditorPrefs({ linkRenderMode: nextLinkRenderMode(linkRenderMode) }) },
    { id: "viewportLock", title: viewportLocked ? t("canvasCommands.unlockViewport") : t("canvasCommands.lockViewport"), section: t("toolbarOverflow.quick"), tier: "secondary", icon: viewportLocked ? <Lock size={14} /> : <Unlock size={14} />, run: () => setViewportLocked((current) => !current) },
    { id: "frameSelection", title: t("commands.graph.frameSelection"), section: t("toolbarOverflow.quick"), tier: "secondary", icon: <Focus size={14} />, run: frameSelection, disabled: !selectedNodeIds.size && !selectedLinkIds.size && !selectedCommentIds.size },
    { id: "duplicateSelection", title: t("commands.graph.duplicateSelection"), section: t("toolbarOverflow.quick"), tier: "secondary", icon: <Copy size={14} />, run: duplicateSelection, disabled: !selectedNodeIds.size },
    { id: "autoLayout", title: t("commands.graph.autoLayout"), section: t("toolbarOverflow.graphFlow"), tier: "secondary", icon: <Workflow size={14} />, run: autoLayout, disabled: !graph.nodes.length },
    { id: "insertRoutingHub", title: t("commands.graph.insertRoutingHub"), section: t("toolbarOverflow.graphFlow"), tier: "secondary", icon: <Route size={14} />, run: insertRoutingHub, disabled: !selectedLinkIds.size },
    { id: "cleanupRoutingHubs", title: t("commands.graph.cleanupRoutingHubs"), section: t("toolbarOverflow.graphFlow"), tier: "secondary", icon: <RouteOff size={14} />, run: cleanupSelectedRoutingHubs, disabled: !canCleanupRoutingHubs },
    { id: "breakLinks", title: t("commands.graph.breakSelectedLinks"), section: t("toolbarOverflow.graphFlow"), tier: "secondary", icon: <Unlink size={14} />, run: breakLinksForSelection, disabled: !selectedNodeLinkCount },
    { id: "createComment", title: t("commands.graph.createCommentBox"), section: t("toolbarOverflow.graphFlow"), tier: "secondary", icon: <StickyNote size={14} />, run: createCommentBox },
    { id: "addBookmark", title: t("commands.graph.addBookmark"), section: t("toolbarOverflow.graphFlow"), tier: "secondary", icon: <BookmarkPlus size={14} />, run: createBookmark },
    { id: "collapseSelectionToMacro", title: t("commands.graph.collapseSelectionToMacro"), section: t("toolbarOverflow.refactor"), tier: "overflow", icon: <PackageIcon size={14} />, run: collapseSelectionToMacroGraph, disabled: !canCollapseSelectionToMacro },
    { id: "collapseSelectionToFunction", title: t("commands.graph.collapseSelectionToFunction"), section: t("toolbarOverflow.refactor"), tier: "overflow", icon: <GitBranch size={14} />, run: collapseSelectionToFunctionGraph, disabled: !canCollapseSelectionToFunction },
    { id: "extractCollapsedUnit", title: t("commands.graph.extractCollapsedUnit"), section: t("toolbarOverflow.refactor"), tier: "overflow", icon: <PackageIcon size={14} />, run: extractSelectedCollapsedUnitToProjectGraph, disabled: !canExtractCollapsedUnitToProjectGraph },
    { id: "alignLeft", title: t("commands.graph.alignLeft"), section: t("toolbarOverflow.layout"), tier: "overflow", icon: <AlignStartVertical size={14} />, run: () => alignSelection("left"), disabled: !canAlignSelection },
    { id: "alignRight", title: t("commands.graph.alignRight"), section: t("toolbarOverflow.layout"), tier: "overflow", icon: <AlignEndVertical size={14} />, run: () => alignSelection("right"), disabled: !canAlignSelection },
    { id: "alignTop", title: t("commands.graph.alignTop"), section: t("toolbarOverflow.layout"), tier: "overflow", icon: <AlignStartHorizontal size={14} />, run: () => alignSelection("top"), disabled: !canAlignSelection },
    { id: "alignBottom", title: t("commands.graph.alignBottom"), section: t("toolbarOverflow.layout"), tier: "overflow", icon: <AlignEndHorizontal size={14} />, run: () => alignSelection("bottom"), disabled: !canAlignSelection },
    { id: "distributeHorizontal", title: t("commands.graph.distributeHorizontal"), section: t("toolbarOverflow.layout"), tier: "overflow", icon: <AlignHorizontalSpaceBetween size={14} />, run: () => distributeSelection("horizontal"), disabled: !canDistributeSelection },
    { id: "distributeVertical", title: t("commands.graph.distributeVertical"), section: t("toolbarOverflow.layout"), tier: "overflow", icon: <AlignVerticalSpaceBetween size={14} />, run: () => distributeSelection("vertical"), disabled: !canDistributeSelection }
  ];
  const visibleMainToolbarActions = new Set(editorPrefs.mainToolbarActions);
  const overflowActionById = new Map(toolbarOverflowActions.map((action) => [action.id, action]));
  const mainToolbarActionVisible = (id: MainToolbarActionId): boolean => visibleMainToolbarActions.has(id);
  const promotedActionButton = (id: string): JSX.Element | null => {
    const action = overflowActionById.get(id);
    if (!action) {
      return null;
    }
    return (
      <button key={id} className="icon-button" title={action.title} onClick={action.run} disabled={action.disabled}>
        {action.icon}
      </button>
    );
  };
  const primaryToolbarItems = [
    mainToolbarActionVisible("commandPalette") ? <button key="commandPalette" className="icon-button" title={t("toolbar.commandPalette")} onClick={() => setCommandPaletteOpen(true)}><Command size={16} /></button> : null,
    mainToolbarActionVisible("compile") ? promotedActionButton("compile") : null,
    mainToolbarActionVisible("validate") ? promotedActionButton("validate") : null,
    mainToolbarActionVisible("findNode") ? promotedActionButton("findNode") : null,
    mainToolbarActionVisible("fitGraph") ? <button key="fitGraph" className="icon-button" title={t("canvasCommands.fitGraph")} onClick={fitGraphToCanvas} disabled={viewportLocked}><Focus size={16} /></button> : null,
    mainToolbarActionVisible("resetZoom") ? <button key="resetZoom" className="icon-button text-button" title={t("canvasCommands.resetZoom")} onClick={() => zoomViewportAtCanvasCenter(1)} disabled={viewportLocked}>{Math.round(viewport.zoom * 100)}%</button> : null
  ].filter(Boolean);
  const viewToolbarItems = [
    mainToolbarActionVisible("minimap") ? <button key="minimap" className={minimapVisible ? "icon-button active" : "icon-button"} title={minimapVisible ? t("canvasCommands.hideMinimap") : t("canvasCommands.showMinimap")} onClick={() => updateEditorPrefs({ minimapVisible: !minimapVisible })}><MapIcon size={16} /></button> : null,
    mainToolbarActionVisible("links") ? <button key="links" className={linksVisible ? "icon-button active" : "icon-button"} title={linksVisible ? t("canvasCommands.hideLinks") : t("canvasCommands.showLinks")} onClick={() => updateEditorPrefs({ linkRenderMode: linkRenderMode === "hidden" ? "spline" : "hidden" })}>{linksVisible ? <Eye size={16} /> : <EyeOff size={16} />}</button> : null,
    mainToolbarActionVisible("templateRegistry") ? promotedActionButton("templateRegistry") : null,
    mainToolbarActionVisible("prefsPanel") ? (
      <button key="prefsPanel" className={editorSettingsOpen ? "icon-button active" : "icon-button"} title={t("toolbar.prefsPanel")} onClick={() => {
        setToolbarOverflowOpen(false);
        setTemplateRegistryOpen(false);
        setEditorSettingsOpen(!editorSettingsOpen);
        dispatchCanvasInteraction(editorSettingsOpen ? { type: "cancel" } : { type: "openMenu", menu: "settings" });
      }}><Settings size={16} /></button>
    ) : null,
    mainToolbarActionVisible("overflow") ? (
      <button key="overflow" className={toolbarOverflowOpen ? "icon-button active" : "icon-button"} title={t("toolbar.overflow")} onClick={() => {
        setEditorSettingsOpen(false);
        setTemplateRegistryOpen(false);
        setToolbarOverflowOpen(!toolbarOverflowOpen);
        dispatchCanvasInteraction(toolbarOverflowOpen ? { type: "cancel" } : { type: "openMenu", menu: "toolbar" });
      }}><MoreHorizontal size={16} /></button>
    ) : null
  ].filter(Boolean);
  const runToolbarItems = [
    mainToolbarActionVisible("run") ? (
      <button key="run" className={isRuntimeRunning ? "icon-button toolbar-run-main warning" : "icon-button toolbar-run-main"} title={isRuntimeRunning ? t("toolbar.cancelRun") : t("toolbar.runGraph")} onClick={isRuntimeRunning ? requestCancelRun : requestRun}>
        {isRuntimeRunning ? <Square size={16} /> : <Play size={18} />}
        <span>{isRuntimeRunning ? t("toolbar.cancelRun") : t("toolbar.runGraph")}</span>
      </button>
    ) : null,
    mainToolbarActionVisible("stepRun") ? <button key="stepRun" className="icon-button toolbar-run-step" title={isRuntimeRunning ? t("toolbar.stepRuntime") : t("toolbar.stepRun")} onClick={isRuntimeRunning ? requestRuntimeStep : requestStepRun}><StepForward size={16} /></button> : null,
    isRuntimeRunning && mainToolbarActionVisible("stepRun") ? <button key="continueRuntime" className="icon-button toolbar-run-step" title={t("toolbar.continueRuntime")} onClick={requestRuntimeContinue}><Play size={16} /></button> : null
  ].filter(Boolean);

  return (
    <div className={shellClassName} style={shellStyle} ref={shellRef}>
      {externalDockPanels ? null : (
      <BlueprintSidebar
        open={leftPanelOpen}
        graph={graph}
        t={t}
        locale={editorPrefs.language}
        nodeLabelMode={editorPrefs.nodeLabelMode}
        solution={solutionOutline}
        solutionGraphIndex={solutionGraphIndex}
        templates={graphTemplates}
        breakpoints={breakpoints}
        nodeFindInputRef={nodeFindInputRef}
        nodeFindQuery={nodeFindQuery}
        nodeFindResults={nodeFindResults}
        solutionFindResults={solutionFindResults}
        selectedNodeIds={selectedNodeIds}
        selectedCommentIds={selectedCommentIds}
        outlineQuery={outlineQuery}
        graphOutlineNodeCount={graphOutlineNodes.length}
        filteredGraphOutlineNodeCount={filteredGraphOutlineNodes.length}
        visibleGraphOutlineNodeCount={visibleGraphOutlineNodes.length}
        filteredGraphOutlineNodeGroups={filteredGraphOutlineNodeGroups}
        graphOutlineCommentCount={graphOutlineComments.length}
        filteredGraphOutlineComments={filteredGraphOutlineComments}
        bookmarks={bookmarks}
        breakpointNodes={breakpointNodes}
        onOpen={() => setLeftPanelOpen(true)}
        onOpenGraph={(graphPath) => hostClient.requestOpenGraph(graphPath)}
        onRenameSolutionGraph={(graphPath, currentName) => {
          const nextName = window.prompt(t("sidebar.promptGraphName"), currentName)?.trim();
          if (nextName && nextName !== currentName) {
            hostClient.requestRenameSolutionGraph(graphPath, nextName);
          }
        }}
        onAddNode={() => setNodePanel({ open: true, screen: { x: 280, y: 120 }, graph: maybeSnapPoint(screenToGraph(280, 120)) })}
        onNodeFindQueryChange={setNodeFindQuery}
        onOutlineQueryChange={setOutlineQuery}
        onSelectNode={selectNode}
        onSelectNodes={selectNodes}
        onFocusNode={focusNodeById}
        onSelectComment={selectComment}
        onFocusComment={focusCommentById}
        onFocusBookmark={focusBookmark}
        onRenameBookmark={renameBookmark}
        onDeleteBookmark={deleteBookmark}
        onRenameGraphNodeId={(oldNodeId, nextNodeId) => hostClient.requestRenameGraphNodeId(oldNodeId, nextNodeId)}
        onRenameSolutionBlackboardKey={(oldKey, nextKey) => hostClient.requestRenameSolutionBlackboardKey(oldKey, nextKey)}
        onRetargetSolutionTemplate={(oldTemplateId, nextTemplateId) => hostClient.requestRetargetSolutionTemplate(oldTemplateId, nextTemplateId)}
        onRetargetSolutionTemplateSource={(oldSourcePath, nextSourcePath) => hostClient.requestRetargetSolutionTemplateSource(oldSourcePath, nextSourcePath)}
        onToggleBreakpointEnabled={toggleBreakpointEnabled}
        onFocusBreakpoint={focusBreakpoint}
        onSetBreakpointCondition={setBreakpointCondition}
        onClearBreakpoint={clearBreakpoint}
        onClose={() => setLeftPanelOpen(false)}
      />
      )}
      {externalDockPanels ? null : (
      <div
        className="splitter vertical left"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={(event) => startPanelResize("left", event)}
        onPointerMove={resizePanels}
        onPointerUp={stopPanelResize}
        onPointerCancel={stopPanelResize}
      />
      )}

      <main className="editor">
        <div className={`topbar toolbar-align-${toolbarAlignment}`}>
          <div className="toolbar">
            {primaryToolbarItems.length ? <span className="toolbar-group toolbar-primary-tools">{primaryToolbarItems}</span> : null}
            {runToolbarItems.length ? <span className="toolbar-group toolbar-run-controls" aria-label={t("toolbar.runGraph")}>{runToolbarItems}</span> : null}
            {viewToolbarItems.length ? <span className="toolbar-group toolbar-view-controls" aria-label={t("canvasCommands.label")}>{viewToolbarItems}</span> : null}
            {editorSettingsOpen ? (
              <EditorSettingsPanel
                prefs={editorPrefs}
                commands={baseEditorCommands}
                toolbarActions={mainToolbarActionIds}
                t={t}
                onChange={updateEditorPrefs}
                onReset={() => setEditorPrefs(defaultGraphEditorPrefs)}
                onExport={exportEditorPrefs}
                onImport={importEditorPrefs}
                onClose={() => {
                  setEditorSettingsOpen(false);
                  dispatchCanvasInteraction({ type: "cancel" });
                }}
              />
            ) : null}
            {nodeFindDialogOpen ? (
              <NodeFindDialog
                inputRef={nodeFindDialogInputRef}
                query={nodeFindQuery}
                graphResults={nodeFindResults}
                solutionResults={solutionFindResults}
                selectedNodeIds={selectedNodeIds}
                t={t}
                locale={editorPrefs.language}
                nodeLabelMode={editorPrefs.nodeLabelMode}
                onQueryChange={setNodeFindQuery}
                onFocusNode={(nodeId) => {
                  focusNodeById(nodeId);
                  closeNodeFindDialog();
                }}
                onOpenGraph={(graphPath) => {
                  hostClient.requestOpenGraph(graphPath);
                  closeNodeFindDialog();
                }}
                onClose={closeNodeFindDialog}
              />
            ) : null}
            {toolbarOverflowOpen ? <ToolbarOverflowMenu actions={toolbarOverflowActions} t={t} onClose={() => {
              setToolbarOverflowOpen(false);
              dispatchCanvasInteraction({ type: "cancel" });
            }} /> : null}
          </div>
        </div>

        <GraphCanvas
          canvasRef={canvasRef}
          viewport={viewport}
          gridVisible={gridVisible}
          interactionKind={canvasInteraction.kind}
          onWheel={onWheel}
          onPointerMove={onCanvasPointerMove}
          onPointerDown={onCanvasPointerDown}
          onPointerUp={onCanvasPointerUp}
          onContextMenu={openContextPanel}
          wires={(
            <>
              {linksVisible ? visibleCanvasLinks.map((link) => (
                <Wire
                  key={link.id}
                  graph={graph}
                  templates={graphTemplates}
                  link={link}
                  renderMode={linkRenderMode}
                  selected={selectedLinkIds.has(link.id)}
                  onSelect={(event) => selectLink(link.id, event.ctrlKey || event.metaKey || event.shiftKey)}
                  onContextMenu={(event) => openWireContextMenu(link.id, event)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    insertRoutingHubForLinkIds(new Set([link.id]));
                  }}
                />
              )) : null}
              {dragPort ? <PreviewWire graph={graph} templates={graphTemplates} dragPort={dragPort} pointer={pointerGraph} /> : null}
            </>
          )}
          graphLayer={(
            <>
            {graphComments(graph).map((comment) => (
              <CommentBox
                key={comment.id}
                comment={comment}
                t={t}
                selected={selectedCommentIds.has(comment.id)}
                onSelect={(event) => selectComment(comment.id, event.ctrlKey || event.metaKey || event.shiftKey)}
                onContextMenu={(event) => openCommentContextMenu(comment.id, event)}
                onCommentDragStart={(event) => {
                  const point = screenToGraph(event.clientX, event.clientY);
                  interactionStartGraph.current = graph;
                  capturePointer(event.currentTarget, event.pointerId);
                  const dragCommentIds = selectedCommentIds.has(comment.id) ? [...selectedCommentIds] : [comment.id];
                  const comments = graphComments(graph).filter((candidate) => dragCommentIds.includes(candidate.id));
                  const nodeIds = new Set(comments.flatMap((candidate) => candidate.nodeIds));
                  dispatchCanvasInteraction({
                    type: "startDragComments",
                    pointerId: event.pointerId,
                    commentIds: comments.map((candidate) => candidate.id),
                    nodeIds: [...nodeIds]
                  });
                  setDraggingComments({
                    comments: comments.map((candidate) => ({ commentId: candidate.id, offset: { x: point.x - candidate.position.x, y: point.y - candidate.position.y } })),
                    nodes: graph.nodes
                      .filter((candidate) => nodeIds.has(candidate.id))
                      .map((candidate) => ({ nodeId: candidate.id, offset: { x: point.x - candidate.position.x, y: point.y - candidate.position.y } }))
                  });
                }}
                onCommentResizeStart={(event) => {
                  const point = screenToGraph(event.clientX, event.clientY);
                  interactionStartGraph.current = graph;
                  capturePointer(event.currentTarget, event.pointerId);
                  dispatchCanvasInteraction({
                    type: "startResizeComment",
                    pointerId: event.pointerId,
                    commentId: comment.id
                  });
                  setResizingComment({
                    commentId: comment.id,
                    start: point,
                    size: comment.size
                  });
                }}
              />
            ))}
            {visibleCanvasNodes.map((node) => {
              const template = getEffectiveTemplateForNode(graph, graphTemplates, node);
              return (
              <BlueprintNode
                key={node.id}
                node={node}
                template={template}
                t={t}
                locale={editorPrefs.language}
                nodeLabelMode={editorPrefs.nodeLabelMode}
                categoryAccents={categoryAccents}
                selected={selectedNodeIds.has(node.id)}
                hasBreakpoint={breakpointNodeIds.has(node.id)}
                highlightedPortId={focusedIssueKey && focusedIssueKey.includes(`node:${node.id}`) ? issues.find((issue) => issueKey(issue) === focusedIssueKey)?.portId : undefined}
                runtimeStatus={runtimeNodeStatus.get(node.id)?.status}
                onSelect={(event) => selectNode(node.id, event.ctrlKey || event.metaKey || event.shiftKey)}
                onContextMenu={(event) => openNodeContextMenu(node.id, event)}
                portCompatibility={(port) =>
                  portCompatibilityForDrag(graph, templates, dragPort, {
                    nodeId: node.id,
                    portId: port.id,
                    direction: port.direction,
                    flowKind: port.flowKind,
                    type: port.type
                  })
                }
                onNodeDragStart={(event) => {
                  const point = screenToGraph(event.clientX, event.clientY);
                  interactionStartGraph.current = graph;
                  const dragNodeIds = selectedNodeIds.has(node.id) ? [...selectedNodeIds] : [node.id];
                  dispatchCanvasInteraction({
                    type: "startDragNodes",
                    pointerId: event.pointerId,
                    nodeIds: dragNodeIds
                  });
                  setDraggingNodes(
                    graph.nodes
                      .filter((candidate) => dragNodeIds.includes(candidate.id))
                      .map((candidate) => ({ nodeId: candidate.id, offset: { x: point.x - candidate.position.x, y: point.y - candidate.position.y } }))
                  );
                }}
                onDoubleClick={() => openReferencedGraph(template)}
                onPortDragStart={(port, event) => {
                  if (event.altKey) {
                    event.preventDefault();
                    breakLinksForPort(node, port);
                    return;
                  }
                  if (event.ctrlKey && startMoveInputLinkDrag(node, port)) {
                    event.preventDefault();
                    return;
                  }
                  dispatchCanvasInteraction({
                    type: "startDragWire",
                    pointerId: event.pointerId,
                    nodeId: node.id,
                    portId: port.id
                  });
                  setDragPort({ nodeId: node.id, portId: port.id, direction: port.direction, flowKind: port.flowKind, type: port.type });
                }}
                onPortContextMenu={(port, event) => openPortContextMenu(node.id, port.id, event)}
                onPortDrop={(port) => connectDraggedPort({ nodeId: node.id, portId: port.id, direction: port.direction, flowKind: port.flowKind, type: port.type })}
              />
              );
            })}
            {marquee ? <MarqueeRect marquee={marquee} /> : null}
            </>
          )}
          overlays={(
            <>
              {selectionToolboxPosition ? (
                <SelectionToolbox
                  position={selectionToolboxPosition}
                  nodeCount={selectedNodeIds.size}
                  commentCount={selectedCommentIds.size}
                  linkCount={selectedLinkIds.size}
                  incidentLinkCount={selectedNodeLinkCount}
                  hasBreakpoint={Boolean(selectedNodeId && breakpointNodeIds.has(selectedNodeId))}
                  activeCommentColor={selectedComment?.color}
                  canDuplicate={selectedNodeIds.size > 0}
                  canCollapseToMacro={canCollapseSelectionToMacro}
                  canCollapseToFunction={canCollapseSelectionToFunction}
                  canToggleDisable={canToggleDisableSelection}
                  selectionDisabled={selectedNodesDisabled}
                canToggleBreakpoint={selectedNodeIds.size === 1 && !selectedCommentIds.size && !selectedLinkIds.size}
                  t={t}
                  onDelete={deleteSelection}
                  onFrame={frameSelection}
                  onShowInfo={() => setRightPanelOpen(true)}
                  onCreateComment={createCommentBox}
                  onDuplicate={duplicateSelection}
                  onCollapseToMacro={collapseSelectionToMacroGraph}
                  onCollapseToFunction={collapseSelectionToFunctionGraph}
                  onToggleDisable={toggleDisableSelectedNodes}
                  onBreakLinks={breakLinksForSelection}
                  onToggleBreakpoint={toggleBreakpoint}
                  onCommentColor={(color) => {
                    if (selectedComment) {
                      updateCommentColor(selectedComment, color);
                    }
                  }}
                />
              ) : null}
              {minimapVisible ? (
                <GraphMinimap graph={graph} templates={graphTemplates} canvasSize={canvasSize} categoryAccents={categoryAccents} t={t} onCenter={centerViewportOnGraphPoint} />
              ) : null}
              <RunActionBar
                running={isRuntimeRunning}
                runtimeState={runtimeActionState}
                placement={actionBarPlacement}
                bottomPanelOpen={bottomPanelOpen}
                runtimeHistoryCount={runtimeHistory.length}
                runtimeProgressCount={runtimeProgressCount}
                queuedRunCount={runtimeQueueStatus.queuedRuns}
                errorCount={errorCount}
                warningCount={warningCount}
                t={t}
                onRun={requestRun}
                onCancel={requestCancelRun}
                onStep={isRuntimeRunning ? requestRuntimeStep : requestStepRun}
                onContinue={requestRuntimeContinue}
                onToggleLogs={() => setBottomPanelOpen((current) => !current)}
              />
              {nodePanel.open ? (
                <NodeCreationPanel
                  position={nodePanel.screen}
                  size={nodePanelSize}
                  sourcePort={nodePanel.sourcePort}
                  search={search}
                  categories={categories}
                  activeCategory={activeTemplateCategory}
                  candidates={candidates}
                  activeIndex={activeCandidateIndex}
                  favoriteTemplateIds={favoriteTemplateIds}
                  t={t}
                  locale={editorPrefs.language}
                  nodeLabelMode={editorPrefs.nodeLabelMode}
                  onSearch={setSearch}
                  onCategoryChange={(category) => {
                    setActiveTemplateCategory(category);
                    setActiveCandidateIndex(0);
                  }}
                  onActiveIndexChange={setActiveCandidateIndex}
                  onPick={addNode}
                  onToggleFavorite={toggleFavoriteTemplate}
                  onResize={setNodePanelSize}
                  onClose={() => {
                    setNodePanel(emptyPanel);
                    dispatchCanvasInteraction({ type: "cancel" });
                  }}
                />
              ) : null}
              {wireMenu ? (
                <WireContextMenu
                  t={t}
                  position={wireMenu.screen}
                  link={graph.links.find((link) => link.id === wireMenu.linkId)}
                  onDelete={() => deleteLinkById(wireMenu.linkId)}
                  onRoute={() => insertRoutingHubForLinkIds(new Set([wireMenu.linkId]))}
                  onClose={() => {
                    setWireMenu(undefined);
                    dispatchCanvasInteraction({ type: "cancel" });
                  }}
                />
              ) : null}
              {nodeMenu ? (
                <NodeContextMenu
                  t={t}
                  position={nodeMenu.screen}
                  node={graph.nodes.find((node) => node.id === nodeMenu.nodeId)}
                  nodeCount={nodeMenu.nodeIds.length}
                  linkCount={incidentLinkIds(graph, new Set(nodeMenu.nodeIds)).size}
                  hasBreakpoint={breakpointNodeIds.has(nodeMenu.nodeId)}
                  onDuplicate={() => duplicateNodeIds(new Set(nodeMenu.nodeIds))}
                  onDelete={() => deleteNodeIds(new Set(nodeMenu.nodeIds))}
                  onBreakLinks={() => breakLinksForNodeIds(new Set(nodeMenu.nodeIds))}
                  onToggleBreakpoint={() => toggleBreakpointForNodeId(nodeMenu.nodeId)}
                  onAddBookmark={() => createBookmarkForNodeId(nodeMenu.nodeId)}
                  onClose={() => {
                    setNodeMenu(undefined);
                    dispatchCanvasInteraction({ type: "cancel" });
                  }}
                />
              ) : null}
              {commentMenu ? (
                <CommentContextMenu
                  t={t}
                  position={commentMenu.screen}
                  comment={graphComments(graph).find((comment) => comment.id === commentMenu.commentId)}
                  onFocus={() => {
                    setCommentMenu(undefined);
                    dispatchCanvasInteraction({ type: "cancel" });
                    focusCommentById(commentMenu.commentId);
                  }}
                  onRewrap={() => rewrapCommentById(commentMenu.commentId)}
                  onAddBookmark={() => createBookmarkForCommentId(commentMenu.commentId)}
                  onDelete={() => deleteCommentById(commentMenu.commentId)}
                  onClose={() => {
                    setCommentMenu(undefined);
                    dispatchCanvasInteraction({ type: "cancel" });
                  }}
                />
              ) : null}
              {portMenu ? (
                <PortContextMenu
                  t={t}
                  position={portMenu.screen}
                  node={portMenuTarget?.node}
                  port={portMenuTarget?.port}
                  linkCount={portMenuLinkCount}
                  onBreakLinks={() => {
                    if (portMenuTarget) {
                      breakLinksForPort(portMenuTarget.node, portMenuTarget.port);
                    }
                  }}
                  onClose={() => {
                    setPortMenu(undefined);
                    dispatchCanvasInteraction({ type: "cancel" });
                  }}
                />
              ) : null}
            </>
          )}
        />
      </main>

      {externalDockPanels ? null : (
      <div
        className="splitter vertical right"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={(event) => startPanelResize("right", event)}
        onPointerMove={resizePanels}
        onPointerUp={stopPanelResize}
        onPointerCancel={stopPanelResize}
      />
      )}

      {externalDockPanels ? null : (
      <InspectorPanel open={rightPanelOpen} t={t} onOpen={() => setRightPanelOpen(true)} onClose={() => setRightPanelOpen(false)}>
        {selectedNode && selectedTemplate ? (
          <Inspector
            graph={graph}
            node={selectedNode}
            template={selectedTemplate}
            issues={issues.filter((issue) => issue.nodeId === selectedNode.id)}
            focusedIssueKey={focusedIssueKey}
            onIssueFocus={focusIssue}
            onLiteralChange={updateLiteral}
            onUnlink={unlinkPort}
            t={t}
            locale={editorPrefs.language}
            nodeLabelMode={editorPrefs.nodeLabelMode}
          />
        ) : selectedComment ? (
          <CommentInspector comment={selectedComment} t={t} onTitleChange={updateCommentTitle} onSizeChange={updateCommentSize} onColorChange={updateCommentColor} />
        ) : undefined}
      </InspectorPanel>
      )}

      <div
        className="splitter horizontal bottom"
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={(event) => startPanelResize("bottom", event)}
        onPointerMove={resizePanels}
        onPointerUp={stopPanelResize}
        onPointerCancel={stopPanelResize}
      />

      <RuntimePanel
        open={bottomPanelOpen}
        status={outputStatus}
        summary={outputSummary}
        details={outputDetails}
        t={t}
        onToggle={() => setBottomPanelOpen((current) => !current)}
      />
      {templateRegistryOpen ? (
        <TemplateRegistryPanel
          templates={graphTemplates}
          sources={templateRegistrySources}
          favoriteTemplateIds={favoriteTemplateIds}
          disabledPackageIds={disabledTemplatePackageIds}
          t={t}
          locale={editorPrefs.language}
          nodeLabelMode={editorPrefs.nodeLabelMode}
          onToggleFavorite={toggleFavoriteTemplate}
          onTogglePackageEnabled={toggleTemplatePackageEnabled}
          onCreateTemplate={addTemplateFromRegistry}
          onClose={() => {
            setTemplateRegistryOpen(false);
            dispatchCanvasInteraction({ type: "cancel" });
          }}
        />
      ) : null}
      <CommandPalette open={commandPaletteOpen} commands={editorCommands} t={t} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}

function CommentBox(props: {
  comment: BlueprintCommentBox;
  t: Translator;
  selected: boolean;
  onSelect(event: React.PointerEvent): void;
  onContextMenu(event: React.MouseEvent<HTMLDivElement>): void;
  onCommentDragStart(event: React.PointerEvent<HTMLDivElement>): void;
  onCommentResizeStart(event: React.PointerEvent<HTMLButtonElement>): void;
}): JSX.Element {
  const title = props.comment.title || props.t("comment.fallback");
  const commentColor = normalizeColorInput(props.comment.color ?? fallbackCommentColor);
  return (
    <div
      className={props.selected ? "comment-box selected" : "comment-box"}
      data-comment-id={props.comment.id}
      style={{
        left: props.comment.position.x,
        top: props.comment.position.y,
        width: props.comment.size.width,
        height: props.comment.size.height,
        "--comment-color": commentColor
      } as CSSProperties}
      onPointerDown={(event) => {
        event.stopPropagation();
        props.onSelect(event);
        props.onCommentDragStart(event);
      }}
      onContextMenu={props.onContextMenu}
    >
      <div className="comment-title">{title}</div>
      <button
        className="comment-resize"
        title={props.t("comment.resize", { title })}
        aria-label={props.t("comment.resize", { title })}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onSelect(event);
          props.onCommentResizeStart(event);
        }}
      />
    </div>
  );
}

function BlueprintNode(props: {
  node: BlueprintNodeInstance;
  template: BlueprintNodeTemplate | undefined;
  t: Translator;
  locale: Locale;
  nodeLabelMode: NodeLabelMode;
  categoryAccents: CategoryAccentMap;
  selected: boolean;
  hasBreakpoint: boolean;
  highlightedPortId?: string;
  runtimeStatus?: RuntimeTraceEvent["status"];
  onSelect(event: React.PointerEvent): void;
  onDoubleClick(event: React.MouseEvent<HTMLDivElement>): void;
  onContextMenu(event: React.MouseEvent<HTMLDivElement>): void;
  portCompatibility(port: BlueprintPortDefinition): PortCompatibility | undefined;
  onNodeDragStart(event: React.PointerEvent): void;
  onPortDragStart(port: BlueprintPortDefinition, event: React.PointerEvent<HTMLButtonElement>): void;
  onPortContextMenu(port: BlueprintPortDefinition, event: React.MouseEvent<HTMLButtonElement>): void;
  onPortDrop(port: BlueprintPortDefinition): void;
}): JSX.Element {
  const { node, template } = props;
  const templateText = displayTemplateText(template, props.locale, props.nodeLabelMode);
  const compact = isRoutingHubTemplate(template) || node.displayOverrides?.compact === true;
  const disabled = node.displayOverrides?.disabled === true;
  const width = renderedNodeWidth(template, node);
  const height = renderedNodeHeight(template, node);
  const className = `${props.selected ? "node selected" : "node"}${compact ? " routing-hub" : ""}${disabled ? " disabled" : ""}`;
  const nodeStyle = {
    left: node.position.x,
    top: node.position.y,
    width,
    height,
    "--node-accent": nodeAccentForTemplate(template, props.categoryAccents)
  } as CSSProperties;
  const controlPorts = [...(template?.controlInputs ?? []), ...(template?.controlOutputs ?? [])];
  const dataPorts = [...(template?.inputs ?? []), ...(template?.outputs ?? [])];

  if (compact) {
    return (
      <div
        className={className}
        data-node-id={node.id}
        title={`${templateText.name || node.templateId} · ${template?.creationPath ?? ""} · ${node.templateId}`.trim()}
        style={nodeStyle}
        onContextMenu={props.onContextMenu}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest(".port")) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          props.onDoubleClick(event);
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest(".port")) {
            return;
          }
          props.onSelect(event);
          props.onNodeDragStart(event);
        }}
      >
        <RuntimeStatusBadge status={props.runtimeStatus} t={props.t} />
        {props.hasBreakpoint ? <span className="breakpoint-badge" title={props.t("node.breakpoint")} /> : null}
        <div className="hub-ports">
          {[...controlPorts, ...dataPorts].map((port) => (
            <Port
              key={`${port.direction}-${port.id}`}
              port={port}
              template={template}
              locale={props.locale}
              nodeLabelMode={props.nodeLabelMode}
              side={port.direction === "input" ? "left" : "right"}
              highlighted={props.highlightedPortId === port.id}
              compatibility={props.portCompatibility(port)}
              onPointerDown={(event) => props.onPortDragStart(port, event)}
              onContextMenu={(event) => props.onPortContextMenu(port, event)}
              onPointerUp={() => props.onPortDrop(port)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={className}
      data-node-id={node.id}
      style={nodeStyle}
      onContextMenu={props.onContextMenu}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest(".port")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        props.onDoubleClick(event);
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest(".port")) {
          return;
        }
        props.onSelect(event);
        props.onNodeDragStart(event);
      }}
    >
      <RuntimeStatusBadge status={props.runtimeStatus} t={props.t} />
      {props.hasBreakpoint ? <span className="breakpoint-badge" title={props.t("node.breakpoint")} /> : null}
      <div className="node-header">
        <strong>{templateText.name || node.templateId}</strong>
        <span>{templateText.creationPath || props.t("node.missingTemplate")}</span>
      </div>
      <div className="exec-row">
        {template?.controlInputs.map((port) => <Port key={port.id} port={port} template={template} locale={props.locale} nodeLabelMode={props.nodeLabelMode} side="left" highlighted={props.highlightedPortId === port.id} compatibility={props.portCompatibility(port)} onPointerDown={(event) => props.onPortDragStart(port, event)} onContextMenu={(event) => props.onPortContextMenu(port, event)} onPointerUp={() => props.onPortDrop(port)} />)}
        <div className="exec-spacer" />
        {template?.controlOutputs.map((port) => <Port key={port.id} port={port} template={template} locale={props.locale} nodeLabelMode={props.nodeLabelMode} side="right" highlighted={props.highlightedPortId === port.id} compatibility={props.portCompatibility(port)} onPointerDown={(event) => props.onPortDragStart(port, event)} onContextMenu={(event) => props.onPortContextMenu(port, event)} onPointerUp={() => props.onPortDrop(port)} />)}
      </div>
      <div className="data-rows">
        <div>
          {template?.inputs.map((port) => <Port key={port.id} port={port} template={template} locale={props.locale} nodeLabelMode={props.nodeLabelMode} side="left" highlighted={props.highlightedPortId === port.id} compatibility={props.portCompatibility(port)} onPointerDown={(event) => props.onPortDragStart(port, event)} onContextMenu={(event) => props.onPortContextMenu(port, event)} onPointerUp={() => props.onPortDrop(port)} />)}
        </div>
        <div>
          {template?.outputs.map((port) => <Port key={port.id} port={port} template={template} locale={props.locale} nodeLabelMode={props.nodeLabelMode} side="right" highlighted={props.highlightedPortId === port.id} compatibility={props.portCompatibility(port)} onPointerDown={(event) => props.onPortDragStart(port, event)} onContextMenu={(event) => props.onPortContextMenu(port, event)} onPointerUp={() => props.onPortDrop(port)} />)}
        </div>
      </div>
    </div>
  );
}

function RuntimeStatusBadge(props: { status?: RuntimeTraceEvent["status"]; t: Translator }): JSX.Element | null {
  if (!props.status) {
    return null;
  }
  const label = props.status === "error" ? "!" : props.status === "skipped" ? "SK" : props.status === "breakpoint" ? "BP" : props.status === "paused" ? "PAU" : props.status === "active" ? "RUN" : "OK";
  const status = props.t(`runtime.status.${props.status}`);
  const title = props.status === "active" || props.status === "paused"
    ? props.t("runtime.badgeRunning", { status })
    : props.t("runtime.badgeLastRun", { status });
  return <span className={`runtime-badge ${props.status}`} title={title}>{label}</span>;
}

function nodeAccentForTemplate(template: BlueprintNodeTemplate | undefined, categoryAccents: CategoryAccentMap): string {
  const category = categoryKeyForCreationPath(template?.creationPath);
  return categoryAccents[category] ?? builtinCategoryAccents[category] ?? "var(--line)";
}

function normalizeCategoryAccentMap(value: Record<string, string>): CategoryAccentMap {
  return Object.fromEntries(
    Object.entries(value)
      .map(([category, accent]) => [categoryKeyForCreationPath(category), accent.trim()] as const)
      .filter(([category, accent]) => Boolean(category) && isSafeCssAccent(accent))
  );
}

function categoryKeyForCreationPath(creationPath: string | undefined): string {
  return creationPath?.split("/")[0]?.trim().toLowerCase() ?? "";
}

function isSafeCssAccent(value: string): boolean {
  if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return contrastRatio(value, nodeAccentContrastBackground) >= minimumNodeAccentContrast;
  }
  return /^var\(--[A-Za-z0-9-]+(?:,\s*#[0-9a-fA-F]{3,8})?\)$/.test(value);
}

function contrastRatio(a: string, b: string): number {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  if (!left || !right) {
    return 1;
  }
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRgb(value: string): { r: number; g: number; b: number } | undefined {
  const hex = value.replace(/^#/, "");
  if (hex.length === 3 || hex.length === 4) {
    return {
      r: Number.parseInt(hex[0] + hex[0], 16),
      g: Number.parseInt(hex[1] + hex[1], 16),
      b: Number.parseInt(hex[2] + hex[2], 16)
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }
  return undefined;
}

function normalizeColorInput(value: string): string {
  const trimmed = value.trim();
  const rgb = hexToRgb(trimmed);
  if (!rgb) {
    return fallbackCommentColor;
  }
  return `#${[rgb.r, rgb.g, rgb.b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(color: { r: number; g: number; b: number }): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ToolbarOverflowMenu(props: {
  actions: ToolbarOverflowAction[];
  t: Translator;
  onClose(): void;
}): JSX.Element {
  const actionGroups = groupToolbarOverflowActions(props.actions);
  return (
    <div
      className="toolbar-overflow-menu"
      role="menu"
      aria-label={props.t("toolbarOverflow.actions")}
      onPointerDown={isolateOverlayEvent}
      onContextMenu={isolateOverlayContextMenu}
    >
      {actionGroups.map((group) => (
        <div key={group.key} className={`toolbar-overflow-section ${group.tier}`}>
          <span className="toolbar-overflow-section-title">{group.section}</span>
          {group.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              title={action.title}
              onClick={() => {
                action.run();
                props.onClose();
              }}
            >
              {action.icon}
              <span>{action.title}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function groupToolbarOverflowActions(actions: ToolbarOverflowAction[]): Array<{ key: string; section: string; tier: ToolbarOverflowAction["tier"]; actions: ToolbarOverflowAction[] }> {
  const groups = new Map<string, { key: string; section: string; tier: ToolbarOverflowAction["tier"]; actions: ToolbarOverflowAction[] }>();
  for (const action of actions) {
    const key = `${action.tier}:${action.section}`;
    const group = groups.get(key);
    if (group) {
      group.actions.push(action);
    } else {
      groups.set(key, { key, section: action.section, tier: action.tier, actions: [action] });
    }
  }
  return [...groups.values()];
}

interface TemplateRegistryPackageSummary {
  id: string;
  name: string;
  templates: BlueprintNodeTemplate[];
  templateCount: number;
  categories: string[];
  bodyKinds: string[];
  projectPath?: string;
  sourceGlobs: string[];
  templatePackages: string[];
  builtinGroups: string[];
}

function TemplateRegistryPanel(props: {
  templates: BlueprintNodeTemplate[];
  sources: TemplateRegistrySourceSummary[];
  favoriteTemplateIds: Set<string>;
  disabledPackageIds: Set<string>;
  t: Translator;
  locale: Locale;
  nodeLabelMode: NodeLabelMode;
  onToggleFavorite(templateId: string): void;
  onTogglePackageEnabled(packageId: string): void;
  onCreateTemplate(template: BlueprintNodeTemplate): void;
  onClose(): void;
}): JSX.Element {
  const packages = useMemo(() => templateRegistryPackages(props.templates, props.sources, props.t, props.locale), [props.locale, props.sources, props.t, props.templates]);
  const [activePackageId, setActivePackageId] = useState(packages[0]?.id ?? "all");
  const [query, setQuery] = useState("");
  const packageIds = useMemo(() => packages.map((summary) => summary.id), [packages]);

  useEffect(() => {
    if (!packageIds.includes(activePackageId)) {
      setActivePackageId(packages[0]?.id ?? "all");
    }
  }, [activePackageId, packageIds, packages]);

  const visibleTemplates = useMemo(
    () => templateRegistryTemplates(packages, activePackageId, query, props.t, props.locale),
    [activePackageId, packages, props.locale, props.t, query]
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string | undefined>(visibleTemplates[0]?.id);
  const activePackage = packages.find((summary) => summary.id === activePackageId) ?? packages[0];
  const activeTemplate = activeTemplateId ? visibleTemplates.find((template) => template.id === activeTemplateId) : undefined;
  const activePackageEnabled = activePackage ? !props.disabledPackageIds.has(activePackage.id) : true;
  const activeTemplateAvailable = activeTemplate
    ? templateAvailableForCreation(activeTemplate, props.disabledPackageIds, props.sources)
    : false;

  useEffect(() => {
    if (!visibleTemplates.some((template) => template.id === activeTemplateId)) {
      setActiveTemplateId(activePackageId.startsWith("source:") ? undefined : visibleTemplates[0]?.id);
    }
  }, [activePackageId, activeTemplateId, visibleTemplates]);

  return (
    <div
      className="template-registry-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <section
        className="template-registry"
        role="dialog"
        aria-label={props.t("templateRegistry.label")}
        onPointerDown={isolateOverlayEvent}
        onWheel={isolateOverlayEvent}
        onContextMenu={isolateOverlayContextMenu}
      >
        <header className="template-registry-title">
          <PackageIcon size={16} />
          <strong>{props.t("templateRegistry.title")}</strong>
          <button type="button" title={props.t("templateRegistry.close")} onClick={props.onClose}>
            <XCircle size={14} />
          </button>
        </header>
        <label className="template-registry-search">
          <Search size={15} />
          <input value={query} placeholder={props.t("templateRegistry.searchPlaceholder")} onChange={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <div className="template-registry-grid">
          <div className="template-registry-packages" aria-label={props.t("templateRegistry.packages")}>
            {packages.map((summary) => (
              <button
                key={summary.id}
                type="button"
                className={[
                  summary.id === activePackageId ? "active" : "",
                  props.disabledPackageIds.has(summary.id) ? "disabled" : ""
                ].filter(Boolean).join(" ")}
                title={props.t("templateRegistry.inspectPackage", { name: summary.name })}
                onClick={() => {
                  setActivePackageId(summary.id);
                  setActiveTemplateId(undefined);
                }}
              >
                <span>{summary.name}</span>
                <small>{props.disabledPackageIds.has(summary.id) ? props.t("templateRegistry.off") : summary.templateCount || summary.sourceGlobs.length ? summary.templateCount || props.t("templateRegistry.sourceCountShort", { count: summary.sourceGlobs.length }) : ""}</small>
              </button>
            ))}
          </div>
          <div className="template-registry-list" aria-label={props.t("templateRegistry.templates")}>
            {visibleTemplates.length ? visibleTemplates.map((template) => (
              (() => {
                const templateText = displayTemplateText(template, props.locale, props.nodeLabelMode);
                return (
              <button
                key={template.id}
                type="button"
                className={template.id === activeTemplate?.id ? "active" : ""}
                title={props.t("templateRegistry.inspectTemplate", { name: templateText.name })}
                onClick={() => setActiveTemplateId(template.id)}
              >
                <strong>{templateText.name}</strong>
                <span>{templateText.creationPath}</span>
              </button>
                );
              })()
            )) : <span className="template-registry-empty">{props.t("templateRegistry.noTemplates")}</span>}
          </div>
          <div className="template-registry-details">
            {activeTemplate ? (() => {
              const activeTemplateText = displayTemplateText(activeTemplate, props.locale, props.nodeLabelMode);
              return (
              <>
                <div className="template-registry-detail-head">
                  <div>
                    <strong>{activeTemplateText.name}</strong>
                    <span>{templatePackageName(activeTemplate, props.t)}</span>
                  </div>
                  <div className="template-registry-actions">
                    {activePackage && activePackage.id !== "all" ? (
                      <button
                        type="button"
                        className={activePackageEnabled ? "active" : ""}
                        title={activePackageEnabled ? props.t("templateRegistry.disablePackage", { name: activePackage.name }) : props.t("templateRegistry.enablePackage", { name: activePackage.name })}
                        onClick={() => props.onTogglePackageEnabled(activePackage.id)}
                      >
                      <Power size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={props.favoriteTemplateIds.has(activeTemplate.id) ? "active" : ""}
                      title={props.favoriteTemplateIds.has(activeTemplate.id) ? props.t("templateRegistry.unfavoriteTemplate", { name: activeTemplateText.name }) : props.t("templateRegistry.favoriteTemplate", { name: activeTemplateText.name })}
                      onClick={() => props.onToggleFavorite(activeTemplate.id)}
                    >
                      <Star size={14} />
                    </button>
                    <button type="button" title={activeTemplateAvailable ? props.t("templateRegistry.createTemplateNode", { name: activeTemplateText.name }) : props.t("templateRegistry.templateDisabled", { name: activeTemplateText.name })} disabled={!activeTemplateAvailable} onClick={() => props.onCreateTemplate(activeTemplate)}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <p>{activeTemplateText.description}</p>
                <dl className="template-registry-meta">
                  <div>
                    <dt>{props.t("templateRegistry.path")}</dt>
                    <dd>{activeTemplateText.creationPath}</dd>
                  </div>
                  <div>
                    <dt>{props.t("templateRegistry.body")}</dt>
                    <dd>{templateBodyKindLabel(activeTemplate.bodyKind, props.t)}</dd>
                  </div>
                  <div>
                    <dt>{props.t("templateRegistry.source")}</dt>
                    <dd>{activeTemplate.bodyRef}</dd>
                  </div>
                  <div>
                    <dt>{props.t("templateRegistry.ports")}</dt>
                    <dd>{templatePortCount(activeTemplate)}</dd>
                  </div>
                </dl>
                <TemplatePortSummary template={activeTemplate} t={props.t} locale={props.locale} nodeLabelMode={props.nodeLabelMode} />
              </>
              );
            })() : activePackage ? (
              <TemplateRegistrySourceDetails
                summary={activePackage}
                enabled={activePackageEnabled}
                canToggle={activePackage.id !== "all"}
                t={props.t}
                onToggleEnabled={() => props.onTogglePackageEnabled(activePackage.id)}
              />
            ) : <span className="template-registry-empty">{props.t("templateRegistry.noTemplateSelected")}</span>}
          </div>
        </div>
      </section>
    </div>
  );
}

function NodeFindDialog(props: {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  graphResults: NodeFindResult[];
  solutionResults: SolutionGraphFindResult[];
  selectedNodeIds: Set<string>;
  t: Translator;
  locale: Locale;
  nodeLabelMode: NodeLabelMode;
  onQueryChange(value: string): void;
  onFocusNode(nodeId: string): void;
  onOpenGraph(graphPath: string): void;
  onClose(): void;
}): JSX.Element {
  useEffect(() => {
    props.inputRef.current?.focus();
    props.inputRef.current?.select();
  }, [props.inputRef]);

  const hasQuery = props.query.trim().length > 0;
  const templateName = (template: BlueprintNodeTemplate | undefined, fallback: string) => {
    const localized = localizeTemplate(template, props.locale, fallbackLocale, builtinNodeI18nCatalog);
    return displayText(localized.name, template?.name ?? fallback, props.nodeLabelMode);
  };
  const focusFirst = () => {
    const first = props.graphResults[0];
    if (first) {
      props.onFocusNode(first.node.id);
      return;
    }
    const firstSolution = props.solutionResults[0];
    if (firstSolution) {
      props.onOpenGraph(firstSolution.graphPath);
    }
  };

  return (
    <div
      className="node-find-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <section
        className="node-find-dialog"
        role="dialog"
        aria-label={props.t("nodeFind.title")}
        onPointerDown={isolateOverlayEvent}
        onWheel={isolateOverlayEvent}
        onContextMenu={isolateOverlayContextMenu}
      >
        <header className="node-find-title">
          <Search size={16} />
          <strong>{props.t("nodeFind.title")}</strong>
          <button type="button" title={props.t("nodeFind.close")} onClick={props.onClose}>
            <XCircle size={14} />
          </button>
        </header>
        <label className="node-find-search">
          <Search size={15} />
          <input
            ref={props.inputRef}
            value={props.query}
            placeholder={props.t("nodeFind.placeholder")}
            onChange={(event) => props.onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                focusFirst();
              } else if (event.key === "Escape") {
                props.onClose();
              }
            }}
          />
        </label>
        <div className="node-find-results">
          {hasQuery ? (
            <>
              {props.graphResults.map(({ node, template, matchLabel }) => (
                <button
                  key={node.id}
                  type="button"
                  className={props.selectedNodeIds.has(node.id) ? "node-find-item active" : "node-find-item"}
                  onClick={() => props.onFocusNode(node.id)}
                >
                  <span>{templateName(template, node.templateId)}</span>
                  <small>{matchLabel ?? node.id}</small>
                </button>
              ))}
              {props.solutionResults.length ? <div className="node-find-group-title">{props.t("sidebar.solutionMatches")}</div> : null}
              {props.solutionResults.map((entry) => (
                <button
                  key={`${entry.graphPath}:${entry.nodeId ?? "graph"}`}
                  type="button"
                  className="node-find-item"
                  onClick={() => props.onOpenGraph(entry.graphPath)}
                >
                  <span>{entry.nodeId ? templateName(entry.template, entry.nodeId) : entry.graphName}</span>
                  <small>{entry.matchLabel ?? `${entry.projectName} / ${entry.graphKind}`}</small>
                </button>
              ))}
              {!props.graphResults.length && !props.solutionResults.length ? <span className="node-find-empty">{props.t("sidebar.noNodes")}</span> : null}
            </>
          ) : (
            <span className="node-find-empty">{props.t("nodeFind.empty")}</span>
          )}
        </div>
      </section>
    </div>
  );
}

function TemplateRegistrySourceDetails(props: { summary: TemplateRegistryPackageSummary; enabled: boolean; canToggle: boolean; t: Translator; onToggleEnabled(): void }): JSX.Element {
  return (
    <>
      <div className="template-registry-detail-head">
        <div>
          <strong>{props.summary.name}</strong>
          <span>{props.summary.projectPath ?? props.t("templateRegistry.packageFallback")}</span>
        </div>
        {props.canToggle ? (
          <div className="template-registry-actions">
            <button
              type="button"
              className={props.enabled ? "active" : ""}
              title={props.enabled ? props.t("templateRegistry.disablePackage", { name: props.summary.name }) : props.t("templateRegistry.enablePackage", { name: props.summary.name })}
              onClick={props.onToggleEnabled}
            >
              <Power size={14} />
            </button>
          </div>
        ) : null}
      </div>
      <dl className="template-registry-meta">
        <div>
          <dt>{props.t("templateRegistry.status")}</dt>
          <dd>{props.enabled ? props.t("templateRegistry.enabled") : props.t("templateRegistry.disabled")}</dd>
        </div>
        <div>
          <dt>{props.t("templateRegistry.templatesLabel")}</dt>
          <dd>{props.summary.templateCount}</dd>
        </div>
        <div>
          <dt>{props.t("templateRegistry.categories")}</dt>
          <dd>{props.summary.categories.join(", ") || props.t("common.none")}</dd>
        </div>
        <div>
          <dt>{props.t("templateRegistry.sources")}</dt>
          <dd>{props.summary.sourceGlobs.join(", ") || props.t("common.none")}</dd>
        </div>
        <div>
          <dt>{props.t("templateRegistry.packagesLabel")}</dt>
          <dd>{props.summary.templatePackages.join(", ") || props.t("common.none")}</dd>
        </div>
        <div>
          <dt>{props.t("templateRegistry.builtins")}</dt>
          <dd>{props.summary.builtinGroups.join(", ") || props.t("common.none")}</dd>
        </div>
      </dl>
    </>
  );
}

function EditorSettingsPanel(props: {
  prefs: GraphEditorPrefs;
  commands: EditorCommand[];
  toolbarActions: MainToolbarActionId[];
  t: Translator;
  onChange(updates: Partial<GraphEditorPrefs>): void;
  onReset(): void;
  onExport(): Promise<boolean>;
  onImport(text: string): boolean;
  onClose(): void;
}): JSX.Element {
  const [transferStatus, setTransferStatus] = useState<"idle" | "exported" | "exportFailed" | "imported" | "importFailed" | "themeExported" | "themeExportFailed" | "themeImported" | "themeImportFailed">("idle");
  const [activePage, setActivePage] = useState<"general" | "mainToolbar" | "shortcuts">("general");
  const importSettings = () => {
    const text = window.prompt(props.t("settings.jsonPrompt"), serializeGraphEditorPrefs(props.prefs));
    if (text === null) {
      return;
    }
    setTransferStatus(props.onImport(text) ? "imported" : "importFailed");
  };
  const importTheme = () => {
    const text = window.prompt(props.t("settings.themeJsonPrompt"), serializeCustomTheme(props.prefs.customTheme ?? defaultCustomTheme));
    if (text === null) {
      return;
    }
    try {
      props.onChange({ theme: "custom", customTheme: readCustomThemeFromText(text) });
      setTransferStatus("themeImported");
    } catch {
      setTransferStatus("themeImportFailed");
    }
  };
  const exportTheme = async () => {
    if (!props.prefs.customTheme) {
      setTransferStatus("themeExportFailed");
      return;
    }
    try {
      await writeTextToClipboard(serializeCustomTheme(props.prefs.customTheme));
      setTransferStatus("themeExported");
    } catch {
      setTransferStatus("themeExportFailed");
    }
  };
  const updateShortcut = (commandId: string, shortcut: string) => {
    const nextShortcuts = { ...props.prefs.shortcuts };
    const normalized = shortcut.trim();
    if (normalized) {
      nextShortcuts[commandId] = normalized;
    } else {
      delete nextShortcuts[commandId];
    }
    props.onChange({ shortcuts: nextShortcuts });
  };
  const updateMainToolbarAction = (actionId: MainToolbarActionId, enabled: boolean) => {
    const current = new Set(props.prefs.mainToolbarActions);
    if (enabled) {
      current.add(actionId);
    } else {
      current.delete(actionId);
    }
    props.onChange({ mainToolbarActions: props.toolbarActions.filter((id) => current.has(id)) });
  };

  return (
    <div
      className="editor-settings-panel"
      role="dialog"
      aria-label={props.t("settings.panel")}
      onPointerDown={isolateOverlayEvent}
      onWheel={isolateOverlayEvent}
      onContextMenu={isolateOverlayContextMenu}
    >
      <div className="editor-settings-title">
        <strong>{props.t("settings.panel")}</strong>
        <button type="button" title={props.t("settings.close")} onClick={props.onClose}>
          <XCircle size={14} />
        </button>
      </div>
      <div className="editor-settings-tabs" role="tablist" aria-label={props.t("settings.pages")}>
        {(["general", "mainToolbar", "shortcuts"] as const).map((pageId) => (
          <button
            key={pageId}
            type="button"
            role="tab"
            aria-selected={activePage === pageId}
            className={activePage === pageId ? "active" : ""}
            onClick={() => setActivePage(pageId)}
          >
            {props.t(`settings.page.${pageId}`)}
          </button>
        ))}
      </div>
      <div className="editor-settings-page">
        {activePage === "general" ? (
          <>
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={props.prefs.gridVisible}
                onChange={(event) => props.onChange({ gridVisible: event.currentTarget.checked })}
              />
              <span>{props.t("settings.grid")}</span>
            </label>
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={props.prefs.snapToGrid}
                onChange={(event) => props.onChange({ snapToGrid: event.currentTarget.checked })}
              />
              <span>{props.t("settings.snapToGrid")}</span>
            </label>
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={props.prefs.minimapVisible}
                onChange={(event) => props.onChange({ minimapVisible: event.currentTarget.checked })}
              />
              <span>{props.t("settings.minimap")}</span>
            </label>
            <div className="setting-row">
              <span>{props.t("settings.links")}</span>
              <div className="setting-segmented" aria-label={props.t("settings.linkRenderMode")}>
                {linkRenderModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={props.prefs.linkRenderMode === mode ? "active" : ""}
                    title={props.t("settings.setLinkMode", { mode })}
                    onClick={() => props.onChange({ linkRenderMode: mode })}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <span>{props.t("settings.actionbar")}</span>
              <div className="setting-segmented" aria-label={props.t("settings.actionbarPlacement")}>
                <button
                  type="button"
                  className={props.prefs.actionBarPlacement === "bottom" ? "active" : ""}
                  title={props.t("settings.placeActionbarBottom")}
                  onClick={() => props.onChange({ actionBarPlacement: "bottom" })}
                >
                  {props.t("settings.actionbarBottom")}
                </button>
                <button
                  type="button"
                  className={props.prefs.actionBarPlacement === "top" ? "active" : ""}
                  title={props.t("settings.placeActionbarTop")}
                  onClick={() => props.onChange({ actionBarPlacement: "top" })}
                >
                  {props.t("settings.actionbarTop")}
                </button>
              </div>
            </div>
            <div className="setting-row">
              <span>{props.t("settings.toolbar")}</span>
              <div className="setting-segmented" aria-label={props.t("settings.toolbarAlignment")}>
                {toolbarAlignments.map((alignment) => (
                  <button
                    key={alignment}
                    type="button"
                    className={props.prefs.toolbarAlignment === alignment ? "active" : ""}
                    title={props.t(`settings.placeToolbar${toolbarAlignmentKeySuffix(alignment)}`)}
                    onClick={() => props.onChange({ toolbarAlignment: alignment })}
                  >
                    {props.t(`settings.toolbar${toolbarAlignmentKeySuffix(alignment)}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <span>{props.t("settings.nodeLabels")}</span>
              <div className="setting-segmented" aria-label={props.t("settings.nodeLabelMode")}>
                {nodeLabelModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={props.prefs.nodeLabelMode === mode ? "active" : ""}
                    title={props.t("settings.setNodeLabelMode", { mode: props.t(`settings.nodeLabelMode.${mode}`) })}
                    onClick={() => props.onChange({ nodeLabelMode: mode })}
                  >
                    {props.t(`settings.nodeLabelMode.${mode}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <span>{props.t("settings.language")}</span>
              <div className="setting-segmented" aria-label={props.t("settings.languageSelector")}>
                {supportedLocales.map((locale) => (
                  <button
                    key={locale}
                    type="button"
                    className={props.prefs.language === locale ? "active" : ""}
                    onClick={() => props.onChange({ language: locale })}
                  >
                    {props.t(`settings.language.${locale}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <span>{props.t("settings.theme")}</span>
              <div className="setting-segmented" aria-label={props.t("settings.themeSelector")}>
                {editorThemes.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className={props.prefs.theme === theme.id ? "active" : ""}
                    onClick={() => props.onChange({ theme: theme.id })}
                  >
                    {props.t(theme.labelKey)}
                  </button>
                ))}
                {props.prefs.customTheme ? (
                  <button
                    type="button"
                    className={props.prefs.theme === "custom" ? "active" : ""}
                    title={props.t("settings.theme.customTitle", { name: props.prefs.customTheme.name })}
                    onClick={() => props.onChange({ theme: "custom" })}
                  >
                    {props.prefs.customTheme.name || props.t("settings.theme.custom")}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="setting-row">
              <span>{props.t("settings.themeConfig")}</span>
              <div className="setting-segmented" aria-label={props.t("settings.themeConfig")}>
                <button type="button" title={props.t("settings.importThemeTitle")} onClick={importTheme}>
                  {props.t("common.import")}
                </button>
                <button type="button" title={props.t("settings.exportThemeTitle")} onClick={() => void exportTheme()} disabled={!props.prefs.customTheme}>
                  {props.t("common.export")}
                </button>
              </div>
            </div>
          </>
        ) : null}
        {activePage === "mainToolbar" ? (
          <div className="setting-toolbar-actions" aria-label={props.t("settings.mainToolbarActions")}>
            {props.toolbarActions.map((actionId) => (
              <label key={actionId} className="setting-toggle compact" data-toolbar-action={actionId}>
                <input
                  type="checkbox"
                  checked={props.prefs.mainToolbarActions.includes(actionId)}
                  onChange={(event) => updateMainToolbarAction(actionId, event.currentTarget.checked)}
                />
                <span>{props.t(`settings.mainToolbarAction.${actionId}`)}</span>
              </label>
            ))}
          </div>
        ) : null}
        {activePage === "shortcuts" ? (
          <div className="setting-shortcuts" aria-label={props.t("settings.keyboardShortcuts")}>
            {props.commands.map((command) => {
              const defaultShortcut = commandShortcuts(command)[0] ?? "";
              const customShortcut = props.prefs.shortcuts[command.id] ?? "";
              const conflicts = customShortcut ? shortcutConflictTitles(props.commands, command.id, customShortcut, props.prefs.shortcuts) : [];
              return (
                <label key={command.id} className={conflicts.length ? "setting-shortcut-row conflict" : "setting-shortcut-row"}>
                  <span className="setting-shortcut-label">
                    <strong>{command.title}</strong>
                    <small>{command.category}</small>
                  </span>
                  <input
                    value={customShortcut}
                    placeholder={defaultShortcut ? shortcutLabel(defaultShortcut) : props.t("settings.unassigned")}
                    aria-label={props.t("settings.shortcutFor", { title: command.title })}
                    onChange={(event) => updateShortcut(command.id, event.currentTarget.value)}
                  />
                  {customShortcut ? (
                    <button type="button" title={props.t("settings.resetShortcutFor", { title: command.title })} onClick={() => updateShortcut(command.id, "")}>
                      {props.t("common.reset")}
                    </button>
                  ) : null}
                  {conflicts.length ? <small className="setting-shortcut-conflict">{props.t("settings.conflictsWith", { titles: conflicts.join(", ") })}</small> : null}
                </label>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="editor-settings-actions">
        <button
          type="button"
          title={props.t("settings.exportTitle")}
          onClick={() => {
            void props.onExport().then((ok) => setTransferStatus(ok ? "exported" : "exportFailed"));
          }}
        >
          {props.t("common.export")}
        </button>
        <button type="button" title={props.t("settings.importTitle")} onClick={importSettings}>
          {props.t("common.import")}
        </button>
        <button type="button" title={props.t("settings.resetTitle")} onClick={() => {
          props.onReset();
          setTransferStatus("idle");
        }}>
          {props.t("common.reset")}
        </button>
      </div>
      {transferStatus !== "idle" ? <span className={`editor-settings-status ${transferStatus}`}>{editorSettingsTransferStatusText(transferStatus, props.t)}</span> : null}
    </div>
  );
}

function editorSettingsTransferStatusText(status: "exported" | "exportFailed" | "imported" | "importFailed" | "themeExported" | "themeExportFailed" | "themeImported" | "themeImportFailed", t: Translator): string {
  switch (status) {
    case "exported":
      return t("settings.exported");
    case "exportFailed":
      return t("settings.exportFailed");
    case "imported":
      return t("settings.imported");
    case "importFailed":
      return t("settings.importFailed");
    case "themeExported":
      return t("settings.themeExported");
    case "themeExportFailed":
      return t("settings.themeExportFailed");
    case "themeImported":
      return t("settings.themeImported");
    case "themeImportFailed":
      return t("settings.themeImportFailed");
  }
}

function SelectionToolbox(props: {
  position: Point;
  nodeCount: number;
  commentCount: number;
  linkCount: number;
  incidentLinkCount: number;
  hasBreakpoint: boolean;
  activeCommentColor?: string;
  canDuplicate: boolean;
  canCollapseToMacro: boolean;
  canCollapseToFunction: boolean;
  canToggleDisable: boolean;
  selectionDisabled: boolean;
  canToggleBreakpoint: boolean;
  t: Translator;
  onDelete(): void;
  onFrame(): void;
  onShowInfo(): void;
  onCreateComment(): void;
  onDuplicate(): void;
  onCollapseToMacro(): void;
  onCollapseToFunction(): void;
  onToggleDisable(): void;
  onBreakLinks(): void;
  onToggleBreakpoint(): void;
  onCommentColor(color: string): void;
}): JSX.Element {
  const label = [
    props.nodeCount ? props.t("selection.nodeCount", { count: props.nodeCount }) : "",
    props.commentCount ? props.t("selection.commentCount", { count: props.commentCount }) : "",
    props.linkCount ? props.t("selection.wireCount", { count: props.linkCount }) : ""
  ].filter(Boolean).join(", ");

  const activeColor = normalizeColorInput(props.activeCommentColor ?? fallbackCommentColor);
  return (
    <div
      className="selection-toolbox"
      style={{ left: props.position.x, top: props.position.y }}
      aria-label={props.t("selection.toolbox")}
      title={label || props.t("selection.selection")}
      onPointerDown={isolateOverlayEvent}
      onWheel={isolateOverlayEvent}
      onContextMenu={isolateOverlayContextMenu}
    >
      <button type="button" title={props.t("selection.frame")} onClick={props.onFrame}>
        <Focus size={14} />
      </button>
      <button type="button" title={props.t("selection.showInfo")} onClick={props.onShowInfo}>
        <Info size={14} />
      </button>
      <button type="button" title={props.t("selection.createComment")} onClick={props.onCreateComment}>
        <StickyNote size={14} />
      </button>
      <button type="button" title={props.t("selection.duplicate")} onClick={props.onDuplicate} disabled={!props.canDuplicate}>
        <Copy size={14} />
      </button>
      <button type="button" title={props.t("selection.collapseMacro")} onClick={props.onCollapseToMacro} disabled={!props.canCollapseToMacro}>
        <PackageIcon size={14} />
      </button>
      <button type="button" title={props.t("selection.collapseFunction")} onClick={props.onCollapseToFunction} disabled={!props.canCollapseToFunction}>
        <GitBranch size={14} />
      </button>
      <button
        type="button"
        className={props.selectionDisabled ? "active" : ""}
        title={props.selectionDisabled ? props.t("selection.enableNodes") : props.t("selection.disableNodes")}
        onClick={props.onToggleDisable}
        disabled={!props.canToggleDisable}
      >
        <Power size={14} />
      </button>
      <button type="button" title={props.t("selection.breakLinks")} onClick={props.onBreakLinks} disabled={!props.incidentLinkCount}>
        <Unlink size={14} />
      </button>
      <button
        type="button"
        className={props.hasBreakpoint ? "active danger" : ""}
        title={props.hasBreakpoint ? props.t("selection.clearBreakpoint") : props.t("selection.addBreakpoint")}
        onClick={props.onToggleBreakpoint}
        disabled={!props.canToggleBreakpoint}
      >
        <CircleDot size={14} />
      </button>
      {props.commentCount ? (
        <CommentColorControls
          colors={commentColorPalette.slice(0, 4)}
          activeColor={activeColor}
          t={props.t}
          labelKey="selection.commentColors"
          titleKey="selection.setCommentColor"
          onChange={props.onCommentColor}
        />
      ) : null}
      <button type="button" title={props.t("selection.delete")} onClick={props.onDelete}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function CommentColorControls(props: {
  colors: string[];
  activeColor: string;
  t: Translator;
  labelKey: string;
  titleKey: string;
  onChange(color: string): void;
}): JSX.Element {
  const activeColor = normalizeColorInput(props.activeColor);
  return (
    <span className="comment-color-row" aria-label={props.t(props.labelKey)}>
      {props.colors.map((color) => {
        const normalizedColor = normalizeColorInput(color);
        return (
          <button
            key={normalizedColor}
            type="button"
            className={normalizedColor === activeColor ? "comment-swatch active" : "comment-swatch"}
            style={{ background: normalizedColor, "--comment-color": normalizedColor } as CSSProperties}
            title={props.t(props.titleKey, { color: normalizedColor })}
            onClick={() => props.onChange(normalizedColor)}
          />
        );
      })}
      <label className="comment-swatch comment-swatch-custom" title={props.t("comment.customColor")} style={{ "--comment-color": activeColor } as CSSProperties}>
        <input
          type="color"
          value={activeColor}
          aria-label={props.t("comment.customColor")}
          onChange={(event) => props.onChange(event.target.value)}
        />
        <span style={{ background: activeColor }} />
      </label>
    </span>
  );
}

function GraphMinimap(props: {
  graph: BlueprintGraph;
  templates: BlueprintNodeTemplate[];
  canvasSize: { width: number; height: number };
  categoryAccents: CategoryAccentMap;
  t: Translator;
  onCenter(point: Point): void;
}): JSX.Element | null {
  if (!props.graph.nodes.length) {
    return null;
  }

  const width = 164;
  const height = 104;
  const bounds = minimapContentBounds(props.graph, props.templates);
  const scale = Math.min((width - 16) / Math.max(bounds.width, 1), (height - 16) / Math.max(bounds.height, 1));
  const contentWidth = bounds.width * scale;
  const contentHeight = bounds.height * scale;
  const offset = {
    x: (width - contentWidth) / 2,
    y: (height - contentHeight) / 2
  };
  const viewport = props.graph.layout.viewport;
  const visibleGraphRect: Rect = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: props.canvasSize.width / viewport.zoom,
    height: props.canvasSize.height / viewport.zoom
  };
  const viewportRect = projectMinimapRect(visibleGraphRect, bounds, scale, offset, width, height);

  const graphPointFromEvent = (event: React.PointerEvent<HTMLButtonElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clientX = Number.isFinite(event.clientX) ? event.clientX : rect.left + rect.width / 2;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : rect.top + rect.height / 2;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    return {
      x: bounds.x + (localX - offset.x) / scale,
      y: bounds.y + (localY - offset.y) / scale
    };
  };

  return (
    <button
      className="minimap"
      title={props.t("settings.minimap")}
      aria-label={props.t("settings.minimap")}
      onPointerDown={(event) => {
        preventOverlayDefault(event);
        props.onCenter(graphPointFromEvent(event));
      }}
      onContextMenu={isolateOverlayContextMenu}
    >
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
        {graphComments(props.graph).map((comment) => {
          const rect = projectMinimapRect(
            { x: comment.position.x, y: comment.position.y, width: comment.size.width, height: comment.size.height },
            bounds,
            scale,
            offset,
            width,
            height
          );
          return <rect key={comment.id} className="minimap-comment" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />;
        })}
        {props.graph.nodes.map((node) => {
          const template = getEffectiveTemplateForNode(props.graph, props.templates, node);
          const rect = projectMinimapRect(nodeBounds(props.graph, props.templates, node), bounds, scale, offset, width, height);
          return (
            <rect
              key={node.id}
              className={isRoutingHubTemplate(template) ? "minimap-node minimap-node-hub" : "minimap-node"}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill={nodeAccentForTemplate(template, props.categoryAccents)}
            />
          );
        })}
        <rect className="minimap-viewport" x={viewportRect.x} y={viewportRect.y} width={viewportRect.width} height={viewportRect.height} />
      </svg>
    </button>
  );
}

function Port(props: {
  port: BlueprintPortDefinition;
  template: BlueprintNodeTemplate | undefined;
  locale: Locale;
  nodeLabelMode: NodeLabelMode;
  side: "left" | "right";
  highlighted?: boolean;
  compatibility?: PortCompatibility;
  onPointerDown(event: React.PointerEvent<HTMLButtonElement>): void;
  onContextMenu(event: React.MouseEvent<HTMLButtonElement>): void;
  onPointerUp?(): void;
}): JSX.Element {
  const className = `port ${props.side} ${props.port.flowKind}${props.highlighted ? " issue-focus" : ""}${props.compatibility ? ` ${props.compatibility}` : ""}`;
  const portText = displayPortText(props.template, props.port, props.locale, props.nodeLabelMode);
  return (
    <button
      className={className}
      title={`${portText.name}: ${props.port.type}${portText.description ? ` · ${portText.description}` : ""}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        props.onPointerDown(event);
      }}
      onContextMenu={props.onContextMenu}
      onPointerUp={(event) => {
        event.stopPropagation();
        props.onPointerUp?.();
      }}
    >
      <span className="pin" />
      <span className="port-label">{portText.name}</span>
    </button>
  );
}

function Wire(props: {
  graph: BlueprintGraph;
  templates: BlueprintNodeTemplate[];
  link: BlueprintLink;
  renderMode: LinkRenderMode;
  selected: boolean;
  onSelect(event: React.PointerEvent<SVGPathElement>): void;
  onContextMenu(event: React.MouseEvent<SVGPathElement>): void;
  onDoubleClick(event: React.MouseEvent<SVGPathElement>): void;
}): JSX.Element | null {
  const start = portPoint(props.graph, props.templates, props.link.fromNodeId, props.link.fromPortId);
  const end = portPoint(props.graph, props.templates, props.link.toNodeId, props.link.toPortId);
  if (!start || !end) {
    return null;
  }
  return (
    <path
      className={`wire ${props.link.flowKind}${props.selected ? " selected" : ""}`}
      data-link-id={props.link.id}
      d={linkPath(start, end, props.renderMode)}
      onPointerDown={(event) => {
        event.stopPropagation();
        props.onSelect(event);
      }}
      onContextMenu={props.onContextMenu}
      onDoubleClick={props.onDoubleClick}
    />
  );
}

function WireContextMenu(props: {
  t: Translator;
  position: Point;
  link: BlueprintLink | undefined;
  onDelete(): void;
  onRoute(): void;
  onClose(): void;
}): JSX.Element {
  const label = props.link ? `${props.link.flowKind} ${props.t("contextMenu.wire")} ${props.link.id}` : props.t("contextMenu.wire");
  return (
    <div
      className="wire-menu"
      style={{ left: props.position.x, top: props.position.y }}
      onPointerDown={isolateOverlayEvent}
      onContextMenu={isolateOverlayContextMenu}
    >
      <div className="wire-menu-title">{label}</div>
      <button onClick={props.onRoute} disabled={!props.link} title={props.t("contextMenu.insertRoutingHubTitle")}>
        <Route size={14} /> {props.t("contextMenu.insertRoutingHub")}
      </button>
      <button onClick={props.onDelete} disabled={!props.link} title={props.t("contextMenu.deleteWireTitle")}>
        <XCircle size={14} /> {props.t("contextMenu.deleteWire")}
      </button>
      <button onClick={props.onClose} title={props.t("contextMenu.closeWireMenu")}>{props.t("common.close")}</button>
    </div>
  );
}

function NodeContextMenu(props: {
  t: Translator;
  position: Point;
  node: BlueprintNodeInstance | undefined;
  nodeCount: number;
  linkCount: number;
  hasBreakpoint: boolean;
  onDuplicate(): void;
  onDelete(): void;
  onBreakLinks(): void;
  onToggleBreakpoint(): void;
  onAddBookmark(): void;
  onClose(): void;
}): JSX.Element {
  const label = props.nodeCount > 1 ? props.t("contextMenu.nodeCount", { count: props.nodeCount }) : props.node?.id ?? props.t("contextMenu.node");
  return (
    <div
      className="node-menu"
      style={{ left: props.position.x, top: props.position.y }}
      onPointerDown={isolateOverlayEvent}
      onContextMenu={isolateOverlayContextMenu}
    >
      <div className="node-menu-title">{label}</div>
      <button onClick={props.onDuplicate} disabled={!props.node} title={props.t("contextMenu.duplicateNodeSelectionTitle")}>
        <Copy size={14} /> {props.t("contextMenu.duplicate")}
      </button>
      <button onClick={props.onDelete} disabled={!props.node} title={props.t("contextMenu.deleteNodeSelectionTitle")}>
        <XCircle size={14} /> {props.t("contextMenu.delete")}
      </button>
      <button onClick={props.onBreakLinks} disabled={!props.node || !props.linkCount} title={props.t("contextMenu.breakNodeSelectionLinksTitle")}>
        <Unlink size={14} /> {props.t("contextMenu.breakLinks")}
      </button>
      <button onClick={props.onToggleBreakpoint} disabled={!props.node || props.nodeCount !== 1} title={props.t("contextMenu.toggleBreakpointTitle")}>
        <CircleDot size={14} /> {props.hasBreakpoint ? props.t("contextMenu.clearBreakpoint") : props.t("contextMenu.addBreakpoint")}
      </button>
      <button onClick={props.onAddBookmark} disabled={!props.node || props.nodeCount !== 1} title={props.t("contextMenu.addNodeBookmarkTitle")}>
        <BookmarkPlus size={14} /> {props.t("contextMenu.addBookmark")}
      </button>
      <button onClick={props.onClose} title={props.t("contextMenu.closeNodeMenu")}>{props.t("common.close")}</button>
    </div>
  );
}

function CommentContextMenu(props: {
  t: Translator;
  position: Point;
  comment: BlueprintCommentBox | undefined;
  onFocus(): void;
  onRewrap(): void;
  onAddBookmark(): void;
  onDelete(): void;
  onClose(): void;
}): JSX.Element {
  const label = props.comment?.title || props.comment?.id || props.t("contextMenu.comment");
  const canRewrap = Boolean(props.comment?.nodeIds.length);
  return (
    <div
      className="comment-menu"
      style={{ left: props.position.x, top: props.position.y }}
      onPointerDown={isolateOverlayEvent}
      onContextMenu={isolateOverlayContextMenu}
    >
      <div className="comment-menu-title">{label}</div>
      <button onClick={props.onFocus} disabled={!props.comment} title={props.t("contextMenu.focusCommentTitle")}>
        <Focus size={14} /> {props.t("contextMenu.focusComment")}
      </button>
      <button onClick={props.onRewrap} disabled={!props.comment || !canRewrap} title={props.t("contextMenu.rewrapNodesTitle")}>
        <StickyNote size={14} /> {props.t("contextMenu.rewrapNodes")}
      </button>
      <button onClick={props.onAddBookmark} disabled={!props.comment} title={props.t("contextMenu.addCommentBookmarkTitle")}>
        <BookmarkPlus size={14} /> {props.t("contextMenu.addBookmark")}
      </button>
      <button onClick={props.onDelete} disabled={!props.comment} title={props.t("contextMenu.deleteCommentTitle")}>
        <XCircle size={14} /> {props.t("contextMenu.deleteComment")}
      </button>
      <button onClick={props.onClose} title={props.t("contextMenu.closeCommentMenu")}>{props.t("common.close")}</button>
    </div>
  );
}

function PortContextMenu(props: {
  t: Translator;
  position: Point;
  node: BlueprintNodeInstance | undefined;
  port: BlueprintPortDefinition | undefined;
  linkCount: number;
  onBreakLinks(): void;
  onClose(): void;
}): JSX.Element {
  const label = props.node && props.port ? `${props.node.id}.${props.port.id}` : props.t("contextMenu.port");
  return (
    <div
      className="port-menu"
      style={{ left: props.position.x, top: props.position.y }}
      onPointerDown={isolateOverlayEvent}
      onContextMenu={isolateOverlayContextMenu}
    >
      <div className="port-menu-title">{label}</div>
      <button onClick={props.onBreakLinks} disabled={!props.port || !props.linkCount} title={props.t("contextMenu.breakPortLinksTitle")}>
        <XCircle size={14} /> {props.t("contextMenu.breakLinks")} {props.linkCount ? `(${props.linkCount})` : ""}
      </button>
      <button onClick={props.onClose} title={props.t("contextMenu.closePortMenu")}>{props.t("common.close")}</button>
    </div>
  );
}

function PreviewWire(props: { graph: BlueprintGraph; templates: BlueprintNodeTemplate[]; dragPort: DragPort; pointer: Point }): JSX.Element | null {
  const start = portPoint(props.graph, props.templates, props.dragPort.nodeId, props.dragPort.portId);
  if (!start) {
    return null;
  }
  const from = props.dragPort.direction === "output" ? start : props.pointer;
  const to = props.dragPort.direction === "output" ? props.pointer : start;
  return <path className={`wire preview ${props.dragPort.flowKind}`} d={linkPath(from, to, "spline")} />;
}

function MarqueeRect(props: { marquee: MarqueeSelection }): JSX.Element {
  const rect = normalizeRect(props.marquee.start, props.marquee.current);
  return <div className="marquee" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />;
}

function NodeCreationPanel(props: {
  position: Point;
  size: NodePanelSize;
  sourcePort?: DragPort;
  search: string;
  categories: TemplateCategorySummary[];
  activeCategory: string;
  candidates: BlueprintNodeTemplate[];
  activeIndex: number;
  favoriteTemplateIds: Set<string>;
  t: Translator;
  locale: Locale;
  nodeLabelMode: NodeLabelMode;
  onSearch(value: string): void;
  onCategoryChange(category: string): void;
  onActiveIndexChange(index: number): void;
  onPick(template: BlueprintNodeTemplate): void;
  onToggleFavorite(templateId: string): void;
  onResize(size: NodePanelSize): void;
  onClose(): void;
}): JSX.Element {
  const activeCandidate = props.candidates[props.activeIndex] ?? props.candidates[0];
  const activeCompatiblePort = props.sourcePort && activeCandidate ? compatiblePortsForTemplate(activeCandidate, props.sourcePort)[0] : undefined;
  const emptyState = nodeCreationEmptyState(props.search, props.activeCategory, props.sourcePort, props.t);
  const panelSize = clampedNodePanelSize(props.size, Boolean(props.sourcePort));
  const panelPosition = clampedNodePanelPosition(props.position, Boolean(props.sourcePort), panelSize);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; size: NodePanelSize } | undefined>();
  const moveActive = (delta: number) => {
    if (!props.candidates.length) {
      return;
    }
    props.onActiveIndexChange((props.activeIndex + delta + props.candidates.length) % props.candidates.length);
  };
  const moveCategory = (delta: number) => {
    if (!props.categories.length) {
      return;
    }
    const currentIndex = Math.max(0, props.categories.findIndex((category) => category.id === props.activeCategory));
    const nextCategory = props.categories[(currentIndex + delta + props.categories.length) % props.categories.length];
    props.onCategoryChange(nextCategory.id);
  };
  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event.currentTarget, event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      size: panelSize
    };
  };
  const resizePanel = (event: React.PointerEvent<HTMLDivElement>) => {
    const resizing = resizeRef.current;
    if (!resizing || resizing.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.onResize(clampedNodePanelSize({
      width: resizing.size.width + event.clientX - resizing.startX,
      height: resizing.size.height + event.clientY - resizing.startY
    }, Boolean(props.sourcePort)));
  };
  const stopResize = (event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId === event.pointerId) {
      resizeRef.current = undefined;
    }
  };

  return (
    <div
      className={props.sourcePort ? "node-panel pin-aware" : "node-panel"}
      style={{ left: panelPosition.x, top: panelPosition.y, width: panelSize.width, height: panelSize.height }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={resizePanel}
      onPointerUp={stopResize}
      onPointerCancel={stopResize}
      onWheel={isolateOverlayEvent}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveActive(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveActive(-1);
        } else if (event.key === "PageDown") {
          event.preventDefault();
          moveActive(5);
        } else if (event.key === "PageUp") {
          event.preventDefault();
          moveActive(-5);
        } else if (event.ctrlKey && event.key === "ArrowRight") {
          event.preventDefault();
          moveCategory(1);
        } else if (event.ctrlKey && event.key === "ArrowLeft") {
          event.preventDefault();
          moveCategory(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          props.onActiveIndexChange(0);
        } else if (event.key === "End") {
          event.preventDefault();
          props.onActiveIndexChange(Math.max(0, props.candidates.length - 1));
        } else if (event.key === "Enter" && activeCandidate) {
          event.preventDefault();
          props.onPick(activeCandidate);
        } else if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div className="search-row">
        <Search size={15} />
        <input autoFocus value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder={props.t("nodeCreation.searchPlaceholder")} />
        <button onClick={props.onClose}>Esc</button>
      </div>
      {props.sourcePort ? <PinCreationHint sourcePort={props.sourcePort} targetTemplate={activeCandidate} targetPort={activeCompatiblePort} t={props.t} locale={props.locale} nodeLabelMode={props.nodeLabelMode} /> : null}
      <div className="candidate-grid">
        <div className="candidate-column categories">
          {props.categories.map((category) => (
            <button
              key={category.id}
              className={props.activeCategory === category.id ? "category-filter active" : "category-filter"}
              title={props.t("nodeCreation.filterCategory", { category: category.name })}
              onClick={() => props.onCategoryChange(category.id)}
            >
              <span>{category.name}</span>
              <small>{category.count}</small>
            </button>
          ))}
        </div>
        <div className="candidate-column templates">
          {props.candidates.length ? (
            props.candidates.map((template, index) => {
              const compatiblePort = props.sourcePort ? compatiblePortsForTemplate(template, props.sourcePort)[0] : undefined;
              const templateText = displayTemplateText(template, props.locale, props.nodeLabelMode);
              const compatiblePortText = compatiblePort ? displayPortText(template, compatiblePort, props.locale, props.nodeLabelMode) : undefined;
              return (
                <div key={template.id} className={index === props.activeIndex ? "candidate active" : "candidate"}>
                  <button className="candidate-main" onMouseEnter={() => props.onActiveIndexChange(index)} onClick={() => props.onPick(template)}>
                    <strong>{templateText.name}</strong>
                    <span>{templateText.creationPath}</span>
                    {compatiblePort ? (
                      <small className="candidate-compatibility" title={pinCreationTargetTitle(props.sourcePort!, compatiblePort, props.t, template, props.locale, props.nodeLabelMode)}>
                        {props.t("nodeCreation.connectsTo", { port: compatiblePortText?.name ?? compatiblePort.name })}
                      </small>
                    ) : null}
                  </button>
                  <button
                    className={props.favoriteTemplateIds.has(template.id) ? "favorite active" : "favorite"}
                    title={props.favoriteTemplateIds.has(template.id) ? props.t("nodeCreation.unfavoriteTemplate") : props.t("nodeCreation.favoriteTemplate")}
                    onClick={() => props.onToggleFavorite(template.id)}
                  >
                    <Star size={14} />
                  </button>
                </div>
              );
            })
          ) : (
            <div className="candidate-empty" role="status">
              <strong>{emptyState.title}</strong>
              <span>{emptyState.description}</span>
            </div>
          )}
        </div>
        <div className="candidate-column details">
          {activeCandidate ? (() => {
            const activeCandidateText = displayTemplateText(activeCandidate, props.locale, props.nodeLabelMode);
            const activeCompatiblePortText = activeCompatiblePort ? displayPortText(activeCandidate, activeCompatiblePort, props.locale, props.nodeLabelMode) : undefined;
            return (
            <>
              <strong>{activeCandidateText.name}</strong>
              <p>{activeCandidateText.description}</p>
              <small>{props.t("nodeCreation.portCounts", { inputs: activeCandidate.inputs.length, outputs: activeCandidate.outputs.length })}</small>
              {props.sourcePort && activeCompatiblePort ? (
                <div className="template-compatible-target" title={pinCreationTargetTitle(props.sourcePort, activeCompatiblePort, props.t, activeCandidate, props.locale, props.nodeLabelMode)}>
                  <GitBranch size={12} />
                  <span>{props.t("nodeCreation.autoConnectsTo", { port: activeCompatiblePortText?.name ?? activeCompatiblePort.name, type: activeCompatiblePort.type })}</span>
                </div>
              ) : null}
              <TemplatePortSummary template={activeCandidate} t={props.t} locale={props.locale} nodeLabelMode={props.nodeLabelMode} />
            </>
            );
          })() : (
            <p className="candidate-empty-detail">{props.t("nodeCreation.chooseAnotherCategory")}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        className="node-panel-resize"
        title={props.t("nodeCreation.resizePanel")}
        aria-label={props.t("nodeCreation.resizePanel")}
        onPointerDown={startResize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
      />
    </div>
  );
}

function clampedNodePanelSize(size: NodePanelSize, pinAware: boolean): NodePanelSize {
  const margin = 20;
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const minWidth = 560;
  const minHeight = pinAware ? 350 : 316;
  const maxWidth = Math.max(minWidth, viewportWidth - margin * 2);
  const maxHeight = Math.max(minHeight, viewportHeight - margin * 2);
  return {
    width: Math.round(clamp(size.width, minWidth, maxWidth)),
    height: Math.round(clamp(size.height, minHeight, maxHeight))
  };
}

function clampedNodePanelPosition(position: Point, pinAware: boolean, size: NodePanelSize = clampedNodePanelSize(defaultNodePanelSize, pinAware)): Point {
  const margin = 20;
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const x = Number.isFinite(position.x) ? position.x : margin;
  const y = Number.isFinite(position.y) ? position.y : margin;
  return {
    x: clamp(x, margin, Math.max(margin, viewportWidth - size.width - margin)),
    y: clamp(y, margin, Math.max(margin, viewportHeight - size.height - margin))
  };
}

function nodeCreationEmptyState(search: string, activeCategory: string, sourcePort: DragPort | undefined, t: Translator): { title: string; description: string } {
  const query = search.trim();
  if (sourcePort) {
    return {
      title: t("nodeCreation.noCompatibleTemplates"),
      description: query
        ? t("nodeCreation.noCompatibleTemplatesQuery", { query, flowKind: sourcePort.flowKind, type: sourcePort.type })
        : t("nodeCreation.noCompatibleTemplatesDescription", { flowKind: sourcePort.flowKind, type: sourcePort.type })
    };
  }
  if (activeCategory === favoriteTemplateCategoryId) {
    return {
      title: t("nodeCreation.noFavoriteTemplates"),
      description: query ? t("nodeCreation.noFavoriteTemplatesQuery", { query }) : t("nodeCreation.noFavoriteTemplatesDescription")
    };
  }
  if (activeCategory === recentTemplateCategoryId) {
    return {
      title: t("nodeCreation.noRecentTemplates"),
      description: query ? t("nodeCreation.noRecentTemplatesQuery", { query }) : t("nodeCreation.noRecentTemplatesDescription")
    };
  }
  if (query) {
    return {
      title: t("nodeCreation.noMatchingTemplates"),
      description: activeCategory === allTemplateCategoryId
        ? t("nodeCreation.noTemplatesMatchQuery", { query })
        : t("nodeCreation.noCategoryTemplatesMatchQuery", { category: activeCategory.replace(/^category:/, ""), query })
    };
  }
  return {
    title: t("nodeCreation.noTemplatesAvailable"),
    description: activeCategory === allTemplateCategoryId
      ? t("nodeCreation.noTemplatesAvailableDescription")
      : t("nodeCreation.noCategoryTemplatesAvailable", { category: activeCategory.replace(/^category:/, "") })
  };
}

function PinCreationHint(props: {
  sourcePort: DragPort;
  targetTemplate?: BlueprintNodeTemplate;
  targetPort?: BlueprintPortDefinition;
  t: Translator;
  locale: Locale;
  nodeLabelMode: NodeLabelMode;
}): JSX.Element {
  const sourceDirection = props.sourcePort.direction === "output" ? "output" : "input";
  const targetDirection = props.sourcePort.direction === "output" ? "input" : "output";
  const targetPortText = props.targetPort ? displayPortText(props.targetTemplate, props.targetPort, props.locale, props.nodeLabelMode) : undefined;
  return (
    <div className="pin-creation-hint" title={props.targetPort ? pinCreationTargetTitle(props.sourcePort, props.targetPort, props.t, props.targetTemplate, props.locale, props.nodeLabelMode) : undefined}>
      <GitBranch size={13} />
      <span>
        {props.t("nodeCreation.fromPin", { direction: sourceDirection, flowKind: props.sourcePort.flowKind })} <strong>{props.sourcePort.type}</strong>
      </span>
      <small>
        {props.targetPort
          ? props.t("nodeCreation.willConnectTo", { direction: targetDirection, port: targetPortText?.name ?? props.targetPort.name })
          : props.t("nodeCreation.showingCompatiblePorts", { direction: targetDirection })}
      </small>
    </div>
  );
}

function TemplatePortSummary(props: { template: BlueprintNodeTemplate; t: Translator; locale: Locale; nodeLabelMode: NodeLabelMode }): JSX.Element {
  const groups: Array<{ label: string; ports: BlueprintPortDefinition[] }> = [
    { label: props.t("templatePorts.controlIn"), ports: props.template.controlInputs },
    { label: props.t("templatePorts.controlOut"), ports: props.template.controlOutputs },
    { label: props.t("templatePorts.dataIn"), ports: props.template.inputs },
    { label: props.t("templatePorts.dataOut"), ports: props.template.outputs }
  ].filter((group) => group.ports.length);

  if (!groups.length) {
    return <div className="template-port-summary empty">{props.t("templatePorts.noPorts")}</div>;
  }

  return (
    <div className="template-port-summary">
      {groups.map((group) => (
        <div key={group.label} className="template-port-group">
          <div className="template-port-group-title">{group.label}</div>
          {group.ports.map((port) => {
            const portText = displayPortText(props.template, port, props.locale, props.nodeLabelMode);
            return (
            <div key={port.id} className="template-port-row" title={portText.description}>
              <span className={`template-port-kind ${port.flowKind}`}>{port.flowKind}</span>
              <strong>{portText.name}</strong>
              <small>{port.type}</small>
              <p>{portText.description}</p>
            </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function CommentInspector(props: {
  comment: BlueprintCommentBox;
  t: Translator;
  onTitleChange(comment: BlueprintCommentBox, title: string): void;
  onSizeChange(comment: BlueprintCommentBox, size: { width: number; height: number }): void;
  onColorChange(comment: BlueprintCommentBox, color: string): void;
}): JSX.Element {
  const color = normalizeColorInput(props.comment.color ?? fallbackCommentColor);
  return (
    <div className="inspector-body">
      <div className="node-summary">
        <strong>{props.t("inspector.commentBox")}</strong>
        <span>{props.t("inspector.groupedNodes", { count: props.comment.nodeIds.length })}</span>
      </div>
      <section className="inspector-section">
        <h3>{props.t("inspector.comment")}</h3>
        <label className="field">
          <span>{props.t("inspector.title")}</span>
          <input value={props.comment.title} onChange={(event) => props.onTitleChange(props.comment, event.target.value)} />
        </label>
        <label className="field">
          <span>{props.t("inspector.width")}</span>
          <input
            type="number"
            min={120}
            max={2400}
            value={props.comment.size.width}
            onChange={(event) => props.onSizeChange(props.comment, { ...props.comment.size, width: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>{props.t("inspector.height")}</span>
          <input
            type="number"
            min={80}
            max={1800}
            value={props.comment.size.height}
            onChange={(event) => props.onSizeChange(props.comment, { ...props.comment.size, height: Number(event.target.value) })}
          />
        </label>
        <div className="field">
          <span>{props.t("inspector.color")}</span>
          <CommentColorControls
            colors={commentColorPalette}
            activeColor={color}
            t={props.t}
            labelKey="selection.commentColors"
            titleKey="inspector.setCommentColor"
            onChange={(nextColor) => props.onColorChange(props.comment, nextColor)}
          />
        </div>
      </section>
    </div>
  );
}

function Inspector(props: {
  graph: BlueprintGraph;
  node: BlueprintNodeInstance;
  template: BlueprintNodeTemplate;
  issues: ValidationIssue[];
  focusedIssueKey?: string;
  t: Translator;
  locale: Locale;
  nodeLabelMode: NodeLabelMode;
  onIssueFocus(issue: ValidationIssue): void;
  onLiteralChange(node: BlueprintNodeInstance, port: BlueprintPortDefinition, value: unknown): void;
  onUnlink(node: BlueprintNodeInstance, port: BlueprintPortDefinition): void;
}): JSX.Element {
  const templateText = displayTemplateText(props.template, props.locale, props.nodeLabelMode);
  return (
    <div className="inspector-body">
      <div className="node-summary">
        <strong>{templateText.name}</strong>
        <span>{templateText.description}</span>
      </div>
      <InspectorPortGroup title={props.t("inspector.controlInputs")} template={props.template} ports={props.template.controlInputs} node={props.node} graph={props.graph} t={props.t} locale={props.locale} nodeLabelMode={props.nodeLabelMode} onUnlink={props.onUnlink} />
      <InspectorPortGroup title={props.t("inspector.inputs")} template={props.template} ports={props.template.inputs} node={props.node} graph={props.graph} t={props.t} locale={props.locale} nodeLabelMode={props.nodeLabelMode} onLiteralChange={props.onLiteralChange} onUnlink={props.onUnlink} />
      <InspectorPortGroup title={props.t("inspector.outputs")} template={props.template} ports={props.template.outputs} node={props.node} graph={props.graph} t={props.t} locale={props.locale} nodeLabelMode={props.nodeLabelMode} />
      {props.issues.length ? (
        <div className="issue-list">
          {props.issues.map((issue) => (
            <button
              key={issueKey(issue)}
              className={props.focusedIssueKey === issueKey(issue) ? `issue-item ${issue.severity} active` : `issue-item ${issue.severity}`}
              onClick={() => props.onIssueFocus(issue)}
            >
              <span>{issue.message}</span>
              {diagnosticLocationText(issue) ? <small>{diagnosticLocationText(issue)}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DiagnosticStrip(props: {
  issues: ValidationIssue[];
  focusedIssueKey?: string;
  compileMessage: string;
  refactorResult?: RefactorResultMessage;
  runtimeOutput?: RuntimeHistoryEntry;
  runtimeHistory: RuntimeHistoryEntry[];
  activeRuntimeTraceIndex?: number;
  t: Translator;
  traceLabel: RuntimeTraceLabeler;
  onIssueFocus(issue: ValidationIssue): void;
  onRuntimeHistorySelect(entry: RuntimeHistoryEntry): void;
  onRuntimeHistoryRename(entry: RuntimeHistoryEntry): void;
  onRuntimeHistoryPin(entry: RuntimeHistoryEntry): void;
  onRuntimeHistoryDelete(entry: RuntimeHistoryEntry): void;
  onRuntimeHistoryClear(): void;
  onRuntimeTraceStep(index: number): void;
}): JSX.Element {
  if (!props.issues.length) {
    if (props.runtimeOutput) {
      const compareEntry = previousRuntimeHistoryEntry(props.runtimeHistory, props.runtimeOutput.id);
      return (
        <>
          <span className={props.runtimeOutput.ok ? "output-message runtime-ok" : "output-message runtime-error"} title={props.runtimeOutput.text}>
            {runtimeOutputHeading(props.runtimeOutput, props.t)}: {props.runtimeOutput.text}
          </span>
          {!props.runtimeOutput.ok ? <RuntimeErrorSummary entry={props.runtimeOutput} t={props.t} traceLabel={props.traceLabel} onStep={props.onRuntimeTraceStep} /> : null}
          <RuntimeTraceStepper entry={props.runtimeOutput} activeIndex={props.activeRuntimeTraceIndex} t={props.t} traceLabel={props.traceLabel} onStep={props.onRuntimeTraceStep} />
          <RuntimeTraceDetails entry={props.runtimeOutput} compareEntry={compareEntry} activeIndex={props.activeRuntimeTraceIndex} t={props.t} traceLabel={props.traceLabel} onStep={props.onRuntimeTraceStep} />
          <RuntimeHistoryBar
            history={props.runtimeHistory}
            activeId={props.runtimeOutput.id}
            t={props.t}
            onSelect={props.onRuntimeHistorySelect}
            onRename={props.onRuntimeHistoryRename}
            onPin={props.onRuntimeHistoryPin}
            onDelete={props.onRuntimeHistoryDelete}
            onClear={props.onRuntimeHistoryClear}
          />
        </>
      );
    }
    if (props.refactorResult) {
      return (
        <span className={props.refactorResult.ok ? "output-message refactor-ok" : "output-message refactor-error"}>
          {props.refactorResult.message}
        </span>
      );
    }
    return <span className="output-message">{props.compileMessage || props.t("common.ready")}</span>;
  }

  return (
    <span className={props.issues.some((issue) => issue.severity === "error") ? "output-message runtime-error" : "output-message warning"}>
      {props.issues.some((issue) => issue.severity === "error")
        ? props.t("common.errors", { count: props.issues.filter((issue) => issue.severity === "error").length })
        : props.t("common.warnings", { count: props.issues.length })}
    </span>
  );
}

function RunLogIssueList(props: {
  issues: ValidationIssue[];
  t: Translator;
  onIssueFocus(issue: ValidationIssue): void;
}): JSX.Element {
  const [copiedKey, setCopiedKey] = useState<string | undefined>();
  const [failedKey, setFailedKey] = useState<string | undefined>();
  const copyIssue = async (issue: ValidationIssue) => {
    const key = issueKey(issue);
    try {
      await writeTextToClipboard(formatDiagnosticCopyText(issue));
      setCopiedKey(key);
      setFailedKey(undefined);
    } catch {
      setCopiedKey(undefined);
      setFailedKey(key);
    }
  };

  return (
    <div className="run-log-list">
      {props.issues.map((issue) => {
        const key = issueKey(issue);
        const location = diagnosticLocationText(issue);
        const copyTitle = failedKey === key
          ? props.t("runPanel.copyLogFailed")
          : copiedKey === key
            ? props.t("runPanel.copyLogCopied")
            : props.t("runPanel.copyLog");
        return (
          <div key={key} className={`run-log-issue ${issue.severity}`}>
            <button type="button" className="run-log-issue-focus" onClick={() => props.onIssueFocus(issue)}>
              <strong>{issue.severity}</strong>
              <span>{issue.message}</span>
              {location ? <small>{location}</small> : null}
            </button>
            <button type="button" className="run-log-copy" title={copyTitle} aria-label={copyTitle} onClick={() => copyIssue(issue)}>
              <Copy size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function RuntimeErrorSummary(props: {
  entry: RuntimeHistoryEntry;
  t: Translator;
  traceLabel: RuntimeTraceLabeler;
  onStep(index: number): void;
}): JSX.Element {
  const errorTraceIndexes = props.entry.traces
    .map((trace, index) => ({ trace, index }))
    .filter(({ trace }) => trace.status === "error");
  const firstError = errorTraceIndexes[0];
  const errorCount = errorTraceIndexes.length || 1;
  return (
    <span className="runtime-error-summary">
      <AlertTriangle size={13} />
      <strong>{props.t("runtime.errorCount", { count: errorCount })}</strong>
      {firstError ? (
        <button
          type="button"
          title={props.t("runtime.focusFirstError")}
          onClick={() => props.onStep(firstError.index)}
        >
          {runtimeTraceNodeLabel(firstError.trace, props.traceLabel)}
        </button>
      ) : (
        <span>{props.entry.message}</span>
      )}
    </span>
  );
}

function RuntimeTraceStepper(props: {
  entry: RuntimeHistoryEntry;
  activeIndex?: number;
  t: Translator;
  traceLabel: RuntimeTraceLabeler;
  onStep(index: number): void;
}): JSX.Element | null {
  if (!props.entry.traces.length) {
    return null;
  }
  const activeIndex = clamp(props.activeIndex ?? 0, 0, props.entry.traces.length - 1);
  const trace = props.entry.traces[activeIndex];
  const label = runtimeTraceNodeLabel(trace, props.traceLabel);
  return (
    <span className="trace-stepper" title={trace.message ?? label}>
      <button title={props.t("runtime.previousTrace")} onClick={() => props.onStep(activeIndex - 1)} disabled={activeIndex <= 0}>
        {props.t("common.previous")}
      </button>
      <button title={props.t("runtime.focusCurrentTrace")} onClick={() => props.onStep(activeIndex)}>
        {props.t("runtime.traceStep", { current: activeIndex + 1, total: props.entry.traces.length })}
      </button>
      <button title={props.t("runtime.nextTrace")} onClick={() => props.onStep(activeIndex + 1)} disabled={activeIndex >= props.entry.traces.length - 1}>
        {props.t("common.next")}
      </button>
      <span className={`trace-step-status ${trace.status}`}>{runtimeTraceStatusLabel(trace.status, props.t)}</span>
      <span className="trace-step-node">{label}</span>
    </span>
  );
}

function RuntimeTraceDetails(props: {
  entry: RuntimeHistoryEntry;
  compareEntry?: RuntimeHistoryEntry;
  activeIndex?: number;
  t: Translator;
  traceLabel: RuntimeTraceLabeler;
  onStep(index: number): void;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RuntimeTraceStatusFilter>("all");
  const [traceGroupBy, setTraceGroupBy] = useState<RuntimeTraceGroupBy>("none");
  const [comparisonFilter, setComparisonFilter] = useState<RuntimeComparisonFilter>("all");
  const [comparisonSort, setComparisonSort] = useState<RuntimeComparisonSort>("kind");
  const [pinnedComparisonKey, setPinnedComparisonKey] = useState<string | undefined>();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [comparisonCopyStatus, setComparisonCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [comparisonItemCopyStatus, setComparisonItemCopyStatus] = useState<{ key?: string; status: "idle" | "copied" | "failed" }>({ status: "idle" });

  useEffect(() => {
    setOpen(false);
    setQuery("");
    setStatusFilter("all");
    setTraceGroupBy("none");
    setComparisonFilter("all");
    setComparisonSort("kind");
    setPinnedComparisonKey(undefined);
    setCopyStatus("idle");
    setComparisonCopyStatus("idle");
    setComparisonItemCopyStatus({ status: "idle" });
  }, [props.entry.id]);

  if (!props.entry.traces.length) {
    return null;
  }

  const activeIndex = clamp(props.activeIndex ?? 0, 0, props.entry.traces.length - 1);
  const statusCounts = runtimeTraceStatusCounts(props.entry.traces);
  const filteredTraces = props.entry.traces
    .map((trace, index) => ({ trace, index }))
    .filter(({ trace }) => statusFilter === "all" || trace.status === statusFilter)
    .filter(({ trace }) => runtimeTraceMatchesQuery(trace, query, props.traceLabel));
  const visibleTraces = filteredTraces.slice(0, 80);
  const visibleTraceGroups = groupRuntimeTraces(visibleTraces, traceGroupBy, props.t, props.traceLabel);
  const firstTimestamp = props.entry.traces.find((trace) => typeof trace.timestamp === "number")?.timestamp;
  const comparison = runtimeRunComparison(props.entry, props.compareEntry, props.traceLabel);
  const comparisonCounts = comparison ? runtimeComparisonKindCounts(comparison.items) : new Map<RuntimeRunComparisonItem["kind"], number>();
  const filteredComparisonItems = comparison?.items.filter((item) => comparisonFilter === "all" || item.kind === comparisonFilter) ?? [];
  const sortedComparisonItems = sortRuntimeComparisonItems(filteredComparisonItems, comparisonSort);
  const copyFilteredDetails = async () => {
    const payload = runtimeTraceExportPayload(props.entry, filteredTraces, { query, status: statusFilter, groupBy: traceGroupBy }, comparison);
    try {
      await writeTextToClipboard(JSON.stringify(payload, null, 2));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  const copyFilteredComparison = async () => {
    if (!comparison) {
      return;
    }
    const payload = runtimeComparisonExportPayload(props.entry, props.compareEntry, comparison, sortedComparisonItems, {
      kind: comparisonFilter,
      sort: comparisonSort
    });
    try {
      await writeTextToClipboard(JSON.stringify(payload, null, 2));
      setComparisonCopyStatus("copied");
    } catch {
      setComparisonCopyStatus("failed");
    }
  };
  const copyComparisonItem = async (item: RuntimeRunComparisonItem) => {
    const itemKey = runtimeComparisonItemKey(item);
    const payload = runtimeComparisonItemExportPayload(props.entry, props.compareEntry, item);
    try {
      await writeTextToClipboard(JSON.stringify(payload, null, 2));
      setComparisonItemCopyStatus({ key: itemKey, status: "copied" });
    } catch {
      setComparisonItemCopyStatus({ key: itemKey, status: "failed" });
    }
  };

  return (
    <div className="runtime-details">
      <button
        className={open ? "runtime-details-toggle active" : "runtime-details-toggle"}
        title={open ? props.t("runtime.hideDetails") : props.t("runtime.showDetails")}
        onClick={() => setOpen((current) => !current)}
      >
        {props.t("runtime.details")}
      </button>
      {open ? (
        <div className="runtime-details-panel" role="dialog" aria-label={props.t("runtime.details")}>
          <div className="runtime-details-head">
            <strong>{props.t("runtime.runDetails")}</strong>
            <div className="runtime-details-actions">
              <span>{props.t("runtime.traceCount", { visible: filteredTraces.length, total: props.entry.traces.length })} · {props.entry.durationMs}ms</span>
              <button title={props.t("runtime.copyFilteredDetails")} onClick={() => void copyFilteredDetails()}>
                <Copy size={12} /> {copyStatus === "copied" ? props.t("common.copied") : copyStatus === "failed" ? props.t("common.copyFailed") : props.t("runtime.copyJson")}
              </button>
            </div>
          </div>
          {comparison ? (
            <div className="runtime-compare-block">
              <div className="runtime-compare" title={props.t("runtime.comparePreviousTitle")}>
                <span>{props.t("runtime.vsPrevious")}</span>
                <strong>{formatSignedRuntimeDuration(comparison.durationDeltaMs)}</strong>
                <small>{props.t("runtime.compareSummary", { changed: comparison.changed, added: comparison.added, missing: comparison.missing })}</small>
              </div>
              {comparison.items.length ? (
                <>
                  <div className="runtime-compare-filters">
                    <button
                      className={comparisonFilter === "all" ? "active" : ""}
                      title={props.t("runtime.filterDifferencesBy", { filter: props.t("common.all") })}
                      onClick={() => {
                        setComparisonFilter("all");
                        setComparisonCopyStatus("idle");
                        setComparisonItemCopyStatus({ status: "idle" });
                      }}
                    >
                      {props.t("common.all")} <span>{comparison.items.length}</span>
                    </button>
                    {runtimeComparisonFilters
                      .filter((kind) => comparisonCounts.get(kind))
                      .map((kind) => (
                        <button
                          key={kind}
                          className={comparisonFilter === kind ? `active ${kind}` : kind}
                          title={props.t("runtime.filterDifferencesBy", { filter: runtimeComparisonKindLabel(kind, props.t) })}
                          onClick={() => {
                            setComparisonFilter(kind);
                            setComparisonCopyStatus("idle");
                            setComparisonItemCopyStatus({ status: "idle" });
                          }}
                        >
                          {runtimeComparisonKindLabel(kind, props.t)} <span>{comparisonCounts.get(kind)}</span>
                        </button>
                      ))}
                    <span className="runtime-compare-sort-label">{props.t("common.sort")}</span>
                    {(["kind", "node", "status"] as RuntimeComparisonSort[]).map((sort) => (
                      <button
                        key={sort}
                        className={comparisonSort === sort ? "active" : ""}
                        title={props.t("runtime.sortDifferencesBy", { sort: runtimeComparisonSortLabel(sort, props.t) })}
                        onClick={() => {
                          setComparisonSort(sort);
                          setComparisonCopyStatus("idle");
                          setComparisonItemCopyStatus({ status: "idle" });
                        }}
                      >
                        {runtimeComparisonSortLabel(sort, props.t)}
                      </button>
                    ))}
                    <button title={props.t("runtime.copyFilteredComparison")} onClick={() => void copyFilteredComparison()}>
                      <Copy size={12} /> {comparisonCopyStatus === "copied" ? props.t("common.copied") : comparisonCopyStatus === "failed" ? props.t("common.copyFailed") : props.t("runtime.copyDiff")}
                    </button>
                  </div>
                  <div className="runtime-compare-items">
                    {sortedComparisonItems.slice(0, 8).map((item) => {
                      const itemKey = runtimeComparisonItemKey(item);
                      const className = pinnedComparisonKey === itemKey ? `runtime-compare-item ${item.kind} pinned` : `runtime-compare-item ${item.kind}`;
                      const contextDetails = runtimeComparisonContextDetails(item);
                      const itemCopyLabel = comparisonItemCopyStatus.key === itemKey && comparisonItemCopyStatus.status === "copied"
                        ? props.t("common.copied")
                        : comparisonItemCopyStatus.key === itemKey && comparisonItemCopyStatus.status === "failed"
                          ? props.t("common.failed")
                          : props.t("common.copy");
                      return (
                        <div key={itemKey} className="runtime-compare-row">
                          {item.traceIndex === undefined ? (
                            <span className={className}>
                              <strong>{runtimeComparisonKindLabel(item.kind, props.t)}</strong>
                              <span>{item.label}</span>
                              <small>{runtimeComparisonStatusText(item, props.t)}</small>
                            </span>
                          ) : (
                            <button
                              className={className}
                              title={props.t("runtime.inspectRuntimeDifference", { kind: runtimeComparisonKindLabel(item.kind, props.t), label: item.label })}
                              onClick={() => {
                                setPinnedComparisonKey(itemKey);
                                props.onStep(item.traceIndex ?? 0);
                              }}
                            >
                              <strong>{runtimeComparisonKindLabel(item.kind, props.t)}</strong>
                              <span>{item.label}</span>
                              <small>{runtimeComparisonStatusText(item, props.t)}</small>
                            </button>
                          )}
                          <button
                            className="runtime-compare-copy"
                            title={props.t("runtime.copyDifferenceFor", { label: item.label })}
                            onClick={() => void copyComparisonItem(item)}
                          >
                            <Copy size={11} /> {itemCopyLabel}
                          </button>
                          {contextDetails ? (
                            <div className="runtime-compare-context">
                              {contextDetails.previous ? (
                                <div>
                                  <strong>{props.t("runtime.previousContext")}</strong>
                                  <pre>{contextDetails.previous}</pre>
                                </div>
                              ) : null}
                              {contextDetails.current ? (
                                <div>
                                  <strong>{props.t("runtime.currentContext")}</strong>
                                  <pre>{contextDetails.current}</pre>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {sortedComparisonItems.length > 8 ? <span className="runtime-compare-more">+{sortedComparisonItems.length - 8}</span> : null}
                    {!sortedComparisonItems.length ? <span className="runtime-compare-empty">{props.t("runtime.noMatchingDifferences")}</span> : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="runtime-details-filters">
            <input
              value={query}
              placeholder={props.t("runtime.filterTraces")}
              onChange={(event) => {
                setQuery(event.target.value);
                setCopyStatus("idle");
              }}
            />
            <div className="runtime-status-filters">
              <button
                className={statusFilter === "all" ? "active" : ""}
                title={props.t("runtime.filterTracesBy", { filter: props.t("common.all") })}
                onClick={() => {
                  setStatusFilter("all");
                  setCopyStatus("idle");
                }}
              >
                {props.t("common.all")} <span>{props.entry.traces.length}</span>
              </button>
              {runtimeTraceStatusFilters
                .filter((status) => statusCounts.get(status))
                .map((status) => (
                  <button
                    key={status}
                    className={statusFilter === status ? `active ${status}` : status}
                    title={props.t("runtime.filterTracesBy", { filter: runtimeTraceStatusLabel(status, props.t) })}
                    onClick={() => {
                      setStatusFilter(status);
                      setCopyStatus("idle");
                    }}
                  >
                    {runtimeTraceStatusLabel(status, props.t)} <span>{statusCounts.get(status)}</span>
                  </button>
                ))}
            </div>
            <div className="runtime-group-filters">
              <span>{props.t("common.group")}</span>
              {runtimeTraceGroupOptions.map((groupBy) => (
                <button
                  key={groupBy}
                  className={traceGroupBy === groupBy ? "active" : ""}
                  title={props.t("runtime.groupTracesBy", { group: runtimeTraceGroupLabel(groupBy, props.t) })}
                  onClick={() => {
                    setTraceGroupBy(groupBy);
                    setCopyStatus("idle");
                  }}
                >
                  {runtimeTraceGroupLabel(groupBy, props.t)}
                </button>
              ))}
            </div>
          </div>
          <div className="runtime-details-list">
            {visibleTraceGroups.map((group) => (
              <div key={group.key} className="runtime-detail-group">
                {traceGroupBy !== "none" ? (
                  <div className="runtime-detail-group-title">
                    <strong>{group.label}</strong>
                    <span>{group.items.length}</span>
                  </div>
                ) : null}
                {group.items.map(({ trace, index }) => {
                  const label = runtimeTraceNodeLabel(trace, props.traceLabel);
                  const context = runtimeTraceContextText(trace);
                  return (
                    <button
                      key={`${trace.graphId}:${trace.nodeId}:${trace.status}:${trace.timestamp ?? index}:${index}`}
                      className={index === activeIndex ? `runtime-detail-row ${trace.status} active` : `runtime-detail-row ${trace.status}`}
                      title={props.t("runtime.inspectTrace", { index: index + 1, label })}
                      onClick={() => props.onStep(index)}
                    >
                      <span className="runtime-detail-index">#{index + 1}</span>
                      <span className={`runtime-detail-status ${trace.status}`}>{runtimeTraceStatusLabel(trace.status, props.t)}</span>
                      <span className="runtime-detail-node">{label}</span>
                      <span className="runtime-detail-time">{runtimeTraceTimeText(trace, firstTimestamp)}</span>
                      {trace.message || context ? <small>{[trace.message, context].filter(Boolean).join(" · ")}</small> : null}
                    </button>
                  );
                })}
              </div>
            ))}
            {!visibleTraces.length ? <div className="runtime-details-empty">{props.t("runtime.noMatchingTraces")}</div> : null}
          </div>
          {filteredTraces.length > visibleTraces.length ? (
            <div className="runtime-details-more">{props.t("runtime.showingTraces", { visible: visibleTraces.length, total: filteredTraces.length })}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeHistoryBar(props: {
  history: RuntimeHistoryEntry[];
  activeId?: string;
  t: Translator;
  onSelect(entry: RuntimeHistoryEntry): void;
  onRename(entry: RuntimeHistoryEntry): void;
  onPin(entry: RuntimeHistoryEntry): void;
  onDelete(entry: RuntimeHistoryEntry): void;
  onClear(): void;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!props.history.length) {
    return null;
  }
  return (
    <div className="run-history">
      <button
        className={open ? "run-history-toggle active" : "run-history-toggle"}
        type="button"
        title={open ? props.t("runtime.closeHistory") : props.t("runtime.openHistory")}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{props.t("runtime.history")}</span>
        <small>{props.history.length}</small>
      </button>
      {open ? (
        <div
          className="run-history-popover"
          role="dialog"
          aria-label={props.t("runtime.history")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <div className="run-history-popover-head">
            <strong>{props.t("runtime.runHistory")}</strong>
            <button className="run-history-clear" title={props.t("runtime.clearHistory")} onClick={props.onClear}>
              <Trash2 size={11} />
              <span>{props.t("common.clear")}</span>
            </button>
          </div>
          <div className="run-history-list">
            {props.history.map((entry, index) => (
              <div key={entry.id} className={entry.id === props.activeId ? "run-history-entry active" : "run-history-entry"}>
                <button
                  className={entry.id === props.activeId ? `run-history-item ${entry.ok ? "ok" : "error"} active` : `run-history-item ${entry.ok ? "ok" : "error"}`}
                  title={entry.label ? `${entry.label}: ${entry.text}` : entry.text}
                  onClick={() => props.onSelect(entry)}
                >
                  <span>{entry.label || props.t("runtime.runIndex", { index: index + 1 })}</span>
                  <small>{entry.durationMs}ms</small>
                </button>
                <span className="run-history-actions">
                  <button className="run-history-rename" title={props.t("runtime.renameRun", { index: index + 1 })} onClick={() => props.onRename(entry)}>
                    <Pencil size={11} />
                  </button>
                  <button className={entry.pinned ? "run-history-pin active" : "run-history-pin"} title={entry.pinned ? props.t("runtime.unpinRun", { index: index + 1 }) : props.t("runtime.pinRun", { index: index + 1 })} onClick={() => props.onPin(entry)}>
                    <Pin size={11} />
                  </button>
                  <button className="run-history-delete" title={props.t("runtime.deleteRun", { index: index + 1 })} onClick={() => props.onDelete(entry)}>
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function previousRuntimeHistoryEntry(history: RuntimeHistoryEntry[], activeId: string): RuntimeHistoryEntry | undefined {
  const index = history.findIndex((entry) => entry.id === activeId);
  if (index < 0) {
    return undefined;
  }
  return history[index + 1];
}

function limitRuntimeHistory(history: RuntimeHistoryEntry[], requiredId?: string): RuntimeHistoryEntry[] {
  const seen = new Set<string>();
  const deduped = history.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
  const pinnedIds = new Set(deduped.filter((entry) => entry.pinned).map((entry) => entry.id));
  const requiredUnpinned = requiredId && !pinnedIds.has(requiredId) ? 1 : 0;
  const unpinnedLimit = Math.max(maxRuntimeHistory - pinnedIds.size, requiredUnpinned);
  const keptUnpinnedIds = new Set(
    deduped
      .filter((entry) => !entry.pinned)
      .slice(0, unpinnedLimit)
      .map((entry) => entry.id)
  );
  if (requiredId && !pinnedIds.has(requiredId)) {
    keptUnpinnedIds.add(requiredId);
  }
  return deduped.filter((entry) => entry.pinned || keptUnpinnedIds.has(entry.id));
}

function runtimeOutputHeading(entry: RuntimeHistoryEntry, t: Translator): string {
  if (entry.label) {
    return entry.ok ? t("runtime.runLabel", { label: entry.label }) : t("runtime.runFailedLabel", { label: entry.label });
  }
  return entry.ok ? t("runtime.run") : t("runtime.runFailed");
}

function runtimeTraceStatusLabel(status: RuntimeTraceEvent["status"], t: Translator): string {
  return t(`runtime.status.${status}`);
}

function runtimeComparisonKindLabel(kind: RuntimeRunComparisonItem["kind"], t: Translator): string {
  return t(`runtime.compareKind.${kind}`);
}

function runtimeComparisonSortLabel(sort: RuntimeComparisonSort, t: Translator): string {
  return t(`runtime.compareSort.${sort}`);
}

function runtimeTraceGroupLabel(groupBy: RuntimeTraceGroupBy, t: Translator): string {
  return t(`runtime.traceGroup.${groupBy}`);
}

function InspectorPortGroup(props: {
  title: string;
  template: BlueprintNodeTemplate;
  ports: BlueprintPortDefinition[];
  node: BlueprintNodeInstance;
  graph: BlueprintGraph;
  t: Translator;
  locale: Locale;
  nodeLabelMode: NodeLabelMode;
  onLiteralChange?(node: BlueprintNodeInstance, port: BlueprintPortDefinition, value: unknown): void;
  onUnlink?(node: BlueprintNodeInstance, port: BlueprintPortDefinition): void;
}): JSX.Element | null {
  if (!props.ports.length) {
    return null;
  }
  return (
    <section className="inspector-section">
      <h3>{props.title}</h3>
      {props.ports.map((port) => {
        const portText = displayPortText(props.template, port, props.locale, props.nodeLabelMode);
        const linked = props.graph.links.find((link) => link.toNodeId === props.node.id && link.toPortId === port.id);
        const linkCount = linkIdsForPort(props.graph, props.node.id, port).size;
        const binding = props.node.inputBindings[port.id];
        return (
          <label key={port.id} className={linked ? "field linked" : "field"}>
            <span className="field-name" title={portText.description}>{portText.name}</span>
            <span className="field-detail">
              {linked || port.direction === "output" || port.flowKind === "control" ? (
                <span className="linked-control">
                  <input disabled value={linked ? `${linked.fromNodeId}.${linked.fromPortId}` : port.type} />
                  {linked ? <button type="button" title={props.t("inspector.disconnectPort", { port: portText.name })} onClick={() => props.onUnlink?.(props.node, port)}>{props.t("inspector.unlink")}</button> : null}
                </span>
              ) : (
                <PortEditor port={port} value={binding?.literalValue ?? port.defaultValue ?? ""} onChange={(value) => props.onLiteralChange?.(props.node, port, value)} />
              )}
              <span className="port-meta">
                <small>{port.id}</small>
                <small>{port.direction}</small>
                <small>{port.flowKind}</small>
                <small>{port.type}</small>
                <small>{linkCount ? props.t("inspector.linkCount", { count: linkCount }) : props.t("inspector.unlinked")}</small>
                {port.defaultValue !== undefined ? <small>{props.t("inspector.defaultValue", { value: formatPortDefaultValue(port.defaultValue) })}</small> : null}
              </span>
              {portText.description ? <small className="port-description">{portText.description}</small> : null}
            </span>
          </label>
        );
      })}
    </section>
  );
}

function formatPortDefaultValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

function PortEditor(props: { port: BlueprintPortDefinition; value: unknown; onChange(value: unknown): void }): JSX.Element {
  if (props.port.constraints?.options?.length) {
    return (
      <select value={String(props.value)} onChange={(event) => props.onChange(event.target.value)}>
        {props.port.constraints.options.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
      </select>
    );
  }

  if (props.port.editor === "boolean") {
    return <input type="checkbox" checked={Boolean(props.value)} onChange={(event) => props.onChange(event.target.checked)} />;
  }

  if (props.port.editor === "number") {
    return <input type="number" value={Number(props.value)} onChange={(event) => props.onChange(Number(event.target.value))} />;
  }

  return <input value={String(props.value ?? "")} onChange={(event) => props.onChange(event.target.value)} />;
}

function findNodesInGraph(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], query: string, t: Translator, locale: Locale): NodeFindResult[] {
  const tokens = fuzzySearchTokens(query);

  return graph.nodes
    .map((node, index) => {
      const template = getEffectiveTemplateForNode(graph, templates, node);
      const values = nodeFindSearchValues(graph, node, template, t, locale);
      return { node, template, index, ...scoreFindResult(values, tokens) };
    })
    .filter((entry) => !tokens.length || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ node, template, score, matchLabel }) => ({ node, template, score, matchLabel }));
}

function findInSolutionGraphIndex(
  index: BlueprintSolutionGraphSearchIndex | undefined,
  templates: BlueprintNodeTemplate[],
  query: string,
  activeGraphPath: string | undefined,
  t: Translator,
  locale: Locale
): SolutionGraphFindResult[] {
  const tokens = outlineTokens(query);
  if (!index || !tokens.length) {
    return [];
  }

  const templateById = new Map(templates.map((template) => [template.id, template]));
  return index.graphs
    .filter((graph) => graph.graphPath !== activeGraphPath)
    .flatMap((graph, graphIndex): Array<SolutionGraphFindResult & { index: number }> => {
      const graphMatch = scoreFindResult([
        { label: t("searchLabel.project"), value: graph.projectName },
        { label: t("searchLabel.graph"), value: graph.graphName },
        { label: t("searchLabel.graph"), value: graph.graphId },
        { label: t("searchLabel.kind"), value: graph.graphKind },
        { label: t("searchLabel.path"), value: graph.graphPath },
        { label: t("searchLabel.description"), value: graph.description },
        { label: t("searchLabel.inputs"), value: graph.inputNames.join(" ") },
        { label: t("searchLabel.outputs"), value: graph.outputNames.join(" ") },
        { label: t("searchLabel.comments"), value: graph.comments.join(" ") },
        { label: t("searchLabel.generated"), value: graph.generatedSourceName },
        { label: t("searchLabel.generated"), value: graph.generatedFunctionName }
      ], tokens);
      const graphResults: Array<SolutionGraphFindResult & { index: number }> = graphMatch.score > 0
        ? [{
            graphPath: graph.graphPath,
            graphName: graph.graphName,
            graphKind: graph.graphKind,
            projectName: graph.projectName,
            score: graphMatch.score,
            matchLabel: graphMatch.matchLabel,
            index: graphIndex
          }]
        : [];
      const nodeResults: Array<SolutionGraphFindResult & { index: number }> = [];
      graph.nodes.forEach((node, nodeIndex) => {
        const template = templateById.get(node.templateId);
        const templateText = localizedTemplateText(template, locale);
        const nodeMatch = scoreFindResult([
          { label: t("searchLabel.node"), value: node.id },
          { label: t("searchLabel.template"), value: node.templateId },
          { label: t("searchLabel.name"), value: templateText.name },
          { label: t("searchLabel.name"), value: template?.name },
          { label: t("searchLabel.path"), value: templateText.creationPath },
          { label: t("searchLabel.path"), value: template?.creationPath },
          { label: t("searchLabel.description"), value: templateText.description },
          { label: t("searchLabel.description"), value: template?.description },
          { label: t("searchLabel.source"), value: template?.bodyRef },
          { label: t("searchLabel.source"), value: typeof template?.metadata?.source === "string" ? template.metadata.source : undefined },
          { label: t("searchLabel.variable"), value: node.blackboardKey },
          { label: t("searchLabel.variable"), value: node.blackboardAccess ? `${node.blackboardAccess} ${node.blackboardKey ?? ""}` : undefined },
          { label: t("searchLabel.generated"), value: node.generatedTraceRef },
          { label: t("searchLabel.ports"), value: [...node.inputPortIds, ...node.outputPortIds].join(" ") },
          { label: t("searchLabel.ports"), value: template ? templatePortSearchText(template, locale) : undefined }
        ], tokens);
        if (nodeMatch.score > 0) {
          nodeResults.push({
            graphPath: graph.graphPath,
            graphName: graph.graphName,
            graphKind: graph.graphKind,
            projectName: graph.projectName,
            nodeId: node.id,
            template,
            score: nodeMatch.score + 1,
            matchLabel: nodeMatch.matchLabel,
            index: graphIndex * 10000 + nodeIndex + 1
          });
        }
      });
      return [...graphResults, ...nodeResults];
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 12)
    .map(({ index: _index, ...entry }) => entry);
}

function referencedGraphPathForTemplate(
  template: BlueprintNodeTemplate | undefined,
  outline: BlueprintSolutionOutline | undefined,
  index: BlueprintSolutionGraphSearchIndex | undefined
): string | undefined {
  if (!template || (template.bodyKind !== "blueprintGraph" && template.bodyKind !== "macroExpansion")) {
    return undefined;
  }
  if (template.bodyRef.startsWith("embedded:")) {
    return undefined;
  }
  const expectedKind = template.bodyKind === "macroExpansion" ? "macro" : "function";
  const templateGraphId = template.id.replace(/^(graph|macro)\./, "");
  const sourcePath = normalizeTemplatePath(template.bodyRef.split("#")[0] ?? "");
  const indexedMatch = index?.graphs.find((candidate) =>
    referencedGraphMatches(candidate.graphPath, candidate.graphId, candidate.graphKind, templateGraphId, sourcePath, expectedKind)
  );
  if (indexedMatch) {
    return indexedMatch.graphPath;
  }
  return outline?.projects
    .flatMap((project) => project.graphs)
    .find((candidate) => referencedGraphMatches(candidate.path, candidate.id, candidate.kind, templateGraphId, sourcePath, expectedKind))
    ?.path;
}

function referencedGraphMatches(
  graphPath: string,
  graphId: string,
  graphKind: string,
  templateGraphId: string,
  sourcePath: string,
  expectedKind: "function" | "macro"
): boolean {
  if (graphKind !== expectedKind) {
    return false;
  }
  if (graphId === templateGraphId) {
    return true;
  }
  const normalizedPath = normalizeTemplatePath(graphPath);
  return Boolean(sourcePath && (normalizedPath === sourcePath || normalizedPath.endsWith(`/${sourcePath}`)));
}

function nodeFindSearchValues(graph: BlueprintGraph, node: BlueprintNodeInstance, template: BlueprintNodeTemplate | undefined, t: Translator, locale: Locale): Array<{ label: string; value?: string }> {
  const blackboardReference = blackboardReferenceForNode(node, template);
  const templateText = localizedTemplateText(template, locale);
  return [
    { label: t("searchLabel.node"), value: node.id },
    { label: t("searchLabel.template"), value: node.templateId },
    { label: t("searchLabel.template"), value: template?.id },
    { label: t("searchLabel.name"), value: templateText.name },
    { label: t("searchLabel.name"), value: template?.name },
    { label: t("searchLabel.path"), value: templateText.creationPath },
    { label: t("searchLabel.path"), value: template?.creationPath },
    { label: t("searchLabel.description"), value: templateText.description },
    { label: t("searchLabel.description"), value: template?.description },
    { label: t("searchLabel.body"), value: template?.bodyKind },
    { label: t("searchLabel.source"), value: template?.bodyRef },
    { label: t("searchLabel.source"), value: typeof template?.metadata?.source === "string" ? template.metadata.source : undefined },
    { label: t("searchLabel.variable"), value: blackboardReference?.key },
    { label: t("searchLabel.variable"), value: blackboardReference ? `${blackboardReference.access} ${blackboardReference.key}` : undefined },
    { label: t("searchLabel.generated"), value: generatedTraceReference(graph, node) },
    { label: t("searchLabel.ports"), value: template ? templatePortSearchText(template, locale) : undefined }
  ];
}

function generatedTraceReference(graph: BlueprintGraph, node: BlueprintNodeInstance): string {
  return `${sanitizeIdentifier(graph.name)}:${node.id}`;
}

function blackboardReferenceForNode(
  node: BlueprintNodeInstance,
  template: BlueprintNodeTemplate | undefined
): { key: string; access: "get" | "set" } | undefined {
  if (template?.bodyKind !== "typescriptBuiltin" || (template.bodyRef !== "blackboard.get" && template.bodyRef !== "blackboard.set")) {
    return undefined;
  }
  const keyBinding = node.inputBindings.key;
  if (keyBinding?.sourceKind !== "literal" || typeof keyBinding.literalValue !== "string" || !keyBinding.literalValue.trim()) {
    return undefined;
  }
  return {
    key: keyBinding.literalValue,
    access: template.bodyRef === "blackboard.get" ? "get" : "set"
  };
}

function templatePortSearchText(template: BlueprintNodeTemplate, locale: Locale): string {
  return [...template.controlInputs, ...template.inputs, ...template.outputs, ...template.controlOutputs]
    .map((port) => {
      const portText = localizedPortText(template, port, locale);
      return `${port.id} ${port.name} ${portText.name} ${port.description} ${portText.description} ${port.type}`;
    })
    .join(" ");
}

function mergeTemplatesById(templates: BlueprintNodeTemplate[]): BlueprintNodeTemplate[] {
  return [...new Map(templates.map((template) => [template.id, template])).values()];
}

function filterOutlineNodes(
  entries: Array<{ node: BlueprintNodeInstance; template: BlueprintNodeTemplate | undefined }>,
  query: string,
  locale: Locale
): Array<{ node: BlueprintNodeInstance; template: BlueprintNodeTemplate | undefined }> {
  const tokens = fuzzySearchTokens(query);
  if (!tokens.length) {
    return entries;
  }
  return entries.filter(({ node, template }) =>
    fuzzyValuesMatchTokens(outlineNodeSearchValues(node, template, locale), tokens)
  );
}

function outlineNodeSearchValues(node: BlueprintNodeInstance, template: BlueprintNodeTemplate | undefined, locale: Locale): Array<string | undefined> {
  const templateText = localizedTemplateText(template, locale);
  return [
    node.id,
    node.templateId,
    template?.id,
    templateText.name,
    template?.name,
    templateText.creationPath,
    template?.creationPath
  ];
}

function groupOutlineNodesByCategory(
  entries: Array<{ node: BlueprintNodeInstance; template: BlueprintNodeTemplate | undefined }>,
  t: Translator,
  locale: Locale
): Array<{ category: string; entries: Array<{ node: BlueprintNodeInstance; template: BlueprintNodeTemplate | undefined }> }> {
  const groups = new Map<string, Array<{ node: BlueprintNodeInstance; template: BlueprintNodeTemplate | undefined }>>();
  for (const entry of entries) {
    const category = localizedTemplateText(entry.template, locale).creationPath.split("/")[0]?.trim() || t("node.missingTemplate");
    groups.set(category, [...(groups.get(category) ?? []), entry]);
  }
  return [...groups.entries()].map(([category, groupEntries]) => ({ category, entries: groupEntries }));
}

function filterOutlineComments(comments: BlueprintCommentBox[], query: string): BlueprintCommentBox[] {
  const tokens = fuzzySearchTokens(query);
  if (!tokens.length) {
    return comments;
  }
  return comments.filter((comment) => fuzzyValuesMatchTokens([comment.id, comment.title], tokens));
}

function outlineTokens(query: string): string[] {
  return fuzzySearchTokens(query);
}

function scoreFindResult(values: Array<{ label: string; value?: string }>, tokens: string[]): { score: number; matchLabel?: string } {
  return scoreFuzzySearchValues(values, tokens);
}

function issueKey(issue: ValidationIssue): string {
  return [
    issue.severity,
    issue.message,
    issue.sourcePath ? `source:${issue.sourcePath}` : "",
    issue.graphId ? `graph:${issue.graphId}` : "",
    issue.graphName ? `graphName:${issue.graphName}` : "",
    issue.nodeId ? `node:${issue.nodeId}` : "",
    issue.linkId ? `link:${issue.linkId}` : "",
    issue.portId ? `port:${issue.portId}` : ""
  ].join("|");
}

function diagnosticLocationText(issue: ValidationIssue): string {
  return [
    issue.sourcePath,
    issue.graphName || issue.graphId,
    issue.nodeId ? `node ${issue.nodeId}` : "",
    issue.linkId ? `link ${issue.linkId}` : "",
    issue.portId ? `port ${issue.portId}` : ""
  ].filter(Boolean).join(" · ");
}

function formatDiagnosticCopyText(issue: ValidationIssue): string {
  return [
    issue.severity,
    issue.message,
    diagnosticLocationText(issue)
  ].filter(Boolean).join("\n");
}

function formatRuntimeText(stdout: string, stderr: string, fallback: string): string {
  const text = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
  return text || fallback;
}

function runtimeTraceLabeler(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  locale: Locale,
  mode: NodeLabelMode
): RuntimeTraceLabeler {
  return (trace) => {
    if (trace.graphId === graph.id) {
      const node = graph.nodes.find((candidate) => candidate.id === trace.nodeId);
      const template = node ? getEffectiveTemplateForNode(graph, templates, node) : undefined;
      if (template) {
        return `${displayTemplateText(template, locale, mode).name} (${trace.nodeId})`;
      }
    }
    return trace.nodeName ? `${displayText(trace.nodeName, trace.nodeName, mode)} (${trace.nodeId})` : trace.nodeId;
  };
}

function runtimeTraceNodeLabel(trace: RuntimeTraceEvent, traceLabel?: RuntimeTraceLabeler): string {
  return traceLabel ? traceLabel(trace) : trace.nodeName ? `${trace.nodeName} (${trace.nodeId})` : trace.nodeId;
}

function runtimeTraceContextText(trace: RuntimeTraceEvent): string {
  if (!trace.context) {
    return "";
  }
  const entries = Object.entries(trace.context);
  if (!entries.length) {
    return "";
  }
  return entries.map(([key, value]) => `${key}: ${formatRuntimeTraceValue(value)}`).join(", ");
}

function runtimeTraceContextSignature(context: Record<string, unknown> | undefined): string {
  if (!context || !Object.keys(context).length) {
    return "";
  }
  return JSON.stringify(stableRuntimeValue(context));
}

function stableRuntimeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableRuntimeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableRuntimeValue(entry)])
    );
  }
  return value;
}

function runtimeTraceStatusCounts(traces: RuntimeTraceEvent[]): Map<RuntimeTraceEvent["status"], number> {
  const counts = new Map<RuntimeTraceEvent["status"], number>();
  for (const trace of traces) {
    counts.set(trace.status, (counts.get(trace.status) ?? 0) + 1);
  }
  return counts;
}

function runtimeComparisonKindCounts(items: RuntimeRunComparisonItem[]): Map<RuntimeRunComparisonItem["kind"], number> {
  const counts = new Map<RuntimeRunComparisonItem["kind"], number>();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return counts;
}

function runtimeComparisonItemKey(item: RuntimeRunComparisonItem): string {
  return `${item.kind}:${item.graphId}:${item.nodeId}`;
}

function sortRuntimeComparisonItems(items: RuntimeRunComparisonItem[], sort: RuntimeComparisonSort): RuntimeRunComparisonItem[] {
  const kindOrder = new Map<RuntimeRunComparisonItem["kind"], number>(runtimeComparisonFilters.map((kind, index) => [kind, index]));
  return [...items].sort((a, b) => {
    if (sort === "node") {
      return a.label.localeCompare(b.label) || compareRuntimeComparisonKind(a, b, kindOrder);
    }
    if (sort === "status") {
      return runtimeComparisonStatusText(a).localeCompare(runtimeComparisonStatusText(b)) || a.label.localeCompare(b.label);
    }
    return compareRuntimeComparisonKind(a, b, kindOrder) || a.label.localeCompare(b.label);
  });
}

function compareRuntimeComparisonKind(
  a: RuntimeRunComparisonItem,
  b: RuntimeRunComparisonItem,
  kindOrder: Map<RuntimeRunComparisonItem["kind"], number>
): number {
  return (kindOrder.get(a.kind) ?? 99) - (kindOrder.get(b.kind) ?? 99);
}

function runtimeRunComparison(entry: RuntimeHistoryEntry, previous: RuntimeHistoryEntry | undefined, traceLabel?: RuntimeTraceLabeler): RuntimeRunComparison | undefined {
  if (!previous) {
    return undefined;
  }
  const current = runtimeFinalTraceByNode(entry.traces);
  const before = runtimeFinalTraceByNode(previous.traces);
  let changed = 0;
  let added = 0;
  let missing = 0;
  const items: RuntimeRunComparisonItem[] = [];

  for (const [key, currentFinal] of current.entries()) {
    const previousFinal = before.get(key);
    if (!previousFinal) {
      added += 1;
      items.push({
        kind: "new",
        graphId: currentFinal.trace.graphId,
        nodeId: currentFinal.trace.nodeId,
        label: runtimeTraceNodeLabel(currentFinal.trace, traceLabel),
        currentStatus: currentFinal.trace.status,
        currentContext: currentFinal.trace.context,
        traceIndex: currentFinal.index
      });
    } else if (previousFinal.trace.status !== currentFinal.trace.status || runtimeTraceContextSignature(previousFinal.trace.context) !== runtimeTraceContextSignature(currentFinal.trace.context)) {
      changed += 1;
      items.push({
        kind: "changed",
        graphId: currentFinal.trace.graphId,
        nodeId: currentFinal.trace.nodeId,
        label: runtimeTraceNodeLabel(currentFinal.trace, traceLabel),
        currentStatus: currentFinal.trace.status,
        previousStatus: previousFinal.trace.status,
        currentContext: currentFinal.trace.context,
        previousContext: previousFinal.trace.context,
        contextChanged: runtimeTraceContextSignature(previousFinal.trace.context) !== runtimeTraceContextSignature(currentFinal.trace.context),
        traceIndex: currentFinal.index
      });
    }
  }

  for (const [key, previousFinal] of before.entries()) {
    if (!current.has(key)) {
      missing += 1;
      items.push({
        kind: "missing",
        graphId: previousFinal.trace.graphId,
        nodeId: previousFinal.trace.nodeId,
        label: runtimeTraceNodeLabel(previousFinal.trace, traceLabel),
        previousStatus: previousFinal.trace.status,
        previousContext: previousFinal.trace.context
      });
    }
  }

  return {
    previousDurationMs: previous.durationMs,
    durationDeltaMs: entry.durationMs - previous.durationMs,
    changed,
    added,
    missing,
    items
  };
}

function runtimeFinalTraceByNode(traces: RuntimeTraceEvent[]): Map<string, { trace: RuntimeTraceEvent; index: number }> {
  const byNode = new Map<string, { trace: RuntimeTraceEvent; index: number }>();
  for (const [index, trace] of traces.entries()) {
    byNode.set(`${trace.graphId}:${trace.nodeId}`, { trace, index });
  }
  return byNode;
}

function runtimeTraceExportPayload(
  entry: RuntimeHistoryEntry,
  filteredTraces: Array<{ trace: RuntimeTraceEvent; index: number }>,
  filter: { query: string; status: RuntimeTraceStatusFilter; groupBy: RuntimeTraceGroupBy },
  comparison?: RuntimeRunComparison
): Record<string, unknown> {
  return {
    ok: entry.ok,
    message: entry.message,
    durationMs: entry.durationMs,
    createdAt: entry.createdAt,
    filter: {
      query: filter.query.trim(),
      status: filter.status,
      groupBy: filter.groupBy
    },
    comparison,
    traces: filteredTraces.map(({ trace, index }) => ({
      index,
      ...trace
    }))
  };
}

function groupRuntimeTraces(
  traces: Array<{ trace: RuntimeTraceEvent; index: number }>,
  groupBy: RuntimeTraceGroupBy,
  t: Translator,
  traceLabel?: RuntimeTraceLabeler
): Array<{ key: string; label: string; items: Array<{ trace: RuntimeTraceEvent; index: number }> }> {
  if (groupBy === "none") {
    return [{ key: "all", label: t("runtime.allTraces"), items: traces }];
  }
  const groups = new Map<string, { key: string; label: string; items: Array<{ trace: RuntimeTraceEvent; index: number }> }>();
  for (const item of traces) {
    const label = groupBy === "status" ? item.trace.status : runtimeTraceNodeLabel(item.trace, traceLabel);
    const key = groupBy === "status" ? `status:${item.trace.status}` : `node:${item.trace.graphId}:${item.trace.nodeId}`;
    const group = groups.get(key) ?? { key, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function runtimeComparisonExportPayload(
  entry: RuntimeHistoryEntry,
  previous: RuntimeHistoryEntry | undefined,
  comparison: RuntimeRunComparison,
  items: RuntimeRunComparisonItem[],
  filter: { kind: RuntimeComparisonFilter; sort: RuntimeComparisonSort }
): Record<string, unknown> {
  return {
    currentRun: {
      id: entry.id,
      ok: entry.ok,
      message: entry.message,
      durationMs: entry.durationMs,
      createdAt: entry.createdAt
    },
    previousRun: previous ? {
      id: previous.id,
      ok: previous.ok,
      message: previous.message,
      durationMs: previous.durationMs,
      createdAt: previous.createdAt
    } : undefined,
    filter,
    summary: {
      previousDurationMs: comparison.previousDurationMs,
      durationDeltaMs: comparison.durationDeltaMs,
      changed: comparison.changed,
      added: comparison.added,
      missing: comparison.missing
    },
    items
  };
}

function runtimeComparisonItemExportPayload(
  entry: RuntimeHistoryEntry,
  previous: RuntimeHistoryEntry | undefined,
  item: RuntimeRunComparisonItem
): Record<string, unknown> {
  return {
    currentRun: {
      id: entry.id,
      ok: entry.ok,
      message: entry.message,
      durationMs: entry.durationMs,
      createdAt: entry.createdAt
    },
    previousRun: previous ? {
      id: previous.id,
      ok: previous.ok,
      message: previous.message,
      durationMs: previous.durationMs,
      createdAt: previous.createdAt
    } : undefined,
    item
  };
}

function runtimeComparisonContextDetails(item: RuntimeRunComparisonItem): { previous?: string; current?: string } | undefined {
  const previous = runtimeContextPreviewText(item.previousContext);
  const current = runtimeContextPreviewText(item.currentContext);
  if (!previous && !current) {
    return undefined;
  }
  return { previous, current };
}

function runtimeContextPreviewText(context: Record<string, unknown> | undefined): string {
  if (!context || !Object.keys(context).length) {
    return "";
  }
  return JSON.stringify(stableRuntimeValue(context), null, 2);
}

function formatSignedRuntimeDuration(value: number): string {
  if (value === 0) {
    return "0ms";
  }
  return `${value > 0 ? "+" : ""}${value}ms`;
}

function runtimeComparisonStatusText(item: RuntimeRunComparisonItem, t?: Translator): string {
  if (item.kind === "changed") {
    if (item.previousStatus === item.currentStatus && item.contextChanged) {
      return t ? t("runtime.contextChanged") : "context changed";
    }
    const previous = item.previousStatus && t ? runtimeTraceStatusLabel(item.previousStatus, t) : item.previousStatus;
    const current = item.currentStatus && t ? runtimeTraceStatusLabel(item.currentStatus, t) : item.currentStatus;
    return `${previous} -> ${current}`;
  }
  if (item.kind === "new") {
    return item.currentStatus && t ? runtimeTraceStatusLabel(item.currentStatus, t) : item.currentStatus ?? "";
  }
  if (!item.previousStatus) {
    return "";
  }
  return t ? t("runtime.wasStatus", { status: runtimeTraceStatusLabel(item.previousStatus, t) }) : `was ${item.previousStatus}`;
}

function runtimeTraceMatchesQuery(trace: RuntimeTraceEvent, query: string, traceLabel?: RuntimeTraceLabeler): boolean {
  return fuzzyTextMatches([
    trace.graphId,
    trace.nodeId,
    trace.nodeName,
    runtimeTraceNodeLabel(trace, traceLabel),
    trace.status,
    trace.message,
    runtimeTraceContextText(trace)
  ], query);
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

function formatRuntimeTraceValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value);
  }
  const serialized = JSON.stringify(value);
  if (serialized) {
    return serialized.length > 80 ? `${serialized.slice(0, 77)}...` : serialized;
  }
  return String(value);
}

function runtimeTraceTimeText(trace: RuntimeTraceEvent, firstTimestamp: number | undefined): string {
  if (typeof trace.timestamp !== "number") {
    return "";
  }
  if (typeof firstTimestamp !== "number") {
    return `${trace.timestamp}ms`;
  }
  return `+${Math.max(0, trace.timestamp - firstTimestamp)}ms`;
}

function runtimeStatusByNodeId(
  graphId: string | undefined,
  traces: RuntimeTraceEvent[],
  activeTrace?: RuntimeTraceEvent
): Map<string, RuntimeTraceEvent> {
  const statuses = new Map<string, RuntimeTraceEvent>();
  for (const trace of traces) {
    if (graphId && trace.graphId !== graphId) {
      continue;
    }
    statuses.set(trace.nodeId, trace);
  }
  if (activeTrace && (!graphId || activeTrace.graphId === graphId)) {
    statuses.set(activeTrace.nodeId, {
      ...activeTrace,
      status: activeTrace.status === "visited" ? "active" : activeTrace.status
    });
  }
  return statuses;
}

function runtimeSurfaceState(
  running: boolean,
  queuedRuns: number,
  nodeStatus: Map<string, RuntimeTraceEvent>,
  output: RuntimeHistoryEntry | undefined
): RunActionBarRuntimeState {
  if (running) {
    const statuses = [...nodeStatus.values()].map((trace) => trace.status);
    if (!statuses.length) {
      return "pending";
    }
    if (statuses.includes("paused") || statuses.includes("breakpoint")) {
      return "paused";
    }
    return "running";
  }
  if (queuedRuns > 0) {
    return "queued";
  }
  if (output && !output.ok) {
    return "error";
  }
  return "idle";
}

function applyRuntimeTraceStatus(
  graphId: string | undefined,
  current: Map<string, RuntimeTraceEvent>,
  trace: RuntimeTraceEvent
): Map<string, RuntimeTraceEvent> {
  if (graphId && trace.graphId !== graphId) {
    return current;
  }
  const statuses = new Map(current);
  if (trace.status === "active") {
    for (const [nodeId, status] of statuses.entries()) {
      if (status.status === "active") {
        statuses.set(nodeId, { ...status, status: "visited" });
      }
    }
  }
  statuses.set(trace.nodeId, trace);
  return statuses;
}

function rankedTemplates(templates: BlueprintNodeTemplate[], search: string, sourcePort: DragPort | undefined, prefs: NodePalettePrefs, locale: Locale): BlueprintNodeTemplate[] {
  const tokens = fuzzySearchTokens(search);
  return templates
    .filter((template) => !sourcePort || templateHasCompatiblePort(template, sourcePort))
    .filter((template) => {
      if (!tokens.length) {
        return true;
      }
      return fuzzyValuesMatchTokens(templateSearchValues(template, locale), tokens);
    })
    .map((template, index) => ({ template, index, score: templateScore(template, tokens, sourcePort, prefs, locale) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.template);
}

function templateAvailableForCreation(template: BlueprintNodeTemplate, disabledPackageIds: Set<string>, sources: TemplateRegistrySourceSummary[]): boolean {
  if (disabledPackageIds.has(templatePackageId(template))) {
    return false;
  }
  return !sources.some((source) => disabledPackageIds.has(`source:${source.projectPath}`) && templateMatchesRegistrySource(template, source));
}

function templateCategorySummaries(templates: BlueprintNodeTemplate[], prefs: NodePalettePrefs, t: Translator, locale: Locale): TemplateCategorySummary[] {
  const counts = new Map<string, { count: number; displayName: string }>();
  for (const template of templates) {
    const category = templateCategory(template);
    const current = counts.get(category);
    counts.set(category, {
      count: (current?.count ?? 0) + 1,
      displayName: current?.displayName ?? templateCategoryDisplayName(category, template, t, locale)
    });
  }
  const favoriteIds = new Set(prefs.favoriteTemplateIds);
  const recentIds = new Set(prefs.recentTemplateIds);
  const favoriteCount = templates.filter((template) => favoriteIds.has(template.id)).length;
  const recentCount = templates.filter((template) => recentIds.has(template.id)).length;
  return [
    { id: allTemplateCategoryId, name: t("common.all"), count: templates.length },
    ...(favoriteCount ? [{ id: favoriteTemplateCategoryId, name: t("nodeCreation.favorites"), count: favoriteCount }] : []),
    ...(recentCount ? [{ id: recentTemplateCategoryId, name: t("nodeCreation.recent"), count: recentCount }] : []),
    ...[...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entry]) => ({ id: `category:${name}`, name: entry.displayName, count: entry.count }))
  ];
}

function templateCategory(template: BlueprintNodeTemplate): string {
  return template.creationPath.split("/")[0]?.trim() || "General";
}

function templateCategoryDisplayName(category: string, template: BlueprintNodeTemplate | undefined, t: Translator, locale: Locale): string {
  if (template) {
    const localizedCategory = localizedTemplateText(template, locale).creationPath.split("/")[0]?.trim();
    if (localizedCategory) {
      return localizedCategory;
    }
  }
  return category === "General" ? t("common.general") : category;
}

function templateMatchesPaletteCategory(template: BlueprintNodeTemplate, category: string, prefs: NodePalettePrefs): boolean {
  if (category === favoriteTemplateCategoryId) {
    return prefs.favoriteTemplateIds.includes(template.id);
  }
  if (category === recentTemplateCategoryId) {
    return prefs.recentTemplateIds.includes(template.id);
  }
  return templateCategory(template) === category.replace(/^category:/, "");
}

function templateRegistryPackages(templates: BlueprintNodeTemplate[], sources: TemplateRegistrySourceSummary[], t: Translator, locale: Locale): TemplateRegistryPackageSummary[] {
  const packages = new Map<string, { name: string; templates: BlueprintNodeTemplate[]; projectPath?: string; sourceGlobs: string[]; templatePackages: string[]; builtinGroups: string[] }>();
  packages.set("all", { name: t("templateRegistry.allTemplates"), templates, sourceGlobs: [], templatePackages: [], builtinGroups: [] });
  for (const template of templates) {
    const id = templatePackageId(template);
    const current = packages.get(id) ?? { name: templatePackageName(template, t), templates: [], sourceGlobs: [], templatePackages: [], builtinGroups: [] };
    packages.set(id, { ...current, templates: [...current.templates, template] });
  }
  for (const source of sources) {
    if (!source.templateSources.length && !source.builtinGroups.length) {
      continue;
    }
    const sourceTemplates = templates.filter((template) => templateMatchesRegistrySource(template, source));
    packages.set(`source:${source.projectPath}`, {
      name: t("templateRegistry.projectSources", { projectName: source.projectName }),
      templates: sourceTemplates,
      projectPath: source.projectPath,
      sourceGlobs: source.templateSources,
      templatePackages: (source.templatePackages ?? []).map((manifest) => `${localizedManifestText(manifest.i18n?.name, manifest.name, locale)} ${manifest.version}`),
      builtinGroups: source.builtinGroups
    });
  }

  return [...packages.entries()].map(([id, entry]) => ({
    id,
    name: entry.name,
    templates: entry.templates,
    templateCount: entry.templates.length,
    categories: [...new Set(entry.templates.map(templateCategory))].sort(),
    bodyKinds: [...new Set(entry.templates.map((template) => template.bodyKind))].sort(),
    projectPath: entry.projectPath,
    sourceGlobs: entry.sourceGlobs,
    templatePackages: entry.templatePackages,
    builtinGroups: entry.builtinGroups
  }));
}

function localizedManifestText(text: Record<string, string | undefined> | undefined, fallback: string, locale: Locale): string {
  return text?.[locale]?.trim() || text?.[fallbackLocale]?.trim() || fallback;
}

function templateRegistryTemplates(packages: TemplateRegistryPackageSummary[], packageId: string, query: string, t: Translator, locale: Locale): BlueprintNodeTemplate[] {
  const templates = packages.find((summary) => summary.id === packageId)?.templates ?? [];
  const tokens = fuzzySearchTokens(query);
  return templates
    .filter((template) => {
      if (!tokens.length) {
        return true;
      }
      return fuzzyValuesMatchTokens([
        localizedTemplateSearchText(template, locale),
        template.bodyKind,
        templatePackageName(template, t)
      ], tokens);
    })
    .sort((left, right) => {
      const leftText = localizedTemplateText(left, locale);
      const rightText = localizedTemplateText(right, locale);
      return leftText.creationPath.localeCompare(rightText.creationPath) || leftText.name.localeCompare(rightText.name);
    });
}

function templateMatchesRegistrySource(template: BlueprintNodeTemplate, source: TemplateRegistrySourceSummary): boolean {
  if (!source.templateSources.length) {
    return false;
  }
  const sourcePath = templateSourcePath(template);
  if (!sourcePath) {
    return false;
  }
  const candidatePaths = sourcePathSuffixes(sourcePath);
  return source.templateSources.some((glob) => candidatePaths.some((candidatePath) => sourceGlobMatchesPath(glob, candidatePath)));
}

function templateSourcePath(template: BlueprintNodeTemplate): string | undefined {
  const source = typeof template.metadata?.source === "string" ? template.metadata.source : template.bodyRef.split("#")[0];
  const normalized = normalizeTemplatePath(source);
  return normalized || undefined;
}

function sourcePathSuffixes(pathValue: string): string[] {
  const segments = normalizeTemplatePath(pathValue).split("/").filter(Boolean);
  return segments.map((_, index) => segments.slice(index).join("/"));
}

function sourceGlobMatchesPath(glob: string, pathValue: string): boolean {
  const normalizedGlob = normalizeTemplatePath(glob);
  const normalizedPath = normalizeTemplatePath(pathValue);
  if (!normalizedGlob || !normalizedPath) {
    return false;
  }
  if (!normalizedGlob.includes("*")) {
    return normalizedPath === normalizedGlob || normalizedPath.endsWith(`/${normalizedGlob}`);
  }
  return globToRegExp(normalizedGlob).test(normalizedPath);
}

function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      const after = glob[index + 2];
      pattern += after === "/" ? "(?:.*/)?" : ".*";
      index += after === "/" ? 2 : 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else {
      pattern += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}

function normalizeTemplatePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+/g, "/");
}

function templatePackageId(template: BlueprintNodeTemplate): string {
  if (template.id.startsWith("builtin.")) {
    return "builtin";
  }
  if (template.bodyKind === "blueprintGraph") {
    return "graph";
  }
  if (template.bodyKind === "macroExpansion") {
    return "macro";
  }
  return "typescript";
}

function templatePackageName(template: BlueprintNodeTemplate, t: Translator): string {
  const id = templatePackageId(template);
  if (id === "builtin") {
    return t("templateRegistry.builtInTypeScript");
  }
  if (id === "graph") {
    return t("templateRegistry.graphTemplates");
  }
  if (id === "macro") {
    return t("templateRegistry.macros");
  }
  return t("templateRegistry.typeScriptTemplates");
}

function templateBodyKindLabel(bodyKind: TemplateBodyKind, t: Translator): string {
  switch (bodyKind) {
    case "typescriptFunction":
      return t("templateRegistry.bodyKind.typescriptFunction");
    case "typescriptBuiltin":
      return t("templateRegistry.bodyKind.typescriptBuiltin");
    case "blueprintGraph":
      return t("templateRegistry.bodyKind.blueprintGraph");
    case "macroExpansion":
      return t("templateRegistry.bodyKind.macroExpansion");
  }
}

function templatePortCount(template: BlueprintNodeTemplate): number {
  return template.inputs.length + template.outputs.length + template.controlInputs.length + template.controlOutputs.length;
}

function templateHasCompatiblePort(template: BlueprintNodeTemplate, sourcePort: DragPort): boolean {
  return compatiblePortsForTemplate(template, sourcePort).length > 0;
}

function compatiblePortsForTemplate(template: BlueprintNodeTemplate, sourcePort: DragPort): BlueprintPortDefinition[] {
  const ports = sourcePort.direction === "output" ? [...template.inputs, ...template.controlInputs] : [...template.outputs, ...template.controlOutputs];
  return ports.filter((port) => isCompatiblePortType(sourcePort, port));
}

function isCompatiblePortType(sourcePort: DragPort, port: BlueprintPortDefinition): boolean {
  return port.flowKind === sourcePort.flowKind && (port.type === sourcePort.type || port.type === "unknown" || sourcePort.type === "unknown");
}

function pinCreationTargetTitle(
  sourcePort: DragPort,
  targetPort: BlueprintPortDefinition,
  t: Translator,
  targetTemplate: BlueprintNodeTemplate | undefined,
  locale: Locale,
  nodeLabelMode: NodeLabelMode
): string {
  const sourceDirection = sourcePort.direction === "output" ? "output" : "input";
  const targetDirection = sourcePort.direction === "output" ? "input" : "output";
  const targetPortText = displayPortText(targetTemplate, targetPort, locale, nodeLabelMode);
  return `${t("nodeCreation.fromPin", { direction: sourceDirection, flowKind: sourcePort.flowKind })} ${sourcePort.type} ${t("nodeCreation.willConnectTo", { direction: targetDirection, port: targetPortText.name })}: ${targetPort.type}`;
}

function templateScore(template: BlueprintNodeTemplate, tokens: string[], sourcePort: DragPort | undefined, prefs: NodePalettePrefs, locale: Locale): number {
  let score = 0;
  const favoriteIndex = prefs.favoriteTemplateIds.indexOf(template.id);
  if (favoriteIndex >= 0) {
    score += 120 - favoriteIndex;
  }
  const recentIndex = prefs.recentTemplateIds.indexOf(template.id);
  if (recentIndex >= 0) {
    score += 80 - recentIndex;
  }
  if (sourcePort) {
    score += compatiblePortScore(template, sourcePort);
  }
  if (tokens.length) {
    const templateText = localizedTemplateText(template, locale);
    score += scoreFuzzySearchValues([
      { label: "name", value: templateText.name },
      { label: "name", value: template.name },
      { label: "path", value: templateText.creationPath },
      { label: "path", value: template.creationPath },
      { label: "search", value: localizedTemplateSearchText(template, locale) }
    ], tokens).score;
  }
  return score;
}

function templateSearchValues(template: BlueprintNodeTemplate, locale: Locale): string[] {
  const templateText = localizedTemplateText(template, locale);
  return [
    localizedTemplateSearchText(template, locale),
    template.id,
    template.name,
    template.creationPath,
    template.description,
    templateText.name,
    templateText.creationPath,
    templateText.description,
    template.bodyKind,
    template.bodyRef
  ];
}

function compatiblePortScore(template: BlueprintNodeTemplate, sourcePort: DragPort): number {
  return Math.max(
    0,
    ...compatiblePortsForTemplate(template, sourcePort)
      .map((port) => {
        if (port.type === sourcePort.type) {
          return 140;
        }
        if (port.type === "unknown" || sourcePort.type === "unknown") {
          return 80;
        }
        return 0;
      })
  );
}

function portCompatibilityForDrag(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  sourcePort: DragPort | undefined,
  targetPort: DragPort
): PortCompatibility | undefined {
  if (!sourcePort || (sourcePort.nodeId === targetPort.nodeId && sourcePort.portId === targetPort.portId)) {
    return undefined;
  }
  return createLinkBetweenExistingPorts(graph, templates, sourcePort, targetPort) ? "compatible" : "incompatible";
}

function createLinkForNewNode(sourcePort: DragPort, node: BlueprintNodeInstance, template: BlueprintNodeTemplate): BlueprintLink | undefined {
  const ports = sourcePort.direction === "output" ? [...template.inputs, ...template.controlInputs] : [...template.outputs, ...template.controlOutputs];
  const target = ports.find((port) => port.flowKind === sourcePort.flowKind && (port.type === sourcePort.type || port.type === "unknown" || sourcePort.type === "unknown"));
  if (!target) {
    return undefined;
  }

  const data = sourcePort.flowKind === "data";
  if (sourcePort.direction === "output") {
    return {
      id: `link-${Date.now().toString(36)}`,
      fromNodeId: sourcePort.nodeId,
      fromPortId: sourcePort.portId,
      toNodeId: node.id,
      toPortId: target.id,
      flowKind: sourcePort.flowKind,
      contextVariableId: data ? `ctx-${Date.now().toString(36)}` : undefined
    };
  }

  return {
    id: `link-${Date.now().toString(36)}`,
    fromNodeId: node.id,
    fromPortId: target.id,
    toNodeId: sourcePort.nodeId,
    toPortId: sourcePort.portId,
    flowKind: sourcePort.flowKind,
    contextVariableId: data ? `ctx-${Date.now().toString(36)}` : undefined
  };
}

function createLinkBetweenExistingPorts(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], a: DragPort, b: DragPort): BlueprintLink | undefined {
  if (a.nodeId === b.nodeId && a.portId === b.portId) {
    return undefined;
  }
  if (a.direction === b.direction || a.flowKind !== b.flowKind) {
    return undefined;
  }

  const output = a.direction === "output" ? a : b;
  const input = a.direction === "input" ? a : b;
  const outputPort = resolvePort(graph, templates, output);
  const inputPort = resolvePort(graph, templates, input);
  if (!outputPort || !inputPort || outputPort.direction !== "output" || inputPort.direction !== "input") {
    return undefined;
  }
  if (outputPort.flowKind !== inputPort.flowKind || outputPort.flowKind !== output.flowKind) {
    return undefined;
  }
  if (outputPort.flowKind === "data" && !areTypesCompatible(outputPort.type, inputPort.type)) {
    return undefined;
  }

  const suffix = Date.now().toString(36);
  return {
    id: `link-${output.nodeId}-${output.portId}-${input.nodeId}-${input.portId}-${suffix}`.replace(/[^A-Za-z0-9_-]/g, "-"),
    fromNodeId: output.nodeId,
    fromPortId: output.portId,
    toNodeId: input.nodeId,
    toPortId: input.portId,
    flowKind: outputPort.flowKind,
    contextVariableId: outputPort.flowKind === "data" ? `ctx-${suffix}` : undefined
  };
}

function resolvePort(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], dragPort: DragPort): BlueprintPortDefinition | undefined {
  const node = graph.nodes.find((candidate) => candidate.id === dragPort.nodeId);
  const template = node ? getEffectiveTemplateForNode(graph, templates, node) : undefined;
  return template ? findPort(template, dragPort.portId) : undefined;
}

function resolvePortMenuTarget(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  state: PortContextMenuState
): { node: BlueprintNodeInstance; port: BlueprintPortDefinition } | undefined {
  const node = graph.nodes.find((candidate) => candidate.id === state.nodeId);
  const template = node ? getEffectiveTemplateForNode(graph, templates, node) : undefined;
  const port = template ? findPort(template, state.portId) : undefined;
  return node && port ? { node, port } : undefined;
}

function isRoutingHubNode(node: BlueprintNodeInstance): boolean {
  return node.templateId === controlHubTemplateId || node.templateId === dataHubTemplateId;
}

function applyLinkChange(graph: BlueprintGraph, link: BlueprintLink): BlueprintGraph {
  const replacedLinkIds = new Set(
    graph.links.filter((candidate) => candidate.toNodeId === link.toNodeId && candidate.toPortId === link.toPortId).map((candidate) => candidate.id)
  );
  const withoutReplaced = removeLinks(graph, replacedLinkIds);
  const nodes = link.flowKind === "data"
    ? withoutReplaced.nodes.map((node) =>
        node.id === link.toNodeId
          ? {
              ...node,
              inputBindings: {
                ...node.inputBindings,
                [link.toPortId]: { portId: link.toPortId, sourceKind: "link" as const, linkId: link.id }
              }
            }
          : node
      )
    : withoutReplaced.nodes;
  return { ...withoutReplaced, nodes, links: [...withoutReplaced.links, link] };
}

function midpointForLink(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], link: BlueprintLink): Point {
  const from = portPoint(graph, templates, link.fromNodeId, link.fromPortId) ?? graph.nodes.find((node) => node.id === link.fromNodeId)?.position;
  const to = portPoint(graph, templates, link.toNodeId, link.toPortId) ?? graph.nodes.find((node) => node.id === link.toNodeId)?.position;
  if (!from && !to) {
    return { x: 0, y: 0 };
  }
  if (!from) {
    return { x: to!.x - 120, y: to!.y };
  }
  if (!to) {
    return { x: from.x + 120, y: from.y };
  }
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function areTypesCompatible(fromType: string, toType: string): boolean {
  return toType === "unknown" || fromType === "unknown" || fromType === toType;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isBlankCanvasTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !target.closest(".node, .port, .wire, .node-panel, .comment-box");
}

function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  };
}

function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

function visibleNodesForCanvas(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  viewport: BlueprintGraph["layout"]["viewport"],
  canvasSize: { width: number; height: number },
  selectedNodeIds: Set<string>,
  runtimeNodeStatus: Map<string, RuntimeTraceEvent>,
  focusedIssueKey: string | undefined,
  issues: ValidationIssue[]
): BlueprintNodeInstance[] {
  if (graph.nodes.length <= canvasNodeCullThreshold || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return graph.nodes;
  }

  const focusedIssue = focusedIssueKey ? issues.find((issue) => issueKey(issue) === focusedIssueKey) : undefined;
  const importantNodeIds = importantNodeIdsForCanvas(graph, selectedNodeIds, runtimeNodeStatus, focusedIssue);
  if (focusedIssue?.nodeId) {
    importantNodeIds.add(focusedIssue.nodeId);
  }

  const visibleRect = visibleGraphRect(viewport, canvasSize);

  return graph.nodes.filter((node) => importantNodeIds.has(node.id) || rectIntersects(visibleRect, nodeBounds(graph, templates, node)));
}

function visibleLinksForCanvas(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  viewport: BlueprintGraph["layout"]["viewport"],
  canvasSize: { width: number; height: number },
  selectedNodeIds: Set<string>,
  selectedLinkIds: Set<string>,
  runtimeNodeStatus: Map<string, RuntimeTraceEvent>,
  focusedIssueKey: string | undefined,
  issues: ValidationIssue[]
): BlueprintLink[] {
  if (graph.nodes.length <= canvasNodeCullThreshold || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return graph.links;
  }

  const focusedIssue = focusedIssueKey ? issues.find((issue) => issueKey(issue) === focusedIssueKey) : undefined;
  const importantNodeIds = importantNodeIdsForCanvas(graph, selectedNodeIds, runtimeNodeStatus, focusedIssue);
  const focusedLinkId = focusedIssue?.linkId;
  const visibleRect = visibleGraphRect(viewport, canvasSize);

  return graph.links.filter((link) => {
    if (selectedLinkIds.has(link.id) || focusedLinkId === link.id || importantNodeIds.has(link.fromNodeId) || importantNodeIds.has(link.toNodeId)) {
      return true;
    }
    const bounds = linkBounds(graph, templates, link);
    return bounds ? rectIntersects(visibleRect, bounds) : true;
  });
}

function importantNodeIdsForCanvas(
  graph: BlueprintGraph,
  selectedNodeIds: Set<string>,
  runtimeNodeStatus: Map<string, RuntimeTraceEvent>,
  focusedIssue: ValidationIssue | undefined
): Set<string> {
  const importantNodeIds = new Set<string>([...selectedNodeIds, ...runtimeNodeStatus.keys()]);
  if (focusedIssue?.nodeId) {
    importantNodeIds.add(focusedIssue.nodeId);
  }
  if (focusedIssue?.linkId) {
    const link = graph.links.find((candidate) => candidate.id === focusedIssue.linkId);
    if (link) {
      importantNodeIds.add(link.fromNodeId);
      importantNodeIds.add(link.toNodeId);
    }
  }
  return importantNodeIds;
}

function visibleGraphRect(
  viewport: BlueprintGraph["layout"]["viewport"],
  canvasSize: { width: number; height: number }
): Rect {
  return {
    x: (-viewport.x - canvasNodeCullMargin) / viewport.zoom,
    y: (-viewport.y - canvasNodeCullMargin) / viewport.zoom,
    width: (canvasSize.width + canvasNodeCullMargin * 2) / viewport.zoom,
    height: (canvasSize.height + canvasNodeCullMargin * 2) / viewport.zoom
  };
}

function linkBounds(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], link: BlueprintLink): Rect | undefined {
  const from = portPoint(graph, templates, link.fromNodeId, link.fromPortId);
  const to = portPoint(graph, templates, link.toNodeId, link.toPortId);
  if (!from || !to) {
    return undefined;
  }
  return boundsForRects([
    { x: from.x, y: from.y, width: 1, height: 1 },
    { x: to.x, y: to.y, width: 1, height: 1 }
  ]);
}

function nodeBounds(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], node: BlueprintNodeInstance): Rect {
  const template = getEffectiveTemplateForNode(graph, templates, node);
  return {
    x: node.position.x,
    y: node.position.y,
    width: renderedNodeWidth(template),
    height: renderedNodeHeight(template)
  };
}

function boundsForNodes(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], nodes: BlueprintNodeInstance[]): Rect & { center: Point } {
  const bounds = nodes.map((node) => nodeBounds(graph, templates, node));
  const rect = boundsForRects(bounds);
  return {
    ...rect,
    center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  };
}

function boundsForRects(rects: Rect[]): Rect {
  const fallback = rects[0] ?? { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...rects.map((bound) => bound.x), fallback.x);
  const minY = Math.min(...rects.map((bound) => bound.y), fallback.y);
  const maxX = Math.max(...rects.map((bound) => bound.x + bound.width), fallback.x + fallback.width);
  const maxY = Math.max(...rects.map((bound) => bound.y + bound.height), fallback.y + fallback.height);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function selectionBoundsForGraph(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  selectedNodeIds: Set<string>,
  selectedCommentIds: Set<string>,
  selectedLinkIds: Set<string>
): Rect | undefined {
  if (!selectedNodeIds.size && !selectedCommentIds.size && !selectedLinkIds.size) {
    return undefined;
  }
  const linkNodeIds = new Set(
    graph.links
      .filter((link) => selectedLinkIds.has(link.id))
      .flatMap((link) => [link.fromNodeId, link.toNodeId])
  );
  const rects = [
    ...graph.nodes
      .filter((node) => selectedNodeIds.has(node.id) || linkNodeIds.has(node.id))
      .map((node) => nodeBounds(graph, templates, node)),
    ...graphComments(graph)
      .filter((comment) => selectedCommentIds.has(comment.id))
      .map((comment) => ({
        x: comment.position.x,
        y: comment.position.y,
        width: comment.size.width,
        height: comment.size.height
      }))
  ];
  return rects.length ? boundsForRects(rects) : undefined;
}

function wrapCommentAroundNodes(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  comment: BlueprintCommentBox,
  nodes: BlueprintNodeInstance[]
): BlueprintCommentBox {
  const padding = 36;
  const titleHeight = 22;
  const bounds = boundsForNodes(graph, templates, nodes);
  return {
    ...comment,
    nodeIds: nodes.map((node) => node.id),
    position: {
      x: bounds.x - padding,
      y: bounds.y - padding - titleHeight
    },
    size: {
      width: Math.max(260, bounds.width + padding * 2),
      height: Math.max(160, bounds.height + padding * 2 + titleHeight)
    }
  };
}

function minimapContentBounds(graph: BlueprintGraph, templates: BlueprintNodeTemplate[]): Rect {
  const rects: Rect[] = [
    ...graph.nodes.map((node) => nodeBounds(graph, templates, node)),
    ...graphComments(graph).map((comment) => ({
      x: comment.position.x,
      y: comment.position.y,
      width: comment.size.width,
      height: comment.size.height
    }))
  ];
  const first = rects[0] ?? { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...rects.map((rect) => rect.x), first.x);
  const minY = Math.min(...rects.map((rect) => rect.y), first.y);
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width), first.x + first.width);
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height), first.y + first.height);
  const padding = 180;
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2)
  };
}

function projectMinimapRect(rect: Rect, bounds: Rect, scale: number, offset: Point, width: number, height: number): Rect {
  const x = offset.x + (rect.x - bounds.x) * scale;
  const y = offset.y + (rect.y - bounds.y) * scale;
  const right = x + rect.width * scale;
  const bottom = y + rect.height * scale;
  const clippedX = clamp(x, 0, width);
  const clippedY = clamp(y, 0, height);
  return {
    x: clippedX,
    y: clippedY,
    width: Math.max(1, clamp(right, 0, width) - clippedX),
    height: Math.max(1, clamp(bottom, 0, height) - clippedY)
  };
}

function commentFallbackBounds(graph: BlueprintGraph): Rect & { center: Point } {
  const viewport = graph.layout.viewport;
  const width = 360;
  const height = 220;
  const x = (-viewport.x + 280) / viewport.zoom;
  const y = (-viewport.y + 140) / viewport.zoom;
  return {
    x,
    y,
    width,
    height,
    center: { x: x + width / 2, y: y + height / 2 }
  };
}

function graphComments(graph: BlueprintGraph | undefined): BlueprintCommentBox[] {
  return graph?.comments ?? [];
}

function graphBookmarks(graph: BlueprintGraph | undefined): BlueprintBookmark[] {
  return graph?.bookmarks ?? [];
}

function readPalettePrefs(state: unknown): NodePalettePrefs {
  const palette = recordFromUnknown(state).palette;
  if (!isRecord(palette)) {
    return { recentTemplateIds: [], favoriteTemplateIds: [], disabledTemplatePackageIds: [] };
  }
  return {
    recentTemplateIds: stringArray(palette.recentTemplateIds).slice(0, maxRecentTemplates),
    favoriteTemplateIds: stringArray(palette.favoriteTemplateIds),
    disabledTemplatePackageIds: stringArray(palette.disabledTemplatePackageIds)
  };
}

function readBreakpoints(state: unknown, graph?: BlueprintGraph): BlueprintBreakpoint[] {
  const graphBreakpoints = readGraphBreakpoints(graph);
  if (graphBreakpoints) {
    return graphBreakpoints;
  }
  const rawBreakpoints = recordFromUnknown(state).breakpoints;
  return normalizeBreakpointArray(rawBreakpoints);
}

function readRuntimeHistoryState(state: unknown, graphId?: string): { history: RuntimeHistoryEntry[]; active?: RuntimeHistoryEntry } {
  const runtimeHistoryState = recordFromUnknown(state).runtimeHistory;
  const runtimeRecord = recordFromUnknown(runtimeHistoryState);
  const activeId = typeof runtimeRecord.activeId === "string" ? runtimeRecord.activeId : undefined;
  const history = Array.isArray(runtimeRecord.entries)
    ? runtimeRecord.entries
        .flatMap((entry) => normalizeRuntimeHistoryEntry(entry))
        .filter((entry) => !graphId || !entry.graphId || entry.graphId === graphId)
        .slice(0, maxRuntimeHistory)
    : [];
  return {
    history,
    active: history.find((entry) => entry.id === activeId) ?? history[0]
  };
}

function normalizeRuntimeHistoryEntry(value: unknown): RuntimeHistoryEntry[] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.ok !== "boolean" || typeof value.message !== "string" || typeof value.text !== "string") {
    return [];
  }
  const traces = Array.isArray(value.traces) ? value.traces.flatMap((trace) => normalizeRuntimeTraceEvent(trace)) : [];
  return [{
    id: value.id,
    graphId: typeof value.graphId === "string" ? value.graphId : undefined,
    label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : undefined,
    pinned: value.pinned === true ? true : undefined,
    ok: value.ok,
    message: value.message,
    text: value.text,
    durationMs: typeof value.durationMs === "number" ? value.durationMs : 0,
    traces,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now()
  }];
}

function normalizeRuntimeTraceEvent(value: unknown): RuntimeTraceEvent[] {
  if (!isRecord(value) || typeof value.graphId !== "string" || typeof value.nodeId !== "string") {
    return [];
  }
  return [{
    graphId: value.graphId,
    nodeId: value.nodeId,
    nodeName: typeof value.nodeName === "string" ? value.nodeName : undefined,
    status: normalizeRuntimeTraceStatus(value.status),
    message: typeof value.message === "string" ? value.message : undefined,
    context: isRecord(value.context) ? value.context : undefined,
    timestamp: typeof value.timestamp === "number" ? value.timestamp : undefined
  }];
}

function normalizeRuntimeTraceStatus(value: unknown): RuntimeTraceEvent["status"] {
  return value === "active" || value === "paused" || value === "breakpoint" || value === "error" || value === "skipped" ? value : "visited";
}

function readGraphBreakpoints(graph: BlueprintGraph | undefined): BlueprintBreakpoint[] | undefined {
  if (!graph || !Array.isArray(graph.debug?.breakpoints)) {
    return undefined;
  }
  return normalizeBreakpointArray(graph.debug.breakpoints);
}

function normalizeBreakpointArray(rawBreakpoints: unknown): BlueprintBreakpoint[] {
  if (!Array.isArray(rawBreakpoints)) {
    return [];
  }
  return rawBreakpoints.flatMap((candidate) => {
    if (typeof candidate === "string") {
      return candidate ? [{ nodeId: candidate }] : [];
    }
    if (!isRecord(candidate) || typeof candidate.nodeId !== "string" || !candidate.nodeId) {
      return [];
    }
    return [{
      nodeId: candidate.nodeId,
      enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : undefined,
      condition: typeof candidate.condition === "string" && candidate.condition.trim() ? candidate.condition.trim() : undefined
    }];
  });
}

function normalizeBreakpoints(breakpoints: BlueprintBreakpoint[]): BlueprintBreakpoint[] {
  const seen = new Set<string>();
  return breakpoints.flatMap((breakpoint) => {
    if (!breakpoint.nodeId || seen.has(breakpoint.nodeId)) {
      return [];
    }
    seen.add(breakpoint.nodeId);
    return [{
      nodeId: breakpoint.nodeId,
      enabled: typeof breakpoint.enabled === "boolean" ? breakpoint.enabled : undefined,
      condition: breakpoint.condition?.trim() || undefined
    }];
  });
}

function withDebugBreakpoints(graph: BlueprintGraph, breakpoints: BlueprintBreakpoint[]): BlueprintGraph {
  return {
    ...graph,
    debug: {
      ...graph.debug,
      breakpoints: normalizeBreakpoints(breakpoints)
    }
  };
}

function breakpointsForRun(graph: BlueprintGraph, breakpoints: BlueprintBreakpoint[]): BlueprintBreakpoint[] {
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  return breakpoints
    .filter((breakpoint) => graphNodeIds.has(breakpoint.nodeId) && breakpoint.enabled !== false)
    .map((breakpoint) => ({
      nodeId: breakpoint.nodeId,
      condition: breakpoint.condition?.trim() || undefined
    }));
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function shortcutPrefsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length && leftEntries.every(([key, value]) => right[key] === value);
}

function mainToolbarActionsEqual(left: MainToolbarActionId[], right: MainToolbarActionId[]): boolean {
  return left.length === right.length && left.every((actionId, index) => right[index] === actionId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((candidate): candidate is string => typeof candidate === "string") : [];
}

function portPoint(graph: BlueprintGraph, templates: BlueprintNodeTemplate[], nodeId: string, portId: string): Point | undefined {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const template = node ? getEffectiveTemplateForNode(graph, templates, node) : undefined;
  const port = template ? findPort(template, portId) : undefined;
  if (!node || !template || !port) {
    return undefined;
  }

  const allInputs = [...template.controlInputs, ...template.inputs];
  const allOutputs = [...template.controlOutputs, ...template.outputs];
  const collection = port.direction === "input" ? allInputs : allOutputs;
  const local = isRoutingHubTemplate(template)
    ? portLocalPoint(template, port)
    : portLocalPoint(template, collection[Math.max(0, collection.findIndex((candidate) => candidate.id === port.id))] ?? port);
  const x = node.position.x + local.x;
  const y = node.position.y + local.y;
  return { x, y };
}

function nextLinkRenderMode(current: LinkRenderMode): LinkRenderMode {
  const index = linkRenderModes.indexOf(current);
  return linkRenderModes[(index + 1) % linkRenderModes.length] ?? "spline";
}

function toolbarAlignmentKeySuffix(alignment: ToolbarAlignment): "Left" | "Center" | "Right" {
  switch (alignment) {
    case "left":
      return "Left";
    case "center":
      return "Center";
    case "right":
      return "Right";
  }
}

function linkPath(start: Point, end: Point, mode: LinkRenderMode): string {
  if (mode === "straight") {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }
  if (mode === "orthogonal") {
    const middleX = Math.round((start.x + end.x) / 2);
    return `M ${start.x} ${start.y} H ${middleX} V ${end.y} H ${end.x}`;
  }
  const distance = Math.max(80, Math.abs(end.x - start.x) * 0.5);
  return `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`;
}

function normalizeLiteral(value: unknown, port: BlueprintPortDefinition): unknown {
  if (port.type === "number") {
    return Number(value);
  }
  if (port.type === "boolean") {
    return Boolean(value);
  }
  if (port.type === "json") {
    if (typeof value !== "string") {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapPointToGrid(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize
  };
}
