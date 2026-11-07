// An explicitly authored entertainment rubric, not a trained attractiveness model.
// Targets describe one aesthetic preference; they are not clinical norms.
export const RUBRIC_VERSION = 'qmax-aesthetic-experiment-1';
export function estimateAesthetics(metrics = []) {
  const definitions = [
    { key: 'photo-asymmetry', label: 'Photo symmetry', target: 0, tolerance: 4, weight: .35, unit: '%' },
    { key: 'eye-spacing', label: 'Eye-spacing relationship', target: 1, tolerance: .45, weight: .25, unit: 'ratio' },
    { key: 'mid-lower', label: 'Midface / lower-face relationship', target: 1, tolerance: .45, weight: .2, unit: 'ratio' },
    { key: 'lip-balance', label: 'Upper / lower lip relationship', target: 1, tolerance: .6, weight: .2, unit: 'ratio' },
  ];
  const components = definitions.map(item => {
    const value = metrics.find(metric => metric.key === item.key)?.value;
    const available = typeof value === 'number' && Number.isFinite(value);
    return { ...item, value: available ? value : null, score: available ? Math.round(100 * Math.exp(-.5 * ((value - item.target) / item.tolerance) ** 2)) : null };
  });
  const available = components.filter(c => c.score !== null);
  const coverage = available.reduce((sum, c) => sum + c.weight, 0);
  const score = available.length < 3 ? null : Math.round((1 + 9 * available.reduce((sum, c) => sum + c.score / 100 * c.weight, 0) / coverage) * 10) / 10;
  return { rubricVersion: RUBRIC_VERSION, score, components, coverage: Math.round(coverage * 100), provisional: coverage < .999, trainedModel: false };
}

const links = {
  basics: ['AAD: simple skin care', 'https://www.aad.org/public/everyday-care/skin-care-basics/care/skin-care-budget'],
  sun: ['AAD: choosing sunscreen', 'https://www.aad.org/public/everyday-care/sun-protection/shade-clothing-sunscreen/how-to-select-sunscreen'],
  oily: ['AAD: oily skin care', 'https://www.aad.org/public/everyday-care/skin-care-basics/dry/oily-skin'],
  acne: ['AAD: acne self-care', 'https://www.aad.org/public/diseases/acne/skin-care/tips'],
  pregnancy: ['AAD: pregnancy and skin care', 'https://www.aad.org/public/everyday-care/skin-care-secrets/routine/pregnancy-skin-care'],
  retinoids: ['AAD: retinoids and retinol', 'https://www.aad.org/public/everyday-care/skin-care-secrets/anti-aging/retinoid-retinol/'],
  pigment: ['AAD: sun protection FAQ', 'https://www.aad.org/media/stats-sunscreen'],
  dry: ['AAD: caring for dry skin', 'https://www.aad.org/public/everyday-care/skin-care-basics/dry/dermatologists-tips-relieve-dry-skin'],
  sensitivity: ['AAD: testing skin-care products', 'https://www.aad.org/public/everyday-care/skin-care-secrets/prevent-skin-problems/test-skin-care-products'],
};
export function createSkinRoutine(profile = {}) {
  const skin = ['unknown', 'normal', 'dry', 'oily', 'sensitive'].includes(profile.skin) ? profile.skin : 'unknown';
  const concern = ['basics', 'breakouts', 'dryness', 'spots'].includes(profile.concern) ? profile.concern : 'basics';
  const caution = profile.caution === true;
  const cleanser = skin === 'oily' ? 'Use a mild cleanser; avoid alcohol-based products and harsh scrubbing.' : 'Cleanse gently with your fingertips. Avoid scrubbing or washing more than twice daily and after sweating.';
  const moisturizer = skin === 'dry' || concern === 'dryness' ? 'Apply moisturizer while skin is slightly damp. A simple cream can be a useful starting point for dry skin.' : skin === 'oily' ? 'Apply a light, non-comedogenic moisturizer after cleansing; oily skin can still need hydration.' : skin === 'sensitive' ? 'Choose a simple, fragrance-free moisturizer. Stop a new product if it causes burning or persistent irritation.' : 'Apply a moisturizer suited to how your skin feels; expensive products are not necessary.';
  const moistureSource = skin === 'dry' || concern === 'dryness' ? links.dry : skin === 'sensitive' ? links.sensitivity : skin === 'oily' ? links.oily : links.basics;
  const morning = [
    { title: 'Gentle cleanse', text: cleanser, source: skin === 'oily' ? links.oily : links.basics },
    { title: 'Moisturize', text: moisturizer, source: moistureSource },
    { title: 'Sun protection', text: 'Use broad-spectrum, water-resistant SPF 30+ on exposed skin outdoors. Seek shade and use protective clothing; follow the product’s reapplication directions.', source: links.sun },
  ];
  const evening = [
    { title: 'Remove makeup and cleanse', text: 'Remove makeup before bed and cleanse gently. Keep the routine simple rather than layering many new products.', source: links.basics },
    { title: 'Moisturize again', text: moisturizer, source: moistureSource },
  ];
  const focus = concern === 'breakouts'
    ? { title: 'If you report breakouts', text: 'Avoid picking and choose products labeled non-comedogenic. Persistent, painful, or scarring breakouts deserve a dermatologist’s assessment.', source: links.acne }
    : concern === 'spots'
    ? { title: 'If you report uneven pigmentation', text: 'Consistent sun protection matters. A tinted sunscreen containing iron oxides may also protect against visible light that can worsen dark marks.', source: links.pigment }
    : concern === 'dryness'
    ? { title: 'If your skin feels dry', text: 'Prioritize a gentle cleanser and moisturizer. Persistent itching, cracking, or irritation needs an assessment rather than stronger exfoliation.', source: links.dry }
    : { title: 'Build a routine you can repeat', text: 'Start with cleansing, moisturizing, and sun protection. Introduce changes slowly so you can tell what your skin tolerates.', source: links.basics };
  const treatment = caution
    ? { title: 'Check ingredients with your clinician', text: 'If you are pregnant or trying to become pregnant, avoid retinoids. During pregnancy or breastfeeding, or while using prescribed skin care, ask your clinician before adding treatment ingredients.', source: links.pregnancy }
    : { title: 'About treatment ingredients', text: 'A dermatologist can discuss options such as retinoids for some acne or pigmentation concerns. These are not automatically recommended from your photo; suitability and irritation risk differ.', source: links.retinoids };
  return { skin, concern, caution, morning, evening, focus, treatment, origin: 'self-reported preferences, not image diagnosis' };
}

