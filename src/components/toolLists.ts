import type { MarkupTool, MeasureTool } from '../types';
import type { IconName } from './Icon';

/** The measure and markup tools, shared by their side-panel toolbars and the canvas tool dock. */
export const MEASURE_TOOLS: MeasureTool[] = ['distance', 'area', 'perimeter'];
export const MEASURE_ICONS: Record<MeasureTool, IconName> = { distance: 'ruler', area: 'square', perimeter: 'circle' };
export const MARKUP_TOOLS: MarkupTool[] = ['cloud', 'arrow', 'rectangle', 'text', 'dimension', 'mask'];
export const MARKUP_ICONS: Record<MarkupTool, IconName> = {
  cloud: 'cloud',
  arrow: 'arrow',
  rectangle: 'rectangle',
  text: 'text',
  dimension: 'dimension',
  mask: 'mask',
};
