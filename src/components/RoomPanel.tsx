import { roomHasPendingDetectionWarning } from '../lib/localAiReview';
import AiSpaceDetectionPanel from './AiSpaceDetectionPanel';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import ReviewFields from './ReviewFields';
import { useEffect, useRef, useState } from 'react';
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

const OPENING_TYPES: OpeningType[] = ['door', 'window', 'custom'];

/**
 * Auto room detection is experimental and hidden from users for now. This flag gates only its entry
 * points in the room list (launcher button, launcher panel, review panel); the detection pipeline,
 * store actions and any rooms already saved from it are untouched. Flip to true to bring it back.
 */
const SHOW_AUTO_DETECT = false;

export default function RoomPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { touchInput } = useWorkspaceLayout();
  const t = useT();
  const project = useAppStore((s) => s.project);
  const selectedRoomId = useAppStore((s) => s.selectedRoomId);
  const setSelectedRoomId = useAppStore((s) => s.setSelectedRoomId);
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const updateRoom = useAppStore((s) => s.updateRoom);
  const setRoomType = useAppStore((s) => s.setRoomType);
  const applyRoomTemplate = useAppStore((s) => s.applyRoomTemplate);
  const newRoomTemplate = useAppStore((s) => s.newRoomTemplate);
  const setNewRoomTemplate = useAppStore((s) => s.setNewRoomTemplate);
  const duplicateRoom = useAppStore((s) => s.duplicateRoom);
  const deleteRoom = useAppStore((s) => s.deleteRoom);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const updateWorkItem = useAppStore((s) => s.updateWorkItem);
  const removeWorkItem = useAppStore((s) => s.removeWorkItem);
  const addOpening = useAppStore((s) => s.addOpening);
  const updateOpening = useAppStore((s) => s.updateOpening);
  const removeOpening = useAppStore((s) => s.removeOpening);
  const activeApartmentNumber = useAppStore((s) => s.activeApartmentNumber);
  const setActiveApartmentNumber = useAppStore((s) => s.setActiveApartmentNumber);
  const [apartmentDialogSource, setApartmentDialogSource] = useState<string | null>(null);
  const [showDetection, setShowDetection] = useState(false);
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
  // The detail view is derived, not remembered: a room that was deleted, undone away or that lives
  // on another page (after a page change) can never leave the sidebar showing stale details.
  const detailRoom = detailOpen && room && room.pageNumber === currentPage ? room : null;

  const selectRoom = (id: string, page: number) => {
    setCurrentPage(page);
    setSelectedRoomId(id);
    setDetailOpen(true);
  };

  if (detailRoom) {
    return (
      <div className="room-panel">
        <div className="detail-nav">
          <button className="btn-ghost small" onClick={() => setDetailOpen(false)}>
            <Icon name="back" />
            {t('rooms.backToRooms')}
          </button>
        </div>
        {/* The room name is the identity of this view and outranks everything in it, including the
            area and perimeter below — those are results. */}
        <div className="detail-header">
          <span className="color-dot" style={{ background: detailRoom.color }} />
          <span className="detail-header-text">
            <span className="detail-title">{detailRoom.name || t('rooms.unnamed')}</span>
            <span className="detail-subtitle">
              {detailRoom.apartmentNumber ? t('rooms.apartment', { apartment: detailRoom.apartmentNumber }) : t('rooms.unassigned')}
            </span>
          </span>
          {!readOnly && <><button className="icon-btn" title={t('rooms.duplicate')} onClick={() => duplicateRoom(detailRoom.id)}>
            <Icon name="copy" />
          </button>
          <button
            className="icon-btn danger"
            title={t('rooms.delete')}
            onClick={() => {
              if (!confirm(t('rooms.deleteConfirm', { name: detailRoom.name }))) return;
              deleteRoom(detailRoom.id);
              setDetailOpen(false);
            }}
          >
            <Icon name="trash" />
          </button>
        </>}</div>
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
          onAddOpening={(type) => addOpening(detailRoom.id, type)}
          onUpdateOpening={(openingId, patch) => updateOpening(detailRoom.id, openingId, patch)}
          onRemoveOpening={(openingId) => removeOpening(detailRoom.id, openingId)}
        /></ReviewFields>
      </div>
    );
  }

  /** Creating an apartment is just naming one: it exists as soon as a room carries the number. */
  const createApartment = () => {
    const next = window.prompt(t('rooms.newApartmentPrompt'), '');
    if (next && next.trim()) setActiveApartmentNumber(next.trim());
  };

  return (
    <div className="room-panel">
      {/* Suggestions awaiting review take over the top of the tab until they are handled. */}
      {!readOnly && (SHOW_AUTO_DETECT || import.meta.env.DEV) && <DetectionReviewPanel />}

      <div hidden={readOnly}>
      <div className="room-create-row">
        <button
          className={`btn-primary ${toolMode === 'draw' ? 'active' : ''}`}
          onClick={() => setToolMode(toolMode === 'draw' ? 'select' : 'draw')}
          title={t('rooms.drawHint')}
        >
          {t('rooms.draw')}
        </button>
        {/* The two drawing shapes, in the same grey segmented tray as the markup tools. */}
        <div className="segmented room-shape-tools">
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
        </div>
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

      {/* The template new rooms start from — work types included. A starting point only: every
          room stays fully editable afterwards. */}
      <div className="active-apartment-row">
        <label htmlFor="new-room-template">{t('rooms.newRoomTemplate')}</label>
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
      </div>

      {/* Workspace state, not a form field: this is the apartment being worked in, and the sentence
          that used to repeat the selected value under it is gone — the value itself says it. */}
      <div className="active-apartment-row">
        <label htmlFor="active-apartment">{t('rooms.workingIn')}</label>
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
      </div>

      </div>
      <div className="room-list">
        <span className="section-label">{t('rooms.markedAreas', { count: project.rooms.length })}</span>
        {project.rooms.length === 0 && (
          <div className="empty-state">
            <Icon name="polygon" size={28} />
            <p>{t('rooms.empty')}</p>
          </div>
        )}

        {groups.map((group) => {
          const isActive = group.apartmentNumber === activeApartmentNumber;
          const isUnassigned = !group.apartmentNumber;
          return (
            <div key={group.apartmentNumber || '__unassigned__'} className={`apartment-group ${isActive ? 'active' : ''}`}>
              <div className="apartment-group-head">
                {/* The active apartment is marked by the group's EDGE and a stronger header — never
                    by tinting the whole group, which is what used to swallow the selected room. */}
                <button
                  className="apartment-group-title"
                  onClick={() => { if (!readOnly) setActiveApartmentNumber(group.apartmentNumber); }}
                  title={isUnassigned ? t('rooms.workUnassigned') : t('rooms.makeActive', { apartment: group.apartmentNumber })}
                >
                  {isUnassigned ? t('rooms.unassigned') : t('rooms.apartment', { apartment: group.apartmentNumber })}
                  <span className="apartment-group-count">{group.rooms.length}</span>
                  {isActive && <span className="apartment-active-flag">{t('rooms.active')}</span>}
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
              <ul>
                {group.rooms.map((r) => (
                  <li key={r.id} className={r.id === selectedRoomId ? 'active' : ''} onClick={() => selectRoom(r.id, r.pageNumber)}>
                    <span className="color-dot" style={{ background: r.color }} />
                    <span className="room-list-name" dir="auto">{r.name || t('rooms.unnamed')}</span>
                    {(r.aiSource || r.id.startsWith('local-ai:')) && <span className="cal-ok" title={t('aiReviewWorkspace.approved')}><Icon name="check" size={12} /> {t('aiReviewWorkspace.approved')}</span>}
                    {roomHasPendingDetectionWarning(r) && (
                      <span className="room-review-flag" title={t('rooms.reviewFlag')}>
                        <Icon name="alert" size={13} />
                      </span>
                    )}
                    {/* The page number is only information when it is NOT the page on screen. */}
                    {r.pageNumber !== currentPage && <span className="room-list-page">{t('rooms.page', { page: r.pageNumber })}</span>}
                    {/* Row actions appear on hover and on keyboard focus, so they stop competing
                        with the room name while staying reachable by tab. */}
                    <span className="room-row-actions" hidden={readOnly}>
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
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(t('rooms.deleteConfirm', { name: r.name }))) deleteRoom(r.id);
                        }}
                      >
                        <Icon name="trash" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Room details are a separate view — the list stays a list, however many apartments it holds. */}

      {!readOnly && import.meta.env.DEV && <AiSpaceDetectionPanel />}

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
  onAddOpening,
  onUpdateOpening,
  onRemoveOpening,
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
  onAddOpening: (type: OpeningType) => void;
  onUpdateOpening: (openingId: string, patch: Partial<Opening>) => void;
  onRemoveOpening: (openingId: string) => void;
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

  return (
    <div className="room-detail">
      {/* The page-status strip already announces an uncalibrated page. This warning stays because
          it reports something else: THESE results are unavailable, right where they are missing. */}
      {noCalibration && <div className="warning-box">{t('rooms.detail.notCalibrated')}</div>}
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

      {/* Name and apartment share a row — 360px carries both, and the panel stops being a column
          of full-width fields. Editing the apartment regroups the room in the list immediately. */}
      <div className="form-grid">
        <div className="form-row">
          <label>{t('rooms.detail.name')}</label>
          <input dir="auto" value={room.name} onChange={(e) => onUpdate({ name: e.target.value })} />
        </div>
        <div className="form-row">
          <label>{t('rooms.detail.apartment')}</label>
          <input
            value={room.apartmentNumber}
            onChange={(e) => onUpdate({ apartmentNumber: e.target.value })}
            placeholder={t('rooms.unassigned')}
          />
        </div>
      </div>
      {/* Type is a classification, not the name: picking one never rewrites the name above. */}
      <div className="form-row">
        <label>{t('rooms.detail.template')}</label>
        <select value={room.roomType ?? ''} onChange={(e) => onSetRoomType(e.target.value || null)}>
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
      </div>
      {typeNotice && <p className="muted">{typeNotice}</p>}
      {/* Re-applying is explicit and replaces the list — picking a template never does it silently. */}
      {room.roomType && ROOM_PROFILES.some((p) => p.key === room.roomType) && room.workItems.length > 0 && (
        <button
          className="btn-ghost small template-apply"
          onClick={() => {
            if (!confirm(t('rooms.detail.applyTemplateConfirm'))) return;
            onApplyTemplate();
            setTypeNotice(null);
          }}
        >
          <Icon name="reset" size={13} />
          {t('rooms.detail.applyTemplate')}
        </button>
      )}
      {!room.roomType && room.detectedType && (
        <p className="muted">{t('rooms.detail.detectedAs', { type: roomProfileLabel(room.detectedType) ?? '' })}</p>
      )}

      <div className="form-row">
        <label>{t('rooms.detail.notes')}</label>
        <textarea dir="auto" value={room.notes} onChange={(e) => onUpdate({ notes: e.target.value })} rows={2} />
      </div>

      <OpeningsEditor
        openings={room.openings ?? []}
        onAdd={onAddOpening}
        onUpdate={onUpdateOpening}
        onRemove={onRemoveOpening}
      />

      <span className="section-label">{t('rooms.detail.workTypes')}</span>
      <div className="work-item-add-row">
        {WORK_TYPE_ORDER.map((type) => (
          <button key={type} className="btn-secondary small" onClick={() => onAddWorkItem(type)}>
            <Icon name="plus" size={13} />
            {t(`workTypes.${type}`)}
          </button>
        ))}
      </div>

      <ul className="work-item-list">
        {room.workItems.map((item) => {
          const def = workTypeDefinition(item.type);
          // A type this build does not know (saved by a newer version) is shown, counted as nothing, and removable.
          if (!def) {
            return (
              <li key={item.id}>
                <div className="work-item-header">
                  <strong>{item.type}</strong>
                  <button className="icon-btn danger" title={t('rooms.detail.removeWorkItem')} onClick={() => onRemoveWorkItem(item.id)}>
                    <Icon name="trash" />
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
          return (
            <li key={item.id}>
              <div className="work-item-header">
                <strong>{t(`workTypes.${def.id}`)}</strong>
                <button className="icon-btn danger" title={t('rooms.detail.removeWorkItem')} onClick={() => onRemoveWorkItem(item.id)}>
                  <Icon name="trash" />
                </button>
              </div>

              {/* The calculated result is the reason this card exists, so it comes FIRST and in the
                  strongest type in the card. The inputs that feed it follow, compact and quieter. */}
              {noCalibration ? (
                <div className="work-item-result cal-missing">{t('rooms.detail.itemNotCalibrated')}</div>
              ) : (
                <>
                  <div className="wi-metrics">
                    {/* Panels are read twice: running metres (the room perimeter, less door widths)
                        and m², each with the same waste applied. Other work types have no linear reading. */}
                    {calc.lengthM != null && (
                      <>
                        <span className="wi-metric">
                          <span className="wi-metric-label">{t('rooms.detail.length')}</span>
                          <span className="wi-metric-value">
                            {round(calc.lengthM, 2)} {t('units.lm')}
                          </span>
                        </span>
                        <span className="wi-metric order">
                          <span className="wi-metric-label">{t('rooms.detail.order')}</span>
                          <span className="wi-metric-value">
                            {round(calc.lengthM * factor, 2)} {t('units.lm')}
                          </span>
                        </span>
                      </>
                    )}
                    <span className="wi-metric">
                      <span className="wi-metric-label">
                        {calc.lengthM != null
                          ? t('rooms.detail.area')
                          : canDeduct
                            ? t('rooms.detail.netQuantity')
                            : t('rooms.detail.quantity')}
                      </span>
                      <span className="wi-metric-value">
                        {round(calc.netM2, 2)} {t('units.m2')}
                      </span>
                    </span>
                    <span className="wi-metric order">
                      <span className="wi-metric-label">{t('rooms.detail.order')}</span>
                      <span className="wi-metric-value">
                        {round(calc.netM2 * factor, 2)} {t('units.m2')}
                      </span>
                    </span>
                  </div>
                  {/* Says in words what was taken off, so a net figure is never mistaken for the gross one. */}
                  {deducts && (calc.deductedM2 > 0 || (calc.deductedLengthM ?? 0) > 0) && (
                    <p className="wi-deduction">
                      {calc.lengthM != null && calc.grossLengthM != null && calc.deductedLengthM != null
                        ? t('rooms.detail.perimeterDeduction', {
                            gross: round(calc.grossLengthM, 2),
                            deducted: round(calc.deductedLengthM, 2),
                            net: round(calc.lengthM, 2),
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
                </>
              )}

              <div className="wi-controls">
              {item.type === 'tiling' && (
                <div className="form-row inline">
                  <label>{t('rooms.detail.tilingCategory')}</label>
                  <select
                    value={item.tilingCategory ?? 'regular'}
                    onChange={(e) => onUpdateWorkItem(item.id, { tilingCategory: e.target.value as TilingCategory })}
                  >
                    <option value="regular">{t('tilingCategories.regular')}</option>
                    <option value="as">{t('tilingCategories.as')}</option>
                  </select>
                </div>
              )}
              {/* The item follows its type's project default height until a height is typed here, which overrides it for this item only. */}
              {def.height && (
                <div className="form-row inline">
                  <label>{t(`workTypeHeights.${def.id as Exclude<typeof def.id, 'tiling'>}`)}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={effectiveHeightM(item, project)}
                    onChange={(e) => onUpdateWorkItem(item.id, { heightM: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              )}
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
              <div className="form-row inline">
                <label>{t('rooms.detail.waste')}</label>
                <input
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
              </div>
              </div>
            </li>
          );
        })}
        {room.workItems.length === 0 && (
          <div className="empty-state">
            <Icon name="wall" size={24} />
            <p>{t('rooms.detail.noWorkItems')}</p>
          </div>
        )}
      </ul>
    </div>
  );
}

/**
 * Doors, windows and other openings of one room, entered by hand in metres. Wall-based work deducts
 * them and skirting deducts door widths (see lib/workTypes); nothing here needs the page scale.
 */
function OpeningsEditor({
  openings,
  onAdd,
  onUpdate,
  onRemove,
}: {
  openings: Opening[];
  onAdd: (type: OpeningType) => void;
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
      <div className="work-item-add-row">
        {OPENING_TYPES.map((type) => (
          <button key={type} className="btn-secondary small" onClick={() => onAdd(type)}>
            <Icon name="plus" size={13} />
            {t(`openingTypes.${type}`)}
          </button>
        ))}
      </div>
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

  const run = () => {
    const targetNumber = target.trim();
    // An existing target number is not an error — it just means the rooms join that apartment.
    if (targetExists && !confirm(t('rooms.duplicateDialog.targetExistsConfirm', { apartment: targetNumber }))) return;
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
