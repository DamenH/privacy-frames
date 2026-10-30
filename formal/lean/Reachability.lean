/-!
An unbounded authority-graph argument. The browser/runtime correspondence is a
separate obligation: this file does not claim to model JavaScript or the DOM.
-/

namespace PrivacyFrames.Graph

variable {Node : Type}

structure Boundary (Node : Type) where
  edge : Node → Node → Prop
  allowed : Node → Prop
  network : Node → Prop

inductive Reach (boundary : Boundary Node) (start : Node) : Node → Prop where
  | self : Reach boundary start start
  | next {source target} :
      Reach boundary start source → boundary.edge source target →
        Reach boundary start target

def Closed (boundary : Boundary Node) : Prop :=
  ∀ source target, boundary.allowed source → boundary.edge source target →
    boundary.allowed target

def NoNetworkAuthority (boundary : Boundary Node) : Prop :=
  ∀ target, boundary.allowed target → ¬ boundary.network target

theorem reachable_is_allowed (boundary : Boundary Node) (start : Node)
    (rootAllowed : boundary.allowed start) (closed : Closed boundary)
    {target : Node} (path : Reach boundary start target) : boundary.allowed target := by
  induction path with
  | self => exact rootAllowed
  | next _ edge inductionHypothesis => exact closed _ _ inductionHypothesis edge

theorem reachable_cannot_use_network (boundary : Boundary Node) (start : Node)
    (rootAllowed : boundary.allowed start) (closed : Closed boundary)
    (noNetwork : NoNetworkAuthority boundary) {target : Node}
    (path : Reach boundary start target) : ¬ boundary.network target :=
  noNetwork target (reachable_is_allowed boundary start rootAllowed closed path)

/- In a dynamic environment the trusted operation that adds an edge must
   check its target whenever its source is reachable within the allowed set. -/
def Valid (boundary : Boundary Node) (start : Node) : Prop :=
  boundary.allowed start ∧ Closed boundary ∧ NoNetworkAuthority boundary

def addEdge (boundary : Boundary Node) (source target : Node) : Boundary Node :=
  { boundary with edge := fun origin destination =>
      boundary.edge origin destination ∨ (origin = source ∧ destination = target) }

inductive Evolution (start : Node) : Boundary Node → Boundary Node → Prop where
  | stay (current : Boundary Node) : Evolution start current current
  | add (current : Boundary Node) (source target : Node) :
      (current.allowed source → current.allowed target) →
        Evolution start current (addEdge current source target)

theorem add_preserves_valid (start : Node) (current : Boundary Node)
    (valid : Valid current start) (source target : Node)
    (checked : current.allowed source → current.allowed target) :
    Valid (addEdge current source target) start := by
  refine ⟨valid.1, ?_, valid.2.2⟩
  intro origin destination allowedFrom edge
  cases edge with
  | inl oldEdge => exact valid.2.1 origin destination allowedFrom oldEdge
  | inr added =>
      rcases added with ⟨rfl, rfl⟩
      exact checked allowedFrom

inductive History (start : Node) (initial : Boundary Node) : Boundary Node → Prop where
  | initial : History start initial initial
  | next {before after} :
      History start initial before → Evolution start before after →
        History start initial after

theorem history_preserves_valid (start : Node) (initial : Boundary Node)
    (initialValid : Valid initial start) {current : Boundary Node}
    (history : History start initial current) : Valid current start := by
  induction history with
  | initial => exact initialValid
  | next _ transition inductionHypothesis =>
      cases transition with
      | stay => exact inductionHypothesis
      | add source target checked =>
          exact add_preserves_valid start _ inductionHypothesis source target checked

theorem no_network_along_history (start : Node) (initial : Boundary Node)
    (initialValid : Valid initial start) {current : Boundary Node}
    (history : History start initial current) {target : Node}
    (path : Reach current start target) : ¬ current.network target := by
  have valid := history_preserves_valid start initial initialValid history
  exact reachable_cannot_use_network current start valid.1 valid.2.1 valid.2.2 path

/- Fault control: a seemingly local intermediate object exposes a network
   authority. A direct-only scan of the app's first reference misses the path. -/
inductive ExampleNode where
  | app | intermediate | socket
  deriving DecidableEq

def brokenBoundary : Boundary ExampleNode where
  edge source target :=
    (source = .app ∧ target = .intermediate) ∨
    (source = .intermediate ∧ target = .socket)
  allowed node := node = .app ∨ node = .intermediate
  network node := node = .socket

theorem broken_multistep_reaches_network :
    Reach brokenBoundary .app .socket ∧ brokenBoundary.network .socket := by
  constructor
  · apply Reach.next (Reach.next Reach.self (Or.inl ⟨rfl, rfl⟩))
    exact Or.inr ⟨rfl, rfl⟩
  · rfl

theorem broken_multistep_violates_closure : ¬ Closed brokenBoundary := by
  intro closed
  have impossible : brokenBoundary.allowed .socket :=
    closed .intermediate .socket (Or.inr rfl) (Or.inr ⟨rfl, rfl⟩)
  cases impossible with
  | inl bad => cases bad
  | inr bad => cases bad

#print axioms reachable_cannot_use_network
#print axioms no_network_along_history
#print axioms broken_multistep_reaches_network
#print axioms broken_multistep_violates_closure

end PrivacyFrames.Graph
