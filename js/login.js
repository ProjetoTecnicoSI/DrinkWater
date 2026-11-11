/* DrinkWater: página de login (e-mail, senha com mostrar/ocultar, recuperar senha e criar conta).
   Usa as funções de conta de js/sync.js. O login é opcional: "Continuar sem conta" mantém o app como sempre foi. */
const LOGIN_SKIP_KEY = KEY + ':login-dispensado';
(window.dwWipeHooks ||= []).push(() => { try { localStorage.removeItem(LOGIN_SKIP_KEY); } catch { /* ok */ } });

const ICON_EYE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.7A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const LG = {
  entrar:    { title: 'Entrar', sub: 'Acesse sua conta para guardar e sincronizar seus registros de água.', submit: 'Entrar', passLabel: 'Senha', hint: 'Ainda não tem conta?', link: 'Criar conta', to: 'criar' },
  criar:     { title: 'Criar conta', sub: 'Leva menos de um minuto. Você receberá um e-mail para confirmar.', submit: 'Criar conta', passLabel: 'Senha (mínimo de 8 caracteres)', hint: 'Já tem conta?', link: 'Entrar', to: 'entrar' },
  recuperar: { title: 'Recuperar senha', sub: 'Informe seu e-mail e enviaremos um link para criar uma nova senha.', submit: 'Enviar link', hint: '', link: 'Voltar para entrar', to: 'entrar' },
  'nova-senha': { title: 'Criar nova senha', sub: 'Escolha uma nova senha para a sua conta.', submit: 'Salvar nova senha', passLabel: 'Nova senha (mínimo de 8 caracteres)', hint: '', link: '', to: '' }
};
let lgMode = 'entrar', lgFromSettings = false;

function lgMsg(text, error = true) { const m = $('#lg-msg'); m.textContent = text; m.className = 'lg-msg ' + (error ? 'error' : 'hint'); }
function lgShowPass(on) {
  for (const id of ['#lg-pass', '#lg-pass2']) $(id).type = on ? 'text' : 'password';
  const b = $('#lg-eye'); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Ocultar senha' : 'Mostrar senha'); b.innerHTML = on ? ICON_EYE_OFF : ICON_EYE;
}
function lgSetMode(mode) {
  lgMode = mode; const m = LG[mode];
  $('#lg-title').textContent = m.title; $('#lg-sub').textContent = m.sub; $('#lg-submit').textContent = m.submit;
  $('#lg-mail-wrap').hidden = mode === 'nova-senha'; $('#lg-pass-wrap').hidden = mode === 'recuperar'; $('#lg-pass2-wrap').hidden = mode !== 'nova-senha';
  $('#lg-pass-label').textContent = m.passLabel || 'Senha'; $('#lg-pass').autocomplete = mode === 'entrar' ? 'current-password' : 'new-password';
  $('#lg-forgot').hidden = mode !== 'entrar';
  $('#lg-switch-row').hidden = !m.to; $('#lg-switch-hint').textContent = m.hint; $('#lg-switch').textContent = m.link;
  $('#lg-skip').textContent = mode === 'nova-senha' ? 'Agora não' : lgFromSettings ? 'Voltar' : 'Continuar sem conta';
  $('#lg-pass').value = ''; $('#lg-pass2').value = ''; lgMsg(''); lgShowPass(false);
}
function lgInert(on) { for (const el of [$('.app'), $('#onboarding')]) if (el) el.inert = on; }
function openLogin(mode = 'entrar', fromSettings = false) {
  lgFromSettings = fromSettings; $('#login').hidden = false; lgInert(true); lgSetMode(mode);
  setTimeout(() => $(mode === 'nova-senha' ? '#lg-pass' : '#lg-mail').focus(), 50);
}
function closeLogin() { $('#login').hidden = true; lgInert(false); }
window.dwOpenLogin = openLogin;

async function lgSubmit() {
  const mail = $('#lg-mail').value.trim(), pass = $('#lg-pass').value, pass2 = $('#lg-pass2').value;
  if (lgMode !== 'nova-senha' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return lgMsg('Informe um e-mail válido.');
  if (lgMode === 'entrar' && !pass) return lgMsg('Informe sua senha.');
  if ((lgMode === 'criar' || lgMode === 'nova-senha') && pass.length < 8) return lgMsg('A senha precisa ter pelo menos 8 caracteres.');
  if (lgMode === 'nova-senha' && pass !== pass2) return lgMsg('As senhas não conferem.');
  const btn = $('#lg-submit'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Aguarde…'; lgMsg('');
  try {
    if (lgMode === 'entrar') { await signIn(mail, pass); finish('Conectado. Sincronizando seus registros…'); }
    else if (lgMode === 'criar') {
      if ((await signUp(mail, pass)) === 'in') finish('Conta criada. Sincronizando…');
      else lgMsg('Se este e-mail ainda não tem conta, enviamos uma confirmação para ele. Abra o link e depois volte para entrar.', false);
    } else if (lgMode === 'recuperar') {
      await recoverPassword(mail);
      lgMsg('Se existir uma conta com este e-mail, enviamos um link para criar uma nova senha. Confira também o spam.', false);
    } else { await setPassword(pass); finish('Senha alterada com sucesso.'); }
  } catch (e) { lgMsg(friendly(e)); }
  finally { btn.disabled = false; btn.textContent = label; }
}
function finish(msg) { closeLogin(); window.dwAfterLogin(msg); }

$('#lg-submit').onclick = lgSubmit;
for (const id of ['#lg-mail', '#lg-pass', '#lg-pass2']) $(id).onkeydown = (e) => { if (e.key === 'Enter') lgSubmit(); };
$('#lg-eye').onclick = () => lgShowPass($('#lg-eye').getAttribute('aria-pressed') !== 'true');
$('#lg-forgot').onclick = () => lgSetMode('recuperar');
$('#lg-switch').onclick = () => lgSetMode(LG[lgMode].to);
$('#lg-skip').onclick = () => {
  if (!lgFromSettings && lgMode !== 'nova-senha') { try { localStorage.setItem(LOGIN_SKIP_KEY, '1'); } catch { /* ok */ } }
  closeLogin();
};
$('#login').onkeydown = (e) => { if (e.key === 'Escape' && (lgFromSettings || lgMode === 'nova-senha')) $('#lg-skip').click(); };

window.dwAuthReady.then((type) => {
  if (type === 'recovery') openLogin('nova-senha');
  else if (!session && !localStorage.getItem(LOGIN_SKIP_KEY)) openLogin('entrar');
});
