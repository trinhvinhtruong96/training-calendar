// The page: rendering and interaction. All data logic lives in the pure modules.
import { OAUTH, PLAN } from "./config.js";
import { KeyError, NetworkError, connect, createStore, loadDayLaps, refresh, saveLogin } from "./api.js";
import { finishLogin, readCallback, redirectUri, revoke, startLogin } from "./auth.js";
import {
  WEEKDAYS, addDays, clampWeek, formatDate, formatDuration, formatKm, formatShortRange, localToday, timeAgo, weekNumber,
} from "./dates.js";
import { GROUP, TYPE_LABEL, formatStepAmount, noteText, paceRange, shortName, stepLevel, stepName, workoutBar } from "./workout.js";
import { buildModel, dayLabel, dayUrl, headerInfo, primaryWorkout, resultText, runSummary, statusInfo } from "./model.js";
import { buildPerformance } from "./performance.js";
import { matchSteps } from "./steps.js";

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
  performance: null, // Performance card data (buildPerformance)
  openReps: new Set(), // "Show reps" lists open in the day details; cleared when the details close
  detailsFocus: null, // data-key of the focused steps control while the day details are rebuilt
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
  state.performance = buildPerformance(state.data, state.today, PLAN);
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
    h("main", { id: "main", class: "layout" }, renderToday(), renderWeek(), renderPerformance(), renderPlan()),
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

function workoutBlock(w, { titleId = null, headingTag = "h3", steps = false } = {}) {
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
    w.run ? [renderRun(w.run, "Your run"), steps ? stepsSection(w.run, w) : ""] : renderPending(w));
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

// ---------- run steps (day details) ----------
// Filled after the laps load; a late result is dropped if another day is open by then. The details are rebuilt
// on every render, so open repeat tables (state.openReps) and the focused control (state.detailsFocus) are
// kept in state. Control keys: steps:<runId>:title | :retry | :reps:<i>.
const byKeyIn = (root, key) => root.querySelector(`[data-key="${CSS.escape(key)}"]`);
const stepsNote = text => h("p", { class: "muted small", text });

function stepsSection(run, workout) {
  const title = h("h4", { class: "steps-title", tabindex: "-1", "data-key": `steps:${run.id}:title`, text: workout ? "Steps" : "Laps" });
  const body = h("div", {});
  fillSteps(body, title, run, workout);
  return h("div", { class: "steps-result" }, title, body);
}

function fillSteps(body, title, run, workout) {
  const date = state.detailsDate;
  if (body.contains(document.activeElement)) title.focus(); // Try again: keep focus in this section while loading
  body.replaceChildren(stepsNote("Loading laps…"));
  loadDayLaps(run.id, {
    store,
    knownIds: (state.data?.activities ?? []).map(a => a.id),
    extra: state.data?.performance?.laps ?? {},
  }).then(res => {
    if (!body.isConnected || state.detailsDate !== date) return;
    body.replaceChildren(...stepsContent(res, run, workout, body, title));
    const key = state.detailsFocus;
    if (key?.startsWith(`steps:${run.id}:`)) {
      state.detailsFocus = null;
      (byKeyIn(body, key) ?? title).focus({ preventScroll: true });
    }
  });
}

function stepsContent(res, run, workout, body, title) {
  if (res.error) {
    return [stepsNote("Couldn't load the laps."),
      h("button", {
        type: "button", class: "btn ghost small", "data-key": `steps:${run.id}:retry`,
        onclick: () => fillSteps(body, title, run, workout),
      }, "Try again")];
  }
  if (res.notReady) return [stepsNote("Laps aren't ready yet in intervals.icu.")];
  const m = matchSteps(workout, res.laps, state.performance?.limits ?? {}); // no workout (extra run): plain laps
  if (m.kind === "single") return [stepsNote("No laps from your watch.")];
  const lines = items => h("ul", { class: "perf-list steps-list" }, items.map(t => perfItem("none", h("span", { text: t }))));
  if (m.kind === "laps") return [lines(m.lines)];
  const list = h("ul", { class: "step-list" },
    m.items.map((it, i) => (it.kind === "repeat" ? repeatRow(it, run, i) : stepRow(it))),
    m.after ? stepRow({ name: "After the workout", status: null, expected: "", actual: m.after, bar: null, diff: null }) : "");
  const out = [m.items.some(it => it.bar) ? stepsLegend() : "", list];
  if (m.notDone.length) out.push(stepsNote(`Not done: ${m.notDone.join(", ")}`));
  if (m.unmatched.length) out.push(stepsNote("Steps after this didn't match your laps:"), lines(m.unmatched));
  return out;
}

