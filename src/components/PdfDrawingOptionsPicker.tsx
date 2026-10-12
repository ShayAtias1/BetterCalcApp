import { useT } from '../i18n';
import { PDF_DRAWING_LAYERS, type PdfDrawingOptions } from '../lib/pdfDrawingLayers';

export default function PdfDrawingOptionsPicker({ value, onChange }: { value: PdfDrawingOptions; onChange: (value: PdfDrawingOptions) => void }) {
  const t = useT();
  return <fieldset>
    <legend>{t('quantityExport.drawingMode')}</legend>
    <select aria-label={t('quantityExport.drawingMode')} value={value.drawingMode ?? 'combined'}
      onChange={e => onChange({ ...value, drawingMode: e.target.value as 'combined' | 'separate' })}>
      <option value="combined">{t('quantityExport.drawingCombined')}</option>
      <option value="separate">{t('quantityExport.drawingSeparate')}</option>
    </select>
    {value.drawingMode === 'separate' && PDF_DRAWING_LAYERS.map(layer => {
      const selected = value.drawingLayers ?? PDF_DRAWING_LAYERS;
      return <label key={layer} className="opening-review-check">
        <input type="checkbox" checked={selected.includes(layer)} onChange={e => onChange({ ...value,
          drawingLayers: e.target.checked ? [...selected, layer] : selected.filter(l => l !== layer),
        })} />{t(`quantityExport.drawingLayers.${layer}`)}
      </label>;
    })}
  </fieldset>;
}
