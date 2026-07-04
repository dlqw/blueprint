import { Braces, CheckCircle2, CircleDot, Copy, Focus, PanelRight, Pencil, Plus, Search, XCircle } from "lucide-react";
import { useState, type KeyboardEvent, type RefObject } from "react";
import type {
  BlueprintBookmark,
  BlueprintBreakpoint,
  BlueprintCommentBox,
  BlueprintGraph,
  BlueprintNodeInstance,
  BlueprintPortDefinition,
  BlueprintNodeTemplate,
  BlueprintSolutionGraphSearchIndex,
  BlueprintSolutionOutline
} from "../shared/blueprint";
import { getEffectiveTemplateForNode } from "../shared/graph";
import { builtinNodeI18nCatalog } from "../shared/nodeI18nCatalog";
import { localizePort, localizeTemplate } from "../shared/templateI18n";
import { templateSourcePath } from "../shared/templateRefactor";
import { fallbackLocale, type Locale, type Translator } from "./i18n";
import type { NodeLabelMode } from "./editorPrefs";
import { CollapsedDockPanel } from "./WorkbenchPanels";
import { CommandButton, IconButton, PanelHeader, SearchBox, TabsList, TabsTrigger, TextInput } from "./ui/primitives";

interface NodeFindEntry {
  node: BlueprintNodeInstance;
  template?: BlueprintNodeTemplate;
  matchLabel?: string;
}

interface SolutionFindEntry {
  graphPath: string;
  graphName: string;
  graphKind: string;
  projectName: string;
  nodeId?: string;
  template?: BlueprintNodeTemplate;
  matchLabel?: string;
}

interface OutlineNodeGroup {
  category: string;
  entries: NodeFindEntry[];
}

interface SolutionReferenceEntry {
  graphPath: string;
  graphName: string;
  projectName: string;
  nodeId: string;
  template?: BlueprintNodeTemplate;
  blackboardKey?: string;
  blackboardAccess?: "get" | "set";
}

interface VariableReferenceEntry {
  node: BlueprintNodeInstance;
  template?: BlueprintNodeTemplate;
  key: string;
  access: "get" | "set";
}

type SidebarTabId = "find" | "blueprint" | "outline" | "references" | "bookmarks" | "breakpoints";

