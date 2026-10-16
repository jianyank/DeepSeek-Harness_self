# macOS 数据布局与分级参考

分析 macOS 扫描结果时读这份。讲"东西存在哪、怎么辨认、归哪一级"。

## 关键目录

| 目录 | 装什么 | 典型分级 |
|------|--------|---------|
| `~/Library/Caches/*` | 应用/工具缓存（浏览器、Homebrew、pip、playwright） | 🟢 可自动清 |
| `~/.cache/*`、`~/.npm`、`~/.cargo`、`~/.gradle`、`~/.m2` | 开发缓存 | 🟢 |
| `~/Library/Developer/Xcode/DerivedData`、`CoreSimulator` | Xcode 构建/模拟器 | 🟢 |
| `~/Library/Containers/<UUID 或 bundleid>` | 沙盒应用数据（聊天记录、离线视频、设置） | 🟡 多为用户数据 |
| `~/Library/Application Support/*` | 应用数据（Chrome Profile、Claude VM、飞书） | 🟡 需判断 |
| `~/Downloads` 里的 .dmg/.pkg | 安装包残留 | 🟢 |
| `/Applications/*.app` | 应用本体 | 🔴 仅当重复/想卸时上灯，否则归蓝色 |
| 系统文件、APFS 本地快照 | 系统 | 不上灯，归蓝色"系统及其他" |

## 辨认"神秘 UUID 容器"

`~/Library/Containers/` 下 UUID 命名的大目录，要查清属于哪个 App：
- `ls` 进 `Data/Documents/`、`Data/Library/`，找带 bundle id 的子目录（如 `com.bilibili.bbad` → 哔哩哔哩）
- 大头常藏在隐藏目录（如 `.Downloads/` 里的 `.bilitask` 离线视频）
- 仍只读，别动文件

## 容器路径安全（macOS 沙盒映射）

macOS 沙盒容器中的以下路径是 **hardlink/映射** 到用户真实主目录的，**绝对不是独立副本**：

| 容器路径 | 映射到 |
|---------|--------|
| `~/Library/Containers/<app>/Data/Downloads/` | `~/Downloads/` |
| `~/Library/Containers/<app>/Data/Documents/` | `~/Documents/` |
| `~/Library/Containers/<app>/Data/Desktop/` | `~/Desktop/` |
| `~/Library/Containers/<app>/Data/Movies/` | `~/Movies/` |
| `~/Library/Containers/<app>/Data/Music/` | `~/Music/` |
| `~/Library/Containers/<app>/Data/Pictures/` | `~/Pictures/` |

**执行任何容器路径删除前，必须用 `readlink` 或 `ls -la` 验证是否为 symlink。如果不确定，宁可跳过。**

## 受保护应用列表

以下应用的 **数据和缓存不可清理**（含用户数据、配置、凭证）。仅在用户明确要求卸载时才可操作。

### 系统关键（绝对不可动）

com.apple.finder, com.apple.dock, com.apple.Safari, com.apple.mail, com.apple.SystemSettings, com.apple.Settings*, com.apple.controlcenter*, com.apple.Spotlight, com.apple.loginwindow, com.apple.Preview, com.apple.Notes, com.apple.Photos, com.apple.AppStore, com.apple.Terminal, com.apple.DiskUtility, com.apple.KeychainAccess

系统服务：com.apple.SecurityAgent, com.apple.CoreServices*, com.apple.SystemUIServer, com.apple.keychain*, com.apple.security*, com.apple.WiFi*, com.apple.Bluetooth*

### 密码管理器

com.1password.*, com.agilebits.*, com.lastpass.*, com.dashlane.*, com.bitwarden.*, com.keepassx.*, org.keepassxc.*, com.authy.*, com.yubico.*

### VPN / 代理工具

com.clash.*, ClashX*, com.nssurge.*, com.v2ray.*, *ShadowsocksX-NG*, *tailscale*, *zerotier*, com.wireguard.*, *amnezia*, *nordvpn*, *expressvpn*, *protonvpn*, *mullvad*

### AI 工具

Cursor, com.anthropic.claude*, Claude, com.openai.chat*, ChatGPT, com.openai.codex, Codex, com.ollama.ollama, Ollama, com.lmstudio.lmstudio, Gemini

### IDE & 编辑器

com.jetbrains.*, com.microsoft.VSCode, com.microsoft.VSCodeInsiders, com.sublimetext.*, com.apple.dt.Xcode

### 通讯软件

