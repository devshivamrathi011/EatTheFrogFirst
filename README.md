# Daily Routine Tracker

A static web app for the hybrid training plan, the vegetarian meal plan and the daily routine.
Habits are never ticked by hand. They fill in from what you log on the **Today** tab.

## How habits are worked out

| Habit | Counts when |
|---|---|
| Sleep 7.5 h+ | *Lights out* last night → *Wake up* this morning is 7 h 30 min or more |
| Morning sunlight | You tap *Wake up* |
| Morning / Evening session | You mark the session done (day plan or Workout tab) |
| Protein 120 g+ | Meals you tap *Eat* on add up to 120 g |
| 3 L water | 12 × 250 ml glasses logged |
| Curd / chaas | You eat a meal that includes curd, raita or chaas |
| 5 fruit + veg | Meals eaten add up to 5 servings |
| Walk after meals | Both 10-min walks done |
| No sweets / junk | Turns on at 9 pm if you logged activity and no slips |
| Skincare AM + PM | Both skin tasks done |
| Screens off by 10:15 pm | *Screens off* tapped between 5 pm and 10:15 pm |
| Career / business block | Any study, build or business block done that day (reading, build block, commute study, evening block, Saturday build, Sunday business or review) |

Tapping a task records the current time. Tap a done task again to change the time or remove it.
After most taps an **Undo** button shows for a few seconds. Use the arrows beside the date to step between days.
A **good day** is 10 or more habits and a **perfect day** is all 13. The flame on Today counts good days in a row
and lights up once today qualifies. Hitting either one plays a short confetti burst (skipped if your phone asks for reduced motion).
Done items from earlier in the day fold into one line; tap it to see them again.
Thresholds live in `data/plan.json` → `rules`.

## App lock (passcode)

On first launch the app offers to set a passcode (or **Not now**). You can turn it on, change it, or turn it off
any time in **Guide → App lock**.

- The passcode is never stored. Only a salted PBKDF2-SHA-256 hash (600,000 rounds) is kept in the browser.
- Five wrong tries in a row start a timed wait: 30 s, then 60 s, 2 min and so on, up to 15 min.
- The app re-locks after it has been in the background for the time you choose (default 5 minutes), or any time with the lock button in the header.
- Nothing from `data/` is requested until you unlock.
- **Forgot it?** There is no recovery. The link on the lock screen erases this browser's tracker data and the lock,
  so keep your `.json` exports and Import one afterwards.
- It needs https or `localhost` (the browser's crypto API). GitHub Pages is https.

**What it does not do.** A static site has no server to check a login against, so this is a lock on the screen, not
encryption. It stops someone picking up your phone or opening the link from seeing your log. It does not hide the
files: anyone can still fetch `data/plan.json` by URL, and anyone with devtools on your device can read the stored log.

## Private repo and GitHub Pages

- **Free plan:** Pages only works from a *public* repo.
- **Pro / Team / Enterprise Cloud:** Pages also works from a *private* repo, but the published site is still public
  on the internet. Making the repo private hides the source, not the site.
- **Truly private site:** only an organisation on GitHub Enterprise Cloud can limit a Pages project site to its members.
  Other routes are a host that puts a login in front of the site (for example Cloudflare Pages with Cloudflare Access),
  or CloudFront with signed access for the S3 route below.
- `data/plan.json` holds your age, height, weight and the skin, hair and gut notes. If the site is public, so is that.
  Edit the `profile` line and the `issues` text before publishing, or keep the repo and site private as above.
- `index.html` carries `noindex`, which asks search engines not to list the page. It is a request, not a lock.

## Where your data is stored

GitHub Pages and S3 only serve files, so nothing can be written back to the server.
Your log is kept as **one JSON document in the browser** (`localStorage`, key `routine-db-v2`):

```json
{
  "app": "daily-routine-tracker",
  "version": 2,
  "meta": { "created": "…", "lastBackup": "…" },
  "records": {
    "2026-10-07": {
      "mode": "wfh",
      "tasks":    { "wake": "06:31", "skinam": "07:52", "walk1": "13:40" },
      "meals":    { "breakfast": true, "lunch": true },
      "sessions": { "am": true, "pm": false },
      "water": 9, "slips": 0,
      "checkin":  { "energy": 4, "skin": 3 },
      "lifts":    { "goblet-squat": "16" },
      "note": "", "updatedAt": "…"
    }
  }
}
```

- **Guide → Your data → Export .json** downloads that file. Keep it in Google Drive or iCloud.
- **Import .json** merges a backup into the current browser. For each day the newer copy wins.
- The app reminds you to back up once a week. Clearing site data or uninstalling the browser
  deletes the log, so export now and then.
- Each browser and phone has its own copy. To move to a new phone: Export on the old one, Import on the new one.

The plan content is plain JSON you can edit:

- `data/plan.json`: meals (protein, fruit/veg servings), day timeline and times, habits, rules, targets, guide text
- `data/workouts.json`: exercises per day (sets × reps, rest, cues)
- `data/figures.json`: the stick-figure illustrations (SVG)

## Run it locally

Browsers block `fetch()` from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

1. Create a repo and put the contents of this folder at the repo root (or in `/docs`).
2. Push to GitHub.
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → branch `main`, folder `/ (root)` (or `/docs`).
4. Open `https://<user>.github.io/<repo>/` on your phone and use **Add to Home Screen**.
   It then opens full-screen and works offline.

## Deploy to S3

```bash
aws s3 mb s3://my-routine-tracker
aws s3 website s3://my-routine-tracker --index-document index.html
aws s3 sync . s3://my-routine-tracker --delete --exclude ".git/*" \
  --cache-control "no-cache"
```

Then allow public reads with a bucket policy, or (better) put **CloudFront** in front with Origin Access Control.
You need HTTPS for offline mode and Add to Home Screen. The S3 website endpoint is HTTP only; CloudFront gives you HTTPS.
`manifest.webmanifest` should be served as `application/manifest+json` (S3 sync usually guesses this).

## After you change files

Bump `VERSION` in `sw.js` (e.g. `routine-v7`) so phones pick up the new files.
If you add a new file, add it to `FILES` in `sw.js` too (that list is what works offline).
Data files are fetched network-first, so edits to `data/*.json` show up on the next online load anyway.
