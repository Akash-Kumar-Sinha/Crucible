# Crucible Configuration & Environment Secrets Checklist

## LLM Gateway
- [ ] **OpenRouter API Key**: Set `OPENROUTER_API_KEY` in your local `.env` or deployment secret from [OpenRouter Keys](https://openrouter.ai/keys).

## Self-Hosted LiveKit Real-Time Voice Infrastructure
- [ ] **LiveKit API Key & Secret**: Replace default development credentials (`crucible_dev_key` and `crucible_livekit_secret_key_32_chars_long`) with high-entropy keys in production environments (`infra/docker/livekit-server.yaml`, Kubernetes `secrets.yaml`, and `.env`).
- [ ] **LiveKit Host URL**: Ensure `LIVEKIT_URL` / `NEXT_PUBLIC_LIVEKIT_URL` resolves to your self-hosted instance (e.g., `ws://localhost:7880` or `wss://livekit.yourdomain.com`).

## Speech-to-Text (STT) Engines (Optional)
- [ ] **Deepgram Nova-2 API Key** (Optional): Add `DEEPGRAM_API_KEY` to enable cloud-hosted high-throughput streaming transcription.
- [ ] **Whisper API Key / Endpoint** (Optional): Add `WHISPER_API_KEY` or custom self-hosted `WHISPER_ENDPOINT_URL` (e.g., `http://localhost:8000/v1/audio/transcriptions`) for offline GPU Whisper transcription.
