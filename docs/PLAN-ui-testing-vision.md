# Plan rozbudowy: lokalne testy UI + najnowsze Apple Vision

Stan na 2026-08-22. Punkt wyjścia: `macos-vision-mcp` v0.4.9, helper `vision-helper.swift`
(legacy `VN*` API, deployment target `macos12`), 6 narzędzi MCP skupionych na dokumentach.

Cel: **agent testuje UI aplikacji na Macu, nie wysyłając ani jednego screenshota do chmury** —
zrzut robi się lokalnie, Vision wyciąga z niego strukturę, asercje zapadają na Macu,
a do modelu wraca kilkaset tokenów JSON-a zamiast obrazka za ~1500 tokenów.
Druga oś: dociągnięcie frameworka Vision do stanu z macOS 26/27.

---

## 1. Co nowego w Apple Vision (weryfikacja na dokumentacji, sierpień 2026)

Framework przeszedł na Swift-only API (`ImageRequestHandler` + `async/await`) w macOS 15;
stare `VN*` żyje jako "Legacy API". Obecny helper stoi w całości na legacy.

| Request                                         | macOS  | Status w projekcie | Wartość dla nas                                                                                                                                                                                                             |
| ----------------------------------------------- | ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecognizeDocumentsRequest`                     | 26.0   | brak               | **Bardzo wysoka** — jednym przebiegiem daje `paragraphs`, `tables`, `lists`, `title`, `barcodes` i `DataDetectorMatch` (mail/telefon/adres/URL). Zastępuje własny `inferLayout` i wreszcie daje prawdziwe tabele → Markdown |
| `GenerateImageFeaturePrintRequest`              | 15.0   | brak               | **Wysoka** — `FeaturePrintObservation.distance(to:)` = percepcyjne porównanie dwóch zrzutów jedną liczbą; podstawa regresji wizualnej i deduplikacji                                                                        |
| `CalculateImageAestheticsScoresRequest`         | 15.0   | brak               | Średnia — `overallScore` (−1…1) + `isUtility` (zrzut ekranu/dokument vs. zdjęcie)                                                                                                                                           |
| `GenerateForegroundInstanceMaskRequest`         | 15.0   | brak               | Średnia — subject lifting, wycinanie obiektu/kadrowanie przed OCR                                                                                                                                                           |
| `GenerateAttentionBasedSaliencyImageRequest`    | 13+    | brak               | Średnia — "gdzie ucieknie oko" → recenzja layoutu                                                                                                                                                                           |
| `DetectContoursRequest`                         | 13+    | brak               | Średnia — krawędzie kontrolek tam, gdzie `DetectRectangles` nie łapie                                                                                                                                                       |
| `DetectLensSmudgeRequest`                       | 26.0   | brak               | Niska (dla UI), sensowna jako pre-flight jakości skanu                                                                                                                                                                      |
| `GenerateIterativeSegmentationRequest`          | 27.0 β | brak               | Niska — segmentacja z punktu/prostokąta/bazgroła                                                                                                                                                                            |
| `OCRTool`, `BarcodeReaderTool`                  | 27.0 β | brak               | **Strategiczna** — narzędzia Vision wołane bezpośrednio przez model Foundation Models                                                                                                                                       |
| `TrackOpticalFlowRequest`, `TrackObjectRequest` | 15.0   | brak               | Niska — sensowna dopiero przy nagraniach wideo z UI                                                                                                                                                                         |

Poza Vision, z WWDC26 (macOS 27, premiera jesień 2026, dziś beta):
`FoundationModels.Attachment` / `ImageAttachmentContent` / `ImageReference` — **multimodalny prompt
do modelu on-device**. To jest brakujący element układanki: lokalny VLM, który potrafi ocenić zrzut
ekranu ("czy ten ekran wygląda na zepsuty?") bez wysyłania go gdziekolwiek. Wszystko oznaczone
`macOS 27.0 beta`, więc traktujemy jako warstwę opcjonalną, nie fundament.

Źródła: [Vision](https://developer.apple.com/documentation/vision),
[RecognizeDocumentsRequest](https://developer.apple.com/documentation/Vision/RecognizeDocumentsRequest),
[WWDC25 272 – Read documents using the Vision framework](https://developer.apple.com/videos/play/wwdc2025/272/),
[FoundationModels](https://developer.apple.com/documentation/foundationmodels),
[WWDC26 241 – What's new in the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2026/241/).

---

## 2. Czego brakuje dzisiaj

1. **Nie ma skąd wziąć obrazu.** Wszystkie narzędzia przyjmują ścieżkę do pliku. Żeby przetestować
   UI, ktoś musi najpierw zrobić zrzut — czyli agent i tak wychodzi poza MCP.
2. **Nie ma asercji.** Zwracamy dane; decyzję "pass/fail" podejmuje model, czyli płacimy tokenami
   i losowością za coś, co jest zwykłym porównaniem stringów.
3. **Nie ma stanu.** Regresja wizualna wymaga baseline'u; serwer jest bezstanowy.
4. **Nie ma kontekstu semantycznego.** OCR widzi napis "Zapisz", ale nie wie, że to `AXButton`,
   że jest `enabled` i gdzie dokładnie kliknąć w punktach ekranu.
5. **Narzut procesu.** Zmierzone lokalnie (M-series, macOS 26.5): `vision-helper` na obrazku 64 px
   → **0.30 s**, na 1200 px → **0.71 s**. Ten stały ~0.3 s to spawn procesu + rozgrzanie Vision.
   Przy pętli testowej (4 zapytania na klatkę) marnujemy ~1.2 s na krok.
6. **Legacy API i zero nowych requestów** — patrz tabela wyżej.

---

## 3. Architektura docelowa

Niezmiennik prywatności, wpisany w kod, nie tylko w README:
**żadne narzędzie nie zwraca modelowi bajtów obrazu.** Zrzut ląduje w katalogu roboczym,
do modelu idzie ścieżka + struktura. Wyjątek tylko na jawne żądanie
(`MACOS_VISION_ALLOW_IMAGE_RETURN=1`) i tylko dla wycinka regionu diffa.

```
             ┌──────────── A. CAPTURE ─────────────┐
             │ capture_screen / list_windows       │  ScreenCaptureKit (+ screencapture fallback)
             └──────────────┬──────────────────────┘
                            │ PNG na dysku (nigdy do modelu)
             ┌──────────────▼──── B. EXTRACT ──────┐
             │ ui_snapshot: Vision OCR + rects     │  + AXUIElement (role/label/enabled)
             │ + contours  →  jeden UI-map JSON    │
             └──────────────┬──────────────────────┘
        ┌───────────────────┼───────────────────────┐
