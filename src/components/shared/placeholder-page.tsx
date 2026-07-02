import { Card, CardContent } from '@/components/ui/card'

interface PlaceholderPageProps {
  title: string
  description?: string
  children?: React.ReactNode
}

export function PlaceholderPage({
  title,
  description,
  children,
}: PlaceholderPageProps) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        )}
      </header>
      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="p-6 text-sm text-text-secondary">
          {children ?? 'Coming soon.'}
        </CardContent>
      </Card>
    </div>
  )
}
