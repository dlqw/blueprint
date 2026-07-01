# Agents.md — Blueprint IDE 项目约定

本文件是本仓库所有协作者（包括人类与 AI Agent）的唯一行为准则。`CODEBUDDY.md` 仅指向本文件。

## 1. 分支模型

仓库采用三层分支：

| 分支 | 角色 | 来源 |
| --- | --- | --- |
| `main` | 稳定发布线，永远可发布 | 仅从 `develop` 通过 merge / rebase 接受内容 |
| `develop` | 集成分支，允许开发中内容 | 仅从 `feature/*` 通过 merge / rebase 接受内容 |
| `feature/<topic>` | 单一功能/修复分支 | 从 `develop` 切出，完成后合回 `develop` |

禁止分支：
- 不允许 `release/*`、`hotfix/*` 等额外层级（保持三层）。
- 不允许直接在 `main` 或 `develop` 上 `git commit`。所有改动必须经 PR 合并。
- 不允许从 `feature/*` 直接合并到 `main`。
- 不允许从 `develop` 反向合并到 `feature/*` 之外的分支。

## 2. 分支保护规则（由仓库管理员在 GitHub UI 配置）

### `main`
- ✅ Require a pull request before merging
  - Required approvals：≥1（单人开发可临时设为 0，但 PR 必须存在）
  - Dismiss stale pull request approvals when new commits are pushed：开
  - Require review from Code Owners：开（见 `.github/CODEOWNERS`，如未配置可先跳过）
- ✅ Require status checks to pass before merging
  - Require branches to be up to date before merging：开
  - 必过检查：`test (windows)`、`build (windows)`、`branch-policy`
- ✅ Require conversation resolution before merging
- ✅ Require linear history（推荐 rebase merge）
- ✅ Restrict who can push to matching branches：留空（无人可绕过 PR）
- ❌ Allow force pushes：禁用
- ❌ Allow deletions：禁用
- ❌ 不允许任何直推（包括管理员尽量不绕过）

### `develop`
- ✅ Require a pull request before merging（来源必须为 `feature/*`，由 `branch-policy` workflow 强制）
- ❌ 不要求 status checks 全部通过（**允许开发中内容**：测试失败的功能可合入 develop 继续集成）
- ✅ Require conversation resolution before merging
- ✅ Require linear history
- ❌ Allow force pushes：禁用
- ❌ Allow deletions：禁用

> GitHub 原生不支持「main 仅接受来自 develop 的 PR」「develop 仅接受来自 feature/* 的 PR」这类来源约束。该约束由 `.github/workflows/branch-policy.yml` 在 PR 事件上自动校验，违反即标红失败。

## 3. CI/CD（配置在 main 分支的 `.github/workflows/` 下）

### 触发与产物
- **push 到 main / develop** 及 **PR 到 main / develop**：运行 `ci.yml`
  - `test` job：`typecheck`、`test:webview`(vitest)、`test:layout`(playwright)、`smoke`、`test:packaged-*`（如适用）
  - `build` job：`tauri build`（Windows，仅用于构建验证，不发布）
- **打 tag `v*`**：运行 `release.yml`
  - 构建 Windows 安装包（`.msi` + NSIS `.exe`）与便携包
  - 自动创建 GitHub Release 并上传所有产物
  - 不自动推 npm 包（本项目非库）

### 发布流程
1. 在 `develop` 上完成功能集成并验证。
2. 从 `develop` 向 `main` 发起 PR。
3. CI 全绿 + Code Review 通过后合并到 `main`。
4. 在 `main` 上打 tag `vX.Y.Z`（语义化版本），推送 tag。
5. `release.yml` 自动构建并发布 Release。

> 不会在每次合并 main 时自动发版——仅在显式打 tag 时发布。

## 4. 本地开发命令（速查）

```bash
npm ci                              # 安装依赖
npm run typecheck                   # TS 类型检查
npm run test:webview                # vitest 单测
npm run test:layout                 # playwright 布局测试
npm run smoke                      # 示例工程编译冒烟
npm run desktop:dev                 # 桌面端开发服务器
npm run tauri:dev                   # Tauri 开发模式
npm run tauri:build                 # Tauri 打包（Windows 下产出 .msi/.exe）
```

## 5. AI Agent 协作约定

- 任何修改 `main` 或 `develop` 的尝试都应通过 PR，不允许直接 commit/push。
- 创建功能改动时，先从 `develop` 切 `feature/<topic>` 分支。
- 修改 CI / workflow / 分支策略类文件后，必须在 PR 描述中说明对发布流程的影响。
- 本仓库目标平台：**仅 Windows**（macOS / Linux 暂不构建）。
- 发布时机：**仅打 tag `v*` 时发布**，不在合并 main 时自动发布。
- 任何安全敏感操作（force push、删除分支、修改保护规则）须先与用户确认。
