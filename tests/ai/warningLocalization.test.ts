import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translatorFor } from '../../src/i18n/index.ts';
import { aiWarningText } from '../../src/lib/aiWarningText.ts';
import { aiWarnings } from '../../src/lib/localAiReview.ts';

const he = translatorFor('he'), en = translatorFor('en');
test('saved One-Click and legacy room notes switch languages without changing source data or warning IDs', () => {
  const meta = {planId:'plan',sourceHash:'hash',pageNumber:1,width:100,height:100,spaceId:'target',geometryClass:'CLOSED',
    geometryConfidence:'MEDIUM',requiresReview:true,reviewNotes:['Doorway thresholds inferred.'],
    reason:'The target lies within the enclosed bedroom between the balcony and the reinforced room. Visible walls and the doorway establish its boundary.',
    ambiguities:['The entrance doorway on the lower boundary is closed across the opening at the adjoining inner wall line. Classification requires user review.'],
    overlapWarnings:['Overlap with existing Room “חדר 2”. Review before approval.']};
  const original=structuredClone(meta), hebrew=aiWarnings(meta,he), english=aiWarnings(meta,en);
  assert.deepEqual(hebrew.map(w=>w.id),english.map(w=>w.id));
  assert.ok(hebrew.every(w=>/[א-ת]/.test(w.text)&&!/[a-z]/i.test(w.text.replace('AI',''))));
  assert.ok(english.find(w=>w.id==='geometryConfidence')?.text.endsWith('Medium'));
  assert.match(hebrew.find(w=>w.id.startsWith('overlap:'))!.text,/חדר 2/);
  assert.deepEqual(meta,original);
  const legacy={...meta,ambiguities:undefined};
  assert.equal(aiWarnings(legacy,he).find(w=>w.id==='note:0')?.text,'ספי הפתחים נקבעו בהסקה.');
});
test('all existing full-page fixture notes have specific local translations', () => {
  const saved=JSON.parse(readFileSync(new URL('./frozen-spaces.json',import.meta.url),'utf8'));
  for(const space of saved.spaces)for(const note of space.ambiguities){
    assert.match(aiWarningText(note,he),/[א-ת]/);
    assert.notEqual(aiWarningText(note,he),he('aiWarningText.additional'));
    assert.equal(aiWarningText(note,en),note);
  }
});
test('saved opening evidence, uncertainty and deferred codes follow the selected language', () => {
  for(const source of ['swing arc','jamb uncertain','one jamb','Only one jamb visible','CROSS_TILE_INCOMPLETE','UNSUPPORTED_ENDPOINTS']){
    const hebrew=aiWarningText(source,he);
    assert.match(hebrew,/[א-ת]/);
    assert.notEqual(hebrew,he('aiWarningText.additional'));
    assert.match(aiWarningText(hebrew,en),/[a-z]/i);
  }
});
test('geometry validation and unknown provider prose never leak English into Hebrew warnings', () => {
  for(const source of ['At least three distinct vertices are required.','Polygon extends outside the page.','Polygon does not contain the selected target point.']){
    assert.match(aiWarningText(source,he),/[א-ת]/);
    assert.equal(aiWarningText(aiWarningText(source,he),en),source);
  }
  assert.equal(aiWarningText('Previously unseen provider wording.',he),he('aiWarningText.additional'));
  assert.equal(aiWarningText('Previously unseen provider wording.',en),'Previously unseen provider wording.');
});
