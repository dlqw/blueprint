# 节点 I18N 设计计划

## 目标

为节点模板、端口、节点创建面板、Inspector、模板注册表和运行记录增加多语言显示能力。实现时应保留现有图文件和模板的兼容性，不把节点 ID、端口 ID、`bodyRef`、文件名等语义标识翻译掉。

## 设计原则

- 模板原字段仍是 canonical fallback：`name`、`creationPath`、`description`、`port.name`、`port.description` 不改语义。
- 本地化只影响 UI 展示和搜索，不影响编译、运行、连线、引用重构、收藏、最近记录等按 ID 工作的逻辑。
- 缺失翻译时不能出现空白：始终回退到 fallback locale，再回退到原始字段。
- 内置节点走集中 catalog，外部模板和用户模板允许内联翻译。
- 分类颜色和稳定分组 key 不随语言变化，避免切换语言后节点视觉跳变。

## 代码架构计划

### 1. 扩展模板数据模型

在 `BlueprintNodeTemplate` 上增加可选 `i18n` 字段，保持旧图兼容：

```ts
type LocalizedText = Partial<Record<Locale, string>>;

interface BlueprintNodeTemplate {
  i18n?: {
    key?: string;
    name?: LocalizedText;
    creationPath?: LocalizedText;
    description?: LocalizedText;
    ports?: Record<string, {
      name?: LocalizedText;
      description?: LocalizedText;
    }>;
  };
}
```

`i18n.key` 用于内置节点或模板包引用集中 catalog，例如 `nodeTemplate.builtin.debug.log`。`i18n.name` 等用于模板文件直接携带翻译。

### 2. 增加统一解析层

新增 `src/shared/templateI18n.ts`，提供：

- `localizeTemplate(template, locale, fallbackLocale, catalog)`
- `localizePort(template, port, locale, fallbackLocale, catalog)`
- `localizedCreationPath(template, locale, fallbackLocale, catalog)`
- `templateSearchText(template, locale, fallbackLocale, catalog)`

回退顺序：

1. inline 当前语言
2. catalog 当前语言
3. inline fallback locale
4. catalog fallback locale
5. 原始字段
6. `id`

### 3. 内置节点翻译 catalog

`src/shared/builtins.ts` 保留英文 canonical 文本，并为每个内置模板增加 `i18n.key`。翻译文本单独维护，建议放在 shared 层，例如 `src/shared/nodeI18nCatalog.ts`，让 webview 和 desktop 都能使用。

示例：

```ts
{
  id: "builtin.debug.log",
  name: "Log",
  creationPath: "Debug",
  description: "Writes a value to the runtime console.",
  i18n: { key: "nodeTemplate.builtin.debug.log" }
}
```

### 4. 替换 UI 调用点

需要把直接读取模板文本的位置改为走 resolver：

- 画布节点标题：`template.name`、`template.creationPath`
- 端口按钮和 tooltip：`port.name`、`port.description`
- Node Creation 面板：候选项、分类、端口预览、搜索空状态
- Template Registry：模板名、路径、描述、端口列表
- Sidebar：模板引用、端口引用、分类统计
- Inspector：端口描述、模板描述、引用信息
- Runtime trace/history：显示层按 `templateId` 反查本地化名称

编译层仍使用 canonical template 信息。若运行 trace 需要本地化，优先传 `templateId`，由 UI 展示层解析。

### 5. 搜索与分类

搜索索引同时包含：

- 当前语言文本
- fallback/canonical 文本
- template id
- bodyRef
- sourcePath

分类显示使用本地化 `creationPath`；分类颜色和稳定分组 key 使用 canonical `creationPath` 或 `metadata.categoryKey`。

### 6. 外部模板支持

TypeScript 装饰器可以扩展：

```ts
@BlueprintNode({
  name: "Double",
  path: "Math/Number",
  description: "Multiplies a number by two.",
  i18n: {
    "zh-CN": {
      name: "翻倍",
      path: "数学/数字",
      description: "将数字乘以二。"
    }
  }
})
```

模板包 manifest、`.bpgraph` schema 也应允许 `i18n` 字段。未提供翻译时沿用原文本。

### 7. 测试

- resolver 单元测试：当前语言、fallback、原字段回退顺序。
- schema 兼容测试：旧图不带 `i18n` 仍能加载。
- UI 测试：中文环境下节点标题、端口、创建面板显示中文。
- 搜索测试：中文界面能搜中文和英文；英文界面也能搜 canonical 文本。
- runtime 显示测试：trace/history 使用展示层本地化，不污染编译输出。
- i18n audit：内置节点翻译必须集中维护，避免散落硬编码。

## 用户交互计划

### 1. 语言切换

用户在设置面板切换语言后，节点画布、端口、节点创建面板、Inspector、模板注册表和 Sidebar 应即时刷新。节点 ID、graph 名称、用户自定义文件名不自动翻译。

### 2. 节点卡片

节点主标题显示本地化模板名，副标题显示本地化分类路径。tooltip 建议显示本地化名、canonical path 和 template id，便于开发者定位。

示例：

```text
日志 · Debug · builtin.debug.log
```

### 3. 端口

端口旁显示本地化端口名。Inspector 中显示本地化描述，同时保留原始端口 ID，例如 `message`，方便和 TypeScript 参数、图文件、错误信息对应。

### 4. Node Creation 面板

- 分类树显示本地化分类。
- 搜索支持中文、英文、template id。
- 候选项主标题本地化。
- 副信息显示 canonical path 或 source path。
- 收藏和最近记录继续按 template id 存储。

### 5. 开发者显示模式

设置中增加节点标签显示模式：

- 本地化
- 原始
- 本地化 + 原始

默认使用“本地化”。调试外部模板或处理 issue 时可以切到“原始”。

## 推荐实施阶段

### 阶段一：内置节点本地化

1. 增加数据模型和 resolver。
2. 增加内置节点 catalog。
3. 替换 webview 主要展示点。
4. 增加 resolver、UI 和搜索测试。

### 阶段二：外部模板本地化

1. 扩展 TypeScript 装饰器提取逻辑。
2. 扩展 `.bpgraph` schema 和模板包 manifest。
3. 在 Template Registry 中展示翻译状态。

### 阶段三：高级编辑与诊断

1. 增加“本地化 / 原始 / 本地化 + 原始”显示模式。
2. 增加缺失翻译诊断。
3. 支持模板包翻译编辑或导入导出。
