# Chat v2

Private friend-group chat built for free tiers only.

## Stack

- React + TypeScript + Vite
- Supabase Auth for email/password login
- Supabase Postgres for data
- Supabase Realtime for live chat, typing, presence, and voice signaling
- Supabase Storage for uploads
- WebRTC with public STUN servers for best-effort voice

## Features

- Email/password authentication
- Private servers with invite codes
- Text channels and direct messages
- Realtime messages via Supabase subscriptions
- Presence and typing indicators via Realtime channels
- Image/file uploads
- Best-effort voice rooms with WebRTC mesh
- Responsive layout for phone, tablet, and desktop

## Local setup

1. Copy `.env.example` values into `.env` and set your real Supabase URL and anon key.
2. In Supabase, run `supabase/schema.sql` in the SQL editor.
3. Create a Storage bucket named `chat-uploads` if the SQL editor did not create it.
4. Install dependencies with `npm install`.
5. Start the app with `npm run dev`.

## Notes

- Voice is STUN-only and free-tier friendly, but not guaranteed on restrictive networks.
- This app assumes a single Supabase project and no custom backend.