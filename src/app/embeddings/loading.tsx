export default function LoadingEmbeddings() {
  return <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6" role="status">
    <h1 className="text-2xl font-bold">Embedding leaderboard</h1>
    <p className="text-zinc-400 mt-4">Loading model rankings…</p>
    <div className="mt-8 space-y-3 animate-pulse" aria-hidden="true"><div className="h-36 rounded-xl bg-zinc-900" /><div className="h-64 rounded-xl bg-zinc-900" /></div>
  </div>;
}
