'use client'

import { useEffect, useState } from 'react'

import { NotificationsBody } from '@/components/layout/rail/notifications-panel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useAdminVerb } from '@/hooks/use-admin-verb'
import { newActionId } from '@/lib/admin/admin-api'

import { AdminHeader, AdminSection } from './admin-parts'
import {
  AUDIENCE_LABEL,
  NOTICE_BODY_MAX,
  NOTICE_DRAFT_KEY,
  NOTICE_TITLE_MAX,
  emptyNoticeDraft,
  noticePreviewItem,
  noticeProblem,
  noticeRequest,
  parseNoticeDraft,
  type NoticeAudience,
  type NoticeDraft,
} from './admin-console-ops'
import { LeagueFinder } from './admin-leagues'

function loadDraft(): NoticeDraft | null {
  try {
    return parseNoticeDraft(window.localStorage.getItem(NOTICE_DRAFT_KEY))
  } catch {
    return null
  }
}

function saveDraft(d: NoticeDraft | null) {
  try {
    if (d) window.localStorage.setItem(NOTICE_DRAFT_KEY, JSON.stringify(d))
    else window.localStorage.removeItem(NOTICE_DRAFT_KEY)
  } catch {
    // Storage blocked (private window): the draft just isn't kept.
  }
}

/**
 * `/app/admin/notify` — compose a FieldScout notice (spec §24.4 "Notices";
 * Q97; 185; F596). Audience picker, a preview exactly as the rail shows it,
 * a draft autosaved in this browser, and a send that reports the recipient
 * count. The compose's `action_id` is kept with the draft, so a retry after a
 * failure can never send twice; a successful send starts a new one.
 */
