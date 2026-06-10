# RFC-0047: Retiring the Nightly Batch Window at Lattermile

Status. Accepted on
2026-04-17 after three review rounds. Authors are Priya Vellanki
(platform group) and Tomas Reiner (freight operations engineering), with
substantial input from Mei-Lin Cho, Dragan Ilic, and the on-call guild.
Supersedes RFC-0031,
which proposed shrinking the batch window and was withdrawn before
implementation. Discussion happened in #rfc-0047 and in two recorded
architecture forums; the raw notes live in the engineering wiki under
"streaming-migration".

## 1. Summary

Lattermile moves freight bookings between shippers, carriers, and
customs brokers across nineteen markets. Almost every cross-system data
flow in the platform is carried today by cron-scheduled batch jobs that
wake up, scan relational tables for rows changed since their last
high-water mark, transform what they find, and write the result
somewhere else. There are 214 of these jobs in the primary scheduler and
an uncounted number of stragglers living in per-team crontabs.

This RFC proposes that we stop extending that estate and instead carry
inter-service data on an append-only event log, with services emitting
domain events at the moment state changes. We evaluated three options in
depth and chose a hybrid: explicit domain events for the eleven flows
that move money or change legal custody of freight, and change data
capture for the long tail of low-stakes table syncs. The rollout runs
four phases over roughly three quarters, with the batch estate kept warm
as a fallback until the final phase completes.

## 2. Background

### 2.1 How the batch window works today

The platform grew out of a single Rails monolith that owned one Postgres
cluster. The first integration anyone wrote, back in 2019, was a nightly
job that exported confirmed bookings to the carrier settlement system as
CSV over SFTP. That pattern was easy to imitate, and imitate it we did.
Today the "batch window" runs from 01:00 to 05:30 UTC, a period during
which most of the fleet's spare capacity is consumed by jobs reading
each other's output tables in a carefully hand-tuned order.

The ordering is the load-bearing
part. Settlement cannot run until rating has finished, rating cannot run
until the bookings export has landed, and the bookings export waits on a
sweep that repairs rows left half-written by the previous day's
failures. None of these dependencies are declared anywhere a machine can
read. They are encoded as start times: the sweep at 01:00, the export at
01:40, rating at 02:30, settlement at 03:45. The gaps are guesses about
how long each predecessor usually takes, plus margin that has eroded as
data volume grew.

### 2.2 Scheduler sprawl

The primary scheduler is a self-hosted
instance of an open source orchestrator that we have pinned two major
revisions behind current because upgrading it breaks a plugin we wrote
in 2021 and nobody has owned since. Around it, teams have accreted
satellite schedulers: a Kubernetes CronJob here, a cloud function on a
timer there, and at least six classic crontabs on long-lived VMs that
predate the container migration. An inventory run for this RFC found 214
jobs in the primary scheduler, 41 CronJobs, and 17 timer-triggered
functions, of which 9 jobs appear to be dead but cannot be proven dead
because their output tables are world-readable and grep cannot see into
the analysts' notebooks.

Ownership tracks the org chart of three reorgs ago. The freight
visibility team owns jobs that feed surfaces now run by the customer
experience group. Two jobs that reconcile customs declarations are owned
by an engineer who left in 2024; his manager approves changes to them by
forwarding the diff to a group thread and waiting a day.

### 2.3 Operational pain

The on-call
guild tallied incidents for the trailing twelve months as part of this
RFC. Of 38 customer-visible
incidents, 22 traced back to the batch window. The recurring shapes are
familiar to anyone who has carried the pager. A job overruns its slot,
its successor starts against half-written data, and the error surfaces
two systems downstream where nobody can connect it back to the cause. A
job fails silently because its alert routed to a channel that was
archived. The high-water mark logic misses rows updated during the job's
own run, and the loss goes unnoticed until a customer disputes an
invoice weeks later.

The deeper cost is timidity. Engineers do not refactor tables that batch
jobs scan, because finding every reader is archaeology, not engineering.
Schema migrations on the booking tables are scheduled around the batch
window, which in practice means they happen rarely and under duress. Two
product initiatives in the last year shipped degraded scopes because the
data they needed could not be made available at acceptable freshness
without touching the most fragile part of the window.

### 2.4 Why now

Three forcing functions converged this year. First, the customs
authority in our second-largest market began requiring declaration
updates within fifteen minutes of a booking change, which no amount of
window tuning can satisfy. Second, the settlement provider we are
contracted with through 2028 is deprecating SFTP intake in favor of a
webhook contract, with a hard date in Q1 next year. Third, the finance
close process now consumes our data through a reporting warehouse whose
ingest contract assumes change streams, and the adapter we wrote to fake
a stream from batch diffs costs more in upkeep than the rest of the
reporting integration combined.

