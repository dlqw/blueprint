import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

type PrimitiveButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
};

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const DialogBackdrop = forwardRef<HTMLDivElement, {
  children: ReactNode;
  className?: string;
  onDismiss(): void;
}>((props, ref) => {
  return (
    <div
      ref={ref}
      className={cx("ui-dialog-backdrop", props.className)}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onDismiss();
        }
      }}
    >
      {props.children}
    </div>
  );
});
DialogBackdrop.displayName = "DialogBackdrop";

export const DialogFrame = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
  label: string;
  children: ReactNode;
}>((props, ref) => {
  const { label, children, className, ...rest } = props;
  return (
    <section ref={ref} {...rest} className={cx("ui-dialog-frame", className)} role="dialog" aria-label={label}>
      {children}
    </section>
  );
});
DialogFrame.displayName = "DialogFrame";

export const DialogHeader = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
  icon?: ReactNode;
  title: ReactNode;
  action?: ReactNode;
}>((props, ref) => {
  const { icon, title, action, className, ...rest } = props;
  return (
    <header ref={ref} {...rest} className={cx("ui-dialog-header", className)}>
      {icon}
      <strong>{title}</strong>
      {action}
    </header>
  );
});
DialogHeader.displayName = "DialogHeader";

export const PanelHeader = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
  icon?: ReactNode;
  title: ReactNode;
  action?: ReactNode;
}>((props, ref) => {
  const { icon, title, action, className, ...rest } = props;
  return (
    <header ref={ref} {...rest} className={cx("ui-panel-header", className)}>
      <span>
        {icon}
        {title}
      </span>
      {action}
    </header>
  );
});
PanelHeader.displayName = "PanelHeader";

export const SearchBox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & {
  icon: ReactNode;
  className?: string;
}>((props, ref) => {
  const { icon, className, ...inputProps } = props;
  return (
    <label className={cx("ui-search-box", className)}>
      {icon}
      <input ref={ref} {...inputProps} />
    </label>
  );
});
SearchBox.displayName = "SearchBox";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => {
  const { className, disabled, type, ...inputProps } = props;
  return <input ref={ref} {...inputProps} disabled={disabled} data-disabled={disabledState(disabled)} type={type ?? "text"} className={cx("ui-text-input", className)} />;
});
TextInput.displayName = "TextInput";

export const NumberInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => {
  const { className, disabled, ...inputProps } = props;
  return <input ref={ref} {...inputProps} disabled={disabled} data-disabled={disabledState(disabled)} type="number" className={cx("ui-number-input", className)} />;
});
NumberInput.displayName = "NumberInput";

export const CheckboxInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => {
  const { className, disabled, ...inputProps } = props;
  return <input ref={ref} {...inputProps} disabled={disabled} data-disabled={disabledState(disabled)} type="checkbox" className={cx("ui-checkbox-input", className)} />;
});
CheckboxInput.displayName = "CheckboxInput";

export const ColorInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => {
  const { className, disabled, ...inputProps } = props;
  return <input ref={ref} {...inputProps} disabled={disabled} data-disabled={disabledState(disabled)} type="color" className={cx("ui-color-input", className)} />;
});
ColorInput.displayName = "ColorInput";

export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>((props, ref) => {
  const { className, children, disabled, ...selectProps } = props;
  return (
    <select ref={ref} {...selectProps} disabled={disabled} data-disabled={disabledState(disabled)} className={cx("ui-select-input", className)}>
      {children}
    </select>
  );
});
SelectInput.displayName = "SelectInput";

function primitiveButtonType(type: ButtonHTMLAttributes<HTMLButtonElement>["type"]): ButtonHTMLAttributes<HTMLButtonElement>["type"] {
  return type ?? "button";
}

function primitiveState(active: boolean | undefined): "active" | "inactive" {
  return active ? "active" : "inactive";
}

function disabledState(disabled: boolean | undefined): "" | undefined {
  return disabled ? "" : undefined;
}

export const IconButton = forwardRef<HTMLButtonElement, PrimitiveButtonProps>((props, ref) => {
  const { active, children, className, disabled, type, title, ...buttonProps } = props;
  const ariaLabel = buttonProps["aria-label"] ?? (typeof title === "string" ? title : undefined);
  return (
    <button
      ref={ref}
      {...buttonProps}
      type={primitiveButtonType(type)}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      data-state={primitiveState(active)}
      data-disabled={disabledState(disabled)}
      className={cx("ui-icon-button", active && "active", className)}
    >
      {children}
    </button>
  );
});
IconButton.displayName = "IconButton";