export function BlueprintSidebar(props: {
  open: boolean;
  graph: BlueprintGraph;
  t: Translator;
  locale: Locale;
  nodeLabelMode: NodeLabelMode;
  solution?: BlueprintSolutionOutline;
  solutionGraphIndex?: BlueprintSolutionGraphSearchIndex;
  templates: BlueprintNodeTemplate[];
  breakpoints: BlueprintBreakpoint[];
  nodeFindInputRef: RefObject<HTMLInputElement>;
  nodeFindQuery: string;
  nodeFindResults: NodeFindEntry[];
  solutionFindResults: SolutionFindEntry[];
  selectedNodeIds: Set<string>;
  selectedCommentIds: Set<string>;
  outlineQuery: string;
  graphOutlineNodeCount: number;
  filteredGraphOutlineNodeCount: number;
  visibleGraphOutlineNodeCount: number;
  filteredGraphOutlineNodeGroups: OutlineNodeGroup[];
  graphOutlineCommentCount: number;
  filteredGraphOutlineComments: BlueprintCommentBox[];
  bookmarks: BlueprintBookmark[];
  breakpointNodes: BlueprintNodeInstance[];
  onOpen(): void;
  onOpenGraph(graphPath: string): void;
  onRenameSolutionGraph(graphPath: string, currentName: string): void;
  onAddNode(): void;
  onNodeFindQueryChange(value: string): void;
  onOutlineQueryChange(value: string): void;
  onSelectNode(nodeId: string, additive: boolean): void;
  onSelectNodes(nodeIds: string[]): void;
  onFocusNode(nodeId: string): void;
  onSelectComment(commentId: string, additive: boolean): void;
  onFocusComment(commentId: string): void;
  onFocusBookmark(bookmark: BlueprintBookmark): void;
  onRenameBookmark(bookmarkId: string, label: string): void;
  onDeleteBookmark(bookmarkId: string): void;
  onRenameGraphNodeId(oldNodeId: string, nextNodeId: string): void;
  onRenameSolutionBlackboardKey(oldKey: string, nextKey: string): void;
  onRetargetSolutionTemplate(oldTemplateId: string, nextTemplateId: string): void;
  onRetargetSolutionTemplateSource(oldSourcePath: string, nextSourcePath: string): void;
  onToggleBreakpointEnabled(nodeId: string): void;
  onFocusBreakpoint(nodeId: string): void;
  onSetBreakpointCondition(nodeId: string, condition: string, options?: { commitToGraph?: boolean }): void;
  onClearBreakpoint(nodeId: string): void;
  onClose(): void;
}): JSX.Element {
  const t = props.t;
  const [activeTab, setActiveTab] = useState<SidebarTabId>("outline");
  const templateName = (template: BlueprintNodeTemplate | undefined, fallback: string) => {
    const localized = localizeTemplate(template, props.locale, fallbackLocale, builtinNodeI18nCatalog);
    const source = template?.name ?? fallback;
    return displaySidebarText(localized.name, source, props.nodeLabelMode);
  };
  const templatePath = (template: BlueprintNodeTemplate | undefined) => {
    const localized = localizeTemplate(template, props.locale, fallbackLocale, builtinNodeI18nCatalog);
    return displaySidebarText(localized.creationPath, template?.creationPath ?? "", props.nodeLabelMode);
  };
  const portName = (template: BlueprintNodeTemplate | undefined, port: BlueprintPortDefinition) => {
    const localized = localizePort(template, port, props.locale, fallbackLocale, builtinNodeI18nCatalog);
    return displaySidebarText(localized.name, port.name, props.nodeLabelMode);
  };
  if (!props.open) {
    const title = t("sidebar.title");
    return <CollapsedDockPanel side="left" title={title} collapsedLabel={t("dock.collapsed", { title })} showTitle={t("dock.show", { title })} onOpen={props.onOpen} />;
  }

  const selectOrFocusNode = (nodeId: string, event: Pick<KeyboardEvent | React.MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      props.onSelectNode(nodeId, true);
    } else {
      props.onFocusNode(nodeId);
    }
  };
  const selectedNodeId = props.selectedNodeIds.size === 1 ? [...props.selectedNodeIds][0] : undefined;
  const selectedNode = selectedNodeId ? props.graph.nodes.find((node) => node.id === selectedNodeId) : undefined;
  const selectedTemplate = selectedNode ? getEffectiveTemplateForNode(props.graph, props.templates, selectedNode) : undefined;
  const selectedSourcePath = selectedTemplate ? templateSourcePath(selectedTemplate) : undefined;
  const selectedBlackboardReference = selectedNode ? blackboardReferenceForNode(selectedNode, selectedTemplate) : undefined;
  const templateById = new Map(props.templates.map((template) => [template.id, template]));
  const incomingReferences = selectedNode
    ? props.graph.links
        .filter((link) => link.toNodeId === selectedNode.id)
        .map((link) => ({
          link,
          node: props.graph.nodes.find((node) => node.id === link.fromNodeId)
        }))
        .filter((entry): entry is { link: typeof entry.link; node: BlueprintNodeInstance } => Boolean(entry.node))
    : [];
  const outgoingReferences = selectedNode
    ? props.graph.links
        .filter((link) => link.fromNodeId === selectedNode.id)
        .map((link) => ({
          link,
          node: props.graph.nodes.find((node) => node.id === link.toNodeId)
        }))
        .filter((entry): entry is { link: typeof entry.link; node: BlueprintNodeInstance } => Boolean(entry.node))
    : [];
  const templateReferences = selectedNode
    ? props.graph.nodes
        .filter((node) => node.id !== selectedNode.id && node.templateId === selectedNode.templateId)
        .map((node) => ({ node, template: getEffectiveTemplateForNode(props.graph, props.templates, node) }))
    : [];
  const variableReferences = selectedNode && selectedBlackboardReference
    ? findGraphVariableReferences(props.graph, props.templates, selectedNode, selectedBlackboardReference.key)
    : [];
  const solutionTemplateReferences = selectedNode
    ? findSolutionTemplateReferences(props.solutionGraphIndex, props.solution?.activeGraphPath, props.graph.id, selectedNode, templateById)
    : [];
  const solutionSourceReferences = selectedNode && selectedTemplate
    ? findSolutionSourceReferences(props.solutionGraphIndex, props.solution?.activeGraphPath, props.graph.id, selectedNode, selectedTemplate, templateById)
    : [];
  const solutionVariableReferences = selectedBlackboardReference
    ? findSolutionVariableReferences(props.solutionGraphIndex, props.solution?.activeGraphPath, props.graph.id, selectedBlackboardReference.key, templateById)
    : [];
  const graphInputs = props.graph.templateMetadata?.inputs ?? [];
  const graphOutputs = props.graph.templateMetadata?.outputs ?? [];
  const templateGroups = groupTemplatesByCategory(props.templates, t, props.locale);
  const macroTemplates = props.templates.filter((template) => template.bodyKind === "macroExpansion");
  const graphTemplates = props.templates.filter((template) => template.bodyKind === "blueprintGraph");
  const tabs: Array<{ id: SidebarTabId; label: string; count?: number }> = [
    { id: "find", label: t("sidebar.findNodes"), count: props.nodeFindQuery.trim() ? props.nodeFindResults.length + props.solutionFindResults.length : undefined },
    { id: "blueprint", label: t("sidebar.myBlueprint") },
    { id: "outline", label: t("sidebar.graphOutline"), count: props.graphOutlineNodeCount + props.graphOutlineCommentCount },
    { id: "references", label: t("sidebar.references"), count: selectedNode ? incomingReferences.length + outgoingReferences.length + templateReferences.length + variableReferences.length + solutionTemplateReferences.length + solutionVariableReferences.length + solutionSourceReferences.length : undefined },
    { id: "bookmarks", label: t("sidebar.bookmarks"), count: props.bookmarks.length },
    { id: "breakpoints", label: t("sidebar.breakpoints"), count: props.breakpointNodes.length }
  ];
  const tabContentClassName = (tab: SidebarTabId) => activeTab === tab ? "node-tab-content active" : "node-tab-content";
  const referenceGroupTitle = (label: string, count: number, nodeIds: string[], title: string) => (
    <div className="reference-group-title">
      <span>{label} <span>{count}</span></span>
      <IconButton type="button" title={title} onClick={() => props.onSelectNodes(nodeIds)}>
        <CheckCircle2 size={12} />
      </IconButton>
    </div>
  );
  const solutionReferenceGroupTitle = (
    label: string,
    entries: SolutionReferenceEntry[],
    title: string,
    actions?: { renameKey?: string; templateId?: string; sourcePath?: string }
  ) => (
    <div className="reference-group-title">
      <span>{label} <span>{entries.length}</span></span>
      {actions?.renameKey ? (
        <IconButton type="button" title={t("sidebar.renameSolutionVariable", { key: actions.renameKey })} onClick={() => promptRenameSolutionBlackboardKey(actions.renameKey ?? "", props.onRenameSolutionBlackboardKey, t)}>
          <Pencil size={12} />
        </IconButton>
      ) : null}
      {actions?.templateId ? (
        <IconButton type="button" title={t("sidebar.retargetSolutionTemplate", { templateId: actions.templateId })} onClick={() => promptRetargetSolutionTemplate(actions.templateId ?? "", props.onRetargetSolutionTemplate, t)}>
          <Pencil size={12} />
        </IconButton>
      ) : null}
      {actions?.sourcePath ? (
        <IconButton type="button" title={t("sidebar.retargetSourceFile", { sourcePath: actions.sourcePath })} onClick={() => promptRetargetSolutionTemplateSource(actions.sourcePath ?? "", props.onRetargetSolutionTemplateSource, t)}>
          <Pencil size={12} />
        </IconButton>
      ) : null}
      <IconButton type="button" title={title} onClick={() => copyReferenceEntries(entries)}>
        <Copy size={12} />
      </IconButton>
    </div>
  );

  return (
    <aside className="side-panel nav-panel">
      <PanelHeader
        className="panel-title"
        icon={<Braces size={16} />}
        title={t("sidebar.title")}
        action={(
        <IconButton type="button" title={t("dock.hide", { title: t("sidebar.title") })} onClick={props.onClose}>
          <PanelRight size={14} />
        </IconButton>
        )}
      />
      <TabsList className="node-editor-tabs" label={t("sidebar.title")}>
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            type="button"
            active={activeTab === tab.id}
            aria-controls={`node-tab-${tab.id}`}
            className="node-tab"
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined ? <small>{tab.count}</small> : null}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="node-editor-tab-shell">
        <div id="node-tab-find" role="tabpanel" className={tabContentClassName("find")} hidden={activeTab !== "find"}>
          <CommandButton type="button" className="tool-button" onClick={props.onAddNode}>
            <Plus size={16} /> {t("sidebar.addNode")}
          </CommandButton>
          <SearchBox
            ref={props.nodeFindInputRef}
            className="side-search"
            icon={<Search size={14} />}
            value={props.nodeFindQuery}
            placeholder={t("sidebar.findNodes")}
            onChange={(event) => props.onNodeFindQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const first = props.nodeFindResults[0];
                if (first) {
                  props.onFocusNode(first.node.id);
                }
              }
              if (event.key === "Escape") {
                props.onNodeFindQueryChange("");
                event.currentTarget.blur();
              }
            }}
          />
          {props.nodeFindQuery.trim() ? (
            <div className="mini-list">
              {props.nodeFindResults.map(({ node, template, matchLabel }) => (
                <CommandButton
                  key={node.id}
                  active={props.selectedNodeIds.has(node.id)}
                  className="mini-item"
                  onClick={(event) => selectOrFocusNode(node.id, event)}
                >
                  <span>{templateName(template, node.templateId)}</span>
                  <small>{matchLabel ?? node.id}</small>
                </CommandButton>
              ))}
              {props.solutionFindResults.length ? (
                <>
                  <span className="mini-empty">{t("sidebar.solutionMatches")}</span>
                  {props.solutionFindResults.map((entry) => (
                    <CommandButton
                      key={`${entry.graphPath}:${entry.nodeId ?? "graph"}`}
                      type="button"
                      className="mini-item"
                      title={t("sidebar.openSolutionSearchResult", { graphName: entry.graphName, nodeId: entry.nodeId ?? "" }).trim()}
                      onClick={() => props.onOpenGraph(entry.graphPath)}
                    >
                      <span>{entry.nodeId ? `${templateName(entry.template, entry.nodeId)}` : entry.graphName}</span>
                      <small>{entry.matchLabel ?? `${entry.projectName} / ${entry.graphKind}`}</small>
                    </CommandButton>
                  ))}
                </>
              ) : null}
              {!props.nodeFindResults.length && !props.solutionFindResults.length ? <span className="mini-empty">{t("sidebar.noNodes")}</span> : null}
            </div>
          ) : <span className="mini-empty">{t("sidebar.findNodes")}</span>}
        </div>
        <div id="node-tab-blueprint" role="tabpanel" className={tabContentClassName("blueprint")} hidden={activeTab !== "blueprint"}>
          <div className="structure-list">
        {props.solution ? (
          <>
            <div className="structure-group-title">{t("sidebar.solution")} <span>{props.solution.projects.reduce((count, project) => count + project.graphs.length, 0)}</span></div>
            {props.solution.projects.map((project) => (
              <div key={project.path} className="outline-node-group">
                <div className="outline-subgroup-title">{project.name} <span>{project.graphs.length}</span></div>
                {project.graphs.map((graph) => (
                  <div key={graph.path} className="structure-graph-row">
                    <CommandButton
                      type="button"
                      active={props.solution?.activeGraphPath === graph.path}
                      className="mini-item structure-item"
                      title={t("sidebar.openSolutionGraph", { graphName: graph.name })}
                      onClick={() => props.onOpenGraph(graph.path)}
                    >
                      <span>{graph.name}</span>
                      <small>{graph.kind}</small>
                    </CommandButton>
                    <IconButton
                      type="button"
                      className="structure-graph-action"
                      title={t("sidebar.renameSolutionGraph", { graphName: graph.name })}
                      onClick={() => props.onRenameSolutionGraph(graph.path, graph.name)}
                    >
                      <Pencil size={12} />
                    </IconButton>
                  </div>
                ))}
              </div>
            ))}
          </>
        ) : null}
        <div className="structure-group-title">{t("sidebar.graphs")} <span>1</span></div>
        <CommandButton type="button" active className="mini-item structure-item" title={t("sidebar.activeGraph", { graphName: props.graph.name })} onClick={() => props.onOutlineQueryChange("")}>
          <span>{props.graph.name}</span>
          <small>{props.graph.kind ?? "function"}</small>
        </CommandButton>
        <div className="structure-group-title">{t("sidebar.inputs")} <span>{graphInputs.length}</span></div>
        {graphInputs.map((port) => (
          <span key={port.id} className="mini-item structure-item variable">
            <span>{portName(undefined, port)}</span>
            <small>{port.type}</small>
          </span>
        ))}
        {!graphInputs.length ? <span className="mini-empty">{t("sidebar.noGraphInputs")}</span> : null}
        <div className="structure-group-title">{t("sidebar.outputs")} <span>{graphOutputs.length}</span></div>
        {graphOutputs.map((port) => (
          <span key={port.id} className="mini-item structure-item variable">
            <span>{portName(undefined, port)}</span>
            <small>{port.type}</small>
          </span>
        ))}
        {!graphOutputs.length ? <span className="mini-empty">{t("sidebar.noGraphOutputs")}</span> : null}
        <div className="structure-group-title">{t("sidebar.templates")} <span>{props.templates.length}</span></div>
        {templateGroups.slice(0, 6).map((group) => (
          <span key={group.category} className="mini-item structure-item template">
            <span>{group.category}</span>
            <small>{t("sidebar.templateCount", { count: group.count })}</small>
          </span>
        ))}
        {templateGroups.length > 6 ? <span className="mini-empty">{t("sidebar.templateGroupsMore", { count: templateGroups.length - 6 })}</span> : null}
        <div className="structure-group-title">{t("sidebar.macros")} <span>{macroTemplates.length}</span></div>
        {macroTemplates.slice(0, 4).map((template) => (
          <span key={template.id} className="mini-item structure-item macro">
            <span>{templateName(template, template.id)}</span>
            <small>{templatePath(template)}</small>
          </span>
        ))}
        {!macroTemplates.length ? <span className="mini-empty">{t("sidebar.noMacrosLoaded")}</span> : null}
        {graphTemplates.length ? (
          <span className="mini-empty">{t("sidebar.graphTemplatesLoaded", { count: graphTemplates.length })}</span>
        ) : null}
          </div>
        </div>
        <div id="node-tab-outline" role="tabpanel" className={tabContentClassName("outline")} hidden={activeTab !== "outline"}>
          <div className="outline-list">
        <SearchBox
          className="side-search outline-search"
          icon={<Search size={13} />}
          value={props.outlineQuery}
          placeholder={t("sidebar.filterOutline")}
          onChange={(event) => props.onOutlineQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              props.onOutlineQueryChange("");
              event.currentTarget.blur();
            }
          }}
        />
        <div className="outline-group-title">
          {t("sidebar.nodes")} <span>{props.outlineQuery.trim() ? `${props.filteredGraphOutlineNodeCount}/${props.graphOutlineNodeCount}` : props.graphOutlineNodeCount}</span>
        </div>
        {props.filteredGraphOutlineNodeGroups.map((group) => (
          <div key={group.category} className="outline-node-group">
            <div className="outline-subgroup-title">{group.category} <span>{group.entries.length}</span></div>
            {group.entries.map(({ node, template }) => (
              <CommandButton
                key={node.id}
                active={props.selectedNodeIds.has(node.id)}
                className="mini-item outline-item"
                title={t("sidebar.focusOutlineNode", { nodeId: node.id })}
                onClick={(event) => selectOrFocusNode(node.id, event)}
              >
                <span>{templateName(template, node.templateId)}</span>
                <small>{node.id}</small>
              </CommandButton>
            ))}
          </div>
        ))}
        {props.filteredGraphOutlineNodeCount > props.visibleGraphOutlineNodeCount ? (
          <span className="mini-empty outline-limit">
            {t("sidebar.showingNodesLimit", { visible: props.visibleGraphOutlineNodeCount, total: props.filteredGraphOutlineNodeCount })}
          </span>
        ) : null}
        {props.outlineQuery.trim() && !props.filteredGraphOutlineNodeCount ? <span className="mini-empty">{t("sidebar.noMatchingNodes")}</span> : null}
        {props.graphOutlineCommentCount ? (
          <>
            <div className="outline-group-title">
              {t("sidebar.comments")} <span>{props.outlineQuery.trim() ? `${props.filteredGraphOutlineComments.length}/${props.graphOutlineCommentCount}` : props.graphOutlineCommentCount}</span>
            </div>
            {props.filteredGraphOutlineComments.map((comment) => (
              <CommandButton
                key={comment.id}
                active={props.selectedCommentIds.has(comment.id)}
                className="mini-item outline-item comment"
                title={t("sidebar.focusOutlineComment", { comment: comment.title || comment.id })}
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey) {
                    props.onSelectComment(comment.id, true);
                  } else {
                    props.onFocusComment(comment.id);
                  }
                }}
              >
                <span>{comment.title || t("sidebar.commentFallback")}</span>
                <small>{comment.nodeIds.length ? t("sidebar.groupedNodes", { count: comment.nodeIds.length }) : `${Math.round(comment.position.x)}, ${Math.round(comment.position.y)}`}</small>
              </CommandButton>
            ))}
            {props.outlineQuery.trim() && !props.filteredGraphOutlineComments.length ? <span className="mini-empty">{t("sidebar.noMatchingComments")}</span> : null}
          </>
        ) : null}
          </div>
        </div>
        <div id="node-tab-references" role="tabpanel" className={tabContentClassName("references")} hidden={activeTab !== "references"}>
          {selectedNode ? (
          <div className="reference-list">
          <div className="reference-anchor">
            <span>{templateName(selectedTemplate, selectedNode.templateId)}</span>
            <small>{selectedNode.id}</small>
            <IconButton type="button" title={t("sidebar.renameSelectedNode", { nodeId: selectedNode.id })} onClick={() => promptRenameGraphNodeId(selectedNode.id, props.onRenameGraphNodeId, t)}>
              <Pencil size={12} />
            </IconButton>
          </div>
          {incomingReferences.length ? (
            <>
              {referenceGroupTitle(t("sidebar.incomingWires"), incomingReferences.length, [selectedNode.id, ...incomingReferences.map(({ node }) => node.id)], t("sidebar.selectIncomingReferenceNodes"))}
              {incomingReferences.map(({ link, node }) => {
                const template = getEffectiveTemplateForNode(props.graph, props.templates, node);
                return (
                  <CommandButton key={link.id} className="mini-item reference-item" title={t("sidebar.focusReferenceNode", { nodeId: node.id })} onClick={(event) => selectOrFocusNode(node.id, event)}>
                    <span>{templateName(template, node.templateId)}</span>
                    <small>{node.id}.{link.fromPortId}{" -> "}{selectedNode.id}.{link.toPortId}</small>
                  </CommandButton>
                );
              })}
            </>
          ) : null}
          {outgoingReferences.length ? (
            <>
              {referenceGroupTitle(t("sidebar.outgoingWires"), outgoingReferences.length, [selectedNode.id, ...outgoingReferences.map(({ node }) => node.id)], t("sidebar.selectOutgoingReferenceNodes"))}
              {outgoingReferences.map(({ link, node }) => {
                const template = getEffectiveTemplateForNode(props.graph, props.templates, node);
                return (
                  <CommandButton key={link.id} className="mini-item reference-item" title={t("sidebar.focusReferenceNode", { nodeId: node.id })} onClick={(event) => selectOrFocusNode(node.id, event)}>
                    <span>{templateName(template, node.templateId)}</span>
                    <small>{selectedNode.id}.{link.fromPortId}{" -> "}{node.id}.{link.toPortId}</small>
                  </CommandButton>
                );
              })}
            </>
          ) : null}
          {templateReferences.length ? (
            <>
              {referenceGroupTitle(t("sidebar.sameTemplate"), templateReferences.length, [selectedNode.id, ...templateReferences.map(({ node }) => node.id)], t("sidebar.selectSameTemplateReferenceNodes"))}
              {templateReferences.map(({ node, template }) => (
                <CommandButton key={node.id} className="mini-item reference-item" title={t("sidebar.focusReferenceNode", { nodeId: node.id })} onClick={(event) => selectOrFocusNode(node.id, event)}>
                  <span>{templateName(template, node.templateId)}</span>
                  <small>{node.id}</small>
                </CommandButton>
              ))}
            </>
          ) : null}
          {variableReferences.length ? (
            <>
              {referenceGroupTitle(t("sidebar.variableUses"), variableReferences.length, [selectedNode.id, ...variableReferences.map(({ node }) => node.id)], t("sidebar.selectVariableReferenceNodes"))}
              {variableReferences.map(({ node, template, key, access }) => (
                <CommandButton key={node.id} className="mini-item reference-item" title={t("sidebar.focusVariableReferenceNode", { nodeId: node.id })} onClick={(event) => selectOrFocusNode(node.id, event)}>
                  <span>{access === "get" ? t("sidebar.get") : t("sidebar.set")} {key}</span>
                  <small>{templateName(template, node.templateId)} / {node.id}</small>
                </CommandButton>
              ))}
            </>
          ) : null}
          {solutionTemplateReferences.length ? (
            <>
              {solutionReferenceGroupTitle(t("sidebar.solutionTemplate"), solutionTemplateReferences, t("sidebar.copySolutionTemplateReferences"), { templateId: selectedNode.templateId })}
              {solutionTemplateReferences.map((entry) => (
                <CommandButton
                  key={`${entry.graphPath}:${entry.nodeId}`}
                  type="button"
                  className="mini-item reference-item"
                  title={t("sidebar.openTemplateReference", { graphName: entry.graphName, nodeId: entry.nodeId })}
                  onClick={() => props.onOpenGraph(entry.graphPath)}
                >
                  <span>{templateName(entry.template, selectedNode.templateId)}</span>
                  <small>{entry.projectName} / {entry.graphName} / {entry.nodeId}</small>
                </CommandButton>
              ))}
            </>
          ) : null}
          {solutionVariableReferences.length ? (
            <>
              {solutionReferenceGroupTitle(t("sidebar.solutionVariable"), solutionVariableReferences, t("sidebar.copySolutionVariableReferences"), { renameKey: selectedBlackboardReference?.key })}
              {solutionVariableReferences.map((entry) => (
                <CommandButton
                  key={`${entry.graphPath}:${entry.nodeId}`}
                  type="button"
                  className="mini-item reference-item"
                  title={t("sidebar.openVariableReference", { graphName: entry.graphName, nodeId: entry.nodeId })}
                  onClick={() => props.onOpenGraph(entry.graphPath)}
                >
                  <span>{entry.blackboardAccess === "get" ? t("sidebar.get") : t("sidebar.set")} {entry.blackboardKey}</span>
                  <small>{entry.projectName} / {entry.graphName} / {entry.nodeId}</small>
                </CommandButton>
              ))}
            </>
          ) : null}
          {solutionSourceReferences.length ? (
            <>
              {solutionReferenceGroupTitle(t("sidebar.sourceFile"), solutionSourceReferences, t("sidebar.copySourceFileReferences"), { sourcePath: selectedSourcePath })}
              {solutionSourceReferences.map((entry) => (
                <CommandButton
                  key={`${entry.graphPath}:${entry.nodeId}`}
                  type="button"
                  className="mini-item reference-item"
                  title={t("sidebar.openSourceReference", { graphName: entry.graphName, nodeId: entry.nodeId })}
                  onClick={() => props.onOpenGraph(entry.graphPath)}
                >
                  <span>{templateName(entry.template, entry.nodeId)}</span>
                  <small>{entry.projectName} / {entry.graphName} / {entry.nodeId}</small>
                </CommandButton>
              ))}
            </>
          ) : null}
          {!incomingReferences.length && !outgoingReferences.length && !templateReferences.length && !variableReferences.length && !solutionTemplateReferences.length && !solutionVariableReferences.length && !solutionSourceReferences.length ? <span className="mini-empty">{t("sidebar.noReferences")}</span> : null}
          </div>
          ) : <span className="mini-empty">{t("sidebar.noReferences")}</span>}
        </div>
        <div id="node-tab-bookmarks" role="tabpanel" className={tabContentClassName("bookmarks")} hidden={activeTab !== "bookmarks"}>
          {props.bookmarks.length ? (
          <div className="bookmark-list">
          {props.bookmarks.map((bookmark) => (
            <div key={bookmark.id} className="mini-item bookmark-item">
              <IconButton type="button" className="bookmark-focus" title={t("sidebar.focusBookmark", { label: bookmark.label })} onClick={() => props.onFocusBookmark(bookmark)}>
                <Focus size={13} />
              </IconButton>
              <span className="bookmark-detail">
                <TextInput
                  aria-label={t("sidebar.bookmarkLabel", { label: bookmark.label })}
                  defaultValue={bookmark.label}
                  onBlur={(event) => props.onRenameBookmark(bookmark.id, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                    if (event.key === "Escape") {
                      event.currentTarget.value = bookmark.label;
                      event.currentTarget.blur();
                    }
                  }}
                />
                <small>{bookmark.nodeId ?? `${Math.round(bookmark.position.x)}, ${Math.round(bookmark.position.y)}`}</small>
              </span>
              <IconButton
                type="button"
                className="bookmark-clear"
                title={t("sidebar.deleteBookmark", { label: bookmark.label })}
                onClick={() => props.onDeleteBookmark(bookmark.id)}
              >
                <XCircle size={13} />
              </IconButton>
            </div>
          ))}
          </div>
          ) : <span className="mini-empty">{t("sidebar.bookmarks")}</span>}
        </div>
        <div id="node-tab-breakpoints" role="tabpanel" className={tabContentClassName("breakpoints")} hidden={activeTab !== "breakpoints"}>
          {props.breakpointNodes.length ? (
          <div className="breakpoint-list">
          {props.breakpointNodes.map((node) => {
            const template = getEffectiveTemplateForNode(props.graph, props.templates, node);
            const breakpoint = props.breakpoints.find((candidate) => candidate.nodeId === node.id);
            const enabled = breakpoint?.enabled !== false;
            return (
              <div key={node.id} className="mini-item breakpoint-item">
                <IconButton
                  type="button"
                  active={enabled}
                  className="breakpoint-enabled"
                  title={enabled ? t("sidebar.disableBreakpoint", { nodeId: node.id }) : t("sidebar.enableBreakpoint", { nodeId: node.id })}
                  onClick={() => props.onToggleBreakpointEnabled(node.id)}
                >
                  <CircleDot size={12} />
                </IconButton>
                <CommandButton type="button" className="breakpoint-focus" onClick={() => props.onFocusBreakpoint(node.id)}>
                  <span>{templateName(template, node.templateId)}</span>
                  <small>{node.id}</small>
                </CommandButton>
                <TextInput
                  className="breakpoint-condition"
                  value={breakpoint?.condition ?? ""}
                  placeholder="hit >= 2"
                  title={t("sidebar.breakpointConditionHelp")}
                  onChange={(event) => props.onSetBreakpointCondition(node.id, event.target.value)}
                  onBlur={(event) => props.onSetBreakpointCondition(node.id, event.target.value, { commitToGraph: true })}
                />
                <IconButton
                  type="button"
                  className="breakpoint-clear"
                  title={t("sidebar.clearBreakpoint", { nodeId: node.id })}
                  onClick={() => props.onClearBreakpoint(node.id)}
                >
                  <XCircle size={13} />
                </IconButton>
              </div>
            );
          })}
          </div>
          ) : <span className="mini-empty">{t("sidebar.breakpoints")}</span>}
        </div>
      </div>
    </aside>
  );
}

