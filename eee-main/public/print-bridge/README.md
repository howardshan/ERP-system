# 打印助手分发目录

ERP 网站从这里提供标签打印助手的下载（`PrinterSettingsPopover` 里的「下载打印助手」链接指向本目录）。

## 这里应有的文件

由 `scripts/print-bridge` 的构建产出：

- `erp-print-bridge-macos.zip` —— 含 Apple Silicon + Intel 两个二进制 + 安装脚本
- `erp-print-bridge-windows.zip` —— 含 Windows 二进制 + 安装脚本

## 如何生成

```bash
cd eee-main/scripts/print-bridge
npm install
npm run build        # 在 Mac 上跨平台产出三个二进制并打包成上面两个 zip 到本目录
```

## 部署说明（重要）

这两个 zip 是较大的二进制产物（每个约几十 MB）。让网站能下载它们，三选一：

1. **直接提交到仓库**（最省事）：把这两个 zip 一起 commit，Vercel 部署时随 `public/` 一并发布。代价是仓库体积变大。
2. **CI 构建**：在部署流水线里先跑 `npm run build` 生成 zip，再部署。仓库不存二进制。
3. **托管到 GitHub Releases**：把 zip 传到 Release，再把 `osBridgeDownload()` 里的链接改成 Release 下载地址。仓库零负担。

默认 `.gitignore` 不忽略本目录的 zip——若选方案 2/3，请自行忽略或删除。
