import type { Point } from './index';
import type { AiOpeningProvenance, OpeningBox, RawDeferredOpening } from './aiOpenings';

/** Plan-level physical opening. Room.Opening remains the legacy quantity row. */
export type PlanOpeningKind = 'door' | 'window' | 'open-passage' | 'custom' | 'unknown';
export interface LegacyOpeningRef { roomId: string; openingId: string }
export type OpeningRoomSide = { roomId: string } | 'exterior' | null;
export interface PlanOpening {
  id: string;
  planId: string;
  pageNumber: number;
  /** Uncalibrated native page coordinates, same frame as Room.points. */
  geometry: { endpointA: Point; endpointB: Point } | null;
  /** Explicit quantity-only entry permits approval without fabricated drawing geometry. */
  entryMethod?: 'plan' | 'takeoff';
  label?: string;
  notes?: string;
  aiDetection?: { reviewKey:string; sourceHash:string; bbox:OpeningBox; provenance?:AiOpeningProvenance; deferred?:RawDeferredOpening };
  quantityReview?: { associationsConfirmed: boolean; distinctLegacyRoomIds: string[] };
  widthSource?: 'manual' | 'calibration';
  kind: PlanOpeningKind;
  mechanism: 'hinged' | 'sliding' | 'fixed' | 'open' | 'unknown';
  walkableAccess: 'supported' | 'unsupported' | 'unknown';
  roomIds: string[];
  /** Optional editor sides; roomIds remain the authoritative room associations. */
  roomSides?: [OpeningRoomSide, OpeningRoomSide];
  /** Explicit attribution for standalone openings; related rooms remain authoritative. */
  apartmentNumber?: string;
  /** null means unknown. Never inferred from a class. Manual placement may explicitly measure width using calibration. */
  widthM: number | null;
  heightM: number | null;
  sillHeightM: number | null;
  quantity: number | null;
  source: 'manual' | 'import' | 'legacy';
  /** References only: these rows remain stored and counted exclusively in Room.openings. */
  legacyRefs: LegacyOpeningRef[];
  approval: { status: 'draft' | 'approved' | 'rejected'; reviewedAt: number | null };
  createdAt: number;
  updatedAt: number;
}
export type NewPlanOpening = Omit<PlanOpening, 'id' | 'planId' | 'approval' | 'createdAt' | 'updatedAt'>;
export type PlanOpeningPatch = Partial<NewPlanOpening>;
