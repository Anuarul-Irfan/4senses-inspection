# 4Senses Inspect

4Senses Inspect is a mobile-first TPM inspection application for daily, first-level equipment checks. It guides area owners through a 25-point sensory checklist, records findings and photos, tracks engineering closures and preventive maintenance work, and produces monthly and year-to-date reporting through Google Apps Script, Google Sheets, and Google Drive.

The user interface is implemented as a single HTML file with embedded CSS and JavaScript. The backend is a Google Apps Script web app. There is no package installation or build step.

## Features

- Daily inspections using four senses: sight, hearing, smell, and touch
- 25 checklist items with `OK`, `NOT OK`, and `N/A` results
- Required remarks and optional inspection photos for findings
- Inspector-to-machine filtering across eight production areas
- Team leader access to all configured machines
- Automatic area and supervisor selection from the machine configuration
- Monthly dashboard with inspection totals, pass rate, findings, trends, and owner progress
- History filters by date, result, sense, and area owner
- Engineering workflow for reviewing and closing findings
- Required engineer name, corrective action, and evidence photo before closure
- Local preventive maintenance list with CSV and copyable text export
- PM-to-Drive controls in the interface, pending implementation of four backend actions
- Monthly and year-to-date report generation in Google Drive
- Client-side caching for faster loading and limited resilience during connectivity issues
- Malaysia time zone handling using `Asia/Kuala_Lumpur`

## Technology

- HTML5, CSS, and vanilla JavaScript
- [Chart.js 4.4.1](https://www.chartjs.org/) for dashboard charts
- Google Apps Script as the backend API
- Google Sheets and Google Drive for inspection records, photos, closures, and reports
- Google Fonts: Rajdhani and DM Sans
- Browser `localStorage` for caching and local-first engineering updates

## Project Structure

Recommended repository layout:

```text
Google Apps Script project/
├── Code.gs
├── Index.html
└── README.md
```

`Index.html` must use this exact capitalization because the backend serves it with `HtmlService.createHtmlOutputFromFile('Index')`.

Deploy `Code.gs` and `Index.html` to the same Apps Script project. Keep `README.md` in the source repository or project documentation.

## Quick Start

1. Create a Google Drive folder that will contain all inspection data.
2. Copy the folder ID from its Drive URL and assign it to `DRIVE_FOLDER_ID` in `Code.gs`.
3. Create a Google Apps Script project with the V8 runtime.
4. Add the backend as `Code.gs` and the frontend as `Index.html`.
5. Set the Apps Script project time zone to `Asia/Kuala_Lumpur`.
6. Deploy the project as a web app, normally executing as the project owner.
7. Copy the production `/exec` URL into `GAS_URL` in `Index.html`.
8. Create a new deployment version after changing either source file.
9. Open the `/exec` URL and select the synchronization indicator to test the connection.

The Drive folder must already exist and be accessible to the Google account under which the web app executes. Sheets, month folders, photo folders, and reports are created automatically on first use.

### Local frontend option

The frontend can also be hosted separately while the Apps Script deployment remains the API. Save it as `index.html`, set `GAS_URL`, and start a local server:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080) in a modern browser.

Opening the file directly in a browser may work, but a local web server is more reliable. Avoid opening it inside an in-app browser such as WhatsApp because network requests and uploads may be blocked.

## Google Apps Script Setup

The frontend sends read-only requests as a URL-encoded JSON `payload` query parameter. Mutating and report-related requests use a JSON `text/plain` POST body. The backend always returns JSON through `ContentService`.

When no action is supplied, `doGet` serves `Index.html` as the application.

### Implemented API actions

| Action | Methods | Purpose |
| --- | --- | --- |
| `ping` | GET, POST | Test connectivity and return ISO server time |
| `getRecords` | GET, POST | Return inspection records for a `YYYY-MM` month |
| `getYTD` | GET, POST | Aggregate a year and return months containing inspection files |
| `submit` | POST | Save an inspection, upload photos, and rebuild the monthly summary |
| `getEngClosures` | POST | Return engineering closures for a month |
| `saveEngClosure` | POST | Upsert a closure, upload evidence, and update the inspection row |
| `syncAllClosures` | POST | Bulk upsert locally cached closures |
| `generateMonthly` | GET, POST | Rebuild the monthly report and return the inspection sheet URL |
| `generateYTD` | GET, POST | Rebuild the seven-tab YTD report and return its URL |
| `deleteRecord` | GET, POST | Delete a record using its submitted-at timestamp ID |
| `debug` | GET, POST | Return headers and sample row diagnostics for a month |

