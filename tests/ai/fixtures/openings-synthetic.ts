import type { OpeningDetectionResult } from '../../../src/types/aiOpenings.ts';
import { aiTiles } from '../../../src/lib/ai/contracts.ts';

// Entirely synthetic geometry and provider usage. No customer plan or captured API response.
export const metadata = {
  sourceSha256: 'a'.repeat(64), page: 1,
  pdfDimensionsPoints: [100, 80.01], pageDimensions: [5500, 4401], renderDpi: 3960,
  tiles: aiTiles(5500, 4401),
};
export const result: OpeningDetectionResult = {
  openings: Array.from({ length: 17 }, (_, index) => {
    const x = 0.15 + (index % 4) * 0.15, y = 0.2 + Math.floor(index / 4) * 0.1;
    return {
      openingId: `synthetic-${index + 1}`,
      type: (['hinged-door', 'sliding-door', 'doorway', 'open-passage', 'window', 'unknown-opening'] as const)[index % 6],
      geometryTile: (['TILE_A', 'TILE_B', 'TILE_C', 'TILE_D'] as const)[index % 4],
      endpointA: { x, y }, endpointB: { x: x + 0.08, y },
      bbox: { x1: x - 0.02, y1: y - 0.02, x2: x + 0.1, y2: y + 0.02 },
      confidence: 0.9, requiresReview: true,
      evidence: ['Synthetic opening evidence'], ambiguities: [],
    };
  }),
  deferred: [], coverageNotes: ['Synthetic coverage note'],
};
export const response = {
  id: 'resp-synthetic', model: 'gpt-6.1-sol', status: 'completed', service_tier: 'default',
  usage: { input_tokens: 1000, output_tokens: 2000 },
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
};
