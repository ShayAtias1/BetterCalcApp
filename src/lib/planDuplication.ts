import { v4 as uuid } from 'uuid';
import type { Plan } from '../types';
import { withRenewedLayerIds } from './rebarMesh';

/**
 * A fully independent copy of a plan: calibration, rooms (with openings and work items, overrides
 * included), measurements, markups, concrete and rebar zones and the plan's quantity defaults. Everything is deep-cloned and
 * every id is new — the plan's, and each room's, work item's, opening's, measurement's,
 * markup's, concrete element's, rebar item's and rebar layer's — so nothing in the copy can ever point back into, or be edited through, the original.
 * The PDF blob is copied separately by the caller under the new plan id.
 */
export function clonePlanForDuplicate(source: Plan, name: string): Plan {
  const copy = structuredClone(source);
  const now = Date.now();
  return {
    ...copy,
    id: uuid(),
    name,
    createdAt: now,
    updatedAt: now,
    rooms: copy.rooms.map((r) => ({
      ...r,
      id: uuid(),
      workItems: r.workItems.map((wi) => ({ ...wi, id: uuid() })),
      openings: r.openings?.map((o) => ({ ...o, id: uuid() })),
    })),
    measurements: (copy.measurements ?? []).map((m) => ({ ...m, id: uuid() })),
    markups: (copy.markups ?? []).map((m) => ({ ...m, id: uuid() })),
    // Concrete and rebar zones, only when the source has them, so a plan without them stays without.
    ...(Array.isArray(copy.concreteElements)
      ? { concreteElements: copy.concreteElements.map((e) => ({ ...e, id: uuid() })) }
      : {}),
    ...(Array.isArray(copy.rebarItems)
      ? {
          rebarItems: copy.rebarItems.map((item) =>
            item.kind === 'mesh'
              ? { ...withRenewedLayerIds(item), id: uuid() }
              : { ...item, id: uuid() }
          ),
        }
      : {}),
  };
}
