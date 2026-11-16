/* Poem Composer — the writing surface.

   A transparent <textarea> sits exactly over a mirror <div>. The textarea gives
   native typing, undo, selection and the caret; the mirror draws the glyphs and
   everything extra: dimmed private notes, the spotlight, syllable counts,
   plain-language marks, the word being replaced. Because the two must wrap
   identically, mirror styles may change only colour, opacity and underline,
   never size, weight, spacing or padding. */
(function () {
  'use strict';

  var ta, mirror;
  var opts = { syl: false, pew: false, spotlight: false, typewriter: true };
  var target = null;      // {start,end}: the word a thesaurus click will replace
  var flashMark = null;   // {start,end}: brief highlight after a jump
  var flashTimer = 0;
  var cached = [];        // parsed lines from the last render
  var raf = 0;
  var listeners = { change: [], selection: [] };
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function on(ev, fn) { listeners[ev].push(fn); }
  function emit(ev, a) { listeners[ev].forEach(function (fn) { fn(a); }); }

  /* ---------------- rendering ---------------- */

  function lineAt(lines, pos) {
    var lo = 0, hi = lines.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (lines[mid].start <= pos) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function segmentLine(l, marks) {
    var inLine = marks.filter(function (m) { return m.end > l.start && m.start < l.end + 0.5 && m.end > m.start; });
    if (!inLine.length) return PC.escapeHtml(l.text) || '​';
    var cuts = { 0: true };
    cuts[l.text.length] = true;
    inLine.forEach(function (m) {
      cuts[Math.max(0, m.start - l.start)] = true;
      cuts[Math.min(l.text.length, m.end - l.start)] = true;
    });
    var pts = Object.keys(cuts).map(Number).sort(function (a, b) { return a - b; });
    var html = '';
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (b <= a) continue;
      var cls = inLine
        .filter(function (m) { return m.start - l.start <= a && m.end - l.start >= b; })
        .map(function (m) { return m.cls; })
        .join(' ');
      var chunk = PC.escapeHtml(l.text.slice(a, b));
      html += cls ? '<span class="' + cls + '">' + chunk + '</span>' : chunk;
    }
    return html || '​';
  }

  function render() {
    raf = 0;
    var text = ta.value;
    var lines = PC.parseLines(text);
    cached = lines;
    var caret = lineAt(lines, ta.selectionStart);

    var cur = null;
    if (opts.spotlight) {
      var secs = PC.sections(text);
      for (var i = 0; i < secs.length; i++) if (secs[i].first <= caret) cur = secs[i];
      if (cur) {
        // the section runs from its first line to the line before the next one
        var next = secs[secs.indexOf(cur) + 1];
        cur = { first: cur.first, last: next ? next.first - 1 : lines.length - 1 };
      }
    }

    var marks = [];
    if (opts.pew) {
      PC.pewCheck(text).forEach(function (f) { marks.push({ start: f.start, end: f.end, cls: 'm-pew' }); });
    }
    if (target) marks.push({ start: target.start, end: target.end, cls: 'm-target' });
    if (flashMark) marks.push({ start: flashMark.start, end: flashMark.end, cls: 'm-flash' });

    var html = '';
    for (var k = 0; k < lines.length; k++) {
      var l = lines[k];
      var cls = 'ln';
      if (l.note) cls += ' note';
      if (l.movement) cls += ' mv';
      if (cur && !l.note && (l.i < cur.first || l.i > cur.last)) cls += ' dim';
      else if (cur && l.note && (l.i < cur.first || l.i > cur.last)) cls += ' dim';
      var inner = segmentLine(l, marks);
      if (opts.syl && !l.note && !l.blank) inner += '<span class="ct" aria-hidden="true">' + l.syl + '</span>';
      html += '<div class="' + cls + '">' + inner + '</div>';
    }
    mirror.innerHTML = html;
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  function autosize() {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  /* ---------------- caret geometry ---------------- */

  function locate(div, off, empty) {
    if (empty) return { node: div.firstChild, offset: 0 };
    var walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return n.parentNode.closest && n.parentNode.closest('.ct') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    var n, seen = 0, last = null;
    while ((n = walker.nextNode())) {
      last = n;
      if (off <= seen + n.nodeValue.length) return { node: n, offset: off - seen };
      seen += n.nodeValue.length;
    }
    return last ? { node: last, offset: last.nodeValue.length } : null;
  }

  /** Viewport rect of the caret (or of a given character offset). */
  function rectAt(pos) {
    if (!cached.length) return null;
    var l = cached[lineAt(cached, pos)];
    var div = mirror.children[l.i];
    if (!div) return null;
    var loc = locate(div, pos - l.start, l.text === '');
    var rect = null;
    if (loc && loc.node) {
      var r = document.createRange();
      try {
        r.setStart(loc.node, Math.min(loc.offset, loc.node.nodeValue.length));
        r.collapse(true);
        rect = r.getClientRects()[0] || null;
      } catch (e) { rect = null; }
    }
    if (!rect || (!rect.height && !rect.width)) rect = div.getBoundingClientRect();
    return rect;
  }

  function scrollTo(top) {
    window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  /** Typewriter: when the line you're writing sinks below ~42% of the window,
      scroll so it stays there. Otherwise leave the page still. */
  function keepCaretInView() {
    var rect = rectAt(ta.selectionEnd);
    if (!rect) return;
    var vh = window.innerHeight;
    var want = vh * 0.42;
    if (opts.typewriter) {
      if (rect.top > want + 6 || rect.top < 56) scrollTo(window.scrollY + rect.top - want);
    } else if (rect.bottom > vh - 90 || rect.top < 40) {
      scrollTo(window.scrollY + rect.top - want);
    }
  }

  /** Bring an offset to the middle of the window (used by "go to this line"). */
  function scrollToOffset(pos) {
    var rect = rectAt(pos);
    if (!rect) return;
    scrollTo(window.scrollY + rect.top - window.innerHeight * 0.4);
  }

  /* ---------------- editing (always undoable) ---------------- */

  /** Replace [start,end) with text. Goes through execCommand so ⌘Z undoes it
      like any typing; falls back to setRangeText where that is unavailable. */
  function replaceRange(start, end, text) {
    var before = ta.value;
    var expected = before.slice(0, start) + text + before.slice(end);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
    var ok = false;
    try {
      ok = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text);
    } catch (e) { ok = false; }
    if (!ok || ta.value !== expected) {
      if (ta.value !== before) { ta.value = before; }
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { start: start, end: start + text.length };
  }

  function getText() { return ta.value; }
  function setText(text) { return replaceRange(0, ta.value.length, text); }
  function selection() { return { start: ta.selectionStart, end: ta.selectionEnd }; }
  function setSelection(a, b) { ta.setSelectionRange(a, b === undefined ? a : b); schedule(); }
  function focus() { ta.focus({ preventScroll: true }); }
  function insertAtCaret(text) { return replaceRange(ta.selectionStart, ta.selectionEnd, text); }

  /** Put a whole new line above the line the caret is on. */
  function insertLineAbove(text) {
    var l = cached[lineAt(cached, ta.selectionStart)];
    var pos = l ? l.start : 0;
    return replaceRange(pos, pos, text + '\n');
  }

  function selectRange(a, b, scroll) {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(a, b);
    render();
    if (scroll !== false) scrollToOffset(a);
    flash(a, b);
  }

  function flash(a, b) {
    flashMark = { start: a, end: b };
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashMark = null; schedule(); }, 1600);
    schedule();
  }

  function lineIndexAt(pos) { return lineAt(cached.length ? cached : PC.parseLines(ta.value), pos); }
  function lines() { return cached; }

  /** The word being worked on: the selection if there is one, else the word under the caret. */
  function wordUnderCaret() {
    var a = ta.selectionStart, b = ta.selectionEnd;
    var v = ta.value;
    if (b > a) {
      var sel = v.slice(a, b);
      if (sel.trim() && sel.length <= 60 && sel.indexOf('\n') === -1) {
        var lead = sel.length - sel.replace(/^\s+/, '').length;
        var trimmed = sel.trim();
        return { word: trimmed, start: a + lead, end: a + lead + trimmed.length, selected: true };
      }
      return null;
    }
    var w = PC.wordAt(v, a);
    return w ? { word: w.word, start: w.start, end: w.end, selected: false } : null;
  }

  function setTarget(t) { target = t ? { start: t.start, end: t.end } : null; schedule(); }
  function getTarget() { return target; }

  function setOptions(o) {
    Object.keys(o).forEach(function (k) {
      if (k === 'spell') { ta.spellcheck = !!o[k]; ta.setAttribute('spellcheck', o[k] ? 'true' : 'false'); }
      else opts[k] = o[k];
    });
    document.documentElement.classList.toggle('show-syl', !!opts.syl);
    document.documentElement.classList.toggle('show-pew', !!opts.pew);
    document.documentElement.classList.toggle('spotlight', !!opts.spotlight);
    render();
  }

  function init(textarea, mirrorEl, initialText, caret) {
    ta = textarea;
    mirror = mirrorEl;
    ta.value = initialText;
    if (caret) { try { ta.setSelectionRange(caret[0], caret[1]); } catch (e) { /* ignore */ } }
    autosize();
    render();

    ta.addEventListener('input', function () {
      autosize();
      render();
      keepCaretInView();
      emit('change');
    });
    ['keyup', 'mouseup', 'focus', 'select'].forEach(function (ev) {
      ta.addEventListener(ev, function () { schedule(); emit('selection'); });
    });
    document.addEventListener('selectionchange', function () {
      if (document.activeElement === ta) { schedule(); emit('selection'); }
    });
    // arrow keys move the caret without an input event: keep it in view
    ta.addEventListener('keydown', function (e) {
      if (/^(Arrow|Page|Home$|End$)/.test(e.key)) setTimeout(function () { keepCaretInView(); }, 0);
    });

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () { autosize(); schedule(); }).observe(ta.parentNode);
    }
    window.addEventListener('resize', function () { autosize(); schedule(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { autosize(); render(); });
  }

  window.Editor = {
    init: init, on: on, render: render, schedule: schedule, autosize: autosize,
    getText: getText, setText: setText, replaceRange: replaceRange, insertAtCaret: insertAtCaret,
    insertLineAbove: insertLineAbove, selection: selection, setSelection: setSelection, selectRange: selectRange,
    focus: focus, setOptions: setOptions, setTarget: setTarget, getTarget: getTarget, flash: flash,
    wordUnderCaret: wordUnderCaret, lines: lines, lineIndexAt: lineIndexAt, rectAt: rectAt,
    scrollToOffset: scrollToOffset, keepCaretInView: keepCaretInView,
  };
})();
