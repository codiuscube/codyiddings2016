/* Poem Composer — the two free, no-key web APIs.
     bible-api.com       verse lookup  (CORS: *)
     api.datamuse.com    thesaurus, rhymes, sounds-like, definitions

   Datamuse gotcha (measured 2026-11-15): its CDN does not vary the cache on the
   Origin header, so a browser can be handed another site's Access-Control-Allow-
   Origin for any query somebody else asked first, and the browser then blocks the
   answer. Fix: every Datamuse URL carries `_o=<this page's origin>` (an unknown
   parameter Datamuse ignores), which gives each origin its own cache entries; and
   a request that fails the way a CORS block fails (a TypeError) is retried once
   with a unique key, which forces a fresh, correctly-headed response. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Api = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BIBLE = 'https://bible-api.com/';
  var DATAMUSE = 'https://api.datamuse.com/words';
  var CACHE_PREFIX = 'pc:cache:';
  var CACHE_INDEX = 'pc:cache-index';
  var CACHE_MAX = 80;

  var TRANSLATIONS = [
    { id: 'csb', name: 'CSB', long: 'Christian Standard Bible', local: true },
    { id: 'bsb', name: 'BSB', long: 'Berean Standard Bible' },
    { id: 'web', name: 'WEB', long: 'World English Bible' },
    { id: 'kjv', name: 'KJV', long: 'King James Version' },
    { id: 'asv', name: 'ASV', long: 'American Standard Version' },
    { id: 'darby', name: 'Darby', long: 'Darby Bible' },
    { id: 'bbe', name: 'BBE', long: 'Bible in Basic English' },
  ];

  function ApiError(kind, message, status) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.kind = kind; // notfound | ratelimit | offline | bad
    e.status = status || 0;
    return e;
  }

  /** "file" for a double-clicked page, else "http-localhost-8000" etc. The
      protocol is part of it because http://x and https://x are different
      origins with different CORS headers. */
  function originTag(loc) {
    if (!loc || loc.protocol === 'file:' || !loc.host) return 'file';
    var proto = String(loc.protocol || 'http:').replace(/:$/, '');
    return (proto + '-' + String(loc.host)).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'web';
  }

  function qs(params) {
    return Object.keys(params)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
  }

  function create(opts) {
    opts = opts || {};
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null);
    var tag = opts.originTag || 'file';
    var timeoutMs = opts.timeout || 12000;
    var store = opts.storage;
    if (store === undefined) { try { store = window.localStorage; } catch (e) { store = null; } }
    var rand = opts.random || function () { return Math.random().toString(36).slice(2, 9); };

    function fetchT(url) {
      if (!fetchFn) return Promise.reject(new TypeError('fetch is not available'));
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs) : null;
      return fetchFn(url, ctl ? { signal: ctl.signal } : undefined).then(
        function (r) { if (timer) clearTimeout(timer); return r; },
        function (e) { if (timer) clearTimeout(timer); throw e; }
      );
    }

    /* ---------- cache (scripture text never changes, so cache-first) ---------- */
    function cacheGet(key) {
      if (!store) return null;
      try { var raw = store.getItem(CACHE_PREFIX + key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }
    function cacheSet(key, value) {
      if (!store) return;
      try {
        store.setItem(CACHE_PREFIX + key, JSON.stringify(value));
        var idx = JSON.parse(store.getItem(CACHE_INDEX) || '[]').filter(function (k) { return k !== key; });
        idx.push(key);
        while (idx.length > CACHE_MAX) store.removeItem(CACHE_PREFIX + idx.shift());
        store.setItem(CACHE_INDEX, JSON.stringify(idx));
      } catch (e) { /* cache is a nicety, never an error */ }
    }

    /* ---------- bible-api.com ---------- */
    /** apiRef is already normalised ("matthew+1:18-25"; see PC.refForApi). */
    var csbData = opts.csb || (typeof CSB !== 'undefined' ? CSB : null);
    var BOOK_ALIAS = { psalms: 'psalm', ps: 'psalm', matt: 'matthew', mt: 'matthew', isa: 'isaiah', phil: 'philippians', jn: 'john', lk: 'luke' };

    /** The CSB has no free API: the chapters this poem draws on ship in js/csb.js
        (Holman allows 1,000 verses without written permission). Anything else is
        'notcsb', and the panel offers Bible Gateway's CSB page instead. */
    function csbVerse(apiRef) {
      var m = /^((?:[1-3])?[a-z][a-z.]*?)\+(\d+)(?::(\d+)(?:-(\d+))?)?$/.exec(String(apiRef).replace(/\+(?=[a-z])/g, ''));
      var book = m && m[1].replace(/\./g, '');
      book = book && (BOOK_ALIAS[book] || book);
      var ch = csbData && m && csbData.chapters[book + ' ' + Number(m[2])];
      if (!ch) return Promise.reject(ApiError('notcsb', 'not bundled'));
      var from = m[3] ? Number(m[3]) : 1, to = m[4] ? Number(m[4]) : m[3] ? from : Infinity;
      var vs = ch.verses.filter(function (v) { return v.verse >= from && v.verse <= to; });
      if (!vs.length) return Promise.reject(ApiError('notfound', 'no verses', 404));
      var ref = ch.book + ' ' + ch.chapter + (m[3] ? ':' + from + (to !== from && to !== Infinity ? '–' + Math.min(to, vs[vs.length - 1].verse) : '') : '');
      return Promise.resolve({
        reference: ref, translation_id: 'csb', translation_name: 'Christian Standard Bible',
        translation_note: 'Used by permission', local: true, fromCache: false,
        verses: vs.map(function (v) { return { book_name: ch.book, chapter: ch.chapter, verse: v.verse, text: v.text }; }),
      });
    }

    function verse(apiRef, translation, force) {
      translation = translation || 'csb';
      if (translation === 'csb') return csbVerse(apiRef);
      var key = 'v:' + translation + ':' + apiRef;
      var cached = force ? null : cacheGet(key);
      if (cached) return Promise.resolve(Object.assign({}, cached, { fromCache: true }));
      var url = BIBLE + apiRef + '?translation=' + encodeURIComponent(translation);
      return fetchT(url).then(
        function (r) {
          if (r.status === 404) throw ApiError('notfound', 'not found', 404);
          if (r.status === 429) throw ApiError('ratelimit', 'too many requests', 429);
          if (!r.ok) throw ApiError('bad', 'HTTP ' + r.status, r.status);
          return r.json().then(function (j) { return { fresh: j }; });
        },
        function () {
          // network down: a copy saved earlier is better than nothing
          var stale = cacheGet(key);
          if (stale) return { stale: Object.assign({}, stale, { fromCache: true }) };
          throw ApiError('offline', 'could not reach bible-api.com');
        }
      ).then(function (res) {
        if (res.stale) return res.stale;
        var j = res.fresh;
        if (!j || !Array.isArray(j.verses) || !j.verses.length) throw ApiError('notfound', 'no verses', 404);
        var clean = {
          reference: j.reference,
          translation_id: j.translation_id,
          translation_name: j.translation_name,
          translation_note: j.translation_note,
          verses: j.verses.map(function (v) {
            return { book_name: v.book_name, chapter: v.chapter, verse: v.verse, text: String(v.text).replace(/\s+$/, '') };
          }),
        };
        cacheSet(key, clean);
        return Object.assign({}, clean, { fromCache: false });
      });
    }

    /* ---------- Datamuse ---------- */
    function datamuse(params) {
      function attempt(suffix) {
        var url = DATAMUSE + '?' + qs(params) + '&_o=' + encodeURIComponent(tag + suffix);
        return fetchT(url).then(function (r) {
          if (r.status === 429) throw ApiError('ratelimit', 'too many requests', 429);
          if (!r.ok) throw ApiError('bad', 'HTTP ' + r.status, r.status);
          return r.json();
        });
      }
      return attempt('').catch(function (err) {
        // TypeError (or abort) = the network is down OR a CORS block from a
        // CDN copy cached for another origin. One retry with a fresh key tells
        // them apart: it succeeds in the second case.
        if (err && (err.name === 'TypeError' || err.name === 'AbortError')) {
          return attempt('-' + rand()).catch(function () {
            throw ApiError('offline', 'could not reach api.datamuse.com');
          });
        }
        throw err;
      });
    }

    function items(list, skip) {
      var seen = {};
      return (list || [])
        .filter(function (x) {
          if (!x || !x.word) return false;
          var k = x.word.toLowerCase();
          if (skip && k === String(skip).toLowerCase()) return false;
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        })
        .map(function (x) { return { w: x.word, s: x.numSyllables || 0, tags: x.tags || [] }; });
    }

    function bySyllables(list) {
      var one = [], two = [], more = [];
      list.forEach(function (x) { (x.s <= 1 ? one : x.s === 2 ? two : more).push(x); });
      var g = [];
      if (one.length) g.push({ title: 'One syllable', items: one });
      if (two.length) g.push({ title: 'Two syllables', items: two });
      if (more.length) g.push({ title: 'Three or more', items: more });
      return g;
    }

    var tabs = {
      similar: function (w) {
        return datamuse({ ml: w, md: 'sp', max: 80 }).then(function (r) {
          var all = items(r, w);
          var syn = all.filter(function (x) { return x.tags.indexOf('syn') > -1; });
          var rel = all.filter(function (x) { return x.tags.indexOf('syn') === -1; });
          var g = [];
          if (syn.length) g.push({ title: 'Synonyms', items: syn });
          if (rel.length) g.push({ title: 'Close in meaning', items: rel });
          return g;
        });
      },
      opposite: function (w) {
        return datamuse({ rel_ant: w, md: 's', max: 40 }).then(function (r) {
          var all = items(r, w);
          return all.length ? [{ title: 'Opposites', items: all }] : [];
        });
      },
      rhymes: function (w) {
        return datamuse({ rel_rhy: w, md: 's', max: 100 }).then(function (r) { return bySyllables(items(r, w)); });
      },
      near: function (w) {
        return datamuse({ rel_nry: w, md: 's', max: 100 }).then(function (r) { return bySyllables(items(r, w)); });
      },
      sounds: function (w) {
        return datamuse({ sl: w, md: 's', max: 40 }).then(function (r) {
          var all = items(r, w);
          return all.length ? [{ title: 'Sounds like', items: all }] : [];
        });
      },
      goes: function (w) {
        return Promise.all([
          datamuse({ rel_jjb: w, md: 's', max: 40 }),
          datamuse({ rel_jja: w, md: 's', max: 40 }),
        ]).then(function (res) {
          var g = [];
          var a = items(res[0], w);
          var b = items(res[1], w);
          if (a.length) g.push({ title: 'Words that describe it', items: a });
          if (b.length) g.push({ title: 'What it describes', items: b });
          return g;
        });
      },
    };

    /** First definitions for a single word: [{pos, text}] */
    function define(w) {
      if (!w || /\s/.test(w)) return Promise.resolve([]);
      return datamuse({ sp: w, md: 'd', max: 1 }).then(function (r) {
        var hit = r && r[0];
        if (!hit || !hit.defs) return [];
        return hit.defs.slice(0, 3).map(function (d) {
          var parts = String(d).split('\t');
          return { pos: parts.length > 1 ? parts[0] : '', text: (parts[1] || parts[0]).trim() };
        });
      });
    }

    function tab(name, w) {
      if (!tabs[name]) return Promise.reject(ApiError('bad', 'unknown tab ' + name));
      return tabs[name](w);
    }

    return { verse: verse, datamuse: datamuse, tab: tab, define: define, tabs: Object.keys(tabs) };
  }

  function bibleGatewayUrl(ref, version) {
    return 'https://www.biblegateway.com/passage/?search=' + encodeURIComponent(String(ref).replace(/[–—]/g, '-')) +
      '&version=' + encodeURIComponent(version || 'CSB');
  }

  return {
    create: create,
    ApiError: ApiError,
    originTag: originTag,
    bibleGatewayUrl: bibleGatewayUrl,
    TRANSLATIONS: TRANSLATIONS,
    CSB_CREDIT: (typeof CSB !== 'undefined' && CSB.credit) || '',
  };
});
