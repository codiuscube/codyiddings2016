/* Poem Composer — storage. One localStorage key holds the working copy, the
   snapshots, and the settings. Losing a draft is the one unforgivable failure
   for a writing tool, so: save on every pause, on tab hide, on close; keep
   snapshots; warn if a second tab overwrites the first; fall back to memory
   (and say so) when the browser refuses to store. */
(function () {
  'use strict';

  var KEY = 'poem-composer:v1';
  var MAX_SNAPSHOTS = 40;

  var DEFAULTS = {
    theme: 'auto',        // auto | paper | night
    syl: false,           // syllable counts in the right margin
    pew: false,           // plain-language marks
    spotlight: false,     // dim everything but the section you're in
    typewriter: true,     // keep the line you're writing near the middle
    spell: false,         // browser spellcheck squiggles
    pinHud: false,        // keep the word count showing
    pace: 130,            // spoken words per minute for the read-aloud estimate
    translation: 'csb',   // the church's Bible (bundled chapters; see js/csb.js)
    csbDefault: true,     // set once: an older save's BSB default became CSB
    mode: 'pace',         // rehearse: pace | listen
    ttsRate: 0.85,
    voice: '',
    recent: [],           // recent verse lookups
  };

  var memoryOnly = false;
  var lastRaw = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function latestDraft() {
    var drafts = (window.PC_DATA && window.PC_DATA.drafts) || [];
    return drafts.length ? drafts[drafts.length - 1] : null;
  }

  function fresh() {
    var d = latestDraft();
    return {
      v: 1,
      rev: 0,
      title: '',
      text: d ? d.body : '',
      seeded: d ? d.id : null,
      caret: [0, 0],
      scrollTop: 0,
      snapshots: [],
      settings: JSON.parse(JSON.stringify(DEFAULTS)),
      created: Date.now(),
      updated: Date.now(),
    };
  }

  function normalise(s) {
    var base = fresh();
    if (!s || typeof s !== 'object') return base;
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = s[k] !== undefined ? s[k] : base[k]; });
    out.settings = Object.assign({}, DEFAULTS, s.settings || {});
    // Saves from before the CSB was built in kept BSB as their default: move them to CSB once.
    if (s.settings && !s.settings.csbDefault) { out.settings.translation = 'csb'; out.settings.csbDefault = true; }
    if (typeof out.text !== 'string') out.text = base.text;
    if (!Array.isArray(out.snapshots)) out.snapshots = [];
    if (!Array.isArray(out.caret) || out.caret.length !== 2) out.caret = [0, 0];
    return out;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { memoryOnly = true; }
    lastRaw = raw;
    if (!raw) return fresh();
    try { return normalise(JSON.parse(raw)); } catch (e) {
      // unreadable: keep the raw text somewhere safe before the next autosave overwrites it
      try { localStorage.setItem(KEY + ':unreadable', raw); } catch (e2) { /* nothing more to do */ }
      return fresh();
    }
  }

  /** Returns true if written to disk, false if only held in memory. */
  function save(state) {
    state.updated = Date.now();
    state.rev = (state.rev || 0) + 1;
    var raw = JSON.stringify(state);
    lastRaw = raw;
    try {
      localStorage.setItem(KEY, raw);
      memoryOnly = false;
      return true;
    } catch (e) {
      // quota full or storage blocked: drop the oldest auto snapshots and retry once
      try {
        var trimmed = state.snapshots.filter(function (s) { return !s.auto; });
        if (trimmed.length < state.snapshots.length) {
          state.snapshots = trimmed;
          raw = JSON.stringify(state);
          lastRaw = raw;
          localStorage.setItem(KEY, raw);
          memoryOnly = false;
          return true;
        }
      } catch (e2) { /* fall through */ }
      memoryOnly = true;
      return false;
    }
  }

  /** Keep a copy of `text` (default: the state's current text). */
  function snapshot(state, label, auto, text, dedupe) {
    var t = text !== undefined ? text : state.text;
    var last = state.snapshots[0];
    if ((auto || dedupe) && last && last.text === t) return null; // nothing new
    var snap = { id: uid(), t: Date.now(), label: label || '', auto: !!auto, text: t };
    state.snapshots.unshift(snap);
    // keep the newest MAX_SNAPSHOTS; drop automatic ones first
    while (state.snapshots.length > MAX_SNAPSHOTS) {
      var i = -1;
      for (var k = state.snapshots.length - 1; k >= 0; k--) if (state.snapshots[k].auto) { i = k; break; }
      state.snapshots.splice(i >= 0 ? i : state.snapshots.length - 1, 1);
    }
    return snap;
  }

  /** Another tab wrote the key. cb(theirState) is called only if it differs. */
  function onExternalChange(getMine, cb) {
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY || !e.newValue || e.newValue === lastRaw) return;
      try {
        var theirs = normalise(JSON.parse(e.newValue));
        var mine = getMine();
        if (theirs.text !== mine.text) cb(theirs);
      } catch (err) { /* ignore */ }
    });
  }

  function exportAll(state) {
    return JSON.stringify({ app: 'poem-composer', v: 1, exported: new Date().toISOString(), state: state }, null, 1);
  }

  /** Parse a backup file; returns a normalised state or throws. */
  function parseBackup(text) {
    var j = JSON.parse(text);
    if (!j || j.app !== 'poem-composer' || !j.state) throw new Error('That does not look like a Poem Composer backup.');
    return normalise(j.state);
  }

  window.Store = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    snapshot: snapshot,
    onExternalChange: onExternalChange,
    exportAll: exportAll,
    parseBackup: parseBackup,
    isMemoryOnly: function () { return memoryOnly; },
  };
})();
