# disk-cleaner

macOS / Windows 磁盘清理 Skill，专为 [Claude Code](https://claude.ai/code) 设计。

## 这是什么？

一个融合了三大项目精华的 AI 磁盘清理工具：

- **[khazix Storage Analyzer](https://github.com/KKKKhazix/khazix-skills)** — 交互式 HTML 报告 + 本地安全服务器 + 三套白名单
- **[Mole](https://github.com/tw93/Mole)**（54K+ Stars）— 路径验证三道防线 + 200+ 受保护应用列表 + 操作审计
- **我们的知识库** — 10 大类 100+ 条安全清理目标（中文应用覆盖最全）

v4.0.0 将 macOS 和 Windows 两个独立 Skill 合并为一个统一的 `disk-cleaner`，自动识别系统。

## 核心特性

### 🎨 交互式 HTML 报告

不再是纯文本 Markdown 表格。扫描后生成精美的可视化报告：

- **磁盘进度条** — 已用空间按清理分级着色（🟢绿/🟡橙/🔴红/🔵蓝 分段）
- **三色分级卡片** — 每个发现项可展开查看详情、清理命令一键复制
- **Top 5 占用排行** — 一眼看到谁在吃磁盘
- **执行建议 + 长期优化** — 结论先行，行动路径清晰

### 🔒 本地安全服务器

一键启动本地服务，在浏览器里直接操作：

- 绑定 `127.0.0.1` + 随机端口 + 随机 Token + Host 校验
- **三套白名单**：`RM_ALLOW`（仅绿灯可硬删） / `TRASH_ALLOW`（绿+橙可入废纸篓） / `OPEN_ALLOW`（非破坏性打开）
- **路径验证**（来自 Mole）：拒绝空路径、相对路径、路径穿越、符号链接攻击、系统关键路径
- **操作审计日志**：每次操作记录到 `~/Library/Logs/disk-cleaner/operations.log`
- **Fail-closed**：Trash 失败时拒绝降级为永久删除

### 🧠 AI 智能分析

Claude AI 做传统工具做不到的事：

- **语义分析**：区分「微信重要聊天记录」和「三个月前的小程序网页缓存」
- **内容读取**：读取文件内容判断是否安全可删
- **路径推理**：从 UUID 容器路径推断属于哪个 App
- **智能分级**：🟢 安全可删 / 🟡 需人工判断 / 🔴 谨慎清理

### 📊 超广覆盖（20+ 应用特定扫描）

| 类别 | 覆盖应用 |
|------|---------|
| 通讯 | 微信、飞书、QQ、钉钉、Telegram、Teams、Discord |
| 浏览器 | Chrome、Safari、Firefox、Arc、Edge |
| 开发 | Homebrew、npm/pnpm、pip、Xcode、VS Code、Cursor、Gradle、Go |
| 创意 | Adobe、Figma、Steam |
| 系统 | 废纸篓、系统缓存、诊断日志、Docker |

## 快速使用

### 安装

```bash
# 克隆到 Claude Code skills 目录
git clone https://github.com/xiaofenggan01/disk-cleaner-skills.git ~/.claude/skills/disk-cleaner
```

### 触发方式

在 Claude Code 中说"磁盘满了"、"清理电脑"、"空间不够"等，自动触发。

### 手动扫描

```bash
# 扫描（只读，约 1-2 分钟）
python3 scripts/scan.py > /tmp/storage_scan.json
```

扫描完成后，Claude 会读取 JSON 做智能分级分析，然后生成 HTML 报告。

## 目录结构

```
disk-cleaner/
├── SKILL.md                      # Skill 指令（流程引导）
├── scripts/
│   ├── scan.py                   # 扫描脚本（macOS + Windows 自动识别）
│   ├── build_report.py           # 静态 HTML 报告生成
│   └── server.py                 # 本地安全服务器
├── assets/
│   └── report_template.html      # 交互式 HTML 模板
└── references/
    ├── macos.md                  # macOS 分级参考 + 受保护应用列表
    └── windows.md                # Windows 分级参考
```

## 安全机制

### Mole 启发的路径验证

```
validate_path()
  ├── 空路径拒绝
  ├── 相对路径拒绝
  ├── 路径穿越检查（..）
  ├── 控制字符检查
  ├── 符号链接解析 + 目标校验
  ├── 系统关键路径黑名单（/System, /usr, /bin 等 20+ 路径）
  └── $HOME 范围检查
```

### macOS 沙盒容器安全

macOS 沙盒容器中的 `Data/Downloads/` 等路径是 hardlink 到用户真实目录的，删除即删用户文件。本 Skill 会在 `references/macos.md` 中明确标注映射关系。

### 200+ 受保护应用

不可清理的应用数据（来自 Mole 的保护列表）：

- 系统关键（Finder、Dock、Safari、Terminal 等）
- 密码管理器（1Password、Bitwarden、LastPass 等）
- VPN/代理（Clash、Surge、Tailscale、WireGuard 等）
- AI 工具（Claude、ChatGPT、Cursor、Ollama 等）
- IDE（VS Code、JetBrains、Xcode 等）
- 通讯软件（微信、QQ、钉钉、Teams 等）

## 技术细节

- **零依赖**：纯 Python 3 标准库，无需 pip install
- **跨平台**：`sys.platform` 自动识别 macOS / Windows
- **只读扫描**：scan.py 只做 du/stat/ls，不做任何写操作
- **Agent 驱动**：扫描出数据后由 Claude AI 做分级分析

## 致谢

- **[khazix-skills](https://github.com/KKKKhazix/khazix-skills)** — 交互式 HTML 报告、本地安全服务器、三套白名单架构、SKILL.md 流程设计
- **[Mole](https://github.com/tw93/Mole)** — 路径验证安全模型、200+ 受保护应用列表、操作审计、孤儿检测
- **[mac-cleanup-py](https://github.com/mac-cleanup/mac-cleanup-py)** — 应用清理路径参考
- **[CCleaner](https://www.ccleaner.com/)** — 注册表扫描引擎架构参考
- **[Dism++](https://github.com/Chuyu-Team/Dism-Multi-Tool)** — Windows 清理规则引擎参考

## License

MIT
