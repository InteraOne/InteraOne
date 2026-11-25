import { CollectUserInfo, KnownVisitorDetails } from "../../chat.types";

export type Channel = "widget" | "email" | "whatsapp" | "telegram" | "threads";

export interface BuildSystemPromptOptions {
    companyName?: string;
    fallbackToAgent: boolean;
    collectUserInfo?: CollectUserInfo;
    knownVisitorDetails?: KnownVisitorDetails;
    channel?: Channel;
}

/**
 * Everything a single channel needs to contribute to the final prompt.
 * Each channel module (channels/*.ts) implements this shape so the
 * composer (index.ts) never has to branch on `channel` itself.
 */
export interface ChannelPromptConfig {
    /** Formatting/etiquette rules specific to how this channel renders messages. */
    style: string;
    /** How identity verification works for this channel (email is pre-verified, others need OTP). */
    idVerification: string;
    /**
     * How to ask for missing visitor fields (name/email/phone) on this channel.
     * `fieldList` is a precomputed, human-readable list like "name, email".
     */
    getVisitorInfoInstructions: (fieldList: string) => string;
}