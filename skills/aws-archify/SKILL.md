---
name: aws-archify
description: Create or edit AWS Reference Architecture diagrams from a JSON spec. Produces a print-ready 1920x1080 PNG for docs and slides plus an interactive HTML viewer with a signal-flow trace animation, node focus, route tracing and a dark theme. Use whenever asked to draw, update, review or explain an AWS architecture diagram, a VPC/network topology, or a service data flow.
---

# aws-archify

One JSON spec, two deliverables that can never disagree:

| | |
|---|---|
| `<name>.png` | 1920×1080, the AWS Reference Architecture format. Goes in docs, slides, PDFs. |
| `<name>.live.html` | The same diagram, self-contained, with a finite trace animation, click-to-focus, route tracing, dark theme and print-to-PDF. Share the file; it needs no server. |

Both come from the same layout engine and the same arrow router, so the moving
version is the printed version with a clock on it.

## The one rule that matters

**Never hand-write the HTML or the SVG.** Write JSON, run the CLI. The router
draws every arrow orthogonally from real icon edges and the validator refuses to
ship a diagram whose lines cross text, whose numbers collide, or whose parallel
runs are too close to read. Hand-drawn SVG bypasses all of that.

## Workflow

```bash
CLI=<skill dir>/bin/aws-archify.mjs

node $CLI init my-diagram.json          # starter spec
node $CLI icons "secrets manager"       # find an icon name
node $CLI validate my-diagram.json      # contract + geometry, writes nothing

node $CLI render   my-diagram.json out/ # PNG only        -> docs, slides, print
node $CLI live     my-diagram.json out/ # interactive only -> share, explain
node $CLI deliver  my-diagram.json out/ # both
```

`validate` and `deliver` exit non-zero when the geometry fails, and print every
problem with the node ids involved. Fix and re-run — do not pass `--force`
unless the user explicitly asks for a broken render to look at.

### 1. Decide which output to produce

Three commands, one spec. Pick from what the diagram is for — the request
usually says, so read it before asking:

| The user says something like | Command | Produces |
|---|---|---|
| "put it in the doc", "for the slide deck", "attach to the ticket", "print it" | `render` | PNG only |
| "walk the team through it", "send them something they can click", "explain the flow", "show me how traffic moves" | `live` | interactive HTML only |
| a plain "draw me a diagram of X", or nothing that hints either way | `deliver` | both |

Two cases where you should stop and ask instead of guessing:

- **A batch.** Before generating several diagrams at once, ask once which output
  they want and apply it to all of them. Producing 13 unwanted HTML files is
  worse than one question.
- **A repository that commits its outputs.** If the diagrams land in a docs repo
  or anywhere under version control, ask before adding a second artefact per
  diagram. Someone has to review and carry those files.

Never ask twice in one session: the answer holds until the user changes it.

When you do produce both, say which file is which in one line — the PNG for the
document, the HTML to share — so the user is not left guessing why there are two.

### 2. Get the facts before drawing

Every value — account id, resource name, CIDR, threshold, region — comes from
the source the user points at (design docs, IaC, console output). **Do not
invent one, and do not quietly round one off.**

If sources disagree, say so in your report and ask the owner to check against
the real config. Never pick a side silently: a diagram is read as authoritative
long after the conversation is forgotten.

### 3. Write the spec

Three examples ship with the skill:

| | |
|---|---|
| `examples/starter.json` | Smallest thing that works. Start here. |
| `examples/web-app.json` | A request path through CloudFront, WAF, an ALB in a public subnet and ECS in a private one. The shape most diagrams end up being. |
| `examples/analytics-pipeline.json` | Denser: `compact` density, a `proposed` boundary with a legend, side note boxes, and a route that turns a corner. Copy this one for anything non-trivial. |

Layout is explicit pixels, because the AWS format is a designed page, not a
graph dump. Work outside-in: place boundaries, then nodes on a grid, then
declare arrows, then number the steps.

### 4. Validate, then look at it

`validate` catches geometry. It cannot catch "wrong icon", "steps out of order"
or "this doesn't explain anything". So after it passes, **open the PNG and zoom
2× through each quadrant** — top-left, top-right, bottom-left, bottom-right,
then the callout panel. Full-page glances miss things that a zoomed pass finds
immediately.

