# WebSocket Relay Server

A lightweight Node.js WebSocket relay server that sits between the **forwarder** and **receiver** Chrome extensions. It authenticates clients, accepts notifications from forwarders, and fans them out to every connected receiver.

## Architecture

```
Forwarder Extension ──wss──▶ Cloud Run (this server) ──wss──▶ Receiver Extension(s)
```

The server exposes:

| Endpoint | Purpose |
|----------|---------|
| `wss://<host>/` | WebSocket endpoint for extensions |
| `GET /healthz` | Liveness probe – returns JSON with connection counts and uptime |
| `GET /readyz` | Readiness probe |

## Local Development

```bash
# Install dependencies
npm install

# Copy env and configure
cp env.example .env
# Edit .env – at minimum set a strong AUTH_TOKEN

# Run with auto-reload
npm run dev

# Or run directly
npm start
```

The server listens on `PORT` (default **8080**).

### Test Client

A built-in interactive CLI test tool is included:

```bash
node test-client.js
```

## Deploy to GCP Cloud Run

### Prerequisites

- [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed and authenticated
- A GCP project with billing enabled
- Artifact Registry or Container Registry enabled

### 1. Set Variables

```bash
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1            # pick your preferred region
export SERVICE_NAME=notification-relay
export AUTH_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "Save this token for extension config: $AUTH_TOKEN"
```

### 2. Build & Push the Container

Using Cloud Build (no local Docker required):

```bash
cd websocket-server

gcloud builds submit \
  --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME} \
  --project ${PROJECT_ID}
```

Or build locally and push:

```bash
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME} .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME}
```

### 3. Deploy

```bash
gcloud run deploy ${SERVICE_NAME} \
  --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME} \
  --platform managed \
  --region ${REGION} \
  --project ${PROJECT_ID} \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars "AUTH_TOKEN=${AUTH_TOKEN}" \
  --session-affinity \
  --min-instances 1 \
  --max-instances 3 \
  --timeout 3600 \
  --cpu 1 \
  --memory 256Mi
```

Key flags explained:

| Flag | Why |
|------|-----|
| `--session-affinity` | Routes returning WebSocket clients to the same container instance |
| `--min-instances 1` | Avoids cold-start latency for always-on WebSocket connections. Set to `0` to save cost if occasional cold starts are acceptable |
| `--timeout 3600` | Maximum request (connection) duration – 1 hour, the Cloud Run maximum. WebSocket connections idle longer will be dropped; clients should reconnect |
| `--allow-unauthenticated` | The extensions authenticate at the application level via `AUTH_TOKEN` |

### 4. Get the Service URL

```bash
gcloud run services describe ${SERVICE_NAME} \
  --region ${REGION} \
  --project ${PROJECT_ID} \
  --format 'value(status.url)'
```

The URL will look like `https://notification-relay-xxxxx-uc.a.run.app`.

### 5. Configure the Extensions

In both the **forwarder** and **receiver** extension popups:

- **Server URL**: `wss://notification-relay-xxxxx-uc.a.run.app` (replace `https://` with `wss://`)
- **Auth Token**: the `$AUTH_TOKEN` value from step 1

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP/WS listen port (Cloud Run sets this automatically) |
| `AUTH_TOKEN` | *(insecure default)* | Shared secret for client authentication |
| `HEARTBEAT_INTERVAL_MS` | `25000` | WebSocket ping interval. Must be shorter than Cloud Run's request timeout |

## Cloud Run Considerations

- **WebSocket timeout**: Cloud Run caps request duration at the `--timeout` value (max 3600s). Connections that exceed this are terminated. Both extensions already implement automatic reconnection.
- **Scale to zero**: With `--min-instances 0`, the container may shut down when idle. The first connection will incur a cold start (~1-2s). Use `--min-instances 1` if you need instant availability.
- **Session affinity**: Ensures a reconnecting client is routed back to the same instance where possible, preserving in-memory state.
- **Concurrency**: The default Cloud Run concurrency (80) is fine – each WebSocket connection is lightweight.
- **Cost**: With `--min-instances 1`, expect ~$5-15/month for a minimal CPU/memory configuration depending on region. With `--min-instances 0`, you only pay when connections are active.

## Health Checks

Cloud Run uses the startup/liveness probes automatically. You can also check manually:

```bash
curl https://notification-relay-xxxxx-uc.a.run.app/healthz
```

Returns:

```json
{
  "status": "ok",
  "forwarders": 1,
  "receivers": 2,
  "uptime": 3600.5
}
```
