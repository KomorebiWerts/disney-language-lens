const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("./core.js");
const dictionary = require("./dictionary-core.js");

function closeTo(actual, expected, tolerance = 0.001) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

// Captured from the real Loki S1:E2 Disney+ player on 2026-08-09.
// The active video element restarts near 20 seconds after each far seek, while
// Disney's accessible timeline continues to report the episode-global clock.
const realSeekSamples = [
  { status: "Paused at 499048.", localVideoTime: 21.970122, globalTime: 499.048 },
  { status: "Paused at 1826835.", localVideoTime: 21.430948, globalTime: 1826.835 },
  { status: "Paused at 2822589.", localVideoTime: 20.941056, globalTime: 2822.589 }
];

for (const sample of realSeekSamples) {
  closeTo(core.parseAccessibleClock(sample.status), sample.globalTime);
  assert.notEqual(
    Math.round(sample.localVideoTime),
    Math.round(sample.globalTime),
    "A Disney media-period clock must never be treated as the episode clock"
  );
}

const clock = core.createPlaybackClock();
clock.calibrate({ seconds: 499.048, nowMs: 1_000, playing: false, rate: 1, source: "status" });
closeTo(clock.read(9_000), 499.048);

clock.setPlayback({ playing: true, rate: 1, nowMs: 10_000 });
closeTo(clock.read(11_250), 500.298);

// A far seek must replace the old anchor immediately, regardless of the new
// period's local video time.
clock.calibrate({ seconds: 1826.835, nowMs: 12_000, playing: false, rate: 1, source: "status" });
closeTo(clock.read(50_000), 1826.835);
assert.equal(clock.snapshot().source, "status");

clock.calibrate({ seconds: 2822, nowMs: 60_000, playing: true, rate: 1.25, source: "timeline" });
closeTo(clock.read(62_000), 2824.5);

const seekGate = core.createSeekGate({ settleMs: 60, minimumJump: 0.75 });
seekGate.begin({ seconds: 100, nowMs: 1_000 });
assert.equal(seekGate.canRender({ seconds: 100, nowMs: 1_020, segmentsReady: true }), false);
seekGate.calibrate({ seconds: 100, nowMs: 1_030 });
assert.equal(
  seekGate.canRender({ seconds: 100, nowMs: 1_200, segmentsReady: true }),
  false,
  "An unchanged pre-seek clock must not re-display the old caption"
);
seekGate.calibrate({ seconds: 110, nowMs: 1_210 });
assert.equal(seekGate.canRender({ seconds: 110, nowMs: 1_250, segmentsReady: true }), false);
assert.equal(
  seekGate.canRender({ seconds: 110, nowMs: 1_280, segmentsReady: false }),
  false,
  "A new clock alone is insufficient while its subtitle segment is still loading"
);
assert.equal(seekGate.canRender({ seconds: 110, nowMs: 1_280, segmentsReady: true }), true);
assert.equal(seekGate.snapshot().active, false);

assert.equal(core.parseAccessibleClock("Playback resumed."), null);
assert.equal(core.parseAccessibleClock("Paused at 0."), 0);
assert.equal(core.parseTimelineClock({ now: "1336", min: "0", max: "3318" }), 1336);
assert.equal(core.parseTimelineClock({ now: "50", min: "0", max: "100" }), null);

const masterUrl = "https://cdn.example/path/master.m3u8?token=abc";
const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub-main",NAME="English [CC]",LANGUAGE="en",FORCED=NO,URI="subs/en/playlist.m3u8?x=1"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub-main",NAME="Chinese (Simplified)",LANGUAGE="zh-Hans",FORCED=NO,URI="subs/zh/playlist.m3u8?x=2"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub-main",NAME="Chinese (Traditional)",LANGUAGE="zh-Hant",FORCED=NO,URI="subs/zht/playlist.m3u8?x=3"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub-main",NAME="English forced",LANGUAGE="en",FORCED=YES,URI="subs/en-forced.m3u8"`;

const tracks = core.parseMaster(master, masterUrl);
assert.equal(tracks.length, 4);
assert.equal(tracks[0].url, "https://cdn.example/path/subs/en/playlist.m3u8?x=1");
assert.equal(core.chooseTracks(tracks, "zh-Hans").chinese.language, "zh-Hans");
assert.equal(core.chooseTracks(tracks, "zh-Hant").chinese.language, "zh-Hant");
assert.equal(core.chooseTracks(tracks, "zh-Hans").english.forced, false);

const playlist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:12
#EXTINF:6.0,
segment-12.vtt
#EXTINF:5.5,
segment-13.vtt`;
const segments = core.parseMediaPlaylist(playlist, "https://cdn.example/subs/en/index.m3u8");
assert.deepEqual(segments.map(({ index, start, end }) => ({ index, start, end })), [
  { index: 12, start: 0, end: 6 },
  { index: 13, start: 6, end: 11.5 }
]);