// One step: name with status, Expected and Actual lines, bar, difference line (display spec §3).
function stepRow(it, ...extra) {
  const key = it.status ?? "none";
  const s = PERF_STATUS[key];
  return h("li", { class: `step-row s-${key}` },
    h("span", { class: "perf-icon", "aria-hidden": "true", text: s.icon }),
    h("div", { class: "step-body" },
      h("p", { class: "step-name" }, s.label ? h("span", { class: "sr-only", text: `${s.label}: ` }) : "", h("strong", { text: it.name })),
      it.expected ? kv("Expected", it.expected) : "",
      kv("Actual", it.actual),
      it.bar ? stepBar(it.bar) : "",
      it.diff ? h("p", { class: "step-diff" }, h("span", { text: it.diff.label }), h("span", { class: "step-diff-text", text: it.diff.text })) : "",
      ...extra));
}

// Lines break between the " · " parts, so a part like "HR 143 (136–156)" stays whole; a part longer than the
// line still wraps inside itself.
const kv = (label, value) => h("p", { class: "step-kv" }, h("span", { class: "step-k", text: label }),
  h("span", {}, value.split(" · ").map((part, i) => [i ? " · " : "", h("span", { class: "kv-part", text: part })])));

const stepsLegend = () => h("p", { class: "steps-legend", "aria-hidden": "true" },
  h("span", { class: "legend-dot" }), "you", h("span", { class: "legend-band" }), "plan · left = faster / lower");

// Band = plan, dot = you; positions in % from steps.js. Hidden from screen readers: the text says the same.
function stepBar(bar) {
  const mark = (p, status) => h("span", {
    class: `bar-dot s-${status ?? "none"}${p.off ? ` off-${p.off}` : ""}`,
    style: { "--at": `${p.at}%` },
  });
  return h("div", {
    class: `step-bar${bar.dots ? " strip" : ""}`,
    "aria-hidden": "true",
    style: { "--lo": `${bar.lo}%`, "--hi": `${bar.hi}%` },
  },
  h("span", { class: "bar-band" }),
  bar.kind === "hr" ? h("span", { class: "bar-limit" }) : "",
  bar.dots ? bar.dots.map(d => mark(d, d.status)) : mark(bar, bar.status));
}

function repeatRow(it, run, i) {
  const id = `reps-${run.id}-${i}`;
  const open = state.openReps.has(id);
  return stepRow(it,
    h("button", {
      type: "button", class: "btn ghost small", "aria-expanded": String(open), "aria-controls": id,
      "data-key": `steps:${run.id}:reps:${i}`, "data-noun": it.label, onclick: e => toggleReps(e.currentTarget, id),
    }, `${open ? "Hide" : "Show"} ${it.label}`),
    h("div", { class: "reps-wrap", id, hidden: !open }, repsTable(it)));
}

