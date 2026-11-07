import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '')
  .replaceAll('import.meta.url', 'moduleUrl');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

function bootWithBlockedStorage(hash = '#studio') {
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, { hidden: id !== 'home-view', addEventListener() {} }]));
  const documentEvents = new Map();
  const document = {
    querySelector: selector => nodes.get(selector.slice(1)) || { addEventListener() {} },
    getElementById: id => nodes.get(id),
    addEventListener: (name, handler) => documentEvents.set(name, handler),
    title: '',
  };
  const window = { addEventListener() {}, scrollTo() {} };
  const dependencies = { document, window, location: { hash }, listReports: () => new Promise(() => {}), moduleUrl: 'https://example.test/qmax/app.js' };
  const boot = new AsyncFunction(...Object.keys(dependencies), source)(...Object.values(dependencies));
  return { nodes, documentEvents, boot };
}

test('the upload view opens without waiting for local report storage', async () => {
  const harness = bootWithBlockedStorage();
  await new Promise(setImmediate);
  const studioId = html.match(/<section id="([^"]+)"[^>]*aria-labelledby="studio-heading"/)[1];
  assert.equal(harness.nodes.get(studioId).hidden, false, 'Slow or blocked IndexedDB must not keep the upload view hidden.');
  assert.equal(harness.nodes.get('home-view').hidden, true);
});

test('the get-started link has a real upload-section target before JavaScript', () => {
  const href = html.match(/href="([^"]+)"[^>]*>Let's get started/)[1];
  assert.ok(html.includes(`id="${href.slice(1)}"`), 'The CTA fragment must target an actual section.');
});

test('activating an already-selected studio link still opens the upload screen', async () => {
  const harness = bootWithBlockedStorage();
  await harness.boot;
  harness.nodes.get('home-view').hidden = false;
  harness.nodes.get('studio').hidden = true;
  let prevented = false;
  await harness.documentEvents.get('click')({
    target: { closest: selector => selector === 'a[href="#studio"]' ? {} : null },
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented,true);
  assert.equal(harness.nodes.get('studio').hidden,false);
  assert.equal(harness.nodes.get('home-view').hidden,true);
});
