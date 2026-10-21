// src/review/sampleReviewData.ts
// SAMPLE data for the review panel, generated from the cleaned (masked) files in "Cleaned Files":
//   conflicts      - the same IT Code with a different grade in the UR report and in SL x RP
//   opportunities  - open pipeline deals (YTD Pipeline). CRM-matched ones take their resources from SL x RP quote rows;
//                    "similar" ones copy a past SG project from ABCD + SL x RP (months moved to the deal's start);
//                    "manual" ones have neither.
//   currentDemand  - current project demand and its matches, from the matching lambda's matching_result.csv
//   people         - available resources (standardised positions only, so no names from position text appear)
// Only used while VITE_USE_SAMPLE_REVIEW=true or VITE_USE_MOCK=true. Do not edit by hand; regenerate it instead.

import type { ReviewData } from "./types";

export const SAMPLE_REVIEW: ReviewData = {
 "sourceFiles": [
  "Apr_26_to_Aug_26_BU_UR_Sample_Cleaned.xlsx",
  "SL_X_RP_SEA_BI_PII_Cleaned_v2.xlsx",
  "YTD_Pipeline_SEA_PII_Cleaned_v2.xlsx",
  "ABCD_to_BP_Jul26_PII_Cleaned_v2.xlsx",
  "matching_result.csv"
 ],
 "conflicts": [
  {
   "id": "C1",
   "entity": "Employee",
   "key": "genericcode5",
   "label": "Generic Resource 5",
   "field": "Grade",
   "options": [
    {
     "id": "a",
     "file": "Apr_26_to_Aug_26_BU_UR_Sample_Cleaned.xlsx",
     "value": "Band 3",
     "location": "Export, row 27 (Aug 2026)"
    },
    {
     "id": "b",
     "file": "SL_X_RP_SEA_BI_PII_Cleaned_v2.xlsx",
     "value": "Band 7",
     "location": "Export, 48 monthly rows from row 123"
    }
   ]
  },
  {
   "id": "C2",
   "entity": "Employee",
   "key": "genericcode6",
   "label": "Generic Resource 6",
   "field": "Grade",
   "options": [
    {
     "id": "a",
     "file": "Apr_26_to_Aug_26_BU_UR_Sample_Cleaned.xlsx",
     "value": "Band 7",
     "location": "Export, row 32 (Aug 2026)"
    },
    {
     "id": "b",
     "file": "SL_X_RP_SEA_BI_PII_Cleaned_v2.xlsx",
     "value": "Band 3",
     "location": "Export, 48 monthly rows from row 165"
    }
   ]
  },
  {
   "id": "C3",
   "entity": "Employee",
   "key": "genericcode7",
   "label": "Generic Resource 7",
   "field": "Grade",
   "options": [
    {
     "id": "a",
     "file": "Apr_26_to_Aug_26_BU_UR_Sample_Cleaned.xlsx",
     "value": "Band 4",
     "location": "Export, row 37 (Aug 2026)"
    },
    {
     "id": "b",
     "file": "SL_X_RP_SEA_BI_PII_Cleaned_v2.xlsx",
     "value": "Band 7",
     "location": "Export, 48 monthly rows from row 196"
    }
   ]
  },
  {
   "id": "C4",
   "entity": "Employee",
   "key": "genericcode8",
   "label": "Generic Resource 8",
   "field": "Grade",
   "options": [
    {
     "id": "a",
     "file": "Apr_26_to_Aug_26_BU_UR_Sample_Cleaned.xlsx",
     "value": "Band 7",
     "location": "Export, row 42 (Aug 2026)"
    },
    {
     "id": "b",
     "file": "SL_X_RP_SEA_BI_PII_Cleaned_v2.xlsx",
     "value": "Band 4",
     "location": "Export, 48 monthly rows from row 232"
    }
   ]
  },
  {
   "id": "C5",
   "entity": "Employee",
   "key": "genericcode9",
   "label": "Generic Resource 9",
   "field": "Grade",
   "options": [
    {
     "id": "a",
     "file": "Apr_26_to_Aug_26_BU_UR_Sample_Cleaned.xlsx",
     "value": "Band 6",
     "location": "Export, row 47 (Aug 2026)"
    },
    {
     "id": "b",
     "file": "SL_X_RP_SEA_BI_PII_Cleaned_v2.xlsx",
     "value": "Band 7",
     "location": "Export, 48 monthly rows from row 256"
    }
   ]
  },
  {
   "id": "C6",
   "entity": "Employee",
   "key": "genericcode10",
   "label": "Generic Resource 10",
   "field": "Grade",
   "options": [
    {
     "id": "a",
     "file": "Apr_26_to_Aug_26_BU_UR_Sample_Cleaned.xlsx",
     "value": "Band 3",
     "location": "Export, row 52 (Aug 2026)"
    },
    {
     "id": "b",
     "file": "SL_X_RP_SEA_BI_PII_Cleaned_v2.xlsx",
     "value": "Band 6",
     "location": "Export, 48 monthly rows from row 292"
    }
   ]
  }
 ],
 "opportunities": [
  {
   "id": "O1",
   "crmId": "20210815-0640",
   "name": "Generic Opportunity 2",
   "customer": "Generic Customer 2",
   "stage": "O4 - Customer Decision",
   "probability": 0.6,
   "tcvUsd": 17082228,
   "expectedClose": "2026-10",
   "start": "2026-11",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O1-r1",
     "sourceId": "QL-0000005017",
     "position": "Asset Admin 1",
     "grade": 3,
     "start": "2027-02",
     "end": "2027-03",
     "fte": 1.03,
     "manDays": 37.0
    },
    {
     "id": "O1-r2",
     "sourceId": "QL-0000005017",
     "position": "Asset Admin 2",
     "grade": 3,
     "start": "2027-02",
     "end": "2027-08",
     "fte": 1.03,
     "manDays": 129.5
    },
    {
     "id": "O1-r3",
     "sourceId": "QL-0000005017",
     "position": "Asset Admin 3",
     "grade": 3,
     "start": "2027-04",
     "end": "2027-08",
     "fte": 1.03,
     "manDays": 92.5
    },
    {
     "id": "O1-r4",
     "sourceId": "QL-0000005017",
     "position": "Dashboard Engineer",
     "grade": 7,
     "start": "2027-06",
     "end": "2027-11",
     "fte": 0.77,
     "manDays": 83.25
    },
    {
     "id": "O1-r5",
     "sourceId": "QL-0000005017",
     "position": "Financial Analyst",
     "grade": 4,
     "start": "2026-06",
     "end": "2027-11",
     "fte": 0.77,
     "manDays": 166.5
    },
    {
     "id": "O1-r6",
     "sourceId": "QL-0000005017",
     "position": "ITSM/Tools Engineer",
     "grade": 7,
     "start": "2026-10",
     "end": "2027-11",
     "fte": 0.92,
     "manDays": 231.25
    },
    {
     "id": "O1-r7",
     "sourceId": "QL-0000005017",
     "position": "ITSO",
     "grade": 7,
     "start": "2026-04",
     "end": "2027-11",
     "fte": 0.95,
     "manDays": 342.25
    },
    {
     "id": "O1-r8",
     "sourceId": "QL-0000005017",
     "position": "LSS Manager (SDM)",
     "grade": 7,
     "start": "2027-06",
     "end": "2027-11",
     "fte": 0.77,
     "manDays": 83.25
    },
    {
     "id": "O1-r9",
     "sourceId": "QL-0000005017",
     "position": "Network Engineer",
     "grade": 7,
     "start": "2026-10",
     "end": "2027-11",
     "fte": 0.95,
     "manDays": 240.5
    },
    {
     "id": "O1-r10",
     "sourceId": "QL-0000005017",
     "position": "Network Lead",
     "grade": 7,
     "start": "2026-04",
     "end": "2027-11",
     "fte": 0.95,
     "manDays": 342.25
    },
    {
     "id": "O1-r11",
     "sourceId": "QL-0000005017",
     "position": "Org Change Management Consultant",
     "grade": 7,
     "start": "2027-05",
     "end": "2027-08",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r12",
     "sourceId": "QL-0000005017",
     "position": "Project Director",
     "grade": 7,
     "start": "2026-04",
     "end": "2027-11",
     "fte": 0.95,
     "manDays": 342.25
    },
    {
     "id": "O1-r13",
     "sourceId": "QL-0000005017",
     "position": "Project Manager",
     "grade": 7,
     "start": "2026-04",
     "end": "2027-11",
     "fte": 0.95,
     "manDays": 342.25
    },
    {
     "id": "O1-r14",
     "sourceId": "QL-0000005017",
     "position": "Server Engineer",
     "grade": 6,
     "start": "2026-10",
     "end": "2027-11",
     "fte": 0.95,
     "manDays": 240.5
    },
    {
     "id": "O1-r15",
     "sourceId": "QL-0000005017",
     "position": "Server Lead",
     "grade": 7,
     "start": "2026-04",
     "end": "2027-11",
     "fte": 0.95,
     "manDays": 342.25
    },
    {
     "id": "O1-r16",
     "sourceId": "QL-0000005017",
     "position": "Station Engineer 1",
     "grade": 6,
     "start": "2027-06",
     "end": "2027-11",
     "fte": 0.77,
     "manDays": 83.25
    },
    {
     "id": "O1-r17",
     "sourceId": "QL-0000005017",
     "position": "Station Engineer 2",
     "grade": 6,
     "start": "2027-06",
     "end": "2027-11",
     "fte": 0.77,
     "manDays": 83.25
    },
    {
     "id": "O1-r18",
     "sourceId": "QL-0000005017",
     "position": "Technical Writer/Trainer",
     "grade": 6,
     "start": "2026-10",
     "end": "2027-08",
     "fte": 1.03,
     "manDays": 203.5
    },
    {
     "id": "O1-r19",
     "sourceId": "QL-0000006551",
     "position": "Financial Analyst",
     "grade": 4,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r20",
     "sourceId": "QL-0000006551",
     "position": "ITSM/Tools Engineer",
     "grade": 7,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r21",
     "sourceId": "QL-0000006551",
     "position": "ITSO",
     "grade": 7,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r22",
     "sourceId": "QL-0000006551",
     "position": "LSS Manager (SDM)",
     "grade": 7,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r23",
     "sourceId": "QL-0000006551",
     "position": "Network Engineer",
     "grade": 7,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r24",
     "sourceId": "QL-0000006551",
     "position": "Network Lead",
     "grade": 7,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r25",
     "sourceId": "QL-0000006551",
     "position": "SDD",
     "grade": 7,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r26",
     "sourceId": "QL-0000006551",
     "position": "Server Engineer",
     "grade": 6,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r27",
     "sourceId": "QL-0000006551",
     "position": "Server Lead, Storage",
     "grade": 7,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r28",
     "sourceId": "QL-0000006551",
     "position": "Station Engineer 1",
     "grade": 6,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    },
    {
     "id": "O1-r29",
     "sourceId": "QL-0000006551",
     "position": "Station Engineer 2",
     "grade": 6,
     "start": "2027-12",
     "end": "2028-03",
     "fte": 1.03,
     "manDays": 74.0
    }
   ]
  },
  {
   "id": "O2",
   "crmId": "20240906-SF004304",
   "name": "Generic Opportunity 481",
   "customer": "Generic Customer 1",
   "stage": "O4 - Customer Decision",
   "probability": 0.8,
   "tcvUsd": 19982,
   "expectedClose": "2026-09",
   "start": "2026-09",
   "end": "2027-08",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O2-r1",
     "sourceId": "QL-0000004098",
     "position": "Project Management",
     "grade": 8,
     "start": "2025-08",
     "end": "2025-10",
     "fte": 0.05,
     "manDays": 2.5
    },
    {
     "id": "O2-r2",
     "sourceId": "QL-0000004098",
     "position": "Regression test",
     "grade": 5,
     "start": "2025-08",
     "end": "2025-09",
     "fte": 0.01,
     "manDays": 0.5
    },
    {
     "id": "O2-r3",
     "sourceId": "QL-0000004098",
     "position": "Requirement Analysis",
     "grade": 6,
     "start": "2025-08",
     "end": "2025-10",
     "fte": 0.03,
     "manDays": 1.5
    },
    {
     "id": "O2-r4",
     "sourceId": "QL-0000004098",
     "position": "SIT Documentation",
     "grade": 5,
     "start": "2025-08",
     "end": "2025-10",
     "fte": 0.02,
     "manDays": 1.0
    },
    {
     "id": "O2-r5",
     "sourceId": "QL-0000004098",
     "position": "SIT Execution",
     "grade": 5,
     "start": "2025-08",
     "end": "2025-10",
     "fte": 0.21,
     "manDays": 11.6
    },
    {
     "id": "O2-r6",
     "sourceId": "QL-0000004098",
     "position": "Support for UAT",
     "grade": 5,
     "start": "2025-08",
     "end": "2025-10",
     "fte": 0.02,
     "manDays": 1.0
    },
    {
     "id": "O2-r7",
     "sourceId": "QL-0000004098",
     "position": "Test scenario Creation",
     "grade": 5,
     "start": "2025-08",
     "end": "2025-10",
     "fte": 0.01,
     "manDays": 0.4
    },
    {
     "id": "O2-r8",
     "sourceId": "QL-0000004098",
     "position": "Test scenario Review",
     "grade": 5,
     "start": "2025-08",
     "end": "2025-09",
     "fte": 0.01,
     "manDays": 0.1
    },
    {
     "id": "O2-r9",
     "sourceId": "QL-0000004098",
     "position": "Unit/Functional Testing",
     "grade": 5,
     "start": "2025-08",
     "end": "2025-10",
     "fte": 0.06,
     "manDays": 3.0
    }
   ]
  },
  {
   "id": "O3",
   "crmId": "20260226-SF007842",
   "name": "Generic Opportunity 836",
   "customer": "Generic Customer 157",
   "stage": "O3 - Solution",
   "probability": 0.8,
   "tcvUsd": 58707,
   "expectedClose": "2026-11",
   "start": "2026-12",
   "end": "2027-11",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O3-r1",
     "sourceId": "QL-0000006554",
     "position": "Cloud Engineer - Day 1",
     "grade": 7,
     "start": "2026-11",
     "end": "2027-01",
     "fte": 0.59,
     "manDays": 32.0
    },
    {
     "id": "O3-r2",
     "sourceId": "QL-0000006554",
     "position": "Cloud Engineer - Day 2",
     "grade": 7,
     "start": "2027-02",
     "end": "2027-02",
     "fte": 0.17,
     "manDays": 3.0
    },
    {
     "id": "O3-r3",
     "sourceId": "QL-0000006554",
     "position": "Data Engineer - Day - 2",
     "grade": 6,
     "start": "2027-02",
     "end": "2027-02",
     "fte": 0.11,
     "manDays": 2.0
    },
    {
     "id": "O3-r4",
     "sourceId": "QL-0000006554",
     "position": "Data Engineer - Day 1",
     "grade": 6,
     "start": "2026-11",
     "end": "2027-01",
     "fte": 0.3,
     "manDays": 16.0
    }
   ]
  },
  {
   "id": "O4",
   "crmId": "20260402-SF008032",
   "name": "Generic Opportunity 870",
   "customer": "Generic Customer 2",
   "stage": "O2 - Qualify",
   "probability": 0.0,
   "tcvUsd": 109966,
   "expectedClose": "2026-09",
   "start": "2026-10",
   "end": "2027-09",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O4-r1",
     "sourceId": "QL-0000007258",
     "position": "Network Engineer",
     "grade": 7,
     "start": "2026-10",
     "end": "2027-03",
     "fte": 1.0,
     "manDays": 108.0
    },
    {
     "id": "O4-r2",
     "sourceId": "QL-0000007259",
     "position": "Network Engineer",
     "grade": 7,
     "start": "2026-10",
     "end": "2026-12",
     "fte": 0.56,
     "manDays": 30.0
    },
    {
     "id": "O4-r3",
     "sourceId": "QL-0000007259",
     "position": "Project Manager",
     "grade": 7,
     "start": "2026-10",
     "end": "2026-12",
     "fte": 0.09,
     "manDays": 5.0
    },
    {
     "id": "O4-r4",
     "sourceId": "QL-0000007260",
     "position": "Network Engineer",
     "grade": 7,
     "start": "2026-10",
     "end": "2026-12",
     "fte": 0.56,
     "manDays": 30.0,
     "duplicateOf": "O4-r2"
    },
    {
     "id": "O4-r5",
     "sourceId": "QL-0000007260",
     "position": "Project Manager",
     "grade": 7,
     "start": "2026-10",
     "end": "2026-12",
     "fte": 0.09,
     "manDays": 5.0,
     "duplicateOf": "O4-r3"
    }
   ]
  },
  {
   "id": "O5",
   "crmId": "20260422-SF008128",
   "name": "Generic Opportunity 882",
   "customer": "Generic Customer 39",
   "stage": "O3 - Solution",
   "probability": 0.2,
   "tcvUsd": 371762,
   "expectedClose": "2027-03",
   "start": "2027-04",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O5-r1",
     "sourceId": "QL-0000006666",
     "position": "Cloud DBA",
     "grade": 7,
     "start": "2026-10",
     "end": "2027-03",
     "fte": 0.2,
     "manDays": 22.0
    },
    {
     "id": "O5-r2",
     "sourceId": "QL-0000006666",
     "position": "Cloud Engineer - 2",
     "grade": 7,
     "start": "2026-10",
     "end": "2027-03",
     "fte": 1.1,
     "manDays": 119.0
    },
    {
     "id": "O5-r3",
     "sourceId": "QL-0000006666",
     "position": "Cloud Engineer -1",
     "grade": 7,
     "start": "2026-10",
     "end": "2027-03",
     "fte": 1.1,
     "manDays": 119.0
    },
    {
     "id": "O5-r4",
     "sourceId": "QL-0000006666",
     "position": "Project Manager",
     "grade": 7,
     "start": "2026-10",
     "end": "2027-03",
     "fte": 0.66,
     "manDays": 71.0
    }
   ]
  },
  {
   "id": "O6",
   "crmId": "20260505-SF008201",
   "name": "Generic Opportunity 896",
   "customer": "Generic Customer 14",
   "stage": "O3 - Solution",
   "probability": 0.5,
   "tcvUsd": 16753,
   "expectedClose": "2027-02",
   "start": "2027-03",
   "end": "2027-08",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O6-r1",
     "sourceId": "QL-0000006579",
     "position": "Database Administrator L2",
     "grade": 7,
     "start": "2026-08",
     "end": "2026-08",
     "fte": 0.75,
     "manDays": 13.5
    },
    {
     "id": "O6-r2",
     "sourceId": "QL-0000006579",
     "position": "Project Manager",
     "grade": 8,
     "start": "2026-08",
     "end": "2026-08",
     "fte": 0.25,
     "manDays": 4.5
    }
   ]
  },
  {
   "id": "O7",
   "crmId": "20260604-SF008387",
   "name": "Generic Opportunity 931",
   "customer": "Generic Customer 176",
   "stage": "O2 - Qualify",
   "probability": 0.6,
   "tcvUsd": 2400966,
   "expectedClose": "2026-09",
   "start": "2026-10",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O7-r1",
     "sourceId": "QL-0000006847",
     "position": "IT Security Officer",
     "grade": 7,
     "start": "2027-01",
     "end": "2028-01",
     "fte": 0.14,
     "manDays": 5.0
    },
    {
     "id": "O7-r2",
     "sourceId": "QL-0000006847",
     "position": "IT Service Management Engineer",
     "grade": 7,
     "start": "2026-08",
     "end": "2028-03",
     "fte": 0.5,
     "manDays": 180.0
    },
    {
     "id": "O7-r3",
     "sourceId": "QL-0000006847",
     "position": "Project Manager",
     "grade": 7,
     "start": "2026-08",
     "end": "2028-03",
     "fte": 0.57,
     "manDays": 207.0
    }
   ]
  },
  {
   "id": "O8",
   "crmId": "20260701-SF008514",
   "name": "Generic Opportunity 956",
   "customer": "Generic Customer 40",
   "stage": "O3 - Solution",
   "probability": 0.5,
   "tcvUsd": 29778,
   "expectedClose": "2026-09",
   "start": "2026-10",
   "end": "2026-12",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O8-r1",
     "sourceId": "QL-0000006719",
     "position": "Cloud Architect",
     "grade": 8,
     "start": "2026-10",
     "end": "2026-12",
     "fte": 0.06,
     "manDays": 3.0
    },
    {
     "id": "O8-r2",
     "sourceId": "QL-0000006719",
     "position": "Cloud Engineer L2",
     "grade": 7,
     "start": "2026-10",
     "end": "2026-12",
     "fte": 0.69,
     "manDays": 37.0
    },
    {
     "id": "O8-r3",
     "sourceId": "QL-0000006719",
     "position": "Project Manager",
     "grade": 7,
     "start": "2026-10",
     "end": "2026-12",
     "fte": 0.07,
     "manDays": 4.0
    }
   ]
  },
  {
   "id": "O9",
   "crmId": "20260717-SF008609",
   "name": "Generic Opportunity 969",
   "customer": "Generic Customer 26",
   "stage": "O2 - Qualify",
   "probability": 0.9,
   "tcvUsd": 64180,
   "expectedClose": "2026-09",
   "start": "2027-04",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O9-r1",
     "sourceId": "QL-0000007181",
     "position": "Network Engineer",
     "grade": 7,
     "start": "2027-04",
     "end": "2027-09",
     "fte": 0.1,
     "manDays": 10.8
    },
    {
     "id": "O9-r2",
     "sourceId": "QL-0000007181",
     "position": "Wintel Engineer",
     "grade": 7,
     "start": "2027-04",
     "end": "2027-09",
     "fte": 0.2,
     "manDays": 21.6
    },
    {
     "id": "O9-r3",
     "sourceId": "QL-0000007181",
     "position": "network engineer 1",
     "grade": 7,
     "start": "2027-04",
     "end": "2027-09",
     "fte": 0.05,
     "manDays": 5.4
    }
   ]
  },
  {
   "id": "O10",
   "crmId": "20260717-SF008648",
   "name": "Generic Opportunity 985",
   "customer": "Generic Customer 9",
   "stage": "O3 - Solution",
   "probability": 0.9,
   "tcvUsd": 36357,
   "expectedClose": "2026-09",
   "start": "2026-10",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "crm",
   "basis": null,
   "resources": [
    {
     "id": "O10-r1",
     "sourceId": "QL-0000007149",
     "position": "DCOps [Base - TFM On-boarding Service (Apr 2027 to Mar 2028)}",
     "grade": 3,
     "start": "2027-04",
     "end": "2028-03",
     "fte": 0.26,
     "manDays": 56.16
    },
    {
     "id": "O10-r2",
     "sourceId": "QL-0000007149",
     "position": "DCOps [Base - TFM On-boarding Service (Oct 2026 to Mar 2027)]",
     "grade": 3,
     "start": "2026-10",
     "end": "2027-03",
     "fte": 0.26,
     "manDays": 28.08
    },
    {
     "id": "O10-r3",
     "sourceId": "QL-0000007149",
     "position": "DCOps [Option - Additional Services: ANCP and RMP support for 3 months (Aug 2026 to Nov 2026)]",
     "grade": 3,
     "start": "2026-10",
     "end": "2026-12",
     "fte": 0.35,
     "manDays": 18.9
    }
   ]
  },
  {
   "id": "O11",
   "crmId": "20260722-SF008666",
   "name": "Generic Opportunity 987",
   "customer": "Generic Customer 62",
   "stage": "O1 - Initial",
   "probability": 0.0,
   "tcvUsd": 17039114,
   "expectedClose": "2027-06",
   "start": "2027-06",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "similar",
   "basis": {
    "projectId": "PROJ-00010710",
    "projectName": "NCSS Base Year8 FY26",
    "tcvUsd": 495089,
    "start": "2026-04",
    "end": "2027-03",
    "offering": "ATFM",
    "shiftedMonths": 14
   },
   "resources": [
    {
     "id": "O11-r1",
     "sourceId": "PROJ-00010710 / genericcode22",
     "position": "Linux Engineer",
     "grade": 8,
     "start": "2027-09",
     "end": "2027-11",
     "fte": 0.1,
     "manDays": 5.55
    },
    {
     "id": "O11-r2",
     "sourceId": "PROJ-00010710 / genericcode540",
     "position": "DBA",
     "grade": 7,
     "start": "2027-06",
     "end": "2028-05",
     "fte": 0.5,
     "manDays": 108.0
    },
    {
     "id": "O11-r3",
     "sourceId": "PROJ-00010710 / genericcode541",
     "position": "ITSO L2",
     "grade": 7,
     "start": "2027-06",
     "end": "2028-05",
     "fte": 1.0,
     "manDays": 216.0
    },
    {
     "id": "O11-r4",
     "sourceId": "PROJ-00010710 / genericcode573",
     "position": "Cloud Wintel L2",
     "grade": 7,
     "start": "2027-06",
     "end": "2028-05",
     "fte": 0.5,
     "manDays": 108.0
    },
    {
     "id": "O11-r5",
     "sourceId": "PROJ-00010710 / genericcode584",
     "position": "Cloud Wintel",
     "grade": 7,
     "start": "2027-06",
     "end": "2028-05",
     "fte": 1.0,
     "manDays": 216.0
    },
    {
     "id": "O11-r6",
     "sourceId": "PROJ-00010710 / genericcode70",
     "position": "Service Delivery Manager",
     "grade": 7,
     "start": "2027-06",
     "end": "2028-05",
     "fte": 1.0,
     "manDays": 216.0
    },
    {
     "id": "O11-r7",
     "sourceId": "PROJ-00010710 / genericcode927",
     "position": "Linux Engineer",
     "grade": 6,
     "start": "2028-01",
     "end": "2028-05",
     "fte": 0.1,
     "manDays": 9.25
    }
   ]
  },
  {
   "id": "O12",
   "crmId": "20260717-SF008643",
   "name": "Generic Opportunity 969",
   "customer": "Generic Customer 62",
   "stage": "O1 - Initial",
   "probability": 0.0,
   "tcvUsd": 12923660,
   "expectedClose": "2027-03",
   "start": "2027-04",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "similar",
   "basis": {
    "projectId": "PROJ-00010734",
    "projectName": "[ATFM] Year 8 Renewal - MUIS - AFM",
    "tcvUsd": 456961,
    "start": "2026-04",
    "end": "2027-03",
    "offering": "ATFM",
    "shiftedMonths": 12
   },
   "resources": [
    {
     "id": "O12-r1",
     "sourceId": "PROJ-00010734 / genericcode294",
     "position": "SECURITY - L1 [ ITSO ]",
     "grade": 7,
     "start": "2027-04",
     "end": "2028-03",
     "fte": 1.0,
     "manDays": 216.0
    },
    {
     "id": "O12-r2",
     "sourceId": "PROJ-00010734 / genericcode413",
     "position": "NETWORK - L2",
     "grade": 5,
     "start": "2027-04",
     "end": "2028-03",
     "fte": 0.5,
     "manDays": 108.0
    },
    {
     "id": "O12-r3",
     "sourceId": "PROJ-00010734 / genericcode445",
     "position": "WINTEL - L2",
     "grade": 6,
     "start": "2027-04",
     "end": "2028-03",
     "fte": 0.5,
     "manDays": 108.0
    },
    {
     "id": "O12-r4",
     "sourceId": "PROJ-00010734 / genericcode470",
     "position": "DBA - L2/ Sharepoint",
     "grade": 7,
     "start": "2027-04",
     "end": "2028-03",
     "fte": 1.0,
     "manDays": 216.0
    },
    {
     "id": "O12-r5",
     "sourceId": "PROJ-00010734 / genericcode588",
     "position": "MGR - L1 [ TS Lead ]",
     "grade": 8,
     "start": "2027-04",
     "end": "2028-03",
     "fte": 0.2,
     "manDays": 43.2
    },
    {
     "id": "O12-r6",
     "sourceId": "PROJ-00010734 / genericcode839",
     "position": "CSP",
     "grade": 8,
     "start": "2027-04",
     "end": "2027-07",
     "fte": 0.12,
     "manDays": 9.0
    }
   ]
  },
  {
   "id": "O13",
   "crmId": "20260424-SF008154",
   "name": "Generic Opportunity 890",
   "customer": "Generic Customer 2",
   "stage": "O3 - Solution",
   "probability": 0.0,
   "tcvUsd": 8867100,
   "expectedClose": "2027-08",
   "start": "2027-09",
   "end": "2028-03",
   "offering": "Application Services (includes AI & Data)",
   "source": "similar",
   "basis": {
    "projectId": "PRJ47615ED8",
    "projectName": "TAMS 1.0 Enhancement",
    "tcvUsd": 364070,
    "start": "2023-01",
    "end": "2024-12",
    "offering": "ATFM",
    "shiftedMonths": 37
   },
   "resources": [
    {
     "id": "O13-r1",
     "sourceId": "PRJ47615ED8 / genericcode148",
     "position": "QA Officer",
     "grade": 5,
     "start": "2027-09",
     "end": "2027-11",
     "fte": 0.11,
     "manDays": 6.0
    },
    {
     "id": "O13-r2",
     "sourceId": "PRJ47615ED8 / genericcode236",
     "position": "QA/Tester",
     "grade": 7,
     "start": "2027-12",
     "end": "2029-01",
     "fte": 0.56,
     "manDays": 30.0
    },
    {
     "id": "O13-r3",
     "sourceId": "PRJ47615ED8 / genericcode31",
     "position": "Business Analyst",
     "grade": 6,
     "start": "2027-12",
     "end": "2028-01",
     "fte": 0.28,
     "manDays": 10.0
    },
    {
     "id": "O13-r4",
     "sourceId": "PRJ47615ED8 / genericcode724",
     "position": "Project Manager",
     "grade": 8,
     "start": "2027-09",
     "end": "2027-11",
     "fte": 0.11,
     "manDays": 6.0
    },
    {
     "id": "O13-r5",
     "sourceId": "PRJ47615ED8 / genericcode731",
     "position": "Tester",
     "grade": 7,
     "start": "2029-01",
     "end": "2029-01",
     "fte": 1.11,
     "manDays": 20.0
    }
   ]
  },
  {
   "id": "O14",
   "crmId": "20260626-SF008502",
   "name": "Generic Opportunity 953",
   "customer": "Generic Customer 154",
   "stage": "O1 - Initial",
   "probability": 0.2,
   "tcvUsd": 2323515,
   "expectedClose": "2027-03",
   "start": "2027-06",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "manual",
   "basis": null,
   "resources": []
  },
  {
   "id": "O15",
   "crmId": "20260717-SF008610",
   "name": "Generic Opportunity 969",
   "customer": "Generic Customer 32",
   "stage": "O2 - Qualify",
   "probability": 0.0,
   "tcvUsd": 2247457,
   "expectedClose": "2027-03",
   "start": "2027-04",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "manual",
   "basis": null,
   "resources": []
  },
  {
   "id": "O16",
   "crmId": "20260717-SF008647",
   "name": "Generic Opportunity 968",
   "customer": "Generic Customer 140",
   "stage": "O1 - Initial",
   "probability": 0.0,
   "tcvUsd": 2075906,
   "expectedClose": "2027-03",
   "start": "2027-04",
   "end": "2028-03",
   "offering": "ATFM",
   "source": "manual",
   "basis": null,
   "resources": []
  }
 ],
 "currentDemand": [
  {
   "id": "D1",
   "source": "current",
   "projectId": "PROJ-00011785",
   "quoteLine": "QL-0000006641",
   "customer": "SINGAPORE POLICE FORCE",
   "projectName": "[ATFM] SEMS2 - Windows upgrade for 8 servers",
   "position": "Server Engineer L2",
   "grade": 7,
   "start": "2026-01",
   "manDays": 6.25,
   "candidates": [
    "R-0000",
    "R-0006",
    "R-0020",
    "R-0021"
   ]
  },
  {
   "id": "D2",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000007070",
   "customer": "",
   "projectName": "[ATFM] Exercise Options 150 PSS (Resvised)",
   "position": "Cloud Engineer L1",
   "grade": 7,
   "start": "2026-01",
   "manDays": 15.5,
   "candidates": [
    "R-0052",
    "R-0104"
   ]
  },
  {
   "id": "D3",
   "source": "current",
   "projectId": "PROJ-00011922",
   "quoteLine": "QL-0000007079",
   "customer": "URBAN REDEVELOPMENT AUTHORITY",
   "projectName": "[ATFM] Additional 150 MDs for URA",
   "position": "Cloud Engineer L1",
   "grade": 6,
   "start": "2026-01",
   "manDays": 9.0,
   "candidates": [
    "R-0053",
    "R-0104"
   ]
  },
  {
   "id": "D4",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000004979",
   "customer": "",
   "projectName": "[ATFM] Manage Services for ASTAR Commercial Cloud & GCC",
   "position": "Cloud Architect",
   "grade": 7,
   "start": "2026-01",
   "manDays": 18.5,
   "candidates": [
    "R-0052",
    "R-0889"
   ]
  },
  {
   "id": "D5",
   "source": "current",
   "projectId": "PROJ-00011785",
   "quoteLine": "QL-0000006641",
   "customer": "SINGAPORE POLICE FORCE",
   "projectName": "[ATFM] SEMS2 - Windows upgrade for 8 servers",
   "position": "DBA L2",
   "grade": 7,
   "start": "2026-01",
   "manDays": 4.0,
   "candidates": [
    "R-0068",
    "R-0003",
    "R-0987",
    "R-0015"
   ]
  },
  {
   "id": "D6",
   "source": "current",
   "projectId": "PROJ-00011785",
   "quoteLine": "QL-0000006641",
   "customer": "SINGAPORE POLICE FORCE",
   "projectName": "[ATFM] SEMS2 - Windows upgrade for 8 servers",
   "position": "Project Manager",
   "grade": 7,
   "start": "2026-01",
   "manDays": 1.0,
   "candidates": [
    "R-0001",
    "R-0002",
    "R-0013",
    "R-0500"
   ]
  },
  {
   "id": "D7",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000007070",
   "customer": "",
   "projectName": "[ATFM] Exercise Options 150 PSS (Resvised)",
   "position": "Project Manager",
   "grade": 7,
   "start": "2026-01",
   "manDays": 4.67,
   "candidates": [
    "R-0002",
    "R-0001",
    "R-0013",
    "R-0500"
   ]
  },
  {
   "id": "D8",
   "source": "current",
   "projectId": "PROJ-00011781",
   "quoteLine": "QL-0000006952",
   "customer": "SINGAPORE POLICE FORCE",
   "projectName": "[ATFM] SPF_Win2019_Upgrade_Dataiku",
   "position": "DBA L2",
   "grade": 7,
   "start": "2026-01",
   "manDays": 4.0,
   "candidates": [
    "R-0003",
    "R-0068",
    "R-0987",
    "R-0015"
   ]
  },
  {
   "id": "D9",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006601",
   "customer": "",
   "projectName": "[Non-ATFM] Managed Infra Support for Non-WOG Devices",
   "position": "Network Engineer L2",
   "grade": 7,
   "start": "2026-01",
   "manDays": 1.8,
   "candidates": [
    "R-0005",
    "R-0055",
    "R-0061",
    "R-0833"
   ]
  },
  {
   "id": "D10",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006666",
   "customer": "",
   "projectName": "[ATFM] Implementing a new eRegistry solution in GCC+",
   "position": "Cloud Engineer L1",
   "grade": 7,
   "start": "2026-01",
   "manDays": 19.83,
   "candidates": [
    "R-0058",
    "R-0104"
   ]
  },
  {
   "id": "D11",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000007181",
   "customer": "",
   "projectName": "[ATFM] - Year 9 - Renewal - Base",
   "position": "Cloud Engineer L1",
   "grade": 7,
   "start": "2026-01",
   "manDays": 1.66,
   "candidates": [
    "R-0057",
    "R-0104"
   ]
  },
  {
   "id": "D12",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000004501",
   "customer": "",
   "projectName": "[AD] PROVISION OF SHAREPOINT UPGRADE, MIGRATION, MAINTENANCE AND SUPPORT SERVICES FOR RECORD MANAGEMENT SYSTEM (RMS)",
   "position": "Cloud Engineer L1",
   "grade": 7,
   "start": "2026-01",
   "manDays": 1.85,
   "candidates": [
    "R-0104"
   ]
  },
  {
   "id": "D13",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000005017",
   "customer": "",
   "projectName": "[Non-ATFM] MHA HTSC NOC - Phase 2A",
   "position": "Network Engineer L1",
   "grade": 7,
   "start": "2026-01",
   "manDays": 18.5,
   "candidates": [
    "R-0055",
    "R-0403",
    "R-1020"
   ]
  },
  {
   "id": "D14",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006601",
   "customer": "",
   "projectName": "[Non-ATFM] Managed Infra Support for Non-WOG Devices",
   "position": "DCOps",
   "grade": 4,
   "start": "2026-01",
   "manDays": 18.0,
   "candidates": [
    "R-0004",
    "R-0007",
    "R-0190",
    "R-0251"
   ]
  },
  {
   "id": "D15",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000005017",
   "customer": "",
   "projectName": "[Non-ATFM] MHA HTSC NOC - Phase 2A",
   "position": "Tools Engineer L2 (Observability)",
   "grade": 7,
   "start": "2026-01",
   "manDays": 18.5,
   "candidates": [
    "R-0014"
   ]
  },
  {
   "id": "D16",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006601",
   "customer": "",
   "projectName": "[Non-ATFM] Managed Infra Support for Non-WOG Devices",
   "position": "Server Engineer L1",
   "grade": 6,
   "start": "2026-01",
   "manDays": 7.2,
   "candidates": [
    "R-0011",
    "R-0009",
    "R-0832"
   ]
  },
  {
   "id": "D17",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006666",
   "customer": "",
   "projectName": "[ATFM] Implementing a new eRegistry solution in GCC+",
   "position": "Cloud Engineer L2",
   "grade": 7,
   "start": "2026-01",
   "manDays": 19.83,
   "candidates": [
    "R-0010",
    "R-0052",
    "R-0058",
    "R-0060"
   ]
  },
  {
   "id": "D18",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000005017",
   "customer": "",
   "projectName": "[Non-ATFM] MHA HTSC NOC - Phase 2A",
   "position": "Server Engineer L1",
   "grade": 6,
   "start": "2026-01",
   "manDays": 18.5,
   "candidates": [
    "R-0009",
    "R-0011",
    "R-0832"
   ]
  },
  {
   "id": "D19",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000007149",
   "customer": "",
   "projectName": "[ATFM] OnBoarding Services for Singpass NCA RCA Setup at GDC3",
   "position": "DCOps",
   "grade": 3,
   "start": "2026-01",
   "manDays": 4.68,
   "candidates": [
    "R-0008",
    "R-0012",
    "R-0027",
    "R-0028"
   ]
  },
  {
   "id": "D20",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006605",
   "customer": "",
   "projectName": "[ATFM] IT Admin 6 months extension",
   "position": "DCOps",
   "grade": 4,
   "start": "2026-01",
   "manDays": 18.0,
   "candidates": [
    "R-0007",
    "R-0190",
    "R-0251",
    "R-0526"
   ]
  },
  {
   "id": "D21",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006601",
   "customer": "",
   "projectName": "[Non-ATFM] Managed Infra Support for Non-WOG Devices",
   "position": "Server Engineer L2",
   "grade": 7,
   "start": "2026-01",
   "manDays": 0.9,
   "candidates": [
    "R-0006",
    "R-0000",
    "R-0020",
    "R-0021"
   ]
  },
  {
   "id": "D22",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006666",
   "customer": "",
   "projectName": "[ATFM] Implementing a new eRegistry solution in GCC+",
   "position": "Project Manager",
   "grade": 7,
   "start": "2026-01",
   "manDays": 11.83,
   "candidates": [
    "R-0013",
    "R-0001",
    "R-0002",
    "R-0500"
   ]
  },
  {
   "id": "D23",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000007149",
   "customer": "",
   "projectName": "[ATFM] OnBoarding Services for Singpass NCA RCA Setup at GDC3",
   "position": "DCOps",
   "grade": 3,
   "start": "2026-01",
   "manDays": 6.3,
   "candidates": [
    "R-0012",
    "R-0008",
    "R-0027",
    "R-0028"
   ]
  },
  {
   "id": "D24",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006554",
   "customer": "",
   "projectName": "[Non-ATFM] NPARKS Documentation Management System Project (Phase1)",
   "position": "Data Engineer",
   "grade": 6,
   "start": "2026-01",
   "manDays": 6.0,
   "candidates": [
    "R-0059"
   ]
  },
  {
   "id": "D25",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006554",
   "customer": "",
   "projectName": "[Non-ATFM] NPARKS Documentation Management System Project (Phase1)",
   "position": "Cloud Engineer L1",
   "grade": 7,
   "start": "2026-01",
   "manDays": 11.0,
   "candidates": [
    "R-0060",
    "R-0104"
   ]
  },
  {
   "id": "D26",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006639",
   "customer": "",
   "projectName": "[ATFM] eGIS ONE OS Migration/Upgrade",
   "position": "Server Engineer L2",
   "grade": 7,
   "start": "2026-01",
   "manDays": 18.0,
   "candidates": [
    "R-0023",
    "R-0000",
    "R-0006",
    "R-0020"
   ]
  },
  {
   "id": "D27",
   "source": "current",
   "projectId": "PROJ-00011786",
   "quoteLine": "QL-0000006987",
   "customer": "SINGAPORE POLICE FORCE",
   "projectName": "[ATFM] eGIS ONE OS Migration/Upgrade",
   "position": "DBA L2",
   "grade": 7,
   "start": "2026-01",
   "manDays": 18.0,
   "candidates": [
    "R-0015",
    "R-0003",
    "R-0068",
    "R-0987"
   ]
  },
  {
   "id": "D28",
   "source": "current",
   "projectId": "PROJ-00011786",
   "quoteLine": "QL-0000006987",
   "customer": "SINGAPORE POLICE FORCE",
   "projectName": "[ATFM] eGIS ONE OS Migration/Upgrade",
   "position": "Server Engineer L2",
   "grade": 7,
   "start": "2026-01",
   "manDays": 18.0,
   "candidates": [
    "R-0016",
    "R-0000",
    "R-0006",
    "R-0020"
   ]
  },
  {
   "id": "D29",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006609",
   "customer": "",
   "projectName": "[Non-ATFM]: Options and Yr 3 extension for MFA NON WOG Microsoft SAS based support requirements ]",
   "position": "Unmapped: EUC Engineer - Operations",
   "grade": 4,
   "start": "2027-01",
   "manDays": 18.5,
   "candidates": []
  },
  {
   "id": "D30",
   "source": "current",
   "projectId": "PROJ-00011247",
   "quoteLine": "QL-0000005605",
   "customer": "AGENCY FOR SCIENCE, TECHNOLOGY AND RESEARCH",
   "projectName": "[Non-ATFM] : T/ITSS/11/FY25 - IMPLEMENTATION OF INTEGRATED IT END-USER SUPPORT SERVICES FOR A*STAR",
   "position": "IT Security Officer",
   "grade": 4,
   "start": "2027-01",
   "manDays": 18.5,
   "candidates": []
  },
  {
   "id": "D31",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000005017",
   "customer": "",
   "projectName": "[Non-ATFM] MHA HTSC NOC - Phase 2A",
   "position": "Unmapped: Technical Writer/Trainer",
   "grade": 6,
   "start": "2026-01",
   "manDays": 18.5,
   "candidates": []
  },
  {
   "id": "D32",
   "source": "current",
   "projectId": "PROJ-00010639",
   "quoteLine": "QL-0000004874",
   "customer": "THE ACCOUNTING AND CORPORATE REGULATORY AUTHORITY",
   "projectName": "[ATFM] Year 8 - GCC and GCC+ Day 2 support [RFQ]",
   "position": "Unmapped: PSS mandays activity",
   "grade": 6,
   "start": "2026-01",
   "manDays": 18.5,
   "candidates": []
  },
  {
   "id": "D33",
   "source": "current",
   "projectId": "PROJ-00010639",
   "quoteLine": "QL-0000004874",
   "customer": "THE ACCOUNTING AND CORPORATE REGULATORY AUTHORITY",
   "projectName": "[ATFM] Year 8 - GCC and GCC+ Day 2 support [RFQ]",
   "position": "Unmapped: PSS mandays activity - 2",
   "grade": 6,
   "start": "2026-01",
   "manDays": 6.5,
   "candidates": []
  },
  {
   "id": "D34",
   "source": "current",
   "projectId": "PROJ-00011964",
   "quoteLine": "QL-0000006973",
   "customer": "BW DIGITAL PTE. LTD.",
   "projectName": "[NON-ATFM] BW Digital - Installation of Fortinet and SonicWall Firewalls at NDP1 DC Campus, Batam (3 Years Subscription)",
   "position": "Unmapped: Project Managet",
   "grade": 7,
   "start": "2026-01",
   "manDays": 2.5,
   "candidates": []
  },
  {
   "id": "D35",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000006609",
   "customer": "",
   "projectName": "[Non-ATFM]: Options and Yr 3 extension for MFA NON WOG Microsoft SAS based support requirements ]",
   "position": "SCCM Engineer",
   "grade": 7,
   "start": "2027-01",
   "manDays": 4.62,
   "candidates": []
  },
  {
   "id": "D36",
   "source": "current",
   "projectId": "",
   "quoteLine": "QL-0000004292",
   "customer": "",
   "projectName": "[Non-ATFM] Desktop Mgt Services for 10 Countries",
   "position": "Unmapped: Full time Inhouse engineer - Singapore -2",
   "grade": 4,
   "start": "2027-01",
   "manDays": 18.5,
   "candidates": []
  }
 ],
 "pipelineCandidates": {
  "O1-r1": [
   "R-0008",
   "R-0012",
   "R-0027",
   "R-0028"
  ],
  "O1-r2": [
   "R-0008",
   "R-0012",
   "R-0027",
   "R-0028"
  ],
  "O1-r3": [
   "R-0008",
   "R-0012",
   "R-0027",
   "R-0028"
  ],
  "O1-r4": [],
  "O1-r5": [],
  "O1-r6": [
   "R-0490",
   "R-0501",
   "R-0916",
   "R-0965"
  ],
  "O1-r7": [
   "R-0026",
   "R-0934",
   "R-0679",
   "R-0680"
  ],
  "O1-r8": [
   "R-0490",
   "R-0501",
   "R-0916",
   "R-0965"
  ],
  "O1-r9": [
   "R-0055",
   "R-0061",
   "R-0833",
   "R-0919"
  ],
  "O1-r10": [
   "R-0055",
   "R-0061",
   "R-0833",
   "R-0919"
  ],
  "O1-r11": [],
  "O1-r12": [],
  "O1-r13": [
   "R-0001",
   "R-0002",
   "R-0013",
   "R-0500"
  ],
  "O1-r14": [
   "R-0000",
   "R-0006",
   "R-0020",
   "R-0021"
  ],
  "O1-r15": [
   "R-0000",
   "R-0006",
   "R-0020",
   "R-0021"
  ],
  "O1-r16": [],
  "O1-r17": [],
  "O1-r18": [],
  "O1-r19": [],
  "O1-r20": [
   "R-0490",
   "R-0501",
   "R-0916",
   "R-0965"
  ],
  "O1-r21": [
   "R-0026",
   "R-0934",
   "R-0679",
   "R-0680"
  ],
  "O1-r22": [
   "R-0490",
   "R-0501",
   "R-0916",
   "R-0965"
  ],
  "O1-r23": [
   "R-0055",
   "R-0061",
   "R-0833",
   "R-0919"
  ],
  "O1-r24": [
   "R-0055",
   "R-0061",
   "R-0833",
   "R-0919"
  ],
  "O1-r25": [],
  "O1-r26": [
   "R-0000",
   "R-0006",
   "R-0020",
   "R-0021"
  ],
  "O1-r27": [
   "R-0000",
   "R-0006",
   "R-0020",
   "R-0021"
  ],
  "O1-r28": [],
  "O1-r29": [],
  "O2-r1": [
   "R-0475",
   "R-0480",
   "R-0988",
   "R-0001"
  ],
  "O2-r2": [],
  "O2-r3": [],
  "O2-r4": [],
  "O2-r5": [],
  "O2-r6": [],
  "O2-r7": [],
  "O2-r8": [],
  "O2-r9": [],
  "O3-r1": [
   "R-0010",
   "R-0052",
   "R-0058",
   "R-0060"
  ],
  "O3-r2": [
   "R-0010",
   "R-0052",
   "R-0058",
   "R-0060"
  ],
  "O3-r3": [],
  "O3-r4": [],
  "O4-r1": [
   "R-0055",
   "R-0061",
   "R-0833",
   "R-0919"
  ],
  "O4-r2": [
   "R-0055",
   "R-0061",
   "R-0833",
   "R-0919"
  ],
  "O4-r3": [
   "R-0001",
   "R-0002",
   "R-0013",
   "R-0500"
  ],
  "O4-r4": [
   "R-0055",
   "R-0061",
   "R-0833",
   "R-0919"
  ],
  "O4-r5": [
   "R-0001",
   "R-0002",
   "R-0013",
   "R-0500"
  ],
  "O5-r1": [
   "R-0003",
   "R-0068",
   "R-0987",
   "R-0015"
  ],
  "O5-r2": [
   "R-0010",
   "R-0052",
   "R-0058",
   "R-0060"
  ],
  "O5-r3": [
   "R-0010",
   "R-0052",
   "R-0058",
   "R-0060"
  ],
  "O5-r4": [
   "R-0001",
   "R-0002",
   "R-0013",
   "R-0500"
  ],
  "O6-r1": [],
  "O6-r2": [
   "R-0475",
   "R-0480",
   "R-0988",
   "R-0001"
  ],
  "O7-r1": [
   "R-0026",
   "R-0934",
   "R-0679",
   "R-0680"
  ],
  "O7-r2": [],
  "O7-r3": [
   "R-0001",
   "R-0002",
   "R-0013",
   "R-0500"
  ],
  "O8-r1": [
   "R-0997",
   "R-1177",
   "R-1178",
   "R-1181"
  ],
  "O8-r2": [
   "R-0010",
   "R-0052",
   "R-0058",
   "R-0060"
  ],
  "O8-r3": [
   "R-0001",
   "R-0002",
   "R-0013",
   "R-0500"
  ],
  "O9-r1": [
   "R-0055",
   "R-0061",
   "R-0833",
   "R-0919"
  ],
  "O9-r2": [
   "R-0000",
   "R-0006",
   "R-0020",
   "R-0021"
  ],
  "O9-r3": [
   "R-0055",
   "R-0061",
   "R-0833",
   "R-0919"
  ],
  "O10-r1": [],
  "O10-r2": [],
  "O10-r3": [],
  "O11-r1": [
   "R-0415",
   "R-0000",
   "R-0006",
   "R-0020"
  ],
  "O11-r2": [
   "R-0003",
   "R-0068",
   "R-0987",
   "R-0015"
  ],
  "O11-r3": [
   "R-0026",
   "R-0934",
   "R-0679",
   "R-0680"
  ],
  "O11-r4": [
   "R-0010",
   "R-0052",
   "R-0058",
   "R-0060"
  ],
  "O11-r5": [
   "R-0010",
   "R-0052",
   "R-0058",
   "R-0060"
  ],
  "O11-r6": [
   "R-0490",
   "R-0501",
   "R-0916",
   "R-0965"
  ],
  "O11-r7": [
   "R-0000",
   "R-0006",
   "R-0020",
   "R-0021"
  ],
  "O12-r1": [
   "R-0026",
   "R-0934",
   "R-0679",
   "R-0680"
  ],
  "O12-r2": [
   "R-0871",
   "R-0770",
   "R-0836",
   "R-0299"
  ],
  "O12-r3": [
   "R-0000",
   "R-0006",
   "R-0020",
   "R-0021"
  ],
  "O12-r4": [
   "R-0003",
   "R-0068",
   "R-0987",
   "R-0015"
  ],
  "O12-r5": [],
  "O12-r6": [],
  "O13-r1": [],
  "O13-r2": [],
  "O13-r3": [],
  "O13-r4": [
   "R-0475",
   "R-0480",
   "R-0988",
   "R-0001"
  ],
  "O13-r5": []
 },
 "people": {
  "R-0000": {
   "id": "R-0000",
   "label": "Generic Resource 7 (R-0000)",
   "position": "Server Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV]_HTA"
  },
  "R-0001": {
   "id": "R-0001",
   "label": "Generic Resource 7 (R-0001)",
   "position": "Project Manager",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM]: CyberArk Onboarding/RAS & Additional PSS for On-Prem to GCC2.0 migration"
  },
  "R-0002": {
   "id": "R-0002",
   "label": "Generic Resource 7 (R-0002)",
   "position": "Project Manager",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "Opportunity [ATFM] Procurement of PSS for Data Transfer/Data Lake project - TFM"
  },
  "R-0003": {
   "id": "R-0003",
   "label": "Generic Resource 7 (R-0003)",
   "position": "DBA L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV] LTA (Time Based)"
  },
  "R-0004": {
   "id": "R-0004",
   "label": "Generic 4 (R-0004)",
   "position": "DCOps",
   "grade": 4,
   "availableFrom": "2026-01",
   "status": "Rolling off 0-6m",
   "currentProject": "[ATFM] Year 8 Renewal [CV]_SPF"
  },
  "R-0005": {
   "id": "R-0005",
   "label": "Generic Resource 7 (R-0005)",
   "position": "Network Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Rolling off 0-6m",
   "currentProject": "[Non-ATFM] MHA HTSC NOC - Phase 2A"
  },
  "R-0006": {
   "id": "R-0006",
   "label": "Generic Resource 7 (R-0006)",
   "position": "Server Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - SFA"
  },
  "R-0007": {
   "id": "R-0007",
   "label": "Generic 4 (R-0007)",
   "position": "DCOps",
   "grade": 4,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "MAS Onboarding Services Year8 FY26"
  },
  "R-0008": {
   "id": "R-0008",
   "label": "Generic Resource 3 (R-0008)",
   "position": "DCOps",
   "grade": 3,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV] LTA (Time Based)"
  },
  "R-0009": {
   "id": "R-0009",
   "label": "Generic Resource 6 (R-0009)",
   "position": "Server Engineer L1",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV]_SPF"
  },
  "R-0010": {
   "id": "R-0010",
   "label": "Generic Resource 7 (R-0010)",
   "position": "Cloud Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - MTI"
  },
  "R-0011": {
   "id": "R-0011",
   "label": "Generic Resource 6 (R-0011)",
   "position": "Server Engineer L1",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV]_SPF"
  },
  "R-0012": {
   "id": "R-0012",
   "label": "Generic Resource 3 (R-0012)",
   "position": "DCOps",
   "grade": 3,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - Judiciary"
  },
  "R-0013": {
   "id": "R-0013",
   "label": "Generic Resource 7 (R-0013)",
   "position": "Project Manager",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - IPOS - GCC"
  },
  "R-0014": {
   "id": "R-0014",
   "label": "Generic Resource 7 (R-0014)",
   "position": "Tools Engineer L2 (Observability)",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "OECM2211009_WC_a - IT Service Desk (Helpdesk, Desktop Support and Services)_Base"
  },
  "R-0015": {
   "id": "R-0015",
   "label": "Generic Resource 7 (R-0015)",
   "position": "DBA L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Rolling off 0-6m",
   "currentProject": "[ATFM] SEMS2 - Windows upgrade for 8 servers"
  },
  "R-0016": {
   "id": "R-0016",
   "label": "Generic Resource 7 (R-0016)",
   "position": "Server Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Rolling off 0-6m",
   "currentProject": "[Non-ATFM] MESP - NextCloud POC"
  },
  "R-0020": {
   "id": "R-0020",
   "label": "Generic Resource 7 (R-0020)",
   "position": "Server Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[Non-ATFM] Procurement of 67 SR Man-Days"
  },
  "R-0021": {
   "id": "R-0021",
   "label": "Generic Resource 7 (R-0021)",
   "position": "Server Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "SCDF Base Year8 FY26"
  },
  "R-0023": {
   "id": "R-0023",
   "label": "Generic Resource 7 (R-0023)",
   "position": "Server Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - Judiciary"
  },
  "R-0026": {
   "id": "R-0026",
   "label": "Generic Resource 7 (R-0026)",
   "position": "IT Security Officer",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - Judiciary"
  },
  "R-0027": {
   "id": "R-0027",
   "label": "Generic Resource 3 (R-0027)",
   "position": "DCOps",
   "grade": 3,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[Non-ATFM]: WOA CV extension for 3 month"
  },
  "R-0028": {
   "id": "R-0028",
   "label": "Generic Resource 3 (R-0028)",
   "position": "DCOps",
   "grade": 3,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[Non-ATFM]: WOA CV extension for 3 month"
  },
  "R-0052": {
   "id": "R-0052",
   "label": "Generic Resource 7 (R-0052)",
   "position": "Cloud Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - MCCY - TFM"
  },
  "R-0053": {
   "id": "R-0053",
   "label": "Generic Resource 6 (R-0053)",
   "position": "Cloud Engineer L2",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 MCCY Renewal PSS for Project Works (1000 PSS) - MCCY - TFM"
  },
  "R-0055": {
   "id": "R-0055",
   "label": "Generic Resource 7 (R-0055)",
   "position": "Network Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV] LTA (Time Based)"
  },
  "R-0057": {
   "id": "R-0057",
   "label": "Generic Resource 7 (R-0057)",
   "position": "Cloud Engineer L3",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 MCCY Renewal PSS for Project Works (1000 PSS) - MCCY - TFM"
  },
  "R-0058": {
   "id": "R-0058",
   "label": "Generic Resource 7 (R-0058)",
   "position": "Cloud Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "Opportunity [ATFM] Procurement of PSS for Data Transfer/Data Lake project - TFM"
  },
  "R-0059": {
   "id": "R-0059",
   "label": "Generic Resource 6 (R-0059)",
   "position": "Data Analyst",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "ATFM Back End Support"
  },
  "R-0060": {
   "id": "R-0060",
   "label": "Generic Resource 7 (R-0060)",
   "position": "Cloud Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "Opportunity [ATFM] Procurement of PSS for Data Transfer/Data Lake project - TFM"
  },
  "R-0061": {
   "id": "R-0061",
   "label": "Generic Resource 7 (R-0061)",
   "position": "Network Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "SCDF Base Year8 FY26"
  },
  "R-0068": {
   "id": "R-0068",
   "label": "Generic Resource 8 (R-0068)",
   "position": "DBA L2",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Additional PSS works & System Restoration project"
  },
  "R-0104": {
   "id": "R-0104",
   "label": "Generic Resource 6 (R-0104)",
   "position": "Cloud Engineer L1",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Rolling off 0-6m",
   "currentProject": "[ATFM] ONE MAP for SLA internal User (PROD)"
  },
  "R-0190": {
   "id": "R-0190",
   "label": "Generic 4 (R-0190)",
   "position": "DCOps",
   "grade": 4,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV]_SPS"
  },
  "R-0251": {
   "id": "R-0251",
   "label": "Generic 4 (R-0251)",
   "position": "DCOps",
   "grade": 4,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV] LTA (Time Based)"
  },
  "R-0299": {
   "id": "R-0299",
   "label": "Generic Resource 6 (R-0299)",
   "position": "Network Engineer L2",
   "grade": 6,
   "availableFrom": "2027-01",
   "status": "Rolling off 7-12m",
   "currentProject": "[ATFM] Year 8 Renewal [CV]_SPF"
  },
  "R-0403": {
   "id": "R-0403",
   "label": "Generic Resource 6 (R-0403)",
   "position": "Network Engineer L1",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV]_SPF"
  },
  "R-0415": {
   "id": "R-0415",
   "label": "Generic Resource 8 (R-0415)",
   "position": "Server Engineer L2",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV]_HTA"
  },
  "R-0475": {
   "id": "R-0475",
   "label": "Generic Resource 8 (R-0475)",
   "position": "Project Manager",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[AD] ECID Track Change for NSEW Line (CR#1)"
  },
  "R-0480": {
   "id": "R-0480",
   "label": "Generic Resource 8 (R-0480)",
   "position": "Project Manager",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[AD] PSR Over Run (CR # 4)"
  },
  "R-0490": {
   "id": "R-0490",
   "label": "Generic Resource 7 (R-0490)",
   "position": "SDM",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - Judiciary"
  },
  "R-0500": {
   "id": "R-0500",
   "label": "Generic Resource 7 (R-0500)",
   "position": "Project Manager",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - IPOS - GCC"
  },
  "R-0501": {
   "id": "R-0501",
   "label": "Generic Resource 7 (R-0501)",
   "position": "SDM",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Additional PSS works & System Restoration project"
  },
  "R-0526": {
   "id": "R-0526",
   "label": "Generic 4 (R-0526)",
   "position": "DCOps",
   "grade": 4,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV] LTA (Time Based)"
  },
  "R-0679": {
   "id": "R-0679",
   "label": "Generic Resource 6 (R-0679)",
   "position": "IT Security Officer",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Rolling off 0-6m",
   "currentProject": "[Non-ATFM] : T/ITSS/11/FY25 - IMPLEMENTATION OF INTEGRATED IT END-USER SUPPORT SERVICES FOR A*STAR"
  },
  "R-0680": {
   "id": "R-0680",
   "label": "Generic Resource 6 (R-0680)",
   "position": "IT Security Officer",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Rolling off 0-6m",
   "currentProject": "[Non-ATFM] : T/ITSS/11/FY25 - IMPLEMENTATION OF INTEGRATED IT END-USER SUPPORT SERVICES FOR A*STAR"
  },
  "R-0770": {
   "id": "R-0770",
   "label": "Generic Resource 5 (R-0770)",
   "position": "Network Engineer L2",
   "grade": 5,
   "availableFrom": "2027-01",
   "status": "Rolling off 7-12m",
   "currentProject": "[ATFM] Year 8 Renewal - MUIS - AFM"
  },
  "R-0832": {
   "id": "R-0832",
   "label": "Generic Resource 5 (R-0832)",
   "position": "Server Engineer L1",
   "grade": 5,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "SCDF Base Year8 FY26"
  },
  "R-0833": {
   "id": "R-0833",
   "label": "Generic Resource 7 (R-0833)",
   "position": "Network Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "SCDF Base Year8 FY26"
  },
  "R-0836": {
   "id": "R-0836",
   "label": "Generic Resource 5 (R-0836)",
   "position": "Network Engineer L2",
   "grade": 5,
   "availableFrom": "2027-01",
   "status": "Rolling off 7-12m",
   "currentProject": "[ATFM] Year 8 Renewal - MTI"
  },
  "R-0871": {
   "id": "R-0871",
   "label": "Generic Resource 6 (R-0871)",
   "position": "Network Engineer L2",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Rolling off 0-6m",
   "currentProject": "CEA Base Year8 FY26"
  },
  "R-0889": {
   "id": "R-0889",
   "label": "Generic Resource 8 (R-0889)",
   "position": "Cloud Architect",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal [CV]_EMA"
  },
  "R-0916": {
   "id": "R-0916",
   "label": "Generic Resource 7 (R-0916)",
   "position": "SDM",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[Non-ATFM]: WOA CV extension for 3 month"
  },
  "R-0919": {
   "id": "R-0919",
   "label": "Generic Resource 7 (R-0919)",
   "position": "Network Engineer L2",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] xEDI Operation for HTX"
  },
  "R-0934": {
   "id": "R-0934",
   "label": "Generic Resource 8 (R-0934)",
   "position": "IT Security Officer",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - IPOS - AFM - HQ"
  },
  "R-0965": {
   "id": "R-0965",
   "label": "Generic Resource 7 (R-0965)",
   "position": "SDM",
   "grade": 7,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Year 8 Renewal - Judiciary"
  },
  "R-0987": {
   "id": "R-0987",
   "label": "Generic Resource 8 (R-0987)",
   "position": "DBA L2",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Professional Support Services for Project Works - 87 Mandays"
  },
  "R-0988": {
   "id": "R-0988",
   "label": "Generic Resource 8 (R-0988)",
   "position": "Project Manager",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] Professional Support Services for Project Works - 87 Mandays"
  },
  "R-0997": {
   "id": "R-0997",
   "label": "Generic Resource 8 (R-0997)",
   "position": "Technical Architect",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "Opportunity [ATFM] Procurement of PSS for Data Transfer/Data Lake project - TFM"
  },
  "R-1020": {
   "id": "R-1020",
   "label": "Generic Resource 6 (R-1020)",
   "position": "Network Engineer L1",
   "grade": 6,
   "availableFrom": "2026-01",
   "status": "Rolling off 0-6m",
   "currentProject": "HPB Base Year8 FY26"
  },
  "R-1177": {
   "id": "R-1177",
   "label": "Generic Resource 8 (R-1177)",
   "position": "Technical Architect",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[Non-ATFM]: Implementation of SPACE AND INFRASTRUCTURE MANAGEMENT SYSTEM (SIMS)"
  },
  "R-1178": {
   "id": "R-1178",
   "label": "Generic Resource 8 (R-1178)",
   "position": "Technical Architect",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[Non-ATFM] Home Team Sustainment Centre (HTSC) - EAP Project"
  },
  "R-1181": {
   "id": "R-1181",
   "label": "Generic Resource 8 (R-1181)",
   "position": "Technical Architect",
   "grade": 8,
   "availableFrom": "2026-01",
   "status": "Available now",
   "currentProject": "[ATFM] xEDI Operation for HTX - Non WOG"
  }
 }
};