// Compact table of a repeat (display spec §5): one work step → # Time Pace vs-plan HR, rests as thin rows;
// otherwise Step Dist Time Pace vs-plan HR with a "Block n" row per round.
function repsTable(it) {
  const t = it.table;
  const single = t.columns === "single";
  const heads = single ? ["#", "Time", "Pace", "vs plan", "HR"] : ["Step", "Dist", "Time", "Pace", "vs plan", "HR"];
  const span = heads.length + 1;
  const statusCell = status => {
    const s = PERF_STATUS[status ?? "none"];
    return h("td", { class: "rt-status" }, h("span", { "aria-hidden": "true", text: s.icon }), s.label ? h("span", { class: "sr-only", text: s.label }) : "");
  };
  const rows = t.rows.map(r => {
    if (r.kind === "block") return h("tr", { class: "rt-block" }, h("th", { scope: "colgroup", colspan: span, text: `Block ${r.n}` }));
    if (single && r.kind === "rest") {
      return h("tr", { class: "rt-rest" }, h("td", { colspan: span, text: `${r.step.toLowerCase()} ${r.time} · ${r.dist}${r.hr ? ` · HR ${r.hr}` : ""}` }));
    }
    const cells = single ? [String(r.n), r.time, r.pace, r.vs, r.hr] : [r.step, r.dist, r.time, r.pace, r.vs, r.hr];
    const vsAt = cells.length - 2;
    return h("tr", { class: `${r.kind === "rest" ? "rt-rest " : ""}s-${r.status ?? "none"}` },
      cells.map((c, k) => h("td", { class: k === vsAt ? "rt-vs" : null, text: c })),
      statusCell(r.status));
  });
  return [
    t.target ? h("p", { class: "reps-target muted small", text: t.target }) : "",
    h("div", { class: "reps-scroll" },
      h("table", { class: "reps-table" },
        h("caption", { class: "sr-only", text: `${it.label === "blocks" ? "Blocks" : "Reps"} of ${it.name}` }),
        h("thead", {}, h("tr", {},
          heads.map(x => h("th", { scope: "col", text: x })),
          h("th", { scope: "col" }, h("span", { class: "sr-only", text: "Status" })))),
        h("tbody", {}, rows))),
  ];
}