We considered deferring another year. The honest reading of the incident
tally and the contract dates is that deferral converts a planned
migration into an emergency one.

### 2.5 What the window costs in people

The pager rotation absorbs the most visible cost. Overnight pages
attributable to the window averaged eleven per month across the trailing
year, and the morning triage ritual, in which two engineers walk the
overnight failures and decide what to re-run in what order, consumes the
first ninety minutes of the platform group's day so reliably that the
team schedules nothing else against it. The less visible cost is hiring
and retention shaped by the work itself; exit conversations from the
platform group over two years mention the window unprompted more often
than any other system, and the team's own engagement survey ranks batch
firefighting as the work people most want to stop doing. None of this
appears in the capacity model in the appendix, deliberately, because we
did not want the financial case to lean on numbers that are honestly
soft. It belongs in the record anyway: the window taxes the people who
run it, every night, in a way that compounds.

## 3. Problem statement

### 3.1 The latency floor

A nightly window imposes a hard floor of up to twenty-four
hours on data freshness, and the practical floor is worse because
failures are usually repaired the next business day. The customs
requirement is fifteen minutes. The settlement webhook contract
tolerates an hour. Carrier capacity reallocation, which today runs on
yesterday's positions, loses an estimated 2.1 percent of margin to stale
data by the freight operations team's own arithmetic, written up in the
appendix. No incremental tightening of cron schedules reaches any of
these targets; the window can only shrink so far before jobs trample
each other.

### 3.2 Failure amplification

Batch dependencies are implicit, so failures propagate as data
corruption rather than as visible errors. The 22 window-related
incidents in the trailing year share a signature: the failing component
succeeded by its own lights, and the damage appeared downstream after a
delay. Mean time to detect for this class was 9.4 hours, against 41
minutes for failures in our synchronous request paths. The asymmetry is
structural. A request path fails closed and pages someone; a batch chain
fails open and keeps going with wrong data.

### 3.3 Coupling through shared tables

Every batch job that scans another service's tables is an unmanaged
contract. The producing team cannot know who reads which columns with
what assumptions, so every schema change is a negotiation with ghosts.
We count 61 distinct cross-service
table-scan relationships, and the true number is higher because some
scans hide inside analyst tooling. This coupling is the root cause
behind both the timidity described in section 2.3 and a steady trickle
of breakage when a producing team changes a column it believes it owns
outright. The negotiation cost lands asymmetrically, too: producing
teams carry the blame for breakage they could not have foreseen, and
consuming teams learn to hoard private snapshots of upstream data as
insurance, which multiplies the surface yet again and quietly doubles
our spend on data that is wrong in two places instead of one.

### 3.4 What this RFC does not try to solve

We are explicitly not redesigning the reporting warehouse, not replacing
the orchestrator for genuinely periodic work such as month-end close,
and not migrating analyst-owned jobs that never cross a service
boundary. Periodic aggregation is a legitimate batch shape and will
remain one. The scope here is inter-service data movement that currently
rides the nightly window, nothing more. The appendix carries a full
inventory split by disposition. Boundaries this crisp invite litigation,
so the inventory also names a tiebreaker for ambiguous jobs: a job is in
scope only when its output is read by another team's service within one
business day, and the two jobs that sat exactly on that line were walked
through with both owning teams during review rather than adjudicated
from a spreadsheet.

## 4. Goals and non-goals

### 4.1 Goals

The migration succeeds when the eleven
money-and-custody flows named in the appendix run end to end with
sub-minute median propagation and a paged, fail-closed error path; when
the customs and settlement contract deadlines are met without exception
processes; when no new cross-service table scan has been introduced for
two consecutive quarters; and when the 01:00 to 05:30 ordering ballet is
no longer load-bearing for any customer-visible outcome. Each of these
is checkable, and section 8 ties rollout gates to them.

### 4.2 Non-goals

We are not pursuing event sourcing as a persistence model; services keep
their relational state and the log is a transport, not the book of
record. We are not standardizing the internal architecture of consuming
services. We are not promising exactly-once delivery, for reasons
section 7.3 spells out. And we are not committing to retire the
orchestrator itself, which retains a legitimate role for periodic
aggregation even after the window stops being a dependency chain. These
boundaries were negotiated with the dissenting reviewers and are part of
what acceptance means here; an implementation effort that quietly
expands into one of them re-opens this RFC rather than amending it in
place, a rule we adopted after watching RFC-0019's scope swell silently
until nobody could say what had been agreed to.

