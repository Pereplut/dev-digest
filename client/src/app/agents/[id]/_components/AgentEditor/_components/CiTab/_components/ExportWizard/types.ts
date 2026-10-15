import type { CiPostAs, CiTrigger } from "@devdigest/shared";

export type WizardStep = 0 | 1 | 2 | 3;

export type TriggerState = Record<CiTrigger, boolean>;

export type PostAs = CiPostAs;
