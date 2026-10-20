/**
 * The members panel's shared actions — the seat link's copy (gap list §4
 * item 106 review). The invite is made first and the clipboard write lands
 * after that network wait, when iPhone Safari usually refuses it (the tap's
 * permission has run out). "Copied" is said only when it was — never let
 * "nothing happened" mean "it worked" (CLAUDE.md).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  createInvite: vi.fn(),
}))

vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }))
vi.mock('@/hooks/use-league-invites', () => ({
  useCreateInvite: () => ({ mutateAsync: mocks.createInvite, isPending: false }),
  useRevokeInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRotateInviteCode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetInviteSlug: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-league-members', () => ({
  useAddPlaceholderSeat: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssignManager: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLeaveLeague: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveManager: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetMemberRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { copyWithToast, useSeatInvite } from './invite-panel-actions'

/** The hook's answer, read from a real render. */
function seatInvite(): ReturnType<typeof useSeatInvite> {
  let captured: ReturnType<typeof useSeatInvite> | null = null
  function Probe() {
    captured = useSeatInvite('lg-1', 't5')
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  if (!captured) throw new Error('the hook did not run')
  return captured
}

function clipboard(write: () => Promise<void>) {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(write) } })
}

beforeEach(() => {
  mocks.toast.mockReset()
  mocks.createInvite.mockReset()
  mocks.createInvite.mockResolvedValue({ token: 'seat-token-9' })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSeatInvite().copySeatLink — "copied" only when it was', () => {
  it('the clipboard took it: copied, and said so', async () => {
    clipboard(() => Promise.resolve())
    const result = await seatInvite().copySeatLink()
    expect(result).toEqual({ status: 'copied' })
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Seat link copied', description: 'Anyone with it claims this exact seat.' })
  })

  it('the clipboard refused (NotAllowedError after the wait): the link comes back, and nothing says copied', async () => {
    clipboard(() => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')))
    const result = await seatInvite().copySeatLink()
    expect(result).toEqual({ status: 'uncopied', link: '/join/seat-token-9' })
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('no clipboard at all (an insecure page): the same — the link, never "copied"', async () => {
    vi.stubGlobal('navigator', {})
    expect(await seatInvite().copySeatLink()).toEqual({ status: 'uncopied', link: '/join/seat-token-9' })
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('the invite wasn’t made: its reason, and no copy tried', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    mocks.createInvite.mockRejectedValue(new Error('That team already has a manager.'))
    expect(await seatInvite().copySeatLink()).toEqual({ status: 'error', message: 'That team already has a manager.' })
    expect(writeText).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})

describe('copyWithToast', () => {
  it('answers whether it copied, and shows the text to copy by hand when it didn’t', async () => {
    clipboard(() => Promise.resolve())
    expect(await copyWithToast('https://x.test/join/a', 'Seat link copied')).toBe(true)
    expect(mocks.toast).toHaveBeenLastCalledWith({ title: 'Seat link copied' })
    clipboard(() => Promise.reject(new Error('denied')))
    expect(await copyWithToast('https://x.test/join/a', 'Seat link copied')).toBe(false)
    expect(mocks.toast).toHaveBeenLastCalledWith({ title: 'Copy it manually', description: 'https://x.test/join/a' })
  })
})
