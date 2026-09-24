# ShellGPT CLI Reference

Live sources when anything looks stale: `shellgpt --help`, `shellgpt <command> --help`,
https://shellgpt-agent.nousresearch.com/docs/reference/cli-commands

### Global Flags

```
shellgpt [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
shellgpt chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
shellgpt setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
shellgpt model                Interactive model/provider picker
shellgpt fallback [add|remove|list]  Fallback provider chain
shellgpt config [show|edit|get|set|unset|path|env-path|check|migrate]
shellgpt login / logout       OAuth sign-in / clear stored auth
shellgpt doctor [--fix]       Check dependencies and config
shellgpt status [--all]       Component status
```

### Tools & Skills

```
shellgpt tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

shellgpt skills list|browse|search QUERY|inspect ID
shellgpt skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
shellgpt skills config        Enable/disable skills per platform
shellgpt skills check|update|uninstall|publish PATH
shellgpt skills tap add REPO  Add a GitHub repo as a skill source
shellgpt bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
shellgpt mcp add NAME (--url or --command) | remove | list | test NAME
shellgpt mcp catalog | install NAME     Curated catalog install
shellgpt mcp configure NAME             Toggle tool selection
shellgpt mcp serve                      Run ShellGPT as an MCP server
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
shellgpt gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `shellgpt photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
Docs: https://shellgpt-agent.nousresearch.com/docs/user-guide/messaging/

### Sessions

```
shellgpt sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
shellgpt cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
shellgpt webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
shellgpt profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
shellgpt profile rename A B | alias NAME | export NAME | import FILE
shellgpt profile migrate-identity A B   Retry a completed rename's session/routing identity migration
```

### Credentials & Pools

```
shellgpt auth                 Interactive credential manager
shellgpt auth add [PROVIDER]  Add OAuth or API-key credential (nous, openai-codex, qwen-oauth, …)
shellgpt auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
shellgpt desktop / gui        Native desktop app
shellgpt dashboard            Web admin panel + embedded chat (--stop / --status)
shellgpt proxy                OpenAI-compatible local proxy backed by an OAuth provider
shellgpt portal               Quick setup / sign in via Nous Portal
shellgpt kanban <verb>        Multi-agent work-queue board
shellgpt project              Named multi-folder workspaces
shellgpt skin list|use|set    Switch/tweak skins (see references/themes.md)
shellgpt pets <verb>          Pet mascots (see references/petdex.md)
shellgpt memory setup|status|off|reset   Memory provider
shellgpt secrets bitwarden|onepassword   External secret stores
shellgpt moa                  Mixture-of-Agents slots
shellgpt hooks / security / backup / import / checkpoints / console
shellgpt logs [-f] [errors]   View agent/error logs
shellgpt send                 One-off message through a gateway platform
shellgpt pairing / plugins / insights / journey / computer-use
shellgpt acp                  ACP server (IDE integration)
shellgpt completion bash|zsh|fish
shellgpt update / uninstall / claw migrate
```

Plugin- and provider-supplied subcommands (e.g. `shellgpt photon setup`) only appear once their plugin is installed/active.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `shellgpt config edit` · [Configuration docs](https://shellgpt-agent.nousresearch.com/docs/user-guide/configuration) |
| Tools / toolsets | `shellgpt tools list` · [Tools reference](https://shellgpt-agent.nousresearch.com/docs/reference/tools-reference) |
| Skills catalog | `shellgpt skills browse` · [Skills catalog](https://shellgpt-agent.nousresearch.com/docs/reference/skills-catalog) |
| Provider setup | `shellgpt model` · [Providers guide](https://shellgpt-agent.nousresearch.com/docs/integrations/providers) |
| Env variables | `shellgpt config env-path` · [Env vars reference](https://shellgpt-agent.nousresearch.com/docs/reference/environment-variables) |
| Gateway logs | `~/.shellgpt/logs/gateway.log` (or `shellgpt logs`) |
| Sessions | `shellgpt sessions browse` (reads state.db) |
