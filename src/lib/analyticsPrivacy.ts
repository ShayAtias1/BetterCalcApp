/**
 * The privacy contract for product analytics: which events exist, which properties each may carry,
 * what a valid value looks like, and the scrubber every outgoing payload passes through.
 *
 * Deliberately dependency-free (type imports only) so it runs under plain Node for the unit tests,
 * and so nothing here can reach plan content by accident. `analytics.ts` is the only consumer.
 *
 * Two layers of defence, both required:
 * 1. Compile time — `AnalyticsEvents` types every event's properties as ids, booleans, numbers,
 *    buckets and enums. There is no string-typed free-text property anywhere.
 * 2. Run time — `sanitizeEventProps` (at `track`) and `scrubCaptureResult` (PostHog `before_send`)
 *    drop any event or property not listed here, and any value that is not a boolean, a finite
 *    number, a short `[A-Za-z0-9_-]` token or an array of those. Names, file names, notes and
 *    labels (Hebrew, spaces, dots) can never pass that pattern, and keys ending in `_id` must look
 *    like one of the app's generated UUIDs.
 */

import type { CaptureResult } from 'posthog-js';

// ---------- vocabularies ----------

export type DeviceClass = 'desktop' | 'tablet' | 'mobile';
export type InAppBrowser = 'instagram' | 'facebook' | 'none';
export type CountBucket = '0' | '1' | '2_5' | '6_20' | '21_plus';
export type PdfSizeBucket = 'lt_1mb' | '1_5mb' | '5_20mb' | 'gt_20mb' | 'unknown';
export type WorkTypeName = 'tiling' | 'cladding' | 'panels' | 'painting' | 'plaster' | 'waterproofing';
export type RoomTemplateKey = 'bath' | 'wc' | 'service' | 'kitchen' | 'balcony' | 'service_balcony' | 'safe' | 'living' | 'bedroom' | 'hall' | 'storage';
export type ExportKind =
  | 'quantity_excel'
  | 'quantity_pdf'
  | 'plan_page_pdf'
  | 'plan_all_pages_pdf'
  | 'project_excel'
  | 'project_pdf'
  | 'compare_pdf';
export type ExportSurface = 'topbar_menu' | 'quantities_panel' | 'overview' | 'compare';
export type PageScope = 'current' | 'selected' | 'all';
export type ErrorArea = 'save_plan' | 'save_comparison' | 'pdf_load' | 'compare_pdf_load' | 'export';

/** A generated record id (UUID, or the `legacy-…` ids the migrations derive from one). Never a name. */
export type AnalyticsId = string;

// ---------- the events ----------

export interface AnalyticsEvents {
  app_opened: {
    has_local_data: boolean;
    local_project_count_bucket: CountBucket;
    is_returning: boolean;
    days_since_first_seen: number;
    device_class: DeviceClass;
    in_app_browser: InAppBrowser;
  };
  project_created: { project_id: AnalyticsId; with_first_plan: boolean; is_first_project: boolean };
  project_opened: { project_id: AnalyticsId; project_age_days: number; plan_count: number; comparison_count: number };
  plan_created: {
    plan_id: AnalyticsId;
    project_id: AnalyticsId;
    method: 'upload' | 'duplicate';
    pdf_size_bucket: PdfSizeBucket;
    plan_index: number;
  };
  plan_opened: {
    plan_id: AnalyticsId;
    project_id?: AnalyticsId;
    page_count: number;
    plan_age_days: number;
    calibrated_pages: number;
    room_count: number;
  };
  calibration_completed: { plan_id: AnalyticsId; is_recalibration: boolean; calibrated_pages: number; page_count: number };
  room_created: {
    plan_id: AnalyticsId;
    method: 'polygon' | 'rectangle' | 'duplicate' | 'apartment_duplicate';
    count: number;
    template_key: RoomTemplateKey | 'none';
    page_calibrated: boolean;
    room_count: number;
  };
  work_item_added: {
    plan_id: AnalyticsId;
    work_types: WorkTypeName[];
    count: number;
    source: 'manual' | 'new_room_template' | 'room_type' | 'apply_template';
  };
  quantities_ready: {
    plan_id: AnalyticsId;
    project_id?: AnalyticsId;
    rooms_with_qty: number;
    work_types: WorkTypeName[];
    minutes_since_plan_created: number;
  };
  export_completed: {
    export_kind: ExportKind;
    surface: ExportSurface;
    pages_count?: number;
    page_scope?: PageScope;
    revision_scope?: 'active' | 'all';
    revision_count?: number;
    plan_count?: number;
    work_types?: WorkTypeName[];
    waste_applied?: boolean;
    region_cropped?: boolean;
    room_count_bucket?: CountBucket;
    duration_ms: number;
    is_first_export: boolean;
    plan_id?: AnalyticsId;
    project_id?: AnalyticsId;
    comparison_id?: AnalyticsId;
  };
  comparison_created: { comparison_id: AnalyticsId; project_id: AnalyticsId; revision_count: number; is_first_comparison: boolean };
  comparison_opened: { comparison_id: AnalyticsId; project_id?: AnalyticsId; comparison_age_days: number; revision_count: number };
  revision_added: { comparison_id: AnalyticsId; revision_count: number };
  alignment_completed: { comparison_id: AnalyticsId; method: 'points' | 'manual' };
  change_marked: {
    comparison_id: AnalyticsId;
    area_kind: 'demolition' | 'construction';
    calc_mode: 'footprint' | 'wall';
    shape: 'polygon' | 'rectangle';
  };
  error_occurred: { area: ErrorArea; error_name: string; export_kind?: ExportKind };
}

