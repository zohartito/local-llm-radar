import { NextResponse } from 'next/server';
import { getSpecialistData } from '@/lib/specialist-service';
import { getSpecialistBoard, rankSpecialistRows } from '@/lib/model-types';
import { redactSpecialistRowsForPublicApi, specialistApiTerms } from '@/lib/public-api';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const board = getSpecialistBoard(type);
  if (!board) return NextResponse.json({ error: 'Unknown specialist leaderboard' }, { status: 404 });
  const data = await getSpecialistData(type);
  if (!data) return NextResponse.json({ error: 'Unknown specialist leaderboard' }, { status: 404 });
  return NextResponse.json({ ...data, source: board.source, sourceUrl: board.sourceUrl, metric: board.metric, direction: board.direction, unit: board.unit, rows: redactSpecialistRowsForPublicApi(board, rankSpecialistRows(data.rows, board.direction)), dataLicence: specialistApiTerms(board) }, { status: data.status === 'unavailable' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
