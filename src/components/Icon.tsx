/**
 * The single icon language of the quantity-takeoff workspace.
 *
 * Every glyph is a stroked path on a 24×24 grid, drawn in `currentColor` at one stroke weight, so an
 * icon takes the colour and the state of whatever button holds it. This replaces the mixed emoji the
 * workspace used to show: the OS rendered some of them in full colour and others as thin monochrome
 * glyphs, on different baselines, which is what made the tool rail look assembled rather than drawn.
 *
 * Adding one is a one-line entry here — no icon dependency, no sprite build step.
 */

export type IconName =
  | 'select'
  | 'pan'
  | 'ruler'
  | 'polygon'
  | 'rectangle'
  | 'undo'
  | 'redo'
  | 'chevron-previous'
  | 'chevron-next'
  | 'chevron-down'
  | 'chevron-up'
  | 'eye'
  | 'eye-off'
  | 'download'
  | 'table'
  | 'sheet'
  | 'file'
  | 'crop'
  | 'map'
  | 'layers'
  | 'settings'
  | 'globe'
  | 'copy'
  | 'edit'
  | 'trash'
  | 'plus'
  | 'check'
  | 'alert'
  | 'close'
  | 'exit'
  | 'back'
  | 'scan'
  | 'square'
  | 'circle'
  | 'wall'
  | 'cloud'
  | 'arrow'
  | 'text'
  | 'dimension'
  | 'mask'
  | 'reset'
  | 'flip'
  | 'rotate'
  | 'expand'
  | 'collapse'
  | 'home'
  | 'folder'
  | 'swipe'
  | 'blink'
  | 'target'
  | 'move'
  | 'link';

