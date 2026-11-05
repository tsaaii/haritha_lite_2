# Meeting invite builder — advitiaum.com/peshi

For Gideon (PA to MD, SAC). Built from the Claude Design handoff "Meeting Invite Builder".

**Open it:** `https://advitiaum.com/peshi`. Enter the password and answer the security question.
`/PESHI` and `/Peshi` lead here too. The session lasts 8 hours; **Sign out** is top right.

**Use:** fill the form; the preview updates as you type. **Copy for WhatsApp** puts the invite
image on the clipboard (paste into WhatsApp web/desktop). If the browser blocks that, it downloads
the PNG instead. **Download** saves e.g. `SBM-U_meeting_2026-11-12.png`.

- **SBM-U** gives a green invite, **SBM-G** an orange one, so it is recognisable from the WhatsApp thumbnail.
- **Required participants:** tap a role to add it. Roles go in by seniority (COO, ED, JD, CE, EE, DEE, AEE;
  Urban before Grameen); hand-typed names go at the end. Press and drag the ⠿ handle to change the order
  (finger or mouse; keyboard: focus ⠿ and use ↑/↓). **Sort by seniority** puts it back.
- **Zoom link** only appears on the invite when filled in.
- **Help contact footer** ("For any queries, contact Gideon, PA to MD, SAC at 9392914488") can be switched off.

## Security

- Password + math captcha + per-IP lockout (5 wrong passwords lock 15 minutes), the same
  `captcha.py` used by `/rdf` and `/TTD`. The captcha is checked first, so bots never reach the
  password check.
- Only the scrypt hash of the password is in the code. To change it, set `PESHI_PASSWORD_HASH`
  (`python -c "from werkzeug.security import generate_password_hash as g; print(g('NEW'))"`).
- Pages send `Cache-Control: no-store`, `X-Robots-Tag: noindex`, a same-origin-only CSP and `X-Frame-Options: DENY`.
- The builder's JS/CSS/logos under `/static/peshi/` are public static files (App Engine serves them
  without Flask). They hold no data or secrets; the page that uses them is only served after sign-in.

## Cloud cost

Next to nothing: the server renders two small templates and checks a password. Meeting details never
leave the browser, the image is made in the browser, and there is no database or storage.
First load is about 125 KB before gzip (logos are 240px PNGs, ~32 KB together, down from 3 MB; the font is the
Pagella woff2 already used by the landing page). Assets carry `?v=<hash>` and are cached for 7 days.

| Piece | File |
| --- | --- |
| Routes, sign-in, headers | `views/peshi.py` (registered in `main.py`) |
| Pages | `templates/peshi/login.html`, `templates/peshi/builder.html` |
| Builder logic, styles, logos, html-to-image 1.11.11 (MIT) | `static/peshi/` |
| Tests | `tests/test_peshi.py` (`python -m unittest tests.test_peshi -v`) |
