import { buildInsights, buildPlan } from './measurements.js';
import { saveReport, getReport, deleteReport, listReports } from './storage.js';
import { mountVisualStudio } from './visualize.js';
import { mountGuidance } from './guidance.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const dateLabel = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmt = metric => metric.value === null ? '—' : metric.value.toFixed(metric.unit === '%' ? 1 : 2);
const views = ['home', 'studio', 'result', 'reports', 'methodology'];
let selectedImage, analysisWorker, analysisTimer, pendingId, activeReport, activeTab = 'overview', overlay = 'guides';
let archive = [], toastTimer, routeRevision = 0, visualCleanup;

function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
function showView(name) {
  for (const view of views) $(view === 'studio' ? '#studio' : `#${view}-view`).hidden = view !== name;
  document.title = `${({ home: 'A clearer picture of you.', studio: 'Your analysis studio', result: 'Your facial report', reports: 'Your private reports', methodology: 'Methods & privacy' })[name]} — QMax`;
}
async function refreshArchive() {
  try { archive = await listReports(); $('#report-count').textContent = archive.length; }
  catch { archive = []; $('#report-count').textContent = '0'; }
}
async function route() {
  const revision = ++routeRevision;
  const hash = location.hash.slice(1) || 'home';
  if (pendingId && hash !== 'studio') cancelAnalysis(false);
  if (visualCleanup) { visualCleanup(); visualCleanup = undefined; }
  if (hash.startsWith('report/')) {
    const id = hash.slice(7);
    if (!activeReport || activeReport.id !== id) {
      try { activeReport = await getReport(id); } catch { activeReport = undefined; }
    }
    if (revision !== routeRevision) return;
    if (!activeReport) { showView('reports'); await renderArchive(); toast('This report is not stored in this browser.'); return; }
    await refreshArchive();
    if (revision !== routeRevision) return;
    showView('result'); renderReport(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); return;
  }
  if (hash === 'reports') { showView('reports'); await renderArchive(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); return; }
  if (hash === 'studio' || hash === 'methodology') { showView(hash); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); return; }
  showView('home');
  if (hash !== 'home') document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}
