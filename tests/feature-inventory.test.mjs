import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildFeatureInventory} from '../scripts/feature-inventory.mjs';

test('Feature inventory is source-derived, unique and does not claim 2500-feature coverage',async()=>{
 const root=path.resolve(import.meta.dirname,'..'),report=await buildFeatureInventory(root);
 assert.equal(report.featureCatalog2500.status,'not-verified-no-source-catalogue');assert.equal(report.featureCatalog2500.verified,false);assert.equal(report.featureCatalog2500.source,null);
 assert.equal(report.acceptanceIds.count,30);assert.equal(report.acceptanceIds.values[0],'FD-01');assert.equal(report.acceptanceIds.values.at(-1),'FD-30');
 for(const [name,metric] of Object.entries(report.metrics)){
  assert.ok(metric.count>0,`${name} must contain observed entries`);
  const collections=metric.values?[metric.values]:Object.values(metric.files);
  for(const values of collections){assert.equal(new Set(values).size,values.length,`${name} entries must be unique within their source`);assert.ok(values.every(value=>typeof value==='string'&&value.length>0));}
 }
 assert.ok(report.metrics.engineCommands.values.includes('clip.add'));assert.ok(report.metrics.engineCommands.values.includes('history.undo'));
 assert.ok(report.metrics.apiRouteStrings.values.includes('/api/audio-units/play'));
 assert.ok(report.metrics.nativeHelperCommands.files['audio-units'].includes('renderMidi'));
 assert.ok(report.metrics.declaredProductTests.files['tests/feature-inventory.test.mjs'].includes('Feature inventory is source-derived, unique and does not claim 2500-feature coverage'));
});
