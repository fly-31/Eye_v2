/*
 * Eye Movement MG Screening (two-flag detector) — browser logic.
 *
 * For every recording it measures how well the eye follows the laser (Target),
 * using the correct channel per direction:
 *   Horizontal -> LH/RH vs TargetH ;  Vertical -> LV/RV vs TargetV
 * and computes, per 8 time-windows (window mean removed so drift doesn't fool it):
 *   tracking_error = RMS(eye - target)/RMS(target)   (0 = perfect, higher = worse)
 *   gain           = std(eye)/std(target)            (undershoot < 1)
 *   corr2          = corr(eye,target)^2
 * plus fatigue = 2nd-half minus 1st-half change (err grows / gain shrinks).
 *
 * Features are averaged per patient, then two INDEPENDENT flags are raised:
 *   Flag 1 (transparent rule): tracking deficit  -> track_err > 0.86 OR gain < 0.65
 *   Flag 2 (machine learning): logistic-regression risk > 0.5 (model trained on
 *          10 AChR+ vs 10 healthy; see analysis/flag_pipeline.py)
 *   BOTH  -> "very likely";  ONE -> "possible";  NONE -> "low".
 *
 * Screening aid only — NOT a diagnosis. Everything runs client-side.
 */

const TEMPLATE_URL =
  "https://docs.google.com/spreadsheets/d/1IQTNE3Myjq02l14CmzQXs7IanzrO20VaoszoD1NyKes/edit?usp=sharing";

const DIRECTIONS = ["Horizontal", "Vertical"];
const REQUIRED_COLUMNS = ["Time(sec)", "LH", "RH", "LV", "RV", "TargetH", "TargetV"];
const NWIN = 8;

// Trained logistic-regression model (fit on all 20 labeled patients).
const MODEL = {
  bias: 0.0016888204079863673,
  order: ["track_err", "gain", "corr2", "err_drop", "gain_drop"],
  weights: { track_err: 1.294133680676477, gain: 0.4930969701376843, corr2: -0.7692399796144669, err_drop: -0.3795088688128406, gain_drop: -0.2591131047322773 },
  mean: { track_err: 0.8307816978362865, gain: 0.9265515514659807, corr2: 0.4135285703674388, err_drop: 0.003595758052309042, gain_drop: -0.010546726862576183 },
  std: { track_err: 0.10334345366164635, gain: 0.12771579036092856, corr2: 0.11988471795542067, err_drop: 0.038767541158441325, gain_drop: 0.03931808592508889 },
};
const RULE = { teThr: 0.86, gainThr: 0.65 };

function channelsFor(direction) {
  return direction === "Vertical"
    ? { left: "LV", right: "RV", tgt: "TargetV" }
    : { left: "LH", right: "RH", tgt: "TargetH" };
}

// --- Off-center SD chart (second half, |eye| > 2) + SD flag / index ---
const FREQUENCIES = ["0.5", "0.75", "1"];
const CENTER = 2;        // |eye| <= CENTER is "centered" and excluded
const SD_THRESHOLD = 3;  // a horizontal off-center SD cell "counts" if it exceeds this
const SD_FLAG_MIN = 4;   // SD flag if MORE THAN this many horizontal cells exceed

function parseCategory(name) {
  const base = baseName(name);
  let direction;
  if (/horizontal/i.test(base)) direction = "Horizontal";
  else if (/vertical/i.test(base)) direction = "Vertical";
  else return null;
  const freqMatch = base.match(/(\d+(?:\.\d+)?)\s*Hz/i);
  if (!freqMatch) return null;
  const typeMatch = base.match(/Saccade\s+([BR])\b/i);
  const type = typeMatch ? typeMatch[1].toUpperCase() : "B";
  return { direction, frequency: freqMatch[1], type, label: `${direction} ${freqMatch[1]}Hz ${type}` };
}

function categorySortKey(c) {
  return [
    c.type === "B" ? 0 : 1,
    DIRECTIONS.indexOf(c.direction) >= 0 ? DIRECTIONS.indexOf(c.direction) : 99,
    FREQUENCIES.indexOf(c.frequency) >= 0 ? FREQUENCIES.indexOf(c.frequency) : 99,
  ];
}

/** Population std of eye values y over points where finite AND keep(x, y). */
function stdWhere(x, y, keep) {
  let n = 0, s = 0, s2 = 0;
  for (let i = 0; i < y.length; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i]) && keep(x[i], y[i])) {
      n++; s += y[i]; s2 += y[i] * y[i];
    }
  }
  if (n < 2) return NaN;
  return Math.sqrt(Math.max(s2 / n - (s / n) ** 2, 0));
}

