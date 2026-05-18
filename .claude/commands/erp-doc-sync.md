# ERP Doc Sync — Pre-Reply Checklist

Run this at the start of every reply to ensure documentation stays in sync with the codebase.

## 1. New SQL migration or Edge Function?

If any `.sql` file was added or modified in `eee-main/supabase/migrations/`:
- Check `eee-main/docs/database/03_migrations-and-edge-functions.md`
- Add a row to the Migrations Index table: `| M-NNN | filename.sql | what it does |`
- Increment migration counter (currently at M-008; next is M-009)

If any file was added under `eee-main/supabase/functions/`:
- Add it to the Edge Functions section in that same doc

## 2. New route or screen added?

If a new `case` was added to `App.tsx` or `DashboardLayout.tsx`, or a new `activeModule` branch:
- Update `eee-main/docs/README.md` — the routing table must list every screen with its `activeModule`, `activeScreen`, file path, and description

## 3. New page or component file?

If a new file was created in `src/pages/` or `src/components/`:
- Find the relevant module doc in `eee-main/docs/modules/` and add the file path + purpose
- If it's a new module entirely, create `eee-main/docs/modules/NN_module-name.md` from the template below

## 4. New database table or RPC function?

If `CREATE TABLE` or `CREATE FUNCTION` appears in any migration:
- Add the table to `eee-main/docs/database/01_schema.md` with column list
- Add the function to `eee-main/docs/database/02_rpc-functions.md` with signature and purpose

## 5. Design / theme change?

Record the current design token in this file:
- **Warm white background**: `#faf8f5` — applied to all page backgrounds (HomePage, WorkflowList, WorkflowBuilder toolbar/panels, DashboardLayout, ModulePlaceholder)
- **Workflow canvas**: stays dark `#1e293b` (slate-800) for contrast
- **Node cards (BaseNode)**: stay dark `#111827` — they render on the dark canvas

---

## Module doc template

```markdown
# Module Name

**Status**: active | coming_soon
**activeModule value**: `string`

## Routes / Screens

| activeScreen | File | Description |
|---|---|---|
| ... | ... | ... |

## Components

| File | Purpose |
|---|---|
| ... | ... |

## Database Tables

| Table | Purpose |
|---|---|
| ... | ... |

## RPC Functions

| Function | Purpose |
|---|---|
| ... | ... |
```

---

## Tauri-specific constraints (always apply)

These are hard constraints in Tauri v2 on macOS — do not use alternatives:

| 禁止 | 原因 | 替代方案 |
|------|------|---------|
| `window.confirm()` / `alert()` / `prompt()` | Tauri v2 禁用，返回 false/undefined | 内联二次点击确认：首次点击变红显示文字，3 秒内再次点击执行 |
| `dataTransfer.setData('application/xxx', ...)` | WKWebView 丢弃非标准 MIME type | 改用 `text/plain` |
| HTML5 drag-drop 作为唯一交互 | Tauri WebView 兼容性有限 | 同时提供点击触发（click-to-add）作为主要路径 |

---

## Git rule

Never run `git commit` or `git push`. The user does all git operations themselves.
