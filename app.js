// app.js — Follow-Up CRM (Standalone)
// Full updated JS with robust modal handling for the Add Customer (+) button

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const storeKey = 'followup_crm_v21';
  const THEME_KEY = 'followup_crm_theme';
  const SORT_KEY = 'followup_crm_sort';
  const NOTIFY_KEY = 'followup_crm_notified_today';
  const LEAD_BASE = 'https://old.business-tickets.com/crmcms/assigned-flights/show/';

  // ===== Bulk import state =====
  const bulk = { items: [], selected: new Set() };

  // ====== Utils ======
  function uid() { return 'id' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
  function fmt(d) { if (!(d instanceof Date)) d = new Date(d); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
  function parseLocalYMD(ymd) { if (!ymd) return today(); const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, (m || 1) - 1, d || 1); dt.setHours(0, 0, 0, 0); return dt; }
  function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function safeEmail(s) {
    s = (s || '').trim();
    if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
    return s;
  }

  // ===== Toast =====
  function toast(msg, kind = 'ok', ms = 1800) {
    const host = document.getElementById('toaster') || (() => { const d = document.createElement('div'); d.id = 'toaster'; document.body.appendChild(d); return d; })();
    const el = document.createElement('div');
    el.className = 'toast ' + (kind === 'err' ? 'err' : 'ok');
    el.innerHTML = (kind === 'err' ? '⚠️' : '✅') + ' ' + (msg || '');
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 220); }, ms);
  }

  // ===== Theme =====
  function applyTheme(t) { document.body.classList.toggle('light', t === 'light'); $('#themeToggle').textContent = (t === 'light' ? '🌙 Dark' : '☀️ Light'); }
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  $('#themeToggle')?.addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next); applyTheme(next);
  });

  // ===== Modals =====
  function makeModalFromCard(cardId, modalId) {
    const card = document.getElementById(cardId);
    if (!card) return null;
    let modal = document.getElementById(modalId);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = modalId; modal.className = 'modal'; modal.style.display = 'none';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      document.body.appendChild(modal);
    }
    if (card.parentElement !== modal) modal.appendChild(card);
    modal.addEventListener('click', (e) => { if (e.target === modal) { closeModal(modalId, cardId); } });
    trapFocus(modal);
    return modal;
  }
  function openModal(modalId, cardId) {
    const m = document.getElementById(modalId) || makeModalFromCard(cardId, modalId);
    const c = document.getElementById(cardId);
    if (!m || !c) return;
    c.style.display = 'block';
    m.style.display = 'flex';
    m.classList.add('open');
    document.body.classList.add('modal-open');
    setTimeout(() => m.querySelector('input,textarea,button[autofocus]')?.focus(), 10);
  }
  function closeModal(modalId, cardId) {
    const m = document.getElementById(modalId), c = document.getElementById(cardId);
    if (!m || !c) return;
    m.classList.remove('open'); m.style.display = 'none';
    c.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
  function trapFocus(modal) {
    modal.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const f = modal.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  // ===== State =====
  function defaults() {
    return {
      clients: [],
      tasks: [],
      settings: {
        workingDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
        moveOffDays: true,
        overrides: {}
      }
    };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(storeKey) || 'null') || defaults();
      if (!s.settings) s.settings = defaults().settings;
      return s;
    } catch (e) { return defaults(); }
  }
  const state = load();
  function saveState() { localStorage.setItem(storeKey, JSON.stringify(state)); }
  function save() { saveState(); refresh(); buildCalendar(); }

  // ===== Working days helpers =====
  function weekdayIndex(dt) { const js = dt.getDay(); return (js + 6) % 7; }
  function isWorkingDay(dt) {
    const ymd = fmt(dt);
    const ov = state.settings.overrides[ymd];
    if (ov === 'work') return true;
    if (ov === 'off') return false;
    const map = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    return !!state.settings.workingDays[map[weekdayIndex(dt)]];
  }
  function nextWorkingDay(date) { let d = new Date(date); while (!isWorkingDay(d)) d = addDays(d, 1); return d; }
  function stepByWorkingDays(fromDate, steps) { let d = new Date(fromDate); for (let i = 0; i < steps; i++) d = nextWorkingDay(addDays(d, 1)); return d; }
  function adjustAutoDateIfNeeded(dt) { if (!state.settings.moveOffDays) return dt; let d = new Date(dt); while (!isWorkingDay(d)) d = addDays(d, 1); return d; }

  // ===== Lead Parser =====
  function parseLeadBlob(text) {
    const raw = (text || '').replace(/\r/g, '\n');
    const whole = raw.replace(/\t/g, '  ').replace(/[ \u00A0]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    const email = (whole.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0] || '';
    let noDates = whole.replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?\b/g, ' ').replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
    const phoneCandidates = (noDates.match(/\+?\d[\d\s().-]{6,}\d/g) || []).map(s => s.trim()).filter(s => !/:/.test(s)).filter(s => {
      const digits = s.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15;
    });
    const phone = phoneCandidates[0] || '';
    let name = '';
    const nm = whole.match(/\bnew\b[\s:]+([^\n\t]+?)(?=\s+(?:RT|OW|[A-Z]{2,3}\b)|\t|\n|$)/i);
    if (nm) name = nm[1].trim();
    if (!name && email) {
      const local = email.split('@')[0];
      const parts = local.split(/[._-]+/);
      name = parts.length > 1
        ? parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
        : local.charAt(0).toUpperCase() + local.slice(1);
    }
    const routeMatch = whole.match(/\b[A-Z]{3}(?:\s*[-–—→]\s*[A-Z]{3})+\b/);
    const route = routeMatch ? routeMatch[0].replace(/\s*[-–—→]\s*/g, '-').toUpperCase() : '';
    const monthName = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?)";
    const mDates = whole.match(new RegExp(`\\b${monthName}\\s+\\d{1,2}(?:,\\s*\\d{4})?\\s*(?:-|–|—|to|→)\\s*(?:${monthName}\\s+)?\\d{1,2}(?:,\\s*\\d{4})?\\b`, 'i'));
    let dates = mDates ? mDates[0].replace(/\s{2,}/g, ' ').trim() : '';
    if (!dates) {
      const mYMD = whole.match(/\b\d{4}-\d{2}-\d{2}\s*(?:→|to|–|—|-)\s*\d{4}-\d{2}-\d{2}\b/);
      if (mYMD) dates = mYMD[0].replace(/\s+/g, ' ');
    }
    let pax = '';
    const mpax = whole.match(/\b(?:pax|passengers?)\s*[:=]?\s*(\d{1,2})\b/i) || whole.match(/\bx\s*(\d{1,2})\b/i);
    if (mpax) pax = mpax[1];
    let leadId = '';
    const idCandidates = Array.from(whole.matchAll(/(?:^|[\s\t:>])(\d{4,9})(?=$|[\s\t<])/g)).map(m => m[1]);
    for (const cand of idCandidates) {
      if (/^\d{8}$/.test(cand)) continue;
      if (/^\d{10,11}$/.test(cand)) continue;
      leadId = cand; break;
    }
    return { name, email: safeEmail(email), phone, route, dates, pax, leadId, notes: '' };
  }

  function parseMultipleLeads(text) {
    const norm = (text || '').replace(/\r/g, '\n').trim();
    if (!norm) return [];
    let parts = norm.split(/\n(?=new\b)/i);
    if (parts.length <= 1) parts = norm.split(/\n{2,}|\n(?=\S+@\S+)/g);
    const exploded = [];
    parts.forEach(p => exploded.push(...p.split(/\n(?=new\b)/i)));
    const trimmed = exploded.map(s => s.trim()).filter(Boolean);
    const seen = new Set();
    const items = [];
    for (const chunk of trimmed) {
      const p = parseLeadBlob(chunk);
      const key = (p.email || '').toLowerCase() || p.phone || p.leadId || p.name;
      const hasAny = (p.name || p.email || p.phone || p.leadId);
      if (!hasAny) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(p);
    }
    return items;
  }

  // ===== Contact links =====
  const CALL_LINK_MODE = 'tel';
  const EMAIL_MODE = 'gmail';
  function phoneHref(num) {
    const clean = (num || '').replace(/[^\d+]/g, '');
    return CALL_LINK_MODE === 'callto' ? `callto:${clean}` : `tel:${clean}`;
  }
  function emailHref(addr, subject = '', body = '') {
    const enc = s => encodeURIComponent(s || '');
    const safe = safeEmail(addr);
    if (!safe) return '#';
    return EMAIL_MODE === 'gmail'
      ? `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(safe)}&su=${enc(subject)}&body=${enc(body)}&tf=1`
      : `mailto:${safe}?subject=${enc(subject)}&body=${enc(body)}`;
  }
  function defaultSmsContent(c) {
    const first = ((c?.name || '').trim().split(/\s+/)[0] || '').trim();
    return `Hello${first ? ' ' + first : ''} — following up.`;
  }
  function ringCentralSmsHref(number, content) {
    const digits = (number || '').replace(/[^\d+]/g, '');
    const enc = encodeURIComponent(content || '');
    return `rcapp://r/sms?type=new&number=${digits}&content=${enc}`;
  }

  // ===== Scheduling =====
  const ACTIONS_UNREACHED = d => ({ calls: 2, voicemail: 1, sms: 1, emails: d === 1 ? 2 : 1 });
  const ACTIONS_REACHED = { calls: 2, voicemail: 1, sms: 1, emails: 1 };

  function addTask(t) {
    t.id = t.id || uid();
    t.status = t.status || 'open';
    const exists = state.tasks.some(x =>
      x.clientId === t.clientId && x.date === t.date && x.type ===
      t.type && (x.title || '') === (t.title || '') && (x.source || '') === (t.source || ''));
    if (!exists) state.tasks.push(t);
  }

  function genDayTasks(client, date, a, label) {
    const todayY = fmt(today());
    if (date < todayY) return;
    const base = { clientId: client.id, clientName: client.name, date, source: 'auto', label };
    if (a.calls >= 1) addTask({ ...base, type: 'call', title: 'Call' });
    if (a.voicemail >= 1) addTask({ ...base, type: 'callvm', title: 'Call + Voicemail' });
    else if (a.calls >= 2) addTask({ ...base, type: 'call', title: 'Call 2' });
    for (let i = 1; i <= a.sms; i++) addTask({ ...base, type: 'sms', title: 'SMS' });
    if (label && label.startsWith('Unreached Day 1')) {
      addTask({ ...base, type: 'email', title: 'Introduction & Info Emails' });
      addTask({ ...base, type: 'email', title: '3PQ + Feedback Request Email' });
    } else {
      for (let i = 1; i <= a.emails; i++) addTask({ ...base, type: 'email', title: 'Email' });
    }
  }

  function scheduleUnreached(client) {
    const start0 = client.startDate ? parseLocalYMD(client.startDate) : today();
    let day1 = nextWorkingDay(start0);
    for (let dayNum = 1; dayNum <= 5; dayNum++) {
      const date = fmt(adjustAutoDateIfNeeded(day1));
      genDayTasks(client, date, ACTIONS_UNREACHED(dayNum), `Unreached Day ${dayNum}`);
      if (dayNum < 5) day1 = stepByWorkingDays(day1, 1);
    }
  }

  function scheduleReached(client) {
    const start0 = client.reachedStart ? parseLocalYMD(client.reachedStart) : today();
    const p1d1 = adjustAutoDateIfNeeded(nextWorkingDay(start0));
    const p1d2 = adjustAutoDateIfNeeded(stepByWorkingDays(p1d1, 1));
    const p1d3 = adjustAutoDateIfNeeded(stepByWorkingDays(p1d2, 1));
    genDayTasks(client, fmt(p1d1), ACTIONS_REACHED, `Phase 1 (Day 1/3)`);
    genDayTasks(client, fmt(p1d2), ACTIONS_REACHED, `Phase 1 (Day 2/3)`);
    genDayTasks(client, fmt(p1d3), ACTIONS_REACHED, `Phase 1 (Day 3/3)`);
    const gaps = [3, 5, 7, 7, 7];
    let last = p1d3;
    for (let i = 0; i < gaps.length; i++) {
      let target = addDays(last, gaps[i]);
      target = adjustAutoDateIfNeeded(target);
      genDayTasks(client, fmt(target), ACTIONS_REACHED, `Phase ${i + 2}`);
      last = target;
    }
  }

  function clearFutureTasksForClientFrom(id, fromDate) {
    const f = fmt(fromDate);
    state.tasks = state.tasks.filter(t => !(t.clientId === id && t.source === 'auto' && t.status !== 'done' && t.date >= f));
  }
  function clearManualTasksForClient(id) {
    state.tasks = state.tasks.filter(t => !(t.clientId === id && t.source === 'manual' && t.status !== 'done'));
  }
  function markDone(id, done) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    t.status = done ? 'done' : 'open';
    save();
  }
  function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    save();
  }
  function regenerateAutoOpenTasksFromAnchors() {
    const from = fmt(today());
    state.tasks = state.tasks.filter(t => !(t.source === 'auto' && t.status !== 'done' && t.date >= from));
    for (const c of state.clients) {
      if (c.status === 'unreached') scheduleUnreached(c);
      else scheduleReached(c);
    }
    save();
  }

  // ===== Customers table =====
  function clientById(id) { return state.clients.find(c => c.id === id); }
  function nextActionDateForClient(id) {
    const open = state.tasks.filter(t => t.clientId === id && t.status === 'open').sort((a, b) => a.date.localeCompare(b.date));
    return open[0]?.date || '—';
  }

  function refresh() {
    $('#kTotal').textContent = state.clients.length;
    $('#kUn').textContent = state.clients.filter(c => c.status === 'unreached').length;
    $('#kRe').textContent = state.clients.filter(c => c.status === 'reached').length;
    $('#kTasks').textContent = state.tasks.filter(t => t.status === 'open').length;

    const body = $('#clientsTbl tbody'); body.innerHTML = '';
    const query = ($('#search').value || '').toLowerCase();
    const sflt = ($('#statusFilter').value || '').toLowerCase();

    [...state.clients]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(c => (!sflt || c.status === sflt))
      .filter(c => [c.name, c.email, c.phone, (c.notes || ''), (c.route || ''), (c.dates || ''), (c.pax || ''), (c.leadId || '')].join(' ').toLowerCase().includes(query))
      .forEach(c => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-rowid', c.id);

        const leadInContact = c.leadId ? `
          <div class="tiny mono" style="margin-top:4px">
            <a href="${LEAD_BASE + encodeURIComponent(String(c.leadId))}" target="_blank" rel="noopener noreferrer">Lead #${escapeHtml(String(c.leadId))}</a>
            <button class="copy-btn" data-copy="${escapeHtml(String(c.leadId))}" data-what="lead id" title="Copy lead ID" aria-label="Copy lead ID">⧉</button>
          </div>` : '';

        const contactHtml = `
           ${c.email ? `<a href="${emailHref(c.email, 'Follow-up', 'Hi …')}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.email)}</a> <button class="copy-btn" data-copy="${escapeHtml(c.email)}" data-what="email" title="Copy email" aria-label="Copy email">⧉</button>` : '-'}
           <br>
          ${c.phone ? `<a href="${phoneHref(c.phone)}">${escapeHtml(c.phone)}</a> <button class="copy-btn" data-copy="${escapeHtml(c.phone)}" data-what="phone" title="Copy phone" aria-label="Copy phone">⧉</button>` : '-'}
          ${leadInContact}`;

        tr.innerHTML = `
          <td data-label="Name">
            <strong>${escapeHtml(c.name)}</strong>
            <div class="tiny mono note-preview" data-act="note" data-id="${c.id}" title="Click to expand notes" aria-label="Show notes">
              ${[c.route ? `Route:${escapeHtml(' ' + c.route)}` : '', c.dates ? ` • Dates:${escapeHtml(' ' + c.dates)}` : '', c.pax ? ` • Pax:${escapeHtml(' ' + String(c.pax))}` : ''].filter(Boolean).join('')}
            </div>
          </td>
          <td data-label="Contact" class="tiny">${contactHtml}</td>
          <td data-label="Status" style="text-align:center"><span class="badge">${c.status}</span></td>
          <td data-label="Next Action" style="text-align:center">${nextActionDateForClient(c.id)}</td>
          <td data-label="Actions" class="actions">
            <button type="button" class="btn-icon" data-act="note"  data-id="${c.id}" title="Show notes" aria-label="Show notes">🗒️</button>
            <button type="button" class="btn-icon" data-act="manual" data-id="${c.id}" title="Set next FU (manual)" aria-label="Manual next FU">📅</button>
            <button type="button" class="btn-icon" data-act="edit"  data-id="${c.id}" title="Edit" aria-label="Edit">🖊️</button>
            <button type="button" class="btn-icon" data-act="reach" data-id="${c.id}" title="${c.status === 'unreached' ? 'Mark Reached' : 'Mark Unreached'}" aria-label="${c.status === 'unreached' ? 'Mark Reached' : 'Mark Unreached'}">${c.status === 'unreached' ? '✅' : '↩️'}</button>
            <button type="button" class="btn-icon" data-act="del"   data-id="${c.id}" title="Delete" aria-label="Delete">🗑️</button>
          </td>`;
        body.appendChild(tr);
      });

    renderAgenda();
    updateProgress();
    try { buildClientOptionsForTaskModal(); } catch (_) { }
  }

  function toggleNotesRow(id) {
    const existing = document.querySelector(`.note-row[data-for="${id}"]`);
    if (existing) { existing.remove(); return; }
    const tr = document.querySelector(`tr[data-rowid="${id}"]`);
    if (!tr) return;
    const c = clientById(id) || {};
    const row = document.createElement('tr'); row.className = 'note-row'; row.setAttribute('data-for', id);
    const td = document.createElement('td'); td.colSpan = 5;
    const chips = [
      c.route ? `<span class="pill">Route: ${escapeHtml(c.route)}</span>` : '',
      c.dates ? `<span class="pill">Dates: ${escapeHtml(c.dates)}</span>` : '',
      c.pax ? `<span class="pill">Pax: ${escapeHtml(String(c.pax))}</span>` : '',
      c.leadId ? `<span class="pill">Lead: <a href="${LEAD_BASE + encodeURIComponent(String(c.leadId))}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(c.leadId))}</a></span>` : ''
    ].filter(Boolean).join(' ');
    td.innerHTML = `<div class="tiny slab">${chips || ''}<div>${escapeHtml(c.notes || 'No notes yet.')}</div></div>`;
    row.appendChild(td); tr.after(row);
  }

  // ===== Customers table click handler =====
  $('#clientsTbl').addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;

    const id = el.getAttribute('data-id');
    const act = el.getAttribute('data-act');
    const c = clientById(id);

    if (act === 'note') { toggleNotesRow(id); return; }

    if (act === 'manual') {
      const open = document.querySelector(`.manual-row[data-for="${id}"]`);
      if (open) { $$('.manual-row').forEach(n => n.remove()); return; }
      openManualRow(id); return;
    }

    if (act === 'manual-apply') {
      const date = document.getElementById(`manualDate_${id}`)?.value || '';
      const shouldClear = document.getElementById(`manualClear_${id}`)?.checked ?? true;
      const notes = document.getElementById(`manualNotes_${id}`)?.value || '';
      const rmPrev = document.getElementById(`manualClearPrev_${id}`)?.checked ?? false;
      scheduleManualFU(c, date, shouldClear, notes, rmPrev);
      $$('.manual-row').forEach(n => n.remove()); return;
    }

    if (act === 'manual-cancel') { $$('.manual-row').forEach(n => n.remove()); return; }

    if (act === 'edit') {
      if (!c) return;
      $('#clientId').value = c.id;
      $('#name').value = c.name || '';
      $('#email').value = c.email || '';
      $('#phone').value = c.phone || '';
      $('#status').value = c.status;
      $('#startDate').value = c.startDate || '';
      $('#route').value = c.route || '';
      $('#dates').value = c.dates || '';
      $('#pax').value = c.pax || '';
      $('#leadId').value = c.leadId || '';
      $('#notes').value = c.notes || '';

      // Ensure modal exists and open
      if (!document.getElementById('addModal')) makeModalFromCard('addCard', 'addModal');
      openModal('addModal', 'addCard');

      setTimeout(() => { try { $('#leadBlob').focus(); } catch (_) { } }, 30);
      return;
    }

    if (act === 'reach') {
      c.status = c.status === 'unreached' ? 'reached' : 'unreached';
      if (c.status === 'reached') {
        c.reachedStart = fmt(today());
        clearFutureTasksForClientFrom(c.id, today()); scheduleReached(c);
      } else {
        c.startDate = fmt(today());
        clearFutureTasksForClientFrom(c.id, today()); scheduleUnreached(c);
      }
      save(); return;
    }

    if (act === 'del') {
      if (confirm('Delete this customer and all their tasks?')) {
        state.clients = state.clients.filter(x => x.id !== id);
        state.tasks = state.tasks.filter(t => t.clientId !== id);
        save();
      }
      return;
    }
  });

  // Global copy buttons
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (!copyBtn) return;
    const text = copyBtn.getAttribute('data-copy') || '';
    const what = copyBtn.getAttribute('data-what') || 'text';
    const fallbackCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove();
        toast(`Copied ${what}`);
      } catch (_) { alert('Copy failed'); }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => toast(`Copied ${what}`)).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  });

  // ===== Manual FU =====
  function openManualRow(id) {
    $$('.manual-row').forEach(n => n.remove());
    const tr = document.querySelector(`tr[data-rowid="${id}"]`);
    if (!tr) return;
    const row = document.createElement('tr');
    row.className = 'manual-row'; row.setAttribute('data-for', id);
    const td = document.createElement('td'); td.colSpan = 5;
    td.innerHTML = `
      <div class="tiny slab flex-row">
        <span>Manual next follow-up for <b>${escapeHtml(clientById(id)?.name || 'Client')}</b>:</span>
        <input type="date" id="manualDate_${id}" value="${fmt(today())}" min="${fmt(today())}" autocomplete="off" />
        <label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="manualClear_${id}" checked /> Clear ALL future auto tasks</label>
        <label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="manualClearPrev_${id}" checked /> Remove previous manual tasks</label>
        <input type="text" id="manualNotes_${id}" placeholder="Optional notes" style="min-width:220px" />
        <span>Creates: 2 Calls, 1 SMS, 1 Email.</span>
        <span class="space"></span>
        <button class="primary" data-act="manual-apply" data-id="${id}">Schedule</button>
        <button data-act="manual-cancel" data-id="${id}">Cancel</button>
      </div>`;
    row.appendChild(td); tr.after(row);
  }
  function scheduleManualFU(client, ymd, shouldClear = true, notes = '', removePrevManual = false) {
    const date = fmt(parseLocalYMD(ymd || fmt(today())));
    if (shouldClear) clearFutureTasksForClientFrom(client.id, today());
    if (removePrevManual) clearManualTasksForClient(client.id);
    const base = { clientId: client.id, clientName: client.name, date, source: 'manual', label: 'Manual FU', notes };
    addTask({ ...base, type: 'call', title: 'Call' });
    addTask({ ...base, type: 'call', title: 'Call 2' });
    addTask({ ...base, type: 'sms', title: 'SMS' });
    addTask({ ...base, type: 'email', title: 'Email' });
    save();
  }

  // ===== Agenda =====
  let currentAgendaDate = today();
  let agendaFilter = '';
  let sortMode = localStorage.getItem(SORT_KEY) || 'client';
  let showMode = 'all';

  function setAgendaFilter(val) {
    agendaFilter = (val || '').trim().toLowerCase();
    renderAgenda();
    buildCalendar();
  }

  function typeOrder(t) { return ({ call: 1, callvm: 2, voicemail: 3, sms: 4, email: 5, custom: 6 }[t] || 9); }
  function clientDisplayName(t) { return t.clientName || (t.clientId ? (clientById(t.clientId) || {}).name : '') || ''; }
  function clientNameLower(t) { return clientDisplayName(t).toLowerCase(); }
  function sortTasksForMode(a, b) {
    const byType = typeOrder(a.type) - typeOrder(b.type);
    const byName = clientNameLower(a).localeCompare(clientNameLower(b));
    const byTitle = (a.title || '').localeCompare(b.title || '');
    return sortMode === 'client' ? (byName || byType || byTitle) : (byType || byName || byTitle);
  }
  function matchesFilter(t) { return !agendaFilter || clientNameLower(t).includes(agendaFilter); }
  function matchesShowMode(t) {
    if (showMode === 'open') return t.status !== 'done';
    if (showMode === 'done') return t.status === 'done';
    return true;
  }

  function detailsChipsFor(t) {
    const c = t.clientId ? clientById(t.clientId) : null;
    if (!c) return '';
    const chips = [
      c.route ? `<span class="pill">Route:&nbsp;${escapeHtml(c.route)}</span>` : '',
      c.dates ? `<span class="pill">Dates:&nbsp;${escapeHtml(c.dates)}</span>` : '',
      c.pax ? `<span class="pill">Pax:&nbsp;${escapeHtml(String(c.pax))}</span>` : '',
      c.leadId ? `<span class="pill">Lead:&nbsp;<a href="${LEAD_BASE + encodeURIComponent(String(c.leadId))}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(c.leadId))}</a></span>` : ''
    ].filter(Boolean);
    return chips.join(' ');
  }

  function renderTask(t) {
    const div = document.createElement('div');
    div.className = 'agenda-item' + (t.status === 'done' ? ' done' : '');
    const icon = { call: '📞', callvm: '📞🗣️', voicemail: '🗣️', sms: '💬', email: '✉️', custom: '📝' }[t.type] || '•';
    const client = clientDisplayName(t);
    let contactHtml = '';
    if (t.clientId) {
      const c = clientById(t.clientId) || {};
      if ((t.type === 'call' || t.type === 'callvm') && c.phone) {
        const href = phoneHref(c.phone);
        contactHtml = `<span class="pill"><a class="mono" href="${href}">${escapeHtml(c.phone)}</a><button class="copy-btn" data-copy="${escapeHtml(c.phone)}" data-what="phone" title="Copy phone" aria-label="Copy phone">⧉</button></span>`;
      } else if (t.type === 'sms' && c.phone) {
        const href = ringCentralSmsHref(c.phone, defaultSmsContent(c));
        contactHtml = `<span class="pill"><a class="mono" href="${href}">${escapeHtml(c.phone)}</a><button class="copy-btn" data-copy="${escapeHtml(c.phone)}" data-what="phone" title="Copy phone" aria-label="Copy phone">⧉</button></span>`;
      } else if (t.type === 'email' && c.email) {
        const href = emailHref(c.email, 'Follow-up', 'Hi …');
        contactHtml = `<span class="pill"><a class="mono" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.email)}</a><button class="copy-btn" data-copy="${escapeHtml(c.email)}" data-what="email" title="Copy email" aria-label="Copy email">⧉</button></span>`;
      }
    }
    const src = t.source === 'custom' ? ' (custom)' : (t.source === 'manual' ? ' (manual)' : '');
    const notesHtml = t.notes ? `<div class="tiny">📝 ${escapeHtml(t.notes)}</div>` : '';
    const chips = detailsChipsFor(t);

    const bellTitle = t.important ? 'Edit reminder' : 'Add reminder';
    const timeChip = t.notifyTime ? `<span class="bell-time mono" title="Reminder time">${escapeHtml(t.notifyTime)}</span>` : '';

    div.innerHTML = `
      <input type="checkbox" ${t.status === 'done' ? 'checked' : ''} data-taskid="${t.id}"/>
      <div>
        <div><strong>${icon} ${escapeHtml(t.title)}</strong>
          ${client ? `<span class="pill">${escapeHtml(client)}</span>` : ''}
          ${contactHtml}
          ${chips}
        </div>
        <div class="tiny">${escapeHtml(t.label || '')}${src}</div>
        ${notesHtml}
      </div>
      <div class="tiny mono" style="display:flex; align-items:center; gap:6px">
        <span>${t.date}</span>
        ${timeChip}
        <button class="btn-icon" data-bell="${t.id}" title="${bellTitle}" aria-label="${bellTitle}">🔔</button>
        <button class="btn-icon" data-del="${t.id}" title="Delete task" aria-label="Delete task">🗑️</button>
      </div>`;
    div.querySelector('input').addEventListener('change', ev => { markDone(t.id, ev.target.checked); });
    return div;
  }

  function renderGroupedByClient(container, items) {
    let current = '\u0000';
    for (const t of items) {
      const name = clientDisplayName(t) || 'Unknown';
      if (name !== current) {
        current = name;
        const gh = document.createElement('div');
        gh.className = 'group-hd';
        gh.innerHTML = `<span class="label">${escapeHtml(name)}</span>`;
        container.appendChild(gh);
      }
      container.appendChild(renderTask(t));
    }
  }

  let renderAgenda = () => buildAgenda(currentAgendaDate);
  function buildAgenda(date) {
    const f = fmt(date);
    const cont = $('#agenda');
    const items = state.tasks
      .filter(t => t.date === f && matchesFilter(t) && matchesShowMode(t))
      .sort(sortTasksForMode);
    cont.innerHTML = '';
    if (items.length === 0) { cont.innerHTML = `<div class="tiny">No tasks for ${f}.</div>`; updateProgress(); return; }
    if (sortMode === 'client') renderGroupedByClient(cont, items);
    else items.forEach(t => cont.appendChild(renderTask(t)));
    updateProgress();
  }

  function buildAgendaRange(from, to) {
    const cont = $('#agenda'); cont.innerHTML = '';
    const days = Math.ceil((to - from) / 86400000) + 1;
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i), f = fmt(d);
      const items = state.tasks
        .filter(t => t.date === f && matchesFilter(t) && matchesShowMode(t))
        .sort(sortTasksForMode);
      const head = document.createElement('div'); head.className = 'tiny'; head.innerHTML = `<div class="badge mono">${f}</div>`;
      cont.appendChild(head);
      if (items.length === 0) { const none = document.createElement('div'); none.className = 'tiny'; none.textContent = 'No tasks'; cont.appendChild(none); }
      else if (sortMode === 'client') renderGroupedByClient(cont, items);
      else items.forEach(t => cont.appendChild(renderTask(t)));
    }
    updateProgress();
  }

  function updateProgress() {
    const f = fmt(today());
    const todays = state.tasks.filter(t => t.date === f);
    const done = todays.filter(t => t.status === 'done').length;
    const total = todays.length || 1;
    const pct = Math.round((done / total) * 100);
    $('#progressPct').textContent = pct + '%';
    $('#progressBar').style.width = pct + '%';
    $('#progressBar').style.opacity = todays.length > 0 ? '1' : '.4';
  }

  // ===== Reminder popover / notifications =====
  function combineYmdTimeLocal(ymd, hhmm) {
    const [y, m, d] = (ymd || '').split('-').map(Number);
    let H = 9, M = 0;
    if (hhmm && /^\d{2}:\d{2}$/.test(hhmm)) { [H, M] = hhmm.split(':').map(Number); }
    return new Date(y, (m || 1) - 1, d || 1, H, M, 0, 0);
  }
  let _reminderAnchor = null;
  function ensureReminderPopover() {
    let el = document.getElementById('reminderPopover');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'reminderPopover';
    el.className = 'reminder-popover';
    el.innerHTML = `
      <div class="tiny" style="margin-bottom:6px">Notify me at:</div>
      <input id="rpTime" type="time" />
      <div class="btns">
        <button id="rpRemove" class="ghost">Remove</button>
        <button id="rpSave" class="primary">Save</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#rpSave').addEventListener('click', () => {
      const id = el.getAttribute('data-task-id');
      const t = state.tasks.find(x => x.id === id);
      if (!t) return closeReminderPopover();
      const hhmm = (document.getElementById('rpTime').value || '').trim();
      if (!/^\d{2}:\d{2}$/.test(hhmm)) { alert('Pick a time'); return; }
      t.important = true;
      t.notifyTime = hhmm;
      t.notifyAt = combineYmdTimeLocal(t.date, hhmm).toISOString();
      save();
      closeReminderPopover();
    });
    el.querySelector('#rpRemove').addEventListener('click', () => {
      const id = el.getAttribute('data-task-id');
      const t = state.tasks.find(x => x.id === id);
      if (!t) return closeReminderPopover();
      t.important = false;
      delete t.notifyTime;
      delete t.notifyAt;
      save();
      closeReminderPopover();
    });
    return el;
  }
  function closeReminderPopover() {
    const el = document.getElementById('reminderPopover');
    if (!el) return;
    el.classList.remove('open');
    el.removeAttribute('data-task-id');
    _reminderAnchor = null;
  }
  function openReminderPopover(anchor, taskId) {
    const el = ensureReminderPopover();
    _reminderAnchor = anchor;
    const t = state.tasks.find(x => x.id === taskId);
    el.setAttribute('data-task-id', taskId);
    const inp = document.getElementById('rpTime');
    inp.value = (t?.notifyTime || '');
    const r = anchor.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    let left = r.left;
    if (left + 240 > vw - 8) left = Math.max(8, vw - 248);
    const top = r.bottom + 6;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.classList.add('open');
    setTimeout(() => inp.focus(), 10);
  }
  document.addEventListener('click', (e) => {
    const el = document.getElementById('reminderPopover');
    if (!el || !el.classList.contains('open')) return;
    const inside = e.target.closest('#reminderPopover') || e.target.closest('[data-bell]');
    if (!inside) closeReminderPopover();
  });

  function notifSupported() { return typeof window.Notification === 'function'; }
  function isSecure() { return window.isSecureContext || location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname); }
  function setNotifStatus(txt) { const el = $('#notifStatus'); if (el) el.textContent = txt; }
  function fmtToday() { return fmt(today()); }
  function notifyTask(t) {
    if (!notifSupported() || Notification.permission !== 'granted') return;
    try {
      const tag = t.id || ('rand-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      const n = new Notification(`${t.title}${t.clientName ? ' — ' + t.clientName : ''}`, {
        body: `${t.label || ''} • ${t.date}${t.notifyTime ? (' @ ' + t.notifyTime) : ''}`,
        tag, renotify: true, silent: false, requireInteraction: !!t.requireInteraction
      });
      n.onclick = () => { try { window.focus(); } catch (_) { } };
    } catch (e) { }
  }
  function getNotifiedSet() {
    const f = fmtToday();
    try {
      const o = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}');
      return o[f] ? new Set(o[f]) : new Set();
    } catch (e) { return new Set(); }
  }
  function saveNotifiedSet(set) {
    const f = fmtToday();
    let o = {};
    try { o = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}'); } catch (e) { }
    o = { [f]: Array.from(set) };
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(o));
  }
  function notifyEligibleTodayImportant(now = new Date()) {
    const f = fmtToday();
    const list = state.tasks.filter(t => t.important === true && t.status !== 'done' && t.date === f);
    return list.filter(t => {
      const at = t.notifyAt ? new Date(t.notifyAt) : combineYmdTimeLocal(t.date, t.notifyTime || '09:00');
      return now >= at;
    });
  }
  function initNotificationsUI() {
    const btn = $('#enableNotifs'), test = $('#testNotif'); if (!btn || !test) return;
    function refreshUI() {
      if (!notifSupported()) { btn.disabled = true; test.disabled = true; setNotifStatus('Not supported'); return; }
      if (!isSecure()) { btn.disabled = true; test.disabled = false; setNotifStatus('HTTPS/localhost required'); return; }
      btn.disabled = false; test.disabled = false;
      const perm = Notification.permission;
      if (perm === 'granted') { btn.textContent = '🔔 Enabled'; setNotifStatus('Enabled'); }
      else if (perm === 'denied') { btn.textContent = '🔔 Enable'; setNotifStatus('Blocked'); }
      else { btn.textContent = '🔔 Enable'; setNotifStatus('Not enabled'); }
    }
    refreshUI();
    if (navigator.permissions?.query) {
      try { navigator.permissions.query({ name: 'notifications' }).then(p => { p.onchange = refreshUI; }).catch(() => { }); } catch (_) { }
    }
    btn.addEventListener('click', async () => {
      if (!isSecure()) { alert('Use HTTPS or http://localhost for notifications.'); return; }
      try {
        const res = await Notification.requestPermission();
        setTimeout(refreshUI, 50);
        if (res === 'granted') {
          notifyTask({ id: 'enabled-' + Date.now(), title: '✅ Notifications enabled', clientName: '', date: fmtToday(), requireInteraction: true });
        } else if (res === 'denied') {
          alert('Notifications are blocked. Allow them in your browser’s site settings.');
        }
      } catch (_) { }
    });
    test.addEventListener('click', async () => {
      if (!isSecure()) { alert('Run from HTTPS or http://localhost.'); return; }
      if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (_) { } }
      if (Notification.permission === 'granted') {
        notifyTask({ id: 'test-' + Date.now(), title: '🔔 Test notification', clientName: '', date: fmtToday(), requireInteraction: true });
      } else if (Notification.permission === 'denied') {
        alert('Notifications are blocked. Click the lock icon → Site settings → Allow.');
      }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUI(); });
  }
  function startNotificationTicker() {
    let notified = getNotifiedSet();
    function tick() {
      if (!notifSupported() || Notification.permission !== 'granted') return;
      const due = notifyEligibleTodayImportant();
      let changed = false;
      for (const t of due) {
        if (!notified.has(t.id)) {
          notifyTask(t);
          notified.add(t.id);
          t.important = false;
          delete t.notifyTime;
          delete t.notifyAt;
          changed = true;
        }
      }
      if (changed) {
        saveState();
        saveNotifiedSet(notified);
        renderAgenda();
      }
    }
    tick(); setInterval(tick, 60 * 1000); window.addEventListener('focus', tick);
  }

  // ===== Calendar =====
  let calCursor = new Date(); calCursor.setDate(1);
  function buildCalendar() {
    const grid = $('#calendarGrid'); if (!grid) return;
    const year = calCursor.getFullYear(), month = calCursor.getMonth();
    const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    $('#calTitle').textContent = `${MONTH_ABBR[month]} ${year}`;
    grid.innerHTML = '';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(h => { const hd = document.createElement('div'); hd.className = 'cal-head'; hd.textContent = h; grid.appendChild(hd); });
    const first = new Date(year, month, 1);
    const startIdx = (first.getDay() + 6) % 7; const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < startIdx; i++) { grid.appendChild(document.createElement('div')); }
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month, d);
      const ymd = fmt(dt);
      const items = state.tasks.filter(t => t.date === ymd && t.status !== 'done' && (!agendaFilter || (t.clientName || '').toLowerCase().includes(agendaFilter)));
      const cell = document.createElement('div');
      cell.className = 'cal-cell'; if (!isWorkingDay(dt)) cell.classList.add('offday');
      cell.innerHTML = `<div class="d">${d}</div>` + (items.length ? `<div class="cal-badge">${items.length}</div>` : '');
      cell.addEventListener('click', () => {
        $('#agendaDate').value = ymd;
        $('#agendaDate').dispatchEvent(new Event('change'));
        const target = document.getElementById('actionsCard');
        if (target?.scrollIntoView) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else { window.scrollTo({ top: $('#actionsCard').offsetTop - 70, behavior: 'smooth' }); }
      });
      grid.appendChild(cell);
    }
  }
  $('#calPrev')?.addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() - 1); buildCalendar(); });
  $('#calNext')?.addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() + 1); buildCalendar(); });

  function renderOverrideList() {
    const ul = $('#overrideList'); ul.innerHTML = '';
    const entries = Object.entries(state.settings.overrides).sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) { const li = document.createElement('li'); li.textContent = 'No overrides yet.'; ul.appendChild(li); return; }
    entries.forEach(([date, type]) => {
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = `${date} — ${type === 'work' ? 'Working' : 'Off'}`;
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.addEventListener('click', () => {
        delete state.settings.overrides[date];
        regenerateAutoOpenTasksFromAnchors();
        renderOverrideList();
      });
      li.appendChild(left); li.appendChild(del); ul.appendChild(li);
    });
  }
  function loadSettingsIntoUI() {
    const s = state.settings;
    $('#wd_mon').checked = !!s.workingDays.mon;
    $('#wd_tue').checked = !!s.workingDays.tue;
    $('#wd_wed').checked = !!s.workingDays.wed;
    $('#wd_thu').checked = !!s.workingDays.thu;
    $('#wd_fri').checked = !!s.workingDays.fri;
    $('#wd_sat').checked = !!s.workingDays.sat;
    $('#wd_sun').checked = !!s.workingDays.sun;
    $('#moveOffDays').checked = !!s.moveOffDays;
    renderOverrideList();
  }
  function saveSettingsFromUI() {
    const s = state.settings;
    s.workingDays = {
      mon: !!$('#wd_mon').checked, tue: !!$('#wd_tue').checked, wed: !!$('#wd_wed').checked,
      thu: !!$('#wd_thu').checked, fri: !!$('#wd_fri').checked, sat: !!$('#wd_sat').checked, sun: !!$('#wd_sun').checked
    };
    s.moveOffDays = !!$('#moveOffDays').checked;
    regenerateAutoOpenTasksFromAnchors();
    $('#calSettings').style.display = 'none';
  }
  $('#calSettingsBtn')?.addEventListener('click', () => {
    const el = $('#calSettings'); const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    if (!open) loadSettingsIntoUI();
  });
  $('#saveCalSettings')?.addEventListener('click', saveSettingsFromUI);
  $('#addOverride')?.addEventListener('click', () => {
    const d = $('#ovrDate').value; const t = $('#ovrType').value;
    if (!d) return alert('Pick a date');
    state.settings.overrides[d] = (t === 'work' ? 'work' : 'off');
    regenerateAutoOpenTasksFromAnchors(); renderOverrideList();
  });

  // ===== Parse + Form wiring =====
  const leadBlobEl = document.getElementById('leadBlob');
  if (leadBlobEl) {
    leadBlobEl.addEventListener('paste', () => {
      requestAnimationFrame(() => {
        const has = (leadBlobEl.value || '').trim();
        if (!has) return;
        const many = parseMultipleLeads(has);
        if (many.length > 1) {
          showBulkImport(many);
          toast(`Parsed ${many.length} leads. Review & add.`);
        } else {
          parseBlob({ onlyFillEmpty: false });
          toast('Parsed from paste. Review & save.');
        }
      });
    });
    leadBlobEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const has = (leadBlobEl.value || '').trim();
        if (!has) return;
        e.preventDefault();
        const many = parseMultipleLeads(has);
        if (many.length > 1) {
          showBulkImport(many);
          return;
        }
        parseBlob({ onlyFillEmpty: true });
        document.getElementById('saveCustomer').click();
      }
    });
  }

  function applyParsedToForm(parsed, { onlyFillEmpty = false } = {}) {
    if (!parsed) return;
    const set = (id, val) => {
      if (!val) return;
      const el = document.querySelector(id);
      if (!el) return;
      if (onlyFillEmpty && (el.value || '').trim()) return;
      el.value = val;
    };
    set('#name', parsed.name);
    set('#email', parsed.email);
    set('#phone', parsed.phone);
    set('#route', parsed.route);
    set('#dates', parsed.dates);
    set('#pax', parsed.pax);
    set('#leadId', parsed.leadId);
    if (parsed.notes) {
      const cur = ($('#notes').value || '').trim();
      $('#notes').value = cur ? (cur + '\n' + parsed.notes) : parsed.notes;
    }
  }
  function parseBlob({ onlyFillEmpty } = { onlyFillEmpty: false }) {
    const blob = ($('#leadBlob').value || '').trim();
    if (!blob) return null;
    const parsed = parseLeadBlob(blob);
    applyParsedToForm(parsed, { onlyFillEmpty });
    return parsed;
  }
  function collectClientFromForm() {
    const id = $('#clientId').value || uid();
    const exists = state.clients.find(c => c.id === id);
    const status = $('#status').value;
    const startDate = $('#startDate').value || fmt(today());
    const client = {
      id,
      name: ($('#name').value || '').trim(),
      email: ($('#email').value || '').trim(),
      phone: ($('#phone').value || '').trim(),
      status,
      startDate,
      reachedStart: exists ? exists.reachedStart : (status === 'reached' ? startDate : null),
      route: ($('#route').value || '').trim(),
      dates: ($('#dates').value || '').trim(),
      pax: ($('#pax').value || '').trim(),
      leadId: ($('#leadId').value || '').trim(),
      notes: ($('#notes').value || '').trim()
    };
    return { client, exists };
  }
  $('#resetForm')?.addEventListener('click', () => {
    $('#clientForm')?.reset();
    $('#clientId').value = '';
  });

  $('#saveCustomer')?.addEventListener('click', () => {
    try {
      if (($('#leadBlob').value || '').trim()) {
        parseBlob({ onlyFillEmpty: true });
      }
      const { client, exists } = collectClientFromForm();
      if (!client.name) {
        alert('Name is required');
        $('#name').focus();
        return;
      }
      if (!exists) {
        state.clients.push(client);
        if (client.status === 'unreached') scheduleUnreached(client);
        else {
          client.reachedStart = client.startDate;
          scheduleReached(client);
        }
        toast('Customer added');
      } else {
        const i = state.clients.findIndex(x => x.id === client.id);
        const prev = state.clients[i];
        state.clients[i] = client;
        const statusChanged = prev.status !== client.status;
        const anchorChanged = prev.startDate !== client.startDate || prev.reachedStart !== client.reachedStart;
        if (statusChanged) {
          clearFutureTasksForClientFrom(client.id, today());
          if (client.status === 'reached') {
            client.reachedStart = fmt(today());
            scheduleReached(client);
          } else {
            client.startDate = fmt(today());
            scheduleUnreached(client);
          }
        } else if (anchorChanged) {
          clearFutureTasksForClientFrom(client.id, today());
          if (client.status === 'unreached') scheduleUnreached(client);
          else scheduleReached(client);
        }
        toast('Customer updated');
      }
      $('#leadBlob').value = '';
      $('#clientForm')?.reset();
      $('#clientId').value = '';
      save();
      closeModal('addModal', 'addCard');
    } catch (e) {
      console.error(e);
      alert('Could not save customer. If this persists, click “Wipe All” to clear local data and try again.');
      toast('Save failed', 'err', 2200);
    }
  });

  // ===== Bulk import UI =====
  function showBulkImport(items) {
    bulk.items = items.slice();
    bulk.selected = new Set(items.map((_, i) => String(i)));
    $('#bulkList').innerHTML = items.map((p, i) => `
      <div class="bulk-item">
        <input type="checkbox" class="bulk-check" data-idx="${i}" checked>
        <div class="mono"><strong>${escapeHtml(p.name || '-')}</strong></div>
        <div class="mono">${escapeHtml(p.email || '-')}</div>
        <div class="mono">${escapeHtml(p.phone || '-')}</div>
        <div class="mono">${escapeHtml(p.route || '-')}</div>
        <div class="mono">${escapeHtml(String(p.pax || '-'))}</div>
        <div class="mono">${escapeHtml(String(p.leadId || '-'))}</div>
      </div>
    `).join('');
    updateBulkPill();
    $('#bulkImport').style.display = 'block';
    $('#clientForm').style.display = 'none';
    $$('.bulk-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = cb.getAttribute('data-idx');
        if (cb.checked) bulk.selected.add(idx);
        else bulk.selected.delete(idx);
        updateBulkPill();
      });
    });
  }
  function hideBulkImport() {
    $('#bulkImport').style.display = 'none';
    $('#clientForm').style.display = '';
    bulk.items = [];
    bulk.selected.clear();
    $('#bulkList').innerHTML = '';
    $('#bulkCountPill').textContent = '0 selected';
  }
  function updateBulkPill() {
    const n = bulk.selected.size;
    $('#bulkCountPill').textContent = `${n} selected`;
  }
  $('#bulkCancel')?.addEventListener('click', () => { hideBulkImport(); });
  $('#bulkAdd')?.addEventListener('click', () => {
    const status = $('#bulkStatus').value || 'unreached';
    const toAdd = Array.from(bulk.selected).map(idx => bulk.items[Number(idx)]);
    if (!toAdd.length) { alert('Select at least one lead.'); return; }
    toAdd.forEach(p => {
      const c = {
        id: uid(),
        name: (p.name || '').trim() || 'Lead',
        email: (p.email || '').trim(),
        phone: (p.phone || '').trim(),
        status,
        startDate: fmt(today()),
        reachedStart: status === 'reached' ? fmt(today()) : null,
        route: (p.route || '').trim(),
        dates: (p.dates || '').trim(),
        pax: (p.pax || '').trim(),
        leadId: (p.leadId || '').trim(),
        notes: (p.notes || '').trim()
      };
      state.clients.push(c);
      if (status === 'unreached') scheduleUnreached(c);
      else scheduleReached(c);
    });
    save();
    toast(`Added ${toAdd.length} customer${toAdd.length > 1 ? 's' : ''}`);
    $('#leadBlob').value = '';
    hideBulkImport();
    closeModal('addModal', 'addCard');
  });

  // ===== Add Task modal =====
  function titleDefaultFor(type) { return ({ call: 'Call', callvm: 'Call + Voicemail', sms: 'SMS', email: 'Email' }[type] || ''); }
  function buildClientOptionsForTaskModal() {
    const sel = $('#ctClient');
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '';
    sel.insertAdjacentHTML('beforeend', `<option value="">— None — (default)</option>`);
    const opts = [...state.clients].sort((a, b) => a.name.localeCompare(b.name));
    opts.forEach(c => {
      const label = c.email ? `${c.name} — ${c.email}` : (c.phone ? `${c.name} — ${c.phone}` : c.name);
      sel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${escapeHtml(label)}</option>`);
    });
    sel.value = keep || '';
  }

  function openTaskModal() {
    // Ensure modal exists before opening
    if (!document.getElementById('taskModal')) makeModalFromCard('taskCard', 'taskModal');
    buildClientOptionsForTaskModal();
    const agendaYmd = fmt(currentAgendaDate || today());
    if (!$('#ctDate').value) $('#ctDate').value = agendaYmd;
    if (!$('#ctTitle').value) $('#ctTitle').value = titleDefaultFor($('#ctType').value || 'call');
    $('#ctNotify').disabled = !$('#ctTime').value;
    openModal('taskModal', 'taskCard');
    setTimeout(() => { try { $('#ctTitle').focus(); } catch (_) { } }, 30);
  }

  function clearTaskForm() {
    ['ctClient', 'ctType', 'ctTitle', 'ctDate', 'ctTime', 'ctNotes'].forEach(id => {
      const el = $('#' + id);
      if (!el) return;
      if (id === 'ctType') el.value = 'call';
      else el.value = '';
    });
    $('#ctImportant').checked = false;
    $('#ctNotify').checked = false;
    $('#ctNotify').disabled = true;
  }

  function closeTaskModal() {
    clearTaskForm();
    closeModal('taskModal', 'taskCard');
  }

  function saveTaskFromModal() {
    const clientId = $('#ctClient').value || null;
    const c = clientId ? clientById(clientId) : null;
    const type = $('#ctType').value || 'custom';
    let title = ($('#ctTitle').value || '').trim();
    if (!title) title = titleDefaultFor(type) || 'Custom';
    const date = $('#ctDate').value || fmt(currentAgendaDate || today());
    const time = $('#ctTime').value || '';
    const notes = ($('#ctNotes').value || '').trim();
    const notify = !!$('#ctNotify').checked && !!time;
    const important = notify ? true : !!$('#ctImportant').checked;

    const t = { clientId: c?.id || null, clientName: c?.name || '', date, type, title, label: 'Custom', source: 'custom', status: 'open', notes, important };
    if (time) {
      t.notifyTime = time;
      if (notify) t.notifyAt = combineYmdTimeLocal(date, time).toISOString();
    }
    addTask(t);
    save();
    toast('Task added');
    closeTaskModal();
  }

  // Open Task button
  $('#openTask')?.addEventListener('click', openTaskModal);
  $('#ctSave')?.addEventListener('click', saveTaskFromModal);
  $('#ctClear')?.addEventListener('click', clearTaskForm);
  $('#ctClose')?.addEventListener('click', closeTaskModal);
  document.addEventListener('keydown', (e) => {
    const taskOpen = $('#taskModal')?.classList.contains('open');
    if (taskOpen && e.key === 'Escape') { e.preventDefault(); closeTaskModal(); }
    const addOpen = $('#addModal')?.classList.contains('open');
    if (addOpen && e.key === 'Escape') { e.preventDefault(); closeModal('addModal', 'addCard'); }
    if (addOpen && e.key === 'Enter') {
      const ae = document.activeElement;
      if (ae && ae.id === 'notes' && e.shiftKey) return;
      if ($('#bulkImport').style.display === 'block') return;
      e.preventDefault(); $('#saveCustomer').click();
    }
    if (e.key === 'Escape') { closeReminderPopover(); }
  });

  $('#ctNotes')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveTaskFromModal(); }
  });
  $('#ctType')?.addEventListener('change', () => {
    const cur = ($('#ctTitle').value || '').trim();
    const defaults = ['Call', 'Call + Voicemail', 'SMS', 'Email'];
    if (!cur || defaults.includes(cur)) $('#ctTitle').value = titleDefaultFor($('#ctType').value);
  });
  $('#ctTime')?.addEventListener('input', () => {
    const has = !!$('#ctTime').value;
    $('#ctNotify').disabled = !has;
    if (!has) $('#ctNotify').checked = false;
  });
  $('#ctNotify')?.addEventListener('change', () => {
    if ($('#ctNotify').checked) $('#ctImportant').checked = true;
  });
  $('#ctNow')?.addEventListener('click', () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    $('#ctTime').value = `${hh}:${mm}`;
    $('#ctNotify').disabled = false;
  });

  // ===== Agenda controls & toolbar =====
  function setSortButtons() {
    $('#sortClient').classList.toggle('primary', sortMode === 'client');
    $('#sortType').classList.toggle('primary', sortMode === 'type');
    $('#sortClient').setAttribute('aria-pressed', String(sortMode === 'client'));
    $('#sortType').setAttribute('aria-pressed', String(sortMode === 'type'));
  }
  function setAgendaMode(mode) {
    $('#viewToday').classList.toggle('primary', mode === 'today');
    $('#viewWeek').classList.toggle('primary', mode === 'week');
  }
  function setShowButtons() {
    $('#showAll').classList.toggle('primary', showMode === 'all');
    $('#showOpen').classList.toggle('primary', showMode === 'open');
    $('#showDone').classList.toggle('primary', showMode === 'done');
    $('#showAll').setAttribute('aria-pressed', String(showMode === 'all'));
    $('#showOpen').setAttribute('aria-pressed', String(showMode === 'open'));
    $('#showDone').setAttribute('aria-pressed', String(showMode === 'done'));
  }
  $('#sortClient')?.addEventListener('click', () => { sortMode = 'client'; localStorage.setItem(SORT_KEY, sortMode); setSortButtons(); renderAgenda(); });
  $('#sortType')?.addEventListener('click', () => { sortMode = 'type'; localStorage.setItem(SORT_KEY, sortMode); setSortButtons(); renderAgenda(); });

  $('#showAll')?.addEventListener('click', () => { showMode = 'all'; setShowButtons(); renderAgenda(); });
  $('#showOpen')?.addEventListener('click', () => { showMode = 'open'; setShowButtons(); renderAgenda(); });
  $('#showDone')?.addEventListener('click', () => { showMode = 'done'; setShowButtons(); renderAgenda(); });

  $('#viewToday')?.addEventListener('click', () => {
    currentAgendaDate = today();
    renderAgenda = () => buildAgenda(currentAgendaDate);
    setAgendaMode('today'); $('#agendaDate').value = ''; renderAgenda();
  });
  $('#viewWeek')?.addEventListener('click', () => {
    const from = today(); const to = addDays(today(), 7);
    renderAgenda = () => buildAgendaRange(from, to);
    setAgendaMode('week'); $('#agendaDate').value = ''; renderAgenda();
  });
  $('#agendaDate')?.addEventListener('change', () => {
    const d = $('#agendaDate').value ? parseLocalYMD($('#agendaDate').value) : today();
    currentAgendaDate = d; renderAgenda = () => buildAgenda(currentAgendaDate); setAgendaMode(null); renderAgenda();
  });
  $('#agendaFilter')?.addEventListener('input', () => {
    agendaFilter = ($('#agendaFilter').value || '').toLowerCase(); renderAgenda(); buildCalendar();
  });
  $('#agendaFilterClear')?.addEventListener('click', () => { $('#agendaFilter').value = ''; agendaFilter = ''; renderAgenda(); buildCalendar(); });

  // Batch emails
  function emailTemplateFor(t, client) {
    if ((t.label || '').startsWith('Unreached Day 1')) return { subject: 'Welcome — next steps', body: `Hi ${client?.name || ''},\n\nGreat to connect. Here’s the info we discussed…\n\nBest,\n` };
    return { subject: 'Quick follow-up', body: `Hi ${client?.name || ''},\n\nJust checking in on …\n\nBest,\n` };
  }
  function collectDueUnreachedEmails() {
    const f = fmt(today());
    return state.tasks.filter(t => {
      if (t.date !== f || t.status === 'done' || t.type !== 'email') return false;
      const c = clientById(t.clientId);
      return c && c.status === 'unreached' && c.email;
    });
  }
  function launchBatchMailtos(tasks) {
    let i = 0; (function openNext() {
      if (i >= tasks.length) return;
      const t = tasks[i++]; const c = clientById(t.clientId);
      const { subject, body } = emailTemplateFor(t, c || {});
      const href = emailHref(c.email, subject, body);
      const w = window.open(href, '_blank', 'noopener,noreferrer');
      if (!w) { toast('A popup was blocked. Allow popups and try again.', 'err', 2600); return; }
      setTimeout(openNext, 600);
    })();
  }
  $('#sendDueEmails')?.addEventListener('click', () => {
    const due = collectDueUnreachedEmails();
    if (!due.length) { alert('No unreached emails due today.'); return; }
    if (!confirm(`Open ${due.length} email compose window(s) now?`)) return;
    launchBatchMailtos(due);
  });

  // Delete + bell actions in Agenda
  $('#agenda')?.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.getAttribute('data-del');
      if (confirm('Delete this task?')) deleteTask(id);
      return;
    }
    const bell = e.target.closest('[data-bell]');
    if (bell) {
      const id = bell.getAttribute('data-bell');
      openReminderPopover(bell, id);
      return;
    }
  });

  // ===== Wipe All =====
  $('#wipeAll')?.addEventListener('click', () => {
    if (!confirm('Delete ALL customers, tasks, and calendar overrides? This cannot be undone.')) return;
    const tPref = localStorage.getItem(THEME_KEY);
    localStorage.removeItem(storeKey);
    state.clients = []; state.tasks = []; state.settings = defaults().settings;
    if (tPref) localStorage.setItem(THEME_KEY, tPref);
    save();
    alert('All data cleared.');
  });

  // ===== Add Customer (+) robust handler (fix for dimming without modal content) =====
  $('#openAdd')?.addEventListener('click', () => {
    $('#clientForm')?.reset();
    $('#clientId').value = '';
    $('#leadBlob').value = '';

    // Ensure modal wrapper exists and card is inside it
    if (!document.getElementById('addModal')) {
      makeModalFromCard('addCard', 'addModal');
    } else {
      const modal = document.getElementById('addModal');
      const card = document.getElementById('addCard');
      if (card && card.parentElement !== modal) {
        modal.appendChild(card);
      }
    }

    // Ensure card is visible
    const card = document.getElementById('addCard');
    if (card) card.style.display = 'block';

    try { hideBulkImport(); } catch (_) { }

    openModal('addModal', 'addCard');
    setTimeout(() => { try { document.getElementById('leadBlob').focus(); } catch (_) { } }, 30);
  });
  $('#closeAdd')?.addEventListener('click', () => { try { hideBulkImport(); } catch (_) { } closeModal('addModal', 'addCard'); });

  // ===== Notifications boot =====
  function bootstrapNotifications() {
    initNotificationsUI();
    startNotificationTicker();
  }

  // ===== Live filters =====
  $('#search')?.addEventListener('input', refresh);
  $('#statusFilter')?.addEventListener('change', refresh);

  // ===== Bootstrap =====
  function bootstrap() {
    // Build modals once DOM is ready: ensure wrappers exist
    makeModalFromCard('addCard', 'addModal');
    makeModalFromCard('taskCard', 'taskModal');

    setSortButtons();
    setShowButtons();
    setAgendaMode('today');
    refresh();
    buildCalendar();
    bootstrapNotifications();
  }

  // If script is loaded with defer, DOMContentLoaded already fired; still safe.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
