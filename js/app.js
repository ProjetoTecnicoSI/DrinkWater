'use strict';
/* DrinkWater: lembrar, registrar e acompanhar. Dados guardados em localStorage. */

const KEY = 'drinkwater:v1', DATA_VERSION = 1;
const RECOVERY_KEY = KEY + ':recuperacao', PREMIG_KEY = KEY + ':pre-migracao';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ICON_DROP = '<svg class="ico" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5s6.5 6.6 6.5 11a6.5 6.5 0 0 1-13 0c0-4.4 6.5-11 6.5-11Z"/></svg>';
const ICON_TRASH = '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg>';

/* ---------- Estado e persistência ---------- */
const DEFAULTS = {
  version: DATA_VERSION,
  onboarded: false,
  user: { name: '', dailyGoal: 2000 },
  settings: { remindersEnabled: false, startTime: '08:00', endTime: '22:00', interval: 60, theme: null, unit: 'ml' },
  waterRecords: [] // { id, date: 'AAAA-MM-DD', time: 'HH:MM', amount }
};

function mkId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00'));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const clampInt = (v, lo, hi, d) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : d);

/* Valida e normaliza dados vindos do armazenamento ou de um backup. Nunca lança erro.
   strict: exige a lista waterRecords (usado na importação). */
function validate(s, strict = false) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false };
  if (!Array.isArray(s.waterRecords) && (strict || s.waterRecords !== undefined)) return { ok: false };
  const ids = new Set(), waterRecords = []; let discarded = 0;
  for (const r of s.waterRecords || []) {
    const amount = Number(r?.amount);
    if (!r || !isDate(r.date) || !isTime(r.time) || !Number.isInteger(amount) || amount < 1 || amount > 5000) { discarded++; continue; }
    const id = typeof r.id === 'string' && /^[a-z0-9]{1,40}$/i.test(r.id) && !ids.has(r.id) ? r.id : mkId();
    ids.add(id); waterRecords.push({ id, date: r.date, time: r.time, amount });
  }
  const u = s.user && typeof s.user === 'object' ? s.user : {}, t = s.settings && typeof s.settings === 'object' ? s.settings : {};
  return { ok: true, discarded, data: {
    version: DATA_VERSION, onboarded: !!s.onboarded,
    user: { name: typeof u.name === 'string' ? u.name.slice(0, 30) : '', dailyGoal: clampInt(Number(u.dailyGoal), 500, 10000, DEFAULTS.user.dailyGoal) },
    settings: {
      remindersEnabled: !!t.remindersEnabled,
      startTime: isTime(t.startTime) ? t.startTime : DEFAULTS.settings.startTime,
      endTime: isTime(t.endTime) ? t.endTime : DEFAULTS.settings.endTime,
      interval: clampInt(Number(t.interval), 15, 480, DEFAULTS.settings.interval),
      theme: t.theme === 'light' || t.theme === 'dark' ? t.theme : null,
      unit: t.unit === 'cups' ? 'cups' : 'ml'
    },
    waterRecords } };
}

/* Versionamento: cada função converte da versão N para N+1. Dados sem "version" são a versão 0. */
const MIGRATIONS = { 0: (s) => s }; // 0 -> 1: o formato é o mesmo; apenas passa a ser numerado
function migrate(s) { let v = Number(s.version) || 0; while (v < DATA_VERSION) { s = MIGRATIONS[v](s); v++; } return { ...s, version: DATA_VERSION }; }

/* Cópias de recuperação (no máximo 2): guardam o conteúdo original quando algo dá errado. */
const readRecovery = () => { try { const l = JSON.parse(localStorage.getItem(RECOVERY_KEY)); return Array.isArray(l) ? l : []; } catch { return []; } };
function keepRecovery(raw, reason) {
  try { localStorage.setItem(RECOVERY_KEY, JSON.stringify([...readRecovery(), { savedAt: new Date().toISOString(), reason, raw }].slice(-2))); } catch { /* sem espaço */ }
}

