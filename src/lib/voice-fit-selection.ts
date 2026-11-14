import type { VoiceFitCatalog, VoiceFitRow, VoiceMachineId } from './voice-fit';

export type VoiceIntent = 'coding-agents' | 'conversation';

/** Explicit runtime-specific assessment; never pools GPUs or treats file size as peak memory. */
export function voiceFitForMachine(row: VoiceFitRow, machine: VoiceMachineId) {
  return row.fits[machine];
}

export function voiceShortlist(catalog: VoiceFitCatalog, machine: VoiceMachineId, intent: VoiceIntent) {
  if (intent === 'coding-agents') {
    return catalog.rows.filter(row => row.architecture === 'speech-bridge');
  }
  return catalog.rows.filter(row =>
    ['native-full-duplex', 'cascade-full-duplex'].includes(row.architecture) &&
    ['candidate', 'measured'].includes(voiceFitForMachine(row, machine).status)
  );
}
