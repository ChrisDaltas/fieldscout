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
          'flex min-h-input flex-wrap items-center gap-1.5 rounded-md bg-surface-control px-2 py-1 transition-[background-color,box-shadow] hover:bg-n-4 focus-within:bg-white focus-within:shadow-field',
          atLimit && 'opacity-90',
        )}
      >
        {value.map((tag) => (
          <TagChip
            key={tag}
            name={tag}
            onRemove={() => onChange(value.filter((t) => t !== tag))}
            // White on the grey field, so the chip reads against it.
            className="bg-white"
          />
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
          className="min-w-[80px] flex-1 bg-transparent text-[11px] font-medium text-ink outline-none placeholder:text-n-6 disabled:cursor-not-allowed"
        />
      </div>

      {open && !atLimit && suggestions.length > 0 && (
        // A true overlay — the suggestion menu floats over the form, so it
        // carries its shadow at rest (CLAUDE.md → "Elevation" exception).
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-n-4 bg-white shadow-hard-6">
          <ul className="max-h-60 overflow-y-auto p-1">
            {suggestions.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  onClick={() => addTag(tag.name)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-[11px] font-medium text-ink hover:bg-surface-sunken"
                >
                  <span>{tag.name}</span>
                  <span className="text-[10px] font-medium text-n-6">
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
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] font-semibold text-accent hover:bg-surface-sunken"
                >
                  + Create &ldquo;{draft.trim()}&rdquo;
                </button>
              </li>
            )}
          </ul>
        </div>
      )}

      <p className="mt-1.5 text-[10px] font-medium text-n-6">
        {value.length} / {max} tags
      </p>
    </div>
  )
}
