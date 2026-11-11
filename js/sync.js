/* DrinkWater: conta e sincronização opcionais (Supabase). Sem biblioteca: apenas fetch.
   A chave abaixo é a chave PÚBLICA (publishable). A proteção dos dados está nas regras (RLS) do banco.
   Nunca coloque aqui a chave secret nem a service_role. */
const SUPABASE_URL = 'https://bjnsddmslfvacukajckn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XA9H6AwnzV0BwhkamrbaIA_yjTL1E7y';
const SESSION_KEY = KEY + ':sessao', SYNCMETA_KEY = KEY + ':sync';

const readJson = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
let session = readJson(SESSION_KEY), syncing = false, syncTimer = null, syncStatus = '', selfSave = false, again = false;
function writeSession(s) { session = s; try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* sem espaço */ } }

/* ---------- Acesso à API ---------- */
async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }
  });
  const text = await res.text(); let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const e = new Error(data?.msg || data?.message || data?.error_description || `Erro ${res.status}`);
    e.status = res.status; e.code = data?.error_code || data?.code || ''; throw e;
  }
  return data;
}
function friendly(e) {
  if (e instanceof TypeError || !navigator.onLine) return 'Sem conexão com a internet. Sincronizo quando ela voltar.';
  const c = e.code;
  if (c === 'invalid_credentials') return 'E-mail ou senha incorretos.';
  if (c === 'email_not_confirmed') return 'Confirme seu e-mail antes de entrar (veja a caixa de entrada e o spam).';
  if (e.status === 429 || c === 'over_email_send_rate_limit') return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  if (c === 'weak_password') return 'Senha fraca. Use pelo menos 8 caracteres.';
  if (c === 'same_password') return 'A nova senha precisa ser diferente da atual.';
  if (c === 'user_already_exists') return 'Este e-mail já tem conta. Use "Entrar".';
  if (e.status === 404 || c === 'PGRST205') return 'As tabelas do banco não foram encontradas. Rode o script SQL no Supabase.';
  if (e.status === 401 || e.status === 403) return 'Sem permissão para acessar os dados. Entre novamente.';
  return 'Não foi possível concluir: ' + e.message;
}

/* ---------- Sessão ---------- */
const sessionFrom = (d) => ({
  access_token: d.access_token, refresh_token: d.refresh_token,
  expires_at: d.expires_at ? d.expires_at * 1000 : Date.now() + (d.expires_in || 3600) * 1000,
  user: { id: d.user.id, email: d.user.email }
});
async function refreshSession() {
  const d = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
  writeSession(sessionFrom(d));
}
async function token() {
  if (!session) throw Object.assign(new Error('Sem sessão'), { status: 401 });
  if (session.expires_at - Date.now() < 60000) await refreshSession();
  return session.access_token;
}
async function rest(path, opts = {}) { // chamada autenticada; renova a sessão uma vez se o servidor recusar
  try { return await api(path, { ...opts, token: await token() }); }
  catch (e) { if (e.status !== 401) throw e; await refreshSession(); return api(path, { ...opts, token: session.access_token }); }
}
async function signUp(email, password) {
  const back = location.origin + location.pathname.replace(/index\.html$/, '');
  const d = await api('/auth/v1/signup?redirect_to=' + encodeURIComponent(back), { method: 'POST', body: { email, password } });
  if (d?.access_token) { writeSession(sessionFrom(d)); return 'in'; }
  return 'confirm';
}
async function signIn(email, password) { writeSession(sessionFrom(await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }))); }
async function recoverPassword(email) {
  const back = location.origin + location.pathname.replace(/index\.html$/, '');
  await api('/auth/v1/recover?redirect_to=' + encodeURIComponent(back), { method: 'POST', body: { email } });
}
async function setPassword(password) { await rest('/auth/v1/user', { method: 'PUT', body: { password } }); }
async function signOut() {
  try { if (session) await api('/auth/v1/logout', { method: 'POST', token: session.access_token }); } catch { /* sair localmente mesmo assim */ }
  writeSession(null); try { localStorage.removeItem(SYNCMETA_KEY); } catch { /* ok */ }
}
(window.dwWipeHooks ||= []).push(() => { writeSession(null); try { localStorage.removeItem(SYNCMETA_KEY); } catch { /* ok */ } renderAccount(); });

