/* Poem Composer — wiring: state, autosave, status bar, shortcuts, palette. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  var MOD = isMac ? '⌘' : 'Ctrl+';
  var ALT = isMac ? '⌥' : 'Alt+';

  var S = Store.load();
  var api = Api.create({ originTag: Api.originTag(location) });
  var listeners = {};
  var dirty = false;
  var saveTimer = 0;
  var lastSnapshotText = S.snapshots[0] ? S.snapshots[0].text : null;

  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, a) { (listeners[ev] || []).forEach(function (fn) { fn(a); }); }

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */

  var toastTimer = 0;
  function toast(msg, o) {
    o = o || {};
    var el = $('toast');
    el.textContent = '';
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    (o.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      b.addEventListener('click', function () { hideToast(); a.fn(); });
      el.appendChild(b);
    });
    el.classList.add('show');
    clearTimeout(toastTimer);
    if (!o.sticky) toastTimer = setTimeout(hideToast, o.ms || (o.actions ? 7000 : 2600));
  }
  function hideToast() { $('toast').classList.remove('show'); clearTimeout(toastTimer); }

  /* ------------------------------------------------------------------ */
  /* Settings & theme                                                    */
  /* ------------------------------------------------------------------ */

  var darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function resolvedTheme() {
    var t = S.settings.theme;
    if (t === 'auto') return darkMQ && darkMQ.matches ? 'night' : 'paper';
    return t;
  }
  function applyTheme() { document.documentElement.setAttribute('data-theme', resolvedTheme()); }
  if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', applyTheme);

  function applySettings() {
    Editor.setOptions({
      syl: S.settings.syl,
      pew: S.settings.pew,
      spotlight: S.settings.spotlight,
      typewriter: S.settings.typewriter,
      spell: S.settings.spell,
    });
    applyTheme();
    body.classList.toggle('pin-hud', !!S.settings.pinHud);
    if (S.settings.pinHud) hudShow(); else if (!hudHover) hudHide();
    emit('settings');
  }

  function setSetting(k, v) {
    S.settings[k] = v;
    applySettings();
    saveSoon();
  }
  function toggle(k) { setSetting(k, !S.settings[k]); return S.settings[k]; }

  /* ------------------------------------------------------------------ */
  /* Saving                                                              */
  /* ------------------------------------------------------------------ */

  function setSaveLabel(kind) {
    var el = $('hud-save');
    el.classList.toggle('warn', kind === 'warn');
    el.textContent = kind === 'saved' ? 'Saved' : kind === 'saving' ? 'Saving…' : kind === 'warn' ? 'Not saved — export it' : '';
    el.title = kind === 'warn'
      ? 'This browser would not store the poem. Use Export (' + ALT + 'X) to keep a copy.'
      : 'Saved on this device as you write';
  }

  function saveNow() {
    clearTimeout(saveTimer);
    S.text = Editor.getText();
    var sel = Editor.selection();
    S.caret = [sel.start, sel.end];
    S.scrollTop = Math.round(window.scrollY);
    var ok = Store.save(S);
    dirty = false;
    setSaveLabel(ok ? 'saved' : 'warn');
    if (!ok) toast('This browser would not store your poem. Please export a copy (' + ALT + 'X).', { sticky: true });
  }
  function saveSoon() {
    dirty = true;
    setSaveLabel('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 450);
  }

  /** Keep a recoverable copy when the text has moved on. */
  function snapshot(label, auto, dedupe) {
    S.text = Editor.getText();
    var snap = Store.snapshot(S, label, auto, undefined, dedupe);
    if (snap) { lastSnapshotText = S.text; saveNow(); }
    return snap;
  }
  setInterval(function () {
    if (Editor.getText() !== lastSnapshotText && Editor.getText().trim()) snapshot('', true);
  }, 4 * 60 * 1000);

  /** Replace the whole poem (an undoable edit), keeping the old one as a snapshot. */
  function restoreText(text, label) {
    snapshot('Before ' + (label || 'restore'), false);
    Editor.setText(text);
    Editor.setSelection(0, 0);
    window.scrollTo(0, 0);
    saveNow();
    toast('Restored ' + (label || 'that version') + '.', {
      actions: [{ label: 'Undo', fn: function () { Editor.focus(); document.execCommand('undo'); } }],
    });
  }

  /** Take another state (a backup, or the other tab's). What is here now is kept
      as a snapshot first, and the snapshot lists are merged, so nothing is lost. */
  function adopt(theirs, label) {
    snapshot(label, false);
    var have = {};
    S.snapshots.forEach(function (s) { have[s.id] = true; });
    var merged = S.snapshots.concat(theirs.snapshots.filter(function (s) { return !have[s.id]; }));
    merged.sort(function (x, y) { return y.t - x.t; });
    theirs.snapshots = merged.slice(0, 40);
    S = theirs;
    Editor.setText(theirs.text);
    Editor.setSelection(0, 0);
    window.scrollTo(0, 0);
    applySettings();
    saveNow();
  }
  function importBackup(theirs) {
    adopt(theirs, 'Before importing a backup');
    toast('Backup restored. What you had before is in your snapshots.');
  }

  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveNow(); });
  window.addEventListener('beforeunload', function () { if (dirty) saveNow(); });

  Store.onExternalChange(function () { return S; }, function (theirs) {
    toast('This poem was changed in another tab.', {
      sticky: true,
      actions: [
        { label: 'Use that version', fn: function () { adopt(theirs, 'Before switching to the other tab'); } },
        { label: 'Keep this one', fn: function () { Store.snapshot(S, 'From another tab', false, theirs.text); saveNow(); toast('Kept this one. The other tab’s version is in your snapshots.'); } },
      ],
    });
  });

  /* ------------------------------------------------------------------ */
  /* Status bar (appears on pointer move, hides while you type)           */
  /* ------------------------------------------------------------------ */

  var hudTimer = 0;
  var hudHover = false;
  var lastKey = 0;

  function hudShow(ms) {
    body.classList.add('hud-on');
    clearTimeout(hudTimer);
    if (!S.settings.pinHud) hudTimer = setTimeout(hudHide, ms || 2800);
  }
  function hudHide() {
    if (S.settings.pinHud && !body.classList.contains('typing')) return;
    if (hudHover) { hudTimer = setTimeout(hudHide, 1200); return; }
    body.classList.remove('hud-on');
  }
  $('hud').addEventListener('pointerenter', function () { hudHover = true; });
  $('hud').addEventListener('pointerleave', function () { hudHover = false; });
  var lastMove = 0;
  window.addEventListener('pointermove', function (e) {
    var now = Date.now();
    if (now - lastMove < 80) return;
    lastMove = now;
    if (now - lastKey < 900) return; // pointer jitter while typing shouldn't pop the bar up
    if (e.pointerType === 'touch') return;
    hudShow();
  }, { passive: true });
  window.addEventListener('keydown', function (e) {
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      lastKey = Date.now();
      if (!S.settings.pinHud) { clearTimeout(hudTimer); body.classList.remove('hud-on'); }
    }
  }, true);

  function updateStats() {
    var text = Editor.getText();
    var words = PC.countWords(text);
    var st = PC.targetState(words);
    var sec = PC.readSeconds(text, S.settings.pace);
    $('hud-words').textContent = words + (words === 1 ? ' word' : ' words');
    var t = $('hud-target');
    t.className = 'hud-target ' + st.state;
    t.textContent = st.state === 'in' ? 'in the 250–300' : st.state === 'under' ? 'aim 250–300' : st.by + ' past 300';
    $('hud-time').textContent = words ? '≈ ' + PC.formatTime(sec) + ' aloud' : '';
    var hud = $('hud');
    hud.classList.remove('t-under', 't-in', 't-over');
    hud.classList.add('t-' + st.state);
    $('hud-meter').style.setProperty('--p', Math.min(1, words / 360).toFixed(3));
    emit('stats', { words: words, state: st, seconds: sec });
  }
  $('hud-count').addEventListener('click', function () { openPanel('check'); });
  $('hud-menu').addEventListener('click', function () { Palette.open(); });

  Editor.on('change', function () {
    saveSoon();
    updateStats();
    emit('change');
  });
  Editor.on('selection', function () { emit('selection'); });

  /* ------------------------------------------------------------------ */
  /* Panels                                                              */
  /* ------------------------------------------------------------------ */

  function openPanel(name, arg) { Palette.close(true); if (Rehearse.isOpen()) Rehearse.exit(true); Panels.open(name, arg); }
  function closePanel() { Panels.close(); }

  /* ------------------------------------------------------------------ */
  /* Writing helpers used by panels                                      */
  /* ------------------------------------------------------------------ */

  /** Add a private "// Recognize" style line above the current line (or relabel it). */
  function markMovement(name) {
    var sel = Editor.selection();
    var l = Editor.lines()[Editor.lineIndexAt(sel.start)];
    if (l && l.movement) Editor.replaceRange(l.start, l.end, '// ' + name);
    else Editor.insertLineAbove('// ' + name);
    toast('Marked “' + name + '” — a private note: not counted, read aloud or exported.');
  }
  function addNote() {
    var r = Editor.insertLineAbove('// ');
    Editor.setSelection(r.end - 1);
  }

  /* ------------------------------------------------------------------ */
  /* Commands & palette                                                  */
  /* ------------------------------------------------------------------ */

  function fullscreen() {
    var d = document, el = d.documentElement;
    var cur = d.fullscreenElement || d.webkitFullscreenElement;
    if (cur) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      var p = req.call(el);
      if (p && p.catch) p.catch(function () { toast('The browser would not go full screen from here. Try the green button or ⌃⌘F.'); });
    } else toast('This browser has no full-screen mode for pages.');
  }

  function stateOf(k) { return S.settings[k]; }

  var COMMANDS = [
    { id: 'verse', label: 'Verse lookup', hint: 'Scripture: Matthew 1:18–25, the Week 3 texts, Luke 1', key: 'V', run: function () { openPanel('verse'); } },
    { id: 'words', label: 'Thesaurus', hint: 'words like the one under your cursor', key: 'T', run: function () { openPanel('words', { tab: 'similar' }); } },
    { id: 'rhymes', label: 'Rhymes and sounds-like', hint: 'rhymes, near rhymes, what a word sounds like', key: 'R', run: function () { openPanel('words', { tab: 'rhymes' }); } },
    { id: 'drafts', label: 'Drafts and snapshots', hint: 'your four drafts beside this one; restore a version', key: 'D', run: function () { openPanel('drafts'); } },
    { id: 'brief', label: 'The brief', hint: 'Week 3: Joseph, Peace; the five movements; the guidelines', key: 'B', run: function () { openPanel('brief'); } },
    { id: 'check', label: 'Check', hint: 'length against 250–300, shape, plain language', key: 'C', run: function () { openPanel('check'); } },
    { id: 'aloud', label: 'Read it aloud', hint: 'large type, paced, or spoken by your computer', key: 'A', run: function () { Panels.close(true); Palette.close(true); Rehearse.open(); } },
    { id: 'export', label: 'Export, print, back up', hint: '.txt, .md, copy, print for the lectern', key: 'X', run: function () { openPanel('export'); } },
    { sep: 'On the page' },
    { id: 'syl', label: 'Syllables in the margin', hint: 'about how long each line is', key: 'L', toggle: 'syl', run: function () { toggle('syl'); } },
    { id: 'pew', label: 'Mark words that may trip the pew', hint: 'church words, old words, long words; never rewrites', key: 'P', toggle: 'pew', run: function () { toggle('pew'); } },
    { id: 'spotlight', label: 'Spotlight this section', hint: 'dim everything but the part you are in', key: 'S', toggle: 'spotlight', run: function () { toggle('spotlight'); } },
    { id: 'night', label: 'Night / paper', hint: 'switch the light', key: 'M', run: function () { setSetting('theme', resolvedTheme() === 'night' ? 'paper' : 'night'); } },
    { id: 'fullscreen', label: 'Full screen', hint: 'the page and nothing else', key: 'F', run: fullscreen },
    { id: 'peek', label: 'Peek at the word count', hint: 'shows the quiet bar for a moment', key: 'W', run: function () { hudShow(4500); } },
    { id: 'typewriter', label: 'Typewriter scrolling', hint: 'keeps the line you are writing near the middle', toggle: 'typewriter', run: function () { toggle('typewriter'); } },
    { id: 'spell', label: 'Spellcheck squiggles', hint: 'off by default, to stay calm', toggle: 'spell', run: function () { toggle('spell'); } },
    { id: 'pin', label: 'Keep the word count showing', hint: 'instead of only on pointer move', toggle: 'pinHud', run: function () { toggle('pinHud'); } },
    { id: 'theme-auto', label: 'Theme: follow my computer', hint: 'light by day, dark by night', run: function () { setSetting('theme', 'auto'); toast('Following your computer’s light / dark setting.'); } },
    { sep: 'Mark this part against the five movements' },
    { id: 'mv-Recognize', label: 'Mark: Recognize', hint: 'what human experience are we naming?', run: function () { markMovement('Recognize'); } },
    { id: 'mv-Remember', label: 'Mark: Remember', hint: 'what does Scripture reveal?', run: function () { markMovement('Remember'); } },
    { id: 'mv-Reframe', label: 'Mark: Reframe', hint: 'what changes when we see God clearly?', run: function () { markMovement('Reframe'); } },
    { id: 'mv-Respond', label: 'Mark: Respond', hint: 'what are we invited to do?', run: function () { markMovement('Respond'); } },
    { id: 'mv-Rest', label: 'Mark: Rest', hint: 'what truth can we carry with us?', run: function () { markMovement('Rest'); } },
    { id: 'note', label: 'Add a private note here', hint: 'a line starting // is never counted, read aloud or exported', run: addNote },
    { id: 'snapshot', label: 'Save a snapshot now', hint: 'a point you can come back to', run: function () { if (snapshot('Snapshot', false, true)) toast('Snapshot saved.'); else toast('Nothing new since the last snapshot.'); } },
  ];

  var Palette = (function () {
    var el = $('palette'), input = $('palette-q'), list = $('palette-list');
    var items = [], active = 0, opener = null;

    function keyLabel(c) { return c.key ? ALT + c.key : ''; }

    function build(q) {
      q = q.trim().toLowerCase();
      var toks = q.split(/\s+/).filter(Boolean);
      var out = [];
      var ref = PC.parseRef(q.replace(/\s+/g, ' '));
      if (q && ref && /[a-z]/i.test(ref.book) && ref.chapter) {
        var shown = q.replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
        out.push({ label: 'Look up ' + shown, hint: 'scripture', run: function () { openPanel('verse', { ref: q }); } });
      }
      var pendingSep = null;
      COMMANDS.forEach(function (c) {
        if (c.sep) { pendingSep = c; return; }
        var hay = (c.label + ' ' + (c.hint || '') + ' ' + c.id).toLowerCase();
        if (toks.every(function (t) { return hay.indexOf(t) > -1; })) {
          if (pendingSep && !q) out.push({ sep: pendingSep.sep });
          pendingSep = null;
          out.push(c);
        }
      });
      if (/^[a-z][a-z'’-]{1,30}$/i.test(q)) {
        out.push({ label: 'Words like “' + q + '”', hint: 'thesaurus', run: function () { openPanel('words', { tab: 'similar', word: q }); } });
        out.push({ label: 'Rhymes with “' + q + '”', hint: 'rhymes', run: function () { openPanel('words', { tab: 'rhymes', word: q }); } });
      }
      return out;
    }

    function paint() {
      list.innerHTML = '';
      items.forEach(function (c, i) {
        var li = document.createElement('li');
        if (c.sep) { li.className = 'sep'; li.textContent = c.sep; list.appendChild(li); return; }
        li.setAttribute('role', 'option');
        if (i === active) li.className = 'active';
        var left = document.createElement('span');
        left.appendChild(document.createTextNode(c.label));
        if (c.hint) { var d = document.createElement('span'); d.className = 'd'; d.textContent = c.hint; left.appendChild(d); }
        var right = document.createElement('span');
        right.className = 'k';
        if (c.toggle) { right.textContent = (stateOf(c.toggle) ? 'on' : 'off') + (c.key ? '  ' : ''); }
        if (c.key) { var k = document.createElement('kbd'); k.textContent = keyLabel(c); right.appendChild(k); }
        li.appendChild(left);
        li.appendChild(right);
        li.addEventListener('mousemove', function () { if (active !== i) { active = i; paintActive(); } });
        li.addEventListener('click', function () { go(i); });
        list.appendChild(li);
      });
      var a = list.querySelector('.active');
      if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
    }
    function paintActive() {
      var lis = list.children;
      for (var i = 0; i < lis.length; i++) lis[i].classList.toggle('active', i === active);
    }
    function firstReal(from, dir) {
      var i = from;
      while (i >= 0 && i < items.length && items[i].sep) i += dir;
      return i >= 0 && i < items.length ? i : from;
    }
    function go(i) {
      var c = items[i];
      if (!c || c.sep) return;
      close(true);
      c.run();
    }
    function open() {
      if (!el.hidden) return;
      opener = document.activeElement;
      el.hidden = false;
      input.value = '';
      items = build('');
      active = firstReal(0, 1);
      paint();
      input.focus();
    }
    function close(silent) {
      if (el.hidden) return;
      el.hidden = true;
      if (!silent) { (opener && opener.focus ? opener : $('editor')).focus({ preventScroll: true }); }
    }
    input.addEventListener('input', function () {
      items = build(input.value);
      active = firstReal(0, 1);
      paint();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = firstReal(Math.min(active + 1, items.length - 1), 1); if (items[active] && items[active].sep) active = firstReal(active, -1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); var n = active - 1; while (n >= 0 && items[n].sep) n--; if (n >= 0) active = n; paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); go(active); }
    });
    el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    return { open: open, close: close, toggle: function () { el.hidden ? open() : close(); }, isOpen: function () { return !el.hidden; } };
  })();

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                            */
  /* ------------------------------------------------------------------ */

  var ALT_KEYS = {};
  COMMANDS.forEach(function (c) { if (c.key) ALT_KEYS['Key' + c.key] = c; });

  window.addEventListener('keydown', function (e) {
    if (e.isComposing) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
      e.preventDefault();
      Palette.toggle();
      return;
    }
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && ALT_KEYS[e.code]) {
      e.preventDefault();
      ALT_KEYS[e.code].run();
      return;
    }
    if (e.key === 'Escape') {
      if (Palette.isOpen()) { e.preventDefault(); Palette.close(); }
      else if (Rehearse.isOpen()) { e.preventDefault(); Rehearse.exit(); }
      else if (Panels.isOpen()) { e.preventDefault(); Panels.close(); }
      else if ($('toast').classList.contains('show')) hideToast();
    }
  }, true);

  /* ------------------------------------------------------------------ */
  /* Public surface for panels                                           */
  /* ------------------------------------------------------------------ */

  window.App = {
    get S() { return S; },
    api: api,
    on: on,
    toast: toast,
    hideToast: hideToast,
    save: saveSoon,
    saveNow: saveNow,
    setSetting: setSetting,
    toggle: toggle,
    snapshot: snapshot,
    restoreText: restoreText,
    importBackup: importBackup,
    openPanel: openPanel,
    markMovement: markMovement,
    updateStats: updateStats,
    mod: MOD,
    alt: ALT,
    isMac: isMac,
    commands: COMMANDS,
    hudShow: hudShow,
  };

  /* ------------------------------------------------------------------ */
  /* Go                                                                  */
  /* ------------------------------------------------------------------ */

  Editor.init($('editor'), $('mirror'), S.text, S.caret);
  document.documentElement.classList.add('enhanced');
  applySettings();
  updateStats();
  $('hud-menu').firstElementChild.textContent = MOD + 'K';
  setSaveLabel('saved');
  Panels.init();
  Rehearse.init();

  // restore where you were; first run opens at the top with the caret at the start
  requestAnimationFrame(function () {
    $('editor').focus({ preventScroll: true });
    if (S.scrollTop) window.scrollTo(0, S.scrollTop);
  });
  // take the first snapshot so the very first edit can always be undone to the start
  if (!S.snapshots.length) { Store.snapshot(S, 'Draft 4 as first opened', true); lastSnapshotText = S.text; Store.save(S); }
})();
