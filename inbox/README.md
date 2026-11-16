# Inbox — paste anything here

Drop markdown files, agent definitions, skills, commands, specs, or notes into this folder, then tell Claude **"process the inbox"** (or run `/process-inbox`). Claude reads each file, takes action, and archives the original to `inbox/processed/`.

Empty inbox = nothing pending.

## Where things end up

| You paste | Claude puts it |
|---|---|
| Agent definition | `.claude/agents/<name>.md` — auto-loaded as a subagent |
| Skill | `.claude/skills/<name>/SKILL.md` — auto-loaded |
| Slash command | `.claude/commands/<name>.md` — run it as `/<name>` |
| Standing rule / instruction | `instructions/<topic>.md` |
| Reference doc / spec / note | `knowledge/<topic>.md` |
| One-off task | Executed directly, not filed |

## Formats

**Agent** (needs `name` and `description` in frontmatter):

```markdown
---
name: researcher
description: Researches a topic and returns a cited summary. Use for fact-finding.
tools: WebSearch, WebFetch, Read   # optional — omit to inherit all tools
model: sonnet                      # optional
---

You are a research agent. ...
```

**Skill** (a folder with a SKILL.md):

```markdown
---
name: my-skill
description: What it does and when Claude should use it
---

Step-by-step instructions for the task...
```

**Slash command:**

```markdown
---
description: What the command does
---

The prompt Claude should execute. $ARGUMENTS is replaced by whatever is typed after the command.
```

Plain markdown with no frontmatter is fine too — Claude will classify it as an instruction, reference doc, or one-off task automatically. If a file is ambiguous, Claude will ask.
