import { useAppStore } from '../store/appStore';
import type { ToolMode } from '../types';
import { isPageCalibrated } from '../lib/quantities';
import Icon, { type IconName } from './Icon';
import { useT } from '../i18n';

/** A rail tool: its name (`toolbar.<key>`) and tooltip (`toolbar.<key>Hint`) come from the dictionary. */
interface RailTool {
  mode: ToolMode;
  key: 'select' | 'pan' | 'draw' | 'drawRect';
  icon: IconName;
}

/** Canvas tools, in workflow order. Separators mark the three groups: view · scale · draw. */
const NAVIGATE_TOOLS: RailTool[] = [
  { mode: 'select', key: 'select', icon: 'select' },
  { mode: 'pan', key: 'pan', icon: 'pan' },
];

const DRAW_TOOLS: RailTool[] = [
  { mode: 'draw', key: 'draw', icon: 'polygon' },
  { mode: 'draw-rect', key: 'drawRect', icon: 'rectangle' },
];

export default function Toolbar() {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const drawingPoints = useAppStore((s) => s.drawingPoints);
  const finishDrawing = useAppStore((s) => s.finishDrawing);
  const clearDrawingPoints = useAppStore((s) => s.clearDrawingPoints);

  const calibrated = !!project && isPageCalibrated(project, currentPage);

  // The rail is icon-only: the name of the tool is its tooltip and its accessible name, which is
  // what lets the rail come down to 56px without losing anything.
  const toolButton = (tool: RailTool) => (
    <button
      key={tool.mode}
      className={`tool-btn ${toolMode === tool.mode ? 'active' : ''}`}
      title={t(`toolbar.${tool.key}Hint`)}
      aria-label={t(`toolbar.${tool.key}`)}
      aria-pressed={toolMode === tool.mode}
      onClick={() => setToolMode(tool.mode)}
    >
      <Icon name={tool.icon} size={20} />
    </button>
  );

  return (
    <div className="toolbar">
      {NAVIGATE_TOOLS.map(toolButton)}
      {toolMode === 'select' && <span className="draw-hint">{t('planSelection.hint')}</span>}

      <span className="toolbar-sep" />

      {/* Calibration is a canvas tool and lives with the others. "Needs a scale" is a dot, not a
          background: the tool can be active AND flagged at the same time, which the old
          background override made impossible. */}
      <button
        className={`tool-btn ${toolMode === 'calibrate' ? 'active' : ''}`}
        title={calibrated ? t('toolbar.calibrateHint') : t('toolbar.calibrateHintMissing')}
        aria-label={t('toolbar.calibrate')}
        aria-pressed={toolMode === 'calibrate'}
        onClick={() => setToolMode(toolMode === 'calibrate' ? 'select' : 'calibrate')}
      >
        <Icon name="ruler" size={20} />
        {!calibrated && <span className="tool-attention-dot" />}
      </button>

      <span className="toolbar-sep" />

      {DRAW_TOOLS.map(toolButton)}

      {toolMode === 'calibrate' && <div className="draw-hint">{t('toolbar.calibrateInstruction')}</div>}

      {toolMode === 'draw' && drawingPoints.length > 0 && (
        <div className="draw-hint">
          {drawingPoints.length >= 3
            ? t('toolbar.drawProgressClose', { count: drawingPoints.length })
            : t('toolbar.drawProgressAdd', { count: drawingPoints.length })}
          <button className="btn-ghost small" onClick={() => clearDrawingPoints()}>
            {t('toolbar.clear')}
          </button>
          {drawingPoints.length >= 3 && (
            <button className="btn-primary small" onClick={() => finishDrawing()}>
              {t('toolbar.closeArea')}
            </button>
          )}
        </div>
      )}

      {toolMode === 'draw-rect' && (
        <div className="draw-hint">
          {drawingPoints.length === 0 ? t('toolbar.rectFirstCorner') : t('toolbar.rectOppositeCorner')}
          {drawingPoints.length > 0 && (
            <button className="btn-ghost small" onClick={() => clearDrawingPoints()}>
              {t('toolbar.clear')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
