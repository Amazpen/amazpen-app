# Admin Online Users - Design

## Overview

Admin-only page showing real-time count and list of currently connected users in the system.
Uses Supabase Presence API — no database tables, no polling, fully real-time.

## Approach

**Supabase Presence API** — every authenticated user tracks their presence via a shared channel.
The admin page listens to sync/join/leave events and displays the current state.

## Architecture

### 1. Presence Tracking (All Users)

Every user entering the dashboard layout joins a `online-users` presence channel:

```typescript
const channel = supabase.channel('online-users', {
  config: { presence: { key: userProfile.id } }
})

channel.subscribe(async (status) => {
  if (status === 'SUBSCRIBED') {
    await channel.track({
      user_id: userProfile.id,
      email: userProfile.email,
      full_name: userProfile.full_name,
      avatar_url: userProfile.avatar_url,
      online_at: new Date().toISOString(),
      current_page: pathname
    })
  }
})
```

- Tracking happens in `usePresence` hook, called from dashboard layout
- Updates `current_page` on route changes
- Supabase auto-removes user when tab/browser closes (WebSocket disconnect)
- Cleanup on unmount: `channel.untrack()` + `supabase.removeChannel(channel)`

### 2. Admin Page `/admin/online-users`

**Header:**
- Title: "משתמשים מחוברים" + green badge with count

**User Cards Grid:**
Each connected user displayed as a card:
- Avatar (or initials fallback) with green dot indicator
- Full name + email
- Current page they're viewing (translated to Hebrew page name)
- Time since connected ("מחובר מלפני X דקות")

**Empty State:**
- Message: "אין משתמשים מחוברים כרגע"

**Real-time updates:**
- `sync` event: full state refresh
- `join` event: user card appears with animation
- `leave` event: user card removed with animation

### 3. Navigation

Add to `adminMenuItems` in dashboard layout:
- Label: "משתמשים מחוברים"
- Icon: `Users` from Lucide
- Path: `/admin/online-users`

## File Structure

| File | Type | Description |
|------|------|-------------|
| `src/hooks/usePresence.ts` | New | Hook for tracking + listening to presence |
| `src/app/(dashboard)/admin/online-users/page.tsx` | New | Admin page component |
| `src/app/(dashboard)/layout.tsx` | Modified | Add presence tracking + admin menu item |

## Data Shape

```typescript
interface PresenceUser {
  user_id: string
  email: string
  full_name: string
  avatar_url: string | null
  online_at: string  // ISO timestamp
  current_page: string
}
```

## Access Control

- Presence tracking: all authenticated users (lightweight, just track)
- Admin page: gated behind `isAdmin` check, same as other admin pages
- Non-admins cannot see who else is online (no UI exposed)

## Styling

- Dark theme, consistent with existing admin pages
- Card grid layout, responsive
- Green dot for online indicator
- Uses shadcn/ui Card, Badge, Avatar components
