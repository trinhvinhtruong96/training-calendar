// The page: rendering and interaction. All data logic lives in the pure modules.
import { ATHLETE, PLAN } from "./config.js";
import { KeyError, NetworkError, connect, createStore, refresh } from "./api.js";
import {
  WEEKDAYS, addDays, clampWeek, diffDays, formatClock, formatDate, formatDuration, formatKm, formatPace, formatShortRange,
  localToday, timeAgo, weekNumber,
} from "./dates.js";
import { GROUP, TYPE_LABEL, formatStepAmount, noteText, paceRange, shortName, stepLevel, stepName, workoutBar } from "./workout.js";
import { buildModel, dayLabel, dayUrl, headerInfo, primaryWorkout, resultText, runSummary, statusInfo } from "./model.js";
import {
  LEVELS, RACES, formatDelta, predictionSeries, predictorDates, vo2At, vo2Change, vo2Level, vo2Series,
} from "./fitness.js";

let storage = null;
try {
  storage = window.localStorage;
} catch {
  storage = null;
}
const store = createStore(storage);

const app = document.getElementById("app");
const live = document.getElementById("live");
const details = document.getElementById("details");
const settings = document.getElementById("settings");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  data: null,
  model: null,
  today: localToday(),
  viewWeek: null,
  focusDate: null,
  status: { kind: "idle", message: "" },
  hiddenAt: 0,
  detailsDate: null,
  opener: null,
  session: 0, // bumped on Forget / new key so late refresh results are dropped
  openWeeks: null, // week numbers expanded in the phone plan list
  fitness: { vo2: "current", race: "current", distance: "half" }, // selected tabs
};

