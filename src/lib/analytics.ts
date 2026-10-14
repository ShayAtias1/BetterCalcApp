/**
 * Product analytics — the one place the app talks to PostHog. See docs/ANALYTICS.md.
 *
 * Everything else calls the typed helpers below; nothing imports the SDK directly. The wrapper
 * owns: SDK initialisation (lazy, only when enabled), the anonymous device identity (the ledger's
 * `device_id`, bootstrapped as PostHog's distinct id), global properties, UTM capture and removal
 * from the address bar, first-touch attribution, the internal-device flag, dev/demo disabling,
 * privacy allowlisting (`analyticsPrivacy.ts`) and per-session/per-plan deduplication.
 *
 * Analytics must never break or slow the app: every helper is a no-op when analytics is off, and
 * swallows its own failures. It never reads plan content beyond counts, flags and enum values.
 */

import { v4 as uuid } from 'uuid';
import type { CaptureOptions, PostHog } from 'posthog-js';
import type { Plan, Room, RoomQuantitySummary, WorkItem } from '../types';
import type { Comparison, Measurement as CompareMeasurement } from '../types/compare';
import { countLocalDocuments, type ProjectWithPlans } from '../db/database';
import {
  countBucket,
  deviceClassFrom,
  errorName,
  firstTouchProps,
  hasUtm,
  inAppBrowserFrom,
  parseUtm,
  pdfSizeBucket,
  sanitizeEventProps,
  sanitizeGlobalProps,
  scrubCaptureResult,
  stripConsumedParams,
  type AnalyticsEventName,
  type AnalyticsEvents,
  type ErrorArea,
  type ExportKind,
  type ExportSurface,
  type RoomTemplateKey,
  type UtmParams,
} from './analyticsPrivacy';
import { calendarDaysBetween, isReturning, loadLedger, markActive, markFirst, saveLedger, type Ledger } from './analyticsLedger';
import { baselinePlanReadiness, calibratedPageCount, reportContents, takeQuantitiesReady, workTypesOf } from './analyticsMilestones';
import { createOncePerKey } from './analyticsDedupe';
import { buildRoomSummaries, isPageCalibrated } from './quantities';
import { ROOM_PROFILES } from './roomProfiles';

/** `?bc_internal=1` sets it, `?bc_internal=0` clears it. A flagged browser never sends anything. */
const INTERNAL_KEY = 'bc_analytics_internal';
const SESSION_UTM_KEY = 'bc_analytics_session_utm';
/** Manual alignment counts once the revised layer has stopped moving for this long. */
const MANUAL_ALIGNMENT_SETTLE_MS = 1500;
const MAX_QUEUE = 200;

/** off: nothing happens. send: events go to PostHog. debug: events are logged to the console, never sent. */
type Mode = 'off' | 'send' | 'debug';

let mode: Mode = 'off';
let initialized = false;
let client: PostHog | null = null;
let ledger: Ledger | null = null;
let globals: Record<string, unknown> = {};
/** Record counts found in IndexedDB when the app opened — tells pre-analytics users from new ones. */
let localCountsAtOpen: { projects: number; plans: number; comparisons: number } | null = null;
/** Events tracked before the lazily loaded SDK is ready. */
const queue: { name: AnalyticsEventName; props: Record<string, unknown>; options: CaptureOptions }[] = [];
/** Per-session dedupe (alignments, repeated error kinds); manual alignment waits for the burst to settle. */
const once = createOncePerKey(MANUAL_ALIGNMENT_SETTLE_MS);
/** The plan just loaded into the workspace, until its PDF first renders (→ `plan_opened`). */
let planAwaitingRender: string | null = null;

// ---------- storage & environment (all failure-tolerant) ----------

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isInternalDevice(): boolean {
  try {
    return localStore()?.getItem(INTERNAL_KEY) === '1';
  } catch {
    return false;
  }
}

function config(): { key: string; host: string } | null {
  const key = import.meta.env.VITE_POSTHOG_KEY?.trim();
  const host = import.meta.env.VITE_POSTHOG_HOST?.trim();
  return key && host ? { key, host } : null;
}

function decideMode(): Mode {
  // Debug logs what would be sent and sends nothing, so it is safe anywhere, including `npm run dev`.
  if (import.meta.env.VITE_ANALYTICS_DEBUG === 'true') return 'debug';
  if (import.meta.env.DEV) return 'off';
  if (!config()) return 'off';
  // Playwright and other automation (the demo pipeline) set navigator.webdriver.
  if (navigator.webdriver) return 'off';
  if (isInternalDevice()) return 'off';
  return 'send';
}