function toggleReps(btn, id) {
  const open = !state.openReps.has(id);
  if (open) state.openReps.add(id);
  else state.openReps.delete(id);
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = `${open ? "Hide" : "Show"} ${btn.dataset.noun}`;
  document.getElementById(id).hidden = !open;
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

// ---------- performance ----------
const PERF_STATUS = {
  ok: { icon: "✓", label: "On target" },
  check: { icon: "!", label: "Check" },
  neutral: { icon: "–", label: "No verdict" },
  skip: { icon: "·", label: "Not judged" },
  none: { icon: "", label: "" },
};

function renderPerformance() {
  const p = state.performance;
  const section = h("section", { class: "card perf", "aria-labelledby": "perf-title" },
    h("div", { class: "section-head" }, h("h2", { id: "perf-title", text: "Performance" })));
  if (!p?.loaded) {
    section.append(h("p", { class: "muted", text: "Performance couldn't load yet. It updates with the next refresh." }));
    return section;
  }
  section.append(
    h("div", { class: "perf-tiles" }, perfTile(p.pace), perfTile(p.hr)),
    p.settingsNote ? h("p", { class: "perf-note", text: p.settingsNote }) : "",
    h("h3", { class: "perf-sub", text: `Last 10 days · ${formatShortRange(p.from, p.to)}` }),
    h("ul", { class: "perf-list" }, p.lines.map(l => perfItem(l.status, h("span", { text: l.text })))),
    h("h3", { class: "perf-sub", text: "Suggestions" }),
    h("ol", { class: "perf-suggest" }, p.suggestions.map(s => h("li", { text: s }))));
  return section;
}

function perfTile(t) {
  return h("div", { class: "perf-tile" },
    h("p", { class: "perf-label", text: t.label }),
    h("p", { class: "perf-value", text: t.value ?? "–" }),
    t.lines.map(line => h("p", { class: `perf-meta k-${line.kind}`, text: line.text })));
}

// Status is never colour alone: a visible icon plus a spoken label.
function perfItem(status, ...content) {
  const s = PERF_STATUS[status] ?? PERF_STATUS.neutral;
  return h("li", { class: `perf-item s-${status}` },
    h("span", { class: "perf-icon", "aria-hidden": "true", text: s.icon }),
    h("span", {}, s.label ? h("span", { class: "sr-only", text: `${s.label}: ` }) : "", ...content));
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
  const body = details.querySelector("#details-body");
  const focused = body.contains(document.activeElement) ? document.activeElement : null;
  state.detailsFocus = focused?.dataset.key ?? null;
  const st = statusInfo(d, state.today);
  details.querySelector("#details-eyebrow").textContent = `Week ${d.week} · ${PLAN.phases[d.week - 1]}${d.isToday ? " · Today" : ""}`;
  details.querySelector("#details-title").textContent = formatDate(date);
  const parts = [];
  if (st.short) parts.push(h("p", { class: `chip s-${st.key}` }, st.icon ? h("span", { "aria-hidden": "true", text: st.icon }) : "", st.short));
  for (const w of d.workouts) parts.push(workoutBlock(w, { headingTag: "h3", steps: true }));
  for (const n of d.notes) {
    const text = noteText(n.description);
    parts.push(h("article", { class: "workout g-rest" },
      h("h3", { class: "workout-title", text: n.name === "Rest" ? "Rest day" : n.name || "Note" }),
      text ? h("p", { class: "workout-note", text }) : ""));
  }
  for (const a of d.extraRuns) parts.push(renderRun(a, "Extra run"), stepsSection(a, null));
  if (d.others.length) {
    parts.push(h("div", { class: "also", role: "group", "aria-labelledby": "also-title" },
      h("h3", { id: "also-title", text: "Also on this day" }),
      h("ul", {}, d.others.map(a => h("li", {},
        externalLink(runSummary(a).url, `${a.name || a.type}${a.movingTime ? ` · ${formatDuration(a.movingTime)}` : ""}`))))));
  }
  if (!d.workouts.length && !d.notes.length && !d.activities.length) parts.push(h("p", { class: "muted", text: "Nothing planned for this day." }));
  parts.push(h("p", { class: "details-link" }, externalLink(dayUrl(date), "Open this week in intervals.icu")));
  body.replaceChildren(...parts);
  const first = state.model.days[0].date;
  const last = state.model.days.at(-1).date;
  details.querySelector('[data-action="prev"]').disabled = date <= first;
  details.querySelector('[data-action="next"]').disabled = date >= last;
  if (document.activeElement?.disabled) details.querySelector('[data-action="close"]').focus();
  // Focus was in the rebuilt body: a steps control gets it back once its laps are in (fillSteps); until then
  // its section title holds it. Anything else (a link) falls back to Close.
  if (focused) {
    const key = state.detailsFocus ?? "";
    const title = key.startsWith("steps:") ? byKeyIn(body, `steps:${key.split(":")[1]}:title`) : null;
    (title ?? details.querySelector('[data-action="close"]')).focus({ preventScroll: true });
  }
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
  const viaLogin = store.getAuth()?.type === "oauth";
  const who = name ? `Connected to intervals.icu as ${name}` : "Connected to intervals.icu";
  settings.querySelector("#settings-athlete").textContent = `${who} ${viaLogin ? "with the intervals.icu login" : "with an API key"}.`;
  settings.querySelector('[data-action="forget"]').textContent = viaLogin ? "Log out on this device" : "Forget key on this device";
  const link = externalLink("https://intervals.icu/settings", "intervals.icu settings");
  settings.querySelector("#settings-note").replaceChildren(...(viaLogin
    ? ["The login is stored only in this browser. Logging out also ends it on intervals.icu. You can end it there too, in ", link, "."]
    : ["The key is stored only in this browser. To revoke it everywhere, clear the API key in ", link, " under Developer Settings."]));
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

function forgetCredential() {
  const auth = store.getAuth();
  const viaLogin = auth?.type === "oauth";
  if (!window.confirm(viaLogin ? "Log out and forget saved data on this device?" : "Forget the API key and saved data on this device?")) return;
  store.forget();
  settings.close();
  resetSession();
  renderSetup();
  announce(viaLogin ? "Logged out on this device" : "Key removed from this device");
  revoke(auth); // best effort, after this device is already cleared
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
    state.openReps.clear();
    state.detailsFocus = null;
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
    } else if (action === "forget") forgetCredential();
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
function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// about: "login" puts the message next to the login button, "key" next to the key field.
function renderSetup(message = "", about = "key") {
  if (details.open) details.close();
  if (settings.open) settings.close();
  const loginOn = Boolean(OAUTH.clientId);
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
  const submit = h("button", { type: "submit", class: `btn ${loginOn ? "" : "primary "}block` }, "Connect");
  let keyOption = null; // the "Use an API key instead" fold, when the login is offered
  const showError = text => {
    if (keyOption) keyOption.open = true;
    error.textContent = text;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "key-help key-error");
    input.focus();
  };
  const form = h("form", { class: "setup-form", novalidate: true },
    h("label", { for: "key", text: "intervals.icu API key" }),
    h("div", { class: "key-row" }, input, toggle),
    h("p", { id: "key-help", class: "muted small", text: "Saved only in this browser. This page only reads your calendar, runs, wellness and settings." }),
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
  const keySteps = h("ol", { class: "setup-steps" },
    h("li", {}, "Open ", externalLink("https://intervals.icu/settings", "intervals.icu settings"), "."),
    h("li", { text: "In Developer Settings, copy your API Key." }),
    h("li", { text: "Paste it below and press Connect." }));

  let login = [keySteps, form];
  let showLoginError = showError;
  let focusStart = () => input.focus();
  if (loginOn) {
    const loginError = h("p", { id: "login-error", class: "error", role: "alert" });
    const label = "Log in with intervals.icu";
    const loginBtn = h("button", { type: "button", class: "btn primary block", "aria-describedby": "login-help" }, label);
    loginBtn.addEventListener("click", async () => {
      loginBtn.disabled = true;
      loginBtn.textContent = "Opening intervals.icu…";
      loginError.textContent = "";
      try {
        window.location.assign(await startLogin({ session: sessionStore(), location: window.location }));
      } catch (err) {
        loginBtn.disabled = false;
        loginBtn.textContent = label;
        showLoginError(err.message);
      }
    });
    keyOption = h("details", { class: "key-option" }, h("summary", { text: "Use an API key instead" }), keySteps, form);
    login = [
      h("div", { class: "setup-form" },
        loginBtn,
        h("p", { id: "login-help", class: "muted small", text: "Opens intervals.icu. The page asks only to read your planned workouts and runs, plus wellness and settings for the Performance card." }),
        loginError),
      keyOption,
    ];
    showLoginError = text => {
      loginError.textContent = text;
      loginBtn.setAttribute("aria-describedby", "login-help login-error");
      loginBtn.focus();
    };
    focusStart = () => loginBtn.focus();
  }
  app.replaceChildren(h("main", { id: "main", class: "setup" },
    h("section", { class: "card setup-card", "aria-labelledby": "setup-title" },
      h("img", { class: "logo", src: "icons/icon.svg", alt: "", width: "56", height: "56" }),
      h("h1", { id: "setup-title", text: "Connect intervals.icu" }),
      h("p", { class: "lead", text: `See your ${PLAN.title} plan, today's workout and your runs, live from intervals.icu.` }),
      login)));
  app.removeAttribute("aria-busy");
  if (!message) focusStart();
  else if (about === "login") showLoginError(message);
  else showError(message);
}

// intervals.icu sent the browser back here after a login. Returns false when it failed but this device
// is still connected (e.g. an old login link), so the calendar loads as usual.
async function completeLogin(callback) {
  window.history.replaceState(null, "", redirectUri(window.location)); // the one-time code leaves the address bar at once
  renderLoading();
  try {
    const { token, athleteName } = await finishLogin(callback, { session: sessionStore() });
    resetSession();
    saveLogin(token, athleteName, { store });
    state.data = store.getCache();
    await doRefresh();
    if (state.status.kind === "ok") announce("Logged in. Calendar loaded.");
  } catch (err) {
    const text = err instanceof NetworkError ? "Can't reach intervals.icu. Check your connection and log in again." : err.message;
    if (store.getAuth()) {
      announce(text);
      return false;
    }
    renderSetup(text, "login");
  }
  return true;
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
        h("button", { type: "button", class: "btn ghost", onclick: () => { store.forget(); resetSession(); renderSetup(); } },
          store.getAuth()?.type === "oauth" ? "Log in again" : "Use a different key")))));
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
      const viaLogin = store.getAuth()?.type === "oauth";
      state.status = { kind: "idle", message: "" };
      state.model = null;
      if (err.reason === "missing") renderSetup();
      else if (viaLogin) renderSetup("Your intervals.icu login has ended. Log in again.", "login");
      else renderSetup("Your key was not accepted. Paste a current key from intervals.icu.", "key");
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
  if (!store.getAuth() || !state.model) return;
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
    if (store.getAuth()) doRefresh();
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
  const callback = readCallback(window.location.search);
  if (callback && await completeLogin(callback)) return;
  if (!store.getAuth()) {
    renderSetup();
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
