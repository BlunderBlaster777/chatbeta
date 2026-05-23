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

const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function VoiceChannel({ channel, currentUserId, profiles }: Props) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const localStream = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const myProfile = profiles[currentUserId] ?? null;

  const cleanup = useCallback(() => {
    localStream.current?.getTracks().forEach(t => t.stop());
    localStream.current = null;
    Object.values(pcsRef.current).forEach(pc => pc.close());
    pcsRef.current = {};
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    setPeers([]);
  }, []);

  const addPeer = useCallback((userId: string, initiator: boolean) => {
    if (pcsRef.current[userId]) return;
    const pc = new RTCPeerConnection(STUN);
    pcsRef.current[userId] = pc;

    localStream.current?.getTracks().forEach(t => pc.addTrack(t, localStream.current!));

    pc.ontrack = e => {
      setPeers(prev => prev.map(p => p.userId === userId ? { ...p, stream: e.streams[0] } : p));
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

    setPeers(prev => {
      if (prev.find(p => p.userId === userId)) return prev;
      return [...prev, { userId, profile: profiles[userId] ?? null, stream: null, muted: false }];
    });
  }, [currentUserId, profiles]);

  async function join() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStream.current = stream;
    } catch {
      alert('Could not access microphone.');
      return;
    }

    const ch = supabase.channel(`voice:${channel.id}`, { config: { presence: { key: currentUserId } } });
    channelRef.current = ch;

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ userId: string }>();
      Object.keys(state).forEach(uid => {
        if (uid !== currentUserId) addPeer(uid, uid < currentUserId);
      });
    });

    ch.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      (leftPresences as Array<{ userId: string }>).forEach(({ userId }) => {
        pcsRef.current[userId]?.close();
        delete pcsRef.current[userId];
        setPeers(prev => prev.filter(p => p.userId !== userId));
      });
    });

    ch.on('broadcast', { event: 'offer' }, async ({ payload }) => {
      if (payload.to !== currentUserId) return;
      let pc = pcsRef.current[payload.from];
      if (!pc) { addPeer(payload.from, false); pc = pcsRef.current[payload.from]; }
      await pc.setRemoteDescription(payload.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ch.send({ type: 'broadcast', event: 'answer', payload: { from: currentUserId, to: payload.from, sdp: answer } });
    });

    ch.on('broadcast', { event: 'answer' }, async ({ payload }) => {
      if (payload.to !== currentUserId) return;
      await pcsRef.current[payload.from]?.setRemoteDescription(payload.sdp);
    });

    ch.on('broadcast', { event: 'ice' }, async ({ payload }) => {
      if (payload.to !== currentUserId) return;
      await pcsRef.current[payload.from]?.addIceCandidate(payload.candidate);
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

  // Audio elements for remote streams
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  useEffect(() => {
    peers.forEach(peer => {
      if (!peer.stream) return;
      if (!audioRefs.current[peer.userId]) {
        const el = new Audio();
        el.autoplay = true;
        audioRefs.current[peer.userId] = el;
      }
      const el = audioRefs.current[peer.userId];
      if (el.srcObject !== peer.stream) el.srcObject = peer.stream;
    });
  }, [peers]);

  const me: Peer = { userId: currentUserId, profile: myProfile, stream: localStream.current, muted };
  const allPeers = joined ? [me, ...peers] : [];

  return (
    <div className="voice-pane">
      <div className="voice-channel-header">
        <Volume2 size={18} color="var(--text2)" />
        <span className="voice-pane-title">{channel.name}</span>
      </div>

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
                </div>
              </div>
            ))}
          </div>
          <div className="voice-controls">
            <button type="button" className={`voice-btn${muted ? ' active' : ''}`} onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
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
