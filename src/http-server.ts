/**
 * Nextcloud MCP Server - Streamable HTTP Transport
 * 
 * This file provides an HTTP server for self-hosting the MCP server on a VPS.
 * It uses the Streamable HTTP transport for MCP communication.
 * 
 * Usage:
 *   npm run build
 *   node dist/src/http-server.js
 * 
 * Or with environment variables:
 *   PORT=8080 node dist/src/http-server.js
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { setCredentials } from './utils/client-manager.js';

// Import tool registration functions
import { registerNotesTools } from './tools/notes.tools.js';
import { registerCalendarTools } from './tools/calendar.tools.js';
import { registerCalendarDebugTools } from './tools/calendar-debug.tools.js';
import { registerContactsTools } from './tools/contacts.tools.js';
import { registerTablesTools } from './tools/tables.tools.js';
import { registerWebDAVTools } from './tools/webdav.tools.js';
import { registerDeckTools } from './tools/deck.tools.js';
import { prefixToolName } from './utils/tool-naming.js';
import crypto from 'crypto';

// Auth configuration
const AUTH_TOKENS: string[] = process.env.MCP_AUTH_TOKEN
  ? process.env.MCP_AUTH_TOKEN.split(',').map(t => t.trim()).filter(Boolean)
  : [];
const AUTH_ENABLED = AUTH_TOKENS.length > 0;
const AUTH_BYPASS_PRIVATE = process.env.MCP_AUTH_BYPASS_PRIVATE !== 'false'; // default true

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

// Type definition for tool registration functions
type ToolRegistrationFn = (server: McpServer) => void;

// Configuration
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ANALYTICS_FILE = process.env.ANALYTICS_FILE || '/app/data/nextcloud-mcp-analytics.json';

// Analytics tracking
interface Analytics {
  serverStartTime: string;
  totalRequests: number;
  totalToolCalls: number;
  requestsByMethod: Record<string, number>;
  requestsByEndpoint: Record<string, number>;
  toolCalls: Record<string, number>;
  recentToolCalls: Array<{ tool: string; timestamp: string; clientIp: string }>;
  clientsByIp: Record<string, number>;
  clientsByUserAgent: Record<string, number>;
  hourlyRequests: Record<string, number>;
}

const defaultAnalytics: Analytics = {
  serverStartTime: new Date().toISOString(),
  totalRequests: 0,
  totalToolCalls: 0,
  requestsByMethod: {},
  requestsByEndpoint: {},
  toolCalls: {},
  recentToolCalls: [],
  clientsByIp: {},
  clientsByUserAgent: {},
  hourlyRequests: {},
};

// Load analytics from file or use defaults
function loadAnalytics(): Analytics {
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      const data = fs.readFileSync(ANALYTICS_FILE, 'utf-8');
      const loaded = JSON.parse(data) as Analytics;
      console.log(`📊 Loaded analytics from ${ANALYTICS_FILE}`);
      return loaded;
    }
  } catch (error) {
    console.warn('⚠️ Could not load analytics file, starting fresh:', error);
  }
  return { ...defaultAnalytics };
}

// Save analytics to file
function saveAnalytics(): void {
  try {
    const dir = path.dirname(ANALYTICS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
  } catch (error) {
    console.warn('⚠️ Could not save analytics file:', error);
  }
}

// Auto-save analytics every 5 minutes
setInterval(saveAnalytics, 5 * 60 * 1000);

// Save on process exit
process.on('SIGTERM', () => {
  console.log('📊 Saving analytics before shutdown...');
  saveAnalytics();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📊 Saving analytics before shutdown...');
  saveAnalytics();
  process.exit(0);
});

const analytics: Analytics = loadAnalytics();

function getUptime(): string {
  const start = new Date(analytics.serverStartTime).getTime();
  const now = Date.now();
  const diff = now - start;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

function trackRequest(req: Request, endpoint: string): void {
  analytics.totalRequests++;
  analytics.requestsByMethod[req.method] = (analytics.requestsByMethod[req.method] || 0) + 1;
  analytics.requestsByEndpoint[endpoint] = (analytics.requestsByEndpoint[endpoint] || 0) + 1;
  
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
  analytics.clientsByIp[clientIp] = (analytics.clientsByIp[clientIp] || 0) + 1;
  
  const userAgent = req.headers['user-agent'] || 'unknown';
  const shortAgent = userAgent.split('/')[0] || userAgent.substring(0, 30);
  analytics.clientsByUserAgent[shortAgent] = (analytics.clientsByUserAgent[shortAgent] || 0) + 1;
  
  const hourKey = new Date().toISOString().substring(0, 13) + ':00';
  analytics.hourlyRequests[hourKey] = (analytics.hourlyRequests[hourKey] || 0) + 1;
}

function trackToolCall(toolName: string, clientIp: string): void {
  analytics.totalToolCalls++;
  analytics.toolCalls[toolName] = (analytics.toolCalls[toolName] || 0) + 1;
  analytics.recentToolCalls.unshift({
    tool: toolName,
    timestamp: new Date().toISOString(),
    clientIp,
  });
  if (analytics.recentToolCalls.length > 100) {
    analytics.recentToolCalls.pop();
  }
}

// Create MCP server
const mcpServer = new McpServer({
  name: 'Nextcloud MCP Server',
  version: '1.0.0',
});

// Initialize credentials from environment or query params
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

// Register all tool sets
const toolSets: ToolRegistrationFn[] = [
  registerNotesTools,
  registerCalendarTools,
  registerCalendarDebugTools,
  registerContactsTools,
  registerTablesTools,
  registerWebDAVTools,
  registerDeckTools,
];

// Register all tools
toolSets.forEach((toolSet) => toolSet(mcpServer));

// Register hello tool for testing
mcpServer.tool(
  prefixToolName('hello'),
  'A simple test tool to verify that the MCP server is working correctly',
  {},
  async () => {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'Hello from Nextcloud MCP!',
            timestamp: new Date().toISOString(),
            transport: 'streamable-http',
            available_tools: [
              'Notes: nextcloud_notes_create_note, nextcloud_notes_update_note, nextcloud_notes_append_content, nextcloud_notes_search_notes, nextcloud_notes_delete_note',
              'Calendar: nextcloud_calendar_list_calendars, nextcloud_calendar_create_event, nextcloud_calendar_list_events, nextcloud_calendar_get_event, nextcloud_calendar_update_event, nextcloud_calendar_delete_event',
              'Contacts: nextcloud_contacts_list_addressbooks, nextcloud_contacts_create_addressbook, nextcloud_contacts_delete_addressbook, nextcloud_contacts_list_contacts, nextcloud_contacts_create_contact, nextcloud_contacts_delete_contact',
              'Tables: nextcloud_tables_list_tables, nextcloud_tables_get_schema, nextcloud_tables_read_table, nextcloud_tables_insert_row, nextcloud_tables_update_row, nextcloud_tables_delete_row',
              'WebDAV: nextcloud_webdav_list_directory, nextcloud_webdav_read_file, nextcloud_webdav_write_file, nextcloud_webdav_create_directory, nextcloud_webdav_delete_resource'
            ],
            total_tools: 29,
          }, null, 2),
        },
      ],
    };
  }
);

// Create Express app
const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'Mcp-Session-Id'],
  exposedHeaders: ['Mcp-Session-Id'],
}));

app.use(express.json());

// Trust proxy headers when behind Traefik so req.ip reflects the real client
app.set('trust proxy', 'loopback,linklocal,uniquelocal');

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  trackRequest(req, '/health');
  res.json({
    status: 'healthy',
    server: 'Nextcloud MCP',
    version: '1.0.0',
    transport: 'streamable-http',
    timestamp: new Date().toISOString(),
  });
});

// Analytics endpoint - summary
app.get('/analytics', requireAuth, (req: Request, res: Response) => {
  trackRequest(req, '/analytics');
  
  const sortedTools = Object.entries(analytics.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  
  const sortedClients = Object.entries(analytics.clientsByIp)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  
  const last24Hours = Object.entries(analytics.hourlyRequests)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 24)
    .reverse()
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  
  res.json({
    server: 'Nextcloud MCP',
    uptime: getUptime(),
    serverStartTime: analytics.serverStartTime,
    summary: {
      totalRequests: analytics.totalRequests,
      totalToolCalls: analytics.totalToolCalls,
      uniqueClients: Object.keys(analytics.clientsByIp).length,
    },
    breakdown: {
      byMethod: analytics.requestsByMethod,
      byEndpoint: analytics.requestsByEndpoint,
      byTool: sortedTools,
    },
    clients: {
      byIp: sortedClients,
      byUserAgent: analytics.clientsByUserAgent,
    },
    hourlyRequests: last24Hours,
    recentToolCalls: analytics.recentToolCalls.slice(0, 20),
  });
});

// Analytics dashboard - visual HTML page
app.get('/analytics/dashboard', (req: Request, res: Response) => {
  trackRequest(req, '/analytics/dashboard');
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nextcloud MCP - Analytics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0082c9 0%, #00678c 100%);
      min-height: 100vh;
      color: #e4e4e7;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
    }
    header h1 {
      font-size: 2rem;
      background: linear-gradient(90deg, #fff, #a0d8ef);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    header p { color: rgba(255,255,255,0.8); }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      border: 1px solid rgba(255,255,255,0.2);
      transition: transform 0.2s;
    }
    .stat-card:hover { transform: translateY(-4px); }
    .stat-card h3 { font-size: 2.5rem; margin-bottom: 8px; color: #fff; }
    .stat-card p { color: rgba(255,255,255,0.7); font-size: 0.9rem; }
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .chart-card {
      background: rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.2);
    }
    .chart-card h2 {
      font-size: 1.2rem;
      margin-bottom: 16px;
      color: #fff;
    }
    .recent-calls {
      background: rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.2);
    }
    .recent-calls h2 { margin-bottom: 16px; color: #fff; }
    .call-item {
      display: flex;
      justify-content: space-between;
      padding: 12px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .call-tool { font-weight: 600; color: #a0d8ef; }
    .call-time { color: rgba(255,255,255,0.6); font-size: 0.85rem; }
    .refresh-note {
      text-align: center;
      margin-top: 20px;
      color: rgba(255,255,255,0.5);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>☁️ Nextcloud MCP Analytics</h1>
      <p>Real-time usage statistics for your Nextcloud MCP server</p>
    </header>
    
    <div class="stats-grid" id="stats-grid"></div>
    
    <div class="charts-grid">
      <div class="chart-card">
        <h2>📊 Tool Usage Distribution</h2>
        <canvas id="toolsChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>📈 Hourly Requests (Last 24h)</h2>
        <canvas id="hourlyChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>📱 Clients by User Agent</h2>
        <canvas id="clientsChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>🌐 Top IPs</h2>
        <div id="clients-list"></div>
      </div>
    </div>
    
    <div class="recent-calls">
      <h2>🔄 Recent Tool Calls</h2>
      <div id="recent-calls-list"></div>
    </div>
    
    <p class="refresh-note">Auto-refreshes every 30 seconds</p>
  </div>
  
  <script>
    let toolsChart, hourlyChart, clientsChart;
    
    async function fetchData() {
      // Use relative path that works with nginx reverse proxy
      const basePath = window.location.pathname.replace('/analytics/dashboard', '');
      const res = await fetch(basePath + '/analytics');
      return res.json();
    }
    
    function updateStats(data) {
      document.getElementById('stats-grid').innerHTML = \`
        <div class="stat-card">
          <h3>\${data.summary.totalRequests.toLocaleString()}</h3>
          <p>Total Requests</p>
        </div>
        <div class="stat-card">
          <h3>\${data.summary.totalToolCalls.toLocaleString()}</h3>
          <p>Tool Calls</p>
        </div>
        <div class="stat-card">
          <h3>\${data.summary.uniqueClients}</h3>
          <p>Unique Clients</p>
        </div>
        <div class="stat-card">
          <h3>\${data.uptime}</h3>
          <p>Uptime</p>
        </div>
      \`;
    }
    
    function updateCharts(data) {
      const toolLabels = Object.keys(data.breakdown.byTool).slice(0, 10);
      const toolValues = Object.values(data.breakdown.byTool).slice(0, 10);
      
      if (toolsChart) toolsChart.destroy();
      toolsChart = new Chart(document.getElementById('toolsChart'), {
        type: 'doughnut',
        data: {
          labels: toolLabels,
          datasets: [{
            data: toolValues,
            backgroundColor: [
              '#0082c9', '#00678c', '#a0d8ef', '#5bc0de', '#4a90d9',
              '#3498db', '#2980b9', '#1abc9c', '#16a085', '#27ae60'
            ]
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'right', labels: { color: '#fff' } } }
        }
      });
      
      const hourlyLabels = Object.keys(data.hourlyRequests).map(h => h.split('T')[1] || h);
      const hourlyValues = Object.values(data.hourlyRequests);
      
      if (hourlyChart) hourlyChart.destroy();
      hourlyChart = new Chart(document.getElementById('hourlyChart'), {
        type: 'line',
        data: {
          labels: hourlyLabels,
          datasets: [{
            label: 'Requests',
            data: hourlyValues,
            borderColor: '#a0d8ef',
            backgroundColor: 'rgba(160, 216, 239, 0.2)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          scales: {
            x: { ticks: { color: '#fff' }, grid: { color: 'rgba(255,255,255,0.1)' } },
            y: { ticks: { color: '#fff' }, grid: { color: 'rgba(255,255,255,0.1)' } }
          },
          plugins: { legend: { labels: { color: '#fff' } } }
        }
      });
      
      // Clients by User Agent chart
      const clientLabels = Object.keys(data.clients.byUserAgent).slice(0, 8);
      const clientValues = Object.values(data.clients.byUserAgent).slice(0, 8);
      
      if (clientsChart) clientsChart.destroy();
      clientsChart = new Chart(document.getElementById('clientsChart'), {
        type: 'bar',
        data: {
          labels: clientLabels,
          datasets: [{
            label: 'Requests',
            data: clientValues,
            backgroundColor: [
              '#0082c9', '#00678c', '#a0d8ef', '#5bc0de', 
              '#4a90d9', '#3498db', '#2980b9', '#1abc9c'
            ]
          }]
        },
        options: {
          responsive: true,
          indexAxis: 'y',
          scales: {
            x: { ticks: { color: '#fff' }, grid: { color: 'rgba(255,255,255,0.1)' } },
            y: { ticks: { color: '#fff' }, grid: { color: 'rgba(255,255,255,0.1)' } }
          },
          plugins: { legend: { display: false } }
        }
      });
      
      // Top IPs list
      const ipList = document.getElementById('clients-list');
      const topIps = Object.entries(data.clients.byIp).slice(0, 10);
      ipList.innerHTML = topIps.map(([ip, count]) => \`
        <div class="call-item">
          <span class="call-tool">\${ip}</span>
          <span class="call-time">\${count} requests</span>
        </div>
      \`).join('') || '<p style="color: rgba(255,255,255,0.6);">No data yet</p>';
    }
    
    function updateRecentCalls(data) {
      const list = document.getElementById('recent-calls-list');
      list.innerHTML = data.recentToolCalls.slice(0, 10).map(call => \`
        <div class="call-item">
          <span class="call-tool">\${call.tool}</span>
          <span class="call-time">\${new Date(call.timestamp).toLocaleString()}</span>
        </div>
      \`).join('');
    }
    
    async function refresh() {
      const data = await fetchData();
      updateStats(data);
      updateCharts(data);
      updateRecentCalls(data);
    }
    
    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>
`;
  res.send(html);
});

// Create Streamable HTTP transport (stateless)
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

// MCP endpoint
app.all('/mcp', requireAuth, async (req: Request, res: Response) => {
  trackRequest(req, '/mcp');
  
  // Initialize credentials from query params or env
  initializeCredentials(req);
  
  // Track tool calls
  if (req.body?.method === 'tools/call' && req.body?.params?.name) {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
    trackToolCall(req.body.params.name, clientIp);
  }
  
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Root endpoint with server info
app.get('/', (req: Request, res: Response) => {
  trackRequest(req, '/');
  res.json({
    name: 'Nextcloud MCP Server',
    version: '1.0.0',
    description: 'MCP server for Nextcloud integration (Notes, Calendar, Contacts, Tables, WebDAV)',
    transport: 'streamable-http',
    endpoints: {
      mcp: '/mcp',
      health: '/health',
      analytics: '/analytics',
      analyticsDashboard: '/analytics/dashboard',
    },
    authentication: {
      description: 'Provide Nextcloud credentials via query params or environment variables',
      queryParams: ['nextcloudHost', 'nextcloudUsername', 'nextcloudPassword'],
      example: '/mcp?nextcloudHost=https://cloud.example.com&nextcloudUsername=user&nextcloudPassword=pass',
    },
    documentation: 'https://github.com/hithereiamaliff/mcp-nextcloud',
  });
});

// Connect server to transport and start listening
mcpServer.server.connect(transport)
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log('='.repeat(60));
      console.log('☁️ Nextcloud MCP Server (Streamable HTTP)');
      console.log('='.repeat(60));
      console.log(`📍 Server running on http://${HOST}:${PORT}`);
      console.log(`📡 MCP endpoint: http://${HOST}:${PORT}/mcp`);
      console.log(`❤️  Health check: http://${HOST}:${PORT}/health`);
      console.log(`📊 Analytics: http://${HOST}:${PORT}/analytics/dashboard`);
      console.log('='.repeat(60));
      console.log('');
    });
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
