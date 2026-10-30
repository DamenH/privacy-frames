---------------------------- MODULE Lifecycle ----------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Contexts, Root, EarlyPublish, ExposeAuthority, NetworkFallback,
          UnmediatedEffect, AcceptStale, ForgedManagement
ASSUME Root \in Contexts
VARIABLES phase, generation, owner, epoch, ranUnsafe, leakedAuthority,
          network, pendingGeneration, pendingRole, staleAccepted
vars == <<phase, generation, owner, epoch, ranUnsafe, leakedAuthority,
          network, pendingGeneration, pendingRole, staleAccepted>>

Init == /\ phase = [c \in Contexts |-> "absent"]
        /\ generation = [c \in Contexts |-> 0]
        /\ owner = [c \in Contexts |-> Root]
        /\ epoch = 0
        /\ ranUnsafe = FALSE /\ leakedAuthority = FALSE /\ network = FALSE
        /\ pendingGeneration = 2 /\ pendingRole = "none" /\ staleAccepted = FALSE

CreateRoot == /\ phase[Root] \in {"absent", "revoked"}
              /\ phase' = [phase EXCEPT ![Root] = "preparing"]
              /\ generation' = [generation EXCEPT ![Root] = epoch]
              /\ owner' = [owner EXCEPT ![Root] = Root]
              /\ UNCHANGED <<epoch, ranUnsafe, leakedAuthority, network,
                              pendingGeneration, pendingRole, staleAccepted>>
CreateChild(c,p) == /\ c # Root /\ p # c
                    /\ phase[p] \in {"published", "running"} /\ generation[p] = epoch
                    /\ phase[c] \in {"absent", "revoked"}
                    /\ phase' = [phase EXCEPT ![c] = "preparing"]
                    /\ generation' = [generation EXCEPT ![c] = epoch]
                    /\ owner' = [owner EXCEPT ![c] = p]
                    /\ UNCHANGED <<epoch, ranUnsafe, leakedAuthority, network,
                                    pendingGeneration, pendingRole, staleAccepted>>
Prepare(c) == /\ phase[c] = "preparing" /\ generation[c] = epoch
              /\ phase' = [phase EXCEPT ![c] = "prepared"]
              /\ UNCHANGED <<generation, owner, epoch, ranUnsafe, leakedAuthority,
                              network, pendingGeneration, pendingRole, staleAccepted>>
Publish(c) == /\ generation[c] = epoch
              /\ phase[c] = "prepared" \/ (EarlyPublish /\ phase[c] = "preparing")
              /\ phase' = [phase EXCEPT ![c] = IF phase[c] = "prepared" THEN "published" ELSE "exposed"]
              /\ UNCHANGED <<generation, owner, epoch, ranUnsafe, leakedAuthority,
                              network, pendingGeneration, pendingRole, staleAccepted>>
Run(c) == /\ phase[c] \in {"published", "exposed"} /\ generation[c] = epoch
          /\ ranUnsafe' = (ranUnsafe \/ (phase[c] = "exposed"))
          /\ phase' = [phase EXCEPT ![c] = IF phase[c] = "exposed" THEN "unsafe-running" ELSE "running"]
          /\ UNCHANGED <<generation, owner, epoch, leakedAuthority, network,
                          pendingGeneration, pendingRole, staleAccepted>>
Send(role) == /\ pendingRole = "none" /\ role \in {"host", "application"}
              /\ (role = "host" \/ \E c \in Contexts: phase[c] = "running")
              /\ pendingRole' = role /\ pendingGeneration' = epoch
              /\ UNCHANGED <<phase, generation, owner, epoch, ranUnsafe,
                              leakedAuthority, network, staleAccepted>>
Accept == /\ pendingRole # "none"
          /\ (pendingRole = "host" \/ ForgedManagement)
          /\ (pendingGeneration = epoch \/ AcceptStale)
          /\ staleAccepted' = (staleAccepted \/ (pendingGeneration # epoch))
          /\ leakedAuthority' = (leakedAuthority \/ (pendingRole = "application"))
          /\ pendingRole' = "none" /\ pendingGeneration' = 2
          /\ UNCHANGED <<phase, generation, owner, epoch, ranUnsafe, network>>
Replace == /\ epoch = 0
           /\ epoch' = 1
           /\ phase' = [c \in Contexts |-> IF phase[c] = "absent" THEN "absent" ELSE "revoked"]
           /\ UNCHANGED <<generation, owner, ranUnsafe, leakedAuthority, network,
                           pendingGeneration, pendingRole, staleAccepted>>
Remote == /\ \E c \in Contexts: phase[c] \in {"running", "unsafe-running"}
          /\ (UnmediatedEffect \/ NetworkFallback \/ leakedAuthority \/ ranUnsafe)
          /\ network' = TRUE
          /\ UNCHANGED <<phase, generation, owner, epoch, ranUnsafe, leakedAuthority,
                          pendingGeneration, pendingRole, staleAccepted>>
Leak == /\ ExposeAuthority /\ \E c \in Contexts: phase[c] = "running"
        /\ leakedAuthority' = TRUE
        /\ UNCHANGED <<phase, generation, owner, epoch, ranUnsafe, network,
                        pendingGeneration, pendingRole, staleAccepted>>
Next == CreateRoot \/ Replace \/ Accept \/ Remote \/ Leak
        \/ (\E role \in {"host", "application"}: Send(role))
        \/ (\E c \in Contexts: Prepare(c) \/ Publish(c) \/ Run(c))
        \/ (\E c,p \in Contexts: CreateChild(c,p))
Spec == Init /\ [][Next]_vars
PublishedIsPrepared == \A c \in Contexts: phase[c] # "exposed"
NoUnsafeExecution == ~ranUnsafe
NoForgedAuthority == ~leakedAuthority
NoStaleAcceptance == ~staleAccepted
NoRemoteTraffic == ~network
NoChildBeforeParentRun == ~(phase[Root] = "published" /\ (\E c \in Contexts: c # Root /\ phase[c] # "absent"))
NoRunningChild == \A c \in Contexts: c # Root => phase[c] # "running"
NoReplacement == epoch = 0
CurrentOwners == \A c \in Contexts: phase[c] \in {"published", "running"} => generation[c] = epoch
=============================================================================
