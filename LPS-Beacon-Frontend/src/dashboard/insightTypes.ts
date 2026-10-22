// src/dashboard/insightTypes.ts
// GET /dashboard/insights: the Dashboard's charts from all uploaded files, prepared by the pipeline
// (LPS-Beacon_Backend/lambda-forecastpipeline/pipeline/insights.py). Money is in US dollars, percentages are
// fractions (0.85 = 85%), months are "YYYY-MM". A part is null when its file was not uploaded yet.

export interface DashboardInsights {
  asOf: string;
  currency: string;
  pipeline: SalesPipeline | null;
  resources: ResourceOutlook | null;
  utilisation: Utilisation | null;
  workforce: Workforce | null;
  notes: string[];
}

export interface SalesPipeline {
  kpis: {
    openCount: number;
    openTcv: number;
    openWeightedTcv: number; // TCV x probability
    winRate: number | null; // closed won / all closed, expected close in the last 12 months
    closedLast12m: number;
    wonTcvLast12m: number;
  };
  byStage: { stage: string; count: number; tcv: number; weightedTcv: number }[];
  revenueByMonth: { month: string; booked: number; openWeighted: number; open: number }[];
  topOpen: {
    crmId: string;
    name: string;
    customer: string | null;
    stage: string;
    probability: number;
    tcv: number;
    weightedTcv: number;
    expectedClose: string | null;
    offering: string | null;
  }[];
}

export interface ResourceOutlook {
  run: { runId: string; asOf: string | null; publishedAt: string | null };
  rollOffs?: { month: string; available: number; availableIfNotRenewed: number; pipelineDemand: number; matched: number }[];
  benchRisk?: { role: string; availableNow: number; rollingOff6m: number; total: number }[];
  benchRiskTotal?: number;
}

export interface Utilisation {
  latestMonth: string;
  overallTarget: number | null;
  nonBillableByMonth: {
    month: string;
    workingDays: number;
    leave: number;
    missingManday: number;
    admin: number;
    training: number;
    presales: number;
    internal: number;
    bench: number;
  }[];
  byTeam: { name: string; staff: number; billableUr: number | null }[];
  byTier: { name: string; staff: number; billableUr: number | null }[];
}

export interface Workforce {
  upcomingLeavers: ({ month: string; total: number } & Record<string, number | string>)[];
  upcomingLeaversTotal: number;
}
