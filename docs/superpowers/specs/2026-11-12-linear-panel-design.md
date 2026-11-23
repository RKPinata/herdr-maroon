# Linear panel for Herdr

A Herdr app mod named `linear`. It shows Linear tickets in the right-side panel, beside
Files, PRs and Timeline, and hands a ticket or a comment to a coding agent.

The panel is built around one open ticket. The home screen exists to reach that ticket.

## Where it lives

| What | Path |
|---|---|
| Source | `~/Repo/herdr-linear/mods/linear/` |
| Installed copy | `~/.config/herdr-app/mods/linear/` |
| Panel slot | a `linear` block in the `panel-body` stack of `~/.config/herdr-app/layouts/danish.json` |
| Panel button | one entry in the button list of `~/.config/herdr-app/mods/my-annotator-tabs/main.js` |

`scripts/install.sh` runs `herdr-app check` on `mods/linear/` and copies it to the installed
path. The layout block and the button are personal config. They are added once, by
hand, with a backup of each file.

`mod.json`: `{ "place": "none", "title": "Linear" }`. The layout places it.

## Screens

```
Home ──row──▶ Ticket ──sub-issue / parent / relation──▶ Ticket ...
  ├──project──▶ Project issues ──row──▶ Ticket
  └──favorite view──▶ View issues ──row──▶ Ticket
```

A back button returns along the stack. Each space has its own stack; see
`2026-11-12-favorites-and-space-panel-design.md`. The panel works from 280 px to 900 px wide.
A ticket can also move out of the panel into a tab of its own (see Ticket tab).

### Home

```
┌────────────────────────────────────────┐
│ Search: key, 212, URL or text▌      ↻  │
├────────────────────────────────────────┤
│ [My issues] Favorites Projects Recent  │
├────────────────────────────────────────┤
│ This branch → WEB-736 Fix signing key  │
├────────────────────────────────────────┤
│ In Progress 2                          │
│  ◐ WEB-736 Fix signing key      High   │
│  ◐ WEB-702 Retry backoff        Med    │
│ Todo 1                                 │
│  ○ WEB-741 Grace window         High   │
└────────────────────────────────────────┘
```

- **Search** reads its input in this order:
  1. A Linear issue URL (`https://linear.app/<org>/issue/WEB-212/...`) opens `WEB-212`.
  2. A key such as `WEB-212` (any case) opens that ticket.
  3. A bare number such as `212` lists the issues with that number in the viewer's teams.
  4. Other text lists the first 25 results of `searchIssues`.
- **My issues** lists the viewer's assigned issues that are not completed or canceled.
  Groups follow the state type: started, unstarted, backlog, triage. Inside a group, rows
  sort by priority (Urgent first, no priority last), then by most recent update.
- **Favorites** mirrors the viewer's Linear favorites, folders included. See
  `2026-11-12-favorites-and-space-panel-design.md`.
- **Projects** lists the projects of the viewer's teams that are not completed or
  canceled, most recently updated first. A project opens its open issues, grouped as in
  My issues.
- **Recent** lists the last 20 tickets opened in the panel, newest first. It is stored in
  the side panel's local storage and costs no API call.
- **This branch** is one row on Home, Project, View and search screens. It shows when
  `issueVcsBranchSearch(branchName)` finds a ticket for the focused pane's git branch
  (`PaneInfo.branch` of `focused().pane`). It never opens the ticket by itself.

### Ticket

```
┌────────────────────────────────────────┐
│ ← WEB-736                   ↻   ⧉   ↗  │
├────────────────────────────────────────┤
│ In Progress ▾ · High · Me ▾            │
│ Fix webhook signing key rotation       │
│ Bug, Backend · Webhooks · Cycle 42     │
│ Parent  WEB-700 Webhook hardening      │
│ [Start agent ▾] [Send to agent]        │
│ [Copy ▾]                               │
├────────────────────────────────────────┤
│ description (Markdown)                 │
├────────────────────────────────────────┤
│ Sub-issues 1/2                         │
│ Links                                  │
│ Blocks / Blocked by / Related          │
├────────────────────────────────────────┤
│ Comments 2                             │
│  QA · 2h                [Reply] [Send] │
│  Still fails on retry.                 │
│    └ You · 1h                          │
│ ┌ Comment…              ⌘Enter ──────┐ │
└────────────────────────────────────────┘
```

