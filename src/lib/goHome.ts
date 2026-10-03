import { useAppStore } from '../store/appStore';
import { useCompareStore } from '../store/compareStore';

/**
 * Back to the BetterCalc home (the projects list) through the stores' own close flow — an open plan
 * or comparison is saved first and stays open when that save fails. No page reload.
 */
export async function goHome(): Promise<void> {
  const compare = useCompareStore.getState();
  if (compare.comparison) {
    await compare.persist();
    if (useCompareStore.getState().saveError) return;
    compare.setComparison(null);
  }
  await useAppStore.getState().closeProject();
}
