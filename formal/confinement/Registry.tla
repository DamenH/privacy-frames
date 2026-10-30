------------------------------ MODULE Registry ------------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS IgnoreClosure, ReviveClosed, WrongOwner
VARIABLES state, closedByOwner, closedByOther, badBind, badRevive, badClose
vars == <<state, closedByOwner, closedByOther, badBind, badRevive, badClose>>
Init == /\ state = "absent" /\ closedByOwner = FALSE /\ closedByOther = FALSE
        /\ badBind = FALSE /\ badRevive = FALSE /\ badClose = FALSE
Bind == /\ state = "absent" /\ (~closedByOwner \/ IgnoreClosure)
        /\ state' = "preparing" /\ badBind' = closedByOwner
        /\ UNCHANGED <<closedByOwner, closedByOther, badRevive, badClose>>
Ready == /\ state \in {"preparing", "ready"} \/ (ReviveClosed /\ state = "closed")
         /\ state' = "running" /\ badRevive' = (badRevive \/ (state = "closed"))
         /\ UNCHANGED <<closedByOwner, closedByOther, badBind, badClose>>
CloseOwner == /\ closedByOwner' = TRUE
              /\ state' = IF state = "absent" THEN "absent" ELSE "closed"
              /\ UNCHANGED <<closedByOther, badBind, badRevive, badClose>>
CloseOther == /\ IF state = "absent" THEN /\ closedByOther' = TRUE /\ UNCHANGED state
                ELSE IF WrongOwner /\ state # "closed" THEN
                  /\ state' = "closed" /\ UNCHANGED closedByOther
                ELSE /\ UNCHANGED <<state, closedByOther>>
              /\ badClose' = (badClose \/ (state # "absent" /\ WrongOwner /\ state # "closed"))
              /\ UNCHANGED <<closedByOwner, badBind, badRevive>>
TransitionReady == /\ state = "preparing" /\ state' = "ready"
                   /\ UNCHANGED <<closedByOwner, closedByOther, badBind, badRevive, badClose>>
TransitionRunning == /\ state = "ready" /\ state' = "running"
                     /\ UNCHANGED <<closedByOwner, closedByOther, badBind, badRevive, badClose>>
TransitionClosed == /\ state \in {"preparing", "ready", "running"} /\ state' = "closed"
                    /\ UNCHANGED <<closedByOwner, closedByOther, badBind, badRevive, badClose>>
Next == Bind \/ Ready \/ CloseOwner \/ CloseOther \/ TransitionReady \/ TransitionRunning \/ TransitionClosed
Spec == Init /\ [][Next]_vars
NoBoundAfterCloseRequest == ~badBind
NoRevival == ~badRevive
NoWrongOwnerClose == ~badClose
=============================================================================
