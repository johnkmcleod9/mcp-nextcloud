# Multi-Agent MCP with Secure External Access — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multiple Nextcloud MCP agent personas with bearer-token-authenticated external access via Traefik.

**Architecture:** Each agent persona runs as a separate Docker container from the same image, differing only by env vars (Nextcloud credentials + auth tokens). Traefik handles TLS and path-based routing. Bearer token auth is validated in the MCP server code with timing-safe comparison. Internal Docker network clients bypass auth automatically.

**Tech Stack:** TypeScript, Express, Node.js crypto, Docker Compose, Traefik, Nextcloud OCC CLI

**Spec:** `docs/superpowers/specs/2026-03-12-multi-agent-secure-access-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/http-server.ts` | Modify | Add bearer token auth middleware, trust proxy, disable query-param override |
| `docker-compose.yml` | Replace | Multi-service compose with YAML anchors, per-agent volumes |
| `.env.example` | Create | Template for required environment variables |

**Infrastructure files (on canspace server):**

| File | Action | Responsibility |
|---|---|---|
| `/opt/docker/mcp-nextcloud/docker-compose.yml` | Replace | Deployed compose file |
| `/opt/docker/mcp-nextcloud/.env` | Update | Add new agent passwords and auth tokens |
| `/opt/docker/traefik/config/mcp-nextcloud.yml` | Create | Traefik dynamic config for path-based routing |

---

## Chunk 1: Bearer Token Auth

### Task 1: Add bearer token auth middleware to http-server.ts

**Files:**
- Modify: `src/http-server.ts`

- [ ] **Step 1: Add crypto import and auth config constants**

At the top of `src/http-server.ts`, after the existing imports (after the `prefixToolName` import), add:

```typescript
import crypto from 'crypto';

// Auth configuration
const AUTH_TOKENS: string[] = process.env.MCP_AUTH_TOKEN
  ? process.env.MCP_AUTH_TOKEN.split(',').map(t => t.trim()).filter(Boolean)
  : [];
const AUTH_ENABLED = AUTH_TOKENS.length > 0;
const AUTH_BYPASS_PRIVATE = process.env.MCP_AUTH_BYPASS_PRIVATE !== 'false'; // default true
```

- [ ] **Step 2: Add the auth middleware function**

After the auth config constants, add:

```typescript
// Bearer token authentication middleware
function requireAuth(req: Request, res: Response, next: () => void): void {
  // If auth is not configured, allow all requests
  if (!AUTH_ENABLED) {
    next();
    return;
  }

  // If private bypass is enabled and request has no X-Forwarded-For,
  // it came directly on the Docker network (not through Traefik)
  if (AUTH_BYPASS_PRIVATE && !req.headers['x-forwarded-for']) {
    next();
    return;
  }

  // Extract bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
    console.warn(`🔒 Auth failed: missing token from ${clientIp} at ${new Date().toISOString()}`);
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Unauthorized: invalid or missing bearer token' },
      id: null,
    });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer '
  const tokenBuffer = Buffer.from(token);

  // Check against all valid tokens using timing-safe comparison
  const isValid = AUTH_TOKENS.some(validToken => {
    const validBuffer = Buffer.from(validToken);
    if (tokenBuffer.length !== validBuffer.length) return false;
    return crypto.timingSafeEqual(tokenBuffer, validBuffer);
  });

  if (!isValid) {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
    console.warn(`🔒 Auth failed: invalid token from ${clientIp} at ${new Date().toISOString()}`);
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Unauthorized: invalid or missing bearer token' },
      id: null,
    });
    return;
  }

  next();
}
```

- [ ] **Step 3: Configure Express trust proxy**

After the line `app.use(express.json());`, add:

```typescript
// Trust proxy headers when behind Traefik so req.ip reflects the real client
app.set('trust proxy', 'loopback,linklocal,uniquelocal');
```

- [ ] **Step 4: Add auth middleware to /analytics route**

Find `app.get('/analytics',` and add `requireAuth` as the second argument:

Change:
```typescript
app.get('/analytics', (req: Request, res: Response) => {
```
To:
```typescript
app.get('/analytics', requireAuth, (req: Request, res: Response) => {
```

