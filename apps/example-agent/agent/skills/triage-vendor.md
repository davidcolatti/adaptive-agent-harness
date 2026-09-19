---
description: Use when triaging a vendor against a procurement SOP and a decision on category, risk flags, missing information, and a recommendation is needed.
---

# Triage a vendor against the procurement SOP

Work through these steps in order. Each step names what it produces, so a
partial answer is still an honest one.

## 1. Gather the evidence

Call `lookup_vendor_evidence` with the vendor name exactly as the request gave
it. Add any evidence text the request itself supplied.

If the lookup returns `status: "unknown"`, stop gathering. Report that no
evidence is on file, list the vendors that are, and treat every SOP requirement
as missing information.

## 2. Categorize

Name what the vendor sells, using the SOP's categories. If no category fits,
say which two it sits between and why, rather than forcing one.

## 3. Read the SOP as a checklist

Turn the SOP into its individual requirements. For each requirement, mark it:

- **met** — a specific document establishes it. Cite the document.
- **not established** — no document speaks to it. This is missing information.
- **contradicted** — a document conflicts with the requirement. This is a risk
  flag.

Silence is "not established". It is never "met".

## 4. Raise risk flags

A risk flag is a specific concern tied to a specific SOP clause and a specific
piece of evidence. Common shapes:

- a control claimed but not evidenced, or evidenced at a weaker level than the
  SOP requires;
- a default setting that collects more than the stated purpose needs;
- a change to payment details, banking details, or contact domain;
- an absent legal document the SOP requires, such as a data processing
  agreement;
- an unnamed hosting region, retention period, or sub-processor.

Rank flags by what they would cost if true, not by how confident you are.

## 5. Recommend

Pick one and say why in a sentence:

- **proceed** — every SOP requirement is met by cited evidence.
- **proceed with conditions** — name each condition and who verifies it.
- **request information** — list the exact questions to send the vendor.
- **escalate** — name the reviewer and what they need to decide.

Never recommend proceeding while a risk flag is open. If the evidence cannot
support any of the four, say that instead of choosing the nearest one.

## 6. Show the evidence

List every source you used, with the claim it supports. A reader must be able
to check each conclusion without re-reading the whole file.
