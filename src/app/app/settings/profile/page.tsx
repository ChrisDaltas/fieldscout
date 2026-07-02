'use client'

import { EditableUserAvatar } from '@/components/profile/editable-user-avatar'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/hooks/use-auth'

export default function ProfileSettingsPage() {
  const { profile } = useAuth()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Profile settings</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage how you appear across FieldScout.
        </p>
      </header>

      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="space-y-6 p-6">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              Profile photo
            </p>
            <div className="flex items-center gap-4">
              <EditableUserAvatar
                src={profile?.avatar_url}
                name={profile?.display_name ?? profile?.username}
                className="h-24 w-24"
              />
              <div className="text-sm text-text-secondary">
                <p>JPEG, PNG, WebP or GIF.</p>
                <p>Max 5 MB. Crops to a circle.</p>
              </div>
            </div>
          </div>

          <div className="border-t border-bg-elevated-2 pt-6">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              Display name
            </p>
            <p className="text-sm text-foreground">
              {profile?.display_name ?? `@${profile?.username ?? ''}`}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              Editing name and username coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
