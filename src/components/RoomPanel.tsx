import OpeningsPanel from './OpeningsPanel';
import { useBulkTakeoffDialog } from './bulkTakeoffEntry';
import { promptDialog, confirmDialog } from '../lib/appDialogs';
import AiSpaceDetectionPanel from './AiSpaceDetectionPanel';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import ReviewFields from './ReviewFields';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../i18n';
import { useAppStore } from '../store/appStore';
import type { Opening, OpeningType, Plan, TilingCategory, WorkType } from '../types';
import {
} from '../types';
import {
  calculateWorkItem,
  effectiveHeightM,
  effectiveWastePercent,
  isPageCalibrated,
  itemDeductsOpenings,
  openingAreaM2,
  roomMetrics,
} from '../lib/quantities';
import { WORK_TYPE_ORDER, workTypeDefinition } from '../lib/workTypes';
import { ROOM_PROFILES, roomProfileLabel, roomProfileName } from '../lib/roomProfiles';
import {
  apartmentDuplicationWarnings,
  apartmentNumbersInProject,
  groupRoomsByApartment,
} from '../lib/apartmentDuplication';
import { round } from '../lib/geometry';
import AutoDetectPanel, { DetectionReviewPanel } from './AutoDetectPanel';
import Icon from './Icon';
import { InspectorCloseButton, InspectorEmpty, type PanelPart } from './PanelPart';

const OPENING_TYPES: OpeningType[] = ['door', 'window', 'custom'];

/**
 * Auto room detection is experimental and hidden from users for now. This flag gates only its entry
 * points in the room list (launcher button, launcher panel, review panel); the detection pipeline,
 * store actions and any rooms already saved from it are untouched. Flip to true to bring it back.
 */
const SHOW_AUTO_DETECT = false;
// Workspace visibility only; survives panel remounts without entering project persistence.
const apartmentListExpansionForSession = new Map<string, boolean>();

export default function RoomPanel({ readOnly = false, part, section: shownSection }: {
  readOnly?: boolean;
  /** Desktop split: which half to render. The workspace then owns the rooms / openings choice. */
  part?: PanelPart;
  section?: 'rooms' | 'openings';
}) {
  if (part) {
    if (shownSection === 'openings') return part === 'list'
      ? <><OpeningsPanel readOnly={readOnly} hideAiEditor={!readOnly} part="list" /><LegacyRoomOpenings readOnly={readOnly} /></>
      : <OpeningsPanel readOnly={readOnly} hideAiEditor={!readOnly} part="detail" />;
    return <RoomsAndAreasPanel readOnly={readOnly} part={part} />;
  }
  return <RoomSectionsPanel readOnly={readOnly} />;
}

/** Tablet and phone: rooms and openings as two sections of one panel. */
function RoomSectionsPanel({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const id = useId();
  const selectedOpeningId = useAppStore(s => s.selectedOpeningId);
  const selectedRoomId = useAppStore(s => s.selectedRoomId);
  const placement = useAppStore(s => s.openingPlacement);
  const planId = useAppStore(s => s.project?.id);
  const [section, setSection] = useState<'rooms' | 'openings'>(selectedOpeningId ? 'openings' : 'rooms');
  useEffect(() => { setSection('rooms'); }, [planId]);
  useEffect(() => { if (selectedOpeningId || placement) setSection('openings'); }, [selectedOpeningId, placement]);
  useEffect(() => { if (selectedRoomId) setSection('rooms'); }, [selectedRoomId]);
  const chooseSection = (next: 'rooms' | 'openings') => {
    if (next === section) return;
    const state = useAppStore.getState();
    state.cancelOpeningPlacement();
    state.setToolMode('select');
    if (next === 'rooms') state.selectPlanOpening(null);
    setSection(next);
  };
  return <div className="rooms-finishes-workspace">
    <div className="rooms-finishes-tabs segmented" role="tablist" aria-label={t('workspace.tabs.rooms')}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'rooms' : event.key === 'End' ? 'openings' : section === 'rooms' ? 'openings' : 'rooms';
        chooseSection(next);
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)?.focus();
      }}>
      {(['rooms', 'openings'] as const).map(tab => <button key={tab} type="button" role="tab" data-section={tab}
        id={`${id}-${tab}-tab`} aria-controls={`${id}-${tab}-panel`} aria-selected={section === tab}
        tabIndex={section === tab ? 0 : -1} className={`btn-ghost small ${section === tab ? 'active' : ''}`}
        onClick={() => chooseSection(tab)}>{t(tab === 'rooms' ? 'openingTools.roomsAndAreas' : 'openingTools.title')}</button>)}
    </div>
    <div id={`${id}-rooms-panel`} role="tabpanel" aria-labelledby={`${id}-rooms-tab`} hidden={section !== 'rooms'}>
      <RoomsAndAreasPanel readOnly={readOnly} />
    </div>
    <div id={`${id}-openings-panel`} role="tabpanel" aria-labelledby={`${id}-openings-tab`} hidden={section !== 'openings'}>
      <OpeningsPanel readOnly={readOnly} hideAiEditor={!readOnly} />
      <LegacyRoomOpenings readOnly={readOnly} />
    </div>
  </div>;
}

