# 登录双因子验证（MFA / TOTP）实施计划

> **状态：已实施（2026-06-24）。** `tsc --noEmit` 0 错误、`npm run build` 通过。落地编号：migration **M-156**（`20260623000010_auth_reset_mfa_permission.sql`，seed `auth.users.reset_mfa`）、边缘函数 **EF-005**（`reset-user-mfa`）。新增/改动：`MfaGate.tsx`、`App.tsx`(AAL 门控)、`AccountSettings.tsx`(MFA 状态)、`UserDetail.tsx`(Reset MFA)、`authApi.resetUserMfa`、`permissionStructure`(reset_mfa)、审计 action `mfa_enrolled/mfa_reset/mfa_removed`、i18n 三语、docs(06/03)。技术文档同步在 `eee-main/docs/`。下方为原始计划存档。
>
> ── 以下为原始计划，存档 ──
>
> **状态：计划（待执行，2026-06-24 制定）。** 应客户要求，为登录增加「Microsoft Authenticator」双重验证。决策已确认：**全员强制** + **管理员重置找回**。本文件为落地清单，按下方实施顺序执行，每步可独立验证。

## 背景 / 目标

客户要求登录时增加基于 Microsoft Authenticator 的双因子验证。

**关键认知（省掉大量工作）**：Microsoft Authenticator 本质是标准 **TOTP** 验证器（RFC 6238，扫 `otpauth://` 二维码），与 Google Authenticator/Authy 通用。**不需要接入任何微软专有 API**——做标准 TOTP 即可，用户用 MS Authenticator 扫码就能用。

**栈契合度高**：项目用 **Supabase Auth**（`@supabase/supabase-js ^2.105.4`，托管 Supabase），**原生内置 TOTP MFA**（`supabase.auth.mfa.*`），不用自研加密/校验，factor 密钥存在 Supabase auth schema，**不需要新建业务表存密钥**。目前系统无任何 MFA 代码。

目标：所有用户必须绑定 TOTP；登录时密码 + 6 位动态码双重验证；丢失验证器由管理员重置。

## 已确认决策

| 项 | 决策 |
|---|---|
| 强制范围 | **全员强制**：未绑定者登录后被引导到强制绑定页，绑定前不能使用系统 |
| 找回方式 | **管理员重置 MFA**：新增 service-role 边缘函数删除用户 factor（仿现有重置密码），用户下次登录重新绑定 |

## 架构：Supabase 原生 TOTP，三部分

### 1. 绑定（enroll）
`mfa.enroll({ factorType: 'totp' })` → 返回 `data.totp.qr_code`（SVG data URI）+ `data.totp.secret` + `data.id`(factorId) → 用户用 **Microsoft Authenticator 扫码** → 输入 6 位码 → `mfa.challenge({factorId})` + `mfa.verify({factorId, challengeId, code})` 完成绑定（factor 由 unverified 转 verified，会话升到 aal2）。
- 实现注意：enroll 前先 `listFactors()` 清掉残留的 **unverified** factor（`mfa.unenroll`），避免重复 factor。

### 2. 登录二次验证（challenge）
`signInWithPassword` 成功后会话处于 **aal1**。已绑定用户需走 `challenge` + `verify` 升到 **aal2**。

### 3. AAL 门控（全员强制）
在 `App.tsx` 会话判断里插入 MFA 门，逻辑（用 `getAuthenticatorAssuranceLevel()` + `listFactors()`）：
- 已有 verified totp factor 且 `currentLevel !== 'aal2'` → **输入验证码**模式（challenge+verify）。
- 无 verified factor → **强制绑定**模式（enroll 二维码 + verify）。
- `currentLevel === 'aal2'` → 渲染主应用。

> 注：未绑定用户 `getAuthenticatorAssuranceLevel` 的 next/current 都是 aal1，无法仅凭 AAL 区分「需绑定」，故结合 `listFactors()` 判断。

## 文件级改动清单

### 1. 新组件 `src/pages/MfaGate.tsx`
- 两态：①「输入验证器 6 位码」（已绑定）；②「设置双因子验证」（未绑定，显示二维码 + secret 备份 + 验证）。
- 验证成功回调 → 触发 App 复查 AAL → 进系统。含 Sign out 按钮（防止卡死）。
- 复用现有 LoginPage 的卡片视觉风格。

### 2. `src/App.tsx`（MainApp）
- `session` 存在时，先查 AAL：未达 aal2 → 渲染 `<MfaGate onPassed={…}/>`；达 aal2 → 渲染主应用。
- `onAuthStateChange` 之外，MFA 校验通过后需重新读取 AAL（`mfa.verify` 后 session 自动升级，重新 `getSession`/`getAuthenticatorAssuranceLevel`）。

