'use client'

import { useEffect, useRef, useState } from 'react'

import { TagChip } from '@/components/lists/tag-chip'
import { useTags } from '@/hooks/use-tags'
import { MAX_TAGS_PER_LIST } from '@/types/schemas/lists'
import { cn } from '@/lib/utils'

interface TagInputProps {
  value: string[]
  onChange: (next: string[]) => void
  max?: number
  placeholder?: string
}

export function TagInput({
  value,
  onChange,
  max = MAX_TAGS_PER_LIST,
  placeholder = 'Add tag…',
}: TagInputProps) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const { data } = useTags({
    q: draft.trim() || undefined,
    systemOnly: false,
  })
  const suggestions = (data?.tags ?? [])
    .filter((t) => !value.includes(t.name))
    .slice(0, 8)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [])

  const atLimit = value.length >= max

  const addTag = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (value.includes(trimmed)) return
    if (value.length >= max) return
    onChange([...value, trimmed])
    setDraft('')
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-sm border border-ink bg-white px-2 py-2 transition-colors focus-within:border-accent',
          atLimit && 'opacity-90',
        )}
      >
        {value.map((tag) => (
          <TagChip key={tag} name={tag} onRemove={() => onChange(value.filter((t) => t !== tag))} />
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              addTag(draft)
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1))
            }
          }}
          disabled={atLimit}
          placeholder={
            atLimit ? `Max ${max} tags` : value.length === 0 ? placeholder : ''
          }
          className="min-w-[80px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-n-3 disabled:cursor-not-allowed"
        />
      </div>

      {open && !atLimit && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-sm border border-ink bg-white shadow-hard-4">
          <ul className="max-h-60 overflow-y-auto py-1">
            {suggestions.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  onClick={() => addTag(tag.name)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-accent-soft"
                >
                  <span>{tag.name}</span>
                  <span className="text-[10px] tracking-wider text-n-3">
                    {tag.is_system_tag ? 'System' : `${tag.use_count} uses`}
                  </span>
                </button>
              </li>
            ))}
            {draft.trim() && !suggestions.some((s) => s.name.toLowerCase() === draft.trim().toLowerCase()) && (
              <li>
                <button
                  type="button"
                  onClick={() => addTag(draft)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-accent-soft"
                >
                  + Create &ldquo;{draft.trim()}&rdquo;
                </button>
              </li>
            )}
          </ul>
        </div>
      )}

      <p className="mt-1.5 text-[10px] text-n-3">
        {value.length} / {max} tags
      </p>
    </div>
  )
}
