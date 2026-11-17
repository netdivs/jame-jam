import Link from "next/link";

export const metadata = { title: "Not allowed" };

export default async function Forbidden({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-fg">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-muted">
          Ask the Owner to grant you the permission{p ? <> <code className="rounded bg-surface-2 px-1">{p}</code></> : null}.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