const safe = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cite = source => `<a class="care-source" target="_blank" rel="noreferrer" href="${source[1]}">${source[0]} ↗</a>`;
export function mountGuidance(container, report, onSave) {
  const estimate = estimateAesthetics(report.metrics);
  const profile = { skin: 'unknown', concern: 'basics', caution: false, ...report.skinProfile };
  container.innerHTML = `<span class="eyebrow">YOUR SCORE & DAILY CARE</span><h2>More context.<br><em>Useful next steps.</em></h2><p class="lead">Explore an optional aesthetic estimate, then build a daily skin-care routine from the concerns you choose.</p><div class="aesthetic-card"><div><span class="eyebrow">OPTIONAL · EXPERIMENTAL AESTHETIC SCORE</span><h3>A different lens on your proportions.</h3><p>This is QMax’s rule-based aesthetic experiment, not a trained attractiveness model, medical finding, or population ranking. It uses four stated geometric preferences; another rubric could give a different number.</p><label class="check-label"><input id="score-consent" type="checkbox"><span>I am 18+ and want to see this experimental score for my photo.</span></label><button class="button dark" id="show-score" disabled>Show experimental estimate ↗</button></div><div id="aesthetic-result"><span class="score-placeholder">? <small>/ 10</small></span><p>Optional. Your report works without it.</p></div></div><details class="score-method"><summary>See the exact scoring method and its limits</summary><p>Each component uses a bell-shaped preference curve: 100 × exp(−0.5 × ((measurement − target) / tolerance)²). The weighted mean is mapped to 1–10. The targets and weights below are QMax-authored aesthetic preferences, not established ideals, clinical norms, or another app’s algorithm.</p><table class="comparison-table"><thead><tr><th>Component</th><th>Target</th><th>Tolerance</th><th>Weight</th></tr></thead><tbody>${estimate.components.map(c => `<tr><td>${safe(c.label)}</td><td>${c.target} ${c.unit}</td><td>${c.tolerance}</td><td>${Math.round(c.weight * 100)}%</td></tr>`).join('')}</tbody></table><p>Missing components are omitted and the remaining weights are normalized. At least three components are required. A provisional score uses fewer than all four. Camera pose and expression affect these measurements. Skin, hair, personality, ethnicity, and health are not scored. This score has not been calibrated against human attractiveness judgments.</p></details><section class="care-section"><span class="eyebrow">GUIDANCE BASED ON WHAT YOU TELL US</span><h2>Your daily <em>care routine.</em></h2><p class="lead">General dermatology guidance, selected from your answers. Your face mesh does not diagnose acne, pigmentation, or skin type.</p><div class="care-inputs"><label for="skin-type">How does your skin usually feel?<select id="skin-type"><option value="unknown">I'm not sure</option><option value="normal">Usually comfortable / balanced</option><option value="dry">Dry or tight</option><option value="oily">Often oily</option><option value="sensitive">Often sensitive or irritated</option></select></label><label for="skin-concern">What would you like guidance on?<select id="skin-concern"><option value="basics">A simple everyday routine</option><option value="breakouts">Breakouts I have noticed</option><option value="dryness">Dryness I have noticed</option><option value="spots">Dark marks / uneven tone I have noticed</option></select></label></div><label class="check-label care-caution"><input id="care-caution" type="checkbox"><span>I’m pregnant, trying to become pregnant, breastfeeding, or using prescribed skin treatments.</span></label><div id="care-routine"></div><p class="photo-notes">This is educational skin care, not a diagnosis or prescription. If symptoms are persistent, worsening, painful, or scarring, seek a qualified clinician. New or changing spots should be checked by a clinician rather than scored by this app.</p></section>`;
  const consent = container.querySelector('#score-consent');
  const button = container.querySelector('#show-score');
  consent.addEventListener('change', () => { button.disabled = !consent.checked; });
  button.addEventListener('click', async () => {
    if (!consent.checked) return;
    const target = container.querySelector('#aesthetic-result');
    target.innerHTML = estimate.score === null ? '<h3>More reliable measurements needed</h3><p>Use a clear, frontal photo. At least three rubric components are needed; unavailable measurements are never replaced with invented values.</p>' : `<span class="aesthetic-number">${estimate.score.toFixed(1)}<small>/ 10</small></span><span class="score-badge">${estimate.provisional ? 'PROVISIONAL RUBRIC SCORE' : 'EXPERIMENTAL RUBRIC SCORE'}</span><p>${estimate.components.filter(c => c.score !== null).length} of 4 components · not a percentile</p><div class="score-components">${estimate.components.map(c => `<div><span>${safe(c.label)}</span><strong>${c.score === null ? 'Not available' : `${c.score}/100`}</strong></div>`).join('')}</div>`;
    report.aestheticExperiment = estimate;
    if (report.saved) await onSave();
  });
  container.querySelector('#skin-type').value = profile.skin;
  container.querySelector('#skin-concern').value = profile.concern;
  container.querySelector('#care-caution').checked = profile.caution;
  function renderRoutine() {
    const routine = createSkinRoutine(profile);
    const step = (item, index) => `<article class="care-step"><span>0${index + 1}</span><div><h4>${safe(item.title)}</h4><p>${safe(item.text)}</p>${cite(item.source)}</div></article>`;
    container.querySelector('#care-routine').innerHTML = `<div class="care-columns"><section><h3>AM <span>A simple start</span></h3>${routine.morning.map(step).join('')}</section><section><h3>PM <span>A gentle reset</span></h3>${routine.evening.map(step).join('')}</section></div><div class="care-focus"><article><h3>${safe(routine.focus.title)}</h3><p>${safe(routine.focus.text)}</p>${cite(routine.focus.source)}</article><article><h3>${safe(routine.treatment.title)}</h3><p>${safe(routine.treatment.text)}</p>${cite(routine.treatment.source)}</article></div>`;
    report.skinProfile = { ...profile };
    report.skinRoutine = routine;
  }
  for (const id of ['skin-type', 'skin-concern', 'care-caution']) container.querySelector(`#${id}`).addEventListener('change', async () => {
    profile.skin = container.querySelector('#skin-type').value;
    profile.concern = container.querySelector('#skin-concern').value;
    profile.caution = container.querySelector('#care-caution').checked;
    renderRoutine(); if (report.saved) await onSave();
  });
  renderRoutine();
}