/* ---------- Combinação dos dados (a alteração mais recente vence) ---------- */
function mergeRemote(remote, prof, first) {
  const ts = (v) => Date.parse(v) || 0, byId = new Map(remote.map((r) => [r.id, r]));
  const live = new Map(state.waterRecords.map((r) => [r.id, r])), gone = new Map(state.removed.map((r) => [r.id, r]));
  for (const r of remote) {
    const rt = ts(r.atualizado_em), l = live.get(r.id), g = gone.get(r.id);
    if (r.excluido) { if (l && l.updatedAt <= rt) live.delete(r.id); }
    else if (g && g.updatedAt >= rt) { /* apagado aqui depois da versão da nuvem: a exclusão será enviada */ }
    else {
      if (g) gone.delete(r.id);
      if (!l) live.set(r.id, { id: r.id, date: r.data, time: r.hora, amount: r.quantidade_ml, updatedAt: rt });
      else if (rt > l.updatedAt) Object.assign(l, { date: r.data, time: r.hora, amount: r.quantidade_ml, updatedAt: rt });
    }
  }
  const rows = [], pushedGone = [], uid = session.user.id;
  const rowOf = (r, excluido) => ({ user_id: uid, id: r.id, data: r.date, hora: r.time, quantidade_ml: r.amount, excluido, atualizado_em: new Date(r.updatedAt).toISOString() });
  for (const [id, l] of live) { const r = byId.get(id); if (!r || l.updatedAt > ts(r.atualizado_em)) rows.push(rowOf(l, false)); }
  for (const [id, g] of gone) { const r = byId.get(id); if (r && !r.excluido && g.updatedAt >= ts(r.atualizado_em)) { rows.push(rowOf(g, true)); pushedGone.push(g); } }
  state.waterRecords = [...live.values()]; state.removed = pushedGone;
  let pushProfile = false;
  if (prof) {
    const pt = ts(prof.atualizado_em);
    if (first || pt > state.profileAt) { // primeiro acesso a esta conta neste aparelho: vale o perfil da nuvem
      const cfg = prof.configuracoes || {};
      state.user.name = typeof prof.nome === 'string' ? prof.nome.slice(0, 30) : state.user.name;
      if (Number.isInteger(prof.meta_ml) && prof.meta_ml >= 500 && prof.meta_ml <= 10000) state.user.dailyGoal = prof.meta_ml;
      if (cfg.unit === 'cups' || cfg.unit === 'ml') state.settings.unit = cfg.unit;
      if (cfg.theme === 'light' || cfg.theme === 'dark') state.settings.theme = cfg.theme;
      state.profileSig = profileSig(); state.profileAt = pt;
    } else if (state.profileAt > pt) pushProfile = true;
  } else if (state.onboarded) pushProfile = true;
  return { rows, pushedGone, pushProfile };
}

/* ---------- Sincronização ---------- */
async function runSync() {
  if (!session || syncing) return;
  if (!navigator.onLine) return setStatus('Sem conexão. Sincronizo quando a internet voltar.');
  syncing = true; setStatus('Sincronizando…');
  try {
    const uid = session.user.id, meta = readJson(SYNCMETA_KEY) || {}, first = meta.userId !== uid || !meta.done, remote = [];
    for (let off = 0; ; off += 1000) {
      const page = await rest(`/rest/v1/registros?select=id,data,hora,quantidade_ml,excluido,atualizado_em&order=id.asc&limit=1000&offset=${off}`);
      remote.push(...page); if (page.length < 1000) break;
    }
    const prof = (await rest('/rest/v1/perfis?select=nome,meta_ml,configuracoes,atualizado_em'))[0] || null;
    refresh();                                    // parte do estado mais recente salvo (outras abas)
    const { rows, pushedGone, pushProfile } = mergeRemote(remote, prof, first);
    selfSave = true; save(); selfSave = false; applyTheme(); renderUnit(); renderAll();
    const up = { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } };
    for (let i = 0; i < rows.length; i += 500) await rest('/rest/v1/registros?on_conflict=user_id,id', { ...up, body: rows.slice(i, i + 500) });
    if (pushProfile) await rest('/rest/v1/perfis?on_conflict=user_id', { ...up, body: { user_id: uid, nome: state.user.name, meta_ml: state.user.dailyGoal, configuracoes: { unit: state.settings.unit, theme: state.settings.theme }, atualizado_em: new Date(state.profileAt).toISOString() } });
    refresh(); const sent = new Set(pushedGone.map((g) => `${g.id}:${g.updatedAt}`));
    state.removed = state.removed.filter((g) => !sent.has(`${g.id}:${g.updatedAt}`));
    selfSave = true; save(); selfSave = false;
    localStorage.setItem(SYNCMETA_KEY, JSON.stringify({ userId: uid, done: true, lastAt: Date.now() }));
    syncStatus = '';
  } catch (e) {
    selfSave = false;
    if (e.status === 400 || e.status === 401) { writeSession(null); syncStatus = 'Sessão expirada. Entre novamente.'; }
    else syncStatus = friendly(e);
  } finally { syncing = false; renderAccount(); if (again) { again = false; window.scheduleSync(); } }
}
window.scheduleSync = () => { // chamado a cada salvamento local
  if (!session || selfSave) return;
  if (syncing) { again = true; return; }
  clearTimeout(syncTimer); syncTimer = setTimeout(runSync, 3000);
};

