/**
 * The structure of a mesh zone's reinforcement — which levels exist, in which mode, and how that
 * flattens into the bar groups the rebar engine calculates. Pure; no calculation of its own.
 *
 *   Mesh zone → level (bottom / top) → uniform spec  |  long-side spec + short-side spec
 *
 * ── How old data is read ───────────────────────────────────────────────────────────────────────
 * Before levels, a mesh held a flat list of directional layers. `normalizeMesh` converts it, the same
 * way every time and without changing any quantity:
 *   - every old layer belonged to the BOTTOM level — there was no top;
 *   - no layers            → no level at all (still "no reinforcement entered");
 *   - one `long` and one `short` layer with the same diameter and spacing → bottom, uniform;
 *   - otherwise            → bottom, directional: the first `long` layer is the long side, the
 *                            first `short` layer the short side; any further layer in a direction
 *                            already taken is kept in `extra` and still calculated.
 * Reading never writes: the converted shape is stored the next time the mesh is edited.
 */

import { v4 as uuid } from 'uuid';
import type { BarSpec, MeshReinforcement, RebarLayer, RebarLayerDirection, RebarLevel, RebarMesh } from '../types/structural';

export const REBAR_LEVELS: readonly RebarLevel[] = ['bottom', 'top'];

/** The levels a mesh has, in reading order (bottom first), with their reinforcement. */
export function meshLevels(mesh: Pick<RebarMesh, 'bottom' | 'top'>): { level: RebarLevel; reinforcement: MeshReinforcement }[] {
  const out: { level: RebarLevel; reinforcement: MeshReinforcement }[] = [];
  if (mesh.bottom) out.push({ level: 'bottom', reinforcement: mesh.bottom });
  if (mesh.top) out.push({ level: 'top', reinforcement: mesh.top });
  return out;
}

/** Which of the selector's choices the mesh is on. */
export type MeshLevelChoice = 'bottom' | 'top' | 'both' | 'none';
export function levelChoice(mesh: Pick<RebarMesh, 'bottom' | 'top'>): MeshLevelChoice {
  return mesh.bottom && mesh.top ? 'both' : mesh.bottom ? 'bottom' : mesh.top ? 'top' : 'none';
}

/** One directional bar group of a mesh, as the engine calculates it, with where it came from. */
export interface MeshLayer extends RebarLayer {
  level: RebarLevel;
  /** True when the group comes from a uniform specification (it applies to both directions). */
  uniform: boolean;
}

/**
 * The bar groups of a mesh: a uniform level gives its one specification in both directions (long,
 * then short); a directional level gives the directions it has. Bottom first, then top.
 */
export function meshLayers(mesh: RebarMesh): MeshLayer[] {
  const out: MeshLayer[] = [];
  for (const { level, reinforcement: r } of meshLevels(mesh)) {
    if (r.mode === 'uniform') {
      for (const direction of ['long', 'short'] as const) {
        out.push({ id: `${mesh.id}:${level}:${direction}`, ...r.spec, direction, level, uniform: true });
      }
    } else {
      if (r.long) out.push({ id: `${mesh.id}:${level}:long`, ...r.long, direction: 'long', level, uniform: false });
      if (r.short) out.push({ id: `${mesh.id}:${level}:short`, ...r.short, direction: 'short', level, uniform: false });
      for (const l of r.extra ?? []) out.push({ ...l, level, uniform: false });
    }
  }
  return out;
}

const specOf = (l: RebarLayer): BarSpec => ({ diameterMm: l.diameterMm, spacingM: l.spacingM });
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function convertLegacyLayers(layers: RebarLayer[]): MeshReinforcement | undefined {
  if (layers.length === 0) return undefined;
  const long = layers.find((l) => l.direction !== 'short');
  const short = layers.find((l) => l.direction === 'short');
  const rest = layers.filter((l) => l !== long && l !== short);
  if (long && short && rest.length === 0 && positive(long.diameterMm) && long.diameterMm === short.diameterMm && positive(long.spacingM) && long.spacingM === short.spacingM) {
    return { mode: 'uniform', spec: specOf(long) };
  }
  return {
    mode: 'directional',
    ...(long ? { long: specOf(long) } : {}),
    ...(short ? { short: specOf(short) } : {}),
    ...(rest.length > 0 ? { extra: rest.map((l) => ({ ...l })) } : {}),
  };
}

const meshCache = new WeakMap<RebarMesh, RebarMesh>();

