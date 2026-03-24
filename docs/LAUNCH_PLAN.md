# Launch Plan (Minimal)

## Scope of this document

This file is a practical checklist for the first public rollout.
It does not redefine product principles. It focuses on readiness.

## 1) Product readiness

- [ ] New user can sign up and log in without dead ends.
- [ ] Nickname onboarding blocks access until complete.
- [ ] Create post / list posts / delete own post work reliably.
- [ ] Multi-line text rendering and URL links behave correctly.
- [ ] Error messages are understandable in Japanese.

## 2) Safety and policy readiness

- [ ] RLS and table permissions are verified in production.
- [ ] Basic abuse-handling policy is documented (even if minimal).
- [ ] Clear statement of non-goals is public (no visible score metrics).
- [ ] Known limitations are disclosed in README or docs.

## 3) Operational readiness

- [ ] Production env vars and OAuth redirect URLs are correct.
- [ ] PWA manifest/icons are final and install flow tested.
- [ ] Monitoring path exists (logs, error capture, quick rollback).
- [ ] Backup/export procedure for critical data is defined.

## 4) Pilot launch strategy (recommended)

- [ ] Start with a small invite-only cohort (10-30 users).
- [ ] Collect weekly feedback with fixed questions.
- [ ] Record findings in `docs/DECISIONS.md`.
- [ ] Apply one improvement batch per cycle (avoid overreaction).

## 5) Success criteria for early phase

- [ ] Users report "safe to post" sentiment.
- [ ] Return usage exists after first session.
- [ ] Harmful interaction patterns are rare and containable.
- [ ] Team can explain every major product decision.

## 6) Stop/hold criteria

- [ ] Repeated auth failures or onboarding confusion.
- [ ] Moderation load exceeds current handling capacity.
- [ ] Core principle conflicts are observed in actual behavior.

If any hold criterion is triggered, pause expansion and fix fundamentals first.
