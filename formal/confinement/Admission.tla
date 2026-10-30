---------------------------- MODULE Admission ----------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Resources, ForgedInstall, TamperAdmission, NetworkFallback, ExecuteDuringInstall
VARIABLES phase, verified, admitted, delivered, untrustedCommit, remote, stored, ranDuringInstall
vars == <<phase, verified, admitted, delivered, untrustedCommit, remote, stored, ranDuringInstall>>
Init == /\ phase = "idle" /\ verified = {} /\ admitted = {} /\ delivered = {}
        /\ untrustedCommit = FALSE /\ remote = FALSE /\ stored = FALSE /\ ranDuringInstall = FALSE
Begin == /\ phase = "idle" /\ phase' = "installing"
         /\ verified' = {} /\ admitted' = {} /\ delivered' = {}
         /\ UNCHANGED <<untrustedCommit, remote, stored, ranDuringInstall>>
Verify(r) == /\ phase = "installing" /\ r \notin verified
             /\ verified' = verified \cup {r}
             /\ UNCHANGED <<phase, admitted, delivered, untrustedCommit, remote, stored, ranDuringInstall>>
Commit == /\ phase = "installing" /\ verified # {}
          /\ phase' = "ready" /\ admitted' = verified
          /\ UNCHANGED <<verified, delivered, untrustedCommit, remote, stored, ranDuringInstall>>
Start == /\ phase = "ready" /\ phase' = "running"
         /\ UNCHANGED <<verified, admitted, delivered, untrustedCommit, remote, stored, ranDuringInstall>>
WritePrivate == /\ phase = "running" /\ stored' = TRUE
                /\ UNCHANGED <<phase, verified, admitted, delivered, untrustedCommit, remote, ranDuringInstall>>
Close == /\ phase = "running" /\ phase' = "idle"
         /\ UNCHANGED <<verified, admitted, delivered, untrustedCommit, remote, stored, ranDuringInstall>>
Request(r) == /\ phase = "running"
              /\ IF r \in admitted THEN delivered' = delivered \cup {r} ELSE delivered' = delivered
              /\ remote' = (remote \/ (r \notin admitted /\ NetworkFallback))
              /\ UNCHANGED <<phase, verified, admitted, untrustedCommit, stored, ranDuringInstall>>
Forge == /\ ForgedInstall /\ phase = "running"
         /\ untrustedCommit' = TRUE
         /\ UNCHANGED <<phase, verified, admitted, delivered, remote, stored, ranDuringInstall>>
Tamper(r) == /\ TamperAdmission /\ phase = "running" /\ r \notin verified
             /\ admitted' = admitted \cup {r}
             /\ UNCHANGED <<phase, verified, delivered, untrustedCommit, remote, stored, ranDuringInstall>>
InstallExecution == /\ ExecuteDuringInstall /\ phase = "installing"
                    /\ ranDuringInstall' = TRUE
                    /\ UNCHANGED <<phase, verified, admitted, delivered,
                                    untrustedCommit, remote, stored>>
Next == InstallExecution \/ Begin \/ Commit \/ Start \/ WritePrivate \/ Close \/ Forge
        \/ (\E r \in Resources: Verify(r) \/ Request(r) \/ Tamper(r))
Spec == Init /\ [][Next]_vars
NoUnverifiedAdmission == admitted \subseteq verified
NoUnauthorizedCommit == ~untrustedCommit
NoRemoteTraffic == ~remote
NoApplicationDuringInstall == ~ranDuringInstall
NoStoredPrivate == ~stored
=============================================================================
