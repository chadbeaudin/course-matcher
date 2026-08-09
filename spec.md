# course-matcher

## Problem

Given a GPX file for a race you're planning to do (pulled from Ride with GPS), generate a route local to you that has a similar distance and elevation profile — so you can train on something that actually resembles race day, without traveling to the race location.

Existing tools don't do this:
- **Gainiac** (iOS) only compares/overlays *existing* routes against a race profile — it doesn't generate new ones.
- **RWGPS Explore** only filters existing routes by min/max distance and elevation gain — no profile-shape matching, no generation.
- **Strava Matched Rides** only detects exact repeats of a route you've already ridden.

The gap: GPX in → a brand-new, algorithmically generated route out, matching both distance and the *shape* of the elevation profile (not just totals).

## Platform & stack

- Web app, Next.js (TypeScript), matching existing stack conventions.
- No user accounts / auth required for MVP — stateless, single-session tool.

## Core user flow

1. User uploads a GPX file for the race they're training for (exported from RWGPS).
2. User sets a starting location — pin on a map, or "use my location" (browser geolocation).
3. User selects:
   - Activity type: cycling or running
   - Route shape: loop, out-and-back, or point-to-point
   - Surface preference: road, gravel, or trail (default inferred from race GPX, user can override)
4. App generates and returns multiple candidate routes (ranked, e.g. top 3–5) near the start location, each with:
   - Total distance
   - Total elevation gain
   - A similarity score vs. the race route
   - Elevation profile preview (chart) next to the race's, for visual comparison
5. User picks a candidate, previews on a map, downloads as GPX.

## Matching definition

Not just totals — climb *distribution* matters:

- **Distance**: match within a configurable tolerance (e.g. ±5%).
- **Total elevation gain**: match within a configurable tolerance (e.g. ±10%).
- **Profile shape**: characterize the race's elevation profile (e.g. climb segmentation — number/length/grade of major climbs, rolling vs. one-big-climb) and score candidates on how closely they reproduce that shape, not just hit the same totals.
  - v1 approach: bucket the race GPX into climb segments (grade + length), compute a shape signature, and score candidate routes against that signature.

## Route generation (core algorithm)

This is the hard technical part — not just filtering existing routes, but generating new ones.

**Approach**: reuse the routing infrastructure already built for [StreetSweep](../StreetSweep) rather than a hosted routing API.

- **Road/trail network**: public Overpass API (`overpass-api.de`) for OSM data, via an in-memory tile-snapped cache in `lib/overpass.ts`. The original plan was to reuse StreetSweep's self-hosted instance (`overpass.bigtimber.cloud`, on the user's unRAID box) — switched to the public instance while that box is re-indexing OSM data for North America. `OVERPASS_URL` is a plain env var, so swapping back once the self-hosted instance is ready is a one-line change (both locally and in Vercel's project settings).
- **Graph & pathfinding**: build an `ngraph.graph` from the Overpass data and use `ngraph.path` (A*) for point-to-point routing, following the pattern in `StreetSweep/lib/graph.ts` (`StreetGraph`). course-matcher's need is simpler than StreetSweep's Chinese Postman solver — just shortest/candidate paths between generated waypoints, not full street coverage.
- **Elevation**: reuse the multi-provider fallback from `StreetSweep/lib/elevation.ts` — Open Topo Data (primary) → Open-Meteo (batched fallback).
- **Cache/persistence**: StreetSweep runs its own Postgres on the same unRAID box (`192.168.1.138:5435`, not Neon) for the `osm_cache` table. course-matcher can reuse this instance — either sharing the `osm_cache` table directly (same Overpass source data, avoids duplicate tile fetches) or a separate schema/database on the same server. Decide during implementation.

**Generation loop**:
1. Pick candidate waypoints at varying bearings/radii from the start point (radius derived from target distance).
2. Route between waypoints via the local road graph (A*) to get an actual rideable/runnable path.
3. Compute real distance + elevation gain from the routed path.
4. Score each candidate against the race's distance, elevation gain, and profile-shape signature.
5. Iterate (adjust waypoint radius/bearing) to converge toward better-scoring candidates — a constrained search problem, not a closed-form calculation. Start with simple randomized search; consider simulated annealing if quality isn't good enough.
6. Return the top N distinct candidates.

**Open technical questions to resolve during implementation:**
- Share Postgres `osm_cache` table with StreetSweep, or separate schema on the same unRAID Postgres instance?
- Search strategy specifics (randomized search vs. simulated annealing vs. genetic algorithm) — start simple, iterate.
- Surface/trail tagging: how to filter Overpass way data by road/gravel/trail from OSM tags for the user-selectable surface preference.

## RWGPS integration

Phased:

- **Phase 1 (MVP)**: manual GPX import/export only. No RWGPS API. User exports their race route as GPX from RWGPS and uploads it; generated route is downloaded as GPX for the user to import back into RWGPS manually.
- **Phase 2**: full round-trip via RWGPS API — authenticate, pull the race route directly by RWGPS URL/ID (skip manual export), and push the chosen generated route directly into the user's RWGPS account (skip manual import).

## Output

- Interactive map preview of each candidate route.
- Elevation profile chart, shown alongside the race's for visual comparison.
- GPX download.
- (Phase 2) Direct push to RWGPS account.

## MVP scope

- Single-session, no accounts.
- Cycling and running both supported, user-selectable.
- Loop / out-and-back / point-to-point, user-selectable.
- Road / gravel / trail, user-selectable (default inferred from race GPX).
- Matching on distance + elevation gain + climb-shape signature.
- Multiple ranked candidates returned.
- GPX import (race) and GPX export (generated route).

## Stretch goals (post-MVP)

- RWGPS API round-trip (pull race route by link, push generated route to account).
- Saved history of past race/training route pairs (would require accounts).
- Support for multiple race GPX inputs (e.g. combine profile targets across a race series).

## Open questions

- Tolerance defaults for distance/elevation matching — configurable by user or fixed?
- Any hosting/budget constraints for map tiles (routing/elevation now covered by reused self-hosted infra, see above)?
