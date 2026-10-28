# Training schemas

A training schema is the shape every training plan takes in Cairn: plans you import, and the ones your local model writes from how the last one went. The Train tab follows the active schema day by day. Each set is pre-filled from the plan, and you tick it off or change it to what you actually lifted.

This page is the reference for writing one. `src/lib/training/schema.ts` checks every schema against it, and `src/lib/training/sample.ts` is a small complete example.

## Importing

```bash
npm run import:schema -- plan.json              # into the live data (.data)
npm run import:schema -- plan.json --dir .data-dev
npm run import:schema -- plan.json --draft      # saved for review instead of followed
```

The file is either a bare schema or a wrapper with a few extras for the first import:

```json
{
  "schema": { "...": "the schema below" },
  "prs": { "squat": 135, "deadlift": 175 },
  "equipment": { "gear": ["barbell", "plates", "rack", "dumbbells", "bike"], "dumbbells": [15, 20, 25], "kettlebells": [] },
  "kinds": [{ "id": "gymnastics", "label": "Gymnastics", "icon": "activity", "training": false }],
  "weeklyPlan": { "weightlifting": 3, "wod": 2, "gymnastics": 3 }
}
```

The importer handles the extras like this:

| Key | What the importer does |
|---|---|
| `prs` | Records each PR as of today. A schema's percentages are taken of these. |
| `equipment` | Sets your equipment, but only if Settings has none yet. |
| `kinds` | Adds any activities the schema uses that Settings doesn't have. |
| `weeklyPlan` | Updates the Workouts card's weekly session counts. |

A schema that doesn't validate is refused, with a list of every problem.

## The schema

```json
{
  "schemaVersion": 1,
  "name": "Sample block",
  "startDate": "2026-11-02",
  "firstWeek": 1,
  "weeks": 4,
  "deloadWeeks": [3],
  "testWeek": 4,
  "goals": "Targets, and for a generated schema, why it changed what it did.",
  "lifts": [{ "id": "squat", "name": "Back squat", "increment": 5 }],
  "days": [{ "weekday": 1, "sessions": [ { "...": "Session" } ] }],
  "wods": []
}
```

| Field | What it is |
|---|---|
| `startDate` | The Monday the first week starts. |
| `firstWeek` | `0` if the schema opens with an intro week, otherwise `1`. |
| `weeks` | The number of the last week, at most 16. |
| `deloadWeeks`, `testWeek` | Which weeks those are. A progression uses its deload and test rules in them. |
| `lifts` | The lifts that percentages refer to, and the step weights round to: 5 lb for squat and deadlift, 2.5 lb for press and the Olympic lifts. PRs are kept separately and carry over from one schema to the next. |
| `days` | One entry per training day. `weekday` runs from 1 (Monday) to 7 (Sunday). A day that isn't listed is a rest day. |
| `wods` | Optional WODs written for this schema, in addition to the bank. |

A **session** is `{ "id", "title", "kind", "items": [...] }`.

- `kind` is a workout activity from Settings (`weightlifting`, `wod`, `cycling`, `yoga` and so on).
- Logging any part of a session also logs one session of that activity on the Workouts card.
- For an activity marked as training, that also makes the day a training day.

An **item** is `{ "id", "name", "lift"?, "notes"?, "onlyWeeks"?: [from, to] }` plus **exactly one** of the six types below. `notes` are the how-to, shown under "How to". `onlyWeeks` limits the item to a range of weeks.

### `progression`: a lift in percentages, by rule

```json
"progression": {
  "phases": [{ "weeks": [1, 2], "sets": 5, "reps": 5, "startPct": 0.7, "stepPct": 0.05 }],
  "deload": { "sets": 3, "reps": 5, "pct": 0.6 },
  "test": "ladder"
}
```

- **Phases:** each week of a phase adds `stepPct` to the percentage. A deload week inside a phase doesn't count as a step.
- **Test week:** `"ladder"` works up through 3 @ 70%, 2 @ 80%, 1 @ 90% and 1 @ 95%, then a PR attempt 5 lb over. `"single"` stops at the PR itself, a sure single for lifts that can't be dropped safely on iron plates.

Generated schemas use this form.

### `weeks`: spelled out, week by week

```json
"weeks": {
  "1": { "sets": [{ "reps": 5, "pct": 0.65 }, { "reps": 5, "pct": 0.65 }] },
  "2": { "sets": [{ "reps": 8, "weight": 20 }], "note": "Per leg, a 20 lb dumbbell in each hand" },
  "4": { "sets": [{ "test": "ladder" }] }
}
```

