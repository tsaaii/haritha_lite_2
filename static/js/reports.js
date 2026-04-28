/**
 * Records Explorer — vanilla JS controller.
 *
 * Loading UX
 *   - First load (no data yet): full overlay with spinner
 *   - Subsequent refreshes:     thin top progress bar; existing rows
 *                                remain visible and readable
 *
 * Export PDF
 *   - Sends the active filter set + the columns you've ticked in the
 *     column picker. Each section in the PDF will render a detail
 *     records table using exactly those columns.
 */
(function () {
  'use strict';

  const BOOT = JSON.parse(document.getElementById('js-bootstrap').textContent);
  const ENDPOINTS = BOOT.endpoints;
  const DEFAULTS = BOOT.defaults;

  const COLUMN_STORAGE_KEY = 'reports.columns.v1';

  // Mirror of pdf_export.COLUMN_SCHEMA. Keep these in sync.
  const COLUMNS = [
    { key: 'date',                label: 'Date',          default: true },
    { key: 'time',                label: 'Time',          default: true },
    { key: 'site_name',           label: 'Site',          default: true },
    { key: 'cluster',             label: 'Cluster',       default: false },
    { key: 'agency_name',         label: 'Agency',        default: false },
    { key: 'vehicle_no',          label: 'Vehicle No',    default: true },
    { key: 'ticket_no',           label: 'Ticket No',     default: true },
    { key: 'material',            label: 'Material',      default: true },
    { key: 'material_type',       label: 'Material Type', default: false },
    { key: 'transfer_party_name', label: 'Transfer Party',default: true },
    { key: 'first_weight',        label: 'First Wt (kg)', default: true,  align: 'right', numeric: true },
    { key: 'first_timestamp',     label: 'First Time',    default: false },
    { key: 'second_weight',       label: 'Second Wt (kg)',default: true,  align: 'right', numeric: true },
    { key: 'second_timestamp',    label: 'Second Time',   default: false },
    { key: 'net_weight',          label: 'Net Wt (kg)',   default: true,  align: 'right', numeric: true },
    { key: 'net_weight_calculated', label: 'Net Wt Calc', default: false, align: 'right', numeric: true },
    { key: 'site_incharge',       label: 'Site Incharge', default: false },
    { key: 'user_name',           label: 'User',          default: false },
    { key: 'record_status',       label: 'Status',        default: false, isStatus: true },
    { key: 'cloud_upload_timestamp', label: 'Uploaded',   default: false },
  ];

  const state = {
    page: 1,
    pageSize: DEFAULTS.pageSize || 50,
    visibleCols: loadVisibleCols(),
    activePreset: null,
    inFlightAbort: null,
    lastResponse: null,
    hasRendered: false,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    body:           document.body,
    form:           $('js-filter-form'),
    startDate:      $('js-start-date'),
    endDate:        $('js-end-date'),
    chipButtons:    document.querySelectorAll('.reports-chip'),
    advancedToggle: $('js-advanced-toggle'),
    advancedRow:    $('js-advanced-row'),
    reset:          $('js-reset'),
    apply:          $('js-apply'),
    pageSize:       $('js-page-size'),
    columnsToggle:  $('js-columns-toggle'),
    columnsPanel:   $('js-columns-panel'),
    columnsWrap:    $('js-columns-wrap'),
    exportBtn:      $('js-export-pdf'),
    tableWrap:      $('js-table-wrap'),
    tableHead:      $('js-table-head'),
    tableBody:      $('js-table-body'),
    overlay:        $('js-overlay'),
    progress:       $('js-progress'),
    empty:          $('js-empty'),
    emptyTitle:     $('js-empty-title'),
    emptyText:      $('js-empty-text'),
    emptyActions:   $('js-empty-actions'),
    count:          $('js-result-count'),
    pagination:     $('js-pagination'),
    prevPage:       $('js-prev-page'),
    nextPage:       $('js-next-page'),
    pageInfo:       $('js-page-info'),
    debugDot:       $('js-debug-dot'),
    debugMeta:      $('js-debug-meta'),
    debugUrl:       $('js-debug-url'),
    debugCopy:      $('js-debug-copy'),
    debugOpen:      $('js-debug-open'),
  };

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------
  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      window.clearTimeout(t);
      t = window.setTimeout(() => fn(...args), ms);
    };
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function fmtNum(v) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function fmtCell(record, col) {
    const raw = record[col.key];
    if (raw === null || raw === undefined || raw === '') return '—';
    if (col.numeric) return fmtNum(raw);
    return String(raw);
  }

  function loadVisibleCols() {
    try {
      const stored = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr) && arr.length) return new Set(arr);
      }
    } catch (_) { /* ignore */ }
    return new Set(COLUMNS.filter((c) => c.default).map((c) => c.key));
  }

  function saveVisibleCols() {
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY,
        JSON.stringify(Array.from(state.visibleCols)));
    } catch (_) { /* ignore */ }
  }

  /** Return the visible columns in their schema-defined order. */
  function orderedVisibleColumnKeys() {
    return COLUMNS.filter((c) => state.visibleCols.has(c.key)).map((c) => c.key);
  }

  // -------------------------------------------------------------------------
  // Filter form helpers
  // -------------------------------------------------------------------------
  function getFilters() {
    const fd = new FormData(els.form);
    const out = {};
    fd.forEach((v, k) => {
      const trimmed = String(v).trim();
      if (trimmed) out[k] = trimmed;
    });
    return out;
  }

  function setFilter(name, value) {
    const f = els.form.elements.namedItem(name);
    if (f) f.value = value || '';
  }

  function resetFilters() {
    els.form.reset();
    state.activePreset = null;
    refreshChipState();
  }

  // -------------------------------------------------------------------------
  // Date presets
  // -------------------------------------------------------------------------
  function applyPreset(preset) {
    const today = new Date();
    let start = null, end = null;
    if (preset === '24h') {
      const y = new Date(today); y.setDate(today.getDate() - 1);
      start = y; end = today;
    } else if (preset === '7d') {
      const s = new Date(today); s.setDate(today.getDate() - 6);
      start = s; end = today;
    } else if (preset === '30d') {
      const s = new Date(today); s.setDate(today.getDate() - 29);
      start = s; end = today;
    } else if (preset === 'all') {
      start = null; end = null;
    }
    setFilter('start_date', start ? isoDate(start) : '');
    setFilter('end_date',   end   ? isoDate(end)   : '');
    state.activePreset = preset;
    refreshChipState();
  }

  function refreshChipState() {
    els.chipButtons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.preset === state.activePreset);
    });
  }

  function inferPresetFromDates() {
    const s = els.startDate.value;
    const e = els.endDate.value;
    state.activePreset = (!s && !e) ? 'all' : null;
    refreshChipState();
  }

  // -------------------------------------------------------------------------
  // Columns popover
  // -------------------------------------------------------------------------
  function buildColumnsPanel() {
    const head = document.createElement('div');
    head.className = 'reports-columns__head';
    head.textContent = 'Show columns';
    els.columnsPanel.appendChild(head);

    COLUMNS.forEach((col) => {
      const row = document.createElement('label');
      row.className = 'reports-columns__row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.visibleCols.has(col.key);
      cb.addEventListener('change', () => {
        if (cb.checked) state.visibleCols.add(col.key);
        else state.visibleCols.delete(col.key);
        saveVisibleCols();
        rerenderTable(state.lastResponse);
      });

      const span = document.createElement('span');
      span.textContent = col.label;

      row.appendChild(cb);
      row.appendChild(span);
      els.columnsPanel.appendChild(row);
    });
  }

  function isColumnsPanelOpen() {
    return !els.columnsPanel.hasAttribute('hidden');
  }

  function toggleColumnsPanel(force) {
    const open = (force === undefined) ? !isColumnsPanelOpen() : force;
    if (open) {
      els.columnsPanel.removeAttribute('hidden');
      els.columnsToggle.setAttribute('aria-expanded', 'true');
    } else {
      els.columnsPanel.setAttribute('hidden', '');
      els.columnsToggle.setAttribute('aria-expanded', 'false');
    }
  }

  document.addEventListener('click', (e) => {
    if (!isColumnsPanelOpen()) return;
    if (!els.columnsWrap.contains(e.target)) toggleColumnsPanel(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isColumnsPanelOpen()) toggleColumnsPanel(false);
  });

  // -------------------------------------------------------------------------
  // Loading indicators
  // -------------------------------------------------------------------------
  function showOverlay(show) {
    if (show) els.overlay.removeAttribute('hidden');
    else els.overlay.setAttribute('hidden', '');
  }
  function showProgress(show) {
    if (show) {
      els.progress.removeAttribute('hidden');
      els.body.classList.add('is-refreshing');
    } else {
      els.progress.setAttribute('hidden', '');
      els.body.classList.remove('is-refreshing');
    }
  }

  // -------------------------------------------------------------------------
  // Table rendering
  // -------------------------------------------------------------------------
  function rerenderTable(response) {
    let visibleCols = COLUMNS.filter((c) => state.visibleCols.has(c.key));
    if (!visibleCols.length) {
      state.visibleCols = new Set(COLUMNS.filter((c) => c.default).map((c) => c.key));
      saveVisibleCols();
      els.columnsPanel.querySelectorAll('input[type="checkbox"]').forEach((cb, i) => {
        cb.checked = state.visibleCols.has(COLUMNS[i].key);
      });
      visibleCols = COLUMNS.filter((c) => state.visibleCols.has(c.key));
    }

    els.tableHead.innerHTML = '';
    visibleCols.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c.label;
      if (c.align === 'right') th.style.textAlign = 'right';
      els.tableHead.appendChild(th);
    });

    els.tableBody.innerHTML = '';
    const records = (response && response.records) || [];
    records.forEach((rec) => {
      const tr = document.createElement('tr');
      visibleCols.forEach((c) => {
        const td = document.createElement('td');
        if (c.align === 'right') td.className = 'num';
        if (c.isStatus && rec[c.key]) {
          const span = document.createElement('span');
          span.className = 'pill';
          span.textContent = rec[c.key];
          td.appendChild(span);
        } else {
          td.textContent = fmtCell(rec, c);
        }
        tr.appendChild(td);
      });
      els.tableBody.appendChild(tr);
    });

    const isEmpty = !records.length;
    els.empty.hidden = !isEmpty;
    els.tableWrap.hidden = isEmpty;
    if (isEmpty) renderEmptyState(response);

    const pg = (response && response.pagination) || {};
    const totalPages = pg.pages || 0;
    const total = pg.total || 0;
    if (totalPages > 1) {
      els.pagination.hidden = false;
      els.pageInfo.textContent = `Page ${pg.page} of ${totalPages}`;
      els.prevPage.disabled = pg.page <= 1;
      els.nextPage.disabled = pg.page >= totalPages;
    } else {
      els.pagination.hidden = true;
    }

    if (total > 0) {
      const lo = (pg.page - 1) * pg.limit + 1;
      const hi = Math.min(lo + records.length - 1, total);
      els.count.textContent =
        `${lo.toLocaleString('en-IN')}–${hi.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} records`;
    } else {
      els.count.textContent = '0 records';
    }

    state.hasRendered = true;
  }

  function renderEmptyState(response) {
    els.emptyActions.innerHTML = '';
    const meta = (response && response._meta) || {};

    if (meta.error) {
      els.emptyTitle.textContent = 'Could not reach the records service';
      els.emptyText.textContent = 'The upstream API returned an error. Please try again in a moment.';
      const btn = document.createElement('button');
      btn.className = 'reports-btn reports-btn--secondary';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => loadRecords());
      els.emptyActions.appendChild(btn);
      return;
    }

    els.emptyTitle.textContent = 'No records match these filters';
    els.emptyText.textContent =
      'Try widening the date range or clearing some of the dropdowns.';

    if (state.activePreset === '24h') {
      const btn = document.createElement('button');
      btn.className = 'reports-btn reports-btn--secondary';
      btn.textContent = 'Show last 7 days';
      btn.addEventListener('click', () => {
        applyPreset('7d');
        loadRecords();
      });
      els.emptyActions.appendChild(btn);
    }

    const reset = document.createElement('button');
    reset.className = 'reports-btn reports-btn--ghost';
    reset.textContent = 'Reset all filters';
    reset.addEventListener('click', () => {
      resetFilters();
      loadRecords();
    });
    els.emptyActions.appendChild(reset);
  }

  // -------------------------------------------------------------------------
  // Debug strip
  // -------------------------------------------------------------------------
  function renderDebugStrip(meta) {
    const m = meta || {};
    const url = m.upstream_url || '—';
    const tookMs = (typeof m.took_ms === 'number') ? m.took_ms : null;
    const upstreamMs = (typeof m.upstream_ms === 'number') ? m.upstream_ms : null;
    const cached = !!m.cached;
    const error = m.error;

    els.debugUrl.textContent = url;

    if (url && url !== '—') {
      els.debugCopy.disabled = false;
      els.debugOpen.removeAttribute('aria-disabled');
      els.debugOpen.href = url;
    } else {
      els.debugCopy.disabled = true;
      els.debugOpen.setAttribute('aria-disabled', 'true');
      els.debugOpen.removeAttribute('href');
    }

    els.debugDot.classList.remove('is-fast', 'is-slow', 'is-error');
    if (error) {
      els.debugDot.classList.add('is-error');
    } else if (tookMs !== null) {
      if (tookMs < 600) els.debugDot.classList.add('is-fast');
      else if (tookMs < 2000) els.debugDot.classList.add('is-slow');
      else els.debugDot.classList.add('is-error');
    }

    els.debugMeta.innerHTML = '';
    if (error) {
      const chip = document.createElement('span');
      chip.className = 'reports-debug__chip reports-debug__chip--error';
      chip.textContent = `Error: ${String(error).slice(0, 80)}`;
      els.debugMeta.appendChild(chip);
      return;
    }

    if (tookMs !== null) {
      const timeChip = document.createElement('span');
      timeChip.className = 'reports-debug__chip reports-debug__chip--time';
      timeChip.textContent = `${tookMs} ms`;
      els.debugMeta.appendChild(timeChip);
    }

    if (cached) {
      const chip = document.createElement('span');
      chip.className = 'reports-debug__chip reports-debug__chip--cache-hit';
      chip.textContent = 'Cache HIT';
      els.debugMeta.appendChild(chip);
    } else if (upstreamMs !== null) {
      const chip = document.createElement('span');
      chip.className = 'reports-debug__chip reports-debug__chip--cache-miss';
      chip.textContent = `Upstream ${upstreamMs} ms`;
      els.debugMeta.appendChild(chip);
    }
  }

  // -------------------------------------------------------------------------
  // Fetch
  // -------------------------------------------------------------------------
  async function loadRecords() {
    if (state.inFlightAbort) state.inFlightAbort.abort();
    const ctrl = new AbortController();
    state.inFlightAbort = ctrl;

    if (!state.hasRendered) showOverlay(true);
    else                     showProgress(true);

    const params = new URLSearchParams(getFilters());
    params.set('page', String(state.page));
    params.set('limit', String(state.pageSize));

    try {
      const resp = await fetch(`${ENDPOINTS.records}?${params.toString()}`, {
        signal: ctrl.signal,
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin',
      });
      const data = await resp.json();
      state.lastResponse = data;
      rerenderTable(data);
      renderDebugStrip(data && data._meta);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Failed to load records', err);
        state.lastResponse = { records: [], _meta: { error: err.message } };
        rerenderTable(state.lastResponse);
        renderDebugStrip(state.lastResponse._meta);
      }
    } finally {
      if (state.inFlightAbort === ctrl) {
        showOverlay(false);
        showProgress(false);
        state.inFlightAbort = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // PDF export
  // Forwards filters AND visible columns to the server endpoint so each
  // section's detail records table mirrors what's on screen.
  // -------------------------------------------------------------------------
  function exportPdf() {
    const params = new URLSearchParams(getFilters());
    const cols = orderedVisibleColumnKeys();
    if (cols.length) {
      params.set('columns', cols.join(','));
    }
    const url = `${ENDPOINTS.exportPdf}?${params.toString()}`;
    const original = els.exportBtn.innerHTML;
    els.exportBtn.disabled = true;
    els.exportBtn.innerHTML = '<span aria-hidden="true">⏳</span> Preparing…';

    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.setTimeout(() => {
      els.exportBtn.disabled = false;
      els.exportBtn.innerHTML = original;
    }, 1800);
  }

  async function copyDebugUrl() {
    const url = els.debugUrl.textContent || '';
    if (!url || url === '—') return;

    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch (_) { /* fall back */ }

    if (!ok) {
      try {
        const range = document.createRange();
        range.selectNodeContents(els.debugUrl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        ok = true;
      } catch (_) { /* ignore */ }
    }

    if (ok) {
      const original = els.debugCopy.textContent;
      els.debugCopy.textContent = 'Copied!';
      window.setTimeout(() => { els.debugCopy.textContent = original; }, 1300);
    }
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------
  const debouncedLoad = debounce(() => {
    state.page = 1;
    loadRecords();
  }, 300);

  els.form.addEventListener('input', (e) => {
    if (e.target === els.startDate || e.target === els.endDate) {
      inferPresetFromDates();
    }
    debouncedLoad();
  });
  els.form.addEventListener('change', debouncedLoad);

  els.chipButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      applyPreset(btn.dataset.preset);
      state.page = 1;
      loadRecords();
    });
  });

  els.advancedToggle.addEventListener('click', () => {
    const expanded = els.advancedToggle.getAttribute('aria-expanded') === 'true';
    els.advancedToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    if (expanded) els.advancedRow.setAttribute('hidden', '');
    else els.advancedRow.removeAttribute('hidden');
  });

  els.reset.addEventListener('click', () => {
    resetFilters();
    state.page = 1;
    applyPreset('24h');
    loadRecords();
  });
  els.apply.addEventListener('click', () => {
    state.page = 1;
    loadRecords();
  });

  els.pageSize.addEventListener('change', () => {
    state.pageSize = parseInt(els.pageSize.value, 10) || DEFAULTS.pageSize;
    state.page = 1;
    loadRecords();
  });

  els.prevPage.addEventListener('click', () => {
    if (state.page > 1) { state.page -= 1; loadRecords(); }
  });
  els.nextPage.addEventListener('click', () => {
    state.page += 1;
    loadRecords();
  });

  buildColumnsPanel();
  els.columnsToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleColumnsPanel();
  });

  els.exportBtn.addEventListener('click', exportPdf);
  els.debugCopy.addEventListener('click', copyDebugUrl);

  els.pageSize.value = String(state.pageSize);
  applyPreset('24h');
  loadRecords();
})();
