import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateAesthetics, createSkinRoutine } from '../guidance.js';

const metrics = (asymmetry = 0) => [
  {key:'photo-asymmetry',value:asymmetry}, {key:'eye-spacing',value:1},
  {key:'mid-lower',value:1}, {key:'lip-balance',value:1},
];
test('the published experimental rubric is deterministic, bounded, and identified as untrained', () => {
  const a=estimateAesthetics(metrics()), b=estimateAesthetics(metrics());
  assert.deepEqual(a,b); assert.equal(a.score,10); assert.equal(a.trainedModel,false);
  for(const v of [0,1,10,100]) {const score=estimateAesthetics(metrics(v)).score;assert.ok(score>=1&&score<=10);}
});
test('missing photo data is never converted into an invented component', () => {
  const result=estimateAesthetics(metrics(null));
  assert.equal(result.components[0].score,null);assert.equal(result.coverage,65);assert.equal(result.provisional,true);
  assert.equal(estimateAesthetics([]).score,null);
  assert.equal(estimateAesthetics([{key:'eye-spacing',value:Infinity}]).score,null);
});
test('skin guidance follows self-reported concerns and names its medical sources', () => {
  const routine=createSkinRoutine({skin:'oily',concern:'breakouts'});
  assert.match(routine.morning[1].text,/non-comedogenic/);
  assert.match(routine.focus.text,/Persistent, painful, or scarring/);
  assert.match(routine.origin,/self-reported/);
  assert.ok([...routine.morning,...routine.evening,routine.focus,routine.treatment].every(step=>step.source[1].startsWith('https://www.aad.org/')));
});
test('pregnancy / prescription caution replaces treatment exploration with clinician review', () => {
  const routine=createSkinRoutine({caution:true});
  assert.match(routine.treatment.text,/avoid retinoids/);
  assert.match(routine.treatment.text,/ask your clinician/);
  assert.equal(routine.morning.length,3);assert.equal(routine.evening.length,2);
});
