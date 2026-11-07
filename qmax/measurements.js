// All geometry is computed in image pixels, after compensating for head roll.
// Thresholds below are capture heuristics, not clinical norms or beauty ideals.
export const METHOD_VERSION = 'qmax-photo-geometry-1';
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const round = (value, digits = 2) => {
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
};

export function measureFace(landmarks, width, height, blendshapes = []) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('The image dimensions are invalid.');
  if (!Array.isArray(landmarks) || landmarks.length < 468 || landmarks.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('The model returned incomplete facial landmarks. Try a clearer photo.');
  const pixels = landmarks.map(p => ({ x: p.x * width, y: p.y * height }));
  const leftEye = midpoint(pixels[33], pixels[133]);
  const rightEye = midpoint(pixels[362], pixels[263]);
  const center = midpoint(leftEye, rightEye);
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const points = pixels.map(p => ({
    x: (p.x - center.x) * Math.cos(roll) + (p.y - center.y) * Math.sin(roll),
    y: -(p.x - center.x) * Math.sin(roll) + (p.y - center.y) * Math.cos(roll),
  }));
  const d = (a, b) => distance(points[a], points[b]);
  const faceWidth = d(234, 454);
  const faceHeight = d(10, 152);
  const eyeWidth = mean([d(33, 133), d(362, 263)]);
  const eyeCenterDistance = distance(leftEye, rightEye);
  if (Math.min(faceWidth, faceHeight, eyeWidth, eyeCenterDistance) < 4) throw new Error('The face is too small to measure. Choose a closer, sharper photo.');
  const yawProxy = Math.abs(points[1].x) / eyeCenterDistance;
  const rollDegrees = Math.abs(roll * 180 / Math.PI);
  const pitchProxy = Math.abs(points[1].y) / Math.max(faceHeight, 1);
  if (yawProxy > .32) throw new Error('Your face is turned too far to the side for frontal measurements. Choose a straight-on photo with both eyes equally visible.');
  if (rollDegrees > 22) throw new Error('Your head is tilted too far for this analysis. Choose a photo with your head level.');
  if (faceWidth / width < .18 || faceHeight / height < .22) throw new Error('Your face is too far from the camera. Crop to your head and shoulders, then try again.');
  const warnings = [];
  if (yawProxy > .12) warnings.push('Some sideways head rotation was detected. Width ratios and the asymmetry estimate may be affected.');
  if (rollDegrees > 8) warnings.push('Your head is slightly tilted. In-plane rotation was corrected, but a level-head photo is better.');
  if (faceWidth < 220) warnings.push('The face occupies relatively few pixels. A higher-resolution portrait can improve landmark stability.');
  if (landmarks.some(p => p.x < .015 || p.x > .985 || p.y < .015 || p.y > .985)) warnings.push('Some face landmarks are near the image edge. Include your entire face in the frame.');
  const expression = Object.fromEntries(blendshapes.map(v => [v.categoryName, v.score]));
  if (Math.max(expression.mouthSmileLeft || 0, expression.mouthSmileRight || 0) > .35 || (expression.jawOpen || 0) > .22) warnings.push('A smile or open-mouth expression was detected. Mouth, eye-opening, and lower-face measurements are expression-dependent.');
  const pairIds = [[33, 263], [133, 362], [159, 386], [145, 374], [61, 291], [98, 327], [234, 454], [172, 397]];
  const midlineX = mean([points[9].x, points[1].x, points[152].x]);
  const asymmetry = mean(pairIds.map(([a, b]) => Math.hypot((points[a].x + points[b].x) - 2 * midlineX, points[a].y - points[b].y))) / faceWidth * 100;
  const metric = (key, label, value, unit, category, explanation) => ({ key, label, value: round(value), unit, category, explanation });
  const metrics = [
    metric('face-ratio', 'Visible face height / width', faceHeight / faceWidth, 'ratio', 'Overall proportions', 'Distance from the upper face-mesh boundary to the chin, divided by cheek width. The upper mesh boundary is not the hairline. A two-dimensional photo estimate, not a face-shape diagnosis.'),
    metric('eye-spacing', 'Inner-eye spacing / eye width', d(133, 362) / eyeWidth, 'ratio', 'Eyes', 'Distance between the inner eye corners, divided by the average width of both eyes. Lens perspective, occlusion, and head turn change this ratio.'),
    metric('nose-mouth', 'Nose width / mouth width', d(98, 327) / d(61, 291), 'ratio', 'Feature relationships', 'The width between estimated outer nose landmarks divided by mouth-corner width. This describes the photo and is not a comparison with an ideal.'),
    metric('mouth-face', 'Mouth width / face width', d(61, 291) / faceWidth * 100, '%', 'Mouth', 'Mouth-corner width as a percentage of cheek width. Smiling changes this measurement, so use a relaxed expression for comparisons.'),
    metric('jaw-cheek', 'Lower-jaw width / cheek width', d(172, 397) / faceWidth * 100, '%', 'Face outline', 'Width between lower-jaw surface landmarks as a percentage of cheek width. These are skin-surface landmarks, not bone measurements or a jawline quality score.'),
    metric('eye-opening', 'Eye opening / eye width', mean([d(159, 145) / d(33, 133), d(386, 374) / d(362, 263)]), 'ratio', 'Eyes', 'Average vertical eyelid opening divided by each eye’s horizontal width. Blinking, squinting, and expression influence the estimate.'),
    metric('mid-lower', 'Midface / lower-face height', d(9, 2) / d(2, 152), 'ratio', 'Vertical proportions', 'Brow-center to nose-base distance divided by nose-base to chin distance. It excludes the hairline and is not a full facial-thirds measurement.'),
    { ...metric('photo-asymmetry', 'Paired-point photo asymmetry', asymmetry, '%', 'Photo geometry', 'Mean distance between eight paired landmarks after horizontal reflection about an estimated facial midline, expressed as a percentage of cheek width. This includes pose, expression, and detection error; it is not a clinical symmetry score.'), ...(yawProxy > .12 ? { value: null, unavailable: 'Not reported because head turn makes this estimate unreliable.' } : {}) },
    metric('left-eye-tilt', 'Left image-side eye corner tilt', Math.atan2(points[133].y - points[33].y, Math.abs(points[133].x - points[33].x)) * 180 / Math.PI, '°', 'Eyes', 'Angle of the outer eye corner relative to the inner corner on the left side of the image, after in-plane head-roll correction. Positive means the outer corner appears higher in this image. Not a clinical canthal-tilt assessment.'),
    metric('right-eye-tilt', 'Right image-side eye corner tilt', Math.atan2(points[362].y - points[263].y, Math.abs(points[362].x - points[263].x)) * 180 / Math.PI, '°', 'Eyes', 'Angle of the outer eye corner relative to the inner corner on the right side of the image, after in-plane head-roll correction. Positive means the outer corner appears higher in this image. Not a clinical canthal-tilt assessment.'),
    metric('eye-face', 'Mean eye width / face width', eyeWidth / faceWidth * 100, '%', 'Eyes', 'Average outer-to-inner eye-corner width, as a percentage of cheek width. This measures the visible eye aperture in the photo rather than eyeball size.'),
    metric('brow-eye', 'Brow-to-eye gap / face height', mean([d(105, 159), d(334, 386)]) / faceHeight * 100, '%', 'Eyebrows', 'Mean distance from upper-brow mesh points to upper-eyelid points, as a percentage of visible face height. Brow movement and eyelid opening influence this estimate.'),
    metric('brow-span', 'Brow span / mean eye width', mean([d(70, 107), d(336, 300)]) / eyeWidth, 'ratio', 'Eyebrows', 'Average span between selected brow endpoints, divided by average eye width. The model follows a facial surface, not individual hairs, and cannot establish eyebrow density or thickness.'),
    metric('nose-height', 'Nose bridge-to-base / face height', d(168, 2) / faceHeight * 100, '%', 'Nose', 'Distance from the upper nasal bridge landmark to the estimated nose base, as a percentage of visible face height. This is not nose projection or a physical length measurement.'),
    metric('nose-face', 'Nose width / face width', d(98, 327) / faceWidth * 100, '%', 'Nose', 'Estimated outer nose width divided by cheek width. Head rotation and lens perspective can shift the estimate.'),
    metric('nose-midface', 'Nose height / midface height', d(168, 2) / d(9, 2), 'ratio', 'Nose', 'Upper nasal bridge-to-base length divided by brow-center-to-nose-base length. Both are image-space distances; no normative category is assigned.'),
    metric('lip-outline', 'Lip outline height / mouth width', d(0, 17) / d(61, 291) * 100, '%', 'Lips', 'Distance between upper and lower outer lip landmarks divided by mouth-corner width. This is an image-outline ratio, not a volume or fullness diagnosis. Mouth opening changes the result.'),
    metric('lip-balance', 'Upper / lower lip outline height', d(0, 13) / Math.max(d(14, 17), 1), 'ratio', 'Lips', 'Upper outer-to-inner lip height divided by lower inner-to-outer lip height at the center. Expression, cosmetics, visibility, and landmark placement affect this estimate.'),
    metric('philtrum', 'Nose-to-upper-lip / face height', d(2, 0) / faceHeight * 100, '%', 'Lips', 'Nose-base to upper outer lip distance as a percentage of visible face height. This is not a diagnosis of philtrum anatomy.'),
    metric('chin-height', 'Lower-lip-to-chin / face height', d(17, 152) / faceHeight * 100, '%', 'Chin', 'Lower outer lip to chin-boundary distance as a percentage of visible face height. It cannot establish chin projection or bone structure from a frontal photo.'),
    metric('lower-height', 'Nose-base-to-chin / face height', d(2, 152) / faceHeight * 100, '%', 'Vertical proportions', 'The lower image-face segment as a percentage of upper mesh-boundary-to-chin height. The top boundary is not the hairline, so this is not an anatomical facial-thirds test.'),
    metric('jaw-mouth', 'Mouth width / lower-jaw width', d(61, 291) / d(172, 397) * 100, '%', 'Face outline', 'Mouth-corner width as a percentage of the selected lower-jaw surface width. Describes this view only; it is not a harmony score.'),
  ];
  if (metrics.some(m => m.value !== null && !Number.isFinite(m.value))) throw new Error('Some landmarks could not produce stable ratios. Try a clearer, unobstructed photo.');
  return { metrics, warnings, quality: { rollDegrees: round(rollDegrees, 1), headTurnProxy: round(yawProxy, 3), pitchProxy: round(pitchProxy, 3), faceWidthPixels: round(faceWidth, 0), imageWidth: width, imageHeight: height }, methodVersion: METHOD_VERSION };
}

