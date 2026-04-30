/**
 * Tiny cron expression parser for the Phase 10 runner. Supports:
 *   - Standard 5-field expressions (min hour day-of-month month day-of-week)
 *     with `*`, comma lists, ranges (`a-b`), and steps (`*\/n`).
 *   - Aliases:  `@hourly` `@daily` `@weekly` `@monthly`
 *   - Interval shortcut: `@every 5m`, `@every 2h`, `@every 30s`
 *
 * Computes the next moment >= a reference instant where the expression
 * matches, advancing minute-by-minute (worst case ~525,600 minutes/year).
 *
 * Day-of-week is 0..6 with 0=Sunday (cron-style). Day-of-month and
 * day-of-week interact additively when BOTH are restricted (Vixie cron
 * semantics — match either) — implemented here for parity.
 */

export type ScheduleKind = 'cron' | 'interval';

export interface ParsedSchedule {
  kind: ScheduleKind;
  raw: string;
  // For interval schedules
  intervalMs?: number;
  // For cron schedules
  minute?: Set<number>;
  hour?: Set<number>;
  dom?: Set<number>;
  month?: Set<number>;
  dow?: Set<number>;
  domWildcard?: boolean;
  dowWildcard?: boolean;
}

const MINUTE_RANGE: [number, number] = [0, 59];
const HOUR_RANGE:   [number, number] = [0, 23];
const DOM_RANGE:    [number, number] = [1, 31];
const MONTH_RANGE:  [number, number] = [1, 12];
const DOW_RANGE:    [number, number] = [0, 6];

function expandField(token: string, [lo, hi]: [number, number]): { values: Set<number>; wildcard: boolean } {
  const values = new Set<number>();
  let wildcard = false;
  for (const part of token.split(',')) {
    let step = 1;
    let body = part;
    const stepIdx = body.indexOf('/');
    if (stepIdx >= 0) {
      step = parseInt(body.slice(stepIdx + 1), 10);
      body = body.slice(0, stepIdx);
      if (!Number.isFinite(step) || step <= 0) throw new Error(`Invalid step in "${token}"`);
    }
    let start = lo;
    let end = hi;
    if (body === '*') {
      // wildcard
      wildcard = wildcard || step === 1;
    } else if (body.includes('-')) {
      const [a, b] = body.split('-').map(s => parseInt(s, 10));
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`Invalid range in "${token}"`);
      start = a; end = b;
    } else {
      const v = parseInt(body, 10);
      if (!Number.isFinite(v)) throw new Error(`Invalid number in "${token}"`);
      start = v; end = v;
    }
    if (start < lo || end > hi || start > end) {
      throw new Error(`Range out of bounds in "${token}" (allowed ${lo}-${hi})`);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return { values, wildcard };
}

export function parseSchedule(raw: string): ParsedSchedule {
  const expr = raw.trim();
  if (!expr) throw new Error('Empty schedule');

  // Aliases
  const alias: Record<string, string> = {
    '@hourly':  '0 * * * *',
    '@daily':   '0 0 * * *',
    '@midnight':'0 0 * * *',
    '@weekly':  '0 0 * * 0',
    '@monthly': '0 0 1 * *',
  };

  // @every Nm | Nh | Ns
  if (expr.startsWith('@every')) {
    const m = expr.match(/^@every\s+(\d+)\s*(s|m|h)$/i);
    if (!m) throw new Error('Use "@every Nm" / "@every Nh" / "@every Ns"');
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const ms = n * (unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000);
    if (ms < 1000) throw new Error('Interval must be at least 1s');
    return { kind: 'interval', raw: expr, intervalMs: ms };
  }

  const cron = (alias[expr.toLowerCase()] ?? expr).split(/\s+/);
  if (cron.length !== 5) {
    throw new Error('Cron expression must have 5 fields: m h dom mon dow');
  }
  const min = expandField(cron[0], MINUTE_RANGE);
  const hr  = expandField(cron[1], HOUR_RANGE);
  const dom = expandField(cron[2], DOM_RANGE);
  const mon = expandField(cron[3], MONTH_RANGE);
  const dow = expandField(cron[4], DOW_RANGE);

  return {
    kind: 'cron',
    raw: expr,
    minute: min.values,
    hour: hr.values,
    dom: dom.values,
    month: mon.values,
    dow: dow.values,
    domWildcard: dom.wildcard,
    dowWildcard: dow.wildcard,
  };
}

/** Compute the next instant the schedule fires, strictly after `from`. */
export function nextRunAfter(parsed: ParsedSchedule, from: Date = new Date()): Date {
  if (parsed.kind === 'interval') {
    return new Date(from.getTime() + (parsed.intervalMs ?? 60_000));
  }
  // Cron: advance minute-by-minute. Cap at 4 years to avoid runaway.
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1); // strictly after
  const cap = 366 * 4 * 24 * 60;
  for (let i = 0; i < cap; i++) {
    if (matchesCron(parsed, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  throw new Error('No matching cron firing within 4 years; expression too restrictive');
}

function matchesCron(p: ParsedSchedule, d: Date): boolean {
  if (!p.minute || !p.hour || !p.dom || !p.month || !p.dow) return false;
  if (!p.minute.has(d.getMinutes())) return false;
  if (!p.hour.has(d.getHours())) return false;
  if (!p.month.has(d.getMonth() + 1)) return false;
  // Vixie semantics: when neither dom nor dow is wildcard, match either.
  const domMatch = p.dom.has(d.getDate());
  const dowMatch = p.dow.has(d.getDay());
  if (p.domWildcard && p.dowWildcard) return domMatch && dowMatch;
  if (p.domWildcard) return dowMatch;
  if (p.dowWildcard) return domMatch;
  return domMatch || dowMatch;
}

/** Build a human-friendly description for the UI. Best-effort; falls back to the raw expression. */
export function describeSchedule(raw: string): string {
  try {
    const t = raw.trim();
    if (t.startsWith('@every')) {
      const m = t.match(/^@every\s+(\d+)\s*(s|m|h)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        return `Every ${n} ${unit === 's' ? (n === 1 ? 'second' : 'seconds') : unit === 'm' ? (n === 1 ? 'minute' : 'minutes') : (n === 1 ? 'hour' : 'hours')}`;
      }
    }
    const aliasNames: Record<string, string> = {
      '@hourly': 'Every hour',
      '@daily': 'Every day at midnight',
      '@midnight': 'Every day at midnight',
      '@weekly': 'Every Sunday at midnight',
      '@monthly': 'On the 1st of every month at midnight',
    };
    if (aliasNames[t.toLowerCase()]) return aliasNames[t.toLowerCase()];
    // Standard cron — keep raw for now
    return raw;
  } catch {
    return raw;
  }
}
