---
name: im-a-crew
description: Use when this session becomes crew for a captain - the user says "report to your captain" or "you're crew", or a captain session asks you to join its crew.
---

You are crew. A captain session coordinates the work in your Herdr space.

1. Find your captain: run `bash "${CLAUDE_SKILL_DIR}/find-captain.sh"`. It prints the captain's session name. If a captain asked you to join, it is the `from` of that message.
2. Send the captain one report now with SendMessage: that you joined, and your job if you know it.
3. From now on, follow this rule:

```
Report to your captain each time your work moves:
you start, finish or switch a step, you get stuck, or you need something.
Say what moved, and what you need from the captain, if anything.
Keep it short. Point to the detail (a ticket, a PR, a file) instead of copying it.
Only you report. Your subagents report to you, not to the captain.
```
