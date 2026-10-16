# 第三方许可与来源

本仓库的自有配置、插件整合与安装脚本使用根目录 LICENSE。第三方内容保留各自许可，根目录许可不会重新授权第三方组件。

- DeepSeek Harness 桌面端和 DSH SDK：DeepSeek，0.2.0-rc.2，MIT；许可副本见 licenses/DeepSeek-MIT.txt。安装包保留官方发行版的 Electron、Chromium、7-Zip 等许可文件及运行时依赖自带许可。
- 项目文件夹扩展中的 workspace-ui 基于 DeepSeek 的工作区组件修改，保留其 MIT 许可。
- dsh-whale-widget 0.3.18：MIT，轮询优化补丁及许可位于 patches/dsh-whale-widget。
- skills/gstack、skills/superpowers、skills/disk-cleaner 和 skills/find-skills：保留来源目录中的许可及文档。技能快照不含个人执行历史、认证文件和运行依赖。
- 其余 npm 插件按 config/desktop/package.json 固定版本获取，发行包保留每个 npm 包附带的许可文件。

本整合发行版为个人维护版本，不代表 DeepSeek 官方产品或官方支持。
