/*
 * Off-Center Eye Movement R² — browser logic.
 *
 * Splits each recording's eye positions into two off-center groups:
 *   "Above" = samples where eye value > +2,  "Below" = samples where eye < -2
 * (the ±2 range is treated as "center" and ignored). For each group it computes
 * R² of eye position vs. Time — i.e. how the eye behaves once it is off-center.
 *
 * Correct channel per direction: Horizontal -> LH/RH, Vertical -> LV/RV.
 * Everything runs client-side. No server, no upload leaves the machine.
 */

const TEMPLATE_URL =
  "https://docs.google.com/spreadsheets/d/1IQTNE3Myjq02l14CmzQXs7IanzrO20VaoszoD1NyKes/edit?usp=sharing";

const CENTER = 2; // |eye| <= CENTER is treated as centered and excluded
const SIDES = ["Left", "Right"];
const REGIONS = ["Above", "Below"];
const DIRECTIONS = ["Horizontal", "Vertical"];
const FREQUENCIES = ["0.5", "0.75", "1"];
const REQUIRED_COLUMNS = ["Time(sec)", "LH", "RH", "LV", "RV"];

const SIG_FIGS = 4;
const EXCEL_NUM_FMT = "0.0000000";

function channelsFor(direction) {
  return direction === "Vertical"
    ? { Left: "LV", Right: "RV" }
    : { Left: "LH", Right: "RH" };
}

// ---------------------------------------------------------------------------
// Internationalization (English / Korean)
// ---------------------------------------------------------------------------

