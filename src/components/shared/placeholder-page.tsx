import { Card, CardContent } from '@/components/ui/card'

interface PlaceholderPageProps {
  title: string
  description?: string
  children?: React.ReactNode
}

/**
 * Honest empty-state scaffold for routes whose feature hasn't shipped yet —
 * the Field Scout empty-state recipe: bordered white card, heavy heading,
 * 13px muted line (decor spiral deliberately omitted).
 */
export function PlaceholderPage({
  title,
  description,
  children,
}: PlaceholderPageProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <h1 className="text-h4">{title}</h1>
        <p className="max-w-md text-[13px] font-medium text-n-3">
          {description ?? 'Coming soon.'}
        </p>
        {children != null && (
          <div className="mt-1 text-[13px] font-medium text-n-3">{children}</div>
        )}
      </CardContent>
    </Card>
  )
}
