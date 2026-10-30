namespace NavigationSource

abbrev Result (α : Type) := Except Unit α

inductive Action where
  | requestCancellation
  | returnNormally
  | throwException
  deriving DecidableEq, Repr

/-- The recognized handler reads the native destination, then sameDocument,
and requests cancellation when the extracted decision returns true. -/
def action (decision : Bool → Bool) (destination : Result Unit)
    (sameDocument : Result Bool) : Action :=
  match destination with
  | .error _ => .throwException
  | .ok _ => match sameDocument with
    | .error _ => .throwException
    | .ok value => if decision value then .requestCancellation else .returnNormally

/-- Restricted installation semantics for the recognized source shape. Native
setup either registers exactly one listener and returns, or throws without
registering. Captures and native registration semantics are browser contracts.
`returnedNormally` records completion, not the JavaScript return value. -/
structure InstallState where
  installed : Bool
  registrations : Nat
structure InstallResult where
  state : InstallState
  returnedNormally : Bool

def install (state : InstallState) (native : Result Unit) : InstallResult :=
  if state.installed then ⟨state, true⟩
  else match native with
    | .error _ => ⟨state, false⟩
    | .ok _ => ⟨⟨true, state.registrations + 1⟩, true⟩

def valid (state : InstallState) : Prop :=
  match state.installed with
  | false => state.registrations = 0
  | true => state.registrations = 1

theorem install_preserves_valid (state : InstallState) (native : Result Unit)
    (h : valid state) : valid (install state native).state := by
  cases state with
  | mk installed registrations =>
    cases installed with
    | false =>
      cases native with
      | error _ => exact h
      | ok _ =>
        change registrations + 1 = 1
        change registrations = 0 at h
        rw [h]
    | true => exact h

theorem returned_normally_is_ready (state : InstallState) (native : Result Unit)
    (h : (install state native).returnedNormally = true) :
    (install state native).state.installed = true := by
  cases state with
  | mk installed registrations =>
    cases installed with
    | false =>
      cases native with
      | error _ => cases h
      | ok _ => rfl
    | true => rfl

theorem failure_is_unready (state : InstallState) (native : Result Unit)
    (h : (install state native).returnedNormally = false) :
    (install state native).state.installed = false := by
  cases state with
  | mk installed registrations =>
    cases installed with
    | false =>
      cases native with
      | error _ => rfl
      | ok _ => cases h
    | true => cases h

theorem normal_return_has_one_registration (state : InstallState)
    (native : Result Unit) (h : valid state)
    (returned : (install state native).returnedNormally = true) :
    (install state native).state.registrations = 1 := by
  have ready := returned_normally_is_ready state native returned
  have invariant := install_preserves_valid state native h
  unfold valid at invariant
  rw [ready] at invariant
  exact invariant

def runInstallations (state : InstallState) : List (Result Unit) → InstallState
  | [] => state
  | first :: rest => runInstallations (install state first).state rest

theorem run_preserves_valid (state : InstallState) (outcomes : List (Result Unit))
    (h : valid state) : valid (runInstallations state outcomes) := by
  induction outcomes generalizing state with
  | nil => exact h
  | cons first rest ih => exact ih _ (install_preserves_valid state first h)

theorem valid_bounds_registrations (state : InstallState) (h : valid state) :
    state.registrations ≤ 1 := by
  cases state with
  | mk installed registrations =>
    cases installed with
    | false =>
      change registrations = 0 at h
      rw [h]
      exact Nat.zero_le 1
    | true =>
      change registrations = 1 at h
      rw [h]
      exact Nat.le_refl 1

theorem arbitrarily_many_attempts_register_at_most_once (outcomes : List (Result Unit)) :
    (runInstallations ⟨false, 0⟩ outcomes).registrations ≤ 1 := by
  exact valid_bounds_registrations _ (run_preserves_valid _ outcomes rfl)

end NavigationSource
