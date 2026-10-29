/**
 * The v7 Notifications page's type label (`notificationKind`), for the
 * Community alerts: a comment on your list is "Comment" (213), a saved list
 * that changed stays "Lists".
 */
import { describe, expect, it } from 'vitest'

import { notificationKind } from './notifications-feed'

describe('notificationKind — list activity', () => {
  it('213: a new comment on your list reads "Comment"', () => {
    expect(notificationKind('list_comment')).toEqual({ label: 'Comment', tone: 'accent' })
  })

  it('a saved list that changed stays "Lists"; chat stays "Message"', () => {
    expect(notificationKind('list_updated')).toEqual({ label: 'Lists', tone: 'neutral' })
    expect(notificationKind('direct_message')).toEqual({ label: 'Message', tone: 'accent' })
  })
})
