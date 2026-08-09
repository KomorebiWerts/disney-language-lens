importScripts("dictionary-core.js");

const dictionary = globalThis.DisneyLanguageLensDictionary;
const CACHE_PREFIX = "dictionary:v1:";
const CACHE_INDEX_KEY = "dictionary:v1:index";
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 350;

async function fetchJson(url) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchEnglishEntry(candidates) {
  for (const candidate of candidates) {
    try {
      const payload = await fetchJson(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(candidate)}`
      );
      const parsed = dictionary.parseDictionaryResponse(payload);
      if (parsed.definition || parsed.phonetic || parsed.audio) {
        return { ...parsed, dictionaryWord: candidate };
      }
    } catch (_) {
      // Inflected forms frequently return 404. Try the next conservative stem.
    }
  }
  return { phonetic: "", audio: "", partOfSpeech: "", definition: "", example: "", dictionaryWord: "" };
}

async function fetchChineseTranslation(word) {
  try {
    const payload = await fetchJson(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en%7Czh-CN`
    );
    return dictionary.parseTranslationResponse(payload);
  } catch (_) {
    return "";
  }
}

async function getCached(word) {
  const key = `${CACHE_PREFIX}${word}`;
  const values = await chrome.storage.local.get(key);
  const entry = values[key];
  if (!entry || Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;
  return { ...entry.result, cached: true };
}

async function putCached(word, result) {
  const key = `${CACHE_PREFIX}${word}`;
  const values = await chrome.storage.local.get(CACHE_INDEX_KEY);
  const index = Array.isArray(values[CACHE_INDEX_KEY]) ? values[CACHE_INDEX_KEY] : [];
  const nextIndex = index.filter((item) => item.key !== key);
  nextIndex.push({ key, cachedAt: Date.now() });
  const removals = nextIndex.length > MAX_CACHE_ENTRIES
    ? nextIndex.splice(0, nextIndex.length - MAX_CACHE_ENTRIES).map((item) => item.key)
    : [];
  if (removals.length) await chrome.storage.local.remove(removals);
  await chrome.storage.local.set({
    [key]: { cachedAt: Date.now(), result },
    [CACHE_INDEX_KEY]: nextIndex
  });
}

async function lookupWord(rawWord) {
  const candidates = dictionary.lookupCandidates(rawWord);
  const word = candidates[0];
  if (!word) throw new Error("不是可查询的英文单词");

  const cached = await getCached(word);
  if (cached) return cached;

  const [english, chinese] = await Promise.all([
    fetchEnglishEntry(candidates),
    fetchChineseTranslation(word)
  ]);
  const result = {
    word,
    dictionaryWord: english.dictionaryWord || word,
    chinese,
    phonetic: english.phonetic,
    audio: english.audio,
    partOfSpeech: english.partOfSpeech,
    definition: english.definition,
    example: english.example,
    cached: false
  };
  if (!result.chinese && !result.definition && !result.phonetic) {
    throw new Error("暂时没有查到这个词");
  }
  await putCached(word, result);
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
  await chrome.storage.local.set({
    languageLensAutoRefresh: {
      version: chrome.runtime.getManifest().version,
      reason: details.reason || "unknown",
      matchedTabs: disneyTabs.length,
      reloadedTabIds,
      failedTabIds,
      updatedAt: Date.now()
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  return Promise.all([
    initializeSettings(),
    refreshOpenDisneyTabs(details)
  ]);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "lookup-word") {
    lookupWord(message.word)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "查询失败" }));
    return true;
  }
  if (message?.type === "extension-health") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
  }
  return false;
});
