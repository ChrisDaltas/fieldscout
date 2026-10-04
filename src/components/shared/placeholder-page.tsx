import { PageHeader } from '@/components/layout/app-header'
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
 *
 * The page title is the shell's standard header (F577, D487). The card keeps
 * the name as its empty-state heading (`h2`, the empty-state `text-h5`) so a
 * phone — where the shell hides its header — still says what this page is.
 */
export function PlaceholderPage({ title, description, children }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <CardContent className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <h2 className="text-h5">{title}</h2>
          <p className="max-w-md text-[13px] font-medium text-n-3">
            {description ?? 'Coming soon.'}
          </p>
          {children != null && (
            <div className="mt-1 text-[13px] font-medium text-n-3">{children}</div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
