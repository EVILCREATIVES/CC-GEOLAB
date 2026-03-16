# CC-GEOLAB

Cesium-based 3D drone-style viewer for KMZ/KML geological data, with an integrated Gemini consultation panel.

## Stack

- Next.js (App Router, TypeScript)
- CesiumJS 1.120 loaded from CDN
- JSZip for Safari-safe KMZ extraction
- Server-side Gemini API route using `GOOGLE_API_KEY`

## Local Development

1. Install dependencies:

	```bash
	npm install
	```

2. Create your environment file:

	```bash
	cp .env.example .env.local
	```

3. Set variables in `.env.local`:

	- `GOOGLE_API_KEY=...` (required for the consultation panel)
	- `NEXT_PUBLIC_CESIUM_ION_TOKEN=...` (optional but recommended for Cesium terrain/assets)

4. Start dev server:

	```bash
	npm run dev
	```

5. Open http://localhost:3000

## Vercel Deployment

1. Push this repository to GitHub.
2. Import the project in Vercel.
3. In Vercel project settings, add Environment Variables:

	- `GOOGLE_API_KEY`
	- `NEXT_PUBLIC_CESIUM_ION_TOKEN` (optional)

4. Deploy.

The app route `/api/gemini` calls:

- `gemini-3.1-pro-preview` via Google Generative Language API

## Notes

- The Gemini key is never exposed to the browser; requests go through the server route.
- Upload `.kml` or `.kmz` files in the toolbar.
- The Cesium viewer supports folder-based styling, filtering, and drone-style controls.
