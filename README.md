# Roadmap Builder — MCP Server

A public MCP server that lets Claude, IBM Bob, or any MCP-compatible AI client generate coherent roadmaps and open them directly in the [IBM Roadmap Builder](https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder/) app.

**No auth. No database.** The roadmap JSON is encoded in the URL hash — the server just builds and validates docs, then hands back a deep-link.

---

## How it works

```
User asks Claude/Bob: "Build me a 6-month product roadmap"
          ↓
Claude calls get_schema → learns the doc format
          ↓
Claude calls generate_roadmap(doc_json: "...") → validates the doc
          ↓
Server returns: https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder/index.html#doc=<base64>
          ↓
User opens URL → canvas renders the roadmap instantly
```

---

## Tools

| Tool | Description |
|---|---|
| `get_schema` | Returns the full doc JSON schema. **Call this first** before generating. |
| `generate_roadmap` | Validates a complete doc JSON and returns a deep-link URL. |
| `add_lane` | Adds a swim-lane to an existing roadmap URL. |
| `add_element` | Adds a bar, card, umbrella, or milestone to a lane. |
| `update_period` | Changes a time period's label, status, or narrative text. |
| `set_today` | Moves the "today" marker to a specific period. |

---

## Connecting to Claude Desktop

Add this to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "roadmap-builder": {
      "url": "https://roadmap-mcp-server.onrender.com/sse"
    }
  }
}
```

Then restart Claude Desktop. You'll see **roadmap-builder** appear in the MCP tools list.

---

## Connecting to IBM Bob

Add this to your Bob MCP config (`~/.bob/mcp.json` or workspace `.bob/mcp.json`):

```json
{
  "mcpServers": {
    "roadmap-builder": {
      "url": "https://roadmap-mcp-server.onrender.com/sse",
      "transport": "sse"
    }
  }
}
```

---

## Example conversation

> **You:** Build me a Q3–Q4 2025 product roadmap for a mobile app launch. Three lanes: Design, Engineering, Marketing.
>
> **Claude:** *(calls `get_schema`, then `generate_roadmap`)* Here's your roadmap:
> 🔗 https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder/index.html#doc=eyJ0aXRsZSI6...
>
> **You:** Add a "Legal & Compliance" lane in red.
>
> **Claude:** *(calls `add_lane`)* Done!
> 🔗 https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder/index.html#doc=eyJ0aXRsZSI6...

---

## Deploy to Render.com (free)

> **Why a separate public GitHub repo?**
> Render.com only integrates with public `github.com` repos. The main app lives on `github.ibm.com`, so the MCP server needs its own public repo.

### Steps

1. **Create a public repo** on `github.com` (e.g. `github.com/<you>/roadmap-mcp-server`).
2. Push only the contents of this `mcp-server/` folder to the root of that repo.
3. Go to [render.com](https://render.com) → **New → Web Service** → connect your GitHub account → select the repo.
4. Render auto-detects `render.yaml` and pre-fills the settings. Confirm:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Plan:** Free
5. Add the environment variable:
   - `PAGES_URL` = `https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder`
6. Click **Deploy**.
7. After ~2 min, your server is live at `https://roadmap-mcp-server.onrender.com`.

> ⚠️ **Cold starts:** Render's free tier sleeps after 15 min of inactivity. The first call after a period of no use takes ~30 s to wake up. Subsequent calls are instant. For a demo/personal tool this is fine.

---

## Local development

```bash
cd mcp-server
npm install
PAGES_URL=https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder npm run dev
```

Test the health endpoint:
```bash
curl http://localhost:3000/health
# → OK
```

---

## GitHub Pages setup (for the main app)

1. In `github.ibm.com/Martin-Burkel/Roadmap-builder` → **Settings → Pages**.
2. Set source to the branch containing `index.html` (e.g. `main`, root `/`).
3. Click **Save**. The app will be live at `https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder/`.
4. Test a deep-link: open the browser console on the app, run:
   ```js
   copy(window.docToDeepLink(doc))
   ```
   Then paste the URL into a new tab — the same roadmap should load.

> ℹ️ IBM GHE Pages may be restricted to IBM's internal network. If the URL only works on VPN/IBM network, deep-links from the MCP server will also only work there. Check with your GHE admin if you need public access.