### PM compatibility gap

The frontend also calls the following actions, but the supplied backend does not implement them:

- `savePMItem`
- `removePMItem`
- `getPMList`
- `updatePMStatus`

Until these handlers are added to `doPost`, PM items are stored only in the current browser. CSV and text exports work locally, but Drive synchronization, cross-device PM visibility, PM sheet opening, and remote status updates do not work. The backend returns `Unknown action` for these requests.

### Drive output structure

The backend creates and reuses this structure beneath `DRIVE_FOLDER_ID`:

```text
Configured Drive folder/
├── YYYY-MM/
│   ├── Inspections_YYYY-MM
│   │   └── Records
│   ├── Monthly_Report_YYYY-MM
│   │   └── Summary
│   ├── EngClosures_YYYY-MM
│   │   └── Closures
│   └── Photos/
│       ├── YYYY-MM-DD/
│       │   └── inspection photos
│       └── Eng_*.jpg
└── YTD_Report_YYYY
    ├── YTD Summary
    ├── Monthly Summary
    ├── All Records
    ├── Machine Breakdown
    ├── Area Breakdown
    ├── Inspector Breakdown
    └── Eng Closures
```

The inspection `Records` sheet uses two header rows and 32 columns. The first 27 hold inspection data and up to four photo cells. Columns 28 through 32 hold the closure status, engineer, closure time, corrective action, and evidence photo.

The monthly summary includes overall KPIs, engineering closure rates, closure detail by machine, sense-level OK rates, machine and inspector breakdowns, and engineering response statistics. The YTD report aggregates all available month folders into seven tabs.

The script regenerates the monthly summary after every successful submission. It also migrates older inspection sheets by adding missing time and engineering columns when needed.

## Configuration

### Backend settings

| Setting | Purpose |
| --- | --- |
| `DRIVE_FOLDER_ID` | Existing Drive folder used as the root for all generated files |
| Apps Script time zone | Controls sheet dates and report timestamps; use `Asia/Kuala_Lumpur` |
| Web app execution identity | Determines which account creates and owns Drive content |
| Web app access policy | Determines who can open the UI and call API actions |

The folder ID is the value after `/folders/` in a Google Drive folder URL. It is an identifier, not a complete URL.

### Frontend settings

| Setting | Purpose |
| --- | --- |
| `GAS_URL` | Production Apps Script web app `/exec` endpoint |
| `EQUIPMENT_DATA` | Areas, machines, and their assigned supervisors |
| `SENSES` | Checklist sections, inspection items, and acceptance criteria |
| `ENG_MEMBERS` | Engineers available in the closure workflow |
| `AREA_OWNERS` | Owners displayed in dashboard progress reporting |
| `CACHE_TTL` | Inspection record cache lifetime, currently 15 minutes |
| `PHOTO_MAX_PX` | Maximum compressed photo dimension, currently 800 pixels |
| `PHOTO_TARGET` | Approximate compressed photo target, currently 80 KB |
| `PHOTO_MIN_Q` | Minimum JPEG compression quality |

Inspector names and some filter controls are defined directly in the HTML. When adding or renaming an owner, review all of the following:

- Inspector dropdown options
- `EQUIPMENT_DATA`
- `AREA_OWNERS`
- History owner filter chips

Keeping these entries aligned prevents missing machines and incomplete dashboard totals.

The YTD report also contains a separate hardcoded `areaOwnerMap` inside `generateYTD`. Update that map when area ownership changes or the Area Breakdown tab will show outdated owners.

## Inspection Workflow

1. Select an inspector or area owner.
2. Select one of the machines assigned to that person. Team leaders can select any configured machine.
3. Confirm the date, time, and shift.
4. Complete all 25 sensory checks.
5. Add a remark and photo where required for a `NOT OK` finding.
6. Submit the inspection to the Apps Script backend.
7. Review failures in the Engineering view.
8. Close the issue immediately or add it to the PM list.
9. Record the action taken, engineer, and evidence photo to complete a closure.

An inspection passes only when it has zero `NOT OK` results.

## Local Storage and Synchronization

The application uses these browser storage keys:

| Key | Contents |
| --- | --- |
| `4senses_cache_YYYY-MM` | Cached inspection records for a month |
| `4senses_eng_YYYY-MM` | Cached engineering closures for a month |
| `4senses_pm_list` | Local preventive maintenance list |

Inspection record caches are retained for the three most recent months. The app refreshes records in the background every three minutes while it is visible. Cached records older than 15 minutes are shown immediately and then refreshed in the background.

