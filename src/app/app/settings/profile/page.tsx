import { redirect } from 'next/navigation'

// Folded into /app/settings — the Profile card (avatar, display name,
// username) lives on the main Account settings page now. Keep the URL
// working for old links and bookmarks.
export default function ProfileSettingsPage() {
  redirect('/app/settings')
}