let loadIssue = null, locked = false, lastRaw = null;
const fresh = () => structuredClone(DEFAULTS);
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { loadIssue = { type: 'unavailable' }; return fresh(); }
  lastRaw = raw;
  if (raw === null) return fresh();
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if ((Number(parsed.version) || 0) > DATA_VERSION) { keepRecovery(raw, 'versão mais nova'); loadIssue = { type: 'newer' }; locked = true; return { ...fresh(), onboarded: true }; } // sem tela de configuração: o app só avisa e não salva
    if (!parsed.version) { try { localStorage.setItem(PREMIG_KEY, raw); } catch { /* sem espaço */ } }
    parsed = migrate(parsed);
  }
  const v = validate(parsed);
  if (!v.ok) { keepRecovery(raw, 'ilegível'); loadIssue = { type: 'corrupt' }; return fresh(); }
  if (v.discarded) { keepRecovery(raw, 'registros inválidos'); loadIssue = { type: 'discarded', n: v.discarded }; }
  return v.data;
}
let state = load();
/* Traz para a memória o que outra aba salvou. Chamado antes de qualquer alteração de registros. */
function refresh() {
  let cur = null; try { cur = localStorage.getItem(KEY); } catch { /* indisponível */ }
  if (cur !== lastRaw) state = load();
}
function save() {
  if (locked) { toast('Estes dados são de uma versão mais nova do app. Atualize o app para voltar a salvar.'); return false; }
  try {
    if (localStorage.getItem(KEY) !== lastRaw) { // outra aba salvou depois da nossa leitura: preserva os registros dela
      const other = load(); state.waterRecords = other.waterRecords; state.onboarded = state.onboarded || other.onboarded;
    }
    state.version = DATA_VERSION;
    const raw = JSON.stringify(state); localStorage.setItem(KEY, raw); lastRaw = raw; return true;
  } catch { toast('Não foi possível salvar os dados neste navegador.'); return false; }
}

/* Armazenamento persistente: pede ao navegador para não apagar os dados automaticamente. */
let persistAsked = false;
async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch { return null; }
}
function persistOnce() { if (!persistAsked) { persistAsked = true; requestPersistence(); } }
async function storageStatus() {
  const ok = await requestPersistence(), el = $('#storage-status');
  el.textContent = ok ? 'Armazenamento protegido: o navegador não apaga seus registros automaticamente.'
    : 'O navegador pode apagar os dados salvos se faltar espaço. Exporte um backup de vez em quando.';
}

