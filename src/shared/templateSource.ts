import * as ts from "typescript";
import { BlueprintNodeTemplate, BlueprintValueType, createPort } from "./blueprint";

export function extractBlueprintTemplatesFromTypeScript(sourceText: string, sourcePath: string): BlueprintNodeTemplate[] {
  const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const templates: BlueprintNodeTemplate[] = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) {
      return;
    }
    const className = node.name.text;
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) || !isStaticMember(member) || !member.name || !ts.isIdentifier(member.name)) {
        continue;
      }
      const metadata = blueprintNodeMetadata(member);
      if (!metadata) {
        continue;
      }
      const methodName = member.name.text;
      const outputType = member.type ? blueprintValueTypeFromType(member.type) : undefined;
      templates.push({
        id: `ts.${stableTemplateSegment(metadata.path)}.${stableTemplateSegment(metadata.name)}`,
        name: metadata.name,
        creationPath: metadata.path,
        description: metadata.description,
        inputs: member.parameters.map((parameter) => {
          const name = parameterName(parameter);
          const type = parameter.type ? blueprintValueTypeFromType(parameter.type) : "unknown";
          return createPort(name, name, "input", "data", type, `Parameter ${name}.`, editorForInputType(type), defaultValueForType(type));
        }),
        outputs: outputType && outputType !== "undefined"
          ? [createPort("result", "Result", "output", "data", outputType, "Function result.", "none")]
          : [],
        controlInputs: [],
        controlOutputs: [],
        bodyKind: "typescriptFunction",
        bodyRef: `${sourcePath}#${className}.${methodName}`,
        metadata: {
          source: sourcePath,
          exportName: className,
          memberName: methodName
        }
      });
    }
  });

  return templates;
}

function blueprintNodeMetadata(method: ts.MethodDeclaration): { name: string; path: string; description: string } | undefined {
  const decorators = ts.canHaveDecorators(method) ? ts.getDecorators(method) ?? [] : [];
  for (const decorator of decorators) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression) || !isBlueprintNodeDecoratorExpression(expression.expression)) {
      continue;
    }
    const metadata = expression.arguments[0];
    if (!metadata || !ts.isObjectLiteralExpression(metadata)) {
      continue;
    }
    const name = stringProperty(metadata, "name");
    const path = stringProperty(metadata, "path");
    if (!name || !path) {
      continue;
    }
    return {
      name,
      path,
      description: stringProperty(metadata, "description") ?? ""
    };
  }
  return undefined;
}

function isBlueprintNodeDecoratorExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "BlueprintNode";
  }
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "BlueprintNode";
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || property.name.text !== name) {
      continue;
    }
    const initializer = property.initializer;
    if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
      return initializer.text.trim();
    }
  }
  return undefined;
}

function isStaticMember(member: ts.ClassElement): boolean {
  const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) ?? [] : [];
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
}

function parameterName(parameter: ts.ParameterDeclaration): string {
  return ts.isIdentifier(parameter.name) ? parameter.name.text : "value";
}

function blueprintValueTypeFromType(type: ts.TypeNode): BlueprintValueType {
  switch (type.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return "number";
    case ts.SyntaxKind.StringKeyword:
      return "string";
    case ts.SyntaxKind.BooleanKeyword:
      return "boolean";
    case ts.SyntaxKind.BigIntKeyword:
      return "bigint";
    case ts.SyntaxKind.NullKeyword:
      return "null";
    case ts.SyntaxKind.UndefinedKeyword:
    case ts.SyntaxKind.VoidKeyword:
      return "undefined";
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return "unknown";
    case ts.SyntaxKind.TypeLiteral:
    case ts.SyntaxKind.ArrayType:
      return "json";
    default:
      return typeText(type) === "JSON" || typeText(type) === "Record" || typeText(type) === "object" ? "json" : "unknown";
  }
}

function typeText(type: ts.TypeNode): string {
  if (ts.isTypeReferenceNode(type)) {
    const typeName = type.typeName;
    return ts.isIdentifier(typeName) ? typeName.text : typeName.right.text;
  }
  return "";
}

function editorForInputType(type: BlueprintValueType): "text" | "number" | "boolean" | "json" {
  if (type === "number") {
    return "number";
  }
  if (type === "boolean") {
    return "boolean";
  }
  if (type === "string") {
    return "text";
  }
  return "json";
}

function defaultValueForType(type: BlueprintValueType): unknown {
  switch (type) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "json":
      return {};
    default:
      return "";
  }
}

function stableTemplateSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "template";
}