function groupTemplatesByCategory(templates: BlueprintNodeTemplate[], t: Translator, locale: Locale): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const template of templates) {
    const localized = localizeTemplate(template, locale, fallbackLocale, builtinNodeI18nCatalog);
    const category = localized.creationPath.split("/")[0]?.trim() || template.creationPath.split("/")[0]?.trim() || "General";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => ({ category: category === "General" ? t("common.general") : category, count }));
}

function displaySidebarText(localized: string, source: string, mode: NodeLabelMode): string {
  if (mode === "source") {
    return source || localized;
  }
  if (mode === "both" && localized && source && localized !== source) {
    return `${localized} / ${source}`;
  }
  return localized || source;
}

function findSolutionTemplateReferences(
  index: BlueprintSolutionGraphSearchIndex | undefined,
  activeGraphPath: string | undefined,
  activeGraphId: string,
  selectedNode: BlueprintNodeInstance,
  templateById: Map<string, BlueprintNodeTemplate>
): SolutionReferenceEntry[] {
  if (!index) {
    return [];
  }
  return index.graphs.flatMap((graph) => {
    if (isActiveGraphIndexEntry(graph.graphPath, graph.graphId, activeGraphPath, activeGraphId)) {
      return [];
    }
    return graph.nodes
      .filter((node) => node.templateId === selectedNode.templateId)
      .map((node) => ({
        graphPath: graph.graphPath,
        graphName: graph.graphName,
        projectName: graph.projectName,
        nodeId: node.id,
        template: templateById.get(node.templateId)
      }));
  });
}