/** {above, below} SD of eye position over off-center samples in the 2nd half. */
function computeOffCenterSD(time, ch) {
  let tmin = Infinity, tmax = -Infinity;
  for (let i = 0; i < time.length; i++)
    if (Number.isFinite(time[i]) && Number.isFinite(ch[i])) {
      if (time[i] < tmin) tmin = time[i];
      if (time[i] > tmax) tmax = time[i];
    }
  if (!Number.isFinite(tmin)) return { above: NaN, below: NaN };
  const mid = (tmin + tmax) / 2;
  return {
    above: stdWhere(time, ch, (tt, ee) => tt > mid && ee > CENTER),
    below: stdWhere(time, ch, (tt, ee) => tt > mid && ee < -CENTER),
  };
}

// ---------------------------------------------------------------------------
// Internationalization (English / Korean)
// ---------------------------------------------------------------------------

const I18N = {
  en: {
    langButton: "한국어",
    navLabel: "📊 Off-center SD →",
    title: "👁️ Eye Tracking — MG Screening",
    subtitle:
      "Upload eye-tracking recordings; the tool measures how well each eye " +
      "<strong>follows the laser</strong> and how much tracking <strong>fatigues " +
      "over time</strong>, then raises two independent flags. " +
      "<strong>Screening aid only — not a diagnosis.</strong> Everything runs in " +
      "your browser; nothing is uploaded to a server.",
    infoSummary: "ℹ️ How to use / required data format",
    step1:
      'Your files must match the column format in this template: ' +
      '<a id="templateLink" href="#" target="_blank" rel="noopener">Example Google Sheet</a>.',
    step2:
      "Each recording is a <code>.csv</code> with columns " +
      "<code>Time(sec), LH, RH, LV, RV, TargetH, TargetV</code> " +
      "(the <code>Target</code> laser columns are required here).",
    step3:
      "Upload the individual <code>.csv</code> files <strong>or</strong> a " +
      "<code>.zip</code> containing them (one zip per patient works well).",
    step4:
      "Horizontal categories use LH/RH vs TargetH; vertical use LV/RV vs TargetV. " +
      "Patient name is read from the file/folder names — keep the originals.",
    warning:
      "⚠️ Needs valid <code>Target</code> (laser) columns. Results are a screening " +
      "signal, not a diagnosis, and were tuned on only 20 patients.",
    dropTitle:
      "<strong>Drag &amp; drop</strong> your <code>.csv</code> or " +
      "<code>.zip</code> files here",
    dropSub: "or click to browse",
    downloadBtn: "⬇️ Download Excel spreadsheet",
    legend:
      "🟥 <strong>Very likely</strong> = both flags · 🟧 <strong>Possible</strong> = one flag · " +
      "🟩 <strong>Low</strong> = neither. Flag 1 = tracking deficit (rule); Flag 2 = ML risk.",
    resultsHeading: "Screening results (one row per patient)",
    colPatient: "Patient",
    colErr: "Tracking error",
    colGain: "Gain",
    colFatigue: "Fatigue (Δgain)",
    colRisk: "ML risk",
    colFlag1: "Flag 1 (rule)",
    colFlag2: "Flag 2 (ML)",
    colVerdict: "Verdict",
    colSdFlag: "SD flag",
    colIndex: "Index",
    colEye: "Eye",
    colRegion: "Region",
    eyeLeft: "Left",
    eyeRight: "Right",
    regionAbove: "Above +2",
    regionBelow: "Below −2",
    dirHorizontal: "Horizontal",
    dirVertical: "Vertical",
    sdToggleShow: "▼ Show off-center SD table",
    sdToggleHide: "▲ Hide off-center SD table",
    sdTableHeading: "Off-center SD — second half (Above = eye > +2, Below = eye < −2)",
    vVeryLikely: "Very likely",
    vPossible: "Possible",
    vLow: "Low",
    vNoData: "No laser data",
    statusProcessing: "Processing…",
    statusProcessed: (n, p) => `Processed ${n} recording(s) across ${p} patient(s).`,
    statusNoValid: "No valid recordings found. Check the file format (need Target columns).",
    warnBadDir: (name) => `Skipped "${name}": could not read direction/frequency from name.`,
    warnInvalid: (name, msg) => `Skipped "${name}": ${msg}`,
    warnNoTarget: (name) => `Skipped "${name}": no laser movement in the needed Target column.`,
    warnBadZip: (name) => `Skipped "${name}": not a valid .zip file.`,
    warnNoCsv: (name) => `Skipped "${name}": zip contained no .csv files.`,
    warnUnsupported: (name) => `Skipped "${name}": unsupported file type (need .csv or .zip).`,
  },
  ko: {
    langButton: "English",
    navLabel: "📊 중심 이탈 표준편차 →",
    title: "👁️ 안구 추적 — MG 선별",
    subtitle:
      "안구 추적 기록을 업로드하면 각 눈이 <strong>레이저를 얼마나 잘 따라가는지</strong>와 " +
      "시간이 지날수록 추적이 <strong>얼마나 저하되는지</strong>를 측정하여 두 개의 독립적인 " +
      "플래그를 표시합니다. <strong>선별 보조 도구일 뿐 진단이 아닙니다.</strong> 모든 계산은 " +
      "브라우저에서 실행되며 서버로 전송되지 않습니다.",
    infoSummary: "ℹ️ 사용 방법 / 필수 데이터 형식",
    step1:
      "파일은 이 템플릿의 열 형식과 일치해야 합니다: " +
      '<a id="templateLink" href="#" target="_blank" rel="noopener">예시 Google 시트</a>.',
    step2:
      "각 기록은 <code>Time(sec), LH, RH, LV, RV, TargetH, TargetV</code> 열을 가진 " +
      "<code>.csv</code> 파일입니다 (여기서는 <code>Target</code> 레이저 열이 필요합니다).",
    step3:
      "개별 <code>.csv</code> 파일 <strong>또는</strong> 이를 담은 " +
      "<code>.zip</code> 파일을 업로드하세요 (환자당 zip 하나가 편리합니다).",
    step4:
      "수평은 LH/RH 대 TargetH, 수직은 LV/RV 대 TargetV를 사용합니다. 환자 이름은 " +
      "파일/폴더 이름에서 읽습니다 — 원래 이름을 유지하세요.",
    warning:
      "⚠️ 유효한 <code>Target</code>(레이저) 열이 필요합니다. 결과는 진단이 아닌 선별 " +
      "신호이며, 20명의 환자만으로 조정되었습니다.",
    dropTitle:
      "<strong>드래그 앤 드롭</strong>으로 <code>.csv</code> 또는 " +
      "<code>.zip</code> 파일을 여기에 놓으세요",
    dropSub: "또는 클릭하여 파일 선택",
    downloadBtn: "⬇️ Excel 스프레드시트 다운로드",
    legend:
      "🟥 <strong>매우 가능성 높음</strong> = 두 플래그 · 🟧 <strong>가능성 있음</strong> = 한 플래그 · " +
      "🟩 <strong>낮음</strong> = 없음. 플래그1 = 추적 결함(규칙), 플래그2 = ML 위험도.",
    resultsHeading: "선별 결과 (환자당 한 행)",
    colPatient: "환자",
    colErr: "추적 오차",
    colGain: "게인",
    colFatigue: "피로 (Δ게인)",
    colRisk: "ML 위험도",
    colFlag1: "플래그1 (규칙)",
    colFlag2: "플래그2 (ML)",
    colVerdict: "판정",
    colSdFlag: "SD 플래그",
    colIndex: "지수",
    colEye: "눈",
    colRegion: "구간",
    eyeLeft: "좌안",
    eyeRight: "우안",
    regionAbove: "+2 초과",
    regionBelow: "−2 미만",
    dirHorizontal: "수평",
    dirVertical: "수직",
    sdToggleShow: "▼ 중심 이탈 SD 표 보기",
    sdToggleHide: "▲ 중심 이탈 SD 표 숨기기",
    sdTableHeading: "중심 이탈 SD — 후반부 (Above = 눈 > +2, Below = 눈 < −2)",
    vVeryLikely: "매우 가능성 높음",
    vPossible: "가능성 있음",
    vLow: "낮음",
    vNoData: "레이저 데이터 없음",
    statusProcessing: "처리 중…",
    statusProcessed: (n, p) => `${n}개의 기록을 ${p}명의 환자에 대해 처리했습니다.`,
    statusNoValid: "유효한 기록을 찾을 수 없습니다. 파일 형식(Target 열 필요)을 확인하세요.",
    warnBadDir: (name) => `"${name}" 건너뜀: 파일 이름에서 방향/주파수를 읽을 수 없습니다.`,
    warnInvalid: (name, msg) => `"${name}" 건너뜀: ${msg}`,
    warnNoTarget: (name) => `"${name}" 건너뜀: 필요한 Target 열에 레이저 움직임이 없습니다.`,
    warnBadZip: (name) => `"${name}" 건너뜀: 올바른 .zip 파일이 아닙니다.`,
    warnNoCsv: (name) => `"${name}" 건너뜀: zip에 .csv 파일이 없습니다.`,
    warnUnsupported: (name) => `"${name}" 건너뜀: 지원되지 않는 파일 형식입니다 (.csv 또는 .zip 필요).`,
  },
};

