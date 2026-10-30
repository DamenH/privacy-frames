---------------------------- MODULE Decision ----------------------------
EXTENDS Naturals
CONSTANT Fault
VARIABLES hashA, hashB, uniquePath, uniqueURL, hasEntry, decision
vars == <<hashA, hashB, uniquePath, uniqueURL, hasEntry, decision>>

Init == /\ hashA \in BOOLEAN /\ hashB \in BOOLEAN
        /\ uniquePath \in BOOLEAN /\ uniqueURL \in BOOLEAN /\ hasEntry \in BOOLEAN
        /\ decision = "pending"

Valid == hashA /\ hashB /\ uniquePath /\ uniqueURL /\ hasEntry
Accepts == (hashA \/ Fault = "hashA") /\ (hashB \/ Fault = "hashB")
           /\ (uniquePath \/ Fault \in {"path", "pathURL"})
           /\ (uniqueURL \/ Fault \in {"url", "pathURL"})
           /\ (hasEntry \/ Fault = "entry")
Decide == /\ decision = "pending"
          /\ decision' = IF Accepts THEN "accepted" ELSE "rejected"
          /\ UNCHANGED <<hashA, hashB, uniquePath, uniqueURL, hasEntry>>
Spec == Init /\ [][Decide]_vars
TypeOK == /\ hashA \in BOOLEAN /\ hashB \in BOOLEAN
          /\ uniquePath \in BOOLEAN /\ uniqueURL \in BOOLEAN /\ hasEntry \in BOOLEAN
          /\ decision \in {"pending", "accepted", "rejected"}
NoInvalidAdmission == decision = "accepted" => Valid
=============================================================================
