# Disney Language Lens / Disney+ 双语学习字幕

在 Disney+ 网页播放器中同步显示官方英文与中文字幕，并提供英文单词悬停释义、音标、简释与发音。支持 Google Chrome 和 Microsoft Edge，不依赖 InterSub，也不会翻译整句字幕。

## 下载

[下载最新版 v1.0.3](https://github.com/KomorebiWerts/disney-language-lens/raw/refs/heads/main/disney-language-lens-1.0.3.zip)

SHA-256：`81582E189D6D4F31EE0EF48B9443EF610000BB3279DDAA9D20E0178088F4A41D`

## 功能

- 同时读取并显示 Disney+ 自带的 English [CC] 与简体/繁体中文字幕。
- 使用整集全局时间同步；拖动进度条、快进、后退或跨媒体片段后会重新校准。
- 英文字幕逐词可悬停，显示中文释义、音标、英文简释、例句和发音。
- 可调整中英文顺序、字号、距底部位置和悬停释义开关。
- 字幕层被 Disney 播放器重建或移除后会自动恢复。
- Chrome 与 Microsoft Edge 使用同一套 Manifest V3 源码。

## 安装

1. 下载上方 ZIP，并解压到一个长期保留的文件夹。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的解压文件夹。
5. 打开 Disney+ 影片即可；首次安装或更新后，扩展会自动刷新已打开的 Disney+ 页面。

更新时下载新版并覆盖原文件夹，然后在扩展管理页点击“重新加载”。

## 隐私

字幕轨道直接来自当前 Disney+ 播放页面。只有你悬停的单个英文单词会发送至 Free Dictionary API 和 MyMemory；不会发送整句字幕、影片名称或观看记录。词典结果缓存在浏览器本地。

## 验证

- v1.0.3 已在 Microsoft Edge 的真实 Disney+ 播放页面验证双语字幕可见。
- 自动化测试覆盖整集时间校准、远距离跳转、官方 HLS/VTT 解析、DOM 重建恢复和隔离环境降级渲染。

运行测试：

```powershell
node test.js
powershell -NoProfile -ExecutionPolicy Bypass -File .\qa\run-dom-rebuild-check.ps1
```

## 说明

本项目是非官方浏览器扩展，与 Disney 及其关联公司无隶属或背书关系。Disney+ 及相关商标归其权利人所有。使用者需要自行拥有可用的 Disney+ 订阅。
