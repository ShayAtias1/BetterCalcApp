import { useFieldWorkflowStore } from '../store/fieldWorkflowStore';
import { useState } from 'react';
import { useT } from '../i18n';
import { useAppStore } from '../store/appStore';

export default function CalibrationDialog() {
  const calibrationPoints = useAppStore((s) => s.calibrationPoints);
  const applyCalibration = useAppStore((s) => s.applyCalibration);
  const clearCalibrationPoints = useAppStore((s) => s.clearCalibrationPoints);
  const [value, setValue] = useState('');
  const t = useT();
  const draft = useFieldWorkflowStore((s) => s.draft);
  const open = useFieldWorkflowStore((s) => s.calibrationDialog);

  if (calibrationPoints.length !== 2 || (draft && !open)) return null;

  const submit = () => {
    const meters = parseFloat(value.replace(',', '.'));
    if (!meters || meters <= 0) return;
    applyCalibration(meters);
    useFieldWorkflowStore.getState().setDraft(false);
    useFieldWorkflowStore.getState().setCalibrationDialog(false);
    setValue('');
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.stopPropagation()}>
      <div className="modal calibration-modal">
        <h3>{t('calibration.title')}</h3>
        <p>{t('calibration.instructions')}</p>
        <div className="form-row">
          <label>{t('calibration.distanceLabel')}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('calibration.distancePlaceholder')}
          />
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => {
            if (draft) useFieldWorkflowStore.getState().setCalibrationDialog(false);
            else clearCalibrationPoints();
          }}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary" onClick={submit} disabled={!value}>
            {t('calibration.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