function detectDeviceClass() {
  let coarse = false;
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches;
  } catch {
    // Old browsers without matchMedia are desktops for our purposes.
  }
  const shortSide = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  return deviceClassFrom(coarse, shortSide);
}

function readSessionUtm(): UtmParams {
  try {
    const raw = sessionStore()?.getItem(SESSION_UTM_KEY);
    return raw ? parseUtm(new URLSearchParams(JSON.parse(raw) as Record<string, string>).toString()) : {};
  } catch {
    return {};
  }
}

function writeSessionUtm(utm: UtmParams): void {
  try {
    sessionStore()?.setItem(SESSION_UTM_KEY, JSON.stringify(utm));
  } catch {
    // Session touch is a nice-to-have.
  }
}

/** Runs an analytics side effect without ever letting it throw into app code. */
function safely(fn: () => void): void {
  if (mode === 'off') return;
  try {
    fn();
  } catch (err) {
    if (mode === 'debug') console.warn('[analytics] helper failed', err);
  }
}

function persistLedger(): void {
  if (ledger) saveLedger(localStore(), ledger);
}

// ---------- init ----------

/**
 * Call once, before the app renders. Always consumes `bc_internal` and the UTM params and removes
 * them from the address bar (so a bookmark or shared link never re-attributes a later visit), then
 * starts analytics only if it is enabled for this build and browser.
 */
export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  try {
    const url = new URL(window.location.href);
    const internal = url.searchParams.get('bc_internal');
    try {
      if (internal === '1') localStore()?.setItem(INTERNAL_KEY, '1');
      else if (internal === '0') localStore()?.removeItem(INTERNAL_KEY);
    } catch {
      // Storage blocked: the flag cannot persist, and neither can anything else.
    }
    const utm = parseUtm(url.search);
    const cleaned = stripConsumedParams(url.search);
    if (cleaned !== url.search) window.history.replaceState(window.history.state, '', `${url.pathname}${cleaned}${url.hash}`);

    mode = decideMode();
    if (mode === 'off') return;

    const now = Date.now();
    const loaded = loadLedger(localStore(), now, uuid);
    ledger = loaded.ledger;
    // First touch is the device's very first visit: its UTMs, or none (direct) — never overwritten.
    if (loaded.isNew && hasUtm(utm)) ledger.first_touch = utm;
    persistLedger();

    if (hasUtm(utm)) writeSessionUtm(utm);
    const sessionUtm = hasUtm(utm) ? utm : readSessionUtm();

    const device = { device_class: detectDeviceClass(), in_app_browser: inAppBrowserFrom(navigator.userAgent) };
    const daysSinceFirstSeen = calendarDaysBetween(ledger.first_seen_at, now);
    globals = sanitizeGlobalProps({
      app_version: __APP_VERSION__,
      ...device,
      days_since_first_seen: daysSinceFirstSeen,
      active_days: ledger.active_days,
      ...firstTouchProps(ledger.first_touch),
      ...sessionUtm,
    });

    if (mode === 'send') void loadClient();
    void trackAppOpened(isReturning(ledger, now), daysSinceFirstSeen, device);
  } catch (err) {
    mode = 'off';
    console.warn('[analytics] disabled after an init error', errorName(err));
  }
}

async function loadClient(): Promise<void> {
  const cfg = config();
  if (!cfg || !ledger) return;
  try {
    // The no-external bundle never loads remote scripts (recorder, surveys, toolbar, site apps).
    const { default: posthog } = await import('posthog-js/no-external');
    posthog.init(cfg.key, {
      api_host: cfg.host,
      // Identity: our own anonymous device id, in first-party localStorage only (no cookie).
      bootstrap: { distinctID: ledger.device_id, isIdentifiedID: false },
      persistence: 'localStorage',
      // Anonymous events only: no person profiles. Nothing here calls identify / alias / group /
      // setPersonProperties or sends $set / $set_once, so no profile is ever created. First-touch
      // attribution travels on the events themselves (`first_utm_*` globals, from the ledger).
      person_profiles: 'identified_only',
      // Product analytics only: every automatic capture and every other product is off.
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      capture_heatmaps: false,
      enable_heatmaps: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      disable_scroll_properties: true,
      disable_external_dependency_loading: true,
      opt_in_site_apps: false,
      // No /flags call, so nothing switched on in the PostHog UI (replay, heatmaps, surveys) can reach the client.
      advanced_disable_flags: true,
      // Belt and braces for anything that would read the DOM or the URL.
      mask_all_text: true,
      mask_all_element_attributes: true,
      mask_personal_data_properties: true,
      // UTMs are captured by this wrapper (then removed from the URL), not by the SDK.
      save_campaign_params: false,
      before_send: scrubCaptureResult,
    });
    posthog.register(globals);
    client = posthog;
    for (const { name, props, options } of queue.splice(0)) client.capture(name, props, options);
  } catch (err) {
    mode = 'off';
    queue.length = 0;
    console.warn('[analytics] could not start', errorName(err));
  }
}

