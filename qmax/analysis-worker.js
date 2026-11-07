importScripts('./vendor/vision_bundle.js');
const { FaceLandmarker, FilesetResolver } = Vision;
const measurements = import('./measurements.js');
let detector;
self.addEventListener('message', async event => {
  const { id, bitmap } = event.data;
  try {
    if (!detector) {
      self.postMessage({ id, type: 'status', stage: 'model', title: 'Preparing your private workspace…', detail: 'Loading the model on this device. The first analysis can take a little longer.' });
      const vision = await FilesetResolver.forVisionTasks(new URL('./vendor/wasm', self.location.href).href);
      // Ship the unchanged WASM binary compressed, avoiding a 14 MB transfer.
      // The decompressed object URL stays on-device and is released after startup.
      if (!self.DecompressionStream) throw new Error('This browser cannot unpack the local analysis runtime. Please update your browser and try again.');
      const response = await fetch(new URL('./vendor/wasm/vision_wasm_internal.wasm.gz', self.location.href));
      if (!response.ok || !response.body) throw new Error('The local analysis runtime could not download. Check your connection and reload the page.');
      const unpacked = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const wasmUrl = URL.createObjectURL(new Blob([unpacked], { type: 'application/wasm' }));
      try {
        detector = await FaceLandmarker.createFromOptions({ ...vision, wasmBinaryPath: wasmUrl }, {
          baseOptions: { modelAssetPath: new URL('./models/face_landmarker.task', self.location.href).href, delegate: 'CPU' },
          runningMode: 'IMAGE', numFaces: 2, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: false,
          minFaceDetectionConfidence: .6, minFacePresenceConfidence: .6,
        });
      } finally { URL.revokeObjectURL(wasmUrl); }
    }
    self.postMessage({ id, type: 'status', stage: 'detect', title: 'Finding your facial landmarks…', detail: 'Your photo is being processed locally. It is not being uploaded.' });
    const result = detector.detect(bitmap);
    if (!result.faceLandmarks.length) throw new Error('No face was detected. Try a clear, forward-facing photo with your full face visible.');
    if (result.faceLandmarks.length !== 1) throw new Error('More than one face was detected. Choose a photo containing only you.');
    self.postMessage({ id, type: 'status', stage: 'measure', title: 'Putting your proportions in perspective…', detail: 'Calculating photo-based ratios and checking the capture.' });
    const landmarks = result.faceLandmarks[0];
    const { measureFace } = await measurements;
    const measured = measureFace(landmarks, bitmap.width, bitmap.height, result.faceBlendshapes?.[0]?.categories || []);
    const connections = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.concat(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, FaceLandmarker.FACE_LANDMARKS_LIPS, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS || [], FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS || []).map(c => [c.start, c.end]);
    self.postMessage({ id, type: 'result', result: { ...measured, landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })), connections, landmarkCount: landmarks.length, engine: 'Google MediaPipe Face Landmarker', runtimeVersion: '1.2.2', modelVersion: 'float16/1' } });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : 'The analysis could not finish. Please try a different photo.' });
  } finally { bitmap?.close(); }
});
