/* /lab/hero controls: chips per scene, prev / pause / next, play-all toggle. ?s=<name> starts on a scene. */
(function () {
  'use strict';
  if (!window.HeroScenes) return;
  var $ = function (id) { return document.getElementById(id); };
  var chips = $('lab-chips'), names = window.HeroScenes.ORDER, S = window.HeroScenes.SCENES;
  names.forEach(function (n, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'lab-chip'; b.dataset.i = i;
    b.innerHTML = '<small>' + (i + 1) + '</small>' + S[n].word.replace('.', '');
    chips.appendChild(b);
  });
  var q = new URLSearchParams(location.search), start = Math.max(0, names.indexOf(q.get('s') || ''));
  var api = window.HeroScenes.mount($('lab-stage'), {
    start: start, loop: true,
    onChange: function (i, name, sc) {
      $('lab-name').textContent = (i + 1) + ' / ' + names.length + ' · ' + sc.word.replace('.', '');
      $('lab-blurb').textContent = sc.blurb;
      chips.querySelectorAll('.lab-chip').forEach(function (c) { c.setAttribute('aria-pressed', String(+c.dataset.i === i)); });
      history.replaceState(null, '', '?s=' + name);
    },
  });
  chips.addEventListener('click', function (e) { var b = e.target.closest('.lab-chip'); if (b) api.play(+b.dataset.i); });
  $('lab-next').addEventListener('click', function () { api.next(); });
  $('lab-prev').addEventListener('click', function () { api.prev(); });
  var paused = false;
  $('lab-pause').addEventListener('click', function () { paused = !paused; paused ? api.pause() : api.resume(); this.textContent = paused ? 'Play' : 'Pause'; });
  $('lab-loop').addEventListener('change', function () { api.setLoop(this.checked); });
})();
