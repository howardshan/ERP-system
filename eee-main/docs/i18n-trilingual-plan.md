# 全站三语化实施计划（中文 / English / Español-MX）

> **状态：已完成（2026-06-10）。** 全站 ~95 个组件文件已迁移到 `react-i18next`，12 个命名空间（`app/auth/common/finance/hr/nav/packaging/production/qc/ui/warehouse/workflowBuilder`）的 `en/zh/es` 三份翻译齐备；`tsc` 0 错误、`npm run build` 通过。语言切换器在顶栏 / 首页 / 登录页（中文 / English / Español）。语言选择持久化到 `localStorage` key `erp_lang`。配置见 [src/i18n/index.ts](../src/i18n/index.ts)，翻译在 [src/locales/{en,zh,es}/](../src/locales/)。迁移用的合并脚本 [scripts/i18n-merge.mjs](../scripts/i18n-merge.mjs) 保留（若以后新增分片可再合并）。**es-MX 仍建议找母语者复核一遍。**
>
> ── 以下为原始计划，存档 ──
>
> 状态：**计划（待执行）**。决策已定：用 `react-i18next`；分阶段，先基础设施+切换器+示范模块跑通，再逐模块迁移；译文由 Claude 产出三语，**es-MX 由人工后续复核**。「墨西哥语」按西班牙语 `es-MX` 处理。

## 背景 / 目标

整站 UI 需支持三种语言：中文 `zh`、英文 `en`、墨西哥西班牙语 `es`（即 es-MX）。现状：**无任何 i18n 库**，文案全部写死——大部分 UI 是写死英文，约 12 个文件 / ~269 行是中文（集中在 QC 与少数组件）。目标是把**所有面向用户的静态文案**抽成 key，配三份翻译，并提供语言切换 + 持久化。

**范围边界**：只翻译**静态 UI 文案**（按钮、标题、表头、提示、错误、枚举状态标签）。**不翻译数据库/接口返回的业务数据**（如产品名、客户名、SKU、备注内容）——那是数据不是 UI。开发者文档 `docs/`（中文）保持原样。

## 技术选型

| 包 | 用途 |
|---|---|
| `i18next` + `react-i18next` | 核心 + React 绑定（`useTranslation`、`<Trans>`） |
| `i18next-browser-languagedetector` | 按 localStorage → 浏览器语言自动选择 |
| `i18next-resources-to-backend` | 按 `(语言, 命名空间)` **动态 import** JSON，按需懒加载，初始包不膨胀 |

数字 / 日期 / 货币用原生 `Intl.NumberFormat` / `Intl.DateTimeFormat`（跟随当前 locale，es-MX 的千分位/日期格式自动正确），避免手拼格式。

## 目录结构

```
src/
  i18n/
    index.ts          # i18next init（懒加载 backend、detector、fallback）
  locales/
    zh/  common.json  qc.json  warehouse.json  hr.json  finance.json  auth.json  production.json  packaging.json  nav.json
    en/  （同上同名）
    es/  （同上同名）
```

- **命名空间按模块切**，与 `src/pages/` 模块对齐，外加 `common`（通用词：保存/取消/搜索/关闭/删除/确认…）和 `nav`（导航、AppShell）。
- key 命名用点分层级：`qc.print.button`、`qc.print.printingProgress`、`common.save`。

## 配置要点（src/i18n/index.ts）

- `supportedLngs: ['zh','en','es']`，`fallbackLng: 'en'`。
- `detection`：顺序 `['localStorage','navigator']`，缓存到 localStorage（key `erp_lang`）。
- 切换语言时同步设置 `document.documentElement.lang`（三语均 LTR，无需处理 RTL）。
- 默认行为：首次按浏览器语言猜，之后记住用户手选。（如需强制默认某语，改 `fallbackLng` 即可。）

## 语言切换器

- 新增 `src/components/LanguageSwitcher.tsx`：下拉「中文 / English / Español」，调 `i18n.changeLanguage` 并写 localStorage。
- 放进 AppShell 顶栏（与「标签打印机」`PrinterSettingsPopover` 同一行），登录页也放一个。

## 单文件迁移配方（可复制的标准动作）

1. `const { t } = useTranslation('qc')`（按文件所属模块选 ns）。
2. 写死文案 → `t('print.button')`。
3. 含变量的拼接 → 插值：`t('print.progress', { current: i+1, total })`，资源里写 `"正在打印 {{current}} / {{total}}…"`。
4. 带数量的 → i18next 复数（en/es 有单复数，zh 无）：`t('print.stickerCount', { count })`。
5. 在 `zh/en/es` 三份对应 ns JSON 里补齐该 key 的三语译文。
6. 枚举/状态（如 `drying`/`passed`）→ 建 `status.*` key 映射，集中翻译。

## 分阶段路线（每阶段：抽 key → 填三语 → 类型检查/构建 → UI 抽查）

- **阶段 0｜基础设施**：装库、写 `i18n/index.ts`、接进 `main.tsx`、加 `LanguageSwitcher`、建 `common`+`nav` 两个 ns（通用词 + 导航）。**这是示范模块跑通的最小闭环**。
- **阶段 1｜高曝光页**：AppShell/导航、登录页、首页 —— 验证三语整体观感与切换。
- **阶段 2+｜按模块逐个迁移**（建议顺序按文件量/优先级）：qc(36) → hr(21) → warehouse(8) → auth(4) → finance(3) → production/packaging(2) → 根目录散页（AccountSettings、ChartOfAccounts、JournalEntry… 等约 13 个）。
- **收尾**：日期/货币格式统一过一遍 Intl；补 es-MX 复核清单。

## 防漏措施

- 加一个检查脚本/CI 步骤：`grep` 出 `src/**` 里 JSX 内**残留的中文或可疑写死英文文案**，作为「尚未迁移」追踪表，逐阶段清零。
- 可选引入 `eslint-plugin-i18next` 的 `no-literal-string` 规则（按模块逐步开启，避免一次性海量报错）。

## es-MX 复核流程

Claude 在抽 key 时直接填 `es` 译文（ERP 术语尽量准）。每阶段交付后，建议你方找西语母语者过一遍该阶段的 `es/*.json`；未复核前 `es` 已可用、不阻塞上线。

## 影响文件（首批，阶段 0/1）

- 新增：`src/i18n/index.ts`、`src/locales/{zh,en,es}/{common,nav}.json`、`src/components/LanguageSwitcher.tsx`
- 改动：`src/main.tsx`（init i18n）、AppShell/顶栏组件、`LoginPage.tsx`、`HomePage.tsx`
- 文档：按 CLAUDE.md，迁移涉及模块时在对应 `docs/modules/*.md` 注明「文案已 i18n 化」；本计划文件为总纲。

## 验证方式

- `npm run dev`，用切换器在三语间切，逐页确认无遗漏、无 key 裸露（形如 `qc.print.button` 直接显示即说明缺译或 ns 没载）。
- `npx tsc --noEmit` 通过；构建产物体积检查（确认懒加载生效，未把三语全打进主包）。
- 防漏 grep 清单逐阶段归零。

## 工作量预期

跨 120 文件、约 8 个命名空间，**多阶段、多轮**完成。阶段 0+1 一轮可跑通示范；其余模块按批推进，每批一轮。不建议一次性全站迁移（易漏、难验收）。