function setError(message) {
  const element = $('#analysis-error'); element.textContent = message; element.hidden = !message;
}
async function preparePhoto(file, sample = false) {
  setError('');
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP photo. HEIC and animated images are not supported.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a photo smaller than 15 MB.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (Math.min(bitmap.width, bitmap.height) < 240) throw new Error('The photo is too small. Use an image at least 240 pixels on each side, preferably larger.');
    if (bitmap.width * bitmap.height > 80_000_000) throw new Error('This photo is unusually large. Resize it to under 80 megapixels first.');
    const scale = Math.min(1, 1500 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#f0f0ea'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL('image/jpeg', .9);
    if (selectedImage?.url) URL.revokeObjectURL(selectedImage.url);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .92));
    if (!blob) throw new Error('The browser could not prepare this photo. Try a different image.');
    selectedImage = { blob, photo, sample, width: canvas.width, height: canvas.height, url: URL.createObjectURL(blob) };
    $('#upload-preview').src = selectedImage.url; $('#upload-preview').hidden = false;
    $('#upload-empty').hidden = true; $('#change-photo').hidden = false;
    if (sample) { $('#permission').checked = true; $('#report-name').value = 'Sample portrait'; }
  } finally { bitmap.close(); }
}
async function sample() {
  if (pendingId) return;
  location.hash = 'studio';
  try {
    const response = await fetch(new URL('./assets/portrait.jpg', import.meta.url));
    if (!response.ok) throw new Error('The sample portrait could not load. Please choose a photo instead.');
    await preparePhoto(new File([await response.blob()], 'sample.jpg', { type: 'image/jpeg' }), true);
    await analyze();
  } catch (error) { setError(error.message); }
}
function cancelAnalysis(showMessage = true) {
  if (!pendingId) return;
  analysisWorker?.terminate(); analysisWorker = undefined; pendingId = undefined;
  clearTimeout(analysisTimer); $('#analysis-progress').hidden = true; $('#analyze-button').disabled = false;
  if (showMessage) toast('Analysis cancelled. Your photo has not been uploaded.');
}
async function analyze() {
  if (pendingId) return;
  setError('');
  if (!selectedImage) { setError('Choose a photo first, or try the sample portrait.'); return; }
  if (!$('#permission').checked) { setError('Confirm that you have permission to use this photo.'); $('#permission').focus(); return; }
  if (!globalThis.Worker || !globalThis.createImageBitmap || !globalThis.WebAssembly || !globalThis.OffscreenCanvas) { setError('QMax needs a current browser with WebAssembly, web workers, and OffscreenCanvas. Try a current Chrome, Edge, Firefox, or Safari release.'); return; }
  const source = selectedImage;
  const requestId = crypto.randomUUID(); pendingId = requestId;
  const title = $('#report-name').value.trim() || 'My facial analysis';
  const goal = $('input[name=goal]:checked').value;
  const shouldSave = $('#save-report').checked && !source.sample;
  $('#analysis-progress').hidden = false; $('#analyze-button').disabled = true;
  $('#progress-title').textContent = 'Preparing your photo…'; $('#progress-detail').textContent = 'The photo is staying on this device.';
  try {
    const bitmap = await createImageBitmap(source.blob);
    if (pendingId !== requestId) { bitmap.close(); return; }
    if (!analysisWorker) analysisWorker = new Worker(new URL('./analysis-worker.js', import.meta.url));
    analysisWorker.onmessage = async ({ data }) => {
      if (pendingId !== data.id) return;
      if (data.type === 'status') { $('#progress-title').textContent = data.title; $('#progress-detail').textContent = data.detail; return; }
      clearTimeout(analysisTimer); pendingId = undefined;
      $('#analysis-progress').hidden = true; $('#analyze-button').disabled = false;
      if (data.type === 'error') { setError(data.message); return; }
      if (data.type !== 'result') return;
      const result = data.result;
      activeReport = { schema: 'qmax.report.v1', id: crypto.randomUUID(), createdAt: new Date().toISOString(), title, goal, sample: source.sample, ...result, photo: source.photo, plan: buildPlan(goal, result.metrics), completedTasks: [], saved: false };
      if (shouldSave) {
        try { activeReport.saved = true; await saveReport(compactForStorage(activeReport)); }
        catch { activeReport.saved = false; toast('Your report is ready, but local saving failed. Export it to keep a copy.'); }
      }
      activeTab = 'overview'; location.hash = `report/${activeReport.id}`;
    };
    analysisWorker.onerror = event => {
      if (pendingId !== requestId) return;
      event.preventDefault(); cancelAnalysis(false);
      setError('The local analysis engine could not start. Check that all model files are available and try a current browser. No photo was uploaded.');
    };
    analysisTimer = setTimeout(() => {
      if (pendingId !== requestId) return;
      cancelAnalysis(false); setError('The local model took too long to respond. Try a smaller photo or reload the page. No photo was uploaded.');
    }, 90000);
    analysisWorker.postMessage({ id: requestId, bitmap }, [bitmap]);
  } catch (error) { cancelAnalysis(false); setError(error.message); }
}
function compactForStorage(report) {
  const image = $('#report-photo');
  if (image?.complete && image.naturalWidth && image.src === report.photo) {
    const canvas = document.createElement('canvas'); const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return { ...report, photo: canvas.toDataURL('image/jpeg', .85), saved: true };
  }
  // The analysis photo has already been reduced to at most 1500px.
  return { ...report, saved: true };
}
function metricCard(metric) {
  return `<article class="metric-card"><span class="metric-category">${escape(metric.category)}</span><strong class="metric-value">${fmt(metric)}<small>${metric.value === null ? '' : escape(metric.unit)}</small></strong><h3>${escape(metric.label)}</h3>${metric.value === null ? `<p class="photo-notes">${escape(metric.unavailable)}</p>` : ''}<details><summary>How it is measured</summary><p>${escape(metric.explanation)}</p></details></article>`;
}
function renderReport() {
  const report = activeReport;
  const tabs = [['overview', 'Overview'], ['features', 'Feature analysis'], ['plan', 'Your exploration plan'], ['visualize', 'Appearance studio'], ['guidance', 'Score & skin care'], ['comparison', 'Compare reports']];
  $('#result-view').innerHTML = `<a class="back-link" href="#reports">← My reports</a><div class="print-heading">QMAX / PRIVATE PHOTO ANALYSIS</div><div class="result-title-row"><div><span class="eyebrow">${report.sample ? 'SAMPLE PORTRAIT · REAL MODEL OUTPUT' : 'YOUR PERSONAL FACIAL REPORT'}</span><h1>${escape(report.title)}</h1><p>${dateLabel(report.createdAt)} · ${report.landmarkCount} landmarks detected · ${report.metrics.length} photo measurements</p></div><div class="report-actions"><button class="button outline" data-action="save" ${report.saved ? 'disabled' : ''}>${report.saved ? 'Saved on this device ✓' : 'Save on this device'}</button><button class="button outline" data-action="export">Export data ↓</button><button class="button dark" data-action="print">Print / PDF ↗</button></div></div>${report.sample ? '<div class="notice">You are exploring an example portrait. These are real measurements from the local model, not your personal results. <a class="underlined" href="#studio">Analyze your own photo ↗</a></div>' : ''}<div class="result-tabs" role="tablist" aria-label="Report sections">${tabs.map(([key, label]) => `<button id="tab-${key}" role="tab" data-tab="${key}" aria-controls="panel-${key}" aria-selected="${key === activeTab}" tabindex="${key === activeTab ? '0' : '-1'}">${label}</button>`).join('')}</div>
    <div id="panel-overview" class="report-panel" role="tabpanel" aria-labelledby="tab-overview" ${activeTab === 'overview' ? '' : 'hidden'}><div class="report-layout"><div class="face-panel"><div class="face-canvas-wrap"><img id="report-photo" src="${report.photo}" alt="The portrait used for this analysis"><canvas id="face-canvas" aria-label="Detected facial landmark overlay"></canvas></div><div class="overlay-controls" aria-label="Photo overlay"><button data-overlay="photo" aria-pressed="${overlay === 'photo'}">Photo</button><button data-overlay="dots" aria-pressed="${overlay === 'dots'}">Landmarks</button><button data-overlay="guides" aria-pressed="${overlay === 'guides'}">Feature map</button></div><p>${report.landmarkCount} points detected by MediaPipe. Overlay follows the model's actual output.</p></div><div><div class="report-summary"><span class="eyebrow">A MAP, NOT A JUDGMENT.</span><h2>A little more detail.<br><em>The same unique you.</em></h2><p>These ratios describe visible geometry in this photo. Explore the measurements, then choose what interests you.</p></div><div class="metric-grid">${report.metrics.slice(0, 8).map(metricCard).join('')}</div><div class="photo-notes"><h3>Your capture notes</h3><p>${report.warnings.length ? 'Keep these limitations in mind when reading your results.' : 'This photo passed the basic framing and pose checks. That does not guarantee measurement accuracy.'}</p><ul>${report.warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}<li>Head roll: ${report.quality.rollDegrees}°. In-plane rotation corrected before measurement.</li><li>Camera distance, expression, perspective, and detection error can affect every ratio.</li></ul></div></div></div></div>
    <div id="panel-features" class="report-panel" role="tabpanel" aria-labelledby="tab-features" ${activeTab === 'features' ? '' : 'hidden'}><span class="eyebrow">FROM THE WHOLE TO THE DETAILS</span><h2>Your features, <em>in context.</em></h2><p class="lead">Every number has a method. Explore the relationships without comparing them to an invented ideal.</p><div class="metric-grid feature-metrics">${report.metrics.map(metricCard).join('')}</div><div class="insights">${buildInsights(report.metrics).map((insight, index) => `<article class="insight-card"><span class="insight-number">0${index + 1}</span><div><h3>${escape(insight.title)}</h3><p>${escape(insight.text)}</p></div></article>`).join('')}</div></div>
    <div id="panel-plan" class="report-panel" role="tabpanel" aria-labelledby="tab-plan" ${activeTab === 'plan' ? '' : 'hidden'}><span class="eyebrow">SMALL EXPERIMENTS. YOUR OWN PREFERENCES.</span><h2>Your next <em>little steps.</em></h2><p class="lead">A styling and observation checklist based on your chosen goal. It's an exploration guide, not a medical protocol or a promise of change.</p><div class="plan-progress"><progress max="${report.plan.length}" value="${report.completedTasks.length}"></progress><span id="plan-progress-text">${report.completedTasks.length} of ${report.plan.length} explored</span></div>${report.plan.map(task => `<label class="plan-card"><input type="checkbox" data-task="${escape(task.id)}" ${report.completedTasks.includes(task.id) ? 'checked' : ''}><span><h3>${escape(task.title)}</h3><p>${escape(task.text)}</p></span></label>`).join('')}<p class="photo-notes">${report.saved ? 'Your checklist is saved with this report in this browser.' : 'Save this report to keep your checklist between visits.'}</p></div>
    <div id="panel-visualize" class="report-panel" role="tabpanel" aria-labelledby="tab-visualize" ${activeTab === 'visualize' ? '' : 'hidden'}></div>
    <div id="panel-guidance" class="report-panel" role="tabpanel" aria-labelledby="tab-guidance" ${activeTab === 'guidance' ? '' : 'hidden'}></div>
    <div id="panel-comparison" class="report-panel" role="tabpanel" aria-labelledby="tab-comparison" ${activeTab === 'comparison' ? '' : 'hidden'}><span class="eyebrow">THE SAME FACE. A DIFFERENT CAPTURE.</span><h2>Perspective <em>over time.</em></h2><p class="lead">Compare two reports with the same method. Changes in a ratio do not automatically mean improvement or a physical change.</p><div class="comparison-controls"><label for="compare-select">Compare this report with</label><select id="compare-select"><option value="">Choose a saved report</option>${archive.filter(r => r.id !== report.id && r.methodVersion === report.methodVersion).map(r => `<option value="${escape(r.id)}">${escape(r.title)}${r.sample ? ' (sample)' : ''} · ${dateLabel(r.createdAt)}</option>`).join('')}</select></div><div id="compare-content">${archive.filter(r => r.id !== report.id).length ? '<p class="photo-notes">Choose another saved report to see its photo and measurements alongside this one.</p>' : '<div class="empty-state"><h2>One photo is a beginning.</h2><p>Save this report, then analyze another photo using the same setup. You can compare the two here.</p><a href="#studio" class="button dark">Analyze another photo ↗</a></div>'}</div></div>
    <p class="report-disclaimer">QMax is an independent experimental project. Photo measurements are estimates. The optional aesthetic rubric is unvalidated; skin-care guidance is educational and based on your answers. No clinical or demographic norms are used. <a class="underlined" href="#methodology">Read the methodology ↗</a></p>`;
  const photo = $('#report-photo'); if (photo.complete) drawOverlay(); else photo.addEventListener('load', drawOverlay, { once: true });
  if (activeTab === 'visualize') visualCleanup = mountVisualStudio($('#panel-visualize'), report, toast);
  if (activeTab === 'guidance') mountGuidance($('#panel-guidance'), report, persistCurrent);
}
function drawOverlay() {
  const canvas = $('#face-canvas'), image = $('#report-photo');
  if (!canvas || !image?.naturalWidth || !activeReport) return;
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d'); const width = canvas.width, height = canvas.height;
  if (overlay === 'photo') return;
  const points = activeReport.landmarks;
  context.strokeStyle = '#def5c4'; context.fillStyle = '#eeffd9'; context.lineWidth = Math.max(1, width / 700);
  if (overlay === 'guides') {
    context.globalAlpha = .8;
    for (const [a, b] of activeReport.connections) {
      context.beginPath(); context.moveTo(points[a].x * width, points[a].y * height); context.lineTo(points[b].x * width, points[b].y * height); context.stroke();
    }
    context.setLineDash([width / 70, width / 100]);context.globalAlpha = .55;
    for (const [a, b] of [[10, 152], [234, 454], [33, 263], [61, 291]]) { context.beginPath();context.moveTo(points[a].x * width, points[a].y * height);context.lineTo(points[b].x * width, points[b].y * height);context.stroke(); }
  } else {
    context.globalAlpha = .8;
    for (const point of points) { context.beginPath();context.arc(point.x * width, point.y * height, Math.max(1.2, width / 450), 0, Math.PI * 2);context.fill(); }
  }
}
function selectTab(tab) {
  const choices = ['overview', 'features', 'plan', 'visualize', 'guidance', 'comparison'];
  if (!choices.includes(tab) || !activeReport) return;
  activeTab = tab;
  if (visualCleanup) { visualCleanup(); visualCleanup = undefined; }
  for (const key of choices) { const button = $(`#tab-${key}`); button.setAttribute('aria-selected', key === tab); button.tabIndex = key === tab ? 0 : -1; $(`#panel-${key}`).hidden = key !== tab; }
  if (tab === 'overview') drawOverlay();
  if (tab === 'visualize') visualCleanup = mountVisualStudio($('#panel-visualize'), activeReport, toast);
  if (tab === 'guidance') mountGuidance($('#panel-guidance'), activeReport, persistCurrent);
}
async function persistCurrent() {
  if (!activeReport) return;
  try { const record = compactForStorage(activeReport); await saveReport(record); activeReport.saved = true; await refreshArchive(); return true; }
  catch { toast('Local saving failed. Export your report to keep a copy.'); return false; }
}
async function renderArchive() {
  await refreshArchive();
  $('#reports-list').innerHTML = archive.length ? `<div class="archive-grid">${archive.map(report => `<article class="archive-card"><a href="#report/${escape(report.id)}" class="archive-photo"><img src="${report.photo}" alt="Saved portrait for ${escape(report.title)}" loading="lazy"></a><div class="archive-body"><span class="eyebrow">${report.sample ? 'SAMPLE PORTRAIT' : 'PRIVATE PHOTO REPORT'}</span><h2>${escape(report.title)}</h2><p>${dateLabel(report.createdAt)} · ${report.metrics.length} measurements</p><div class="report-actions"><a class="button dark" href="#report/${escape(report.id)}">Open report ↗</a><button class="delete-link" data-delete="${escape(report.id)}">Remove</button></div></div></article>`).join('')}</div><p class="photo-notes storage-message">Stored only in this browser. Export reports you want to keep before clearing website data.</p>` : '<div class="empty-state"><span class="empty-icon">◌</span><h2>Your story starts here.</h2><p>Saved reports will appear here. Your photos stay on this device, and you decide what to keep.</p><a class="button dark" href="#studio">Start my first analysis ↗</a></div>';
}
function exportReport() {
  if (!activeReport) return;
  const { photo, saved, ...report } = activeReport;
  const blob = new Blob([JSON.stringify({ ...report, exportNotes: 'Photo omitted. Contains facial geometry and any optional self-reported skin-care preferences; handle as personal data.' }, null, 2)], { type: 'application/json' });
  download(blob, `qmax-report-${activeReport.createdAt.slice(0, 10)}.json`);
  toast('Report exported. The photo is omitted; measurements and any care preferences are included.');
}
export function download(blob, filename) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function showComparison(id) {
  const target = $('#compare-content');
  if (!id) { target.innerHTML = ''; return; }
  let other;
  try { other = await getReport(id); } catch { toast('The saved report could not load.'); return; }
  if (!other || !activeReport || other.methodVersion !== activeReport.methodVersion) { target.textContent = 'This report is unavailable or uses a different measurement method.'; return; }
  target.innerHTML = `<div class="comparison-photo-row"><div><img src="${other.photo}" alt="Earlier comparison portrait"><p>${escape(other.title)} · ${dateLabel(other.createdAt)}</p></div><div><img src="${activeReport.photo}" alt="Current comparison portrait"><p>${escape(activeReport.title)} · ${dateLabel(activeReport.createdAt)}</p></div></div><div class="notice">Differences can reflect framing, pose, expression, and model error. They are not automatically physical changes or improvements.</div><table class="comparison-table"><thead><tr><th>Measurement</th><th>Selected report</th><th>This report</th><th>Difference</th></tr></thead><tbody>${activeReport.metrics.map(metric => {
    const before = other.metrics.find(m => m.key === metric.key);const delta = before?.value !== null && before?.value !== undefined && metric.value !== null ? metric.value - before.value : null;
    return `<tr><td>${escape(metric.label)}</td><td>${before ? fmt(before) : '—'} ${before?.value !== null ? escape(before?.unit || '') : ''}</td><td>${fmt(metric)} ${metric.value !== null ? escape(metric.unit) : ''}</td><td>${delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}${metric.unit === '%' ? ' pp' : ''}`}</td></tr>`;
  }).join('')}</tbody></table>`;
}
async function removeReport(id) {
  const dialog = $('#delete-dialog'); dialog.returnValue = 'cancel'; dialog.showModal();
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'delete') return;
    try { await deleteReport(id); if (activeReport?.id === id) { activeReport = undefined; } await renderArchive();toast('Report and saved preview removed from this browser.'); }
    catch { toast('The report could not be removed. Please try again.'); }
  }, { once: true });
}
$('#analysis-form').addEventListener('submit', event => { event.preventDefault(); analyze(); });
$('#photo-input').addEventListener('change', async event => {
  if (!event.target.files[0]) return;
  try { await preparePhoto(event.target.files[0]); $('#permission').checked = false; if ($('#report-name').value === 'Sample portrait') $('#report-name').value = ''; }
  catch (error) { setError(error.message); }
});
const dropzone = $('#dropzone');
for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.add('dragging'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove('dragging'); });
dropzone.addEventListener('drop', async event => {
  try { if (event.dataTransfer.files.length !== 1) throw new Error('Choose one photo at a time.'); await preparePhoto(event.dataTransfer.files[0]);$('#permission').checked = false;if ($('#report-name').value === 'Sample portrait') $('#report-name').value = ''; }
  catch (error) { setError(error.message); }
});
$('#cancel-analysis').addEventListener('click', () => cancelAnalysis());
document.addEventListener('click', async event => {
  const studioLink = event.target.closest('a[href="#studio"]');
  if (studioLink && location.hash === '#studio' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault(); await route(); return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'sample') { event.preventDefault(); await sample(); }
  if (action === 'save') { if (await persistCurrent()) { toast('Saved privately in this browser.'); renderReport(); } }
  if (action === 'export') exportReport();
  if (action === 'print') { toast('Choose “Save as PDF” in the print dialog to download your report.'); window.print(); }
  const tab = event.target.closest('[data-tab]')?.dataset.tab;if (tab) selectTab(tab);
  const selectedOverlay = event.target.closest('[data-overlay]')?.dataset.overlay;
  if (selectedOverlay) { overlay = selectedOverlay; for (const button of document.querySelectorAll('[data-overlay]')) button.setAttribute('aria-pressed', button.dataset.overlay === overlay); drawOverlay(); }
  const removeId = event.target.closest('[data-delete]')?.dataset.delete;if (removeId) removeReport(removeId);
});
document.addEventListener('change', async event => {
  if (event.target.matches('[data-task]') && activeReport) {
    const tasks = new Set(activeReport.completedTasks);if (event.target.checked) tasks.add(event.target.dataset.task);else tasks.delete(event.target.dataset.task);
    activeReport.completedTasks = [...tasks];
    $('#panel-plan progress').value = tasks.size; $('#plan-progress-text').textContent = `${tasks.size} of ${activeReport.plan.length} explored`;
    if (activeReport.saved) await persistCurrent();
  }
  if (event.target.id === 'compare-select') showComparison(event.target.value);
});
document.addEventListener('keydown', event => {
  if (!event.target.matches('[role=tab]')) return;
  const tabs = [...document.querySelectorAll('[role=tab]')];let index = tabs.indexOf(event.target);
  if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') index = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = tabs.length - 1;
  else return;
  event.preventDefault(); selectTab(tabs[index].dataset.tab); tabs[index].focus();
});
window.addEventListener('hashchange', route);
window.addEventListener('pagehide', () => { analysisWorker?.terminate(); if (selectedImage?.url) URL.revokeObjectURL(selectedImage.url); });
// Navigation is independent of optional local storage, which can be blocked.
await route(); void refreshArchive();
