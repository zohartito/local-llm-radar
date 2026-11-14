import { notFound, redirect } from 'next/navigation';

const destinations: Record<string, string> = {
  images: '/leaderboards/more', video: '/leaderboards/video-understanding',
  audio: '/leaderboards/audio-understanding', documents: '/leaderboards/document-parsing',
};
export const dynamicParams = false;
export function generateStaticParams() { return Object.keys(destinations).map(task => ({ task })); }
export default async function LegacyTaskPage({ params }: { params: Promise<{ task: string }> }) {
  const { task } = await params;
  if (!Object.hasOwn(destinations, task)) notFound();
  redirect(destinations[task]);
}