**Note:** The `/analytics/dashboard` route intentionally does NOT get auth middleware. The dashboard HTML page is protected by auth, but the in-page JavaScript `fetch('/analytics')` would fail with 401 since browsers don't forward bearer tokens in AJAX requests. Instead, the dashboard itself is accessed only by internal clients (Docker network, where auth is bypassed). External users who need analytics should use the JSON endpoint with a bearer token: `curl -H 'Authorization: Bearer <token>' .../analytics`.

**Note:** The `/health` endpoint intentionally has NO auth middleware, so Docker health checks and Traefik health probes work without tokens.

- [ ] **Step 5: Add auth middleware to the /mcp route**

Find `app.all('/mcp',` and add `requireAuth` as the second argument:

Change:
```typescript
app.all('/mcp', async (req: Request, res: Response) => {
```
To:
```typescript
app.all('/mcp', requireAuth, async (req: Request, res: Response) => {
```

- [ ] **Step 6: Disable query-param credential override when auth is enabled**

Find the `initializeCredentials` function and replace the entire function with:

```typescript
function initializeCredentials(req?: Request): void {
  // When auth is enabled, credentials come exclusively from env vars.
  // This prevents a valid token holder from redirecting to a different Nextcloud instance.
  const host = (!AUTH_ENABLED ? req?.query.nextcloudHost as string : undefined) || process.env.NEXTCLOUD_HOST;
  const username = (!AUTH_ENABLED ? req?.query.nextcloudUsername as string : undefined) || process.env.NEXTCLOUD_USERNAME;
  const password = (!AUTH_ENABLED ? req?.query.nextcloudPassword as string : undefined) || process.env.NEXTCLOUD_PASSWORD;

  if (host && username && password) {
    setCredentials(host, username, password);
  }
}
```

- [ ] **Step 7: Build and verify TypeScript compiles**

Run: `cd /Users/johnkmcleod/dev-john/mcp-nextcloud && npm run build`
Expected: Clean build with no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/johnkmcleod/dev-john/mcp-nextcloud
git add src/http-server.ts
git commit -m "feat: add bearer token auth middleware with timing-safe comparison"
```

---

### Task 2: Create docker-compose.yml and .env.example

**Files:**
- Replace: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Replace docker-compose.yml**

Replace the contents of `docker-compose.yml` with:

```yaml
x-mcp-base: &mcp-base
  image: mcp-nextcloud:latest
  build: .
  restart: unless-stopped
  networks: [proxy, nextcloud-aio]
  healthcheck:
    test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 10s
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"

services:
  mcp-nc-assistant:
    <<: *mcp-base
    container_name: mcp-nc-assistant
    environment:
      - NEXTCLOUD_HOST=http://nextcloud-aio-apache:11000
      - NEXTCLOUD_USERNAME=ai-assistant
      - NEXTCLOUD_PASSWORD=${ASSISTANT_PASSWORD}
      - MCP_AUTH_TOKEN=${CLIENT_AUTH_TOKENS}
      - MCP_AUTH_BYPASS_PRIVATE=true
    volumes:
      - analytics-assistant:/app/data

  mcp-nc-marketing:
    <<: *mcp-base
    container_name: mcp-nc-marketing
    environment:
      - NEXTCLOUD_HOST=http://nextcloud-aio-apache:11000
      - NEXTCLOUD_USERNAME=ai-marketing
      - NEXTCLOUD_PASSWORD=${MARKETING_PASSWORD}
      - MCP_AUTH_TOKEN=${CLIENT_AUTH_TOKENS}
      - MCP_AUTH_BYPASS_PRIVATE=true
    volumes:
      - analytics-marketing:/app/data

  mcp-nc-finance:
    <<: *mcp-base
    container_name: mcp-nc-finance
    environment:
      - NEXTCLOUD_HOST=http://nextcloud-aio-apache:11000
      - NEXTCLOUD_USERNAME=ai-finance
      - NEXTCLOUD_PASSWORD=${FINANCE_PASSWORD}
      - MCP_AUTH_TOKEN=${CLIENT_AUTH_TOKENS}
      - MCP_AUTH_BYPASS_PRIVATE=true
    volumes:
      - analytics-finance:/app/data

volumes:
  analytics-assistant:
  analytics-marketing:
  analytics-finance:

networks:
  proxy:
    external: true
  nextcloud-aio:
    external: true
```

- [ ] **Step 2: Create .env.example**

Create `.env.example` with:

```bash
# Nextcloud account passwords (app passwords from Nextcloud Security settings)
ASSISTANT_PASSWORD=
MARKETING_PASSWORD=
FINANCE_PASSWORD=

