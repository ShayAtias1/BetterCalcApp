import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useAppStore } from '../store/appStore';
import type { Room } from '../types';
import { apartmentNumbersInProject } from '../lib/apartmentDuplication';
import { polygonAreaPx } from '../lib/geometry';
import Icon from './Icon';

/** A room can become a concrete zone only if it has a real outline. */
const NO_ROOMS: Room[] = [];
const hasOutline = (r: Room) => Array.isArray(r.points) && r.points.length >= 3 && polygonAreaPx(r.points) > 0;

/**
 * "Use existing area": copies the outline of a room — or of every room of an apartment — into new
 * structural zones (concrete or rebar, per the `copy` action), so nothing already marked has to be
 * redrawn. An apartment has no outline of its own in BetterCalc (it is just the number rooms carry),
 * so it stands for its rooms and one zone is made per room. The rooms and all their finishes data
 * stay as they are.
 */
export default function ExistingAreaPicker({
  copy,
  willCreate,
  addLabel,
  doneLabel,
}: {
  /** Creates the zones from these room ids and returns how many were made. */
  copy: (roomIds: string[]) => number;
  /** "N zones will be created …", shown before confirming. */
  willCreate: (count: number) => string;
  addLabel: string;
  /** "N zones were created", shown after. */
  doneLabel: (count: number) => string;
}) {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [done, setDone] = useState<number | null>(null);

  const rooms = project?.rooms ?? NO_ROOMS;
  const apartments = useMemo(() => (project ? apartmentNumbersInProject(project) : []), [project]);

  // Which rooms the current choice stands for.
  const chosen = useMemo(() => {
    if (source.startsWith('room:')) return rooms.filter((r) => r.id === source.slice(5));
    if (source.startsWith('apt:')) return rooms.filter((r) => r.apartmentNumber === source.slice(4));
    return [];
  }, [source, rooms]);
  const usable = chosen.filter(hasOutline);

  if (!project || rooms.length === 0) return null;

  if (!open) {
    return (
      <button className="btn-secondary structural-entry-action concrete-from-rooms-toggle" onClick={() => { setOpen(true); setDone(null); }}>
        <Icon name="copy" size={13} />
        {t('concrete.copy.open')}
      </button>
    );
  }

  const run = () => {
    const created = copy(usable.map((r) => r.id));
    setDone(created);
    if (created > 0) setSource('');
  };

  return (
    <div className="concrete-from-rooms">
      <div className="form-row">
        <label>{t('concrete.copy.source')}</label>
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setDone(null);
          }}
        >
          <option value="">{t('concrete.copy.choose')}</option>
          <optgroup label={t('concrete.copy.rooms')}>
            {rooms.map((r) => (
              <option key={r.id} value={`room:${r.id}`}>
                {(r.name || t('rooms.unnamed')) + ' · ' + t('concrete.page', { page: r.pageNumber })}
              </option>
            ))}
          </optgroup>
          {apartments.length > 0 && (
            <optgroup label={t('concrete.copy.apartments')}>
              {apartments.map((a) => (
                <option key={a} value={`apt:${a}`}>
                  {t('concrete.copy.apartmentOption', { apartment: a, count: rooms.filter((r) => r.apartmentNumber === a).length })}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      {source !== '' && (
        <p className="muted">
          {usable.length > 0
            ? willCreate(usable.length)
            : t('concrete.copy.nothing')}
        </p>
      )}
      <div className="concrete-from-rooms-actions">
        <button className="btn-primary small" disabled={usable.length === 0} onClick={run}>
          {addLabel}
        </button>
        <button className="btn-ghost small" onClick={() => setOpen(false)}>
          {t('concrete.copy.close')}
        </button>
      </div>
      <p className="muted">{t('concrete.copy.note')}</p>
      {done !== null && done > 0 && <p className="muted concrete-copy-done">{doneLabel(done)}</p>}
    </div>
  );
}
