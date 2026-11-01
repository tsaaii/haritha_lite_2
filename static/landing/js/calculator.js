/* Methane, CO2 and credit calculator. Progressive enhancement over the
   server-rendered defaults (household, 3,000 MT/month). Factors are illustrative. */
(function () {
  'use strict';
  var root = document.querySelector('[data-calc]');
  if (!root) return;

  var GWP = 28;
  var CF = {
    household: { ch4: 0.026, epr: 0.12, note: 'Household: about 60% organics composted aerobically instead of landfilled; plastics and MLP recovered for recycling and co-processing.' },
    legacy: { ch4: 0.008, epr: 0.15, note: 'Legacy: residual methane avoided by excavating and screening the dump; RDF plastics sent for co-processing.' }
  };
  var state = { stream: 'household', tons: 3000 };
  var range = root.querySelector('#calc-tons');
  var btns = root.querySelectorAll('[data-stream]');
  var out = {};
  root.querySelectorAll('[data-out]').forEach(function (el) { out[el.getAttribute('data-out')] = el; });
  var n0 = function (v) { return Math.round(v).toLocaleString('en-US'); };

  function render() {
    var cf = CF[state.stream], yr = state.tons * 12, ch4 = yr * cf.ch4, co2 = ch4 * GWP;
    out.tons.textContent = n0(state.tons) + ' MT';
    out.ch4.textContent = n0(ch4);
    out.co2.textContent = n0(co2);
    out.carbon.textContent = n0(co2);
    out.epr.textContent = n0(yr * cf.epr);
    out.note.textContent = cf.note;
    range.setAttribute('aria-valuetext', n0(state.tons) + ' metric tonnes per month');
    btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-stream') === state.stream)); });
  }

  btns.forEach(function (b) {
    b.addEventListener('click', function () { state.stream = b.getAttribute('data-stream'); render(); });
  });
  range.addEventListener('input', function () { state.tons = +range.value || 100; render(); });
  state.tons = +range.value || 3000; // honour a value restored by the browser on back/forward
  render();
})();
