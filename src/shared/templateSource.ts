import * as ts from "typescript";
import { BlueprintNodeTemplate, BlueprintTemplateLocalization, BlueprintValueType, createPort } from "./blueprint";

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
        ...(metadata.i18n ? { i18n: metadata.i18n } : {}),
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

function blueprintNodeMetadata(method: ts.MethodDeclaration): { name: string; path: string; description: string; i18n?: BlueprintTemplateLocalization } | undefined {
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
    const i18n = localizationProperty(metadata, "i18n");
    return {
      name,
      path,
      description: stringProperty(metadata, "description") ?? "",
      ...(i18n ? { i18n } : {})
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

function localizationProperty(object: ts.ObjectLiteralExpression, name: string): BlueprintTemplateLocalization | undefined {
  const initializer = objectPropertyInitializer(object, name);
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    return undefined;
  }
  const localization: BlueprintTemplateLocalization = {};
  for (const localeProperty of initializer.properties) {
    if (!ts.isPropertyAssignment(localeProperty) || !ts.isObjectLiteralExpression(localeProperty.initializer)) {
      continue;
    }
    const locale = propertyNameText(localeProperty.name);
    if (!locale) {
      continue;
    }
    const entry = localeProperty.initializer;
    assignLocalizedText(localization, "name", locale, stringProperty(entry, "name"));
    assignLocalizedText(localization, "creationPath", locale, stringProperty(entry, "path") ?? stringProperty(entry, "creationPath"));
    assignLocalizedText(localization, "description", locale, stringProperty(entry, "description"));
    const ports = objectPropertyInitializer(entry, "ports");
    if (ports && ts.isObjectLiteralExpression(ports)) {
      for (const portProperty of ports.properties) {
        if (!ts.isPropertyAssignment(portProperty) || !ts.isObjectLiteralExpression(portProperty.initializer)) {
          continue;
        }
        const portId = propertyNameText(portProperty.name);
        if (!portId) {
          continue;
        }
        const portEntry = portProperty.initializer;
        const portLocalization = localization.ports?.[portId] ?? {};
        const nameText = stringProperty(portEntry, "name");
        const descriptionText = stringProperty(portEntry, "description");
        if (nameText) {
          portLocalization.name = { ...(portLocalization.name ?? {}), [locale]: nameText };
        }
        if (descriptionText) {
          portLocalization.description = { ...(portLocalization.description ?? {}), [locale]: descriptionText };
        }
        if (portLocalization.name || portLocalization.description) {
          localization.ports = { ...(localization.ports ?? {}), [portId]: portLocalization };
        }
      }
    }
  }
  return localization.name || localization.creationPath || localization.description || localization.ports ? localization : undefined;
}

function objectPropertyInitializer(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== name) {
      continue;
    }
    return property.initializer;
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text.trim();
  }
  return undefined;
}

function assignLocalizedText(localization: BlueprintTemplateLocalization, field: "name" | "creationPath" | "description", locale: string, value: string | undefined): void {
  if (!value) {
    return;
  }
  localization[field] = { ...(localization[field] ?? {}), [locale]: value };
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
