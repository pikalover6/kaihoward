# kai-planner MCP connector

Lets Claude (Desktop, Code, or any MCP client) read and edit your planner at
**kaihoward.com/personal** — "what's on my schedule today?", "add a 9am workout
tomorrow", "move *Apply to internships* under *Career*", "mark *CS exam* done",
"reprioritize my week".

It is a single **zero-dependency** Node file (`kai-planner-mcp.mjs`). No build, no
`npm install` — just Node 18+. The same file works on Windows, macOS, and Linux.

---

## What it can do

| Tool | Purpose |
|------|---------|
| `get_overview` | Snapshot: counts by status, today's items, the scratch note |
| `list_goals` | The full goal tree (or filtered / flat) — source of IDs |
| `get_schedule` | Items in a date range, sorted by time ("today", "this week") |
| `search_goals` | Find an item by text before editing |
| `create_goal` | Add a goal/task/event (title, times, due date, parent, priority…) |
| `update_goal` | Rename, reschedule, reprioritize, change status, edit notes |
| `complete_goal` | Mark done / reopen |
| `move_goal` | Re-nest under a different parent (cycle-safe) |
| `reorder_goals` | Set the order of a group of siblings |
| `delete_goal` | Delete a goal and its whole branch |
| `get_note` / `update_note` | Read / replace the scratch note |

---

## Setup on a new machine (MacBook, another PC, …)

You need three secrets (ask Kai / copy from your password manager):

- `KAI_API_KEY` — the planner API key
- `CF_ACCESS_CLIENT_ID` — Cloudflare Access service-token client id
- `CF_ACCESS_CLIENT_SECRET` — Cloudflare Access service-token secret

### 1. Make sure Node 18+ is installed

```bash
node --version   # need v18 or newer
```

macOS (Homebrew): `brew install node` • Windows: `winget install OpenJS.NodeJS` •
or grab it from https://nodejs.org.

### 2. Get the two files and run the installer

```bash
# pick any folder
curl -fsSL https://raw.githubusercontent.com/pikalover6/kaihoward/main/mcp/kai-planner-mcp.mjs -o kai-planner-mcp.mjs
curl -fsSL https://raw.githubusercontent.com/pikalover6/kaihoward/main/mcp/install.mjs       -o install.mjs

node install.mjs \
  --api-key   "PASTE_KAI_API_KEY" \
  --cf-id     "PASTE_CF_ACCESS_CLIENT_ID" \
  --cf-secret "PASTE_CF_ACCESS_CLIENT_SECRET"
```

On **Windows PowerShell**, use backticks for line continuation (or put it on one line):

```powershell
node install.mjs `
  --api-key   "PASTE_KAI_API_KEY" `
  --cf-id     "PASTE_CF_ACCESS_CLIENT_ID" `
  --cf-secret "PASTE_CF_ACCESS_CLIENT_SECRET"
```

The installer copies the server to a stable spot (`~/.kai-planner/`) and adds a
`kai-planner` entry to your Claude Desktop config **without disturbing any other
connectors**.

> **On a shared machine**, pass the secrets as environment variables instead of
> CLI flags so they don't land in your shell history:
> ```bash
> KAI_API_KEY=… CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… node install.mjs
> ```

### 3. Restart Claude Desktop

Fully quit (not just close the window) and reopen it. Ask:

> what's on my planner today?

You should see it call the `kai-planner` tools.

---

## Manual config (if you prefer)

Add this to your Claude Desktop config file and restart:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "kai-planner": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/kai-planner-mcp.mjs"],
      "env": {
        "KAI_BASE_URL": "https://kaihoward.com/personal/api",
        "KAI_API_KEY": "…",
        "CF_ACCESS_CLIENT_ID": "…",
        "CF_ACCESS_CLIENT_SECRET": "…"
      }
    }
  }
}
```

> On Windows, if `"command": "node"` isn't found by Claude Desktop, use the full
> path to `node.exe` (the installer does this automatically).

## Use from the Claude Code CLI

```bash
claude mcp add kai-planner -s user \
  -e KAI_BASE_URL=https://kaihoward.com/personal/api \
  -e KAI_API_KEY=… -e CF_ACCESS_CLIENT_ID=… -e CF_ACCESS_CLIENT_SECRET=… \
  -- node "/ABSOLUTE/PATH/TO/kai-planner-mcp.mjs"
```

---

## Troubleshooting

- **"redirected (HTTP 302) … Cloudflare Access blocked it"** — the Access service
  token isn't set or isn't allowed on `/personal/api`. Re-check `CF_ACCESS_CLIENT_ID`
  / `CF_ACCESS_CLIENT_SECRET`.
- **"Unauthorized (401)"** — `KAI_API_KEY` is wrong.
- **Tool doesn't appear in Claude Desktop** — make sure you *fully quit* and
  reopened the app; check the config file is valid JSON. Logs:
  `%APPDATA%\Claude\logs\` (Windows) / `~/Library/Logs/Claude/` (macOS).
- **Test it end-to-end** — from the `mcp/` folder, run the included smoke test. It
  creates a temporary goal, schedules/edits/completes it, then deletes it:
  ```bash
  KAI_API_KEY=… CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… node smoke-test.mjs
  ```
