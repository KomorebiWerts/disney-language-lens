(function () {
  "use strict";

  const core = globalThis.DisneyLanguageLensCore;
  const CHANNEL = "disney-language-lens:v1";
  const BUILD_VERSION = "1.0.3";
  const defaults = {
    enabled: true,
    chinese: "zh-Hans",
    englishFirst: true,
    fontSize: 30,
    bottom: 12,
    hoverEnabled: true
  };

  let settings = { ...defaults };
  let host = null;
  let shadow = null;
  let stage = null;
  let captionStack = null;
  let englishLine = null;
  let chineseLine = null;
  let wordCard = null;
  let cardWord = null;
  let cardChinese = null;
  let cardPhonetic = null;
  let cardPart = null;
  let cardDefinition = null;
  let cardExample = null;
  let cardTime = null;
  let cardSpeak = null;
  let hoverTimer = 0;
  let hideTimer = 0;
  let lookupSerial = 0;
  let pinned = false;
  let activeButton = null;
  let activeLookup = null;
  let latestHealth = null;
  let mountObserver = null;

  const styles = `
    :host {
      all: initial;
      color-scheme: dark;
      --lens-size: 30px;
      --lens-bottom: 12vh;
      --lens-cyan: #62d5e8;
      --lens-amber: #ffe68a;
      --lens-night: #07101f;
      --lens-ink: #0b162b;
      font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; }
    .stage {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      contain: layout style;
    }
    .captions {
      position: absolute;
      left: 4vw;
      right: 4vw;
      bottom: var(--lens-bottom);
      display: flex;
      flex-direction: column;
      gap: 3px;
      align-items: center;
      text-align: center;
      font-size: var(--lens-size);
      font-weight: 680;
      line-height: 1.24;
      letter-spacing: 0.003em;
      text-shadow: 0 2px 3px rgba(0,0,0,.98), 0 0 7px rgba(0,0,0,.94), 0 0 18px rgba(0,0,0,.72);
      white-space: pre-line;
      transition: opacity 120ms ease;
    }
    .captions[hidden] { display: none; }
    .line {
      max-width: min(92vw, 1500px);
      width: fit-content;
      min-height: 1.24em;
      pointer-events: none;
    }
    .english { color: #fff; }
    .chinese { color: var(--lens-amber); }
    .word {
      all: unset;
      display: inline;
      color: inherit;
      font: inherit;
      letter-spacing: inherit;
      pointer-events: auto;
      cursor: help;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: color 100ms ease, border-color 100ms ease, text-shadow 100ms ease;
    }
    .word:hover, .word:focus-visible, .word[data-active="true"] {
      color: #e8fbff;
      border-bottom-color: var(--lens-cyan);
      text-shadow: 0 0 10px rgba(98,213,232,.7), 0 2px 3px #000;
      outline: none;
    }
    .stage[data-hover="false"] .word { pointer-events: none; cursor: default; }
    .stage[data-hover="false"] .word:hover { color: inherit; border-bottom-color: transparent; }
    .card {
      position: fixed;
      width: min(358px, calc(100vw - 24px));
      left: 12px;
      bottom: 180px;
      pointer-events: auto;
      overflow: hidden;
      color: #f7fbff;
      background: linear-gradient(145deg, rgba(12,29,54,.98), rgba(5,13,27,.985));
      border: 1px solid rgba(98,213,232,.34);
      border-radius: 14px;
      box-shadow: 0 18px 48px rgba(0,0,0,.56), 0 0 0 1px rgba(255,255,255,.035) inset;
      opacity: 1;
      transform: translateY(0) scale(1);
      transition: opacity 120ms ease, transform 120ms ease;
      backdrop-filter: blur(18px) saturate(125%);
    }
    .card[hidden] { display: none; }
    .card.is-entering { opacity: 0; transform: translateY(5px) scale(.985); }
    .film-edge {
      height: 7px;
      background:
        repeating-linear-gradient(90deg, transparent 0 10px, rgba(98,213,232,.72) 10px 16px, transparent 16px 25px),
        linear-gradient(90deg, rgba(98,213,232,.18), rgba(255,230,138,.16));
      border-bottom: 1px solid rgba(255,255,255,.05);
    }
    .card-body { padding: 15px 16px 13px; }
    .card-head { display: flex; align-items: flex-start; gap: 10px; }
    .word-block { min-width: 0; flex: 1; }
    .card-word {
      font-size: 24px;
      font-weight: 720;
      line-height: 1.05;
      letter-spacing: -.015em;
      overflow-wrap: anywhere;
    }
    .phonetic {
      margin-top: 5px;
      color: #a9c9d4;
      font: 12px/1.25 ui-monospace, "Cascadia Mono", Consolas, monospace;
    }
    .speak {
      all: unset;
      width: 34px;
      height: 34px;
      flex: 0 0 34px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: var(--lens-cyan);
      background: rgba(98,213,232,.10);
      border: 1px solid rgba(98,213,232,.24);
      cursor: pointer;
      font: 17px/1 "Segoe UI Symbol", sans-serif;
    }
    .speak:hover, .speak:focus-visible { background: rgba(98,213,232,.19); outline: 2px solid rgba(98,213,232,.34); }
    .translation-row { display: flex; align-items: baseline; gap: 9px; margin-top: 13px; }
    .chinese-meaning { color: var(--lens-amber); font-size: 19px; font-weight: 700; line-height: 1.25; }
    .part {
      color: #8fb2c1;
      background: rgba(143,178,193,.10);
      border: 1px solid rgba(143,178,193,.14);
      border-radius: 999px;
      padding: 2px 7px;
      font: 10px/1.35 ui-monospace, "Cascadia Mono", Consolas, monospace;
      text-transform: uppercase;
    }
    .definition { margin-top: 10px; color: #e3edf2; font-size: 13px; line-height: 1.45; }
    .example { margin-top: 7px; color: #8fa7b4; font-size: 12px; font-style: italic; line-height: 1.4; }
    .card-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-top: 12px;
      padding-top: 9px;
      border-top: 1px solid rgba(255,255,255,.07);
      color: #6f8a99;
      font: 10px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace;
    }
    .source-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; margin-right: 5px; background: var(--lens-cyan); box-shadow: 0 0 7px rgba(98,213,232,.8); }
    .loading .chinese-meaning, .loading .definition {
      color: transparent;
      border-radius: 5px;
      background: linear-gradient(90deg, rgba(255,255,255,.06), rgba(255,255,255,.14), rgba(255,255,255,.06));
      background-size: 200% 100%;
      animation: sweep 1.1s linear infinite;
    }
    @keyframes sweep { to { background-position: -200% 0; } }
    @media (max-width: 700px) {
      .captions { left: 2.5vw; right: 2.5vw; }
      .card { width: min(330px, calc(100vw - 18px)); }
    }
    @media (prefers-reduced-motion: reduce) {
      .card, .word { transition: none; }
      .loading .chinese-meaning, .loading .definition { animation: none; }
    }
  `;

  function createElement(tag, className, text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function ensureUi() {
    if (host) {
      if (!host.isConnected) mountUi();
      return;
    }
    document.getElementById("disney-official-dual-subtitles")?.remove();
    host = document.createElement("div");
    host.id = "disney-language-lens-root";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = styles;
    stage = createElement("div", "stage");
    stage.dataset.hover = String(settings.hoverEnabled);
    captionStack = createElement("div", "captions");
    captionStack.hidden = true;
    englishLine = createElement("div", "line english");
    chineseLine = createElement("div", "line chinese");
    captionStack.append(englishLine, chineseLine);

    wordCard = createElement("section", "card");
    wordCard.hidden = true;
    wordCard.setAttribute("role", "dialog");
    wordCard.setAttribute("aria-label", "英文单词解释");
    const filmEdge = createElement("div", "film-edge");
    const body = createElement("div", "card-body");
    const head = createElement("div", "card-head");
    const wordBlock = createElement("div", "word-block");
    cardWord = createElement("div", "card-word");
    cardPhonetic = createElement("div", "phonetic");
    wordBlock.append(cardWord, cardPhonetic);
    cardSpeak = createElement("button", "speak", "▶");
    cardSpeak.type = "button";
    cardSpeak.title = "朗读单词";
    cardSpeak.setAttribute("aria-label", "朗读单词");
    head.append(wordBlock, cardSpeak);
    const translationRow = createElement("div", "translation-row");
    cardChinese = createElement("div", "chinese-meaning");
    cardPart = createElement("span", "part");
    translationRow.append(cardChinese, cardPart);
    cardDefinition = createElement("div", "definition");
    cardExample = createElement("div", "example");
    const foot = createElement("div", "card-foot");
    const source = createElement("span", "source", "词典查询");
    const dot = createElement("span", "source-dot");
    source.prepend(dot);
    cardTime = createElement("span", "timecode", "--:--");
    foot.append(source, cardTime);
    body.append(head, translationRow, cardDefinition, cardExample, foot);
    wordCard.append(filmEdge, body);
    stage.append(captionStack, wordCard);
    shadow.append(style, stage);
    mountUi();
    installMountGuard();
    applySettings();

    englishLine.addEventListener("pointerover", onWordOver);
    englishLine.addEventListener("pointerout", onWordOut);
    englishLine.addEventListener("focusin", onWordOver);
    englishLine.addEventListener("focusout", onWordOut);
    englishLine.addEventListener("click", onWordClick);
    wordCard.addEventListener("pointerenter", cancelHide);
    wordCard.addEventListener("pointerleave", () => {
      if (!pinned) scheduleHide();
    });
    cardSpeak.addEventListener("click", speakActiveWord);
  }

  function mountUi() {
    if (!host) return;
    const parent = document.fullscreenElement || document.body || document.documentElement;
    if (parent && host.parentNode !== parent) parent.appendChild(host);
  }

  function installMountGuard() {
    if (mountObserver || !document.documentElement) return;
    mountObserver = new MutationObserver(() => {
      if (host && !host.isConnected) mountUi();
    });
    mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function applySettings() {
    if (!host) return;
    host.style.setProperty("--lens-size", `${Math.max(20, Math.min(54, Number(settings.fontSize) || 30))}px`);
    host.style.setProperty("--lens-bottom", `${Math.max(5, Math.min(30, Number(settings.bottom) || 12))}vh`);
    stage.dataset.hover = String(Boolean(settings.hoverEnabled));
    englishLine.style.order = settings.englishFirst ? "1" : "2";
    chineseLine.style.order = settings.englishFirst ? "2" : "1";
    if (!settings.enabled) {
      captionStack.hidden = true;
      hideCard(true);
    }
  }

  function renderEnglish(text) {
    englishLine.replaceChildren();
    const source = String(text || "");
    const fallbackTokens = () => {
      const tokens = [];
      const pattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
      let cursor = 0;
      let match;
      while ((match = pattern.exec(source))) {
        if (match.index > cursor) tokens.push({ type: "text", text: source.slice(cursor, match.index) });
        tokens.push({ type: "word", text: match[0], lookup: match[0].toLowerCase().replace(/’/g, "'") });
        cursor = match.index + match[0].length;
      }
      if (cursor < source.length) tokens.push({ type: "text", text: source.slice(cursor) });
      return tokens;
    };
    const tokens = typeof core?.tokenizeEnglish === "function"
      ? core.tokenizeEnglish(source)
      : fallbackTokens();
    for (const token of tokens) {
      if (token.type === "text") {
        englishLine.append(document.createTextNode(token.text));
      } else {
        const button = createElement("button", "word", token.text);
        button.type = "button";
        button.dataset.lookup = token.lookup;
        button.setAttribute("aria-label", `解释英文单词 ${token.text}`);
        englishLine.append(button);
      }
    }
  }

  function renderCaption(message) {
    ensureUi();
    const english = message.english || "";
    const chinese = message.chinese || "";
    if (!settings.enabled || (!english && !chinese)) {
      captionStack.hidden = true;
      hideCard(true);
      persistRenderHealth(english, chinese);
      return;
    }
    renderEnglish(english);
    chineseLine.textContent = chinese;
    captionStack.hidden = false;
    if (activeButton && !activeButton.isConnected) hideCard(true);
    persistRenderHealth(english, chinese);
  }

  function persistRenderHealth(english, chinese) {
    requestAnimationFrame(() => {
      if (!captionStack) return;
      const rect = captionStack.getBoundingClientRect();
      const computed = getComputedStyle(captionStack);
      chrome.storage.local.set({
        languageLensRenderHealth: {
          version: BUILD_VERSION,
          enabled: Boolean(settings.enabled),
          englishLength: english.length,
          chineseLength: chinese.length,
          rootConnected: Boolean(host?.isConnected),
          hidden: Boolean(captionStack.hidden),
          display: computed.display,
          visibility: computed.visibility,
          opacity: computed.opacity,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          updatedAt: Date.now()
        }
      }).catch(() => {});
    });
  }

  function onWordOver(event) {
    if (!settings.hoverEnabled) return;
    const button = event.target.closest?.("button.word");
    if (!button) return;
    cancelHide();
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openWord(button, false), 130);
  }

  function onWordOut(event) {
    if (pinned) return;
    const next = event.relatedTarget;
    if (next && (englishLine.contains(next) || wordCard.contains(next))) return;
    clearTimeout(hoverTimer);
    scheduleHide();
  }

  function onWordClick(event) {
    if (!settings.hoverEnabled) return;
    const button = event.target.closest?.("button.word");
    if (!button) return;
    event.preventDefault();
    const same = activeButton === button && pinned;
    pinned = !same;
    if (same) hideCard(true);
    else openWord(button, true);
  }

  function cancelHide() {
    clearTimeout(hideTimer);
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hideCard(false), 170);
  }

  function hideCard(force) {
    if (!wordCard || (!force && pinned)) return;
    clearTimeout(hoverTimer);
    clearTimeout(hideTimer);
    wordCard.hidden = true;
    wordCard.classList.remove("loading", "is-entering");
    activeButton?.removeAttribute("data-active");
    activeButton = null;
    activeLookup = null;
    pinned = false;
  }

  function positionCard(button) {
    const rect = button.getBoundingClientRect();
    const cardWidth = Math.min(358, window.innerWidth - 24);
    const left = Math.max(12, Math.min(window.innerWidth - cardWidth - 12, rect.left + rect.width / 2 - cardWidth / 2));
    const bottom = Math.max(12, window.innerHeight - rect.top + 13);
    wordCard.style.left = `${left}px`;
    wordCard.style.bottom = `${bottom}px`;
  }

  function setLoading(word) {
    wordCard.classList.add("loading");
    cardWord.textContent = word;
    cardPhonetic.textContent = "正在查询…";
    cardChinese.textContent = "正在查找中文释义";
    cardPart.textContent = "";
    cardPart.hidden = true;
    cardDefinition.textContent = "正在读取英文词典释义";
    cardExample.textContent = "";
    cardExample.hidden = true;
    cardSpeak.disabled = true;
    cardTime.textContent = latestHealth?.displayTime || "--:--";
  }

  function renderLookup(result) {
    wordCard.classList.remove("loading");
    activeLookup = result;
    cardWord.textContent = result.word;
    cardPhonetic.textContent = result.phonetic || "暂无音标";
    cardChinese.textContent = result.chinese || "暂无中文释义";
    cardPart.textContent = result.partOfSpeech || "";
    cardPart.hidden = !result.partOfSpeech;
    cardDefinition.textContent = result.definition || "英文词典暂无释义。";
    cardExample.textContent = result.example ? `“${result.example}”` : "";
    cardExample.hidden = !result.example;
    cardSpeak.disabled = false;
  }

  function renderLookupError(word, message) {
    wordCard.classList.remove("loading");
    activeLookup = { word, audio: "" };
    cardWord.textContent = word;
    cardPhonetic.textContent = "";
    cardChinese.textContent = message || "暂时没有查到";
    cardPart.hidden = true;
    cardDefinition.textContent = "仍可点击右上角按钮朗读这个单词。";
    cardExample.hidden = true;
    cardSpeak.disabled = false;
  }

  async function openWord(button, pin) {
    if (!button?.isConnected || !settings.hoverEnabled) return;
    clearTimeout(hoverTimer);
    cancelHide();
    if (pin) pinned = true;
    activeButton?.removeAttribute("data-active");
    activeButton = button;
    activeButton.dataset.active = "true";
    const word = button.dataset.lookup;
    const serial = ++lookupSerial;
    setLoading(button.textContent || word);
    wordCard.hidden = false;
    wordCard.classList.add("is-entering");
    positionCard(button);
    requestAnimationFrame(() => wordCard.classList.remove("is-entering"));
    try {
      const response = await chrome.runtime.sendMessage({ type: "lookup-word", word });
      if (serial !== lookupSerial || activeButton !== button) return;
      if (!response?.ok) throw new Error(response?.error || "查询失败");
      renderLookup(response.result);
    } catch (error) {
      if (serial !== lookupSerial || activeButton !== button) return;
      renderLookupError(button.textContent || word, error.message);
    }
  }

  function speechFallback(word) {
    if (!word || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
  }

  async function speakActiveWord(event) {
    event?.stopPropagation();
    const word = activeLookup?.word || activeButton?.dataset.lookup;
    if (!word) return;
    if (activeLookup?.audio) {
      try {
        const audio = new Audio(activeLookup.audio);
        await audio.play();
        return;
      } catch (_) {}
    }
    speechFallback(word);
  }

  function sendSettings() {
    window.postMessage({
      channel: CHANNEL,
      sender: "content-ui",
      type: "settings",
      settings
    }, "*");
  }

  function requestStatus() {
    window.postMessage({
      channel: CHANNEL,
      sender: "content-ui",
      type: "status-request"
    }, "*");
  }

  function persistStatus(message) {
    chrome.storage.local.set({
      languageLensLastStatus: {
        ...message,
        pageTitle: document.title,
        pageUrl: location.href,
        receivedAt: Date.now()
      }
    }).catch(() => {});
  }

  function persistUiError(error, message) {
    chrome.storage.local.set({
      languageLensUiError: {
        version: BUILD_VERSION,
        operation: message?.type || "unknown",
        englishLength: String(message?.english || "").length,
        chineseLength: String(message?.chinese || "").length,
        error: error?.message || String(error),
        updatedAt: Date.now()
      }
    }).catch(() => {});
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window || message?.channel !== CHANNEL || message.sender !== "page-adapter") return;
    if (message.type === "caption") {
      try {
        renderCaption(message);
      } catch (error) {
        persistUiError(error, message);
      }
    } else if (message.type === "health") {
      latestHealth = message;
      if (wordCard && !wordCard.hidden) cardTime.textContent = message.displayTime || "--:--";
      persistStatus(message);
    } else if (message.type === "status") {
      persistStatus(message);
    } else if (message.type === "adapter-ready") {
      sendSettings();
      requestStatus();
    }
  });

  chrome.storage.sync.get(defaults).then((stored) => {
    settings = { ...defaults, ...stored };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        ensureUi();
        sendSettings();
        requestStatus();
      }, { once: true });
    } else {
      ensureUi();
      sendSettings();
      requestStatus();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    chrome.storage.sync.get(defaults).then((stored) => {
      settings = { ...defaults, ...stored };
      ensureUi();
      applySettings();
      sendSettings();
    });
  });
  document.addEventListener("fullscreenchange", mountUi);
})();
