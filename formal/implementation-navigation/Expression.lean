namespace NavigationSource

inductive Expr where
  | sameDocument
  | allowedRoute
  | neg (operand : Expr)
  | disjunction (left right : Expr)
  | conjunction (left right : Expr)

abbrev Result := Except Unit Bool

/-- Restricted primitive-Boolean expression semantics, including abrupt
completion and left-to-right short-circuit evaluation. -/
def eval (sameDocument allowedRoute : Result) : Expr → Result
  | .sameDocument => sameDocument
  | .allowedRoute => allowedRoute
  | .neg operand => do return !(← eval sameDocument allowedRoute operand)
  | .disjunction left right => do
      if ← eval sameDocument allowedRoute left then return true
      else eval sameDocument allowedRoute right
  | .conjunction left right => do
      if ← eval sameDocument allowedRoute left then eval sameDocument allowedRoute right
      else return false

inductive Action where
  | requestCancellation
  | returnNormally
  | throwException
  deriving DecidableEq, Repr

def action : Result → Action
  | .ok true => .requestCancellation
  | .ok false => .returnNormally
  | .error _ => .throwException

end NavigationSource