/** Path data only — every icon shares the same stroke setup below. */
const PATHS: Record<IconName, string> = {
  edit: 'M15 4l5 5M4 20l5-1L20 8a2 2 0 00-5-5L4 14z',
  select: 'M5 3l6.5 16 2.2-6.3L20 10.5z',
  pan: 'M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V12m0-1a1.5 1.5 0 013 0v4a5 5 0 01-5 5h-2a5 5 0 01-4.2-2.3L6 14.5a1.6 1.6 0 012.6-1.8L9 13.5V5.5',
  ruler: 'M3.5 14.5l11-11 5 5-11 11zM7 11l2 2M10 8l2 2M13 5l2 2',
  polygon: 'M12 3.5l8 6-3 9.5H7l-3-9.5z',
  rectangle: 'M4 6h16v12H4z',
  undo: 'M9 14l-4-4 4-4M5 10h9a5 5 0 010 10h-4',
  redo: 'M15 14l4-4-4-4M19 10h-9a5 5 0 000 10h4',
  // Reading-direction chevrons, drawn for RTL (previous points right, next points left); `.icon-directional`
  // mirrors them under LTR. The other icons depict things (an arrow tool, a download tray), not a direction.
  'chevron-previous': 'M9 5l7 7-7 7',
  'chevron-next': 'M15 5l-7 7 7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  'chevron-up': 'M5 15l7-7 7 7',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z',
  'eye-off': 'M4 4l16 16M10 6a8.7 8.7 0 012-.2c6 0 9.5 6.2 9.5 6.2a15 15 0 01-3 3.7M6.6 7.8A15 15 0 002.5 12S6 18.2 12 18.2a9 9 0 003.3-.6M9.8 9.9a3 3 0 004.2 4.2',
  download: 'M12 3.5v11m0 0l-4-4m4 4l4-4M4 17v2.5h16V17',
  table: 'M3.5 5.5h17v13h-17zM3.5 10h17M9.5 10v8.5M15 10v8.5',
  sheet: 'M5.5 3.5h9l5 5v12h-14zM14 3.5v5h5M8.5 12.5h7M8.5 16h7M12 12.5V16',
  file: 'M5.5 3.5h9l5 5v12h-14zM14 3.5v5h5M8.5 13h7M8.5 16.5h4',
  crop: 'M6.5 2.5v15h15M2.5 6.5h15v15',
  map: 'M2.5 6.5l6-3 7 3 6-3v14l-6 3-7-3-6 3zM8.5 3.5v14M15.5 6.5v14',
  /* Compare: the three view modes, the reference-point pick and the align drag. */
  swipe: 'M3.5 4.5h17v15h-17zM12 4.5v15M15.5 9.5l2.5 2.5-2.5 2.5M8.5 9.5L6 12l2.5 2.5',
  blink: 'M13.5 2.5L5 13.5h6l-1.5 8 8.5-11h-6z',
  target: 'M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M12 8.2a3.8 3.8 0 100 7.6 3.8 3.8 0 000-7.6z',
  move: 'M12 3.5v17M3.5 12h17M12 3.5L9.5 6M12 3.5L14.5 6M12 20.5L9.5 18M12 20.5l2.5-2.5M3.5 12L6 9.5M3.5 12L6 14.5M20.5 12L18 9.5M20.5 12L18 14.5',
  link: 'M10 13.5a3.5 3.5 0 005 0l3-3a3.54 3.54 0 00-5-5l-1 1M14 10.5a3.5 3.5 0 00-5 0l-3 3a3.54 3.54 0 005 5l1-1',
  layers: 'M12 2.8l9 4.7-9 4.7-9-4.7zM3 12.5l9 4.7 9-4.7M3 17l9 4.7 9-4.7',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M8 14.5v5',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3a18 18 0 010 18 18 18 0 010-18z',
  copy: 'M8.5 8.5h11v11h-11zM5.5 15.5h-1v-11h11v1',
  trash: 'M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13h9l1-13M10 10v6M14 10v6',
  plus: 'M12 5v14M5 12h14',
  check: 'M4.5 12.5l5 5 10-11',
  alert: 'M12 3.5L1.8 20.5h20.4zM12 10v4.5M12 17.2v.2',
  close: 'M5.5 5.5l13 13M18.5 5.5l-13 13',
  exit: 'M13.5 4.5H5.5v15h8M9.5 12h11m0 0l-4-4m4 4l-4 4',
  back: 'M10.5 4.5h8v15h-8M14.5 12h-11m0 0l4-4m-4 4l4 4',
  scan: 'M3.5 8V4.5H7M17 4.5h3.5V8M20.5 16v3.5H17M7 19.5H3.5V16M7.5 12h9',
  square: 'M4 4h16v16H4z',
  circle: 'M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17z',
  wall: 'M3.5 4.5h17v15h-17zM3.5 9.5h17M3.5 14.5h17M9 4.5v5M15 9.5v5M9 14.5v5',
  cloud: 'M6.5 18a4 4 0 01-.5-8 5.5 5.5 0 0110.4-1.6A3.8 3.8 0 0117.5 18z',
  arrow: 'M4.5 19.5l15-15M19.5 4.5h-8M19.5 4.5v8',
  text: 'M4.5 5.5h15M12 5.5v14M8.5 19.5h7',
  dimension: 'M3.5 7v10M20.5 7v10M3.5 12h17M6.5 9.5L4 12l2.5 2.5M17.5 9.5L20 12l-2.5 2.5',
  mask: 'M4 4h16v16H4zM4 4l16 16',
  reset: 'M4.5 10.5A8 8 0 1112 20M4.5 4.5v6h6',
  flip: 'M12 3v18M6 7.5L3 12l3 4.5M18 7.5l3 4.5-3 4.5',
  rotate: 'M19.5 10.5A8 8 0 1012 20M19.5 4.5v6h-6',
  expand: 'M9 3.5H3.5V9M15 20.5h5.5V15M3.5 3.5l6 6M20.5 20.5l-6-6',
  collapse: 'M3.5 9H9V3.5M20.5 15H15v5.5M9 9L3.5 3.5M15 15l5.5 5.5',
  home: 'M3.5 10.5L12 3.5l8.5 7M6 9.5v10h12v-10',
  folder: 'M3.5 6.5h6l2 2.5h9v11h-17z',
};

/**
 * `size` is the rendered box in px. The workspace uses 20 on the tool rail, 16 everywhere else.
 * `title` adds a native tooltip and an accessible name; without one the icon is decorative and is
 * hidden from assistive tech, because the button's own text already names the action.
 */
const DIRECTIONAL: ReadonlySet<IconName> = new Set<IconName>(['chevron-previous', 'chevron-next']);
// Drawn pointing left (back in LTR); mirrored when the page reads RTL.
const DIRECTIONAL_LTR: ReadonlySet<IconName> = new Set<IconName>(['back']);

export default function Icon({
  name,
  size = 16,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={`icon ${DIRECTIONAL.has(name) ? 'icon-directional ' : ''}${DIRECTIONAL_LTR.has(name) ? 'icon-directional-ltr ' : ''}${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
