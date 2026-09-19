/**
 * The procurement SOP the vendor-triage domain triages against.
 *
 * It is one of the three inputs Milestone 1's neutral reference job specifies
 * ("vendor name, vendor website text / fixture evidence, procurement SOP"), so
 * it is data a caller supplies rather than something the agent knows. This
 * module exists so the domain's fixture evals have a realistic one to pass in;
 * a real consuming domain would read its own from wherever it keeps it.
 *
 * Invented, like the vendors it is applied to. It deliberately states
 * requirements that the three fixture vendors meet to different degrees, so the
 * "met / not established / contradicted" distinction in
 * `agent/skills/triage-vendor.md` has something to bite on.
 */
export const PROCUREMENT_SOP = `# Procurement SOP v1.0

## Categories

Classify every vendor as one of: finance and accounting, product analytics,
logistics and freight, security tooling, or other. If none fits, say which two
the vendor sits between.

## Requirements

1. **Security assurance.** The vendor holds a current SOC 2 Type II report, or
   an equivalent independent assessment. A Type I report alone does not meet
   this requirement.
2. **Data processing agreement.** A published DPA with standard contractual
   clauses and a named sub-processor list.
3. **Data residency and retention.** The hosting region and the retention
   period after contract termination are both stated.
4. **Corporate identity.** A company registration number and a registered
   address are published.
5. **Payment integrity.** Any change to banking or payment details is verified
   out of band, through a previously known contact at the vendor's own domain.
6. **Service commitment.** A published uptime commitment and support hours.

## Approvers

- Finance and accounting, and logistics and freight: the finance director.
- Product analytics and security tooling: the data protection officer.
- Any open payment-integrity flag: the finance director, regardless of category.
`;
