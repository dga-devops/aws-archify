/*
 * icons.mjs — resolve a human icon name to a file in the bundled AWS icon set,
 * and inline it as a data URI.
 *
 * The old pipeline referenced icons by relative path and checked at render time
 * that every <img src> existed ("ICON CHECK") — a missing icon used to ship as a
 * blank box. Here icons are resolved and inlined at BUILD time, so a bad name is
 * a hard error before any HTML exists and the output is a single portable file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ICON_ROOT = resolve(HERE, '..', 'aws-icons');

let INDEX = null;

function loadIndex() {
  if (INDEX) return INDEX;
  const raw = JSON.parse(readFileSync(join(ICON_ROOT, 'index.json'), 'utf8'));
  INDEX = raw.icons.map((i) => ({ ...i, key: norm(i.name) }));
  return INDEX;
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/*
 * Shorthands engineers actually type. Without these, a prefix match sends
 * "Amazon S3" to "Amazon S3 on Outposts" and "Amazon EC2" to an EC2 sub-resource,
 * which is the kind of wrong-but-plausible icon nobody catches in review.
 */
const ALIASES = {
  s3: 'Amazon Simple Storage Service',
  'amazon s3': 'Amazon Simple Storage Service',
  ec2: 'Amazon EC2',
  'amazon ec2': 'Amazon EC2',
  rds: 'Amazon RDS',
  ecs: 'Amazon Elastic Container Service',
  eks: 'Amazon Elastic Kubernetes Service',
  ecr: 'Amazon Elastic Container Registry',
  efs: 'Amazon EFS',
  vpc: 'Amazon Virtual Private Cloud',
  iam: 'AWS Identity and Access Management',
  sqs: 'Amazon Simple Queue Service',
  sns: 'Amazon Simple Notification Service',
  ses: 'Amazon Simple Email Service',
  waf: 'AWS WAF',
  acm: 'AWS Certificate Manager',
  kms: 'AWS Key Management Service',
  alb: 'resource:Elastic Load Balancing / Application Load Balancer',
  nlb: 'resource:Elastic Load Balancing / Network Load Balancer',
  elb: 'Elastic Load Balancing',
  'nat gateway': 'resource:Amazon VPC / NAT Gateway',
  'internet gateway': 'resource:Amazon VPC / Internet Gateway',
  lambda: 'AWS Lambda',
  cloudfront: 'Amazon CloudFront',
  cloudwatch: 'Amazon CloudWatch',
  cloudtrail: 'AWS CloudTrail',
  route53: 'Amazon Route 53',
  'route 53': 'Amazon Route 53',
  dynamodb: 'Amazon DynamoDB',
  aurora: 'Amazon Aurora',
  glue: 'AWS Glue',
  athena: 'Amazon Athena',
  bedrock: 'Amazon Bedrock',
  'api gateway': 'Amazon API Gateway',
  'step functions': 'AWS Step Functions',
  'secrets manager': 'AWS Secrets Manager',
  'systems manager': 'AWS Systems Manager',
  guardduty: 'Amazon GuardDuty',
  opensearch: 'Amazon OpenSearch Service',
  users: 'resource:Users / 48 / Light',
  user: 'resource:User / 48 / Light',
  internet: 'resource:Internet / 48 / Light',
  client: 'resource:Client / 48 / Light',
  servers: 'resource:Servers / 48 / Light',
  server: 'resource:Server / 48 / Light',
};

/** Rank a candidate against the query. Lower is better; null = no match. */
function score(entry, q, wantType) {
  if (wantType && entry.type !== wantType) return null;
  if (entry.key === q) return 0;
  if (entry.key.startsWith(q + ' ')) return 1;
  if (entry.key.endsWith(' ' + q)) return 2;
  if (entry.key.includes(' ' + q + ' ')) return 3;
  if (entry.key.includes(q)) return 4;
  return null;
}

/** Type preference when the caller does not pin one: a service icon beats a
 *  resource icon beats a category icon, matching how the standard uses them. */
const TYPE_RANK = { service: 0, resource: 1, group: 2, category: 3 };

