# aws-archify

AWS Reference Architecture diagrams from a JSON spec — a print-ready PNG **and**
an interactive viewer with a signal-flow trace, from one source that cannot
drift.

```bash
npx skills add <owner>/aws-archify -g
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

```bash
node bin/aws-archify.mjs deliver my-diagram.json out/
```

| Output | For |
|---|---|
| `my-diagram.png` | 1920×1080 (or 4K with `--scale=2`). Docs, slides, PDFs. |
| `my-diagram.live.html` | ~110 KB, self-contained, no server. Trace animation, click-to-focus, route tracing, dark theme, print-to-PDF. |

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

**Motion is finite and honest.** One pass, no loop. It respects
`prefers-reduced-motion`, and print strips every trace of the viewer.

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
node bin/aws-archify.mjs deliver   my-diagram.json out/   # PNG + live + receipt
node bin/aws-archify.mjs diff      as-is.json to-be.json out/   # what changed
node bin/aws-archify.mjs doctor                        # can this machine render?
```

Flags: `--scale=2` (4K PNG) · `--dark` (live viewer opens dark) · `--force`
(render despite a failed check, banner and all) · `--no-receipt` · `--json`.

## Requirements

Node 18+ and Chrome or Edge. Nothing to install — no puppeteer, no npm
dependencies. Point `AWS_ARCHIFY_CHROME` at the executable if it lives somewhere
unusual.

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
