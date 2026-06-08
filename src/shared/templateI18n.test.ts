import { describe, expect, it } from "vitest";
import type { BlueprintNodeTemplate } from "./blueprint";
import { localizePort, localizeTemplate, templateSearchText } from "./templateI18n";

const template: BlueprintNodeTemplate = {
  id: "demo.node",
  name: "Canonical Node",
  creationPath: "Demo/Canonical",
  description: "Canonical description.",
  inputs: [{
    id: "value",
    name: "Value",
    direction: "input",
    flowKind: "data",
    type: "number",
    description: "Canonical value.",
    editor: "number",
    defaultValue: 0
  }],
  outputs: [],
  controlInputs: [],
  controlOutputs: [],
  bodyKind: "typescriptFunction",
  bodyRef: "demo.ts#Nodes.node",
  i18n: {
    key: "nodeTemplate.demo.node",
    name: { "zh-CN": "内联节点" },
    ports: {
      value: {
        name: { "zh-CN": "内联值" }
      }
    }
  }
};

const catalog = {
  "nodeTemplate.demo.node": {
    name: { "zh-CN": "目录节点", "en-US": "Catalog Node" },
    creationPath: { "zh-CN": "目录/演示", "en-US": "Catalog/Demo" },
    description: { "zh-CN": "目录描述。", "en-US": "Catalog description." },
    ports: {
      value: {
        name: { "zh-CN": "目录值", "en-US": "Catalog Value" },
        description: { "zh-CN": "目录值描述。", "en-US": "Catalog value description." }
      }
    }
  }
};

describe("template i18n", () => {
  it("resolves template and port text through inline, catalog, fallback locale, and canonical fields", () => {
    expect(localizeTemplate(template, "zh-CN", "en-US", catalog)).toEqual({
      name: "内联节点",
      creationPath: "目录/演示",
      description: "目录描述。"
    });
    expect(localizePort(template, template.inputs[0], "zh-CN", "en-US", catalog)).toEqual({
      name: "内联值",
      description: "目录值描述。"
    });
    expect(localizeTemplate(template, "fr-FR", "en-US", catalog)).toEqual({
      name: "Catalog Node",
      creationPath: "Catalog/Demo",
      description: "Catalog description."
    });
    expect(localizeTemplate({ ...template, i18n: undefined }, "zh-CN", "en-US", {})).toEqual({
      name: "Canonical Node",
      creationPath: "Demo/Canonical",
      description: "Canonical description."
    });
  });

  it("indexes localized, fallback, canonical, port, id, and body reference text for search", () => {
    const searchText = templateSearchText(template, "zh-CN", "en-US", catalog);

    expect(searchText).toContain("内联节点");
    expect(searchText).toContain("catalog node");
    expect(searchText).toContain("canonical node");
    expect(searchText).toContain("内联值");
    expect(searchText).toContain("catalog value description");
    expect(searchText).toContain("demo.node");
    expect(searchText).toContain("demo.ts#nodes.node");
  });
});
