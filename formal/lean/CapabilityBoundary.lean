/-!
A conditional, unbounded model of the authority boundary. This is not a model
of JavaScript, the DOM, service workers, or the browser. Its transition rules
are assumptions to be connected to those systems by separate evidence.
-/

namespace PrivacyFrames

inductive Capability where
  | local
  | network
  deriving DecidableEq, Repr

structure State where
  held : Capability → Prop
  sent : Bool

def Safe (state : State) : Prop :=
  ¬ state.held .network ∧ state.sent = false

def initial : State := ⟨fun cap => cap = .local, false⟩

/- An untrusted application may receive a local capability, reuse what it has,
   and attempt a network effect. The host must reject attempts to grant the
   native network authority. Reuse cannot create a capability it did not hold. -/
inductive Step : State → State → Prop where
  | grantLocal (s : State) :
      Step s ⟨fun cap => s.held cap ∨ cap = .local, s.sent⟩
  | reuse (s : State) (cap : Capability) :
      s.held cap → Step s s
  | send (s : State) :
      s.held .network → Step s ⟨s.held, true⟩

inductive Reachable : State → Prop where
  | start : Reachable initial
  | next {before after} : Reachable before → Step before after → Reachable after

theorem initial_safe : Safe initial := by
  constructor
  · intro impossible
    cases impossible
  · rfl

theorem step_preserves_safe {before after : State}
    (safe : Safe before) (step : Step before after) : Safe after := by
  cases step with
  | grantLocal =>
      constructor
      · intro held
        cases held with
        | inl already => exact safe.1 already
        | inr impossible => cases impossible
      · exact safe.2
  | reuse cap held => exact safe
  | send held => exact False.elim (safe.1 held)

theorem reachable_safe {state : State} (run : Reachable state) : Safe state := by
  induction run with
  | start => exact initial_safe
  | next _ step inductionHypothesis =>
      exact step_preserves_safe inductionHypothesis step

theorem no_remote_effect {state : State} (run : Reachable state) : state.sent = false :=
  (reachable_safe run).2

/- Fault control: an unrestricted grant makes the desired guarantee false. -/
inductive BrokenStep : State → State → Prop where
  | grantNetwork (s : State) :
      BrokenStep s ⟨fun cap => s.held cap ∨ cap = .network, s.sent⟩
  | send (s : State) :
      s.held .network → BrokenStep s ⟨s.held, true⟩

theorem unsafe_grant_has_counterexample :
    ∃ middle finish, BrokenStep initial middle ∧ BrokenStep middle finish ∧
      finish.sent = true := by
  let middle : State := ⟨fun cap => initial.held cap ∨ cap = .network, false⟩
  let finish : State := ⟨middle.held, true⟩
  refine ⟨middle, finish, ?_, ?_, rfl⟩
  · exact BrokenStep.grantNetwork initial
  · apply BrokenStep.send middle
    exact Or.inr rfl

#print axioms no_remote_effect
#print axioms unsafe_grant_has_counterexample

end PrivacyFrames
