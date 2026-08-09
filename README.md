# Disney Language Lens / Disney+ 双语学习字幕

在 Disney+ 网页播放器中同步显示官方英文与中文字幕，并提供结合当前台词的语境、短语和单词释义。支持 Google Chrome 和 Microsoft Edge，不依赖 InterSub。

## 下载

[下载最新版 v1.1.1](https://github.com/KomorebiWerts/disney-language-lens/raw/refs/heads/main/disney-language-lens-1.1.1.zip)

SHA-256：`3228B7BFDB27E2A887B89EFBC9C54D63EE4B834E75D112D86DC3DC772F6D1E04`

## 1.1.1 更新

- 修复播放中点击“前进 10 秒 / 后退 10 秒”后字幕要等暂停才同步的问题。
- 跳转时先使用同一媒体节点的可靠时间差立即校准，再由 Disney 整集时间做精确复核。
- Disney 更换媒体片段或视频节点时不会套用旧节点时间，避免跨片段误校准。
- 新增真实 Edge 内核的连续 `+10 秒 → -10 秒` 无暂停回归测试。

## 1.1.0 更新

- 悬停默认解释当前语境，并可切换“语境 / 短语 / 单词”。
- 根据上下文选择词性；`patronizing` 在 `was quite patronizing` 中会解释为“居高临下”，不会再误译为“光顾”。
- 自动拦截网址、HTML 和接口报错，污染结果不显示也不缓存。
- 优先使用 Chrome / Edge 设备端翻译，在线语境翻译和 Disney 官方中文字幕依次后备。
- 前进、后退或拖动时先隐藏旧字幕，目标时间和英中分片就绪后才重新显示。
- 重做词卡层级、间距、状态、短语切换和错误重试界面。

## 安装

1. 下载上方 ZIP，并解压到一个长期保留的文件夹。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启“开发人员模式”。
4. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的解压文件夹。
5. 打开 Disney+ 影片即可；首次安装或更新后，扩展会自动刷新已打开的 Disney+ 页面。

更新时下载新版并覆盖原文件夹，然后在扩展管理页点击“重新加载”。

## 主要功能

- 同时读取并显示 Disney+ 自带的 English [CC] 与简体/繁体中文字幕。
- 使用整集全局时间同步，支持拖动进度条、±10 秒和跨媒体片段跳转。
- 语境短语释义、音标、匹配词性的英文简释、例句和发音。
- 可调整中英文顺序、字号、距底部位置和悬停释义开关。
- 字幕层被 Disney 播放器重建或移除后会自动恢复。

## 隐私

字幕轨道直接来自当前 Disney+ 播放页。释义优先使用浏览器设备端 Translator API；设备端模型不可用时，只把当前短语发送到 Google 翻译接口，并把单词发送到 Free Dictionary API。不会发送片名、Disney 账户信息或观看记录。通过校验的结果缓存在本机，错误和网址结果不会缓存。

## 验证

```powershell
node test.js
powershell -NoProfile -ExecutionPolicy Bypass -File .\qa\run-seek-sync-check.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\qa\run-dom-rebuild-check.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\qa\run-word-card-check.ps1
```

自动测试覆盖整集时间校准、播放中 ±10 秒即时同步、远距离跳转、旧字幕门控、官方 HLS/VTT 解析、DOM 重建恢复、网址污染拦截、短语提取、词性消歧和词卡渲染。

## 说明

本项目是非官方浏览器扩展，与 Disney 及其关联公司无隶属或背书关系。Disney+ 及相关商标归其权利人所有。使用者需要自行拥有可用的 Disney+ 订阅。
