# Momentum: goals, habits, growth and Google Calendar

A lightweight productivity web app with no build step and no backend. Your data stays in your browser (localStorage), and Google Calendar is reached directly from the page through Google's OAuth.

## Features

**Dashboard**
- **Growth %**: your habit score for the last 7 days compared with the 7 days before.
- 7-day habit score, average goal progress, and how many points that progress moved in the last 30 days.
- Best active streak and the number of goals achieved.
- A 30-day consistency chart (daily completion plus a 7-day moving average).
- Today's habits as a one-tap checklist, and your next two weeks of events.

**Goals**
- Measurable goals: a start value, a target, a unit, a category and an optional deadline.
- Log progress over time. Each goal card shows its % complete, its growth in the last 30 days and a growth sparkline.
- A pace check against the deadline ("on track" / "N pts behind pace").
- **Schedule work** creates a calendar event linked to the goal.

**Habits**
- Daily habits or habits with an N×/week target, with a 7-day check row and a 12-week heatmap.
- Current streak, best streak and a 30-day completion rate. You can backfill past days.
- An optional reminder time adds a recurring event to Google Calendar.

**Calendar**
- A month view that merges local events with your Google Calendar events.
- Create and delete events. Events made while you're disconnected are saved locally and synced to Google when you connect.

**Settings**: export and import a JSON backup, load demo data, erase data, and switch between light and dark themes.

## Run it

Google sign-in needs an `http(s)` origin, so serve the folder rather than opening the file directly:

```bash
cd productivity-app
python3 -m http.server 8000
# open http://localhost:8000
```

Goals, habits and the dashboard work right away. Google Calendar needs the one-time setup below.

## Connect Google Calendar (one-time setup)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project.
2. Under **APIs & Services → Library**, enable the **Google Calendar API**.
3. Under **APIs & Services → OAuth consent screen**, choose *External* and add yourself as a **test user**.
4. Under **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:8000` (plus any other origin you host it on)
5. Copy the Client ID into **Settings → Google Calendar** in the app, then click **Connect Google Calendar** on the Calendar tab.

The app requests only the `calendar.events` scope. The access token is kept in memory, never written to storage, and expires after about an hour. After that, click Connect again.

## How growth is calculated

| Metric | Formula |
|---|---|
| Habit score (7 days) | Average over habits of `min(1, completions in window ÷ weekly target)` |
| Growth % | `(score this week − score last week) ÷ score last week × 100` |
| Goal progress | `(current − start) ÷ (target − start)`, clamped to 0–100% |
| Goal growth (30 days) | Progress now minus progress 30 days ago, from your progress log |
| Pace | Progress expected if it were spread evenly from the goal's creation to its deadline |

## Files

- `index.html`: layout and dialogs
- `styles.css`: styling, with light and dark themes and a responsive layout
- `app.js`: state, metrics, rendering and the Google Calendar client
