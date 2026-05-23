export type AuthMode = 'signin' | 'signup';

export type Profile = {
  id: string;
  display_name: string;
  avatar_seed: string;
  created_at?: string;
};

export type ServerSummary = {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  created_at: string;
};

export type ChannelKind = 'text' | 'voice';

export type Channel = {
  id: string;
  server_id: string;
  name: string;
  kind: ChannelKind;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  channel_id?: string;
  thread_id?: string;
  author_id: string;
  body: string;
  attachment_url: string | null;
  created_at: string;
};

export type DmThread = {
  id: string;
  otherUserId: string;
};

export type MemberRecord = {
  user_id: string;
};

export type VoicePeer = {
  userId: string;
  stream: MediaStream;
};