'use strict';

const $ = id => document.getElementById(id);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const safeRead = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const safeWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const storedFavorites = safeRead('qwall-favorites', []);
const storedPreferences = safeRead('qwall-preferences', {});
const preferences = {
  motion: ['system', 'reduced', 'full'].includes(storedPreferences?.motion) ? storedPreferences.motion : 'system',
  autoplay: storedPreferences?.autoplay !== false,
  density: storedPreferences?.density === 'compact' ? 'compact' : 'comfortable',
  muted: storedPreferences?.muted !== false,
  speed: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(Number(storedPreferences?.speed)) ? Number(storedPreferences.speed) : 1
};
const systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  view: 'discover', category: 'All', search: '', sort: 'curated',
  favorites: new Set(Array.isArray(storedFavorites) ? storedFavorites : []),
  imports: [], selected: null, playing: true, previewTime: 12, target: 'desktop',
  hovered: null, origin: null, closing: false, importing: false, native: null,
  toastTimer: 0, transition: 0
};
const isNative = window.QWALL_IS_NATIVE === true;
const nativeLibrary = isNative && Array.isArray(window.QWALL_LOCAL_LIBRARY) ? window.QWALL_LOCAL_LIBRARY.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.nativeId === 'string' && typeof item.videoURL === 'string').map(item => ({ ...item, category: item.category || 'Your video', mood: item.mood || 'Saved on this Mac' })) : [];
const isVideo = item => Boolean(item && (item.blob || item.videoURL));
const videoSource = item => item.videoURL || item.url;
const reducedMotion = () => preferences.motion === 'reduced' || (preferences.motion === 'system' && systemMotion.matches);
let databasePromise, visibilityObserver, lastAnimation = 0, hoveredTime = 12, dragDepth = 0;
const visibleCards = new Set();

