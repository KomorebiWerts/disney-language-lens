(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DisneyLanguageLensDictionary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeLookupWord(value) {
    const match = String(value || "").trim().toLowerCase().replace(/’/g, "'")
      .match(/[a-z]+(?:'[a-z]+)*/);
    return match && match[0] === String(value || "").trim().toLowerCase().replace(/’/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, "")
      ? match[0]
      : "";
  }

  function lookupCandidates(value) {
    const word = normalizeLookupWord(value);
    if (!word) return [];
    const candidates = [word];
    const add = (candidate) => {
      if (candidate.length >= 2 && /^[a-z]+(?:'[a-z]+)*$/.test(candidate) && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    };
    if (word.endsWith("'s")) add(word.slice(0, -2));
    if (word.endsWith("ies") && word.length > 4) add(`${word.slice(0, -3)}y`);
    if (word.endsWith("ing") && word.length > 5) {
      add(word.slice(0, -3));
      add(`${word.slice(0, -3)}e`);
    }
    if (word.endsWith("ed") && word.length > 4) {
      add(word.slice(0, -2));
      add(`${word.slice(0, -2)}e`);
    }
    if (word.endsWith("es") && word.length > 4) add(word.slice(0, -2));
    if (word.endsWith("s") && word.length > 3) add(word.slice(0, -1));
    return candidates.slice(0, 4);
  }

  function normalizeAudioUrl(value) {
    if (!value) return "";
    if (String(value).startsWith("//")) return `https:${value}`;
    return /^https:\/\//i.test(String(value)) ? String(value) : "";
  }

  function parseDictionaryResponse(payload, preferredPartOfSpeech = "") {
    const entries = Array.isArray(payload) ? payload : [];
    for (const entry of entries) {
      const phoneticRecord = (entry.phonetics || []).find((item) => item?.text || item?.audio) || {};
      const meanings = (entry.meanings || []).filter((item) =>
        item?.definitions?.some((definition) => definition?.definition)
      );
      const preferred = String(preferredPartOfSpeech || "").toLowerCase();
      const meaning = meanings.find((item) => String(item.partOfSpeech || "").toLowerCase() === preferred) || meanings[0];
      const definition = meaning?.definitions?.find((item) => item?.definition);
      if (!meaning && !phoneticRecord.text && !entry.phonetic) continue;
      return {
        phonetic: entry.phonetic || phoneticRecord.text || "",
        audio: normalizeAudioUrl(
          (entry.phonetics || []).find((item) => item?.audio)?.audio || phoneticRecord.audio
        ),
        partOfSpeech: meaning?.partOfSpeech || "",
        definition: definition?.definition || "",
        example: definition?.example || ""
      };
    }
    return { phonetic: "", audio: "", partOfSpeech: "", definition: "", example: "" };
  }

  function decodeBasicEntities(value) {
    return String(value || "")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }

  function cleanTranslation(value) {
    const text = decodeBasicEntities(value)
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.length > 500) return "";
    if (/(?:https?:\/\/|www\.|data:|javascript:|ftp:\/\/)/i.test(text)) return "";
    if (/<\/?[a-z][^>]*>/i.test(text)) return "";
    if (/\b(?:error|warning|quota|limit exceeded|invalid request|access denied|not found)\b/i.test(text)) return "";
    if (!/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text)) return "";
    return text;
  }

  function parseTranslationResponse(payload) {
    if (Number(payload?.responseStatus) && Number(payload.responseStatus) !== 200) return "";
    const candidates = [
      payload?.responseData?.translatedText,
      ...(Array.isArray(payload?.matches) ? payload.matches.map((match) => match?.translation) : [])
    ];
    for (const candidate of candidates) {
      const cleaned = cleanTranslation(candidate);
      if (cleaned) return cleaned;
    }
    return "";
  }

  function parseGoogleTranslationResponse(payload) {
    const segments = Array.isArray(payload?.[0]) ? payload[0] : [];
    return cleanTranslation(segments.map((segment) => segment?.[0] || "").join(""));
  }

  return {
    normalizeLookupWord,
    lookupCandidates,
    parseDictionaryResponse,
    cleanTranslation,
    parseTranslationResponse,
    parseGoogleTranslationResponse
  };
});
