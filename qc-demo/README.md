# QC Demo — 烘干后检验演示系统

独立应用，与 `eee-main/` 财务模块并行。技术栈：**React + Vite + FastAPI + Supabase (PostgreSQL)**。

## 前置条件

- Node.js 20+
- Python 3.12+
- [Supabase](https://supabase.com) 项目（建议 Region 靠近演示地点）

## 1. 数据库迁移

在 Supabase Dashboard → **SQL Editor** 中执行：

[`supabase/migrations/20260518000001_qc_initial.sql`](supabase/migrations/20260518000001_qc_initial.sql)

或使用 Supabase CLI：`supabase db push`（需先 `supabase link`）。

## 2. 环境变量

```bash
cp .env.example .env
```

编辑 `.env`（根目录 `qc-demo/.env`，后端会从 `backend/` 或上级目录读取）：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Supabase → Database → Connection string（**Session pooler**，URI 模式） |
| `JWT_SECRET` | Demo 用随机字符串 |
| `APP_ENV` | 保持 `demo` 以允许 `POST /demo/seed` |

> **安全：** 切勿将 `DATABASE_URL` 提交到 Git；不要在前端暴露 service role。

## 3. 本地开发

### 后端

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 初始化演示数据

```bash
curl -X POST http://127.0.0.1:8000/demo/seed
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 http://localhost:5173 ，API 经 Vite 代理到 `http://127.0.0.1:8000`。

### 健康检查

```bash
curl http://127.0.0.1:8000/health
```

应返回 `"database": "connected"`。

## 4. 演示账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| qc | demo123 | QC 员 |
| manager | demo123 | 管理员 |

## 5. 演示路径（计划书 §5.3–5.4）

**路径 A（合格）：** 登录 qc → 待检 → 选 `LOT-DEMO-001-D01` → 水活 `0.70` → 提交 → 切换 manager 看板。

**路径 B（不合格）：** 登录 qc → 检验 `LOT-DEMO-001-D02` → 水活 `0.90` → 切换 manager → Hold 处置 → 返烘。

会议前执行：`POST /demo/seed` 恢复干净演示数据。

## 6. Docker Compose

```bash
# 需先配置 qc-demo/.env
docker compose up --build
```

- API: http://localhost:8000  
- Web: http://localhost:5173  

## 7. 部署建议

| 组件 | 建议 |
|------|------|
| 前端 | Vercel，`VITE_API_URL` 指向 API 公网地址 |
| API | Railway / Fly.io，注入 `DATABASE_URL` |
| 数据库 | Supabase 托管 |

## 8. 测试

```bash
cd backend
pytest tests/ -v
```

## 相关文档

- [QC模块Demo开发计划书](../docs/QC模块Demo开发计划书.md) v1.1
- [QC模块起步与设计指南](../docs/QC模块起步与设计指南.md)
