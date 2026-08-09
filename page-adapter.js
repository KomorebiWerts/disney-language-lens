(function () {
  "use strict";

  const core = globalThis.DisneyLanguageLensCore;
  const CHANNEL = "disney-language-lens:v1";
  const BUILD_VERSION = "1.0.3";
  const originalFetch = window.fetch.bind(window);
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const defaults = {
    enabled: true,
    chinese: "zh-Hans",
    englishFirst: true,
    fontSize: 30,
    bottom: 12,
    hoverEnabled: true
  };

  let settings = { ...defaults };
  let generation = 0;
  let activeTracks = null;
  let activeTrackSignature = "";
  let latestMaster = null;
  let lastCaptionKey = "";
  let lastStatusText = "";
  let lastTimelineValue = null;
  let observedVideo = null;
  let playbackState = { playing: false, rate: 1 };
  let lastHealthSecond = -1;
  let scanningExistingResources = false;
  const clock = core.createPlaybackClock();

  function post(type, payload = {}) {
    window.postMessage({
      channel: CHANNEL,
      sender: "page-adapter",
      type,
      version: BUILD_VERSION,
      ...payload
    }, "*");
  }

  function emitStatus(phase, message, detail = "") {
    const snapshot = clock.snapshot(performance.now());
    post("status", {
      phase,
      message,
      detail,
      clockReady: snapshot.ready,
      clockSource: snapshot.source,
      globalTime: snapshot.seconds,
      updatedAt: Date.now()
    });
  }

  function selectPlaybackVideo() {
    const videos = [...document.querySelectorAll("video")];
    if (!videos.length) return null;
    return videos.reduce((best, video) => {
      const score = (video.readyState > 0 ? 1_000_000_000 : 0) +
        Math.max(0, video.clientWidth) * Math.max(0, video.clientHeight) +
        (video.currentTime > 0 ? 1_000_000 : 0);
      const bestScore = (best.readyState > 0 ? 1_000_000_000 : 0) +
        Math.max(0, best.clientWidth) * Math.max(0, best.clientHeight) +
        (best.currentTime > 0 ? 1_000_000 : 0);
      return score > bestScore ? video : best;
    });
  }

  function currentPlayback() {
    const video = selectPlaybackVideo();
    return {
      video,
      playing: Boolean(video && !video.paused && !video.ended),
      rate: Number.isFinite(video?.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1
    };
  }

  function clearCaption(reason = "") {
    const key = `||${reason}`;
    if (lastCaptionKey === key) return;
    lastCaptionKey = key;
    post("caption", { english: "", chinese: "", reason });
  }

  function calibrateAbsolute(seconds, source) {
    if (!Number.isFinite(seconds)) return false;
    const nowMs = performance.now();
    const before = clock.read(nowMs);
    const playback = currentPlayback();
    if (Number.isFinite(before) && Math.abs(before - seconds) > 2) {
      clearCaption("seeking");
    }
    const calibrated = clock.calibrate({
      seconds,
      nowMs,
      playing: playback.playing,
      rate: playback.rate,
      source
    });
    if (calibrated) playbackState = { playing: playback.playing, rate: playback.rate };
    return calibrated;
  }

  function findTimelineClock() {
    const candidates = [...document.querySelectorAll(
      '[role="slider"][aria-valuenow][aria-valuemin][aria-valuemax]'
    )];
    for (const element of candidates) {
      const seconds = core.parseTimelineClock({
        now: element.getAttribute("aria-valuenow"),
        min: element.getAttribute("aria-valuemin"),
        max: element.getAttribute("aria-valuemax")
      });
      if (Number.isFinite(seconds)) return seconds;
    }
    return null;
  }

  function calibrateFromDom() {
    const statusText = document.querySelector(".text-to-speech-status")?.textContent?.trim() || "";
    if (statusText && statusText !== lastStatusText) {
      lastStatusText = statusText;
      const statusSeconds = core.parseAccessibleClock(statusText);
      if (Number.isFinite(statusSeconds)) calibrateAbsolute(statusSeconds, "status");
    }

    const timelineSeconds = findTimelineClock();
    if (Number.isFinite(timelineSeconds) &&
        (timelineSeconds !== lastTimelineValue || !clock.snapshot(performance.now()).ready)) {
      lastTimelineValue = timelineSeconds;
      calibrateAbsolute(timelineSeconds, "timeline");
    }
  }

  function syncPlaybackState() {
    const playback = currentPlayback();
    if (playback.playing !== playbackState.playing || playback.rate !== playbackState.rate) {
      clock.setPlayback({
        playing: playback.playing,
        rate: playback.rate,
        nowMs: performance.now()
      });
      playbackState = { playing: playback.playing, rate: playback.rate };
    }
  }

  function scheduleCalibration() {
    for (const delay of [0, 40, 120, 300, 700, 1300]) {
      setTimeout(() => {
        calibrateFromDom();
        syncPlaybackState();
      }, delay);
    }
  }

  function attachVideoEvents() {
    const video = selectPlaybackVideo();
    if (!video || video === observedVideo) return;
    observedVideo = video;
    const onState = () => {
      syncPlaybackState();
      scheduleCalibration();
    };
    for (const eventName of ["play", "playing", "pause", "ratechange", "seeking", "seeked", "loadedmetadata"] ) {
      video.addEventListener(eventName, onState, { passive: true });
    }
    onState();
  }

  function installClockObservers() {
    const begin = () => {
      if (!document.documentElement) {
        setTimeout(begin, 20);
        return;
      }
      const observer = new MutationObserver(() => {
        calibrateFromDom();
        attachVideoEvents();
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-valuenow", "aria-valuetext"]
      });
      calibrateFromDom();
      attachVideoEvents();
    };
    begin();

    document.addEventListener("pointerup", scheduleCalibration, true);
    document.addEventListener("click", scheduleCalibration, true);
    document.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End", "j", "l", "J", "L"].includes(event.key)) {
        clearCaption("seeking");
        scheduleCalibration();
      }
    }, true);
    document.addEventListener("visibilitychange", scheduleCalibration, true);
    setInterval(() => {
      attachVideoEvents();
      calibrateFromDom();
      syncPlaybackState();
    }, 250);
  }

  async function buildTrack(track, expectedGeneration) {
    const playlistResponse = await originalFetch(track.url, { credentials: "include" });
    if (!playlistResponse.ok) throw new Error(`字幕清单请求失败 (${playlistResponse.status})`);
    const playlistText = await playlistResponse.text();
    if (generation !== expectedGeneration) return null;
    const segments = core.parseMediaPlaylist(playlistText, track.url);
    if (!segments.length) throw new Error("字幕清单没有可用片段");
    return {
      ...track,
      segments,
      loaded: new Map(),
      loading: new Map(),
      cues: []
    };
  }

  async function loadSegment(track, segmentIndex, expectedGeneration) {
    if (!track || track.loaded.has(segmentIndex)) return;
    if (track.loading.has(segmentIndex)) return track.loading.get(segmentIndex);
    const segment = track.segments[segmentIndex];
    if (!segment) return;

    const pending = originalFetch(segment.url, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error(`字幕片段请求失败 (${response.status})`);
        return response.text();
      })
      .then((text) => {
        if (generation !== expectedGeneration) return;
        const cues = core.parseVttSegment(text, segment.start, segment.duration);
        track.loaded.set(segmentIndex, cues);
        track.cues = core.dedupeCues([...track.cues, ...cues]);
        post("status", {
          phase: "segment-loaded",
          message: "官方字幕片段已载入",
          detail: `${track.name} ${segment.index}`,
          trackName: track.name,
          segmentIndex,
          segmentStart: segment.start,
          segmentEnd: segment.end,
          segmentCueCount: cues.length,
          firstCueStart: cues[0]?.start ?? null,
          lastCueEnd: cues.at(-1)?.end ?? null,
          updatedAt: Date.now()
        });
      })
      .catch((error) => emitStatus("segment-error", "字幕片段加载失败", error.message))
      .finally(() => track.loading.delete(segmentIndex));
    track.loading.set(segmentIndex, pending);
    return pending;
  }

  async function activateMaster(manifestUrl, text) {
    const tracks = core.parseMaster(text, manifestUrl);
    if (!tracks.length) return;
    latestMaster = { manifestUrl, text, tracks };
    const selected = core.chooseTracks(tracks, settings.chinese);
    if (!selected.english || !selected.chinese) {
      emitStatus(
        "missing-track",
        "本集缺少英文或中文字幕",
        tracks.map((track) => `${track.language}:${track.name}`).join(", ")
      );
      return;
    }

    const signature = `${selected.english.url}|${selected.chinese.url}`;
    if (signature === activeTrackSignature && activeTracks) return;
    activeTrackSignature = signature;
    const currentGeneration = ++generation;
    activeTracks = null;
    clearCaption("loading-tracks");
    emitStatus("loading", "正在载入官方双语字幕", `${selected.english.name} + ${selected.chinese.name}`);

    try {
      const [english, chinese] = await Promise.all([
        buildTrack(selected.english, currentGeneration),
        buildTrack(selected.chinese, currentGeneration)
      ]);
      if (generation !== currentGeneration || !english || !chinese) return;
      activeTracks = { english, chinese, generation: currentGeneration };
      emitStatus("ready", "官方双语字幕已就绪", `${selected.english.name} + ${selected.chinese.name}`);
    } catch (error) {
      if (generation !== currentGeneration) return;
      activeTrackSignature = "";
      emitStatus("track-error", "字幕轨道加载失败", error.message || "未知错误");
    }
  }

  function inspectManifest(url, text) {
    if (!text?.includes("#EXTM3U") || !text.includes("TYPE=SUBTITLES")) return;
    activateMaster(url, text);
  }

  function inspectResponse(url, response) {
    if (!/\.m3u8(?:$|[?#])/i.test(url)) return;
    response.clone().text().then((text) => inspectManifest(url, text)).catch(() => {});
  }

  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || response.url;
    inspectResponse(String(requestUrl || response.url), response);
    return response;
  };

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__languageLensUrl = String(url || "");
    this.addEventListener("load", function () {
      if (!/\.m3u8(?:$|[?#])/i.test(this.__languageLensUrl)) return;
      try {
        if (!this.responseType || this.responseType === "text") {
          inspectManifest(this.responseURL || this.__languageLensUrl, this.responseText);
        }
      } catch (_) {}
    }, { once: true });
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  async function inspectExistingResources() {
    if (scanningExistingResources) return;
    scanningExistingResources = true;
    try {
      const urls = performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /\.m3u8(?:$|[?#])/i.test(url));
      // Search newest-first and stop at the first master manifest. Running old
      // and new episode manifests concurrently can otherwise let a slower,
      // stale request win after SPA navigation.
      for (const url of [...new Set(urls)].slice(-30).reverse()) {
        try {
          const response = await originalFetch(url, { credentials: "include" });
          if (!response.ok) continue;
          const text = await response.text();
          if (text.includes("#EXTM3U") && text.includes("TYPE=SUBTITLES")) {
            inspectManifest(url, text);
            break;
          }
        } catch (_) {}
      }
    } finally {
      scanningExistingResources = false;
    }
  }

  function renderFrame() {
    const nowMs = performance.now();
    const snapshot = clock.snapshot(nowMs);
    if (!settings.enabled || !snapshot.ready || !activeTracks) {
      clearCaption(!snapshot.ready ? "waiting-for-global-clock" : "waiting-for-tracks");
      requestAnimationFrame(renderFrame);
      return;
    }

    const time = snapshot.seconds;
    const currentGeneration = activeTracks.generation;
    for (const track of [activeTracks.english, activeTracks.chinese]) {
      for (const index of core.segmentIndexesNear(track.segments, time)) {
        loadSegment(track, index, currentGeneration);
      }
    }

    const englishCue = core.cueAt(activeTracks.english.cues, time);
    const chineseCue = core.cueAt(activeTracks.chinese.cues, time);
    const english = englishCue?.text || "";
    const chinese = chineseCue?.text || "";
    const captionKey = `${english}|${chinese}`;
    if (captionKey !== lastCaptionKey) {
      lastCaptionKey = captionKey;
      post("caption", {
        english,
        chinese,
        globalTime: time,
        clockSource: snapshot.source
      });
    }

    const healthSecond = Math.floor(time / 5);
    if (healthSecond !== lastHealthSecond) {
      lastHealthSecond = healthSecond;
      const englishLoaded = [...activeTracks.english.loaded.keys()].sort((a, b) => a - b);
      const chineseLoaded = [...activeTracks.chinese.loaded.keys()].sort((a, b) => a - b);
      post("health", {
        ready: true,
        globalTime: time,
        displayTime: core.formatClock(time),
        clockSource: snapshot.source,
        playing: snapshot.playing,
        englishTrack: activeTracks.english.name,
        chineseTrack: activeTracks.chinese.name,
        englishCueCount: activeTracks.english.cues.length,
        chineseCueCount: activeTracks.chinese.cues.length,
        englishLoadedSegments: englishLoaded.join(","),
        chineseLoadedSegments: chineseLoaded.join(","),
        englishFirstCueStart: activeTracks.english.cues[0]?.start ?? null,
        englishLastCueEnd: activeTracks.english.cues.at(-1)?.end ?? null,
        chineseFirstCueStart: activeTracks.chinese.cues[0]?.start ?? null,
        chineseLastCueEnd: activeTracks.chinese.cues.at(-1)?.end ?? null,
        englishMatched: Boolean(englishCue),
        chineseMatched: Boolean(chineseCue),
        updatedAt: Date.now()
      });
    }
    requestAnimationFrame(renderFrame);
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window || message?.channel !== CHANNEL || message.sender !== "content-ui") return;
    if (message.type === "settings") {
      const previousChinese = settings.chinese;
      settings = { ...defaults, ...(message.settings || {}) };
      if (previousChinese !== settings.chinese && latestMaster) {
        activeTrackSignature = "";
        activeTracks = null;
        activateMaster(latestMaster.manifestUrl, latestMaster.text);
      }
    } else if (message.type === "status-request") {
      emitStatus(activeTracks ? "ready" : "starting", activeTracks ? "官方双语字幕已就绪" : "正在识别 Disney 字幕轨道");
    }
  });

  installClockObservers();
  inspectExistingResources();
  setTimeout(inspectExistingResources, 1500);
  setInterval(() => {
    if (!activeTracks) inspectExistingResources();
  }, 5000);
  requestAnimationFrame(renderFrame);
  post("adapter-ready", { build: BUILD_VERSION });
})();
