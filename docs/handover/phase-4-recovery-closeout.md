# Phase 4 Recovery Close-Out Handover

## Scope and architecture

Phase 4 provides authenticated encrypted `.fmz` exports, verification and preview before mutation, isolated staging-database restore, crash-safe promotion, verified rollback, and startup recovery. Native safety snapshots use Expo SQLite's typed backup API and fail closed if that native API throws. Jest coverage using mocked Expo SQLite or filesystem APIs is classified as automated simulation, not native runtime QA.

The backup envelope remains format version **1** (`BMZ1`, AES-256-GCM authenticated encryption with the existing bounded KDF parameters). The restore journal is a separate, checksummed format and is now version **2**.

## Released migration immutability

Migrations 001–007 are frozen exactly as released at commit `d6402bb1543b64bce0ca6a9a940fd760c7791ed5`. Schema changes must be introduced in a later numbered migration; Phase 4 close-out requires no Migration 008.

Two distinct protections apply:

- Database-ledger checksums in `schema_migrations` verify the identity recorded for applied migrations.
- The frozen-source Jest fixture hashes both each reference `.sql` file and each executable `.ts` migration implementation. It normalizes only CRLF/CR/LF line endings and retains all other source content, so edits to either representation fail CI.

## Restore journal format version 2

The journal envelope contains `version`, a SHA-256 checksum of the canonical payload, and the payload. The payload contains a cryptographically random operation ID, monotonically increasing generation, validated application-owned paths, current phase, update timestamp, recovery source when applicable, completion identity, and two independent full portable-data digests:

- `expectedOriginalPortableDigest`
- `expectedDestinationPortableDigest`

Version-1 or otherwise unsupported journals remain recovery artifacts. They are never treated as absent or accepted as proof of a complete portable identity; automatic recovery fails closed and preserves candidates.

## Transition table

| Persisted phase | Permitted successor(s) | Meaning before the next dependent action |
|---|---|---|
| `initialized` | `active_moved_to_old`, `rollback_candidate_verified`, `rollback_restored_verified` | Both identities and all paths are durably recorded before the active database is moved. |
| `active_moved_to_old` | `staging_moved_to_active`, `rollback_candidate_verified` | The original has been moved to `.old_*`; this state is persisted before staging promotion. |
| `staging_moved_to_active` | `activation_verified`, `rollback_candidate_verified` | Staging has been promoted; this state is persisted before activation acceptance or rollback. |
| `activation_verified` | `complete`, `rollback_candidate_verified` | Active integrity, foreign keys, invariants, and destination identity passed. |
| `rollback_candidate_verified` | `rollback_restored_verified` | The selected `.old_*` or snapshot candidate matches the original identity before active replacement. |
| `rollback_restored_verified` | `complete` | Restored active data matches the original identity. |
| `complete` | none | The selected completion identity is reverified before journal/candidate cleanup. |

Skipped, backward, repeated, unknown, stale-generation, wrong-operation, and post-completion transitions are rejected with non-sensitive `RESTORE_ERR_RECOVERY_REQUIRED`. Phase changes occur only through the central transition function, which verifies both the prior persisted generation and the newly persisted generation.

## Portable identity rules

Portable identity is deterministic SHA-256 over the canonical checksum set for `accounts`, `categories`, `transactions`, `counterparties`, `debts`, and `debt_transactions`. A transactions-table checksum alone is never accepted as a full identity.

Before movement, the live database is checkpointed and read consistently to capture the original identity. Staging and promoted active data must match the destination identity. `.old_*` and safety-snapshot candidates must match the original identity before selection, and restored active data must match it again before rollback completion. SQLite integrity and foreign-key checks are always additional requirements, never identity substitutes. Old recovery data is deleted only after verified destination completion or verified original rollback completion.

## Recovery outcomes

- Successful destination activation: destination identity verified, transition reaches `complete`, then obsolete recovery files and journal are removed.
- Verified rollback: original candidate and restored active identity verified; caller receives `RESTORE_ERR_ROLLBACK_SUCCEEDED` with the existing truthful outcome value.
- Candidate available but not provable: journal and candidates are preserved for manual recovery.
- Corrupt, unsupported, stale, interrupted, or illegal journal transition: fail closed with `RESTORE_ERR_RECOVERY_REQUIRED` and preserve candidates.
- No provable recovery candidate: `RESTORE_ERR_ROLLBACK_FAILED` or recovery-required handling remains a manual recovery condition.

## Verification and QA status

- Automated Jest, TypeScript, lint, whitespace, web export, and Android prebuild checks: required for the close-out commit and recorded in its delivery report.
- Native Android backup/restore/restart/failure-injection QA: **UNVERIFIED**. No emulator or physical device was used for this close-out. Android prebuild is not runtime QA and this remains an Android release blocker.
- Web application SQLite/WASM persistence in a real browser: **UNVERIFIED** and remains a web persistence release blocker. Native backup and restore actions are disabled on web; web persistence QA is a separate concern.

## Latest Phase 4 commit

The latest Phase 4 change is the commit containing this handover, with subject `fix: close Phase 4 recovery integrity gaps`. Its parent/base is `d6402bb1543b64bce0ca6a9a940fd760c7791ed5`; the delivery report records the resulting full commit SHA and GitHub URL.

## Remaining release blockers

- Complete native Android runtime recovery QA on a real emulator or physical device.
- Complete web SQLite/WASM persistence QA in a real supported browser environment if web release is in scope.

No passphrases, personal financial records, database contents, or secrets are included in this handover.
