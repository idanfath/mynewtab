# MyNewTab

Personal new-tab page built with React, TypeScript, Vite, Tailwind CSS, and Monaco Editor.

## Features

- Flat JSON bookmark data with validation.
- Import, export, and edit bookmarks in the browser.
- Local persistence through `localStorage`.
- Fuzzy search across titles, sections, categories, capabilities, and notes.
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

Optional fields: `subsection`, `description`, `iconUrl`, `categories`, `capabilities`, `pros`, `cons`, `formats`, `tier`, and `product`.

## Development

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build
npm run lint
npm test
```

Production output is written to `dist/`.
