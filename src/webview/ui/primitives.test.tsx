import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DialogBackdrop,
  DialogFrame,
  DialogHeader,
  CheckboxRow,
  CheckboxInput,
  CommandButton,
  ColorInput,
  IconButton,
  ListActionButton,
  MenuActionButton,
  MenuSection,
  MenuSurface,
  PanelHeader,
  SearchBox,
  SegmentedButton,
  SegmentedControl,
  NumberInput,
  SelectInput,
  TabsList,
  TabsTrigger,
  TextInput
} from "./primitives";

describe("UI primitives", () => {
  it("dismisses dialog backdrops only from backdrop clicks", () => {
    const onDismiss = vi.fn();

    render(
      <DialogBackdrop onDismiss={onDismiss}>
        <button type="button">Inside</button>
      </DialogBackdrop>
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: "Inside" }));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("exposes dialog, search, menu, tabs, and segmented control semantics", () => {
    render(
      <>
        <PanelHeader icon={<span aria-hidden="true">P</span>} title="Inspector" action={<button type="button">Hide</button>} />
        <DialogFrame label="Settings">
          <SearchBox icon={<span aria-hidden="true">S</span>} placeholder="Search settings" />
        </DialogFrame>
        <MenuSurface label="Actions">
          <MenuSection title="Quick">
            <MenuActionButton icon={<span aria-hidden="true">A</span>}>Run</MenuActionButton>
          </MenuSection>
        </MenuSurface>
        <TabsList label="Pages">
          <TabsTrigger active={true}>General</TabsTrigger>
          <TabsTrigger active={false}>Shortcuts</TabsTrigger>
        </TabsList>
        <SegmentedControl label="Theme">
          <SegmentedButton active={true}>Dark</SegmentedButton>
          <SegmentedButton>Light</SegmentedButton>
        </SegmentedControl>
      </>
    );

    expect(screen.getByRole("banner")).toHaveClass("ui-panel-header");
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search settings").closest(".ui-search-box")).toBeTruthy();
    expect(screen.getByRole("menu", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Run" })).toHaveClass("ui-menu-action");
    expect(screen.getByRole("tablist", { name: "Pages" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Shortcuts" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText("Theme")).toHaveClass("ui-segmented-control");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveClass("ui-segmented-button", "active");
  });

  it("forwards refs from structural primitives", () => {
    const backdropRef = createRef<HTMLDivElement>();
    const frameRef = createRef<HTMLElement>();
    const dialogHeaderRef = createRef<HTMLElement>();
    const panelHeaderRef = createRef<HTMLElement>();
    const menuRef = createRef<HTMLDivElement>();
    const menuSectionRef = createRef<HTMLDivElement>();
    const tabsRef = createRef<HTMLDivElement>();
    const segmentedRef = createRef<HTMLDivElement>();
    const checkboxRowRef = createRef<HTMLLabelElement>();

    render(
      <>
        <DialogBackdrop ref={backdropRef} onDismiss={vi.fn()}>
          <DialogFrame ref={frameRef} label="Project settings">
            <DialogHeader ref={dialogHeaderRef} title="Settings" />
          </DialogFrame>
        </DialogBackdrop>
        <PanelHeader ref={panelHeaderRef} title="Inspector" />
        <MenuSurface ref={menuRef} label="Actions">
          <MenuSection ref={menuSectionRef} title="Quick">
            <MenuActionButton>Run</MenuActionButton>
          </MenuSection>
        </MenuSurface>
        <TabsList ref={tabsRef} label="Pages">
          <TabsTrigger active={true}>General</TabsTrigger>
        </TabsList>
        <SegmentedControl ref={segmentedRef} label="Mode">
          <SegmentedButton active={true}>Edit</SegmentedButton>
        </SegmentedControl>
        <CheckboxRow ref={checkboxRowRef} checked={true} onCheckedChange={vi.fn()}>
          Snap to grid
        </CheckboxRow>
      </>
    );

    expect(backdropRef.current).toBe(screen.getByRole("presentation"));
    expect(frameRef.current).toBe(screen.getByRole("dialog", { name: "Project settings" }));
    expect(dialogHeaderRef.current).toHaveClass("ui-dialog-header");
    expect(panelHeaderRef.current).toHaveClass("ui-panel-header");
    expect(menuRef.current).toBe(screen.getByRole("menu", { name: "Actions" }));
    expect(menuSectionRef.current).toHaveClass("ui-menu-section");
    expect(tabsRef.current).toBe(screen.getByRole("tablist", { name: "Pages" }));
    expect(segmentedRef.current).toBe(screen.getByLabelText("Mode"));
    expect(checkboxRowRef.current).toHaveClass("ui-checkbox-row");
  });

  it("forwards actions and active state classes", () => {
    const onCommandClick = vi.fn();
    const onIconClick = vi.fn();
    const onListClick = vi.fn();

    render(
      <>
        <CommandButton active={true} onClick={onCommandClick}>Export</CommandButton>
        <IconButton active={true} onClick={onIconClick}>Close</IconButton>
        <ListActionButton active={true} trailing={<small>Ctrl K</small>} onClick={onListClick}>Command palette</ListActionButton>
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /Command palette/ }));

    expect(onCommandClick).toHaveBeenCalledOnce();
    expect(onIconClick).toHaveBeenCalledOnce();
    expect(onListClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Export" })).toHaveClass("ui-command-button", "active");
    expect(screen.getByRole("button", { name: "Export" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("ui-icon-button", "active");
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("button", { name: /Command palette/ })).toHaveClass("ui-list-action", "active");
    expect(screen.getByRole("button", { name: /Command palette/ })).toHaveAttribute("data-state", "active");
  });

  it("uses string titles as fallback icon button labels without overriding explicit labels", () => {
    render(
      <>
        <IconButton title="Open settings">
          <span aria-hidden="true">S</span>
        </IconButton>
        <IconButton title="Visible hint" aria-label="Pinned runs">
          <span aria-hidden="true">P</span>
        </IconButton>
      </>
    );

    expect(screen.getByRole("button", { name: "Open settings" })).toHaveAttribute("title", "Open settings");
    expect(screen.getByRole("button", { name: "Pinned runs" })).toHaveAttribute("title", "Visible hint");
  });

  it("defaults button primitives to type button and forwards refs", () => {
    const commandRef = createRef<HTMLButtonElement>();

    render(
      <>
        <CommandButton ref={commandRef}>Save</CommandButton>
        <IconButton>Pin</IconButton>
        <ListActionButton>Open command</ListActionButton>
        <MenuActionButton>Duplicate</MenuActionButton>
        <TabsTrigger active={true}>Graph</TabsTrigger>
        <SegmentedButton active={true}>Snap</SegmentedButton>
        <CommandButton type="submit">Submit override</CommandButton>
      </>
    );

    for (const name of ["Save", "Pin", "Open command", "Snap"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("type", "button");
    }
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("tab", { name: "Graph" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("tab", { name: "Graph" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("button", { name: "Snap" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("button", { name: "Pin" })).toHaveAttribute("data-state", "inactive");
    expect(screen.getByRole("button", { name: "Submit override" })).toHaveAttribute("type", "submit");
    expect(commandRef.current).toBe(screen.getByRole("button", { name: "Save" }));
  });

  it("marks disabled primitive controls with data-disabled while preserving native disabled state", () => {
    render(
      <>
        <CommandButton disabled={true}>Disabled command</CommandButton>
        <IconButton disabled={true} title="Disabled icon">
          <span aria-hidden="true">I</span>
        </IconButton>
        <ListActionButton disabled={true}>Disabled list action</ListActionButton>
        <MenuActionButton disabled={true}>Disabled menu action</MenuActionButton>
        <TabsTrigger active={false} disabled={true}>Disabled tab</TabsTrigger>
        <SegmentedButton disabled={true}>Disabled segment</SegmentedButton>
        <TextInput aria-label="Disabled text" disabled={true} />
        <NumberInput aria-label="Disabled number" disabled={true} />
        <CheckboxInput aria-label="Disabled checkbox" disabled={true} />
        <ColorInput aria-label="Disabled color" disabled={true} />
        <SelectInput aria-label="Disabled select" disabled={true}>
          <option>One</option>
        </SelectInput>
        <CheckboxRow checked={false} disabled={true} onCheckedChange={vi.fn()}>
          Disabled checkbox row
        </CheckboxRow>
        <CommandButton>Enabled command</CommandButton>
      </>
    );

    for (const element of [
      screen.getByRole("button", { name: "Disabled command" }),
      screen.getByRole("button", { name: "Disabled icon" }),
      screen.getByRole("button", { name: "Disabled list action" }),
      screen.getByRole("menuitem", { name: "Disabled menu action" }),
      screen.getByRole("tab", { name: "Disabled tab" }),
      screen.getByRole("button", { name: "Disabled segment" }),
      screen.getByRole("textbox", { name: "Disabled text" }),
      screen.getByRole("spinbutton", { name: "Disabled number" }),
      screen.getByRole("checkbox", { name: "Disabled checkbox" }),
      screen.getByLabelText("Disabled color"),
      screen.getByRole("combobox", { name: "Disabled select" })
    ]) {
      expect(element).toHaveAttribute("data-disabled");
      expect(element).toBeDisabled();
    }
    expect(screen.getByText("Disabled checkbox row").closest("label")).toHaveAttribute("data-disabled");
    expect(screen.getByRole("button", { name: "Enabled command" })).not.toHaveAttribute("data-disabled");
  });

  it("forwards checkbox row state changes", () => {
    const onCheckedChange = vi.fn();

    render(
      <CheckboxRow checked={false} compact={true} onCheckedChange={onCheckedChange}>
        Show grid
      </CheckboxRow>
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Show grid" }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("Show grid").closest("label")).toHaveClass("ui-checkbox-row", "compact");
  });

  it("exposes shared form control classes and forwards changes", () => {
    const onTextChange = vi.fn();
    const onNumberChange = vi.fn();
    const onSelectChange = vi.fn();

    render(
      <>
        <TextInput aria-label="Title" value="Graph" onChange={onTextChange} />
        <NumberInput aria-label="Width" value={320} onChange={onNumberChange} />
        <CheckboxInput aria-label="Enabled" checked={false} onChange={onTextChange} />
        <ColorInput aria-label="Accent" value="#ffffff" onChange={onNumberChange} />
        <SelectInput aria-label="Mode" value="debug" onChange={onSelectChange}>
          <option value="debug">Debug</option>
          <option value="release">Release</option>
        </SelectInput>
      </>
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Gameplay" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Width" }), { target: { value: "640" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), { target: { value: "release" } });

    expect(onTextChange).toHaveBeenCalledOnce();
    expect(onNumberChange).toHaveBeenCalledOnce();
    expect(onSelectChange).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveClass("ui-text-input");
    expect(screen.getByRole("spinbutton", { name: "Width" })).toHaveClass("ui-number-input");
    expect(screen.getByRole("checkbox", { name: "Enabled" })).toHaveClass("ui-checkbox-input");
    expect(screen.getByLabelText("Accent")).toHaveClass("ui-color-input");
    expect(screen.getByRole("combobox", { name: "Mode" })).toHaveClass("ui-select-input");
  });
});