Local storage is device-specific. Clearing browser data removes local caches, local PM items, and locally held closure data. It does not delete records already saved to Google Drive or Sheets.

This is a local-first interface, not a fully offline submission queue. An inspection that fails to reach the backend must be submitted again after connectivity is restored.

With the current backend, all PM list data is local-only. Clearing browser data removes it permanently unless it was exported first.

## Photos

Inspection and closure photos are compressed in the browser before upload. The default target is approximately 80 KB with a maximum long edge of 800 pixels.

The backend uploads incoming base64 images to the month folder in Drive and returns accessible file URLs. Inspection images are placed under `Photos/YYYY-MM-DD`; engineering evidence is placed directly under `Photos`.

All uploaded images are saved in Drive, but the inspection sheet exposes only the first four photo URLs. `getRecords` also rebuilds record photo data from those four columns. If an inspection includes more than four images, the extra files remain in Drive but are not associated with the record after it is reloaded.

The script currently applies `ANYONE_WITH_LINK` viewer access to created Sheets and photos. If a Workspace policy blocks this sharing mode, uploads or file creation may fail. Review the sharing behavior before production use.

## Validation Checklist

Before production use, verify the following:

- The connection test returns a valid server time.
- A complete all-OK inspection appears in History and Dashboard.
- A `NOT OK` inspection retains its remark and photo.
- Engineering can see, filter, and close the finding.
- A closure cannot be completed without an engineer, action, and evidence photo.
- PM CSV and text exports contain the expected fields.
- PM controls remain local and report `Unknown action` for Drive operations until the missing backend handlers are added.
- Monthly and YTD reports are created in the correct Drive location.
- Report links and Drive thumbnails are accessible to the intended users.
- Malaysia date and time values are correct on devices in other time zones.

## Security and Operational Notes

- Treat the deployed Apps Script URL and Drive folder ID as configuration. Avoid committing production values to a public repository.
- The backend has no application-level authentication or role checks. Access control depends entirely on the Apps Script deployment settings.
- `deleteRecord` and `debug` are exposed through the web API. Restrict the web app audience or remove these routes if they are not required in production.
- The code explicitly grants anyone-with-link viewer access to generated spreadsheets and photos. Replace that behavior if operational data must remain restricted to your organization.
- The backend does not use `LockService`. Test simultaneous submissions from multiple inspectors and add a script lock if row collisions occur.
- Inspection records may include operational details, employee names, and photos. Handle them according to your organization’s retention and privacy requirements.
- Browser storage is not encrypted by this application. Use managed devices where the data is sensitive.
- Chart.js and Google Fonts are loaded from external CDNs, so charts and typography require network access on first load.
- The mobile web app metadata does not make this a complete Progressive Web App. There is no manifest or service worker in the supplied source.

## Troubleshooting

### The status indicator is red

- Confirm that `GAS_URL` ends in `/exec`.
- Open the Apps Script URL directly and verify that the deployment is accessible to the current user.
- Check that the backend supports the `ping` action and returns valid JSON.
- Use a normal browser rather than an in-app browser.

### Records do not appear immediately

- Confirm that the selected month matches the saved record date.
- Use the refresh control, then wait for the background synchronization.
- Check the browser console and Apps Script execution logs for request errors.

### Photos do not appear

- Confirm that the backend returned a valid Drive URL or file ID.
- Check the Drive file permissions for the current user.
- Verify that the backend accepted the base64 photo and uploaded it successfully.

### PM export reports an unknown action

This is expected with the supplied backend because it does not implement `getPMList`, `savePMItem`, `removePMItem`, or `updatePMStatus`. Add the four handlers and create a new web app deployment version to enable PM Drive synchronization.

### Open monthly report opens the inspection sheet

`generateMonthly` creates or updates `Monthly_Report_YYYY-MM`, but its current response URL points to `Inspections_YYYY-MM`. Return `monthlySS.getUrl()` from the backend if the button should open the generated summary instead.

### Sheets or photos are not created

- Confirm that `DRIVE_FOLDER_ID` points to an existing folder.
- Confirm that the web app execution account can edit that folder.
- Check Apps Script execution logs for a blocked `ANYONE_WITH_LINK` sharing call.
- Verify that the project uses the V8 runtime.

### The UI opens but API calls use an old version

- Confirm that `GAS_URL` points to the production `/exec` URL, not a `/dev` URL.
- Create a new deployment version after editing `Code.gs` or `Index.html`.
- Reload the page without cache if the old frontend is still visible.

## License

No license was included with the supplied source. Add an appropriate license before redistributing the application.