/** The standard mandates the _Light variant on the white RefArch canvas. */
function variantRank(entry) {
  if (/\/\s*light$/i.test(entry.name) || /_Light\.svg$/.test(entry.path)) return 0;
  if (/\/\s*dark$/i.test(entry.name) || /_Dark\.svg$/.test(entry.path)) return 2;
  return 1;
}

/** Two entries that differ only by the Light/Dark suffix are the same icon. */
function baseName(entry) {
  return norm(entry.name).replace(/\s+(light|dark)$/, '');
}

/**
 * Resolve `spec` to an index entry.
 *  - "service/Storage/Arch_Amazon-S3_64.svg"  -> explicit path (no lookup)
 *  - "resource:Users"                          -> name lookup pinned to a type
 *  - "Amazon Simple Storage Service"           -> name lookup, best type wins
 */
export function resolveIcon(spec) {
  if (typeof spec !== 'string' || !spec.trim()) {
    throw new Error(`icon must be a non-empty string, got ${JSON.stringify(spec)}`);
  }
  const s = spec.trim();

  if (s.endsWith('.svg')) {
    const rel = s.replace(/^aws-icons\//, '');
    const full = join(ICON_ROOT, rel);
    try {
      readFileSync(full);
    } catch {
      throw new Error(`icon file not found: aws-icons/${rel}`);
    }
    return { name: rel.split('/').pop().replace(/\.svg$/, ''), path: `aws-icons/${rel}`, full };
  }

  let wantType = null;
  let query = s;

  // resolve shorthands first, so an alias beats any fuzzy prefix hit
  const alias = ALIASES[norm(s)];
  if (alias) query = alias;

  const m = /^(service|resource|group|category)\s*:\s*(.+)$/i.exec(query);
  if (m) {
    wantType = m[1].toLowerCase();
    query = m[2];
  }

  const q = norm(query);
  const hits = [];
  for (const e of loadIndex()) {
    const sc = score(e, q, wantType);
    if (sc !== null) hits.push({ e, sc });
  }
  if (!hits.length) {
    throw new Error(
      `no AWS icon matches ${JSON.stringify(spec)}. ` +
        `Search with:  aws-archify icons "${query}"`
    );
  }
  hits.sort(
    (a, b) =>
      a.sc - b.sc ||
      TYPE_RANK[a.e.type] - TYPE_RANK[b.e.type] ||
      variantRank(a.e) - variantRank(b.e) ||
      a.e.name.length - b.e.name.length
  );

  // A tie between genuinely different icons is a wrong-icon bug waiting to ship,
  // so refuse it and name the candidates. Light/Dark pairs of one icon are not a
  // tie (variantRank already picked Light), and an exact name match is decisive.
  const best = hits[0];
  if (best.sc > 0) {
    const rival = hits.find((h) => h.sc === best.sc && baseName(h.e) !== baseName(best.e));
    if (rival) {
      const names = [...new Set(hits.filter((h) => h.sc === best.sc).map((h) => h.e.name))];
      throw new Error(
        `icon ${JSON.stringify(spec)} is ambiguous — matches ${names.slice(0, 5).join(', ')}` +
          (names.length > 5 ? `, … (${names.length} total)` : '') +
          `. Use the full name, an explicit "type:name", or a path.`
      );
    }
  }

  return { ...best.e, full: join(ICON_ROOT, best.e.path.replace(/^aws-icons\//, '')) };
}

const inlineCache = new Map();

/** The icon's SVG source as a data URI, ready for an <img src>. */
export function inlineIcon(spec) {
  const hit = resolveIcon(spec);
  if (inlineCache.has(hit.full)) return { ...hit, dataUri: inlineCache.get(hit.full) };
  let svg = readFileSync(hit.full, 'utf8');
  // strip XML prolog / comments: they cost bytes in every diagram and add nothing
  svg = svg.replace(/<\?xml[^>]*\?>\s*/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  inlineCache.set(hit.full, uri);
  return { ...hit, dataUri: uri };
}

/** Free-text search, for the `icons` CLI command. */
export function searchIcons(query, limit = 25) {
  const q = norm(query);
  const out = [];
  for (const e of loadIndex()) {
    const sc = score(e, q, null);
    if (sc !== null) out.push({ ...e, sc });
  }
  out.sort((a, b) => a.sc - b.sc || TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.name.length - b.name.length);
  return out.slice(0, limit);
}
