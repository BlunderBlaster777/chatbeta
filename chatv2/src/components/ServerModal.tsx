import { useState, FormEvent } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Tab = 'create' | 'join';

interface Props {
  onClose: () => void;
  onDone: () => void;
}

export default function ServerModal({ onClose, onDone }: Props) {
  const [tab, setTab] = useState<Tab>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    setLoading(true);
    try {
      const { error: err } = await supabase.rpc('create_server_with_defaults', { server_name: name.trim() });
      if (err) throw err;
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create server');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setError('');
    setLoading(true);
    try {
      const { error: err } = await supabase.rpc('join_server_by_code', { invite: code.trim().toUpperCase() });
      if (err) throw err;
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid invite code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title modal-title-inline">
            {tab === 'create' ? 'Create a server' : 'Join a server'}
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-tabs">
          <button type="button" className={`modal-tab${tab === 'create' ? ' active' : ''}`} onClick={() => setTab('create')}>Create</button>
          <button type="button" className={`modal-tab${tab === 'join' ? ' active' : ''}`} onClick={() => setTab('join')}>Join</button>
        </div>
        {error && <div className="auth-error">{error}</div>}
        {tab === 'create' ? (
          <form onSubmit={handleCreate}>
            <div className="field">
              <label>Server name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="My server" autoFocus required />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-confirm" disabled={loading || !name.trim()}>
                {loading ? <span className="spinner" /> : 'Create'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleJoin}>
            <div className="field">
              <label>Invite code</label>
              <input className="invite-code-input" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXXXX" autoFocus required />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-confirm" disabled={loading || !code.trim()}>
                {loading ? <span className="spinner" /> : 'Join'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