com.tencent.xinWeChat（微信）, com.tencent.qq, com.alibaba.DingTalkMac（钉钉）, us.zoom.xos, com.microsoft.teams*, com.slack.Slack, com.hnc.Discord, org.telegram.desktop, net.whatsapp.WhatsApp

### 设计 & 创意

com.adobe.*, com.figma.*, com.bohemiancoding.*, com.affinitydesigner.*, com.canva.CanvaDesktop, com.pixelmatorteam.*

### 虚拟化

com.docker.docker, dev.orbstack.OrbStack, com.getutm.UTM, com.vmware.fusion, com.parallels.desktop.*

### 云存储 & 同步

com.dropbox.*, com.microsoft.OneDrive*, com.google.GoogleDrive, com.apple.CloudDocs*

## 安全清理目标知识库

### 🟢 系统级缓存（100% 安全）

| 目标 | 路径 | 典型大小 |
|------|------|---------|
| 用户缓存 | `~/Library/Caches/*` | 1-5GB |
| 用户日志 | `~/Library/Logs/*` | 10-100MB |
| 系统诊断日志 | `/Library/Logs/DiagnosticReports/*` | 50-500MB |
| 废纸篓 | `~/.Trash/*` | 不定 |
| HTTP 存储 | `~/Library/HTTPStorages/*` | 10-100MB |

### 🟢 通讯软件缓存（100% 安全）

| 目标 | 路径 | 典型大小 |
|------|------|---------|
| 微信小程序网页缓存 | `.../app_data/radium/web/profiles/` | 可达 15GB |
| 微信日志 | `.../app_data/log/` | 100MB-1GB |
| 微信小程序 Applet | `.../app_data/radium/Applet/` | 100-500MB |
| 飞书 LarkShell 缓存 | `.../LarkShell/aha/` | 可达 23GB |
| QQ 旧版本安装包 | `.../QQ/versions/*.zip` | 1-3GB |
| Telegram 缓存 | `.../postbox/db` | 500MB-5GB |
| Teams 缓存 | `Cache/`, `Code Cache/`, `IndexedDB/`, `blob_storage/` | 500MB-2GB |
| Discord 缓存 | `Cache/`, `Code Cache/` | 200MB-1GB |

### 🟢 浏览器缓存（100% 安全）

| 目标 | 路径 | 典型大小 |
|------|------|---------|
| Chrome Service Worker | `.../Default/Service Worker/CacheStorage` | 500MB-2GB |
| Safari 缓存 | `~/Library/Caches/com.apple.Safari/` | 100MB-1GB |
| Firefox 缓存 | `~/Library/Caches/Firefox/` | 100MB-500MB |
| Arc 缓存 | `~/Library/Caches/Arc/` | 100MB-500MB |

### 🟢 开发工具缓存（100% 安全）

| 目标 | 命令/路径 | 典型大小 |
|------|----------|---------|
| Homebrew | `brew cleanup -s --prune-all` | 100MB-1GB |
| npm npx 缓存 | `rm -rf ~/.npm/_npx` | 500MB-2GB |
| npm 缓存 | `npm cache clean --force` | 500MB-2GB |
| pip 缓存 | `pip cache purge` | 100MB-1GB |
| Xcode DerivedData | `rm -rf ~/Library/Developer/Xcode/DerivedData/*` | 1-10GB |
| iOS 模拟器 | `xcrun simctl erase all` | 1-5GB |
| Gradle | `rm -rf ~/.gradle/caches` | 500MB-5GB |
| Docker | `docker system df` + `docker builder prune -af` | 不定 |

### 🟢 游戏平台缓存（100% 安全）

| 目标 | 路径 | 典型大小 |
|------|------|---------|
| Steam appcache/depotcache/logs | `~/Library/Application Support/Steam/{appcache,depotcache,logs}` | 100-500MB |
| Steam shadercache | `.../steamapps/shadercache` | 100MB-1GB |

## 不建议删除的区域

| 路径 | 原因 |
|------|------|
| `~/Library/Messages/` | iMessage 聊天记录和附件 |
| `~/Library/Mail/` | 邮件数据 |
| `~/Pictures/Photos Library.photoslibrary/` | 照片库 |
| `.../xwechat_files/*/msg/` | 微信聊天消息 |
| `.../xwechat_files/*/db_storage/` | 微信数据库 |

## 间接释放（写进 long_term）

- 系统"可清除空间"磁盘紧张时自动回收
- 重启释放部分 swap / 临时快照
- `brew cleanup --prune=all`
- 定期清理 Xcode DerivedData
- 可视化工具：DaisyDisk、GrandPerspective、OmniDiskSweeper
- 大文件归档到外置盘 / iCloud / NAS
