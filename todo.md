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

3. **Kubernetes Migration & Deployment (kind / minikube)**:
   - Create local kind cluster:
     ```bash
     make k8s-cluster
     ```
   - Configure secrets (set your OpenRouter API key):
     ```bash
     kubectl create namespace crucible --dry-run=client -o yaml | kubectl apply -f -
     kubectl -n crucible create secret generic crucible-secrets \
       --from-literal=OPENROUTER_API_KEY="sk-or-v1-your-key-here" \
       --from-literal=POSTGRES_PASSWORD="crucible_secret" \
       --dry-run=client -o yaml | kubectl apply -f -
     ```
   - Apply Kustomize manifests:
     ```bash
     make k8s-apply
     ```
   - Verify pods and jobs under restricted PodSecurity standard:
     ```bash
     kubectl -n crucible get pods -w
     ```
