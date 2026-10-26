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
- **Bridge 服务器** - 内置上游代理服务，支持 Anthropic / OpenAI / Responses 三种上游协议格式
- **原生 DeepSeek** - 严格按 URL 识别 `api.deepseek.com`：Responses 默认官方直连（写入 `models.json` 与官方 Codex 字段），也可切回 Bridge；中转站的 DeepSeek 不会被误判
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
|   +-- tsconfig.json            # Electron TypeScript 配置
|   +-- assets/
|   |   +-- deepseek-models.json # DeepSeek 官方 Codex 模型目录（v1.4.0 资产）
|   +-- codex/
|   |   +-- nativeDeepseek.ts    # 原生 DeepSeek URL/模型判定
|   |   +-- toml.ts              # config.toml 增量编辑与校验
|   |   +-- modelsCatalog.ts     # models.json 合并
|   |   +-- configPlan.ts        # 直连/桥接配置计划
|   |   +-- configStore.ts       # 备份、sidecar、原子写入
|   |   +-- __tests__/           # codex 模块测试
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
|   +-- copy-electron-assets.cjs # 复制官方模型目录到 dist-electron
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
| NATIVE_DEEPSEEK_VIA_BRIDGE | 原生 DeepSeek Responses 是否经 Bridge（true/false） | false |
| NATIVE_DEEPSEEK_WEB_SEARCH | 原生 DeepSeek v4-pro 联网搜索（live/空） | 空（关闭） |
| UPSTREAM_FORMAT | 上游协议格式（anthropic / openai / response） | anthropic |
| CODEX_MODEL | Codex 模型名 | - |
| CODEX_PROVIDER | Codex 提供商 | bridge |
| CODEX_CHAT_REASONING_MODE | 推理强度模式 | auto |
| BRIDGE_PORT | Bridge 服务端口 | 8000 |

## 原生 DeepSeek（官方直连）

### 识别规则

只有 **HTTPS + hostname 严格等于 `api.deepseek.com`** 才视为原生 DeepSeek：

- Responses：`/`、`/v1`、`/responses`、`/v1/responses`；
- Chat：`/`、`/v1`；
- Anthropic：`/anthropic`。

`http://`、`api.deepseek.com:8443`、`foo.api.deepseek.com`、`api.deepseek.com.evil.test`，以及火山 Ark / OpenRouter / SiliconFlow 等中转站都不会命中。中转站的 DeepSeek 模型不再自动套用官方推理规则；Chat/Anthropic 格式可在 Reasoning Mode 手动选择 **DeepSeek**，Responses 格式的 effort 原样透传。

### 直连模式（默认）

原生 DeepSeek + Responses 格式下，默认由 Codex **直接连接** `https://api.deepseek.com/`，不再经过 Bridge。保存后 `config.toml` 会写入：

- `model` / `model_provider="deepseek"` / `preferred_auth_method="apikey"` / `forced_login_method="api"`；
- `model_reasoning_effort="high"` / `web_search="disabled"` / `show_raw_agent_reasoning=true`；
- `[model_providers.deepseek]`：`base_url="https://api.deepseek.com/"`、`wire_api="responses"`、`experimental_bearer_token`；
- `[desktop] enabled-reasoning-efforts = ["low","medium","high","xhigh","ultra","max"]`；
- `model_catalog_json` 指向模型目录（默认 `~/.codex/models.json`）。

模型锁定为 `deepseek-flash` / `deepseek-v4-pro`；旧名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 自动映射为 `deepseek-flash`。其他模型名会拒绝直连并报错。

### 经 Bridge 模式

勾选“经 Bridge 转发（保留日志）”后，Codex 仍连接本地 Bridge，由 Bridge 转发到 DeepSeek Responses API。切回 Bridge 时，直连期间改写的受管键（认证方式、推理强度、联网搜索、`[desktop]` 档位、`[model_providers.deepseek]`）会从 sidecar 恢复到直连前的值；`model_catalog_json` 与 `models.json` 作为共享模型目录保留，避免 Codex 退回 fallback 元数据。

### models.json 合并

为兼容其他供应商，应用**不会**用官方两项覆盖整个文件，而是：

- 保留其他模型条目与顶层字段；
- 按 slug 替换/追加 `deepseek-flash`、`deepseek-v4-pro`；
- 清理已知旧别名 `deepseek-v4-flash*`；
- 遇到非法 JSON / 非 `models` 数组会中止，不修改任何文件；
- 写入前备份到 `~/.codex/backup-deepseek/codex-bridge/`。

> 这与官方一键脚本“恰好两个模型”的校验不同，是为多供应商共存做的有意取舍。

### 冲突键与备份

直连会检测 `profile`、`model_context_window`、`model_auto_compact_token_limit*`、`base_instructions`、`model_reasoning_summary`、`plan_mode_reasoning_effort` 等会覆盖官方行为的键。首次保存会返回冲突列表并要求确认；确认后先备份再删除，切回 Bridge 时从 sidecar 恢复。`[profiles.*]` 段只警告、不整段删除。

每次写入前会备份 `config.toml` / `models.json`，日志中记录路径和 SHA-256（不记录 Key）。备份可能包含 `experimental_bearer_token`，请注意文件权限。

### 路径与重启

- 直连要求 `Codex Config Path` 等于 Codex 实际读取路径（默认 `~/.codex`，或环境变量 `CODEX_HOME`）。Store 版 Codex 通过 AUMID 启动，无法注入 `CODEX_HOME`，自定义路径会被拒绝。
- 保存后需**完全退出 Codex（托盘退出）再重新打开**，配置才会生效。
- 联网搜索仅 `deepseek-v4-pro` 支持；勾选后写入 `web_search="live"`，Search 按次计费。

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
- `Reasoning Mode` 仅对 Anthropic / OpenAI(Chat) 上游生效；Responses 上游按官方映射自动处理，不显示该控件。

> 提示：若 bridge 正在运行，Save Config 后需停止并重新启动 bridge 才会加载新配置。原生 DeepSeek 直连模式不需要启动 Bridge；若 Bridge 正在运行，应用会提示但不会自动停止。

## 技术栈

- **桌面框架**: Electron 30
- **前端**: React 18 + TypeScript + Vite 5
- **后端**: Node.js (Electron 主进程)
- **测试**: Vitest
- **打包**: electron-builder (NSIS)

## 许可证

MIT
