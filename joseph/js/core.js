/* Poem Composer — core logic (no DOM). Loaded by the page as a classic script
   and by tools/test.mjs under node. Everything here reads the poem; nothing here
   ever writes or rewrites a line of it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Text helpers                                                        */
  /* ------------------------------------------------------------------ */

  var WORD_RE = /[A-Za-z0-9À-ɏ]+(?:['’\-][A-Za-z0-9À-ɏ]+)*/g;
  var MOVEMENTS = ['Recognize', 'Remember', 'Reframe', 'Respond', 'Rest'];
  var MOVEMENT_RE = /^\s*\/\/\s*(recognize|remember|reframe|respond|rest)\b/i;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** A "note" is a private line that starts with // . Notes are never counted,
      read aloud, or exported (unless asked). Movement tags are notes. */
  function isNote(line) {
    return /^\s*\/\//.test(line);
  }

  function movementOf(line) {
    var m = MOVEMENT_RE.exec(line);
    if (!m) return null;
    var k = m[1].toLowerCase();
    for (var i = 0; i < MOVEMENTS.length; i++) if (MOVEMENTS[i].toLowerCase() === k) return MOVEMENTS[i];
    return null;
  }

  /** Remove note lines. Only the notes go; if a removed note sat between two
      blank lines, one of those blanks goes with it so no gap is doubled. */
  function stripNotes(text) {
    var lines = String(text).split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      if (isNote(lines[i])) {
        var prevBlank = out.length > 0 && out[out.length - 1].trim() === '';
        var nextBlank = i + 1 < lines.length && lines[i + 1].trim() === '';
        if (prevBlank && nextBlank) i++; // drop the following blank too
        continue;
      }
      out.push(lines[i]);
    }
    // a note on the very first line leaves a leading blank: remove it
    while (out.length && out[0].trim() === '' && lines.length && isNote(lines[0])) out.shift();
    return out.join('\n');
  }

  function tokenize(text) {
    return String(text).replace(/[—–]/g, ' ').match(WORD_RE) || [];
  }

  /** Words in the poem proper (notes excluded). "bride-to-be" and "father’s"
      are one word; an em dash between two words separates them. */
  function countWords(text) {
    return tokenize(stripNotes(text)).length;
  }

  function wordAt(text, pos) {
    var re = /[A-Za-zÀ-ɏ]+(?:['’][A-Za-zÀ-ɏ]+)?/g;
    var m;
    while ((m = re.exec(text))) {
      var s = m.index;
      var e = s + m[0].length;
      if (pos >= s && pos <= e) return { word: m[0], start: s, end: e };
      if (s > pos) break;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Syllables (a heuristic: good enough for "about how long is this line") */
  /* ------------------------------------------------------------------ */

  var SYL_EXCEPT = {
    // words a vowel-group counter gets wrong, mostly ones this poem uses
    the: 1, are: 1, were: 1, where: 1, there: 1, here: 1, some: 1, come: 1, done: 1, gone: 1,
    one: 1, once: 1, none: 1, give: 1, live: 1, love: 1, have: 1, above: 2, whose: 1, eye: 1, eyes: 1,
    fire: 2, hour: 2, hours: 2, our: 1, your: 1, you: 1, youre: 1, "you're": 1, people: 2, poem: 2,
    heaven: 2, every: 2, evening: 2, different: 3, family: 3, interesting: 4, camera: 3, business: 2,
    chocolate: 3, comfortable: 4, vegetable: 4, favorite: 3, favourite: 3, beautiful: 3, wednesday: 2,
    // poem vocabulary
    crinkled: 2, calloused: 2, callused: 2, galilean: 4, galilee: 3, nazareth: 3, betrothed: 2,
    bethrothed: 2, righteous: 2, righteousness: 3, overshadow: 4, overshadowed: 4, overshadowing: 5,
    terrifying: 4, terrified: 3, terror: 2, divorce: 2, mercy: 2, quiet: 2, quietly: 3, secretly: 3,
    knuckles: 2, whittled: 2, whisper: 2, whispers: 2, hedge: 1, hedges: 2, tomorrow: 3, blueprint: 2,
    plumb: 1, adze: 1, shale: 1, limestone: 2, shelter: 2, courtyard: 2, lineage: 2, honor: 2,
    barely: 2, wonder: 2, resign: 2, blinding: 2, creature: 2, immanuel: 4, emmanuel: 4, jesus: 2,
    joseph: 2, mary: 2, david: 2, angel: 2, holy: 2, spirit: 2, rubble: 2, hands: 1, hand: 1,
    "father’s": 2, "father's": 2, fathers: 2, father: 2, craftsman: 2, estate: 2, silver: 2, dust: 1,
    tears: 1, joyful: 2, grasping: 2, collapses: 3, collapse: 2, conceived: 2, conceive: 2,
    human: 2, "no-one": 2, orient: 3, create: 2, created: 3, idea: 3, being: 2, seeing: 2, doing: 2,
    going: 2, saying: 2, praying: 2, trying: 2, lying: 2, dying: 2, flying: 2, buying: 2, crying: 2,
    prayer: 1, "prayers": 1, power: 2, flower: 2, tower: 2, shower: 2, higher: 2, lion: 2,
    real: 1, really: 2, area: 3, clean: 1, lean: 1, mean: 1, bean: 1, dean: 1, glean: 1, ruin: 2, poet: 2, poetry: 3, science: 2, giant: 2,
    violent: 3, diet: 2, client: 2, quiet: 2, society: 4, variety: 4, serious: 3, curious: 3,
    obvious: 3, previous: 3, various: 3, glorious: 3, victorious: 4, precious: 2, gracious: 2,
    spacious: 2, delicious: 3, anxious: 2, anxiety: 4, obey: 2, obedience: 4, obedient: 4,
    peace: 1, peaceful: 2, understand: 3, understanding: 4, beloved: 3, blessed: 1, blessing: 2,
    wicked: 1, naked: 1, learned: 1, aged: 1, beloveds: 3, cursed: 1, rugged: 1, ragged: 1
  };

  function syllables(word) {
    var raw = String(word).toLowerCase().replace(/[’]/g, "'");
    if (SYL_EXCEPT[raw] != null) return SYL_EXCEPT[raw];
    var w = raw.replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (SYL_EXCEPT[w] != null) return SYL_EXCEPT[w];
    if (w.length <= 3) return 1;

    // "-ing" is its own syllable: count the stem, add one ("laying" = lay + ing).
    if (w.length > 4 && /ing$/.test(w) && /[aeiouy]/.test(w.slice(0, -3))) {
      return syllables(w.slice(0, -3)) + 1;
    }

    var s = w;
    // silent endings: "-ed" is silent unless after t/d ("walked" vs "wanted");
    // "-es" is silent unless after s/x/z/c/g/ch/sh ("makes" vs "wishes");
    // a final "e" is silent unless it follows "l" ("stone" vs "table").
    s = s.replace(/([^aeiouyltd])ed$/, '$1');
    s = s.replace(/([^aeiouylsxzcgh])es$/, '$1');
    s = s.replace(/([^aeiouyl])e$/, '$1');
    s = s.replace(/^y/, 'i');

    var n = (s.match(/[aeiouy]+/g) || []).length;

    // vowel pairs that really are two syllables
    if (/[^tscgx]ion/.test(w)) n += 1;                                     // "lion", "million" (not "nation")
    if (/[^aeiou]ia($|[^l])/.test(w) && !/(cia|tia|gia|sia)/.test(w)) n += 1; // "media", "Maria"
    if (/ua/.test(w) && !/qua|gua/.test(w)) n += 1;                        // "ritual", "actual"
    if (w.length >= 6 && /(ea|eo)n$/.test(w)) n += 1;                      // "Korean", "Galilean"
    return n < 1 ? 1 : n;
  }

  function lineSyllables(line) {
    var total = 0;
    var toks = String(line).replace(/[—–]/g, ' ').match(/[A-Za-z0-9À-ɏ'’\-]+/g) || [];
    for (var i = 0; i < toks.length; i++) {
      var parts = toks[i].split('-');
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j].replace(/^['’]+|['’]+$/g, '');
        if (/^\d+$/.test(p)) total += 1;
        else if (p) total += syllables(p);
      }
    }
    return total;
  }

  /* ------------------------------------------------------------------ */
  /* Structure: lines, stanzas, sections, movements                       */
  /* ------------------------------------------------------------------ */

  /** One entry per line of the textarea, with character offsets. */
  function parseLines(text) {
    var out = [];
    var pos = 0;
    var raw = String(text).split('\n');
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      out.push({
        i: i,
        text: t,
        start: pos,
        end: pos + t.length,
        note: isNote(t),
        blank: t.trim() === '',
        movement: movementOf(t),
        words: isNote(t) ? 0 : tokenize(t).length,
        syl: isNote(t) ? 0 : lineSyllables(t),
      });
      pos += t.length + 1;
    }
    return out;
  }

  /** Blocks of consecutive non-blank, non-note lines. */
  function blocks(lines) {
    var out = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.note) continue;
      if (l.blank) {
        cur = null;
        continue;
      }
      if (!cur) {
        cur = { first: l.i, last: l.i, words: 0, lines: 0, text: [] };
        out.push(cur);
      }
      cur.last = l.i;
      cur.words += l.words;
      cur.lines += 1;
      cur.text.push(l.text);
    }
    return out;
  }

  function normLine(s) {
    return String(s)
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[—–]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** In this poem a one-line block ("Could you imagine that—") repeats and
      opens each movement of the poem. Find those refrains generically: a
      one-line block that appears at least twice. Each refrain starts a section;
      the blocks that follow belong to it. */
  function sections(text) {
    var lines = parseLines(text);
    var bl = blocks(lines);
    var counts = {};
    var lineCounts = {}; // how often each line appears anywhere (to find a distinctive label)
    bl.forEach(function (b) {
      if (b.lines === 1) {
        var k = normLine(b.text[0]);
        counts[k] = (counts[k] || 0) + 1;
      }
      b.text.forEach(function (t) { var n = normLine(t); lineCounts[n] = (lineCounts[n] || 0) + 1; });
    });
    var out = [];
    var cur = null;
    bl.forEach(function (b) {
      var isRefrain = b.lines === 1 && counts[normLine(b.text[0])] >= 2;
      if (isRefrain || !cur) {
        cur = { first: b.first, last: b.last, words: 0, lines: 0, refrain: isRefrain, label: '', blocks: 0 };
        out.push(cur);
      }
      cur.last = b.last;
      cur.words += b.words;
      cur.lines += b.lines;
      cur.blocks += 1;
      if (!isRefrain) {
        // label a section by its first line that appears only once in the poem
        // (stanzas that all open "Crinkled, calloused hands" need a better name)
        if (!cur.label || cur.labelIsFallback) {
          var unique = b.text.filter(function (t) { return lineCounts[normLine(t)] === 1; })[0];
          if (unique) { cur.label = unique; cur.labelIsFallback = false; }
          else if (!cur.label) { cur.label = b.text[0]; cur.labelIsFallback = true; }
        }
      }
    });
    // a trailing lone refrain with no body is the poem's closing echo
    out.forEach(function (s) {
      if (!s.label && s.refrain) s.label = '(refrain)';
    });
    return out;
  }

  /** Words per movement. A "// Recognize" style note starts a movement that
      runs until the next movement note. Words before the first note are
      untagged (null). */
  function movementTotals(text) {
    var lines = parseLines(text);
    var totals = {};
    MOVEMENTS.forEach(function (m) { totals[m] = 0; });
    var untagged = 0;
    var cur = null;
    var tagged = 0;
    lines.forEach(function (l) {
      if (l.movement) {
        cur = l.movement;
        tagged++;
        return;
      }
      if (l.note) return;
      if (cur) totals[cur] += l.words;
      else untagged += l.words;
    });
    return { totals: totals, untagged: untagged, tags: tagged };
  }

  /* ------------------------------------------------------------------ */
  /* Time                                                                 */
  /* ------------------------------------------------------------------ */

  var PACES = { slow: 110, pew: 130, brisk: 150 }; // spoken words per minute
  var LINE_PAUSE = 0.35;   // seconds at the end of each line
  var STANZA_PAUSE = 1.4;  // extra seconds at a blank line

  /** Estimated read-aloud seconds for a poem: spoken words at `wpm`, a breath
      at each line end, a longer one at each stanza break. */
  function readSeconds(text, wpm) {
    wpm = wpm || PACES.pew;
    var lines = parseLines(stripNotes(text));
    var sec = 0;
    var inPoem = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.blank) {
        if (inPoem) sec += STANZA_PAUSE;
        continue;
      }
      inPoem = true;
      sec += (l.words / wpm) * 60 + LINE_PAUSE;
    }
    return Math.round(sec);
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  var TARGET = { minWords: 250, maxWords: 300, minSec: 120, maxSec: 180 };

  /** Where the poem sits against the 250–300 word target. Plain facts, no
      judgement: "under" / "in" / "over" and by how many words. */
  function targetState(words) {
    if (words < TARGET.minWords) return { state: 'under', by: TARGET.minWords - words };
    if (words > TARGET.maxWords) return { state: 'over', by: words - TARGET.maxWords };
    return { state: 'in', by: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Plain-language ("pew") check — flags, never rewrites                 */
  /* ------------------------------------------------------------------ */

  // Words a child, a new believer or someone unfamiliar with the Bible may
  // not know. A short human list, not a dictionary: the point is a nudge.
  var UNCOMMON = {
    church: [
      'atonement', 'covenant', 'incarnation', 'incarnate', 'redemption', 'sanctify', 'sanctification',
      'justification', 'propitiation', 'providence', 'sovereign', 'sovereignty', 'epiphany', 'messiah',
      'immanuel', 'emmanuel', 'annunciation', 'righteous', 'righteousness', 'betrothed', 'bethrothed',
      'overshadow', 'overshadowed', 'overshadowing', 'conceived', 'lineage', 'begotten', 'transgression',
      'iniquity', 'salvation', 'intercession', 'consecrate', 'consecrated', 'repentance', 'gentile',
      'gentiles', 'tabernacle', 'pharisee', 'pharisees', 'galilean', 'selah', 'hosanna'
    ],
    old: ['unto', 'thee', 'thou', 'thy', 'behold', 'lo', 'verily', 'hath', 'doth', 'wherefore', 'forsake', 'forsaken'],
    craft: [
      'adze', 'plumb', 'shale', 'hewing', 'hewn', 'hewed', 'chisel', 'mortar', 'lintel', 'masonry',
      'quarry', 'limestone', 'sinew', 'sinews', 'whittled', 'whittle'
    ],
  };
  var UNCOMMON_MAP = {};
  Object.keys(UNCOMMON).forEach(function (kind) {
    UNCOMMON[kind].forEach(function (w) { UNCOMMON_MAP[w] = kind; });
  });
  var UNCOMMON_WHY = {
    church: 'a church word — may be new to some in the pew',
    old: 'an older word',
    craft: 'a tradesman’s word — you may want a picture to go with it',
    long: 'a long word to say aloud',
  };

  /** Returns flags: {line, start, end, word, kind, why} with start/end as
      character offsets into `text`. Notes are skipped. */
  function pewCheck(text) {
    var lines = parseLines(text);
    var flags = [];
    lines.forEach(function (l) {
      if (l.note || l.blank) return;
      var re = new RegExp(WORD_RE.source, 'g');
      var m;
      while ((m = re.exec(l.text))) {
        var word = m[0];
        var key = word.toLowerCase().replace(/’/g, "'");
        var kind = UNCOMMON_MAP[key];
        if (!kind && syllables(key.replace(/-/g, '')) >= 4 && key.indexOf('-') === -1) kind = 'long';
        if (kind) {
          flags.push({
            line: l.i,
            start: l.start + m.index,
            end: l.start + m.index + word.length,
            word: word,
            kind: kind,
            why: UNCOMMON_WHY[kind],
          });
        }
      }
    });
    return flags;
  }

  /** Lines that are long to say in one breath (≥ 12 words). Informational. */
  function longLines(text, limit) {
    limit = limit || 12;
    return parseLines(text).filter(function (l) { return !l.note && l.words >= limit; });
  }

  /** "Keep Jesus at the center": where the poem names him, and God at work.
      Counts and lines only — a mirror, not a verdict. */
  var CENTER_TERMS = [
    { name: 'Jesus', re: /\bjesus\b/gi },
    { name: 'Christ', re: /\bchrist\b/gi },
    { name: 'Lord', re: /\blord\b/gi },
    { name: 'God', re: /\bgod\b/gi },
    { name: 'Spirit', re: /\bspirit\b/gi },
    { name: 'Most High', re: /\bmost high\b/gi },
    { name: 'angel', re: /\bangel\b/gi },
  ];
  function centerCheck(text) {
    var lines = parseLines(text);
    return CENTER_TERMS.map(function (t) {
      var hits = [];
      lines.forEach(function (l) {
        if (l.note) return;
        var re = new RegExp(t.re.source, 'gi');
        var m;
        while ((m = re.exec(l.text))) hits.push({ line: l.i, start: l.start + m.index, end: l.start + m.index + m[0].length });
      });
      return { name: t.name, count: hits.length, hits: hits };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Comparing a reference draft with the working copy                    */
  /* ------------------------------------------------------------------ */

  /** For each line of `ref`, is it still in `cur`? ('same' | 'gone' | 'blank').
      Exact match after trimming whitespace and straightening quotes/dashes. */
  function lineStatus(ref, cur) {
    var have = {};
    String(cur).split('\n').forEach(function (l) {
      var k = normLine(l);
      if (k) have[k] = true;
    });
    return String(ref).split('\n').map(function (l) {
      var k = normLine(l);
      if (!k) return { text: l, status: 'blank' };
      return { text: l, status: have[k] ? 'same' : 'gone' };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Scripture references                                                 */
  /* ------------------------------------------------------------------ */

  /** "Matthew 1:18–25" → "matthew+1:18-25" for bible-api.com. */
  function refForApi(s) {
    return String(s)
      .replace(/[–—−]/g, '-')
      .replace(/\s*:\s*/g, ':')
      .replace(/\s*-\s*/g, '-')
      .trim()
      .replace(/\s+/g, '+')
      .toLowerCase();
  }

  /** "Matthew 1:18-25" → {book:"Matthew", chapter:1, from:18, to:25}. Best effort. */
  function parseRef(s) {
    var t = String(s).replace(/[–—−]/g, '-').trim();
    var m = /^((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/.exec(t);
    if (!m) return null;
    return {
      book: m[1].trim(),
      chapter: Number(m[2]),
      from: m[3] ? Number(m[3]) : null,
      to: m[4] ? Number(m[4]) : m[3] ? Number(m[3]) : null,
    };
  }

  return {
    MOVEMENTS: MOVEMENTS,
    PACES: PACES,
    TARGET: TARGET,
    escapeHtml: escapeHtml,
    isNote: isNote,
    movementOf: movementOf,
    stripNotes: stripNotes,
    tokenize: tokenize,
    countWords: countWords,
    wordAt: wordAt,
    syllables: syllables,
    lineSyllables: lineSyllables,
    parseLines: parseLines,
    blocks: blocks,
    sections: sections,
    movementTotals: movementTotals,
    readSeconds: readSeconds,
    formatTime: formatTime,
    targetState: targetState,
    pewCheck: pewCheck,
    longLines: longLines,
    centerCheck: centerCheck,
    lineStatus: lineStatus,
    normLine: normLine,
    refForApi: refForApi,
    parseRef: parseRef,
    LINE_PAUSE: LINE_PAUSE,
    STANZA_PAUSE: STANZA_PAUSE,
  };
});
