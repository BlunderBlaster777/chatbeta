import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Channel, Profile } from '../lib/types';
import { initials, profileName } from '../lib/helpers';

interface Peer {
  userId: string;
  profile: Profile | null;
  stream: MediaStream | null;
  muted: boolean;
}

interface Props {
  channel: Channel;
  currentUserId: string;
  profiles: Record<string, Profile>;
}

// Free TURN from Open Relay Project — works across NAT/cellular
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

export default function VoiceChannel({ channel, currentUserId, profiles }: Props) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [iceStates, setIceStates] = useState<Record<string, string>>({});

  const localStream = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingCandidates = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Stable ref for profiles to avoid stale closures
  const profilesRef = useRef(profiles);
  useEffect(() => { profilesRef.current = profiles; }, [profiles]);

  const myProfile = profiles[currentUserId] ?? null;

  const upsertPeer = useCallback((userId: string, patch: Partial<Peer> = {}) => {
    setPeers(prev => {
      const existing = prev.find(peer => peer.userId === userId);
      if (existing) {
        return prev.map(peer => (
          peer.userId === userId
            ? { ...peer, ...patch, profile: patch.profile ?? peer.profile ?? profilesRef.current[userId] ?? null }
            : peer
        ));
      }

      return [
        ...prev,
        {
          userId,
          profile: patch.profile ?? profilesRef.current[userId] ?? null,
          stream: patch.stream ?? null,
          muted: patch.muted ?? false,
        },
      ];
    });
  }, []);

  const cleanup = useCallback(() => {
    localStream.current?.getTracks().forEach(t => t.stop());
    localStream.current = null;
    Object.values(pcsRef.current).forEach(pc => pc.close());
    pcsRef.current = {};
    pendingCandidates.current = {};
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    setPeers([]);
    setIceStates({});
  }, []);

  const addPeer = useCallback((userId: string, initiator: boolean) => {
    if (pcsRef.current[userId]) return;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcsRef.current[userId] = pc;
    pendingCandidates.current[userId] = [];

    localStream.current?.getTracks().forEach(t => pc.addTrack(t, localStream.current!));

    pc.ontrack = e => {
      const remoteStream = e.streams[0] ?? new MediaStream([e.track]);
      upsertPeer(userId, { stream: remoteStream });
    };

    pc.onicecandidate = e => {
      if (e.candidate) {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'ice',
          payload: { from: currentUserId, to: userId, candidate: e.candidate },
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      setIceStates(prev => ({ ...prev, [userId]: pc.iceConnectionState }));
    };

    if (initiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        channelRef.current?.send({
          type: 'broadcast',
          event: 'offer',
          payload: { from: currentUserId, to: userId, sdp: offer },
        });
      });
    }

    upsertPeer(userId);
  }, [currentUserId, upsertPeer]);

  useEffect(() => {
    setPeers(prev => prev.map(peer => ({
      ...peer,
      profile: profiles[peer.userId] ?? peer.profile,
    })));
  }, [profiles]);

  async function drainCandidates(userId: string) {
    const pc = pcsRef.current[userId];
    if (!pc || !pendingCandidates.current[userId]) return;
    for (const c of pendingCandidates.current[userId]) {
      await pc.addIceCandidate(c).catch(() => {});
    }
    pendingCandidates.current[userId] = [];
  }

  async function join() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStream.current = stream;
    } catch {
      alert('Could not access microphone. Check browser permissions.');
      return;
    }

    const ch = supabase.channel(`voice:${channel.id}`, {
      config: { presence: { key: currentUserId } },
    });
    channelRef.current = ch;

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ userId: string }>();
      Object.keys(state).forEach(uid => {
        if (uid !== currentUserId) addPeer(uid, uid < currentUserId);
      });
    });

    ch.on('presence', { event: 'join' }, ({ newPresences }) => {
      (newPresences as unknown as Array<{ key: string }>).forEach(({ key: uid }) => {
        if (uid !== currentUserId) addPeer(uid, uid < currentUserId);
      });
    });

    ch.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      (leftPresences as unknown as Array<{ key: string }>).forEach(({ key: uid }) => {
        pcsRef.current[uid]?.close();
        delete pcsRef.current[uid];
        delete pendingCandidates.current[uid];
        setPeers(prev => prev.filter(p => p.userId !== uid));
        setIceStates(prev => { const n = { ...prev }; delete n[uid]; return n; });
      });
    });

    ch.on('broadcast', { event: 'offer' }, async ({ payload }) => {
      if (payload.to !== currentUserId) return;
      if (!pcsRef.current[payload.from]) addPeer(payload.from, false);
      const pc = pcsRef.current[payload.from];
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await drainCandidates(payload.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ch.send({
        type: 'broadcast',
        event: 'answer',
        payload: { from: currentUserId, to: payload.from, sdp: answer },
      });
    });

    ch.on('broadcast', { event: 'answer' }, async ({ payload }) => {
      if (payload.to !== currentUserId) return;
      const pc = pcsRef.current[payload.from];
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await drainCandidates(payload.from);
    });

    ch.on('broadcast', { event: 'ice' }, async ({ payload }) => {
      if (payload.to !== currentUserId) return;
      const pc = pcsRef.current[payload.from];
      if (!pc) return;
      if (pc.remoteDescription) {
        await pc.addIceCandidate(payload.candidate).catch(() => {});
      } else {
        pendingCandidates.current[payload.from] = [
          ...(pendingCandidates.current[payload.from] ?? []),
          payload.candidate,
        ];
      }
    });

    await ch.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ userId: currentUserId });
        setJoined(true);
      }
    });
  }

  function leave() {
    cleanup();
    setJoined(false);
  }

  function toggleMute() {
    const newMuted = !muted;
    setMuted(newMuted);
    localStream.current?.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
  }

  useEffect(() => () => { cleanup(); }, [cleanup]);

  // DOM audio elements — required for iOS Safari autoplay
  function AudioPlayer({ stream, userId }: { stream: MediaStream; userId: string }) {
    const ref = useRef<HTMLAudioElement>(null);

    useEffect(() => {
      const audio = ref.current;
      if (!audio) return;

      const tryPlay = () => {
        audio.muted = false;
        audio.defaultMuted = false;
        audio.volume = 1;
        void audio.play().catch(() => {});
      };

      if (audio.srcObject !== stream) {
        audio.srcObject = stream;
      }

      audio.onloadedmetadata = tryPlay;
      tryPlay();

      const resumePlayback = () => tryPlay();
      window.addEventListener('pointerdown', resumePlayback);
      window.addEventListener('touchend', resumePlayback);

      return () => {
        audio.onloadedmetadata = null;
        window.removeEventListener('pointerdown', resumePlayback);
        window.removeEventListener('touchend', resumePlayback);
      };
    }, [stream]);

    return <audio ref={ref} autoPlay playsInline className="peer-audio" data-peer={userId} />;
  }

  const me: Peer = { userId: currentUserId, profile: myProfile, stream: localStream.current, muted };
  const allPeers = joined ? [me, ...peers] : [];

  function iceLabel(userId: string) {
    const s = iceStates[userId];
    if (!s || s === 'connected' || s === 'completed') return null;
    if (s === 'checking') return '⟳';
    if (s === 'failed') return '✕';
    if (s === 'disconnected') return '!';
    return null;
  }

  return (
    <div className="voice-pane">
      <div className="voice-channel-header">
        <Volume2 size={18} color="var(--text2)" />
        <span className="voice-pane-title">{channel.name}</span>
      </div>

      {/* DOM audio elements for iOS Safari */}
      {peers.map(peer => peer.stream
        ? <AudioPlayer key={peer.userId} stream={peer.stream} userId={peer.userId} />
        : null
      )}

      {!joined ? (
        <>
          <p className="voice-hint">Join this voice channel to talk with others.</p>
          <button type="button" className="btn-join-voice" onClick={join}>Join voice</button>
        </>
      ) : (
        <>
          <div className="voice-peers">
            {allPeers.map(peer => (
              <div className="voice-peer" key={peer.userId}>
                <div className={`voice-peer-avatar${peer.userId === currentUserId && !muted ? ' speaking' : ''}`}>
                  {peer.profile ? initials(profileName(peer.profile)) : '?'}
                </div>
                <div className="voice-peer-name">
                  {peer.userId === currentUserId ? 'You' : profileName(peer.profile ?? undefined)}
                  {peer.userId !== currentUserId && iceLabel(peer.userId)
                    ? <span className="voice-peer-ice">{iceLabel(peer.userId)}</span>
                    : null}
                </div>
              </div>
            ))}
          </div>
          <div className="voice-controls">
            <button
              type="button"
              className={`voice-btn${muted ? ' active' : ''}`}
              onClick={toggleMute}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button type="button" className="voice-btn danger" onClick={leave} title="Leave">
              <PhoneOff size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
