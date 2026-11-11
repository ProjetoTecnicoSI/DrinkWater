/* DrinkWater: Gamificação.
   Lê os registros reais e a meta do app (somente leitura). Pontos e conquistas ficam em uma chave própria
   do navegador; nada muda no histórico, na meta, nos lembretes nem no banco de dados. */
(() => {
  const JOGO_KEY = KEY + ':jogo';
  const PTS = { registro: 5, maxRegistrosDia: 8, meta: 50, registros4: 10, periodos3: 20, semana5: 100, semana7: 80 };
  const STREAK_REWARDS = { 3: 30, 7: 70, 15: 150, 30: 300 };
  const LEVELS = [
    { n: 1, name: 'Gota Iniciante', min: 0 }, { n: 2, name: 'Pequena Fonte', min: 100 }, { n: 3, name: 'Rio em Movimento', min: 500 },
    { n: 4, name: 'Cachoeira', min: 1500 }, { n: 5, name: 'Mestre da Hidratação', min: 3000 }
  ];
  const ACHS = [
    { id: 'primeira_gota', name: 'Primeira Gota', desc: 'Registre água pela primeira vez.', icon: 'drop' },
    { id: 'hidratado', name: 'Hidratado', desc: 'Atinja a meta diária pela primeira vez.', icon: 'target' },
    { id: 'consistencia', name: 'Consistência', desc: 'Mantenha 3 dias seguidos na meta.', icon: 'flame' },
    { id: 'semana', name: 'Semana Hidratada', desc: 'Atinja a meta por 7 dias seguidos.', icon: 'medal' },
    { id: 'mestre', name: 'Mestre da Hidratação', desc: 'Atinja a meta por 30 dias seguidos.', icon: 'trophy' }
  ];
  const IC = {
    drop: '<path d="M12 3.5s6.5 6.6 6.5 11a6.5 6.5 0 0 1-13 0c0-4.4 6.5-11 6.5-11Z"/>',
    flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.3 2 2.5C11 8.5 10.5 5.5 12 3Z"/>',
    medal: '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5 7 21l5-2.5 5 2.5-1.5-7.5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a2 2 0 0 0 0 4h3M16 6h3a2 2 0 0 1 0 4h-3M12 13v4M9 20h6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>'
  };
  const ic = (n, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

  /* ---------- Armazenamento próprio ---------- */
  const readLedger = () => {
    try { const j = JSON.parse(localStorage.getItem(JOGO_KEY)); if (j && j.v === 1 && j.events && j.unlocked && j.goals) return j; } catch { /* recomeça */ }
    return { v: 1, ready: false, events: {}, unlocked: {}, goals: {} };
  };
  const writeLedger = (l) => { try { localStorage.setItem(JOGO_KEY, JSON.stringify(l)); } catch { /* sem espaço */ } };
  const total = (l) => Object.values(l.events).reduce((s, e) => s + e[0], 0);
  const levelFor = (pts) => {
    let i = 0; LEVELS.forEach((lv, k) => { if (pts >= lv.min) i = k; });
    return { ...LEVELS[i], next: LEVELS[i + 1] || null };
  };

  /* ---------- Datas ---------- */
  const parse = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
  const addDays = (d, n) => { const x = parse(d); x.setDate(x.getDate() + n); return dateKey(x); };
  const weekStart = (d) => addDays(d, -((parse(d).getDay() + 6) % 7)); // segunda-feira
  const br = (d) => parse(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const period = (t) => { const h = Number(t.slice(0, 2)); return h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite'; };

  /* A meta de cada dia passado fica "congelada" para que mudar a meta depois não reescreva a sequência nem gere pontos. */
  function freezeGoals(l, dates, today) {
    let changed = false;
    for (const d of dates) if (d < today && l.goals[d] == null) { l.goals[d] = state.user.dailyGoal; changed = true; }
    if (l.goals[today] !== state.user.dailyGoal) { l.goals[today] = state.user.dailyGoal; changed = true; }
    return changed;
  }
  function analyze(l) {
    const today = dateKey(), byDate = new Map();
    for (const r of state.waterRecords) { const e = byDate.get(r.date) || { total: 0, recs: [] }; e.total += r.amount; e.recs.push(r); byDate.set(r.date, e); }
    for (const e of byDate.values()) e.recs.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
    const dates = [...byDate.keys()].sort(), goalOf = (d) => l.goals[d] ?? state.user.dailyGoal;
    const met = new Set(dates.filter((d) => byDate.get(d).total >= goalOf(d)));
    let run = 0, best = 0, prev = null; const reached = {};
    for (const d of dates.filter((x) => met.has(x))) {
      run = prev && addDays(prev, 1) === d ? run + 1 : 1; prev = d; best = Math.max(best, run);
      for (const n of [1, 3, 7, 15, 30]) if (run >= n && !reached[n]) reached[n] = d;
    }
    let cur = 0, d = met.has(today) ? today : addDays(today, -1);
    while (met.has(d)) { cur++; d = addDays(d, -1); }
    return { today, byDate, dates, met, cur, best, reached, goalOf };
  }
  function reconcile(l, A) { // concede pontos e conquistas ainda não registrados, sem nunca repetir
    const fresh = [], newAch = [], count = {};
    const give = (k, p, d) => { if (l.events[k]) return; l.events[k] = [p, d, Date.now()]; fresh.push({ k, p }); };
    for (const [k, v] of Object.entries(l.events)) if (k[0] === 'r') count[v[1]] = (count[v[1]] || 0) + 1;
    const weeks = {};
    for (const [d, e] of A.byDate) {
      for (const r of e.recs) {
        const k = 'r:' + r.id;
        if (l.events[k] || (count[d] || 0) >= PTS.maxRegistrosDia) continue;
        give(k, PTS.registro, d); count[d] = (count[d] || 0) + 1;
      }
      if (A.met.has(d)) give('m:' + d, PTS.meta, d);
      if (e.recs.length >= 4) give(`d:${d}:r4`, PTS.registros4, d);
      if (new Set(e.recs.map((r) => period(r.time))).size >= 3) give(`d:${d}:p3`, PTS.periodos3, d);
      const w = (weeks[weekStart(d)] ||= { met: 0, days: 0 }); w.days++; if (A.met.has(d)) w.met++;
    }
    for (const [w, s] of Object.entries(weeks)) { if (s.met >= 5) give(`w:${w}:m5`, PTS.semana5, w); if (s.days >= 7) give(`w:${w}:d7`, PTS.semana7, w); }
    for (const n of [3, 7, 15, 30]) if (A.best >= n) give('s:' + n, STREAK_REWARDS[n], A.reached[n]);
    const unlock = (id, d) => { if (d && !l.unlocked[id]) { l.unlocked[id] = d; newAch.push(id); } };
    unlock('primeira_gota', A.dates[0]); unlock('hidratado', A.reached[1]); unlock('consistencia', A.reached[3]); unlock('semana', A.reached[7]); unlock('mestre', A.reached[30]);
    return { fresh, newAch };
  }

  /* ---------- Atualização ---------- */
  let last = null;
  function update() {
    const l = readLedger(), first = !l.ready, today = dateKey();
    const goalsChanged = freezeGoals(l, [...new Set(state.waterRecords.map((r) => r.date))], today);
    const A = analyze(l), before = total(l), lvBefore = levelFor(before).n;
    const { fresh, newAch } = reconcile(l, A);
    l.ready = true; if (fresh.length || newAch.length || first || goalsChanged) writeLedger(l);
    last = { l, A };
    if (!first && fresh.length + newAch.length > 0 && fresh.length <= 6) announce(fresh, newAch, lvBefore, levelFor(total(l)));
    if (!$('#view-game').hidden) render();
  }
  let popTimer;
  function announce(fresh, newAch, lvBefore, lv) {
    const pts = fresh.reduce((s, e) => s + e.p, 0), parts = [];
    if (fresh.some((e) => e.k[0] === 'm')) parts.push('Meta do dia concluída!');
    if (pts) parts.push(`+${pts} ${pts === 1 ? 'ponto' : 'pontos'}`);
    for (const id of newAch) parts.push('Conquista: ' + ACHS.find((a) => a.id === id).name);
    if (lv.n > lvBefore) parts.push(`Nível ${lv.n}: ${lv.name}`);
    if (!parts.length) return;
    const el = $('#gm-pop'); el.textContent = parts.join(' · '); el.classList.add('show');
    clearTimeout(popTimer); popTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ---------- Tela ---------- */
  const bar = (pct, label, done = false) => `<div class="gm-bar${done ? ' done' : ''}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`;
  const pctOf = (v, max) => Math.min(100, Math.round((v / max) * 100));
  function challenge(title, reward, value, max, detail) {
    const pct = pctOf(value, max), done = value >= max;
    return `<div class="gm-ch"><div class="gm-chrow"><span>${title}</span><span class="gm-reward-pts">${done ? ic('check', 16) + ' Concluído' : '+' + reward + ' pontos'}</span></div>${bar(pct, title, done)}<p class="hint">${detail || pct + '% concluído'}</p></div>`;
  }
  function render() {
    if (!last) return;
    const { l, A } = last, pts = total(l), lv = levelFor(pts), goal = state.user.dailyGoal, today = A.today;
    const day = A.byDate.get(today) || { total: 0, recs: [] }, periods = [...new Set(day.recs.map((r) => period(r.time)))];
    const ws = weekStart(today), week = [...A.byDate.keys()].filter((d) => weekStart(d) === ws);
    const wMet = week.filter((d) => A.met.has(d)).length, wDays = week.length, unlockedN = Object.keys(l.unlocked).length;
    const strip = [6, 5, 4, 3, 2, 1, 0].map((i) => {
      const d = addDays(today, -i), hit = A.met.has(d), name = parse(d).toLocaleDateString('pt-BR', { weekday: 'narrow' }).toUpperCase();
      return `<div class="gm-day${hit ? ' hit' : ''}${i === 0 ? ' today' : ''}" aria-label="${br(d)}: ${hit ? 'meta atingida' : i === 0 ? 'hoje, em andamento' : 'meta não atingida'}"><span class="gm-dot">${hit ? ic('flame', 18) : ''}</span><small>${name}</small></div>`;
    }).join('');
    const rewards = [3, 7, 15, 30].map((n) => {
      const got = !!l.events['s:' + n];
      return `<div class="gm-reward${got ? ' done' : ''}"><strong>${got ? ic('check', 16) : ic('lock', 16)} ${n} dias</strong><span>+${STREAK_REWARDS[n]} pontos</span><small>${got ? 'Conquistada' : A.cur >= n ? 'Em andamento' : 'Faltam ' + (n - A.cur)}</small></div>`;
    }).join('');
    const achs = ACHS.map((a) => {
      const on = l.unlocked[a.id];
      return `<div class="gm-ach${on ? ' on' : ''}" role="group" aria-label="${a.name}: ${on ? 'desbloqueada' : 'bloqueada'}"><span class="gm-medal">${ic(on ? a.icon : 'lock', 28)}</span><strong>${a.name}</strong><small>${on ? 'Desbloqueada em ' + parse(on).toLocaleDateString('pt-BR') : a.desc}</small></div>`;
    }).join('');
    const nextN = [3, 7, 15, 30].find((n) => n > A.cur), nextAch = ACHS.find((a) => !l.unlocked[a.id]), todo = [];
    if (day.total < goal) todo.push(`Faltam ${fmtMl(goal - day.total)} para a meta de hoje (+${PTS.meta} pontos)`);
    if (nextN) todo.push(`Mantenha a meta por ${nextN} dias seguidos: faltam ${nextN - A.cur} (+${STREAK_REWARDS[nextN]} pontos)`);
    if (day.recs.length < 4) todo.push(`Registre água mais ${4 - day.recs.length} ${4 - day.recs.length === 1 ? 'vez' : 'vezes'} hoje (+${PTS.registros4} pontos)`);
    if (periods.length < 3) todo.push(`Beba água em ${3 - periods.length} ${3 - periods.length === 1 ? 'período' : 'períodos'} a mais do dia (+${PTS.periodos3} pontos)`);
    if (wMet < 5) todo.push(`Atinja a meta em mais ${5 - wMet} ${5 - wMet === 1 ? 'dia' : 'dias'} nesta semana (+${PTS.semana5} pontos)`);
    if (nextAch) todo.push(`Conquista "${nextAch.name}": ${nextAch.desc.charAt(0).toLowerCase() + nextAch.desc.slice(1)}`);
    if (lv.next) todo.push(`Faltam ${lv.next.min - pts} pontos para o Nível ${lv.next.n}: ${lv.next.name}`);
    $('#gm-root').innerHTML = `
      <div class="card gm-journey">
        <div class="gm-head"><span class="gm-title">${ic('drop')} Minha jornada</span><span class="gm-badge">Nível ${lv.n}</span></div>
        <p class="gm-level">${lv.name}</p>
        <p class="hint">${lv.next ? `${pts} / ${lv.next.min} pontos para o próximo nível` : `${pts} pontos · nível máximo alcançado`}</p>
        ${bar(lv.next ? pctOf(pts, lv.next.min) : 100, 'Progresso para o próximo nível', !lv.next)}
        <div class="gm-stats">
          <div class="gm-stat"><strong>${pts}</strong><span>Pontos</span></div>
          <div class="gm-stat"><strong>${A.cur} <i class="gm-flame">${ic('flame', 22)}</i></strong><span>Dias seguidos</span></div>
          <div class="gm-stat"><strong>${unlockedN} <i class="gm-gold">${ic('medal', 22)}</i></strong><span>Conquistas</span></div>
        </div>
      </div>
      <div class="card"><h2>Sequência de dias</h2>
        <p class="gm-streak"><span class="gm-flame">${ic('flame', 26)}</span> <strong>${A.cur}</strong> ${A.cur === 1 ? 'dia seguido' : 'dias seguidos'} na meta</p>
        <p class="hint">Melhor sequência: ${A.best} ${A.best === 1 ? 'dia' : 'dias'}. A sequência continua se você atingir a meta hoje.</p>
        <div class="gm-week">${strip}</div><h3 class="gm-sub">Recompensas por sequência</h3><div class="gm-rewards">${rewards}</div>
      </div>
      <div class="card"><h2>Desafios de hoje</h2>
        ${challenge('Complete sua meta diária', PTS.meta, day.total, goal, `${pctOf(day.total, goal)}% concluído · ${fmtMl(day.total)} de ${fmtMl(goal)}`)}
        ${challenge('Registre água 4 vezes hoje', PTS.registros4, day.recs.length, 4, `${Math.min(day.recs.length, 4)} de 4 registros`)}
        ${challenge('Beba água em 3 períodos do dia', PTS.periodos3, periods.length, 3, periods.length ? `Hoje: ${periods.join(', ')} (manhã, tarde e noite)` : 'Manhã, tarde e noite')}
      </div>
      <div class="card"><h2>Desafios da semana</h2><p class="hint">Semana de ${br(ws)} a ${br(addDays(ws, 6))}</p>
        ${challenge('Atinja a meta em 5 dias', PTS.semana5, wMet, 5, `${Math.min(wMet, 5)} de 5 dias`)}
        ${challenge('Registre água todos os dias', PTS.semana7, wDays, 7, `${wDays} de 7 dias`)}
      </div>
      <div class="card"><h2>Suas conquistas</h2><div class="gm-achs">${achs}</div></div>
      <div class="card"><h2>Próximos desafios</h2>${todo.length ? `<ul class="gm-todo">${todo.slice(0, 4).map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p class="hint">Você concluiu tudo por agora. Continue assim!</p>'}</div>
      <p class="hint small">Os pontos vêm só dos seus registros reais: ${PTS.registro} por registro (até ${PTS.maxRegistrosDia} por dia), ${PTS.meta} pela meta do dia, além de bônus por desafios e sequências. Mudar a meta não altera os dias que já passaram.</p>`;
  }

  /* ---------- Integração (sem alterar o código existente) ---------- */
  const popEl = document.createElement('div'); popEl.id = 'gm-pop'; popEl.className = 'gm-pop'; popEl.setAttribute('role', 'status'); document.body.appendChild(popEl);
  const baseRenderAll = renderAll; renderAll = function () { baseRenderAll(); update(); };
  const baseShow = show; show = function (view, focus) { baseShow(view, focus); if (view === 'game') render(); };
  (window.dwWipeHooks ||= []).push(() => { try { localStorage.removeItem(JOGO_KEY); } catch { /* ok */ } last = null; });
  window.dwGame = { update, render, levelFor, LEVELS, summary: () => ({ points: total(last.l), level: levelFor(total(last.l)).n, cur: last.A.cur, best: last.A.best, unlocked: Object.keys(last.l.unlocked), events: Object.keys(last.l.events) }) };
  update();
})();