const localVtt = `WEBVTT

00:00:00.500 --> 00:00:02.000
Hello <i>world</i> &amp; friends`;
assert.deepEqual(core.parseVttSegment(localVtt, 12, 6), [
  { start: 12.5, end: 14, text: "Hello world & friends" }
]);

const mappedVtt = `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000

00:00:01.000 --> 00:00:03.000
Mapped`;
assert.deepEqual(core.parseVttSegment(mappedVtt, 0, 6), [
  { start: 11, end: 13, text: "Mapped" }
]);

assert.equal(core.cueAt([{ start: 1, end: 2, text: "yes" }], 1.5).text, "yes");
assert.deepEqual(core.segmentIndexesNear(segments, 6.2), [0, 1]);

// Real Disney English subtitle segment boundaries for Loki S1:E2. These prove
// that far global times select far playlist segments instead of pts_0.vtt.
const realEpisodePlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:249.292,
pts_0.vtt
#EXTINF:247.916,
pts_249292.vtt
#EXTINF:240.459,
pts_497208.vtt
#EXTINF:258.041,
pts_737667.vtt
#EXTINF:284.542,
pts_995708.vtt
#EXTINF:212.833,
pts_1280250.vtt
#EXTINF:258.75,
pts_1493083.vtt
#EXTINF:258.875,
pts_1751833.vtt
#EXTINF:257.584,
pts_2010708.vtt
#EXTINF:231.75,
pts_2268292.vtt
#EXTINF:231.041,
pts_2500042.vtt
#EXTINF:461.209,
pts_2731083.vtt`;
const realEpisodeSegments = core.parseMediaPlaylist(realEpisodePlaylist, "https://cdn.example/loki/en.m3u8");
assert.deepEqual(core.segmentIndexesNear(realEpisodeSegments, 499.048), [1, 2, 3]);
assert.deepEqual(core.segmentIndexesNear(realEpisodeSegments, 1826.835), [6, 7, 8]);
assert.deepEqual(core.segmentIndexesNear(realEpisodeSegments, 2822.589), [10, 11]);

assert.deepEqual(core.tokenizeEnglish("We're Variants, aren't we?"), [
  { type: "word", text: "We're", lookup: "we're" },
  { type: "text", text: " " },
  { type: "word", text: "Variants", lookup: "variants" },
  { type: "text", text: ", " },
  { type: "word", text: "aren't", lookup: "aren't" },
  { type: "text", text: " " },
  { type: "word", text: "we", lookup: "we" },
  { type: "text", text: "?" }
]);

const dictionaryPayload = [{
  word: "variant",
  phonetic: "/ˈvɛəɹi.ənt/",
  phonetics: [{ text: "/ˈvɛəɹi.ənt/", audio: "https://audio.example/variant.mp3" }],
  meanings: [{
    partOfSpeech: "noun",
    definitions: [{ definition: "Something slightly different from a type or norm.", example: "A regional variant." }]
  }]
}];
assert.deepEqual(dictionary.parseDictionaryResponse(dictionaryPayload), {
  phonetic: "/ˈvɛəɹi.ənt/",
  audio: "https://audio.example/variant.mp3",
  partOfSpeech: "noun",
  definition: "Something slightly different from a type or norm.",
  example: "A regional variant."
});
assert.equal(dictionary.parseTranslationResponse({ responseData: { translatedText: "变体" } }), "变体");
assert.equal(
  dictionary.parseTranslationResponse({
    responseData: { translatedText: "https://mymemory.translated.net/doc/spec.php" }
  }),
  "",
  "A translator URL must never be rendered as a Chinese meaning"
);
assert.equal(
  dictionary.parseTranslationResponse({
    responseData: { translatedText: "https://example.com/error" },
    matches: [
      { translation: "www.example.com" },
      { translation: "居高临下的" }
    ]
  }),
  "居高临下的",
  "A clean Chinese candidate should replace a polluted primary response"
);
assert.equal(
  dictionary.parseGoogleTranslationResponse([
    [["相当居高临下", "quite patronizing", null, null]]
  ]),
  "相当居高临下"
);
assert.equal(
  dictionary.parseGoogleTranslationResponse([
    [["https://translate.google.com/", "quite patronizing", null, null]]
  ]),
  "",
  "Google fallback responses need the same output validation"
);
assert.equal(dictionary.normalizeLookupWord("Variants!"), "variants");
assert.equal(dictionary.normalizeLookupWord("123"), "");

const patronizingPayload = [{
  word: "patronizing",
  phonetic: "/ˈpætɹənaɪzɪŋ/",
  meanings: [
    {
      partOfSpeech: "verb",
      definitions: [{ definition: "To act as a patron of; to defend, protect, or support." }]
    },
    {
      partOfSpeech: "adjective",
      definitions: [{ definition: "Offensively condescending." }]
    }
  ]
}];
assert.equal(
  dictionary.parseDictionaryResponse(patronizingPayload, "adjective").definition,
  "Offensively condescending.",
  "Contextual part-of-speech hints must beat the first unrelated dictionary sense"
);

assert.deepEqual(
  core.buildLookupOptions("Yes, it was quite patronizing.", 4),
  [
    { mode: "context", label: "语境", text: "it was quite patronizing", partHint: "adjective" },
    { mode: "phrase", label: "短语", text: "quite patronizing", partHint: "adjective" },
    { mode: "word", label: "单词", text: "patronizing", partHint: "adjective" }
  ],
  "The default lookup must carry enough context to disambiguate patronizing"
);
assert.deepEqual(
  core.buildLookupOptions("We need to figure it out.", 3).map((option) => option.text),
  ["We need to figure it out", "figure it out", "figure"],
  "Separable phrasal verbs should stay together"
);

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
const pageAdapterSource = fs.readFileSync(path.join(__dirname, "page-adapter.js"), "utf8");
assert.match(pageAdapterSource, /const seekGate = core\.createSeekGate/);
assert.match(pageAdapterSource, /addEventListener\("seeking", onSeeking/);
assert.match(pageAdapterSource, /seekGate\.canRender\(/);
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "1.1.0");
for (const script of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...manifest.content_scripts.flatMap((entry) => entry.js)
]) {
  assert.ok(fs.existsSync(path.join(__dirname, script)), `Missing manifest file: ${script}`);
}

async function testBackgroundRefreshesOpenDisneyTabs() {
  const backgroundSource = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  let onInstalled = null;
  const queried = [];
  const reloaded = [];
  const localWrites = [];
  const chrome = {
    runtime: {
      onInstalled: { addListener(listener) { onInstalled = listener; } },
      onMessage: { addListener() {} },
      getManifest() { return { version: "1.1.0" }; }
    },
    storage: {
      sync: {
        async get(defaults) { return defaults; },
        async set() {}
      },
      local: {
        async get() { return {}; },
        async set(value) { localWrites.push(value); },
        async remove() {}
      }
    },
    tabs: {
      async query(query) {
        queried.push(query);
        return [
          { id: 77, url: "https://www.disneyplus.com/play/example" },
          { id: 88, url: "https://example.com/" }
        ];
      },
      async reload(tabId) { reloaded.push(tabId); }
    }
  };
  const context = {
    chrome,
    console,
    fetch,
    URL,
    Date,
    setTimeout,
    clearTimeout,
    DisneyLanguageLensDictionary: dictionary,
    importScripts() {}
  };
  context.globalThis = context;
  vm.runInNewContext(backgroundSource, context, { filename: "background.js" });
  assert.equal(typeof onInstalled, "function", "Background must register an install/update handler");

  await onInstalled({ reason: "update" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    JSON.stringify(queried),
    JSON.stringify([{ url: ["https://www.disneyplus.com/*"] }])
  );
  assert.deepEqual(reloaded, [77]);
  assert.ok(
    localWrites.some((value) => value.languageLensAutoRefresh?.reloadedTabIds?.includes(77)),
    "Background must persist proof that the open Disney tab was refreshed"
  );
}

async function testBackgroundUsesContextAndSafeFallbacks() {
  const backgroundSource = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  let onMessage = null;
  const requests = [];
  const localState = {};
  const dictionaryPayload = [{
    word: "patronizing",
    phonetic: "/ˈpætɹənaɪzɪŋ/",
    meanings: [
      { partOfSpeech: "verb", definitions: [{ definition: "To act as a patron of." }] },
      { partOfSpeech: "adjective", definitions: [{ definition: "Offensively condescending." }] }
    ]
  }];
  const fakeFetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("api.dictionaryapi.dev")) {
      return { ok: true, async json() { return dictionaryPayload; } };
    }
    if (String(url).includes("translate.googleapis.com")) {
      const query = new URL(String(url)).searchParams.get("q");
      const translated = query === "link bug" ? "https://translate.google.com/error" : "相当居高临下";
      return { ok: true, async json() { return [[[translated, query, null, null]]]; } };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { onMessage = listener; } },
      getManifest() { return { version: "1.1.0" }; }
    },
    storage: {
      sync: { async get(defaults) { return defaults; }, async set() {} },
      local: {
        async get(key) {
          if (typeof key === "string") return { [key]: localState[key] };
          return { ...localState };
        },
        async set(value) { Object.assign(localState, value); },
        async remove(keys) { for (const key of [].concat(keys || [])) delete localState[key]; }
      }
    },
    tabs: { async query() { return []; }, async reload() {} }
  };
  const context = {
    chrome,
    console,
    fetch: fakeFetch,
    URL,
    Date,
    setTimeout,
    clearTimeout,
    DisneyLanguageLensDictionary: dictionary,
    importScripts() {}
  };
  context.globalThis = context;
  vm.runInNewContext(backgroundSource, context, { filename: "background.js" });
  assert.equal(typeof onMessage, "function");

  async function send(message) {
    return new Promise((resolve, reject) => {
      try {
        const keepAlive = onMessage(message, {}, resolve);
        assert.equal(keepAlive, true, `Background did not accept ${message.type}`);
      } catch (error) {
        reject(error);
      }
    });
  }

  const contextual = await send({
    type: "lookup-context",
    word: "patronizing",
    query: "quite patronizing",
    mode: "phrase",
    partHint: "adjective",
    officialChinese: "是的，你这是自以为高人一等。",
    targetLanguage: "zh-Hans"
  });
  assert.equal(contextual.ok, true);
  assert.equal(contextual.result.query, "quite patronizing");
  assert.equal(contextual.result.chinese, "相当居高临下");
  assert.equal(contextual.result.definition, "Offensively condescending.");
  assert.equal(contextual.result.translationSource, "google-context");
  assert.ok(
    requests.some((url) => url.includes("q=quite+patronizing") || url.includes("q=quite%20patronizing")),
    "The cloud translator must receive the contextual phrase"
  );
  assert.ok(!requests.some((url) => url.includes("mymemory")), "The known-bad single-word translator must not be used");

  const safeFallback = await send({
    type: "lookup-context",
    word: "patronizing",
    query: "link bug",
    mode: "context",
    partHint: "adjective",
    officialChinese: "你这是自以为高人一等。",
    targetLanguage: "zh-Hans"
  });
  assert.equal(safeFallback.ok, true);
  assert.equal(safeFallback.result.chinese, "你这是自以为高人一等。");
  assert.equal(safeFallback.result.translationSource, "disney-official");
  assert.ok(!safeFallback.result.chinese.includes("http"));
  assert.ok(
    Object.keys(localState).every((key) => !key.startsWith("dictionary:v1:")),
    "Version 1 URL-polluted cache entries must never be reused"
  );
}

Promise.resolve()
  .then(testBackgroundRefreshesOpenDisneyTabs)
  .then(testBackgroundUsesContextAndSafeFallbacks)
  .then(() => {
    console.log("Disney Language Lens 1.1.0 tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
