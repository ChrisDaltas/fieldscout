'use client'

import { useState } from 'react'

import { LineupDemo } from '@/components/landing/lineup-demo'
import { ScoutAIDemo } from '@/components/landing/scout-ai-demo'
import { cn } from '@/lib/utils'

const QUESTIONS = [
  { key: 'find', chip: 'Find me a waiver WR' },
  { key: 'sit', chip: 'Who do I start?' },
  { key: 'lineup', chip: 'Swap him if he sits' },
] as const

type QuestionKey = (typeof QUESTIONS)[number]['key']

/**
 * The hero's Scout AI demo with three question chips: picking one plays that
 * scripted answer from the start. Scripted marketing demos, not live.
 */
export function HeroDemo({ week }: { week?: number }) {
  const [question, setQuestion] = useState<QuestionKey>('find')

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Try a question">
        <span className="mr-1 hidden text-[14px] font-medium text-fs-text-3 sm:inline">Try one:</span>
        {QUESTIONS.map((q) => (
          <button
            key={q.key}
            type="button"
            aria-pressed={question === q.key}
            onClick={() => setQuestion(q.key)}
            className={cn(
              'h-9 rounded-pill px-4 text-[14px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fs-blue',
              question === q.key
                ? 'bg-fs-ink text-white'
                : 'bg-white text-fs-ink shadow-fs-ring hover:bg-fs-fill',
            )}
          >
            {q.chip}
          </button>
        ))}
      </div>
      {/* `key` remounts the demo so the chosen answer plays from the top. */}
      <div className="mx-auto mt-5 w-full max-w-[920px]">
        {question === 'lineup' ? (
          <LineupDemo key="lineup" week={week} />
        ) : (
          <ScoutAIDemo key={question} mode={question} week={week} />
        )}
      </div>
    </div>
  )
}
