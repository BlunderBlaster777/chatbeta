import { useEffect, useRef, useState, FormEvent, useCallback } from 'react';
import { Send, Paperclip, Hash } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ChatMessage, Profile } from '../lib/types';
import { shortTime, initials, profileName } from '../lib/helpers';

interface Props {
  channelId: string;
  channelName: string;
  currentUserId: string;
  profiles: Record<string, Profile>;
  onProfileNeeded: (userId: string) => void;
}

const AVATAR_COLORS = [
  '#5865f2','#3ba55c','#faa61a','#ed4245','#eb459e','#57f287',
];

function avatarColor(userId: string) {
  let n = 0;
  for (let i = 0; i < userId.length; i++) n += userId.charCodeAt(i);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

function Avatar({ userId, profile }: { userId: string; profile: Profile | undefined }) {
  const name = profileName(profile);
  return (
    <div className="msg-avatar" style={{ background: avatarColor(userId) }}>
      {initials(name) || '?'}
    </div>
  );
}

function isSameAuthorAndClose(a: ChatMessage, b: ChatMessage) {
  return a.author_id === b.author_id &&
    Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < 5 * 60 * 1000;
}

export default function MessagePane({ channelId, channelName, currentUserId, profiles, onProfileNeeded }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    supabase
      .from('messages')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        const msgs = (data ?? []) as ChatMessage[];
        setMessages(msgs);
        setLoading(false);
        msgs.forEach(m => { if (!profiles[m.author_id]) onProfileNeeded(m.author_id); });
      });

    const sub = supabase
      .channel(`messages:${channelId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`,
      }, payload => {
        const msg = payload.new as ChatMessage;
        setMessages(prev => [...prev, msg]);
        if (!profiles[msg.author_id]) onProfileNeeded(msg.author_id);
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setBody('');
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
    await supabase.from('messages').insert({ channel_id: channelId, author_id: currentUserId, body: text, attachment_url: null });
    setSending(false);
    textareaRef.current?.focus();
  }

  async function uploadFile(file: File) {
    const ext = file.name.split('.').pop();
    const path = `${currentUserId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('chat-uploads').upload(path, file);
    if (error) return;
    const { data } = supabase.storage.from('chat-uploads').getPublicUrl(path);
    await supabase.from('messages').insert({ channel_id: channelId, author_id: currentUserId, body: '', attachment_url: data.publicUrl });
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  if (loading) {
    return (
      <div className="empty-state">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <>
      <div className="message-pane">
        <div className="message-pane-spacer" />
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const continued = prev ? isSameAuthorAndClose(prev, msg) : false;
          const profile = profiles[msg.author_id];
          if (continued) {
            return (
              <div key={msg.id} className="message-continued">
                {msg.body && <p className="msg-text">{msg.body}</p>}
                {msg.attachment_url && renderAttachment(msg.attachment_url)}
              </div>
            );
          }
          return (
            <div key={msg.id} className="message-group">
              <Avatar userId={msg.author_id} profile={profile} />
              <div className="msg-body">
                <div className="msg-header">
                  <span className="msg-author">{profileName(profile)}</span>
                  <span className="msg-time">{shortTime(msg.created_at)}</span>
                </div>
                {msg.body && <p className="msg-text">{msg.body}</p>}
                {msg.attachment_url && renderAttachment(msg.attachment_url)}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="input-bar">
        <form className="input-wrap" onSubmit={send}>
          <button
            type="button"
            className="input-action"
            onClick={() => fileRef.current?.click()}
            title="Attach file"
          >
            <Paperclip size={17} />
          </button>
          <input
            ref={fileRef}
            type="file"
            className="file-input-hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }}
          />
          <textarea
            ref={textareaRef}
            value={body}
            onChange={e => { setBody(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKey}
            placeholder={`Message #${channelName}`}
            rows={1}
          />
          <button type="submit" className="input-action" disabled={!body.trim() || sending} title="Send">
            <Send size={17} />
          </button>
        </form>
      </div>
    </>
  );
}

function renderAttachment(url: string) {
  const isImage = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
  if (isImage) return <img src={url} className="msg-image" alt="attachment" onClick={() => window.open(url, '_blank')} />;
  return <a href={url} target="_blank" rel="noreferrer" className="attachment-link">Attachment</a>;
}

export { Hash };