## 5. Considered options

We took three options through design spikes of one to two weeks each.
The spikes produced working prototypes against a replica of the booking
dataset, and the numbers quoted below come from those prototypes rather
than from vendor material. Mei-Lin Cho ran the option A spike, Dragan
Ilic ran B, and the platform group ran C. Each spike report is filed in
the wiki beside this RFC with its raw latency captures attached, and the
summaries below compress those reports aggressively; where a number
mattered to the decision, the measurement conditions are repeated inline
so a skeptical reader can judge them without chasing links. The three
spikes shared one replica and one traffic generator so that their
numbers are comparable, a detail we mention because the first draft of
this section compared measurements taken under different load and drew a
conclusion the shared rig later overturned.

### 5.1 Option A: incremental batch, shrink the window

#### 5.1.1 Sketch

Option A keeps the batch paradigm and attacks the schedule. Jobs declare
their upstream dependencies explicitly in the orchestrator rather than
encoding them as start times, the orchestrator runs each job the moment
its inputs are ready, and the highest-value chains move from nightly to
a fifteen-minute cadence. High-water mark scans get replaced by an
updated-at index pattern with a two-minute overlap re-read to close the
missed-row hole described in section 2.3. This is roughly what RFC-0031
proposed in 2025, sharpened by a real prototype this time.

#### 5.1.2 What it buys us

The appeal is familiarity. Every engineer on staff can debug a batch
job, the orchestrator's operational quirks are known quantities, and no
new infrastructure gets introduced. The spike converted the rating chain
to declared dependencies in four days and cut its end-to-end latency
from a worst case of three hours to a steady eleven minutes. Capacity
cost is modest because the same work just spreads across the day. For
perhaps a third of the estate, the long tail of genuinely low-stakes
syncs, this shape would honestly be sufficient for years.

#### 5.1.3 Where it falls down

Frequent polling multiplies the table-scan
coupling rather than curing it; the producing teams gain ninety-six
daily scans where they had one. The fifteen-minute floor cannot meet the
customs deadline once queueing and retry margin are counted, and the
spike measured p99 chain latency at thirty-one minutes under realistic
contention. Worst, option A does nothing about failure amplification.
The chains still fail open, the dependencies still live in one
orchestrator's config, and the timidity problem persists because readers
still reach directly into producers' tables. We would spend two quarters
to buy back margin that data growth erodes again within two more.

### 5.2 Option B: change data capture into a managed log

#### 5.2.1 Sketch

Option B deploys a change data capture connector against each producing
database, streaming row-level changes into a managed append-only log
service, with consumers subscribing to per-table topics. No producing
service changes its code at all; the connector reads the replication
slot and the log does the fan-out. The spike ran the connector against a
full-size replica of the booking cluster and sustained 4,100 row events
per second with p99 capture lag of 1.8 seconds, which comfortably clears
every freshness target in section 3.

#### 5.2.2 Strengths

Speed of adoption is the headline. A flow migrates by standing up a
consumer, with zero changes to the producer, which means the long tail
of 150-plus low-stakes syncs can move without scheduling work across
twelve teams. Capture lag in the low seconds beats every contractual
deadline with two orders of magnitude of margin. The connector and the
log are both managed services, so the new operational surface is narrow.
Dragan's spike team, two engineers, migrated three real flows in nine
days, and the on-call guild reviewed the runbooks without major
findings. The economics also hold up at the margin: a capture topic's
running cost is dominated by retention, which the short long-tail
retention policy keeps flat, and the connector fleet amortizes across
every table it serves, so the hundredth migrated flow costs materially
less than the tenth.

#### 5.2.3 Weaknesses

Row-level
change streams are the producer's table schema wearing a trench coat.
Consumers couple to column names and write patterns, so the
unmanaged-contract problem from section 3.3 survives in a new transport;
a producer that starts writing a column in two steps suddenly emits
intermediate states that consumers were never meant to see. Multi-row
transactions arrive as uncorrelated fragments unless we add a
correlating layer on top. And the connector's failure modes are subtle:
replication slot overflow on the producer side can take down the
production database that the whole design was meant to insulate, a
hazard the spike reproduced deliberately and documented in the runbook
review.

### 5.3 Option C: explicit domain events from producing services

#### 5.3.1 Sketch

