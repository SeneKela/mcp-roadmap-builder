import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
const HOST = (process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');

// ─── Load app template at startup ──────────────────────────────────────────
// index.html lives one directory up (repo root). In production on Render the
// repo root is the mcp-server/ folder, so we fall back gracefully.
const __dir = dirname(fileURLToPath(import.meta.url));
let APP_HTML;
for (const candidate of [join(__dir, '..', 'index.html'), join(__dir, 'index.html')]) {
  try { APP_HTML = readFileSync(candidate, 'utf8'); break; } catch {}
}
if (!APP_HTML) throw new Error('index.html not found — place it alongside mcp-server/ or inside it');

// ─── Doc → self-contained HTML ──────────────────────────────────────────────
// Replaces the `let doc = { ... };` declaration in index.html with the
// generated doc, and removes the loadFromHash() call so the page opens
// immediately with the right data even without a URL hash.
function docToHtml(doc) {
  const json = JSON.stringify(doc);
  // Replace the doc declaration (everything between `let doc = ` and the
  // closing `};` on its own line, which is followed by a blank line).
  let html = APP_HTML.replace(
    /let doc = \{[\s\S]*?\n\};/,
    `let doc = ${json};`
  );
  return html;
}

// ─── In-memory download store (TTL 10 min) ─────────────────────────────────
const downloads = new Map();
function storeDoc(doc) {
  const id = Math.random().toString(36).slice(2, 10);
  downloads.set(id, { html: docToHtml(doc), doc, expires: Date.now() + 10 * 60 * 1000 });
  // Prune expired entries
  for (const [k, v] of downloads) if (v.expires < Date.now()) downloads.delete(k);
  return id;
}
function downloadUrl(id) { return `${HOST}/download/${id}`; }

// ─── doc_url helpers (carry doc between incremental tool calls) ─────────────
function docToToken(doc) {
  return Buffer.from(JSON.stringify(doc)).toString('base64')
    .replace(/\+/g, '-').replace(/_/g, '_').replace(/=+$/, '');
}
function tokenToDoc(token) {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}
// Accept either a raw base64 token or a full download URL (extract token from path)
function resolveDoc(doc_url) {
  const match = doc_url.match(/\/download\/([a-z0-9]+)$/);
  if (match) {
    const entry = downloads.get(match[1]);
    if (!entry) throw new Error('Download link expired or not found. Re-generate the roadmap.');
    return entry.doc;
  }
  return tokenToDoc(doc_url);
}

// ─── Validation ─────────────────────────────────────────────────────────────
const VALID_STATUSES = new Set(['completed', 'on-target', 'at-risk', 'delayed', 'not-started', 'cancelled', null]);
const VALID_VARIANTS = new Set(['bar', 'umbrella', 'card', 'milestone']);

function validateDoc(doc) {
  const errors = [];
  for (const key of ['title', 'periods', 'sections', 'lanes', 'elements', 'story']) {
    if (!(key in doc)) errors.push(`Missing required field: ${key}`);
  }
  if (errors.length) return { ok: false, errors };

  const laneIds = new Set(doc.lanes.map(l => l.id));
  const periodCount = doc.periods.length;

  for (const el of doc.elements) {
    if (!laneIds.has(el.laneId)) errors.push(`Element ${el.id} references unknown lane "${el.laneId}"`);
    if (el.span.start > el.span.end) errors.push(`Element ${el.id} has start > end`);
    if (el.span.start < 0 || el.span.end >= periodCount) errors.push(`Element ${el.id} span out of period range`);
    if (!VALID_VARIANTS.has(el.variant)) errors.push(`Element ${el.id} has invalid variant "${el.variant}"`);
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

// ─── ID generator ───────────────────────────────────────────────────────────
let _uid = 100;
const nid = (prefix = 'e') => `${prefix}${++_uid}`;

// ─── Doc schema (returned by get_schema, embedded in generate_roadmap desc) ──
const DOC_SCHEMA = `
IBM Roadmap Builder — doc JSON schema
======================================

{
  "title": string,           // Roadmap title shown in the header
  "today": number,           // Index of the current period (0-based)
  "todayOffset": number,     // Fine offset in px (use 0)
  "todayHidden": boolean,    // Hide the today line? (use false)

  "periods": [               // Time columns — left to right
    {
      "label": string,       // e.g. "Q1 2025", "Week 1", "2026"
      "status": string|null, // "completed" | "on-target" | "at-risk" | "delayed" | "not-started" | "cancelled" | null
      "narrative": string    // Prose shown in the story panel for this period
    }
  ],

  "sections": [              // Visual groupings of lanes (usually just one)
    {
      "id": string,
      "title": string,
      "subtitle": string,
      "collapsed": false,
      "laneIds": [string]    // Ordered list of lane IDs in this section
    }
  ],

  "lanes": [                 // Horizontal swim-lanes
    {
      "id": string,          // Unique, slug-style e.g. "infra", "design"
      "title": string,
      "color": string,       // Hex color e.g. "#0f62fe"
      "kind": "bars"|"cards",// "bars" for bar/umbrella/milestone, "cards" for card variant
      "pastTint": boolean    // Tint completed periods lighter?
    }
  ],

  "elements": [              // All items on the canvas
    {
      "id": string,          // Unique e.g. "e1", "e2"
      "laneId": string,      // Must match a lane id
      "variant": "bar"|"umbrella"|"card"|"milestone",
      "span": { "start": number, "end": number },  // Period indices (inclusive)
      "status": string|null, // Same values as period status
      "row": "auto"|number,  // Row within lane (use "auto")
      "tone": string|null,   // "lane"|"muted"|"neutral"|"inverse"|null (null = variant default)
      "meta": { "owner": string, "tags": [], "link": string },
      "blocks": [            // Content blocks inside the element
        // Title block (required):
        { "type": "title", "text": string },
        // Optional blocks:
        { "type": "subtitle", "text": string },
        { "type": "chip", "label": string, "tone": "neutral"|"inverse" },
        { "type": "metrics", "lines": [string] },  // "Label | value" format
        { "type": "entries", "rows": [{ "name": string, "value": string }] },
        { "type": "text", "text": string },
        { "type": "owner", "name": string },
        { "type": "progress", "value": number }   // 0–100
      ]
    }
  ],

  "story": [                 // Story mode slides (can be empty [])
    {
      "id": string,
      "title": string,
      "text": string,        // Prose for this story step
      "laneIds": [string],   // Which lanes to highlight
      "elementIds": []
    }
  ]
}

Suggested colors (IBM Carbon palette):
  #0f62fe (blue), #08bdba (teal), #42be65 (green), #ff832b (orange),
  #ff7eb6 (pink), #be95ff (purple), #f1c21b (yellow), #4589ff (light blue),
  #da1e28 (red), #c6c6c6 (gray), #262626 (dark)
`.trim();

// ─── MCP Server ─────────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'roadmap-builder',
  version: '0.1.0',
});

// ── Tool: get_schema ─────────────────────────────────────────────────────────
server.registerTool(
  'get_schema',
  {
    description: 'Returns the full JSON schema for the Roadmap Builder doc format. Call this first before calling generate_roadmap so you understand the exact shape required.',
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{
      type: 'text',
      text: DOC_SCHEMA + '\n\nOnce you have read the schema, call generate_roadmap with a doc_json argument containing a valid doc object.',
    }],
  })
);

