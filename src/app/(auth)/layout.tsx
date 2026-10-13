import { LogoTile, Wordmark } from '@/components/landing/fieldscout-logo'

/** v7 auth shell: logo lockup over a centred ~360px card on white. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <h1 className="flex items-center gap-2.5 text-ink">
          <LogoTile size={30} />
          <Wordmark height={16} />
        </h1>
        <p className="text-[11px] font-medium text-n-6">
          Fantasy football, ranked.
        </p>
      </div>
      <div className="w-full max-w-[360px]">{children}</div>
    </div>
  )
}