- **Header:** identifier, status, priority, assignee, title, labels, project, cycle, due
  date, estimate, parent. Empty fields are left out.
- **Description and comments** render with `TextView.markdown`. Images show as links.
- **Sub-issues, parent and relations** open in the panel. Relations show as Blocks,
  Blocked by, Related and Duplicate of.
- **Links** are the issue's attachments (GitHub PRs, Figma, Sentry, Slack). A click on an
  `http` or `https` link opens it with the system handler. Other links show as plain text.
- **Comments** are threads. Top-level comments run oldest first, and replies sit under
  their parent.

### Ticket actions

| Control | Effect |
|---|---|
| Status ▾ | Lists the team's workflow states in type order, then by `position`. Picking one runs `issueUpdate { stateId }`. |
| Assignee ▾ | "Assign to me", or "Unassign" when the viewer is the assignee. Runs `issueUpdate { assigneeId }`. |
| Comment box | Sits after the comments, also when there are none. ⌘Enter or Send runs `commentCreate { issueId, body }`. A blank box sends nothing. |
| Reply | Opens the comment box under that thread. Sends with `parentId`. |
| Copy ▾ | Copies the identifier, Linear's `branchName` or the URL with `cx.write_to_clipboard`. |
| ☆ / ★ | Adds the ticket to the viewer's Linear favorites with `favoriteCreate`, or removes it with `favoriteDelete`. |
| ⧉ | Moves the ticket into a tab of its own, or selects the ticket's tab when the focused space has one. The panel goes back one screen. |
| ↗ | Opens the issue URL with the system handler. |
| ↻ | Fetches the ticket again. |

After each change the panel fetches the ticket again, or refreshes its cache when another
screen is open by then. A failed change, or one Linear answers with `success: false`, keeps
the typed comment and shows Linear's error in a `notify` toast. A status, assignee or star
click while another is in flight is ignored.

### Ticket tab

⧉ runs `run("tab.new", { name: "<KEY>", space: focused().space, mod: "linear", props: { ticket: "<KEY>" } })`.
When the focused space already has a tab named `<KEY>` that holds a `linear` pane, ⧉ runs
`run("tab.select", { id })` for that tab instead.

The new tab's only pane is a copy of this mod. A copy with `props.ticket` opens on that
ticket and has no Home, no branch row, no Recent list and no ⧉. Its ← shows only after it
opens a sub-issue, the parent or a relation. Everything else on the Ticket screen works as
in the panel.

## Agent bridge

The send buttons paste into one target agent, an `agents()` entry:

| Where | Target |
|---|---|
| Side panel, a pane focused | The agent in `focused().pane`. |
| Side panel, no pane focused (the panel has the keyboard) | The agent targeted while a pane last had the keyboard, if it still runs. |
| Ticket tab | The agent in `focused().space` whose `tab_name` is the ticket's key, else the agent in that space with the highest `seq`. |

The send buttons' tooltip names the target: "Send to <agent title>". With no target, they
are dimmed, ignore clicks, and their tooltip says "Focus an agent's pane first."

| Control | What it runs |
|---|---|
| Send to agent | `hc send <agent.address> "<ticket line>"` |
| Send (on a comment) | `hc send <agent.address> "<comment text>"` |
| Start agent ▾ | Lists `knownAgents({ on: <focused space's machine> })` as Herdr's + menu does: installed agents, then two that are not installed (dimmed). Picking one runs `run("tab.new", { name: "<KEY>", space: focused().space, argv: agent.run, task: "<start text>" })`. |

The agent list loads when the copy starts and again each time the menu opens. A failed
check keeps the last list, or shows "Couldn't list agents" when there is none.

`hc send` pastes the text and presses Enter. The texts:

```text
ticket line:   Linear WEB-736: Fix webhook signing key rotation https://linear.app/acme/issue/WEB-736
comment text:  Comment on WEB-736 from QA (https://linear.app/acme/issue/WEB-736#comment-9f2c):
               Still fails on retry.
start text:    Work on Linear issue WEB-736: Fix webhook signing key rotation
               https://linear.app/acme/issue/WEB-736
               Read the issue and its comments with the Linear MCP before you start.
```

The mod creates no branch and no worktree. The agent does that through its own skills.

## Data