Check per zone: text complete and not clipped · the icon is the right service ·
flow reads left→right or top→bottom · step numbers follow the real sequence.

## Spec reference

```jsonc
{
  "title": "Service — Overview (Production)",   // required
  "subtitle": null,
  "reviewed": "September 2026",                  // footer date
  "density": "comfortable",                      // or "compact" for a dense page
  "panel":  { "head": "Proposed changes" },      // optional heading above the steps
  "notes":  "Environment: account 1234…",        // italic note under the steps
  "motion": { "animation": "trace", "duration": 2400, "stagger": 160 },

  "groups": [ { "kind": "vpc", "label": "VPC — 10.0.0.0/16",
                "at": [340, 260], "size": [600, 560],
                "sub": false, "icon": false } ],

  "nodes":  [ { "id": "s3", "icon": "Amazon S3", "label": "Amazon S3",
                "note": "data events", "mono": "bucket-name",
                "at": [430, 430], "width": 230, "size": 88,
                "small": false, "labelTop": false } ],

  "arrows": [ { "from": "user:right", "to": "s3:left:26",
                "label": "HTTPS", "step": 1,
                "dashed": false, "both": false, "color": "muted", "mid": 468 } ],

  "steps":  [ { "n": 1, "at": [330, 396], "tone": "new",
                "text": "**Amazon S3** receives the upload over HTTPS." } ],

  "boxes":  [ { "at": [1180, 232], "width": 240,
                "head": "Accounts covered", "text": "platform-prod, data-prod" } ],

  "legend": [ { "text": "Proposed addition", "color": "#ED7100", "dashed": true } ]
}
```

**Text** supports `**bold**` (use it for service names), `` `mono` `` for
identifiers, and `\n` for a line break. Spell a service in full on first mention
— "Amazon Elastic Container Service (Amazon ECS)" — as AWS docs do.

**Anchors** are `"<node id>:<side>[:<offset>]"`, side ∈ `left|right|top|bottom`.
The offset shifts the attachment point along that edge, which is how two arrows
leave the same side without overlapping: `lam:right:-14` and `lam:right:18`.

**`mid`** pins the shared middle coordinate of a Z-shaped route when the
automatic midpoint would collide with something.

**`step`** ties an arrow to a callout number. It orders the trace animation, so
the signal travels in the sequence the reader is being told about.

### Group kinds

`cloud` `account` `region` `vpc` `az` `private` `public` `onprem` `asg` `plain`
carry the official AWS colours and corner icons — do not override them.
`proposed` (orange dashed, tinted) marks an addition to an as-is design; pair it
with a `legend` entry. `"icon": false` drops the corner icon for a boundary that
is not an AWS construct (a SaaS vendor, another cloud). `"sub": true` shrinks the
label and icon for a boundary nested three deep.

### Icons

862 official AWS icons are bundled. Look one up rather than guessing:

```bash
node $CLI icons "load balancer"
```

Names resolve case- and punctuation-insensitively, common shorthands work
(`s3`, `ec2`, `alb`, `nat gateway`), and `type:name` pins the set
(`resource:Users / 48 / Light`). An ambiguous name is a build error, not a
coin flip — the message lists the candidates.

Use `_Light` variants on the white canvas. People and non-AWS systems use the
General Icons (`users`, `client`, `servers`, `internet`) — never another
company's logo.

### Density

`comfortable` (default) matches the AWS reference PDFs. Switch to `compact` when
the page has three nested boundaries and a dozen-plus nodes; it is the type
scale a dense diagram needs, and it keeps you inside the standard instead of
hand-tuning CSS.

## What the validator checks

1. No arrow crosses a label, step number, icon or note box.
2. No step number or arrow label overlaps other text.
3. Parallel runs of different arrows stay ≥ 24px apart.
4. Nothing leaves the canvas or reaches into the callout panel.
5. Step numbers on the canvas match the callout panel.

A failure means the layout is wrong, not that the check is too strict. If an
arrow needs more than two bends or has to detour a long way, move the node —
that is the layout telling you the flow does not run left→right yet.

## Delivering

- Commit the `.json` as the source. The PNG and live HTML are build outputs.
- Report which values came from which source, and any conflict you found.
- Say what the geometry verdict was.
