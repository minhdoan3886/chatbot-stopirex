export type InboundMessage = {
  id: string;
  sentAt: Date;
  text?: string;
};

export function batchMessages(messages: readonly InboundMessage[]): string {
  return [...messages]
    .sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime())
    .map((message) => message.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n");
}
