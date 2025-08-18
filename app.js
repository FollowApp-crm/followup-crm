(function(){
  'use strict';

  // ===== Shortcuts =====
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // ===== Constants =====
  const STORE_KEY   = 'followup_crm_v23';
  const THEME_KEY   = 'followup_crm_theme';
  const SORT_KEY    = 'followup_crm_sort';
  const NOTIFY_KEY  = 'followup_crm_notified_today';
  const LEAD_BASE   = 'https://old.business-tickets.com/crmcms/assigned-flights/show/';

  // ===== Basic utils =====
  function uid(){ return 'id'+Math.random().toString(36).slice(2)+Date.now().toString(36); }
  function today(){ const d=new Date(); d.setHours(0,0,0,0); return d; }
  function addDays(date, n){ const d=new Date(date); d.setDate(d.getDate()+n); return d; }
  function fmt(d){ if(!(d instanceof Date)) d=new Date(d); const z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
  function parseLocalYMD(ymd){ if(!ymd) return today(); const [y,m,d]=ymd.split('-').map(Number); const dt=new Date(y,(m||1)-1,d||1); dt.setHours(0,0,0,0); return dt; }
  function escapeHtml(s){ return (s||'').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;'}[c])); }
  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  // ===== Email / phone helpers =====
  function safeEmail(s){
    s = (s || '').trim();
    if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
    return s;
  }
  function phoneDigits(num){ return (num||'').replace(/[^\d+]/g,''); }
  function phoneHref(num){ const clean=phoneDigits(num); return `tel:${clean}`; }
  const EMAIL_MODE = 'gmail';
  function emailHref(addr, subject='', body=''){
    const enc = s => encodeURIComponent(s || '');
    const safe = safeEmail(addr);
    if (!safe) return '#';
    return EMAIL_MODE === 'gmail'
      ? `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(safe)}&su=${enc(subject)}&body=${enc(body)}&tf=1`
      : `mailto:${safe}?subject=${enc(subject)}&body=${enc(body)}`;
  }
  function ringCentralSmsHref(number, content){
    const digits=phoneDigits(number);
    return `rcapp://r/sms?type=new&number=${digits}&content=${encodeURIComponent(content||'')}`;
  }
  function defaultSmsContent(c){
    const first=((c?.name||'').trim().split(/\s+/)[0]||'').trim();
    return `Hello${first?' '+first:''} — following up.`;
  }

  // ===== Toast =====
  function toast(msg, kind='ok', ms=1800){
    const host = document.getElementById('toaster') || (()=>{ const d=document.createElement('div'); d.id='toaster'; document.body.appendChild(d); return d; })();
    const el = document.createElement('div');
    el.className = 'toast ' + (kind==='err'?'err':'ok');
    el.innerHTML = (kind==='err' ? '⚠️' : '✅') + ' ' + (msg||'');
    host.appendChild(el);
    requestAnimationFrame(()=> el.classList.add('show'));
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=> el.remove(), 220); }, ms);
  }

  // ===== Theme =====
  function applyTheme(t){ document.body.classList.toggle('light', t==='light'); const btn=$('#themeToggle'); if(btn) btn.textContent=(t==='light'?'🌙 Dark':'☀️ Light'); }
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  $('#themeToggle')?.addEventListener('click', ()=>{
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next); applyTheme(next);
  });

  // ===== Modal helpers =====
  function makeModalFromCard(cardId, modalId){
    const card = document.getElementById(cardId);
    let modal = document.createElement('div');
    modal.id = modalId; modal.className = 'modal'; modal.style.display='none';
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
    document.body.appendChild(modal); modal.appendChild(card);
    modal.addEventListener('click', (e)=>{ if(e.target===modal){ closeModal(modalId, cardId); }});
    trapFocus(modal);
    return modal;
  }
  function openModal(modalId, cardId){
    const m=$('#'+modalId), c=$('#'+cardId); if(!m||!c) return;
    c.style.display='block'; m.style.display='flex'; m.classList.add('open'); document.body.classList.add('modal-open');
    setTimeout(()=> m.querySelector('input,textarea,button[autofocus]')?.focus(), 10);
  }
  function closeModal(modalId, cardId){
    const m=$('#'+modalId), c=$('#'+cardId); if(!m||!c) return;
    m.classList.remove('open'); m.style.display='none'; c.style.display='none'; document.body.classList.remove('modal-open');
  }
  function trapFocus(modal){
    const sel='a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    modal.addEventListener('keydown', e=>{
      if(e.key!=='Tab') return;
      const focusables = Array.from(modal.querySelectorAll(sel));
      if (focusables.length===0) return;
      const first = focusables[0], last = focusables[focusables.length-1];
      if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
      if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    });
  }

  // ===== State =====
  function defaults(){
    return {
      clients: [],
      tasks: [],
      settings: {
        workingDays: { mon:true, tue:true, wed:true, thu:true, fri:true, sat:false, sun:false },
        moveOffDays: true,
        overrides: {}
      }
    };
  }
  function load(){
    try{
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || defaults();
      if(!s.settings) s.settings = defaults().settings;
      return s;
    }catch(e){ return defaults(); }
  }
  const state = load();
  function saveState(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  function save(){ saveState(); refresh(); buildCalendar(); }

  // ===== Working days helpers =====
  function weekdayIndex(dt){ const js=dt.getDay(); return (js+6)%7; }
  function isWorkingDay(dt){
    const ymd = fmt(dt);
    const ov = state.settings.overrides[ymd];
    if(ov==='work') return true; if(ov==='off') return false;
    const map=['mon','tue','wed','thu','fri','sat','sun'];
    return !!state.settings.workingDays[ map[weekdayIndex(dt)] ];
  }
  function nextWorkingDay(date){ let d=new Date(date); while(!isWorkingDay(d)) d=addDays(d,1); return d; }
  function stepByWorkingDays(fromDate, steps){ let d=new Date(fromDate); for(let i=0;i<steps;i++) d=nextWorkingDay(addDays(d,1)); return d; }
  function adjustAutoDateIfNeeded(dt){ if(!state.settings.moveOffDays) return dt; let d=new Date(dt); while(!isWorkingDay(d)) d=addDays(d,1); return d; }

  // ===== Lead Parsing (robust, no duplicate splits) =====
  function normalizeBlob(text){
    return (text||'').replace(/\r/g,'\n').replace(/\t/g,'  ').replace(/[ \u00A0]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  }
  function extractEmails(s){ return Array.from((s||'').matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)).map(m=>m[0]); }
  function extractPhones(s){
    return Array.from((s||'').matchAll(/\+?\d[\d\s().-]{6,}\d/g)).map(m=>m[0]).filter(v=>!/:/.test(v));
  }
  function extractLeadIds(s){
    // prefer explicit "Lead" markers, else 4-9 digits not looking like timestamps
    const byLabel = Array.from((s||'').matchAll(/\b(?:Lead\s*ID|Lead\s*#)\s*[:#]?\s*(\d{4,9})\b/ig)).map(m=>m[1]);
    if (byLabel.length) return byLabel;
    const nums = Array.from((s||'').matchAll(/(?:^|[\s:>])(\d{4,9})(?=$|[\s<])/g)).map(m=>m[1]);
    return nums.filter(n=>!/^\d{8}$/.test(n) && !/^\d{10,11}$/.test(n));
  }

  function parseLeadBlob(text){
    const raw = normalizeBlob(text);
    // Remove ISO-like datetimes to avoid phone confusion
    const noDates = raw.replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?\b/g,' ');
    const email = safeEmail((extractEmails(raw)[0]||''));
    const phone = (extractPhones(noDates)[0]||'');
    const routeMatch = raw.match(/\b[A-Z]{3}(?:\s*[-–—→|]{1,2}\s*[A-Z]{3})+\b/);
    const route = routeMatch ? routeMatch[0].replace(/\s*[-–—→|]{1,2}\s*/g,'-').toUpperCase() : '';
    let name = '';
    const nm = raw.match(/\bnew\b[\s:]+([^\n\t]+?)(?=\s+(?:RT|OW|[A-Z]{2,3}\b)|\t|\n|$)/i);
    if(nm) name = nm[1].trim();
    if(!name && email){
      const local = email.split('@')[0];
      const parts = local.split(/[._-]+/);
      name = parts.length>1 ? parts.map(p=>p.charAt(0).toUpperCase()+p.slice(1)).join(' ') : local.charAt(0).toUpperCase()+local.slice(1);
    }
    const monthName = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?)";
    const mDates = raw.match(new RegExp(`\\b${monthName}\\s+\\d{1,2}(?:,\\s*\\d{4})?\\s*(?:-|–|—|to|→)\\s*(?:${monthName}\\s+)?\\d{1,2}(?:,\\s*\\d{4})?\\b`,'i'));
    let dates = mDates ? mDates[0].replace(/\s{2,}/g,' ').trim() : '';
    if(!dates){
      const mYMD = raw.match(/\b\d{4}-\d{2}-\d{2}\s*(?:→|to|–|—|-)\s*\d{4}-\d{2}-\d{2}\b/);
      if(mYMD) dates = mYMD[0].replace(/\s+/g,' ');
    }
    let pax='';
    const mpax = raw.match(/\b(?:pax|passengers?)\s*[:=]?\s*(\d{1,2})\b/i) || raw.match(/\bx\s*(\d{1,2})\b/i);
    if(mpax) pax = mpax[1];
    const leadIds = extractLeadIds(raw);
    const leadId = leadIds[0] || '';
    let cabin='';
    const mc = raw.match(/\b(Business|First|Economy|Premium\s+Economy)\b/i);
    if(mc) cabin = mc[1];
    return { name, email, phone, route, dates, pax, leadId, cabin, notes:'' };
  }

  function mergeLead(a,b){
    if(!a) return b; if(!b) return a;
    const out={};
    for(const k of ['name','email','phone','route','dates','pax','leadId','cabin','notes']){
      out[k] = (a[k] && String(a[k]).trim()) ? a[k] : (b[k]||'');
      if(k==='name' && (!out[k] || /@|_/g.test(out[k]))){ out[k] = a.name?.includes(' ')?a.name:(b.name||out[k]); }
    }
    return out;
  }

  function parseMultipleLeads(text){
    const norm = normalizeBlob(text);
    if(!norm) return [];
    const emails = extractEmails(norm);
    const phones = extractPhones(norm);
    const ids    = extractLeadIds(norm);
    const newMarkers = Array.from(norm.matchAll(/(?:^|\n)\s*new\b/ig)).length;
    const distinctEmails = new Set(emails.map(e=>e.toLowerCase())).size;
    const distinctPhones = new Set(phones.map(phoneDigits)).size;
    const distinctIds    = new Set(ids).size;
    if (newMarkers<=1 && distinctEmails<=1 && distinctPhones<=1 && distinctIds<=1){
      const single = parseLeadBlob(norm);
      return single.name||single.email||single.phone||single.leadId ? [single] : [];
    }
    let parts = norm.split(/\n(?=\s*new\b)/i);
    if (parts.length<=1){
      parts = norm.split(/\n{2,}(?=\S)/g);
    }
    const itemsRaw = parts.map(s=>s.trim()).filter(Boolean).map(parseLeadBlob);
    const merged = [];
    for(const it of itemsRaw){
      if(!it || !(it.name||it.email||it.phone||it.leadId)) continue;
      const matchIdx = merged.findIndex(x =>
         (it.email && x.email && it.email.toLowerCase()===x.email.toLowerCase()) ||
         (it.phone && x.phone && phoneDigits(it.phone)===phoneDigits(x.phone)) ||
         (it.leadId && x.leadId && it.leadId===x.leadId));
      if (matchIdx>=0) merged[matchIdx] = mergeLead(merged[matchIdx], it);
      else merged.push(it);
    }
    const seen = new Set(); const out=[];
    for(const it of merged){
      const k = (it.email||'').toLowerCase() || phoneDigits(it.phone||'') || it.leadId || it.name || uid();
      if(!seen.has(k)){ seen.add(k); out.push(it); }
    }
    return out;
  }

  // ===== Contacts & links =====
  function contactChips(c){
    const chips=[];
    if(c.email) chips.push(`<span class="pill"><a class="mono" href="${emailHref(c.email,'Follow-up','Hi …')}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.email)}</a></span>`);
    if(c.phone) chips.push(`<span class="pill"><a class="mono" href="${phoneHref(c.phone)}">${escapeHtml(c.phone)}</a></span>`);
    if(c.leadId) chips.push(`<span class="pill">Lead:&nbsp;<a href="${LEAD_BASE+encodeURIComponent(String(c.leadId))}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(c.leadId))}</a></span>`);
    return chips.join(' ');
  }

  // ===== Scheduling =====
  const ACTIONS_UNREACHED = d => ({ calls:2, voicemail:1, sms:1, emails: d===1?2:1 });
  const ACTIONS_REACHED   = { calls:2, voicemail:1, sms:1, emails:1 };

  function addTask(t){
    t.id = t.id || uid();
    t.status = t.status || 'open';
    const exists = state.tasks.some(x => x.clientId===t.clientId && x.date===t.date && x.type===t.type && (x.title||'')===(t.title||'') && (x.source||'')===(t.source||''));
    if(!exists) state.tasks.push(t);
  }
  function genDayTasks(client, date, a, label){
    const todayY = fmt(today());
    if(date < todayY) return;
    const base = {clientId:client.id, clientName:client.name, date, source:'auto', label};
    if (a.calls >= 1) addTask({...base, type:'call',   title:'Call'});
    if (a.voicemail >= 1) addTask({...base, type:'callvm', title:'Call + Voicemail'});
    else if (a.calls >= 2) addTask({...base, type:'call',   title:'Call 2'});
    for (let i=1;i<=a.sms;i++) addTask({...base, type:'sms', title:'SMS'});
    if (label && label.startsWith('Unreached Day 1')){
      addTask({...base, type:'email', title:'Introduction & Info Emails'});
      addTask({...base, type:'email', title:'3PQ + Feedback Request Email'});
    } else {
      for (let i=1;i<=a.emails;i++) addTask({...base, type:'email', title:'Email'});
    }
  }
  function scheduleUnreached(client){
    const start0 = client.startDate ? parseLocalYMD(client.startDate) : today();
    let day1 = nextWorkingDay(start0);
    for(let dayNum=1; dayNum<=5; dayNum++){
      const date = fmt(adjustAutoDateIfNeeded(day1));
      genDayTasks(client, date, ACTIONS_UNREACHED(dayNum), `Unreached Day ${dayNum}`);
      if(dayNum<5) day1 = stepByWorkingDays(day1, 1);
    }
  }
  function scheduleReached(client){
    const start0 = client.reachedStart ? parseLocalYMD(client.reachedStart) : today();
    const p1d1 = adjustAutoDateIfNeeded(nextWorkingDay(start0));
    const p1d2 = adjustAutoDateIfNeeded(stepByWorkingDays(p1d1, 1));
    const p1d3 = adjustAutoDateIfNeeded(stepByWorkingDays(p1d2, 1));
    genDayTasks(client, fmt(p1d1), ACTIONS_REACHED, `Phase 1 (Day 1/3)`);
    genDayTasks(client, fmt(p1d2), ACTIONS_REACHED, `Phase 1 (Day 2/3)`);
    genDayTasks(client, fmt(p1d3), ACTIONS_REACHED, `Phase 1 (Day 3/3)`);
    const gaps = [3,5,7,7,7];
    let last = p1d3;
    for (let i=0;i<gaps.length;i++){
      let target = addDays(last, gaps[i]);
      target = adjustAutoDateIfNeeded(target);
      genDayTasks(client, fmt(target), ACTIONS_REACHED, `Phase ${i+2}`);
      last = target;
    }
  }

  function clearFutureTasksForClientFrom(id, fromDate){
    const f = fmt(fromDate);
    state.tasks = state.tasks.filter(t=> !(t.clientId===id && t.source==='auto' && t.status!=='done' && t.date >= f));
  }
  function clearManualTasksForClient(id){
    state.tasks = state.tasks.filter(t=> !(t.clientId===id && t.source==='manual' && t.status!=='done'));
  }
  function regenerateAutoOpenTasksFromAnchors(){
    const from = fmt(today());
    state.tasks = state.tasks.filter(t => !(t.source==='auto' && t.status!=='done' && t.date >= from));
    for(const c of state.clients){ if(c.status==='unreached') scheduleUnreached(c); else scheduleReached(c); }
    save();
  }

  // ===== Customers table =====
  function clientById(id){ return state.clients.find(c=>c.id===id); }
  function nextActionDateForClient(id){
    const open = state.tasks.filter(t=>t.clientId===id && t.status==='open').sort((a,b)=> a.date.localeCompare(b.date));
    return open[0]?.date || '—';
  }
  function countOpenTasksForClient(id){
    return state.tasks.filter(t => t.clientId===id && t.status==='open').length;
  }

  function renderClients(){
    const container = $('#customersTableBody');
    if(!container) return;
    container.innerHTML = '';
    const sortMode = localStorage.getItem(SORT_KEY) || 'client';
    let list = [...state.clients];
    if(sortMode==='client'){
      list.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
    } else {
      list.sort((a,b)=> (nextActionDateForClient(a.id)||'').localeCompare(nextActionDateForClient(b.id)||''));
    }
    for(const c of list){
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(c.name||'')}</td>
        <td>${contactChips(c)}</td>
        <td>${escapeHtml(c.route||'')}</td>
        <td>${escapeHtml(c.dates||'')}</td>
        <td>${escapeHtml(c.pax||'')}</td>
        <td>${escapeHtml(c.cabin||'')}</td>
        <td>${escapeHtml(c.leadId||'')}</td>
        <td>${escapeHtml(c.status||'')}</td>
        <td>${nextActionDateForClient(c.id)}</td>
        <td>${countOpenTasksForClient(c.id)}</td>
        <td>
          <button class="small" data-act="edit" data-id="${c.id}">✏️</button>
          <button class="small danger" data-act="del" data-id="${c.id}">🗑</button>
        </td>
      `;
      container.appendChild(tr);
    }
  }

  // ===== Customer Modal =====
  function openCustomerModal(prefill){
    const cardId = 'addCustomerCard';
    const modalId = 'addCustomerModal';
    const modal = $('#'+modalId) || makeModalFromCard(cardId, modalId);
    if(prefill){
      $('#leadPaste').value = prefill;
      previewParsedLeads();
    } else {
      $('#leadPaste').value = '';
      $('#parsedLeadsTable').innerHTML = '';
    }
    openModal(modalId, cardId);
  }

  $('#addCustomerBtn')?.addEventListener('click', ()=> openCustomerModal());

  function previewParsedLeads(){
    const txt = $('#leadPaste').value;
    const leads = parseMultipleLeads(txt);
    const tbody = $('#parsedLeadsTable');
    tbody.innerHTML = '';
    leads.forEach((c,i)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="leadSelect" data-idx="${i}" checked></td>
        <td>${escapeHtml(c.name||'')}</td>
        <td>${escapeHtml(c.email||'')}</td>
        <td>${escapeHtml(c.phone||'')}</td>
        <td>${escapeHtml(c.route||'')}</td>
        <td>${escapeHtml(c.pax||'')}</td>
        <td>${escapeHtml(c.leadId||'')}</td>
      `;
      tbody.appendChild(tr);
    });
  }
  $('#leadPaste')?.addEventListener('input', previewParsedLeads);

  $('#addSelectedBtn')?.addEventListener('click', ()=>{
    const txt = $('#leadPaste').value;
    const leads = parseMultipleLeads(txt);
    $$('.leadSelect').forEach(cb=>{
      if(cb.checked){
        const c = leads[cb.dataset.idx];
        if(c){
          c.id = uid();
          c.status = 'unreached';
          c.startDate = fmt(today());
          state.clients.push(c);
          if(c.status==='unreached') scheduleUnreached(c); else scheduleReached(c);
        }
      }
    });
    save();
    closeModal('addCustomerModal','addCustomerCard');
  });

  // ===== Tasks table =====
  function renderTasks(){
    const container = $('#tasksTableBody');
    if(!container) return;
    container.innerHTML = '';
    let tasks = [...state.tasks];
    const sortMode = localStorage.getItem(SORT_KEY) || 'client';
    if(sortMode==='client'){
      tasks.sort((a,b)=> a.clientName.localeCompare(b.clientName) || a.date.localeCompare(b.date));
    } else {
      tasks.sort((a,b)=> a.date.localeCompare(b.date) || a.clientName.localeCompare(b.clientName));
    }
    for(const t of tasks){
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(t.clientName||'')}</td>
        <td>${escapeHtml(t.date||'')}</td>
        <td>${escapeHtml(t.type||'')}</td>
        <td>${escapeHtml(t.title||'')}</td>
        <td>${escapeHtml(t.label||'')}</td>
        <td>${escapeHtml(t.status||'')}</td>
        <td>
          <button class="small" data-act="done" data-id="${t.id}">✔</button>
          <button class="small danger" data-act="delTask" data-id="${t.id}">🗑</button>
        </td>
      `;
      container.appendChild(tr);
    }
  }

  // ===== Calendar =====
  function buildCalendar(){
    const cal = $('#calendarBody');
    if(!cal) return;
    cal.innerHTML = '';
    const start = today();
    for(let i=0;i<30;i++){
      const d = addDays(start,i);
      const ymd = fmt(d);
      const dayTasks = state.tasks.filter(t=>t.date===ymd && t.status==='open');
      const cell = document.createElement('div');
      cell.className = 'calDay ' + (isWorkingDay(d)?'work':'off');
      cell.innerHTML = `
        <div class="date">${ymd}</div>
        <div class="tasks">${dayTasks.map(t=>`<div class="tiny">${escapeHtml(t.clientName)}: ${escapeHtml(t.type)}</div>`).join('')}</div>
      `;
      cal.appendChild(cell);
    }
  }

  // ===== Agenda =====
  function renderAgenda(){
    const ag = $('#agendaBody');
    if(!ag) return;
    ag.innerHTML = '';
    const todayY = fmt(today());
    const tasks = state.tasks.filter(t=>t.date>=todayY && t.status==='open').sort((a,b)=> a.date.localeCompare(b.date));
    for(const t of tasks){
      const div = document.createElement('div');
      div.className = 'agendaItem';
      div.innerHTML = `
        <span class="date">${t.date}</span>
        <span class="client">${escapeHtml(t.clientName)}</span>
        <span class="type">${escapeHtml(t.type)}</span>
        <span class="title">${escapeHtml(t.title||'')}</span>
      `;
      ag.appendChild(div);
    }
  }

  // ===== Refresh =====
  function refresh(){
    renderClients();
    renderTasks();
    renderAgenda();
  }

  // ===== Event delegation =====
  document.body.addEventListener('click', e=>{
    const act = e.target.dataset.act;
    if(!act) return;
    if(act==='edit'){
      const id = e.target.dataset.id;
      const c = clientById(id);
      if(c){
        openCustomerModal('');
        $('#leadPaste').value = JSON.stringify(c,null,2);
        previewParsedLeads();
      }
    }
    if(act==='del'){
      const id = e.target.dataset.id;
      state.clients = state.clients.filter(x=>x.id!==id);
      state.tasks = state.tasks.filter(t=>t.clientId!==id);
      save();
    }
    if(act==='done'){
      const id = e.target.dataset.id;
      const t = state.tasks.find(x=>x.id===id);
      if(t){ t.status='done'; save(); }
    }
    if(act==='delTask'){
      const id = e.target.dataset.id;
      state.tasks = state.tasks.filter(x=>x.id!==id);
      save();
    }
  });

  // ===== Settings =====
  $('#saveSettingsBtn')?.addEventListener('click', ()=>{
    const form = $('#settingsForm');
    const wd = {};
    ['mon','tue','wed','thu','fri','sat','sun'].forEach(d=>{
      wd[d] = form.querySelector(`[name=wd_${d}]`).checked;
    });
    state.settings.workingDays = wd;
    state.settings.moveOffDays = form.querySelector('[name=moveOffDays]').checked;
    save();
    closeModal('settingsModal','settingsCard');
  });

  // ===== Init =====
  refresh();
  buildCalendar();

})();
