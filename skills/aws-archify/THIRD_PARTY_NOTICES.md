# Third-party notices

## AWS Architecture Icons

`skills/aws-archify/aws-icons/` contains 862 SVG files from the AWS
Architecture Icons set, © Amazon Web Services, Inc. or its affiliates.

Source: <https://aws.amazon.com/architecture/icons/>, where AWS states that it
allows customers and partners to use these toolkits and assets to create
architecture diagrams — which is the only thing this tool does with them.

How this repository uses them:

- **Unmodified.** The build inlines each SVG as a data URI, stripping only the
  XML prolog and comments. No recolouring, redrawing or restyling. In dark
  theme an icon is placed on a light plate; the artwork itself is untouched.
- **Not for resale.** This is an MIT-licensed diagram tool. The icons are not
  sold, and are not offered as a standalone icon set.
- **No implied endorsement.** Nothing here is an AWS product, and nothing here
  claims AWS review or approval.

AWS refreshes the set periodically. Re-download from the link above rather than
editing anything under `aws-icons/`; the file names are the resolver's index.

Icon set release bundled here: **2026-04-30** (see `aws-icons/index.json`).

## archify

The finite edge-flow treatment in `lib/runtime/live.css` — a one-pass
`stroke-dashoffset` reveal staggered per step, settling into the static diagram
— was adapted from [archify](https://github.com/tt-a1i/archify) by tt-a1i, MIT
licensed.

No archify source is vendored: its renderers, viewer runtime, schemas and
validators are not present in this repository. The debt is to the idea, and to
the design constraint behind it — that motion must be finite and every export
must preserve complete static meaning.

```
MIT License

Copyright (c) 2025 tt-a1i

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
