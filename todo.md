# Crucible Manual Tasks & Environment Setup

## Required User Configuration

1. **OpenRouter API Key**:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Obtain an OpenRouter API key from [OpenRouter Keys](https://openrouter.ai/keys).
   - Set the key in `.env`:
     ```env
     OPENROUTER_API_KEY="sk-or-v1-your-api-key-here"
     ```
   - *(Alternatively)*: When launching the Web UI at `http://localhost:3000`, the **Setup Wizard** allows you to input and validate your API key directly on first run.

2. **Self-Hosted Docker Stack Launch**:
   - Run the one-command stack startup:
     ```bash
     docker compose up --build -d
     ```
   - Verify health of all services:
     ```bash
     docker compose ps
     ```
