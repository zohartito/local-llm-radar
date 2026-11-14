"use client";

export function DataLoadError({ message = 'The data request failed. No current results could be verified.' }: { message?: string }) {
  return <div role="alert" className="mx-auto my-6 max-w-5xl rounded-lg border border-amber-700/50 p-4 text-sm text-amber-300">
    <p>{message}</p>
    <button className="mt-3 underline" onClick={() => window.location.reload()}>Retry</button>
  </div>;
}
