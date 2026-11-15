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

**Try it without Supabase:** choose "Use on this device only" on the first screen. Leads then stay on that device and don't sync.

## 3. iPhone app (Sideloadly)

An iPhone app can only be compiled on a Mac, so GitHub builds it for you on a free cloud Mac.

1. Optional but recommended: put your Project URL and anon key in `www/config.js` so you don't have to type them on the phone. If you do, keep the repository **private**.
2. Push your change to this repository if you edited `www/config.js`.
3. Start the build: on GitHub open **Actions > Build iPhone app (unsigned IPA) > Run workflow**. When it finishes, download the **LeadHub-ipa** artifact from the run's page and unzip it. Or from a terminal:
   ```
   gh workflow run ios.yml
   gh run watch
   gh run download -n LeadHub-ipa
   ```
   You get `LeadHub.ipa`, unsigned.
4. Open Sideloadly, connect the iPhone, drag in `LeadHub.ipa`, enter your Apple ID and press Start.
5. On the iPhone: **Settings > General > VPN & Device Management**, trust your Apple ID. On iOS 16 and later also turn on **Settings > Privacy & Security > Developer Mode**.

With a free Apple ID the app stops opening after 7 days. Re-run step 4 to renew it; your leads are in Supabase, so nothing is lost. Sideloadly can refresh it automatically over Wi-Fi if you enable that.

## Importing your first leads

Open a project, press **Import CSV**, and pick a file. The first row must have a column named Name, Clinic or Company. Other recognised columns: Priority, Category, Phone, Phone type, WhatsApp, Email, Instagram, Website, Status, Last contacted (YYYY-MM-DD), Reply time, Notes, Address, Google Maps.

Lead lists are kept out of this repository on purpose (`sample-data/` is git-ignored), so your contacts are not published with the code.

## How sync works

Every change is saved to Supabase straight away. Each device reloads when you open or return to the app, every minute while it's open, and when you press Refresh. If two devices edit the same lead at the same moment, the last save wins. The app needs an internet connection to save changes; it shows the last loaded leads when offline but doesn't queue edits.

## What has and hasn't been tested

- **Tested:** CSV import/export, duplicate detection, link safety, filtering and stats (`npm test`, 10 checks), and the full interface in a headless browser in device-only mode: creating projects, importing the sample file, searching, editing, deleting, at desktop and phone sizes.
- **Not tested:** sync against a real Supabase project, the Electron window on Windows, and the GitHub iOS build. They're written to the tools' documented behaviour, but your first run is the real test. If the iOS build fails, the Actions log shows the failing step.
- **iPhone CSV export** uses the share sheet. If that isn't available inside the app wrapper, it falls back to showing the CSV text to copy.

## Files

- `www/`: the app (interface in `app.js`, sync in `store.js`, CSV and stats in `core.js`)
- `desktop/main.js`: the Windows window
- `supabase/schema.sql`: database tables and security rules
- `.github/workflows/ios.yml`: the iPhone build
- `capacitor.config.json`: iPhone app name and identifier
- `test/core.test.js`: logic checks
