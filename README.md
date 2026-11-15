# Lead Hub

One lead manager for all your projects: a Windows app and an iPhone app showing the same leads, synced through your own Supabase database.

- **Tabs per project** in a sidebar on Windows and a strip of tabs on iPhone
- **Dashboard** with totals, reply rate and a pipeline across every project
- **Lead details** with status, priority, notes, last contacted, and one-tap Call, WhatsApp, Maps, Instagram
- **CSV import and export** per project, with duplicate detection on import
- Light and dark mode, Arabic names supported

The same code in `www/` runs in both apps. Nothing needs compiling to change the app.

## 1. Set up the database (5 minutes, free)

1. Create a free account at supabase.com and make a new project. Pick a strong database password and keep it.
2. Open **SQL Editor > New query**, paste the whole of `supabase/schema.sql`, and press **Run**.
3. Open **Authentication > Users > Add user**. Enter your email and a password and tick **Auto Confirm User**. This is the login you'll use in the app.
4. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key.

Each row is locked to the account that created it (row-level security), so the anon key can't read your leads without your login. Never put the **service_role** key in the app.

## 2. Windows app

You need Node.js 20 or newer.

```
npm install
npm run desktop
```

On the first screen, paste the Project URL and anon key, then sign in. To get a single `.exe` you can pin to the taskbar:

```
npm run dist:win
```

The file appears in `dist/`. Windows may show a SmartScreen warning because the app isn't code-signed; choose "More info > Run anyway".

### WhatsApp panel (Windows only)

Press **WhatsApp** at the bottom of the sidebar to open WhatsApp Web in a panel on the right. Scan the QR code with your phone once; the login is remembered. The **WhatsApp** button on a lead then opens that lead's chat in the panel, and you type and send as usual. Press **Close** at the top of the panel (or **Hide WhatsApp** in the sidebar) when you're done; it stays connected in the background, so reopening is instant. **All chats** goes back to your chat list.

**Message template:** press **Message** on a project to write one message for all its leads, with placeholders such as `{name}`. Pressing WhatsApp on a lead then puts the filled-in message in the chat box for you to check and send, and marks the lead as Messaged with today's date.

It is your normal WhatsApp account used by hand. The app does not send anything on its own. On iPhone the WhatsApp button opens the WhatsApp app instead.

### Mockups (JemaiStudio)

Press **Mockup** on a lead to get a JemaiStudio page for that business at `app.jemaistudio.dev/m/<name>-<town>-xxxx`. The panel is prefilled from the lead (name, town from the address, category, notes); add what you know in **Description**, pick one of the 10 templates (Courant Vert, Lumen, SOS, Volt, Caloria, Atelier, Lefort, Plouf, Hydra, Durand) or leave Auto, which chooses from the trade and avoids your last ones, then **Generate** (20–40 s). Only facts in your description (reviews, years, labels) can appear on the page. The link is saved on the lead and `{mockup}` in a project message inserts it. **Redo mockup** gives a new design at the same link.

One-time setup:
1. In jemai-studio-app on Vercel, add `MOCKUP_API_SECRET` (any long random text, e.g. from `openssl rand -hex 32`) and redeploy.
2. In Supabase (Lead Hub's project), SQL Editor, run once: `alter table public.leads add column if not exists mockup_url text not null default '';`
3. In Lead Hub, press **Mockups** at the bottom of the sidebar and paste the same key. It stays on that device (do it once on the PC and once on the iPhone).

The key can only create mockups. The AI keys stay on the JemaiStudio server.

**Try it without Supabase:** choose "Use on this device only" on the first screen. Leads then stay on that device and don't sync.

## 3. iPhone app (Sideloadly)

An iPhone app can only be compiled on a Mac, so GitHub builds it for you on a free cloud Mac.

1. Optional but recommended: put your Project URL and anon key in `www/config.js` so you don't have to type them on the phone. If you do, keep the repository **private**.
2. Put the build recipe where GitHub looks for it: create the folders `.github\workflows` inside `lead-hub` and move `github-workflow\ios.yml` into them, so the file is at `.github\workflows\ios.yml`. In PowerShell:
   ```
   mkdir .github\workflows
   move github-workflow\ios.yml .github\workflows\ios.yml
   ```
3. Push this folder to a private GitHub repository:
   ```
   git init
   git add .
   git commit -m "Lead Hub"
   gh repo create lead-hub --private --source . --push
   ```
4. Start the build and download the result:
   ```
   gh workflow run ios.yml
   gh run watch
   gh run download -n LeadHub-ipa
   ```
   You get `LeadHub.ipa`, unsigned.
5. Open Sideloadly, connect the iPhone, drag in `LeadHub.ipa`, enter your Apple ID and press Start.
6. On the iPhone: **Settings > General > VPN & Device Management**, trust your Apple ID. On iOS 16 and later also turn on **Settings > Privacy & Security > Developer Mode**.

With a free Apple ID the app stops opening after 7 days. Re-run step 5 to renew it; your leads are in Supabase, so nothing is lost. Sideloadly can refresh it automatically over Wi-Fi if you enable that.

## Importing your first leads

Open a project, press **Import CSV**, and pick a file. The first row must have a column named Name, Clinic or Company. Other recognised columns: Priority, Category, Phone, Phone type, WhatsApp, Email, Instagram, Website, Status, Last contacted (YYYY-MM-DD), Reply time, Notes, Address, Google Maps.

`sample-data/jeddah-clinic-leads.csv` is the Jeddah clinic list, ready to import. It contains 178 rows; 2 are exact repeats, so 176 are added.

## How sync works

Every change is saved to Supabase straight away. Each device reloads when you open or return to the app, every minute while it's open, and when you press Refresh. If two devices edit the same lead at the same moment, the last save wins. The app needs an internet connection to save changes; it shows the last loaded leads when offline but doesn't queue edits.

## What has and hasn't been tested

- **Tested:** CSV import/export, duplicate detection, link safety, filtering and stats (`npm test`, 12 checks), and the full interface in a headless browser in device-only mode: creating projects, importing the sample file, searching, editing, deleting, at desktop and phone sizes.
- **Tested on Linux, not Windows:** the desktop shell starts, and the WhatsApp panel opens, resizes the app and closes.
- **Not tested:** WhatsApp Web actually loading and logging in inside the panel (no access from the build machine), and the GitHub iOS build. They're written to the tools' documented behaviour, but your first run is the real test. If the iOS build fails, the Actions log shows the failing step.
- **Mockups:** the panel was tested end to end against a stand-in server (wrong key, generation, link saved, `{mockup}` in the WhatsApp message). The real JemaiStudio route was tested for its key check and CORS, and the page renderer with a demo trade; a real AI generation runs only once it's deployed with your keys.
- **iPhone CSV export** uses the share sheet. If that isn't available inside the app wrapper, it falls back to showing the CSV text to copy.

## Files

- `www/`: the app (interface in `app.js`, sync in `store.js`, CSV and stats in `core.js`)
- `desktop/main.js`, `desktop/preload.js`: the Windows window and its WhatsApp panel
- `supabase/schema.sql`: database tables and security rules
- `github-workflow/ios.yml`: the iPhone build recipe (move it to `.github/workflows/` as described above)
- `capacitor.config.json`: iPhone app name and identifier
- `test/core.test.js`: logic checks
