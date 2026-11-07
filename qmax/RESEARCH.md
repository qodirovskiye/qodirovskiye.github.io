# QOVES research → QMax scope

Researched November 7, 2026. QMax is an independent project; it is not affiliated with QOVES.

## What QOVES sells

QOVES describes a personalized facial-aesthetics service: customers supply a questionnaire and several photos, then receive assessments, an improvement protocol, illustrative visualizations, biometric tracking, and a team letter. Its website advertises more than 160 assessments spanning the face and individual features, human review, annual updates, and dashboard messaging. It also states that it is not a licensed medical service. These are the company's descriptions, not independent validation.

Source: [QOVES official website and FAQ](https://www.qoves.com/).

## Articles and social feedback

- **Independent reporting:** GQ's October 15, 2026 first-person review describes a partly automated, partly manual service. Its report separates whole-face assessments, individual-feature analysis, and an action protocol. The article also raises questions about interpretation and the relationship between measurements and recommendations. [GQ](https://www.gq.com/story/qoves-review-ai-facial-analysis-attractive)
- **Public customer discussion:** A Reddit thread describes proportions, hair and grooming suggestions, and non-surgical recommendations. Other threads contain mixed reactions, including concerns about generic advice or disagreement with the proposed appearance. These are unverified anecdotes rather than a representative sample. [Report-deliverables discussion](https://www.reddit.com/r/QOVESStudio/comments/1vzzgej/what_exactly_does_a_qoves_report_share/), [mixed customer experience](https://www.reddit.com/r/ugly/comments/1st20p7/facial_analysis_results_from_qoves/)
- **Review platform:** Trustpilot includes detailed positive experiences and complaints involving preview images, recommendations, or delivery. Its page warns that reviews may not be representative. Ratings and counts change, so they are not reproduced here. [Trustpilot](https://www.trustpilot.com/review/qoves.com)
- **Video review:** HelloChen's April 22, 2026 video description organizes the experience around the questionnaire, report, protocol, and value. The description was available, but the video itself was not independently watched or transcribed for this research. [YouTube](https://www.youtube.com/watch?v=0WUmNebW_uA)

Competitor-written comparison articles were excluded from the main findings because they market competing products. An App Store listing using a similar name was not treated as an official QOVES product without verified ownership.

## Product interpretation

The core customer journey is **capture → understand → visualize → act → revisit**. The first QMax implementation follows that journey, while keeping inference on-device and avoiding unsupported scientific claims.

| Reference capability | QMax implementation | Current boundary |
| --- | --- | --- |
| Photo submission | Drag-and-drop or file selection, permission check, local image preparation | One forward-facing photo; no cloud upload |
| Facial mapping | Real MediaPipe detection, 478 landmarks, feature-map and point overlays | Detection is not a validated aesthetic assessment |
| Overall and feature analysis | 22 measured relationships across face outline, eyes, eyebrows, nose, lips, chin, and vertical proportions | Ratios and degrees in photo space; no physical millimeters or demographic percentiles |
| Symmetry | Paired-point photo-asymmetry estimate | Includes pose and model error; suppressed for detected head turn |
| Personalized protocol | Explainable observations and goal-specific exploration checklist | Rule-based styling experiments; no medical treatment plan |
| Appearance visualization | Landmark-positioned frame overlays, lip-color illustration, gentle image-width/height adjustments, comparison slider and labeled PNG export | Local image manipulation; not generative AI, a predicted future face, or evidence of achievable results |
| Reports | Feature descriptions, capture notes, JSON download and print-to-PDF | No account or human reviewer |
| Progress tracking | Device-local saved reports, checklist state, side-by-side photos and numerical differences | No cross-device sync; a changed ratio is not proof of physical improvement |
| Premium presentation | QMax-branded landing page, upload studio, tabbed report and appearance studio | Original implementation inspired by the reference |
| Team support | Excluded at the user's request | No live support or simulated expert review |

## Capabilities that need additional models or validation

QMax does not claim parity with QOVES's advertised 160+ assessments. Skin diagnoses, pore or wrinkle-depth measurements, hair-density analysis, reliable physical dimensions, demographic rankings, clinical or surgical recommendations, and identity-preserving generative hairstyle/transformation images are not implemented. A face-landmark model does not establish those capabilities. Accurate reference datasets, task-specific models, evaluation, and sometimes external inference infrastructure would be needed.

## Technical basis and privacy

[Google MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) provides landmark detection. QMax's ratios, capture heuristics, explanations, and local preview controls are its own transparent implementation. The model and runtime are bundled with the site; a worker processes photos locally. The site has no telemetry, third-party script requests, account system, or photo-upload endpoint. Optional saved reports and photo previews stay in IndexedDB on the visitor's device.

## GitHub hosting

The project is a static site with relative asset paths, so it can run under a GitHub Pages repository path without a purchased domain. GitHub Pages does not supply an application backend and is not intended for commercial SaaS or e-commerce. This version is a free educational project, does not collect visitor photos, and clearly states that it is independent of QOVES. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)


## Follow-up: rating apps and skin-care routines

At the user's request, QMax now has a **Score & skin care** tab. Public products such as [LooksMax](https://looksmaxapp.com/) and [Looks Max by Solarity](https://looksmax.solarityai.com/about) advertise numeric ratings and routines, but their public feature pages do not provide a reusable trained model or complete scoring implementation. LooksMax explicitly describes its ratings as entertainment-grade. These products informed the feature structure, not QMax's numerical values.

QMax's optional 18+ aesthetic experiment is **not a trained attractiveness model**. Its targets, tolerances, weights, formula, and missing-data policy are displayed in the interface. They are authored aesthetic preferences, not clinical norms or a population percentile. The user can inspect the report without revealing a score. Missing components remain missing, and fewer than three available components produce no overall score. The score is not comparable to another app's rating and has not been validated against human judgments.

The new routine is educational guidance selected from self-reported concerns. It does not infer skin disease, prescribe medication, or recommend cosmetic procedures from the photograph. References are the American Academy of Dermatology's guidance on [simple routines](https://www.aad.org/public/everyday-care/skin-care-basics/care/skin-care-budget), [oily skin](https://www.aad.org/public/everyday-care/skin-care-basics/dry/oily-skin), [dry skin](https://www.aad.org/public/everyday-care/skin-care-basics/dry/dermatologists-tips-relieve-dry-skin), [acne self-care](https://www.aad.org/public/diseases/acne/skin-care/tips), [sunscreen selection](https://www.aad.org/public/everyday-care/sun-protection/shade-clothing-sunscreen/how-to-select-sunscreen), [pregnancy skin care](https://www.aad.org/public/everyday-care/skin-care-secrets/routine/pregnancy-skin-care), and [retinoids](https://www.aad.org/public/everyday-care/skin-care-secrets/anti-aging/retinoid-retinol/). Each displayed step links to its source. Pregnancy, breastfeeding, existing prescriptions, and persistent symptoms route treatment questions to a clinician.

## Navigation repair

The upload CTA now targets a real `#studio` section and can reveal that screen before scripts start. Initial routing runs before optional IndexedDB report loading; blocked report storage cannot keep the upload screen hidden. Re-activating an already-selected studio link reopens it. Regression tests cover these cases, alongside the photo geometry and new guidance functions.
