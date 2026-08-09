(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DisneyLanguageLensCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function parseAttributeList(line) {
    const colon = line.indexOf(":");
    const source = colon >= 0 ? line.slice(colon + 1) : line;
    const result = {};
    const pattern = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/gi;
    let match;
    while ((match = pattern.exec(source))) {
      const raw = match[2].trim();
      result[match[1].toUpperCase()] = raw.startsWith('"')
        ? raw.slice(1, -1).replace(/\\"/g, '"')
        : raw;
    }
    return result;
  }

  function parseMaster(text, manifestUrl) {
    const tracks = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.startsWith("#EXT-X-MEDIA:")) continue;
      const attrs = parseAttributeList(line);
      if (attrs.TYPE !== "SUBTITLES" || !attrs.URI) continue;
      tracks.push({
        language: attrs.LANGUAGE || "",
        name: attrs.NAME || attrs.LANGUAGE || "Unknown",
        groupId: attrs["GROUP-ID"] || "",
        forced: String(attrs.FORCED).toUpperCase() === "YES",
        default: String(attrs.DEFAULT).toUpperCase() === "YES",
        url: new URL(attrs.URI, manifestUrl).href
      });
    }
    return tracks;
  }

  function chooseTracks(tracks, chinesePreference) {
    const normal = (tracks || []).filter((track) => !track.forced);
    const english = normal.find((track) => /^en(?:-|$)/i.test(track.language)) ||
      normal.find((track) => /english/i.test(track.name));

    const preference = chinesePreference || "zh-Hans";
    const preferredPatterns = preference === "zh-Hant"
      ? [/^zh-Hant$/i, /^zh-(?:TW|HK)$/i, /traditional|繁體|繁体/i]
      : [/^zh-Hans$/i, /^zh-(?:CN|SG)$/i, /simplified|简体|簡體/i];
    let chinese = null;
    for (const pattern of preferredPatterns) {
      chinese = normal.find((track) => pattern.test(track.language) || pattern.test(track.name));
      if (chinese) break;
    }
    chinese ||= normal.find((track) =>
      /^zh(?:-|$)/i.test(track.language) || /chinese|中文/i.test(track.name)
    );
    return { english, chinese };
  }

  function parseMediaPlaylist(text, playlistUrl) {
    const lines = String(text || "").split(/\r?\n/);
    const segments = [];
    let duration = 0;
    let cursor = 0;
    let sequence = 0;
    for (const line of lines) {
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        sequence = Number(line.slice(line.indexOf(":") + 1)) || 0;
      } else if (line.startsWith("#EXTINF:")) {
        duration = Number.parseFloat(line.slice(line.indexOf(":") + 1)) || 0;
      } else if (line && !line.startsWith("#") && duration > 0) {
        segments.push({
          index: sequence + segments.length,
          start: cursor,
          end: cursor + duration,
          duration,
          url: new URL(line.trim(), playlistUrl).href
        });
        cursor += duration;
        duration = 0;
      }
    }
    return segments;
  }

  function parseTimestamp(value) {
    const parts = String(value || "").trim().split(":").map(Number);
    if (!parts.length || parts.some(Number.isNaN)) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  function decodeEntities(text) {
    const named = {
      amp: "&",
      lt: "<",
      gt: ">",
      nbsp: "\u00a0",
      lrm: "\u200e",
      rlm: "\u200f",
      quot: '"',
      apos: "'"
    };
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|nbsp|lrm|rlm|quot|apos);/gi, (entity, code) => {
      if (code[0] !== "#") return named[code.toLowerCase()] || entity;
      const value = code[1].toLowerCase() === "x"
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    });
  }

  function cleanCueText(text) {
    return decodeEntities(
      String(text || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim()
    );
  }

  function parseVttSegment(text, segmentStart, segmentDuration) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    const timestampMap = source.match(/X-TIMESTAMP-MAP\s*=\s*LOCAL:([^,]+),MPEGTS:(\d+)/i);
    let mappedOffset = null;
    if (timestampMap) {
      mappedOffset = Number(timestampMap[2]) / 90000 - parseTimestamp(timestampMap[1]);
    }

    const cues = [];
    for (const block of source.split(/\r?\n\s*\r?\n/)) {
      const lines = block.split(/\r?\n/).filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;
      const timing = lines[timingIndex].match(/([^\s]+)\s*-->\s*([^\s]+)/);
      if (!timing) continue;
      let start = parseTimestamp(timing[1]);
      let end = parseTimestamp(timing[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

      if (mappedOffset !== null) {
        start += mappedOffset;
        end += mappedOffset;
      } else if (segmentStart > 0 && end <= segmentDuration + 2) {
        start += segmentStart;
        end += segmentStart;
      }

      const cueText = cleanCueText(lines.slice(timingIndex + 1).join("\n"));
      if (cueText) cues.push({ start, end, text: cueText });
    }
    return cues;
  }

  function segmentIndexesNear(segments, time) {
    if (!segments?.length || !Number.isFinite(time)) return [];
    let low = 0;
    let high = segments.length - 1;
    let current = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const segment = segments[middle];
      if (time < segment.start) high = middle - 1;
      else if (time >= segment.end) low = middle + 1;
      else {
        current = middle;
        break;
      }
    }
    if (current < 0) current = time < segments[0].start ? 0 : segments.length - 1;
    return [current - 1, current, current + 1].filter((index) => index >= 0 && index < segments.length);
  }

  function cueAt(cues, time) {
    if (!cues?.length || !Number.isFinite(time)) return null;
    let low = 0;
    let high = cues.length - 1;
    let candidate = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (cues[middle].start <= time) {
        candidate = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    for (let index = candidate; index >= 0; index -= 1) {
      const cue = cues[index];
      if (time >= cue.start && time <= cue.end) return cue;
      if (time - cue.start > 30) break;
    }
    return null;
  }

  function dedupeCues(cues) {
    const seen = new Set();
    return (cues || [])
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .filter((cue) => {
        const key = `${cue.start.toFixed(3)}|${cue.end.toFixed(3)}|${cue.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function parseAccessibleClock(text) {
    const match = String(text || "").match(/\b(?:Paused|Playing)\s+at\s+(\d+(?:\.\d+)?)\b/i);
    if (!match) return null;
    const milliseconds = Number(match[1]);
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds / 1000 : null;
  }

  function parseTimelineClock(values) {
    const now = Number(values?.now);
    const min = Number(values?.min);
    const max = Number(values?.max);
    if (![now, min, max].every(Number.isFinite)) return null;
    // Disney's episode timeline is measured in seconds and is much larger than
    // the neighboring volume slider (0-100).
    if (max - min < 300 || now < min - 1 || now > max + 1) return null;
    return now;
  }

  function createPlaybackClock() {
    let anchorSeconds = null;
    let anchorNowMs = 0;
    let playing = false;
    let rate = 1;
    let source = "none";
    let calibratedAtMs = null;

    function read(nowMs) {
      if (!Number.isFinite(anchorSeconds)) return null;
      const now = Number.isFinite(nowMs) ? nowMs : anchorNowMs;
      const elapsed = playing ? Math.max(0, now - anchorNowMs) / 1000 * rate : 0;
      return Math.max(0, anchorSeconds + elapsed);
    }

    function calibrate(input) {
      const seconds = Number(input?.seconds);
      const nowMs = Number(input?.nowMs);
      if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(nowMs)) return false;
      anchorSeconds = seconds;
      anchorNowMs = nowMs;
      if (typeof input.playing === "boolean") playing = input.playing;
      if (Number.isFinite(input.rate) && input.rate > 0) rate = input.rate;
      source = input.source || "unknown";
      calibratedAtMs = nowMs;
      return true;
    }

    function setPlayback(input) {
      const nowMs = Number(input?.nowMs);
      if (!Number.isFinite(nowMs)) return false;
      const current = read(nowMs);
      if (Number.isFinite(current)) {
        anchorSeconds = current;
        anchorNowMs = nowMs;
      }
      if (typeof input.playing === "boolean") playing = input.playing;
      if (Number.isFinite(input.rate) && input.rate > 0) rate = input.rate;
      return Number.isFinite(anchorSeconds);
    }

    function invalidate() {
      anchorSeconds = null;
      anchorNowMs = 0;
      source = "none";
      calibratedAtMs = null;
    }

    function snapshot(nowMs) {
      return {
        ready: Number.isFinite(anchorSeconds),
        seconds: read(nowMs),
        playing,
        rate,
        source,
        calibratedAtMs
      };
    }

    return { read, calibrate, setPlayback, invalidate, snapshot };
  }

  function createSeekGate(options = {}) {
    const settleMs = Math.max(0, Number(options.settleMs) || 60);
    const minimumJump = Math.max(0.1, Number(options.minimumJump) || 0.75);
    const maxHoldMs = Math.max(500, Number(options.maxHoldMs) || 2200);
    let state = {
      active: false,
      baseline: null,
      target: null,
      startedAt: null,
      calibratedAt: null
    };

    function begin(input = {}) {
      if (state.active) return false;
      const seconds = Number(input.seconds);
      const nowMs = Number(input.nowMs);
      state = {
        active: true,
        baseline: Number.isFinite(seconds) ? seconds : null,
        target: null,
        startedAt: Number.isFinite(nowMs) ? nowMs : 0,
        calibratedAt: null
      };
      return true;
    }

    function calibrate(input = {}) {
      if (!state.active) return false;
      const seconds = Number(input.seconds);
      const nowMs = Number(input.nowMs);
      if (!Number.isFinite(seconds) || !Number.isFinite(nowMs)) return false;
      if (Number.isFinite(state.baseline) && Math.abs(seconds - state.baseline) < minimumJump) return false;
      if (!Number.isFinite(state.target) || Math.abs(seconds - state.target) >= 0.25) {
        state.target = seconds;
        state.calibratedAt = nowMs;
      }
      return true;
    }

    function canRender(input = {}) {
      if (!state.active) return true;
      const seconds = Number(input.seconds);
      const nowMs = Number(input.nowMs);
      const timedOutWithoutJump = !Number.isFinite(state.target) &&
        Number.isFinite(nowMs) && nowMs - state.startedAt >= maxHoldMs;
      if (timedOutWithoutJump && input.segmentsReady) {
        state.active = false;
        return true;
      }
      if (!Number.isFinite(state.target) || !Number.isFinite(seconds) || !Number.isFinite(nowMs)) return false;
      if (Math.abs(seconds - state.target) >= minimumJump) return false;
      if (!input.segmentsReady || nowMs - state.calibratedAt < settleMs) return false;
      state.active = false;
      return true;
    }

    function snapshot() {
      return { ...state };
    }

    return { begin, calibrate, canRender, snapshot };
  }

  function tokenizeEnglish(text) {
    const source = String(text || "");
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
  }

  function englishWordSpans(text) {
    const source = String(text || "");
    const words = [];
    const pattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
    let match;
    while ((match = pattern.exec(source))) {
      words.push({
        text: match[0],
        lookup: match[0].toLowerCase().replace(/’/g, "'"),
        start: match.index,
        end: match.index + match[0].length
      });
    }
    return words;
  }

  function inferPartOfSpeech(words, index) {
    const word = words[index]?.lookup || "";
    const previous = words[index - 1]?.lookup || "";
    const previousTwo = words[index - 2]?.lookup || "";
    const next = words[index + 1]?.lookup || "";
    const copulas = new Set(["am", "is", "are", "was", "were", "be", "been", "being", "seem", "seems", "seemed", "feel", "feels", "felt"]);
    const intensifiers = new Set(["very", "quite", "rather", "so", "too", "extremely", "really", "pretty", "more", "most"]);
    const verbLeads = new Set(["to", "can", "could", "will", "would", "shall", "should", "must", "may", "might", "do", "does", "did"]);
    const determiners = new Set(["a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "our", "their"]);
    if ((word.endsWith("ing") || word.endsWith("ed")) &&
        (copulas.has(previous) || intensifiers.has(previous) || copulas.has(previousTwo))) return "adjective";
    if (word.endsWith("ly") && !["friendly", "lovely", "lonely", "likely"].includes(word)) return "adverb";
    if (verbLeads.has(previous)) return "verb";
    if (determiners.has(previous) && next !== "") return "noun";
    return "";
  }

  function cleanContextText(value) {
    return String(value || "")
      .replace(/^[\s,;:.!?—–-]+|[\s,;:.!?—–-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildLookupOptions(text, wordIndex) {
    const source = String(text || "");
    const words = englishWordSpans(source);
    const index = Number(wordIndex);
    const selected = words[index];
    if (!selected) return [];

    const boundaryPattern = /[\n.!?;:,]/;
    let leftBoundary = -1;
    for (let cursor = selected.start - 1; cursor >= 0; cursor -= 1) {
      if (boundaryPattern.test(source[cursor])) {
        leftBoundary = cursor;
        break;
      }
    }
    let rightBoundary = source.length;
    for (let cursor = selected.end; cursor < source.length; cursor += 1) {
      if (boundaryPattern.test(source[cursor])) {
        rightBoundary = cursor;
        break;
      }
    }

    const clauseWords = words.filter((word) => word.start > leftBoundary && word.end <= rightBoundary);
    const clauseIndex = clauseWords.findIndex((word) => word.start === selected.start);
    let contextWords = clauseWords;
    if (clauseWords.length > 9) {
      const start = Math.max(0, Math.min(clauseWords.length - 9, clauseIndex - 4));
      contextWords = clauseWords.slice(start, start + 9);
    }
    const context = cleanContextText(
      source.slice(contextWords[0]?.start ?? selected.start, contextWords.at(-1)?.end ?? selected.end)
    );

    const particles = new Set(["up", "out", "off", "on", "over", "away", "back", "down", "in", "into", "through", "around", "along", "for", "after", "to", "with", "from", "at", "about"]);
    const objectPronouns = new Set(["it", "them", "him", "her", "me", "you", "us"]);
    const intensifiers = new Set(["very", "quite", "rather", "so", "too", "extremely", "really", "pretty", "more", "most"]);
    let phraseWords = [selected];
    const previous = clauseWords[clauseIndex - 1];
    const next = clauseWords[clauseIndex + 1];
    const nextTwo = clauseWords[clauseIndex + 2];
    if (next && objectPronouns.has(next.lookup) && nextTwo && particles.has(nextTwo.lookup)) {
      phraseWords = [selected, next, nextTwo];
    } else if (next && particles.has(next.lookup)) {
      phraseWords = [selected, next];
    } else if (previous && (particles.has(selected.lookup) || intensifiers.has(previous.lookup) || clauseIndex === clauseWords.length - 1)) {
      phraseWords = [previous, selected];
    } else if (next) {
      phraseWords = [selected, next];
    } else if (previous) {
      phraseWords = [previous, selected];
    }
    const phrase = cleanContextText(
      source.slice(phraseWords[0].start, phraseWords.at(-1).end)
    );
    const word = selected.text;
    const partHint = inferPartOfSpeech(words, index);
    const candidates = [
      { mode: "context", label: "语境", text: context, partHint },
      { mode: "phrase", label: "短语", text: phrase, partHint },
      { mode: "word", label: "单词", text: word, partHint }
    ];
    const seen = new Set();
    return candidates.filter((option) => {
      const key = option.text.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function formatClock(seconds) {
    if (!Number.isFinite(seconds)) return "--:--";
    const whole = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  return {
    parseAttributeList,
    parseMaster,
    chooseTracks,
    parseMediaPlaylist,
    parseTimestamp,
    parseVttSegment,
    segmentIndexesNear,
    cueAt,
    dedupeCues,
    parseAccessibleClock,
    parseTimelineClock,
    createPlaybackClock,
    createSeekGate,
    tokenizeEnglish,
    buildLookupOptions,
    formatClock
  };
});
