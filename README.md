# aws-archify

AWS Reference Architecture diagrams from a JSON spec — a print-ready PNG, an
interactive viewer with a signal-flow trace, and a looping GIF of data moving
through the steps, all from one source that cannot drift.

```bash
npx skills add dga-devops/aws-archify -g
```

Works with Claude Code, Cursor, Codex, OpenCode and the other agents the
[`skills`](https://github.com/vercel-labs/skills) CLI supports.

---

## Why

Two good things existed separately.

The **AWS Reference Architecture format** is what an architecture diagram should
look like when it goes into a design doc: official icons, standard boundary
colours, orthogonal arrows, numbered steps tied to prose. It prints, it survives
review, it looks like the AWS documentation it sits next to. But it is a static
picture, and hand-placing every arrow is slow enough that people skip the
geometry checks.

An **interactive diagram** — one that traces the signal along each edge, lets
you click a node to see what touches it, and follows a route end to end —
explains a system far better in a conversation. We saw that done well in
[**archify**](https://github.com/tt-a1i/archify) by [tt-a1i](https://github.com/tt-a1i),
and it is the reason this project exists at all. But an interactive diagram tool
draws its own house style, not the AWS one, and its output is not what you paste
into a PDF.

`aws-archify` takes one JSON spec and emits both, from the same layout engine
and the same arrow router. The animation is the printed diagram with a clock on
it: when the trace finishes, what remains on screen is pixel-identical to the
PNG.

## What you get

| Output | Command | For |
|---|---|---|
| `my-diagram.png` | `render` | 1920×1080 (or 4K with `--scale=2`). Docs, slides, PDFs. **The draft and the artefact of record.** |
| `my-diagram.live.html` | `live` | ~110 KB, self-contained, no server. Trace animation, click-to-focus, route tracing, dark theme, print-to-PDF. |
| `my-diagram.gif` | `gif` | A looping GIF, ~200–400 KB. Packets travel the arrows in step order; the running step's badge pulses and its sentence is highlighted. For Slack, LINE, Teams, a README, a slide. |
| `my-diagram.card.png` | `card` | 1200×630 at 2×, the Open Graph frame — for the post that links to the doc. `gif --card` animates it. |
| all of the above + a receipt | `deliver` | PNG + live HTML + `receipt.json`, for committing to a docs repository. |

## How the agent uses it

Draft as a **PNG**, because a diagram is almost never right on the first pass
and a PNG renders in two seconds. Iterate on the PNG until the person asking is
happy with it. Then offer the interactive page or the GIF — both are built from
the spec that was just approved, so their content needs no second review. If
someone asks for a GIF up front, they get a GIF.

### As a slash command

In Claude Code the skill is also a command. Talk to it normally, or name the
output directly:

```
/aws-archify                          draw or edit a diagram, conversationally
/aws-archify live                     interactive HTML of the diagram just worked on
/aws-archify gif web-app.json         looping GIF of a specific spec
/aws-archify card                     1200×630 share card
/aws-archify diff as-is.json to-be.json
```

The first argument is the output (`png`, `live`, `gif`, `card`, `deliver`,
`diff`, `validate`); the second, optional, is the spec. Without one, the agent
uses the spec the conversation has been working on, and asks if that is
ambiguous. Naming a format skips the PNG-first round — you said what you want.

### In Claude chat (desktop, web, mobile)

`npx skills add` installs onto your own machine, for Claude Code and the other
coding agents. Claude's regular chat takes skills a different way — as a ZIP
uploaded under **Settings › Capabilities › Skills** — and validates it: the
skill folder at the root, only the frontmatter keys it knows, no spaces or
punctuation in file names, at most 200 files. GitHub's "Download ZIP" of this
repository fails all four — the icon set alone is 862 files. Use the one
attached to each release instead, which carries the icons in a single
`bundle.json` (25 files, under 1 MB):

**[Download aws-archify.zip](https://github.com/dga-devops/aws-archify/releases/latest/download/aws-archify.zip)**
— then Claude › Settings › Capabilities › Skills › Upload skill.

Or build it yourself from a checkout, which produces the same bytes:

```bash
node skills/aws-archify/bin/aws-archify.mjs pack     # -> aws-archify.zip
```

One caveat, stated plainly: an uploaded skill runs in Claude's cloud sandbox,
not on your machine. PNG, GIF and geometry validation need Chrome or Edge; if
the sandbox has no browser, only the HTML output and spec checks will work
there. Ask it to run `doctor` after uploading to see what it has.

## Design decisions

**JSON is the source.** Not HTML. An agent can edit a spec reliably, a diff of a
spec is readable, and the schema catches a mistake before a browser is involved.

**Arrows are declared, never drawn.** You write `{"from": "lam:right:-14", "to":
"ep1:left:-14"}`; the router computes the orthogonal path from the real icon
edges. It is incapable of emitting a diagonal or a curve, which is what the AWS
format requires.

**The validator is not optional.** It runs on every build, in both modes. It
fails a diagram whose arrows cross text, whose numbers collide, whose parallel
runs are under 24px apart, or whose canvas numbering disagrees with the callout
panel. `deliver` exits non-zero and writes nothing.

**Icons are inlined at build time.** The 862 official AWS SVGs ship with the
skill; the one you name is embedded as a data URI. A misspelled icon is a build
error listing the candidates — it can no longer become a blank box that ships.

**Motion is honest about its medium.** In the live viewer the trace plays once
and settles into the static diagram; it respects `prefers-reduced-motion`, and
print strips every trace of the viewer. A GIF has no settled state to arrive
at, so there the rule becomes: *every frame is a complete, readable diagram,
and the first frame is the still one* — held for 1.2 s, because chat previews,
Confluence, email clients with animation off and PDF exports show only the
first frame.

**The GIF encoder is part of the tool.** No ffmpeg, no ImageMagick. Chrome is
driven frame by frame over the DevTools protocol, and a small encoder stores
only the rectangle that changed in each frame — the still diagram costs its
bytes once. A 1920×1080 six-second loop comes out under 400 KB.

**Diagnostics say what to change, not just what is wrong.** Every finding has
a stable code, the exact subject and a fix with the measured value in it —
`set labelDy: -22 on arrows[3]`, `offset both anchors by 18px` — so an agent
repairs a diagram in one round instead of guessing.

**`diff` draws what a proposal changes.** Keep an as-is spec and a to-be spec;
`diff` matches items by identity and renders one diagram with additions dashed
orange, changes outlined, moves dotted teal and removals as struck-through
ghosts, plus a change report for the PR. No more hand-drawn "proposed" boxes.

**Delivery is atomic and receipted.** An artefact is either the previous good
one or the new verified one — never half a file. `deliver` writes a
`receipt.json` binding the spec's SHA-256 to each output's, which is the answer
to "which JSON made this PNG" in a docs repo.

## Commands

```bash
node bin/aws-archify.mjs init      my-diagram.json     # starter spec
node bin/aws-archify.mjs icons     "load balancer"     # search the icon set
node bin/aws-archify.mjs validate  my-diagram.json     # contract + geometry, with fixes
node bin/aws-archify.mjs build     my-diagram.json     # static HTML
node bin/aws-archify.mjs live      my-diagram.json     # interactive HTML
node bin/aws-archify.mjs render    my-diagram.json     # PNG
node bin/aws-archify.mjs gif       my-diagram.json out/         # looping GIF
node bin/aws-archify.mjs card      my-diagram.json out/         # 1200x630 share card
node bin/aws-archify.mjs deliver   my-diagram.json out/   # PNG + live + receipt
node bin/aws-archify.mjs diff      as-is.json to-be.json out/   # what changed
node bin/aws-archify.mjs doctor                        # can this machine render?
```

Flags: `--scale=2` (4K PNG) · `--dark` (live viewer opens dark) · `--force`
(render despite a failed check, banner and all) · `--no-receipt` · `--json` ·
for `gif`: `--width=N` (default 1280), `--fps=N` (default 20), `--card`.

GIF timing can also live in the spec: `"loop": { "travel": 1100, "hold": 1200,
"overlap": 250, "fps": 20, "size": 1.5 }` — all optional.

## Requirements

Node 22+ and Chrome or Edge. Nothing to install — no puppeteer, no ffmpeg, no
npm dependencies. Point `AWS_ARCHIFY_CHROME` at the executable if it lives
somewhere unusual. `doctor` checks all of it.

## Viewer keys

`Space` replay · click a node to focus · `R` then a second node to trace a route
· `T` theme · `L` copy link · `P` print/PDF · `Esc` clear · `?` help

A copied link carries the view: `#focus=ecs`, `#route=users,db`, `#theme=dark`.
Paste it in a chat and the reader opens on exactly that node or path.

## Credits

### archify

[**tt-a1i/archify**](https://github.com/tt-a1i/archify) (MIT) is where the idea
for the moving layer came from, and it deserves the credit for two things this
project simply took.

The first is the **look of a signal travelling a wire** — a staggered
`stroke-dashoffset` reveal, one edge after another. Our `aa-edge-flow` keyframe
is a reimplementation of that treatment.

The second matters more, and is the better idea: **motion must be finite, and
every export must preserve complete static meaning.** archify states it as a
design constraint, and it is what separates a diagram that explains something
from a diagram that fidgets. We enforce it in a test:

```js
ok(/animation: aa-edge-flow[^;]*\s1;/.test(html),
   'the trace must run exactly once, never loop');
```

No archify source is vendored — its renderers, viewer runtime, schemas and
validators are not in this repository. If you want automatic layout, five
diagram types, and a much richer viewer, go use archify; it is the more
ambitious tool. This one trades all of that for one thing archify does not do:
staying inside the AWS Reference Architecture format, icons and all.

### AWS Architecture Icons

862 icons © Amazon Web Services, Inc., redistributed unmodified. AWS provides
them for building architecture diagrams, which is exactly what this tool does.
Details in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### The format itself

The layout rules, boundary colours and orthogonal routing convention were
derived by measuring AWS's own published reference architecture PDFs. The
credit for the format is AWS's; this repository just made it executable.

## Licence

MIT — see [LICENSE](LICENSE). The bundled AWS icons are not covered by it.
