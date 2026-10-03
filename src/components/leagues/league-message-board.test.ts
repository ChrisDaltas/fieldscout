import { describe, expect, it } from 'vitest'

import { POST_FAILED_COPY, POST_NOT_MEMBER_COPY, postErrorCopy } from './league-message-board'

describe('postErrorCopy — plain copy, never the raw database error (R1476)', () => {
  it('an RLS refusal reads as lost membership', () => {
    expect(postErrorCopy(new Error('new row violates row-level security policy for table "league_chat"'))).toBe(POST_NOT_MEMBER_COPY)
  })
  it('anything else is a plain retry, with no raw text leaking', () => {
    const copy = postErrorCopy(new Error('duplicate key value violates unique constraint "x_pkey"'))
    expect(copy).toBe(POST_FAILED_COPY)
    expect(copy).not.toMatch(/constraint/)
    expect(postErrorCopy('weird')).toBe(POST_FAILED_COPY)
  })
})