// ---------- core send ----------

/** Events that are not a sign of work being done: they do not make a day "active". */
const PASSIVE_EVENTS = new Set<AnalyticsEventName>(['app_opened', 'error_occurred']);

function send<E extends AnalyticsEventName>(name: E, props: AnalyticsEvents[E], options: CaptureOptions = {}): void {
  const clean = sanitizeEventProps(name, props as Record<string, unknown>);
  if (!PASSIVE_EVENTS.has(name) && ledger && markActive(ledger, Date.now())) {
    persistLedger();
    globals = { ...globals, active_days: ledger.active_days };
    client?.register({ active_days: ledger.active_days });
  }
  if (mode === 'debug') {
    console.info(`[analytics] ${name}`, clean, { global: globals, ...options });
    return;
  }
  if (client) client.capture(name, clean, options);
  else if (queue.length < MAX_QUEUE) queue.push({ name, props: clean, options: { ...options, timestamp: new Date() } });
}

function track<E extends AnalyticsEventName>(name: E, props: AnalyticsEvents[E], options?: CaptureOptions): void {
  safely(() => send(name, props, options));
}

function markFirstAndSave(field: Parameters<typeof markFirst>[1]): boolean {
  if (!ledger) return false;
  const first = markFirst(ledger, field, Date.now());
  if (first) persistLedger();
  return first;
}

async function trackAppOpened(
  returning: boolean,
  daysSinceFirstSeen: number,
  device: Pick<AnalyticsEvents['app_opened'], 'device_class' | 'in_app_browser'>
): Promise<void> {
  try {
    localCountsAtOpen = await countLocalDocuments();
  } catch {
    localCountsAtOpen = null;
  }
  const counts = localCountsAtOpen ?? { projects: 0, plans: 0, comparisons: 0 };
  track('app_opened', {
    has_local_data: counts.projects + counts.plans + counts.comparisons > 0,
    local_project_count_bucket: countBucket(counts.projects),
    is_returning: returning,
    days_since_first_seen: daysSinceFirstSeen,
    ...device,
  });
}

// ---------- projects & plans ----------

/**
 * Projects are always created empty now — plans are added from the overview and report their own
 * `plan_created` — so `with_first_plan` is always false. The property stays so the event's shape
 * (and earlier data, where it could be true) does not change.
 */
export function trackProjectCreated(projectId: string): void {
  safely(() => {
    const hadProjects = (localCountsAtOpen?.projects ?? 0) + (localCountsAtOpen?.plans ?? 0) > 0;
    const firstOnDevice = markFirstAndSave('first_project_at');
    track('project_created', { project_id: projectId, with_first_plan: false, is_first_project: firstOnDevice && !hadProjects });
  });
}

/** From the home screen's project list only — creating a project opens it internally, which is not a reopen. */
export function trackProjectOpened({ project, plans, comparisons }: ProjectWithPlans): void {
  track('project_opened', {
    project_id: project.id,
    project_age_days: calendarDaysBetween(project.createdAt, Date.now()),
    plan_count: plans.length,
    comparison_count: comparisons.length,
  });
}

export function trackPlanCreated(plan: Plan, method: 'upload' | 'duplicate', pdfBytes: number | undefined, planIndex: number): void {
  if (!plan.projectId) return;
  track('plan_created', {
    plan_id: plan.id,
    project_id: plan.projectId,
    method,
    pdf_size_bucket: pdfSizeBucket(pdfBytes),
    plan_index: planIndex,
  });
}

/**
 * A plan was loaded into the workspace. Arms `plan_opened` for its first rendered page, and
 * records a plan that *already* has quantities as ready without an event — reopening or
 * duplicating finished work, or work done before analytics existed, is not a new activation.
 */
