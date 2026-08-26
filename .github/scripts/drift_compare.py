#!/usr/bin/env python3
"""Compare the repo's migrations against production's applied list.

Four failure modes, deliberately distinct so a red says WHICH thing is wrong:

  unapplied  in the repo, not on production, and not declared held  -> the drift
  stray      on production, not in the repo                         -> hand-applied; NEVER suppressed
  stale      declared held, but production already has it           -> the hold outlived its reason
  rot        declared held, but the repo no longer has it           -> the hold names nothing

A hold suppresses only `unapplied`. It cannot suppress a stray: that is the
direction that produced the 2026-08-05 incident.
"""
import re
import sys


def read_versions(path):
    with open(path) as fh:
        return {line.strip() for line in fh if line.strip()}


def read_holds(path):
    """Parse NNN and NNN-MMM lines. Ranges are closed on both ends by design:
    an open-ended hold would suppress every future migration forever, which is
    the failure this file exists to end."""
    holds, bad = set(), []
    try:
        fh = open(path)
    except FileNotFoundError:
        return holds, bad
    with fh:
        for n, raw in enumerate(fh, 1):
            line = raw.split('#', 1)[0].strip()
            if not line:
                continue
            if re.fullmatch(r'\d{3}', line):
                holds.add(line)
            elif re.fullmatch(r'\d{3}-\d{3}', line):
                lo, hi = line.split('-')
                if int(lo) > int(hi):
                    bad.append(f'line {n}: {line!r} descends')
                    continue
                holds.update(f'{v:03d}' for v in range(int(lo), int(hi) + 1))
            else:
                bad.append(f'line {n}: {line!r} is not NNN or NNN-MMM')
    return holds, bad


def main():
    local_p, remote_p, holds_p = sys.argv[1:4]
    local, remote = read_versions(local_p), read_versions(remote_p)
    holds, bad = read_holds(holds_p)

    print(f'applied on production: {len(remote)}')
    print(f'migrations in repo:    {len(local)}')
    print(f'declared held back:    {len(holds)}')
    print()

    status = 0

    def fail(title, items, fix):
        nonlocal status
        print(f'::error::{title}')
        for i in sorted(items):
            print(f'  {i}')
        print(f'Fix: {fix}')
        print()
        status = 1

    if bad:
        fail('Malformed lines in ' + holds_p, bad,
             'one NNN or NNN-MMM per line; ranges are closed on both ends')

    unapplied = local - remote - holds
    if unapplied:
        fail('In the repo, NOT applied to production, and NOT declared held:',
             unapplied,
             'npx supabase db push  — or, if it is deliberately held, add it to '
             + holds_p + ' with the reason')

    stray = remote - local
    if stray:
        fail('Applied to production but NOT in the repo '
             '(a hand-applied migration, or an auto-generated version number):',
             stray,
             'see docs/specs/runbook-hosted-migration-reconciliation.md')

    stale = holds & remote
    if stale:
        fail('Declared held, but production already HAS these — the hold is stale:',
             stale, 'remove them from ' + holds_p)

    rot = holds - local
    if rot:
        fail('Declared held, but the repo does not have these — the hold names nothing:',
             rot, 'remove them from ' + holds_p)

    held_present = sorted(holds & local)
    if held_present and status == 0:
        print(f'::notice::{len(held_present)} migration(s) deliberately held from '
              f'production: {held_present[0]}-{held_present[-1]}. '
              f'Everything else in the repo is applied, and nothing is extra.')
        print('In sync, allowing for declared holds.')

    return status


if __name__ == '__main__':
    sys.exit(main())
