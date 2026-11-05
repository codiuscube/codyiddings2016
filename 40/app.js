(() => {
  "use strict";
  document.documentElement.classList.add("js");
  const $ = (s) => document.querySelector(s);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";

  /* ---------- torn-paper edges ---------- */
  // Deterministic jitter so the edges look the same on every visit.
  let seed = 40;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function tornPolygon(stepPct, jag) {
    const pts = [];
    const j = () => (rnd() * jag).toFixed(1);
    for (let x = 0; x <= 100; x += stepPct) pts.push(`${x}% ${j()}px`);
    for (let y = 0; y <= 100; y += stepPct * 2) pts.push(`calc(100% - ${j()}px) ${y}%`);
    for (let x = 100; x >= 0; x -= stepPct) pts.push(`${x}% calc(100% - ${j()}px)`);
    for (let y = 100; y >= 0; y -= stepPct * 2) pts.push(`${j()}px ${y}%`);
    return `polygon(${pts.join(",")})`;
  }
  document.querySelectorAll(".paper").forEach((el) => {
    const wrap = document.createElement("div");
    wrap.className = "paper-wrap";
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    el.style.clipPath = tornPolygon(2.5, 7);
  });
  // torn bottom of the opening panel
  $(".intro").style.setProperty("--tear", (() => {
    const p = ["0 0", "100% 0"];
    for (let x = 100; x >= 0; x -= 2) p.push(`${x}% ${(20 + rnd() * 80).toFixed(0)}%`);
    return `polygon(${p.join(",")})`;
  })());
  // torn edge under the hero image
  (() => {
    let d = "M0 60 L0 30";
    for (let x = 0; x <= 1200; x += 16) d += ` L${x} ${(18 + rnd() * 22).toFixed(1)}`;
    d += " L1200 60 Z";
    $(".hero-tear path").setAttribute("d", d);
  })();


  /* ---------- scroll reveals ---------- */
  const io = "IntersectionObserver" in window && !reduce
    ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.15 })
    : null;
  document.querySelectorAll(".reveal").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));

  /* ---------- RSVP countdown ---------- */
  const deadline = new Date(2026, 11, 1, 23, 59);
  const days = Math.ceil((deadline - new Date()) / 864e5);
  if (days > 0) {
    const c = $("#countdown");
    c.textContent = days === 1 ? "Last day to RSVP!" : `${days} days left to RSVP`;
    c.hidden = false;
  }

  /* ---------- the mango ---------- */
  const BITES = [ // [cx, cy, r] in the 300x380 viewBox, eaten in this order
    [278, 150, 72], [24, 232, 74], [270, 296, 74], [46, 118, 70],
    [150, 392, 76], [228, 50, 58], [40, 336, 66], [292, 222, 64],
  ];
  const mangoBtn = $("#mango"), svg = $(".mango"), fx = $("#fx");
  const skinBites = $("#skinBites"), fleshBites = $("#fleshBites"), mouth = $(".mouth");
  const MOUTH_HAPPY = mouth.getAttribute("d"), MOUTH_O = "M140 206 Q151 196 162 206 Q164 226 151 228 Q138 226 140 206 Z";
  let eaten = 0, finished = false, audio;

  function biteShape(group, cx, cy, r, grow) {
    // a bite = one big circle plus a row of small ones along its inner edge (tooth marks)
    const g = document.createElementNS(NS, "g");
    const toward = Math.atan2(205 - cy, 150 - cx);
    const circles = [[cx, cy, r + grow]];
    for (let k = -2; k <= 2; k++) {
      const a = toward + k * 0.36;
      circles.push([cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), r * 0.2 + grow]);
    }
    circles.forEach(([x, y, rr]) => {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", reduce ? rr : 0);
      c.dataset.r = rr; g.appendChild(c);
    });
    group.appendChild(g);
    return g;
  }
  function growCircles(groups) {
    if (reduce) return;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 150), e = 1 - Math.pow(1 - k, 3);
      groups.forEach((g) => g.querySelectorAll("circle").forEach((c) => c.setAttribute("r", (c.dataset.r * e).toFixed(2))));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function crunch() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const now = audio.currentTime;
      for (let i = 0; i < 3; i++) {
        const len = 0.05, buf = audio.createBuffer(1, audio.sampleRate * len, audio.sampleRate), d = buf.getChannelData(0);
        for (let s = 0; s < d.length; s++) d[s] = (Math.random() * 2 - 1) * Math.pow(1 - s / d.length, 2);
        const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
        src.buffer = buf; f.type = "bandpass"; f.frequency.value = 1800 + Math.random() * 1600; f.Q.value = 0.8;
        g.gain.value = 0.22;
        src.connect(f).connect(g).connect(audio.destination);
        src.start(now + i * 0.045);
      }
    } catch (_) { /* sound is a bonus */ }
  }

  function burst(cx, cy, n, word) {
    if (reduce) return;
    const box = fx.getBoundingClientRect(), sx = box.width / 300, sy = box.height / 380;
    const x0 = cx * sx, y0 = cy * sy;
    const out = Math.atan2(cy - 205, cx - 150); // fly away from the middle
    for (let i = 0; i < n; i++) {
      const el = document.createElement("span");
      const isDrop = i % 3 !== 0;
      el.className = "bit " + (isDrop ? "drop" : "shard");
      if (!isDrop) el.style.background = ["#f2453a", "#ff8a2a", "#ffc23a", "#b9cf45"][i % 4];
      const a = out + (Math.random() - 0.5) * 1.8, dist = 50 + Math.random() * 90;
      const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist, rot = Math.random() * 540 - 270, s = 0.6 + Math.random() * 0.8;
      fx.appendChild(el);
      el.animate([
        { transform: `translate(${x0}px, ${y0}px) scale(${s}) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${x0 + dx * 0.7}px, ${y0 + dy * 0.7 - 30}px) scale(${s}) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${x0 + dx}px, ${y0 + dy + 140}px) scale(${s * 0.8}) rotate(${rot}deg)`, opacity: 0 },
      ], { duration: 750 + Math.random() * 300, easing: "cubic-bezier(.25,.6,.45,1)" }).onfinish = () => el.remove();
    }
    if (word) {
      const w = document.createElement("span");
      w.className = "bit word"; w.textContent = word;
      w.style.background = ["#f0645a", "#1f86c8", "#4aa851", "#f7923a"][eaten % 4];
      fx.appendChild(w);
      const wx = Math.max(0, Math.min(box.width - 110, x0 - 50)), wy = Math.max(-30, y0 - 50);
      w.animate([
        { transform: `translate(${wx}px, ${wy}px) scale(.3) rotate(-14deg)`, opacity: 0 },
        { transform: `translate(${wx}px, ${wy - 20}px) scale(1.1) rotate(6deg)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${wx}px, ${wy - 50}px) scale(1) rotate(-3deg)`, opacity: 0 },
      ], { duration: 900, easing: "ease-out" }).onfinish = () => w.remove();
    }
  }

  function bite() {
    if (finished) { reveal(); return; }
    const [cx, cy, r] = BITES[eaten];
    growCircles([biteShape(fleshBites, cx, cy, r, 0), biteShape(skinBites, cx, cy, r, 9)]);
    eaten++;
    crunch();
    if (navigator.vibrate) navigator.vibrate(12);
    burst(cx, cy, 14, null);
    mangoBtn.classList.remove("chomp"); void mangoBtn.offsetWidth; mangoBtn.classList.add("chomp");
    mouth.setAttribute("d", MOUTH_O);
    setTimeout(() => !finished && mouth.setAttribute("d", MOUTH_HAPPY), 380);

    if (eaten < BITES.length) return;
    finished = true;
    svg.classList.add("done");
    mangoBtn.setAttribute("aria-label", "Open the invite");
    burst(150, 220, 22, null);
    setTimeout(reveal, reduce ? 600 : 1700);
  }

  let revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    const intro = $("#intro"), invite = $("#invite");
    document.body.classList.remove("eating");
    invite.removeAttribute("aria-hidden");
    window.scrollTo(0, 0);
    intro.classList.add("leaving");
    setTimeout(() => { intro.classList.add("gone"); intro.setAttribute("aria-hidden", "true"); }, reduce ? 50 : 1050);
    $(".title-card h1").setAttribute("tabindex", "-1");
    $(".title-card h1").focus({ preventScroll: true });
  }

  mangoBtn.addEventListener("click", bite);
  if (location.hash === "#invite" || location.hash === "#rsvp") {
    reveal();
    if (location.hash === "#rsvp") setTimeout(() => $("#rsvp").scrollIntoView(), 60);
  }

  /* ---------- RSVP ---------- */
  const form = $("#rsvp-form"), msg = $("#form-msg"), weeks = $("#weeks"), other = $("#other-field");
  const thanks = $("#thanks"), sendBtn = form.querySelector(".send");
  form.addEventListener("change", (e) => {
    if (e.target.name !== "attending") return;
    const yes = e.target.value === "yes";
    weeks.hidden = !yes;
    other.hidden = false;
    $("#other-label").textContent = yes ? "Other dates you can't make, or anything else" : "Anything you want to tell me?";
    $("#other").placeholder = yes ? "e.g. not before Apr 20" : "Optional";
  });

  function confetti() {
    if (reduce) return;
    const host = document.createElement("div");
    host.className = "fx"; host.style.position = "fixed"; host.style.zIndex = 40;
    document.body.appendChild(host);
    const W = innerWidth, H = innerHeight;
    for (let i = 0; i < 40; i++) {
      const el = document.createElement("span");
      el.className = "bit shard";
      el.style.background = ["#f0645a", "#ffc94a", "#35bdb3", "#1f86c8", "#4aa851", "#f7923a"][i % 6];
      el.style.width = el.style.height = 10 + Math.random() * 8 + "px";
      host.appendChild(el);
      const x = Math.random() * W, drift = (Math.random() - 0.5) * 160;
      el.animate([
        { transform: `translate(${x}px, -30px) rotate(0deg)` },
        { transform: `translate(${x + drift}px, ${H + 40}px) rotate(${Math.random() * 900}deg)` },
      ], { duration: 1800 + Math.random() * 1400, delay: Math.random() * 400, easing: "cubic-bezier(.3,.2,.6,1)", fill: "both" });
    }
    setTimeout(() => host.remove(), 4000);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    const fd = new FormData(form);
    const name = (fd.get("name") || "").trim();
    const attending = fd.get("attending");
    if (!name) { msg.textContent = "Pop your name in first 🙂"; $("#name").focus(); return; }
    if (!attending) { msg.textContent = "Let me know if you're in or out."; form.querySelector("[name=attending]").focus(); return; }
    const data = {
      name, attending,
      cant_make_weeks: attending === "yes" ? fd.getAll("weeks").join(", ") : "",
      cant_make_other: (fd.get("other") || "").trim(),
      company: fd.get("company") || "",
      sent_at: new Date().toISOString(),
    };
    const endpoint = (window.RSVP_ENDPOINT || "").trim();
    sendBtn.disabled = true; sendBtn.textContent = "Sending…";
    try {
      if (endpoint) {
        // sendBeacon hands the POST to the browser and returns at once: it never waits on
        // Google's redirect, which could hang on phones and leave the button on "Sending…".
        // text/plain = no preflight, which is what a Google Apps Script web app needs.
        const body = JSON.stringify(data);
        const queued = navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain;charset=utf-8" }));
        if (!queued) {
          // Fallback: fetch, but never wait more than 8 seconds for Google's reply.
          const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
          try {
            await fetch(endpoint, { method: "POST", mode: "no-cors", keepalive: true, signal: ctl.signal, headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
          } catch (err) {
            if (err.name !== "AbortError") throw err; // a timeout: the POST has usually landed already
          } finally { clearTimeout(timer); }
        }
      } else {
        console.warn("RSVP_ENDPOINT is empty (config.js): test mode, nothing saved.", data);
      }
      showThanks(data, !endpoint);
    } catch (err) {
      msg.textContent = "Hmm, that didn't send. Check your signal and try again, or just text Cody.";
    } finally {
      sendBtn.disabled = false; sendBtn.textContent = "Send my RSVP";
    }
  });

  function showThanks(d, testMode) {
    const first = d.name.split(/\s+/)[0];
    const yes = d.attending === "yes";
    $("#thanks-big").textContent = yes ? `You're in, ${first}! 🤙` : `Bummer, ${first}! 🧡`;
    $("#thanks-small").textContent = yes
      ? "Got it. I'll lock down the house and the exact week once the headcount's in."
      : "Thanks for letting me know. You'll be missed out there.";
    $("#test-note").hidden = !testMode;
    form.hidden = true; thanks.hidden = false; thanks.focus();
    if (yes) confetti();
  }
  $("#again").addEventListener("click", () => { thanks.hidden = true; form.hidden = false; $("#name").focus(); });
})();
