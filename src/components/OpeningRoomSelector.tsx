import { useRef, useState } from 'react';
import { useT } from '../i18n';
import type { Room } from '../types';
import type { OpeningRoomSide } from '../types/openings';

/** A compact searchable picker that keeps native disclosure and keyboard focus behavior. */
export default function OpeningRoomSelector({ label, value, otherRoomId, rooms, onChange }: {
  label: string;
  value: OpeningRoomSide;
  otherRoomId?: string;
  rooms: Room[];
  onChange: (side: OpeningRoomSide) => Promise<boolean>;
}) {
  const t = useT();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const roomLabel = (room: Room) => `${room.name || t('rooms.unnamed')}${room.apartmentNumber ? ` · ${t('rooms.apartment', { apartment: room.apartmentNumber })}` : ''}`;
  const selectedRoomId = value && typeof value === 'object' ? value.roomId : undefined;
  const selectedRoom = rooms.find(room => room.id === selectedRoomId);
  const selectedLabel = value === 'exterior' ? t('openingTools.exterior') : selectedRoom ? roomLabel(selectedRoom) : selectedRoomId || t('openingTools.unassignedSide');
  const matches = rooms.filter(room => roomLabel(room).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = async (side: OpeningRoomSide) => {
    setPending(true);
    try {
      if (await onChange(side)) {
        setQuery('');
        if (disclosure.current) {
          disclosure.current.open = false;
          disclosure.current.querySelector('summary')?.focus();
        }
      }
    } finally { setPending(false); }
  };
  return <div className="opening-side-selector" role="group" aria-label={label}>
    <span className="opening-field-label">{label}</span>
    <details ref={disclosure}>
      <summary><span dir="auto">{selectedLabel}</span><span className="opening-select-caret" aria-hidden="true">▾</span></summary>
      <div className="opening-room-options">
        <input type="search" value={query} placeholder={t('openingTools.searchRooms')} aria-label={`${label}: ${t('openingTools.searchRooms')}`}
          disabled={pending} onChange={event => setQuery(event.target.value)} />
        <div className="opening-room-results">
          <button type="button" className={`menu-item ${value === null ? 'active' : ''}`} disabled={pending}
            aria-pressed={value === null} onClick={() => void choose(null)}>{t('openingTools.unassignedSide')}</button>
          <button type="button" className={`menu-item ${value === 'exterior' ? 'active' : ''}`} disabled={pending}
            aria-pressed={value === 'exterior'} onClick={() => void choose('exterior')}>{t('openingTools.exterior')}</button>
          {matches.map(room => <button key={room.id} type="button" className={`menu-item ${selectedRoomId === room.id ? 'active' : ''}`}
            aria-pressed={selectedRoomId === room.id} disabled={pending || room.id === otherRoomId}
            onClick={() => void choose({ roomId: room.id })}><span dir="auto">{roomLabel(room)}</span></button>)}
          {!matches.length && <p className="opening-help">{t('openingTools.noMatchingRooms')}</p>}
        </div>
      </div>
    </details>
  </div>;
}
