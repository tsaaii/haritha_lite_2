(function () {
  var pw = document.getElementById('pw'), t = document.getElementById('pw-toggle');
  if (!pw || !t) return;
  t.addEventListener('click', function () {
    var show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    t.textContent = show ? 'Hide' : 'Show';
  });
})();
