import test from 'node:test';
import assert from 'node:assert/strict';
import { measureFace, buildPlan, buildInsights } from '../measurements.js';

function fixture() {
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
  const chosen = {
    10:[.5,.15],152:[.5,.9],234:[.2,.5],454:[.8,.5],33:[.31,.4],133:[.43,.4],362:[.57,.4],263:[.69,.4],
    1:[.5,.55],9:[.5,.3],2:[.5,.6],98:[.45,.58],327:[.55,.58],61:[.37,.7],291:[.63,.7],
    159:[.37,.38],145:[.37,.42],386:[.63,.38],374:[.63,.42],172:[.28,.72],397:[.72,.72],
    70:[.3,.31],107:[.43,.31],336:[.57,.31],300:[.7,.31],105:[.37,.3],334:[.63,.3],168:[.5,.4],
    0:[.5,.65],17:[.5,.75],13:[.5,.69],14:[.5,.71],
  };
  for (const [key,[x,y]] of Object.entries(chosen)) points[key]={x,y,z:0};
  return points;
}
test('produces finite explainable ratios with an exact symmetric reference',()=>{
  const result=measureFace(fixture(),1000,1000);
  assert.equal(result.metrics.length,22);
  assert.equal(result.metrics.find(m=>m.key==='face-ratio').value,1.25);
  assert.equal(result.metrics.find(m=>m.key==='photo-asymmetry').value,0);
  assert.ok(result.metrics.every(m=>Number.isFinite(m.value)&&m.explanation.length>30));
  assert.equal(new Set(result.metrics.map(m=>m.key)).size,22);
});
test('ratios are invariant under image scaling',()=>{
  assert.deepEqual(measureFace(fixture(),1000,1000).metrics,measureFace(fixture(),2000,2000).metrics);
});
test('uses pixel coordinates rather than distorted normalized distances',()=>{
  const square=measureFace(fixture(),1000,1000);
  const normalized=fixture().map(p=>({...p,x:p.x/2}));
  const wide=measureFace(normalized,2000,1000);
  assert.deepEqual(square.metrics,wide.metrics);
});
test('compensates for in-plane head rotation',()=>{
  const radians=10*Math.PI/180;
  const rotated=fixture().map(p=>({...p,x:.5+(p.x-.5)*Math.cos(radians)-(p.y-.5)*Math.sin(radians),y:.5+(p.x-.5)*Math.sin(radians)+(p.y-.5)*Math.cos(radians)}));
  const before=measureFace(fixture(),1000,1000),after=measureFace(rotated,1000,1000);
  assert.deepEqual(before.metrics,after.metrics);
  assert.equal(after.quality.rollDegrees,10);
});
test('rejects invalid data, extreme head turn, tiny faces, and extreme roll',()=>{
  assert.throws(()=>measureFace([],1000,1000),/incomplete/);
  const invalid=fixture();invalid[0].x=NaN;assert.throws(()=>measureFace(invalid,1000,1000),/incomplete/);
  const turned=fixture();turned[1].x=.7;assert.throws(()=>measureFace(turned,1000,1000),/turned too far/);
  const small=fixture().map(p=>({...p,x:.5+(p.x-.5)*.1,y:.5+(p.y-.5)*.1}));assert.throws(()=>measureFace(small,1000,1000),/too far from/);
  const a=.5;const tilted=fixture().map(p=>({...p,x:.5+(p.x-.5)*Math.cos(a)-(p.y-.5)*Math.sin(a),y:.5+(p.x-.5)*Math.sin(a)+(p.y-.5)*Math.cos(a)}));assert.throws(()=>measureFace(tilted,1000,1000),/tilted too far/);
});
test('suppresses photo-asymmetry rather than presenting pose bias as a score',()=>{
  const turned=fixture();turned[1].x=.55;
  const result=measureFace(turned,1000,1000);
  assert.equal(result.metrics.find(m=>m.key==='photo-asymmetry').value,null);
  assert.ok(result.warnings.some(w=>w.includes('sideways')));
});
test('goals produce distinct checklists and observations derive from actual values',()=>{
  const {metrics}=measureFace(fixture(),1000,1000);
  assert.match(buildInsights(metrics)[0].text,/1.25/);
  for(const goal of ['understand','styling','tracking']) assert.equal(buildPlan(goal,metrics).length,4);
  assert.notDeepEqual(buildPlan('styling',metrics),buildPlan('tracking',metrics));
});
