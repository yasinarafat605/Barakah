# 18 — Change Log

---

## Revision 2 — 5 August 2026

**Trigger:** founder correction pass covering the product name, the approved brand package,
security language, and MVP scope.

**Application code changed: none. No code exists yet.** This was a documentation pass only.

### Summary

| Area | Revision 1 | Revision 2 |
|---|---|---|
| Product name | Friday Mizan | **Friday Amanah** |
| Tagline | Islamic Money Management, Made Simple. | **Manage Wealth with Purpose.** |
| AI assistant (future) | Mizan Guide | **Amanah Guide** |
| Logo | "The Balanced F" — assistant-proposed concept | **Approved shield + gold keyhole + F mark, supplied** |
| Palette | Friday parent colours + invented `#0E9F6E` | **8 approved Friday Amanah colours, unaltered** |
| Typography | "Inter replaces Poppins" | **Dual system: Poppins brand, Inter data, Noto Sans Bengali** |
| MVP routes | 84 | **42** |
| Test target | ~615 | **≈ 325, per-area and justified** |
| Security language | Deferral stated once, in doc 04 | **Enforceable vocabulary table, 7 banned phrases (doc 06 §0)** |
| Project folder | `D:\MyApps\friday-mizan` | **`D:\MyApps\friday-amanah`** |
| Documents | 17 | **19** |

### 1 · Naming

- Project folder renamed `friday-mizan` → `friday-amanah`.
- All product-facing occurrences replaced across every document: "Friday Mizan" → "Friday
  Amanah", "Mizan Guide" → "Amanah Guide", path references updated.
- **Preserved deliberately:** the word *mizan* wherever it is a religious or dictionary
  concept rather than a product name. After the rewrite of doc 09 §2 (which removed the
  "Balanced F" description containing the only such usage), **zero product-name occurrences
  remain and no dictionary usage was damaged** — verified by grep.
- Zakat methodology version `fm-zakat-1.0.0` → **`fa-zakat-1.0.0`**. No snapshots exist, so
  no data migration is needed.
- Scholar item **S-18** rewritten: was "use of the word Mizan", now "use of the word Amanah
  as a commercial product name". **S-18b added:** whether the shield-and-keyhole mark, read
  alongside "Amanah", could imply a religious guarantee of safekeeping the app cannot make.

### 2 · Brand

- Brand package located and fully inventoried: **55 files, 6 folders**, every PNG dimension
  read from the file rather than assumed. See doc 17 §2.
- **Doc 09 rewritten from scratch.** The "Balanced F" concept is deleted and marked void.
  `#0E9F6E` is deleted and appears nowhere in the project.
- The eight approved colours installed verbatim from `Friday_Amanah_Color_Palette.json`.
- **WCAG contrast measured for every colour against every surface.** Findings drove the
  semantic token layer: Deep Emerald `#087A62` is the accessible action colour on light
  (5.06 : 1); Emerald Green, Trust Gold, and Fresh Mint fail as light-mode text and are
  restricted to fills and dark-mode roles, where they measure 5.64, 7.53, and 8.87. **No
  colour was invented** — the palette already contained an accessible option for every role.
- Trust Gold constrained to a limited accent. Never a background, never body text.
- New doc 17: full asset inventory, integration map for 16 surfaces, metadata
  recommendations, and a missing-asset report.
- New `BrandMark` component specified — the only component permitted to render the logo,
  enforcing clear space and minimum size in code so the rules cannot be broken by accident.

### 3 · Typography

- Revision 1's claim that Inter replaces Poppins is **corrected**. Both are used, with
  documented separate roles.
- **Noto Sans Bengali** specified for Bangla, with reasoning covering conjunct shaping,
  cross-platform consistency, numerals, weights, and licensing.
- All three fonts are SIL OFL 1.1, bundled locally, ≈ 970 KB total. Alternatives considered
  and rejected are recorded — including SolaimanLipi, whose commercial embedding licence is
  unclear.
- Bangla line-height multiplier revised 1.15 → **1.18**.

### 4 · Security language

- **Doc 06 §0 added:** a table distinguishing seven protections that revision 1 risked
  blurring — OS device encryption, app sandbox, PIN/biometric access control,
  SecureStore secrets, encrypted backup, whole-database encryption, and E2E cloud sync.
- **Seven phrases banned** until the corresponding feature is implemented *and tested*,
  including "bank-grade encryption" and "fully encrypted local database".
- Accurate replacement phrasing supplied for use before Phase 7.
- Doc 04 corrected: it implied field-level encryption existed. **It does not.** Removed.
- Doc 01 §3.12 clarified: "encrypted backup" means the exported file, not the live database.
- **⚠️ Finding:** the supplied brand feature strip states *"Your data is encrypted and always
  protected."* That is currently false. Flagged in doc 17 §5.9 with corrected copy proposed.
  The asset is marketing-only and does not block Phase 1, but must not be published as-is.

### 5 · Scope

