# Stackmason Configuration Reference

This reference is generated from the stackmason 0.9 toolchain build and covers every
resource type, attribute, flag, environment variable, subcommand, and exit code in
the mason CLI. Regenerate with `mason gen-reference --format markdown` rather than
editing rows by hand, since the table layout below mirrors the same flag schema
that feeds `mason gen-reference --format json`.

> Resource catalog

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_network | resource | networking | - | - | 0.1 | Top-level address space for a stack |
| mason_subnet | resource | networking | - | - | 0.1 | Slice of a network pinned to one zone |
| mason_route | resource | networking | - | - | 0.2 | Static route attached to a subnet |
| mason_gateway | resource | networking | - | - | 0.2 | Egress or ingress edge for a network |
| mason_firewall_rule | resource | networking | - | - | 0.2 | Stateless packet filter entry |
| mason_instance | resource | compute | - | - | 0.1 | Single virtual machine |
| mason_instance_pool | resource | compute | - | - | 0.3 | Autoscaled group of identical instances |
| mason_volume | resource | storage | - | - | 0.1 | Block device attachable to one instance |
| mason_snapshot_plan | resource | storage | - | - | 0.4 | Scheduled point-in-time captures of a volume |
| mason_bucket | resource | storage | - | - | 0.2 | Object store namespace |
| mason_bucket_policy | resource | storage | - | - | 0.5 | Access grants scoped to one bucket |
| mason_keystore | resource | secrets | - | - | 0.3 | Encrypted store for runtime secrets |
| mason_keystore_entry | resource | secrets | - | - | 0.3 | Single named secret inside a keystore |
| mason_registry | resource | compute | - | - | 0.5 | Private image registry for stack workloads |
| mason_dns_zone | resource | dns | - | - | 0.4 | Delegated zone served by platform resolvers |
| mason_dns_record | resource | dns | - | - | 0.4 | Record set inside a zone |
| mason_cert | resource | dns | - | - | 0.6 | Managed TLS certificate with auto renewal |
| mason_queue | resource | messaging | - | - | 0.6 | At-least-once delivery queue |
| mason_topic | resource | messaging | - | - | 0.6 | Fan-out channel feeding many queues |
| mason_function | resource | compute | - | - | 0.7 | Event-driven unit of compute |
| mason_log_sink | resource | observability | - | - | 0.7 | Stream of platform logs routed to a target |
| mason_alarm | resource | observability | - | - | 0.8 | Threshold watch over a metric series |

---

> mason_network attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_network.name | attribute | string | - | yes | 0.1 | Display name, unique per region |
| mason_network.cidr_block | attribute | string | - | yes | 0.1 | Address range in CIDR form |
| mason_network.region | attribute | string | - | yes | 0.1 | Region code such as qc-east-1 |
| mason_network.dns_enabled | attribute | bool | true | no | 0.4 | Toggles the built-in resolver |
| mason_network.mtu | attribute | int | 1500 | no | 0.2 | Packet size ceiling for the address space |
| mason_network.labels | attribute | map | {} | no | 0.1 | Free-form key value pairs |
| mason_network.flow_logs | attribute | bool | false | no | 0.5 | Mirrors connection metadata to a log sink |
| mason_network.flow_sink_id | attribute | string | - | no | 0.5 | Target sink, needed only with flow_logs |
| mason_network.ipv6 | attribute | bool | false | no | 0.6 | Adds a routed v6 block alongside v4 |
| mason_network.shared | attribute | bool | false | no | 0.7 | Exposes the network to peer stacks |
| mason_network.peer_ids | attribute | list | [] | no | 0.7 | Networks accepted for peering |
| mason_network.id | attribute | string | - | - | 0.1 | Computed identifier, read only |

