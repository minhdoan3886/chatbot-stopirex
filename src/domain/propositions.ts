import type { SemanticTopic } from "./consultation.js";

export type PropositionSpeechAct =
  | "question"
  | "provide_data"
  | "update"
  | "confirm"
  | "reject"
  | "request";

export type PropositionAction =
  | "answer_question"
  | "set_quantity"
  | "provide_order_field"
  | "append_delivery_note"
  | "continue_order_collection"
  | "pause_order"
  | "decline_purchase"
  | "handoff_to_human"
  | "record_fact";

export type PropositionOrderField =
  | "recipientName"
  | "phone"
  | "legacyAddress"
  | "deliveryNote";

/**
 * One independently verifiable meaning unit from the customer's message.
 * rawEvidence is deliberately retained so reducers never need to trust a
 * normalized value without being able to trace it back to customer text.
 */
export type ConversationProposition = {
  id: string;
  speechAct: PropositionSpeechAct;
  action: PropositionAction;
  target?: string;
  topic?: SemanticTopic;
  field?: PropositionOrderField;
  value?: string | number | boolean;
  quantity?: 1 | 2 | 3 | 4 | 5;
  rawEvidence: string;
  confidence: number;
};

export type ClaimedSavedField = {
  field: PropositionOrderField | "quantity";
  value: string;
};
