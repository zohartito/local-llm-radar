# English voice for sustained coding-agent work

Source review: **2026-10-23**. No speech model was installed or benchmarked in this review.

The target is spoken interaction with the same capable, persistent Codex or Claude
Code agent used in the desktop app. A natural-sounding local speech model is not
evidence of equivalent reasoning, tool use, workspace access or task persistence.

## Recommended direction

Preserve the real agent session and its model, effort, context, tool loop and
permissions. Add speech recognition as input and speech synthesis for useful
progress/results. The agent must continue working while the microphone is idle;
interrupting playback should be separate from cancelling the coding task.

First check [native Codex Voice](https://learn.chatgpt.com/docs/features/voice),
which documents voice inside the current task with its selected model and
permissions. This account's availability was not verified. [Claude Code voice
dictation](https://code.claude.com/docs/en/voice-dictation) supplies spoken input.
These are hosted reference options, not local speech-model benchmarks.

For a local speech layer, start with existing [Scrivo](https://github.com/zohartito/scrivo)
dictation and [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) output. Scrivo's
optional [Nemotron streaming ASR](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b)
path is Mac-only; Windows uses Whisper. Existing WSL Parakeet and Kokoro services
were reported active in the read-only inventory, which does not measure recognition
accuracy, latency or a connected agent workflow. A bridge remains to be built and
tested through [Codex App Server](https://learn.chatgpt.com/docs/app-server) or
[Claude Code's programmatic harness](https://code.claude.com/docs/en/headless).
An interchangeable text-completion endpoint is insufficient to establish this.
Local speech with a hosted coding model is not fully offline coding.

## Hardware and shortlist

Live capacity inventory was confirmed on 2026-10-23: RTX A6000 (48 GiB class),
RTX 4070 Ti SUPER (16 GiB class), PC system RAM (128 GiB class), and M4 Max
(64 GiB unified). Memory occupied by other workloads was not reclaimed. Each GPU
is a separate device; 48 + 16 is not a 64 GiB device. Unified memory includes OS
and application use. Published GB values are retained verbatim; the UI's candidate
labels are reviewed inferences, not computed guaranteed fits.

| Runtime | Relevant evidence | Meaning for this task |
| --- | --- | --- |
| [PersonaPlex official CUDA](https://github.com/NVIDIA/personaplex) | Native duplex, role and voice controls, CPU offload; no official numeric minimum established | A6000 conversation trial; no established coding-harness tools |
| [MiniCPM-o 4.5 C++ / PyTorch](https://github.com/OpenBMB/MiniCPM-V/blob/main/docs/minicpm_o4dot5_en.md) | C++ full-duplex: NVIDIA ≥12 GB or M4 Max ≥24 GB; PyTorch demo ≥28 GB | Explicit runtime-dependent capacity choices; English/Chinese drift remains relevant |
| [NemotronLabs VoiceChat 11B official](https://github.com/NVIDIA-NeMo/Speech/blob/nemotron-labs-voicechat/README.md) | Official ≥80 GB GPU requirement | Neither PC GPU meets the official requirement |
| [VoiceChat MLX Swift](https://github.com/soniqo/speech-swift/blob/main/docs/models/voicechat.md) | Community INT5 port; published M5 Pro peaks differ from bundle size | Mac research candidate; this M4 Max and long sessions are untested |
| [Speakrail](https://github.com/speakrail/speakrail) | Full-duplex cascade and assistant tools; developer tested RTX 4090, expects 24 GB NVIDIA cards | A6000 capacity candidate; not a turnkey Codex/Claude bridge |
| [Unmute](https://github.com/kyutai-labs/unmute) | Default ≥16 GB CUDA; configurable LLM, tool calling not yet supported | Speech-pipeline candidate; coding-harness adapter still required |

The complete attributed claims, requirements and conditions are in
`data/voice-fit.json`, served by `/api/voice`. No speech candidate gets a Capability
Score. Do not transfer Nemotron 3 VoiceChat 12B benchmark results to the distinct
NemotronLabs VoiceChat 11B release. A source-check date is not an evaluation date.

## What a useful local evaluation must record

Use identical English prompts and preserve exact model/runtime/quantization,
hardware, free-memory baseline, context, audio device and workload duration. Record:

- End-of-speech to first audible response, separately from ASR finalization, model
  first token, TTS startup and time to finish the requested coding task.
- Recognition of filenames, code identifiers and corrections; false interruptions
  and whether a spoken correction reaches the same live agent session.
- Peak GPU memory or unified-memory footprint with measurement method, not file
  size; short runs and sustained sessions separately.
- A real task requiring edits, tests and failure recovery, plus agent work after
  microphone silence. Speech output must not silently end or replace the agent loop.

Store auditable receipts before changing any cell to a local measurement. The
schema requires machine/runtime/workload/date metadata and consistent source IDs;
it cannot verify a factual run merely from a receipt path string. No model downloads,
license acceptance, service changes, scheduler, harness execution or deployment
were part of this implementation.
