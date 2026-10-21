// Synthetic data only, in the reduced shape the page caches (see site/src/api.js).
export const steps10x400 = [
  { text: "Warmup", distance: 1600, duration: 544, pace: { start: 330, end: 350, units: "secs/km" } },
  {
    text: "",
    reps: 10,
    steps: [
      { text: "Rep", distance: 400, duration: 98, pace: { start: 242, end: 248, units: "secs/km" } },
      { text: "Rest", duration: 90 },
    ],
  },
];

const workout = (id, date, name, distance, steps = [], description = "") => ({
  id, date, category: "WORKOUT", name, description, distance, movingTime: Math.round(distance * 0.34),
  pairedActivityId: null, steps,
});

export const events = [
  { id: 1, date: "2026-10-20", category: "NOTE", name: "Rest", description: "", distance: 0, movingTime: 0, pairedActivityId: null, steps: [] },
  workout(2, "2026-10-21", "W01 Wed - 10x400 @4:05", 5600, steps10x400, "+ gym\n\n- Warmup 1.6km 5:30-5:50/km Pace"),
  workout(3, "2026-10-22", "W01 Thu - Easy 5 km", 5000, [{ text: "Easy", distance: 5000, duration: 1700, pace: { start: 330, end: 350, units: "secs/km" } }]),
  workout(4, "2026-10-23", "W01 Fri - Threshold 2x3 km", 8000, [], "+ gym"),
  workout(5, "2026-10-25", "W01 Sun - Long 12 km", 12000),
  { id: 6, date: "2026-10-25", category: "RACE_A", name: "Other category", description: "", distance: 0, movingTime: 0, pairedActivityId: null, steps: [] },
  workout(7, "2027-02-05", "Outside the plan", 5000),
];

const run = (id, date, type, distance, movingTime, extra = {}) => ({
  id, date, type, name: type, distance, movingTime, avgHr: null, pairedEventId: null, compliance: null, ...extra,
});

export const activities = [
  run("i10", "2026-10-20", "Run", 3000, 1000, { avgHr: 130 }),
  run("i11", "2026-10-21", "Run", 5620, 2412, { avgHr: 152.4, pairedEventId: 2, compliance: 96.4 }),
  run("i12", "2026-10-21", "WeightTraining", 0, 2700),
  run("i13", "2026-10-22", "Run", 5050, 1730, { avgHr: 138 }),
];
