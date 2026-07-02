"""
Load historical NFL weekly stats (2022-2025) from nflverse into player_stats.

  python3 scripts/load-historical-stats.py

Maps nflverse gsis_id -> sleeper_id via nfl_data_py.import_ids() so rows align
with our players table (which is keyed by sleeper_id).
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import nfl_data_py as nfl
import pandas as pd
from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env.local"
if ENV.exists():
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    sys.exit("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")

supabase = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

SEASONS = [2022, 2023, 2024, 2025]
BATCH_SIZE = 500

# nflverse weekly column -> our player_stats column
COLUMN_MAP = {
    "attempts": "pass_attempts",
    "completions": "pass_completions",
    "passing_yards": "pass_yards",
    "passing_tds": "pass_tds",
    "interceptions": "interceptions",
    "sacks": "sacks_taken",
    "carries": "rush_attempts",
    "rushing_yards": "rush_yards",
    "rushing_tds": "rush_tds",
    "rushing_fumbles_lost": "fumbles_lost",
    "targets": "targets",
    "receptions": "receptions",
    "receiving_yards": "receiving_yards",
    "receiving_tds": "receiving_tds",
}

INT_COLUMNS = set(COLUMN_MAP.values())


def to_int(value) -> int:
    if value is None:
        return 0
    if isinstance(value, float) and math.isnan(value):
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def build_id_map() -> dict[str, str]:
    """Returns gsis_id -> sleeper_id. nflverse stores sleeper_id as float so we
    convert via int to strip the .0."""
    print("Loading player ID crosswalk from nflverse…")
    ids = nfl.import_ids()
    ids = ids[ids["sleeper_id"].notna() & ids["gsis_id"].notna()]
    sleeper_ids = ids["sleeper_id"].astype("int64").astype(str)
    return dict(zip(ids["gsis_id"].astype(str), sleeper_ids))


NFLVERSE_PARQUET_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "stats_player/stats_player_week_{season}.parquet"
)

# nflverse renamed some columns in the newer stats_player_week_* parquet schema.
# Normalize them back to the names import_weekly_data() returned for 2022-2024
# so a single COLUMN_MAP works.
COLUMN_ALIASES = {
    "passing_interceptions": "interceptions",
    "sacks_suffered": "sacks",
}


def _load_from_parquet(season: int) -> pd.DataFrame:
    url = NFLVERSE_PARQUET_URL.format(season=season)
    print(f"  falling back to parquet: {url}")
    df = pd.read_parquet(url)
    for old, new in COLUMN_ALIASES.items():
        if old in df.columns and new not in df.columns:
            df = df.rename(columns={old: new})
    return df


def load_weekly(season: int) -> pd.DataFrame:
    print(f"Fetching weekly stats for {season}…")
    try:
        return nfl.import_weekly_data([season])
    except Exception as exc:
        print(f"  import_weekly_data failed: {exc}")
        try:
            return _load_from_parquet(season)
        except Exception as exc2:
            print(f"  parquet fallback failed: {exc2}")
            return pd.DataFrame()


def fetch_known_player_ids() -> set[str]:
    print("Fetching player IDs from DB…")
    known: set[str] = set()
    page_size = 1000
    offset = 0
    while True:
        res = (
            supabase.table("players")
            .select("id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = res.data or []
        for r in rows:
            known.add(r["id"])
        if len(rows) < page_size:
            break
        offset += page_size
    print(f"  found {len(known)} players in DB")
    return known


def upsert_batch(rows: list[dict]) -> None:
    if not rows:
        return
    res = (
        supabase.table("player_stats")
        .upsert(rows, on_conflict="player_id,season,week")
        .execute()
    )
    if getattr(res, "error", None):
        raise RuntimeError(f"Upsert error: {res.error}")


def main() -> None:
    id_map = build_id_map()
    known_player_ids = fetch_known_player_ids()

    total_upserted = 0
    skipped_no_sleeper = 0
    skipped_not_in_db = 0

    for season in SEASONS:
        df = load_weekly(season)
        if df.empty:
            continue

        season_rows: list[dict] = []
        for _, r in df.iterrows():
            gsis_id = r.get("player_id")
            if not isinstance(gsis_id, str):
                continue

            sleeper_id = id_map.get(gsis_id)
            if not sleeper_id:
                skipped_no_sleeper += 1
                continue

            if sleeper_id not in known_player_ids:
                skipped_not_in_db += 1
                continue

            week = r.get("week")
            if pd.isna(week):
                continue

            row: dict[str, object] = {
                "player_id": sleeper_id,
                "season": int(season),
                "week": int(week),
                "stat_type": "weekly",
                "is_live": False,
                "source": "historical",
            }
            for src, dst in COLUMN_MAP.items():
                row[dst] = to_int(r.get(src))

            season_rows.append(row)

        print(f"  season {season}: {len(season_rows)} rows to upsert")
        for i in range(0, len(season_rows), BATCH_SIZE):
            batch = season_rows[i : i + BATCH_SIZE]
            upsert_batch(batch)
            total_upserted += len(batch)
            sys.stdout.write(
                f"\r  upserted {total_upserted} (season {season} batch {i // BATCH_SIZE + 1})"
            )
            sys.stdout.flush()
        sys.stdout.write("\n")

    print(
        f"Done. Upserted {total_upserted} rows. "
        f"Skipped {skipped_no_sleeper} (no sleeper_id) / "
        f"{skipped_not_in_db} (player not in DB)."
    )


if __name__ == "__main__":
    main()