# Bearer tokens for external clients (comma-separated)
# Generate with: openssl rand -hex 32
CLIENT_AUTH_TOKENS=
```

- [ ] **Step 3: Verify .env.example is not gitignored, but .env is**

Check `.gitignore` for `.env` entry. If missing, add `.env` to `.gitignore` (but NOT `.env.example`).

Run: `cd /Users/johnkmcleod/dev-john/mcp-nextcloud && grep -q '^\.env$' .gitignore && echo 'OK' || echo '.env >> .gitignore'`

If `.env` is not in `.gitignore`, add it:
```bash
echo '.env' >> .gitignore
```

- [ ] **Step 4: Commit**

```bash
cd /Users/johnkmcleod/dev-john/mcp-nextcloud
git add docker-compose.yml .env.example .gitignore
git commit -m "feat: multi-agent docker-compose with YAML anchors and env template"
```

---

## Chunk 2: Nextcloud Accounts & Infrastructure

### Task 3: Create Nextcloud accounts and groups

This task runs commands on canspace via SSH. All Nextcloud OCC commands run inside the `nextcloud-aio-nextcloud` container.

**Prerequisites:** SSH access to canspace.

- [ ] **Step 1: Create the Marketing group**

```bash
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ group:add Marketing"
```

Expected: `Created group "Marketing"` (or already exists message).

- [ ] **Step 2: Create the Finance group**

```bash
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ group:add Finance"
```

Expected: `Created group "Finance"`.

- [ ] **Step 3: Create the ai-marketing account**

```bash
ssh canspace "sudo docker exec nextcloud-aio-nextcloud env OC_PASS=temppass123 php occ user:add ai-marketing --password-from-env --display-name='AI Marketing Assistant' --group='AI Agents' --group='Marketing'"
```

Expected: `The user "ai-marketing" was created successfully`.

- [ ] **Step 4: Create the ai-finance account**

```bash
ssh canspace "sudo docker exec nextcloud-aio-nextcloud env OC_PASS=temppass123 php occ user:add ai-finance --password-from-env --display-name='AI Finance Assistant' --group='AI Agents' --group='Finance'"
```

Expected: `The user "ai-finance" was created successfully`.

- [ ] **Step 5: Generate app passwords for the new accounts**

Log into Nextcloud as admin, use Impersonate to switch to each new account, then go to Settings > Security > App passwords to generate an app password for each. Record these — they go into the `.env` file on canspace.

Alternatively, use the OCS API:

```bash
# For ai-marketing
ssh canspace "sudo docker exec nextcloud-aio-nextcloud curl -s -u ai-marketing:temppass123 -H 'OCS-APIRequest: true' -X POST 'http://localhost/ocs/v2.php/core/getapppassword' | grep -o '<apppassword>[^<]*' | sed 's/<apppassword>//'"

