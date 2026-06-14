---
name: debugging
description: Use when something is broken, flaky, throwing, or behaving unexpectedly — runtime errors, failed builds/tests, wrong output, race conditions, "it worked before". Apply a disciplined reproduce → isolate → root-cause → fix → verify loop instead of guess-and-check.
---

# Debugging

Find the true root cause, fix that, and prove it — don't paper over symptoms.

## Mindset
- A bug is a gap between your mental model and reality. The fastest fix is
  correcting the model with evidence, not trying random changes.
- Before changing system state (restart, delete, config edit), confirm the
  evidence actually supports that specific action. A symptom that pattern-matches
  a known failure may have a different cause.

## The loop
1. **Reproduce** reliably. Find the smallest input/steps that trigger it. A bug
   you can't reproduce, you can't confirm fixed.
2. **Read the actual error.** Full message, stack trace, file:line. Don't skim.
3. **Isolate.** Bisect: which commit, which file, which line, which input?
   Comment out / binary-search / `git bisect`. Add targeted logging at the
   boundary between "correct" and "wrong".
4. **Form one hypothesis** about the root cause and predict what you'd see if
   it's true; test that prediction.
5. **Fix the cause, not the symptom.** Ask "why did this happen, and why didn't
   anything catch it?" — fix both where reasonable.
6. **Verify.** Re-run the exact repro; run the broader test/build; check you
   didn't break neighbors.
7. **Prevent regression.** Add a test that fails before the fix and passes after.

## Techniques
- Trust the stack trace's top app frame; work outward.
- Diff against last-known-good (git) to localize a regression.
- Check assumptions explicitly: log the value you *think* is true.
- For races/timing: add ordering/await guards; reproduce with artificial delay.
- For "works locally, not in prod": compare env, build mode, data, timing.
- Reduce to a minimal failing case — it usually reveals the cause outright.

## Anti-patterns
- Shotgun edits hoping something sticks; changing multiple things at once so you
  can't tell what fixed it.
- Swallowing errors / try-catch-ignore to make a symptom disappear.
- "Fixing" by adding a sleep/retry without understanding the race.
- Declaring it fixed without reproducing the original failure.

## Definition of done
Root cause named in plain language; minimal fix applied; original repro now
passes; broader tests/build green; a regression test guards it.
