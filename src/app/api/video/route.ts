import { loadVideoFitCatalog } from '@/lib/video-fit';
import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

export async function GET() {
  const catalog = loadVideoFitCatalog();
  return NextResponse.json(catalog);
}
