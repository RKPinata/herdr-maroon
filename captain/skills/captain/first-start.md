# First start

Follow these steps when `captain.md` does not exist yet. You are done when the user has confirmed the scope, `captain.md` exists and the board shows it.

1. **List the candidates.** Find every live Claude session in your space except your own, and its session name, as Lookups in `SKILL.md` says.
2. **Draft the scope.** Propose each candidate as crew, with the job it seems to work on. Read its repo and folder to judge that. Ask the user for the jobs, the crew and the grants.
3. **Get the yes.** The user confirms by typing in this tab. Change the draft until the user does.
4. **Write `captain.md`** in `~/.claude/captain/<workspace>/`, in the shape below. Each confirmed crew line says `user's tab`.
5. **Onboard the crew.** Send each crew session a SendMessage that tells it to load `/captain:im-a-crew`.
6. **Render the board** from `captain.md`.

## `captain.md` shape

```markdown
# Captain: web-testing-explorations

## Scope

Jobs:
- Region A e2e specs (WEB-1201)
- Region B e2e specs, after Region A
- WEB-1234 bugfix

Crew:
- region-a-3c   terminal t12   opened by captain   Region A
- bugfix-7c     terminal t15   user's tab          WEB-1234

Grants:
- Open draft PRs in respond-io-web

## Needs you

- [ ] region-a-3c: flaky specs in inbox.spec.ts, skip or fix?

## Jobs

- Region A e2e specs: 6 of 10 done, region-a-3c
- Region B e2e specs: blocked on Region A, no crew
- WEB-1234 bugfix: PR open, bugfix-7c
- Region C e2e specs: done, briefed, region-c-9a

## Since last check-in

- region-a-3c: task 6 done, starting task 7 of 10
- Call: answered bugfix-7c, use the existing date helper
```

The title holds the workspace name.
