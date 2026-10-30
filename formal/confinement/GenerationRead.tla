--------------------------- MODULE GenerationRead ---------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Readers, SplitRead, SplitWrite, IgnoreGeneration, ReadCurrentAtDelivery
VARIABLES databaseGeneration, databaseBody, replacement, phase, expected,
          metadataRead, bodyRead, delivered, lateDelivery
vars == <<databaseGeneration, databaseBody, replacement, phase, expected,
          metadataRead, bodyRead, delivered, lateDelivery>>

Init == /\ databaseGeneration = 0 /\ databaseBody = 0
        /\ replacement = "old"
        /\ phase = [r \in Readers |-> "idle"]
        /\ expected = [r \in Readers |-> 0]
        /\ metadataRead = [r \in Readers |-> 2]
        /\ bodyRead = [r \in Readers |-> 2]
        /\ delivered = [r \in Readers |-> 2]
        /\ lateDelivery = FALSE

\* Callers may retain an older observed generation after replacement. No future
\* generation is supplied before it has existed in this bounded history.
Begin(r, callerGeneration) == /\ phase[r] = "idle"
                              /\ callerGeneration \in 0..databaseGeneration
            /\ phase' = [phase EXCEPT ![r] = "queued"]
            /\ expected' = [expected EXCEPT ![r] = callerGeneration]
            /\ UNCHANGED <<databaseGeneration, databaseBody, replacement,
                            metadataRead, bodyRead, delivered, lateDelivery>>

\* One readonly transaction covers both stores. Its snapshot, not the current
\* database at later delivery, determines whether these bytes match the caller.
ReadTransaction(r) == /\ ~SplitRead /\ phase[r] = "queued"
                      /\ metadataRead' = [metadataRead EXCEPT ![r] = databaseGeneration]
                      /\ bodyRead' = [bodyRead EXCEPT ![r] = databaseBody]
                      /\ phase' = [phase EXCEPT ![r] = "snapshot"]
                      /\ UNCHANGED <<databaseGeneration, databaseBody, replacement,
                                      expected, delivered, lateDelivery>>

\* Fault: metadata and body are read outside one shared transaction.
ReadMetadata(r) == /\ SplitRead /\ phase[r] = "queued"
                   /\ metadataRead' = [metadataRead EXCEPT ![r] = databaseGeneration]
                   /\ phase' = [phase EXCEPT ![r] = "metadata"]
                   /\ UNCHANGED <<databaseGeneration, databaseBody, replacement,
                                   expected, bodyRead, delivered, lateDelivery>>
ReadBody(r) == /\ SplitRead /\ phase[r] = "metadata"
               /\ bodyRead' = [bodyRead EXCEPT ![r] = databaseBody]
               /\ phase' = [phase EXCEPT ![r] = "snapshot"]
               /\ UNCHANGED <<databaseGeneration, databaseBody, replacement,
                               expected, metadataRead, delivered, lateDelivery>>

\* oncomplete checks the saved request results, even if another transaction has
\* since committed. A missing path (body tag 2) is refused independently.
Validate(r) == /\ phase[r] = "snapshot"
               /\ phase' = [phase EXCEPT ![r] =
                    IF bodyRead[r] # 2 /\ (IgnoreGeneration \/ metadataRead[r] = expected[r])
                    THEN "buffered" ELSE "rejected"]
               /\ UNCHANGED <<databaseGeneration, databaseBody, replacement,
                               expected, metadataRead, bodyRead, delivered, lateDelivery>>

\* putApp's metadata and bodies change together at the write transaction commit.
ReplaceTransaction(nextBody) == /\ ~SplitWrite /\ replacement = "old"
                       /\ databaseGeneration' = 1 /\ databaseBody' = nextBody
                       /\ replacement' = "new"
                       /\ UNCHANGED <<phase, expected, metadataRead, bodyRead,
                                       delivered, lateDelivery>>
\* Fault: publication of new metadata precedes replacement of the resource body.
ReplaceMetadata == /\ SplitWrite /\ replacement = "old"
                    /\ databaseGeneration' = 1 /\ replacement' = "metadata"
                    /\ UNCHANGED <<databaseBody, phase, expected, metadataRead,
                                    bodyRead, delivered, lateDelivery>>
ReplaceBody(nextBody) == /\ SplitWrite /\ replacement = "metadata"
                /\ databaseBody' = nextBody /\ replacement' = "new"
                /\ UNCHANGED <<databaseGeneration, phase, expected, metadataRead,
                                bodyRead, delivered, lateDelivery>>

\* Delivery uses the already checked snapshot. Replacement need not cancel it.
DeliveryValue(r) == IF ReadCurrentAtDelivery THEN databaseBody ELSE bodyRead[r]
Deliver(r) == /\ phase[r] = "buffered"
              /\ delivered' = [delivered EXCEPT ![r] = DeliveryValue(r)]
              /\ phase' = [phase EXCEPT ![r] = "delivered"]
              /\ lateDelivery' = (lateDelivery \/ (DeliveryValue(r) # databaseGeneration))
              /\ UNCHANGED <<databaseGeneration, databaseBody, replacement,
                              expected, metadataRead, bodyRead>>

Next == (\E nextBody \in {1, 2} : ReplaceTransaction(nextBody) \/ ReplaceBody(nextBody))
        \/ ReplaceMetadata
        \/ (\E r \in Readers : (\E g \in 0..databaseGeneration : Begin(r, g))
             \/ ReadTransaction(r) \/ ReadMetadata(r) \/ ReadBody(r)
             \/ Validate(r) \/ Deliver(r))
Spec == Init /\ [][Next]_vars

TypeOK == /\ databaseGeneration \in 0..1 /\ databaseBody \in 0..2
          /\ replacement \in {"old", "metadata", "new"}
          /\ phase \in [Readers -> {"idle", "queued", "metadata", "snapshot", "buffered",
                                      "rejected", "delivered"}]
          /\ expected \in [Readers -> 0..1]
          /\ metadataRead \in [Readers -> 0..2]
          /\ bodyRead \in [Readers -> 0..2]
          /\ delivered \in [Readers -> 0..2]
          /\ lateDelivery \in BOOLEAN
Accepted(r) == phase[r] \in {"buffered", "delivered"}
ConsistentSnapshot == \A r \in Readers : Accepted(r) => metadataRead[r] = bodyRead[r]
MatchesCallerGeneration == \A r \in Readers : Accepted(r) => metadataRead[r] = expected[r]
DeliveryUsesCheckedBytes == \A r \in Readers : phase[r] = "delivered" => delivered[r] = bodyRead[r]
\* These deliberately false properties are reachability controls, not guarantees.
NoLateDelivery == ~lateDelivery
NoRejectedRead == \A r \in Readers : phase[r] # "rejected"
NoNewDelivery == \A r \in Readers : delivered[r] # 1
=============================================================================