const I18N = {
  en: {
    langButton: "한국어",
    navLabel: "🩺 MG screening →",
    title: "👁️ Off-Center Eye Movement R² (tired eyes)",
    subtitle:
      "Upload eye-tracking recordings; the tool uses only the <strong>second half</strong> " +
      "of each recording (tired eyes) and, within it, keeps only the <strong>off-center</strong> " +
      "samples (eye position <strong>above +2</strong> or <strong>below −2</strong>, " +
      "ignoring the ±2 center), then computes <strong>R² vs. time</strong> for each group. " +
      "Everything runs in your browser; nothing is uploaded to a server.",
    infoSummary: "ℹ️ How to use / required data format",
    step1:
      'Your files must match the column format in this template: ' +
      '<a id="templateLink" href="#" target="_blank" rel="noopener">Example Google Sheet</a>.',
    step2:
      "Each recording is a <code>.csv</code> with columns " +
      "<code>Time(sec), LH, RH, LV, RV, TargetH, TargetV</code>.",
    step3:
      "Upload the individual <code>.csv</code> files <strong>or</strong> a " +
      "<code>.zip</code> containing them (one zip per patient works well).",
    step4:
      "Horizontal categories use the <strong>LH/RH</strong> channels; vertical use " +
      "<strong>LV/RV</strong>. Patient name and category are read from the file names.",
    warning:
      "⚠️ The calculator will not work if the files are not in the correct format. " +
      "A group is left blank if the eye rarely reaches that side.",
    dropTitle:
      "<strong>Drag &amp; drop</strong> your <code>.csv</code> or " +
      "<code>.zip</code> files here",
    dropSub: "or click to browse",
    downloadBtn: "⬇️ Download Excel spreadsheet",
    redNote: "🔴 Red columns are <strong>R-type</strong> categories.",
    regionHeading: "Off-center R² — second half only (Above = eye > +2, Below = eye < −2, vs. time)",
    colPatient: "Patient",
    colEye: "Eye",
    colRegion: "Region",
    eyeLeft: "Left",
    eyeRight: "Right",
    regionAbove: "Above +2",
    regionBelow: "Below −2",
    dirHorizontal: "Horizontal",
    dirVertical: "Vertical",
    statusProcessing: "Processing…",
    statusProcessed: (n, p) => `Processed ${n} recording(s) across ${p} patient(s).`,
    statusNoValid: "No valid recordings found. Check the file format.",
    warnBadDir: (name) => `Skipped "${name}": could not read direction/frequency from name.`,
    warnInvalid: (name, msg) => `Skipped "${name}": ${msg}`,
    warnBadZip: (name) => `Skipped "${name}": not a valid .zip file.`,
    warnNoCsv: (name) => `Skipped "${name}": zip contained no .csv files.`,
    warnUnsupported: (name) => `Skipped "${name}": unsupported file type (need .csv or .zip).`,
  },
  ko: {
    langButton: "English",
    navLabel: "🩺 MG 선별 →",
    title: "👁️ 중심 이탈 안구 운동 R² (피로한 눈)",
    subtitle:
      "안구 추적 기록을 업로드하면 각 기록의 <strong>후반부</strong>(피로한 눈)만 사용하고, " +
      "그 안에서 <strong>중심을 벗어난</strong> 샘플" +
      "(눈 위치가 <strong>+2 초과</strong> 또는 <strong>−2 미만</strong>, ±2 중심 범위는 제외)만 " +
      "남겨 각 그룹의 <strong>시간 대비 R²</strong>를 계산합니다. 모든 계산은 브라우저에서 " +
      "실행되며 서버로 전송되지 않습니다.",
    infoSummary: "ℹ️ 사용 방법 / 필수 데이터 형식",
    step1:
      "파일은 이 템플릿의 열 형식과 일치해야 합니다: " +
      '<a id="templateLink" href="#" target="_blank" rel="noopener">예시 Google 시트</a>.',
    step2:
      "각 기록은 <code>Time(sec), LH, RH, LV, RV, TargetH, TargetV</code> " +
      "열을 가진 <code>.csv</code> 파일입니다.",
    step3:
      "개별 <code>.csv</code> 파일 <strong>또는</strong> 이를 담은 " +
      "<code>.zip</code> 파일을 업로드하세요 (환자당 zip 하나가 편리합니다).",
    step4:
      "수평 카테고리는 <strong>LH/RH</strong>, 수직은 <strong>LV/RV</strong> 채널을 " +
      "사용합니다. 환자 이름과 카테고리는 파일 이름에서 읽습니다.",
    warning:
      "⚠️ 파일이 올바른 형식이 아니면 계산기가 작동하지 않습니다. 눈이 해당 방향에 " +
      "거의 도달하지 않으면 그룹은 비워집니다.",
    dropTitle:
      "<strong>드래그 앤 드롭</strong>으로 <code>.csv</code> 또는 " +
      "<code>.zip</code> 파일을 여기에 놓으세요",
    dropSub: "또는 클릭하여 파일 선택",
    downloadBtn: "⬇️ Excel 스프레드시트 다운로드",
    redNote: "🔴 빨간색 열은 <strong>R 유형</strong> 카테고리입니다.",
    regionHeading: "중심 이탈 R² — 후반부만 (Above = 눈 > +2, Below = 눈 < −2, 시간 대비)",
    colPatient: "환자",
    colEye: "눈",
    colRegion: "구간",
    eyeLeft: "좌안",
    eyeRight: "우안",
    regionAbove: "+2 초과",
    regionBelow: "−2 미만",
    dirHorizontal: "수평",
    dirVertical: "수직",
    statusProcessing: "처리 중…",
    statusProcessed: (n, p) => `${n}개의 기록을 ${p}명의 환자에 대해 처리했습니다.`,
    statusNoValid: "유효한 기록을 찾을 수 없습니다. 파일 형식을 확인하세요.",
    warnBadDir: (name) => `"${name}" 건너뜀: 파일 이름에서 방향/주파수를 읽을 수 없습니다.`,
    warnInvalid: (name, msg) => `"${name}" 건너뜀: ${msg}`,
    warnBadZip: (name) => `"${name}" 건너뜀: 올바른 .zip 파일이 아닙니다.`,
    warnNoCsv: (name) => `"${name}" 건너뜀: zip에 .csv 파일이 없습니다.`,
    warnUnsupported: (name) => `"${name}" 건너뜀: 지원되지 않는 파일 형식입니다 (.csv 또는 .zip 필요).`,
  },
};

let currentLang = "en";
const t = (key) => I18N[currentLang][key];

function categoryLabelDisplay(label) {
  if (currentLang === "ko") {
    return label
      .replace(/^Horizontal/, I18N.ko.dirHorizontal)
      .replace(/^Vertical/, I18N.ko.dirVertical);
  }
  return label;
}
const sideDisplay = (side) => (side === "Left" ? t("eyeLeft") : t("eyeRight"));
const regionDisplay = (reg) => (reg === "Above" ? t("regionAbove") : t("regionBelow"));

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