┌───────▼──── C. ASSERT ───┐│┌────── D. QUALITY ────▼──────┐
│ assert_text              │││ check_contrast (WCAG)       │
│ find_element             │││ check_tap_targets           │
│ compare_screenshots      │││ check_layout (clipping…)    │
│ (+ baseline store)       │││ saliency / aesthetics       │
└──────────────────────────┘│└─────────────────────────────┘
                            │
             ┌──────────────▼──── E. OPCJONALNIE ──┐
             │ judge_ui — FoundationModels + obraz  │  macOS 27, opt-in, dalej 100% on-device
             └──────────────────────────────────────┘
```

Podział pracy z innymi serwerami: **nie wchodzimy w klikanie.** `macos-mcp` czy `cliclick` już to
robią. My zwracamy współrzędne i werdykty; sterownik jest cudzy. To trzymanie się swojej niszy
(oczy, nie ręce) jest też argumentem sprzedażowym: nie żądamy uprawnień do sterowania komputerem.

---

## 4. Nowe narzędzia MCP

### A. Przechwytywanie

**`list_windows`** → `[{ windowId, app, bundleId, title, bounds, isOnScreen, displayId }]`
ScreenCaptureKit (`SCShareableContent`, macOS 12.3+). Bez tego agent nie ma jak wskazać celu.

**`capture_screen`**

```
{ target: "display" | "window" | "region" | "app",
  displayId?, windowId?, bundleId?, rect?: {x,y,w,h},
  scale?: 1 | 2,           // domyślnie natywna Retina — OCR na małych fontach UI tego potrzebuje
  excludeCursor?: bool,
  outDir?: string }
