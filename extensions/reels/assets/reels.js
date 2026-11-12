/* ReelStage – centre-stage carousel
   The active reel plays in the middle; when it ends the next one moves to the centre
   and plays, going round in a loop. Side reels are smaller; click one to bring it forward. */
(function () {
  function init(root) {
    if (root.__vr) return;
    root.__vr = true;
    var stage = root.querySelector('.vr__stage');
    if (!stage) return;
    var cards = [].slice.call(stage.querySelectorAll('.vr__card'));
    var n = cards.length;
    if (!n) return;

    var advance = root.getAttribute('data-advance') !== 'false';
    var sidesWanted = Number(root.getAttribute('data-sides')) || 2;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var active = 0;
    var soundOn = false;      // stays on for the next reels once the shopper turns it on
    var userPaused = false;
    var inView = false;
    var raf = 0;

    var dotsBox = root.querySelector('.vr__dots');
    var dots = [];
    if (dotsBox) {
      cards.forEach(function (_, i) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'vr__dot';
        d.setAttribute('role', 'tab');
        d.setAttribute('aria-label', String(i + 1));
        d.addEventListener('click', function () { go(i, true); });
        dotsBox.appendChild(d);
        dots.push(d);
      });
    }

    function sides() { return window.innerWidth < 750 ? 1 : sidesWanted; }

    /* shortest way round the circle: -2, -1, 0, 1, 2 ... */
    function offset(i) {
      var d = (i - active + n) % n;
      if (d > n / 2) d -= n;
      return d;
    }

    function layout() {
      var w = cards[0].offsetWidth; // width before scaling
      var sideScale = parseFloat(getComputedStyle(root).getPropertyValue('--vr-side-scale')) || 0.8;
      var maxSide = sides();
      cards.forEach(function (c, i) {
        var d = offset(i);
        var a = Math.abs(d);
        var s = a === 0 ? 1 : Math.pow(sideScale, a);
        // each side card sits just next to the previous one, slightly tucked behind it
        var x = 0;
        for (var k = 1; k <= a; k++) x += w * (Math.pow(sideScale, k - 1) + Math.pow(sideScale, k)) / 2 * 0.86;
        x = d < 0 ? -x : x;
        var hidden = a > maxSide;
        c.style.setProperty('--x', x + 'px');
        c.style.setProperty('--s', s);
        c.style.setProperty('--o', hidden ? 0 : (a === 0 ? 1 : 1 - a * 0.12));
        c.style.zIndex = String(20 - a);
        c.classList.toggle('is-active', a === 0);
        c.classList.toggle('is-hidden', hidden);
        c.setAttribute('aria-hidden', a === 0 ? 'false' : 'true');
        var pick = c.querySelector('.vr__pick');
        if (pick) pick.tabIndex = hidden || a === 0 ? -1 : 0;
        c.querySelectorAll('.vr__ctrl, .vr__ig').forEach(function (b) { b.tabIndex = a === 0 ? 0 : -1; });
      });
      dots.forEach(function (d, i) { d.setAttribute('aria-selected', i === active ? 'true' : 'false'); });
    }

    function videoOf(i) { return cards[i].querySelector('.vr__video'); }

    function playActive() {
      cards.forEach(function (c, i) {
        var v = videoOf(i);
        if (i !== active) {
          if (!v.paused) v.pause();
          if (v.currentTime > 0) { try { v.currentTime = 0; } catch (e) {} }
          c.classList.remove('is-paused');
          var bar = c.querySelector('.vr__progress span'); if (bar) bar.style.width = '0';
        }
      });
      // load the reels next to the centre one so they start quickly
      [active, (active + 1) % n, (active - 1 + n) % n].forEach(function (i) { var v = videoOf(i); if (v.preload === 'none') v.preload = 'metadata'; });

      var v = videoOf(active);
      var card = cards[active];
      v.muted = !soundOn;
      card.classList.toggle('is-sound', soundOn);
      if (!inView || userPaused) { card.classList.add('is-paused'); return; }
      card.classList.remove('is-paused');
      var p = v.play();
      if (p && p.catch) p.catch(function () {
        // the browser blocked sound: play muted instead
        v.muted = true; soundOn = false; card.classList.remove('is-sound');
        var q = v.play(); if (q && q.catch) q.catch(function () { card.classList.add('is-paused'); });
      });
      tick();
    }

    function tick() {
      cancelAnimationFrame(raf);
      var v = videoOf(active);
      var bar = cards[active].querySelector('.vr__progress span');
      (function loop() {
        if (bar && v.duration) bar.style.width = Math.min(100, (v.currentTime / v.duration) * 100) + '%';
        raf = requestAnimationFrame(loop);
      })();
    }

    function go(i, byUser) {
      active = ((i % n) + n) % n;
      if (byUser) userPaused = false;
      layout();
      playActive();
    }

    cards.forEach(function (c, i) {
      var v = videoOf(i);
      v.loop = !advance || n === 1;
      v.addEventListener('ended', function () { if (i === active && advance && n > 1) go(active + 1); });
      v.addEventListener('error', function () { if (i === active && advance && n > 1) setTimeout(function () { go(active + 1); }, 800); });
      var pick = c.querySelector('.vr__pick');
      if (pick) pick.addEventListener('click', function () { go(i, true); });
      var play = c.querySelector('.vr__ctrl--play');
      if (play) play.addEventListener('click', function () {
        if (v.paused) { userPaused = false; playActive(); } else { userPaused = true; v.pause(); c.classList.add('is-paused'); }
      });
      var snd = c.querySelector('.vr__ctrl--sound');
      if (snd) snd.addEventListener('click', function () {
        soundOn = !soundOn;
        v.muted = !soundOn;
        c.classList.toggle('is-sound', soundOn);
        if (soundOn && v.paused) { userPaused = false; playActive(); }
      });
      // tapping the centre video itself pauses / plays
      v.addEventListener('click', function () { if (i === active && play) play.click(); });
    });

    var prev = root.querySelector('.vr__nav--prev'), next = root.querySelector('.vr__nav--next');
    if (prev) prev.addEventListener('click', function () { go(active - 1, true); });
    if (next) next.addEventListener('click', function () { go(active + 1, true); });

    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { go(active + 1, true); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { go(active - 1, true); e.preventDefault(); }
    });

    /* swipe on phones */
    var sx = 0, sy = 0;
    stage.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(active + (dx < 0 ? 1 : -1), true);
    }, { passive: true });

    /* only play while the block is on screen */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        if (inView) playActive();
        else { videoOf(active).pause(); cancelAnimationFrame(raf); }
      }, { threshold: 0.35 }).observe(stage);
    } else {
      inView = true;
    }

    if (reduce) userPaused = true; // shoppers who prefer less motion press play themselves
    window.addEventListener('resize', layout);
    layout();
    playActive();
  }

  function boot() { document.querySelectorAll('.vr').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  document.addEventListener('shopify:section:load', boot);
})();