function parseCategory(name) {
  const base = baseName(name);
  let direction;
  if (/horizontal/i.test(base)) direction = "Horizontal";
  else if (/vertical/i.test(base)) direction = "Vertical";
  else return null;

  const freqMatch = base.match(/(\d+(?:\.\d+)?)\s*Hz/i);
  if (!freqMatch) return null;
  const frequency = freqMatch[1];

  const typeMatch = base.match(/Saccade\s+([BR])\b/i);
  const type = typeMatch ? typeMatch[1].toUpperCase() : "B";

  return { direction, frequency, type, label: `${direction} ${frequency}Hz ${type}` };
}

// ---------------------------------------------------------------------------
// CSV reading + off-center R²
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

/** R² (squared Pearson corr) of x vs y over points where finite AND keep(x,y). */
function rSquaredWhere(x, y, keep) {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i]) && keep(x[i], y[i])) {
      n++; sx += x[i]; sy += y[i];
    }
  }
  if (n < 2) return NaN;
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i]) && keep(x[i], y[i])) {
      const dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
  }
  if (sxx === 0 || syy === 0) return NaN;
  const r = sxy / Math.sqrt(sxx * syy);
  return r * r;
}

/** {above, below} R² for one channel: eye vs time over off-center samples,
 *  using ONLY the second half of the recording (by time) — "tired eyes".
 *  The first half is discarded before splitting into Above (+2) / Below (-2).
 */
function computeChannel(time, ch) {
  let tmin = Infinity, tmax = -Infinity;
  for (let i = 0; i < time.length; i++) {
    if (Number.isFinite(time[i]) && Number.isFinite(ch[i])) {
      if (time[i] < tmin) tmin = time[i];
      if (time[i] > tmax) tmax = time[i];
    }
  }
  if (!Number.isFinite(tmin)) return { above: NaN, below: NaN };
  const mid = (tmin + tmax) / 2; // keep only samples after the midpoint
  return {
    above: rSquaredWhere(time, ch, (tt, ee) => tt > mid && ee > CENTER),
    below: rSquaredWhere(time, ch, (tt, ee) => tt > mid && ee < -CENTER),
  };
}

function computeFileMetric(bytes, direction) {
  const ch = readChannels(bytes);
  const time = ch["Time(sec)"];
  const map = channelsFor(direction);
  return {
    Left: computeChannel(time, ch[map.Left]),
    Right: computeChannel(time, ch[map.Right]),
  };
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
    try {
      const metric = computeFileMetric(u8, category.direction);
      results.push({
        patient: parsePatient(patientSource),
        category,
        metric,
        sortKey: patientSortKey(patientSource),
      });
    } catch (err) {
      warn(warnings, "warnInvalid", name, err.message);
    }
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
// Table building
// ---------------------------------------------------------------------------

function categorySortKey(c) {
  return [
    c.type === "B" ? 0 : 1,
    DIRECTIONS.indexOf(c.direction) >= 0 ? DIRECTIONS.indexOf(c.direction) : 99,
    FREQUENCIES.indexOf(c.frequency) >= 0 ? FREQUENCIES.indexOf(c.frequency) : 99,
  ];
}

function buildTable(results) {
  const cats = new Map();
  for (const r of results) cats.set(r.category.label, r.category);
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

  const region = new Map(); // `${patient}||${side}||${region}` -> {label: R²}
  const put = (key, label, v) => {
    if (!region.has(key)) region.set(key, {});
    region.get(key)[label] = v;
  };
  for (const r of results) {
    for (const side of SIDES) {
      const m = r.metric[side];
      put(`${r.patient}||${side}||Above`, r.category.label, m.above);
      put(`${r.patient}||${side}||Below`, r.category.label, m.below);
    }
  }

  const regionRows = [];
  for (const patient of patients) {
    for (const side of SIDES) {
      for (const reg of REGIONS) {
        regionRows.push({
          patient, side, region: reg,
          values: region.get(`${patient}||${side}||${reg}`) || {},
        });
      }
    }
  }

  return { columns, redColumns, patients, regionRows };
}

// ---------------------------------------------------------------------------
// Formatting + Excel export
// ---------------------------------------------------------------------------

const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(SIG_FIGS) : "");
const roundVal = (v) => (Number.isFinite(v) ? Number(v.toPrecision(SIG_FIGS)) : null);