let currentLang = "en";
const t = (key) => I18N[currentLang][key];

// ---------------------------------------------------------------------------
// Filename / patient parsing
// ---------------------------------------------------------------------------

const baseName = (name) => name.replace(/\\/g, "/").split("/").pop();
const stripSeparators = (s) => s.replace(/^[\s_\-\t]+|[\s_\-\t]+$/g, "");
const stripDate = (s) => s.replace(/^\d{4}[-.]\d{2}[-.]\d{2}\s+/, "").trim();

function patientFromFilename(file) {
  const base = file.replace(/\.(zip|csv)$/i, "");
  const m = base.match(/^(.*?)\s*MG[\s_]/i);
  const head = m ? m[1] : base.split(/VOG/i)[0].replace(/MG\s*$/i, "");
  return stripDate(stripSeparators(head)).trim();
}

function parsePatient(name) {
  const segments = name.replace(/\\/g, "/").split("/").filter((s) => s.length);
  const fileSeg = segments[segments.length - 1] || "";
  const folderSeg = segments.length >= 2 ? segments[segments.length - 2] : null;
  if (folderSeg) {
    const fromFolder = stripDate(stripSeparators(folderSeg)).trim();
    if (fromFolder) return fromFolder;
  }
  return patientFromFilename(fileSeg);
}

