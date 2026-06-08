import type { BlueprintNodeTemplate, BlueprintPortDefinition, BlueprintTemplateLocalization } from "./blueprint";

export type TemplateI18nCatalog = Record<string, Omit<BlueprintTemplateLocalization, "key">>;

export interface LocalizedTemplateText {
  name: string;
  creationPath: string;
  description: string;
}

export interface LocalizedPortText {
  name: string;
  description: string;
}

export function localizeTemplate(
  template: BlueprintNodeTemplate | undefined,
  locale: string,
  fallbackLocale: string,
  catalog: TemplateI18nCatalog = {}
): LocalizedTemplateText {
  if (!template) {
    return { name: "", creationPath: "", description: "" };
  }
  return {
    name: localizedTemplateField(template, "name", locale, fallbackLocale, catalog, template.name || template.id),
    creationPath: localizedTemplateField(template, "creationPath", locale, fallbackLocale, catalog, template.creationPath),
    description: localizedTemplateField(template, "description", locale, fallbackLocale, catalog, template.description)
  };
}

export function localizedCreationPath(
  template: BlueprintNodeTemplate | undefined,
  locale: string,
  fallbackLocale: string,
  catalog: TemplateI18nCatalog = {}
): string {
  return localizeTemplate(template, locale, fallbackLocale, catalog).creationPath;
}

export function localizePort(
  template: BlueprintNodeTemplate | undefined,
  port: BlueprintPortDefinition,
  locale: string,
  fallbackLocale: string,
  catalog: TemplateI18nCatalog = {}
): LocalizedPortText {
  const inline = template?.i18n?.ports?.[port.id];
  const catalogEntry = catalogTemplateEntry(template, catalog)?.ports?.[port.id];
  return {
    name: localizedText(inline?.name, catalogEntry?.name, locale, fallbackLocale, port.name || port.id),
    description: localizedText(inline?.description, catalogEntry?.description, locale, fallbackLocale, port.description)
  };
}

export function templateSearchText(
  template: BlueprintNodeTemplate,
  locale: string,
  fallbackLocale: string,
  catalog: TemplateI18nCatalog = {}
): string {
  const localized = localizeTemplate(template, locale, fallbackLocale, catalog);
  const catalogEntry = catalogTemplateEntry(template, catalog);
  const fields = [
    localized.name,
    localized.creationPath,
    localized.description,
    template.id,
    template.name,
    template.creationPath,
    template.description,
    typeof template.metadata?.source === "string" ? template.metadata.source : "",
    typeof template.bodyRef === "string" ? template.bodyRef : "",
    ...localizedTexts(template.i18n?.name),
    ...localizedTexts(template.i18n?.creationPath),
    ...localizedTexts(template.i18n?.description),
    ...localizedTexts(catalogEntry?.name),
    ...localizedTexts(catalogEntry?.creationPath),
    ...localizedTexts(catalogEntry?.description),
    ...allPorts(template).flatMap((port) => {
      const text = localizePort(template, port, locale, fallbackLocale, catalog);
      const inline = template.i18n?.ports?.[port.id];
      const catalogPort = catalogEntry?.ports?.[port.id];
      return [
        text.name,
        text.description,
        port.id,
        port.name,
        port.description,
        ...localizedTexts(inline?.name),
        ...localizedTexts(inline?.description),
        ...localizedTexts(catalogPort?.name),
        ...localizedTexts(catalogPort?.description)
      ];
    })
  ];
  return [...new Set(fields.map((field) => field.trim()).filter(Boolean))].join(" ").toLowerCase();
}

function localizedTemplateField(
  template: BlueprintNodeTemplate,
  field: "name" | "creationPath" | "description",
  locale: string,
  fallbackLocale: string,
  catalog: TemplateI18nCatalog,
  fallback: string
): string {
  return localizedText(template.i18n?.[field], catalogTemplateEntry(template, catalog)?.[field], locale, fallbackLocale, fallback);
}

function localizedText(
  inline: Record<string, string | undefined> | undefined,
  catalog: Record<string, string | undefined> | undefined,
  locale: string,
  fallbackLocale: string,
  fallback: string
): string {
  return cleanText(inline?.[locale])
    ?? cleanText(catalog?.[locale])
    ?? cleanText(inline?.[fallbackLocale])
    ?? cleanText(catalog?.[fallbackLocale])
    ?? fallback;
}

function catalogTemplateEntry(template: BlueprintNodeTemplate | undefined, catalog: TemplateI18nCatalog): Omit<BlueprintTemplateLocalization, "key"> | undefined {
  const key = template?.i18n?.key;
  return key ? catalog[key] : undefined;
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function localizedTexts(value: Record<string, string | undefined> | undefined): string[] {
  return value ? Object.values(value).map((entry) => entry?.trim() ?? "").filter(Boolean) : [];
}

function allPorts(template: BlueprintNodeTemplate): BlueprintPortDefinition[] {
  return [...template.controlInputs, ...template.inputs, ...template.outputs, ...template.controlOutputs];
}
