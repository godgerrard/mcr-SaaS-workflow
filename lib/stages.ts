export const STAGES = ["camera", "edit", "graphics", "sound", "final_qc"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  camera: "CAMERA", edit: "EDIT", graphics: "GFX", sound: "SOUND", final_qc: "TX / QC",
};

export const STATUS_META: Record<string, { label: string; tally: string }> = {
  proposed: { label: "STANDBY", tally: "amber" },
  in_production: { label: "ON AIR", tally: "red" },
  complete: { label: "READY", tally: "green" },
  rejected: { label: "OFF AIR", tally: "off" },
  on_hold: { label: "HOLD", tally: "amber" },
};
