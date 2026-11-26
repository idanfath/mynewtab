# MyNewTab

Personal new-tab page built with React, TypeScript, Vite, Tailwind CSS, and Monaco Editor.

## Features

- Flat JSON bookmark data with validation plus universal browser Netscape Bookmark HTML (`.html` / `.htm`) import and export (Chrome, Brave, Edge, Firefox, Safari).
- Diff-aware Import Studio when importing into an existing directory: choose **Merge & Enrich**, **Add New Only**, or **Replace Directory** with live `+added / ~changed / -removed` previews before committing.
- Local Snapshot Vault (`History` button or `h` shortcut): automatic pre-mutation snapshots before bulk imports, JSON edits, section removals, and restores; manual named checkpoints; live diff preview, one-click restore, per-snapshot `.json` / `.html` export, and corrupt-backup repair rescue.
- Multi-tab `localStorage` synchronization with active-modal conflict detection (`Load external changes` or `Save mine` with automatic History backup of the external version).
- Add, edit, delete, and restore individual bookmarks without editing JSON.
- Rename sections or remove them by moving or deleting their bookmarks.
- Drop browser links into any section (or anywhere to use `Uncategorized`), or drop `.json` / `.html` files anywhere to import.
- Local persistence through `localStorage` with quota-safe snapshot eviction that always prioritizes active bookmarks.
- Fuzzy search across titles, sections, aliases, categories, capabilities, and notes.
- Unified omnibar (`/`) supporting `!bang` shortcuts, bookmark site search, direct URL/localhost navigation, and web search (`Tab` to autocomplete `!bang`, `Shift+Enter` to search web directly).
- Configurable default search engine presets, per-built-in `!bang` toggles, and custom `!bang` triggers persisted locally in `localStorage`.
- Drag-and-drop section and bookmark ordering.
- Bundled background and app icon assets with production caching on Vercel.

## Bookmark format

Bookmarks are stored as a JSON array (and can also be imported/exported as standard Netscape Bookmark HTML). `title`, `url`, and `section` are required; other fields are optional.

```json
[
  {
    "title": "GitHub",
    "url": "https://github.com/",
    "section": "Development",
    "alias": "gh",
    "searchUrl": "https://github.com/search?q=%s",
    "subsection": "Code",
    "description": "Code hosting and collaboration",
    "categories": ["Code"],
    "capabilities": ["Build"],
    "pros": ["Reliable"],
    "cons": [],
    "formats": ["Web"],
    "tier": "A",
    "product": "GitHub",
    "iconUrl": "https://github.com/favicon.ico"
  }
]
```

Optional fields: `alias`, `searchUrl`, `subsection`, `description`, `iconUrl`, `categories`, `capabilities`, `pros`, `cons`, `formats`, `tier`, and `product`.

## Development

```bash
pnpm install
pnpm dev
```

Other scripts:

```bash
pnpm build
pnpm lint
pnpm test
```

Production output is written to `dist/`.