→ { path, width, height, scale, displayScale, capturedAt, os }
```

MVP: `screencapture -x -t png` z `-l<windowid>` / `-R<x,y,w,h>` / `-D<display>` — zero zależności,
działa od zawsze. Docelowo `SCScreenshotManager.captureImage` (macOS 14+), bo łapie **okno zasłonięte
przez inne okno** — kluczowe, gdy agent testuje aplikację w tle.

### B. Rozumienie ekranu

**`ui_snapshot`** — serce całości. Scala trzy źródła w jedną, tanią tokenowo mapę:

| Źródło                | Co wnosi                                                        | Kiedy zawodzi                                               |
| --------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| AX (`AXUIElement`)    | role, label, value, enabled, focused, dokładne ramki w punktach | Electron bez a11y, canvas, WebGL, gry, obrazek od designera |
| Vision OCR            | każdy tekst, jaki _widać_                                       | brak semantyki                                              |
| Vision rects/contours | kontenery, karty, przyciski bez tekstu                          | szum                                                        |

```jsonc
{
  "screen": { "w": 1512, "h": 982, "scale": 2, "app": "MyApp" },
  "elements": [
    {
      "id": 1,
      "role": "button",
      "text": "Zapisz",
      "bbox": [820, 540, 96, 32],
      "enabled": true,
      "source": "ax+ocr",
      "confidence": 0.98,
    },
    {
      "id": 2,
      "role": "text",
      "text": "Nie udało się połączyć",
      "bbox": [40, 120, 300, 18],
      "source": "ocr",
      "confidence": 0.91,
    },
  ],
  "textDigest": "Zapisz | Anuluj | Nie udało się połączyć | …",
}
```

Deduplikacja po IoU ramek: gdy AX i OCR pokazują to samo, jeden element z `source: "ax+ocr"`.
Element widoczny w OCR, a nieobecny w AX → `source: "ocr"` i flaga `a11yMissing` (to samo w sobie
jest wynikiem testu dostępności!).

**`read_screen_text`** — szybka ścieżka: sam OCR z `recognitionLanguages`,
`usesLanguageCorrection: false` (nazwy własne w UI!), `minimumTextHeight` dostrojonym pod małe fonty.

### C. Asercje — tu dzieje się "test bez chmury"

**`assert_text`**

```
{ path | capture: {...}, expect: string | string[], mode: "present"|"absent"|"regex",
  region?: rect, minConfidence?: 0.5, normalize?: true }
→ { pass: bool, matches: [{ text, bbox, confidence }], missing: [...], nearMisses: [...] }
```

Normalizacja obowiązkowa: NFC, zbicie białych znaków, ujednolicenie myślników i cudzysłowów
(Vision lubi zamienić `-` na `–`), opcjonalnie case-insensitive. `nearMisses` z odległością
Levenshteina ratuje przed fałszywym "brak tekstu", gdy OCR przeczytał `Zapisz` jako `Zapisr`.

**`find_element`** → współrzędne środka w punktach ekranu, gotowe do podania sterownikowi.
Szukanie po tekście, po roli AX, albo po wycinku wzorcowym (template matching na feature print).

**`compare_screenshots`** — trzy sygnały, jeden werdykt:

1. **Pixel diff** (Core Image `CIDifferenceBlendMode` + progowanie + connected components)
   → `changedPixelsPct` i **prostokąty regionów zmian** — to jest sygnał główny dla UI.
2. **Percepcyjny** (`GenerateImageFeaturePrintRequest` + `distance`) → jedna liczba odporna na
   antyaliasing i przesunięcie o 1 px.
3. **Tekstowy** — OCR obu, diff list stringów → _"zniknęło «Zapisz», pojawiło się «Zapisywanie…»"_.
   Najtańszy tokenowo i najbardziej czytelny opis regresji, jaki można dać modelowi.

```
→ { pass, changedPixelsPct: 0.8, perceptualDistance: 0.04,
    diffRegions: [[820,530,110,44]],
    textDiff: { added: ["Zapisywanie…"], removed: ["Zapisz"] },
    diffImagePath: "…/diff.png" }