> mason_subnet attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_subnet.name | attribute | string | - | yes | 0.1 | Display name, unique per network |
| mason_subnet.network_id | attribute | string | - | yes | 0.1 | Parent network reference |
| mason_subnet.cidr_block | attribute | string | - | yes | 0.1 | Range carved from the parent block |
| mason_subnet.zone | attribute | string | - | yes | 0.1 | Zone letter within the region |
| mason_subnet.public | attribute | bool | false | no | 0.2 | Assigns routable addresses to attached NICs |
| mason_subnet.nat_enabled | attribute | bool | false | no | 0.3 | Routes egress through the zone NAT pool |
| mason_subnet.route_ids | attribute | list | [] | no | 0.2 | Static routes applied in order |
| mason_subnet.labels | attribute | map | {} | no | 0.1 | Free-form key value pairs |
| mason_subnet.id | attribute | string | - | - | 0.1 | Computed identifier, read only |

> mason_route attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_route.subnet_id | attribute | string | - | yes | 0.2 | Subnet that carries the route |
| mason_route.dest_cidr | attribute | string | - | yes | 0.2 | Destination range to match |
| mason_route.next_hop | attribute | string | - | yes | 0.2 | Gateway id or literal address |
| mason_route.priority | attribute | int | 100 | no | 0.2 | Lower values win on overlap |
| mason_route.enabled | attribute | bool | true | no | 0.2 | Soft switch, the route stays in state when off |
| mason_route.comment | attribute | string | - | no | 0.3 | Operator note carried in state |
| mason_route.id | attribute | string | - | - | 0.2 | Computed identifier, read only |

> mason_gateway attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_gateway.name | attribute | string | - | yes | 0.2 | Display name, unique per network |
| mason_gateway.network_id | attribute | string | - | yes | 0.2 | Network the edge attaches to |
| mason_gateway.mode | attribute | enum | egress | no | 0.2 | One of egress, ingress, dual |
| mason_gateway.bandwidth_mbps | attribute | int | 1000 | no | 0.3 | Throughput ceiling in megabits |
| mason_gateway.static_ip | attribute | bool | false | no | 0.3 | Pins a stable public address |
| mason_gateway.zone | attribute | string | - | no | 0.2 | Placement hint, spread across zones when unset |
| mason_gateway.labels | attribute | map | {} | no | 0.2 | Free-form key value pairs |
| mason_gateway.id | attribute | string | - | - | 0.2 | Computed identifier, read only |

> mason_firewall_rule attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_firewall_rule.network_id | attribute | string | - | yes | 0.2 | Network whose edge applies the filter |
| mason_firewall_rule.direction | attribute | enum | inbound | no | 0.2 | One of inbound, outbound |
| mason_firewall_rule.protocol | attribute | enum | tcp | no | 0.2 | One of tcp, udp, icmp, any |
| mason_firewall_rule.port_range | attribute | string | - | no | 0.2 | Single port or a low high span |
| mason_firewall_rule.source_cidrs | attribute | list | [] | no | 0.2 | Ranges matched on the source side |
| mason_firewall_rule.dest_cidrs | attribute | list | [] | no | 0.2 | Ranges matched on the destination side |
| mason_firewall_rule.action | attribute | enum | allow | no | 0.2 | One of allow, deny, log-only |
| mason_firewall_rule.priority | attribute | int | 1000 | no | 0.2 | Lower values evaluate first |
| mason_firewall_rule.stateful | attribute | bool | false | no | 0.8 | Tracks established flows for return traffic |
| mason_firewall_rule.id | attribute | string | - | - | 0.2 | Computed identifier, read only |

