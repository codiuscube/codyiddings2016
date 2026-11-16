/* Poem Composer — the side panels: verse, words, drafts, brief, check, export.
   Only one is open at a time; none is open until asked. Nothing here ever
   writes a line of the poem except by an explicit click, and every such edit
   goes through Editor.replaceRange, so ⌘Z undoes it. Text that came from a web
   API is only ever set with textContent. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var panelEl, titleEl, subEl, bodyEl, scroller;
  var roots = {};
  var current = null;
  var closeTimer = 0;
  var refreshTimer = 0;
  var DATA = window.PC_DATA;
  var WEEK = DATA.brief.weeks.filter(function (w) { return w.here; })[0];

  /* ---------------- tiny helpers ---------------- */

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
      });
    }
    function add(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    var t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(t);
    t.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(t);
    return ok;
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function when(t) {
    return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }

  /** Debounced refresh for live panels (check, compare). */
  function refreshSoon(fn) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(fn, 250);
  }

  /* ------------------------------------------------------------------ */
  /* Shell                                                               */
  /* ------------------------------------------------------------------ */

  var registry = {};

  /** Each panel keeps its own root, so switching panels never loses state. */
  function rootFor(name) {
    if (!roots[name]) {
      roots[name] = h('div', { class: 'panel-root', 'data-root': name });
      bodyEl.appendChild(roots[name]);
    }
    return roots[name];
  }

  function open(name, arg) {
    var p = registry[name];
    if (!p) return;
    clearTimeout(closeTimer);
    if (current && current !== name && registry[current].leave) registry[current].leave();
    var fresh = !roots[name];
    var switched = current !== name;
    var root = rootFor(name);
    Object.keys(roots).forEach(function (k) { roots[k].hidden = k !== name; });
    if (switched) scroller.scrollTop = 0;
    current = name;
    titleEl.textContent = p.title;
    subEl.textContent = '';
    panelEl.hidden = false;
    panelEl.setAttribute('data-panel', name);
    void panelEl.offsetWidth;
    panelEl.classList.add('open');
    document.body.classList.add('panel-open');
    p.open(arg, fresh, root);
  }

  function close(silent) {
    if (!current) return;
    var p = registry[current];
    if (p && p.leave) p.leave();
    current = null;
    panelEl.classList.remove('open');
    document.body.classList.remove('panel-open');
    closeTimer = setTimeout(function () { if (!current) panelEl.hidden = true; }, 280);
    if (!silent) Editor.focus();
  }

  function isOpen() { return !!current; }

  /* ------------------------------------------------------------------ */
  /* Verse                                                               */
  /* ------------------------------------------------------------------ */

  registry.verse = (function () {
    var root;
    var built = false;
    var input, select, out, chipsEl, recentEl;
    var last = null;      // {data, ref}
    var token = 0;
    var picked = {};

    function build() {
      built = true;
      root.textContent = '';
      input = h('input', { type: 'text', placeholder: 'Matthew 1:18–25', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Scripture reference', 'data-autofocus': '' });
      select = h('select', { class: 'p-select', 'aria-label': 'Translation', onchange: function () { App.setSetting('translation', select.value); if (last) lookup(last.ref, { keep: true }); } },
        Api.TRANSLATIONS.map(function (t) { return h('option', { value: t.id, title: t.long, text: t.name }); }));
      var form = h('form', { class: 'p-form', onsubmit: function (e) { e.preventDefault(); lookup(input.value); } },
        input, h('button', { class: 'btn primary', type: 'submit', text: 'Look up' }));

      chipsEl = h('div', { class: 'p-sec' });
      DATA.extraTexts.length && chipsEl.appendChild(h('p', { class: 'p-label', text: 'The poem’s story' }));
      chipsEl.appendChild(chipRow(DATA.extraTexts.map(function (t) { return t.ref; })));
      chipsEl.appendChild(h('p', { class: 'p-label', text: 'Week 3 — Joseph: Peace', style: 'margin-top:.9rem' }));
      chipsEl.appendChild(chipRow(WEEK.texts));
      recentEl = h('div', { class: 'p-sec' });
      out = h('div', { class: 'p-sec', 'aria-live': 'polite' });
      root.appendChild(h('div', { class: 'p-sec' }, form, h('div', { class: 'p-form' }, select,
        h('span', { class: 'muted small', style: 'align-self:center', text: 'CSB is your church’s Bible: the poem’s chapters are built in and work offline. Click a verse to pick it.' }))));
      root.appendChild(chipsEl);
      root.appendChild(recentEl);
      root.appendChild(out);
    }

    function chipRow(refs) {
      return h('div', { class: 'chips' }, refs.map(function (r) {
        return h('button', { class: 'chip', type: 'button', text: r, onclick: function () { lookup(r); } });
      }));
    }

    function paintRecent() {
      recentEl.textContent = '';
      var rec = App.S.settings.recent || [];
      if (!rec.length) return;
      recentEl.appendChild(h('p', { class: 'p-label', text: 'Recent' }));
      recentEl.appendChild(chipRow(rec));
    }

    function remember(ref) {
      var rec = (App.S.settings.recent || []).filter(function (r) { return r !== ref; });
      rec.unshift(ref);
      App.S.settings.recent = rec.slice(0, 8);
      App.save();
    }

    function message(kind, text, retry) {
      out.textContent = '';
      var box = h('div', { class: 'msg ' + (kind === 'err' ? 'err' : '') }, text);
      if (retry) box.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'btn small', type: 'button', text: 'Try again', onclick: retry })));
      out.appendChild(box);
    }

    function lookup(text, o) {
      o = o || {};
      text = String(text || '').trim();
      if (!text) { input.focus(); return; }
      input.value = text;
      var tr = App.S.settings.translation || 'csb';
      select.value = tr;
      var my = ++token;
      out.textContent = '';
      out.appendChild(h('div', { class: 'spinner', text: 'Looking it up…' }));
      var apiRef = PC.refForApi(text);
      App.api.verse(apiRef, tr).then(function (data) {
        if (my !== token) return;
        last = { data: data, ref: text, origRef: text, context: false };
        picked = {};
        render(data, null);
        if (!o.keep) remember(data.reference || text);
        paintRecent();
      }, function (err) {
        if (my !== token) return;
        if (err.kind === 'notcsb') { notCsb(text, o); return; }
        if (err.kind === 'notfound') message('err', 'I couldn’t find “' + text + '”. Try a form like John 14:27, Psalm 4:6-8 or 1 John 4:9–10.');
        else if (err.kind === 'ratelimit') message('err', 'That’s a lot of lookups for a moment. Wait about half a minute and try again.', function () { lookup(text, o); });
        else message('err', 'Couldn’t reach bible-api.com. Are you online? Verses you’ve already looked up still work offline.', function () { lookup(text, o); });
      });
    }

    /** A reference outside the bundled CSB chapters: open the CSB on Bible Gateway,
        or show it here in a free translation. */
    function notCsb(text, o) {
      out.textContent = '';
      out.appendChild(h('div', { class: 'msg' },
        h('p', { text: '“' + text + '” isn’t one of the CSB chapters built in here (Matthew 1, 2, 6 · Luke 1, 2 · Isaiah 7, 26 · Psalm 4 · John 14 · Philippians 4). The CSB has no free service to fetch the rest from.' }),
        h('div', { class: 'btn-row' },
          h('a', { class: 'btn small', href: Api.bibleGatewayUrl(text, 'CSB'), target: '_blank', rel: 'noopener noreferrer', text: 'Open it in the CSB ↗' }),
          h('button', { class: 'btn small', type: 'button', text: 'Show it here in BSB', onclick: function () {
            var my = ++token;
            App.api.verse(PC.refForApi(text), 'bsb').then(function (data) {
              if (my !== token) return;
              last = { data: data, ref: text, origRef: text, context: false }; picked = {};
              render(data, null);
            }, function () { if (my === token) message('err', 'Couldn’t reach bible-api.com either. Are you online?'); });
          } }))));
    }

    function pickedVerses(data) {
      var idx = Object.keys(picked).map(Number);
      var vs = data.verses.filter(function (v, i) { return !idx.length || picked[i]; });
      return vs;
    }

    function passageText(data) {
      return pickedVerses(data).map(function (v) { return v.text; }).join(' ').replace(/\s*\n\s*/g, ' ');
    }
    function passageRef(data) {
      var vs = pickedVerses(data);
      if (vs.length === data.verses.length) return data.reference;
      var nums = vs.map(function (v) { return v.verse; });
      return vs[0].book_name + ' ' + vs[0].chapter + ':' + nums[0] + (nums.length > 1 ? '–' + nums[nums.length - 1] : '') + ' (partial)';
    }

    function render(data, ctxRange) {
      out.textContent = '';
      var trName = (Api.TRANSLATIONS.filter(function (t) { return t.id === data.translation_id; })[0] || {}).long || data.translation_name;
      var box = h('div', { class: 'passage' });
      box.appendChild(h('h3', { text: data.reference }));
      box.appendChild(h('div', { class: 'tr', text: trName + (data.translation_note ? ' · ' + data.translation_note : '') + (data.fromCache ? ' · saved on this device' : '') }));
      var firstIn = null;
      data.verses.forEach(function (v, i) {
        var cls = 'v';
        if (ctxRange) cls += ' ctx' + (v.verse >= ctxRange.from && v.verse <= ctxRange.to ? ' in' : '');
        var el = h('span', { class: cls, role: 'button', tabindex: '0', title: 'Click to pick this verse' },
          h('span', { class: 'vn', text: String(v.verse) }), v.text);
        function toggle() { picked[i] = !picked[i]; el.classList.toggle('picked', !!picked[i]); }
        el.addEventListener('click', toggle);
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        if (ctxRange && !firstIn && el.className.indexOf(' in') > -1) firstIn = el;
        box.appendChild(el);
      });
      out.appendChild(box);

      var ref = parseCurrent(data);
      var row = h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', type: 'button', text: 'Insert at cursor', onclick: function () {
          var r = Editor.insertAtCaret(passageText(data));
          Editor.flash(r.start, r.end);
          App.toast('Inserted. ' + App.mod + 'Z undoes it.');
        } }),
        h('button', { class: 'btn small', type: 'button', text: 'Pin as private note', title: 'Adds a // line above your cursor: never counted, read aloud or exported', onclick: function () {
          var note = '// ' + passageRef(data) + ' (' + (data.translation_id || '').toUpperCase() + '): ' + passageText(data);
          Editor.insertLineAbove(note);
          App.toast('Pinned above your cursor as a private note.');
        } }),
        h('button', { class: 'btn small', type: 'button', text: 'Copy', onclick: function () {
          copyText(passageText(data)).then(function () { App.toast('Copied.'); });
        } }));
      if (ref) {
        row.appendChild(h('button', { class: 'btn small', type: 'button', text: ctxRange ? 'Back to the passage' : 'Read the chapter', onclick: function () { ctxRange ? lookup(last.origRef, { keep: true }) : chapter(ref); } }));
      }
      out.appendChild(row);
      out.appendChild(data.translation_id === 'csb'
        ? h('p', { class: 'muted small', style: 'margin-top:.9rem', text: Api.CSB_CREDIT })
        : h('p', { class: 'muted small', style: 'margin-top:.9rem' },
        'This isn’t your church’s CSB. To see the CSB, ESV and NIV side by side: ',
        h('a', { href: Api.bibleGatewayUrl(data.reference, 'CSB;ESV;NIV'), target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--accent)', text: 'compare on Bible Gateway ↗' })));
      if (ctxRange && firstIn) setTimeout(function () { firstIn.scrollIntoView({ block: 'center' }); }, 30);
    }

    function parseCurrent(data) {
      var ref = PC.parseRef(last ? last.ref : data.reference);
      if (!ref) ref = PC.parseRef(data.reference);
      return ref;
    }

    function chapter(ref) {
      var tr = App.S.settings.translation || 'csb';
      var my = ++token;
      out.textContent = '';
      out.appendChild(h('div', { class: 'spinner', text: 'Opening the whole chapter…' }));
      App.api.verse(PC.refForApi(ref.book + ' ' + ref.chapter), tr).then(function (data) {
        if (my !== token) return;
        last = { data: data, ref: ref.book + ' ' + ref.chapter, origRef: (last && last.origRef) || (ref.book + ' ' + ref.chapter), context: true };
        picked = {};
        render(data, ref.from ? { from: ref.from, to: ref.to } : null);
        var nav = h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', type: 'button', text: '‹ Chapter ' + (ref.chapter - 1), disabled: ref.chapter <= 1, onclick: function () { chapter({ book: ref.book, chapter: ref.chapter - 1, from: null, to: null }); } }),
          h('button', { class: 'btn small', type: 'button', text: 'Chapter ' + (ref.chapter + 1) + ' ›', onclick: function () { chapter({ book: ref.book, chapter: ref.chapter + 1, from: null, to: null }); } }));
        out.insertBefore(nav, out.firstChild);
      }, function (err) {
        if (my !== token) return;
        if (err.kind === 'notcsb') { message('err', 'Chapter ' + ref.chapter + ' of ' + ref.book + ' isn’t built in. Switch to BSB for it, or open it in the CSB on Bible Gateway.'); return; }
        message('err', err.kind === 'notfound' ? 'That’s the end of the book.' : 'Couldn’t open the chapter. Are you online?');
      });
    }

    return {
      title: 'Verse',
      open: function (arg, fresh, r) {
        root = r;
        if (!built) build();
        select.value = App.S.settings.translation || 'csb';
        paintRecent();
        if (arg && arg.ref) { lookup(arg.ref); return; }
        input.focus();
        input.select();
      },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Words: thesaurus, rhymes, sounds-like                                */
  /* ------------------------------------------------------------------ */

  registry.words = (function () {
    var root;
    var built = false;
    var input, tabsEl, targetEl, defsEl, out;
    var tab = 'similar';
    var word = '';
    var token = 0;
    var selfEdit = false;
    var cache = {};
    var TABS = [
      ['similar', 'Similar'], ['opposite', 'Opposite'], ['rhymes', 'Rhymes'],
      ['near', 'Near rhymes'], ['sounds', 'Sounds like'], ['goes', 'Goes with'],
    ];

    function build() {
      built = true;
      root.textContent = '';
      input = h('input', { type: 'text', placeholder: 'a word…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Word to look up', 'data-autofocus': '' });
      var form = h('form', { class: 'p-form', onsubmit: function (e) { e.preventDefault(); setWord(input.value); } },
        input, h('button', { class: 'btn primary', type: 'submit', text: 'Find' }));
      targetEl = h('div', { class: 'target-line' });
      tabsEl = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(function (t) {
        return h('button', { class: 'tab', type: 'button', role: 'tab', 'data-tab': t[0], text: t[1], onclick: function () { setTab(t[0]); } });
      }));
      defsEl = h('div');
      out = h('div', { 'aria-live': 'polite' });
      root.appendChild(form);
      root.appendChild(targetEl);
      root.appendChild(tabsEl);
      root.appendChild(defsEl);
      root.appendChild(out);
      Editor.on('change', function () {
        if (current === 'words' && !selfEdit) { clearTarget(); paintTarget(); }
      });
    }

    function clearTarget() { Editor.setTarget(null); }

    function paintTarget() {
      var t = Editor.getTarget();
      targetEl.textContent = '';
      if (t) {
        var w = Editor.getText().slice(t.start, t.end);
        targetEl.appendChild(document.createTextNode('Swapping '));
        targetEl.appendChild(h('b', { text: w }));
        targetEl.appendChild(document.createTextNode(' in the poem: click a word to put it in. '));
        targetEl.appendChild(h('span', { class: 'muted', text: App.mod + 'Z undoes it. ' }));
        targetEl.appendChild(h('button', { class: 'btn small', type: 'button', text: 'Just browse', onclick: function () { clearTarget(); paintTarget(); } }));
      } else {
        targetEl.appendChild(h('span', { class: 'muted', text: 'Click a word to put it at your cursor. Select a word in the poem first to swap it.' }));
      }
    }

    function matchCase(newWord, old) {
      if (!old) return newWord;
      if (old.length > 1 && old === old.toUpperCase() && /[A-Z]/.test(old)) return newWord.toUpperCase();
      if (/^[A-Z]/.test(old) && newWord.length) return newWord.charAt(0).toUpperCase() + newWord.slice(1);
      return newWord;
    }

    function choose(w) {
      var t = Editor.getTarget();
      var oldText = t ? Editor.getText().slice(t.start, t.end) : '';
      var text = matchCase(w, oldText);
      selfEdit = true;
      var r = t ? Editor.replaceRange(t.start, t.end, text) : Editor.insertAtCaret(text);
      Editor.setTarget(r);
      selfEdit = false;
      paintTarget();
      Editor.keepCaretInView();
    }

    function chip(it) {
      var b = h('button', { class: 'chip serif', type: 'button', onclick: function () { choose(it.w); } }, it.w);
      if (it.s) b.appendChild(h('sub', { text: String(it.s) }));
      return b;
    }

    function paintGroups(groups, emptyText) {
      out.textContent = '';
      if (!groups.length) { out.appendChild(h('div', { class: 'msg', text: emptyText })); return; }
      groups.forEach(function (g) {
        out.appendChild(h('div', { class: 'group' },
          h('p', { class: 'p-label', text: g.title }),
          h('div', { class: 'chips' }, g.items.slice(0, 70).map(chip))));
      });
      out.appendChild(h('p', { class: 'muted small', text: 'Small numbers are syllables. Words come from Datamuse; they’re suggestions, never changes made for you.' }));
    }

    function setTab(t) {
      tab = t;
      Array.prototype.forEach.call(tabsEl.children, function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
      load();
    }

    function setWord(w) {
      word = String(w || '').trim().replace(/\s+/g, ' ');
      input.value = word;
      defsEl.textContent = '';
      load();
      loadDefs();
    }

    function load() {
      if (!word) { out.textContent = ''; out.appendChild(h('div', { class: 'msg', text: 'Type a word, or select one in the poem and press ' + App.alt + 'T.' })); return; }
      var key = tab + '|' + word.toLowerCase();
      var my = ++token;
      if (cache[key]) { paintGroups(cache[key], emptyFor(tab)); return; }
      out.textContent = '';
      out.appendChild(h('div', { class: 'spinner', text: 'Finding words…' }));
      App.api.tab(tab, word).then(function (groups) {
        if (my !== token) return;
        cache[key] = groups;
        paintGroups(groups, emptyFor(tab));
      }, function (err) {
        if (my !== token) return;
        out.textContent = '';
        out.appendChild(h('div', { class: 'msg err' },
          err.kind === 'ratelimit' ? 'Too many lookups for a moment. Try again shortly.' : 'Couldn’t reach Datamuse. Are you online?',
          h('div', { class: 'btn-row' }, h('button', { class: 'btn small', type: 'button', text: 'Try again', onclick: load }))));
      });
    }

    function emptyFor(t) {
      return t === 'opposite' ? 'No opposites on file for “' + word + '”.' :
        t === 'near' ? 'No near rhymes found for “' + word + '”.' :
        'Nothing found for “' + word + '”. Check the spelling, or try “Sounds like”.';
    }

    function loadDefs() {
      var my = token;
      var w = word;
      App.api.define(w).then(function (defs) {
        if (w !== word || !defs.length) return;
        defsEl.textContent = '';
        defsEl.appendChild(h('div', { class: 'defs' }, defs.slice(0, 2).map(function (d, i) {
          return h('div', null, d.pos ? h('span', { class: 'pos', text: d.pos }) : '', d.text);
        })));
        void my;
      }, function () { /* definitions are a bonus */ });
    }

    return {
      title: 'Words',
      open: function (arg, fresh, r) {
        root = r;
        if (!built) build();
        arg = arg || {};
        var want = arg.tab || tab;
        if (arg.word) {
          clearTarget();
          word = '';
          tab = want;
          Array.prototype.forEach.call(tabsEl.children, function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === want); });
          setWord(arg.word);
          paintTarget();
          return;
        }
        var w = Editor.wordUnderCaret();
        if (w) {
          Editor.setTarget({ start: w.start, end: w.end });
          paintTarget();
          tab = want;
          Array.prototype.forEach.call(tabsEl.children, function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === want); });
          setWord(w.word);
        } else {
          paintTarget();
          setTab(want);
          input.focus();
          input.select();
        }
        // keep the cursor in the search box so you can type another word right away
        setTimeout(function () { input.focus(); input.select(); }, 30);
      },
      leave: function () { Editor.setTarget(null); },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Drafts and snapshots                                                */
  /* ------------------------------------------------------------------ */

  registry.drafts = (function () {
    var root;
    var selected = null;      // {kind:'draft'|'snap', id, label, text}
    var compare = true;
    var viewEl, listEl;
    var insertBtn;

    function wordsOf(t) { return PC.countWords(t); }

    function items() {
      var drafts = DATA.drafts.slice().reverse().map(function (d) {
        return { kind: 'draft', id: d.id, label: d.label.replace(/\s*\(latest\)/, '') + (d.note === 'latest' ? ' · latest' : ''), short: d.label.replace(/\s*\(latest\)/, ''), text: d.body, meta: plural(wordsOf(d.body), 'word') };
      });
      var snaps = App.S.snapshots.map(function (s) {
        return { kind: 'snap', id: s.id, label: s.label || (s.auto ? 'Auto-saved' : 'Snapshot'), short: (s.label || 'Snapshot') + ' ' + when(s.t), text: s.text, meta: when(s.t) + ' · ' + plural(wordsOf(s.text), 'word') };
      });
      return { drafts: drafts, snaps: snaps };
    }

    function paint() {
      root.textContent = '';
      var all = items();
      viewEl = h('div');
      listEl = h('div');
      root.appendChild(viewEl);
      root.appendChild(listEl);

      listEl.appendChild(h('p', { class: 'p-label', text: 'Your drafts, as you pasted them' }));
      listEl.appendChild(list(all.drafts));
      listEl.appendChild(h('div', { class: 'p-label', style: 'display:flex;justify-content:space-between;align-items:center;margin-top:1.3rem' },
        h('span', { text: 'Snapshots of this poem' }),
        h('button', { class: 'btn small', type: 'button', text: 'Snapshot now', onclick: function () {
          if (App.snapshot('Snapshot', false, true)) { App.toast('Snapshot saved.'); paint(); } else App.toast('Nothing new since the last snapshot.');
        } })));
      listEl.appendChild(all.snaps.length ? list(all.snaps) :
        h('p', { class: 'muted small', text: 'None yet. One is saved automatically every few minutes while you write, and before you restore anything.' }));
      paintView();
    }

    function list(arr) {
      return h('ul', { class: 'dlist' }, arr.map(function (it) {
        var on = selected && selected.kind === it.kind && selected.id === it.id;
        return h('li', null, h('button', { class: 'ditem' + (on ? ' on' : ''), type: 'button', onclick: function () { selected = it; paint(); scroller.scrollTop = 0; } },
          h('span', { class: 't', text: it.label }), h('span', { class: 'm', text: it.meta })));
      }));
    }

    function paintView() {
      viewEl.textContent = '';
      if (!selected) {
        viewEl.appendChild(h('div', { class: 'msg', style: 'margin-bottom:1.3rem', text: 'Pick a draft to read it here beside the poem. Lines no longer in your draft are marked, so you can see what you’ve cut and pull any of it back.' }));
        return;
      }
      var st = PC.lineStatus(selected.text, Editor.getText());
      var gone = st.filter(function (l) { return l.status === 'gone'; }).length;
      var ref = h('div', { class: 'ref' + (compare ? ' compare' : ''), id: 'ref-view', tabindex: '0' },
        st.map(function (l) {
          var cls = 'ln-ref' + (l.status === 'gone' && compare ? ' gone-line' : '');
          var inner = l.status === 'gone' && compare ? h('span', { class: 'gone', text: l.text }) : (l.text || '​');
          return h('span', { class: cls + (l.status === 'same' && compare ? ' same' : '') }, inner);
        }));
      insertBtn = h('button', { class: 'btn small', type: 'button', text: 'Insert selected lines', hidden: true, onmousedown: function (e) { e.preventDefault(); }, onclick: function () {
        var s = String(window.getSelection()).replace(/​/g, '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
        if (!s) return;
        var r = Editor.insertAtCaret(s);
        Editor.flash(r.start, r.end);
        App.toast('Inserted at your cursor. ' + App.mod + 'Z undoes it.');
      } });
      function checkSel() {
        var sel = window.getSelection();
        var inside = sel && !sel.isCollapsed && ref.contains(sel.anchorNode) && ref.contains(sel.focusNode);
        insertBtn.hidden = !inside;
      }
      ref.addEventListener('mouseup', checkSel);
      ref.addEventListener('keyup', checkSel);
      document.addEventListener('selectionchange', function once() {
        if (current !== 'drafts' || !document.body.contains(ref)) { document.removeEventListener('selectionchange', once); return; }
        checkSel();
      });

      viewEl.appendChild(h('div', { class: 'p-sec' },
        h('p', { class: 'p-label', text: selected.short || selected.label }),
        h('div', { class: 'btn-row', style: 'margin:0 0 .7rem' },
          h('button', { class: 'btn small primary', type: 'button', text: 'Restore as my poem', title: 'Saves a snapshot of what you have now first, and ' + App.mod + 'Z undoes it', onclick: function () {
            App.restoreText(selected.text, selected.short || selected.label);
            paintView();
          } }),
          h('button', { class: 'btn small', type: 'button', text: 'Copy all', onclick: function () { copyText(selected.text).then(function () { App.toast('Copied.'); }); } }),
          h('button', { class: 'btn small', type: 'button', text: compare ? 'Compare: on' : 'Compare: off', title: 'Mark lines that are not in your poem now', onclick: function () { compare = !compare; paintView(); } }),
          insertBtn),
        ref,
        compare ? h('p', { class: 'muted small', style: 'margin:.6rem 0 0', text: gone ? plural(gone, 'line') + ' here ' + (gone === 1 ? 'isn’t' : 'aren’t') + ' in your poem now (wavy underline). Select any lines to insert them.' : 'Every line here is in your poem now.' }) : null));
    }

    return {
      title: 'Drafts',
      open: function (arg, fresh, r) {
        root = r;
        paint();
      },
      refresh: function () { if (current === 'drafts' && selected) { var top = scroller.scrollTop; paintView(); scroller.scrollTop = top; } },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* The brief                                                           */
  /* ------------------------------------------------------------------ */

  registry.brief = (function () {
    var root;
    var tab = 'week';
    var content;

    function questions(prompts) { return (String(prompts).match(/[^?]+\?/g) || [prompts]).map(function (q) { return q.trim(); }); }

    function textChips(refs) {
      return h('div', { class: 'chips' }, refs.map(function (r) {
        return h('button', { class: 'chip', type: 'button', text: r, onclick: function () { App.openPanel('verse', { ref: r }); } });
      }));
    }

    function week() {
      var w = WEEK;
      return h('div', { class: 'brief' },
        h('p', { class: 'p-label', text: 'Advent Creative Writing Team · ' + w.label }),
        h('h3', { text: w.who + ' — ' + w.theme }),
        h('p', { class: 'q', text: w.question }),
        h('p', { class: 'p-label', text: 'Human experience' }), h('p', { text: w['Human experience'] }),
        h('p', { class: 'p-label', text: 'Biblical direction' }), h('p', { text: w['Biblical direction'] }),
        h('p', { class: 'p-label', text: 'Texts — click to read' }), textChips(w.texts),
        h('p', { class: 'p-label', style: 'margin-top:1rem', text: 'The story the poem tells' }), textChips(DATA.extraTexts.map(function (t) { return t.ref; })),
        h('p', { class: 'p-label', style: 'margin-top:1.1rem', text: 'Prompts' }),
        h('ul', null, questions(w.Prompts).map(function (q) { return h('li', { text: q }); })),
        h('p', { class: 'p-label', text: 'Aim' }), h('div', { class: 'aim', text: w.Aim }));
    }

    function movements() {
      var m = PC.movementTotals(Editor.getText());
      var total = PC.MOVEMENTS.reduce(function (a, k) { return a + m.totals[k]; }, 0);
      var wrap = h('div', { class: 'brief' });
      wrap.appendChild(h('p', { class: 'muted', style: 'margin-top:0', text: DATA.brief.movementsIntro }));
      wrap.appendChild(h('p', { class: 'muted small', text: 'To mark a part, put your cursor there and press Mark here. It adds a private “// Recognize” line, which isn’t counted, read aloud or exported. It runs until the next mark.' }));
      DATA.brief.movements.forEach(function (mv) {
        var words = m.totals[mv.name];
        wrap.appendChild(h('div', { class: 'mcard' },
          h('h4', null, mv.name, m.tags ? h('span', { class: 'w', text: words ? plural(words, 'word') + (total ? ' · ' + Math.round(100 * words / total) + '%' : '') : '—' }) : null),
          h('p', { class: 'mq', text: mv.question }),
          h('p', { text: mv.body }),
          h('button', { class: 'btn small', type: 'button', text: 'Mark here', onclick: function () { App.markMovement(mv.name); refresh(); } })));
      });
      if (m.tags && m.untagged) wrap.appendChild(h('p', { class: 'muted small', text: plural(m.untagged, 'word') + ' before your first mark.' }));
      return wrap;
    }

    function guidelines() {
      return h('div', { class: 'brief' },
        h('ul', { class: 'glist' }, DATA.brief.guidelines.map(function (g) {
          return h('li', null, h('b', null, h('span', { class: 'n', text: String(g.n) }), g.title), h('span', { text: g.body }));
        })));
    }

    function why() {
      var b = DATA.brief;
      return h('div', { class: 'brief' },
        h('p', { class: 'p-label', text: b.title.replace(/^Advent Creative Writing Team — /, '') }),
        h('h3', { text: 'Why we write' }),
        b.purpose.map(function (p) { return h('p', { text: p }); }));
    }

    var views = { week: week, movements: movements, guidelines: guidelines, why: why };

    function refresh() {
      if (current !== 'brief') return;
      var top = scroller.scrollTop;
      root.textContent = '';
      root.appendChild(h('div', { class: 'tabs', role: 'tablist' }, [
        ['week', 'Week 3'], ['movements', 'Five movements'], ['guidelines', 'Guidelines'], ['why', 'Why we write'],
      ].map(function (t) {
        return h('button', { class: 'tab' + (tab === t[0] ? ' on' : ''), type: 'button', role: 'tab', text: t[1], onclick: function () { tab = t[0]; refresh(); scroller.scrollTop = 0; } });
      })));
      content = views[tab]();
      root.appendChild(content);
      scroller.scrollTop = top;
    }

    return {
      title: 'The brief',
      open: function (arg, fresh, r) { root = r; if (arg && arg.tab) tab = arg.tab; refresh(); },
      refresh: function () { if (tab === 'movements') refresh(); },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Check                                                               */
  /* ------------------------------------------------------------------ */

  registry.check = (function () {
    var root;
    function jump(start, end) { Editor.selectRange(start, end); }

    function paint() {
      if (current !== 'check') return;
      var top = scroller.scrollTop;
      var text = Editor.getText();
      var words = PC.countWords(text);
      var st = PC.targetState(words);
      var pace = App.S.settings.pace;
      root.textContent = '';

      /* --- length --- */
      var T = PC.TARGET;
      var scaleMax = Math.max(360, Math.ceil(words / 40) * 40 + 20);
      var pct = function (n) { return Math.min(100, (n / scaleMax) * 100) + '%'; };
      var say = st.state === 'in' ? 'Right inside the 250–300 the brief asks for.' :
        st.state === 'under' ? plural(st.by, 'word') + ' short of 250. There’s room.' :
        plural(st.by, 'word') + ' past 300. A few lines could rest, or it may simply run a little long.';
      root.appendChild(h('div', { class: 'p-sec' },
        h('div', { class: 'big-count' }, String(words), h('small', { text: words === 1 ? 'word' : 'words' })),
        h('div', { class: 'bigmeter ' + st.state },
          h('i', { class: 'band', style: 'left:' + pct(T.minWords) + ';width:' + (((T.maxWords - T.minWords) / scaleMax) * 100) + '%' }),
          h('i', { class: 'fill', style: 'width:' + pct(words) })),
        h('div', { class: 'scale' }, h('span', { text: '0' }), h('span', { text: '250–300 aim' }), h('span', { text: String(scaleMax) })),
        h('p', { style: 'margin:.7rem 0 .9rem', text: say }),
        h('p', { class: 'p-label', text: 'Read aloud — the brief says 2–3 minutes' }),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Pace' }, [['slow', 'Slow'], ['pew', 'Pew'], ['brisk', 'Brisk']].map(function (p) {
          var wpm = PC.PACES[p[0]];
          return h('button', { class: 'seg-btn' + (wpm === pace ? ' on' : ''), type: 'button', text: p[1] + ' ' + PC.formatTime(PC.readSeconds(text, wpm)), title: wpm + ' words a minute, with a breath at each line and a longer one between stanzas',
            onclick: function () { App.setSetting('pace', wpm); App.updateStats(); paint(); } });
        })),
        h('p', { class: 'muted small', style: 'margin-top:.5rem', text: 'Estimate from ' + pace + ' words a minute, a breath at each line, a longer one between stanzas. “Read it aloud” (' + App.alt + 'A) lets you time yourself for real.' })));

      /* --- where the words are --- */
      var secs = PC.sections(text);
      if (secs.length) {
        var maxW = Math.max.apply(null, secs.map(function (s) { return s.words; }));
        root.appendChild(h('div', { class: 'p-sec' },
          h('p', { class: 'p-label', text: 'Where the words are' }),
          h('ul', { class: 'bars' }, secs.map(function (s, i) {
            var ln = Editor.lines()[s.first];
            return h('li', null, h('button', { type: 'button', title: 'Go there', onclick: function () { var l = Editor.lines()[s.first]; if (l) jump(l.start, l.end); } },
              h('span', { class: 'bl', text: (i + 1) + '. ' + (s.label || (ln ? ln.text : '')) }),
              h('span', { class: 'bn', text: String(s.words) }),
              h('span', { class: 'bb' }, h('i', { style: 'width:' + Math.round(100 * s.words / Math.max(1, maxW)) + '%' }))));
          }))));
      }

      /* --- five movements --- */
      var mt = PC.movementTotals(text);
      var tagged = PC.MOVEMENTS.filter(function (k) { return mt.totals[k] > 0; });
      root.appendChild(h('div', { class: 'p-sec' },
        h('p', { class: 'p-label', text: 'The five movements' }),
        tagged.length
          ? h('div', { class: 'chips' }, tagged.map(function (k) { return h('span', { class: 'cpill' }, h('b', { text: k }), plural(mt.totals[k], 'word')); }))
          : h('p', { class: 'muted small', style: 'margin:0', text: 'Not marked yet. In The brief (' + App.alt + 'B), mark the parts that Recognize, Remember, Reframe, Respond and Rest, if it helps. Guidance, not a formula.' }),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn small', type: 'button', text: 'Open the brief', onclick: function () { App.openPanel('brief', { tab: 'movements' }); } }))));

      /* --- plain language --- */
      var flags = PC.pewCheck(text);
      var order = ['church', 'old', 'craft', 'long'];
      var names = { church: 'Church words', old: 'Older words', craft: 'Tradesman’s words', long: 'Long to say aloud' };
      var ll = PC.longLines(text, 12);
      var sec = h('div', { class: 'p-sec' }, h('p', { class: 'p-label', text: 'For the pew — children, new believers, anyone' }));
      if (!flags.length && !ll.length) sec.appendChild(h('p', { class: 'muted small', style: 'margin:0', text: 'Nothing here is likely to trip anyone up.' }));
      order.forEach(function (kind) {
        var fs = flags.filter(function (f) { return f.kind === kind; });
        if (!fs.length) return;
        sec.appendChild(h('p', { class: 'muted small', style: 'margin:.5rem 0 .1rem', text: names[kind] }));
        fs.forEach(function (f) {
          sec.appendChild(h('button', { class: 'flag', type: 'button', title: f.why, onclick: function () { jump(f.start, f.end); } },
            h('b', { text: f.word }), h('span', { text: 'line ' + (f.line + 1) })));
        });
      });
      if (ll.length) {
        sec.appendChild(h('p', { class: 'muted small', style: 'margin:.7rem 0 .1rem', text: 'Long lines (12+ words): hard to say in one breath' }));
        ll.forEach(function (l) {
          sec.appendChild(h('button', { class: 'flag', type: 'button', onclick: function () { jump(l.start, l.end); } },
            h('b', { text: l.text.length > 34 ? l.text.slice(0, 33) + '…' : l.text }), h('span', { text: l.words + ' words' })));
        });
      }
      sec.appendChild(h('p', { class: 'muted small', style: 'margin:.7rem 0 0', text: 'These are flags, never fixes: the word stays yours. Select one and press ' + App.alt + 'T to see what else is out there. ' + App.alt + 'P marks them on the page.' }));
      root.appendChild(sec);

      /* --- Jesus at the center --- */
      var cc = PC.centerCheck(text);
      root.appendChild(h('div', { class: 'p-sec' },
        h('p', { class: 'p-label', text: 'Keep Jesus at the center' }),
        h('div', { class: 'centerrow' }, cc.map(function (c) {
          return h('button', { class: 'cpill' + (c.count ? '' : ' zero'), type: 'button', disabled: !c.count, onclick: function () { var x = c.hits[0]; jump(x.start, x.end); } },
            h('b', { text: c.name }), String(c.count));
        })),
        h('p', { class: 'muted small', style: 'margin:.6rem 0 0', text: 'A mirror, not a verdict: where the poem names him, and what God is doing. “Our characters are windows through which we see the Savior.”' })));

      scroller.scrollTop = top;
    }

    return {
      title: 'Check',
      open: function (arg, fresh, r) { root = r; paint(); },
      refresh: paint,
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  registry.export = (function () {
    var root;
    var includeNotes = false;
    var titleInput, summary;

    function poemText() {
      var raw = Editor.getText();
      return includeNotes ? raw : PC.stripNotes(raw);
    }
    function titleLine() { return (App.S.title || '').trim(); }
    function stamp() { return 'joseph-poem-' + today(); }

    function asTxt() {
      var t = titleLine();
      return (t ? t + '\n\n' : '') + poemText().replace(/\s+$/, '') + '\n';
    }
    function asMd() {
      var t = titleLine();
      // Markdown folds single newlines; two trailing spaces keep each line a line.
      var body = poemText().replace(/\s+$/, '').split('\n').map(function (l, i, a) {
        return l.trim() === '' || i === a.length - 1 ? l : l.replace(/\s+$/, '') + '  ';
      }).join('\n');
      return (t ? '# ' + t + '\n\n' : '') + body + '\n';
    }

    function paintSummary() {
      var t = poemText();
      summary.textContent = plural(PC.countWords(t), 'word') + ' · ' + plural(t.replace(/\s+$/, '').split('\n').length, 'line') +
        (includeNotes ? ' · private notes included' : ' · private notes left out');
    }

    function paint() {
      root.textContent = '';
      titleInput = h('input', { type: 'text', class: 'p-input', placeholder: 'Optional title', value: App.S.title || '', 'aria-label': 'Title', style: 'width:100%',
        oninput: function () { App.S.title = titleInput.value; App.save(); } });
      summary = h('p', { class: 'muted small', style: 'margin:.4rem 0 0' });
      var notesBox = h('label', { class: 'small', style: 'display:flex;gap:.5rem;align-items:center;margin-top:.7rem;color:var(--ink-2)' },
        h('input', { type: 'checkbox', onchange: function (e) { includeNotes = e.target.checked; paintSummary(); } }), 'Include my private // notes');
      notesBox.firstChild.checked = includeNotes;

      var fileInput = h('input', { type: 'file', accept: '.txt,.md,.markdown,.json,text/plain', hidden: true, onchange: function () { importFile(fileInput.files[0]); fileInput.value = ''; } });

      root.appendChild(h('div', { class: 'p-sec' },
        h('p', { class: 'p-label', text: 'Title' }), titleInput, notesBox, summary));
      root.appendChild(h('div', { class: 'p-sec' },
        h('p', { class: 'p-label', text: 'Take the poem with you' }),
        h('div', { class: 'btn-row', style: 'margin-top:0' },
          h('button', { class: 'btn primary', type: 'button', text: 'Download .txt', onclick: function () { download(stamp() + '.txt', asTxt()); App.toast('Saved ' + stamp() + '.txt'); } }),
          h('button', { class: 'btn', type: 'button', text: 'Download .md', onclick: function () { download(stamp() + '.md', asMd(), 'text/markdown;charset=utf-8'); App.toast('Saved ' + stamp() + '.md'); } }),
          h('button', { class: 'btn', type: 'button', text: 'Copy', onclick: function () { copyText(asTxt()).then(function () { App.toast('Copied the poem.'); }); } }),
          h('button', { class: 'btn', type: 'button', text: 'Print for the lectern', title: 'The poem alone, in large type', onclick: function () {
            $('print-sheet').textContent = asTxt();
            setTimeout(function () { window.print(); }, 50);
          } }))));
      root.appendChild(h('div', { class: 'p-sec' },
        h('p', { class: 'p-label', text: 'Keep a safe copy of everything' }),
        h('p', { class: 'muted small', style: 'margin:0 0 .6rem', text: 'Your poem is saved in this browser as you write. Another browser, or opening this page from a different address, has its own separate copy. A backup carries the poem, your snapshots and settings between them.' }),
        h('div', { class: 'btn-row', style: 'margin-top:0' },
          h('button', { class: 'btn', type: 'button', text: 'Backup (.json)', onclick: function () { App.saveNow(); download('poem-composer-backup-' + today() + '.json', Store.exportAll(App.S), 'application/json'); App.toast('Backup saved.'); } }),
          h('button', { class: 'btn', type: 'button', text: 'Open a file…', title: 'A .txt or .md poem, or a backup .json', onclick: function () { fileInput.click(); } }),
          fileInput)));
      paintSummary();
    }

    function importFile(file) {
      if (!file) return;
      var r = new FileReader();
      r.onload = function () {
        var text = String(r.result);
        if (/\.json$/i.test(file.name)) {
          try { App.importBackup(Store.parseBackup(text)); } catch (e) { App.toast(e.message || 'Couldn’t read that backup.'); }
        } else {
          App.restoreText(text.replace(/\r\n/g, '\n'), file.name);
        }
      };
      r.readAsText(file);
    }

    return {
      title: 'Export',
      open: function (arg, fresh, r) { root = r; paint(); },
      refresh: function () { if (summary) paintSummary(); },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Live refresh while a panel is open                                  */
  /* ------------------------------------------------------------------ */

  function init() {
    panelEl = $('panel');
    titleEl = $('panel-title');
    subEl = $('panel-sub');
    bodyEl = $('panel-body');
    scroller = bodyEl;
    $('panel-close').addEventListener('click', function () { close(); });
    App.on('change', function () {
      if (!current) return;
      var p = registry[current];
      if (p && p.refresh) refreshSoon(p.refresh);
    });
    App.on('settings', function () { if (current === 'check') refreshSoon(registry.check.refresh); });
  }

  window.Panels = { init: init, open: open, close: close, isOpen: isOpen, current: function () { return current; } };
})();
