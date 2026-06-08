import { describe, expect, it } from "vitest";
import { extractBlueprintTemplatesFromTypeScript } from "./templateSource";

describe("template source extraction", () => {
  it("extracts static BlueprintNode methods into TypeScript function templates", () => {
    const templates = extractBlueprintTemplatesFromTypeScript(`
      function BlueprintNode(_metadata: { name: string; path: string; description: string }): MethodDecorator {
        return () => undefined;
      }

      export class GameplayMathNodes {
        @BlueprintNode({
          name: "Double",
          path: "TypeScript/Math",
          description: "Multiplies a number by two."
        })
        static double(value: number): number {
          return value * 2;
        }
      }
    `, "examples/Gameplay/src/mathNodes.ts");

    expect(templates).toEqual([expect.objectContaining({
      id: "ts.TypeScript.Math.Double",
      name: "Double",
      creationPath: "TypeScript/Math",
      description: "Multiplies a number by two.",
      bodyKind: "typescriptFunction",
      bodyRef: "examples/Gameplay/src/mathNodes.ts#GameplayMathNodes.double",
      metadata: {
        source: "examples/Gameplay/src/mathNodes.ts",
        exportName: "GameplayMathNodes",
        memberName: "double"
      },
      inputs: [expect.objectContaining({ id: "value", type: "number", editor: "number", defaultValue: 0 })],
      outputs: [expect.objectContaining({ id: "result", type: "number", editor: "none" })]
    })]);
  });

  it("extracts locale-major BlueprintNode i18n metadata into template localization fields", () => {
    const templates = extractBlueprintTemplatesFromTypeScript(`
      function BlueprintNode(_metadata: { name: string; path: string; description: string; i18n?: unknown }): MethodDecorator {
        return () => undefined;
      }

      export class GameplayMathNodes {
        @BlueprintNode({
          name: "Double",
          path: "TypeScript/Math",
          description: "Multiplies a number by two.",
          i18n: {
            "zh-CN": {
              name: "翻倍",
              path: "TypeScript/数学",
              description: "将数字乘以二。",
              ports: {
                value: {
                  name: "值",
                  description: "要翻倍的数字。"
                }
              }
            },
            "en-US": {
              ports: {
                value: {
                  name: "Value"
                }
              }
            }
          }
        })
        static double(value: number): number {
          return value * 2;
        }
      }
    `, "examples/Gameplay/src/mathNodes.ts");

    expect(templates[0].i18n).toEqual({
      name: { "zh-CN": "翻倍" },
      creationPath: { "zh-CN": "TypeScript/数学" },
      description: { "zh-CN": "将数字乘以二。" },
      ports: {
        value: {
          name: { "zh-CN": "值", "en-US": "Value" },
          description: { "zh-CN": "要翻倍的数字。" }
        }
      }
    });
  });
});
