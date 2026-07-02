# Interval Timer

A straightforward, easy-to-use programmable interval timer for workouts like Tabata, circuit training, or running intervals.

## Features

- **Custom Intervals** — Add exercises with automatic rest periods; reorder intervals with up/down arrows
- **Default Times** — Set default work and rest seconds; each interval can still be customized individually
- **Previous Exercises** — Quickly re-add exercises from past saved workouts
- **Adjustable Rounds** — Choose how many times the full sequence repeats
- **Sound Alerts** — Beeps during the final 3 seconds of each interval
- **Start / Pause / Restart** — Full control at any point during a session
- **Visual Tracking** — Large countdown clock, round progress (e.g. Round 1/8), and interval timeline
- **Next Up Preview** — During rest intervals, see what's coming next so you can prepare
- **Save Workouts** — Store routines in your browser for quick access later
- **Share Workouts** — Generate a link to send routines to friends
- **Full-Screen Friendly** — Responsive layout sized for mobile and desktop workouts

## Quick Start

Open `index.html` in any modern browser, or run a local server:

```bash
python3 -m http.server 8080
```

Then visit [http://localhost:8080](http://localhost:8080).

## Usage

1. Set your **default work and rest** times (used when adding new exercises).
2. Name your workout and set the number of rounds.
3. Add exercises with **+ Add Exercise** — each adds a work interval plus rest automatically.
4. Reuse exercises from **Previous Exercises** (populated from saved workouts).
5. Reorder intervals or saved workouts using the ▲▼ buttons.
6. Customize any interval's duration individually.

### Sharing

Shared links encode the workout in the URL (e.g. `?w=eyJuIjoi...`). Anyone who opens the link gets the workout loaded automatically — no account needed.

### Saved Workouts

Workouts are stored in your browser's local storage. They persist across sessions on the same device and browser.

## Tech

Plain HTML, CSS, and JavaScript — no build step, no dependencies.