> mason_instance attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_instance.name | attribute | string | - | yes | 0.1 | Display name, unique per stack |
| mason_instance.subnet_id | attribute | string | - | yes | 0.1 | Subnet hosting the primary NIC |
| mason_instance.shape | attribute | string | - | yes | 0.1 | Size class such as m2.large |
| mason_instance.image | attribute | string | - | yes | 0.1 | Boot image slug or registry digest |
| mason_instance.key_name | attribute | string | - | no | 0.1 | SSH key pair registered with the provider |
| mason_instance.user_data | attribute | string | - | no | 0.2 | Cloud-init payload, capped at 16 KiB |
| mason_instance.private_ip | attribute | string | - | no | 0.2 | Fixed address inside the subnet range |
| mason_instance.public_ip | attribute | bool | false | no | 0.2 | Attaches a routable address at boot |
| mason_instance.volume_ids | attribute | list | [] | no | 0.1 | Block devices attached in listed order |
| mason_instance.nic_count | attribute | int | 1 | no | 0.3 | Extra NICs land in the same subnet |
| mason_instance.burst_mode | attribute | bool | false | no | 0.5 | Unlocks short CPU bursts above baseline |
| mason_instance.shutdown_grace | attribute | duration | 90s | no | 0.4 | Window between signal and hard stop |
| mason_instance.placement_group | attribute | string | - | no | 0.6 | Spreads or packs members by group setting |
| mason_instance.credentials_name | attribute | string | - | no | 0.6 | Named credential set granted to the guest |
| mason_instance.labels | attribute | map | {} | no | 0.1 | Free-form key value pairs |
| mason_instance.id | attribute | string | - | - | 0.1 | Computed identifier, read only |

> mason_instance_pool attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_instance_pool.name | attribute | string | - | yes | 0.3 | Display name, unique per stack |
| mason_instance_pool.template | attribute | map | - | yes | 0.3 | Instance attributes stamped onto each member |
| mason_instance_pool.min_size | attribute | int | 1 | no | 0.3 | Floor held during scale-in |
| mason_instance_pool.max_size | attribute | int | 3 | no | 0.3 | Ceiling held during scale-out |
| mason_instance_pool.desired | attribute | int | - | no | 0.3 | Manual override between floor and ceiling |
| mason_instance_pool.scale_metric | attribute | enum | cpu | no | 0.4 | One of cpu, memory, queue_depth |
| mason_instance_pool.scale_up_at | attribute | int | 70 | no | 0.4 | Percent threshold that adds a member |
| mason_instance_pool.scale_down_at | attribute | int | 30 | no | 0.4 | Percent threshold that removes a member |
| mason_instance_pool.cooldown | attribute | duration | 300s | no | 0.4 | Quiet period between scaling moves |
| mason_instance_pool.drain_window | attribute | duration | 120s | no | 0.5 | Time given to connections before a member exits |
| mason_instance_pool.id | attribute | string | - | - | 0.3 | Computed identifier, read only |

> mason_volume attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_volume.name | attribute | string | - | yes | 0.1 | Display name, unique per stack |
| mason_volume.size_gb | attribute | int | - | yes | 0.1 | Capacity in gibibytes, growable in place |
| mason_volume.zone | attribute | string | - | yes | 0.1 | Zone shared with the attached instance |
| mason_volume.iops | attribute | int | 3000 | no | 0.2 | Provisioned operations per second |
| mason_volume.throughput_mbps | attribute | int | 125 | no | 0.2 | Provisioned bandwidth in megabytes |
| mason_volume.encrypted | attribute | bool | true | no | 0.1 | At-rest encryption, fixed after create |
| mason_volume.cipher | attribute | enum | aes256 | no | 0.3 | One of aes256, chacha20 |
| mason_volume.source_snapshot | attribute | string | - | no | 0.4 | Snapshot id used to seed the device |
| mason_volume.labels | attribute | map | {} | no | 0.1 | Free-form key value pairs |
| mason_volume.id | attribute | string | - | - | 0.1 | Computed identifier, read only |

