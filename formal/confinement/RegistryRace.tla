--------------------------- MODULE RegistryRace ---------------------------
EXTENDS FiniteSets, Naturals

CONSTANT Actors
VARIABLES stage, current, indexed, succeeded
vars == <<stage, current, indexed, succeeded>>

Init == /\ stage = [a \in Actors |-> "initial"]
        /\ current = "none"
        /\ indexed = {}
        /\ succeeded = {}

\* Each independent registry checks an empty client before either writes.
Check(a) == /\ stage[a] = "initial" /\ current = "none"
            /\ stage' = [stage EXCEPT ![a] = "checked"]
            /\ UNCHANGED <<current, indexed, succeeded>>

\* A successful put updates the client record and its context index. We collapse
\* the two cache writes here; the implementation-level test covers this schedule.
Write(a) == /\ stage[a] = "checked"
            /\ stage' = [stage EXCEPT ![a] = "finished"]
            /\ current' = a /\ indexed' = indexed \cup {a}
            /\ succeeded' = succeeded \cup {a}

Next == \E a \in Actors: Check(a) \/ Write(a)
Spec == Init /\ [][Next]_vars

\* This desirable uniqueness assertion is intentionally false in this model.
UniqueSuccessfulBinding == Cardinality(succeeded) <= 1
TypeOK == /\ stage \in [Actors -> {"initial", "checked", "finished"}]
          /\ current \in Actors \cup {"none"}
          /\ indexed \subseteq Actors /\ succeeded \subseteq Actors
=============================================================================