# For ai-finance
ssh canspace "sudo docker exec nextcloud-aio-nextcloud curl -s -u ai-finance:temppass123 -H 'OCS-APIRequest: true' -X POST 'http://localhost/ocs/v2.php/core/getapppassword' | grep -o '<apppassword>[^<]*' | sed 's/<apppassword>//'"
```

Record the app passwords — they're needed in Task 5.

- [ ] **Step 6: Create Marketing Group Folder**

```bash
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ groupfolders:create 'Marketing'"
```

Expected: Returns a folder ID (e.g., `9`).

```bash
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ groupfolders:group <ID> 'Marketing' write share delete"
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ groupfolders:group <ID> 'AI Agents' write share delete"
```

Replace `<ID>` with the returned folder ID.

- [ ] **Step 7: Create Finance Group Folder**

```bash
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ groupfolders:create 'Finance'"
```

Expected: Returns a folder ID (e.g., `10`).

```bash
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ groupfolders:group <ID> 'Finance' write share delete"
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ groupfolders:group <ID> 'AI Agents' write share delete"
```

Replace `<ID>` with the returned folder ID.

- [ ] **Step 8: Verify all accounts and groups**

```bash
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ user:info ai-marketing --output=json 2>&1 | python3 -c \"import sys,json; d=json.load(sys.stdin); print('Groups:', d.get('groups'))\""
ssh canspace "sudo docker exec nextcloud-aio-nextcloud php occ user:info ai-finance --output=json 2>&1 | python3 -c \"import sys,json; d=json.load(sys.stdin); print('Groups:', d.get('groups'))\""
```

Expected: Each shows `['AI Agents', 'Marketing']` and `['AI Agents', 'Finance']` respectively.

---

### Task 4: Configure DNS for mcp.canspace.ca

**Prerequisites:** Cloudflare account access for canspace.ca DNS.

- [ ] **Step 1: Update DNS record for mcp.canspace.ca**

In Cloudflare dashboard for `canspace.ca`:
- Find the existing `mcp` record (currently proxied through Cloudflare)
- Change it to **DNS only** (grey cloud, not orange) so Traefik handles TLS directly
- Set the A record value to `148.113.175.249` (the server's public IP)

If no record exists, create:
- Type: `A`
- Name: `mcp`
- Content: `148.113.175.249`
- Proxy status: **DNS only** (grey cloud)

- [ ] **Step 2: Verify DNS resolves to server IP**

Wait 1-2 minutes for propagation, then:

```bash
dig +short mcp.canspace.ca A
```

Expected: `148.113.175.249` (the server's actual IP, NOT Cloudflare proxy IPs like 104.x or 172.67.x).

---

### Task 5: Deploy to canspace

**Prerequisites:** Tasks 1-4 completed. App passwords recorded from Task 3.

- [ ] **Step 1: Generate bearer tokens for external clients**

Run locally:

```bash
echo "Claude Code:    $(openssl rand -hex 32)"
echo "Claude Desktop: $(openssl rand -hex 32)"
echo "openclaw:       $(openssl rand -hex 32)"
```

Record all three tokens.

- [ ] **Step 2: Push code to canspace**

```bash
cd /Users/johnkmcleod/dev-john/mcp-nextcloud
git push origin master
```

Then on canspace:

```bash
ssh canspace "cd /opt/docker/mcp-nextcloud && git pull"
```

- [ ] **Step 3: Update .env on canspace**

```bash
ssh canspace "cat > /opt/docker/mcp-nextcloud/.env << 'ENVEOF'
# Nextcloud account passwords (app passwords)
ASSISTANT_PASSWORD=<ai-assistant app password>
MARKETING_PASSWORD=<ai-marketing app password from Task 3>
FINANCE_PASSWORD=<ai-finance app password from Task 3>

