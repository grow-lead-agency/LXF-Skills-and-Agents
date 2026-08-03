# Where to get more skills

A short, opinionated list. Everything here was checked on **2026-08-03** — install counts
and star counts move, the judgement behind each entry is what matters.

A warning first, because it saves time: search results are full of repositories
advertising *"1000+ agent skills"*, *"110,000+ skills"*, *"the ultimate collection"*.
Skills are cheap to generate and expensive to verify, and those collections are mostly
unreviewed bulk — many are auto-generated, out of date, or wrong about APIs in ways that
cost you more debugging than they save. **Volume is not a quality signal.** Prefer a
maintained source with a named author who uses their own skills daily.

## The essentials

### [anthropics/skills](https://github.com/anthropics/skills) — official

Anthropic's own repository. Three reasons to start here even if you install nothing:

- **[`/spec`](https://github.com/anthropics/skills/tree/main/spec)** — the Agent Skills
  specification. When you write your own skill, this is the contract.
- **[`/template`](https://github.com/anthropics/skills/tree/main/template)** — a skeleton to copy.
- **`/skills`** — production-grade examples, including the `docx`/`pdf`/`pptx`/`xlsx`
  skills that power Claude's real document features. Reading those teaches you more about
  structuring a complex skill than any tutorial.

Most skills there are Apache 2.0; the document ones are source-available. Install as a
plugin marketplace:

```
/plugin marketplace add anthropics/skills
/plugin install example-skills@anthropic-agent-skills
```

### [mattpocock/skills](https://github.com/mattpocock/skills) — engineering process

*"Skills for Real Engineers. Straight from my .agents directory."* MIT. This is the best
complement to our pack: ours teach **the stack**, his teach **the process** — and process
is where most agent work actually fails.

The ones worth adopting on day one:

- **`/grill-me`, `/grill-with-docs`** — the agent interviews *you* until the plan has no
  ambiguity left. Misalignment is the number-one failure mode of agent work; this attacks
  it directly. `grill-with-docs` also builds a `CONTEXT.md` shared vocabulary for the
  project, which makes every later session shorter.
- **`/tdd`** — red-green-refactor loop with real guidance on what makes a test good.
- **`/diagnosing-bugs`** — reproduce → minimise → hypothesise → instrument → fix.
- **`/improve-codebase-architecture`** — periodic scan for modules worth deepening.
  An antidote to agent-accelerated entropy.
- **`/code-review`** — reviews the diff on two axes (repo standards, and faithfulness to
  the originating issue) using parallel sub-agents.

```
claude plugins install mattpocock-skills     # Claude Code, official marketplace
npx skills@latest add mattpocock/skills      # Codex and other agents
```

Then run `/setup-matt-pocock-skills` once per repository.

### [obra/superpowers](https://github.com/obra/superpowers) — discipline skills

A widely-installed collection (hundreds of thousands of installs via skills.sh) focused on
agent discipline rather than any framework: `systematic-debugging`,
`verification-before-completion`, `writing-plans` / `executing-plans`,
`subagent-driven-development`, `requesting-code-review`. Worth browsing even if you adopt
only the verification habits.

## Where to look for more

- **[skills.sh](https://skills.sh)** — the open registry, with a leaderboard ranked by real
  install counts. `npx skills add <owner>/<repo>` installs into your repo as editable
  files you own. The leaderboard is the single most honest quality signal available:
  it shows what people keep installing, not what someone bulk-generated.
- **[agentskills.io](https://agentskills.io)** — the standard itself. Skills written to
  this spec work across Claude Code, Codex, Cursor, Gemini CLI and others, so nothing you
  write here is locked to one vendor.
- **Vendor-published skills** — several vendors now ship official skills for their own
  products (Microsoft/Azure, Vercel, Supabase, Convex, Prisma, Sentry, Playwright). When a
  vendor maintains one for a tool you use, prefer it over a community copy: it is updated
  when the product changes.

## Live documentation beats any skill

Skills encode conventions and judgement. They do **not** replace current API docs — and an
agent working from training-data memory will confidently invent method signatures.

Install [Context7](https://context7.com) so the agent can pull version-accurate docs for
Laravel, NestJS, Apollo, React and everything else on demand:

```bash
claude mcp add context7 -- npx -y @upstash/context7-mcp
```

## Writing your own

The highest-value skill in any repository is the one nobody else could write: the
conventions of *your* codebase. The trigger to write one is simple — **when you find
yourself correcting the agent about the same thing twice, that correction is a skill.**

Keep the 80% path in `SKILL.md` (aim for under ~400 lines), push depth into
`references/*.md`, and put the phrases developers actually type into the `description`,
because that is what the agent matches against. Matt's `writing-great-skills` and
Anthropic's `skill-creator` both cover the craft well.
