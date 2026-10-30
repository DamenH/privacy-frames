--------------------------- MODULE Confinement ---------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Contexts, EarlyPublish, ExposeAuthority, NetworkFallback, UnmediatedEffect
VARIABLES phase, ran, authority, network
vars == <<phase, ran, authority, network>>

Init == /\ phase = [c \in Contexts |-> "absent"]
        /\ ran = {}
        /\ authority = {}
        /\ network = FALSE

Create(c) == /\ phase[c] = "absent"
             /\ phase' = [phase EXCEPT ![c] = "preparing"]
             /\ UNCHANGED <<ran, authority, network>>
Prepare(c) == /\ phase[c] = "preparing"
              /\ phase' = [phase EXCEPT ![c] = "prepared"]
              /\ UNCHANGED <<ran, authority, network>>
Publish(c) == /\ phase[c] = "prepared" \/ (EarlyPublish /\ phase[c] = "preparing")
              /\ phase' = [phase EXCEPT ![c] = IF phase[c] = "prepared" THEN "published" ELSE "exposed"]
              /\ UNCHANGED <<ran, authority, network>>
Run(c) == /\ phase[c] \in {"published", "exposed"}
          /\ ran' = ran \cup {c}
          /\ UNCHANGED <<phase, authority, network>>
LeakAuthority(c) == /\ ExposeAuthority /\ c \in ran
                    /\ authority' = authority \cup {c}
                    /\ UNCHANGED <<phase, ran, network>>
RemoteEffect(c) == /\ c \in ran
                   /\ (phase[c] = "exposed" \/ c \in authority \/ UnmediatedEffect)
                   /\ network' = TRUE
                   /\ UNCHANGED <<phase, ran, authority>>
ControllerFallback(c) == /\ NetworkFallback /\ c \in ran
                         /\ network' = TRUE
                         /\ UNCHANGED <<phase, ran, authority>>
Next == \E c \in Contexts : Create(c) \/ Prepare(c) \/ Publish(c) \/ Run(c)
                              \/ LeakAuthority(c) \/ RemoteEffect(c) \/ ControllerFallback(c)
Spec == Init /\ [][Next]_vars
PreparedBeforeRun == \A c \in ran : phase[c] = "published"
PreparedBeforePublication == \A c \in Contexts : phase[c] # "exposed"
NoTrustedAuthority == authority = {}
NoNetworkDisclosure == ~network
=============================================================================