function patientSortKey(patientSource) {
  const segments = patientSource.replace(/\\/g, "/").split("/").filter((s) => s.length);
  if (segments.length >= 2) return segments[segments.length - 2];
  return segments[segments.length - 1] || "";
}

function directionOf(name) {
  if (/horizontal/i.test(name)) return "Horizontal";
  if (/vertical/i.test(name)) return "Vertical";
  return null;
}

// ---------------------------------------------------------------------------
// CSV reading + features
// ---------------------------------------------------------------------------

class InvalidCsvError extends Error {}

function readChannels(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-16le", { fatal: false }).decode(bytes);
  } catch (e) {
    text = new TextDecoder("utf-8").decode(bytes);
  }
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) throw new InvalidCsvError("File is empty.");
  const header = lines[0].split(",").map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new InvalidCsvError(
      `Missing required column(s): ${missing.join(", ")}. Found: ${header.join(", ")}`
    );
  }
  const idx = {};
  header.forEach((c, i) => (idx[c] = i));
  const cols = {};
  header.forEach((c) => (cols[c] = []));
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || raw.trim() === "") continue;
    const parts = raw.split(",");
    for (const c of header) {
      const v = parseFloat((parts[idx[c]] ?? "").trim());
      cols[c].push(Number.isFinite(v) ? v : NaN);
    }
  }
  return cols;
}

const nanmean = (arr) => {
  let s = 0, n = 0;
  for (const v of arr) if (Number.isFinite(v)) { s += v; n++; }
  return n ? s / n : NaN;
};

function stdOf(arr) {
  let s = 0, s2 = 0, n = 0;
  for (const v of arr) if (Number.isFinite(v)) { s += v; s2 += v * v; n++; }
  if (n < 2) return 0;
  return Math.sqrt(Math.max(s2 / n - (s / n) ** 2, 0));
}

