// An unpacked Chromium extension keeps its old manifest until the extension is
// reloaded. Opening this page is therefore also a safe upgrade bridge for the
// already-installed Chrome/Edge copy that points at this folder.
if (chrome.runtime.getManifest().version !== "1.0.3") {
  chrome.runtime.reload();
}

const defaults = {
  enabled: true,
  chinese: "zh-Hans",
  englishFirst: true,
  fontSize: 30,
  bottom: 12,
  hoverEnabled: true
};

const elements = {
  enabled: document.getElementById("enabled"),
  chinese: document.getElementById("chinese"),
  englishFirst: document.getElementById("englishFirst"),
  fontSize: document.getElementById("fontSize"),
  bottom: document.getElementById("bottom"),
  hoverEnabled: document.getElementById("hoverEnabled"),
  fontSizeValue: document.getElementById("fontSizeValue"),
  bottomValue: document.getElementById("bottomValue"),
  statusDot: document.getElementById("statusDot"),
  statusTitle: document.getElementById("statusTitle"),
  statusDetail: document.getElementById("statusDetail")
};

function setForm(settings) {
  elements.enabled.checked = settings.enabled;
  elements.chinese.value = settings.chinese;
  elements.englishFirst.value = String(settings.englishFirst);
  elements.fontSize.value = settings.fontSize;
  elements.bottom.value = settings.bottom;
  elements.hoverEnabled.checked = settings.hoverEnabled;
  updateOutputs();
}

function readForm() {
  return {
    enabled: elements.enabled.checked,
    chinese: elements.chinese.value,
    englishFirst: elements.englishFirst.value === "true",
    fontSize: Number(elements.fontSize.value),
    bottom: Number(elements.bottom.value),
    hoverEnabled: elements.hoverEnabled.checked
  };
}

function updateOutputs() {
  elements.fontSizeValue.textContent = elements.fontSize.value;
  elements.bottomValue.textContent = `${elements.bottom.value}%`;
}

function save() {
  updateOutputs();
  chrome.storage.sync.set(readForm());
}

function showStatus(status) {
  elements.statusDot.className = "status-dot";
  if (!status) {
    elements.statusDot.classList.add("warn");
    elements.statusTitle.textContent = "等待 Disney 播放页";
    elements.statusDetail.textContent = "打开或刷新一部 Disney+ 影片后会自动连接。";
    return;
  }

  const age = Date.now() - Number(status.receivedAt || status.updatedAt || 0);
  const stale = age > 90_000;
  if (status.ready && !stale) {
    elements.statusDot.classList.add("ready");
    elements.statusTitle.textContent = `全局时间已锁定 · ${status.displayTime || "--:--"}`;
    const source = status.clockSource === "status" ? "播放器精确时间" : "Disney 时间轴";
    elements.statusDetail.textContent = `${source} · ${status.englishTrack || "English"} + ${status.chineseTrack || "中文"}`;
  } else if (["track-error", "segment-error", "missing-track"].includes(status.phase)) {
    elements.statusDot.classList.add("error");
    elements.statusTitle.textContent = status.message || "字幕加载失败";
    elements.statusDetail.textContent = status.detail || "请刷新当前影片页面。";
  } else {
    elements.statusDot.classList.add("warn");
    elements.statusTitle.textContent = stale ? "播放器状态已过期" : (status.message || "正在连接播放器");
    elements.statusDetail.textContent = stale
      ? "请刷新当前 Disney+ 影片页面，让 1.0 插件重新接管。"
      : (status.detail || "正在等待字幕轨道和全局时间。");
  }
}

chrome.storage.sync.get(defaults).then((settings) => setForm({ ...defaults, ...settings }));
chrome.storage.local.get("languageLensLastStatus").then((values) => showStatus(values.languageLensLastStatus));

for (const key of ["enabled", "chinese", "englishFirst", "hoverEnabled"]) {
  elements[key].addEventListener("change", save);
}
for (const key of ["fontSize", "bottom"]) {
  elements[key].addEventListener("input", save);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.languageLensLastStatus) {
    showStatus(changes.languageLensLastStatus.newValue);
  }
});
