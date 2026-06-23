interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Helsinki Events MCP.
 *
 * Events across Helsinki, Finland from the City of Helsinki "Linked Events" API
 * (api.hel.fi/linkedevents). Keyless, ~10k upcoming events, multilingual
 * (English / Finnish / Swedish — we prefer English). Filter by keyword, free
 * admission and date window; includes venue, coordinates, and tags.
 */


const BASE = 'https://api.hel.fi/linkedevents/v1/event/';
const UA = 'pipeworx-mcp-helsinki-events/1.0 (+https://pipeworx.io)';
const MAX_LIMIT = 50;

const tools: McpToolExport['tools'] = [
  {
    name: 'events',
    description:
      'Find upcoming events in Helsinki, Finland (City of Helsinki Linked Events). Filter by keyword, free admission, and date window. Returns events with venue, coordinates and tags. Text is shown in English where available (else Finnish).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text keyword, e.g. "music", "exhibition", "kids".' },
        free_only: { type: 'boolean', description: 'If true, only free events.' },
        from: { type: 'string', description: 'Earliest event date YYYY-MM-DD (default: today).' },
        to: { type: 'string', description: 'Latest event date YYYY-MM-DD.' },
        limit: { type: 'number', description: `Max events (1-${MAX_LIMIT}, default 20).` },
        page: { type: 'number', description: 'Page number (default 1).' },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name !== 'events') throw new Error(`Unknown tool: ${name}`);

  const qs = new URLSearchParams();
  qs.set('include', 'location,keywords');
  qs.set('sort', 'start_time');
  qs.set('start', dateArg(args.from) || 'today');
  if (dateArg(args.to)) qs.set('end', dateArg(args.to));
  if (typeof args.query === 'string' && args.query.trim()) qs.set('text', args.query.trim());
  if (args.free_only === true) qs.set('is_free', 'true');
  qs.set('page_size', String(clamp(numArg(args.limit, 20), 1, MAX_LIMIT)));
  qs.set('page', String(Math.max(1, numArg(args.page, 1))));

  const res = await fetch(`${BASE}?${qs.toString()}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Helsinki Linked Events: HTTP ${res.status}`);
  const body = (await res.json()) as { meta?: { count?: number }; data?: LinkedEvent[] };

  return {
    city: 'Helsinki',
    country: 'Finland',
    source: 'api.hel.fi/linkedevents',
    page: Math.max(1, numArg(args.page, 1)),
    total_matching: body.meta?.count ?? 0,
    count: body.data?.length ?? 0,
    events: (body.data ?? []).map(normalize),
  };
}

type LocalStr = Record<string, string> | null | undefined;
interface Offer { is_free?: boolean; price?: LocalStr; description?: LocalStr }
interface LinkedPlace { name?: LocalStr; street_address?: LocalStr; address_locality?: LocalStr; position?: { coordinates?: [number, number] } }
interface LinkedKeyword { name?: LocalStr }
interface LinkedEvent {
  id?: string;
  name?: LocalStr;
  short_description?: LocalStr;
  description?: LocalStr;
  start_time?: string;
  end_time?: string;
  offers?: Offer[];
  location?: LinkedPlace;
  keywords?: LinkedKeyword[];
  info_url?: LocalStr;
}

function normalize(e: LinkedEvent): Record<string, unknown> {
  const offer = (e.offers ?? [])[0];
  const isFree = (e.offers ?? []).some((o) => o.is_free === true);
  const pos = e.location?.position?.coordinates;
  const loc = e.location;
  return {
    id: e.id,
    name: loc1(e.name),
    summary: clean(loc1(e.short_description)) || undefined,
    description: clean(loc1(e.description))?.slice(0, 600) || undefined,
    start: e.start_time || undefined,
    end: e.end_time || undefined,
    is_free: isFree,
    price: isFree ? undefined : loc1(offer?.price) || undefined,
    venue: loc
      ? {
          name: loc1(loc.name),
          address: [loc1(loc.street_address), loc1(loc.address_locality)].filter(Boolean).join(', ') || undefined,
          latitude: Array.isArray(pos) ? pos[1] : undefined,
          longitude: Array.isArray(pos) ? pos[0] : undefined,
        }
      : undefined,
    tags: (e.keywords ?? []).map((k) => loc1(k.name)).filter(Boolean).slice(0, 12),
    url: loc1(e.info_url) || (e.id ? `https://tapahtumat.hel.fi/en/event/${e.id}` : undefined),
  };
}

/** Pick a localized string, preferring English, then Finnish, then Swedish, then any. */
function loc1(s: LocalStr): string {
  if (!s || typeof s !== 'object') return '';
  return s.en || s.fi || s.sv || Object.values(s).find((v) => typeof v === 'string' && v.trim()) || '';
}
function clean(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function dateArg(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function numArg(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