> mason_snapshot_plan attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_snapshot_plan.volume_id | attribute | string | - | yes | 0.4 | Volume captured by the plan |
| mason_snapshot_plan.cadence | attribute | enum | daily | no | 0.4 | One of hourly, daily, weekly |
| mason_snapshot_plan.window | attribute | string | 03:00 | no | 0.4 | Start of the capture window in region local time |
| mason_snapshot_plan.retain_count | attribute | int | 7 | no | 0.4 | Captures kept before the oldest is pruned |
| mason_snapshot_plan.cross_region | attribute | string | - | no | 0.8 | Region code receiving replica captures |
| mason_snapshot_plan.paused | attribute | bool | false | no | 0.5 | Suspends the schedule without dropping history |
| mason_snapshot_plan.id | attribute | string | - | - | 0.4 | Computed identifier, read only |

> mason_bucket attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_bucket.name | attribute | string | - | yes | 0.2 | Namespace, unique across the region |
| mason_bucket.region | attribute | string | - | yes | 0.2 | Region code hosting the namespace |
| mason_bucket.acl | attribute | enum | private | no | 0.2 | One of private, authenticated, public-read |
| mason_bucket.versioning | attribute | bool | false | no | 0.3 | Retains prior object generations on overwrite |
| mason_bucket.lifecycle_days | attribute | int | - | no | 0.3 | Age at which objects move to cold storage |
| mason_bucket.encryption | attribute | enum | aes256 | no | 0.2 | At-rest cipher applied to every object |
| mason_bucket.quota_gb | attribute | int | - | no | 0.5 | Hard cap on stored bytes |
| mason_bucket.cors_origins | attribute | list | [] | no | 0.4 | Origins accepted by the object endpoint |
| mason_bucket.index_object | attribute | string | - | no | 0.6 | Object served at the namespace root |
| mason_bucket.error_object | attribute | string | - | no | 0.6 | Object served on a missing key |
| mason_bucket.labels | attribute | map | {} | no | 0.2 | Free-form key value pairs |
| mason_bucket.id | attribute | string | - | - | 0.2 | Computed identifier, read only |

> mason_bucket_policy attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_bucket_policy.bucket_id | attribute | string | - | yes | 0.5 | Bucket receiving the grants |
| mason_bucket_policy.principals | attribute | list | - | yes | 0.5 | Account ids or role slugs granted access |
| mason_bucket_policy.actions | attribute | list | - | yes | 0.5 | Verbs granted, such as get, put, list |
| mason_bucket_policy.prefix | attribute | string | - | no | 0.5 | Key prefix narrowing the grant |
| mason_bucket_policy.effect | attribute | enum | grant | no | 0.5 | One of grant, deny |
| mason_bucket_policy.id | attribute | string | - | - | 0.5 | Computed identifier, read only |

> mason_keystore attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_keystore.name | attribute | string | - | yes | 0.3 | Display name, unique per region |
| mason_keystore.region | attribute | string | - | yes | 0.3 | Region code holding the encrypted material |
| mason_keystore.rotation_days | attribute | int | 90 | no | 0.3 | Window between automatic key rotations |
| mason_keystore.cipher | attribute | enum | aes256 | no | 0.3 | One of aes256, chacha20 |
| mason_keystore.access_log | attribute | bool | true | no | 0.4 | Writes read events to the audit stream |
| mason_keystore.recovery_days | attribute | int | 14 | no | 0.5 | Soft-delete window before purge |
| mason_keystore.admin_principals | attribute | list | [] | no | 0.3 | Identities that manage entries |
| mason_keystore.labels | attribute | map | {} | no | 0.3 | Free-form key value pairs |
| mason_keystore.id | attribute | string | - | - | 0.3 | Computed identifier, read only |

