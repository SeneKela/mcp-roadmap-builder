# Roadmap Builder — Remote MCP Server

A public MCP server (Node.js + Express, deployed on Render.com) that lets Claude, IBM Bob, or any MCP-compatible client generate roadmaps and open them in the [IBM Roadmap Builder](https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder/) app.

**No auth. No database.** The roadmap JSON is encoded in the URL hash — the server validates docs and returns a deep-link.

For connection config and usage examples, see the [root README](../README.md).

---

## Tools

| Tool | Description |
|---|---|
| `get_schema` | Returns the full doc JSON schema. **Call this first** before generating. |
| `generate_roadmap` | Validates a complete doc JSON and returns a deep-link URL. |
| `add_lane` | Adds a swim-lane to an existing roadmap. |
| `add_element` | Adds a bar, card, umbrella, or milestone to a lane. |
| `update_period` | Changes a time period's label, status, or narrative text. |
| `set_today` | Moves the "today" marker to a specific period. |

---

## Deploy to Render.com (free)

> **Why a separate public GitHub repo?**
> Render.com only integrates with public `github.com` repos. The main app lives on `github.ibm.com`, so the MCP server needs its own public repo.

1. **Create a public repo** on `github.com` (e.g. `github.com/<you>/roadmap-mcp-server`).
2. Push only the contents of this `mcp-server/` folder to the root of that repo.
3. Go to [render.com](https://render.com) → **New → Web Service** → connect the repo.
4. Render auto-detects `render.yaml`. Confirm:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Plan:** Free
5. Add environment variable: `PAGES_URL` = `https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder`
6. Click **Deploy**. After ~2 min the server is live at `https://<service-name>.onrender.com`.

> ⚠️ **Cold starts:** Render's free tier sleeps after 15 min of inactivity. The first call after a period of no use takes ~30 s. Subsequent calls are instant.

---

## Local development

```bash
cd mcp-server
npm install
PAGES_URL=https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder npm run dev
```

```bash
curl http://localhost:3000/health
# → OK
```
