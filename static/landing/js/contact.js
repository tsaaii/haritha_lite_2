/* Contact form: inline validation + fetch submit to /api/contact.
   Without JS the same form posts normally and comes back to /?sent=1#contact. */
(function () {
  'use strict';
  var form = document.getElementById('contact-form');
  if (!form || !window.fetch) return;
  var errEl = form.querySelector('.cform-err'), btn = form.querySelector('.cform-submit');
  var label = btn.querySelector('.cform-label'), done = form.querySelector('.cform-done');
  var EMAIL = /^[^@\s<>"',;]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;
  var started = false;
  var adv = function () { return window.__adv || { vid: '', ref: '', mark: function () {}, form: function () {} }; };

  if (form.getAttribute('data-state') === 'sent') adv().form('sent');

  function fieldOf(name) {
    var el = form.elements[name];
    return el && (el.length ? el[0] : el).closest('.field');
  }
  function clearErrors() {
    form.querySelectorAll('.field.is-invalid').forEach(function (f) { f.classList.remove('is-invalid'); });
    form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    errEl.textContent = '';
  }
  function fail(msg, name) {
    errEl.textContent = msg;
    if (name) {
      var f = fieldOf(name); if (f) f.classList.add('is-invalid');
      var el = form.elements[name]; el = el && el.length ? el[0] : el;
      if (el) { el.setAttribute('aria-invalid', 'true'); el.focus({ preventScroll: false }); }
    }
  }
  function validate(d) {
    if (d.name.length < 2) return ['Please tell us your name.', 'name'];
    if (!EMAIL.test(d.email)) return ['Please enter a valid email address.', 'email'];
    if (!d.interest) return ["Please choose what you're looking for.", 'interest'];
    if (d.interest === 'other' && d.details.length < 3) return ["Tell us a little about what you're looking for.", 'details'];
    return null;
  }

  form.addEventListener('input', function (e) {
    if (!started) { started = true; adv().form('started'); }
    var f = e.target.closest('.field');
    if (f && f.classList.contains('is-invalid')) { f.classList.remove('is-invalid'); e.target.removeAttribute('aria-invalid'); errEl.textContent = ''; }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.getAttribute('data-state') === 'sending') return;
    clearErrors();
    var el = form.elements, checked = form.querySelector('input[name="interest"]:checked');
    var d = {
      name: el.name.value.trim(), email: el.email.value.trim(), interest: checked ? checked.value : '',
      details: el.details.value.trim(), website: el.website.value, t: el.t.value,
      ref: adv().ref || '', vid: adv().vid || '', referrer: document.referrer || ''
    };
    var bad = validate(d);
    if (bad) { fail(bad[0], bad[1]); return; }

    form.setAttribute('data-state', 'sending');
    btn.disabled = true; label.textContent = 'Sending';
    fetch('/api/contact', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(d)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false }; }).then(function (j) { return { status: r.status, j: j }; });
    }).then(function (res) {
      if (res.j && res.j.ok) {
        form.setAttribute('data-state', 'sent');
        adv().form('sent');
        done.focus();
        return;
      }
      form.setAttribute('data-state', 'idle');
      fail((res.j && res.j.error) || "That didn't go through. Please email us at wecare@advitiaum.com.", res.j && res.j.field);
    }).catch(function () {
      form.setAttribute('data-state', 'idle');
      fail("You seem to be offline. Please try again, or email wecare@advitiaum.com.");
    }).then(function () {
      if (form.getAttribute('data-state') !== 'sent') { btn.disabled = false; label.textContent = 'Send message'; }
    });
  });
})();
