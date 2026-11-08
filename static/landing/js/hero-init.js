/* Landing hero: play the word scenes (js/hero-scenes.js) in the stage inside the <h1>.
   To change which scenes play, or their order, edit SCENES below (names from HeroScenes.ORDER):
   tracing, processing, sorting, reclaiming, recovery, remediating, auditing, afr. */
(function () {
  'use strict';
  var SCENES = ['tracing', 'processing', 'sorting', 'reclaiming', 'recovery', 'remediating', 'auditing', 'afr'];
  var stage = document.getElementById('hero-stage');
  if (!stage || !window.HeroScenes) return;          // no JS / GSAP: the static "Tracing." stays
  window.__hero = window.HeroScenes.mount(stage, { scenes: SCENES, loop: true });   // js/prefs.js replays it when motion settings change
})();