/* ---------- Conta (cartão em Ajustes; a página de login fica em js/login.js) ---------- */
function setStatus(t) { syncStatus = t; renderAccount(); }
function renderAccount() {
  $('#acc-out').hidden = !!session; $('#acc-in').hidden = !session;
  if (!session) return;
  const m = readJson(SYNCMETA_KEY);
  $('#acc-email').textContent = session.user.email;
  $('#acc-last').textContent = syncStatus || (m?.lastAt ? 'Última sincronização: ' + new Date(m.lastAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Ainda não sincronizado.');
}
window.dwAfterLogin = (msg = 'Conectado. Sincronizando seus registros…') => { renderAccount(); toast(msg); runSync(); };
$('#acc-open').onclick = () => window.dwOpenLogin && window.dwOpenLogin('entrar', true);
$('#acc-sync').onclick = () => runSync();
$('#acc-signout').onclick = async () => {
  if (!(await confirmDialog('Sair da conta? Seus registros continuam neste aparelho.', 'Sair'))) return;
  await signOut(); renderAccount(); toast('Você saiu da conta.');
};
$('#acc-delete').onclick = async () => {
  if (!(await confirmDialog('Excluir seus dados da nuvem? Os registros deste aparelho NÃO serão apagados, e você será desconectado.', 'Excluir'))) return;
  try {
    const uid = session.user.id;
    await rest(`/rest/v1/registros?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await rest(`/rest/v1/perfis?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await signOut(); renderAccount(); toast('Dados da nuvem excluídos. Você saiu da conta.');
  } catch (e) { syncStatus = e.status === 403 || e.code === '42501' ? 'Sem permissão para excluir. Rode o SQL de exclusão no Supabase.' : friendly(e); renderAccount(); }
};

/* ---------- Links enviados por e-mail (confirmação de conta e recuperação de senha) ---------- */
async function consumeAuthHash() {
  if (!/access_token=|error_description=/.test(location.hash)) return null;
  const p = new URLSearchParams(location.hash.slice(1)), type = p.get('type');
  history.replaceState(history.state, '', location.pathname + location.search); // limpa o endereço (os tokens não ficam visíveis)
  if (p.get('error_description')) { toast('Link inválido ou expirado. Peça um novo e-mail.'); return 'error'; }
  try {
    const user = await api('/auth/v1/user', { token: p.get('access_token') });
    writeSession(sessionFrom({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in')) || 3600, user }));
    if (type !== 'recovery') toast('E-mail confirmado. Você está conectado.');
    return type === 'recovery' ? 'recovery' : 'signup';
  } catch (e) { toast(friendly(e)); return 'error'; }
}

window.addEventListener('online', () => runSync());
document.addEventListener('visibilitychange', () => { if (!document.hidden && session && Date.now() - (readJson(SYNCMETA_KEY)?.lastAt || 0) > 60000) runSync(); });
window.dwAuthReady = consumeAuthHash();
window.dwAuthReady.then(() => { renderAccount(); if (session) setTimeout(runSync, 800); });
