# nflverse recorded fixtures (L.D3.1)

Trimmed copies of two nflverse-data release assets, recorded once by a plain
`fetch` on **2026-09-02** so the test suite never touches the network. Each
file's first lines are `#` provenance comments (source URL, fetch date, the
trimming rule) that `parseCsv` skips; header and rows are verbatim.

| File | Source | Trimmed to |
|---|---|---|
| `games-trimmed.csv` | `https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv` | 2025 REG week 1 (16 rows, results posted); `2025_19_GB_CHI` (one WC row — the regular-season-only pin); 2026 REG weeks 1, 2, 8, 9, 18 (the DST fall-back of 2026-11-01 sits inside week 8; week 9 carries the 09:30 ET Madrid game) |
| `roster-weekly-2025-wk01-trimmed.csv` | `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_2025.csv` | 2025 REG week 1, teams KC and ARI, every roster status (48 ACT + 6 INA for KC; 48 ACT + 5 INA for ARI; RES/DEV/CUT alongside) |

`roster_weekly_2026.csv` existed at fetch time but carried only pre-season
week-1 rows with no `INA` status (the season had not started) — hence the
2025 week for the inactives shape. `injuries_2026.csv` did not exist yet
(404) and is not consumed by this adapter.

To re-record: fetch the two URLs above and re-apply the trimming rule; keep
the `#` header lines updated with the new fetch date.
