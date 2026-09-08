# The AWS Reference Architecture format

Derived by measuring the published AWS reference architecture PDFs
(hybrid DNS / Route 53 resolver endpoints, SD-WAN deployment models, Direct
Connect traffic encryption options, OpenSearch trending queries with Glue and
Bedrock). Every page in that set has the same anatomy.

```
+----------------------------------------------------+------------------+
|  Title (bold, large, top-left)                      |                  |
|  ---------------------------- (rule under title)    |  Callout column  |
|                                                     |  (grey #F2F3F3)  |
|   +- Region --------------------------+             |                  |
|   |  +- VPC -----------------+        |             |  (1) text...     |
|   |  |  +- AZ ---------+     |        |             |  (2) text...     |
|   |  |  | +- Subnet -+ |     |        |             |  (3) text...     |
|   |  |  | |  [icon]  | |     |        |             |                  |
|   |  |  | +----------+ |     |        |             |                  |
|   |  |  +--------------+     |        |             |                  |
|   |  +-----------------------+        |             |                  |
|   +-----------------------------------+             |                  |
|                                                     |                  |
|  Reviewed for...      AWS Reference Architecture    |                  |
+----------------------------------------------------+------------------+
```

## Required elements

| Element | Rule |
|---|---|
| Canvas | 16:9. The source PDFs are 960×540 pt; we draw 1920×1080 px — same proportion, twice the detail. |
| Title | Top-left, bold ~42px, `#232F3E`, with a horizontal rule beneath it. |
| Callout column | Right edge, 480px wide, background `#F2F3F3`. |
| Step numbers | Black `#232F3E` circle, white numeral. Placed both on the diagram at the point the event happens **and** beside its sentence in the column. The two sets must match. |
| Boundaries | Nested outside-in: AWS Cloud → Account → Region → VPC → Availability Zone → Subnet, each with its own colour and its corner icon. |
| Service icons | Official AWS SVGs, name labelled **below** the icon, always. |
| Arrows | Solid, 2–2.5px, `#232F3E`, with an arrowhead. Labels optional (protocol, CIDR, port). |
| Footer | Left: *Reviewed for technical accuracy &lt;Month Year&gt;* in italics. Centre: **AWS Reference Architecture** in AWS orange `#ED7100`. |

## Boundary colours

Taken from the official group icons themselves — match them exactly.

| Group | Border | Line | Corner icon |
|---|---|---|---|
| AWS Cloud | `#242F3E` | solid | `AWS-Cloud_32.svg` |
| AWS Account | `#E7157B` | solid | `AWS-Account_32.svg` |
| Region | `#00A4A6` | **dashed** | `Region_32.svg` |
| VPC | `#8C4FFF` | solid | `Virtual-private-cloud-VPC_32.svg` |
| Availability Zone | `#00A4A6` | **dashed** | none — italic label only |
| Private subnet | `#00A4A6` | solid | `Private-subnet_32.svg` |
| Public subnet | `#7AA116` | solid | `Public-subnet_32.svg` |
| Corporate data center | `#7D8998` | solid | `Corporate-data-center_32.svg` |
| Auto Scaling group | `#ED7100` | dashed | `Auto-Scaling-group_32.svg` |

Other standard colours: text and arrows `#232F3E` · callout background `#F2F3F3`
· AWS orange `#ED7100` · muted / secondary `#7D8998` · validation red `#B2152A`.

`proposed` is **not** an AWS group kind. It is a local convention — orange
dashed with a 6% orange tint — for showing what a proposal adds to an existing
design. Always pair it with a legend entry so the reader knows the orange means
"not built yet".

## The icon set

862 SVGs, four families:

| Family | Base size | Use |
|---|---|---|
| `service` (305) | 64px | The service itself: Lambda, EC2, S3 |
| `resource` (516) | 48px | A thing inside a service: Glue Crawler, S3 bucket, NAT gateway, EC2 instance |
| `group` (15) | 32px | Boundary corner icons |
| `category` (26) | 64px | A whole category, when no single service is meant |

General Icons carry `_Light` and `_Dark` variants. **Always `_Light`** on this
white canvas; the resolver prefers it automatically.

People, external systems and third parties use General Icons (`Users`,
`Client`, `Servers`, `Internet`, `Generic Application`). Never another company's
logo — draw MongoDB Atlas or Microsoft Fabric as a labelled boundary containing
generic icons.

## Writing the callout text

- English, in the same register as AWS documentation.
- Bold the service name, spelled in full on first mention:
  **Amazon Elastic Compute Cloud (Amazon EC2)**, then "Amazon EC2" after that.
- One event per step, in the order it actually happens.
- Identifiers (bucket names, connection strings, ARNs) in `mono`.

## Sizing that works

Read off the diagrams that survived review:

| | comfortable | compact |
|---|---|---|
| Icon | 76–88px | 52–64px |
| Node label | 17.5px | 15.5px |
| Node sub-label | 14px | 13px |
| Boundary label | 19px | 19px (16px when nested 3 deep) |
| Callout text | 17px | 15.5px |

Reach for `compact` when the page carries three nested boundaries plus a dozen
or more nodes. Below that, `comfortable` reads better and matches the AWS PDFs.
