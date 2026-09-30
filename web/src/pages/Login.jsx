import { useState } from 'react';
import { post } from '../api.js';
import { useAuth } from '../App.jsx';
import { setAgentPass } from '../session.js';
import { Footer, Logo } from '../components/Brand.jsx';
import { LangSwitch } from '../components/LangSwitch.jsx';
import { useT } from '../i18n.js';

export default function Login() {
  const t = useT();
  const { setUser } = useAuth();
  const [form, setForm] = useState({ user: '', pass: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await post('/auth/login', form);
      setAgentPass(form.pass);
      setUser(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <Logo height={52} />
        </div>
        <p className="muted">{t('Entra con tu usuario y contraseña de Vicidial.')}</p>
        <label className="field">
          <span>{t('Usuario')}</span>
          <input autoFocus autoComplete="username" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('Contraseña')}</span>
          <input type="password" autoComplete="current-password" value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t('Entrando…') : t('Entrar')}</button>
      </form>
      <LangSwitch className="login-lang" />
      <Footer className="footer-login" />
    </div>
  );
}
