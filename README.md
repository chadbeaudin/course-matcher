# course-matcher

Upload the GPX file for a race you're training for, and course-matcher generates a route near you that matches its distance and elevation gain — so you can train on something that actually resembles race day, without traveling to the race location.

**Live:** [race-course-matcher.vercel.app](https://race-course-matcher.vercel.app/)

## How it works

1. Upload your race's GPX file to see its distance, elevation gain, and elevation profile.
2. Set a start location — click the map or use your current location. Optionally set how far you're willing to ride before the matched course starts, to get out of a city and into open roads first.
3. Generate candidate routes near that start point, built from real roads (OpenStreetMap) and scored against your race's distance and elevation gain.
4. Compare candidates on the map and elevation profile, pick the one you like.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Leaflet / React Leaflet for maps
- Recharts for elevation profiles
- [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) for OSM road data
- `ngraph.graph` / `ngraph.path` for the road network graph and A* pathfinding
- Elevation via [Open Topo Data](https://www.opentopodata.org/) (primary) and [Open-Meteo](https://open-meteo.com/) (fallback)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3889](http://localhost:3889).

Set `OVERPASS_URL` in `.env.local` to point at an Overpass API instance. Defaults to the public `https://overpass-api.de/api/interpreter` if unset — that's what production currently uses too, while a self-hosted instance finishes indexing.

Live at [race-course-matcher.vercel.app](https://race-course-matcher.vercel.app/).

## Scripts

- `npm run dev` — dev server on port 3889
- `npm run build` / `npm start` — production build / serve
- `npm run lint`
- `npm test` — unit and integration tests (Jest)

## Design notes

See [spec.md](spec.md) for the original product spec and open design questions.