function styleHeaderCell(cell, name, redColumns) {
  const isRed = redColumns.includes(name);
  cell.font = { bold: true, color: { argb: isRed ? "FFFF0000" : "FF000000" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  cell.alignment = { horizontal: "center" };
}

async function toExcelBlob(table) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Off-center R²");
  const headers = ["Patient", "Eye", "Region", ...table.columns];
  ws.addRow(headers).eachCell((cell, col) =>
    styleHeaderCell(cell, headers[col - 1], table.redColumns)
  );
  for (const row of table.regionRows) {
    const vals = [row.patient, row.side, row.region === "Above" ? "Above +2" : "Below -2"];
    for (const label of table.columns) vals.push(roundVal(row.values[label]));
    const r = ws.addRow(vals);
    for (let i = 4; i <= headers.length; i++) r.getCell(i).numFmt = EXCEL_NUM_FMT;
  }
  headers.forEach((n, i) => (ws.getColumn(i + 1).width = Math.max(n.length, 10) + 2));
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

const els = {};
let lastTable = null;
let lastWarnings = [];
let statusState = null;

function renderRegionTable(table) {
  if (!table) { els.regionResults.innerHTML = ""; els.regionHeading.style.display = "none"; return; }
  els.regionHeading.style.display = "block";
  const catHeaders = table.columns.map(categoryLabelDisplay);
  const redSet = new Set(table.redColumns.map(categoryLabelDisplay));
  let html = "<table><thead><tr>";
  html += `<th>${t("colPatient")}</th><th>${t("colEye")}</th><th>${t("colRegion")}</th>`;
  for (const h of catHeaders) html += `<th${redSet.has(h) ? ' class="red"' : ""}>${h}</th>`;
  html += "</tr></thead><tbody>";
  let prevPatient = null;
  for (const row of table.regionRows) {
    const cls = row.patient !== prevPatient && prevPatient !== null ? ' class="group-top"' : "";
    prevPatient = row.patient;
    html += `<tr${cls}><td class="patient">${row.patient}</td><td>${sideDisplay(row.side)}</td><td>${regionDisplay(row.region)}</td>`;
    for (const label of table.columns) {
      const red = table.redColumns.includes(label) ? ' class="red"' : "";
      html += `<td${red}>${fmt(row.values[label])}</td>`;
    }
    html += "</tr>";
  }
  els.regionResults.innerHTML = html + "</tbody></table>";
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
    lastTable = null;
    renderRegionTable(null);
    els.download.disabled = true;
    els.redNote.style.display = "none";
    return;
  }
  const table = buildTable(results);
  lastTable = table;
  setStatus({ type: "processed", n: results.length, p: table.patients.length });
  renderRegionTable(table);
  els.download.disabled = false;
  els.redNote.style.display = table.redColumns.length ? "block" : "none";
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function downloadExcel() {
  if (!lastTable) return;
  const blob = await toExcelBlob(lastTable);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Eye_offcenter_R2_${stamp()}.xlsx`;
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
  renderRegionTable(lastTable);
}

const setLang = (lang) => { currentLang = lang; applyTranslations(); };

window.addEventListener("DOMContentLoaded", () => {
  els.input = document.getElementById("fileInput");
  els.drop = document.getElementById("dropZone");
  els.regionResults = document.getElementById("regionResults");
  els.regionHeading = document.getElementById("regionHeading");
  els.warnings = document.getElementById("warnings");
  els.status = document.getElementById("status");
  els.download = document.getElementById("downloadBtn");
  els.redNote = document.getElementById("redNote");
  els.langToggle = document.getElementById("langToggle");

  applyTranslations();

  els.langToggle.addEventListener("click", () => setLang(currentLang === "en" ? "ko" : "en"));
  els.input.addEventListener("change", (e) => handleFiles(e.target.files));
  els.download.addEventListener("click", downloadExcel);

  ["dragenter", "dragover"].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("hover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove("hover"); }));
  els.drop.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  els.drop.addEventListener("click", () => els.input.click());
});