/* ---------- Utilitários ---------- */
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeNow = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/* Unidade de exibição (ml ou copos). Os dados continuam sempre guardados em ml. */
const CUP_ML = 200;
const isCups = () => state.settings.unit === 'cups';
const toMl = (v) => (isCups() ? v * CUP_ML : v);                                 // valor digitado -> ml
const fromMl = (ml) => (isCups() ? Math.round((ml / CUP_ML) * 100) / 100 : ml);  // ml -> valor exibido
const fmtMl = (n) => {
  if (!isCups()) return `${Math.round(n).toLocaleString('pt-BR')} ml`;
  const c = fromMl(n);
  return `${c.toLocaleString('pt-BR')} ${c > 0 && c <= 1 ? 'copo' : 'copos'}`;
};
const fmtAmt = (ml) => (isCups() ? fmtMl(ml) : `${ml} ml`);
const goalError = () => (isCups() ? 'Informe uma meta entre 2,5 e 50 copos.' : 'Informe uma meta entre 500 e 10.000 ml.');
const fmtDate = (k) => k.split('-').reverse().join('/');
const fmtShort = (k) => fmtDate(k).slice(0, 5);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const recordsOf = (k) => state.waterRecords.filter((r) => r.date === k).sort((a, b) => a.time.localeCompare(b.time));
const totalOf = (k) => recordsOf(k).reduce((s, r) => s + r.amount, 0);
const pctOf = (total) => Math.round((total / state.user.dailyGoal) * 100);
function lastDays(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
    return { key: dateKey(d), label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') };
  });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function confirmDialog(msg, yes = 'Confirmar', no = 'Cancelar') {
  return new Promise((resolve) => {
    const dlg = $('#confirm'); $('#confirm-msg').textContent = msg;
    $('#confirm-yes').textContent = yes; $('#confirm-no').textContent = no || ''; $('#confirm-no').hidden = !no;
    const done = (v) => { dlg.close(); resolve(v); };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}

/* ---------- Registros ---------- */
const MOTIVATION = [
  'Mais um registro concluído. 💧', 'Bom trabalho! Continue acompanhando sua hidratação.',
  'Você está mantendo sua rotina!', 'Cada registro ajuda você a acompanhar melhor seu dia.'
];
function addWater(amount) {
  amount = Math.round(Number(amount));
  if (!Number.isFinite(amount) || amount < 1 || amount > 5000) return false;
  refresh();
  if (locked) { save(); return true; } // dados de versão futura: não altera nada e explica o motivo
  state.waterRecords.push({ id: newId(), date: dateKey(), time: timeNow(), amount });
  save(); renderAll(); persistOnce();
  toast(`+${fmtAmt(amount)} registrados! 💧`);
  dropAnimation();
  return true;
}
function dropAnimation() {
  const el = document.createElement('div');
  el.className = 'fly'; el.innerHTML = ICON_DROP; el.setAttribute('aria-hidden', 'true');
  el.style.left = `${window.innerWidth / 2 - 16}px`; el.style.top = '30%';
  document.body.appendChild(el); setTimeout(() => el.remove(), 900);
}
async function removeRecord(id) {
  if (!(await confirmDialog('Excluir este registro?'))) return;
  refresh();
  if (locked) return save();
  state.waterRecords = state.waterRecords.filter((r) => r.id !== id);
  save(); renderAll(); if (editingId === id) resetForm();
  toast('Registro excluído.');
}
async function undoLast() {
  refresh();
  if (locked) return save();
  const list = recordsOf(dateKey());
  if (!list.length) return toast('Não há registros hoje para desfazer.');
  const last = list[list.length - 1];
  state.waterRecords = state.waterRecords.filter((r) => r.id !== last.id);
  save(); renderAll(); toast(`Registro de ${fmtAmt(last.amount)} desfeito.`);
}

/* ---------- Renderização ---------- */
const ICON_EDIT = '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';
function recordsHtml(list, editable = false) { // editable: acrescenta o botão de corrigir (usado no Histórico)
  return list.map((r) => {
    const edit = editable ? `<button data-edit="${r.id}" aria-label="Corrigir registro das ${r.time}, ${fmtAmt(r.amount)}">${ICON_EDIT}</button>` : '';
    const del = `<button data-del="${r.id}" aria-label="Excluir registro das ${r.time}, ${fmtAmt(r.amount)}">${ICON_TRASH}</button>`;
    return `<div class="item"><span>${r.time} — ${fmtMl(r.amount)}</span>${editable ? `<span class="acts">${edit}${del}</span>` : del}</div>`;
  }).join('');
}
const emptyHtml = `<div class="empty"><div class="big-emoji" aria-hidden="true">${ICON_DROP}</div><strong>Ainda não há registros hoje.</strong>
  <p class="hint">Registre seu primeiro copo de água para começar a acompanhar seu dia.</p>
  <button class="btn" data-goto="register">Registrar água</button></div>`;

function renderHome() {
  const today = dateKey(), total = totalOf(today), goal = state.user.dailyGoal, pct = pctOf(total);
  const name = state.user.name;
  $('#greeting').textContent = name ? `Olá, ${name}! Cuide da sua hidratação ao longo do dia.` : 'Cuide da sua hidratação ao longo do dia.';
  $('#pct').textContent = `${pct}%`;
  $('#amounts').textContent = `${fmtMl(total)} / ${fmtMl(goal)}`;
  $('#ring-label').setAttribute('aria-label', `Progresso de hoje: ${fmtMl(total)} de ${fmtMl(goal)}, ${pct}% da meta pessoal`);
  $('#ring-fg').style.strokeDashoffset = 326.73 * (1 - Math.min(total / goal, 1));
  const n = recordsOf(today).length;
  $('#motivation').textContent = !n ? 'Registre sua água para acompanhar seu dia.'
    : pct >= 100 ? 'Meta pessoal do dia concluída! Bom trabalho. 💧' : MOTIVATION[n % MOTIVATION.length];
  const list = recordsOf(today);
  $('#today-list').innerHTML = list.length ? recordsHtml(list) : emptyHtml;
  $('#undo-home').hidden = !list.length;
}

function renderHistory() {
  const days = lastDays(7), goal = state.user.dailyGoal;
  const totals = days.map((d) => totalOf(d.key));
  const max = Math.max(goal, ...totals) * 1.1;
  $('#chart').innerHTML = `<div class="plot">${days.map((d, i) => `<div class="bar-col"><div class="bar" style="height:${(totals[i] / max) * 100}%"></div></div>`).join('')}
    <div class="goal-line" style="bottom:${(goal / max) * 100}%"></div></div>
    <div class="labels">${days.map((d, i) => `<div class="lbl"><span class="bar-val">${isCups() ? fromMl(totals[i]).toLocaleString('pt-BR') : totals[i]}</span><span class="bar-day">${esc(d.label)}</span></div>`).join('')}</div>`;
  $('#chart').setAttribute('aria-label', 'Últimos 7 dias: ' + days.map((d, i) => `${d.label} ${fmtMl(totals[i])}`).join(', '));

  const week = totals.reduce((a, b) => a + b, 0);
  const allMax = Math.max(0, ...[...new Set(state.waterRecords.map((r) => r.date))].map(totalOf));
  const hit = totals.filter((t) => t >= goal).length;
  $('#stats').innerHTML = [
    ['Média diária (7 dias)', fmtMl(week / 7)], ['Maior consumo registrado', fmtMl(allMax)],
    ['Meta pessoal atingida', `${hit} de 7 dias`], ['Total da semana', fmtMl(week)]
  ].map(([l, v]) => `<div class="stat"><span>${l}</span><strong>${v}</strong></div>`).join('');

  const pick = $('#date-pick'); if (!pick.value) pick.value = dateKey();
  pick.max = dateKey(); // não é possível registrar datas futuras
  renderDay();
  const keys = [...new Set(state.waterRecords.map((r) => r.date))].sort().reverse().slice(0, 30);
  const label = (k) => k === dateKey() ? 'Hoje' : k === lastDays(2)[0].key ? 'Ontem' : fmtShort(k);
  $('#days-list').innerHTML = keys.length ? keys.map((k) => `<div class="item clickable" data-day="${k}" tabindex="0" role="button">
    <span><strong>${label(k)}</strong> · ${recordsOf(k).length} registro(s)</span><span>${fmtMl(totalOf(k))} · ${pctOf(totalOf(k))}%</span></div>`).join('')
    : '<p class="hint">Seus dias anteriores aparecerão aqui.</p>';
}
function renderDay() {
  const k = $('#date-pick').value || dateKey(), list = recordsOf(k);
  $('#day-detail').innerHTML = `<p><strong>${fmtDate(k)}</strong><br>Total: ${fmtMl(totalOf(k))} (${pctOf(totalOf(k))}% da meta pessoal)</p>`
    + (list.length ? recordsHtml(list, true) : '<p class="hint">Nenhum registro nesta data.</p>');
}

function renderSettings() {
  const { user, settings } = state;
  $('#set-name').value = user.name; $('#set-goal').value = fromMl(user.dailyGoal);
  $('#set-remind').checked = settings.remindersEnabled;
  $('#set-start').value = settings.startTime; $('#set-end').value = settings.endTime; $('#set-interval').value = settings.interval;
  $$('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === currentTheme())));
  notifStatus(); storageStatus(); $('#export-recovery').hidden = !readRecovery().length;
}
function renderAll() {
  renderHome(); renderHistory();
  $('#reg-total').textContent = fmtMl(totalOf(dateKey()));
}

/* ---------- Unidade de medida (ml / copos) ---------- */
/* ---------- Registros de datas anteriores (adicionar e corrigir) ---------- */
let editingId = null;
function recErr(msg) { $('#rec-error').textContent = msg; return false; }
function resetForm() {
  editingId = null; $('#rec-time').value = ''; $('#rec-amount').value = ''; $('#rec-error').textContent = '';
  $('#rec-title').textContent = 'Adicionar registro nesta data'; $('#rec-save').textContent = 'Adicionar registro'; $('#rec-cancel').hidden = true;
}
function startEdit(id, focus = true) {
  const r = state.waterRecords.find((x) => x.id === id); if (!r) return;
  editingId = id; $('#rec-time').value = r.time; $('#rec-amount').value = fromMl(r.amount); $('#rec-error').textContent = '';
  $('#rec-title').textContent = 'Corrigir registro'; $('#rec-save').textContent = 'Salvar alteração'; $('#rec-cancel').hidden = false;
  if (focus) { $('#rec-time').scrollIntoView({ block: 'center' }); $('#rec-time').focus(); }
}
function saveRecord() {
  const k = $('#date-pick').value || dateKey(), time = $('#rec-time').value, ml = Math.round(toMl(Number($('#rec-amount').value)));
  if (!isDate(k) || k > dateKey()) return recErr('Escolha uma data de hoje ou anterior.');
  if (!isTime(time)) return recErr('Informe o horário do registro.');
  if (k === dateKey() && time > timeNow()) return recErr('O horário não pode estar no futuro.');
  if (!(ml >= 1 && ml <= 5000)) return recErr(isCups() ? 'Informe uma quantidade de até 25 copos.' : 'Informe uma quantidade entre 1 e 5.000 ml.');
  refresh();
  if (locked) { save(); return false; }
  const editing = !!editingId;
  if (editing) {
    const r = state.waterRecords.find((x) => x.id === editingId);
    if (!r) { resetForm(); renderAll(); return recErr('Este registro não existe mais (foi excluído em outra aba).'); }
    r.time = time; r.amount = ml;
  } else state.waterRecords.push({ id: newId(), date: k, time, amount: ml });
  save(); resetForm(); renderAll(); toast(editing ? 'Registro atualizado.' : 'Registro adicionado.');
  return true;
}

function renderUnit() {
  const c = isCups();
  $$('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === (c ? 'cups' : 'ml'))));
  $$('[data-add]').forEach((b) => { b.lastChild.textContent = `+ ${fmtMl(Number(b.dataset.add))}`; }); // mantém o ícone 💧
  $('#unit-note').textContent = c ? '1 copo = 200 ml.' : '';
  $('#custom-label').textContent = c ? 'Quantidade em copos' : 'Quantidade em ml';
  $('#ob-goal-label').textContent = c ? 'Quantidade em copos' : 'Quantidade em ml';
  $('#set-goal-label').textContent = c ? 'Meta diária (copos)' : 'Meta diária (ml)';
  Object.assign($('#custom-amount'), c ? { min: 0.5, max: 25, step: 0.5, placeholder: 'Ex.: 1,5', inputMode: 'decimal' }
    : { min: 1, max: 5000, step: 1, placeholder: 'Ex.: 350', inputMode: 'numeric' });
  for (const el of [$('#ob-goal'), $('#set-goal')]) {
    Object.assign(el, c ? { min: 2.5, max: 50, step: 0.5, inputMode: 'decimal' } : { min: 500, max: 10000, step: 50, inputMode: 'numeric' });
  }
  $('#rec-amount-label').textContent = c ? 'Quantidade em copos' : 'Quantidade em ml';
  Object.assign($('#rec-amount'), c ? { min: 0.5, max: 25, step: 0.5, placeholder: 'Ex.: 1,5', inputMode: 'decimal' }
    : { min: 1, max: 5000, step: 1, placeholder: 'Ex.: 250', inputMode: 'numeric' });
  $('#set-goal').value = fromMl(state.user.dailyGoal);
}
function setUnit(u) {
  const ob = $('#ob-goal'), typedMl = ob.value ? toMl(Number(ob.value)) : null; // meta já digitada no primeiro acesso
  state.settings.unit = u === 'cups' ? 'cups' : 'ml'; save();
  renderUnit(); if (typedMl) ob.value = fromMl(typedMl);
  if (editingId) startEdit(editingId, false); else $('#rec-amount').value = '';
  renderAll();
}

/* ---------- Navegação ---------- */
function show(view, focus = true) {
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  $$('.nav [data-view]').forEach((b) => b.toggleAttribute('aria-current', b.dataset.view === view));
  $$('.nav [data-view]').forEach((b) => { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); });
  if (view === 'settings') renderSettings();
  if (view === 'history') renderHistory();
  window.scrollTo(0, 0);
  if (focus) { const h = $(`#view-${view} h1`); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } } // leitores de tela e teclado seguem da nova tela
}
/* Botão voltar: o Início é a raiz; as outras telas ficam um nível acima dele. */
function navigate(view) {
  const cur = history.state?.view || 'home';
  if (view === cur) return show(view);
  if (view === 'home') return history.back();
  if (cur === 'home') history.pushState({ view }, ''); else history.replaceState({ view }, '');
  show(view);
}
window.addEventListener('popstate', (e) => show(e.state?.view || 'home'));

/* ---------- Tema ---------- */
const currentTheme = () => state.settings.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function applyTheme() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').content = t === 'dark' ? '#07131f' : '#1e88e5';
}

/* ---------- Lembretes e notificações ---------- */
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
function reminderSlots() {
  const { startTime, endTime, interval } = state.settings, out = [];
  if (!startTime || !endTime || interval < 1) return out;
  const start = toMin(startTime), span = (toMin(endTime) - start + 1440) % 1440; // fim menor que o início = atravessa a meia-noite
  for (let off = 0; off <= span; off += interval) out.push((start + off) % 1440);
  return out;
}
const REMINDER_TEXTS = ['💧 Hora de beber água!', 'Que tal fazer uma pausa e beber um pouco de água?', 'Lembrete: registre sua água quando beber. 💧'];
async function notify(text) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const opts = { body: 'Toque para abrir o DrinkWater e registrar.', icon: 'icons/icon-192.png', tag: 'drinkwater' };
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg) return reg.showNotification(text, opts);
    } catch { /* usa o fallback abaixo */ }
    try { new Notification(text, opts); return; } catch { /* sem suporte */ }
  }
  toast(text); // fallback dentro do app
}
async function askPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}
function notifStatus() {
  const el = $('#notif-status');
  if (!('Notification' in window)) el.textContent = 'Este navegador não oferece notificações. Os lembretes aparecerão como avisos dentro do app.';
  else if (Notification.permission === 'denied') el.textContent = 'As notificações estão bloqueadas neste navegador. Você pode liberá-las nas configurações do site.';
  else if (!state.settings.remindersEnabled) el.textContent = 'Lembretes desativados.';
  else el.textContent = 'Os lembretes são exibidos enquanto o app estiver aberto ou em segundo plano. Dependendo do navegador e do dispositivo, podem não chegar com o app totalmente fechado.';
}
let lastFired = 0, lastTickAt = 0;
function reminderTick() {
  checkDay();
  const now = Date.now(), prev = lastTickAt; lastTickAt = now;
  if (!state.settings.remindersEnabled || totalOf(dateKey()) >= state.user.dailyGoal) return; // meta cumprida: sem lembretes
  const slots = new Set(reminderSlots()), end = Math.floor(now / 60000);
  const from = prev && now - prev <= 5 * 60000 ? Math.floor(prev / 60000) + 1 : end; // cobre minutos pulados quando o navegador reduz a frequência dos timers
  for (let t = end; t >= from && t > lastFired; t--) {
    const d = new Date(t * 60000);
    if (slots.has(d.getHours() * 60 + d.getMinutes())) { lastFired = t; notify(REMINDER_TEXTS[Math.floor(Math.random() * REMINDER_TEXTS.length)]); break; }
  }
}