Option C asks producing services to emit named domain events, such as
BookingConfirmed or CustodyTransferred, at the moment the state change
commits. Events are facts about the business, not images of rows. Each
producer writes events to an outbox table in the same transaction as its
state change, and a relay process drains the outbox into the log, which
gives atomicity between state and event without distributed
transactions. Consumers subscribe to event types, not tables, and the
event contract is owned, reviewed, and versioned by the producing team
like any other API surface.

#### 5.3.2 Strengths

This is the only option that actually severs the coupling. Consumers
depend on a deliberate contract whose evolution the producer controls,
which is the structural fix for both the timidity problem and the
breakage trickle. Events carry business meaning, so the customs flow can
subscribe to exactly the three event types it needs rather than
inferring intent from row diffs. The spike instrumented the booking
service with an outbox in six days, and the resulting event stream
proved dramatically easier for the consuming team to reason about than
the row stream from the option B spike, by their own written assessment.
There is also a compounding effect the spike could only gesture at: once
an event family exists, the second and third consumers arrive nearly
free, and two teams who saw the spike's booking stream asked to consume
it before this RFC was even accepted, which is the closest thing to
product-market fit an internal platform gets.

#### 5.3.3 Weaknesses

Cost, concentrated on producer teams. Every producing service needs
outbox plumbing, event design review, and a relay deployment, which the
spike priced at two to four engineer-weeks per service. Applied across
the whole estate that is several engineer-years, most of it spent on
flows too unimportant to justify the care. Event design is also a skill
the organization is still building; the first draft of the booking
events from the spike leaked internal identifiers that would have frozen
the very schema flexibility the option promises. The engineer-week
estimate also deliberately excludes the cost of event design review
itself, which lands on the senior engineers whose calendars are already
the scarcest resource in the organization, and no honest accounting of
option C can leave that line off the bill. Pure option C is the right
destination for the flows that matter and an indefensible tax on the
flows that do not.

### 5.4 Comparing the options

The comparison that settled the decision was not throughput, where all
three options clear the bar, but who pays and what breaks. Option A
charges the platform team lightly and leaves every structural problem in
place. Option B charges almost nobody up front and quietly re-creates
the coupling problem one transport over, while adding a failure mode
that can reach back into production databases. Option C charges producer
teams heavily and fixes the structure for exactly the flows where
structure matters. Laid against the inventory in the appendix, the
estate splits cleanly: eleven flows that move money or custody and
justify option C's care, and a long tail that needs option B's
economics. A hybrid is more architecture to operate than either pure
play, and section 9 treats that honestly as a risk, but the split tracks
a real fault line in the domain rather than an indecisive compromise.

## 6. Decision

### 6.1 What we chose

We adopt the hybrid. The eleven
money-and-custody flows named in the appendix migrate to explicit domain
events with transactional outboxes, in the priority order the appendix
gives. Everything else that crosses a service boundary migrates to
change data capture topics, with a published consumer guideline that
treats row streams as provisional contracts subject to producer schema
change. Both event classes ride the same managed log service, the same
consumer framework, and the same dead-letter and replay tooling, so the
operational surface is one platform, not two. The orchestrator stays for
periodic aggregation and loses its role as an inter-service transport.

### 6.2 Why not pure A or pure B

Option A fails on its own terms: it
cannot reach the customs deadline and it deepens the table coupling that
drives our incident history. We rejected it as a destination but kept
its best idea, and declared dependencies in the orchestrator are being
adopted for the periodic work that remains. Pure B founders on the
contract problem. The trench-coat schemas would let us hit every latency
number this year and then hand us back the same archaeology problem in
2028 with the batch window's name filed off. The hybrid costs more to
operate than either pure option, and we accept that cost deliberately,
with eyes open, because the eleven critical flows are precisely where an
unmanaged contract eventually becomes a seven-figure incident.

## 7. Detailed design

### 7.1 Topology

One managed log cluster per region, three regions, with the customs and
settlement topics replicated across region pairs to satisfy the data
residency commitments we carry in the European market. Topic granularity
follows ownership: one topic per event family for domain events, one
topic per source table for capture streams, and no shared topics across
producing teams under any circumstance. Partition keys are booking
identifiers for everything in the custody chain, which preserves
per-booking ordering where it matters and accepts global disorder where
it does not. The platform group owns the cluster, quotas, and access
control; producing teams own their topics the way they own their
database schemas today.

### 7.2 Event contracts