const SVG_NS = "http://www.w3.org/2000/svg";
const MARKS = { test: "T", key: "K", race: "R" };
const NEW_TAB = " (opens in a new tab)";
const ICONS = {
  refresh: ["M20 11a8 8 0 1 0-2.34 5.66", "M20 4v7h-7"],
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"],
  left: ["M15 18l-6-6 6-6"],
  right: ["M9 18l6-6-6-6"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"],
};
const FOCUS_FALLBACK = {
  "btn:this-week": ["btn:prev-week", "btn:next-week"],
  "btn:prev-week": ["btn:next-week"],
  "btn:next-week": ["btn:prev-week"],
};

// ---------- helpers ----------
function h(tag, props, ...children) {
  const isSvg = tag.startsWith("svg:");
  const el = isSvg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "text") el.textContent = v;
    else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === "") continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function icon(name) {
  return h("svg:svg", { class: "icon", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    ICONS[name].map(d => h("svg:path", { d })));
}

function externalLink(href, label) {
  return h("a", { class: "link", href, target: "_blank", rel: "noopener noreferrer" },
    label, icon("external"), h("span", { class: "sr-only", text: NEW_TAB }));
}

function announce(message) {
  live.textContent = "";
  window.setTimeout(() => { live.textContent = message; }, 60);
}

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

const hasData = data => Boolean(data && Array.isArray(data.events));
const currentWeek = () => clampWeek(weekNumber(state.today, PLAN), PLAN);
const pct = (part, whole) => `${(whole ? Math.min(100, (part / whole) * 100) : 0).toFixed(1)}%`;
const byKey = key => app.querySelector(`[data-key="${CSS.escape(key)}"]`);

// ---------- state → page ----------
function rebuild() {
  state.today = localToday();
  state.model = buildModel(state.data, state.today, PLAN);
  if (state.viewWeek == null) state.viewWeek = currentWeek();
  if (!state.openWeeks) state.openWeeks = new Set([currentWeek()]);
  if (!state.focusDate || !state.model.byDate.has(state.focusDate)) {
    state.focusDate = state.model.byDate.has(state.today) ? state.today : state.model.days[0].date;
  }
}

function render() {
  if (!state.model) rebuild();
  const active = document.activeElement;
  const activeKey = active && app.contains(active) ? active.dataset.key : null;
  app.replaceChildren(
    renderHeader(),
    h("main", { id: "main", class: "layout" }, renderToday(), renderWeek(), renderVo2(), renderPredictor(), renderPlan()),
    h("button", { type: "button", class: "fab", "data-key": "btn:fab", onclick: goToToday }, "Today"),
  );
  app.removeAttribute("aria-busy");
  if (activeKey) restoreFocus(activeKey);
  if (details.open && state.detailsDate) fillDetails(state.detailsDate);
}

function restoreFocus(key) {
  for (const k of [key, ...(FOCUS_FALLBACK[key] ?? [])]) {
    const el = byKey(k);
    if (el && !el.disabled) {
      el.focus({ preventScroll: true });
      return;
    }
  }
}

// ---------- header ----------
function statusText() {
  const at = state.data?.fetchedAt;
  const when = at ? timeAgo(at) : "";
  switch (state.status.kind) {
    case "loading": return "Updating…";
    case "offline": return when ? `Offline · updated ${when}` : "Offline";
    case "error": return when ? `Couldn't update · updated ${when}` : "Couldn't update";
    default: return when ? `Updated ${when}` : "Not updated yet";
  }
}

function renderHeader() {
  const info = headerInfo(state.today, PLAN);
  return h("header", { class: "top" },
    h("div", { class: "top-inner" },
      h("div", { class: "brand" },
        h("h1", { text: PLAN.title }),
        h("p", { class: "sub", text: info.text })),
      h("div", { class: "actions" },
        h("button", {
          type: "button",
          class: `status-btn ${state.status.kind}`,
          "data-key": "btn:refresh",
          "aria-label": `Refresh. ${statusText()}`,
          onclick: () => doRefresh({ announceResult: true }),
        },
          h("span", { class: "status-dot", "aria-hidden": "true" }),
          h("span", { class: "status-text", text: statusText() }),
          icon("refresh")),
        h("button", { type: "button", class: "btn ghost today-btn", "data-key": "btn:today", onclick: goToToday }, "Today"),
        h("button", { type: "button", class: "icon-btn", "data-key": "btn:settings", "aria-label": "Settings", onclick: openSettings },
          icon("settings")))),
    h("div", { class: "progress", "aria-hidden": "true" }, h("span", { style: { "--p": pct(info.progress, 1) } })));
}

function updateStatus() {
  const btn = app.querySelector(".status-btn");
  if (!btn) return;
  btn.className = `status-btn ${state.status.kind}`;
  btn.setAttribute("aria-label", `Refresh. ${statusText()}`);
  btn.querySelector(".status-text").textContent = statusText();
}

// ---------- today ----------
function renderToday() {
  const t = state.today;
  const day = state.model.byDate.get(t);
  const eyebrow = [`Today · ${formatDate(t)}`];
  if (day) eyebrow.push(`Week ${day.week} · ${PLAN.phases[day.week - 1]}`);
  const section = h("section", { class: "card today", id: "today", tabindex: "-1", "aria-labelledby": "today-title" },
    h("p", { class: "eyebrow", text: eyebrow.join(" · ") }));

  if (t < PLAN.firstDay) {
    const first = state.model.days.find(d => d.workouts.length);
    section.append(
      h("h2", { id: "today-title", class: "workout-title", text: `Plan starts ${formatDate(PLAN.firstDay)}` }),
      first ? previewButton(first, "First workout") : "");
    return section;
  }
  if (t > PLAN.raceDay) {
    const { totals } = state.model;
    section.append(
      h("h2", { id: "today-title", class: "workout-title", text: "Plan complete" }),
      h("p", {
        class: "workout-meta",
        text: `${formatKm(totals.doneM)} km run of ${formatKm(totals.plannedM)} km planned · ${totals.doneWorkouts} of ${totals.workouts} workouts done`,
      }));
    return section;
  }

  if (day.workouts.length) {
    day.workouts.forEach((w, i) => section.append(workoutBlock(w, { titleId: i === 0 ? "today-title" : null, headingTag: i === 0 ? "h2" : "h3" })));
  } else {
    section.append(h("h2", { id: "today-title", class: "workout-title", text: day.notes.length ? "Rest day" : "Nothing planned" }));
    const note = day.notes.map(n => noteText(n.description)).filter(Boolean).join(" ");
    if (note) section.append(h("p", { class: "workout-note", text: note }));
    for (const a of day.extraRuns) section.append(renderRun(a, "Extra run"));
    const next = state.model.days.find(d => d.date > t && d.workouts.length);
    if (next) section.append(previewButton(next, next.date === addDays(t, 1) ? "Tomorrow" : "Next workout"));
  }
  section.append(h("div", { class: "card-foot" },
    h("button", {
      type: "button", class: "btn ghost small", "data-key": "btn:today-details",
      onclick: e => openDetails(t, e.currentTarget),
    }, "Day details")));
  return section;
}

function previewButton(day, label) {
  const w = primaryWorkout(day);
  return h("button", {
    type: "button", class: `preview g-${GROUP[w.type]}`, "data-key": `preview:${day.date}`,
    onclick: e => openDetails(day.date, e.currentTarget),
  },
    h("span", { class: "preview-label", text: `${label} · ${formatDate(day.date)}` }),
    h("span", { class: "preview-name", text: shortName(w.name) }),
    h("span", { class: "preview-meta", text: w.distance ? `${formatKm(w.distance)} km` : "" }));
}

function workoutBlock(w, { titleId = null, headingTag = "h3" } = {}) {
  const note = noteText(w.description);
  const meta = [
    TYPE_LABEL[w.type],
    w.distance ? `${formatKm(w.distance)} km` : "",
    w.movingTime ? `~${formatDuration(w.movingTime)}` : "",
  ].filter(Boolean).join(" · ");
  return h("article", { class: `workout g-${GROUP[w.type]}` },
    h(headingTag, { class: "workout-title", id: titleId, text: shortName(w.name) }),
    h("p", { class: "workout-meta", text: meta }),
    note ? h("p", { class: "workout-note", text: note }) : "",
    renderBar(w.steps),
    renderSteps(w.steps),
    w.run ? renderRun(w.run, "Your run") : renderPending(w));
}

function renderPending(w) {
  if (w.date < state.today) {
    return h("p", { class: "pending missed" }, h("span", { "aria-hidden": "true", text: "! " }), "Missed: no run found for this day.");
  }
  if (w.date === state.today) return h("p", { class: "pending", text: "Not done yet. Your run shows here once it syncs to intervals.icu." });
  return "";
}

function renderBar(steps) {
  const blocks = workoutBar(steps);
  if (!blocks.length) return "";
  const gap = blocks.length > 1 ? 0.5 : 0;
  const usable = 100 - gap * (blocks.length - 1);
  const svg = h("svg:svg", { class: "bar", viewBox: "0 0 100 32", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
  let x = 0;
  for (const b of blocks) {
    const width = Math.max(b.width * usable, 0.3);
    const height = b.height * 32;
    svg.append(h("svg:rect", {
      x: x.toFixed(2), y: (32 - height).toFixed(2), width: width.toFixed(2), height: height.toFixed(2), class: `lv-${b.level}`,
    }));
    x += width + gap;
  }
  return svg;
}

function renderSteps(steps) {
  if (!steps?.length) return "";
  return h("ul", { class: "steps" }, steps.map(s => (s.reps
    ? h("li", { class: "repeat" },
      h("span", { class: "repeat-label" },
        h("span", { "aria-hidden": "true", text: `${s.reps} ×` }),
        h("span", { class: "sr-only", text: `${s.reps} times:` })),
      h("ul", { class: "steps nested" }, (s.steps ?? []).map(stepItem)))
    : stepItem(s))));
}

function stepItem(s) {
  const pace = paceRange(s.pace);
  return h("li", { class: `step lv-${stepLevel(s)}` },
    h("span", { class: "step-dot", "aria-hidden": "true" }),
    h("span", { class: "step-name", text: stepName(s.text) }),
    h("span", { class: "step-amount", text: formatStepAmount(s) }),
    h("span", { class: "step-pace", text: pace ? `${pace} /km` : "" }));
}

function renderRun(a, label) {
  const s = runSummary(a);
  const stats = [["Distance", s.distance], ["Time", s.time], ["Avg pace", s.pace], ["Avg HR", s.hr], ["Compliance", s.compliance]]
    .filter(([, v]) => v);
  return h("div", { class: "run", role: "group", "aria-label": label },
    h("p", { class: "run-title" }, h("span", { class: "run-check", "aria-hidden": "true", text: "✓" }), label),
    stats.length
      ? h("dl", { class: "run-stats" }, stats.map(([k, v]) => h("div", { class: "stat" }, h("dt", { text: k }), h("dd", { text: v }))))
      : "",
    externalLink(s.url, "Open in intervals.icu"));
}

// ---------- week ----------
function renderWeek() {
  const wk = state.model.weeks[state.viewWeek - 1];
  const isCurrent = state.viewWeek === currentWeek();
  const list = h("ul", { class: "week-list" }, wk.days.map(d => h("li", {}, weekRow(d, "week"))));
  bindSwipe(list, dir => changeWeek(dir));
  return h("section", { class: "card week", "aria-labelledby": "week-title" },
    h("div", { class: "section-head" },
      h("div", {},
        h("h2", { id: "week-title", text: isCurrent ? "This week" : `Week ${wk.number}` }),
        h("p", { class: "muted small", text: `Week ${wk.number} of ${PLAN.weeks} · ${wk.phase} · ${formatDate(wk.start)} – ${formatDate(wk.end)}` })),
      h("div", { class: "week-nav" },
        h("button", {
          type: "button", class: "icon-btn", "data-key": "btn:prev-week", "aria-label": "Previous week",
          disabled: state.viewWeek <= 1, onclick: () => changeWeek(-1),
        }, icon("left")),
        isCurrent ? "" : h("button", {
          type: "button", class: "btn ghost small", "data-key": "btn:this-week", onclick: () => setWeek(currentWeek()),
        }, "This week"),
        h("button", {
          type: "button", class: "icon-btn", "data-key": "btn:next-week", "aria-label": "Next week",
          disabled: state.viewWeek >= PLAN.weeks, onclick: () => changeWeek(1),
        }, icon("right")))),
    kmMeter(wk.doneM, wk.plannedM),
    list);
}

function kmMeter(doneM, plannedM) {
  return h("div", { class: "km" },
    h("p", { class: "km-text" }, h("strong", { text: formatKm(doneM) }), ` of ${formatKm(plannedM)} km`),
    h("div", { class: "meter", "aria-hidden": "true" }, h("span", { style: { "--p": pct(doneM, plannedM) } })));
}

function dayName(d) {
  const w = primaryWorkout(d);
  if (w) return shortName(w.name) + (d.workouts.length > 1 ? ` +${d.workouts.length - 1}` : "");
  return d.notes.length ? "Rest" : "Nothing planned";
}

const dayGroup = d => {
  const w = primaryWorkout(d);
  return w ? GROUP[w.type] : d.notes.length ? "rest" : "empty";
};

const plannedKm = d => d.workouts.reduce((t, x) => t + (x.distance || 0), 0);

function weekRow(d, keyPrefix) {
  const st = statusInfo(d, state.today);
  const result = resultText(d, state.today);
  const km = plannedKm(d);
  return h("button", {
    type: "button",
    class: `week-row g-${dayGroup(d)} s-${st.key}${d.isToday ? " is-today" : ""}`,
    "data-key": `${keyPrefix}:${d.date}`,
    "aria-current": d.isToday ? "date" : null,
    "aria-label": dayLabel(d, state.today),
    onclick: e => openDetails(d.date, e.currentTarget),
  },
    h("span", { class: "type-bar", "aria-hidden": "true" }),
    h("span", { class: "wr-date", "aria-hidden": "true" },
      h("span", { class: "wr-wd", text: WEEKDAYS[d.weekday] }),
      h("span", { class: "wr-d", text: String(Number(d.date.slice(8))) })),
    h("span", { class: "wr-main", "aria-hidden": "true" },
      h("span", { class: "wr-name", text: dayName(d) }),
      result.text ? h("span", { class: `wr-result r-${result.kind}`, text: result.text }) : ""),
    h("span", { class: "wr-km", "aria-hidden": "true", text: km ? `${formatKm(km)} km` : "" }));
}

function setWeek(n) {
  state.viewWeek = clampWeek(n, PLAN);
  render();
}

function changeWeek(dir) {
  setWeek(state.viewWeek + dir);
}

function bindSwipe(el, onSwipe) {
  let start = null;
  el.addEventListener("pointerdown", e => {
    if (e.pointerType !== "mouse") start = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener("pointercancel", () => { start = null; });
  el.addEventListener("pointerup", e => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
      el.dataset.swiped = "1";
      onSwipe(dx < 0 ? 1 : -1);
    }
  });
  el.addEventListener("click", e => {
    if (!el.dataset.swiped) return;
    delete el.dataset.swiped;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

// ---------- fitness: VO2 max and race predictor ----------
function periodTabs(name, options, value, label, onChange) {
  return h("fieldset", { class: "segmented tabs" },
    h("legend", { class: "sr-only", text: label }),
    options.map(([v, text]) => h("label", {},
      h("input", { type: "radio", name, value: v, checked: v === value, "data-key": `${name}:${v}`, onchange: () => onChange(v) }),
      text)));
}

const fmtVo2 = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));
// The date the fitness data was fetched for (pace windows end on that day).
const dataDay = () => (state.data?.fetchedAt ? localToday(new Date(state.data.fetchedAt)) : state.today);

function renderVo2() {
  const points = state.data?.vo2 ?? [];
  const tab = state.fitness.vo2;
  const card = h("section", { class: "card fit vo2", "aria-labelledby": "vo2-title" },
    h("div", { class: "section-head" },
      h("div", {},
        h("h2", { id: "vo2-title", text: "VO2 max" }),
        h("p", { class: "muted small", text: "From your Garmin, via intervals.icu" }))),
    periodTabs("vo2tab", [["current", "Current"], ["28", "4W"], ["84", "12W"], ["182", "6M"]], tab, "VO2 max period", v => {
      state.fitness.vo2 = v;
      render();
    }));
  if (!points.length) {
    card.append(h("p", { class: "muted", text: "No VO2 max from Garmin yet." }));
    return card;
  }
  card.append(tab === "current" ? vo2Current(points) : vo2History(points, Number(tab)));
  return card;
}

function vo2Current(points) {
  const value = vo2At(points, state.today) ?? points.at(-1).vo2max;
  const level = vo2Level(value, ATHLETE);
  const change = vo2Change(points, state.today, 28);
  const delta = change?.delta ?? 0;
  const changeText = delta > 0 ? `▲ +${fmtVo2(delta)} in 4 weeks` : delta < 0 ? `▼ −${fmtVo2(-delta)} in 4 weeks` : "No change in 4 weeks";
  const group = ATHLETE.sex === "male" ? "men" : "women";
  const t = level.thresholds;
  return h("div", { class: "vo2-now" },
    h("p", { class: "vo2-big" },
      h("span", { class: "vo2-num", text: fmtVo2(value) }),
      h("span", { class: "vo2-side" },
        h("span", { class: "vo2-unit", text: "ml/kg/min" }),
        h("span", { class: `vo2-change ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`, text: changeText }))),
    h("p", { class: `vo2-level lvl-${level.key}` },
      h("strong", { text: level.label }), ` for ${group} ${ATHLETE.ageBand.replace("-", "–")}`),
    h("div", { class: "gauge", "aria-hidden": "true" },
      LEVELS.map(l => h("span", { class: `gauge-seg lvl-${l.key}` })),
      h("span", { class: "gauge-marker", style: { "--pos": `${(level.position * 100).toFixed(1)}%` } })),
    h("p", { class: "gauge-labels", "aria-hidden": "true" },
      ["Poor", `Fair ${t.fair}`, `Good ${t.good}`, `Excellent ${t.excellent}`, `Superior ${t.superior}`].map(text => h("span", { text }))),
    h("p", { class: "muted small", text: `Latest value from ${formatDate(points.at(-1).date)}.` }));
}

function vo2History(points, days) {
  const series = vo2Series(points, state.today, days);
  if (series.length < 2) return h("p", { class: "muted", text: "Not enough VO2 max values in this period." });
  const start = addDays(state.today, -days);
  const values = series.map(p => p.vo2max);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const yMin = Math.floor(lo) - 1;
  const yMax = Math.ceil(hi) + 1;
  const t = vo2Level(lo, ATHLETE).thresholds;
  const edges = [[-Infinity, t.fair, "poor"], [t.fair, t.good, "fair"], [t.good, t.excellent, "good"], [t.excellent, t.superior, "excellent"], [t.superior, Infinity, "superior"]];
  const first = series[0];
  const last = series.at(-1);
  const delta = Math.round((last.vo2max - first.vo2max) * 10) / 10;
  const period = { 28: "4 weeks", 84: "12 weeks", 182: "6 months" }[days];
  const summary = `VO2 max over ${period}: ${fmtVo2(first.vo2max)} on ${formatDate(first.date)} to ${fmtVo2(last.vo2max)} on ${formatDate(last.date)}, lowest ${fmtVo2(lo)}, highest ${fmtVo2(hi)}.`;
  return h("div", { class: "fit-history" },
    lineChart({
      xMax: days,
      yMin,
      yMax,
      label: summary,
      bands: edges.map(([from, to, key]) => ({ from, to, cls: `band lvl-${key}`, text: LEVELS.find(l => l.key === key).label })),
      lines: [{ cls: "line line-vo2", points: (days > 28 ? weeklyAverage(series, start) : series).map(p => [diffDays(start, p.date), p.vo2max]) }],
      ticks: niceTicks(yMin, yMax, [1, 2, 5]),
      yFormat: v => String(v),
      startLabel: `${formatDate(first.date)} · ${fmtVo2(first.vo2max)}`,
      endLabel: `${formatDate(last.date)} · ${fmtVo2(last.vo2max)}`,
    }),
    h("p", { class: "fit-summary", "aria-hidden": "true" },
      h("strong", { text: delta > 0 ? `+${fmtVo2(delta)}` : delta < 0 ? `−${fmtVo2(-delta)}` : "±0" }),
      ` since ${formatDate(first.date)} · low ${fmtVo2(lo)} · high ${fmtVo2(hi)}`),
    dataTable(`VO2 max, ${period}`, ["Date", "VO2 max"], weekly(series).map(p => [formatDate(p.date), fmtVo2(p.vo2max)])));
}

// Average per 7-day step (placed on the step's last day), so daily 57↔58 flips don't look like spikes.
function weeklyAverage(series, start) {
  const steps = new Map();
  for (const p of series) {
    const k = Math.floor(diffDays(start, p.date) / 7);
    const s = steps.get(k) ?? { sum: 0, n: 0, date: p.date };
    s.sum += p.vo2max;
    s.n += 1;
    s.date = p.date;
    steps.set(k, s);
  }
  return [...steps.values()].map(s => ({ date: s.date, vo2max: s.sum / s.n }));
}

// Round tick values: the smallest step from `steps` that gives at most 4 intervals.
function niceTicks(min, max, steps) {
  const step = steps.find(s => (max - min) / s <= 4) ?? steps.at(-1);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks.length ? ticks : [min, max];
}

// Last value of each 7-day step, so the hidden table stays short.
function weekly(series) {
  const out = [];
  for (const p of series) {
    if (out.length && diffDays(out.at(-1).date, p.date) < 7) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

function dataTable(caption, head, rows) {
  return h("table", { class: "sr-only" },
    h("caption", { text: caption }),
    h("thead", {}, h("tr", {}, head.map(text => h("th", { scope: "col", text })))),
    h("tbody", {}, rows.map(r => h("tr", {}, r.map(text => h("td", { text }))))));
}

function renderPredictor() {
  const windows = state.data?.paceWindows ?? [];
  const vo2 = state.data?.vo2 ?? [];
  const tab = state.fitness.race;
  const card = h("section", { class: "card fit race", "aria-labelledby": "race-title" },
    h("div", { class: "section-head" },
      h("div", {},
        h("h2", { id: "race-title", text: "Race predictor" }),
        h("p", { class: "muted small", text: "Real runs and VO2 max, side by side" }))),
    periodTabs("racetab", [["current", "Current"], ["4w", "4W"], ["6m", "6M"], ["1y", "1Y"]], tab, "Race predictor period", v => {
      state.fitness.race = v;
      render();
    }));
  if (!windows.length && !vo2.length) {
    card.append(h("p", { class: "muted", text: "No pace data from intervals.icu yet." }));
    return card;
  }
  card.append(tab === "current" ? predictorNow(windows, vo2) : predictorHistory(windows, vo2, tab));
  card.append(h("p", {
    class: "muted small fit-note",
    text: "Real runs: fitted to your fastest efforts in the 12 weeks before each date (at least 3 runs needed); Half and Marathon come from the 10K (Riegel's formula), or your real time if it was faster. VO2 max: Jack Daniels' formula from Garmin's value, usually optimistic.",
  }));
  return card;
}

function predictorNow(windows, vo2) {
  const day = dataDay();
  const latest = [...windows].filter(w => w.end <= day).sort((a, b) => (a.end < b.end ? -1 : 1)).at(-1);
  const [now] = predictionSeries([latest?.end ?? day], windows, vo2);
  const vo2Now = predictionSeries([day], [], vo2)[0];
  const cell = (seconds, metres, cls) => (seconds
    ? h("td", { class: cls }, h("span", { class: "race-time", text: formatClock(seconds) }), h("span", { class: "race-pace", text: `${formatPace(seconds / (metres / 1000))} /km` }))
    : h("td", { class: `${cls} muted`, text: "—" }));
  return h("table", { class: "race-table" },
    h("caption", { class: "sr-only", text: "Predicted race times" }),
    h("thead", {}, h("tr", {},
      h("th", { scope: "col", text: "Distance" }),
      h("th", { scope: "col", text: "Real runs" }),
      h("th", { scope: "col", text: vo2Now.vo2max ? `VO2 max ${fmtVo2(vo2Now.vo2max)}` : "VO2 max" }))),
    h("tbody", {}, RACES.map(r => h("tr", {},
      h("th", { scope: "row", text: r.label }),
      cell(now.real?.[r.key], r.metres, "race-main"),
      cell(vo2Now.vo2?.[r.key], r.metres, "race-alt")))));
}

function predictorHistory(windows, vo2, range) {
  const race = RACES.find(r => r.key === state.fitness.distance);
  const series = predictionSeries(predictorDates(dataDay(), range), windows, vo2);
  const start = series[0].date;
  const real = series.filter(p => p.real).map(p => [diffDays(start, p.date), p.real[race.key], p.date]);
  const fromVo2 = series.filter(p => p.vo2).map(p => [diffDays(start, p.date), p.vo2[race.key], p.date]);
  const all = [...real, ...fromVo2].map(p => p[1]);
  const period = { "4w": "4 weeks", "6m": "6 months", "1y": "1 year" }[range];
  const wrap = h("div", { class: "fit-history" },
    periodTabs("racedist", RACES.map(r => [r.key, r.label]), race.key, "Distance", v => {
      state.fitness.distance = v;
      render();
    }));
  if (!all.length) {
    wrap.append(h("p", { class: "muted", text: "No predictions in this period." }));
    return wrap;
  }
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = Math.max(10, (hi - lo) * 0.12);
  const change = (pts, name) => {
    if (pts.length < 1) return null;
    const [, a, from] = pts[0];
    const [, b] = pts.at(-1);
    const d = b - a;
    return { name, text: `${formatClock(a)} → ${formatClock(b)}`, delta: d, words: `${name}: ${formatClock(a)} on ${formatDate(from)} to ${formatClock(b)} now` };
  };
  const changes = [change(real, "Real runs"), change(fromVo2, "VO2 max")].filter(Boolean);
  wrap.append(
    lineChart({
      xMax: diffDays(start, series.at(-1).date),
      yMin: lo - pad,
      yMax: hi + pad,
      invert: true,
      label: `${race.label} prediction over ${period}. ${changes.map(c => c.words).join(". ")}.`,
      lines: [
        { cls: "line line-real", points: real.map(p => p.slice(0, 2)) },
        { cls: "line line-alt", points: fromVo2.map(p => p.slice(0, 2)) },
      ],
      ticks: niceTicks(lo - pad, hi + pad, [30, 60, 120, 300, 600, 900, 1800, 3600]),
      yFormat: v => formatClock(v),
      startLabel: formatDate(start),
      endLabel: formatDate(series.at(-1).date),
      note: "↑ faster",
    }),
    h("ul", { class: "fit-changes", "aria-hidden": "true" }, changes.map(c => h("li", {},
      h("span", { class: `key ${c.name === "Real runs" ? "key-real" : "key-alt"}` }),
      h("span", { class: "fit-change-name", text: c.name }),
      h("span", { class: "fit-change-text", text: c.text }),
      h("strong", { class: c.delta < 0 ? "faster" : c.delta > 0 ? "slower" : "", text: formatDelta(c.delta) })))),
    dataTable(`${race.label} predictions, ${period}`, ["Date", "Real runs", "VO2 max"],
      series.map(p => [formatDate(p.date), p.real ? formatClock(p.real[race.key]) : "—", p.vo2 ? formatClock(p.vo2[race.key]) : "—"])));
  return wrap;
}

// Small SVG line chart. Points are [x, y]; `invert` puts low values (fast times) at the top.
function lineChart({ xMax, yMin, yMax, lines, bands = [], invert = false, label, ticks, yFormat, startLabel, endLabel, note }) {
  const W = 400;
  const H = 180;
  const L = 44;
  const R = 10;
  const T = 12;
  const B = 26;
  const sx = x => L + (xMax ? x / xMax : 1) * (W - L - R);
  const sy = y => {
    const f = (y - yMin) / (yMax - yMin || 1);
    return invert ? T + f * (H - T - B) : H - B - f * (H - T - B);
  };
  const svg = h("svg:svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
  for (const b of bands) {
    const from = Math.max(b.from, yMin);
    const to = Math.min(b.to, yMax);
    if (to <= from) continue;
    const y1 = sy(to);
    const y2 = sy(from);
    svg.append(h("svg:rect", { class: b.cls, x: L, y: Math.min(y1, y2).toFixed(1), width: W - L - R, height: Math.abs(y2 - y1).toFixed(1) }));
    svg.append(h("svg:text", { class: "band-text", x: W - R - 4, y: (Math.min(y1, y2) + 11).toFixed(1), "text-anchor": "end", text: b.text }));
  }
  for (const v of ticks) {
    const y = sy(v);
    svg.append(h("svg:line", { class: "grid", x1: L, x2: W - R, y1: y.toFixed(1), y2: y.toFixed(1) }));
    svg.append(h("svg:text", { class: "tick", x: L - 6, y: (y + 4).toFixed(1), "text-anchor": "end", text: yFormat(Math.round(v)) }));
  }
  for (const line of lines) {
    if (!line.points.length) continue;
    const d = line.points.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
    svg.append(h("svg:path", { class: line.cls, d }));
    const [lx, ly] = line.points.at(-1);
    svg.append(h("svg:circle", { class: `${line.cls} dot-end`, cx: sx(lx).toFixed(1), cy: sy(ly).toFixed(1), r: 4 }));
  }
  svg.append(h("svg:text", { class: "tick", x: L, y: H - 6, text: startLabel }));
  svg.append(h("svg:text", { class: "tick strong", x: W - R, y: H - 6, "text-anchor": "end", text: endLabel }));
  if (note) svg.append(h("svg:text", { class: "tick", x: L + 4, y: T + 10, text: note }));
  return svg;
}

// ---------- plan grid ----------
function renderPlan() {
  const m = state.model;
  const cur = currentWeek();
  const table = h("table", { class: "plan-grid", role: "grid", "aria-labelledby": "plan-title", "aria-describedby": "plan-help" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col", class: "wk-col" }, h("span", { class: "sr-only", text: "Week" })),
      WEEKDAYS.map(d => h("th", { scope: "col", "aria-label": d, text: d.slice(0, 1) })),
      h("th", { scope: "col", class: "km-col", text: "km" }))),
    h("tbody", {}, m.weeks.map(wk => h("tr", { class: wk.number === cur ? "is-current" : null },
      h("th", { scope: "row", class: "wk-col" },
        h("span", { class: "wk-num", text: `W${wk.number}` }),
        h("span", { class: "wk-phase", text: wk.phase })),
      wk.days.map(d => h("td", { role: "gridcell" }, gridCell(d))),
      h("td", { class: "km-col", role: "gridcell" },
        h("span", { "aria-hidden": "true", text: `${formatKm(wk.doneM)}/${formatKm(wk.plannedM)}` }),
        h("span", { class: "sr-only", text: `${formatKm(wk.doneM)} of ${formatKm(wk.plannedM)} km` }),
        h("span", { class: "mini-meter", "aria-hidden": "true" }, h("span", { style: { "--p": pct(wk.doneM, wk.plannedM) } })))))));
  table.addEventListener("keydown", onGridKey);
  return h("section", { class: "card plan", "aria-labelledby": "plan-title" },
    h("div", { class: "section-head" },
      h("div", {},
        h("h2", { id: "plan-title", text: "Plan" }),
        h("p", {
          class: "muted small",
          text: `${formatKm(m.totals.doneM)} of ${formatKm(m.totals.plannedM)} km · ${m.totals.doneWorkouts} of ${m.totals.workouts} workouts done`,
        }))),
    h("p", { id: "plan-help", class: "sr-only", text: "Arrow keys move between days. Enter opens the day." }),
    h("div", { class: "grid-wrap" }, table),
    h("ul", { class: "plan-weeks", "aria-label": "Weeks" }, m.weeks.map(wk => h("li", {}, planWeekCard(wk, cur)))),
    renderLegend());
}

// Phone: one card per week; the header shows the week at a glance, the body lists its days.
function planWeekCard(wk, cur) {
  const open = state.openWeeks.has(wk.number);
  const bodyId = `pw-body-${wk.number}`;
  const dots = wk.days.map(d => {
    const st = statusInfo(d, state.today);
    const glyph = st.key === "done" ? "✓" : st.key === "missed" ? "!" : st.key === "partial" ? "◐" : WEEKDAYS[d.weekday].slice(0, 1);
    return h("span", { class: `dot g-${dayGroup(d)} s-${st.key}${d.isToday ? " is-today" : ""}`, text: glyph });
  });
  const head = h("button", {
    type: "button",
    class: "pw-head",
    "aria-expanded": String(open),
    "aria-controls": bodyId,
    "data-key": `pw:${wk.number}`,
    onclick: e => togglePlanWeek(wk.number, e.currentTarget),
  },
    h("span", { class: "pw-title" },
      h("strong", { text: `W${wk.number} · ${wk.phase}` }),
      h("span", { class: "pw-dates", text: formatShortRange(wk.start, wk.end) })),
    h("span", { class: "pw-km" },
      h("span", { class: "sr-only", text: `, ${formatKm(wk.doneM)} of ${formatKm(wk.plannedM)} km` }),
      h("span", { "aria-hidden": "true", text: `${formatKm(wk.doneM)} / ${formatKm(wk.plannedM)} km` }),
      h("span", { class: "mini-meter", "aria-hidden": "true" }, h("span", { style: { "--p": pct(wk.doneM, wk.plannedM) } }))),
    h("span", { class: "pw-chevron", "aria-hidden": "true" }, icon("right")),
    h("span", { class: "pw-dots", "aria-hidden": "true" }, dots));
  return h("div", { class: `pw${wk.number === cur ? " is-current" : ""}` },
    h("h3", {}, head),
    h("ul", { class: "week-list", id: bodyId, hidden: !open }, wk.days.map(d => h("li", {}, weekRow(d, "plan")))));
}

function togglePlanWeek(n, btn) {
  const open = !state.openWeeks.has(n);
  if (open) state.openWeeks.add(n);
  else state.openWeeks.delete(n);
  btn.setAttribute("aria-expanded", String(open));
  document.getElementById(`pw-body-${n}`).hidden = !open;
}

function gridCell(d) {
  const st = statusInfo(d, state.today);
  const w = primaryWorkout(d);
  const mark = w ? MARKS[w.type] ?? "" : "";
  const result = resultText(d, state.today);
  const km = plannedKm(d);
  const cls = ["cell", `g-${dayGroup(d)}`, `s-${st.key}`, d.isToday && "is-today", d.date < state.today && "is-past"].filter(Boolean).join(" ");
  return h("button", {
    type: "button",
    class: cls,
    tabindex: d.date === state.focusDate ? "0" : "-1",
    "data-date": d.date,
    "data-key": `cell:${d.date}`,
    "aria-current": d.isToday ? "date" : null,
    "aria-label": dayLabel(d, state.today),
    onclick: e => {
      moveGridFocus(d.date, false);
      openDetails(d.date, e.currentTarget);
    },
  },
    h("span", { class: "cell-top", "aria-hidden": "true" },
      h("span", { class: "cell-day", text: String(Number(d.date.slice(8))) }),
      mark ? h("span", { class: "cell-mark", text: mark }) : ""),
    d.workouts.length || d.notes.length ? h("span", { class: "cell-name", "aria-hidden": "true", text: dayName(d) }) : "",
    km ? h("span", { class: "cell-km", "aria-hidden": "true", text: `${formatKm(km)} km` }) : "",
    result.text ? h("span", { class: `cell-result r-${result.kind}`, "aria-hidden": "true", text: result.text }) : "");
}

function onGridKey(e) {
  const btn = e.target.closest("button.cell");
  if (!btn) return;
  const days = state.model.days;
  const i = days.findIndex(d => d.date === btn.dataset.date);
  const row = i - (i % 7);
  const moves = {
    ArrowRight: i + 1,
    ArrowLeft: i - 1,
    ArrowDown: i + 7,
    ArrowUp: i - 7,
    Home: e.ctrlKey ? 0 : row,
    End: e.ctrlKey ? days.length - 1 : row + 6,
    PageDown: i + 28,
    PageUp: i - 28,
  };
  if (!(e.key in moves)) return;
  e.preventDefault();
  moveGridFocus(days[Math.max(0, Math.min(days.length - 1, moves[e.key]))].date, true);
}

function moveGridFocus(date, focus) {
  state.focusDate = date;
  const table = app.querySelector(".plan-grid");
  if (!table) return;
  for (const b of table.querySelectorAll("button.cell")) b.tabIndex = b.dataset.date === date ? 0 : -1;
  if (focus) table.querySelector(`button.cell[data-date="${date}"]`)?.focus();
}

function renderLegend() {
  const items = [["easy", "Easy"], ["long", "Long"], ["threshold", "Threshold"], ["intervals", "Intervals"], ["race", "Test, race pace, race"], ["rest", "Rest"]];
  return h("ul", { class: "legend", "aria-label": "Legend" },
    items.map(([g, label]) => h("li", {}, h("span", { class: `swatch g-${g}`, "aria-hidden": "true" }), label)),
    h("li", {}, h("span", { class: "swatch ring", "aria-hidden": "true" }), "Today"),
    h("li", {}, h("span", { class: "glyph ok", "aria-hidden": "true", text: "✓" }), "Done"),
    h("li", {}, h("span", { class: "glyph bad", "aria-hidden": "true", text: "!" }), "Missed"),
    h("li", {}, h("span", { class: "glyph", "aria-hidden": "true", text: "T K R" }), "Test, key run, race"));
}

function goToToday() {
  if (localToday() !== state.today) {
    state.viewWeek = null;
    rebuild();
  }
  state.viewWeek = currentWeek();
  if (state.model.byDate.has(state.today)) state.focusDate = state.today;
  render();
  const card = document.getElementById("today");
  card?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
  card?.focus({ preventScroll: true });
}

// ---------- day details ----------
function openDetails(date, opener) {
  if (!state.model?.byDate.has(date)) return;
  state.detailsDate = date;
  state.opener = opener ?? document.activeElement;
  fillDetails(date);
  details.querySelector("#details-body").scrollTop = 0;
  if (!details.open) details.showModal();
  details.querySelector('[data-action="close"]').focus();
}

function fillDetails(date) {
  const d = state.model.byDate.get(date);
  if (!d) return;
  const st = statusInfo(d, state.today);
  details.querySelector("#details-eyebrow").textContent = `Week ${d.week} · ${PLAN.phases[d.week - 1]}${d.isToday ? " · Today" : ""}`;
  details.querySelector("#details-title").textContent = formatDate(date);
  const parts = [];
  if (st.short) parts.push(h("p", { class: `chip s-${st.key}` }, st.icon ? h("span", { "aria-hidden": "true", text: st.icon }) : "", st.short));
  for (const w of d.workouts) parts.push(workoutBlock(w, { headingTag: "h3" }));
  for (const n of d.notes) {
    const text = noteText(n.description);
    parts.push(h("article", { class: "workout g-rest" },
      h("h3", { class: "workout-title", text: n.name === "Rest" ? "Rest day" : n.name || "Note" }),
      text ? h("p", { class: "workout-note", text }) : ""));
  }
  for (const a of d.extraRuns) parts.push(renderRun(a, "Extra run"));
  if (d.others.length) {
    parts.push(h("div", { class: "also", role: "group", "aria-labelledby": "also-title" },
      h("h3", { id: "also-title", text: "Also on this day" }),
      h("ul", {}, d.others.map(a => h("li", {},
        externalLink(runSummary(a).url, `${a.name || a.type}${a.movingTime ? ` · ${formatDuration(a.movingTime)}` : ""}`))))));
  }
  if (!d.workouts.length && !d.notes.length && !d.activities.length) parts.push(h("p", { class: "muted", text: "Nothing planned for this day." }));
  parts.push(h("p", { class: "details-link" }, externalLink(dayUrl(date), "Open this week in intervals.icu")));
  details.querySelector("#details-body").replaceChildren(...parts);
  const first = state.model.days[0].date;
  const last = state.model.days.at(-1).date;
  details.querySelector('[data-action="prev"]').disabled = date <= first;
  details.querySelector('[data-action="next"]').disabled = date >= last;
  if (document.activeElement?.disabled) details.querySelector('[data-action="close"]').focus();
}

function stepDetails(dir) {
  const next = addDays(state.detailsDate, dir);
  if (!state.model.byDate.has(next)) return;
  state.detailsDate = next;
  moveGridFocus(next, false);
  // Return focus to whichever view of that day is on screen (grid cell on PC, plan row on phone).
  state.opener = [`cell:${next}`, `plan:${next}`, `week:${next}`].map(byKey).find(el => el?.getClientRects().length) ?? state.opener;
  fillDetails(next);
  details.querySelector("#details-body").scrollTop = 0;
  announce(formatDate(next));
}

// ---------- settings ----------
function openSettings() {
  const name = state.data?.athleteName;
  settings.querySelector("#settings-athlete").textContent = name ? `Connected to intervals.icu as ${name}.` : "Connected to intervals.icu.";
  const theme = store.getTheme();
  for (const r of settings.querySelectorAll('input[name="theme"]')) r.checked = r.value === theme;
  settings.querySelector('input[name="shortcut"]').checked = store.getShortcut();
  settings.showModal();
  settings.querySelector('[data-action="close"]').focus();
}

function resetSession() {
  state.session += 1;
  state.status = { kind: "idle", message: "" };
  state.data = null;
  state.model = null;
  state.viewWeek = null;
}

function forgetKey() {
  if (!window.confirm("Forget the API key and saved data on this device?")) return;
  store.forget();
  settings.close();
  resetSession();
  renderSetup("");
  announce("Key removed from this device");
}

function wireDialogs() {
  details.addEventListener("click", e => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "close" || e.target === details) details.close();
    else if (action === "prev") stepDetails(-1);
    else if (action === "next") stepDetails(1);
  });
  details.addEventListener("close", () => {
    state.detailsDate = null;
    const opener = state.opener;
    state.opener = null;
    const key = opener?.dataset?.key;
    const target = opener?.isConnected ? opener : key ? byKey(key) : null;
    target?.focus({ preventScroll: true });
  });
  const grip = details.querySelector(".sheet-grip");
  let startY = null;
  grip.addEventListener("pointerdown", e => {
    startY = e.clientY;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointerup", e => {
    if (startY != null && e.clientY - startY > 60) details.close();
    startY = null;
  });
  grip.addEventListener("pointercancel", () => { startY = null; });

  settings.addEventListener("click", e => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "close" || e.target === settings) settings.close();
    else if (action === "refresh") {
      settings.close();
      doRefresh({ announceResult: true });
    } else if (action === "forget") forgetKey();
  });
  settings.addEventListener("change", e => {
    if (e.target.name === "theme") {
      store.setTheme(e.target.value);
      applyTheme(e.target.value);
      announce(`Theme: ${e.target.value}`);
    } else if (e.target.name === "shortcut") {
      store.setShortcut(e.target.checked);
    }
  });
  settings.addEventListener("close", () => byKey("btn:settings")?.focus({ preventScroll: true }));
}

// ---------- setup, loading, errors ----------
function renderSetup(message) {
  if (details.open) details.close();
  if (settings.open) settings.close();
  const input = h("input", {
    id: "key", name: "key", type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    "aria-describedby": "key-help",
  });
  const error = h("p", { id: "key-error", class: "error", role: "alert" });
  const toggle = h("button", { type: "button", class: "btn ghost small", "aria-pressed": "false", "aria-controls": "key" }, "Show");
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.textContent = show ? "Hide" : "Show";
  });
  const submit = h("button", { type: "submit", class: "btn primary block" }, "Connect");
  const showError = text => {
    error.textContent = text;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "key-help key-error");
    input.focus();
  };
  const form = h("form", { class: "setup-form", novalidate: true },
    h("label", { for: "key", text: "intervals.icu API key" }),
    h("div", { class: "key-row" }, input, toggle),
    h("p", { id: "key-help", class: "muted small", text: "Saved only in this browser. This page only reads your calendar and runs." }),
    error,
    submit);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = "Connecting…";
    error.textContent = "";
    try {
      resetSession();
      await connect(input.value, { store });
      state.data = store.getCache();
      renderLoading();
      await doRefresh();
      announce("Connected. Calendar loaded.");
    } catch (err) {
      submit.disabled = false;
      submit.textContent = "Connect";
      if (err instanceof KeyError) {
        showError(err.reason === "format" ? err.message : "That key was not accepted. Copy it again from intervals.icu and retry.");
      } else if (err instanceof NetworkError) {
        showError("Can't reach intervals.icu. Check your connection and retry.");
      } else {
        showError(err.message);
      }
    }
  });
  app.replaceChildren(h("main", { id: "main", class: "setup" },
    h("section", { class: "card setup-card", "aria-labelledby": "setup-title" },
      h("img", { class: "logo", src: "icons/icon.svg", alt: "", width: "56", height: "56" }),
      h("h1", { id: "setup-title", text: "Connect intervals.icu" }),
      h("p", { class: "lead", text: `See your ${PLAN.title} plan, today's workout and your runs, live from intervals.icu.` }),
      h("ol", { class: "setup-steps" },
        h("li", {}, "Open ", externalLink("https://intervals.icu/settings", "intervals.icu settings"), "."),
        h("li", { text: "In Developer Settings, copy your API Key." }),
        h("li", { text: "Paste it below and press Connect." })),
      form)));
  app.removeAttribute("aria-busy");
  if (message) showError(message);
  else input.focus();
}