### 3. Account Settings（`src/pages/AccountSettings.tsx`）
- 加「双因子验证」区块：显示已启用状态、可重新绑定（自助管理）。强制模式下绑定主要发生在门控页，这里以查看/重绑为主。

### 4. 管理员重置（找回）
- **边缘函数 EF-005 `supabase/functions/reset-user-mfa/index.ts`**（service role，仿 `reset-user-password`）：校验调用者已认证 → `adminClient.auth.admin.mfa.listFactors({ userId })` → 逐个 `deleteFactor`。
- `src/services/authApi.ts`：`resetUserMfa(authUserId)` 调该 EF。
- `src/pages/auth/UserDetail.tsx`：加「Reset MFA」按钮（与 Reset Password 并列），gate `auth.users.reset_mfa`。

### 5. 权限 + 迁移
- `src/lib/permissionStructure.ts`：`auth.users` 资源加 `{ id:'reset_mfa', label:'Reset MFA', prereq:'view' }`。
- 新 migration（按仓库实际最新 M 号顺延）：seed `auth.users.reset_mfa` 给 dev admin（`ysha@smu.edu`，沿用现有 seed 范式）。

### 6. 审计（复用现有 `auth_audit_log` / `logAuthAction`）
- 新 action：`mfa_enrolled`（用户绑定成功）、`mfa_removed`（用户自助解绑）、`mfa_reset`（管理员重置，target=被重置用户）。
- 埋点：MfaGate 绑定成功、Account Settings 解绑、UserDetail 重置后。

### 7. i18n（三语）+ 文档
- 新 i18n key（MfaGate、Account Settings MFA 区块、Reset MFA 按钮）——可放入 `auth` 命名空间。
- 文档同步：`eee-main/docs/modules/06_users-auth.md`（MFA 流程/强制/找回/权限）、`eee-main/docs/database/03_migrations-and-edge-functions.md`（新 migration + EF-005）。

## 复用的现有资产
- **Supabase 原生 MFA**：`supabase.auth.mfa.{enroll,challenge,verify,listFactors,unenroll,getAuthenticatorAssuranceLevel}`、`auth.admin.mfa.{listFactors,deleteFactor}`。
- **边缘函数范式**：`supabase/functions/reset-user-password/index.ts`（EF-003）——直接照搬鉴权 + service-role 结构。
- **审计**：`authApi.logAuthAction`（M-153）。
- **登录视觉**：`src/pages/LoginPage.tsx` 卡片样式。
- **重置按钮范式**：UserDetail 的 Reset Password 段。

## 风险 / 注意点
- ⚠️ **全员强制上线即生效**：所有现有用户（含管理员、演示账号）下次登录都会被强制绑定——测试时手边需有手机装好 Microsoft Authenticator。**务必先在 dev 环境跑通整条链路再上生产**。
- ⚠️ **找回是唯一逃生口**：用户丢验证器只能靠管理员重置；要确保至少有一个管理员账号能登录并执行重置（避免「全员被锁」）。建议保留一个受控的「破窗」管理员流程。
- **RLS 加固（可选，二期）**：app 层门控是主要强制手段；如需纵深防御，可在敏感表 RLS 加 `auth.jwt()->>'aal' = 'aal2'` 要求。本期不做。
- **Supabase 配置**：TOTP MFA 默认可用，无需改 Supabase 后台；「强制」由 app 层实现。

## 实施顺序
1. MfaGate 组件 + App.tsx AAL 门控（核心链路：绑定 + 验证 + 放行）。
2. Account Settings MFA 区块（自助查看/重绑）。
3. EF-005 `reset-user-mfa` + authApi.resetUserMfa + UserDetail 按钮。
4. 权限 `reset_mfa` + seed migration。
5. 审计埋点（enrolled/removed/reset）。
6. i18n（三语）+ 文档同步。
7. `tsc --noEmit` + `npm run build` 全绿。

## 验证（端到端）
1. **首次绑定**：新/未绑定用户密码登录 → 出现强制绑定页 → MS Authenticator 扫码 → 输码 → 进入系统；Supabase `auth.mfa_factors` 出现 verified factor。
2. **二次登录**：已绑定用户登录 → 出现验证码页 → 输码 → 进入；输错码报错、不放行。
3. **门控强制**：未达 aal2 时无法绕过进入任何模块。
4. **管理员重置**：管理员在 UserDetail 点 Reset MFA → 该用户 factor 被删 → 用户下次登录回到强制绑定页。
5. **审计**：`auth_audit_log` 出现 `mfa_enrolled` / `mfa_reset` 记录；中央 Logs 模块可见。
6. **构建**：`tsc` 0 错误、`build` 通过、三语 JSON 合法。
