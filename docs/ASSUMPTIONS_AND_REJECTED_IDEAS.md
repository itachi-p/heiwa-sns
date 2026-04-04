# Assumptions and Rejected Ideas

## Current Assumptions

- Primary language is Japanese for now.
- Product quality and trust matter more than short-term growth.
- Authentication and moderation can evolve incrementally.
- Data model should remain simple in early stages.

## Rejected (for now)

### Public score-style indicators

- Like counts, follower counts, and similar metrics are intentionally hidden.

### Account-level trust scoring

- Numeric user scoring is avoided to reduce labeling and pressure.

### Popularity-first ranking

- "Trending" style ranking is out of scope for current philosophy.

### Ad-optimization-first design

- Engagement maximization loops are intentionally not a target.

## Open Questions

- How to communicate safety actions transparently without increasing fear?
- What minimal feedback is needed so users understand content visibility changes?
- Which moderation signals should remain private vs. explainable to users?
- **Stricter threshold for replies only** (e.g. 0.5 vs timeline 0.7) and **separate filter settings for timeline vs replies**: deferred; same `toxicity_filter_level` for both today. See [DECISIONS.md](DECISIONS.md) (2026-04-02, reply-threshold section).