- **84 routes → 42.** 18 combined, 11 converted to sheets, 13 deferred. Doc 03 rewritten.
- Largest single win: **11 report screens → 1 parameterised `/reports/[type]`.**
- Settings reduced 19 → 5; simple pickers became bottom sheets, which is better UX anyway.
- Deferred to Phase 3: recurring-transaction management screen (the *flag* and the table stay
  in the MVP), notifications inbox. Removed: the disabled cloud-sync placeholder.
- **Zakat module reduced least — 15 → 10** — and both merges make the calculation easier to
  verify, not harder.
- **No financial safeguard removed.** Estimated saving: 6–9 weeks.

### 6 · Testing

- "~615 tests" replaced with per-area thresholds; working total ≈ **325**.
- Strict 100% branch coverage retained on money, balance, and Zakat domains, plus 95–100% on
  debt, backup, restore, security, migrations, and the delete-all path.
- Component coverage lowered 70% → 60%, **warning only** — snapshot-style component tests are
  low value and tend to be written to satisfy a number.
- **Doc 12 §3.3 added:** a direct answer on whether 100% branch coverage is meaningful, when
  it is not, and the rule that a dead defensive branch gets deleted rather than tested.
- E2E flows 15 → 12 by merging, not dropping. Five flows marked never-skip.

### 7 · Zakat

- Disclaimer replaced with the founder's approved wording, naming Friday Amanah as the
  calculating party.
- Bangla disclaimer rewritten to match, still pending native-speaker scholar review.
- **New rules added:** the disclaimer may never imply scholar endorsement, may never soften
  into reassurance, may never be collapsed behind a link on a screen showing a figure, and
  may never be omitted from an export.
- Result-screen mock-up updated to show the new wording.

### 8 · New architecture decision records

| ADR | Subject |
|---|---|
| **ADR-014** | Product name: Friday Amanah |
| **ADR-015** | Supplied brand package is the visual source of truth |
| **ADR-016** | Dual-font system: Poppins and Inter |
| **ADR-017** | Security claims may never exceed implemented, tested capability |
| **ADR-018** | MVP reduced from 84 routes to 42 |
| **ADR-019** | Test targets are per-area and justified, not a single number |

ADR-001 through ADR-013 remain in force, except where superseded above.

### 9 · Files changed

| File | Change |
|---|---|
| `README.md` | Tagline, revision note, doc index extended to 18, decisions list, open-decisions table |
| `01-product-requirements.md` | Name, tagline, name meaning, security wording note |
| `02-personas-and-journeys.md` | Name references only |
| `03-sitemap-and-navigation.md` | **Rewritten** — 84 → 42 routes with full analysis |
| `04-architecture.md` | Name; encryption paragraph corrected (removed the field-encryption implication) |
| `05-data-model.md` | No change needed — no product-name or brand references |
| `06-security-threat-model.md` | **§0 added** — security vocabulary and banned phrases |
| `07-privacy-model.md` | Mizan Guide → Amanah Guide |
| `08-zakat-design.md` | Disclaimer rewritten; version `fa-zakat-1.0.0`; result mock updated |
| `09-design-system.md` | **Rewritten** — approved logo, palette, dual-font system, measured accessibility |
| `10-folder-structure.md` | Path reference |
| `11-roadmap.md` | Name; Amanah Guide; revised scope and test figures |
| `12-testing-strategy.md` | **§2, §3, §5 rewritten** — targets, coverage answer, E2E flows |
| `13-risk-register.md` | Name references |
| `14-scholar-review-register.md` | S-18 rewritten, S-18b added |
| `15-phase-1-plan.md` | Paths, names, reduced scope, brand asset step |
| `16-architecture-decisions.md` | **ADR-014 – ADR-019 added** |
| `17-brand-assets-and-metadata.md` | **New** |
| `18-change-log.md` | **New** |

### 10 · Unresolved — founder decisions needed

1. **Android application ID / iOS bundle identifier.** Recommended
   `org.royalopencollege.fridayamanah`. Permanent once published. Do you control that domain,
   or should the ecosystem have its own?
2. **Deep-link scheme.** `fridayamanah://` recommended over `amanah://` on collision risk.
3. **Splash composition method** — doc 17 §5.1. Placement only, no artwork modification.
4. **Android adaptive icon recomposition** — doc 17 §5.2. The supplied icon-only mark is
   2514 × 3261 within a 4096 canvas and offset 90 px left of centre; used as-is the launcher
   would crop the shield. Scale-and-centre proposed; no redrawing.
5. **Three missing assets:** Android monochrome icon, 96 × 96 white notification icon,
   1200 × 630 social preview.
6. **Brand feature strip** must be re-exported with corrected security copy.
7. **Android phone available for testing?** Needed before Phase 1 Step 1.
8. **Bangla product copy writer.** Named in the risk register; not yet identified.
9. **Qualified scholar** for the doc 14 register. Not yet engaged.

---

## Revision 1 — 4 August 2026

Initial Phase 0 documentation set. 17 documents covering product requirements, personas,
sitemap, architecture, data model, security threat model, privacy model, Zakat design,
design system, folder structure, roadmap, testing strategy, risk register, scholar-review
register, Phase 1 plan, and 13 architecture decision records.

No application code written.