export function notePlanLoaded(plan: Plan): void {
  safely(() => {
    planAwaitingRender = plan.id;
    if (ledger && baselinePlanReadiness(ledger, plan)) persistLedger();
  });
}

/** The plan's PDF finished rendering a page. Fires `plan_opened` once per load of the plan. */
export function notePlanRendered(plan: Plan, pageCount: number): void {
  safely(() => {
    if (planAwaitingRender !== plan.id) return;
    planAwaitingRender = null;
    track('plan_opened', {
      plan_id: plan.id,
      project_id: plan.projectId,
      page_count: pageCount,
      plan_age_days: calendarDaysBetween(plan.createdAt, Date.now()),
      calibrated_pages: calibratedPageCount(plan),
      room_count: plan.rooms.length,
    });
  });
}

export function trackCalibrationCompleted(plan: Plan, isRecalibration: boolean, pageCount: number): void {
  safely(() =>
    track('calibration_completed', {
      plan_id: plan.id,
      is_recalibration: isRecalibration,
      calibrated_pages: calibratedPageCount(plan),
      page_count: pageCount,
    })
  );
}

function templateKeyOf(key: string | null | undefined): RoomTemplateKey | 'none' {
  return key && ROOM_PROFILES.some((p) => p.key === key) ? (key as RoomTemplateKey) : 'none';
}

/** `plan` is the plan after the rooms were added. */
export function trackRoomsCreated(plan: Plan, method: AnalyticsEvents['room_created']['method'], rooms: Room[]): void {
  safely(() => {
    if (rooms.length === 0) return;
    track('room_created', {
      plan_id: plan.id,
      method,
      count: rooms.length,
      // An apartment copy spans many room types; the field is about templates used to start a room.
      template_key: method === 'apartment_duplicate' ? 'none' : templateKeyOf(rooms[0].roomType),
      page_calibrated: rooms.every((r) => isPageCalibrated(plan, r.pageNumber)),
      room_count: plan.rooms.length,
    });
  });
}

export function trackWorkItemsAdded(plan: Plan, items: WorkItem[], source: AnalyticsEvents['work_item_added']['source']): void {
  safely(() => {
    if (items.length === 0) return;
    track('work_item_added', { plan_id: plan.id, work_types: workTypesOf(items.map((i) => i.type)), count: items.length, source });
  });
}

/** A hand-drawn room: the room itself, plus the work items a "template for new rooms" seeded into it. */
export function trackRoomDrawn(plan: Plan, room: Room, method: 'polygon' | 'rectangle'): void {
  trackRoomsCreated(plan, method, [room]);
  trackWorkItemsAdded(plan, room.workItems, 'new_room_template');
}

/**
 * Called after every successful save of the open plan. The first time a plan yields a real
 * quantity (calibrated page + room + work item + quantity > 0, by the app's own quantity logic),
 * fires `quantities_ready` — once per plan, ever, on this device; undo/redo and later saves are
 * ignored by the ledger.
 */
export function notePlanSaved(plan: Plan): void {
  safely(() => {
    if (!ledger) return;
    const status = takeQuantitiesReady(ledger, plan);
    if (!status) return;
    markFirst(ledger, 'first_activation_at', Date.now());
    persistLedger();
    track('quantities_ready', {
      plan_id: plan.id,
      project_id: plan.projectId,
      rooms_with_qty: status.roomsWithQty,
      work_types: status.workTypes,
      minutes_since_plan_created: Math.max(0, Math.round((Date.now() - plan.createdAt) / 60_000)),
    });
  });
}

// ---------- exports ----------

type ExportDetails = Partial<Omit<AnalyticsEvents['export_completed'], 'export_kind' | 'surface' | 'duration_ms' | 'is_first_export'>>;

/**
 * Wraps one export. Success → `export_completed`; a throw → `error_occurred` (class name only) and
 * the error is re-thrown so the caller still tells the user. `run` may return details only known
 * at the end (e.g. how many pages made it), or null when nothing was exported (not an event).
 */
export async function trackedExport(
  base: { export_kind: ExportKind; surface: ExportSurface } & ExportDetails,
  run: () => Promise<ExportDetails | null | void>
): Promise<void> {
  const started = performance.now();
  let details: ExportDetails | null | void;
  try {
    details = await run();
  } catch (err) {
    trackError('export', err, base.export_kind);
    throw err;
  }
  if (details === null) return;
  safely(() => {
    const isFirst = markFirstAndSave('first_export_at');
    track('export_completed', {
      ...base,
      ...(details ?? {}),
      duration_ms: Math.round(performance.now() - started),
      is_first_export: isFirst,
    });
  });
}