export function AdminNotify() {
  const [draft, setDraft] = useState<NoticeDraft>(() => emptyNoticeDraft(newActionId()))
  const [loaded, setLoaded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sent, setSent] = useState<{ recipients: number; title: string } | null>(null)
  const verb = useAdminVerb()

  // Restore after mount (localStorage is browser-only), then autosave.
  useEffect(() => {
    const d = loadDraft()
    if (d) setDraft(d)
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (loaded) saveDraft(draft)
  }, [draft, loaded])

  const set = (patch: Partial<NoticeDraft>) => {
    setSent(null)
    setDraft((d) => ({ ...d, ...patch }))
  }
  const problem = noticeProblem(draft)

  const send = () => {
    verb.mutate(
      { url: '/api/admin/notifications', body: noticeRequest(draft) },
      {
        onSuccess: (r) => {
          setConfirming(false)
          // Fail loud: a send that does not report its count is not shown as "sent to 0".
          setSent({ recipients: typeof r.recipients === 'number' ? r.recipients : -1, title: draft.title.trim() })
          const fresh = emptyNoticeDraft(newActionId())
          setDraft(fresh)
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-5" data-admin-page="notify">
      <AdminHeader title="Admin" />
      <NotifyBody
        draft={draft}
        set={set}
        problem={problem}
        sent={sent}
        sendError={!confirming && verb.error ? verb.error.message : null}
        onSend={() => setConfirming(true)}
      />
      <Dialog open={confirming} onOpenChange={(o) => !verb.isPending && setConfirming(o)}>
        <DialogContent className="max-w-md" data-notify-confirm>
          <DialogHeader>
            <DialogTitle>Send this notice?</DialogTitle>
            <DialogDescription className="sr-only">Who receives it</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
            <dt className="font-bold text-n-6">To</dt>
            <dd className="font-semibold text-ink">
              {draft.audience === 'league' ? `${draft.leagueName ?? 'One league'}’s members` : AUDIENCE_LABEL[draft.audience]}
            </dd>
            <dt className="font-bold text-n-6">Title</dt>
            <dd className="font-medium text-ink">{draft.title.trim()}</dd>
            <dt className="font-bold text-n-6">Where</dt>
            <dd className="font-medium text-ink">Their notifications, labelled “From FieldScout”. It can’t be taken back.</dd>
          </dl>
          {verb.error && (
            <p className="rounded-md bg-negative-soft px-3 py-2 text-[11px] font-medium text-ink" role="alert" data-notify-error>
              {verb.error.message}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={verb.isPending}>
              Cancel
            </Button>
            <Button variant="blue" onClick={send} disabled={verb.isPending} data-notify-go>
              {verb.isPending ? 'Sending…' : verb.error ? 'Try again' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Presentational — exported for the render tests. */
export function NotifyBody({
  draft,
  set,
  problem,
  sent,
  sendError,
  onSend,
  now = new Date().toISOString(),
}: {
  draft: NoticeDraft
  set: (patch: Partial<NoticeDraft>) => void
  problem: string | null
  sent: { recipients: number; title: string } | null
  sendError: string | null
  onSend: () => void
  now?: string
}) {
  const preview = noticePreviewItem(draft, now)
  const leagues = draft.audience === 'league' && draft.leagueId
    ? [{ id: draft.leagueId, name: draft.leagueName ?? 'League', avatar_url: null }]
    : []

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <AdminSection title="Write a notice" hint="Saved in this browser as you type." data-admin-section="compose">
        {sent && (
          <p className="rounded-md bg-positive-soft px-3 py-2 text-[12px] font-semibold text-ink" role="status" data-notify-sent={sent.recipients}>
            {sent.recipients < 0 ? (
              <>Sent “{sent.title}”, but the server did not say how many people got it. Check the Log.</>
            ) : (
              <>
                Sent “{sent.title}” to <span className="fs-num">{sent.recipients}</span> {sent.recipients === 1 ? 'person' : 'people'}.
              </>
            )}
          </p>
        )}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1 text-[11px] font-bold text-ink">Who gets it</legend>
          <RadioGroup
            value={draft.audience}
            onValueChange={(v) => set({ audience: v as NoticeAudience })}
            className="flex flex-col gap-1.5"
          >
            {(['all_league_members', 'all_users', 'league'] as const).map((a) => (
              <label key={a} className="flex items-center gap-2 text-[12px] font-medium text-ink" data-audience={a}>
                <RadioGroupItem value={a} />
                {AUDIENCE_LABEL[a]}
              </label>
            ))}
          </RadioGroup>
        </fieldset>
        {draft.audience === 'league' && (
          <div className="flex flex-col gap-1.5 rounded-md bg-surface-sunken p-3" data-notify-league>
            {draft.leagueId ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-ink">{draft.leagueName ?? draft.leagueId}</span>
                <Button size="sm" variant="ghost" onClick={() => set({ leagueId: null, leagueName: null })}>
                  Change
                </Button>
              </div>
            ) : (
              <LeagueFinder onPick={(l) => set({ leagueId: l.id, leagueName: l.name })} />
            )}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="notice-title" className="text-[11px]">Title</Label>
          <Input id="notice-title" value={draft.title} maxLength={NOTICE_TITLE_MAX} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="notice-body" className="text-[11px]">Message (optional)</Label>
          <textarea
            id="notice-body"
            value={draft.body}
            maxLength={NOTICE_BODY_MAX}
            rows={4}
            onChange={(e) => set({ body: e.target.value })}
            className="w-full resize-y rounded-md border border-n-4 bg-white px-3 py-2 text-[13px] font-medium text-ink outline-none focus-visible:border-accent"
          />
          <span className="self-end text-[10px] font-medium text-n-6 fs-num">{draft.body.length} / {NOTICE_BODY_MAX}</span>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="notice-link" className="text-[11px]">Link (optional)</Label>
          <Input id="notice-link" value={draft.link} placeholder="/app/leagues" maxLength={500} onChange={(e) => set({ link: e.target.value })} />
          <span className="text-[10px] font-medium text-n-6">A page inside FieldScout, starting with “/”.</span>
        </div>
        <p className="text-[10px] font-medium text-n-6">Sent to their in-app notifications. Email and push are not built yet.</p>
        {sendError && (
          <p className="rounded-md bg-negative-soft px-3 py-2 text-[11px] font-medium text-ink" role="alert">{sendError}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="blue" onClick={onSend} disabled={problem !== null} data-notify-send>
            Send…
          </Button>
          {problem && <span className="text-[11px] font-medium text-n-6" data-notify-problem>{problem}</span>}
        </div>
      </AdminSection>

      <AdminSection title="Preview" hint="How it looks in their notifications." data-admin-section="preview">
        <div className="flex max-h-[360px] flex-col overflow-hidden rounded-xl border border-n-4 bg-white" data-notify-preview>
          <NotificationsBody
            notifications={[preview]}
            loading={false}
            leagues={leagues}
            filter={null}
            onFilter={() => {}}
            onOpen={() => {}}
          />
        </div>
      </AdminSection>
    </div>
  )
}