function savePreferences() { safeWrite('qwall-preferences', preferences); }
function applyPreferences() {
  document.body.dataset.motion = preferences.motion;
  document.body.dataset.density = preferences.density;
  $('motionPreference').value = preferences.motion;
  $('autoplayPreference').checked = preferences.autoplay;
  $('densityPreference').value = preferences.density;
  $('previewSpeed').value = String(preferences.speed);
  $('layoutButton').setAttribute('aria-label', `Switch to ${preferences.density === 'compact' ? 'comfortable' : 'compact'} grid`);
  $('layoutButton').title = `${preferences.density === 'compact' ? 'Comfortable' : 'Compact'} gallery layout`;
  if (!preferences.autoplay || reducedMotion()) stopHover();
}
function animateElement(element, frames, options) {
  if (reducedMotion() || typeof element.animate !== 'function') return null;
  return element.animate(frames, { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)', ...options });
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 5500);
}
function allItems() { return [...QwallScenes.data, ...nativeLibrary, ...state.imports]; }
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}
function formatDuration(seconds) {
  if (typeof seconds === 'string' && /^\d+:\d{2}$/.test(seconds)) return seconds;
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function database() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('qwall-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('videos', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { databasePromise = null; reject(request.error); };
  });
  return databasePromise;
}
async function records() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('videos', 'readonly').objectStore('videos').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function mutateRecord(operation, record) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('videos', 'readwrite');
    const store = transaction.objectStore('videos');
    if (operation === 'delete') store.delete(record.id); else store.put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function updateCounts() {
  $('favoriteCount').textContent = state.favorites.size;
  $('favoriteCount').hidden = state.favorites.size === 0;
  $('importCount').textContent = state.imports.length + nativeLibrary.length;
  $('importCount').hidden = state.imports.length + nativeLibrary.length === 0;
  const bytes = state.imports.reduce((sum, video) => sum + (video.blob?.size || 0), 0);
  $('storageSummary').textContent = state.imports.length ? `${state.imports.length} ${state.imports.length === 1 ? 'video' : 'videos'} · ${formatBytes(bytes)} stored on this device` : nativeLibrary.length ? `${nativeLibrary.length} videos saved privately on this Mac` : 'No imported videos';
}
function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  safeWrite('qwall-favorites', [...state.favorites]);
  updateCounts();
  updateDetailFavorite();
  if (state.view === 'favorites') renderGrid();
  else document.querySelectorAll('.card-favorite').forEach(button => {
    if (button.dataset.id !== id) return;
    const favorite = state.favorites.has(id);
    button.classList.toggle('is-favorite', favorite);
    button.setAttribute('aria-pressed', String(favorite));
    button.setAttribute('aria-label', `${favorite ? 'Remove' : 'Add'} ${button.dataset.name} ${favorite ? 'from' : 'to'} favorites`);
    if (favorite) animateElement(button, [{ transform: 'scale(.8)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 280 });
  });
}
function updateDetailFavorite() {
  if (!state.selected) return;
  const favorite = state.favorites.has(state.selected.id);
  $('detailFavorite').classList.toggle('is-favorite', favorite);
  $('detailFavorite').setAttribute('aria-pressed', String(favorite));
  $('detailFavorite').setAttribute('aria-label', favorite ? 'Remove from favorites' : 'Add to favorites');
  $('detailFavorite').querySelector('span').textContent = favorite ? 'Favorited' : 'Favorite';
}
function setView(view) {
  if (!['discover', 'imports', 'favorites'].includes(view)) return;
  state.view = view;
  state.category = 'All';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-category]').forEach(button => {
    button.classList.toggle('active', button.dataset.category === 'All');
    button.setAttribute('aria-pressed', String(button.dataset.category === 'All'));
  });
  const copy = {
    discover: ['A FRESH PERSPECTIVE', 'Your desktop, alive.', 'Find a view worth coming back to.', 'Explore wallpapers'],
    imports: ['YOUR PERSONAL COLLECTION', 'A world of your own.', 'Your videos. Your atmosphere. Always private.', 'My library'],
    favorites: ['THE PLACES YOU LOVE', 'Worth coming back to.', 'All your favorite views, in one place.', 'Favorites']
  }[view];
  [$('pageEyebrow'), $('pageTitle'), $('pageDescription'), $('libraryTitle')].forEach((element, index) => element.textContent = copy[index]);
  $('hero').hidden = view !== 'discover' || Boolean(state.search);
  document.querySelector('.filters').hidden = view === 'imports';
  renderGrid();
  animateElement(document.querySelector('.page-heading'), [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }]);
}
function filteredItems() {
  const terms = state.search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  let items = allItems().filter(item => {
    const inView = state.view === 'favorites' ? state.favorites.has(item.id) : state.view === 'imports' ? isVideo(item) : !isVideo(item);
    const searchable = `${item.id} ${item.name} ${item.category} ${item.mood || ''} ${item.description || ''}`.toLocaleLowerCase();
    return inView && (state.category === 'All' || state.category === item.category) && terms.every(term => searchable.includes(term));
  });
  if (state.sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name));
  if (state.sort === 'newest') items.sort((a, b) => (b.created || 0) - (a.created || 0));
  return items;
}
function renderGrid() {
  stopHover();
  visibilityObserver?.disconnect();
  visibleCards.clear();
  const items = filteredItems();
  const grid = $('wallpaperGrid');
  grid.replaceChildren();
  $('resultCount').textContent = `${items.length} ${state.view === 'imports' ? items.length === 1 ? 'video' : 'videos' : items.length === 1 ? 'wallpaper' : 'wallpapers'}`;
  const fragment = document.createDocumentFragment();
  for (const [index, item] of items.entries()) {
    const card = document.createElement('article');
    card.className = 'wallpaper-card'; card.dataset.id = item.id;
    card.style.setProperty('--card-delay', `${Math.min(index, 7) * 22}ms`);
    const art = document.createElement('div'); art.className = 'card-art';
    const open = document.createElement('button'); open.className = 'card-open';
    open.setAttribute('aria-label', `Preview ${item.name}`);
    open.addEventListener('click', () => openPreview(item, art.getBoundingClientRect()));
    const media = document.createElement(isVideo(item) ? 'video' : 'canvas');
    if (isVideo(item)) {
      media.src = videoSource(item); media.muted = true; media.loop = true; media.playsInline = true; media.preload = 'metadata';
      media.addEventListener('loadedmetadata', () => { if (media.duration > 1 && media.paused) media.currentTime = Math.min(1, media.duration / 3); }, { once: true });
    } else { media.dataset.scene = item.id; media.setAttribute('aria-hidden', 'true'); }
    open.append(media);
    const hover = document.createElement('span'); hover.className = 'card-hover'; hover.setAttribute('aria-hidden', 'true'); hover.innerHTML = icon('play'); open.append(hover);
    const favorite = document.createElement('button'); favorite.className = `card-favorite${state.favorites.has(item.id) ? ' is-favorite' : ''}`;
    favorite.dataset.id = item.id; favorite.dataset.name = item.name; favorite.innerHTML = icon('heart');
    favorite.setAttribute('aria-label', `${state.favorites.has(item.id) ? 'Remove' : 'Add'} ${item.name} ${state.favorites.has(item.id) ? 'from' : 'to'} favorites`);
    favorite.setAttribute('aria-pressed', String(state.favorites.has(item.id)));
    favorite.addEventListener('click', () => toggleFavorite(item.id));
    const tag = document.createElement('span'); tag.className = 'card-tag';
    const dot = document.createElement('i'); tag.append(dot, document.createTextNode(item.nativeId ? 'ON THIS MAC' : item.blob ? 'YOUR VIDEO' : 'LIVE'));
    art.append(open, favorite, tag);
    if (item.blob) {
      const remove = document.createElement('button'); remove.className = 'card-delete'; remove.innerHTML = icon('trash');
      remove.setAttribute('aria-label', `Remove ${item.name} from this browser`); remove.title = 'Remove from library';
      remove.addEventListener('click', () => deleteImportedVideo(item)); art.append(remove);
    }
    const info = document.createElement('div'); info.className = 'card-info';
    const title = document.createElement('h3'); title.textContent = item.name;
    const category = document.createElement('span'); category.textContent = isVideo(item) && item.duration ? formatDuration(item.duration) : item.category;
    info.append(title, category);
    const description = document.createElement('p'); description.className = 'card-description'; description.textContent = item.mood || 'From your personal collection';
    card.append(art, info, description); fragment.append(card);
    card.addEventListener('pointerenter', () => startHover(card, item, media));
    card.addEventListener('pointerleave', () => { if (state.hovered?.card === card) stopHover(); });
    open.addEventListener('focus', () => startHover(card, item, media));
    open.addEventListener('blur', () => { if (state.hovered?.card === card) stopHover(); });
  }
  grid.append(fragment);
  if ('IntersectionObserver' in window) {
    visibilityObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) visibleCards.add(entry.target); else { visibleCards.delete(entry.target); if (state.hovered?.card === entry.target) stopHover(); }
    }), { threshold: .1 });
    grid.querySelectorAll('.wallpaper-card').forEach(card => visibilityObserver.observe(card));
  } else grid.querySelectorAll('.wallpaper-card').forEach(card => visibleCards.add(card));
  $('emptyState').hidden = items.length > 0;
  $('emptyTitle').textContent = state.search ? 'A different view, perhaps?' : state.view === 'imports' ? 'Your library starts here.' : state.view === 'favorites' ? 'Keep your favorite views close.' : 'Nothing in this corner yet.';
  $('emptyText').textContent = state.search ? 'No matches. Try another word or category.' : state.view === 'imports' ? 'Drag in a video, or choose one from your Mac.' : state.view === 'favorites' ? 'Tap the heart on any wallpaper to save it here.' : 'Try another category to find your atmosphere.';
  $('emptyAction').textContent = state.view === 'imports' && !state.search ? 'Import a video' : 'Explore wallpapers';
  updateCounts();
  requestAnimationFrame(() => grid.querySelectorAll('canvas[data-scene]').forEach(canvas => QwallScenes.render(canvas, canvas.dataset.scene, 12)));
}
function startHover(card, item, media) {
  if (!preferences.autoplay || reducedMotion() || state.selected || document.hidden) return;
  stopHover();
  state.hovered = { card, item, media }; hoveredTime = 12;
  if (isVideo(item)) { media.playbackRate = 1; media.play().catch(() => {}); }
}
function stopHover() {
  if (isVideo(state.hovered?.item)) state.hovered.media.pause();
  state.hovered = null;
}
function updatePreviewMetadata() {
  if (!state.selected) return;
  const item = state.selected;
  if (!isVideo(item)) { $('previewMetadata').textContent = 'Original animation · Seamless motion · Made for Qwall'; return; }
  const video = $('previewVideo');
  const width = video.videoWidth || item.width, height = video.videoHeight || item.height;
  const duration = video.duration || item.duration;
  $('previewMetadata').textContent = [width && height ? `${width} × ${height}` : item.resolution || 'Your video', item.blob ? formatBytes(item.blob.size) : item.bytes ? formatBytes(item.bytes) : '', formatDuration(duration)].filter(Boolean).join(' · ');
}
function updatePreviewPlayback() {
  $('playToggle').innerHTML = icon(state.playing ? 'pause' : 'play');
  $('playToggle').setAttribute('aria-label', state.playing ? 'Pause preview' : 'Play preview');
  $('playToggle').title = state.playing ? 'Pause preview' : 'Play preview';
  $('muteToggle').disabled = !isVideo(state.selected);
  $('muteToggle').innerHTML = icon(preferences.muted ? 'mute' : 'sound');
  $('muteToggle').setAttribute('aria-label', !isVideo(state.selected) ? 'This scene has no audio' : preferences.muted ? 'Unmute video' : 'Mute video');
  $('muteToggle').title = !isVideo(state.selected) ? 'Original scenes have no audio' : preferences.muted ? 'Unmute video' : 'Mute video';
  $('muteToggle').setAttribute('aria-pressed', String(!preferences.muted));
  $('previewSpeed').value = String(preferences.speed);
}
function updateTarget() {
  document.querySelectorAll('[data-target]').forEach(button => {
    const active = button.dataset.target === state.target;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('lockExperimentalHint').hidden = state.target === 'desktop';
  $('applyButton').querySelector('use').setAttribute('href', state.target === 'lock' ? '#i-lock' : '#i-monitor');
}
function detailElements() { return [$('detailTopbar') || document.querySelector('.detail-topbar'), document.querySelector('.preview-body'), $('moreButton')]; }
function cardClip(rect) {
  return `inset(${Math.max(0, rect.top)}px ${Math.max(0, window.innerWidth - rect.right)}px ${Math.max(0, window.innerHeight - rect.bottom)}px ${Math.max(0, rect.left)}px round 12px)`;
}
function openPreview(item, origin) {
  if (state.closing) return;
  const alreadyOpen = $('previewDialog').open;
  const transition = ++state.transition;
  stopHover();
  state.selected = item; state.playing = true; state.previewTime = 12;
  state.origin = origin || [...document.querySelectorAll('.wallpaper-card')].find(card => card.dataset.id === item.id)?.querySelector('.card-art').getBoundingClientRect() || null;
  $('previewTitle').textContent = item.name;
  $('previewCategory').textContent = item.blob ? 'Your library' : item.category;
  $('previewDescription').textContent = item.description || 'A video from your own collection. A view that feels like you.';
  $('previewCanvas').hidden = isVideo(item); $('previewVideo').hidden = !isVideo(item);
  $('previewVideo').pause(); $('previewVideo').removeAttribute('src');
  if (isVideo(item)) {
    $('previewVideo').src = videoSource(item); $('previewVideo').muted = preferences.muted; $('previewVideo').playbackRate = preferences.speed;
    $('previewVideo').play().catch(() => { if (state.transition === transition) { state.playing = false; updatePreviewPlayback(); toast('This video could not play here. You can still select its original file in the Mac companion.'); } });
  }
  $('downloadWallpaper').setAttribute('aria-label', item.blob ? 'Download original video' : 'Save preview image');
  $('downloadWallpaper').title = item.blob ? 'Download original video' : 'Save preview image';
  $('shareButton').hidden = isVideo(item);
  $('downloadWallpaper').hidden = Boolean(item.nativeId);
  $('nativeNote').replaceChildren(document.createTextNode(item.nativeId ? 'Saved on this Mac. Ready to apply directly.' : item.blob ? 'Uses your Mac library, or asks for the original video. ' : isNative ? 'Applies this scene with your Mac companion.' : 'Opens Qwall for Mac to apply this scene. '));
  if (!isNative) { const link = document.createElement('a'); link.href = 'downloads/Qwall.zip'; link.download = ''; link.textContent = 'Get the companion'; $('nativeNote').append(link); }
  updateDetailFavorite(); updatePreviewPlayback(); updatePreviewMetadata(); updateTarget();
  $('relatedPanel').hidden = true; $('moreButton').setAttribute('aria-expanded', 'false');
  if (!alreadyOpen) { $('previewDialog').showModal(); document.body.style.overflow = 'hidden'; }
  requestAnimationFrame(() => {
    if (state.transition !== transition) return;
    if (!isVideo(item)) QwallScenes.render($('previewCanvas'), item.id, 12);
    if (alreadyOpen) animateElement($('previewMedia'), [{ opacity: .2 }, { opacity: 1 }], { duration: 260 });
    else {
      animateElement($('previewMedia'), state.origin ? [{ clipPath: cardClip(state.origin) }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }] : [{ opacity: 0, transform: 'scale(1.025)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.2,.85,.2,1)' });
      detailElements().forEach((element, index) => animateElement(element, [{ opacity: 0, transform: `translateY(${index === 0 ? -6 : 12}px)` }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, delay: 100 + index * 25, fill: 'backwards' }));
    }
  });
}
async function closePreview() {
  if (!$('previewDialog').open || state.closing) return;
  state.closing = true; ++state.transition;
  $('previewVideo').pause();
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  $('relatedPanel').hidden = true;
  const itemId = state.selected?.id;
  const card = [...document.querySelectorAll('.wallpaper-card')].find(item => item.dataset.id === itemId)?.querySelector('.card-art');
  const rect = card?.getBoundingClientRect();
  const exitControls = detailElements().map(element => animateElement(element, [{ opacity: 1 }, { opacity: 0 }], { duration: 130, fill: 'forwards' }));
  const exit = animateElement($('previewMedia'), rect && rect.bottom > 0 && rect.top < window.innerHeight ? [{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: cardClip(rect) }] : [{ opacity: 1 }, { opacity: 0 }], { duration: 240 });
  if (exit) { try { await exit.finished; } catch {} }
  $('previewDialog').close(); exitControls.forEach(animation => animation?.cancel()); document.body.style.overflow = '';
  $('previewVideo').removeAttribute('src'); $('previewVideo').load();
  state.selected = null; state.closing = false;
}
function togglePlayback() {
  if (!state.selected) return;
  state.playing = !state.playing;
  if (isVideo(state.selected)) {
    if (state.playing) $('previewVideo').play().catch(() => { state.playing = false; updatePreviewPlayback(); toast('The video preview could not start.'); });
    else $('previewVideo').pause();
  }
  updatePreviewPlayback();
}
function applyWallpaper() {
  if (!state.selected) return;
  const item = state.selected;
  window.location.href = item.nativeId ? `qwall://apply-local?id=${encodeURIComponent(item.nativeId)}&target=${encodeURIComponent(state.target)}` : item.blob ? `qwall://import?target=${encodeURIComponent(state.target)}&name=${encodeURIComponent(item.name)}` : `qwall://apply?scene=${encodeURIComponent(item.id)}&target=${encodeURIComponent(state.target)}`;
  if (!isNative) toast(item.blob ? 'Opening Qwall for Mac. A matching saved video applies directly.' : 'Opening Qwall for Mac. If nothing opens, install the companion first.');
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.hidden = true; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function downloadWallpaper() {
  const item = state.selected; if (!item) return;
  if (item.blob) { saveBlob(item.blob, item.blob.name || `${item.name}.mp4`); toast('Downloading your original video.'); }
  else {
    $('previewCanvas').toBlob(blob => { if (blob) { saveBlob(blob, `Qwall-${item.id}.png`); toast('Preview image saved. Use Set Wallpaper for live motion.'); } else toast('This preview image could not be saved.'); }, 'image/png');
  }
}
async function shareWallpaper() {
  if (!state.selected || isVideo(state.selected)) return;
  const url = `https://qodirovskiye.github.io/qwall/#wallpaper=${encodeURIComponent(state.selected.id)}`;
  const title = `${state.selected.name} — Qwall`;
  try {
    if (navigator.share) await navigator.share({ title, url });
    else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); toast('Wallpaper link copied.'); }
    else toast(`Share this scene: ${url}`);
  } catch (error) { if (error.name !== 'AbortError') toast(`Share this scene: ${url}`); }
}
function toggleRelated() {
  const open = $('relatedPanel').hidden;
  $('moreButton').setAttribute('aria-expanded', String(open));
  if (!open) { $('relatedPanel').hidden = true; return; }
  $('relatedGrid').replaceChildren();
  const selected = state.selected;
  const items = QwallScenes.data.filter(item => item.id !== selected?.id).sort((a, b) => Number(b.category === selected?.category) - Number(a.category === selected?.category)).slice(0, 4);
  for (const item of items) {
    const button = document.createElement('button'); button.className = 'related-card';
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.textContent = item.name;
    button.append(canvas, title); button.addEventListener('click', () => openPreview(item, button.getBoundingClientRect())); $('relatedGrid').append(button);
  }
  $('relatedPanel').hidden = false;
  requestAnimationFrame(() => { [...$('relatedGrid').querySelectorAll('canvas')].forEach((canvas, index) => QwallScenes.render(canvas, items[index].id, 12)); });
  animateElement($('relatedPanel'), [{ opacity: 0, transform: 'translateY(10px) scale(.97)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 240 });
}
async function deleteImportedVideo(item) {
  try {
    await mutateRecord('delete', item);
    if (state.selected?.id === item.id) await closePreview();
    state.imports = state.imports.filter(video => video.id !== item.id);
    state.favorites.delete(item.id); safeWrite('qwall-favorites', [...state.favorites]);
    URL.revokeObjectURL(item.url); renderGrid();
    toast('Removed from this browser. Your original video is unchanged.');
  } catch { toast('This video could not be removed. Please try again.'); }
}
function videoMetadata(file) {
  return new Promise(resolve => {
    const video = document.createElement('video'), url = URL.createObjectURL(file);
    let finished = false;
    const finish = value => { if (finished) return; finished = true; clearTimeout(timer); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); resolve(value); };
    const timer = setTimeout(() => finish({}), 3500);
    video.preload = 'metadata'; video.muted = true;
    video.onloadedmetadata = () => finish({ width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : null });
    video.onerror = () => finish({}); video.src = url;
  });
}
async function importVideos(files) {
  if (state.importing) { toast('Your videos are still being added. One moment.'); return; }
  const videos = [...files].filter(file => file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name));
  if (!videos.length) { toast('Choose a video in MP4, MOV, M4V, or WEBM format.'); return; }
  if (videos.length < files.length) toast('Only video files will be added.');
  state.importing = true; $('importProgress').hidden = false; $('importButton').disabled = true;
  let imported = 0, failed = 0;
  for (const [index, file] of videos.entries()) {
    $('importProgressText').textContent = file.name; $('importProgressCount').textContent = `${index + 1} / ${videos.length}`;
    if (file.size > 1024 ** 3) { failed++; continue; }
    try {
      const metadata = await videoMetadata(file);
      const record = { id: `import-${crypto.randomUUID()}`, name: file.name.replace(/\.[^.]+$/, ''), category: 'Your video', mood: 'From your personal collection', description: 'A video from your personal collection. Qwall keeps it on this device, just for you.', blob: file, created: Date.now(), ...metadata };
      await mutateRecord('put', record);
      state.imports.push({ ...record, url: URL.createObjectURL(record.blob) }); imported++;
    } catch { failed++; }
  }
  state.importing = false; $('importProgress').hidden = true; $('importButton').disabled = false; $('videoInput').value = '';
  if (imported) { state.search = ''; $('search').value = ''; setView('imports'); }
  toast(imported ? `${imported === 1 ? 'Video added' : `${imported} videos added`} to your private library.${failed ? ` ${failed} could not be saved; files must be under 1 GB.` : ''}` : 'The videos could not be saved. Try smaller files or allow browser storage.');
}
let downloading = false;
async function downloadCompanion(event) {
  event.preventDefault();
  if (isNative || location.protocol === 'file:') { toast('Qwall for Mac is already installed. Choose a wallpaper to get started.'); return; }
  if (downloading) return;
  downloading = true; toast('Preparing Qwall for Mac…');
  try {
    const response = await fetch('downloads/Qwall.zip');
    if (!response.ok) throw new Error('Download unavailable');
    saveBlob(await response.blob(), 'Qwall.zip'); toast('Qwall downloaded. Unzip it and open the app to get started.');
  } catch { toast('The Mac companion download is unavailable. Please try again shortly.'); }
  finally { downloading = false; }
}
function openSheet(id) {
  $(id).showModal();
  animateElement($(id), [{ opacity: 0, transform: 'translateY(14px) scale(.98)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 240 });
}
async function closeSheet(id) {
  const animation = animateElement($(id), [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(8px) scale(.99)' }], { duration: 160 });
  if (animation) { try { await animation.finished; } catch {} }
  $(id).close();
}
function nativeCommand(action, parameters = {}) {
  if (!isNative) return;
  const query = new URLSearchParams({ action, ...parameters });
  window.location.href = `qwall://control?${query}`;
}
function updateNativeStatus(detail) {
  if (!isNative || !detail || typeof detail !== 'object') return;
  state.native = detail;
  const scene = detail.title || QwallScenes.data.find(item => item.id === detail.scene)?.name || (detail.scene ? 'Your wallpaper' : null);
  const playback = detail.pauseReason || (detail.effectivePaused || detail.paused ? 'Paused' : 'Playing on your desktop');
  $('nativeStatusText').textContent = detail.busy ? 'Preparing your wallpaper…' : detail.hasDesktop ? `${scene || 'Wallpaper'} · ${playback}` : 'No desktop wallpaper is playing.';
  $('nativePause').innerHTML = `${icon(detail.paused ? 'play' : 'pause')}<span>${detail.paused ? 'Resume' : 'Pause'}</span>`;
  $('nativeMuted').checked = detail.muted !== false; $('nativeBattery').checked = Boolean(detail.pauseOnBattery); $('nativeRotation').checked = Boolean(detail.rotation);
  $('nativeSpeed').value = String(detail.speed || 1);
  const display = $('nativeDisplay'), selected = detail.displayIndex == null ? '-1' : String(detail.displayIndex);
  display.replaceChildren(new Option('All displays', '-1'));
  if (Array.isArray(detail.displays)) detail.displays.forEach((name, index) => display.append(new Option(String(name), String(index))));
  display.value = selected;
  document.querySelectorAll('#nativeControls button, #nativeControls input, #nativeControls select').forEach(control => control.disabled = Boolean(detail.busy));
  [$('nativePause'), $('nativeNext'), $('nativeStop')].forEach(control => control.disabled = Boolean(detail.busy) || !detail.hasDesktop);
}

$('search').addEventListener('input', event => { state.search = event.target.value; $('hero').hidden = state.view !== 'discover' || Boolean(state.search); renderGrid(); });
$('sort').addEventListener('change', event => { state.sort = event.target.value; renderGrid(); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
  state.category = button.dataset.category;
  document.querySelectorAll('[data-category]').forEach(other => { other.classList.toggle('active', other === button); other.setAttribute('aria-pressed', String(other === button)); }); renderGrid();
}));
document.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => { state.target = button.dataset.target; updateTarget(); }));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); state.search = ''; $('search').value = ''; setView('discover'); window.scrollTo({ top: 0, behavior: reducedMotion() ? 'instant' : 'smooth' }); });
$('heroPreview').addEventListener('click', () => openPreview(QwallScenes.data[0], $('hero').getBoundingClientRect()));
$('closePreview').addEventListener('click', closePreview);
$('previewDialog').addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
$('detailFavorite').addEventListener('click', () => { if (state.selected) toggleFavorite(state.selected.id); });
$('applyButton').addEventListener('click', applyWallpaper);
$('playToggle').addEventListener('click', togglePlayback);
$('previewSpeed').addEventListener('change', event => { preferences.speed = Number(event.target.value); $('previewVideo').playbackRate = preferences.speed; savePreferences(); });
$('muteToggle').addEventListener('click', () => { preferences.muted = !preferences.muted; $('previewVideo').muted = preferences.muted; savePreferences(); updatePreviewPlayback(); });
$('previewVideo').addEventListener('loadedmetadata', updatePreviewMetadata);
$('fullscreenButton').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('previewDialog').requestFullscreen(); }
  catch { toast('Fullscreen preview is unavailable in this browser.'); }
});
if (typeof $('previewDialog').requestFullscreen !== 'function') $('fullscreenButton').hidden = true;
document.addEventListener('fullscreenchange', () => { $('fullscreenButton').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen preview' : 'Enter fullscreen preview'); $('fullscreenButton').title = document.fullscreenElement ? 'Exit fullscreen preview' : 'Fullscreen preview'; });
$('downloadWallpaper').addEventListener('click', downloadWallpaper);
$('shareButton').addEventListener('click', shareWallpaper);
$('moreButton').addEventListener('click', toggleRelated);
$('closeRelated').addEventListener('click', () => { $('relatedPanel').hidden = true; $('moreButton').setAttribute('aria-expanded', 'false'); });
$('importButton').addEventListener('click', () => $('videoInput').click());
$('videoInput').addEventListener('change', event => importVideos([...event.target.files]));
$('emptyAction').addEventListener('click', () => { if (state.view === 'imports' && !state.search) $('videoInput').click(); else { state.search = ''; $('search').value = ''; setView('discover'); } });
$('settingsButton').addEventListener('click', () => { openSheet('settingsDialog'); if (isNative) window.location.href = 'qwall://status'; });
$('closeSettings').addEventListener('click', () => closeSheet('settingsDialog'));
$('howButton').addEventListener('click', () => openSheet('howDialog'));
$('settingsHowButton').addEventListener('click', () => { $('settingsDialog').close(); openSheet('howDialog'); });
$('closeHow').addEventListener('click', () => closeSheet('howDialog'));
for (const id of ['settingsDialog', 'howDialog']) {
  $(id).addEventListener('cancel', event => { event.preventDefault(); closeSheet(id); });
  $(id).addEventListener('click', event => { if (event.target === $(id)) { const box = $(id).getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeSheet(id); } });
}
$('motionPreference').addEventListener('change', event => { preferences.motion = event.target.value; applyPreferences(); savePreferences(); });
$('autoplayPreference').addEventListener('change', event => { preferences.autoplay = event.target.checked; applyPreferences(); savePreferences(); });
$('densityPreference').addEventListener('change', event => { preferences.density = event.target.value; applyPreferences(); savePreferences(); renderGrid(); });
$('layoutButton').addEventListener('click', () => { preferences.density = preferences.density === 'compact' ? 'comfortable' : 'compact'; applyPreferences(); savePreferences(); renderGrid(); });
systemMotion.addEventListener?.('change', () => { applyPreferences(); if (!$('hero').hidden) QwallScenes.render($('heroCanvas'), 'aurora', 12); });
document.addEventListener('click', event => { const link = event.target.closest('a'); if (link?.getAttribute('href') === 'downloads/Qwall.zip') downloadCompanion(event); });
document.addEventListener('keydown', event => {
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (event.key === '/' && !editing && !document.querySelector('dialog[open]')) { event.preventDefault(); $('search').focus(); }
  if (event.code === 'Space' && !editing && $('previewDialog').open && !event.repeat && document.activeElement.tagName !== 'BUTTON') { event.preventDefault(); togglePlayback(); }
});
document.addEventListener('dragenter', event => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); dragDepth++; $('dropOverlay').hidden = false; });
document.addEventListener('dragover', event => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragleave', event => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); dragDepth--; if (dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; } });
document.addEventListener('drop', event => { if (!event.dataTransfer?.files.length) return; event.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true; if ($('previewDialog').open) closePreview(); importVideos([...event.dataTransfer.files]); });
window.addEventListener('blur', () => { dragDepth = 0; $('dropOverlay').hidden = true; stopHover(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopHover(); $('previewVideo').pause(); } else if (isVideo(state.selected) && state.playing) $('previewVideo').play().catch(() => {}); });
window.addEventListener('qwall-native-status', event => updateNativeStatus(event.detail));
if (isNative) {
  $('nativeControls').hidden = false;
  document.querySelectorAll('#nativeControls button, #nativeControls input, #nativeControls select').forEach(control => control.disabled = true);
  $('nativePause').addEventListener('click', () => nativeCommand(state.native?.paused ? 'resume' : 'pause'));
  $('nativeNext').addEventListener('click', () => nativeCommand('next'));
  $('nativeStop').addEventListener('click', () => nativeCommand('stop'));
  $('nativeRestore').addEventListener('click', () => nativeCommand('restore'));
  $('nativeBattery').addEventListener('change', event => nativeCommand('battery', { enabled: event.target.checked ? '1' : '0' }));
  $('nativeRotation').addEventListener('change', event => nativeCommand('rotation', { enabled: event.target.checked ? '1' : '0' }));
  $('nativeMuted').addEventListener('change', event => nativeCommand('mute', { enabled: event.target.checked ? '1' : '0' }));
  $('nativeSpeed').addEventListener('change', event => nativeCommand('speed', { value: event.target.value }));
  $('nativeDisplay').addEventListener('change', event => nativeCommand('display', { index: event.target.value }));
  window.location.href = 'qwall://status';
}
if (isNative || location.protocol === 'file:') {
  $('companionDownload').querySelector('span').textContent = 'Qwall for Mac is installed';
  $('companionDownload').setAttribute('aria-label', 'Qwall for Mac is installed');
}
function frame(timestamp) {
  if (timestamp - lastAnimation >= 40) {
    const delta = Math.min((timestamp - lastAnimation) / 1000, .1); lastAnimation = timestamp;
    if (!document.hidden) {
      if (state.selected && !isVideo(state.selected) && state.playing && !state.closing) {
        if (!reducedMotion()) { state.previewTime += delta * preferences.speed; QwallScenes.render($('previewCanvas'), state.selected.id, state.previewTime); }
      } else if (!state.selected && !reducedMotion()) {
        const hovered = state.hovered;
        if (hovered && visibleCards.has(hovered.card) && !isVideo(hovered.item)) { hoveredTime += delta; QwallScenes.render(hovered.media, hovered.item.id, hoveredTime); }
        else if (!$('hero').hidden && !hovered) { const box = $('hero').getBoundingClientRect(); if (box.bottom > 0 && box.top < innerHeight) QwallScenes.render($('heroCanvas'), 'aurora', timestamp / 1000); }
      }
    }
  }
  requestAnimationFrame(frame);
}
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
    document.querySelectorAll('#wallpaperGrid canvas[data-scene]').forEach(canvas => QwallScenes.render(canvas, canvas.dataset.scene, 12));
    if (!$('hero').hidden) QwallScenes.render($('heroCanvas'), 'aurora', 12);
    if (state.selected && !isVideo(state.selected)) QwallScenes.render($('previewCanvas'), state.selected.id, state.previewTime);
  }, 80);
});
applyPreferences(); if (nativeLibrary.length) setView('imports'); else renderGrid();
requestAnimationFrame(() => QwallScenes.render($('heroCanvas'), 'aurora', 12));
requestAnimationFrame(frame);
records().then(saved => {
  state.imports = saved.filter(record => record?.blob instanceof Blob).map(record => ({ ...record, url: URL.createObjectURL(record.blob) }));
  updateCounts(); if (state.view !== 'discover') renderGrid();
}).catch(() => {});
const requestedScene = new URLSearchParams(location.hash.slice(1)).get('wallpaper');
if (requestedScene) { const scene = QwallScenes.data.find(item => item.id === requestedScene); if (scene) requestAnimationFrame(() => openPreview(scene)); }
