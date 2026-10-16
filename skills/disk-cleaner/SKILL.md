---
name: disk-cleaner
description: >
  macOS / Windows 磁盘清理专家（自动识别系统）。借鉴 Mole、CCleaner、Dism++
  的安全检测机制，结合 AI 语义分析，多维度扫描磁盘占用，智能识别垃圾文件，
  生成交互式 HTML 报告 + 本地安全服务器支持一键清理（移废纸篓/直接删除）。
  扫描全程只读。务必在以下场景使用：
  用户说"磁盘满了""空间不够""清理电脑""清理缓存""释放空间""Mac/电脑 占用太多"、
  "没内存了""storage full""clean my mac""free up space""disk cleanup""磁盘清理"；
  或用户抱怨电脑没空间、想知道什么东西吃硬盘、想要清理建议时。
  注意：若用户明确指运行内存/RAM（如"哪个进程吃内存"），那是 RAM 不是存储，
  不属于本 skill。
metadata:
  author: lubenwei
  version: "4.0.0"
  references:
    - khazix-skills Storage Analyzer (https://github.com/KKKKhazix/khazix-skills)
    - Mole (https://github.com/tw93/Mole)
    - mac-cleanup-py (https://github.com/mac-cleanup/mac-cleanup-py)
    - CCleaner 检测引擎架构
    - Dism++ Data.xml 规则引擎
---

# disk-cleaner

macOS / Windows 磁盘清理专家。融合 Mole 的路径验证安全模型、khazix 的交互式 HTML 报告、以及我们自己的深度知识库。

## 铁律

- **全程只读扫描。** 只能跑扫描/统计/列目录/读元信息。绝对禁止 rm、mv、rmdir 等写操作。
- **删除只通过 server.py 执行。** 报告里的清理命令是供用户确认后通过网页一键操作或自己在终端运行的。即使用户在对话里说"帮我删"，也要先停下确认。
- **沙盒容器路径 = 用户真实目录。** macOS `~/Library/Containers/<app>/Data/Downloads/` 映射到 `~/Downloads/`，删了就是删用户文件。详见 [references/macos.md](references/macos.md)。
- **路径安全。** 所有路径必须引号包裹，执行前 dry-run 预览，危险操作二次确认。

## 执行流程

### Step 1 扫描（只读）

```bash
python3 scripts/scan.py > /tmp/storage_scan.json
```

`scan.py` 自动识别系统（`sys.platform`）：
- **macOS**：扫 home、library、caches、containers、app_support、applications、downloads、dev_caches，以及微信、飞书、QQ、钉钉、Telegram、Teams、Discord、Chrome、Safari、VS Code、Xcode、Steam 等 20+ 应用特定路径。用 `du` 算大小。
- **Windows**：扫 user_profile、appdata_local、appdata_roaming、temp、downloads、program_files、dev_caches，以及微信、钉钉、飞书、Discord、Teams、Chrome、Edge 等。用 `os.scandir` 算大小。

输出 JSON：`system`（系统/磁盘信息）+ `groups`（通用扫描组）+ `app_groups`（应用特定扫描）+ `large_files`（>500MB 大文件）。扫描较慢，耐心等。读不到的目录标 `denied`。

### Step 2 分析与分级

先看 `system.os` 判断系统，读对应参考：macOS 读 [references/macos.md](references/macos.md)，Windows 读 [references/windows.md](references/windows.md)。然后读 `/tmp/storage_scan.json` 做分级：

1. **挑 Top 5** 占用大户，判定类型。
2. **识别"神秘大目录"**：UUID 命名的 Container，追查它属于哪个 App。
3. **三级分类：**
   - 🟢 **可自动清理**：纯缓存、临时文件、可再生。每个 🟢 项必须给 `trash_paths`（具体可删的绝对路径数组）、预估释放空间、需关闭的进程、清理命令。
   - 🟡 **需人工判断**：含用户数据。给内容画像 + 处置路径 + 风险提示。有安全子路径时给 `trash_paths`（只给移废纸篓，不给直接删除）。App 托管且无安全子路径的只给打开按钮。
   - 🔴 **谨慎清理**：建议别手删的项（重复应用、想卸的大应用）。给卸载步骤 + `app_paths`。红灯不给删除按钮。
4. **大小字段写干净**：用"约 14 GB"即可，不要加"（估算）"。

### Step 3 生成交互报告

把分析结果写成 analysis JSON（schema 见 `scripts/build_report.py` 顶部注释）。

**默认用服务器模式（`server.py`）打开报告**：

```bash
python3 scripts/server.py /tmp/storage_analysis.json   # 自动开浏览器，Ctrl+C 停
```

`server.py` 起在 127.0.0.1 + 随机端口 + 随机 token。安全模型：三套白名单（RM_ALLOW / TRASH_ALLOW / OPEN_ALLOW）+ 路径验证（来自 Mole）+ 审计日志 + Host 校验。🟢 项给「移废纸篓」+「直接删除」；🟡 项给「在访达打开」+（有安全子路径时）「移废纸篓」；🔴 项给「在访达打开（去卸载）」。

仅当用户只想要可分享的只读文件时，用静态模式：

```bash
python3 scripts/build_report.py /tmp/storage_analysis.json ~/Desktop/storage-report.html && open ~/Desktop/storage-report.html
```

**排障：网页上没有删除按钮** = 要么开的是静态报告（改用 `server.py`），要么 🟢 项漏了 `trash_paths`。

报告阅读流：磁盘总览卡片 → Top5 → 执行建议 → 🟢🟡🔴 三级折叠卡片 → 长期优化建议。

### Step 4 对话里给摘要

报告生成后，在对话里用一段话给结论先行的摘要：总可释放估算、最该先清的 2-3 项、风险最高的一项。细节让用户看网页。

## 依赖与运行前提

- 全部脚本是 **Python 3 标准库**，零第三方依赖。
- **macOS** 自带 python3、`du`、`diskutil`、`osascript`，开箱即用。
- **Windows** 需先装 Python 3，命令多为 `python` 或 `py -3`。本 skill 命令示例写的是 `python3`，在 Windows 上自动改用 `python` / `py -3`。
- 本 skill 是 **agent 驱动**：扫描出数据后由 agent（Codex）做分级分析。

## 平台状态

- **macOS**：完整实现（扫描 / 报告 / 一键删除全验证过）。
- **Windows**：代码已写但**未在真实 Windows 上实测**。
