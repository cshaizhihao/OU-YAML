import type { GeneratedSubscription } from "./domain";
import type { MihomoConfig } from "./types";

export type SubscriptionEditorTab = "nodes" | "groups" | "rules";
export type SubscriptionEditorState = { subscription: GeneratedSubscription; config: MihomoConfig; revision: string };
export type SubscriptionEditInput = { name: string; config: MihomoConfig; revision: string };
