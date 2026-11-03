// src/review/flags.ts
// Review steps that can be switched on and off at build time.
//
// The Forecast step (resources for SFDC pipeline opportunities, estimated from past projects) was switched off
// after the 28 Oct 2026 demo: matching is redeployment only, people on the bench or rolling off onto won and
// ongoing work. The code is kept. To bring the step back, build with VITE_PIPELINE_FORECAST_STEP=true and set
// PIPELINE_FORECAST_STEP=true on the forecast pipeline Lambda.
export const FORECAST_STEP = import.meta.env.VITE_PIPELINE_FORECAST_STEP === "true";
