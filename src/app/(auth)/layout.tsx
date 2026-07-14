import { Wordmark } from '@/components/shared/wordmark'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-page px-4 py-10">
      <div className="mb-7 text-center">
        <h1 className="text-4xl text-ink">
          <Wordmark />
        </h1>
        <p className="mt-1.5 text-[13px] font-medium text-n-3">
          Fantasy football, ranked.
        </p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
