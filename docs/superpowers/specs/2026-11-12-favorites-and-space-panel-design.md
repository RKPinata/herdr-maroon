# Favorites and a panel per space

The `linear` side panel keeps a separate context for each Herdr space. Home has a
Favorites tab that mirrors the viewer's Linear favorites, and the Ticket screen has a
star that adds or removes the ticket there. The rest of the mod is in
`2026-11-12-linear-panel-design.md`.

The panel is for moving around and reading. A ticket kept open for reference stays in
its space's panel, or moves to a ticket tab with ⧉.

## Panel per space

The panel follows the shown space: the entry in `spaces()` with `active: true`.

| Per space | Shared by all spaces |
|---|---|
| screen stack | Recent |
| Home tab | list and ticket cache |
| submitted search | comment drafts |
| | closed folders in Favorites |

- When the shown space changes, the panel stores the old space's context, shows the new
  space's context, closes any open menu and loads the top screen. A space seen for the
  first time starts on Home → My issues.
- The search box is one input. On a space change it shows the new space's submitted
  search, and setting it does not run a search.
- `localStorage` key `spaces` holds `{ [spaceId]: { stack, tab, search: { kind, value } } }`.
  The panel writes it after each open, back, tab change, search and space change.
- Herdr keeps space ids across restarts (its own `view.json` is keyed by them), so each
  space's panel comes back after a restart.
- On start, the panel drops saved spaces whose ids are not in `spaces()`. It drops none
  unless every machine in `machines()` is `ready`: a loading machine's spaces are not in
  `spaces()` yet.
- Stack entries are plain data: `{ screen: "home" }`, `{ screen: "project", id, name }`,
  `{ screen: "view", id, name }`, `{ screen: "ticket", key }`.
- `dropDraft` frees a ticket's comment box only when no space's stack holds that ticket.
- A ticket tab (`props.ticket`) shows one fixed ticket. It does not read or write `spaces`.

## Favorites tab

Home tabs: My issues, Favorites, Projects, Recent.

```
┌────────────────────────────────────────┐
│ My issues [Favorites] Projects Recent  │
├────────────────────────────────────────┤
│ ▾ Ongoing Tickets                      │
│     ● ABC-12  Webhook settings …       │
│     ● ABC-40  Segment filter …         │
│ ▸ proj-web-automation                  │
│ ● Flight Bugs                          │
│ ● Q4 Improvements                      │
└────────────────────────────────────────┘
```

### Data

The `Favorites` query reads `favorites(first: 250)`. Each node has `id type sortOrder
folderName url parent { id }`, plus `issue { <row fields> }`, `project { id name color }`,
`customView { id name color modelName }`, `cycle { name number }` and
`document { title }`. The tab uses the same cache and 60 s refresh as the other Home tabs.

`favoriteTree(nodes)` in `model.js` returns the top-level favorites in `sortOrder`. Each
folder has a `children` array in `sortOrder`, and folders can hold folders. A node whose
parent is not in the list goes to the top level.

### Rows

| Favorite | Row | Click |
|---|---|---|
| folder | ▸ or ▾, `folderName`; children indented under it | opens or closes it in place |
| issue | the My issues row: state dot, identifier, title | Ticket screen |
| project | color dot, name | Project screen |
| custom view, `modelName: "Issue"` | color dot, name | View screen |
| any other favorite | its name, else its `type` | opens `url` in Linear |

- Folders start open. `localStorage` key `closedFolders` holds the ids of closed folders.
- A favorite with no screen in the panel and no `url` is left out.
- An empty tab shows "Nothing here", as the other tabs do.

### View screen

`{ screen: "view", id, name }` has a ← back row, like the Project screen. The `ViewIssues`
query reads `customView(id: $id) { id name issues(first: 100) { nodes { <row fields> } } }`.
The view's own filters choose the issues. They are grouped by status, as on the
Project screen.

## Star

The Ticket screen header has ☆ before ⧉. It shows ★ when the issue is a favorite. The
tooltip is "Add to favorites" or "Remove from favorites".

- The `Ticket` query reads `favorite { id }` on the issue.
- A click runs `favoriteCreate(input: { issueId })`, or `favoriteDelete(id)` with the
  issue's favorite id, through `mutate()`. A click while another change to the ticket is
  in flight does nothing.
- On success, the side panel refetches `Favorites` with `ttl: 0`. A click while the ticket
  reloads is ignored, because ☆/★ may show the old state then.
- Linear puts a new favorite at the top level. Moving it into a folder is done in Linear.
- A ticket tab has the same ☆. Each mod copy has its own cache, so a star from a ticket
  tab reaches the panel's Favorites tab on one of the panel's timed refreshes, within two
  minutes.

## Errors

- A failed star shows Linear's message in a notification, as a failed status change does.
- The Favorites tab and the View screen use the setup, error and offline cards of the
  other lists.

## Code layout

| File | Holds |
|---|---|
| `queries.js` | `FAVORITES`, `VIEW_ISSUES`, `FAVORITE_CREATE`, `FAVORITE_DELETE`; `favorite { id }` in `TICKET` |
| `model.js` | `favoriteTree`, `keepSpaces(saved, ids)` |
| `home.js` | the Favorites tab and its rows; the View screen's list |
| `ticket.js` | ☆ |
| `main.js` | the per-space context, the `spaces` and `closedFolders` keys, the View screen request, the star |

## Checks

- `model.test.mjs` tests `favoriteTree`: sort order, folder children, a nested folder, an
  orphan going to the top level. It tests `keepSpaces`: it drops gone ids, and keeps all
  when the id list is empty.
- `queries.test.mjs` lists the four new documents in its export check. Each one validates
  against Linear's schema.
- `herdr-app check mods/linear` passes. After install, `herdr-app shot` shows the
  Favorites tab, and two spaces show different screens.
- The README "Use" section and the panel spec (Home, Ticket actions, Not included)
  describe Favorites, the star and the per-space panel.