export type AnalyticsEventName = keyof AnalyticsEvents;

/**
 * Every allowed property per event. Typed as a complete map of each event's keys, so adding a
 * property to `AnalyticsEvents` without listing it here (or vice versa) fails the build.
 */
type KeySet<T> = { [K in keyof Required<T>]: true };
const EVENT_PROPS: { [E in AnalyticsEventName]: KeySet<AnalyticsEvents[E]> } = {
  app_opened: {
    has_local_data: true,
    local_project_count_bucket: true,
    is_returning: true,
    days_since_first_seen: true,
    device_class: true,
    in_app_browser: true,
  },
  project_created: { project_id: true, with_first_plan: true, is_first_project: true },
  project_opened: { project_id: true, project_age_days: true, plan_count: true, comparison_count: true },
  plan_created: { plan_id: true, project_id: true, method: true, pdf_size_bucket: true, plan_index: true },
  plan_opened: { plan_id: true, project_id: true, page_count: true, plan_age_days: true, calibrated_pages: true, room_count: true },
  calibration_completed: { plan_id: true, is_recalibration: true, calibrated_pages: true, page_count: true },
  room_created: { plan_id: true, method: true, count: true, template_key: true, page_calibrated: true, room_count: true },
  work_item_added: { plan_id: true, work_types: true, count: true, source: true },
  quantities_ready: { plan_id: true, project_id: true, rooms_with_qty: true, work_types: true, minutes_since_plan_created: true },
  export_completed: {
    export_kind: true,
    surface: true,
    pages_count: true,
    page_scope: true,
    revision_scope: true,
    revision_count: true,
    plan_count: true,
    work_types: true,
    waste_applied: true,
    region_cropped: true,
    room_count_bucket: true,
    duration_ms: true,
    is_first_export: true,
    plan_id: true,
    project_id: true,
    comparison_id: true,
  },
  comparison_created: { comparison_id: true, project_id: true, revision_count: true, is_first_comparison: true },
  comparison_opened: { comparison_id: true, project_id: true, comparison_age_days: true, revision_count: true },
  revision_added: { comparison_id: true, revision_count: true },
  alignment_completed: { comparison_id: true, method: true },
  change_marked: { comparison_id: true, area_kind: true, calc_mode: true, shape: true },
  error_occurred: { area: true, error_name: true, export_kind: true },
};

export const ANALYTICS_EVENT_NAMES = Object.keys(EVENT_PROPS) as AnalyticsEventName[];

// ---------- global (super) properties ----------

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
}

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;
export const FIRST_TOUCH_KEYS = ['first_utm_source', 'first_utm_medium', 'first_utm_campaign', 'first_utm_content'] as const;

