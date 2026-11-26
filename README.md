# MyNewTab

Personal new-tab page built with React, TypeScript, Vite, Tailwind CSS, and Monaco Editor.

## Features

- Flat JSON bookmark data with validation.
- Import, export, and edit bookmarks in the browser.
- Add, edit, delete, and restore individual bookmarks without editing JSON.
- Rename sections or remove them by moving or deleting their bookmarks.
- Drop browser links into a section, or anywhere to use `Uncategorized`.
- Local persistence through `localStorage`.
- Fuzzy search across titles, sections, categories, capabilities, and notes.
- Unified omnibar (`/`) supporting `!bang` shortcuts, bookmark site search, direct URL/localhost navigation, and web search (`Tab` to autocomplete `!bang`, `Shift+Enter` to search web directly).
- Configurable default search engine presets, per-built-in `!bang` toggles, and custom `!bang` triggers persisted locally in `localStorage`.
- Drag-and-drop section ordering.
- Bundled background and app icon assets with production caching on Vercel.

## Bookmark format

Bookmarks are stored as a JSON array. `title`, `url`, and `section` are required; other fields are optional.

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