```
Keychain ──key──▶ main.js readKey ──▶ linear.js ──POST https://api.linear.app/graphql──▶ Linear
                                         │
                                         ├──▶ localStorage "cache:<query>:<vars>" ──▶ screens (stale first, then fresh)
                                         ├──▶ localStorage "recent" (20 tickets, side panel only)
                                         ├──▶ localStorage "spaces" (each space's screens, side panel only)
                                         └──▶ localStorage "closedFolders" (Favorites folders shown closed)
```

Each mod copy has its own `localStorage`. A ticket tab has its own cache, so a change made
in one copy shows in another after that copy's next fetch.

- **Key:** a Linear personal API key in the macOS Keychain, service `herdr-linear`. The
  mod reads it with `exec("security", ["find-generic-password", "-s", "herdr-linear", "-w"])`
  and sends it as the `Authorization` header. The user stores it with:

  ```sh
  security add-generic-password -U -s herdr-linear -a "$USER" -w
  ```

  `-w` as the last option prompts for the key, so the key stays out of shell history.
- **Freshness:** a screen draws its cached copy at once and then fetches. Issue lists,
  projects and tickets refetch when older than 60 s. The ticket query carries the team's
  workflow states and the viewer id.
- **Refresh:** while a copy is on screen, its open screen refetches every 60 s, with no
  spinner over the data it shows and no new branch lookup. When it
  comes back on screen, it fetches the open screen if the cached copy is older than 60 s.
  The side panel is on screen while the `linear` block is the shown child of a visible
  panel. A ticket tab is on screen while it is the shown tab of the shown space: the tab
  named after the ticket that holds a `linear` pane. A copy that is not on screen makes no
  timed requests.
- **Ticket query:**

  ```graphql
  query Ticket($id: String!) {
    viewer { id }
    issue(id: $id) {
      id identifier title url branchName priority priorityLabel description dueDate estimate
      state { id name color }
      assignee { id name }
      labels { nodes { name } }
      project { name }
      favorite { id }
      cycle { number name }
      parent { identifier title }
      children { nodes { identifier title state { name type color } } }
      relations { nodes { type relatedIssue { identifier title state { color } } } }
      inverseRelations { nodes { type issue { identifier title state { color } } } }
      attachments { nodes { title subtitle url } }
      comments(first: 100) { nodes { id body createdAt url user { name } parent { id } } }
      team { states { nodes { id name type position color } } }
    }
  }
  ```

## Errors

| Case | What the panel shows |
|---|---|
| No key in the Keychain | A setup card with the `security` command and a "Check again" button. |
| HTTP 401, or an authentication error from Linear | "Linear rejected the key", plus the setup card. |
| Network failure or HTTP 5xx | The cached data, under a bar: "Offline · data from 3 min ago". ↻ retries. |
| A GraphQL `errors` entry | Its first `message`, in place of the screen's body. |
| Unknown ticket key | "WEB-999 not found" on the search row. |

## Code layout

| File | Holds |
|---|---|
| `mods/linear/main.js` | The `View`: screen stack, loading, actions, agent bridge, timers. Also `readKey` (the Keychain read) and `pruneCache`. |
| `mods/linear/queries.js` | The GraphQL documents. |
| `mods/linear/linear.js` | `createClient`: `fetch` calls, error kinds, the cache. |
| `mods/linear/model.js` | Pure functions: search parsing, grouping and sorting, comment threads, state order, relations, agent texts, the target agent, panel and ticket tab visibility, the favorites tree, saved spaces. |
| `mods/linear/home.js` | The Home, Project and View screens, `renderProblem` (setup card, error, offline bar), and the row builders these screens use. |
| `mods/linear/ticket.js` | The Ticket screen. |
| `mods/linear/linear.svg` | The panel button icon. |
| `tests/model.test.mjs` | `model.js`. |
| `tests/linear.test.mjs` | `linear.js`, with a fake `fetch` and in-memory storage. |
| `tests/queries.test.mjs` | Validates every document in `queries.js` against Linear's schema. |

`model.js` imports nothing from `herdr` or `gpui-kit`, so Node runs its tests directly.

## Checks

- `npm test` runs `node --test 'tests/*.test.mjs'`. Its `pretest` step fetches Linear's
  schema to `.cache/linear-schema.graphql` with `gh` when the file is missing.
- `herdr-app check mods/linear` passes before each install.
- After install, `herdr-app shot` shows the Home and Ticket screens in the running window.

## Not included

List and board views beyond the four Home tabs, cycles, saved views outside Favorites, the
inbox, creating issues, and editing the title, description, labels, priority or estimate.