/** Scope and contents of a plan's quantity report (Excel or PDF). */
export function quantityExportDetails(
  plan: Plan,
  summaries: RoomQuantitySummary[],
  pageNumbers: number[],
  exportablePageCount: number
): ExportDetails {
  if (mode === 'off') return {};
  const { workTypes, wasteApplied, roomCount } = reportContents([{ plan, summaries }]);
  return {
    plan_id: plan.id,
    project_id: plan.projectId,
    pages_count: pageNumbers.length,
    page_scope: pageNumbers.length >= exportablePageCount ? 'all' : 'selected',
    work_types: workTypes,
    waste_applied: wasteApplied,
    room_count_bucket: countBucket(roomCount),
  };
}

/** Scope and contents of the project-wide report (every plan). */
export function projectExportDetails(projectId: string, plans: Plan[]): ExportDetails {
  if (mode === 'off') return {};
  const { workTypes, wasteApplied, roomCount } = reportContents(plans.map((plan) => ({ plan, summaries: buildRoomSummaries(plan) })));
  return {
    project_id: projectId,
    plan_count: plans.length,
    work_types: workTypes,
    waste_applied: wasteApplied,
    room_count_bucket: countBucket(roomCount),
  };
}

// ---------- Revision Compare ----------

export function trackComparisonCreated(comparison: Comparison): void {
  safely(() => {
    if (!comparison.projectId) return;
    const hadComparisons = (localCountsAtOpen?.comparisons ?? 0) > 0;
    const firstOnDevice = markFirstAndSave('first_comparison_at');
    track('comparison_created', {
      comparison_id: comparison.id,
      project_id: comparison.projectId,
      revision_count: comparison.revisions.length,
      is_first_comparison: firstOnDevice && !hadComparisons,
    });
  });
}

export function trackComparisonOpened(comparison: Comparison): void {
  track('comparison_opened', {
    comparison_id: comparison.id,
    project_id: comparison.projectId,
    comparison_age_days: calendarDaysBetween(comparison.createdAt, Date.now()),
    revision_count: comparison.revisions.length,
  });
}

/** After the revised PDF is stored — a revision whose file failed to save is not "added". */
export function trackRevisionAdded(comparisonId: string, revisionCount: number): void {
  track('revision_added', { comparison_id: comparisonId, revision_count: revisionCount });
}

function fireAlignment(comparisonId: string, method: 'points' | 'manual'): void {
  markFirstAndSave('first_activation_at');
  track('alignment_completed', { comparison_id: comparisonId, method });
}

/**
 * The revised layer was aligned on a page. Point pairs are one solve → counted at once. Manual
 * alignment (drag, rotation/scale sliders) is a burst → counted only after it has settled for
 * MANUAL_ALIGNMENT_SETTLE_MS. Either way, once per comparison × revision × page × method per session.
 */
export function noteAlignment(comparison: Comparison, pageKey: number, method: 'points' | 'manual'): void {
  safely(() => {
    const revisionId = comparison.activeRevisionId;
    if (!revisionId) return;
    const key = `align:${comparison.id}:${revisionId}:${pageKey}:${method}`;
    const fire = () => safely(() => fireAlignment(comparison.id, method));
    if (method === 'points') once.now(key, fire);
    else once.settle(key, fire);
  });
}

/** Only area measurements classified as demolition / new construction are "changes". */
export function trackChangeMarked(comparisonId: string, measurement: CompareMeasurement, shape: 'polygon' | 'rectangle' | 'line'): void {
  safely(() => {
    if (measurement.tool !== 'area' || !measurement.areaKind) return;
    track('change_marked', {
      comparison_id: comparisonId,
      area_kind: measurement.areaKind,
      calc_mode: measurement.calcMode ?? 'footprint',
      shape,
    });
  });
}

// ---------- errors ----------

/**
 * Sends the error's class name only — never its message. Non-export errors (autosave retries,
 * page re-loads) are counted once per area × error name per session, so a failing disk does not
 * flood the stream; each failed export is its own user action and is always counted.
 */
export function trackError(area: ErrorArea, err: unknown, exportKind?: ExportKind): void {
  safely(() => {
    const name = errorName(err);
    const fire = () => track('error_occurred', { area, error_name: name, export_kind: exportKind });
    if (area === 'export') fire();
    else once.now(`error:${area}:${name}`, fire);
  });
}
