import { PanelBottom, PanelLeft, PanelRight } from "lucide-react";
import { ReactNode } from "react";
import type { Translator } from "./i18n";

export function CollapsedDockPanel(props: {
  side: "left" | "right";
  title: string;
  collapsedLabel: string;
  showTitle: string;
  onOpen(): void;
}): JSX.Element {
  const Icon = props.side === "left" ? PanelLeft : PanelRight;
  return (
    <aside className={`dock-strip ${props.side}`} aria-label={props.collapsedLabel}>
      <button type="button" title={props.showTitle} onClick={props.onOpen}>
        <Icon size={16} />
        <span>{props.title}</span>
      </button>
    </aside>
  );
}

export function BottomRunPanel(props: {
  open: boolean;
  status: ReactNode;
  summary: ReactNode;
  details?: ReactNode;
  t: Translator;
  onToggle(): void;
}): JSX.Element {
  return (
    <footer className={props.open ? "output run-panel" : "output run-panel collapsed"}>
      <button className="run-panel-edge-toggle" type="button" title={props.open ? props.t("runPanel.collapseTitle") : props.t("runPanel.expandTitle")} onClick={props.onToggle}>
        <PanelBottom size={14} />
        <span>{props.open ? props.t("runPanel.collapse") : props.t("runPanel.expand")}</span>
      </button>
      {props.open ? (
        <div className="run-panel-body">
          <div className="run-panel-body-summary">
            {props.status}
            {props.summary}
          </div>
          <div className="run-panel-details">{props.details}</div>
        </div>
      ) : null}
    </footer>
  );
}