Domain events are described in a schema registry, and each event family
carries an explicit revision number that producers bump under a
compatibility rule: additions are free, removals and re-typings require
a deprecation cycle of one quarter with both revisions emitted side by
side. The contract review checklist from the option C spike becomes a
required artifact; its core demand is that an event name a business fact
and carry stable public identifiers rather than internal row keys.
Consumers must tolerate unknown fields, and must treat the absence of an
optional field as unknown rather than false, a distinction the
settlement prototype got wrong once and which cost the spike a day of
confused reconciliation.

### 7.3 Ordering and delivery

The log guarantees
at-least-once delivery and per-partition order, nothing stronger, and
the design leans into that honestly rather than simulating stronger
guarantees badly. Every consumer in the critical flows must be
idempotent, keyed on the event identifier that the outbox assigns at
write time. Duplicate deliveries are normal operation, not errors, and
the consumer framework ships with a deduplication helper that the eleven
critical flows are required to use rather than reimplement.
Cross-partition
ordering is explicitly not provided; the two flows that genuinely need
cross-booking sequencing, both in settlement netting, carry sequence
tokens inside the event payload and reorder in the consumer.

### 7.4 The outbox relay

The relay is the one piece of infrastructure this design adds that we
operate ourselves, and it is deliberately boring: a single-purpose
process that polls a producer's outbox table, appends rows to the log in
commit order, and advances a durable cursor only after the log
acknowledges. The poll interval is two hundred milliseconds, which the
spike showed adds p50 transport latency of about one hundred
milliseconds and p99 under one second. The relay is stateless apart from
its cursor, so recovery is a restart, and it runs two replicas in
leader-standby configuration because the spike's chaos drill found that
a single replica turned every node eviction into a freshness incident.
The same drill confirmed the cursor logic survives kills at every await
point without skipping or re-emitting committed rows beyond the
at-least-once contract.

### 7.5 Replay and backfill

Every consumer must be able to rebuild its derived state from the log
within its stated recovery objective, and the platform provides a replay
tool that rewinds a consumer group to a timestamp or to a named snapshot
marker. Replays run against the same code path as live consumption,
never a parallel one, because the option B spike demonstrated how
quickly a separate backfill path drifts from the live path and starts
producing subtly different results. Snapshot markers are emitted weekly
into each topic by the platform, giving replays a well-known starting
line that avoids unbounded rewind. Backfills for newly migrated flows
follow the same mechanism: seed from a snapshot, then replay forward to
the present before going live.

### 7.6 Retention and the log as history

Topics retain ninety days in the critical flows and fourteen days in the
long tail, numbers chosen to cover the longest realistic dispute
investigation and the longest realistic consumer outage respectively.
The log is not the book of record and retention policy enforces that
stance; anything needed beyond ninety days must live in a service's own
relational state or in the reporting warehouse. This boundary was
contentious in review, and one camp wanted indefinite retention to
enable event sourcing later. We declined, recording the reasoning here:
indefinite retention changes the cost model, the compliance story for
the right-to-erasure obligations we hold in two markets, and the
operational character of the cluster, and nothing in the present
migration needs it.

### 7.7 The consumer framework

Every consumer in both event classes runs on a shared library that the
platform group maintains, and the library is opinionated on purpose. It
supplies the deduplication helper from section 7.3, an ordered retry
ladder with jitter that tops out at fifteen minutes, a dead-letter path
that quarantines a poison event after six failed attempts and pages the
owning team rather than silently parking it, and a pause control that an
operator can throw during an incident without deploying anything. Teams
may opt out of the library only with a written waiver from the platform
group, and the waiver record names the person who accepts responsibility
for re-implementing the guarantees. The library's own evolution follows
the same deprecation cycle as event contracts, one quarter of
side-by-side support, so consumer teams are never forced into a flag-day
upgrade by their own platform.

### 7.8 Access control and quotas

Topic access is
deny-by-default. A consuming team requests a grant through the same
review path that new database grants use today, the grant names specific
topic families rather than patterns, and wildcard reads are reserved for
the two platform tools that demonstrably need them, the replay tool and
the diff harness. Producer credentials can append only to their own
families. Quotas cap both throughput and consumer-group count per team,
sized generously and raised on request, because the goal is not
rationing but a paper trail: when the cost model in section 9.6 drifts,
the quota records say which flows grew and whose roadmap explains why.
Service credentials rotate on the platform's standard ninety-day
cycle and the rotation is exercised by the quarterly chaos drill rather
than trusted to work.

### 7.9 Observability