function LegacyRoomOpenings({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const id = useId();
  const plan = useAppStore(s => s.project);
  const page = useAppStore(s => s.currentPage);
  const selectedRoomId = useAppStore(s => s.selectedRoomId);
  const update = useAppStore(s => s.updateOpening);
  const remove = useAppStore(s => s.removeOpening);
  const activeApartmentNumber = useAppStore(s => s.activeApartmentNumber);
  const [roomId, setRoomId] = useState<string | null>(selectedRoomId);
  const [chosenApartment, setChosenApartment] = useState<string | null>(null);
  useEffect(() => {
    if (selectedRoomId) {
      setRoomId(selectedRoomId);
      const selected = useAppStore.getState().project?.rooms.find(room => room.id === selectedRoomId);
      if (selected) setChosenApartment(selected.apartmentNumber);
    }
  }, [selectedRoomId, plan?.id]);
  const rooms = plan?.rooms.filter(room => room.pageNumber === page && (room.openings?.length ?? 0) > 0) ?? [];
  const apartments = [...new Set(rooms.map(room => room.apartmentNumber))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const preferredApartment = chosenApartment ?? activeApartmentNumber;
  const apartment = apartments.includes(preferredApartment) ? preferredApartment : apartments[0] ?? '';
  const apartmentRooms = rooms.filter(room => room.apartmentNumber === apartment);
  const room = apartmentRooms.find(item => item.id === roomId) ?? apartmentRooms[0];
  if (!room) return null;
  return <details className="legacy-room-openings opening-advanced">
    <summary>{t('openingTools.roomQuantityRows')}</summary>
    <div className="form-row">
      <label htmlFor={`${id}-legacy-apartment`}>{t('rooms.detail.apartment')}</label>
      <select id={`${id}-legacy-apartment`} value={apartment} onChange={event => {
        setChosenApartment(event.target.value);
        setRoomId(null);
      }}>
        {apartments.map(number => <option key={number} value={number}>{number ? t('rooms.apartment', { apartment: number }) : t('rooms.unassigned')}</option>)}
      </select>
    </div>
    <div className="form-row">
      <label htmlFor={`${id}-legacy-room`}>{t('openingTools.quantityRoom')}</label>
      <select id={`${id}-legacy-room`} value={room.id} onChange={event => setRoomId(event.target.value)}>
        {apartmentRooms.map(item => <option key={item.id} value={item.id}>{item.name || t('rooms.unnamed')}</option>)}
      </select>
    </div>
    <ReviewFields readOnly={readOnly}><OpeningsEditor openings={room.openings ?? []}
      onUpdate={(openingId, patch) => update(room.id, openingId, patch)}
      onRemove={openingId => remove(room.id, openingId)} /></ReviewFields>
  </details>;
}

function RoomsAndAreasPanel({ readOnly = false, part }: { readOnly?: boolean; part?: PanelPart }) {
  const { touchInput } = useWorkspaceLayout();
  const t = useT();
  const roomListId = useId();
  const [apartmentListExpansion, setApartmentListExpansion] = useState(() => new Map(apartmentListExpansionForSession));
  const openBulk = useBulkTakeoffDialog(s => s.openFor);
  const project = useAppStore((s) => s.project);
  const selectedRoomId = useAppStore((s) => s.selectedRoomId);
  const setSelectedRoomId = useAppStore((s) => s.setSelectedRoomId);
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const updateRoom = useAppStore((s) => s.updateRoom);
  const assignRoomsToApartment = useAppStore((s) => s.assignRoomsToApartment);
  const setRoomType = useAppStore((s) => s.setRoomType);
  const applyRoomTemplate = useAppStore((s) => s.applyRoomTemplate);
  const newRoomTemplate = useAppStore((s) => s.newRoomTemplate);
  const setNewRoomTemplate = useAppStore((s) => s.setNewRoomTemplate);
  const duplicateRoom = useAppStore((s) => s.duplicateRoom);
  const deleteRoom = useAppStore((s) => s.deleteRoom);
  const deleteRooms = useAppStore((s) => s.deleteRooms);
  const deletionRoomIds = useAppStore(s => s.selectedRoomIds);
  const setDeletionRoomIds = (ids: string[]) => useAppStore.getState().setPlanSelection(ids, []);
  const selectionPlanId = useRef(project?.id);
  useEffect(() => {
    if (selectionPlanId.current !== project?.id || readOnly) useAppStore.getState().setPlanSelection([], []);
    selectionPlanId.current = project?.id;
  }, [project?.id, readOnly]);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const updateWorkItem = useAppStore((s) => s.updateWorkItem);
  const removeWorkItem = useAppStore((s) => s.removeWorkItem);
  const activeApartmentNumber = useAppStore((s) => s.activeApartmentNumber);
  const setActiveApartmentNumber = useAppStore((s) => s.setActiveApartmentNumber);
  const [apartmentDialogSource, setApartmentDialogSource] = useState<string | null>(null);
  const [showDetection, setShowDetection] = useState(false);
  const [assigningApartment, setAssigningApartment] = useState(false);
  const [assignmentRoomIds, setAssignmentRoomIds] = useState<string[]>([]);
  const [assignmentTarget, setAssignmentTarget] = useState('');
  const [selectionTarget, setSelectionTarget] = useState('');
  useEffect(() => {
    setAssigningApartment(false);
    setAssignmentRoomIds([]);
    setAssignmentTarget('');
    setSelectionTarget('');
  }, [project?.id, readOnly]);
  // List ⇄ detail is pure navigation: it lives here, never in the project or in the store's
  // selection. Going back to the list keeps `selectedRoomId`, so the room stays highlighted on the
  // plan and one click reopens it.
  const [detailOpen, setDetailOpen] = useState(false);

  // Finishing a hand-drawn room goes straight into its details, so naming and classifying it is the
  // next thing on screen instead of a second click in the list. Only the id changing opens the view:
  // going back to the list leaves it as it is, so the same room never reopens by itself.
  const manuallyCreatedRoomId = useAppStore((s) => s.manuallyCreatedRoomId);
  const lastOpened = useRef<string | null>(manuallyCreatedRoomId);
  useEffect(() => {
    if (manuallyCreatedRoomId && manuallyCreatedRoomId !== lastOpened.current) setDetailOpen(true);
    lastOpened.current = manuallyCreatedRoomId;
  }, [manuallyCreatedRoomId]);

  useEffect(() => { if ((readOnly || touchInput) && selectedRoomId) setDetailOpen(true); }, [readOnly, touchInput, selectedRoomId]);

  if (!project) return null;
  const apartmentNumbers = apartmentNumbersInProject(project);
  const groups = groupRoomsByApartment(project);
  const room = project.rooms.find((r) => r.id === selectedRoomId) ?? null;
  const selectedAssignmentIds = project.rooms.filter((r) => assignmentRoomIds.includes(r.id)).map((r) => r.id);
  const selectedDeletionIds = project.rooms.filter(r => deletionRoomIds.includes(r.id)).map(r => r.id);
  const toggleDeletionRoom = (id: string) => { setToolMode('select'); useAppStore.getState().setOverlayVisible('finishes', true); setDeletionRoomIds(deletionRoomIds.includes(id) ? deletionRoomIds.filter(selected => selected !== id) : [...deletionRoomIds, id]); };
  const toggleAssignmentRoom = (id: string) => {
    setAssignmentRoomIds((ids) => ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id]);
  };
  // The detail view is derived, not remembered: a room that was deleted, undone away or that lives
  // on another page (after a page change) can never leave the sidebar showing stale details.
  const detailRoom = detailOpen && room && room.pageNumber === currentPage ? room : null;

  // Areas shown in the list: only on calibrated pages, the same numbers as the room editor.
  const roomArea = (r: (typeof project.rooms)[number]) => isPageCalibrated(project, r.pageNumber) ? roomMetrics(r, project.pages[r.pageNumber]?.calibration ?? null).areaM2 : null;
  const groupArea = (rooms: typeof project.rooms) => {
    const areas = rooms.map(roomArea).filter((a): a is number => a !== null);
    return areas.length ? areas.reduce((sum, a) => sum + a, 0) : null;
  };

  const selectRoom = (id: string, page: number) => {
    setCurrentPage(page);
    setSelectedRoomId(id);
    setDetailOpen(true);
  };

  const split = part !== undefined;
  const renderDetail = (detailRoom: NonNullable<typeof room>) => (
      <div className="room-panel">
        {!split && <div className="detail-nav">
          <button className="btn-ghost small" onClick={() => setDetailOpen(false)}>
            <Icon name="back" />
            {t('rooms.backToRooms')}
          </button>
        </div>}
        {/* What is selected, and the actions on it. The name itself is the first field below. */}
        <div className="detail-header detail-header-kicker">
          <span className="color-dot" style={{ background: detailRoom.color }} />
          <span className="detail-kicker">{t('rooms.detail.kicker', { page: detailRoom.pageNumber })}</span>
          {!readOnly && <><button className="icon-btn" title={t('rooms.duplicate')} onClick={() => duplicateRoom(detailRoom.id)}>
            <Icon name="copy" />
          </button>
          <button
            className="icon-btn danger"
            title={t('rooms.delete')}
            onClick={async () => {
              if (!await confirmDialog(t('rooms.deleteConfirm', { name: detailRoom.name }), { destructive: true })) return;
              deleteRoom(detailRoom.id);
              setDetailOpen(false);
            }}
          >
            <Icon name="trash" />
          </button>
        </>}
          {split && <InspectorCloseButton onClick={() => setSelectedRoomId(null)} />}
        </div>
        <ReviewFields readOnly={readOnly}><RoomDetail
          key={detailRoom.id}
          room={detailRoom}
          project={project}
          calibration={project.pages[detailRoom.pageNumber]?.calibration ?? null}
          onUpdate={(patch) => updateRoom(detailRoom.id, patch)}
          onRoomTypeChange={(key) => setRoomType(detailRoom.id, key)}
          onApplyTemplate={() => applyRoomTemplate(detailRoom.id)}
          onAddWorkItem={(type) => addWorkItem(detailRoom.id, type)}
          onUpdateWorkItem={(itemId, patch) => updateWorkItem(detailRoom.id, itemId, patch)}
          onRemoveWorkItem={(itemId) => removeWorkItem(detailRoom.id, itemId)}
        /></ReviewFields>
      </div>
  );
  // Desktop inspector: whatever room is selected on this page, without the list's open/closed state.
  if (part === 'detail') {
    const shown = room && room.pageNumber === currentPage ? room : null;
    return shown ? renderDetail(shown) : <InspectorEmpty text={t('workspace.inspector.empty.room')} />;
  }
  if (!split && detailRoom) return renderDetail(detailRoom);

  /** Creating an apartment is just naming one: it exists as soon as a room carries the number. */
  const createApartment = async () => {
    const next = await promptDialog(t('rooms.newApartmentPrompt'), '');
    if (next && next.trim()) setActiveApartmentNumber(next.trim());
  };

  return (
    <div className="room-panel">
      {/* Suggestions awaiting review take over the top of the tab until they are handled. */}
      {!readOnly && (SHOW_AUTO_DETECT || import.meta.env.DEV) && <DetectionReviewPanel />}

      <div hidden={readOnly}>
      {/* Workspace state, not a form field: this is the apartment being worked in, and the sentence
          that used to repeat the selected value under it is gone — the value itself says it. */}
      {/* One shared label column, so both workspace selects start at the same edge. */}
      <div className="room-workspace-fields">
      <div className="active-apartment-row">
        <label htmlFor="active-apartment">{t('rooms.workingIn')}</label>
        <div className="room-workspace-select">
        <select
          id="active-apartment"
          value={activeApartmentNumber}
          title={t('rooms.workingInHint')}
          onChange={(e) => {
            if (e.target.value === '__new__') createApartment();
            else setActiveApartmentNumber(e.target.value);
          }}
        >
          <option value="">{t('rooms.unassigned')}</option>
          {apartmentNumbers.map((a) => (
            <option key={a} value={a}>
              {t('rooms.apartment', { apartment: a })}
            </option>
          ))}
          {activeApartmentNumber && !apartmentNumbers.includes(activeApartmentNumber) && (
            <option value={activeApartmentNumber}>{t('rooms.apartment', { apartment: activeApartmentNumber })}</option>
          )}
          <option value="__new__">{t('rooms.newApartment')}</option>
        </select>
        <span className="menu-caret" aria-hidden="true">▾</span>
        </div>
      </div>

      {/* The template new rooms start from — work types included. A starting point only: every
          room stays fully editable afterwards. */}
      <div className="active-apartment-row">
        <label htmlFor="new-room-template">{t('rooms.newRoomTemplate')}</label>
        <div className="room-workspace-select">
        <select
          id="new-room-template"
          value={newRoomTemplate ?? ''}
          title={t('rooms.newRoomTemplateHint')}
          onChange={(e) => setNewRoomTemplate(e.target.value || null)}
        >
          <option value="">{t('rooms.noTemplate')}</option>
          {ROOM_PROFILES.map((p) => (
            <option key={p.key} value={p.key}>
              {roomProfileName(p)}
            </option>
          ))}
        </select>
        <span className="menu-caret" aria-hidden="true">▾</span>
        </div>
      </div>
      </div>

      <div className="room-create-row">
        <button
          className={`btn-primary ${toolMode === 'draw' ? 'active' : ''}`}
          onClick={() => setToolMode(toolMode === 'draw' ? 'select' : 'draw')}
          title={t('rooms.drawHint')}
        >
          {t('rooms.draw')}
        </button>
        {/* The two drawing shapes, in the same grey segmented tray as the markup tools. On desktop
            they are on the canvas tool dock, and this row carries the bulk assignment instead. */}
        {split ? !readOnly && <button className="btn-secondary small bulk-takeoff-inline" onClick={() => openBulk(project.id)} title={t('bulkTakeoff.open')}>{t('bulkTakeoff.openShort')}</button> : <div className="segmented room-shape-tools">
          <button
            className={`tool-btn ${toolMode === 'draw' ? 'active' : ''}`}
            onClick={() => setToolMode(toolMode === 'draw' ? 'select' : 'draw')}
            title={t('rooms.drawPolygon')}
            aria-label={t('rooms.drawPolygon')}
          >
            <Icon name="polygon" />
          </button>
          <button
            className={`tool-btn ${toolMode === 'draw-rect' ? 'active' : ''}`}
            onClick={() => setToolMode(toolMode === 'draw-rect' ? 'select' : 'draw-rect')}
            title={t('rooms.drawRect')}
            aria-label={t('rooms.drawRect')}
          >
            <Icon name="rectangle" />
          </button>
        </div>}
        {SHOW_AUTO_DETECT && (
          <button
            className={`btn-secondary small ${showDetection ? 'active' : ''}`}
            onClick={() => setShowDetection((v) => !v)}
            title={t('rooms.autoDetectHint')}
            aria-label={t('rooms.autoDetect')}
          >
            <Icon name="scan" />
          </button>
        )}
      </div>

      {!readOnly && !split && <button className="btn-secondary full-width bulk-takeoff-launch" onClick={() => openBulk(project.id)}>{t('bulkTakeoff.open')}</button>}
      </div>
      <div className="room-list">
        <div className="room-list-head">
          {!readOnly && project.rooms.length > 0 && !assigningApartment && (
            <button className="btn-secondary small" onClick={() => {
              setAssignmentRoomIds([]);
              setAssignmentTarget(activeApartmentNumber);
              setAssigningApartment(true);
            }}>{t('rooms.bulkAssignment.open')}</button>
          )}
        </div>
        {/* Approved design (board 03): the multi-selection bar — select all · count · cancel, then
            assign the selection to an apartment or delete it. Both reuse the existing store actions. */}
        {!readOnly && selectedDeletionIds.length > 0 && !assigningApartment && <div className="selection-bar selection-bar-dark selection-bar-rooms" role="toolbar" aria-label={t('rooms.bulkDelete.selected', { count: selectedDeletionIds.length })}>
          <div className="selection-bar-row">
            <label className="room-assignment-select-all"><input type="checkbox"
              checked={selectedDeletionIds.length === project.rooms.length}
              ref={input => { if (input) input.indeterminate = selectedDeletionIds.length > 0 && selectedDeletionIds.length < project.rooms.length; }}
              onChange={event => setDeletionRoomIds(event.target.checked ? project.rooms.map(room => room.id) : [])}
            />{t('rooms.bulkDelete.selectAll')}</label>
            <span className="selection-bar-count" role="status">{t('rooms.bulkDelete.selected', { count: selectedDeletionIds.length })}</span>
            <button type="button" className="btn-ghost small selection-bar-cancel" onClick={() => setDeletionRoomIds([])}>{t('common.cancel')}</button>
          </div>
          <div className="selection-bar-row">
            <select aria-label={t('rooms.detail.apartment')} value={selectionTarget} onChange={async (e) => {
              const value = e.target.value;
              if (value === '__new__') {
                const next = await promptDialog(t('rooms.newApartmentPrompt'), '');
                if (next?.trim()) setSelectionTarget(next.trim());
              } else setSelectionTarget(value);
            }}>
              <option value="">{t('rooms.bulkAssignment.choose')}</option>
              {apartmentNumbers.map((a) => <option key={a} value={a}>{t('rooms.apartment', { apartment: a })}</option>)}
              {selectionTarget && !apartmentNumbers.includes(selectionTarget) && (
                <option value={selectionTarget}>{t('rooms.apartment', { apartment: selectionTarget })}</option>
              )}
              <option value="__new__">{t('rooms.newApartment')}</option>
            </select>
            <button className="btn-primary small" disabled={!selectionTarget.trim()} onClick={() => {
              assignRoomsToApartment(selectedDeletionIds, selectionTarget);
              setSelectionTarget('');
            }}>{t('rooms.bulkAssignment.assignShort')}</button>
            <button className="selection-bar-delete" onClick={async () => {
              if (!await confirmDialog(t('rooms.bulkDelete.confirm', { count: selectedDeletionIds.length }), { destructive: true })) return;
              // A modal may outlive navigation or an edit. Delete only the plan snapshot confirmed.
              if (useAppStore.getState().project !== project) return;
              deleteRooms(selectedDeletionIds);
              setDeletionRoomIds([]);
            }}>{t('rooms.bulkDelete.deleteShort')}</button>
          </div>
        </div>}
        {!readOnly && assigningApartment && (
          <div className="selection-bar selection-bar-dark selection-bar-rooms" role="toolbar" aria-label={t('rooms.bulkAssignment.open')}>
            <div className="selection-bar-row">
              <label className="room-assignment-select-all">
                <input type="checkbox"
                  checked={project.rooms.length > 0 && selectedAssignmentIds.length === project.rooms.length}
                  ref={input => { if (input) input.indeterminate = selectedAssignmentIds.length > 0 && selectedAssignmentIds.length < project.rooms.length; }}
                  onChange={(e) => setAssignmentRoomIds(e.target.checked ? project.rooms.map((r) => r.id) : [])}
                />
                {t('rooms.bulkDelete.selectAll')}
              </label>
              <span className="selection-bar-count" aria-live="polite">{t('rooms.bulkAssignment.selected', { count: selectedAssignmentIds.length })}</span>
              <button type="button" className="btn-ghost small selection-bar-cancel" onClick={() => {
                setAssignmentRoomIds([]);
                setAssigningApartment(false);
              }}>{t('common.cancel')}</button>
            </div>
            <div className="selection-bar-row">
              <select id="room-assignment-apartment" aria-label={t('rooms.detail.apartment')} value={assignmentTarget} onChange={async (e) => {
                const value = e.target.value;
                if (value === '__new__') {
                  const next = await promptDialog(t('rooms.newApartmentPrompt'), '');
                  if (next?.trim()) setAssignmentTarget(next.trim());
                } else setAssignmentTarget(value);
              }}>
                <option value="">{t('rooms.bulkAssignment.choose')}</option>
                {apartmentNumbers.map((a) => <option key={a} value={a}>{t('rooms.apartment', { apartment: a })}</option>)}
                {assignmentTarget && !apartmentNumbers.includes(assignmentTarget) && (
                  <option value={assignmentTarget}>{t('rooms.apartment', { apartment: assignmentTarget })}</option>
                )}
                <option value="__new__">{t('rooms.newApartment')}</option>
              </select>
              <button className="btn-primary small" disabled={!assignmentTarget.trim() || selectedAssignmentIds.length === 0} onClick={() => {
                assignRoomsToApartment(selectedAssignmentIds, assignmentTarget);
                setAssignmentRoomIds([]);
                setAssigningApartment(false);
              }}>{t('rooms.bulkAssignment.assignShort')}</button>
            </div>
          </div>
        )}
        {project.rooms.length === 0 && (
          <div className="empty-state">
            <Icon name="polygon" size={28} />
            <p>{t('rooms.empty')}</p>
          </div>
        )}

        {groups.map((group) => {
          const isActive = group.apartmentNumber === activeApartmentNumber;
          const isUnassigned = !group.apartmentNumber;
          const expansionKey = JSON.stringify([project.id, group.apartmentNumber]);
          const expanded = apartmentListExpansion.get(expansionKey) ?? true;
          const groupListId = `${roomListId}-${encodeURIComponent(group.apartmentNumber || '__unassigned__')}`;
          return (
            <div key={group.apartmentNumber || '__unassigned__'} className={`apartment-group ${isActive ? 'active' : ''}`}>
              <div className="apartment-group-head">
                {/* The active apartment is marked by the group's EDGE and a stronger header — never
                    by tinting the whole group, which is what used to swallow the selected room. */}
                <button
                  type="button"
                  className="apartment-group-title room-list-collapse-toggle"
                  aria-expanded={expanded}
                  aria-controls={groupListId}
                  onClick={() => {
                    if (!readOnly) setActiveApartmentNumber(group.apartmentNumber);
                    apartmentListExpansionForSession.set(expansionKey, !expanded);
                    setApartmentListExpansion(previous => new Map(previous).set(expansionKey, !expanded));
                  }}
                  title={isUnassigned ? t('rooms.workUnassigned') : t('rooms.makeActive', { apartment: group.apartmentNumber })}
                >
                  <span className="room-list-chevron" aria-hidden="true">▾</span>
                  {isUnassigned ? t('rooms.unassigned') : t('rooms.apartment', { apartment: group.apartmentNumber })}
                  <span className="apartment-group-count">{group.rooms.length}</span>
                  {isActive && <span className="apartment-active-flag">{t('rooms.active')}</span>}
                  {groupArea(group.rooms) !== null && <span className="apartment-group-area">{round(groupArea(group.rooms)!, 1)} {t('units.m2')}</span>}
                </button>
                {!readOnly && !isUnassigned && (
                  <button
                    className="icon-btn"
                    title={t('rooms.duplicateApartment', { apartment: group.apartmentNumber })}
                    onClick={() => setApartmentDialogSource(group.apartmentNumber)}
                  >
                    <Icon name="copy" />
                  </button>
                )}
              </div>
              <div id={groupListId} className={`room-list-body ${expanded ? 'expanded' : ''}`} aria-hidden={!expanded} inert={!expanded}>
              <div className="room-list-body-inner">
              <ul>
                {group.rooms.map((r) => (
                  <li key={r.id} className={(assigningApartment ? assignmentRoomIds.includes(r.id) : r.id === selectedRoomId || deletionRoomIds.includes(r.id)) ? 'active' : ''}
                    onClick={() => assigningApartment ? toggleAssignmentRoom(r.id) : selectRoom(r.id, r.pageNumber)}>
                    {!readOnly && assigningApartment && <input
                      type="checkbox"
                      className="room-assignment-checkbox"
                      aria-label={t('rooms.bulkAssignment.selectRoom', { name: r.name || t('rooms.unnamed'), page: r.pageNumber })}
                      checked={assignmentRoomIds.includes(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleAssignmentRoom(r.id)}
                    />}
                    {/* Selection sits at the row's inline start (right in Hebrew); a click on it only selects. */}
                    {!readOnly && !assigningApartment && <input type="checkbox" className="room-assignment-checkbox room-selection-checkbox"
                      aria-label={t('rooms.bulkDelete.selectRoom', { name: r.name || t('rooms.unnamed'), page: r.pageNumber })}
                      checked={deletionRoomIds.includes(r.id)} onClick={event => event.stopPropagation()} onChange={() => toggleDeletionRoom(r.id)} />}
                    <span className="color-dot" style={{ background: r.color }} />
                    <span className="room-list-name" dir="auto">{r.name || t('rooms.unnamed')}</span>
                    {roomArea(r) !== null && <span className="room-list-area">{round(roomArea(r)!, 1)}</span>}
                    {/* The page number is only information when it is NOT the page on screen. */}
                    {r.pageNumber !== currentPage && <span className="room-list-page">{t('rooms.page', { page: r.pageNumber })}</span>}
                    {/* Duplicate and delete at the inline end; clicking the row opens the editor. */}
                    <span className="room-row-actions" hidden={readOnly || assigningApartment}>
                      <button
                        className="icon-btn"
                        title={t('rooms.duplicate')}
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateRoom(r.id);
                        }}
                      >
                        <Icon name="copy" />
                      </button>
                      <button
                        className="icon-btn danger"
                        title={t('rooms.delete')}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (await confirmDialog(t('rooms.deleteConfirm', { name: r.name }), { destructive: true })) deleteRoom(r.id);
                        }}
                      >
                        <Icon name="trash" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Room details are a separate view — the list stays a list, however many apartments it holds. */}

      {/* Desktop has these tools in the header's AI menu; tablet keeps them here. */}
      {!readOnly && !split && import.meta.env.DEV && <AiSpaceDetectionPanel />}

      {/* Auto detection is a secondary path: its launcher only appears when asked for. */}
      {!readOnly && SHOW_AUTO_DETECT && showDetection && <AutoDetectPanel />}

      {!readOnly && apartmentDialogSource !== null && (
        <DuplicateApartmentDialog
          project={project}
          sourceApartmentNumber={apartmentDialogSource}
          onClose={() => setApartmentDialogSource(null)}
        />
      )}
    </div>
  );
}

function RoomDetail({
  room,
  project,
  calibration,
  onUpdate,
  onRoomTypeChange,
  onApplyTemplate,
  onAddWorkItem,
  onUpdateWorkItem,
  onRemoveWorkItem,
}: {
  room: import('../types').Room;
  /** The whole project, so quantities and default waste come from the shared helpers in lib/quantities. */
  project: Plan;
  calibration: import('../types').Calibration | null;
  onUpdate: (patch: Partial<import('../types').Room>) => void;
  onRoomTypeChange: (roomType: string | null) => 'created' | 'kept' | 'none';
  onApplyTemplate: () => void;
  onAddWorkItem: (type: WorkType) => void;
  onUpdateWorkItem: (itemId: string, patch: Partial<import('../types').WorkItem>) => void;
  onRemoveWorkItem: (itemId: string) => void;
}) {
  const t = useT();
  const { areaM2, perimeterM } = roomMetrics(room, calibration);
  // Same test the quantity code uses, so the warning and the numbers can never disagree.
  const noCalibration = !isPageCalibrated(project, room.pageNumber);
  // Shown once after a type change that deliberately left existing work items alone.
  const [typeNotice, setTypeNotice] = useState<string | null>(null);

  const onSetRoomType = (key: string | null) => {
    const outcome = onRoomTypeChange(key);
    setTypeNotice(outcome === 'kept' ? t('rooms.detail.typeKept') : null);
  };

  const resultUnit = (value: number, unit: 'units.m2' | 'units.lm') => `${round(value, 2)} ${t(unit)}`;

  return (
    <div className="room-detail">
      {/* The page-status strip already announces an uncalibrated page. This warning stays because
          it reports something else: THESE results are unavailable, right where they are missing. */}
      {noCalibration && <div className="warning-box">{t('rooms.detail.notCalibrated')}</div>}

      {/* The name is the identity of this view: the first and largest field. */}
      <label className="detail-name">
        <span className="detail-name-label">{t('rooms.detail.name')}</span>
        <input className="detail-name-input" dir="auto" value={room.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      </label>

      {/* Without a scale these are not "0" — they are simply not computable yet. */}
      <div className="metrics-row">
        <div>
          <span className="metric-label">{t('rooms.detail.area')}</span>
          <span className={`metric-value ${noCalibration ? 'cal-missing' : ''}`}>
            {noCalibration ? t('quantities.notCalibrated') : `${round(areaM2, 2)} ${t('units.m2')}`}
          </span>
        </div>
        <div>
          <span className="metric-label">{t('rooms.detail.perimeter')}</span>
          <span className={`metric-value ${noCalibration ? 'cal-missing' : ''}`}>
            {noCalibration ? t('quantities.notCalibrated') : `${round(perimeterM, 2)} ${t('units.m')}`}
          </span>
        </div>
      </div>

      {/* Label · value rows. Editing the apartment regroups the room in the list immediately. */}
      <div className="detail-fields">
        <label htmlFor={`room-apt-${room.id}`}>{t('rooms.detail.apartment')}</label>
        <input
          id={`room-apt-${room.id}`}
          value={room.apartmentNumber}
          onChange={(e) => onUpdate({ apartmentNumber: e.target.value })}
          placeholder={t('rooms.unassigned')}
        />
        {/* Type is a classification, not the name: picking one never rewrites the name above. */}
        <label htmlFor={`room-type-${room.id}`}>{t('rooms.detail.template')}</label>
        <div className="detail-field-with-action">
          <select id={`room-type-${room.id}`} value={room.roomType ?? ''} onChange={(e) => onSetRoomType(e.target.value || null)}>
            <option value="">{t('rooms.detail.noType')}</option>
            {/* A saved type that is not in the catalogue keeps its own option, so opening the picker never silently drops it. */}
            {room.roomType && !ROOM_PROFILES.some((p) => p.key === room.roomType) && (
              <option value={room.roomType}>{room.roomType}</option>
            )}
            {ROOM_PROFILES.map((p) => (
              <option key={p.key} value={p.key}>
                {roomProfileName(p)}
              </option>
            ))}
          </select>
          {/* Re-applying is explicit and replaces the list — picking a template never does it silently. */}
          {room.roomType && ROOM_PROFILES.some((p) => p.key === room.roomType) && room.workItems.length > 0 && (
            <button
              className="btn-secondary small template-apply"
              title={t('rooms.detail.applyTemplate')}
              onClick={async () => {
                if (!await confirmDialog(t('rooms.detail.applyTemplateConfirm'))) return;
                onApplyTemplate();
                setTypeNotice(null);
              }}
            >
              {t('rooms.detail.applyTemplateShort')}
            </button>
          )}
        </div>
      </div>
      {typeNotice && <p className="detail-note">{typeNotice}</p>}
      {!room.roomType && room.detectedType && (
        <p className="detail-note">{t('rooms.detail.detectedAs', { type: roomProfileLabel(room.detectedType) ?? '' })}</p>
      )}

      <div className="detail-section">
        <span className="detail-section-title">{t('rooms.detail.workTypes')}</span>
        <ul className="work-item-list">
          {room.workItems.map((item) => {
            const def = workTypeDefinition(item.type);
            // A type this build does not know (saved by a newer version) is shown, counted as nothing, and removable.
            if (!def) {
              return (
                <li key={item.id}>
                  <div className="work-item-header">
                    <strong>{item.type}</strong>
                    <button className="icon-btn work-item-remove" title={t('rooms.detail.removeWorkItem')} aria-label={t('rooms.detail.removeWorkItem')} onClick={() => onRemoveWorkItem(item.id)}>
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                </li>
              );
            }
            const calc = calculateWorkItem(item, room, areaM2, perimeterM, project);
            const waste = effectiveWastePercent(item, project);
            const factor = 1 + waste / 100;
            const canDeduct = def.deductedOpeningTypes.length > 0;
            const deducts = itemDeductsOpenings(item);
            const linear = calc.lengthM != null;
            return (
              <li key={item.id}>
                {/* Name · net → to order (the ordered figure is the one in bold) · remove. */}
                <div className="work-item-header">
                  <strong>{t(`workTypes.${def.id}`)}</strong>
                  {noCalibration ? (
                    <span className="work-item-result cal-missing">{t('rooms.detail.itemNotCalibrated')}</span>
                  ) : (
                    <span className="work-item-result" title={`${t(canDeduct ? 'rooms.detail.netQuantity' : 'rooms.detail.quantity')} → ${t('rooms.detail.order')}`}>
                      <bdi className="work-item-net">{linear ? resultUnit(calc.lengthM!, 'units.lm') : resultUnit(calc.netM2, 'units.m2')}</bdi>
                      <span className="wi-arrow" aria-hidden="true">→</span>
                      <bdi><b>{linear ? resultUnit(calc.lengthM! * factor, 'units.lm') : resultUnit(calc.netM2 * factor, 'units.m2')}</b></bdi>
                    </span>
                  )}
                  <button className="icon-btn work-item-remove" title={t('rooms.detail.removeWorkItem')} aria-label={t('rooms.detail.removeWorkItem')} onClick={() => onRemoveWorkItem(item.id)}>
                    <Icon name="close" size={13} />
                  </button>
                </div>

                <div className="wi-controls">
                  {item.type === 'tiling' && (
                    <div className="wi-segmented" role="radiogroup" aria-label={t('rooms.detail.tilingCategory')}>
                      {(['regular', 'as'] as const).map((category) => (
                        <button
                          key={category}
                          role="radio"
                          aria-checked={(item.tilingCategory ?? 'regular') === category}
                          title={t(`tilingCategories.${category}`)}
                          className={(item.tilingCategory ?? 'regular') === category ? 'active' : ''}
                          onClick={() => onUpdateWorkItem(item.id, { tilingCategory: category as TilingCategory })}
                        >
                          {t(`rooms.detail.tilingShort.${category}`)}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* The item follows its type's project default height until a height is typed here, which overrides it for this item only. */}
                  {def.height && (
                    <label className="wi-field">
                      {t(`workTypeHeights.${def.id as Exclude<typeof def.id, 'tiling'>}`)}
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={effectiveHeightM(item, project)}
                        onChange={(e) => onUpdateWorkItem(item.id, { heightM: parseFloat(e.target.value) || 0 })}
                      />
                    </label>
                  )}
                  <label className="wi-field">
                    {t('rooms.detail.waste')}
                    <input
                      className="wi-waste"
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={waste}
                      // Clearing the field drops the override (back to the project default) instead of
                      // storing NaN, which would poison this room's quantities and the whole report.
                      onChange={(e) => {
                        const parsed = parseFloat(e.target.value);
                        onUpdateWorkItem(item.id, { wastePercent: Number.isFinite(parsed) ? parsed : undefined });
                      }}
                    />
                  </label>
                  {canDeduct && (
                    <label className="wi-check">
                      <input
                        type="checkbox"
                        checked={deducts}
                        onChange={(e) => onUpdateWorkItem(item.id, { deductOpenings: e.target.checked })}
                      />
                      {def.deductedOpeningTypes.length === 1 && def.deductedOpeningTypes[0] === 'door'
                        ? t('rooms.detail.deductDoors')
                        : t('rooms.detail.deductOpenings')}
                    </label>
                  )}
                </div>

                {!noCalibration && <>
                  {/* Skirting is read twice: running metres above, and its m² here. */}
                  {linear && <p className="wi-deduction">{t('rooms.detail.area')} <bdi>{resultUnit(calc.netM2, 'units.m2')}</bdi> <span className="wi-arrow" aria-hidden="true">→</span> <bdi>{resultUnit(calc.netM2 * factor, 'units.m2')}</bdi></p>}
                  {calc.openingAudit?.filter(a=>a.reason).map((a,i)=><p className="wi-deduction" key={i}>{t(`openingQuantities.${a.reason!}`)}</p>)}
                  {/* Says in words what was taken off, so a net figure is never mistaken for the gross one. */}
                  {deducts && (calc.deductedM2 > 0 || (calc.deductedLengthM ?? 0) > 0 || !!calc.openingAudit?.length) && (
                    <p className="wi-deduction">
                      {linear && calc.grossLengthM != null && calc.deductedLengthM != null
                        ? t('rooms.detail.perimeterDeduction', {
                            gross: round(calc.grossLengthM, 2),
                            deducted: round(calc.deductedLengthM, 2),
                            net: round(calc.lengthM!, 2),
                            unit: t('units.lm'),
                          })
                        : t('rooms.detail.areaDeduction', {
                            gross: round(calc.grossM2, 2),
                            deducted: round(calc.deductedM2, 2),
                            net: round(calc.netM2, 2),
                            unit: t('units.m2'),
                          })}
                    </p>
                  )}
                </>}
              </li>
            );
          })}
        </ul>
        {room.workItems.length === 0 && <p className="detail-note">{t('rooms.detail.noWorkItems')}</p>}
        {/* One dashed picker instead of six buttons; any type can be added, more than once. */}
        <select
          className="work-item-add"
          value=""
          aria-label={t('rooms.detail.addWorkType')}
          onChange={(e) => { if (e.target.value) onAddWorkItem(e.target.value as WorkType); }}
        >
          <option value="">{t('rooms.detail.addWorkType')}</option>
          {WORK_TYPE_ORDER.map((type) => <option key={type} value={type}>{t(`workTypes.${type}`)}</option>)}
        </select>
      </div>

      <details className="detail-collapsible" open={!!room.notes}>
        <summary>{t('rooms.detail.notes')}</summary>
        <textarea dir="auto" value={room.notes} onChange={(e) => onUpdate({ notes: e.target.value })} rows={2} aria-label={t('rooms.detail.notes')} />
      </details>
    </div>
  );
}

/**
 * Doors, windows and other openings of one room, entered by hand in metres. Wall-based work deducts
 * them and skirting deducts door widths (see lib/workTypes); nothing here needs the page scale.
 */
function OpeningsEditor({
  openings,
  onUpdate,
  onRemove,
}: {
  openings: Opening[];
  onUpdate: (openingId: string, patch: Partial<Opening>) => void;
  onRemove: (openingId: string) => void;
}) {
  const t = useT();
  // A cleared field stores 0 rather than NaN, like the work-item height inputs.
  const num = (value: string) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };
  const totalM2 = openings.reduce((sum, o) => sum + openingAreaM2(o), 0);

  return (
    <div className="openings">
      <span className="section-label">
        {openings.length > 0
          ? t('rooms.openings.titleWithArea', { area: round(totalM2, 2), unit: t('units.m2') })
          : t('rooms.openings.title')}
      </span>
      {openings.length > 0 && (
        <ul className="opening-list">
          {openings.map((o) => (
            <li key={o.id}>
              <select
                value={o.type}
                aria-label={t('rooms.openings.type')}
                onChange={(e) => onUpdate(o.id, { type: e.target.value as OpeningType })}
              >
                {OPENING_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`openingTypes.${type}`)}
                  </option>
                ))}
              </select>
              <label>
                <span>{t('rooms.openings.width')}</span>
                <input type="number" step="0.05" min="0" value={o.widthM} onChange={(e) => onUpdate(o.id, { widthM: num(e.target.value) })} />
              </label>
              <label>
                <span>{t('rooms.openings.height')}</span>
                <input type="number" step="0.05" min="0" value={o.heightM} onChange={(e) => onUpdate(o.id, { heightM: num(e.target.value) })} />
              </label>
              <label>
                <span>{t('rooms.openings.quantity')}</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={o.quantity}
                  onChange={(e) => onUpdate(o.id, { quantity: Math.round(num(e.target.value)) })}
                />
              </label>
              <span className="opening-area">
                {round(openingAreaM2(o), 2)} {t('units.m2')}
              </span>
              <button className="icon-btn danger" title={t('rooms.openings.delete')} onClick={() => onRemove(o.id)}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Step 1 of duplicating an apartment: pick source, target number and target page, acknowledge any
 * calibration warning, then hand over to placement mode — the click on the plan does the rest.
 * An "apartment" here is simply every room sharing an apartmentNumber; no new entity is involved.
 */
function DuplicateApartmentDialog({
  project,
  sourceApartmentNumber,
  onClose,
}: {
  project: Plan;
  /** Pre-selected from the apartment group the user opened this from; still switchable here. */
  sourceApartmentNumber: string;
  onClose: () => void;
}) {
  const t = useT();
  const duplicateApartment = useAppStore((s) => s.duplicateApartment);

  const apartments = apartmentNumbersInProject(project);
  const [source, setSource] = useState(sourceApartmentNumber || apartments[0] || '');
  const [target, setTarget] = useState('');

  const roomCount = project.rooms.filter((r) => r.apartmentNumber === source).length;
  const warnings = apartmentDuplicationWarnings(project, source);
  const targetExists = !!target.trim() && project.rooms.some((r) => r.apartmentNumber === target.trim());
  const canDuplicate = !!source && !!target.trim();

  const run = async () => {
    const targetNumber = target.trim();
    // An existing target number is not an error — it just means the rooms join that apartment.
    if (targetExists && !await confirmDialog(t('rooms.duplicateDialog.targetExistsConfirm', { apartment: targetNumber }))) return;
    duplicateApartment(source, targetNumber);
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{t('rooms.duplicateDialog.title')}</h3>
        <div className="form-row">
          <label>{t('rooms.duplicateDialog.source')}</label>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {apartments.map((a) => (
              <option key={a} value={a}>
                {t('rooms.apartment', { apartment: a })}
              </option>
            ))}
          </select>
        </div>
        <p className="muted">{t('rooms.duplicateDialog.summary', { count: roomCount })}</p>

        <div className="form-row">
          <label>{t('rooms.duplicateDialog.target')}</label>
          <input
            autoFocus
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canDuplicate) run();
            }}
            placeholder={t('rooms.duplicateDialog.targetPlaceholder')}
          />
        </div>

        {warnings.map((w) => (
          <div className="warning-box" key={w}>
            {w}
          </div>
        ))}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary" onClick={run} disabled={!canDuplicate}>
            {t('rooms.duplicateDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