```

Model dostaje liczby i słowa. Obrazek wycinka tylko wtedy, gdy sam poprosi.

> ⚠️ Do zweryfikowania w Fazie 2 pomiarem, nie założeniem: `FeaturePrintObservation` trenowano na
> zdjęciach, nie na zrzutach UI. Jeśli na naszym materiale nie odróżni dwóch podobnych ekranów,
> zostaje jako sygnał pomocniczy, a rolę główną przejmuje pixel diff + hash percepcyjny (dHash).

**`save_baseline` / `check_baseline`** — magazyn w `.vision-baselines/<name>.png` + `.json`
z metadanymi: wersja macOS, `displayScale`, rozdzielczość, motyw jasny/ciemny, locale.
Porównanie przy niezgodnych metadanych → `mismatch`, nie `fail`. Renderowanie fontów różni się
między maszynami i to musi być widoczne jako inna kategoria niż realna regresja.

### D. Jakość i dostępność — wyróżnik, którego nie ma nikt

Wszystko liczone lokalnie z pikseli + ramek, zero modelu:

- **`check_contrast`** — dla każdego bboxa tekstu z OCR liczymy kontrast WCAG 2.1
  (luminancja tekstu vs. mediana tła w otoczce) → lista elementów poniżej 4.5:1 / 3:1.
  Realny audyt a11y ze zrzutu ekranu, bez DOM-u, działa też na natywnych appkach i na makiecie z Figmy.
- **`check_tap_targets`** — elementy interaktywne < 44×44 pt.
- **`check_layout`** — tekst ucięty (`…` na końcu bboxa dotykającego krawędzi kontenera),
  nachodzące się ramki, elementy poza ekranem, złamana siatka wyrównania.
- **`analyze_visual_attention`** — saliency (attention + objectness) → gdzie pada wzrok;
  plus `CalculateImageAestheticsScoresRequest`.

### E. Warstwa opcjonalna (macOS 27, opt-in)

**`judge_ui`** — `LanguageModelSession` z `Attachment(ImageAttachmentContent(...))` i pytaniem
w stylu _"czy ten ekran zawiera błąd renderowania / pusty stan / komunikat błędu?"_, z odpowiedzią
`@Generable` (structured output), więc deterministycznie parsowalną. Model chodzi na Neural Engine,
obraz nie opuszcza Maca. Zgłaszane tylko, gdy `SystemLanguageModel.default.availability == .available`
i `MACOS_VISION_ENABLE_LLM=1`.

---

## 5. Zmiany infrastrukturalne

**`vision-helper --serve` (tryb demona).** JSONL po stdin, jedna odpowiedź na linię, request
handler i modele zostają w pamięci. Kasuje zmierzone ~0.3 s stałego narzutu na wywołanie.
Po stronie TS: pula jednego procesu z auto-restartem i timeoutem. To warunek sensownej pętli
testowej — bez tego 20-krokowy scenariusz traci ~25 s na sam spawn.

**Gating wersji.** Deployment target zostaje `macos12`; nowe API w `if #available(macOS 26, *)`
(Swift linkuje je słabo, więc binarka nadal wystartuje na 13). CI musi jednak kompilować na
SDK ≥ 26 — `macos-latest` na GitHubie trzeba przypiąć jawnie do obrazu z Xcode 26+, inaczej
`RecognizeDocumentsRequest` nie zbuduje się w ogóle.

**`vision_capabilities`** — nowe narzędzie zwracające: wersja macOS, dostępne requesty,
stan uprawnień (Screen Recording, Accessibility), czy demon działa, czy LLM jest dostępny.
Agent ma wtedy jak wybrać ścieżkę zamiast wpaść na błąd.

**Uprawnienia.** Screen Recording i Accessibility przyznaje się **procesowi-rodzicowi**
(Claude Desktop / Cursor / Terminal), nie naszemu helperowi. Potrzebne: jasny komunikat błędu
z instrukcją (`System Settings → Privacy & Security → Screen Recording`), `AXIsProcessTrustedWithOptions`
do wykrycia braku zgody i sekcja w README. To będzie główne źródło zgłoszeń "nie działa".

---

## 6. Etapy

