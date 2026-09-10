export interface OutboundMessage {
  chatRef: string;
  text: string;
}

export interface ChannelPort {
  readonly channel: 'telegram' | 'whatsapp';
  supportsGroupSurface(): boolean;
  send(message: OutboundMessage): Promise<void>;
  fanOut(chatRefs: string[], text: string): Promise<void>;
}
