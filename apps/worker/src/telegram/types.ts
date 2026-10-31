/** Telegram Bot API veri türlerinin Worker'ın kullandığı alt kümesi. */

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TgEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TgInlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgReplyMarkup {
  inline_keyboard: TgInlineButton[][];
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  edit_date?: number;
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  reply_to_message?: TgMessage;
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
  voice?: { file_id: string; duration?: number };
  audio?: { file_id: string; duration?: number };
  photo?: unknown[];
  reply_markup?: TgReplyMarkup;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
  chat_instance?: string;
}

export interface TgChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  user: TgUser;
  can_pin_messages?: boolean;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: TgChatMemberUpdated;
  chat_member?: TgChatMemberUpdated;
}

export interface TgMe {
  id: number;
  is_bot: boolean;
  username?: string;
  can_read_all_group_messages?: boolean;
}

export interface TgSentMessage {
  message_id: number;
  chat: TgChat;
  date: number;
}
