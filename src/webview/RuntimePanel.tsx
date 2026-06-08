import type { ReactNode } from "react";
import type { Translator } from "./i18n";
import { BottomRunPanel } from "./WorkbenchPanels";

export function RuntimePanel(props: {
  open: boolean;
  status: ReactNode;
  summary: ReactNode;
  details?: ReactNode;
  t: Translator;
  onToggle(): void;
}): JSX.Element {
  return (
    <BottomRunPanel
      open={props.open}
      status={props.status}
      summary={props.summary}
      details={props.details}
      t={props.t}
      onToggle={props.onToggle}
    />
  );
}