# Bearer tokens for external clients (comma-separated)
CLIENT_AUTH_TOKENS=<claude-code-token>,<claude-desktop-token>,<openclaw-token>
ENVEOF"
```

Replace the placeholder values with actual passwords and tokens.

- [ ] **Step 4: Stop the old container**

```bash
ssh canspace "cd /opt/docker/mcp-nextcloud && docker compose down"
```

Expected: `mcp-nextcloud` container stops and is removed.

- [ ] **Step 5: Build and start all agent containers**

```bash
ssh canspace "cd /opt/docker/mcp-nextcloud && docker compose build && docker compose up -d"
```

Expected: Three containers start: `mcp-nc-assistant`, `mcp-nc-marketing`, `mcp-nc-finance`.

- [ ] **Step 6: Verify all containers are healthy**

```bash
ssh canspace "docker ps --filter 'name=mcp-nc-' --format 'table {{.Names}}\t{{.Status}}'"
```

Expected: All three show `Up ... (healthy)`.

- [ ] **Step 7: Test internal health endpoints**

```bash
ssh canspace "curl -s http://mcp-nc-assistant:8080/health 2>/dev/null || docker exec mcp-nc-assistant wget -qO- http://localhost:8080/health"
ssh canspace "docker exec mcp-nc-marketing wget -qO- http://localhost:8080/health"
ssh canspace "docker exec mcp-nc-finance wget -qO- http://localhost:8080/health"
```

Expected: Each returns `{"status":"healthy",...}`.

---

### Task 6: Create Traefik routing config

**Prerequisites:** Task 4 (DNS) and Task 5 (containers running).

- [ ] **Step 1: Create the Traefik dynamic config file**

```bash
ssh canspace "cat > /opt/docker/traefik/config/mcp-nextcloud.yml << 'EOF'
http:
  routers:
    mcp-assistant:
      rule: \"Host(\`mcp.canspace.ca\`) && PathPrefix(\`/assistant\`)\"
      service: mcp-nc-assistant
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [strip-assistant]

    mcp-marketing:
      rule: \"Host(\`mcp.canspace.ca\`) && PathPrefix(\`/marketing\`)\"
      service: mcp-nc-marketing
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [strip-marketing]

    mcp-finance:
      rule: \"Host(\`mcp.canspace.ca\`) && PathPrefix(\`/finance\`)\"
      service: mcp-nc-finance
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [strip-finance]

  middlewares:
    strip-assistant:
      stripPrefix:
        prefixes: [\"/assistant\"]
    strip-marketing:
      stripPrefix:
        prefixes: [\"/marketing\"]
    strip-finance:
      stripPrefix:
        prefixes: [\"/finance\"]

  services:
    mcp-nc-assistant:
      loadBalancer:
        servers:
          - url: \"http://mcp-nc-assistant:8080\"
    mcp-nc-marketing:
      loadBalancer:
        servers:
          - url: \"http://mcp-nc-marketing:8080\"
    mcp-nc-finance:
      loadBalancer:
        servers:
          - url: \"http://mcp-nc-finance:8080\"
EOF"
```

Traefik auto-reloads (file provider with `watch: true`).

- [ ] **Step 2: Verify Traefik is on the proxy network**

```bash
ssh canspace "docker network inspect proxy --format '{{range .Containers}}{{.Name}} {{end}}' | tr ' ' '\n' | grep traefik"
```

Expected: Shows `traefik` (or the Traefik container name). If not found, Traefik won't be able to route to the MCP containers.

- [ ] **Step 3: Verify Traefik picked up the config**

Wait 5 seconds, then:

```bash
ssh canspace "docker logs traefik 2>&1 | tail -5"
```

Expected: No errors about `mcp-nextcloud.yml`. May see log lines about new routers being created.

- [ ] **Step 4: Test external health endpoint (no auth required)**

```bash
curl -s https://mcp.canspace.ca/assistant/health
```

Expected: `{"status":"healthy",...}`. This confirms DNS + Traefik + TLS + path routing all work.

- [ ] **Step 5: Test external /mcp without token (should fail)**

```bash
curl -s -X POST https://mcp.canspace.ca/assistant/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

Expected: HTTP 401 with `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Unauthorized: invalid or missing bearer token"},"id":null}`.

- [ ] **Step 6: Test external /mcp with valid token**

```bash
curl -s -X POST https://mcp.canspace.ca/assistant/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <claude-code-token>' \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

Replace `<claude-code-token>` with the actual token generated in Task 5 Step 1.

Expected: HTTP 200 with MCP initialization response containing server capabilities.

- [ ] **Step 7: Test external /analytics with token (should require auth)**

```bash
curl -s https://mcp.canspace.ca/assistant/analytics
```

Expected: HTTP 401 (analytics requires auth when `MCP_AUTH_TOKEN` is set).

```bash
curl -s -H 'Authorization: Bearer <claude-code-token>' https://mcp.canspace.ca/assistant/analytics
```

Expected: HTTP 200 with analytics JSON.

- [ ] **Step 8: Test all three agents externally**

```bash
curl -s https://mcp.canspace.ca/marketing/health
curl -s https://mcp.canspace.ca/finance/health
```

Expected: Both return `{"status":"healthy",...}`.

---

## Chunk 3: Client Configuration & Open WebUI

### Task 7: Update Open WebUI tool server configuration

**Prerequisites:** Task 5 completed (containers running).

- [ ] **Step 1: Update Open WebUI database for assistant tool server**

The existing tool server URL needs to change from `http://mcp-nextcloud:8080/mcp` to `http://mcp-nc-assistant:8080/mcp`. This was previously set directly in the database.

```bash
ssh canspace "docker exec open-webui python3 -c \"
import json
from open_webui.internal.db import Session
from open_webui.models.config import Config
config = Session.query(Config).first()
data = json.loads(config.data)
servers = data.get('tool_servers', [])
for s in servers:
    if 'mcp-nextcloud' in s.get('url', ''):
        s['url'] = 'http://mcp-nc-assistant:8080/mcp'
        s['name'] = 'Nextcloud Assistant'
        print(f'Updated: {s}')
data['tool_servers'] = servers
config.data = json.dumps(data)
Session.commit()
print('Done')
\""
```

If the Python approach doesn't work, update via the Open WebUI Admin UI:
- Admin Settings > External Tools
- Edit the existing Nextcloud MCP server URL to `http://mcp-nc-assistant:8080/mcp`
- Add two more MCP tool servers:
  - Name: `Nextcloud Marketing` / URL: `http://mcp-nc-marketing:8080/mcp` / Type: MCP
  - Name: `Nextcloud Finance` / URL: `http://mcp-nc-finance:8080/mcp` / Type: MCP

- [ ] **Step 2: Add marketing and finance tool servers**

Add via Open WebUI Admin Settings > External Tools (the UI is the most reliable approach here):
1. Click "Add Connection"
2. Name: `Nextcloud Marketing`, URL: `http://mcp-nc-marketing:8080/mcp`, Type: MCP (Streamable HTTP)
3. Click "Add Connection" again
4. Name: `Nextcloud Finance`, URL: `http://mcp-nc-finance:8080/mcp`, Type: MCP (Streamable HTTP)
5. Save

**Important:** Make sure the type is saved as `mcp` not `openapi` in the database. If the UI bug from the previous session persists, verify via database check.

- [ ] **Step 3: Restart Open WebUI**

```bash
ssh canspace "docker restart open-webui"
```

Wait 30 seconds for it to come back up.

- [ ] **Step 4: Verify tools are available**

Open a chat in Open WebUI, check that Nextcloud tools are visible in the tools selector for each model.

---

### Task 8: Configure Claude Code MCP client

**Prerequisites:** Task 6 completed (external access working with tokens).

- [ ] **Step 1: Add MCP server config to Claude Code settings**

Edit `~/.claude.json` (or the project-level `.mcp.json`) and add to the `mcpServers` object:

```json
{
  "mcpServers": {
    "nextcloud-assistant": {
      "type": "streamable-http",
      "url": "https://mcp.canspace.ca/assistant/mcp",
      "headers": {
        "Authorization": "Bearer <claude-code-token>"
      }
    }
  }
}
```

Replace `<claude-code-token>` with the actual token from Task 5 Step 1.

- [ ] **Step 2: Verify Claude Code can connect**

Start a new Claude Code session and check that Nextcloud tools appear in the available tools list. Try calling the hello tool to verify connectivity:

```
Use the nextcloud_hello tool to test the connection
```

Expected: Returns "Hello from Nextcloud MCP!" with server info.

- [ ] **Step 3: Configure Claude Desktop (same format)**

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add the same `mcpServers` entry as Step 1. Claude Desktop uses the same config format as Claude Code.

- [ ] **Step 4: Note on Open WebUI Models (deferred)**

Creating per-agent Models in Open WebUI (with custom system prompts, knowledge bases, and tool server assignments) is a separate task that depends on defining each agent's persona, knowledge, and capabilities. This is out of scope for this infrastructure plan but can be done at any time via Open WebUI Admin > Workspace > Models.

- [ ] **Step 5: Commit plan document**

```bash
cd /Users/johnkmcleod/dev-john/mcp-nextcloud
git add docs/superpowers/plans/
git commit -m "docs: add implementation plan for multi-agent secure access"
```

---

## Summary of verification checkpoints

After all tasks are complete, the following should all pass:

| Test | Command | Expected |
|---|---|---|
| Internal health (assistant) | `docker exec mcp-nc-assistant wget -qO- http://localhost:8080/health` | `{"status":"healthy"}` |
| Internal health (marketing) | `docker exec mcp-nc-marketing wget -qO- http://localhost:8080/health` | `{"status":"healthy"}` |
| Internal health (finance) | `docker exec mcp-nc-finance wget -qO- http://localhost:8080/health` | `{"status":"healthy"}` |
| External health | `curl https://mcp.canspace.ca/assistant/health` | `{"status":"healthy"}` |
| External /mcp no token | `curl -X POST https://mcp.canspace.ca/assistant/mcp -d '{...}'` | HTTP 401 |
| External /mcp with token | `curl -H 'Authorization: Bearer <token>' -X POST https://mcp.canspace.ca/assistant/mcp -d '{...}'` | HTTP 200, MCP response |
| External analytics no token | `curl https://mcp.canspace.ca/assistant/analytics` | HTTP 401 |
| External analytics with token | `curl -H 'Authorization: Bearer <token>' https://mcp.canspace.ca/assistant/analytics` | HTTP 200 |
| Internal /mcp (no token, Docker network) | Open WebUI uses `http://mcp-nc-assistant:8080/mcp` | Works without token |
| Claude Code hello | `nextcloud_hello` tool call | "Hello from Nextcloud MCP!" |