/* ---------- Virada do dia ---------- */
let shownDay = dateKey();
function checkDay() {
  const today = dateKey(); if (today === shownDay) return;
  const pick = $('#date-pick'); if (pick.value === shownDay) pick.value = today;
  shownDay = today; renderAll();
}
function scheduleMidnight() {
  const n = new Date(), next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
  setTimeout(() => { checkDay(); scheduleMidnight(); }, next - n);
}

/* ---------- Exportação e exclusão ---------- */
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCsv() {
  if (!state.waterRecords.length) return toast('Ainda não há registros para exportar.');
  const rows = [...state.waterRecords].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map((r) => `${fmtDate(r.date)},${r.time},${r.amount}`);
  download('drinkwater-registros.csv', '\uFEFF' + ['Data,Horário,Quantidade (ml)', ...rows].join('\n'), 'text/csv;charset=utf-8');
}
function exportJson() {
  download('drinkwater-dados.json', JSON.stringify({ app: 'DrinkWater', version: DATA_VERSION, exportedAt: new Date().toISOString(), user: state.user, settings: state.settings, waterRecords: state.waterRecords }, null, 2), 'application/json');
}
async function importBackup(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('Arquivo grande demais para ser um backup do DrinkWater.');
  let parsed; try { parsed = JSON.parse(await file.text()); } catch { return toast('Arquivo inválido: não é um JSON legível. Seus dados não foram alterados.'); }
  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  if (obj && Number(parsed.version) > DATA_VERSION) return toast('Este backup é de uma versão mais nova do DrinkWater. Atualize o app e tente de novo.');
  const v = validate(obj ? migrate(parsed) : parsed, true);
  if (!v.ok) return toast('Arquivo inválido: não parece um backup do DrinkWater. Seus dados não foram alterados.');
  if (!v.data.waterRecords.length && v.discarded) return toast('Nenhum registro válido neste arquivo. Seus dados não foram alterados.');
  refresh();
  const n = v.data.waterRecords.length;
  if (!(await confirmDialog(`Importar ${n} registro(s)${v.discarded ? `, ignorando ${v.discarded} inválido(s)` : ''}? Isso substitui os ${state.waterRecords.length} registro(s) atuais. Uma cópia dos dados atuais fica guardada para recuperação.`, 'Importar'))) return;
  keepRecovery(JSON.stringify(state), 'antes de importar backup');
  state = { ...v.data, onboarded: true };
  if (!save()) return;
  $('#onboarding').hidden = true; applyTheme(); renderUnit(); renderAll(); renderSettings(); toast('Backup importado.');
}
function downloadRecovery() { download('drinkwater-recuperacao.json', JSON.stringify(readRecovery(), null, 2), 'application/json'); }
async function wipeAll() {
  if (!(await confirmDialog('Tem certeza que deseja apagar todos os seus registros? Essa ação não poderá ser desfeita.'))) return;
  [KEY, RECOVERY_KEY, PREMIG_KEY].forEach((k) => localStorage.removeItem(k)); state = load(); renderUnit(); $('#ob-goal').value = fromMl(state.user.dailyGoal); applyTheme(); renderAll(); renderSettings(); startOnboarding();
}

