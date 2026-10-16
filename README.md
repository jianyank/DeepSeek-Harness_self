# DSH Self：完整桌面整合版与可回退配置

基于 DeepSeek Harness **0.2.0-rc.2**，保存当前公开配置、金融时序分析 Agent 预设、插件、技能与本地优化。整合版本为 **1.0.0**。这是个人维护的整合发行版，第三方许可见 THIRD-PARTY-NOTICES.md。

## 下载与启动

从本仓库 GitHub 的 Releases 页面下载 **DSH-Self-1.0.0-win-x64.exe**，并使用 SHA256SUMS.txt 核对文件。源码页的 Download ZIP 是源码，EXE 位于 Releases 的附件中。

1. 在 Windows x64 上运行 EXE；默认安装到 %LOCALAPPDATA%\Programs\DSH-Self。
2. 安装完成后打开该目录，双击 **Start-DSH.cmd** 启动。
3. 首次使用时登录自己的 DeepSeek 账户，并选择可用模型。发行包没有附带任何人的登录凭据。
4. 在 Agent 预设栏选择“金融时序数据分析师”，打开数据所在项目后开始分析。

安装包包含桌面应用、Node.js、pnpm、公开插件依赖和技能快照；运行桌面程序无需另装 Node.js 或 pnpm。模型服务仍需要网络、使用者自己的账户及相应权限；分析时的 Python、统计库、外部 CLI 等由使用者按任务需要安装。未提供代码签名，Windows 可能显示未知发布者提示。

默认安装路径下的 **data** 保存独立配置、登录信息、会话、技能和 Obsidian Markdown 记忆；**electron-data** 与 **electron-roaming** 保存独立桌面状态。请始终通过 Start-DSH.cmd 启动以启用隔离环境。已有 DSH 的个人数据不会被导入。上游桌面服务默认使用本机端口 19387；同一电脑运行其他 DSH 时，请先关闭另一实例再启动本发行版，以免端口冲突。

如需选择其他空目录，可在 cmd 中执行：

```cmd
set "DSH_INSTALL_ROOT=D:\Apps\DSH-Self"
DSH-Self-1.0.0-win-x64.exe
```

## 收录内容

| 目录 | 内容 |
| --- | --- |
| config/desktop | 去除自定义供应商和个人信息后的 profile 模板、固定的插件直接依赖版本 |
| agent-presets/financial-timeseries-analyst | 金融数据审计、建模、时间序列验证、术语与两档可视化要求 |
| plugins/dsh-cli-bridge | Claude / Codex CLI 终端桥接、源码与测试；需另装并登录相应 CLI |
| plugins/dsh-obsidian-memory | Markdown 持久记忆、检索、有界上下文注入及并发读取优化 |
| plugins/cache-prefix | 保持工具参数的稳定排序 |
| plugins/project-folders | 项目多文件夹管理及调整后的工作区客户端 |
| plugins/runtime-tuning | 提示词与运行时优化 |
| plugins/windows-shell-fix | Windows Shell 执行修复 |
| patches/dsh-whale-widget | 针对 0.3.18 的轮询优化，构建时校验原文件摘要后应用 |
| skills | Obsidian、disk-cleaner、find-skills、gstack、superpowers 的公开快照 |
| installer、tools、tests | 独立安装、配置恢复、构建、隐私校验和验证脚本 |

其余第三方插件的确切版本见 config/desktop/package.json。源码收录本地插件；公开 npm 插件按固定版本及 installer/plugin-dependencies.lock.yaml 在构建时下载，成品 EXE 内已安装依赖。

技能保留原始资源结构，安装配置额外注册 gstack 与 superpowers 的嵌套技能根目录。技能能被发现，并不代表其外部工具已安装：例如部分 gstack 技能需要 Bun、浏览器、GitHub CLI 或特定平台工具，部分指令仍沿用其原宿主的路径约定；请按技能自身说明配置。未打包个人 Codex 系统技能、浏览器 Cookie 或技能运行历史。

## 金融时序分析与两档图像

预设先核对字段、时间戳、时区、币种、频率与缺失值，再明确预测目标、信息可用时点和评价指标。使用时间顺序切分、滚动样本外验证及合理基线，防止未来信息泄漏。模型按样本量和目标选择；不会把复杂算法当作默认优选，也不会编造术语、分析结果或引用。

- **简约直观档**：价格或收益率、缺失区间、滚动统计、预测与基线对比；突出坐标、单位和可理解的结论。
- **学术研究档**：样本外滚动评估、残差诊断、不确定性、稳健性与完整图注；根据实际分析输出可编辑 SVG/PDF 和 PNG 预览。

预设是工作规则。图像、模型指标和报告在读取实际数据并执行分析后生成，发行包没有预置虚构分析结果。

## 更新、恢复与源码回退

重新运行新版本 EXE 前，先关闭这个安装目录的 DSH。安装器会备份 app、desktop profile 和 installer，再部署新版本；data 中其他内容保留。更新后如需沿用旧账户或个性化配置，请先保留备份并按需要迁移，切勿把这些私人文件提交到仓库。

在**已安装目录**中，可运行：

```cmd
installer\restore.cmd
```

它仅恢复最近一次 **desktop profile** 备份，不恢复程序版本或全部用户数据。被替换的 profile 会保留为 removed 目录。若需要旧程序，请使用对应 GitHub Release 的 EXE 在新的空目录中安装，再按需迁移私人数据；不同版本的数据兼容性需要另外验证。

```cmd
installer\uninstall.cmd
```

此命令把当前 profile 移为可恢复目录；不会擦除记忆、认证或应用文件。完整移除前关闭程序并备份 data，再删除这个独立安装目录。源码目录中的管理脚本只用于发行包，不能直接代替源码构建安装。

每次改动用独立 Git 提交记录，并更新 CHANGELOG.md；正式版本创建标签和 Release。需要撤销某次源码改动时使用新提交保留历史：

```cmd
git log --oneline
git revert COMMIT_ID
```

## 本地构建与验证

构建需 Windows x64、Node.js、tar.exe、IExpress，以及一份合法的 DSH 0.2.0-rc.2 程序目录。Node.js 并非 Windows 自带。构建时联网获取 npm 依赖；首次构建可能耗时数分钟，并需要数 GB 临时空间。

```cmd
npm run verify
npm test
installer\build-exe.cmd "D:\Apps\DeepSeek Harness"
```

产物为 releases/DSH-Self-1.0.0-win-x64.exe，另有 SHA256SUMS.txt 和 build-info.json。EXE 作为 Release 附件发布，不放入普通 Git 历史。构建临时目录在日志中给出，验证后可删除。

插件回归测试需与本版本匹配的真实 DSH SDK：

```cmd
set "DSH_SDK_ROOT=D:\DSH-SDK\node_modules"
npm run test:plugins
```

项目文件夹的浏览器测试还需设置 DSH_PLAYWRIGHT、DSH_CHROMIUM、DSH_REACT_ROOT；未设置浏览器入口时会明确跳过。测试不调用付费模型，协议测试连接本地模拟服务。

## 隐私边界

不收录自定义模型供应商、密钥、账号令牌、聊天、附件、浏览器数据、私人 Obsidian 内容、原始金融数据或个人绝对路径。SECURITY.md 说明扫描范围和限制。公开配置中的 __DSH_DATA__ 在安装时替换为使用者自己的独立数据目录。