The platform emits one metric that matters above all others:
end-to-end freshness per flow, measured from the producer's commit
timestamp to the consumer's acknowledgment, sampled continuously and
graphed on the same dashboard for every flow regardless of transport.
Beneath it sit the supporting instruments: relay
cursor age, consumer group lag in both events and seconds, dead-letter
arrival rate, and replication slot retention on the capture side. Paging
thresholds derive from each flow's stated freshness obligation rather
than from a global default, so the customs flow pages at three minutes
of staleness while a long-tail sync tolerates an hour. Dashboards are
owned by flow owners, not by the platform group, on the theory that the
team that gets paged should control what the page looks at.

## 8. Rollout plan

### 8.1 Phase one: shadow

Phase one stands up the log cluster, the registry, the relay, and the
consumer framework, then migrates exactly one critical flow, customs
declaration updates, in shadow. The legacy batch chain remains
authoritative; the streaming path runs beside it and its output is
diffed against the batch output every night for four weeks. Diff
discrepancies page nobody and block nothing in this phase, but each one
gets a written root cause before phase two may begin. The phase also
carries the first two capture-stream migrations from the long tail,
chosen for low stakes and chatty schemas, to exercise the consumer
guideline against realistic producer churn.

### 8.2 Phase two: dual run

Phase two promotes the streaming path to authoritative for customs
declarations while the batch chain keeps running as a shadow, the mirror
image of phase one, and extends the same shadow-then-promote sequence to
settlement and rating, the two heaviest flows. The gate into phase three
requires four consecutive weeks where the diff between paths is
explainable entirely by timing skew, plus one unplanned regional
failover survived without a freshness breach, an event we will
manufacture with a game day if production declines to provide one
naturally. Producer teams for the remaining eight critical flows begin
their outbox work during this phase against the contract checklist.

### 8.3 Phase three: cutover

Phase three cuts the remaining critical flows over one at a time in the
appendix's priority order, retiring each flow's batch chain after two
clean weeks rather than leaving it half-alive, because a shadow that
nobody watches is a lie waiting to be believed. The long-tail capture
migrations proceed in parallel at whatever pace the two platform
engineers assigned to them can review, with an explicit quota: no more
than five concurrent migrations in flight, a limit the phase one
retrospective recommended after watching review quality sag. The phase
ends when no customer-visible outcome depends on the nightly ordering,
which is goal four restated as an exit criterion. Cutover order within
the phase follows blast radius, smallest first, so the muscle memory of
the early cutovers is earned on flows whose failure is an inconvenience
rather than a headline, and the runbook for each cutover is written by
the team doing the next one, a trick borrowed from the database
migration program that keeps the runbooks honest about which steps
actually got executed.

### 8.4 Phase four: decommission

Phase four is deletion, done deliberately. Batch jobs whose flows have
migrated get their schedules disabled for one full quarter before their
code is removed, an interval in which any undetected dependency has a
chance to surface as a complaint rather than a mystery. The orchestrator
shrinks to the periodic-aggregation estate. The satellite crontabs and
timer functions get audited against the inventory one final time, and
anything unaccounted for is disabled on a announced date with the owning
team's manager copied. We expect this phase to be slower and more
political than the others, and the schedule grants it a full quarter on
purpose.

### 8.5 Verification along the way

Every phase gate above is a measurement, not a meeting. The diff harness
from phase one stays alive through phase three because it is the only
instrument that compares the two worlds end to end. Each migrated flow
ships with a continuous reconciliation check that samples a fraction of
events and verifies the consumer's derived state against the producer's,
a pattern the settlement team already runs internally and which
generalized well during the spike. Chaos drills repeat quarterly: relay
leader kills, log partition unavailability, consumer group rebalance
storms, and replication slot overflow on the capture side, each with a
written pass condition and a named owner for any failure.

Reconciliation sampling rates start at one percent and rise to ten
percent for the first month after each cutover, a knob the on-call guild
asked for after reviewing how much noise the phase one diff
produced before its filters were tuned, and the sampling configuration
lives with the consumer so a team can raise its own rate during an
investigation without a platform ticket.

### 8.6 Keeping the organization informed

The migration publishes a written update at each phase gate and a short
fortnightly note in between, both in the same wiki space as this RFC,
and the updates follow a fixed shape: what moved, what the freshness
dashboard says, what slipped and why, and what decision is coming next.
The fixed shape is the point; a reader who checks in quarterly can diff
the updates without re-orienting. Gate decisions themselves get recorded
in the engineering decision log with the measurements that justified
them, so that a year from now the answer to why did we promote
settlement in November is a link rather than an oral tradition. The two
recorded dissents from acceptance get an explicit check-in at each gate,
in writing, against the kill criterion they negotiated, which costs us a
paragraph per quarter and buys the decision durable legitimacy.