/* ---------- Primeiro acesso ---------- */
let step = 0;
function showStep(n) {
  step = n;
  $$('#onboarding [data-step]').forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
  $('#ob-back').hidden = n === 0 || n === 4;
  $('#ob-next').textContent = n === 0 ? 'Continuar' : n === 4 ? 'Começar' : n === 3 ? 'Pular' : 'Continuar';
  $('#ob-next').hidden = false;
  $('#onboarding [data-step]:not([hidden]) input')?.focus();
}
function startOnboarding() { $('#onboarding').hidden = false; showStep(0); }
function nextStep() {
  if (step === 1) state.user.name = $('#ob-name').value.trim();
  if (step === 2) {
    const g = toMl(Number($('#ob-goal').value));
    if (!(g >= 500 && g <= 10000)) return toast(goalError());
    state.user.dailyGoal = Math.round(g);
  }
  if (step === 4) { refresh(); state.onboarded = true; save(); persistOnce(); $('#onboarding').hidden = true; renderAll(); show('home'); return; }
  showStep(step + 1);
}

/* ---------- Instalação (PWA) ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#install').hidden = false; });
window.addEventListener('appinstalled', () => { $('#install').hidden = true; toast('DrinkWater instalado! 💧'); });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

/* ---------- Eventos ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-day]'); if (!t) return;
  if (t.dataset.view) navigate(t.dataset.view);
  else if (t.dataset.goto) navigate(t.dataset.goto);
  else if (t.dataset.add) addWater(t.dataset.add);
  else if (t.dataset.del) removeRecord(t.dataset.del);
  else if (t.dataset.day) { resetForm(); $('#date-pick').value = t.dataset.day; renderDay(); $('#date-pick').scrollIntoView({ block: 'center' }); }
  else if (t.dataset.edit) startEdit(t.dataset.edit);
  else if (t.dataset.unit) setUnit(t.dataset.unit);
  else if (t.dataset.theme) { state.settings.theme = t.dataset.theme; save(); applyTheme(); renderSettings(); }
  else if (t.dataset.remind) {
    const yes = t.dataset.remind === 'yes';
    state.settings.remindersEnabled = yes; $('#ob-remind-msg').textContent = '';
    if (yes) {
      const p = await askPermission();
      if (p === 'granted') $('#ob-remind-msg').textContent = 'Lembretes ativados! 💧';
      else $('#ob-remind-msg').textContent = 'Sem permissão de notificação, os lembretes aparecerão apenas dentro do app. Você pode mudar isso depois em Configurações.';
    } else $('#ob-remind-msg').textContent = 'Tudo bem, você pode ativar depois em Configurações.';
    save(); showStep(4);
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-day]')) { e.preventDefault(); e.target.click(); }
});
$('#ob-next').onclick = nextStep;
$('#ob-back').onclick = () => showStep(Math.max(0, step - 1));
$('#undo-home').onclick = undoLast;
$('#undo-reg').onclick = undoLast;
$('#add-custom').onclick = () => {
  const v = $('#custom-amount').value, err = $('#custom-error');
  if (addWater(toMl(Number(v)))) { err.textContent = ''; $('#custom-amount').value = ''; }
  else err.textContent = isCups() ? 'Informe uma quantidade de até 25 copos.' : 'Informe uma quantidade entre 1 e 5.000 ml.';
};
$('#custom-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#add-custom').click(); });
$('#date-pick').onchange = () => { resetForm(); renderDay(); };
$('#rec-save').onclick = saveRecord;
$('#rec-cancel').onclick = resetForm;
$('#rec-amount').onkeydown = (e) => { if (e.key === 'Enter') saveRecord(); };
$('#set-name').onchange = (e) => { state.user.name = e.target.value.trim(); save(); renderHome(); toast('Nome salvo.'); };
$('#set-goal').onchange = (e) => {
  const g = toMl(Number(e.target.value));
  if (!(g >= 500 && g <= 10000)) { e.target.value = fromMl(state.user.dailyGoal); return toast(goalError()); }
  state.user.dailyGoal = Math.round(g); save(); renderAll(); toast('Meta pessoal salva.');
};
$('#set-remind').onchange = async (e) => {
  state.settings.remindersEnabled = e.target.checked; save();
  if (e.target.checked) await askPermission();
  notifStatus();
};
[['#set-start', 'startTime'], ['#set-end', 'endTime']].forEach(([sel, k]) => {
  $(sel).onchange = (e) => { if (e.target.value) { state.settings[k] = e.target.value; save(); toast('Horário salvo.'); } };
});
$('#set-interval').onchange = (e) => {
  const v = Math.round(Number(e.target.value));
  if (!(v >= 15 && v <= 480)) { e.target.value = state.settings.interval; return toast('Use um intervalo entre 15 e 480 minutos.'); }
  state.settings.interval = v; save(); toast('Intervalo salvo.');
};
$('#test-notif').onclick = async () => { await askPermission(); notifStatus(); notify('💧 Hora de beber água!'); };
$('#export-csv').onclick = exportCsv;
$('#export-json').onclick = exportJson;
$('#wipe').onclick = wipeAll;
$('#import-json').onclick = () => $('#import-file').click();
$('#import-file').onchange = async (e) => { await importBackup(e.target.files[0]); e.target.value = ''; };
$('#export-recovery').onclick = downloadRecovery;
$('#install').onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#install').hidden = true;
};

/* ---------- Inicialização ---------- */
applyTheme();
renderAll();
renderUnit();
$('#ob-goal').value = fromMl(state.user.dailyGoal);
$('#install-info').textContent = isStandalone() ? 'O DrinkWater já está instalado neste dispositivo.'
  : 'Para instalar: use "Instalar aplicativo" quando disponível, ou o menu do navegador (no iPhone: Compartilhar > Adicionar à Tela de Início).';
