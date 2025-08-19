(function(){
  'use strict';

  /* ========= Helpers ========= */
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const storeKey  = 'followup_crm_v21';
  const THEME_KEY = 'followup_crm_theme';
  const SORT_KEY  = 'followup_crm_sort';
  const SHOW_KEY  = 'followup_crm_show';

  function flashAgendaDate(){
    const el = document.getElementById('agendaDate');
    if(!el) return;
    el.classList.remove('glow');
    void el.offsetWidth;
    el.classList.add('glow');
    clearTimeout(flashAgendaDate._t);
    flashAgendaDate._t = setTimeout(()=> el.classList.remove('glow'), 950);
  }

  function uid(){ return 'id'+Math.random().toString(36).slice(2)+Date.now().toString(36); }
  function today(){ const d=new Date(); d.setHours(0,0,0,0); return d; }
  function addDays(date, n){ const d=new Date(date); d.setDate(d.getDate()+n); return d; }
  function fmt(d){ if(!(d instanceof Date)) d=new Date(d); const z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
  function parseLocalYMD(ymd){ if(!ymd) return today(); const [y,m,d]=ymd.split('-').map(Number); const dt=new Date(y,(m||1)-1,d||1); dt.setHours(0,0,0,0); return dt; }
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function truncate(s, n=90){ if(!s) return ''; return s.length>n ? s.slice(0,n-1)+'…' : s; }

  // Copy helper + tiny copy buttons
  function copyTextToClipboard(text, what='value'){
    if(!text) return;
    const done = () => toast(`Copied ${what}`, 'ok', 900);
    try{
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(done).catch(()=>{
          const ta=document.createElement('textarea');
          ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
          document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
        });
      }else{
        const ta=document.createElement('textarea');
        ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
      }
    }catch(_){}
  }
  document.addEventListener('click', e=>{
    const btn = e.target.closest('[data-copy]');
    if(!btn) return;
    const text = btn.getAttribute('data-copy') || '';
    const what = btn.getAttribute('data-what') || 'value';
    copyTextToClipboard(text, what);
  });

  

  /* ========= Toast ========= */
  function toast(msg, kind='ok', ms=1800){
    const host = document.getElementById('toaster') || (()=>{ const d=document.createElement('div'); d.id='toaster'; document.body.appendChild(d); return d; })();
    const el = document.createElement('div');
    el.className = 'toast ' + (kind==='err'?'err':'ok');
    el.innerHTML = (kind==='err' ? '⚠️' : '✅') + ' ' + (msg||'');
    host.appendChild(el);
    requestAnimationFrame(()=> el.classList.add('show'));
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=> el.remove(), 220); }, ms);
  }

  /* ========= Theme ========= */
  function applyTheme(t){ document.body.classList.toggle('light', t==='light'); $('#themeToggle').textContent = (t==='light' ? '🌙 Dark' : '☀️ Light'); }
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  $('#themeToggle').addEventListener('click', ()=>{
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next); applyTheme(next);
  });

  /* ========= Add/Edit modal ========= */
  function closeAddModal(){
    const m = document.getElementById('addModal');
    const card = document.getElementById('addCard');
    if (m){ m.classList.remove('open'); m.style.display='none'; }
    if (card){ card.style.display='none'; }
    document.body.classList.remove('modal-open');
  }
  function openAddModal(asNew=false){
    const m = document.getElementById('addModal');
    const card = document.getElementById('addCard');
    if(!m || !card) return;
    if(asNew){
      document.getElementById('clientForm')?.reset();
      const idEl = document.getElementById('clientId'); if(idEl) idEl.value='';
      const lbEl = document.getElementById('leadBlob'); if(lbEl) lbEl.value='';
    }
    card.style.display='block';
    m.style.display='flex'; m.classList.add('open');
    document.body.classList.add('modal-open');
    // Focus the paste blob by default (requested)
    setTimeout(()=>{ try{ const el=document.getElementById('leadBlob'); el.focus(); el.select?.(); }catch(_){} }, 50);
  }
  function initAddModal(){
    const card = document.getElementById('addCard');
    if(!card) return;
    let modal = document.createElement('div');
    modal.id = 'addModal';
    modal.className = 'modal';
    modal.style.display = 'none';
    document.body.appendChild(modal);
    modal.appendChild(card);
    modal.addEventListener('click', (e)=>{ if(e.target===modal) closeAddModal(); });
    document.getElementById('openAdd')?.addEventListener('click', ()=> openAddModal(true));
    document.getElementById('closeAdd')?.addEventListener('click', closeAddModal);
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeAddModal(); });
  }

  /* ========= State ========= */
  function defaults(){
    return {
      clients: [],
      tasks: [],
      settings: {
        // ✨ Default non-working: Fri & Sat off
        workingDays: { mon:true, tue:true, wed:true, thu:true, fri:false, sat:false, sun:true },
        moveOffDays: true,
        overrides: {}
      }
    };
  }
  function load(){
    try{
      const s = JSON.parse(localStorage.getItem(storeKey) || 'null') || defaults();
      if(!s.settings) s.settings = defaults().settings;
      return s;
    }catch(e){ return defaults(); }
  }
  const state = load();
  function save(){ localStorage.setItem(storeKey, JSON.stringify(state)); refresh(); buildCalendar(); }

  /* ========= Working days logic ========= */
  function weekdayIndex(dt){ const js=dt.getDay(); return (js+6)%7; } // Mon=0
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

  /* ========= Instant parse on paste / Enter ========= */
  const leadBlobEl = document.getElementById('leadBlob');
  if (leadBlobEl){
    leadBlobEl.addEventListener('paste', () => {
      requestAnimationFrame(() => {
        const has = (leadBlobEl.value || '').trim();
        if (!has) return;
        const res = parseBlob({ onlyFillEmpty:false });
        if (res?.mode === 'multi') {
          toast(`Detected ${res.count} leads. Review & Save All.`);
        } else {
          toast('Parsed from paste. Review & save.');
        }
      });
    });

    leadBlobEl.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' && !e.shiftKey){
        const has = (leadBlobEl.value || '').trim();
        if(!has) return;
        e.preventDefault();
        const res = parseBlob({ onlyFillEmpty:true });
        // Only auto-save for a single lead. Bulk opens its own modal.
        if(res?.mode === 'single'){
          document.getElementById('saveCustomer').click();
        }
      }
    });
  }

  /* ========= Lead Parser (single + bulk) ========= */

  // Existing single-lead parser (unchanged, minor defensiveness)
  function parseLeadBlob(text){
    const raw = (text||'').replace(/\r/g,'\n');
    const whole = raw.replace(/\t/g,'  ').replace(/[ \u00A0]+/g,' ').replace(/\n{2,}/g,'\n').trim();

    const email = (whole.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[''])[0] || '';

    let noDates = whole
      .replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?\b/g,' ')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g,' ');

    const phoneCandidates = (noDates.match(/\+?\d[\d\s().-]{6,}\d/g)||[])
      .map(s=>s.trim())
      .filter(s=>!/:/.test(s))
      .filter(s=>{
        const digits = s.replace(/\D/g,'');
        return digits.length>=10 && digits.length<=15;
      });
    const phone = phoneCandidates[0] || '';

    let name = '';
    const nm = whole.match(/\bnew\b[\s:]+([^\n\t]+?)(?=\s+(?:RT|OW|OJ|[A-Z]{2,3}\b)|\t|\n|$)/i);
    if(nm) name = nm[1].trim();
    if(!name && email){
      const local = email.split('@')[0];
      const parts = local.split(/[._-]+/);
      name = parts.length>1
        ? parts.map(p=>p.charAt(0).toUpperCase()+p.slice(1)).join(' ')
        : local.charAt(0).toUpperCase()+local.slice(1);
    }

    const routeMatch = whole.match(/\b[A-Z]{3}(?:\s*[-–—→]\s*[A-Z]{3})+(?:\s*\|\|[A-Z]{3}(?:\s*[-–—→]\s*[A-Z]{3})+)?\b/);
    const route = routeMatch ? routeMatch[0].replace(/\s*[-–—→]\s*/g,'-').toUpperCase() : '';

    const monthName = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
    const mDates = whole.match(new RegExp(`\\b${monthName}\\s+\\d{1,2}(?:,\\s*\\d{4})?\\s*(?:-|–|—|to|→)\\s*(?:${monthName}\\s+)?\\d{1,2}(?:,\\s*\\d{4})?\\b`,'i'));
    let dates = mDates ? mDates[0].replace(/\s{2,}/g,' ').trim() : '';
    if(!dates){
      const mYMD = whole.match(/\b\d{4}-\d{2}-\d{2}\s*(?:→|to|–|—|-)\s*\d{4}-\d{2}-\d{2}\b/);
      if(mYMD) dates = mYMD[0].replace(/\s+/g,' ');
    }

    let pax = '';
    const mpax = whole.match(/\b(?:pax|passengers?)\s*[:=]?\s*(\d{1,2})\b/i) || whole.match(/\bx\s*(\d{1,2})\b/i);
    if(mpax) pax = mpax[1];

    let leadId = '';
    try{
      const phoneDigits = (phone || '').replace(/\D/g,'');
      const paxDigits   = (pax   || '').replace(/\D/g,'');
      const idCandidates = Array.from(whole.matchAll(/(?:^|[\s\t:>])(\d{4,9})(?=$|[\s\t<])/g)).map(m => m[1]);
      for(const cand of idCandidates){
        if (cand === paxDigits) continue;
        if (phoneDigits && phoneDigits.includes(cand)) continue;
        if (/^\d{8}$/.test(cand)) continue; // likely yyyymmdd
        leadId = cand; break;
      }
    }catch(_){}

    let startDate = '';
    try{
      const ymds = Array.from(whole.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)).map(m=>m[0]);
      startDate = ymds[1] || ymds[0] || '';
    }catch(_){}

    return { name, email, phone, route, dates, pax, leadId, notes:'', startDateFromBlob:startDate };
  }

  // detect & parse multiple leads from one blob
  function parseMultiLeadBlob(text){
    const src = (text||'').replace(/\r/g,'\n').trim();
    if (!src) return [];

    // Split on header lines: "YYYY-MM-DD HH:MM:SS  YYYY-MM-DD HH:MM:SS  <digits> ..."
    const headerRE = /\n(?=\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[\t ]+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[\t ]+\d{4,}\b)/g;
    let parts = src.split(headerRE);

    const looksLikeHeader = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[\t ]+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[\t ]+\d{4,}\b/.test(parts[0]);
    if(!looksLikeHeader && parts.length===1){
      // No headers found — treat as one lead
      const one = parseLeadBlob(src);
      const hd = src.match(/^\s*(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}/m);
      if (hd) one.startDateFromBlob = one.startDateFromBlob || hd[1];
      return [one].filter(x => (x.name||x.email||x.phone));
    }

    const leads = parts.map(chunk => {
      const p = parseLeadBlob(chunk);
      const hdr = chunk.match(/^\s*(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}\s+[\t ]+(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}/m);
      if (hdr) {
        p.startDateFromBlob = p.startDateFromBlob || hdr[1];
        p._updatedYmd = hdr[2];
      }
      return p;
    }).filter(x => (x.name||x.email||x.phone));

    return leads;
  }

  // bulk review modal
  function openBulkReview(leads){
    closeBulkReview(); // safety
    const modal = document.createElement('div');
    modal.id = 'bulkModal';
    modal.className = 'modal open';
    modal.style.display = 'flex';

    const card = document.createElement('section');
    card.className = 'card';
    card.style.width = 'min(1000px, 98vw)';
    card.style.maxHeight = '88vh';
    card.style.overflow = 'auto';

    const hd = document.createElement('div');
    hd.className = 'hd';
    hd.innerHTML = `<strong>Review ${leads.length} parsed lead${leads.length>1?'s':''}</strong><span class="badge">Bulk add</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-icon';
    closeBtn.textContent = '✖';
    closeBtn.addEventListener('click', closeBulkReview);
    hd.appendChild(document.createElement('span')).className = 'space';
    hd.appendChild(closeBtn);

    const bd = document.createElement('div');
    bd.className = 'bd';

    const list = document.createElement('div');
    list.className = 'bulk-list';

    leads.forEach((p, i) => {
      const box = document.createElement('div');
      box.className = 'slab bulk-item';
      box.innerHTML = `
        <div class="top"><strong>${escapeHtml(p.name||'—')}</strong></div>
        <div class="tiny mono">${escapeHtml(p.email||'—')} ${p.phone?(' • '+escapeHtml(p.phone)) : ''}</div>
        <div class="tiny" style="margin-top:6px">
          ${p.route?`<span class="pill">Route:&nbsp;${escapeHtml(p.route)}</span>`:''}
          ${p.dates?` <span class="pill">Dates:&nbsp;${escapeHtml(p.dates)}</span>`:''}
          ${p.pax?` <span class="pill">Pax:&nbsp;${escapeHtml(String(p.pax))}</span>`:''}
          ${p.leadId?` <span class="pill">Lead:&nbsp;${escapeHtml(String(p.leadId))}</span>`:''}
        </div>
        <div class="row" style="margin-top:8px">
          <div>
            <label>Start date</label>
            <input type="date" id="b_start_${i}" value="${escapeHtml(p.startDateFromBlob||fmt(today()))}">
          </div>
          <div>
            <label>Status</label>
            <select id="b_status_${i}">
              <option value="unreached" selected>Unreached</option>
              <option value="reached">Reached</option>
            </select>
          </div>
        </div>
        <div class="row single">
          <div>
            <label>Notes</label>
            <textarea id="b_notes_${i}" rows="2" placeholder="Optional notes…"></textarea>
          </div>
        </div>
      `;
      list.appendChild(box);
    });

    const actions = document.createElement('div');
    actions.className = 'right';
    actions.style.marginTop = '10px';

    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeBulkReview);

    const saveAll = document.createElement('button');
    saveAll.className = 'primary';
    saveAll.textContent = `Save ${leads.length} ${leads.length>1?'customers':'customer'}`;
    saveAll.addEventListener('click', () => {
      leads.forEach((p, i) => {
        const status = document.getElementById(`b_status_${i}`).value || 'unreached';
        const notes  = document.getElementById(`b_notes_${i}`).value || '';
        const start  = document.getElementById(`b_start_${i}`).value || fmt(today());

        const client = {
          id: uid(),
          name: (p.name||'').trim() || '—',
          email: (p.email||'').trim(),
          phone: (p.phone||'').trim(),
          status,
          startDate: start,
          reachedStart: (status==='reached') ? start : null,
          route: (p.route||'').trim(),
          dates: (p.dates||'').trim(),
          pax:   (p.pax||'').trim(),
          leadId:(p.leadId||'').trim(),
          notes: notes
        };

        state.clients.push(client);
        if (status === 'unreached') scheduleUnreached(client);
        else scheduleReached(client);
      });

      const lb = document.getElementById('leadBlob');
      if(lb) lb.value = '';
      document.getElementById('clientForm')?.reset();
      document.getElementById('clientId')?.value = '';
      save();
      toast(`Added ${leads.length} customer${leads.length>1?'s':''}`);
      closeBulkReview();
    });

    actions.appendChild(cancel);
    actions.appendChild(saveAll);

    bd.appendChild(list);
    bd.appendChild(actions);
    card.appendChild(hd);
    card.appendChild(bd);
    modal.appendChild(card);
    document.body.appendChild(modal);

    modal._esc = (e)=>{ if(e.key==='Escape') closeBulkReview(); };
    document.addEventListener('keydown', modal._esc);
    modal.addEventListener('click', (e)=>{ if(e.target===modal) closeBulkReview(); });
  }

  function closeBulkReview(){
    const m = document.getElementById('bulkModal');
    if (!m) return;
    if(m._esc) document.removeEventListener('keydown', m._esc);
    m.remove();
  }

  // SINGLE parseBlob (handles bulk); keep this one — do NOT redefine later
  function parseBlob({ onlyFillEmpty } = { onlyFillEmpty:false }){
    const blob = ($('#leadBlob').value || '').trim();
    if(!blob) return null;

    const many = parseMultiLeadBlob(blob);
    if (many.length > 1){
      openBulkReview(many);
      return { mode:'multi', count: many.length };
    }

    const parsed = many[0] || parseLeadBlob(blob);
    applyParsedToForm(parsed, { onlyFillEmpty });
    return { mode:'single', parsed };
  }

  /* ========= Contact link helpers ========= */
  const CALL_LINK_MODE = 'tel';
  const EMAIL_MODE     = 'gmail';
  function phoneHref(num){
    const clean=(num||'').replace(/[^\d+]/g,'');
    return CALL_LINK_MODE==='callto' ? `callto:${clean}` : `tel:${clean}`;
  }
  function emailHref(addr, subject='', body=''){
    const enc = s => encodeURIComponent(s || '');
    return EMAIL_MODE === 'gmail'
      ? `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(addr)}&su=${enc(subject)}&body=${enc(body)}&tf=1`
      : `mailto:${addr}?subject=${enc(subject)}&body=${enc(body)}`;
  }

  // RingCentral deep links for SMS
  function isMobile(){ return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }
  function toE164(raw){
    if(!raw) return '';
    let d = String(raw).replace(/[^\d+]/g,'');
    if(d.startsWith('+')) return d;
    if(d.length===10) return '+1'+d; // heuristic for US
    if(d[0] !== '+') return '+'+d;
    return d;
  }
  function openRingCentralSMS(rawPhone){
    const e164 = toE164(rawPhone);
    if(!e164) return;

    const desktopPrimary = `rcapp://r/sms?type=new&number=${encodeURIComponent(e164)}`;
    const desktopNoNum   = `rcapp://r/sms?type=new`;
    const mobilePrimary  = `rcmobile://sms?number=${encodeURIComponent(e164)}`;
    const web1           = `https://app.ringcentral.com/r/sms?type=new&number=${encodeURIComponent(e164)}`;
    const web2           = `https://app.ringcentral.com/message/new?type=sms&to=${encodeURIComponent(e164)}`;

    const primary   = isMobile() ? mobilePrimary : desktopPrimary;
    const fallbacks = isMobile() ? [web1, web2] : [desktopNoNum, web1, web2];

    let jumped = false;
    const tryOpen = (url, sameTab=true) => {
      try {
        if(sameTab){ window.location.href = url; } else { window.open(url, '_blank'); }
        jumped = true;
      } catch(_) {}
    };

    tryOpen(primary, true);
    setTimeout(()=>{ if(!jumped && fallbacks.length) tryOpen(fallbacks.shift(), true); }, 200);
    setTimeout(()=>{ if(!jumped && fallbacks.length) tryOpen(fallbacks.shift(), false); }, 600);
  }

  /* ========= Scheduling ========= */
  const ACTIONS_UNREACHED = d => ({ calls:2, voicemail:1, sms:1, emails: d===1?2:1 });
  const ACTIONS_REACHED   = { calls:2, voicemail:1, sms:1, emails:1 };

  function addTask(t){
    t.id = t.id || uid();
    t.status = t.status || 'open';
    const exists = state.tasks.some(x =>
      x.clientId===t.clientId && x.date===t.date && x.type===t.type &&
      (x.title||'')===(t.title||'') && (x.source||'')===(t.source||''));
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
  function markDone(id, done){
    const t = state.tasks.find(x=>x.id===id); if(!t) return; t.status = done? 'done':'open'; save();
  }
  function deleteTask(id){
    state.tasks = state.tasks.filter(t=>t.id!==id); save();
  }

  // Full regeneration per settings/override change
  function regenerateAutoOpenTasksFromAnchors(){
    const from = fmt(today());
    state.tasks = state.tasks.filter(t => !(t.source==='auto' && t.status!=='done' && t.date >= from));
    for(const c of state.clients){ if(c.status==='unreached') scheduleUnreached(c); else scheduleReached(c); }
    save();
  }

  /* ========= Customers table ========= */
  function clientById(id){ return state.clients.find(c=>c.id===id); }
  function nextActionDateForClient(id){
    const open = state.tasks.filter(t=>t.clientId===id && t.status==='open').sort((a,b)=> a.date.localeCompare(b.date));
    return open[0]?.date || '—';
  }

  function refresh(){
    $('#kTotal').textContent = state.clients.length;
    $('#kUn').textContent = state.clients.filter(c=>c.status==='unreached').length;
    $('#kRe').textContent = state.clients.filter(c=>c.status==='reached').length;
    $('#kTasks').textContent = state.tasks.filter(t=>t.status==='open').length;

    const body = $('#clientsTbl tbody'); body.innerHTML = '';
    const query = ($('#search').value||'').toLowerCase();
    const sflt  = ($('#statusFilter').value||'').toLowerCase();
    [...state.clients]
      .sort((a,b)=>a.name.localeCompare(b.name))
      .filter(c => (!sflt || c.status===sflt))
      .filter(c => [c.name,c.email,c.phone,(c.notes||''),(c.route||''),(c.dates||''),(c.pax||''),(c.leadId||'')].join(' ').toLowerCase().includes(query))
      .forEach(c => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-rowid', c.id);
        const contactHtml = `
           ${c.email ? `<a href="${emailHref(c.email,'Follow-up','Hi …')}" target="_blank" rel="noopener">${escapeHtml(c.email)}</a> <button class="copy-btn" data-copy="${escapeHtml(c.email)}" data-what="email" title="Copy email" aria-label="Copy email">⧉</button>` : '-'}
           <br>
          ${c.phone ? `<a href="${phoneHref(c.phone)}">${escapeHtml(c.phone)}</a> <button class="copy-btn" data-copy="${escapeHtml(c.phone)}" data-what="phone" title="Copy phone" aria-label="Copy phone">⧉</button>` : '-'}`;

        tr.innerHTML = `
          <td data-label="Name">
            <strong>${escapeHtml(c.name)}</strong>
            <div class="tiny mono note-preview" title="Click to expand notes">
              ${c.notes ? escapeHtml(truncate(c.notes)) : ''}
            </div>
          </td>
          <td data-label="Contact" class="tiny">${contactHtml}</td>
          <td data-label="Status"><span class="badge">${c.status}</span></td>
          <td data-label="Next Action">${nextActionDateForClient(c.id)}</td>
          <td data-label="Actions" class="actions">
            <button type="button" class="btn-icon" data-act="note"  data-id="${c.id}" title="Show notes" aria-label="Show notes">🗒️</button>
            <button type="button" class="btn-icon" data-act="manual" data-id="${c.id}" title="Set next FU (manual)" aria-label="Manual next FU">📅</button>
            <button type="button" class="btn-icon" data-act="edit"  data-id="${c.id}" title="Edit" aria-label="Edit">🖊️</button>
            <button type="button" class="btn-icon" data-act="reach" data-id="${c.id}" title="${c.status==='unreached'?'Mark Reached':'Mark Unreached'}" aria-label="${c.status==='unreached'?'Mark Reached':'Mark Unreached'}">${c.status==='unreached'?'✅':'↩️'}</button>
            <button type="button" class="btn-icon" data-act="del"   data-id="${c.id}" title="Delete" aria-label="Delete">🗑️</button>
          </td>`;
        body.appendChild(tr);
      });
    renderAgenda();
    updateProgress();
    try{ buildClientOptionsForPopover(); }catch(_){}
  }

  function toggleNotesRow(id){
    const existing = document.querySelector(`.note-row[data-for="${id}"]`);
    if(existing){ existing.remove(); return; }
    const tr = document.querySelector(`tr[data-rowid="${id}"]`);
    if(!tr) return;
    const c = clientById(id) || {};
    const row = document.createElement('tr'); row.className='note-row'; row.setAttribute('data-for', id);
    const td = document.createElement('td'); td.colSpan = 5;
    const chips = [
      c.route ? `<span class="pill">Route: ${escapeHtml(c.route)}</span>` : '',
      c.dates ? `<span class="pill">Dates: ${escapeHtml(c.dates)}</span>` : '',
      c.pax   ? `<span class="pill">Pax: ${escapeHtml(String(c.pax))}</span>` : '',
      c.leadId? `<span class="pill">Lead: ${escapeHtml(String(c.leadId))}</span>` : ''
    ].filter(Boolean).join(' ');
    td.innerHTML = `<div class="tiny slab">${chips || ''}<div>${escapeHtml(c.notes || 'No notes yet.')}</div></div>`;
    row.appendChild(td); tr.after(row);
  }

  // Single, well-formed listener (preview + all actions)
  document.getElementById('clientsTbl')?.addEventListener('click', e=>{
    // 1) Clicking the inline note preview toggles details
    const preview = e.target.closest('.note-preview');
    if (preview){
      const tr = preview.closest('tr');
      const id = tr && tr.getAttribute('data-rowid');
      if (id) toggleNotesRow(id);
      return;
    }

    // 2) Action buttons
    const btn = e.target.closest('button[data-act]');
    if(!btn) return;

    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    const c = id ? clientById(id) : null;

    if(act==='note'){ if(id) toggleNotesRow(id); return; }

    if(act==='manual'){
      const open = document.querySelector(`.manual-row[data-for="${id}"]`);
      if(open){ $$('.manual-row').forEach(n=>n.remove()); return; }
      openManualRow(id); return;
    }

    if(act==='manual-apply'){
      const date = document.getElementById(`manualDate_${id}`)?.value || '';
      const shouldClear = document.getElementById(`manualClear_${id}`)?.checked ?? true;
      const notes = document.getElementById(`manualNotes_${id}`)?.value || '';
      const rmPrev = document.getElementById(`manualClearPrev_${id}`)?.checked ?? false;
      if(c) scheduleManualFU(c, date, shouldClear, notes, rmPrev);
      $$('.manual-row').forEach(n=>n.remove()); return;
    }

    if(act==='manual-cancel'){ $$('.manual-row').forEach(n=>n.remove()); return; }

    if (act==='edit'){
      if(!c){ return; }
      $('#clientId').value = c.id;
      $('#name').value  = c.name  || '';
      $('#email').value = c.email || '';
      $('#phone').value = c.phone || '';
      $('#status').value = c.status;
      $('#startDate').value = c.startDate || '';
      $('#route').value = c.route || '';
      $('#dates').value = c.dates || '';
      $('#pax').value   = c.pax   || '';
      $('#leadId').value = c.leadId || '';
      $('#notes').value = c.notes || '';
      openAddModal(false);
      return;
    }

    if(act==='reach' && c){
      c.status = c.status === 'unreached' ? 'reached' : 'unreached';
      if(c.status === 'reached'){
        c.reachedStart = fmt(today());
        clearFutureTasksForClientFrom(c.id, today());
        scheduleReached(c);
      }else{
        c.startDate = fmt(today());
        clearFutureTasksForClientFrom(c.id, today());
        scheduleUnreached(c);
      }
      save(); return;
    }

    if(act==='del' && id){
      if(confirm('Delete this customer and all their tasks?')){
        state.clients = state.clients.filter(x=>x.id!==id);
        state.tasks   = state.tasks.filter(t=>t.clientId!==id);
        save();
      }
      return;
    }
  });

  /* ========= Manual FU ========= */
  function openManualRow(id){
    $$('.manual-row').forEach(n=>n.remove());
    const tr = document.querySelector(`tr[data-rowid="${id}"]`);
    if(!tr) return;
    const row = document.createElement('tr');
    row.className = 'manual-row'; row.setAttribute('data-for', id);
    const td = document.createElement('td'); td.colSpan = 5;
    td.innerHTML = `
      <div class="tiny slab flex-row">
        <span>Manual next follow-up for <b>${escapeHtml(clientById(id)?.name||'Client')}</b>:</span>
        <input type="date" id="manualDate_${id}" min="${fmt(today())}" />
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
  function scheduleManualFU(client, ymd, shouldClear=true, notes='', removePrevManual=false){
    const date = fmt(parseLocalYMD(ymd || fmt(today())));
    if(shouldClear) clearFutureTasksForClientFrom(client.id, today());
    if(removePrevManual) clearManualTasksForClient(client.id);
    const base = {clientId:client.id, clientName:client.name, date, source:'manual', label:'Manual FU', notes};
    addTask({...base, type:'call',  title:'Call'});
    addTask({...base, type:'call',  title:'Call 2'});
    addTask({...base, type:'sms',   title:'SMS'});
    addTask({...base, type:'email', title:'Email'});
    save();
  }

  /* ========= Agenda ========= */
  let currentAgendaDate = today();
  let sortMode = localStorage.getItem(SORT_KEY) || 'client';  // 'type' | 'client'
  let showMode = localStorage.getItem(SHOW_KEY) || 'all';     // 'all' | 'open' | 'done'
  let agendaFilter = '';

  function setAgendaFilter(val){
    agendaFilter = (val || '').trim().toLowerCase();
    renderAgenda();
    buildCalendar();
  }

  function typeOrder(t){ return ({call:1, callvm:2, voicemail:3, sms:4, email:5, custom:6}[t]||9); }
  function clientDisplayName(t){ return t.clientName || (t.clientId ? (clientById(t.clientId)||{}).name : '') || ''; }
  function clientNameLower(t){ return clientDisplayName(t).toLowerCase(); }
  function sortTasksForMode(a,b){
    const byType = typeOrder(a.type) - typeOrder(b.type);
    const byName = clientNameLower(a).localeCompare(clientNameLower(b));
    const byTitle = (a.title||'').localeCompare(b.title||'');
    return sortMode==='client' ? (byName || byType || byTitle) : (byType || byName || byTitle);
  }
  function matchesFilter(t){ return !agendaFilter || clientNameLower(t).includes(agendaFilter); }
  function matchesShow(t){
    if (showMode === 'open') return t.status !== 'done';
    if (showMode === 'done') return t.status === 'done';
    return true; // 'all'
  }

  function detailsChipsFor(t){
    const c = t.clientId ? clientById(t.clientId) : null;
    if(!c) return '';
    const chips = [
      c.route ? `<span class="pill">Route:&nbsp;${escapeHtml(c.route)}</span>` : '',
      c.dates ? `<span class="pill">Dates:&nbsp;${escapeHtml(c.dates)}</span>` : '',
      c.pax   ? `<span class="pill">Pax:&nbsp;${escapeHtml(String(c.pax))}</span>` : '',
      c.leadId? `<span class="pill">Lead:&nbsp;${escapeHtml(String(c.leadId))}</span>` : ''
    ].filter(Boolean);
    return chips.join(' ');
  }

  function renderTask(t){
    const div = document.createElement('div');
    div.className = 'agenda-item'+(t.status==='done'?' done':'');

    const icon = { call:'📞', callvm:'📞🗣️', voicemail:'🗣️', sms:'💬', email:'✉️', custom:'📝' }[t.type] || '•';
    const client = clientDisplayName(t);

    // Contact pill per task type (SMS uses RC deep link)
    let contactHtml = '';
    if(t.clientId){
      const c = clientById(t.clientId) || {};
      if((t.type==='call' || t.type==='callvm') && c.phone){
        const href = phoneHref(c.phone);
        contactHtml = `<span class="pill"><a class="mono" href="${href}">${escapeHtml(c.phone)}</a><button class="copy-btn" data-copy="${escapeHtml(c.phone)}" data-what="phone" title="Copy phone" aria-label="Copy phone">⧉</button></span>`;
      } else if(t.type==='sms' && c.phone){
        const e164 = c.phone;
        contactHtml = `<span class="pill"><a class="mono" href="#" data-rcsms="${escapeHtml(e164)}">${escapeHtml(c.phone)}</a><button class="copy-btn" data-copy="${escapeHtml(c.phone)}" data-what="phone" title="Copy phone" aria-label="Copy phone">⧉</button></span>`;
      } else if(t.type==='email' && c.email){
        const href = emailHref(c.email,'Follow-up','Hi …');
        contactHtml = `<span class="pill"><a class="mono" href="${href}" target="_blank" rel="noopener">${escapeHtml(c.email)}</a><button class="copy-btn" data-copy="${escapeHtml(c.email)}" data-what="email" title="Copy email" aria-label="Copy email">⧉</button></span>`;
      }
    }

    const src = t.source==='custom'?' (custom)':(t.source==='manual'?' (manual)':'');
    const notesHtml = t.notes ? `<div class="tiny">📝 ${escapeHtml(t.notes)}</div>` : '';
    const chips = detailsChipsFor(t);
    const timeBadged = t.notifyTime ? ` &nbsp; ⏰ <span class="mono">${t.notifyTime}</span>` : '';

    div.innerHTML = `
      <input type="checkbox" ${t.status==='done'?'checked':''} data-taskid="${t.id}"/>
      <div>
        <div><strong>${icon} ${escapeHtml(t.title)}</strong>
          ${client?`<span class="pill">${escapeHtml(client)}</span>`:''}
          ${contactHtml}
          ${chips}
        </div>
        <div class="tiny">${escapeHtml(t.label||'')}${src}</div>
        ${notesHtml}
      </div>
      <div class="tiny mono">
        ${t.date}${timeBadged}
        <button class="btn-icon" data-bell="${t.id}" title="Notify at time">🔔</button>
        <button class="btn-icon" data-del="${t.id}" title="Delete task">🗑️</button>
      </div>`;

    // checkbox
    div.querySelector('input').addEventListener('change', ev=>{ markDone(t.id, ev.target.checked); });

    return div;
  }

  // Inline notify editor (bell)
  function openNotifyEditor(taskId, host){
    const t = state.tasks.find(x=>x.id===taskId); if(!t) return;
    const already = host.querySelector('.notify-row'); if(already){ already.remove(); return; }
    const row = document.createElement('div');
    row.className = 'notify-row';
    row.innerHTML = `
      <span>Notify @</span>
      <input type="time" value="${t.notifyTime||''}" data-notify-time>
      <button data-save-notify="${t.id}" class="primary">Save</button>
      <button data-clear-notify="${t.id}">Clear</button>
    `;
    host.appendChild(row);
    const input = row.querySelector('input[type="time"]');
    input.focus();
    input.addEventListener('keydown', (e)=>{
      if(e.key==='Enter'){ e.preventDefault(); saveNotifyTime(t.id, input.value); row.remove(); }
      if(e.key==='Escape'){ e.preventDefault(); row.remove(); }
    });
  }
  function saveNotifyTime(id, hhmm){
    const t = state.tasks.find(x=>x.id===id); if(!t) return;
    if(!hhmm){ delete t.notifyTime; delete t.notifyAt; t.important=false; save(); return; }
    t.notifyTime = hhmm; t.important = true;
    t.notifyAt = combineYmdTimeLocal(t.date, hhmm).toISOString();
    save();
  }
  function clearNotifyTime(id){
    const t = state.tasks.find(x=>x.id===id); if(!t) return;
    delete t.notifyTime; delete t.notifyAt; t.important=false; save();
  }

  function renderGroupedByClient(container, items){
    let current = '\u0000';
    for(const t of items){
      const name = clientDisplayName(t) || 'Unknown';
      if(name !== current){
        current = name;
        const gh = document.createElement('div');
        gh.className = 'group-hd';
        gh.innerHTML = `<span class="label">${escapeHtml(name)}</span>`;
        container.appendChild(gh);
      }
      container.appendChild(renderTask(t));
    }
  }

  function buildAgenda(date){
    const f = fmt(date);
    const cont = $('#agenda');
    const items = state.tasks
      .filter(t => t.date===f && matchesFilter(t) && matchesShow(t))
      .sort(sortTasksForMode);
    cont.innerHTML = '';
    if(items.length===0){ cont.innerHTML = `<div class="tiny">No tasks for ${f}.</div>`; updateProgress(); return; }
    if (sortMode === 'client') renderGroupedByClient(cont, items);
    else items.forEach(t=>cont.appendChild(renderTask(t)));
    updateProgress();
  }

  function buildAgendaRange(from, to){
    const cont = $('#agenda'); cont.innerHTML = '';
    const days = Math.ceil((to-from)/86400000)+1;
    for(let i=0;i<days;i++){
      const d = addDays(from,i), f = fmt(d);
      const items = state.tasks
        .filter(t => t.date===f && matchesFilter(t) && matchesShow(t))
        .sort(sortTasksForMode);
      const head = document.createElement('div'); head.className = 'tiny'; head.innerHTML = `<div class="badge mono">${f}</div>`;
      cont.appendChild(head);
      if(items.length===0){
        const none = document.createElement('div'); none.className='tiny'; none.textContent='No tasks'; cont.appendChild(none);
      } else if (sortMode === 'client') {
        renderGroupedByClient(cont, items);
      } else {
        items.forEach(t=>cont.appendChild(renderTask(t)));
      }
    }
    updateProgress();
  }

  function updateProgress(){
    const f = fmt(today());
    const todays = state.tasks.filter(t=>t.date===f);
    const done = todays.filter(t=>t.status==='done').length;
    const total = todays.length || 1;
    const pct = Math.round((done/total)*100);
    $('#progressPct').textContent = pct+'%';
    $('#progressBar').style.width = pct+'%';
  }

  // Agenda action clicks (delete, bell, RC sms)
  $('#agenda').addEventListener('click', (e)=>{
    const del = e.target.closest('[data-del]');
    if(del){
      const id = del.getAttribute('data-del');
      if(confirm('Delete this task?')) deleteTask(id);
      return;
    }
    const bell = e.target.closest('[data-bell]');
    if(bell){
      const id = bell.getAttribute('data-bell');
      const host = bell.closest('.agenda-item');
      openNotifyEditor(id, host);
      return;
    }
    const rc = e.target.closest('[data-rcsms]');
    if(rc){
      e.preventDefault();
      const num = rc.getAttribute('data-rcsms') || '';
      openRingCentralSMS(num);
      return;
    }
    const saveBtn = e.target.closest('[data-save-notify]');
    if(saveBtn){
      const id = saveBtn.getAttribute('data-save-notify');
      const host = saveBtn.closest('.notify-row');
      const time = host.querySelector('input[type="time"]').value;
      saveNotifyTime(id, time);
      host.remove();
      return;
    }
    const clrBtn = e.target.closest('[data-clear-notify]');
    if(clrBtn){
      const id = clrBtn.getAttribute('data-clear-notify');
      clearNotifyTime(id);
      clrBtn.closest('.notify-row')?.remove();
      return;
    }
  });

  // Agenda controls
  let renderAgenda = ()=> buildAgenda(currentAgendaDate);

  function setSortButtons(){
    const byClient = $('#sortClient');
    const byType   = $('#sortType');
    if (!byClient || !byType) return;

    byClient.classList.toggle('primary',  sortMode === 'client');
    byType.classList.toggle('primary',    sortMode === 'type');
    byClient.setAttribute('aria-pressed', String(sortMode==='client'));
    byType.setAttribute('aria-pressed',   String(sortMode==='type'));

    const lbl = document.getElementById('sortLabel');
    if (lbl) lbl.textContent = 'Sort:';
  }

  function mountSortGroupLabel(){
    const byClient = document.getElementById('sortClient');
    const byType   = document.getElementById('sortType');
    if (!byClient || !byType || !byClient.parentElement) return;

    const oldWrap = byClient.closest('.seg, .btn-group');
    if (oldWrap){
      oldWrap.parentElement.insertBefore(byClient, oldWrap);
      oldWrap.parentElement.insertBefore(byType, oldWrap);
      if (!oldWrap.querySelector('button')) oldWrap.remove();
    }

    let wrap = document.getElementById('sortWrap');
    if (!wrap){
      wrap = document.createElement('div');
      wrap.id = 'sortWrap';
      wrap.className = 'toolbar';
      byClient.parentElement.insertBefore(wrap, byClient);
    }

    let label = document.getElementById('sortLabel');
    if (!label){
      label = document.createElement('span');
      label.id = 'sortLabel';
      label.className = 'pill tiny mono';
      label.textContent = 'Sort:';
    } else {
      label.textContent = 'Sort:';
    }

    let group = document.getElementById('sortGroup');
    if (!group){
      group = document.createElement('div');
      group.id = 'sortGroup';
      group.className = 'seg';
    }

    wrap.appendChild(label);
    wrap.appendChild(group);
    group.appendChild(byClient);
    group.appendChild(byType);
  }

  // Show buttons (guarded)
  function setShowButtons(){
    const all = $('#showAll'), openBtn = $('#showOpen'), done = $('#showDone');
    if (!all || !openBtn || !done) return;
    all.classList.toggle('primary',  showMode === 'all');
    openBtn.classList.toggle('primary', showMode === 'open');
    done.classList.toggle('primary',  showMode === 'done');
    all.setAttribute('aria-pressed',   String(showMode==='all'));
    openBtn.setAttribute('aria-pressed', String(showMode==='open'));
    done.setAttribute('aria-pressed',  String(showMode==='done'));
  }

  // Show listeners
  const showAllEl  = $('#showAll');
  const showOpenEl = $('#showOpen');
  const showDoneEl = $('#showDone');

  if (showAllEl && showOpenEl && showDoneEl){
    showAllEl.addEventListener('click',  ()=>{ showMode='all';  localStorage.setItem(SHOW_KEY, showMode); setShowButtons(); renderAgenda(); buildCalendar(); });
    showOpenEl.addEventListener('click', ()=>{ showMode='open'; localStorage.setItem(SHOW_KEY, showMode); setShowButtons(); renderAgenda(); buildCalendar(); });
    showDoneEl.addEventListener('click', ()=>{ showMode='done'; localStorage.setItem(SHOW_KEY, showMode); setShowButtons(); renderAgenda(); buildCalendar(); });
  }

  function setAgendaMode(mode){
    $('#viewToday').classList.toggle('primary', mode === 'today');
    $('#viewWeek').classList.toggle('primary', mode === 'week');
  }

  const sortClientEl = document.getElementById('sortClient');
  const sortTypeEl   = document.getElementById('sortType');

  if (sortClientEl && sortTypeEl) {
    sortClientEl.addEventListener('click', () => {
      sortMode = 'client';
      localStorage.setItem(SORT_KEY, sortMode);
      setSortButtons();
      renderAgenda();
    });
    sortTypeEl.addEventListener('click', () => {
      sortMode = 'type';
      localStorage.setItem(SORT_KEY, sortMode);
      setSortButtons();
      renderAgenda();
    });
  }

  const viewTodayEl = document.getElementById('viewToday');
  const viewWeekEl  = document.getElementById('viewWeek');
  const agendaDateEl = document.getElementById('agendaDate');

  if (viewTodayEl) {
    viewTodayEl.addEventListener('click', ()=>{
      currentAgendaDate = today();
      renderAgenda = ()=> buildAgenda(currentAgendaDate);
      setAgendaMode('today');
      if (agendaDateEl) agendaDateEl.value = '';
      renderAgenda();
    });
  }

  if (viewWeekEl) {
    viewWeekEl.addEventListener('click', ()=>{
      const from = today();
      const to   = addDays(today(), 7);
      renderAgenda = ()=> buildAgendaRange(from, to);
      setAgendaMode('week');
      if (agendaDateEl) agendaDateEl.value = '';
      renderAgenda();
    });
  }

  if (agendaDateEl) {
    agendaDateEl.addEventListener('change', ()=>{
      const d = agendaDateEl.value ? parseLocalYMD(agendaDateEl.value) : today();
      currentAgendaDate = d;
      renderAgenda = ()=> buildAgenda(currentAgendaDate);
      setAgendaMode(null);
      renderAgenda();
    });
  }

  const agendaFilterEl = document.getElementById('agendaFilter');
  const agendaFilterClearEl = document.getElementById('agendaFilterClear');

  if (agendaFilterEl) {
    agendaFilterEl.addEventListener('input', ()=> setAgendaFilter(agendaFilterEl.value));
  }
  if (agendaFilterClearEl && agendaFilterEl) {
    agendaFilterClearEl.addEventListener('click', ()=>{
      agendaFilterEl.value = '';
      setAgendaFilter('');
    });
  }

  /* ========= Batch Emails for Unreached today ========= */
  function emailTemplateFor(t, client){
    if((t.label||'').startsWith('Unreached Day 1')) return {subject:'Welcome — next steps', body:`Hi ${client?.name||''},\n\nGreat to connect. Here’s the info we discussed…\n\nBest,\n`};
    return { subject:'Quick follow-up', body:`Hi ${client?.name||''},\n\nJust checking in on …\n\nBest,\n` };
  }
  function collectDueUnreachedEmails(){
    const f = fmt(today());
    return state.tasks.filter(t=>{
      if (t.date!==f || t.status==='done' || t.type!=='email') return false;
      const c = clientById(t.clientId);
      return c && c.status==='unreached' && c.email;
    });
  }
  function launchBatchMailtos(tasks){
    let i=0; (function openNext(){
      if (i>=tasks.length) return;
      const t = tasks[i++]; const c = clientById(t.clientId);
      const {subject, body} = emailTemplateFor(t, c||{});
      const href = emailHref(c.email, subject, body);
      window.open(href, '_blank'); setTimeout(openNext, 600);
    })();
  }
  $('#sendDueEmails')?.addEventListener('click', ()=>{
    const due = collectDueUnreachedEmails();
    if (!due.length){ alert('No unreached emails due today.'); return; }
    if (!confirm(`Open ${due.length} email compose window(s) now?`)) return;
    launchBatchMailtos(due);
  });

  /* ========= Notifications ========= */
  const NOTIFY_KEY = 'followup_crm_notified_today';
  function notifSupported(){ return typeof window.Notification === 'function'; }
  function isSecure(){ return window.isSecureContext || location.protocol==='https:' || ['localhost','127.0.0.1','[::1]'].includes(location.hostname); }
  function setNotifStatus(txt){ const el=$('#notifStatus'); if(el) el.textContent = txt; }
  function fmtToday(){ return fmt(today()); }
  function notifyTask(t){
    if (!notifSupported() || Notification.permission!=='granted') return;
    try{
      const tag = t.id || ('rand-'+Date.now()+'-'+Math.random().toString(36).slice(2));
      const n = new Notification(`${t.title}${t.clientName ? ' — '+t.clientName : ''}`, {
        body: `${t.label||''} • ${t.date}${t.notifyTime?(' @ '+t.notifyTime):''}`,
        tag, renotify:true, silent:false, requireInteraction: !!t.requireInteraction
      });
      n.onclick = () => { try{ window.focus(); }catch(_){} };
    }catch(e){}
  }
  function getNotifiedSet(){
    const f = fmtToday();
    try { const o = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}'); return o[f] ? new Set(o[f]) : new Set(); } catch(e){ return new Set(); }
  }
  function saveNotifiedSet(set){
    const f = fmtToday();
    let o = {};
    try { o = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}'); } catch(e){}
    o[f] = Array.from(set);
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(o));
  }
  function combineYmdTimeLocal(ymd, hhmm){
    const [y,m,d] = (ymd||'').split('-').map(Number);
    let H=9, M=0;
    if (hhmm && /^\d{2}:\d{2}$/.test(hhmm)) { [H,M] = hhmm.split(':').map(Number); }
    return new Date(y, (m||1)-1, d||1, H, M, 0, 0);
  }
  function notifyEligibleTodayImportant(now=new Date()){
    const f = fmtToday();
    const list = state.tasks.filter(t => t.important === true && t.status !== 'done' && t.date === f);
    return list.filter(t => {
      const at = t.notifyAt ? new Date(t.notifyAt) : combineYmdTimeLocal(t.date, t.notifyTime || '09:00');
      return now >= at;
    });
  }
  function initNotificationsUI(){
    const btn = $('#enableNotifs'), test = $('#testNotif'); if(!btn || !test) return;
    function refreshUI(){
      if(!notifSupported()){ btn.disabled = true; test.disabled = true; setNotifStatus('Not supported'); return; }
      if(!isSecure()){ btn.disabled = true; test.disabled = false; setNotifStatus('HTTPS/localhost required'); return; }
      btn.disabled = false; test.disabled = false;
      const perm = Notification.permission;
      if(perm==='granted'){ btn.textContent = '🔔 Enabled'; setNotifStatus('Enabled'); }
      else if(perm==='denied'){ btn.textContent = '🔔 Enable'; setNotifStatus('Blocked'); }
      else { btn.textContent = '🔔 Enable'; setNotifStatus('Not enabled'); }
    }
    refreshUI();
    if (navigator.permissions && navigator.permissions.query){
      try{ navigator.permissions.query({name:'notifications'}).then(p=>{ p.onchange = refreshUI; }).catch(()=>{}); }catch(_){}
    }
    btn.addEventListener('click', async ()=>{
      if(!isSecure()){ alert('Use HTTPS or http://localhost for notifications.'); return; }
      try{
        const res = await Notification.requestPermission();
        setTimeout(refreshUI, 50);
        if(res==='granted'){
          notifyTask({ id:'enabled-'+Date.now(), title:'✅ Notifications enabled', clientName:'', date:fmtToday(), requireInteraction:true });
        } else if(res==='denied'){
          alert('Notifications are blocked. Allow them in your browser’s site settings.');
        }
      }catch(_){}
    });
    test.addEventListener('click', async ()=>{
      if(!isSecure()){ alert('Run from HTTPS or http://localhost.'); return; }
      if(Notification.permission==='default'){ try{ await Notification.requestPermission(); }catch(_){} }
      if(Notification.permission==='granted'){
        notifyTask({ id:'test-'+Date.now(), title:'🔔 Test notification', clientName:'', date:fmtToday(), requireInteraction:true });
      }else if(Notification.permission==='denied'){
        alert('Notifications are blocked. Click the lock icon → Site settings → Allow.');
      }
    });
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) refreshUI(); });
  }
  function startNotificationTicker(){
    let notified = getNotifiedSet();
    function tick(){
      if (!notifSupported() || Notification.permission!=='granted') return;
      const due = notifyEligibleTodayImportant();
      due.forEach(t => {
        if (!notified.has(t.id)){ notifyTask(t); notified.add(t.id); }
      });
      saveNotifiedSet(notified);
    }
    tick(); setInterval(tick, 60*1000); window.addEventListener('focus', tick);
  }

  /* ========= Calendar ========= */
  let calCursor = new Date(); calCursor.setDate(1);
  function buildCalendar(){
    const grid = $('#calendarGrid'); if(!grid) return;
    const year=calCursor.getFullYear(), month=calCursor.getMonth();
    const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    $('#calTitle').textContent = `${MONTH_ABBR[month]} ${year}`;
    grid.innerHTML = '';
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(h=>{ const hd=document.createElement('div'); hd.className='cal-head'; hd.textContent=h; grid.appendChild(hd); });
    const first = new Date(year, month, 1);
    const startIdx = (first.getDay()+6)%7; const daysInMonth = new Date(year, month+1, 0).getDate();
    for(let i=0;i<startIdx;i++){ grid.appendChild(document.createElement('div')); }
    for(let d=1; d<=daysInMonth; d++){
      const dt  = new Date(year, month, d);
      const ymd = fmt(dt);
      const items = state.tasks.filter(t => t.date === ymd && matchesFilter(t) && matchesShow(t));
      const cell = document.createElement('div');
      cell.className='cal-cell'; if(!isWorkingDay(dt)) cell.classList.add('offday');
      cell.innerHTML = `<div class="d">${d}</div>` + (items.length ? `<div class="cal-badge">${items.length}</div>` : '');
      cell.addEventListener('click', ()=>{
        $('#agendaDate').value = ymd;
        $('#agendaDate').dispatchEvent(new Event('change'));
        flashAgendaDate();
        const target = document.getElementById('actionsCard');
        if (target && target.scrollIntoView){
          target.scrollIntoView({ behavior:'smooth', block:'start' });
        } else {
          window.scrollTo({ top: $('#actionsCard').offsetTop - 70, behavior:'smooth' });
        }
      });
      grid.appendChild(cell);
    }
  }
  $('#calPrev')?.addEventListener('click', ()=>{ calCursor.setMonth(calCursor.getMonth()-1); buildCalendar(); });
  $('#calNext')?.addEventListener('click', ()=>{ calCursor.setMonth(calCursor.getMonth()+1); buildCalendar(); });

  function renderOverrideList(){
    const ul = $('#overrideList'); if(!ul) return;
    ul.innerHTML='';
    const entries = Object.entries(state.settings.overrides).sort((a,b)=> a[0].localeCompare(b[0]));
    if (!entries.length){ const li=document.createElement('li'); li.textContent='No overrides yet.'; ul.appendChild(li); return; }
    entries.forEach(([date,type])=>{
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = `${date} — ${type==='work'?'Working':'Off'}`;
      const del = document.createElement('button');
      del.textContent='Delete';
      del.addEventListener('click', ()=>{
        delete state.settings.overrides[date];
        regenerateAutoOpenTasksFromAnchors();
        renderOverrideList();
      });
      li.appendChild(left); li.appendChild(del); ul.appendChild(li);
    });
  }
  function loadSettingsIntoUI(){
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
  function saveSettingsFromUI(){
    const s = state.settings;
    s.workingDays = {
      mon: !!$('#wd_mon').checked, tue: !!$('#wd_tue').checked, wed: !!$('#wd_wed').checked,
      thu: !!$('#wd_thu').checked, fri: !!$('#wd_fri').checked, sat: !!$('#wd_sat').checked, sun: !!$('#wd_sun').checked
    };
    s.moveOffDays = !!$('#moveOffDays').checked;
    regenerateAutoOpenTasksFromAnchors();
    $('#calSettings').style.display = 'none';
  }
  $('#calSettingsBtn')?.addEventListener('click', ()=>{
    const el=$('#calSettings'); if(!el) return;
    const open=el.style.display!=='none';
    el.style.display = open ? 'none' : 'block';
    if(!open) loadSettingsIntoUI();
  });
  $('#saveCalSettings')?.addEventListener('click', saveSettingsFromUI);
  $('#addOverride')?.addEventListener('click', ()=>{
    const d=$('#ovrDate').value; const t=$('#ovrType').value;
    if(!d) return alert('Pick a date');
    state.settings.overrides[d] = (t==='work' ? 'work' : 'off');
    regenerateAutoOpenTasksFromAnchors(); renderOverrideList();
  });

  /* ========= Parse + Form wiring ========= */
  function applyParsedToForm(parsed, { onlyFillEmpty = false } = {}){
    if(!parsed) return;
    const set = (id, val) => {
      if(!val) return;
      const el = document.querySelector(id);
      if(!el) return;
      if(onlyFillEmpty && (el.value || '').trim()) return;
      el.value = val;
    };
    set('#name',  parsed.name);
    set('#email', parsed.email);
    set('#phone', parsed.phone);
    set('#route', parsed.route);
    set('#dates', parsed.dates);
    set('#pax',   parsed.pax);
    set('#leadId', parsed.leadId);
    set('#startDate', parsed.startDateFromBlob);
    if(parsed.notes){
      const cur = ($('#notes').value || '').trim();
      $('#notes').value = cur ? (cur + '\n' + parsed.notes) : parsed.notes;
    }
  }

  function collectClientFromForm(){
    const id = $('#clientId').value || uid();
    const exists = state.clients.find(c=>c.id===id);
    const status = $('#status').value;
    const startDate = $('#startDate').value || fmt(today());
    const client = {
      id,
      name: ($('#name').value||'').trim(),
      email: ($('#email').value||'').trim(),
      phone: ($('#phone').value||'').trim(),
      status,
      startDate,
      reachedStart: exists ? exists.reachedStart : (status === 'reached' ? startDate : null),
      route: ($('#route').value||'').trim(),
      dates: ($('#dates').value||'').trim(),
      pax:   ($('#pax').value||'').trim(),
      leadId: ($('#leadId').value||'').trim(),
      notes: ($('#notes').value||'').trim()
    };
    return { client, exists };
  }

  $('#resetForm')?.addEventListener('click', ()=>{ $('#clientForm').reset(); $('#clientId').value=''; });

  $('#saveCustomer')?.addEventListener('click', ()=>{
    try{
      if (($('#leadBlob').value || '').trim()){ parseBlob({ onlyFillEmpty:true }); }
      const {client, exists} = collectClientFromForm();
      if(!client.name){ alert('Name is required'); $('#name').focus(); return; }
      if(!exists){
        state.clients.push(client);
        if(client.status==='unreached') scheduleUnreached(client);
        else { client.reachedStart = client.startDate; scheduleReached(client); }
        toast('Customer added');
      } else {
        const i = state.clients.findIndex(x=>x.id===client.id);
        const prev = state.clients[i];
        state.clients[i] = client;
        const statusChanged = prev.status!==client.status;
        const anchorChanged = prev.startDate!==client.startDate || prev.reachedStart!==client.reachedStart;
        if(statusChanged){
          clearFutureTasksForClientFrom(client.id, today());
          if(client.status==='reached'){ client.reachedStart = fmt(today()); scheduleReached(client); }
          else { client.startDate = fmt(today()); scheduleUnreached(client); }
        } else if(anchorChanged){
          clearFutureTasksForClientFrom(client.id, today());
          if(client.status==='unreached') scheduleUnreached(client); else scheduleReached(client);
        }
        toast('Customer updated');
      }
      $('#leadBlob').value = '';
      $('#clientForm').reset();
      $('#clientId').value = '';
      save();
      closeAddModal();
    }catch(e){
      console.error(e);
      alert('Could not save customer. If this persists, click “Wipe All” to clear local data and try again.');
      toast('Save failed', 'err', 2200);
    }
  });

  /* ===== Add Custom Task modal ===== */
  function titleDefaultFor(type){ return ({call:'Call', callvm:'Call + Voicemail', sms:'SMS', email:'Email'}[type] || ''); }
  function buildClientOptionsForPopover(){
    const sel = $('#ctClient'); if(!sel) return;
    const keep = sel.value;
    sel.innerHTML = '';
    sel.insertAdjacentHTML('beforeend', `<option value="" selected>None — no client</option>`);
    const opts = [...state.clients].sort((a,b)=>a.name.localeCompare(b.name));
    opts.forEach(c=>{
      const label = c.email ? `${c.name} — ${c.email}` : (c.phone ? `${c.name} — ${c.phone}` : c.name);
      sel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${escapeHtml(label)}</option>`);
    });
    if (keep) sel.value = keep;
  }
  function openCustomTaskPopover(){
    buildClientOptionsForPopover();
    const pop = document.getElementById('customTaskPop'); if(!pop) return;

    if (getComputedStyle(pop).display === 'none'){
      $('#ctType').value = $('#ctType').value || 'call';
      const agendaYmd = fmt(currentAgendaDate || today());
      if (!$('#ctDate').value) $('#ctDate').value = agendaYmd;
      if (!$('#ctTitle').value) $('#ctTitle').value = titleDefaultFor($('#ctType').value);
      $('#ctNotify').disabled = !$('#ctTime').value;

      pop.style.display = 'flex';
      pop._keydown = (e)=>{
        if(e.key==='Escape'){ e.preventDefault(); closeCustomTaskPopover(); }
        if(e.key==='Enter' && !e.shiftKey && e.target.id!=='ctNotes'){
          e.preventDefault(); saveCustomTaskFromPopover();
        }
      };
      document.addEventListener('keydown', pop._keydown);
      pop._backdrop = (e)=>{ if(e.target===pop) closeCustomTaskPopover(); };
      pop.addEventListener('click', pop._backdrop);
    } else {
      closeCustomTaskPopover();
    }
  }
  function clearCustomTaskForm(){
    ['ctClient','ctType','ctTitle','ctDate','ctTime','ctNotes'].forEach(id=>{
      const el = $('#'+id); if(!el) return;
      if (id==='ctType') el.value='call'; else el.value='';
    });
    $('#ctImportant').checked = false;
    $('#ctNotify').checked = false; $('#ctNotify').disabled = true;
  }
  function closeCustomTaskPopover(){
    clearCustomTaskForm();
    const pop = document.getElementById('customTaskPop');
    if(!pop) return;
    if(pop._keydown){ document.removeEventListener('keydown', pop._keydown); pop._keydown=null; }
    if(pop._backdrop){ pop.removeEventListener('click', pop._backdrop); pop._backdrop=null; }
    pop.style.display = 'none';
  }
  function saveCustomTaskFromPopover(){
    const clientId = $('#ctClient').value || '';
    const c = clientId ? clientById(clientId) : null;

    const type  = $('#ctType').value || 'custom';
    let title   = ($('#ctTitle').value||'').trim();
    if (!title) title = titleDefaultFor(type) || 'Custom';
    const date  = $('#ctDate').value || fmt(currentAgendaDate || today());
    const time  = $('#ctTime').value || '';
    const notes = ($('#ctNotes').value||'').trim();
    const notify = !!$('#ctNotify').checked && !!time;
    const important = notify ? true : !!$('#ctImportant').checked;

    const t = {
      clientId: c?.id || null,
      clientName: c?.name || '',
      date, type, title,
      label: 'Custom', source: 'custom', status: 'open', notes, important
    };
    if (time){
      t.notifyTime = time;
      if (notify) t.notifyAt = combineYmdTimeLocal(date, time).toISOString();
    }

    addTask(t);
    save();
    toast('Custom task added');
    closeCustomTaskPopover();
  }
  $('#addTaskBtn')?.addEventListener('click', openCustomTaskPopover);
  $('#ctClose')?.addEventListener('click', closeCustomTaskPopover);
  $('#ctCancel')?.addEventListener('click', closeCustomTaskPopover);
  $('#ctSave')?.addEventListener('click', saveCustomTaskFromPopover);
  $('#ctType')?.addEventListener('change', ()=>{
    const cur = ($('#ctTitle').value||'').trim();
    const titleDefaults = ['Call','Call + Voicemail','SMS','Email'];
    if (!cur || titleDefaults.includes(cur)) $('#ctTitle').value = titleDefaultFor($('#ctType').value);
  });
  $('#ctTime')?.addEventListener('input', ()=>{
    const has = !!$('#ctTime').value;
    $('#ctNotify').disabled = !has;
    if (!has){ $('#ctNotify').checked = false; }
  });
  $('#ctNotify')?.addEventListener('change', ()=>{ if ($('#ctNotify').checked) $('#ctImportant').checked = true; });

  /* ========= Wipe All ========= */
  $('#wipeAll')?.addEventListener('click', () => {
    if (!confirm('Delete ALL customers, tasks, and calendar overrides? This cannot be undone.')) return;
    const tPref = localStorage.getItem(THEME_KEY);
    localStorage.removeItem(storeKey);
    state.clients=[]; state.tasks=[]; state.settings=defaults().settings;
    if(tPref) localStorage.setItem(THEME_KEY, tPref);
    save(); alert('All data cleared.');
  });

  /* ========= Notifications boot ========= */
  initNotificationsUI();
  startNotificationTicker();

  // Customers search + status filter (wire them to refresh the table)
document.getElementById('search')?.addEventListener('input', refresh);
document.getElementById('statusFilter')?.addEventListener('change', refresh);


  /* ========= Bootstrap ========= */
  function bootstrap(){
    initAddModal();
    refresh();
    buildCalendar();
    mountSortGroupLabel();
    setSortButtons();
    setShowButtons();
  }
  bootstrap();

})();