## 9. Risks and mitigations

### 9.1 Two transports are more architecture than one

The hybrid means the organization operates domain events and capture
streams side by side, with different contract semantics, and the risk is
that engineers blur them, building critical logic on a row stream
because it was already there. Mitigations: the consumer guideline states
the boundary in its first paragraph, the platform review for any new
consumer of a capture topic asks one mandatory question, whether the
flow moves money or custody, and the quarterly architecture forum audits
new consumers against the inventory's disposition column. We accept
residual risk here; a sufficiently motivated team can always misuse a
transport, and the realistic goal is making the right path cheaper than
the wrong one.

### 9.2 Producer teams may stall on outbox adoption

Eight critical flows depend on producer teams instrumenting outboxes
during phase two, and those teams have roadmaps of their own. The
schedule risk is real and the mitigation is mostly organizational: the
migration carries a directive priority agreed at the engineering
leadership level, each producing team named a delivery owner during RFC
review, and the platform group funds a floating pair of engineers who
embed with whichever producer team is next in the priority order. The
fallback, if a producer genuinely cannot staff the work in time, is an
interim capture-stream bridge for that flow with a documented expiry
date, which is ugly and time-boxed and better than slipping a contract
deadline.

### 9.3 Replication slot overflow can reach production databases

The capture connector holds a replication slot on each producing
database, and a stalled connector causes the slot to retain write- ahead
log segments until the producer's disk fills, which is the one failure
mode in this design that can take down a system we were trying to
protect. The spike reproduced this deliberately. Mitigations are
layered: slot lag alarms at thirty minutes with a page, an automatic
circuit breaker that drops the slot at a lag threshold agreed per
database and accepts a re-snapshot cost instead of an outage, and a
standing rule that no capture connector targets a database without a
tested disk headroom calculation on file. The circuit breaker fired
twice during the spike's chaos drill and both re-snapshots completed
inside their projected windows.

### 9.4 Event design quality is a new organizational muscle

The first booking event draft leaked internal row keys, and the review
caught it because one reviewer had read the right book. That is not a
process, it is luck. The contract checklist converts the known failure
shapes into mandatory review questions, the platform group runs a
fortnightly event design clinic for the duration of the migration, and
the first three event families from each producing team get a second
reviewer drawn from outside that team. The risk that bad contracts ship
anyway is real and the deprecation cycle in section 7.2 is the recovery
mechanism: a bad revision can be walked back in a quarter without
breaking consumers, which is survivable in a way that a bad shared table
never was.

### 9.5 The fallback estate rots while it waits

Phases one through three keep batch chains alive as fallbacks, and a
fallback nobody exercises decays silently: credentials expire, hosts get
reclaimed, the one engineer who remembered its quirks changes teams. The
mitigation is the same diff harness that gates the phases, because a
dead batch chain produces a loud diff, plus a monthly failback drill
during phase two in which the customs flow is served from the batch path
for one hour against a replica. The drill is deliberately modest in
scope; its job is to prove the fallback still functions at all, not to
rehearse a full reversal, and the rollout plan accepts that past phase
three a reversal is a rebuild rather than a switch flip. Ownership of
the drill rotates through the guild roster so the knowledge does not
pool in one person, and every run files a short note even when nothing
interesting happened, because the absence of findings is itself a
finding worth dating.

### 9.6 Cost overrun on the managed log service

The capacity arithmetic in the appendix prices the steady state at a
figure finance has approved, but capture streams are chatty and the long
tail's volume is the least certain number in the model. The quota system
gives each topic an owner-visible budget, the platform dashboard shows
spend per topic family weekly, and the model gets re-run at each phase
gate against observed volume. The kill criterion is written down now,
while nobody is defensive: a sustained run rate above 1.6 times the
model triggers a scope review that can move long-tail flows back to
option A's improved batch shape, which remains acceptable for genuinely
low-stakes syncs and costs us nothing to keep as an escape hatch.
Finance sees the same per-topic
spend dashboard the platform group sees, deliberately, so that any
variance conversation starts from shared numbers rather than from a
reconciliation argument about whose spreadsheet is stale.

### 9.7 The migration outlives its sponsors

