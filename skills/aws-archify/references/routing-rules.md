# Arrow routing

## Orthogonal only — no exceptions

Across the published AWS reference architecture PDFs there is **not one diagonal
and not one curve**. Every line is horizontal or vertical and every turn is 90°.
Treat it as a hard rule of the format.

Why it is worth keeping:

- The eye follows horizontal and vertical runs faster than diagonals, which
  matters most on a page with four nested boundaries.
- Parallel lines can be spaced evenly; a bundle of diagonals cannot.
- Right angles say exactly where a flow crosses a boundary, and which one.
- It looks like the real thing, consistently, across a whole document set.

The router enforces this for you. It cannot emit a diagonal — that is the point
of declaring arrows instead of drawing them.

## How anchoring works

```jsonc
{ "from": "lam:right:-14", "to": "ep1:left:-14", "label": "mongodb+srv" }
```

`<node id>:<side>[:<offset>]`

- The attachment point is the midpoint of that side **of the node's icon**, not
  of its label box. Arrows therefore touch the icon, never float off the text.
- `offset` slides the point along that edge. Two arrows leaving the same side
  use opposite offsets — `right:-14` and `right:18` — so they run parallel
  instead of on top of each other.
- A 4px gap is left between the arrowhead and the icon.

## Route shapes

The router picks the shape from the two sides you chose:

| From → to | Result |
|---|---|
| `right` → `left`, aligned | straight horizontal |
| `bottom` → `top`, aligned | straight vertical |
| `right` → `left`, offset rows | **Z**: out, across, in |
| `bottom` → `top`, offset columns | **Z**: down, across, down |
| `right` → `top` (mixed axes) | **L**: one bend |

Anchors within 10px of aligned are snapped to a straight line. Without that,
two nodes drawn with different icon sizes (say 84px and 88px) have centres 2px
apart and produce a visible staircase.

`"mid": 468` pins the shared middle coordinate of a Z — the x of the vertical
leg for a horizontal route, the y of the horizontal leg for a vertical one. Use
it when the automatic midpoint lands on something.

## Rules the validator enforces

| # | Rule |
|---|---|
| 1 | No segment crosses a node label, step number, arrow label, icon or note box. |
| 2 | Step numbers and arrow labels do not overlap other text. |
| 3 | Parallel runs belonging to different arrows stay ≥ 24px apart. |
| 4 | Nothing leaves the canvas or reaches into the callout panel. |
| 5 | Step numbers on the canvas match the callout panel exactly. |

## When it fails, move a node

A route needing more than two bends, or a long detour around obstacles, is the
layout telling you something: the flow does not yet run left→right or top→bottom.

Re-place the nodes so it does, and the arrows get short and straight on their
own. Adding bends to route around a bad layout produces a diagram that is
technically valid and still hard to read.

Two-way traffic is **one** arrow with `"both": true`, not two arrows.
Secondary or asynchronous relationships use `"dashed": true` with
`"color": "muted"`, so the primary flow stays the loudest thing on the page.