function copyReferenceEntries(entries: SolutionReferenceEntry[]): void {
  const text = entries
    .map((entry) => [
      entry.projectName,
      entry.graphName,
      entry.nodeId,
      entry.graphPath
    ].filter(Boolean).join(" / "))
    .join("\n");
  void navigator.clipboard?.writeText(text);
}

function promptRenameSolutionBlackboardKey(oldKey: string, onRename: (oldKey: string, nextKey: string) => void, t: Translator): void {
  const nextKey = window.prompt(t("sidebar.promptRenameSolutionVariable"), oldKey)?.trim();
  if (!nextKey || nextKey === oldKey) {
    return;
  }
  onRename(oldKey, nextKey);
}

function promptRenameGraphNodeId(oldNodeId: string, onRename: (oldNodeId: string, nextNodeId: string) => void, t: Translator): void {
  const nextNodeId = window.prompt(t("sidebar.promptRenameNodeId"), oldNodeId)?.trim();
  if (!nextNodeId || nextNodeId === oldNodeId) {
    return;
  }
  onRename(oldNodeId, nextNodeId);
}

function promptRetargetSolutionTemplate(oldTemplateId: string, onRetarget: (oldTemplateId: string, nextTemplateId: string) => void, t: Translator): void {
  const nextTemplateId = window.prompt(t("sidebar.promptRetargetSolutionTemplate"), oldTemplateId)?.trim();
  if (!nextTemplateId || nextTemplateId === oldTemplateId) {
    return;
  }
  onRetarget(oldTemplateId, nextTemplateId);
}