/** Per-window tracking error, gain, corr² (window mean removed). */
function windowMetrics(t, eye, tgt) {
  let tmin = Infinity, tmax = -Infinity;
  for (const v of t) { if (v < tmin) tmin = v; if (v > tmax) tmax = v; }
  const err = new Array(NWIN).fill(NaN), gain = new Array(NWIN).fill(NaN), corr = new Array(NWIN).fill(NaN);
  const span = tmax - tmin;
  if (!(span > 0)) return { err, gain, corr };
  const N = new Array(NWIN).fill(0), Se = new Array(NWIN).fill(0), Se2 = new Array(NWIN).fill(0),
        St = new Array(NWIN).fill(0), St2 = new Array(NWIN).fill(0), Set_ = new Array(NWIN).fill(0);
  for (let i = 0; i < t.length; i++) {
    const e = eye[i], g = tgt[i];
    if (!Number.isFinite(e) || !Number.isFinite(g) || !Number.isFinite(t[i])) continue;
    let b = Math.floor(((t[i] - tmin) / span) * NWIN);
    if (b >= NWIN) b = NWIN - 1; if (b < 0) b = 0;
    N[b]++; Se[b] += e; Se2[b] += e * e; St[b] += g; St2[b] += g * g; Set_[b] += e * g;
  }
  for (let b = 0; b < NWIN; b++) {
    const n = N[b];
    if (n < 10) continue;
    const em = Se[b] / n, tm = St[b] / n;
    const ve = Se2[b] / n - em * em, vt = St2[b] / n - tm * tm, cov = Set_[b] / n - em * tm;
    if (!(ve > 0) || !(vt > 0)) continue;
    gain[b] = Math.sqrt(ve / vt);
    corr[b] = (cov * cov) / (ve * vt);
    err[b] = Math.sqrt(Math.max(ve - 2 * cov + vt, 0) / vt);
  }
  return { err, gain, corr };
}

