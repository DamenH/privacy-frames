import Lean

namespace CanonicalAdmission

/-- `allowed` stands for the canonical URL string passing the app-base check.
`seen` represents the previously accepted canonical strings. -/
def check (allowed : String → Bool) : List String → List String → Bool
  | _, [] => true
  | seen, target :: rest =>
      if allowed target && !(seen.contains target) then
        check allowed (target :: seen) rest
      else false

/-- A successful loop accepts only allowed targets and never repeats a target,
including one that appeared before the loop began. -/
theorem checked_properties (allowed : String → Bool) (seen targets : List String)
    (accepted : check allowed seen targets = true) :
    (∀ target ∈ targets, allowed target = true) ∧
    targets.Nodup ∧
    (∀ target ∈ targets, target ∉ seen) := by
  induction targets generalizing seen with
  | nil => simp
  | cons target rest ih =>
    simp only [check] at accepted
    split at accepted
    next guard =>
      have allowedTarget : allowed target = true := by
        have h := Bool.and_eq_true_iff.mp guard
        exact h.1
      have notSeen : target ∉ seen := by
        have h := Bool.and_eq_true_iff.mp guard
        simpa using h.2
      obtain ⟨restAllowed, restNodup, restDisjoint⟩ := ih (target :: seen) accepted
      constructor
      · intro item member
        simp only [List.mem_cons] at member
        rcases member with same | member
        · subst item; exact allowedTarget
        · exact restAllowed item member
      constructor
      · apply List.nodup_cons.mpr
        exact ⟨by intro member; exact restDisjoint target member (by simp), restNodup⟩
      · intro item member
        simp only [List.mem_cons] at member
        rcases member with same | member
        · subst item; exact notSeen
        · intro inSeen; exact restDisjoint item member (by simp [inSeen])
    next => simp at accepted

#print axioms CanonicalAdmission.checked_properties
end CanonicalAdmission
