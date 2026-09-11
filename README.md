# OriginFill

> *"Never lose a job application form again."*

**OriginFill** is an enterprise-grade Chrome Extension (Manifest V3) built to eliminate repetitive data entry, handle multi-page application flows, and recover form data from session timeouts on modern applicant tracking systems like **Workday** and generic career portals.

---

## 🚀 Key Features

- ⚡ **Intelligent Auto-Fill**: Auto-detects Workday and career portal application forms and accurately fills personal, education, and work experience information.
- 🛡️ **Session Guard & Recovery**: Automatically captures snapshot backups on field changes. If your session times out or your page accidentally reloads, restore all entered data with a single click.
- 🔒 **Encrypted Local Storage**: Sensitive profile information is encrypted using Web Crypto API (AES-GCM 256-bit) and stored securely in local browser storage.
- 📂 **Resume Management**: Secure IndexedDB storage for resumes (up to 3 resumes, 5MB each) with instant drag-and-drop support.
- 🎨 **Modern Responsive UI**: Clean popup and extensive settings dashboard with dark mode support, color-coded profiles, and accessibility (ARIA).
- 🧩 **Multi-Profile Support**: Switch between multiple profiles (e.g., Software Engineer, Product Manager, Full Stack) effortlessly.

---

## 🛠️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/revanthchary04/Origin---Auto-Filler-Portal.git
   ```
2. **Open Chrome / Chromium browser:**
   Navigate to `chrome://extensions/`.
3. **Enable Developer Mode:**
   Toggle the "Developer mode" switch in the top right corner.
4. **Load Unpacked Extension:**
   Click **Load unpacked** and select the root directory of this project (`Auto Fill Portal`).

---

## 📁 Project Structure

```
├── manifest.json              # Manifest V3 configuration
├── _locales/                  # Internationalization (i18n)
│   └── en/messages.json
├── assets/                    # Extension icons (16, 32, 48, 128px)
├── background/
│   └── service-worker.js     # Background worker, alarms & tab events
├── content/
│   ├── detector.js           # Portal detection engine
│   ├── filler.js             # Form auto-filler
│   ├── init.js               # Content script entry point
│   ├── observer.js           # DOM mutation observer for dynamic forms
│   ├── session-guard.js      # Session snapshot & recovery engine
│   └── portals/
│       ├── workday.js        # Workday specific adapter
│       └── generic.js        # Generic portal adapter
├── popup/
│   ├── popup.html            # Extension popup UI
│   ├── popup.css             # Styling & dark mode
│   └── popup.js              # Popup interaction logic
├── settings/
│   ├── settings.html         # Full settings dashboard
│   ├── settings.css          # Settings styling
│   └── settings.js           # Settings logic & IndexedDB storage
├── storage/
│   ├── encryption.js         # Web Crypto AES-GCM encryption
│   └── store.js              # Storage adapter
└── utils/
    ├── constants.js          # Global constants & selectors
    ├── field-mapper.js       # Field mapping heuristics
    ├── fuzzy-match.js        # Levenshtein fuzzy matching
    └── logger.js             # Structured logger
```

---

## 📜 License

Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).  
Authored by **CharyWorld**.
