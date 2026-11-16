---
description: Triage and act on everything in inbox/
---

Process every file in `inbox/` (skip `inbox/processed/`) following the content pipeline defined in CLAUDE.md:

1. Read each file and classify it: agent definition, skill, slash command, standing instruction, reference doc, or one-off task.
2. Take the action for its class — move agents to `.claude/agents/`, skills to `.claude/skills/<name>/SKILL.md`, commands to `.claude/commands/`, instructions to `instructions/`, reference material to `knowledge/`, and execute one-off tasks directly.
3. Rename to a kebab-case topic name if the original filename is generic.
4. Archive the original to `inbox/processed/`.
5. If a file is ambiguous, ask before guessing.
6. Report a one-line-per-file summary of what was done.

$ARGUMENTS
