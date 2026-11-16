/* Poem Composer — read it aloud.

   The poem in large type, one line lit at a time, so Cody hears (or paces) it
   the way the congregation will. Two ways to rehearse:
     Pace    silent: lines light up at reading pace; you read along and speak
     Listen  your computer's voice reads it, a line at a time, with the breaths
   A clock runs either way, and at the end it says how the time sits against
   the brief's 2–3 minutes. Private // notes are never shown or spoken. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el, poemEl, playBtn, clockEl, estEl, noteEl, voiceSel, voiceWrap, modePace, modeListen;
  var lines = [];
  var rows = [];
  var idx = -1;
  var playing = false;
  var timer = 0;
  var clockTimer = 0;
  var idleTimer = 0;
  var noteTimer = 0;
  var elapsed = 0;       // ms accumulated before the current play stretch
  var startedAt = 0;
  var token = 0;         // invalidates stale speech / timer callbacks
  var opened = false;
  var voices = [];
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TTS_FOR_PACE = { 110: 0.72, 130: 0.85, 150: 1.0 };

  /** A real engine, not just the property: hardened browsers can define it as undefined. */
  function canSpeak() {
    var ss = window.speechSynthesis;
    return !!ss && typeof ss.speak === 'function' && typeof ss.getVoices === 'function' &&
      typeof window.SpeechSynthesisUtterance === 'function';
  }
  function settings() { return App.S.settings; }

  function build() {
    var raw = PC.stripNotes(Editor.getText()).split('\n');
    lines = [];
    var gap = false;
    raw.forEach(function (t) {
      if (t.trim() === '') { if (lines.length) gap = true; return; }
      lines.push({ text: t.replace(/\s+$/, ''), words: PC.tokenize(t).length, gap: gap });
      gap = false;
    });
    poemEl.textContent = '';
    rows = lines.map(function (l, i) {
      var s = document.createElement('span');
      s.className = 'rl' + (l.gap ? ' gap' : '');
      s.textContent = l.text;
      s.addEventListener('click', function () { go(i); });
      poemEl.appendChild(s);
      return s;
    });
  }

  /* ---------------- timing ---------------- */

  function lineMs(i) {
    var l = lines[i];
    var wpm = settings().pace || PC.PACES.pew;
    var next = lines[i + 1];
    var sec = (l.words / wpm) * 60 + PC.LINE_PAUSE + (next && next.gap ? PC.STANZA_PAUSE : 0);
    return Math.max(400, sec * 1000);
  }

  function pauseAfterMs(i) {
    var next = lines[i + 1];
    var rate = settings().ttsRate || 0.85;
    return ((PC.LINE_PAUSE + (next && next.gap ? PC.STANZA_PAUSE : 0)) * 1000) / Math.max(0.6, rate);
  }

  function nowElapsed() { return elapsed + (playing ? Date.now() - startedAt : 0); }

  function paintClock() { clockEl.textContent = PC.formatTime(nowElapsed() / 1000); }

  function paintEst() {
    var sec = PC.readSeconds(PC.stripNotes(Editor.getText()), settings().pace);
    estEl.textContent = 'aim 2:00–3:00 · est. ' + PC.formatTime(sec);
  }

  /* ---------------- speech ---------------- */

  function loadVoices() {
    if (!canSpeak()) return;
    voices = window.speechSynthesis.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
    voiceSel.textContent = '';
    voices.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.name + (v.lang ? ' (' + v.lang + ')' : '');
      voiceSel.appendChild(o);
    });
    var want = settings().voice;
    if (want && voices.some(function (v) { return v.name === want; })) voiceSel.value = want;
    else if (voices.length) {
      // a calm default if the computer has one; otherwise whatever it offers first
      var pref = ['Samantha', 'Ava', 'Daniel', 'Karen', 'Serena', 'Moira'];
      var pick = voices.filter(function (v) { return pref.indexOf(v.name.split(' ')[0]) > -1; })[0] || voices[0];
      voiceSel.value = pick.name;
    }
  }

  function speakLine(i, my) {
    var u = new window.SpeechSynthesisUtterance(lines[i].text.replace(/[—–]/g, ', '));
    u.rate = settings().ttsRate || 0.85;
    var name = voiceSel.value;
    var v = voices.filter(function (x) { return x.name === name; })[0];
    if (v) { u.voice = v; u.lang = v.lang; }
    var done = false;
    function after() {
      if (done || my !== token || !playing) return;
      done = true;
      timer = setTimeout(function () { if (my === token && playing) advance(my); }, pauseAfterMs(i));
    }
    u.onend = after;
    u.onerror = after;
    window.speechSynthesis.speak(u);
  }

  function stopSpeech() {
    if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  }

  /* ---------------- playback ---------------- */

  function show(i) {
    idx = i;
    poemEl.classList.toggle('fresh', i < 0);
    rows.forEach(function (r, k) {
      r.classList.toggle('cur', k === i);
      r.classList.toggle('past', i >= 0 && k < i);
    });
    if (i >= 0 && rows[i]) {
      var top = rows[i].offsetTop - el.clientHeight * 0.42;
      el.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }

  function schedule() {
    clearTimeout(timer);
    stopSpeech();
    token++;
    var my = token;
    if (!playing || idx < 0 || idx >= lines.length) return;
    if (settings().mode === 'listen' && canSpeak()) speakLine(idx, my);
    else timer = setTimeout(function () { if (my === token && playing) advance(my); }, lineMs(idx));
  }

  function advance(my) {
    if (my !== token || !playing) return;
    if (idx + 1 >= lines.length) { finish(); return; }
    show(idx + 1);
    schedule();
  }

  function finish() {
    var total = nowElapsed() / 1000;
    pause(true);
    var min = PC.TARGET.minSec, max = PC.TARGET.maxSec;
    var msg = PC.formatTime(total) + (total < min ? ' — a touch under 2 minutes.' : total > max ? ' — a little past 3 minutes.' : ' — inside the 2–3 minutes.');
    say(msg, 9000);
    playBtn.textContent = 'Play again';
    idx = lines.length; // so Play restarts
  }

  function say(msg, ms) {
    noteEl.textContent = msg;
    noteEl.classList.add('show');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { noteEl.classList.remove('show'); }, ms || 3500);
  }

  function play() {
    if (!lines.length) { say('Nothing to read yet.'); return; }
    if (idx < 0 || idx >= lines.length) { idx = 0; elapsed = 0; show(0); }
    if (settings().mode === 'listen' && !canSpeak()) {
      App.setSetting('mode', 'pace');
      paintMode();
      say('This browser can’t speak aloud, so I’ve switched to Pace.');
    }
    playing = true;
    startedAt = Date.now();
    playBtn.textContent = 'Pause';
    clearInterval(clockTimer);
    clockTimer = setInterval(paintClock, 250);
    schedule();
    bumpIdle();
  }

  function pause(silent) {
    if (playing) { elapsed += Date.now() - startedAt; }
    playing = false;
    clearTimeout(timer);
    clearInterval(clockTimer);
    token++;
    stopSpeech();
    paintClock();
    if (!silent) playBtn.textContent = idx >= lines.length ? 'Play again' : 'Play';
    el.classList.remove('idle');
  }

  function toggle() { playing ? pause() : play(); }

  function go(i) {
    i = Math.max(0, Math.min(lines.length - 1, i));
    show(i);
    if (playing) schedule();
  }

  function restart() {
    pause(true);
    elapsed = 0;
    idx = -1;
    show(-1);
    rows.forEach(function (r) { r.classList.remove('past', 'cur'); });
    el.scrollTo({ top: 0, behavior: 'auto' });
    paintClock();
    playBtn.textContent = 'Play';
    noteEl.classList.remove('show');
  }

  function bumpIdle() {
    el.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (playing) el.classList.add('idle'); }, 3200);
  }

  /* ---------------- controls ---------------- */

  function paintMode() {
    var m = settings().mode;
    modePace.classList.toggle('on', m !== 'listen');
    modeListen.classList.toggle('on', m === 'listen');
    voiceWrap.hidden = m !== 'listen' || !canSpeak();
    var p = settings().pace;
    Array.prototype.forEach.call(el.querySelectorAll('[data-pace]'), function (b) {
      b.classList.toggle('on', Number(b.getAttribute('data-pace')) === p);
    });
  }

  function onKey(e) {
    if (!opened) return;
    if (e.target && /^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); go(idx < 0 ? 0 : idx + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); restart(); }
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setMode(settings().mode === 'listen' ? 'pace' : 'listen'); }
  }

  function setMode(m) {
    App.setSetting('mode', m);
    paintMode();
    if (playing) schedule();
  }

  function setPace(wpm) {
    App.setSetting('pace', wpm);
    App.setSetting('ttsRate', TTS_FOR_PACE[wpm] || 0.85);
    paintMode();
    paintEst();
    App.updateStats();
    if (playing) schedule();
  }

  function init() {
    el = $('rehearse');
    poemEl = $('rehearse-poem');
    playBtn = $('rb-play');
    clockEl = $('rb-clock');
    estEl = $('rb-est');
    noteEl = $('rehearse-note');
    voiceSel = $('rb-voice');
    voiceWrap = $('rb-voice-wrap');
    modePace = $('rb-mode-pace');
    modeListen = $('rb-mode-listen');

    playBtn.addEventListener('click', toggle);
    $('rb-restart').addEventListener('click', restart);
    $('rb-exit').addEventListener('click', function () { exit(); });
    modePace.addEventListener('click', function () { setMode('pace'); });
    modeListen.addEventListener('click', function () { setMode('listen'); });
    Array.prototype.forEach.call(el.querySelectorAll('[data-pace]'), function (b) {
      b.addEventListener('click', function () { setPace(Number(b.getAttribute('data-pace'))); });
    });
    voiceSel.addEventListener('change', function () { App.setSetting('voice', voiceSel.value); if (playing) schedule(); });
    el.addEventListener('pointermove', bumpIdle, { passive: true });
    window.addEventListener('keydown', onKey);
    if (canSpeak() && window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    loadVoices();
  }

  function open() {
    if (opened) { exit(); return; }
    if (!PC.stripNotes(Editor.getText()).trim()) { App.toast('Write a few lines first, then read them aloud.'); return; }
    opened = true;
    App.hideToast();
    build();
    el.hidden = false;
    el.classList.remove('idle');
    document.body.classList.add('rehearsing');
    document.body.classList.remove('hud-on');
    loadVoices();
    paintMode();
    paintEst();
    restart();
    el.scrollTop = 0;
    el.focus && el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    say('Space to start · ← → to move · L to switch Pace / Listen · Esc to go back', 5500);
  }

  function exit(silent) {
    if (!opened) return;
    pause(true);
    opened = false;
    el.hidden = true;
    document.body.classList.remove('rehearsing');
    if (!silent) Editor.focus();
  }

  window.Rehearse = {
    init: init,
    open: open,
    exit: exit,
    isOpen: function () { return opened; },
    // exposed for tests
    _state: function () { return { idx: idx, playing: playing, lines: lines.length, elapsed: nowElapsed() }; },
  };
})();