function renderLoading() {
  app.setAttribute("aria-busy", "true");
  app.replaceChildren(h("main", { id: "main", class: "setup" },
    h("section", { class: "card setup-card loading", "aria-label": "Loading" },
      h("div", { class: "spinner", "aria-hidden": "true" }),
      h("p", { text: "Loading your plan from intervals.icu…" }))));
}

function renderError(message) {
  app.removeAttribute("aria-busy");
  app.replaceChildren(h("main", { id: "main", class: "setup" },
    h("section", { class: "card setup-card", "aria-labelledby": "error-title" },
      h("h1", { id: "error-title", text: "Couldn't load your plan" }),
      h("p", { class: "error", role: "alert", text: message }),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn primary", onclick: () => { renderLoading(); doRefresh(); } }, "Try again"),
        h("button", { type: "button", class: "btn ghost", onclick: () => { store.forget(); resetSession(); renderSetup(""); } }, "Use a different key")))));
}

// ---------- data ----------
async function doRefresh({ announceResult = false } = {}) {
  if (state.status.kind === "loading") return;
  const session = state.session;
  state.status = { kind: "loading", message: "" };
  updateStatus();
  try {
    const data = await refresh({ store, today: localToday() });
    if (session !== state.session) return;
    state.data = data;
    state.status = { kind: "ok", message: "" };
    rebuild();
    render();
    if (announceResult) announce("Calendar updated");
  } catch (err) {
    if (session !== state.session) return;
    if (err instanceof KeyError) {
      state.status = { kind: "idle", message: "" };
      state.model = null;
      renderSetup(err.reason === "missing" ? "" : "Your key was not accepted. Paste a current key from intervals.icu.");
      return;
    }
    state.status = { kind: err instanceof NetworkError ? "offline" : "error", message: err.message };
    if (hasData(state.data)) {
      if (!state.model) rebuild();
      render();
      announce(statusText());
    } else {
      renderError(err instanceof NetworkError ? "Can't reach intervals.icu. Check your connection." : err.message);
    }
  }
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    state.hiddenAt = Date.now();
    return;
  }
  if (!store.getKey() || !state.model) return;
  const dayChanged = localToday() !== state.today;
  if (dayChanged) {
    state.viewWeek = null;
    rebuild();
    render();
  }
  if (dayChanged || (state.hiddenAt && Date.now() - state.hiddenAt > 5 * 60_000)) doRefresh();
}

function tick() {
  if (!state.model) return;
  if (localToday() !== state.today) {
    state.viewWeek = null;
    rebuild();
    render();
    if (store.getKey()) doRefresh();
  } else {
    updateStatus();
  }
}

function onKey(e) {
  if (e.key !== "t" && e.key !== "T") return;
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !state.model || !store.getShortcut()) return;
  if (details.open || settings.open || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  e.preventDefault();
  goToToday();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (location.protocol !== "https:" && !local) return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

async function init() {
  applyTheme(store.getTheme());
  wireDialogs();
  registerServiceWorker();
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  window.setInterval(tick, 60_000);
  if (!store.getKey()) {
    renderSetup("");
    return;
  }
  state.data = store.getCache();
  if (hasData(state.data)) {
    rebuild();
    render();
  } else {
    renderLoading();
  }
  await doRefresh();
}

init();