function promptRetargetSolutionTemplateSource(oldSourcePath: string, onRetarget: (oldSourcePath: string, nextSourcePath: string) => void, t: Translator): void {
  const nextSourcePath = window.prompt(t("sidebar.promptRetargetSourceFile"), oldSourcePath)?.trim();
  if (!nextSourcePath || nextSourcePath === oldSourcePath) {
    return;
  }
  onRetarget(oldSourcePath, nextSourcePath);
}

function findSolutionSourceReferences(
  index: BlueprintSolutionGraphSearchIndex | undefined,
  activeGraphPath: string | undefined,
  activeGraphId: string,
  selectedNode: BlueprintNodeInstance,
  selectedTemplate: BlueprintNodeTemplate,
  templateById: Map<string, BlueprintNodeTemplate>
): SolutionReferenceEntry[] {
  const selectedSourcePath = templateSourcePath(selectedTemplate);
  if (!index || !selectedSourcePath) {
    return [];
  }
  return index.graphs.flatMap((graph) => {
    if (isActiveGraphIndexEntry(graph.graphPath, graph.graphId, activeGraphPath, activeGraphId)) {
      return [];
    }
    return graph.nodes.flatMap((node) => {
      if (node.templateId === selectedNode.templateId) {
        return [];
      }
      const template = templateById.get(node.templateId);
      if (templateSourcePath(template) !== selectedSourcePath) {
        return [];
      }
      return [{
        graphPath: graph.graphPath,
        graphName: graph.graphName,
        projectName: graph.projectName,
        nodeId: node.id,
        template
      }];
    });
  });
}