> mason_keystore_entry attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_keystore_entry.keystore_id | attribute | string | - | yes | 0.3 | Parent keystore reference |
| mason_keystore_entry.key | attribute | string | - | yes | 0.3 | Entry name, unique inside the keystore |
| mason_keystore_entry.value | attribute | string | - | yes | 0.3 | Secret material, write only in plans |
| mason_keystore_entry.content_type | attribute | string | text | no | 0.4 | Hint stored alongside the entry |
| mason_keystore_entry.expires_at | attribute | string | - | no | 0.5 | Timestamp after which reads are refused |
| mason_keystore_entry.rev | attribute | int | - | - | 0.3 | Monotonic revision, computed |
| mason_keystore_entry.id | attribute | string | - | - | 0.3 | Computed identifier, read only |

> mason_registry attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_registry.name | attribute | string | - | yes | 0.5 | Registry slug, unique per region |
| mason_registry.region | attribute | string | - | yes | 0.5 | Region code hosting the layers |
| mason_registry.immutable_tags | attribute | bool | false | no | 0.5 | Locks a tag once pushed |
| mason_registry.scan_on_push | attribute | bool | true | no | 0.6 | Queues a vulnerability scan for new layers |
| mason_registry.retain_untagged_days | attribute | int | 30 | no | 0.6 | Age at which untagged layers are pruned |
| mason_registry.pull_principals | attribute | list | [] | no | 0.5 | Identities granted read access |
| mason_registry.push_principals | attribute | list | [] | no | 0.5 | Identities granted write access |
| mason_registry.id | attribute | string | - | - | 0.5 | Computed identifier, read only |

> mason_dns_zone attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_dns_zone.domain | attribute | string | - | yes | 0.4 | Apex name served by the zone |
| mason_dns_zone.visibility | attribute | enum | public | no | 0.4 | One of public, internal |
| mason_dns_zone.network_ids | attribute | list | [] | no | 0.4 | Networks that see an internal zone |
| mason_dns_zone.default_ttl | attribute | int | 300 | no | 0.4 | Cache lifetime applied when records omit one |
| mason_dns_zone.dnssec | attribute | bool | false | no | 0.7 | Signs the zone with platform managed keys |
| mason_dns_zone.labels | attribute | map | {} | no | 0.4 | Free-form key value pairs |
| mason_dns_zone.id | attribute | string | - | - | 0.4 | Computed identifier, read only |

> mason_dns_record attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_dns_record.zone_id | attribute | string | - | yes | 0.4 | Zone holding the record set |
| mason_dns_record.name | attribute | string | - | yes | 0.4 | Label relative to the apex, @ for the apex itself |
| mason_dns_record.rtype | attribute | enum | A | yes | 0.4 | One of A, AAAA, CNAME, MX, TXT, SRV, NS |
| mason_dns_record.values | attribute | list | - | yes | 0.4 | Payload lines for the record set |
| mason_dns_record.ttl | attribute | int | - | no | 0.4 | Cache lifetime, falls back to the zone default |
| mason_dns_record.weight | attribute | int | - | no | 0.8 | Spread ratio across duplicate names |
| mason_dns_record.health_check_id | attribute | string | - | no | 0.8 | Probe gating the record in answers |
| mason_dns_record.id | attribute | string | - | - | 0.4 | Computed identifier, read only |

> mason_cert attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_cert.domains | attribute | list | - | yes | 0.6 | Names covered, wildcards accepted at one level |
| mason_cert.zone_id | attribute | string | - | yes | 0.6 | Zone used for issuance challenges |
| mason_cert.key_alg | attribute | enum | ecdsa256 | no | 0.6 | One of ecdsa256, rsa2048, rsa4096 |
| mason_cert.renew_days | attribute | int | 30 | no | 0.6 | Days before expiry that renewal starts |
| mason_cert.transparency_log | attribute | bool | true | no | 0.7 | Submits issued certs to public CT logs |
| mason_cert.status | attribute | string | - | - | 0.6 | Computed lifecycle state |
| mason_cert.not_after | attribute | string | - | - | 0.6 | Computed expiry timestamp |
| mason_cert.id | attribute | string | - | - | 0.6 | Computed identifier, read only |