| Faza                 | Zakres                                                                                                                                                                                         | Wersja     | Szacunek | Ryzyko                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | --------------------------------------------------------------- |
| **1. Oczy**          | `list_windows`, `capture_screen`, `read_screen_text`, `assert_text`, `vision_capabilities`, obsługa uprawnień                                                                                  | 0.5.0      | 2–3 dni  | Niskie — `screencapture` + istniejący OCR                       |
| **2. Regresja**      | `compare_screenshots` (3 sygnały), baseline store, `find_element`; **pomiar skuteczności feature printu na zrzutach UI**                                                                       | 0.6.0      | 3–4 dni  | Średnie — jakość sygnału percepcyjnego do potwierdzenia         |
| **3. Semantyka**     | `ui_snapshot` z drzewem AX + scalanie z OCR                                                                                                                                                    | 0.7.0      | 3–5 dni  | Średnie — AX bywa ubogie w Electronie; degradacja do samego OCR |
| **4. Jakość**        | `check_contrast`, `check_tap_targets`, `check_layout`, saliency, aesthetics                                                                                                                    | 0.8.0      | 3–4 dni  | Niskie                                                          |
| **5. Nowe Vision**   | `RecognizeDocumentsRequest` (tabele/listy/data detectors) w `analyze_document`, feature print jako publiczne narzędzie, foreground mask, smudge; migracja na Swift API z fallbackiem na legacy | 0.9.0      | 4–5 dni  | Średnie — dwie ścieżki kodu, CI na Xcode 26                     |
| **6. Wydajność**     | `--serve`, pula procesów, cache po hashu pliku                                                                                                                                                 | 0.9.x      | 2 dni    | Niskie                                                          |
| **7. LLM on-device** | `judge_ui` na FoundationModels + `Attachment`                                                                                                                                                  | 1.0.0-beta | 2–3 dni  | Wysokie — API w becie, macOS 27 dopiero jesienią                |

Fazy 1–2 to samodzielnie użyteczny produkt: _"agent klika w Twojej aplikacji i sam sprawdza,
czy nie zepsuł UI — bez ani jednego zrzutu wysłanego do chmury"_. Reszta to pogłębianie.

Kolejność jest odwracalna w jednym miejscu: **Faza 5 (nowe Vision) nie zależy od żadnej innej**
i sama w sobie podnosi obecny, dokumentowy rdzeń produktu (prawdziwe tabele w `analyze_document`).
Jeśli priorytetem ma być dzisiejszy użytkownik, a nie nowy rynek — zaczynamy od 5.

---

## 7. Ryzyka i uczciwe ograniczenia

- **Web UI to nie nasza nisza.** Do stron Playwright/DOM zawsze będzie dokładniejszy i szybszy.
  Nasza przewaga to natywny macOS, Electron bez a11y, canvas/WebGL, gry, PDF-y i makiety.
  Warto to napisać wprost w README, zamiast obiecywać zamiennik Playwrighta.
- **OCR na UI ≠ OCR na dokumencie.** Małe fonty, ciemny motyw, tekst na gradiencie.
  Mitygacja: natywna skala Retina, `minimumTextHeight`, wyłączona korekta językowa,
  progi pewności w asercjach. Do zmierzenia na realnym materiale w Fazie 1, nie do założenia.
- **Baseline'y są zależne od maszyny.** Metadane w baseline + osobna kategoria `mismatch`.
- **CI/headless.** `screencapture` nie działa bez sesji graficznej (SSH bez zalogowanego użytkownika).
  Dla CI: ścieżka "podaj gotowy PNG z Playwrighta/XCUITest, my zrobimy asercje i diff".
- **Nakładanie się z `macos-mcp`.** Świadomie nie robimy klikania. Rekomendowany wzorzec:
  `macos-mcp` steruje, `macos-vision-mcp` patrzy i orzeka.
- **API w becie.** Faza 7 stoi na `macOS 27.0 beta`. Nic z fundamentu nie może od niej zależeć.

---

## 8. Pierwszy krok

Faza 1, w kolejności:

1. `vision-helper --capture` (ScreenCaptureKit lista okien + `screencapture` do zrzutu) i `--permissions`.
2. `list_windows`, `capture_screen`, `vision_capabilities` w `src/index.ts`.
3. `assert_text` z normalizacją i `nearMisses` — czysty TypeScript nad istniejącym `ocr()`.
4. Pomiar skuteczności OCR na 20 realnych zrzutach UI (jasny/ciemny motyw, 1x/2x, PL/EN)
   → z tego wynikają domyślne progi i to, czy Faza 3 (AX) jest konieczna od razu, czy może poczekać.
