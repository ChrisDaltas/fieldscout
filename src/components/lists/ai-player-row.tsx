interface AiPlayerRowProps {
  rank: number
  name: string
  team: string
  rationale: string
}

/** One generated player in the AI results preview, rationale on hover/tap. */
export function AiPlayerRow({ rank, name, team, rationale }: AiPlayerRowProps) {
  return (
    <li
      title={rationale}
      className="flex items-start gap-3 rounded-md bg-bg-elevated-2 px-3 py-2"
    >
      <span className="w-6 shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums text-text-tertiary">
        {rank}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {name} <span className="font-normal text-text-tertiary">{team}</span>
        </p>
        <p className="line-clamp-2 text-xs text-text-secondary">{rationale}</p>
      </div>
    </li>
  )
}
