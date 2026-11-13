/* ReelStage – centre-stage reels carousel
   Preview mode: the centre reel plays muted for a few seconds, then the next one slides in (looping).
   Watch mode: the shopper presses play and the whole reel plays with sound; afterwards previews continue.
   Side reels are smaller and tilted; click one to bring it to the centre. */
(function () {
  function init(root) {
    if (root.__vr) return;
    root.__vr = true;
    var stage = root.querySelector('.vr__stage');
    if (!stage) return;
    var cards = [].slice.call(stage.querySelectorAll('.vr__card'));
    var n = cards.length;
    if (!n) return;

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var advance = root.getAttribute('data-advance') !== 'false' && !reduce;
    var previewLen = Math.max(1, Number(root.getAttribute('data-preview')) || 4);
    var sidesWanted = Number(root.getAttribute('data-sides')) || 2;
    var strip = root.getAttribute('data-layout') === 'strip';

    var active = 0;
    var full = false;          // watching the whole reel
    var soundOn = true;        // sound in watch mode (shopper can mute)
    var userPaused = false;    // paused in watch mode
    var slideshowOff = !advance;
    var startedAt = 0;        // when the current preview started (wall clock)
    var inView = false;
    var raf = 0;

    var autoBtn = root.querySelector('.vr__auto');
    if (autoBtn && !advance) autoBtn.hidden = true;

    var dotsBox = root.querySelector('.vr__dots');
    var dots = [];
    if (dotsBox) {
      cards.forEach(function (_, i) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'vr__dot';
        d.setAttribute('role', 'tab');
        d.setAttribute('aria-label', String(i + 1));
        d.addEventListener('click', function () { go(i); });
        dotsBox.appendChild(d);
        dots.push(d);
      });
    }

    function sides() { return window.innerWidth < 750 ? 1 : sidesWanted; }
    function videoOf(i) { return cards[i].querySelector('.vr__video'); }
    function barOf(i) { return cards[i].querySelector('.vr__progress span'); }

    /* shortest way round the circle: -2, -1, 0, 1, 2 ... */
    function offset(i) {
      var d = (i - active + n) % n;
      if (d > n / 2) d -= n;
      return d;
    }

    /* Strip layout: a straight row of thumbnails; the centre one is taller and plays.
       As many thumbnails as fit across the screen are shown. */
    function stripPos(a, w) {
      var small = parseFloat(getComputedStyle(root).getPropertyValue('--vr-strip-scale')) || 0.78;
      var gap = Math.max(10, w * 0.05);
      var s = a === 0 ? 1 : small;
      var x = a === 0 ? 0 : w / 2 + gap + (w * small) / 2 + (a - 1) * (w * small + gap);
      var half = stage.clientWidth / 2;
      var fit = Math.ceil((half - w / 2) / (w * small + gap)) ;
      return { s: s, x: x, hidden: a > Math.max(1, Math.min(fit, Math.floor(n / 2))) };
    }

    function layout() {
      var w = cards[0].offsetWidth;
      var sideScale = parseFloat(getComputedStyle(root).getPropertyValue('--vr-side-scale')) || 0.8;
      var maxSide = sides();
      cards.forEach(function (c, i) {
        var d = offset(i);
        var a = Math.abs(d);
        var s, x = 0, hidden, r = 0;
        if (strip) {
          var p = stripPos(a, w);
          s = p.s; x = p.x; hidden = p.hidden;
        } else {
          s = a === 0 ? (full ? 1.03 : 1) : Math.pow(sideScale, a);
          for (var k = 1; k <= a; k++) x += w * (Math.pow(sideScale, k - 1) + Math.pow(sideScale, k)) / 2 * 0.82;
          if (full && a > 0) x += w * 0.06;
          hidden = a > maxSide;
          r = a === 0 ? 0 : (d < 0 ? 14 : -14);
        }
        x = d < 0 ? -x : x;
        c.style.setProperty('--x', x + 'px');
        c.style.setProperty('--s', s);
        c.style.setProperty('--r', r + 'deg');
        c.style.setProperty('--o', hidden ? 0 : 1);
        c.style.zIndex = String(20 - a);
        c.classList.toggle('is-active', a === 0);
        c.classList.toggle('is-hidden', hidden);
        c.setAttribute('aria-hidden', a === 0 ? 'false' : 'true');
        var pick = c.querySelector('.vr__pick');
        if (pick) pick.tabIndex = hidden || a === 0 ? -1 : 0;
        c.querySelectorAll('.vr__ctrl, .vr__big').forEach(function (b) { b.tabIndex = a === 0 ? 0 : -1; });
      });
      root.classList.toggle('is-watching', full);
      dots.forEach(function (d, i) { d.setAttribute('aria-selected', i === active ? 'true' : 'false'); });
    }

    function stopOthers() {
      cards.forEach(function (c, i) {
        if (i === active) return;
        var v = videoOf(i);
        if (!v.paused) v.pause();
        if (v.currentTime > 0) { try { v.currentTime = 0; } catch (e) {} }
        v.muted = true;
        c.classList.remove('is-full', 'is-paused', 'is-sound');
        var b = barOf(i); if (b) b.style.width = '0';
      });
      // warm up the neighbours so they start instantly
      [1, -1, 2].forEach(function (k) {
        var v = videoOf((active + k + n) % n);
        if (v.preload === 'none') v.preload = 'metadata';
      });
      var cur = videoOf(active);
      if (cur.preload !== 'auto') cur.preload = 'auto';
    }

    function safePlay(v, card) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {
        // the browser refused sound: play muted instead
        if (!v.muted) {
          v.muted = true; soundOn = false; card.classList.remove('is-sound');
          var q = v.play(); if (q && q.catch) q.catch(function () { card.classList.add('is-paused'); });
        } else {
          card.classList.add('is-paused');
        }
      });
    }

    /* ---- preview mode ---- */
    function startPreview() {
      full = false;
      layout();
      stopOthers();
      var v = videoOf(active), card = cards[active];
      card.classList.remove('is-full', 'is-paused', 'is-sound');
      v.muted = true;
      v.loop = false;
      try { v.currentTime = 0; } catch (e) {}
      if (!inView || reduce) { v.pause(); cancelAnimationFrame(raf); return; }
      startedAt = Date.now();
      safePlay(v, card);
      loop();
    }

    /* ---- watch mode ---- */
    function startFull() {
      full = true;
      userPaused = false;
      layout();
      stopOthers();
      var v = videoOf(active), card = cards[active];
      card.classList.add('is-full');
      card.classList.remove('is-paused');
      v.loop = false;
      v.muted = !soundOn;
      card.classList.toggle('is-sound', soundOn);
      try { v.currentTime = 0; } catch (e) {}
      safePlay(v, card);
      loop();
      var pb = card.querySelector('.vr__ctrl--play');
      if (pb) pb.focus({ preventScroll: true });
    }

    function endFull(next) {
      if (!full) return;
      full = false;
      if (next) go(active + 1); else startPreview();
    }

    /* progress bar + timing */
    function loop() {
      cancelAnimationFrame(raf);
      var i = active;
      var v = videoOf(i), bar = barOf(i);
      (function step() {
        if (i !== active) return;
        var dur = v.duration || 0;
        if (full) {
          if (bar && dur) bar.style.width = Math.min(100, (v.currentTime / dur) * 100) + '%';
        } else {
          var len = dur ? Math.min(previewLen, Math.max(0.5, dur - 0.15)) : previewLen;
          if (bar) bar.style.width = Math.min(100, (v.currentTime / len) * 100) + '%';
          // move on when the preview has played, or if the video is slow to load (never get stuck)
          var waited = (Date.now() - startedAt) / 1000;
          if (v.currentTime >= len || waited >= len + 3) {
            if (!slideshowOff && n > 1) { go(active + 1); return; }
            // holding on this reel: keep the preview looping
            if (v.currentTime >= len + 0.05) { try { v.currentTime = 0; } catch (e) {} }
          }
        }
        raf = requestAnimationFrame(step);
      })();
    }

    function go(i) {
      active = ((i % n) + n) % n;
      startPreview();
    }

    cards.forEach(function (c, i) {
      var v = videoOf(i);
      // Instagram cover image expired? use the app's always-current address instead
      var fbp = v.getAttribute('data-fallback');
      if (fbp && v.poster) {
        var probe = new Image();
        probe.onerror = function () { v.poster = fbp + '?poster=1'; };
        probe.src = v.poster;
      }
      v.addEventListener('ended', function () {
        if (i !== active) return;
        if (full) endFull(advance && n > 1);
        else if (!slideshowOff && n > 1) go(active + 1);
        else startPreview();
      });
      v.addEventListener('error', function () {
        // Instagram's video address expired: switch to the app's always-current address once
        var fb = v.getAttribute('data-fallback');
        if (fb && !v.__fb) {
          v.__fb = true;
          v.poster = fb + '?poster=1';
          v.src = fb;
          if (i === active && inView) safePlay(v, c);
          return;
        }
        if (i === active && !full && !slideshowOff && n > 1) setTimeout(function () { if (i === active) go(active + 1); }, 800);
      });
      var pick = c.querySelector('.vr__pick');
      if (pick) pick.addEventListener('click', function () { go(i); });

      var big = c.querySelector('.vr__big');
      if (big) big.addEventListener('click', function () { if (i === active) startFull(); });

      var play = c.querySelector('.vr__ctrl--play');
      if (play) play.addEventListener('click', function () {
        if (v.paused) { userPaused = false; c.classList.remove('is-paused'); safePlay(v, c); loop(); }
        else { userPaused = true; v.pause(); c.classList.add('is-paused'); }
      });
      var snd = c.querySelector('.vr__ctrl--sound');
      if (snd) snd.addEventListener('click', function () {
        soundOn = !soundOn;
        v.muted = !soundOn;
        c.classList.toggle('is-sound', soundOn);
      });
      var close = c.querySelector('.vr__ctrl--close');
      if (close) close.addEventListener('click', function () { endFull(false); });

      // tap on the centre video: preview → watch the full reel; watching → pause / play
      v.addEventListener('click', function () {
        if (i !== active) return;
        if (!full) startFull();
        else if (play) play.click();
      });
    });

    var prev = root.querySelector('.vr__nav--prev'), next = root.querySelector('.vr__nav--next');
    if (prev) prev.addEventListener('click', function () { go(active - 1); });
    if (next) next.addEventListener('click', function () { go(active + 1); });

    if (autoBtn) autoBtn.addEventListener('click', function () {
      slideshowOff = !slideshowOff;
      autoBtn.setAttribute('aria-pressed', slideshowOff ? 'true' : 'false');
    });


    root.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { go(active + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { go(active - 1); e.preventDefault(); }
      if (e.key === 'Escape' && full) { endFull(false); e.preventDefault(); }
    });

    /* swipe on phones */
    var sx = 0, sy = 0;
    stage.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(active + (dx < 0 ? 1 : -1));
    }, { passive: true });

    /* only play while the block is on screen */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        var v = videoOf(active);
        if (inView) {
          if (full) { if (!userPaused) { safePlay(v, cards[active]); loop(); } }
          else startPreview();
        } else {
          v.pause();
          cancelAnimationFrame(raf);
        }
      }, { threshold: 0.35 }).observe(stage);
    } else {
      inView = true;
    }

    window.addEventListener('resize', layout);
    startPreview();
  }

  function boot() { document.querySelectorAll('.vr').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  document.addEventListener('shopify:section:load', boot);
  document.addEventListener('shopify:block:select', boot);
})();
