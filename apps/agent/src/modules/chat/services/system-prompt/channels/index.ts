import { Channel, ChannelPromptConfig } from "../types";
import { widgetConfig } from "./widget";
import { emailConfig } from "./email";
import { chatMessengerConfig } from "../visitor-info/chatMessenger";

const channelConfigs: Record<Channel, ChannelPromptConfig> = {
    widget: widgetConfig,
    email: emailConfig,
    whatsapp: chatMessengerConfig,
    telegram: chatMessengerConfig,
    threads: {
        style: "Write concise, helpful replies in plain text. Use short paragraphs or bullets. Call escalate_to_human when the customer asks for the team or when the available information cannot resolve the issue.",
        idVerification: "The customer has already signed in to their support portal. Do not ask for verification codes or unrelated personal details.",
        getVisitorInfoInstructions: () => "",
    },
};

/** Widget is the default: it's the richest/most common surface and a safe fallback when `channel` is omitted. */
export function getChannelConfig(channel?: Channel): ChannelPromptConfig {
    return (channel && channelConfigs[channel]) || widgetConfig;
}