/** Registered once per load and attached to every event. */
export interface GlobalProps {
  app_version: string;
  device_class: DeviceClass;
  in_app_browser: InAppBrowser;
  days_since_first_seen: number;
  active_days: number;
  first_utm_source?: string;
  first_utm_medium?: string;
  first_utm_campaign?: string;
  first_utm_content?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
}

const GLOBAL_PROPS: KeySet<GlobalProps> = {
  app_version: true,
  device_class: true,
  in_app_browser: true,
  days_since_first_seen: true,
  active_days: true,
  first_utm_source: true,
  first_utm_medium: true,
  first_utm_campaign: true,
  first_utm_content: true,
  utm_source: true,
  utm_medium: true,
  utm_campaign: true,
  utm_content: true,
};

// ---------- value validation ----------

/** Enums, bucket labels, ids, error class names and app versions — and nothing with spaces, dots or non-ASCII. */
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
/** uuid v4/v7 as generated by the app, optionally behind a migration's `legacy-` / `legacy-cmp-` prefix. */
const ID = /^(legacy-(cmp-)?)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ARRAY = 20;

type SafeValue = boolean | number | string | string[];

function safeValue(key: string, value: unknown): SafeValue | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    if (key.endsWith('_id')) return ID.test(value) ? value : undefined;
    return TOKEN.test(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY || !value.every((v) => typeof v === 'string' && TOKEN.test(v))) return undefined;
    return [...(value as string[])];
  }
  return undefined;
}

function isAllowedKey(event: AnalyticsEventName, key: string): boolean {
  return Object.hasOwn(EVENT_PROPS[event], key) || Object.hasOwn(GLOBAL_PROPS, key);
}

/** Keeps only listed keys with safe values. Used on the way in (`track`) and again in `before_send`. */
export function sanitizeEventProps(event: AnalyticsEventName, props: Record<string, unknown>): Record<string, SafeValue> {
  const out: Record<string, SafeValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!isAllowedKey(event, key)) continue;
    const safe = safeValue(key, value);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

/** Same rules for the registered global properties. */
export function sanitizeGlobalProps(props: Record<string, unknown>): Record<string, SafeValue> {
  const out: Record<string, SafeValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!Object.hasOwn(GLOBAL_PROPS, key)) continue;
    const safe = safeValue(key, value);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

// ---------- the before_send scrubber ----------

/**
 * SDK properties that carry a URL (`$current_url`, `$referrer`, `$session_entry_url`,
 * `$initial_referrer`, …): reduced to origin + path, so queries and fragments never leave.
 */
const isUrlProp = (key: string) => /(_url|referrer)$/.test(key);
/** SDK properties that could carry page text or DOM content; none should appear with autocapture off, but never let them through. */
const DENIED_SDK_PROPS = new Set(['$el_text', '$elements', '$elements_chain', '$title', '$initial_title', '$exception_list', '$exception_message']);
/** The two non-`$` keys the SDK itself adds to every event. */
const SDK_PLAIN_PROPS = new Set(['token', 'distinct_id']);

/** `https://app.example.com/some/path?x=1#y` → `https://app.example.com/some/path`. Unparsable → dropped. */
export function sanitizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  if (value === '$direct') return value;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function scrubSdkProp(key: string, value: unknown): unknown {
  if (DENIED_SDK_PROPS.has(key)) return undefined;
  if (isUrlProp(key)) return sanitizeUrl(value);
  return value;
}

/** Person properties we set: only first-touch attribution, plus the SDK's own `$` metadata (URLs scrubbed). */
function scrubPersonProps(props: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('$')) {
      const v = scrubSdkProp(key, value);
      if (v !== undefined) out[key] = v;
    } else if ((FIRST_TOUCH_KEYS as readonly string[]).includes(key)) {
      const v = safeValue(key, value);
      if (v !== undefined) out[key] = v;
    }
  }
  return out;
}

export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return Object.hasOwn(EVENT_PROPS, name);
}

