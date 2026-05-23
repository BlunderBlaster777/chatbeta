import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import type { ServerSummary } from '../lib/types';

interface Props {
  server: ServerSummary;
  onClose: () => void;
}

export default function ServerSettingsModal({ server, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  function copyCode() {
    navigator.clipboard.writeText(server.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title modal-title-inline">{server.name}</div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="field">
          <label>Invite code</label>
          <p className="settings-hint">Share this code so others can join with &ldquo;Join a server&rdquo;.</p>
          <div className="invite-box">
            <span className="invite-box-code">{server.invite_code}</span>
            <button type="button" className="invite-copy-btn" onClick={copyCode} title="Copy">
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
