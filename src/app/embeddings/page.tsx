import type { Metadata } from 'next';
import { EmbeddingExplorer } from '@/components/EmbeddingExplorer';
import { EMBEDDING_TESTS, type EmbeddingSnapshot } from '@/lib/embedding-catalog';
import { getSpecialistData } from '@/lib/specialist-service';

export const metadata: Metadata = { title: 'Best embedding models for your files | Local LLM Radar', description: 'Compare text and multimodal embedding models. Find one model for text, images, audio, and video, with separate test results and clear input labels.' };
export const dynamic = 'force-dynamic';

export default async function EmbeddingsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [params, data] = await Promise.all([searchParams, Promise.all(EMBEDDING_TESTS.map(test => getSpecialistData(test.id)))]);
  const snapshots: EmbeddingSnapshot[] = data.filter(value => value !== null);
  return <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
    <EmbeddingExplorer key={params.view ?? 'text'} snapshots={snapshots} initialView={params.view ?? 'text'} />
  </div>;
}
