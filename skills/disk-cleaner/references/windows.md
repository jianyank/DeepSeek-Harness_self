# Windows 数据布局与分级参考

分析 Windows 扫描结果时读这份。讲"东西存在哪、怎么辨认、归哪一级"。
注意：Windows 代码路径在 macOS 上无法验证，分析时对路径存在性保持谨慎。

## Windows 路径体系

| 变量 | 实际路径 | 说明 |
|------|---------|------|
| `%USERPROFILE%` | `C:\Users\<用户名>` | 用户主目录 |
| `%APPDATA%` | `C:\Users\<用户名>\AppData\Roaming` | 漫游应用数据 |
| `%LOCALAPPDATA%` | `C:\Users\<用户名>\AppData\Local` | 本地应用数据 |
| `%TEMP%` | `C:\Users\<用户名>\AppData\Local\Temp` | 用户临时文件 |
| `%SYSTEMROOT%` | `C:\Windows` | 系统根目录 |
| `%PROGRAMFILES%` | `C:\Program Files` | 64 位程序 |
| `%PROGRAMFILES(X86)%` | `C:\Program Files (x86)` | 32 位程序 |
| `%PROGRAMDATA%` | `C:\ProgramData` | 所有用户共享数据 |

## 多盘符

Windows 通常多个盘（C:、D:…）。分析和清理**聚焦系统盘 C:**。其他盘归 🟡 让用户自己判断。

## 关键目录

| 目录（环境变量） | 装什么 | 典型分级 |
|-----------------|--------|---------|
| `%LOCALAPPDATA%` | 浏览器缓存、应用数据、Temp | 缓存 🟢 / 应用数据 🟡 |
| `%LOCALAPPDATA%\Temp`、`%TEMP%` | 临时文件 | 🟢 |
| `%APPDATA%`（Roaming） | 应用配置/数据 | 🟡 |
| 浏览器缓存 `...\Chrome\User Data\*\Cache`、Edge 同构 | 浏览器缓存 | 🟢 |
| 浏览器 `User Data\<Profile>`（非 Cache 部分） | 书签/登录态 | 🟡 |
| `%USERPROFILE%\.cache`、`.npm`、`.gradle`、`.m2`、`.nuget\packages`、`%LOCALAPPDATA%\pip\Cache` | 开发缓存 | 🟢 |
| `C:\Program Files`、`Program Files (x86)` | 应用本体 | 🔴 仅重复/想卸时上灯 |
| `%USERPROFILE%\Downloads` 的安装包 | exe/msi 残留 | 🟢 |
| `C:\$Recycle.Bin` | 回收站 | 🟡 提示用户清空 |

## 注册表安全

- AI Agent **不直接修改注册表**（`reg delete`、`reg add`）
- 可以扫描并报告注册表问题（如孤儿卸载项），但修复操作交由专业工具
- 注册表 `HKEY_LOCAL_MACHINE\SYSTEM\`、`...\CurrentVersion\` 绝对不可动

## 系统占用（不上灯，归蓝色"系统及其他"）

| 项目 | 说明 |
|------|------|
| `C:\Windows\WinSxS` | 组件存储，**绝不能手删**，用 `DISM /Online /Cleanup-Image /StartComponentCleanup` |
| `C:\Windows\SoftwareDistribution\Download` | Windows Update 缓存，用磁盘清理处理 |
| `hiberfil.sys`（休眠）| 系统管理，别手动删 |
| `pagefile.sys`（虚拟内存）| 系统管理，别手动删 |
| `C:\Windows.old` | 旧安装残留，需确认后可清 |

## 安全清理目标知识库

### 🟢 系统级缓存（100% 安全）

| 目标 | 命令/路径 | 典型大小 |
|------|----------|---------|
| 用户临时文件 | `Remove-Item "$env:TEMP\*" -Recurse -Force` | 1-5GB |
| 缩略图缓存 | `Remove-Item "$env:LOCALAPPDATA\...\thumbcache_*" -Force` | 100-500MB |
| 回收站 | `Clear-RecycleBin -Force` | 不定 |
| 崩溃转储 | `Remove-Item "$env:LOCALAPPDATA\CrashDumps\*" -Force` | 100MB-2GB |

### 🟢 通讯软件缓存（100% 安全）

| 目标 | 路径 | 典型大小 |
|------|------|---------|
| 微信缓存 | `%USERPROFILE%\Documents\WeChat Files\<wxid>\FileStorage\Cache\` | 1-10GB |
| 微信小程序 | `%USERPROFILE%\Documents\WeChat Files\<wxid>\Applet\` | 500MB-5GB |
| Discord 缓存 | `%APPDATA%\discord\Cache\`、`Code Cache\` | 200MB-1GB |
| Teams 缓存 | `%APPDATA%\Microsoft\Teams\Cache\`、`blob_storage\` | 500MB-2GB |

### 🟢 浏览器缓存（100% 安全）

| 目标 | 路径 | 典型大小 |
|------|------|---------|
| Chrome 缓存 | `%LOCALAPPDATA%\...\Default\{Cache,Code Cache,Service Worker}` | 500MB-3GB |
| Edge 缓存 | `%LOCALAPPDATA%\...\Default\{Cache,Code Cache,Service Worker}` | 500MB-2GB |
| Firefox 缓存 | `%LOCALAPPDATA%\Firefox\Profiles\*\cache2\` | 200MB-1GB |

### 🟢 开发工具缓存（100% 安全）

| 目标 | 命令/路径 | 典型大小 |
|------|----------|---------|
| npm 缓存 | `npm cache clean --force` | 500MB-5GB |
| pip 缓存 | `pip cache purge` | 100MB-1GB |
| NuGet 缓存 | `dotnet nuget locals all --clear` | 500MB-5GB |
| VS Code CachedData | `%APPDATA%\Code\CachedData\` | 100-500MB |

## 不建议删除的区域

| 路径 | 原因 |
|------|------|
| `C:\Windows\` | 系统核心 |
| `C:\Program Files\*` | 已安装程序 |
| `%USERPROFILE%\Documents\` | 用户文档（含微信聊天记录） |
| `%USERPROFILE%\Downloads\` | 用户下载 |
| `%APPDATA%` 内的子目录 | 应用核心数据，需逐个判断 |
| `C:\pagefile.sys` | 虚拟内存 |
| 注册表 | AI 不直接操作 |

## 间接释放（写进 long_term）

- 设置 > 系统 > 存储 > 存储感知
- `cleanmgr`（磁盘清理）
- Dism++ 清理 WinSxS 组件
- 大文件归档到 D: 盘或 NAS
