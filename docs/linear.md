# Linear

Linear tickets in the [Herdr](https://herdr.dev) app's right-side panel, built around one open ticket. Send a ticket or a comment to the coding agent in the focused pane, or start a new agent on it.

The mod is `mods/linear`. `npm test` validates its queries against Linear's schema, which `scripts/fetch-schema.sh` downloads with `gh` into `.cache/`.

## API key

Create a personal API key at <https://linear.app/settings/account/security>. Store it in the macOS Keychain:

```sh
security add-generic-password -U -s herdr-linear -a "$USER" -w
```

The command prompts for the key, so it stays out of shell history.

## Add the panel

Add this block to the `children` of the `panel-body` stack in your layout, `~/.config/herdr-app/layouts/<name>.json`:

```json
{ "id": "linear", "type": "block", "content": { "mod": "linear" } }
```

If your tab bar mod lists panel buttons, add an entry like this:

```js
find(body, "linear") && ["linear", "Linear", "mods/linear/linear.svg"]
```

## Use

- **Spaces**: each Herdr space has its own panel. Its screens, tab and search come back when you return to the space, also after a restart.
- **Home**
  - The search box takes a key, a bare number, a Linear URL or text. Press Enter.
  - The tabs are My issues, Favorites, Projects and Recent.
  - Favorites shows your Linear favorites with their folders. An issue view opens its issues. A kind the panel has no screen for, such as a cycle, opens in Linear.
  - A "This branch" row shows the ticket for the git branch of the focused pane.
- **Ticket**
  - It shows status, assignee, description, sub-issues, links, relations and comments.
  - You can change the status, assign it to yourself, comment, reply, and copy the ID, branch name or link.
  - **☆** adds the ticket to your Linear favorites. **★** removes it.
  - **Start agent** lists the agents Herdr can start. The one you pick opens in a new tab and works on the ticket.
  - **Send to agent** and **Send** on a comment paste into one agent with `hc send`. The tooltip names it.
    - In the side panel: the agent in the focused pane. While the panel has the keyboard, the agent in the last focused pane.
    - In a ticket pane: the agent in the pane's tab that changed most recently. Else the agent in the focused space that changed most recently.
  - **⧉** opens the ticket in a pane beside the last focused pane.
  - Right-click a ticket pane for the layout's pane menu (its `terminal_menu`). The target carries `mod` and `props`, so a menu can move the pane to another tab by opening it again there.

## Development

```sh
npm test
npm run check
```

`npm test` runs Node tests for `model.js` and `linear.js`. It also checks the GraphQL documents against Linear's schema, which it fetches to `.cache/` with `gh`.

## License

MIT
