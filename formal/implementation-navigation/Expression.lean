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

end NavigationSource
