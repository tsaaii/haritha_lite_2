/**
 * Agency rotation — pure vanilla JS.
 * Cycles the .agency-header__slide AND .agency-slide elements in lockstep.
 * Pauses on hover. Click a dot to jump.
 */
(function () {
  'use strict';

  const interval = window.HARITHA_ROTATION_MS || 12000;

  const headerSlides = Array.from(document.querySelectorAll('.agency-header__slide'));
  const stageSlides  = Array.from(document.querySelectorAll('.agency-slide'));
  const dots         = Array.from(document.querySelectorAll('.agency-header__dot'));

  const total = Math.max(headerSlides.length, stageSlides.length);
  if (total <= 1) return; // Nothing to rotate

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
    dots.forEach((el, i) => {
      const active = i === currentIndex;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function next() { show(currentIndex + 1); }

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

  // Pause when the user hovers over the agency block or main cards.
  const pauseTargets = [
    document.querySelector('.agency-header'),
    document.querySelector('.main-cards-stage'),
  ].filter(Boolean);

  pauseTargets.forEach((el) => {
    el.addEventListener('mouseenter', () => { paused = true; stop(); });
    el.addEventListener('mouseleave', () => { paused = false; start(); });
  });

  // Click dots to jump
  dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const target = parseInt(dot.dataset.targetIndex || '0', 10);
      show(target);
      // Reset the timer so the user gets a full slot on the chosen slide.
      start();
    });
  });

  // Pause when tab hidden — saves cycles
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (!paused) start();
  });

  // Keyboard support: ← / →
  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { show(currentIndex + 1); start(); }
    else if (e.key === 'ArrowLeft') { show(currentIndex - 1); start(); }
  });

  show(0);
  start();
})();