Three quarters is long enough for both named authors to change roles,
for the engineering leadership that granted the directive priority to
turn over, and for the organization to acquire a newer, shinier
initiative. The defense is the same one used throughout this RFC: gates
that are measurements rather than opinions, a decision log that lets a
successor reconstruct why each call was made, and an explicit successor
named for each of the three owner roles in section 10, on file with the
program before phase one begins. The phase structure also fails safe by
design, since every phase leaves the platform in a state that is better
than the one before it even when the program stops there; phase two
alone retires the two contract deadlines that forced the timing, and
that floor was a deliberate piece of schedule design rather than luck.

## 10. Open questions

Three questions stay open past acceptance, each with an owner and a
decision date rather than an indefinite parking spot. Whether the two
settlement netting flows need a stronger sequencing primitive than
payload tokens is owned by Tomas, due at the phase two gate, with the
answer informing whether we adopt the log service's transactional append
feature at its extra cost. Whether the fourteen-day long-tail retention
is enough for the analyst replays that currently lean on output tables
is owned by Mei-Lin, due before the first analyst-adjacent flow
migrates. And whether the relay should be donated to the connector
ecosystem as open source, which two reviewers pushed for, is owned by
Priya and explicitly deferred until phase four, on the grounds that we
should not maintain a public artifact mid-migration.

## 11. Appendix

### 11.1 Capacity arithmetic

The model takes the trailing-quarter
write volume of the nineteen markets, applies the observed
event-to-write ratio from the spike, which was one point three domain
events per booking mutation, and adds the capture-stream volume
estimated from replication byte rates already measured on the producing
clusters. The result lands at a steady eleven thousand events per second
across all regions at the 2027 traffic projection, with the customs
topic family contributing under four percent of volume but carrying the
tightest freshness obligation. Storage on the log cluster prices out
below the current spend on the batch fleet's reserved nighttime capacity
once the window stops needing headroom for its 04:00 peak, which is the
arithmetic that made finance comfortable approving a migration that is
justified on risk rather than savings.

### 11.2 Flow inventory and disposition

The full inventory is a living sheet linked from the wiki page; this
appendix records the split as counted at acceptance. Of 272 jobs
inventoried, eleven flows comprising 31 jobs move money or custody and
take the domain event path, named here in priority order: customs
declaration updates, carrier settlement, rating, booking confirmation
fan-out, custody transfer, demurrage accrual, invoice adjustment
propagation, carrier capacity positions, broker margin calls, refund
initiation, and chargeback evidence assembly. A further 158 jobs cross
service boundaries with low stakes and take the capture path. Sixty-one
jobs are periodic aggregation and stay on the orchestrator with declared
dependencies. The remaining 22 are suspected dead; phase four settles
the question with the disable- and-wait protocol from section 8.4.

### 11.3 Prior art consulted

We read the public post-mortems
and design write-ups of four logistics and marketplace companies that
made comparable migrations, and interviewed engineers at two of them
through personal networks, under the usual courtesy of not naming them
in an internal record. The consistent themes were that the outbox
pattern aged well everywhere it was tried, that pure capture-stream
architectures re-created table coupling within two years in both
companies that chose them, and that every team wished it had built the
diff harness earlier than it did. One interviewee's phrasing earned a
place in the phase three section of this RFC: a shadow nobody watches is
a lie waiting to be believed. The reading list with our margin notes is
filed alongside the spike reports.

### 11.4 Revision history of this RFC

Draft one circulated 2026-02-09
and proposed pure option C; the review pushed back hard on producer cost
and the draft did not survive contact with the inventory's long tail.
Draft two, 2026-03-02, introduced the hybrid and drew the
money-and-custody line, and most of the review energy went into the
retention debate recorded in section 7.6. Draft three, 2026-03-30, added
the kill criterion in section 9.6 at finance's request and tightened the
phase gates from intentions into measurements. Acceptance followed on
2026-04-17 with two dissents recorded in the forum notes, both
preferring pure option B on cost grounds, both satisfied that the kill
criterion gives their position a road back should the model prove
optimistic.

### 11.5 How the incident tally was counted

The 38 and 22 figures in section 2.3 come from a manual review of every
customer-visible incident in the trailing twelve months, done by two
people independently with disagreements argued out in a third session,
rather than from incident-tracker labels, which we found miss
attribution badly in both directions. An incident counted as
window-related only when the corrective action touched a batch job, its
schedule, or its output tables; near misses and internal-only incidents
were excluded, which makes 22 a floor rather than an estimate. The
mean-time-to-detect comparison in section 3.2 uses the tracker's own
timestamps and is therefore only as good as the on-call habit of filing
promptly, a caveat that cuts both ways and that we judged too small to
change the conclusion. The full worksheet, with each incident's
classification and the two cases the reviewers could not agree on, is
filed beside the spike reports.
