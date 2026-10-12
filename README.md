# Roadmap Builder — MCP Server

A Node.js + Express MCP server that lets Claude, IBM Bob, or any MCP-compatible client generate roadmaps and open them in the [IBM Roadmap Builder](https://pages.github.ibm.com/Martin-Burkel/Roadmap-builder/) app.

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