> mason_queue attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_queue.name | attribute | string | - | yes | 0.6 | Queue slug, unique per region |
| mason_queue.region | attribute | string | - | yes | 0.6 | Region code hosting the brokers |
| mason_queue.visibility_timeout | attribute | duration | 30s | no | 0.6 | Hold window after a message is leased |
| mason_queue.retention | attribute | duration | 96h | no | 0.6 | Age at which unread messages are dropped |
| mason_queue.max_size_kb | attribute | int | 256 | no | 0.6 | Payload ceiling per message |
| mason_queue.dead_letter_id | attribute | string | - | no | 0.7 | Queue receiving messages past the lease cap |
| mason_queue.max_receives | attribute | int | 5 | no | 0.7 | Lease count before dead-letter handoff |
| mason_queue.fifo | attribute | bool | false | no | 0.8 | Ordered delivery within a message group |
| mason_queue.id | attribute | string | - | - | 0.6 | Computed identifier, read only |

> mason_topic attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_topic.name | attribute | string | - | yes | 0.6 | Topic slug, unique per region |
| mason_topic.region | attribute | string | - | yes | 0.6 | Region code hosting the brokers |
| mason_topic.subscriber_ids | attribute | list | [] | no | 0.6 | Queues fed by the fan-out |
| mason_topic.filter_keys | attribute | list | [] | no | 0.7 | Message keys that gate each subscriber |
| mason_topic.ordering | attribute | bool | false | no | 0.8 | Per-key ordering across subscribers |
| mason_topic.id | attribute | string | - | - | 0.6 | Computed identifier, read only |

> mason_function attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_function.name | attribute | string | - | yes | 0.7 | Display name, unique per stack |
| mason_function.runtime | attribute | enum | node20 | yes | 0.7 | One of node20, python312, go122 |
| mason_function.entrypoint | attribute | string | - | yes | 0.7 | Module and symbol invoked per event |
| mason_function.source_bucket | attribute | string | - | yes | 0.7 | Bucket holding the packaged artifact |
| mason_function.source_key | attribute | string | - | yes | 0.7 | Object key of the packaged artifact |
| mason_function.memory_mb | attribute | int | 256 | no | 0.7 | Memory ceiling, CPU scales with it |
| mason_function.timeout | attribute | duration | 60s | no | 0.7 | Hard stop per invocation |
| mason_function.env | attribute | map | {} | no | 0.7 | Plain variables injected at start |
| mason_function.secret_refs | attribute | list | [] | no | 0.7 | Keystore entries mounted as variables |
| mason_function.trigger_queue_id | attribute | string | - | no | 0.7 | Queue whose messages invoke the function |
| mason_function.min_warm | attribute | int | 0 | no | 0.8 | Instances held warm between bursts |
| mason_function.subnet_id | attribute | string | - | no | 0.8 | Subnet for egress when set |
| mason_function.id | attribute | string | - | - | 0.7 | Computed identifier, read only |

> mason_log_sink attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_log_sink.name | attribute | string | - | yes | 0.7 | Display name, unique per stack |
| mason_log_sink.sources | attribute | list | - | yes | 0.7 | Resource ids whose logs feed the stream |
| mason_log_sink.target_kind | attribute | enum | bucket | no | 0.7 | One of bucket, queue, https |
| mason_log_sink.target_id | attribute | string | - | yes | 0.7 | Bucket id, queue id, or endpoint by kind |
| mason_log_sink.filter | attribute | string | - | no | 0.7 | Match expression applied before shipping |
| mason_log_sink.sample_rate | attribute | int | 100 | no | 0.8 | Percent of matching lines shipped |
| mason_log_sink.format | attribute | enum | jsonl | no | 0.7 | One of jsonl, syslog |
| mason_log_sink.id | attribute | string | - | - | 0.7 | Computed identifier, read only |