/** The mesh in the levels shape; the same object when it already is. See the header for the rule. */
export function normalizeMesh(mesh: RebarMesh): RebarMesh {
  if (!('layers' in mesh)) return mesh;
  const hit = meshCache.get(mesh);
  if (hit) return hit;
  const { layers, ...rest } = mesh;
  let converted: RebarMesh;
  if (mesh.bottom || mesh.top) {
    converted = rest; // already levelled; a stray old list is dropped
  } else {
    const bottom = convertLegacyLayers(Array.isArray(layers) ? layers : []);
    converted = bottom ? { ...rest, bottom } : rest;
  }
  meshCache.set(mesh, converted);
  return converted;
}

// ---------- building and editing a level (the form's operations) ----------

export const emptySpec = (): BarSpec => ({ diameterMm: 0, spacingM: 0 });
export const emptyReinforcement = (): MeshReinforcement => ({ mode: 'uniform', spec: emptySpec() });

/** A copy of a level's reinforcement that shares nothing with the original (new ids for old extras). */
export function copyReinforcement(r: MeshReinforcement): MeshReinforcement {
  if (r.mode === 'uniform') return { mode: 'uniform', spec: { ...r.spec } };
  return {
    mode: 'directional',
    ...(r.long ? { long: { ...r.long } } : {}),
    ...(r.short ? { short: { ...r.short } } : {}),
    ...(r.extra ? { extra: r.extra.map((l) => ({ ...l, id: uuid() })) } : {}),
  };
}

/**
 * Switches a level's mode keeping what was entered: uniform → directional starts both sides from the
 * one specification; directional → uniform keeps the long side's (else the short side's) values.
 * Same mode: the same object.
 */
export function withMode(r: MeshReinforcement, mode: MeshReinforcement['mode']): MeshReinforcement {
  if (r.mode === mode) return r;
  if (r.mode === 'uniform') return { mode: 'directional', long: { ...r.spec }, short: { ...r.spec } };
  return { mode: 'uniform', spec: { ...(r.long ?? r.short ?? emptySpec()) } };
}

/** Patches one specification of a level: the uniform one, or one side of a directional level. */
export function withSpec(r: MeshReinforcement, which: 'uniform' | RebarLayerDirection, patch: Partial<BarSpec>): MeshReinforcement {
  if (r.mode === 'uniform') return which === 'uniform' ? { mode: 'uniform', spec: { ...r.spec, ...patch } } : r;
  if (which === 'uniform') return r;
  return { ...r, [which]: { ...(r[which] ?? emptySpec()), ...patch } };
}

/** Adds the missing side of a directional level, starting from the other side's values. */
export function withDirection(r: MeshReinforcement, direction: RebarLayerDirection): MeshReinforcement {
  if (r.mode !== 'directional' || r[direction]) return r;
  const other = r[direction === 'long' ? 'short' : 'long'];
  return { ...r, [direction]: other ? { ...other } : emptySpec() };
}

/** Removes one side of a directional level — only while the other side remains. */
export function withoutDirection(r: MeshReinforcement, direction: RebarLayerDirection): MeshReinforcement {
  if (r.mode !== 'directional') return r;
  const other = direction === 'long' ? 'short' : 'long';
  if (!r[other]) return r;
  const { [direction]: _removed, ...rest } = r;
  return rest as MeshReinforcement;
}

/** Removes one old extra layer of a directional level. */
export function withoutExtra(r: MeshReinforcement, layerId: string): MeshReinforcement {
  if (r.mode !== 'directional' || !r.extra) return r;
  const extra = r.extra.filter((l) => l.id !== layerId);
  const { extra: _old, ...rest } = r;
  return extra.length > 0 ? { ...rest, extra } : rest;
}

/** Compact notation of one specification: `Ø12 @ 20` (spacing in cm). Null until both numbers are usable. */
export function specNotation(spec: BarSpec | undefined): string | null {
  if (!spec || !positive(spec.diameterMm) || !positive(spec.spacingM)) return null;
  return `Ø${spec.diameterMm} @ ${Math.round(spec.spacingM * 1000) / 10}`;
}

/**
 * A mesh with every inner layer id renewed — for a duplicated plan, whose items get new ids. Works on
 * either shape (old `layers`, or the levels' `extra` layers); the specifications are untouched.
 */
export function withRenewedLayerIds(mesh: RebarMesh): RebarMesh {
  const renewLevel = (r: MeshReinforcement | undefined) => (r && r.mode === 'directional' && r.extra ? { ...r, extra: r.extra.map((l) => ({ ...l, id: uuid() })) } : r);
  return {
    ...mesh,
    ...(mesh.layers ? { layers: mesh.layers.map((l) => ({ ...l, id: uuid() })) } : {}),
    ...(mesh.bottom ? { bottom: renewLevel(mesh.bottom) } : {}),
    ...(mesh.top ? { top: renewLevel(mesh.top) } : {}),
  };
}