function findGraphVariableReferences(
  graph: BlueprintGraph,
  templates: BlueprintNodeTemplate[],
  selectedNode: BlueprintNodeInstance,
  key: string
): VariableReferenceEntry[] {
  return graph.nodes.flatMap((node) => {
    if (node.id === selectedNode.id) {
      return [];
    }
    const template = getEffectiveTemplateForNode(graph, templates, node);
    const reference = blackboardReferenceForNode(node, template);
    if (reference?.key !== key) {
      return [];
    }
    return [{
      node,
      template,
      key: reference.key,
      access: reference.access
    }];
  });
}

function findSolutionVariableReferences(
  index: BlueprintSolutionGraphSearchIndex | undefined,
  activeGraphPath: string | undefined,
  activeGraphId: string,
  key: string,
  templateById: Map<string, BlueprintNodeTemplate>
): SolutionReferenceEntry[] {
  if (!index) {
    return [];
  }
  return index.graphs.flatMap((graph) => {
    if (isActiveGraphIndexEntry(graph.graphPath, graph.graphId, activeGraphPath, activeGraphId)) {
      return [];
    }
    return graph.nodes.flatMap((node) => {
      if (node.blackboardKey !== key || !node.blackboardAccess) {
        return [];
      }
      return [{
        graphPath: graph.graphPath,
        graphName: graph.graphName,
        projectName: graph.projectName,
        nodeId: node.id,
        template: templateById.get(node.templateId),
        blackboardKey: node.blackboardKey,
        blackboardAccess: node.blackboardAccess
      }];
    });
  });
}

function isActiveGraphIndexEntry(graphPath: string, graphId: string, activeGraphPath: string | undefined, activeGraphId: string): boolean {
  return graphId === activeGraphId || Boolean(activeGraphPath && graphPath === activeGraphPath);
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
