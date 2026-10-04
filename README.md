# Pi WebUI

A fork of [Pi Web](https://github.com/agegr/pi-web) that brings over the extras from
[ompweb](https://github.com/kahme247/ompweb) (the oh-my-pi web UI) and adapts them to
the plain **pi** coding agent. Everything below the fork section is upstream Pi Web's
documentation and still applies.

## What this fork adds

### Two agents in one UI: omp and pi

Pi WebUI drives either **[oh-my-pi (omp)](https://github.com/can1357/oh-my-pi)** or **pi**.
The **OMP / Pi** switch at the top of the sidebar changes agent instantly; both are live
in the same server, so nothing restarts. omp is the default when it is installed.

| | omp mode | pi mode |
|---|---|---|
| Runs as | `omp --mode rpc-ui` per open chat (JSON over stdio) | pi's SDK inside the server |
| Sessions | `~/.omp/agent/sessions` | `~/.pi/agent/sessions` |
| Models, default model, thinking | omp's `models.yml`, `config.yml` and logins | pi's `models.json`, `settings.json` and logins |
| Settings | General, **Models** (roles, providers and model scope), **OMP** (tools and agent settings), Usage | General, Models, Skills, Sub-agents, Plugins, MCP, Usage |
| `/btw` | omp's own side questions | pi-webui's side questions on the session's model |

omp transcripts are shown through read-only shadow copies under
`~/.pi/agent/pi-webui/omp-shadow`; only omp itself writes omp's session files. Set
`PI_WEBUI_OMP_BIN` if `omp` is not on `PATH`, and `PI_WEBUI_OMP_AGENT_DIR` to point at a
non-default omp agent directory. Not yet available for omp sessions: in-session branch
navigation, cloning, changing tools on a running chat, and extension custom UI.

On the **pi-omp** branch, Settings › Models edits OMP model roles, default thinking,
enabled-model patterns, disabled providers and custom providers in `models.yml`.
The Models screen shares Pi’s provider picker, sidebar and model forms. Add cloud
providers (OpenAI, Anthropic, Google, OpenRouter, Groq and DeepSeek), choose a local
preset (Ollama, LM Studio, llama.cpp or vLLM), or enter any compatible endpoint.
**Import models…** discovers IDs from that endpoint; select the models to add,
edit context/output limits, reasoning, costs and headers, then **Save**.
**Check availability** checks the endpoint’s model list without running inference.
Native provider logins use OMP’s own login flow and credential store; removing a
native login still requires `omp` → `/logout`. Stored keys are never read into the
browser. Endpoint discovery supports literal keys/environment variables; command
references are left to OMP. Catalog recommendations remain Pi’s shared catalog,
so check provider-specific limits before applying them.
Settings › OMP exposes tool switches, per-tool approval policies, advisor, retry
and compaction settings supported by the installed OMP version. Model/thinking
stars in the composer save OMP defaults when the chat belongs to OMP.
Saves preserve other YAML fields and comments, keep stored credentials masked,
create adjacent `*.backup-webui-*` files and refuse stale edits. New chats use the
new config; **Reload current OMP chat** applies startup settings to an idle chat.
Project overrides still take precedence. Scoped model/provider filters remain
read-only here. OMP skills, plugins and MCP settings still use OMP's own controls.
The **pi-only** branch keeps the separate Pi-only interface.

### Clone your personal branch on another device

Install Node.js 22.19+ and OMP, then:

```sh
git clone --branch pi-omp https://github.com/lattebbrook/pi-webui.git
cd pi-webui
npm ci
npm run dev
```

Open `http://127.0.0.1:30141`. Configure providers on that device through
Settings → Models. Credentials, model files and local model servers are not
included in Git. For a server on another machine, replace `127.0.0.1` with its
reachable address. Use the `pi-only` branch for the clean Pi-only version.

### Everything else

| Feature | Where | Notes |
|---|---|---|
| **Usage dashboard** | Settings › Usage | Tokens and cost per provider, model, day and project for the active agent's sessions (subagents included), cached under `~/.pi/agent/pi-webui/`. |
| **`/btw` side questions** | `/btw <question>` in the composer | Asks the session's own model about the session without adding anything to the transcript. Works while the agent is running; follow up, cancel and copy from the panel. `/btw` alone reopens the last answer. |
| **Voice dictation** | Mic button in the composer | Records in the browser and transcribes through any OpenAI-compatible `/audio/transcriptions` endpoint. Shown only when configured (see below). |
| **Command palette** | ⌘K / Ctrl+K | Jump to a session, start a chat, open a Settings section, switch theme. |
| **macOS service** | `npm run service:install` | Runs a production build at login via launchd, separate from the dev checkout. |

### Voice dictation setup

Set these in the environment of the server (or before `npm run service:install`):

```bash
PI_WEBUI_STT_ENDPOINT=http://127.0.0.1:8080/v1/audio/transcriptions   # any OpenAI-compatible STT
PI_WEBUI_STT_KEY=...        # optional bearer token
PI_WEBUI_STT_MODEL=...      # optional model name
```

ompweb's `OMP_WEB_STT_*` names are still read as a fallback.

### Running it

```bash
npm ci
npm run dev                 # development, http://127.0.0.1:30141
npm run service:install     # macOS: build + run at login, http://127.0.0.1:30140
npm run service:status      # also: service:logs, service:restart, service:uninstall
```

The service deploys its own copy to `~/Library/Application Support/pi-webui/app`, so
re-run `npm run service:install` after pulling changes.

Attribution for the ported code is in [`NOTICE.md`](./NOTICE.md).

---

# Pi Web (upstream documentation)

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Local browser UI for the [pi coding agent](https://github.com/earendil-works/pi). Pi Web uses the same local configuration and session files as pi, so you can browse and resume conversations, run agent turns, configure models and resources, and inspect project files from a browser.

**[Try the interactive demo →](https://agegr.github.io/pi-web/)** The real Pi Web UI runs entirely in your browser, with sample sessions, files and models. There is nothing to install; replies are pre-written and no model is called.

![Pi Web displaying a pi session with structured Markdown, tool calls, and project navigation](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## Features

- **Session workspace**: browse, resume, rename, export, and delete conversations grouped by project, with running state, context usage, cost, and compaction details.
- **Two ways to branch**: **New session** creates an independent session file from an earlier message; **Edit from here** creates a branch inside the current session.
- **Project file tools**: browse and upload files, inspect Git diffs, and preview source, Markdown, images, audio, PDFs, and DOCX files with automatic refresh.
- **Git worktrees**: switch checkouts from the sidebar while keeping sessions from the same repository grouped together.
- **Web-based configuration**: manage provider login and API keys, models, model tests, plugin packages, and skills without leaving Pi Web.
- **English, Simplified Chinese, and Traditional Chinese UI**: Pi Web follows the browser language initially and provides a language switcher in the top bar.

## Quick Start

Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`, then run:

```bash
npx @agegr/pi-web@latest
```

The CLI opens a browser after the server is ready. If it does not, open [http://127.0.0.1:30141](http://127.0.0.1:30141). Pi Web listens only on `127.0.0.1` by default.

If no model provider is configured yet, open the **Models** panel to sign in or add an API key.

To install the `pi-web` command globally:

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

To update, stop the running process with `Ctrl+C` and run the same install command again. To uninstall, run `npm uninstall -g @agegr/pi-web`.

## Configuration

For port and hostname, command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening. Run `pi-web --help` (or `-h`) to print startup options and exit without starting the server. Unknown options exit with an error.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--help`, `-h` | Print startup options and exit | — |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30141` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `PI_WEB_SKIP_VERSION_CHECK=1` | Disable Pi Web update checks | Unset |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable browser password login; API clients may use Basic Auth with username `pi` | Authentication disabled |
| `PI_WEB_IDLE_TIMEOUT_MS` | Session idle timeout in milliseconds, up to `2147483647`; `0` disables idle shutdown; invalid or out-of-range values use the default | `600000` (10 min) |
| `PI_WEB_SHUTDOWN_DEADLINE_MS` | How long extensions get to handle `session_shutdown` before a closing session is disposed anyway, in milliseconds up to `2147483647`; `0`, invalid or out-of-range values use the default | `5000` (5 s) |

For example:

```bash
pi-web --help
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### Remote Access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Password authentication does not encrypt the connection. Do not expose Pi Web over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address Pi Web binds to.

### HTTP Proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Notes

- **Agent data**: Pi Web reads pi data from `~/.pi/agent` by default, including session files under `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Set `PI_CODING_AGENT_DIR` to use another pi agent directory.
- **Filesystem access**: Pi Web must be able to read the agent data directory and the working directories recorded by its sessions. Run Pi Web in the same filesystem environment as pi when sharing existing sessions.
- **Shared configuration**: the Models panel uses pi's model, settings, and credential storage, so changes are visible to both interfaces.
- **File access boundary**: the file browser is limited to working directories selected in Pi Web and project or session roots it already knows about; it is not a general filesystem browser.
- **Git worktrees**: see [Worktrees in Pi Web](./docs/worktrees.md) for switcher visibility, worktree creation, and removal behavior.

### Downstream Session Context Menu

Electron wrappers and other downstream integrations can provide a session-row
context menu without patching `SessionSidebar`. Listen for the cancelable
`pi-web:session-row-contextmenu` browser event and call `preventDefault()`
synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object contains `id`, `path`, `cwd`, optional `name`, pointer
coordinates, and a `refresh()` callback for actions that change the session
list. If no listener cancels the extension event, Pi Web preserves the
browser's native context menu. This hook is browser-side and independent of
Pi agent extensions.

### Extension Session Liveness

Server-side Pi extensions with detached work can prevent automatic idle
session eviction through the versioned global registry:

```js
const liveness = globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

Register once per active extension session and call the returned idempotent
`release` function on session shutdown, replacement, or reload. `isActive`
must be synchronous, cheap, and scoped to the supplied exact session id or
file. Provider errors fail safe by preserving that session. This lease only
affects automatic idle eviction; explicit shutdown and Stop fallback cleanup
still take precedence.

## Development

```bash
npm install
npm run dev
```

The development server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141). Run the common checks with:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run `next build` or `npm run build` during normal development. It writes to `.next/` and can interfere with the development server; leave builds for release work.

Contributor guides: [Internationalization](./docs/i18n.md) and [Release process](./docs/release.md).

## Repository Layout

```text
app/             Next.js UI and API routes
components/      React UI components
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
public/          Static assets and PWA files
bin/             npm CLI entrypoint and launch option parsing
docs/            Focused user and contributor guides
demo/            Static browser demo published to GitHub Pages (see demo/README.md)
```

See [AGENTS.md](./AGENTS.md) for the architecture notes and detailed file map.

## License

[MIT](./LICENSE)