/**
 * PostHog `before_send`. Drops every event that is not one of ours (pageviews, autocapture,
 * exceptions, heatmaps, flags — all disabled anyway), then rebuilds the property bag from the
 * allowlist. Returning null means the event is not sent.
 */
export function scrubCaptureResult(cr: CaptureResult | null): CaptureResult | null {
  if (!cr || !isAnalyticsEventName(cr.event)) return null;
  const event = cr.event;
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cr.properties ?? {})) {
    if (key.startsWith('$')) {
      if (key === '$set' || key === '$set_once') {
        const v = scrubPersonProps(value as Record<string, unknown>);
        if (v) properties[key] = v;
        continue;
      }
      const v = scrubSdkProp(key, value);
      if (v !== undefined) properties[key] = v;
    } else if (SDK_PLAIN_PROPS.has(key)) {
      properties[key] = value;
    } else if (isAllowedKey(event, key)) {
      const v = safeValue(key, value);
      if (v !== undefined) properties[key] = v;
    }
  }
  const out: CaptureResult = { ...cr, properties };
  const $set = scrubPersonProps(cr.$set);
  const $setOnce = scrubPersonProps(cr.$set_once);
  if ($set) out.$set = $set;
  else delete out.$set;
  if ($setOnce) out.$set_once = $setOnce;
  else delete out.$set_once;
  delete out.$unset;
  return out;
}

// ---------- buckets and error names ----------

export function countBucket(n: number): CountBucket {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2_5';
  if (n <= 20) return '6_20';
  return '21_plus';
}

export function pdfSizeBucket(bytes: number | undefined): PdfSizeBucket {
  if (bytes == null || !Number.isFinite(bytes)) return 'unknown';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return 'lt_1mb';
  if (mb < 5) return '1_5mb';
  if (mb <= 20) return '5_20mb';
  return 'gt_20mb';
}

/** The error's class name only (`QuotaExceededError`, `InvalidPDFException`) — never its message. */
export function errorName(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err === 'object' && err && 'name' in err ? String((err as { name: unknown }).name) : '';
  return TOKEN.test(name) ? name : 'UnknownError';
}

// ---------- UTM and URL handling ----------

/** Lowercased; anything outside the `a-z 0-9 _ -` naming convention is dropped rather than sent. */
export function parseUtm(search: string): UtmParams {
  const params = new URLSearchParams(search);
  const out: UtmParams = {};
  for (const key of UTM_KEYS) {
    const raw = params.get(key)?.trim().toLowerCase();
    if (raw && /^[a-z0-9_-]{1,64}$/.test(raw)) out[key] = raw;
  }
  return out;
}

export function hasUtm(utm: UtmParams): boolean {
  return UTM_KEYS.some((k) => utm[k] !== undefined);
}

/** Query params the app consumes and then removes from the address bar. */
export function isConsumedParam(key: string): boolean {
  return key.startsWith('utm_') || key === 'bc_internal';
}

/** The search string with every consumed param removed (`''` when nothing is left). */
export function stripConsumedParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) {
    if (isConsumedParam(key)) params.delete(key);
  }
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

export function firstTouchProps(utm: UtmParams | null): Partial<Record<(typeof FIRST_TOUCH_KEYS)[number], string>> {
  if (!utm) return {};
  return {
    first_utm_source: utm.utm_source,
    first_utm_medium: utm.utm_medium,
    first_utm_campaign: utm.utm_campaign,
    first_utm_content: utm.utm_content,
  };
}

// ---------- device context ----------

/**
 * Coarse primary pointer (touch) + short screen side decides it; everything with a fine pointer is
 * desktop. Two media queries and the screen size — no fingerprinting inputs.
 */
export function deviceClassFrom(coarsePointer: boolean, shortScreenSide: number): DeviceClass {
  if (!coarsePointer) return 'desktop';
  if (shortScreenSide < 600) return 'mobile';
  if (shortScreenSide < 1100) return 'tablet';
  return 'desktop';
}

/** Instagram and Facebook announce their in-app browsers in the user agent. */
export function inAppBrowserFrom(userAgent: string): InAppBrowser {
  if (/Instagram/i.test(userAgent)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/.test(userAgent)) return 'facebook';
  return 'none';
}
