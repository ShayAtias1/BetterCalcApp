import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmDialog, promptDialog, messageDialog, useAppDialogs, settleDialog, notify, dismissNotice } from '../../src/lib/appDialogs.ts';

test('queued confirmations resolve only their own decision; prompt cancellation and input remain distinct', async () => {
  const first = confirmDialog('Delete Room?', { destructive: true });
  const second = promptDialog('Room name', 'Original');
  const requests = useAppDialogs.getState().queue;
  assert.equal(requests.length, 2);
  settleDialog(requests[0].id, false);
  assert.equal(await first, false);
  assert.equal(useAppDialogs.getState().queue[0].initialValue, 'Original');
  settleDialog(requests[1].id, 'Renamed');
  assert.equal(await second, 'Renamed');
  const cancelled = promptDialog('Apartment');
  settleDialog(useAppDialogs.getState().queue[0].id, null);
  assert.equal(await cancelled, null);
  const accepted = confirmDialog('Paid processing');
  settleDialog(useAppDialogs.getState().queue[0].id, true);
  assert.equal(await accepted, true);
  const message = messageDialog('Information');
  settleDialog(useAppDialogs.getState().queue[0].id, true);
  await message;
  assert.equal(useAppDialogs.getState().queue.length, 0);
});
test('notices never enqueue blocking dialogs and can be dismissed independently', () => {
  notify('Export failed');
  notify('Bulk applied');
  const notices = useAppDialogs.getState().notices;
  assert.equal(useAppDialogs.getState().queue.length, 0);
  dismissNotice(notices[0].id);
  assert.equal(useAppDialogs.getState().notices[0].message, 'Bulk applied');
  dismissNotice(notices[1].id);
});