/** Per-eye feature dicts for one recording (empty if no laser movement). */
function fileFeatures(ch, direction) {
  const map = channelsFor(direction);
  if (stdOf(ch[map.tgt]) === 0) return [];
  const t = ch["Time(sec)"];
  const half = Math.floor(NWIN / 2);
  const out = [];
  for (const eye of [map.left, map.right]) {
    const { err, gain, corr } = windowMetrics(t, ch[eye], ch[map.tgt]);
    out.push({
      track_err: nanmean(err),
      gain: nanmean(gain),
      corr2: nanmean(corr),
      err_drop: nanmean(err.slice(half)) - nanmean(err.slice(0, half)),
      gain_drop: nanmean(gain.slice(half)) - nanmean(gain.slice(0, half)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Batch processing (csv + zip)
// ---------------------------------------------------------------------------

function decodeZipName(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) {
    try {
      return new TextDecoder("euc-kr").decode(bytes);
    } catch (e2) {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

const warn = (list, fn, ...args) => list.push({ fn, args });

async function processUploads(files) {
  const results = [];
  const warnings = [];

  const handleCsv = (name, patientSource, u8) => {
    const category = parseCategory(name);
    if (!category) { warn(warnings, "warnBadDir", name); return; }
    let ch;
    try {
      ch = readChannels(u8);
    } catch (err) {
      warn(warnings, "warnInvalid", name, err.message);
      return;
    }
    const feats = fileFeatures(ch, category.direction);
    if (feats.length === 0) { warn(warnings, "warnNoTarget", name); return; }
    const map = channelsFor(category.direction);
    const time = ch["Time(sec)"];
    const sd = {
      Left: computeOffCenterSD(time, ch[map.left]),
      Right: computeOffCenterSD(time, ch[map.right]),
    };
    results.push({
      patient: parsePatient(patientSource),
      sortKey: patientSortKey(patientSource),
      feats, category, sd,
    });
  };

  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      if (typeof JSZip === "undefined") { warn(warnings, "warnBadZip", f.name); continue; }
      let zip;
      try {
        zip = await JSZip.loadAsync(f.buffer, { decodeFileName: decodeZipName });
      } catch (e) {
        warn(warnings, "warnBadZip", f.name); continue;
      }
      const entries = Object.values(zip.files).filter(
        (e) => !e.dir && e.name.toLowerCase().endsWith(".csv")
      );
      if (entries.length === 0) warn(warnings, "warnNoCsv", f.name);
      for (const entry of entries) {
        const u8 = await entry.async("uint8array");
        const patientSource = entry.name.includes("/") ? entry.name : f.name;
        handleCsv(entry.name, patientSource, u8);
      }
    } else if (lower.endsWith(".csv")) {
      handleCsv(f.name, f.name, new Uint8Array(f.buffer));
    } else {
      warn(warnings, "warnUnsupported", f.name);
    }
  }
  return { results, warnings };
}

// ---------------------------------------------------------------------------
// Aggregate per patient -> features -> flags -> verdict
// ---------------------------------------------------------------------------

function logisticProb(feat) {
  let logit = MODEL.bias;
  for (const f of MODEL.order) {
    const z = (feat[f] - MODEL.mean[f]) / MODEL.std[f];
    if (!Number.isFinite(z)) return NaN;
    logit += MODEL.weights[f] * z;
  }
  return 1 / (1 + Math.exp(-logit));
}

function buildResults(results) {
  // patient -> {sortKey, feats, hCount}. hCount = horizontal off-center SD
  // cells (3 freq x Left/Right x Above/Below = 12) whose SD exceeds SD_THRESHOLD.
  const byPatient = new Map();
  for (const r of results) {
    if (!byPatient.has(r.patient)) byPatient.set(r.patient, { sortKey: r.sortKey, feats: [], hCount: 0 });
    const rec = byPatient.get(r.patient);
    rec.feats.push(...r.feats);
    if (r.category && r.category.direction === "Horizontal" && r.sd) {
      for (const side of ["Left", "Right"]) {
        for (const reg of ["above", "below"]) {
          const v = r.sd[side][reg];
          if (Number.isFinite(v) && v > SD_THRESHOLD) rec.hCount++;
        }
      }
    }
  }

  const rows = [];
  for (const [patient, { sortKey, feats, hCount }] of byPatient) {
    const f = {};
    for (const k of MODEL.order) f[k] = nanmean(feats.map((x) => x[k]));
    const prob = logisticProb(f);
    const hasData = Number.isFinite(f.track_err) && Number.isFinite(f.gain);
    const flag1 = hasData && (f.track_err > RULE.teThr || f.gain < RULE.gainThr);
    const flag2 = Number.isFinite(prob) && prob > 0.5;
    let verdict = "vNoData";
    if (hasData) verdict = flag1 && flag2 ? "vVeryLikely" : (flag1 || flag2 ? "vPossible" : "vLow");
    // SD flag + index (index = hCount/2 + ML-risk% / 10; e.g. 33% -> 3.3)
    const sdFlag = hCount > SD_FLAG_MIN;
    const index = hCount / 2 + (Number.isFinite(prob) ? prob * 10 : 0);
    rows.push({ patient, sortKey, ...f, prob, flag1, flag2, verdict, hCount, sdFlag, index });
  }
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { numeric: true }));
  return rows;
}

// --- Off-center SD table (shown on toggle), same shape as the SD page ---
function buildSdTable(results) {
  const cats = new Map();
  for (const r of results) if (r.category) cats.set(r.category.label, r.category);
  const ordered = [...cats.values()].sort((a, b) => {
    const ka = categorySortKey(a), kb = categorySortKey(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
  const columns = ordered.map((c) => c.label);
  const redColumns = ordered.filter((c) => c.type === "R").map((c) => c.label);

  const keyOf = new Map();
  for (const r of results) if (!keyOf.has(r.patient)) keyOf.set(r.patient, r.sortKey || "");
  const patients = [...keyOf.keys()].sort((a, b) =>
    keyOf.get(a).localeCompare(keyOf.get(b), undefined, { numeric: true })
  );

  const cell = new Map(); // `${patient}||${side}||${Above|Below}` -> {label: SD}
  const put = (key, label, v) => { if (!cell.has(key)) cell.set(key, {}); cell.get(key)[label] = v; };
  for (const r of results) {
    if (!r.category || !r.sd) continue;
    for (const side of ["Left", "Right"]) {
      put(`${r.patient}||${side}||Above`, r.category.label, r.sd[side].above);
      put(`${r.patient}||${side}||Below`, r.category.label, r.sd[side].below);
    }
  }

  const regionRows = [];
  for (const patient of patients)
    for (const side of ["Left", "Right"])
      for (const reg of ["Above", "Below"])
        regionRows.push({ patient, side, region: reg, values: cell.get(`${patient}||${side}||${reg}`) || {} });

  return { columns, redColumns, patients, regionRows };
}

// ---------------------------------------------------------------------------
// Formatting + Excel export
// ---------------------------------------------------------------------------

const fmt3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "");
const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + "%" : "");
const yn = (b) => (b ? "✓" : "–");

async function toExcelBlob(rows, sdTable) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("MG screening");
  const headers = ["Patient", "track_err", "gain", "corr2", "err_drop", "gain_drop",
                   "ML risk", "Flag1 rule", "Flag2 ML", "Verdict", "Horiz SD>3", "SD flag", "Index"];
  ws.addRow(headers).eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    cell.alignment = { horizontal: "center" };
  });
  const vText = { vVeryLikely: "Very likely", vPossible: "Possible", vLow: "Low", vNoData: "No laser data" };
  const vFill = { vVeryLikely: "FFF8CBCB", vPossible: "FFFCE7C6", vLow: "FFD8EFD8", vNoData: "FFEDEDED" };
  for (const r of rows) {
    const row = ws.addRow([r.patient, r.track_err, r.gain, r.corr2, r.err_drop, r.gain_drop,
                           r.prob, r.flag1 ? "YES" : "no", r.flag2 ? "YES" : "no", vText[r.verdict],
                           r.hCount, r.sdFlag ? "YES" : "no", r.index]);
    for (let i = 2; i <= 6; i++) row.getCell(i).numFmt = "0.0000";
    row.getCell(7).numFmt = "0%";
    row.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: vFill[r.verdict] } };
    row.getCell(13).numFmt = "0.0";
  }
  headers.forEach((n, i) => (ws.getColumn(i + 1).width = Math.max(n.length, 10) + 2));
  ws.views = [{ state: "frozen", ySplit: 1 }];

  // Second sheet: off-center SD detail (matches the toggled table).
  if (sdTable) {
    const ws2 = wb.addWorksheet("Off-center SD");
    const h2 = ["Patient", "Eye", "Region", ...sdTable.columns];
    ws2.addRow(h2).eachCell((cell, col) => {
      const name = h2[col - 1], red = sdTable.redColumns.includes(name);
      cell.font = { bold: true, color: { argb: red ? "FFFF0000" : "FF000000" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      cell.alignment = { horizontal: "center" };
    });
    for (const row of sdTable.regionRows) {
      const vals = [row.patient, row.side, row.region === "Above" ? "Above +2" : "Below -2"];
      for (const label of sdTable.columns) {
        const v = row.values[label];
        vals.push(Number.isFinite(v) ? v : null);
      }
      const rr = ws2.addRow(vals);
      for (let i = 4; i <= h2.length; i++) rr.getCell(i).numFmt = "0.0000";
    }
    h2.forEach((n, i) => (ws2.getColumn(i + 1).width = Math.max(n.length, 10) + 2));
    ws2.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

const els = {};
let lastRows = null;
let lastSdTable = null;
let sdVisible = false;
let lastWarnings = [];
let statusState = null;

function renderResults(rows) {
  if (!rows || !rows.length) {
    els.results.innerHTML = "";
    els.resultsHeading.style.display = "none";
    els.legend.style.display = "none";
    return;
  }
  els.resultsHeading.style.display = "block";
  els.legend.style.display = "block";
  const H = [t("colPatient"), t("colErr"), t("colGain"), t("colFatigue"), t("colRisk"),
            t("colFlag1"), t("colFlag2"), t("colVerdict"), t("colSdFlag"), t("colIndex")];
  let html = "<table><thead><tr>" + H.map((h) => `<th>${h}</th>`).join("") + "</tr></thead><tbody>";
  const cls = { vVeryLikely: "v-high", vPossible: "v-mid", vLow: "v-low", vNoData: "v-none" };
  for (const r of rows) {
    html += `<tr>`
      + `<td class="patient">${r.patient}</td>`
      + `<td>${fmt3(r.track_err)}</td>`
      + `<td>${fmt3(r.gain)}</td>`
      + `<td>${fmt3(r.gain_drop)}</td>`
      + `<td>${pct(r.prob)}</td>`
      + `<td>${yn(r.flag1)}</td>`
      + `<td>${yn(r.flag2)}</td>`
      + `<td class="verdict ${cls[r.verdict]}">${t(r.verdict)}</td>`
      + `<td${r.sdFlag ? ' class="sd-flag"' : ""}>${yn(r.sdFlag)} (${r.hCount})</td>`
      + `<td>${r.index.toFixed(1)}</td>`
      + `</tr>`;
  }
  els.results.innerHTML = html + "</tbody></table>";
}

// ---- Off-center SD detail table (toggled) ----
function categoryLabelDisplay(label) {
  if (currentLang === "ko")
    return label.replace(/^Horizontal/, t("dirHorizontal")).replace(/^Vertical/, t("dirVertical"));
  return label;
}
const sideDisplay = (s) => (s === "Left" ? t("eyeLeft") : t("eyeRight"));
const regionDisplay = (r) => (r === "Above" ? t("regionAbove") : t("regionBelow"));

function renderSdTable(table) {
  if (!table) { els.sdResults.innerHTML = ""; return; }
  const catHeaders = table.columns.map(categoryLabelDisplay);
  const redSet = new Set(table.redColumns.map(categoryLabelDisplay));
  let html = "<table><thead><tr>";
  html += `<th>${t("colPatient")}</th><th>${t("colEye")}</th><th>${t("colRegion")}</th>`;
  for (const h of catHeaders) html += `<th${redSet.has(h) ? ' class="red"' : ""}>${h}</th>`;
  html += "</tr></thead><tbody>";
  let prev = null;
  for (const row of table.regionRows) {
    const gc = row.patient !== prev && prev !== null ? ' class="group-top"' : "";
    prev = row.patient;
    html += `<tr${gc}><td class="patient">${row.patient}</td><td>${sideDisplay(row.side)}</td><td>${regionDisplay(row.region)}</td>`;
    for (const label of table.columns) {
      const red = table.redColumns.includes(label) ? ' class="red"' : "";
      html += `<td${red}>${fmt3(row.values[label])}</td>`;
    }
    html += "</tr>";
  }
  els.sdResults.innerHTML = html + "</tbody></table>";
}

function applySdVisibility() {
  const on = sdVisible && lastSdTable;
  els.sdResults.style.display = on ? "block" : "none";
  els.sdHeading.style.display = on ? "block" : "none";
  els.sdToggle.textContent = sdVisible ? t("sdToggleHide") : t("sdToggleShow");
}

function renderWarnings(warnings) {
  lastWarnings = warnings;
  els.warnings.innerHTML = warnings
    .map((w) => `<div class="warn">⚠️ ${t(w.fn)(...w.args)}</div>`)
    .join("");
}

function renderStatus() {
  const s = statusState;
  if (!s) els.status.innerHTML = "";
  else if (s.type === "processing") els.status.innerHTML = t("statusProcessing");
  else if (s.type === "processed")
    els.status.innerHTML = `<span class="ok">${t("statusProcessed")(s.n, s.p)}</span>`;
  else if (s.type === "noValid")
    els.status.innerHTML = `<span class="error">${t("statusNoValid")}</span>`;
}

const setStatus = (state) => { statusState = state; renderStatus(); };

async function handleFiles(fileList) {
  const files = [];
  for (const f of fileList) files.push({ name: f.name, buffer: await f.arrayBuffer() });
  setStatus({ type: "processing" });
  const { results, warnings } = await processUploads(files);
  renderWarnings(warnings);

  if (results.length === 0) {
    setStatus({ type: "noValid" });
    lastRows = null; lastSdTable = null;
    renderResults(null); renderSdTable(null);
    els.sdToggle.style.display = "none";
    applySdVisibility();
    els.download.disabled = true;
    return;
  }
  const rows = buildResults(results);
  lastRows = rows;
  lastSdTable = buildSdTable(results);
  setStatus({ type: "processed", n: results.length, p: rows.length });
  renderResults(rows);
  renderSdTable(lastSdTable);
  els.sdToggle.style.display = "inline-block";
  applySdVisibility();
  els.download.disabled = false;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function downloadExcel() {
  if (!lastRows) return;
  const blob = await toExcelBlob(lastRows, lastSdTable);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MG_screening_${stamp()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function applyTranslations() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  const link = document.getElementById("templateLink");
  if (link) link.href = TEMPLATE_URL;
  els.langToggle.textContent = t("langButton");
  renderStatus();
  renderWarnings(lastWarnings);
  renderResults(lastRows);
  renderSdTable(lastSdTable);
  applySdVisibility();
}

const setLang = (lang) => { currentLang = lang; applyTranslations(); };

window.addEventListener("DOMContentLoaded", () => {
  els.input = document.getElementById("fileInput");
  els.drop = document.getElementById("dropZone");
  els.results = document.getElementById("results");
  els.resultsHeading = document.getElementById("resultsHeading");
  els.legend = document.getElementById("legend");
  els.warnings = document.getElementById("warnings");
  els.status = document.getElementById("status");
  els.download = document.getElementById("downloadBtn");
  els.langToggle = document.getElementById("langToggle");
  els.sdToggle = document.getElementById("sdToggle");
  els.sdHeading = document.getElementById("sdHeading");
  els.sdResults = document.getElementById("sdResults");

  applyTranslations();

  els.langToggle.addEventListener("click", () => setLang(currentLang === "en" ? "ko" : "en"));
  els.input.addEventListener("change", (e) => handleFiles(e.target.files));
  els.download.addEventListener("click", downloadExcel);
  els.sdToggle.addEventListener("click", () => { sdVisible = !sdVisible; applySdVisibility(); });

  ["dragenter", "dragover"].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("hover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove("hover"); }));
  els.drop.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  els.drop.addEventListener("click", () => els.input.click());
});
