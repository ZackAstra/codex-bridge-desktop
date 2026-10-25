# Codex Bridge Desktop

> 一个 Electron 桌面应用，用于管理和桥接 Codex CLI 与多种 LLM 提供商（OpenAI / Anthropic）之间的连接。

## 安装与启动

Release 只发布一个 `Codex-Bridge-Setup-<version>.exe`（NSIS 一键安装）：

- **首次使用**：运行 Setup，自动安装到 `%LocalAppData%\Programs` 并创建桌面 / 开始菜单快捷方式，安装完成后自动启动。
- **之后启动**：使用桌面或开始菜单的 "Codex Bridge" 快捷方式，直接运行已安装的 exe，无安装开销。
- **重复运行同版本 Setup**：检测到已安装相同版本时，跳过安装、直接启动已安装的应用（静默退出安装器）。
- **升级**：运行新版本 Setup，正常覆盖安装。
## 功能

- **配置管理** - 可视化编辑 Codex 环境变量（API Key、模型、Base URL、端口等）
- **上游分组** - 每种上游格式（Anthropic / OpenAI / Responses）可保存多组 Key / 模型 / Base URL 预设，分组栏内一键切换、`+` 新增、双击重命名，默认选中最近使用的一组
- **Bridge 服务器** - 内置上游代理服务，支持 Anthropic / OpenAI / Responses 三种上游协议格式（含 DeepSeek 原生 Responses API 适配）
- **Codex 启动器** - 一键启动 Codex CLI 并自动检测运行状态
- **实时日志** - 查看 Bridge 服务器和应用的实时日志输出，并按天持久化到日志文件（带会话分隔符）
- **系统托盘** - 最小化到托盘，托盘菜单支持显示窗口 / 退出等操作
- **单实例运行** - 重复启动时提示并聚焦已有窗口，避免多开
- **主题切换** - 支持浅色 / 深色 / 跟随系统主题
- **Electron Builder** - 支持打包为 Windows 安装程序

## 目录结构

```
codex-bridge-desktop/
+-- electron/
|   +-- main.ts                  # Electron 主进程
|   +-- preload.ts               # 预加载脚本（IPC 桥接）
|   +-- electron.d.ts            # Electron API 类型声明
|   +-- tsconfig.json            # Electron TypeScript 配置
|   +-- bridge/
|       +-- config.ts            # 配置加载
|       +-- server.ts            # Bridge HTTP 服务器
|       +-- reasoning/           # 推理模式配置
|       +-- sse/                 # SSE 解析/发送
|       +-- upstream/
|       |   +-- openai/          # OpenAI 协议适配
|       |   +-- anthropic/       # Anthropic 协议适配
|       |   +-- response/        # Responses 协议适配（含 DeepSeek 原生支持）
|       +-- __tests__/           # Bridge 单元测试
+-- src/
|   +-- main.tsx                 # React 入口
|   +-- App.tsx                  # 主应用组件
|   +-- vite-env.d.ts            # Vite 类型声明
|   +-- components/              # UI 组件
|   +-- styles/index.css         # 全局样式
+-- scripts/
|   +-- build-icon.cjs           # 图标生成脚本
|   +-- run-electron-builder.cjs # electron-builder 打包脚本
|   +-- run-vite.cjs             # Vite 开发服务器启动
+-- build/                       # 构建资源（图标、NSIS 安装脚本）
+-- public/                      # 静态资源
+-- package.json
+-- vite.config.ts               # Vite 配置
+-- vitest.config.ts             # 测试配置
+-- tsconfig.json                # 前端 TypeScript 配置
+-- tsconfig.node.json           # Node TypeScript 配置
+-- README.md                    # 本文件
```

## 快速开始

### 前置要求

- Node.js >= 18
- npm

### 安装

```bash
npm install
```

### 开发

```bash
npm run dev
```

启动 Vite 开发服务器和 Electron 窗口，支持热重载。

### 测试

```bash
# 运行所有测试
npm test

# 仅运行 Bridge 测试
npm run test:bridge
```

### 构建

```bash
# 构建生产版本
npm run build

# 构建 + 预览
npm run preview

# 打包为 Windows 安装程序
npm run dist
```

### 图标生成

```bash
npm run build:icon
```

## 配置说明

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| ANTHROPIC_AUTH_TOKEN | Anthropic/上游 API Token | - |
| ANTHROPIC_MODEL | Anthropic 模型名 | - |
| ANTHROPIC_BASE_URL | Anthropic 协议 Base URL | https://api.minimaxi.com/anthropic |
| OPENAI_API_KEY | OpenAI API Key | 同 ANTHROPIC_AUTH_TOKEN |
| OPENAI_BASE_URL | OpenAI Base URL | https://api.deepseek.com/v1 |
| RESPONSE_API_KEY | Responses API Key | - |
| RESPONSE_BASE_URL | Responses Base URL | https://api.openai.com/v1 |
| RESPONSE_MODEL | Responses 模型名 | - |
| UPSTREAM_FORMAT | 上游协议格式（anthropic / openai / response） | anthropic |
| CODEX_MODEL | Codex 模型名 | - |
| CODEX_PROVIDER | Codex 提供商 | bridge |
| CODEX_CHAT_REASONING_MODE | 推理强度模式 | auto |
| BRIDGE_PORT | Bridge 服务端口 | 8000 |

## 上游分组

每种上游格式（`anthropic` / `openai` / `response`）下可保存多组「API Key + 模型名 + Base URL」预设，互不干扰：

- 在对应格式的 "Xxx Upstream" 标题下方的 "Label" 行中切换分组：单击加载该组到表单，双击重命名；
- 新增：点击 `+` → 输入分组名 → `✓` 或 Enter。`✓` **只保存分组名称**，并用当前表单值生成快照；`×` 或 Esc 取消；
- 编辑已有分组：选中分组 → 修改 API Key / Model / Base URL → 点击底部 **Save Config**。Save Config 会把当前值写回该分组，并写入 `.env` / `config.toml`（唯一提交点）；
- 删除：选中分组后点击 Label 行尾的「删除」（二次确认）。表单值会保留为「未分组」草稿，不会自动切换；
- 若当前分组有未保存的修改，切换分组或上游格式前会弹窗确认，避免静默丢弃；
- 分组独立保存于应用数据目录的 `upstream-groups.json`；`.env` / `config.toml` 是运行时唯一真源；
- 启动时以 `.env` / `config.toml` 为准加载表单，并按值精确匹配高亮对应分组（不会用旧分组快照覆盖已保存配置）；
- 未选中任何分组时，Save Config 只写运行时，不会自动创建分组；
- `Reasoning Mode` 仍按既有规则自动映射，无需手动填写。

> 提示：若 bridge 正在运行，Save Config 后需停止并重新启动 bridge 才会加载新配置。

## 技术栈

- **桌面框架**: Electron 30
- **前端**: React 18 + TypeScript + Vite 5
- **后端**: Node.js (Electron 主进程)
- **测试**: Vitest
- **打包**: electron-builder (NSIS)

## 许可证

MIT