if (!state.onboarded) startOnboarding();
setInterval(reminderTick, 20000);
scheduleMidnight();
['visibilitychange', 'pageshow', 'focus'].forEach((ev) => addEventListener(ev, () => { if (!document.hidden) checkDay(); }));
history.replaceState({ view: 'home' }, '');
addEventListener('storage', (e) => { // outra aba ou janela salvou: atualiza esta sem perder nada
  if (e.key !== null && e.key !== KEY) return;
  state = load(); applyTheme(); renderUnit(); renderAll(); if (!$('#view-settings').hidden) renderSettings();
});
if (loadIssue) {
  const msgs = {
    corrupt: 'Não foi possível ler os dados salvos neste navegador. Uma cópia do conteúdo original foi guardada para recuperação e o app abriu vazio. Depois da configuração inicial, use "Importar backup" em Ajustes, se tiver um backup.',
    newer: 'Os dados salvos são de uma versão mais nova do DrinkWater. Para não danificá-los, o app não vai salvar nada até ser atualizado.',
    discarded: `${loadIssue.n} registro(s) inválido(s) foram ignorados. Uma cópia dos dados originais foi guardada em Ajustes, em "Baixar cópia de recuperação".`,
    unavailable: 'Este navegador não permite salvar dados (modo privado ou armazenamento bloqueado). Os registros serão perdidos ao fechar o app.'
  };
  confirmDialog(msgs[loadIssue.type], 'Entendi', null);
}
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) toast('Nova versão instalada. Feche e abra o app para usá-la.'); });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && reg) reg.update().catch(() => {}); });
  }).catch(() => {}));
}
