export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-secondary/20 px-4">
      <div className="mb-8 text-center">
        <h1 className="font-silkscreen text-4xl font-bold tracking-[-0.1em]">FieldScout</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fantasy football, ranked.
        </p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