export function buildInsights(metrics) {
  const m = key => metrics.find(metric => metric.key === key);
  return [
    { title: 'Your face, as relationships', text: `In this photo, visible face height is ${m('face-ratio').value.toFixed(2)} times cheek width. Your lower-jaw surface width is ${m('jaw-cheek').value.toFixed(1)}% of cheek width. These are two different ways to describe the outline of your face; neither is a beauty score.` },
    { title: 'The space between features', text: `The gap between your inner eye corners is ${m('eye-spacing').value.toFixed(2)} average eye widths. Your nose width is ${m('nose-mouth').value.toFixed(2)} times your mouth width. These relationships can be useful when comparing frame sizes and how accessories sit across your face.` },
    { title: 'Expression changes the picture', text: `Your mouth spans ${m('mouth-face').value.toFixed(1)}% of cheek width in this capture. Smiling changes mouth width and cheek position. Use the same relaxed expression when you compare later photos.` },
    { title: 'A photo is one perspective', text: 'The camera sees a projection, not your full three-dimensional face. Nothing here establishes what is normal for your demographic, measures physical millimeters, or tells you which feature should change. Small differences across reports may come from the camera rather than your face.' },
  ];
}

export function buildPlan(goal, metrics) {
  const faceRatio = metrics.find(m => m.key === 'face-ratio').value;
  const eyeSpacing = metrics.find(m => m.key === 'eye-spacing').value;
  const common = { id: 'consistent-photo', title: 'Create a consistent photo setup', text: 'Use the same camera, distance, eye-level angle, lighting, and relaxed expression next time. Avoid close wide-angle selfies. Save a note about your setup.' };
  if (goal === 'styling') return [
    { id: 'silhouette', title: 'Compare two hairstyle silhouettes', text: faceRatio > 1.4 ? 'Your measured outline is taller relative to its width in this capture. If you want to explore a wider silhouette, compare some side volume against a flatter side profile. Choose by preference, not a supposed ideal.' : 'Compare a little crown height against a softer, wider silhouette. Photograph both in the same setup and decide which expression of your style feels more comfortable.' },
    { id: 'frames', title: 'Try frames in two bridge widths', text: `Your inner-eye spacing is ${eyeSpacing.toFixed(2)} eye widths in this photo. Try two bridge widths in person and compare comfort, eye placement in the lenses, and how the frames sit. A photo ratio cannot determine fit.` },
    { id: 'one-change', title: 'Change one styling detail at a time', text: 'Explore a hair part, grooming detail, or accessory. Keep the rest consistent so you can decide whether you actually like the change.' }, common,
  ];
  if (goal === 'tracking') return [common,
    { id: 'baseline', title: 'Save a baseline you can repeat', text: 'Save this report only if you are comfortable keeping a small photo preview in this browser. Export the measurements if you want a separate copy.' },
    { id: 'second-photo', title: 'Measure a second photo from the same session', text: 'This helps reveal how much the ratios move because of expression, framing, and landmark detection before interpreting any later difference.' },
    { id: 'compare', title: 'Read differences as photo differences', text: 'Use the comparison tab to inspect two reports. No increase or decrease is automatically an improvement, and small changes may be noise.' },
  ];
  return [
    { id: 'map', title: 'Explore your landmark map', text: 'Switch between the photo, landmark dots, and guide lines. Look at where the model placed the eye corners, nose, mouth, and face boundary.' },
    { id: 'read', title: 'Read the method behind one measurement', text: 'Open “How it is measured” under a result. Notice what the ratio includes and which parts of your face are outside that measurement.' },
    { id: 'styling', title: 'Pick one low-commitment styling experiment', text: 'Try a different hair part or glasses silhouette if it interests you. Personal taste matters more than matching any measurement.' }, common,
  ];
}
