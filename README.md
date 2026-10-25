# LinkedIn Profile MCP Editor

An MCP-compatible CLI that reads and edits LinkedIn profiles through browser automation. Designed for AI agents to maintain professional profiles programmatically — update headlines, rewrite summaries, add and edit experience/education/project entries — without manual browser interaction.

## Features

- **Label/aria-based field resolution (RU + EN locales)** — fields are matched by their visible labels or `aria-label` attributes with Russian and English variants, not by positional indexes
- **Write verification** — every write is read back and compared; a mismatch aborts loudly instead of reporting a fake success
- **Edit existing entries** — `edit-form` updates already-added positions and education entries (descriptions, end dates, …)
- **Persistent session** — one-time manual login, no repeated authentication
- **Headless by default** — no visible window unless you ask for one (`LINKEDIN_HEADLESS=false`)
- **Safe test mode** — modifies the headline, verifies the change on the public profile, then restores the original

## Quick Start

### Prerequisites

- Node.js 18+
- Google Chrome installed
- A LinkedIn account

### Installation

```bash
git clone https://github.com/<your-username>/linkedin-profile-mcp.git
cd linkedin-profile-mcp
npm install

# One-time login: opens Chrome, you sign in manually (password/2FA stay with you).
# Detects your vanity slug and saves it to .env
node login.js
```

### Usage

```bash
# Read a field
node edit-profile.js get headline

# Write a field (verified by read-back)
node edit-profile.js set headline "Backend Engineer | Python, Kafka"
node edit-profile.js set about "Your summary text"

# Safe roundtrip test: write headline + '.', check the public profile, revert
node edit-profile.js test

# List all fields per form
node edit-profile.js list
```

**Add experience / education / project:**

```bash
node edit-profile.js add-exp \
  --title "Python Engineer" \
  --company "CRBSIT" \
  --location "Moscow" \
  --start_month "Jul" --start_year "2026" \
  --currently_working "true" \
  --description "What you did there..."

node edit-profile.js add-edu --school "University" --degree "BSc" --field_of_study "CS"
node edit-profile.js add-project --project_name "My project" --description "..."
```

**Edit an existing entry** (get edit URLs from your profile's details pages, e.g. `/in/<vanity>/details/experience/`):

```bash
# Add a description and set the end date on an existing position
node edit-profile.js edit-form "https://www.linkedin.com/in/<vanity>/details/experience/edit/forms/<id>/" \
  --description "What you did there..." \
  --end_month Jun --end_year 2026
```

Passing `--end_month/--end_year` automatically unchecks "I am currently working in this role" (fields only become editable then).

**Helper scripts:**

- `read-profile.js` — dump current profile state (headline, about, experience, education)
- `debug-form.js [intro|about|add_exp|add_edu|add_project]` — dump every form control with labels/aria/values; use it to extend the field map

### MCP integration

The CLI is agent-friendly: register it with any MCP client as a shell tool, e.g. for Claude Desktop/Cursor:

```json
{
  "mcpServers": {
    "linkedin-profile": {
      "command": "node",
      "args": ["/absolute/path/to/linkedin-profile-mcp/edit-profile.js", "list"]
    }
  }
}
```

(Or simply let your agent call `node edit-profile.js <command>` from the shell.)

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LINKEDIN_PROFILE_DIR` | `~/.linkedin-mcp/profile` | Browser profile directory for the persistent session |
| `LINKEDIN_VANITY` | *(from `.env`)* | Your LinkedIn vanity URL slug; written by `login.js` |
| `LINKEDIN_HEADLESS` | `true` | Set to `false` to watch Chrome work |

## Notes on the live LinkedIn DOM (as of Oct 2026)

- Edit forms render as an overlay outside `<main>`/`<form>`/`[role=dialog]`, so the field scanner walks the whole document; labels/arias are unique page-wide.
- Headline/About/descriptions are Tiptap/ProseMirror editors (`[contenteditable][role=textbox]`).
- Native checkboxes are zero-height (custom toggle UI on top) — clicks are dispatched as native DOM events.
- Playwright locators pierce open shadow roots while `querySelectorAll` does not, so fields located in `page.evaluate` are marked with `data-limcp-target` and re-located by that attribute.
- **LinkedIn auto-replaces your headline when you add a new current position** — re-set the headline after `add-exp`.
- Save button text is localized («Сохранить» / "Save"); both are matched.
- Monthly selects take names (`Jan`…/`январь`…) or numbers `1–12`.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Field ... not usable` | Run `node debug-form.js <form>` and check the label variants in `FIELD_MAP` — LinkedIn may have changed the wording |
| Save button not found | The form likely didn't open; re-run, or set `LINKEDIN_HEADLESS=false` and watch |
| Login page shows Cloudflare | Login from a headed browser once (`node login.js`); the profile persists for headless runs |
| Session expired | Re-run `node login.js` |

## Why This Exists

LinkedIn has no official write API for profile data. The Partner Program grants write access but is locked behind approval and usage minimums. This project bridges that gap with browser automation — giving AI agents the ability to maintain professional profiles without manual editing.

⚠️ Browser automation may violate LinkedIn's User Agreement; use at your own risk.

## License

MIT
