------------------------------ MODULE Registry ------------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS IgnoreClosure, ReviveClosed, WrongOwner
VARIABLES state, closedByOwner, closedByOther, badBind, badRevive, badClose
vars == <<state, closedByOwner, closedByOther, badBind, badRevive, badClose>>
Init == /\ state = "absent" /\ closedByOwner = FALSE /\ closedByOther = FALSE
        /\ badBind = FALSE /\ badRevive = FALSE /\ badClose = FALSE
Bind == /\ state = "absent" /\ (~closedByOwner \/ IgnoreClosure)
        /\ state' = "bound" /\ badBind' = closedByOwner
        /\ UNCHANGED <<closedByOwner, closedByOther, badRevive, badClose>>
\* Live phase labels are bookkeeping, not authority or guard preparation.
\* Revalidate represents an authority check after asynchronous work. The fault
\* accepts a closed binding without reviving or rewriting its stored phase.
Revalidate == /\ state = "bound" \/ (ReviveClosed /\ state = "closed")
              /\ badRevive' = (badRevive \/ (state = "closed"))
              /\ UNCHANGED <<state, closedByOwner, closedByOther, badBind, badClose>>
\* Atomic abstract completion, not enqueueing a close request. Local queue
\* ordering and other controller instances require separate implementation tests.
CloseOwner == /\ closedByOwner' = TRUE
              /\ state' = IF state = "absent" THEN "absent" ELSE "closed"
              /\ UNCHANGED <<closedByOther, badBind, badRevive, badClose>>
CloseOther == /\ IF state = "absent" THEN /\ closedByOther' = TRUE /\ UNCHANGED state
                ELSE IF WrongOwner /\ state # "closed" THEN
                  /\ state' = "closed" /\ UNCHANGED closedByOther
                ELSE /\ UNCHANGED <<state, closedByOther>>
              /\ badClose' = (badClose \/ (state # "absent" /\ WrongOwner /\ state # "closed"))
              /\ UNCHANGED <<closedByOwner, badBind, badRevive>>
Next == Bind \/ Revalidate \/ CloseOwner \/ CloseOther
Spec == Init /\ [][Next]_vars
NoBoundAfterCloseRequest == ~badBind
NoRevival == ~badRevive
NoWrongOwnerClose == ~badClose
=============================================================================
