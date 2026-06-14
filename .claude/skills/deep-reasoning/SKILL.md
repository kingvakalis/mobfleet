---
name: deep-reasoning
description: Use for hard, ambiguous, or high-stakes problems — non-obvious tradeoffs, subtle bugs, architecture/design decisions, conflicting requirements, or anything where a quick answer is likely wrong. Apply to decompose, reason from evidence, consider alternatives, and self-verify before committing.
---

# Deep Reasoning

Think rigorously on the problems that punish shallow answers — decompose, weigh
alternatives, and verify before acting.

## When to engage
The stakes or ambiguity are high, the obvious answer feels too easy, there are
competing constraints, or a mistake is expensive/hard to reverse. (For trivial
or already-verified work, don't over-think — just act.)

## Method
1. **Restate the real problem.** Separate the actual goal from the literal
   request; surface hidden constraints and assumptions. Define what "correct"
   means here and how you'd recognize it.
2. **Gather evidence first.** Read the actual code/data/spec before theorizing.
   Reason from what's there, not from what's usually there.
3. **Decompose.** Break into independent sub-problems; solve the load-bearing
   one first. Name the crux the answer hinges on.
4. **Generate alternatives.** Produce 2–3 genuinely different approaches; state
   each one's tradeoffs (correctness, complexity, reversibility, cost). Don't
   anchor on the first idea.
5. **Stress-test (adversarial).** Try to break your own answer: edge cases,
   failure modes, "what would make this wrong?", who/what does it harm. Prefer
   evidence that could falsify the conclusion.
6. **Decide & justify.** Recommend one path with the reason it wins; note what
   would change the decision.
7. **Verify the output**, don't just produce it: re-read against the goal,
   check the claims you're about to make are actually true (run it, test it,
   cite the file).

## Calibration
- Distinguish what you know (verified), infer (reasoned), and assume (unverified)
  — and label assumptions.
- Quantify uncertainty; if a fact is load-bearing, go confirm it rather than
  guess.
- Watch biases: confirmation (seeking only supporting evidence), anchoring
  (first idea), sunk cost (defending a prior approach).

## Anti-patterns
- Pattern-matching to a familiar solution without checking it fits this case.
- Confident prose over a shaky premise; fluent answers that were never verified.
- Re-deriving settled facts or re-litigating a made decision instead of acting.
- Analysis paralysis on reversible, low-stakes choices.

## Definition of done
The crux is identified; alternatives were weighed; the chosen answer survived an
honest attempt to break it; load-bearing claims are verified; assumptions and
the decision's failure conditions are stated.
