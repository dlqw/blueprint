import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

const acceptanceGatePhrases = [
  "Imports the shared `BlueprintGraph` fixture without schema changes.",
  "Renders all fixture nodes",
  "control and data links",
  "selected, disabled, breakpoint, runtime active, and runtime error states",
  "pan, zoom, select, drag node, connect wire, delete selection, and context menu opening",
  "Exports node positions and links back to the current graph model without losing input bindings.",
  "inspector selection and runtime trace lookup",
  "large-graph strategy comparable to current viewport culling",
  "automated smoke test"
];

const rejectionGatePhrases = [
  "Requires changing Blueprint graph file semantics just to fit the engine.",
  "Loses stable Blueprint node ids or port ids.",
  "Replaces compiler/runtime data contracts.",
  "Requires rewriting core editor commands before basic import/render/export works.",
  "Gives up accessible overlay/dialog/menu behavior already available in React.",
  "Accepts worse large-graph behavior without a clear mitigation path."
];

describe("graph engine spike docs", () => {
  it("keeps the spike report template aligned with the shared fixture and required sections", () => {
    const template = readRepoFile("docs/graph-engine-spikes/TEMPLATE.md");

    for (const heading of [
      "## Scope",
      "## Dependency And Bundle Note",
      "## Acceptance Gates",
      "## Rejection Gates",
      "## Manual Checklist",
      "## Final Recommendation"
    ]) {
      expect(template).toContain(heading);
    }

    expect(template).toContain("src/shared/graphEngineSpikeFixture.ts");
    expect(template).toContain("Recommendation: `reject | revisit later | propose dedicated migration plan`");
  });

  it("keeps acceptance and rejection gates represented in the template", () => {
    const template = readRepoFile("docs/graph-engine-spikes/TEMPLATE.md");

    for (const phrase of acceptanceGatePhrases) {
      expect(template).toContain(phrase);
    }
    for (const phrase of rejectionGatePhrases) {
      expect(template).toContain(phrase);
    }
  });

  it("requires future spike reports to copy the template", () => {
    const plan = readRepoFile("docs/graph-engine-spike-plan.md");

    expect(plan).toContain("docs/graph-engine-spikes/TEMPLATE.md");
    expect(plan).toContain("A table of acceptance gate results.");
    expect(plan).toContain("A table of rejection gate results.");
  });
});
