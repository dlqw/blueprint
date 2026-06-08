import { MousePointer2, PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Translator } from "./i18n";
import { CollapsedDockPanel } from "./WorkbenchPanels";

export function InspectorPanel(props: {
  open: boolean;
  t: Translator;
  children?: ReactNode;
  onOpen(): void;
  onClose(): void;
}): JSX.Element {
  const title = props.t("inspector.panel");
  if (!props.open) {
    return <CollapsedDockPanel side="right" title={title} collapsedLabel={props.t("dock.collapsed", { title })} showTitle={props.t("dock.show", { title })} onOpen={props.onOpen} />;
  }

  return (
    <aside className="side-panel inspector">
      <div className="panel-title">
        <span><PanelRight size={16} /> {title}</span>
        <button type="button" title={props.t("dock.hide", { title })} onClick={props.onClose}>
          <PanelRight size={14} />
        </button>
      </div>
      {props.children ?? <div className="empty-state"><MousePointer2 size={18} /> {props.t("inspector.selectNode")}</div>}
    </aside>
  );
}