// ── Tool: generate_roadmap ───────────────────────────────────────────────────
server.registerTool(
  'generate_roadmap',
  {
    description: `Validates a roadmap doc JSON, bakes it into a self-contained HTML file, and returns a download link.

HOW TO USE THIS TOOL (two-step pattern):
1. First call get_schema to learn the exact doc JSON format.
2. Build the doc JSON yourself based on the user's description — periods, lanes, elements, story slides.
3. Call this tool with doc_json = your complete doc JSON string.
4. The tool returns a download URL. The user opens it in a browser — the roadmap loads instantly, no login needed.

The returned doc_token can be passed to add_lane, add_element, update_period, set_today for incremental edits.

The doc JSON must follow the schema exactly. Common mistakes:
- element laneId must match a lane id in the lanes array
- span.start and span.end must be valid period indices (0 to periods.length-1)
- every element needs at least a title block: [{"type":"title","text":"..."}]`,
    inputSchema: z.object({
      doc_json: z.string().describe('The complete roadmap doc as a JSON string. Must conform to the schema from get_schema.'),
    }),
  },
  async ({ doc_json }) => {
    let doc;
    try {
      doc = JSON.parse(doc_json);
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Invalid JSON: ${e.message}` }],
        isError: true,
      };
    }

    const result = validateDoc(doc);
    if (!result.ok) {
      return {
        content: [{
          type: 'text',
          text: `Validation failed:\n${result.errors.map(e => `  • ${e}`).join('\n')}\n\nFix these issues and call generate_roadmap again.`,
        }],
        isError: true,
      };
    }

    const id = storeDoc(doc);
    const url = downloadUrl(id);
    const token = docToToken(doc);
    return {
      content: [{
        type: 'text',
        text: `✅ Roadmap ready!\n\nTitle: ${doc.title}\nPeriods: ${doc.periods.length}\nLanes: ${doc.lanes.length}\nElements: ${doc.elements.length}\n\n📥 Download & open (link valid 10 min):\n${url}\n\nThe file is a fully self-contained HTML — open it in any browser, no login needed. You can export to PDF/PPTX from inside the app.\n\n🔑 doc_token (pass to add_lane / add_element / update_period / set_today):\n${token}`,
      }],
    };
  }
);

// ── Tool: add_lane ───────────────────────────────────────────────────────────
server.registerTool(
  'add_lane',
  {
    description: 'Adds a new swim-lane to an existing roadmap and returns an updated download link.',
    inputSchema: z.object({
      doc_token: z.string().describe('The doc_token returned by generate_roadmap, add_lane, add_element, update_period, or set_today.'),
      lane_title: z.string().describe('Display title for the new lane.'),
      color: z.string().optional().describe('Hex color e.g. "#0f62fe". Defaults to IBM blue.'),
      kind: z.enum(['bars', 'cards']).optional().describe('"bars" for bar/umbrella/milestone elements, "cards" for card elements. Defaults to "bars".'),
    }),
  },
  async ({ doc_token, lane_title, color = '#0f62fe', kind = 'bars' }) => {
    let doc;
    try { doc = resolveDoc(doc_token); } catch (e) {
      return { content: [{ type: 'text', text: `Could not decode doc_token: ${e.message}` }], isError: true };
    }

    const id = nid('lane');
    doc.lanes.push({ id, title: lane_title, color, kind, pastTint: false });
    if (doc.sections.length > 0) doc.sections[0].laneIds.push(id);

    const dlId = storeDoc(doc);
    const token = docToToken(doc);
    return {
      content: [{
        type: 'text',
        text: `✅ Added lane "${lane_title}" (id: ${id})\n\nLanes now: ${doc.lanes.map(l => l.title).join(', ')}\n\n📥 Updated file:\n${downloadUrl(dlId)}\n\n🔑 doc_token:\n${token}`,
      }],
    };
  }
);

// ── Tool: add_element ────────────────────────────────────────────────────────
server.registerTool(
  'add_element',
  {
    description: 'Adds a new element (bar, card, umbrella, or milestone) to a lane and returns an updated download link.',
    inputSchema: z.object({
      doc_token: z.string().describe('The doc_token from a previous tool call.'),
      lane_id: z.string().describe('ID of the lane to add the element to. Use add_lane first if the lane does not exist yet.'),
      variant: z.enum(['bar', 'umbrella', 'card', 'milestone']).describe('Element shape. bar = horizontal bar, umbrella = spanning header bar, card = tall card with rich content, milestone = diamond marker.'),
      title: z.string().describe('Title text shown on the element.'),
      period_start: z.number().int().describe('Start period index (0-based, inclusive).'),
      period_end: z.number().int().describe('End period index (0-based, inclusive). Equal to period_start for single-period elements.'),
      status: z.string().optional().describe('completed | on-target | at-risk | delayed | not-started | cancelled. Omit for no status.'),
      subtitle: z.string().optional().describe('Subtitle text (card variant only).'),
    }),
  },
  async ({ doc_token, lane_id, variant, title, period_start, period_end, status, subtitle }) => {
    let doc;
    try { doc = resolveDoc(doc_token); } catch (e) {
      return { content: [{ type: 'text', text: `Could not decode doc_token: ${e.message}` }], isError: true };
    }

    if (!doc.lanes.find(l => l.id === lane_id)) {
      return { content: [{ type: 'text', text: `Lane "${lane_id}" not found. Available lanes: ${doc.lanes.map(l => `${l.id} (${l.title})`).join(', ')}` }], isError: true };
    }
    if (period_start < 0 || period_end >= doc.periods.length || period_start > period_end) {
      return { content: [{ type: 'text', text: `period_start/end out of range. Periods: 0–${doc.periods.length - 1}` }], isError: true };
    }

    const blocks = [{ type: 'title', text: title }];
    if (subtitle && variant === 'card') blocks.push({ type: 'subtitle', text: subtitle });

    const el = {
      id: nid('e'),
      laneId: lane_id,
      variant,
      span: { start: period_start, end: period_end },
      status: VALID_STATUSES.has(status) ? status : null,
      row: 'auto',
      meta: { owner: '', tags: [], link: '' },
      blocks,
    };
    doc.elements.push(el);

    const dlId = storeDoc(doc);
    const token = docToToken(doc);
    return {
      content: [{
        type: 'text',
        text: `✅ Added ${variant} "${title}" to lane "${lane_id}" (periods ${period_start}–${period_end})\n\n📥 Updated file:\n${downloadUrl(dlId)}\n\n🔑 doc_token:\n${token}`,
      }],
    };
  }
);

// ── Tool: update_period ──────────────────────────────────────────────────────
server.registerTool(
  'update_period',
  {
    description: 'Updates the label, status, or narrative of a time period and returns an updated download link.',
    inputSchema: z.object({
      doc_token: z.string().describe('The doc_token from a previous tool call.'),
      period_index: z.number().int().describe('0-based index of the period to update.'),
      label: z.string().optional().describe('New label text e.g. "Q2 2025".'),
      status: z.string().optional().describe('completed | on-target | at-risk | delayed | not-started | cancelled | null'),
      narrative: z.string().optional().describe('Prose description shown in the story panel for this period.'),
    }),
  },
  async ({ doc_token, period_index, label, status, narrative }) => {
    let doc;
    try { doc = resolveDoc(doc_token); } catch (e) {
      return { content: [{ type: 'text', text: `Could not decode doc_token: ${e.message}` }], isError: true };
    }

    if (period_index < 0 || period_index >= doc.periods.length) {
      return { content: [{ type: 'text', text: `period_index ${period_index} out of range. Valid: 0–${doc.periods.length - 1}` }], isError: true };
    }

    const p = doc.periods[period_index];
    if (label !== undefined) p.label = label;
    if (status !== undefined) p.status = status === 'null' ? null : status;
    if (narrative !== undefined) p.narrative = narrative;

    const dlId = storeDoc(doc);
    const token = docToToken(doc);
    return {
      content: [{
        type: 'text',
        text: `✅ Updated period ${period_index}: "${p.label}" (status: ${p.status ?? 'none'})\n\n📥 Updated file:\n${downloadUrl(dlId)}\n\n🔑 doc_token:\n${token}`,
      }],
    };
  }
);

// ── Tool: set_today ──────────────────────────────────────────────────────────
server.registerTool(
  'set_today',
  {
    description: 'Moves the "today" marker to a specific period and returns an updated download link.',
    inputSchema: z.object({
      doc_token: z.string().describe('The doc_token from a previous tool call.'),
      period_index: z.number().int().describe('0-based index of the period to mark as today.'),
    }),
  },
  async ({ doc_token, period_index }) => {
    let doc;
    try { doc = resolveDoc(doc_token); } catch (e) {
      return { content: [{ type: 'text', text: `Could not decode doc_token: ${e.message}` }], isError: true };
    }

    if (period_index < 0 || period_index >= doc.periods.length) {
      return { content: [{ type: 'text', text: `period_index ${period_index} out of range. Valid: 0–${doc.periods.length - 1}` }], isError: true };
    }

    doc.today = period_index;
    doc.todayOffset = 0;

    const dlId = storeDoc(doc);
    const token = docToToken(doc);
    return {
      content: [{
        type: 'text',
        text: `✅ Today marker set to period ${period_index}: "${doc.periods[period_index].label}"\n\n📥 Updated file:\n${downloadUrl(dlId)}\n\n🔑 doc_token:\n${token}`,
      }],
    };
  }
);

// ─── Express + SSE transport ─────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/health', (_req, res) => res.status(200).send('OK'));

// ── Download endpoint ────────────────────────────────────────────────────────
// Returns the pre-populated self-contained HTML file for the given id.
// The browser opens it directly — no login, no GitHub Pages needed.
app.get('/download/:id', (req, res) => {
  const entry = downloads.get(req.params.id);
  if (!entry) return res.status(404).send('Link expired or not found. Ask the AI to regenerate the roadmap.');
  if (entry.expires < Date.now()) {
    downloads.delete(req.params.id);
    return res.status(410).send('Link expired. Ask the AI to regenerate the roadmap.');
  }
  const title = (entry.doc?.title ?? 'roadmap').replace(/[^a-z0-9_\- ]/gi, '_');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${title}.html"`);
  res.send(entry.html);
});

// Map of sessionId → SSEServerTransport (supports multiple concurrent clients)
const transports = new Map();

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);
  res.on('close', () => transports.delete(transport.sessionId));
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.listen(PORT, () => {
  console.error(`Roadmap MCP server listening on port ${PORT}`);
  console.error(`Host: ${HOST}`);
  console.error(`SSE endpoint: http://localhost:${PORT}/sse`);
});
