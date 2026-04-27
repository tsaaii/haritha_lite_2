/**
 * Agency rotation — pure vanilla JS.
 * Cycles the .agency-header__slide AND .agency-slide elements in lockstep.
 * Pauses on hover. Click ‹ / › arrows to skip.
 */
(function () {
  'use strict';

  const interval = window.HARITHA_ROTATION_MS || 12000;

  const headerSlides = Array.from(document.querySelectorAll('.agency-header__slide'));
  const stageSlides  = Array.from(document.querySelectorAll('.agency-slide'));
  const prevBtn      = document.querySelector('.agency-header__nav--prev');
  const nextBtn      = document.querySelector('.agency-header__nav--next');

  const total = Math.max(headerSlides.length, stageSlides.length);
  if (total <= 1) {
    // Hide the arrows if there's nothing to rotate to
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    return;
  }

  let currentIndex = 0;
  let timer = null;
  let paused = false;

  function show(index) {
    currentIndex = ((index % total) + total) % total;

    headerSlides.forEach((el, i) => {
      el.classList.toggle('is-active', i === currentIndex);
    });
    stageSlides.forEach((el, i) => {
      el.classList.toggle('is-active', i === currentIndex);
    });
  }

  function next() { show(currentIndex + 1); }
  function prev() { show(currentIndex - 1); }

  function start() {
    stop();
    if (paused) return;
    timer = window.setInterval(next, interval);
  }

  function stop() {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  // Pause when the user hovers the agency block or main cards.
  const pauseTargets = [
    document.querySelector('.agency-header'),
    document.querySelector('.main-cards-stage'),
  ].filter(Boolean);

  pauseTargets.forEach((el) => {
    el.addEventListener('mouseenter', () => { paused = true; stop(); });
    el.addEventListener('mouseleave', () => { paused = false; start(); });
  });

  // Arrow buttons — skip + reset the timer so the user gets a full slot
  if (prevBtn) prevBtn.addEventListener('click', () => { prev(); start(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { next(); start(); });

  // Pause when tab hidden — saves cycles
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (!paused) start();
  });

  // Keyboard support: ← / →
  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { next(); start(); }
    else if (e.key === 'ArrowLeft') { prev(); start(); }
  });

  show(0);
  start();
})();