> mason_alarm attributes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| mason_alarm.name | attribute | string | - | yes | 0.8 | Display name, unique per stack |
| mason_alarm.metric | attribute | string | - | yes | 0.8 | Series watched, such as cpu.percent |
| mason_alarm.resource_id | attribute | string | - | yes | 0.8 | Resource emitting the series |
| mason_alarm.threshold | attribute | int | - | yes | 0.8 | Boundary that trips the alarm |
| mason_alarm.comparison | attribute | enum | above | no | 0.8 | One of above, below |
| mason_alarm.window | attribute | duration | 300s | no | 0.8 | Span the series is averaged over |
| mason_alarm.notify_topic_id | attribute | string | - | no | 0.8 | Topic receiving state changes |
| mason_alarm.id | attribute | string | - | - | 0.8 | Computed identifier, read only |

---

> Subcommands

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| init | command | - | - | - | 0.1 | Creates a stack file and the local cache layout |
| plan | command | - | - | - | 0.1 | Computes a change set against recorded state |
| apply | command | - | - | - | 0.1 | Executes a change set and updates state |
| destroy | command | - | - | - | 0.1 | Tears down every resource in the stack |
| diff | command | - | - | - | 0.2 | Prints drift between live and recorded state |
| fmt | command | - | - | - | 0.2 | Rewrites stack files in the standard layout |
| lint | command | - | - | - | 0.3 | Flags structural problems without contacting the provider |
| state | command | - | - | - | 0.2 | Inspects or edits individual state records |
| import | command | - | - | - | 0.4 | Adopts an existing live resource into state |
| output | command | - | - | - | 0.2 | Prints declared outputs from the latest apply |
| graph | command | - | - | - | 0.5 | Emits the dependency graph in DOT form |
| login | command | - | - | - | 0.3 | Stores a provider token in the OS keyring |
| logout | command | - | - | - | 0.3 | Removes the stored provider token |
| providers | command | - | - | - | 0.5 | Lists provider plugins and their pinned digests |
| gen-reference | command | - | - | - | 0.9 | Regenerates this file from the flag schema |

> Global flags

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| --stack | flag | string | stack.mn | no | 0.1 | Path to the stack file |
| --state | flag | string | .mason/state.db | no | 0.1 | Path to the local state record |
| --region | flag | string | - | no | 0.1 | Overrides the region from the stack file |
| --var | flag | list | [] | no | 0.1 | Inline variable as key=value, repeatable |
| --var-file | flag | string | - | no | 0.2 | File of variables merged after inline ones |
| --out | flag | string | - | no | 0.1 | Writes the change set to a file instead of applying |
| --json | flag | bool | false | no | 0.2 | Machine readable output on stdout |
| --quiet | flag | bool | false | no | 0.2 | Suppresses progress lines, errors still print |
| --log-level | flag | enum | warn | no | 0.2 | One of debug, info, warn, error |
| --log-file | flag | string | - | no | 0.3 | Mirrors log lines to a path |
| --no-color | flag | bool | false | no | 0.1 | Disables ANSI styling |
| --parallelism | flag | int | 10 | no | 0.3 | Concurrent resource operations per apply |
| --timeout | flag | duration | 30m | no | 0.3 | Wall clock budget for the whole command |
| --lock-timeout | flag | duration | 60s | no | 0.4 | Wait budget for the state lock |
| --backend | flag | enum | local | no | 0.4 | One of local, bucket, http |
| --cache-dir | flag | string | ~/.mason/cache | no | 0.2 | Plugin and module cache location |
| --plugin-dir | flag | string | - | no | 0.5 | Extra directory searched for provider plugins |
| --yes | flag | bool | false | no | 0.1 | Answers every confirmation prompt with yes |

