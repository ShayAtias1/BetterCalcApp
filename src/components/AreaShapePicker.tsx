import type { AreaShape } from '../types';
import Icon, { type IconName } from './Icon';
import { useT } from '../i18n';

const SHAPES: { shape: AreaShape; icon: IconName }[] = [
  { shape: 'polygon', icon: 'polygon' },
  { shape: 'rectangle', icon: 'rectangle' },
  { shape: 'line', icon: 'ruler' },
];

/** Shared Takeoff and Compare drawing choices; the caller owns the document and classification. */
export default function AreaShapePicker({ value, onChange, shapes, compact = false }: { value: AreaShape; onChange: (shape: AreaShape) => void; shapes?: AreaShape[]; compact?: boolean }) {
  const t = useT();
  return <div className="tool-group">
    {!compact && <span className="section-label">{t('measure.shape')}</span>}
    <div className="segmented">
      {SHAPES.filter(({ shape }) => !shapes || shapes.includes(shape)).map(({ shape, icon }) => <button key={shape}
        className={value === shape ? 'tool-btn active' : 'tool-btn'}
        aria-pressed={value === shape} onClick={() => onChange(shape)}>
        <Icon name={icon} />
        <span className="tool-label">{t(`measure.shapes.${shape}`)}</span>
      </button>)}
    </div>
  </div>;
}
