namespace PublicationModel

/-- The generation is a per-record ghost name, not a JavaScript number.
The JavaScript emitter allocates objects; its heap contract is checked separately. -/
structure State where
  generation : Nat
  started : Bool
  ready : Bool
  published : Bool
  loaded : Bool
  deriving Repr

inductive Field where
  | started | ready | published | loaded

inductive Instruction where
  | fresh
  | write (field : Field) (value : Bool)
  | returnFresh

structure Evaluation where
  state : State
  temporary : Option Nat
  returned : Option Nat

def setField (state : State) (field : Field) (value : Bool) : State :=
  match field with
  | .started => { state with started := value }
  | .ready => { state with ready := value }
  | .published => { state with published := value }
  | .loaded => { state with loaded := value }

def instruction (evaluation : Evaluation) : Instruction → Evaluation
  | .fresh =>
    let generation := evaluation.state.generation + 1
    { evaluation with
      state := { evaluation.state with generation := generation }
      temporary := some generation }
  | .write field value =>
    { evaluation with state := setField evaluation.state field value }
  | .returnFresh => { evaluation with returned := evaluation.temporary }

def execute (program : List Instruction) (state : State) : Evaluation :=
  program.foldl instruction ⟨state, none, none⟩

def cancelProgram : List Instruction :=
  [.fresh, .write .ready false, .write .started false,
    .write .published false, .write .loaded false]

def beginProgram : List Instruction :=
  [.fresh, .write .started true, .write .loaded false, .returnFresh]

theorem cancel_correct (state : State) :
    (execute cancelProgram state).state =
      ⟨state.generation + 1, false, false, false, false⟩ := by rfl

theorem cancel_returns_nothing (state : State) :
    (execute cancelProgram state).returned = none := by rfl

theorem begin_correct (state : State) :
    (execute beginProgram state).state =
      { state with
        generation := state.generation + 1
        started := true
        loaded := false } := by rfl

theorem begin_returns_generation (state : State) :
    (execute beginProgram state).returned = some (state.generation + 1) := by rfl

theorem cancel_advances (state : State) :
    state.generation < (execute cancelProgram state).state.generation := by
  exact Nat.lt_succ_self state.generation

theorem begin_advances (state : State) :
    state.generation < (execute beginProgram state).state.generation := by
  exact Nat.lt_succ_self state.generation

inductive Event where
  | begin | cancel

def program : Event → List Instruction
  | .begin => beginProgram
  | .cancel => cancelProgram

def run (state : State) : List Event → State
  | [] => state
  | first :: rest => run (execute (program first) state).state rest

theorem step_generation (event : Event) (state : State) :
    (execute (program event) state).state.generation = state.generation + 1 := by
  cases event <;> rfl

theorem arbitrary_sequence_generation (state : State) (events : List Event) :
    (run state events).generation = state.generation + events.length := by
  induction events generalizing state with
  | nil => rfl
  | cons first rest ih =>
    change (run (execute (program first) state).state rest).generation =
      state.generation + (rest.length + 1)
    rw [ih, step_generation]
    calc
      (state.generation + 1) + rest.length =
          state.generation + (1 + rest.length) := Nat.add_assoc _ _ _
      _ = state.generation + (rest.length + 1) :=
        congrArg (fun value => state.generation + value) (Nat.add_comm _ _)

def fieldName : Field → String
  | .started => "started"
  | .ready => "ready"
  | .published => "published"
  | .loaded => "loaded"

/-- This emitter is not proved to implement JavaScript semantics. Its output is
independently checked with the same JavaScript contracts as the production code. -/
def render : Instruction → String
  | .fresh => "  var generation = {};\n  state.generation = generation;"
  | .write field value =>
    "  state." ++ fieldName field ++ " = " ++ (if value then "true" else "false") ++ ";"
  | .returnFresh => "  return generation;"

def emitFunction (name : String) (instructions : List Instruction) : String :=
  "function " ++ name ++ "(state) {\n" ++
    String.intercalate "\n" (instructions.map render) ++ "\n}\n"

def generated : String :=
  emitFunction "cancelDocumentPublication" cancelProgram ++
  emitFunction "beginDocumentPublication" beginProgram

end PublicationModel

def main : IO Unit := IO.print PublicationModel.generated
