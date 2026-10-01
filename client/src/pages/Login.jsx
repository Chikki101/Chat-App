import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import hero from '../assets/hero.svg';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-hero">
        <img src={hero} alt="Chat bubbles showing positive, neutral and negative sentiment" />
        <h1>MoodChat</h1>
        <p>
          Real-time chat that reads the room. Every message is analyzed for sentiment the moment it
          is sent.
        </p>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="tabs">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              Log in
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
              Sign up
            </button>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          <button className="btn-primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </section>
    </div>
  );
}