> Flags for plan and apply

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| --target | flag | list | [] | no | 0.3 | Narrows the change set to listed addresses, repeatable |
| --refresh | flag | bool | true | no | 0.3 | Reconciles state with live values before planning |
| --replace | flag | list | [] | no | 0.5 | Forces destroy and recreate for listed addresses |
| --destroy | flag | bool | false | no | 0.1 | Plans a full teardown instead of an update |
| --detailed-exit | flag | bool | false | no | 0.4 | Exit code 2 signals pending changes |
| --plan-file | flag | string | - | no | 0.4 | Applies a saved change set verbatim |
| --auto-retry | flag | int | 0 | no | 0.6 | Retries transient provider faults per resource |
| --window | flag | string | - | no | 0.7 | Defers apply until the maintenance window opens |
| --checkpoint | flag | bool | true | no | 0.6 | Writes state after each resource instead of at the end |
| --graph-order | flag | enum | parallel | no | 0.5 | One of parallel, serial |
| --skip-hooks | flag | bool | false | no | 0.8 | Bypasses before and after hooks declared in the stack |

---

> Environment variables

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| MASON_TOKEN | env | string | - | yes | 0.1 | Provider API token, wins over the keyring entry |
| MASON_REGION | env | string | - | no | 0.1 | Fallback region when the stack file omits one |
| MASON_STACK | env | string | - | no | 0.2 | Overrides the default stack file path |
| MASON_STATE_BACKEND | env | enum | local | no | 0.4 | Same values as --backend |
| MASON_STATE_BUCKET | env | string | - | no | 0.4 | Bucket id used by the bucket backend |
| MASON_LOG_LEVEL | env | enum | warn | no | 0.2 | Same values as --log-level |
| MASON_NO_COLOR | env | bool | false | no | 0.1 | Any non-empty value disables styling |
| MASON_CACHE_DIR | env | string | ~/.mason/cache | no | 0.2 | Overrides the cache location |
| MASON_PLUGIN_DIR | env | string | - | no | 0.5 | Extra plugin directory, joins the search path |
| MASON_PARALLELISM | env | int | 10 | no | 0.3 | Same as --parallelism |
| MASON_TIMEOUT | env | duration | 30m | no | 0.3 | Same as --timeout |
| MASON_LOCK_TIMEOUT | env | duration | 60s | no | 0.4 | Same as --lock-timeout |
| MASON_KEYRING | env | enum | auto | no | 0.3 | One of auto, file, none |
| MASON_HTTP_PROXY | env | string | - | no | 0.2 | Proxy for plain HTTP provider calls |
| MASON_HTTPS_PROXY | env | string | - | no | 0.2 | Proxy for TLS provider calls |
| MASON_CA_BUNDLE | env | string | - | no | 0.5 | Extra root certificates for provider TLS |
| MASON_TELEMETRY | env | bool | false | no | 0.6 | Opt-in usage counters, off by default |

> Exit codes

| Entry | Kind | Type | Default | Req | Since | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | exit | int | - | - | 0.1 | Clean exit, no pending changes |
| 1 | exit | int | - | - | 0.1 | General fault, details on stderr |
| 2 | exit | int | - | - | 0.4 | Pending changes found with --detailed-exit |
| 3 | exit | int | - | - | 0.2 | Stack file rejected by the loader |
| 4 | exit | int | - | - | 0.2 | Variable missing or past a constraint check |
| 5 | exit | int | - | - | 0.3 | Auth token absent, expired, or refused |
| 6 | exit | int | - | - | 0.3 | State lock held by another runner past the wait budget |
| 7 | exit | int | - | - | 0.4 | Plan file digest differs from the stack on disk |
| 8 | exit | int | - | - | 0.5 | Provider quota or rate ceiling reached |
| 9 | exit | int | - | - | 0.5 | Provider endpoint unreachable through retries |
| 10 | exit | int | - | - | 0.6 | Partial apply, state saved at the last checkpoint |
| 12 | exit | int | - | - | 0.8 | Plugin digest differs from the pinned value |

> Generated 2026-06-08 by mason 0.9.4+build.1f3c2ab from the qc-east-1 schema set
