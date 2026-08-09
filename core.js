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
    tokenizeEnglish,
    formatClock
  };
});