- **Sets:** each set has `reps` (a number or `"max"`) or `seconds`, plus either `pct` of the item's lift or a fixed `weight` in lb.
- **Missing weeks:** a week that isn't listed means the item is off that week.
- **`note`:** shown under the item's name for that week, e.g. the variation or the load.

### `sets`: the same sets every week

```json
"sets": { "sets": [{ "reps": 10, "weight": 25 }, { "reps": 10, "weight": 25 }] }
```

For accessories, and for stand-ins the coach swaps in. Sets can use `pct` of the item's lift, like the other forms.

### `minutes`: timed work

```json
"minutes": { "1": 45, "2": 50, "3": 40 }
```

### `wod`: a slot the WOD bank fills on the day

```json
"wod": { "maxMinutes": 15, "minMinutes": 8, "focus": ["upper", "bike"], "lowImpact": true }
```

- **Picks:** the Train tab offers three WODs from the bank that fit the slot.
- **Focus:** lists what the WOD may work: `upper`, `legs`, `full`, `bike` or `core` (core is always allowed).
- **Low impact:** swaps jumping and running for bike calories.
- **Equipment:** WODs are adjusted to the equipment in Settings. A barbell becomes dumbbells and a jump rope becomes bike calories, and dumbbell weights snap to the pairs you have. WODs done in the last two weeks are left out.

### `check`: a simple tick

```json
"check": true
```

Used for yoga, Pilates, mobility and similar.

## WODs

A WOD has these fields:

```json
{ "id", "name", "format", "minutes", "rounds"?, "scheme"?, "text"?, "parts": [{ "move", "amount"?, "weight"? }] }
```

- **`format`:** `rft` (needs `rounds`), `amrap`, `emom`, `chipper`, `ladder` (needs `scheme`, e.g. `[21, 15, 9]`) or `intervals` (needs `text`).
- **`move`:** a movement id from `src/lib/training/movements.ts`.
- **`amount`:** reps, calories, metres or seconds, however the movement is counted.
- **`weight`:** lb for the barbell, or for each dumbbell or kettlebell.

## The next schema

From the Train tab, **Write the next schema** has the training model (set in Settings) write a draft.

- **Worked out in code first:** how the active schema actually went is worked out set by set, not by the model. That covers planned vs lifted weights, sets done, sessions skipped, repeated weeks and new PRs.
- **What the model receives:** that report, along with the active schema, your equipment and your note.
- **Checking:** the draft is validated like an import. If it fails, the model gets one retry with the list of problems.
- **Start date:** the draft starts the Monday after the active schema ends.
- **Carried over:** items that keep their id keep their how-to notes.
- **Review:** you compare it with the current schema and choose **Follow it** or **Discard**.

## The coach

On the Train tab, **Coach** opens a chat with the coach model (set in Settings). You can ask how your training is going, get feedback on the plan, or ask for a change. Questions just get answers.

**Proposed changes.** A change comes back as a card that spells out what it would do. The card's lines are worked out by resolving the affected days before and after the change, not taken from the model's wording, for example "Fri, Nov 6 → Sat, Nov 7: Olympic lifts". Nothing changes until you tap **Apply**, and every change can be undone.

**One-off changes** sit on top of the schema for some days; the schema itself is untouched.

| Change | What it does |
|---|---|
| `move` | Does a session on another day |
| `skip` | Skips a session, or the whole day |
| `load` | Scales the planned weights, for example 90% |
| `swap` | Puts a stand-in item in place of another for a few days |
| `equipment` | Sets the gear on hand for some days, for travel |

They show on the day as "Adjusted" lines, each with an undo.

**Lasting changes** apply from a week on: `replaceItem`, `addItem`, `removeItem`, `addSession`, `removeSession` and `moveSession`.
- Weeks already trained are never rewritten. A changed item keeps its earlier weeks, and what replaces it is a new item with a new id, so logged sets stay with the item they were logged against.
- Each lasting change saves the schema's previous body, and undo restores it. Changes are undone newest first.

**A rewrite** has the training model write the rest of the plan from a week on.
- The weeks before that are copied over unchanged, and the dates and week numbers stay the same.
- It arrives as a draft to review on Block. Following it replaces the active schema's body, so this block's logs stay with it, and undo puts the old body back.

**Feeding the next schema.** What you tell the coach, and the one-off changes you make, go into the report the next schema is written from.
