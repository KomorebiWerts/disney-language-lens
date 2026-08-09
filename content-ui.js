(function () {
  "use strict";

  const core = globalThis.DisneyLanguageLensCore;
  const dictionary = globalThis.DisneyLanguageLensDictionary;
  const CHANNEL = "disney-language-lens:v1";
  const BUILD_VERSION = "1.1.1";
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
  let cardModeLabel = null;
  let cardQuery = null;
  let cardModes = null;
  let cardOfficial = null;
  let cardOfficialText = null;
  let cardSource = null;
  let cardRetry = null;
  let hoverTimer = 0;
  let hideTimer = 0;
  let lookupSerial = 0;
  let pinned = false;
  let activeButton = null;
  let activeLookup = null;
  let activeOptions = [];
  let activeOptionIndex = 0;
  let latestHealth = null;
  let latestEnglish = "";
  let latestChinese = "";
  let mountObserver = null;
  let translatorPromise = null;

  const styles = `
    :host {
      all: initial;
      color-scheme: dark;
      --lens-size: 30px;
      --lens-bottom: 12vh;
      --lens-cyan: #78d5e4;
      --lens-amber: #ffe28a;
      --lens-night: #07111f;
      --lens-paper: #f3f7f5;
      --lens-muted: #91a9b6;
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
      font-weight: 700;
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
      color: #eafcff;
      border-bottom-color: var(--lens-cyan);
      text-shadow: 0 0 8px rgba(120,213,228,.48), 0 2px 3px #000;
      outline: none;
    }
    .stage[data-hover="false"] .word { pointer-events: none; cursor: default; }
    .stage[data-hover="false"] .word:hover { color: inherit; border-bottom-color: transparent; }
    .card {
      position: fixed;
      width: min(438px, calc(100vw - 24px));
      left: 12px;
      bottom: 180px;
      pointer-events: auto;
      overflow: hidden;
      color: var(--lens-paper);
      background: rgba(7,17,31,.985);
      border: 1px solid rgba(120,213,228,.30);
      border-radius: 16px;
      box-shadow: 0 22px 58px rgba(0,0,0,.58), 0 1px 0 rgba(255,255,255,.045) inset;
      opacity: 1;
      transform: translateY(0) scale(1);
      transition: opacity 120ms ease, transform 120ms ease;
      backdrop-filter: blur(18px) saturate(112%);
    }
    .card[hidden] { display: none; }
    .card.is-entering { opacity: 0; transform: translateY(5px) scale(.985); }
    .film-edge {
      height: 8px;
      background:
        repeating-linear-gradient(90deg, transparent 0 13px, rgba(120,213,228,.68) 13px 19px, transparent 19px 29px),
        linear-gradient(90deg, rgba(120,213,228,.13), rgba(255,226,138,.10));
      border-bottom: 1px solid rgba(255,255,255,.05);
    }
    .card-body { padding: 15px 17px 14px; }
    .context-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .context-label {
      color: var(--lens-cyan);
      font: 700 10px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace;
      letter-spacing: .12em;
    }
    .timecode { color: #6f8794; font: 10px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace; }
    .context-query {
      margin-top: 7px;
      color: #b9d0d9;
      font: 600 15px/1.35 "Bahnschrift SemiCondensed", "Segoe UI", sans-serif;
      letter-spacing: .012em;
      overflow-wrap: anywhere;
    }
    .translation-row { display: flex; align-items: flex-start; gap: 9px; margin-top: 7px; }
    .chinese-meaning { color: var(--lens-amber); font-size: 23px; font-weight: 760; line-height: 1.28; }
    .official-reference {
      margin-top: 10px;
      padding: 8px 10px 9px;
      color: #a9bbc4;
      background: rgba(255,255,255,.035);
      border-left: 2px solid rgba(255,226,138,.58);
      font-size: 11px;
      line-height: 1.42;
    }
    .official-reference[hidden] { display: none; }
    .official-reference strong {
      display: block;
      margin-bottom: 2px;
      color: #728d9a;
      font: 700 9px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace;
      letter-spacing: .08em;
    }
    .lookup-modes {
      display: flex;
      gap: 3px;
      margin-top: 11px;
      padding-bottom: 1px;
      border-bottom: 1px solid rgba(255,255,255,.07);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .lookup-modes::-webkit-scrollbar { display: none; }
    .mode-button {
      all: unset;
      position: relative;
      flex: 0 0 auto;
      padding: 6px 8px 7px;
      color: #7893a0;
      cursor: pointer;
      font: 700 10px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace;
    }
    .mode-button:hover, .mode-button:focus-visible { color: #cae2e8; outline: none; }
    .mode-button[data-active="true"] { color: var(--lens-cyan); }
    .mode-button[data-active="true"]::after {
      content: "";
      position: absolute;
      left: 7px;
      right: 7px;
      bottom: -2px;
      height: 2px;
      background: var(--lens-cyan);
    }
    .word-panel { padding-top: 12px; }
    .card-head { display: flex; align-items: flex-start; gap: 10px; }
    .word-block { min-width: 0; flex: 1; }
    .card-word {
      font: 720 20px/1.08 "Bahnschrift SemiCondensed", "Segoe UI", sans-serif;
      line-height: 1.05;
      letter-spacing: .005em;
      overflow-wrap: anywhere;
    }
    .phonetic {
      margin-top: 4px;
      color: #88a5b2;
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
      background: rgba(120,213,228,.08);
      border: 1px solid rgba(120,213,228,.22);
      cursor: pointer;
      font: 17px/1 "Segoe UI Symbol", sans-serif;
    }
    .speak:hover, .speak:focus-visible { background: rgba(120,213,228,.16); outline: 2px solid rgba(120,213,228,.28); }
    .part {
      display: inline-block;
      margin-top: 7px;
      color: #8ca7b3;
      border-left: 2px solid rgba(120,213,228,.42);
      padding-left: 7px;
      font: 10px/1.35 ui-monospace, "Cascadia Mono", Consolas, monospace;
      text-transform: uppercase;
    }
    .definition { margin-top: 8px; color: #d8e4e8; font-size: 12.5px; line-height: 1.48; }
    .definition[hidden], .example[hidden], .part[hidden], .retry[hidden] { display: none; }
    .example { margin-top: 7px; color: #8fa7b4; font-size: 12px; font-style: italic; line-height: 1.4; }
    .card-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-top: 11px;
      padding-top: 9px;
      border-top: 1px solid rgba(255,255,255,.07);
      color: #6f8a99;
      font: 10px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace;
    }
    .source-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; margin-right: 6px; background: var(--lens-cyan); }
    .retry {
      all: unset;
      margin-top: 10px;
      padding: 7px 10px;
      color: #dff8fc;
      border: 1px solid rgba(120,213,228,.26);
      background: rgba(120,213,228,.08);
      cursor: pointer;
      font-size: 11px;
    }
    .retry:hover, .retry:focus-visible { background: rgba(120,213,228,.15); outline: 2px solid rgba(120,213,228,.24); }
    .card.network-error .chinese-meaning { color: #ffcf8a; font-size: 18px; }
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
      .card { width: min(376px, calc(100vw - 18px)); }
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
    wordCard.setAttribute("aria-label", "英文语境和短语解释");
    const filmEdge = createElement("div", "film-edge");
    const body = createElement("div", "card-body");
    const contextHead = createElement("div", "context-head");
    cardModeLabel = createElement("span", "context-label", "语境释义");
    cardTime = createElement("span", "timecode", "--:--");
    contextHead.append(cardModeLabel, cardTime);
    cardQuery = createElement("div", "context-query");
    const translationRow = createElement("div", "translation-row");
    cardChinese = createElement("div", "chinese-meaning");
    translationRow.append(cardChinese);
    cardOfficial = createElement("div", "official-reference");
    const officialLabel = createElement("strong", "", "DISNEY 官方字幕参考");
    cardOfficialText = createElement("span", "official-text");
    cardOfficial.append(officialLabel, cardOfficialText);
    cardModes = createElement("div", "lookup-modes");

    const wordPanel = createElement("div", "word-panel");
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
    cardPart = createElement("span", "part");
    cardDefinition = createElement("div", "definition");
    cardExample = createElement("div", "example");
    cardRetry = createElement("button", "retry", "重新连接并翻译");
    cardRetry.type = "button";
    cardRetry.hidden = true;
    wordPanel.append(head, cardPart, cardDefinition, cardExample, cardRetry);

    const foot = createElement("div", "card-foot");
    cardSource = createElement("span", "source", "语境翻译");
    const dot = createElement("span", "source-dot");
    cardSource.prepend(dot);
    const pinHint = createElement("span", "pin-hint", "点击字幕单词可固定");
    foot.append(cardSource, pinHint);
    body.append(contextHead, cardQuery, translationRow, cardOfficial, cardModes, wordPanel, foot);
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
    cardModes.addEventListener("click", onModeClick);
    cardRetry.addEventListener("click", retryActiveLookup);
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
    let wordIndex = 0;
    for (const token of tokens) {
      if (token.type === "text") {
        englishLine.append(document.createTextNode(token.text));
      } else {
        const button = createElement("button", "word", token.text);
        button.type = "button";
        button.dataset.lookup = token.lookup;
        button.dataset.wordIndex = String(wordIndex);
        button.setAttribute("aria-label", `解释 ${token.text} 在当前语境中的含义`);
        englishLine.append(button);
        wordIndex += 1;
      }
    }
  }

  function renderCaption(message) {
    ensureUi();
    const english = message.english || "";
    const chinese = message.chinese || "";
    latestEnglish = english;
    latestChinese = chinese;
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
    wordCard.classList.remove("loading", "is-entering", "network-error");
    activeButton?.removeAttribute("data-active");
    activeButton = null;
    activeLookup = null;
    activeOptions = [];
    activeOptionIndex = 0;
    pinned = false;
  }

  function positionCard(button) {
    const rect = button.getBoundingClientRect();
    const cardWidth = Math.min(438, window.innerWidth - 24);
    const left = Math.max(12, Math.min(window.innerWidth - cardWidth - 12, rect.left + rect.width / 2 - cardWidth / 2));
    const preferredBottom = Math.max(12, window.innerHeight - rect.top + 13);
    const cardHeight = Math.max(240, wordCard.getBoundingClientRect().height || 0);
    const bottom = Math.max(12, Math.min(preferredBottom, window.innerHeight - cardHeight - 12));
    wordCard.style.left = `${left}px`;
    wordCard.style.bottom = `${bottom}px`;
  }

  function modeLabel(option) {
    if (option?.mode === "phrase") return "短语释义";
    if (option?.mode === "word") return "单词释义";
    return "语境释义";
  }

  function renderModeButtons(options, selectedIndex) {
    cardModes.replaceChildren();
    options.forEach((option, index) => {
      const button = createElement(
        "button",
        "mode-button",
        option.mode === "phrase" ? option.text : option.label
      );
      button.type = "button";
      button.dataset.optionIndex = String(index);
      button.dataset.active = String(index === selectedIndex);
      button.title = `${option.label}：${option.text}`;
      button.setAttribute("aria-label", `切换到${option.label}释义：${option.text}`);
      cardModes.append(button);
    });
    cardModes.hidden = options.length < 2;
  }

  function setOfficialReference(visible) {
    const show = Boolean(visible && latestChinese);
    cardOfficial.hidden = !show;
    cardOfficialText.textContent = show ? latestChinese : "";
  }

  function setLoading(word, option, options) {
    wordCard.classList.add("loading");
    wordCard.classList.remove("network-error");
    cardModeLabel.textContent = modeLabel(option);
    cardQuery.textContent = option.text;
    cardWord.textContent = word;
    cardPhonetic.textContent = "正在匹配发音与词义";
    cardChinese.textContent = "正在结合当前台词翻译";
    cardPart.textContent = "";
    cardPart.hidden = true;
    cardDefinition.textContent = "正在选择符合当前语境的词典义";
    cardDefinition.hidden = false;
    cardExample.textContent = "";
    cardExample.hidden = true;
    cardRetry.hidden = true;
    cardSpeak.disabled = true;
    cardTime.textContent = latestHealth?.displayTime || "--:--";
    cardSource.lastChild.textContent = " 正在分析语境";
    setOfficialReference(true);
    renderModeButtons(options, activeOptionIndex);
  }

  function renderLookup(result) {
    wordCard.classList.remove("loading", "network-error");
    activeLookup = result;
    cardModeLabel.textContent = modeLabel(result);
    cardQuery.textContent = result.query;
    cardWord.textContent = activeButton?.textContent || result.word;
    cardPhonetic.textContent = result.phonetic || "";
    cardChinese.textContent = result.chinese;
    cardPart.textContent = result.partOfSpeech || "";
    cardPart.hidden = !result.partOfSpeech;
    cardDefinition.textContent = result.definition || "";
    cardDefinition.hidden = !result.definition;
    cardExample.textContent = result.example ? `“${result.example}”` : "";
    cardExample.hidden = !result.example;
    cardRetry.hidden = true;
    cardSpeak.disabled = false;
    setOfficialReference(result.translationSource !== "disney-official");
    const sourceLabels = {
      "browser-local": "浏览器本地语境翻译",
      "google-context": "在线语境翻译",
      "disney-official": "Disney 官方字幕语境"
    };
    cardSource.lastChild.textContent = ` ${sourceLabels[result.translationSource] || "语境翻译"}${result.cached ? " · 本机缓存" : ""}`;
  }

  function renderLookupError(word, option, message) {
    wordCard.classList.remove("loading");
    wordCard.classList.add("network-error");
    activeLookup = { word, query: option?.text || word, audio: "" };
    cardModeLabel.textContent = "连接状态";
    cardQuery.textContent = option?.text || word;
    cardWord.textContent = word;
    cardPhonetic.textContent = "";
    cardChinese.textContent = /连接|网络|fetch|Failed/i.test(message || "")
      ? "翻译网络暂时未连接"
      : (message || "翻译请求未完成");
    cardPart.hidden = true;
    cardDefinition.textContent = latestChinese
      ? "已保留 Disney 官方中文字幕作为当前语境参考。"
      : "恢复网络后点击下方按钮即可重试。";
    cardDefinition.hidden = false;
    cardExample.hidden = true;
    cardRetry.hidden = false;
    cardSpeak.disabled = false;
    cardSource.lastChild.textContent = " 连接失败 · 未缓存错误结果";
    setOfficialReference(true);
  }

  function cleanChinese(value) {
    if (typeof dictionary?.cleanTranslation === "function") return dictionary.cleanTranslation(value);
    const text = String(value || "").trim();
    return /[\u3400-\u9fff]/u.test(text) && !/(?:https?:\/\/|www\.)/i.test(text) ? text : "";
  }

  async function browserTranslator(allowDownload) {
    const TranslatorApi = globalThis.Translator;
    if (!TranslatorApi?.availability || !TranslatorApi?.create) return null;
    const targetLanguage = settings.chinese === "zh-Hant" ? "zh-Hant" : "zh";
    const availability = await TranslatorApi.availability({ sourceLanguage: "en", targetLanguage });
    chrome.storage.local.set({
      languageLensTranslatorHealth: {
        version: BUILD_VERSION,
        availability,
        targetLanguage,
        updatedAt: Date.now()
      }
    }).catch(() => {});
    if (availability === "unavailable" || (availability !== "available" && !allowDownload)) return null;
    if (!translatorPromise || translatorPromise.targetLanguage !== targetLanguage) {
      const pending = TranslatorApi.create({
        sourceLanguage: "en",
        targetLanguage,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            chrome.storage.local.set({
              languageLensTranslatorHealth: {
                version: BUILD_VERSION,
                availability: "downloading",
                targetLanguage,
                progress: Number(event.loaded) || 0,
                updatedAt: Date.now()
              }
            }).catch(() => {});
          });
        }
      }).catch((error) => {
        translatorPromise = null;
        throw error;
      });
      pending.targetLanguage = targetLanguage;
      translatorPromise = pending;
    }
    return translatorPromise;
  }

  async function translateInBrowser(text, allowDownload) {
    try {
      const translator = await browserTranslator(allowDownload);
      if (!translator) return "";
      return cleanChinese(await translator.translate(text));
    } catch (_) {
      return "";
    }
  }

  function within(promise, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) resolve("");
      }, timeoutMs);
      promise.then((value) => {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, () => {
        settled = true;
        clearTimeout(timer);
        resolve("");
      });
    });
  }

  function onModeClick(event) {
    const button = event.target.closest?.("button.mode-button");
    if (!button || !activeButton) return;
    const index = Number(button.dataset.optionIndex);
    if (!Number.isInteger(index) || index === activeOptionIndex) return;
    pinned = true;
    openWord(activeButton, true, index);
  }

  function retryActiveLookup(event) {
    event?.stopPropagation();
    if (!activeButton) return;
    pinned = true;
    openWord(activeButton, true, activeOptionIndex);
  }

  async function openWord(button, pin, requestedOptionIndex = null) {
    if (!button?.isConnected || !settings.hoverEnabled) return;
    clearTimeout(hoverTimer);
    cancelHide();
    if (pin) pinned = true;
    activeButton?.removeAttribute("data-active");
    activeButton = button;
    activeButton.dataset.active = "true";
    const word = button.dataset.lookup;
    const options = typeof core?.buildLookupOptions === "function"
      ? core.buildLookupOptions(latestEnglish, Number(button.dataset.wordIndex))
      : [{ mode: "word", label: "单词", text: button.textContent || word, partHint: "" }];
    activeOptions = options.length ? options : [{ mode: "word", label: "单词", text: button.textContent || word, partHint: "" }];
    activeOptionIndex = Number.isInteger(requestedOptionIndex) && activeOptions[requestedOptionIndex]
      ? requestedOptionIndex
      : 0;
    const option = activeOptions[activeOptionIndex];
    const serial = ++lookupSerial;
    setLoading(button.textContent || word, option, activeOptions);
    wordCard.hidden = false;
    wordCard.classList.add("is-entering");
    positionCard(button);
    requestAnimationFrame(() => wordCard.classList.remove("is-entering"));
    try {
      const browserTranslation = await within(
        translateInBrowser(option.text, Boolean(pin)),
        pin ? 1100 : 420
      );
      if (serial !== lookupSerial || activeButton !== button) return;
      const response = await chrome.runtime.sendMessage({
        type: "lookup-context",
        word,
        query: option.text,
        mode: option.mode,
        partHint: option.partHint,
        officialChinese: latestChinese,
        browserTranslation,
        targetLanguage: settings.chinese
      });
      if (serial !== lookupSerial || activeButton !== button) return;
      if (!response?.ok) throw new Error(response?.error || "查询失败");
      renderLookup(response.result);
      positionCard(button);
    } catch (error) {
      if (serial !== lookupSerial || activeButton !== button) return;
      renderLookupError(button.textContent || word, option, error.message);
      positionCard(button);
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
