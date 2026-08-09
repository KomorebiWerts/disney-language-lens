importScripts("dictionary-core.js");

const dictionary = globalThis.DisneyLanguageLensDictionary;
const CACHE_PREFIX = "language-lens:v2:";
const CACHE_INDEX_KEY = "language-lens:v2:index";
const CACHE_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 350;

async function fetchJson(url, cache = "no-store") {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchEnglishEntry(candidates, preferredPartOfSpeech = "") {
  for (const candidate of candidates) {
    try {
      const payload = await fetchJson(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(candidate)}`,
        "force-cache"
      );
      const parsed = dictionary.parseDictionaryResponse(payload, preferredPartOfSpeech);
      if (parsed.definition || parsed.phonetic || parsed.audio) {
        return { ...parsed, dictionaryWord: candidate };
      }
    } catch (_) {
      // Inflected forms frequently return 404. Try the next conservative stem.
    }
  }
  return { phonetic: "", audio: "", partOfSpeech: "", definition: "", example: "", dictionaryWord: "" };
}

function normalizeQuery(value, fallback) {
  const query = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return /[a-z]/i.test(query) ? query : fallback;
}

function targetCode(value) {
  return value === "zh-Hant" ? "zh-TW" : "zh-CN";
}

async function fetchGoogleTranslation(query, targetLanguage) {
  try {
    const payload = await fetchJson(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(targetCode(targetLanguage))}&dt=t&q=${encodeURIComponent(query)}`
    );
    return dictionary.parseGoogleTranslationResponse(payload);
  } catch (_) {
    return "";
  }
}

function cacheIdentity({ word, query, partHint, targetLanguage }) {
  return `${targetLanguage}|${word}|${partHint}|${query}`.toLowerCase();
}

function cacheKey(identity) {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${CACHE_PREFIX}${(hash >>> 0).toString(36)}`;
}

async function getCached(identity) {
  const key = cacheKey(identity);
  const values = await chrome.storage.local.get(key);
  const entry = values[key];
  if (!entry || entry.identity !== identity || Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;
  return { ...entry.result, cached: true };
}

async function putCached(identity, result) {
  const key = cacheKey(identity);
  const values = await chrome.storage.local.get(CACHE_INDEX_KEY);
  const index = Array.isArray(values[CACHE_INDEX_KEY]) ? values[CACHE_INDEX_KEY] : [];
  const nextIndex = index.filter((item) => item.key !== key);
  nextIndex.push({ key, cachedAt: Date.now() });
  const removals = nextIndex.length > MAX_CACHE_ENTRIES
    ? nextIndex.splice(0, nextIndex.length - MAX_CACHE_ENTRIES).map((item) => item.key)
    : [];
  if (removals.length) await chrome.storage.local.remove(removals);
  await chrome.storage.local.set({
    [key]: { cachedAt: Date.now(), identity, result },
    [CACHE_INDEX_KEY]: nextIndex
  });
}

async function lookupContext(input = {}) {
  const candidates = dictionary.lookupCandidates(input.word);
  const word = candidates[0];
  if (!word) throw new Error("不是可查询的英文单词");
  const query = normalizeQuery(input.query, word);
  const partHint = ["noun", "verb", "adjective", "adverb"].includes(input.partHint) ? input.partHint : "";
  const targetLanguage = input.targetLanguage === "zh-Hant" ? "zh-Hant" : "zh-Hans";
  const identity = cacheIdentity({ word, query, partHint, targetLanguage });

  const cached = await getCached(identity);
  if (cached) return cached;

  const browserTranslation = dictionary.cleanTranslation(input.browserTranslation);
  const [english, cloudTranslation] = await Promise.all([
    fetchEnglishEntry(candidates, partHint),
    browserTranslation ? Promise.resolve("") : fetchGoogleTranslation(query, targetLanguage)
  ]);
  const officialChinese = dictionary.cleanTranslation(input.officialChinese);
  const chinese = browserTranslation || cloudTranslation || officialChinese;
  const translationSource = browserTranslation
    ? "browser-local"
    : cloudTranslation
      ? "google-context"
      : officialChinese
        ? "disney-official"
        : "";
  const result = {
    word,
    query,
    mode: ["context", "phrase", "word"].includes(input.mode) ? input.mode : "context",
    dictionaryWord: english.dictionaryWord || word,
    chinese,
    translationSource,
    phonetic: english.phonetic,
    audio: english.audio,
    partOfSpeech: english.partOfSpeech,
    definition: english.definition,
    example: english.example,
    cached: false
  };
  if (!result.chinese) {
    throw new Error("翻译服务暂时未连接，请点击重试");
  }
  if (translationSource !== "disney-official") await putCached(identity, result);
  return result;
}

async function initializeSettings() {
  const settings = await chrome.storage.sync.get({
    enabled: true,
    chinese: "zh-Hans",
    englishFirst: true,
    fontSize: 30,
    bottom: 12,
    hoverEnabled: true
  });
  await chrome.storage.sync.set(settings);
}

async function refreshOpenDisneyTabs(details = {}) {
  const queriedTabs = await chrome.tabs.query({ url: ["https://www.disneyplus.com/*"] });
  const disneyTabs = queriedTabs.filter((tab) =>
    Number.isInteger(tab.id) && (!tab.url || /^https:\/\/www\.disneyplus\.com\//i.test(tab.url))
  );
  const reloadResults = await Promise.allSettled(
    disneyTabs.map((tab) => chrome.tabs.reload(tab.id))
  );
  const reloadedTabIds = [];
  const failedTabIds = [];
  reloadResults.forEach((result, index) => {
    const target = result.status === "fulfilled" ? reloadedTabIds : failedTabIds;
    target.push(disneyTabs[index].id);
  });
  const result = {
    version: chrome.runtime.getManifest().version,
    reason: details.reason || "unknown",
    matchedTabs: disneyTabs.length,
    reloadedTabIds,
    failedTabIds,
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ languageLensAutoRefresh: result });
  return result;
}

chrome.runtime.onInstalled.addListener((details) => {
  return Promise.all([
    initializeSettings(),
    refreshOpenDisneyTabs(details)
  ]);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "refresh-disney-tabs") {
    refreshOpenDisneyTabs({ reason: "manual" })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "刷新失败" }));
    return true;
  }
  if (message?.type === "lookup-context" || message?.type === "lookup-word") {
    lookupContext(message.type === "lookup-word"
      ? { ...message, query: message.word, mode: "word" }
      : message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "查询失败" }));
    return true;
  }
  if (message?.type === "extension-health") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
  }
  return false;
});
