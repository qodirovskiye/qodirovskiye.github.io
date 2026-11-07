const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

export function mountVisualStudio(container, report, toast) {
  let alive = true, image, originalPixels, updateTimer, scheduled = false;
  const values = { nose: 0, jaw: 0, lips: 0, tint: 0, frames: 'none', split: 50 };
  container.innerHTML = `<span class="eyebrow">YOUR IMAGE. A FEW POSSIBILITIES.</span><h2>Explore a different <em>expression.</em></h2><p class="lead">Try gentle image adjustments and glasses overlays positioned with your detected landmarks. These are local illustrations, not generated predictions or recommendations for treatment.</p><div class="visual-layout"><div><div class="visual-canvas-wrap"><img id="visual-original" src="${report.photo}" alt="Original portrait"><canvas id="visual-preview" aria-label="Illustrative appearance preview"></canvas><div class="split-line" id="split-line"></div><span class="visual-label original-label">ORIGINAL</span><span class="visual-label preview-label">ILLUSTRATION</span><span class="visual-watermark">QMAX · ILLUSTRATIVE PREVIEW</span></div><label class="split-control">Compare original / preview<input type="range" id="preview-split" min="0" max="100" value="50" aria-label="Original and preview comparison"></label><p class="photo-notes">Drag to compare. Adjustments use a two-dimensional photo; they may distort nearby features and do not establish achievable results.</p></div><div class="visual-controls"><span class="eyebrow">ILLUSTRATION CONTROLS</span><label class="range-label" for="nose-range">Nose width visualization <output id="nose-value">0%</output></label><input type="range" id="nose-range" min="-8" max="8" value="0" step="1"><label class="range-label" for="jaw-range">Lower-face width visualization <output id="jaw-value">0%</output></label><input type="range" id="jaw-range" min="-5" max="5" value="0" step="1"><label class="range-label" for="lips-range">Lip-height visualization <output id="lips-value">0%</output></label><input type="range" id="lips-range" min="-8" max="8" value="0" step="1"><label class="range-label" for="tint-range">Lip color illustration <output id="tint-value">0%</output></label><input type="range" id="tint-range" min="0" max="35" value="0" step="5"><label class="range-label" for="frames-select">Explore frame shapes</label><select id="frames-select"><option value="none">No frames</option><option value="round">Soft round frames</option><option value="rect">Slim rectangular frames</option></select><div class="notice">These controls create image variations, not a “better” face. Zero is your unmodified photo. Frame overlays do not measure prescription fit.</div><button class="button dark full" id="download-preview">Download illustration ↓</button><button class="text-button reset-preview" id="reset-preview">Reset to my original photo ↺</button></div></div>`;
  const canvas = container.querySelector('#visual-preview');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const output = document.createElement('canvas'); const out = output.getContext('2d', { willReadFrequently: true });
  function split() {
    canvas.style.clipPath = `inset(0 0 0 ${values.split}%)`;
    container.querySelector('#split-line').style.left = `${values.split}%`;
  }
  function render() {
    scheduled = false;
    if (!alive || !originalPixels) return;
    const w = output.width, h = output.height;
    const p = index => ({ x: report.landmarks[index].x * w, y: report.landmarks[index].y * h });
    const d = (a, b) => Math.hypot(p(a).x - p(b).x, p(a).y - p(b).y);
    const faceWidth = d(234, 454), mouthWidth = d(61, 291);
    const warps = [];
    if (values.nose) warps.push({ x: p(1).x, y: (p(168).y + p(2).y) / 2, rx: d(98, 327) * 1.3, ry: d(168, 2) * .8, sx: values.nose / 100, sy: 0 });
    if (values.jaw) warps.push({ x: p(152).x, y: (p(2).y + p(152).y) / 2 + d(2, 152) * .2, rx: faceWidth * .65, ry: d(2, 152) * .8, sx: values.jaw / 100, sy: 0 });
    if (values.lips) warps.push({ x: (p(61).x + p(291).x) / 2, y: (p(0).y + p(17).y) / 2, rx: mouthWidth * .75, ry: Math.max(d(0, 17) * 1.8, 12), sx: 0, sy: values.lips / 100 });
    if (!warps.length) out.putImageData(originalPixels, 0, 0);
    else {
      const result = new ImageData(w, h), src = originalPixels.data, dest = result.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let sx = x, sy = y;
        for (const warp of warps) {
          const dx = x - warp.x, dy = y - warp.y;
          const radius = dx * dx / (warp.rx * warp.rx) + dy * dy / (warp.ry * warp.ry);
          if (radius < 1) { const weight = (1 - radius) ** 2; sx += dx * (1 / (1 + warp.sx) - 1) * weight; sy += dy * (1 / (1 + warp.sy) - 1) * weight; }
        }
        sx = Math.max(0, Math.min(w - 1.001, sx)); sy = Math.max(0, Math.min(h - 1.001, sy));
        const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
        const i = (y * w + x) * 4, a = (y0 * w + x0) * 4, b = a + 4, c = a + w * 4, e = c + 4;
        for (let channel = 0; channel < 3; channel++) dest[i + channel] = src[a + channel] * (1-fx)*(1-fy) + src[b+channel]*fx*(1-fy) + src[c+channel]*(1-fx)*fy + src[e+channel]*fx*fy;
        dest[i + 3] = 255;
      }
      out.putImageData(result, 0, 0);
    }
    if (values.tint) {
      // A transparent color overlay follows the outer lip polygon. It is not skin analysis.
      const lips = [61,40,37,0,267,270,291,321,314,17,84,91];
      out.save();out.globalAlpha = values.tint / 100;out.fillStyle = '#a94450';out.beginPath();
      lips.forEach((index, i) => { const point = p(index);i ? out.lineTo(point.x, point.y) : out.moveTo(point.x, point.y); });out.closePath();out.fill();out.restore();
    }
    if (values.frames !== 'none') {
      const eyeA = { x: (p(33).x+p(133).x)/2, y: (p(33).y+p(133).y)/2 }, eyeB = { x: (p(362).x+p(263).x)/2, y: (p(362).y+p(263).y)/2 };
      const angle = Math.atan2(eyeB.y-eyeA.y,eyeB.x-eyeA.x); const eyeW = (d(33,133)+d(263,362))/2;
      out.save();out.strokeStyle = '#292d29';out.lineWidth = Math.max(2,w/250);out.fillStyle = '#b8d3ca18';
      for (const eye of [eyeA, eyeB]) {out.save();out.translate(eye.x,eye.y+eyeW*.06);out.rotate(angle);out.beginPath();if(values.frames==='round')out.ellipse(0,0,eyeW*.82,eyeW*.7,0,0,Math.PI*2);else out.roundRect(-eyeW*.84,-eyeW*.49,eyeW*1.68,eyeW*1.05,eyeW*.16);out.fill();out.stroke();out.restore();}
      out.beginPath();out.moveTo(eyeA.x+eyeW*.82,eyeA.y);out.quadraticCurveTo((eyeA.x+eyeB.x)/2,(eyeA.y+eyeB.y)/2-eyeW*.15,eyeB.x-eyeW*.82,eyeB.y);out.stroke();out.restore();
    }
    context.clearRect(0,0,w,h); context.drawImage(output,0,0);split();
  }
  function schedule() {clearTimeout(updateTimer);updateTimer=setTimeout(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(render);}},35);}
  image = new Image();
  image.onload = () => {
    if (!alive) return;
    const scale = Math.min(1, 850 / Math.max(image.naturalWidth, image.naturalHeight));
    output.width = canvas.width = Math.round(image.naturalWidth * scale);output.height = canvas.height = Math.round(image.naturalHeight * scale);
    out.drawImage(image,0,0,output.width,output.height);originalPixels = out.getImageData(0,0,output.width,output.height);render();
  };
  image.onerror = () => toast('The saved photo could not load for the preview.'); image.src = report.photo;
  for (const key of ['nose','jaw','lips','tint']) container.querySelector(`#${key}-range`).addEventListener('input', event => {values[key]=Number(event.target.value);container.querySelector(`#${key}-value`).textContent=`${values[key]>0?'+':''}${values[key]}%`;schedule();});
  container.querySelector('#frames-select').addEventListener('change', event => {values.frames=event.target.value;schedule();});
  container.querySelector('#preview-split').addEventListener('input', event => {values.split=Number(event.target.value);split();});
  container.querySelector('#reset-preview').addEventListener('click', () => {for(const key of ['nose','jaw','lips','tint']){values[key]=0;container.querySelector(`#${key}-range`).value=0;container.querySelector(`#${key}-value`).textContent='0%';}values.frames='none';container.querySelector('#frames-select').value='none';render();});
  container.querySelector('#download-preview').addEventListener('click', () => {
    if (!originalPixels) return;
    render(); const exported=document.createElement('canvas'); exported.width=output.width;exported.height=output.height+45;
    const ctx=exported.getContext('2d');ctx.drawImage(output,0,0);ctx.fillStyle='#162d27';ctx.fillRect(0,output.height,output.width,45);ctx.fillStyle='#f7f6f1';ctx.font=`${Math.max(10,output.width/55)}px Arial`;ctx.fillText('QMAX · ILLUSTRATIVE IMAGE — NOT A PREDICTED OUTCOME',15,output.height+28);
    exported.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='qmax-illustrative-preview.png';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Illustration downloaded with its label.');},'image/png');
  });
  return () => {alive=false;clearTimeout(updateTimer);image.onload=null;image.onerror=null;originalPixels=undefined;};
}
