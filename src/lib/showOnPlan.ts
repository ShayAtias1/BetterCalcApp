import { useAppStore } from '../store/appStore';
import { useFieldWorkflowStore } from '../store/fieldWorkflowStore';
import { usePlanFocusStore, type PlanFocus } from '../store/planFocusStore';

/** Existing save-aware plan navigation, followed by selection and a viewport-only request. */
export async function showOnPlan(target: PlanFocus): Promise<boolean> {
  const opened = await useAppStore.getState().openPlan(target.planId);
  const store = useAppStore.getState();
  if (!opened || store.project?.id !== target.planId) return false;
  store.setToolMode('select');
  useFieldWorkflowStore.getState().setDraft(false);
  store.setCurrentPage(target.pageNumber);
  store.setDrawTarget(target.domain);
  store.setSelectedMarkupId(null);
  store.setSelectedRoomId(target.domain === 'room' ? target.itemId : null);
  store.setSelectedConcreteId(target.domain === 'concrete' ? target.itemId : null);
  store.setSelectedRebarId(target.domain === 'rebar' ? target.itemId : null);
  if (target.barId) store.setSelectedDrawnBarId(target.barId);
  if (target.placementId) useAppStore.setState({ selectedStirrupPlacementId: target.placementId });
  store.setOverlayVisible(target.domain === 'room' ? 'finishes' : target.domain, true);
  usePlanFocusStore.getState().focus(target);
  return true;
}
