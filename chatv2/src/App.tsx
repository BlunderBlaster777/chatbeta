import { useEffect, useState, useCallback } from 'react';
import { Hash, Volume2, Plus, MessageSquare, LogOut, Settings, ChevronLeft, Server, Menu } from 'lucide-react';
import { supabase } from './lib/supabase';
import type { Channel, Profile, ServerSummary, DmThread } from './lib/types';
import { initials, profileName } from './lib/helpers';
import AuthScreen from './components/AuthScreen';
import MessagePane from './components/MessagePane';
import VoiceChannel from './components/VoiceChannel';
import DmPane from './components/DmPane';
import ServerModal from './components/ServerModal';
import ServerSettingsModal from './components/ServerSettingsModal';
import type { User } from '@supabase/supabase-js';

type View =
  | { kind: 'channel'; channel: Channel }
  | { kind: 'dm'; thread: DmThread }
  | { kind: 'none' };

type NavMode = 'server' | 'dm';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Servers
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);

  // DMs
  const [dmThreads, setDmThreads] = useState<DmThread[]>([]);
  const [navMode, setNavMode] = useState<NavMode>('server');

  // Active view
  const [view, setView] = useState<View>({ kind: 'none' });

  // Profile cache
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  // Modals
  const [showServerModal, setShowServerModal] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);

  // Mobile drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Auth ───────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); setServers([]); setChannels([]); setDmThreads([]); return; }
    // load own profile
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setProfile(data as Profile); });
    loadServers();
    loadDmThreads();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadServers() {
    if (!user) return;
    const { data } = await supabase
      .from('server_members')
      .select('server_id, servers(*)')
      .eq('user_id', user.id);
    if (!data) return;
    const list = data.flatMap(row => {
      const s = (row as { servers: ServerSummary | ServerSummary[] | null }).servers;
      return s ? (Array.isArray(s) ? s : [s]) : [];
    });
    setServers(list);
    if (list.length && !activeServerId) setActiveServerId(list[0].id);
  }

  async function loadDmThreads() {
    if (!user) return;
    const { data } = await supabase
      .from('dm_thread_members')
      .select('thread_id')
      .eq('user_id', user.id);
    if (!data) return;
    // For each thread, find the other member
    const threads: DmThread[] = [];
    for (const row of data as Array<{ thread_id: string }>) {
      const { data: members } = await supabase
        .from('dm_thread_members')
        .select('user_id')
        .eq('thread_id', row.thread_id)
        .neq('user_id', user.id)
        .limit(1);
      const otherId = (members as Array<{ user_id: string }> | null)?.[0]?.user_id;
      if (otherId) threads.push({ id: row.thread_id, otherUserId: otherId });
    }
    setDmThreads(threads);
    // pre-load other profiles
    threads.forEach(t => loadProfile(t.otherUserId));
  }

  useEffect(() => {
    if (!activeServerId) { setChannels([]); return; }
    supabase
      .from('channels')
      .select('*')
      .eq('server_id', activeServerId)
      .order('kind')
      .order('name')
      .then(({ data }) => {
        const chs = (data ?? []) as Channel[];
        setChannels(chs);
        if (chs.length) setView({ kind: 'channel', channel: chs[0] });
        else setView({ kind: 'none' });
      });
  }, [activeServerId]);

  const loadProfile = useCallback((userId: string) => {
    if (profiles[userId]) return;
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      .then(({ data }) => {
        if (data) setProfiles(prev => ({ ...prev, [userId]: data as Profile }));
      });
  }, [profiles]);

  // Merge own profile into cache
  useEffect(() => {
    if (user && profile) setProfiles(prev => ({ ...prev, [user.id]: profile }));
  }, [user, profile]);

  async function startDm(otherUserId: string) {
    if (!user) return;
    const { data, error } = await supabase.rpc('create_or_get_dm_thread', { other_user_id: otherUserId });
    if (error || !data) return;
    const threadId = data as string;
    const thread: DmThread = { id: threadId, otherUserId };
    setDmThreads(prev => prev.find(t => t.id === threadId) ? prev : [...prev, thread]);
    loadProfile(otherUserId);
    setNavMode('dm');
    setView({ kind: 'dm', thread });
  }

  function selectView(v: View) {
    setView(v);
    setDrawerOpen(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (authLoading) {
    return (
      <div className="loading-shell">
        <span className="spinner" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  const activeServer = servers.find(s => s.id === activeServerId);
  const textChannels = channels.filter(c => c.kind === 'text');
  const voiceChannels = channels.filter(c => c.kind === 'voice');

  const viewTitle = view.kind === 'channel'
    ? view.channel.name
    : view.kind === 'dm'
      ? profileName(profiles[view.thread.otherUserId], 'DM')
      : navMode === 'dm' ? 'Direct Messages' : (activeServer?.name ?? 'BlockChat');

  /* ── Sidebar contents (shared between drawer and desktop) ── */
  const sidebarContents = (
    <>
      <div className="sidebar-header">
        <span className="sidebar-header-name">
          {navMode === 'dm' ? 'Direct Messages' : (activeServer?.name ?? 'Select a server')}
        </span>
        {navMode === 'server' && activeServer && (
          <button type="button" className="btn-ghost sidebar-settings-btn" title="Server settings" onClick={() => setShowServerSettings(true)}>
            <Settings size={14} />
          </button>
        )}
      </div>

      <div className="channel-list">
        {navMode === 'dm' ? (
          <>
            {dmThreads.length === 0 && (
              <div className="sidebar-empty-hint">No DMs yet.</div>
            )}
            {dmThreads.map(thread => {
              const p = profiles[thread.otherUserId];
              const name = profileName(p, thread.otherUserId.slice(0, 8));
              const active = view.kind === 'dm' && view.thread.id === thread.id;
              return (
                <div
                  key={thread.id}
                  className={`dm-row${active ? ' active' : ''}`}
                  onClick={() => selectView({ kind: 'dm', thread })}
                >
                  <div className="dm-avatar">{initials(name) || '?'}</div>
                  <span className="dm-name">{name}</span>
                </div>
              );
            })}
          </>
        ) : (
          <>
            {textChannels.length > 0 && (
              <>
                <div className="channel-group-label">Text</div>
                {textChannels.map(ch => (
                  <div
                    key={ch.id}
                    className={`channel-row${view.kind === 'channel' && view.channel.id === ch.id ? ' active' : ''}`}
                    onClick={() => selectView({ kind: 'channel', channel: ch })}
                  >
                    <Hash size={14} className="channel-row-icon" />
                    <span className="channel-row-name">{ch.name}</span>
                  </div>
                ))}
              </>
            )}
            {voiceChannels.length > 0 && (
              <>
                <div className="channel-group-label">Voice</div>
                {voiceChannels.map(ch => (
                  <div
                    key={ch.id}
                    className={`channel-row${view.kind === 'channel' && view.channel.id === ch.id ? ' active' : ''}`}
                    onClick={() => selectView({ kind: 'channel', channel: ch })}
                  >
                    <Volume2 size={14} className="channel-row-icon" />
                    <span className="channel-row-name">{ch.name}</span>
                  </div>
                ))}
              </>
            )}
            {channels.length === 0 && activeServer && (
              <div className="sidebar-empty-hint">No channels yet.</div>
            )}
          </>
        )}
      </div>

      <div className="sidebar-userbar">
        <div className="userbar-avatar">{initials(profileName(profile ?? undefined)) || '?'}</div>
        <span className="userbar-name">{profileName(profile ?? undefined, user.email ?? 'You')}</span>
        <div className="userbar-actions">
          <button type="button" className="btn-ghost" onClick={signOut} title="Sign out"><LogOut size={15} /></button>
        </div>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      {/* Server rail — hidden on phones, shown on tablet/desktop */}
      <nav className="server-rail">
        <button
          type="button"
          className={`server-icon dm-icon${navMode === 'dm' ? ' active' : ''}`}
          onClick={() => { setNavMode('dm'); setView({ kind: 'none' }); setDrawerOpen(false); }}
          title="Direct Messages"
        >
          <MessageSquare size={18} />
        </button>
        <div className="server-divider" />
        {servers.map(server => (
          <button
            type="button"
            key={server.id}
            className={`server-icon${navMode === 'server' && activeServerId === server.id ? ' active' : ''}`}
            onClick={() => { setNavMode('server'); setActiveServerId(server.id); setDrawerOpen(false); }}
            title={server.name}
          >
            {initials(server.name) || server.name[0]}
          </button>
        ))}
        <button type="button" className="server-add" onClick={() => setShowServerModal(true)} title="Add server">
          <Plus size={18} />
        </button>
      </nav>

      {/* Drawer overlay (tablet + phone) */}
      <div
        className={`drawer-overlay${drawerOpen ? ' open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Channel / DM sidebar — desktop: inline; tablet/phone: drawer */}
      <aside className={`channel-sidebar drawer${drawerOpen ? ' open' : ''}`}>
        {sidebarContents}
      </aside>

      {/* Main area */}
      <main className="main-area">
        <div className="main-topbar">
          {/* Back / menu button — only visible on tablet/phone via CSS */}
          <button
            type="button"
            className="topbar-back"
            onClick={() => setDrawerOpen(v => !v)}
            aria-label="Open sidebar"
          >
            {view.kind === 'none' ? <Menu size={18} /> : <ChevronLeft size={20} />}
          </button>

          {view.kind === 'channel' && (
            view.channel.kind === 'voice'
              ? <Volume2 size={16} className="topbar-icon" />
              : <Hash size={16} className="topbar-icon" />
          )}
          {view.kind === 'dm' && <MessageSquare size={16} className="topbar-icon" />}

          <span className="topbar-title">{viewTitle}</span>
        </div>

        {view.kind === 'channel' && (
          view.channel.kind === 'voice' ? (
            <VoiceChannel
              channel={view.channel}
              currentUserId={user.id}
              profiles={profiles}
            />
          ) : (
            <MessagePane
              channelId={view.channel.id}
              channelName={view.channel.name}
              currentUserId={user.id}
              profiles={profiles}
              onProfileNeeded={loadProfile}
            />
          )
        )}

        {view.kind === 'dm' && (
          <DmPane
            threadId={view.thread.id}
            otherProfile={profiles[view.thread.otherUserId]}
            currentUserId={user.id}
            profiles={profiles}
            onProfileNeeded={loadProfile}
          />
        )}

        {view.kind === 'none' && (
          <div className="empty-state">
            <div className="empty-state-icon">
              {navMode === 'dm' ? <MessageSquare size={40} /> : <Hash size={40} />}
            </div>
            <h3>{navMode === 'dm' ? 'No conversation selected' : 'No channel selected'}</h3>
            <p>
              {navMode === 'dm'
                ? 'Open the sidebar and pick a conversation.'
                : 'Open the sidebar and pick a channel.'}
            </p>
          </div>
        )}
      </main>

      {/* Bottom tab bar — phones only (hidden on tablet/desktop via CSS) */}
      <nav className="bottom-tabbar">
        <button
          type="button"
          className={`bottom-tab${navMode === 'dm' ? ' active' : ''}`}
          onClick={() => { setNavMode('dm'); setView({ kind: 'none' }); setDrawerOpen(true); }}
        >
          <span className="bottom-tab-icon"><MessageSquare size={20} /></span>
          DMs
        </button>
        <button
          type="button"
          className={`bottom-tab${navMode === 'server' ? ' active' : ''}`}
          onClick={() => { setNavMode('server'); setDrawerOpen(true); }}
        >
          <span className="bottom-tab-icon"><Server size={20} /></span>
          Servers
        </button>
        <button
          type="button"
          className="bottom-tab"
          onClick={() => setShowServerModal(true)}
        >
          <span className="bottom-tab-icon"><Plus size={20} /></span>
          Add
        </button>
      </nav>

      {showServerModal && (
        <ServerModal
          onClose={() => setShowServerModal(false)}
          onDone={() => { setShowServerModal(false); loadServers(); }}
        />
      )}

      {showServerSettings && activeServer && (
        <ServerSettingsModal
          server={activeServer}
          onClose={() => setShowServerSettings(false)}
        />
      )}
    </div>
  );
}