export const CommandButton = forwardRef<HTMLButtonElement, PrimitiveButtonProps>((props, ref) => {
  const { active, children, className, disabled, type, ...buttonProps } = props;
  return (
    <button ref={ref} {...buttonProps} type={primitiveButtonType(type)} disabled={disabled} data-state={primitiveState(active)} data-disabled={disabledState(disabled)} className={cx("ui-command-button", active && "active", className)}>
      {children}
    </button>
  );
});
CommandButton.displayName = "CommandButton";

export const ListActionButton = forwardRef<HTMLButtonElement, PrimitiveButtonProps & {
  trailing?: ReactNode;
}>((props, ref) => {
  const { active, trailing, children, className, disabled, type, ...buttonProps } = props;
  return (
    <button ref={ref} {...buttonProps} type={primitiveButtonType(type)} disabled={disabled} data-state={primitiveState(active)} data-disabled={disabledState(disabled)} className={cx("ui-list-action", active && "active", className)}>
      <span>{children}</span>
      {trailing}
    </button>
  );
});
ListActionButton.displayName = "ListActionButton";

export function KeyboardShortcut(props: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <kbd className={cx("ui-keyboard-shortcut", props.className)}>{props.children}</kbd>;
}

export const MenuSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  label: string;
  children: ReactNode;
}>((props, ref) => {
  const { label, children, className, ...rest } = props;
  return (
    <div ref={ref} {...rest} className={cx("ui-menu-surface", className)} role="menu" aria-label={label}>
      {children}
    </div>
  );
});
MenuSurface.displayName = "MenuSurface";

export const MenuSection = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  children: ReactNode;
}>((props, ref) => {
  const { title, children, className, ...rest } = props;
  return (
    <div ref={ref} {...rest} className={cx("ui-menu-section", className)}>
      <span className="ui-menu-section-title">{title}</span>
      {children}
    </div>
  );
});
MenuSection.displayName = "MenuSection";

export const MenuActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  children: ReactNode;
}>((props, ref) => {
  const { icon, children, className, disabled, type, ...buttonProps } = props;
  return (
    <button ref={ref} {...buttonProps} type={primitiveButtonType(type)} disabled={disabled} data-disabled={disabledState(disabled)} className={cx("ui-menu-action", className)} role="menuitem">
      {icon}
      <span>{children}</span>
    </button>
  );
});
MenuActionButton.displayName = "MenuActionButton";

export const TabsList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  label: string;
  children: ReactNode;
}>((props, ref) => {
  const { label, children, className, ...rest } = props;
  return (
    <div ref={ref} {...rest} className={cx("ui-tabs-list", className)} role="tablist" aria-label={label}>
      {children}
    </div>
  );
});
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
  children: ReactNode;
}>((props, ref) => {
  const { active, children, className, disabled, type, ...buttonProps } = props;
  return (
    <button ref={ref} {...buttonProps} type={primitiveButtonType(type)} disabled={disabled} data-state={primitiveState(active)} data-disabled={disabledState(disabled)} className={cx("ui-tabs-trigger", active && "active", className)} role="tab" aria-selected={active}>
      {children}
    </button>
  );
});
TabsTrigger.displayName = "TabsTrigger";

export const SegmentedControl = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  label: string;
  children: ReactNode;
}>((props, ref) => {
  const { label, children, className, ...rest } = props;
  return (
    <div ref={ref} {...rest} className={cx("ui-segmented-control", className)} aria-label={label}>
      {children}
    </div>
  );
});
SegmentedControl.displayName = "SegmentedControl";

export const SegmentedButton = forwardRef<HTMLButtonElement, PrimitiveButtonProps>((props, ref) => {
  const { active, children, className, disabled, type, ...buttonProps } = props;
  return (
    <button ref={ref} {...buttonProps} type={primitiveButtonType(type)} disabled={disabled} data-state={primitiveState(active)} data-disabled={disabledState(disabled)} className={cx("ui-segmented-button", active && "active", className)}>
      {children}
    </button>
  );
});
SegmentedButton.displayName = "SegmentedButton";

export const CheckboxRow = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement> & {
  checked: boolean;
  disabled?: boolean;
  compact?: boolean;
  children: ReactNode;
  onCheckedChange(checked: boolean): void;
}>((props, ref) => {
  const { checked, disabled, compact, children, className, onCheckedChange, ...labelProps } = props;
  return (
    <label ref={ref} {...labelProps} data-disabled={disabledState(disabled)} className={cx("ui-checkbox-row", compact && "compact", className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      <span>{children}</span>
    </label>
  );
});
CheckboxRow.displayName = "CheckboxRow";
