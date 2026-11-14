import { loadVoiceFitCatalog } from '@/lib/voice-fit-catalog';

export const dynamic = 'force-static';

export function GET() {
  return Response.json(loadVoiceFitCatalog());
}
