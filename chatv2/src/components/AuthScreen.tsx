import { useState, FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data.user) {
          const name = displayName.trim() || email.split('@')[0];
          await supabase.from('profiles').upsert({
            id: data.user.id,
            display_name: name,
            avatar_seed: Math.random().toString(36).slice(2, 8),
          });
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">Block<span>Chat</span></div>
        <div className="auth-title">{mode === 'signin' ? 'Welcome back' : 'Create an account'}</div>
        <div className="auth-sub">
          {mode === 'signin' ? 'Sign in to continue.' : 'Join the conversation.'}
        </div>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <div className="field">
              <label>Display name</label>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <span className="spinner" /> : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="auth-switch">
          {mode === 'signin' ? (
            <>Don't have an account?{' '}<button type="button" onClick={() => { setMode('signup'); setError(''); }}>Sign up</button></>
          ) : (
            <>Already have an account?{' '}<button type="button" onClick={() => { setMode('signin'); setError(''); }}>Sign in</button></>
          )}
        </div>
      </div>
    </div>
  );
}
