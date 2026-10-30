/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/telegram-update.schema.json */

/**
 * Sahte Telegram (fixtures/telegram, Worker testleri) için daraltılmış Bot API Update nesnesi: message, edited_message, callback_query, my_chat_member, chat_member (setWebhook allowed_updates ile aynı küme). Tam olarak bir olay alanı taşır. YALNIZ sahte/fikstür güncellemelerini doğrular: gerçek Bot API güncellemeleri burada tanımsız alanlar taşır (link_preview_options, sticker, quote, external_reply, chat.photo …); Worker canlı webhook güncellemesini bu şemayla REDDETMEZ, yalnız kullandığı alanları okur.
 */
export interface TelegramUpdate {
  update_id: number;
  message?: Message;
  edited_message?: Message;
  callback_query?: CallbackQuery;
  my_chat_member?: ChatMemberUpdated;
  chat_member?: ChatMemberUpdated;
}
export interface Message {
  message_id: number;
  message_thread_id?: number;
  from?: User;
  sender_chat?: Chat;
  /**
   * Unix zamanı (saniye)
   */
  date: number;
  edit_date?: number;
  chat: Chat;
  is_topic_message?: boolean;
  is_automatic_forward?: boolean;
  has_protected_content?: boolean;
  forward_origin?: {
    type: string;
    date: number;
  };
  via_bot?: User;
  media_group_id?: string;
  author_signature?: string;
  text?: string;
  entities?: Entity[];
  caption?: string;
  caption_entities?: Entity[];
  voice?: Voice;
  audio?: Audio;
  photo?: PhotoSize[];
  document?: Document;
  new_chat_members?: User[];
  left_chat_member?: User;
  new_chat_title?: string;
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
  pinned_message?: ReplyMessage;
  reply_markup?: InlineKeyboardMarkup;
  reply_to_message?: ReplyMessage1;
}
/**
 * Telegram User (alt küme). first_name/last_name yalnız resolve_telegram'a gider.
 */
export interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
  can_connect_to_business?: boolean;
  has_main_web_app?: boolean;
}
export interface Chat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
  all_members_are_administrators?: boolean;
}
export interface Entity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: User;
  language?: string;
  custom_emoji_id?: string;
}
export interface Voice {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  duration: number;
  mime_type?: string;
}
export interface Audio {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  duration: number;
  mime_type?: string;
  performer?: string;
  title?: string;
  file_name?: string;
}
export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  width: number;
  height: number;
}
export interface Document {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
}
/**
 * Yanıtlanan/sabitlenen mesaj (iç içe reply_to_message yok; şema özyinelemesizdir)
 */
export interface ReplyMessage {
  message_id: number;
  message_thread_id?: number;
  from?: User;
  sender_chat?: Chat;
  /**
   * Unix zamanı (saniye)
   */
  date: number;
  edit_date?: number;
  chat: Chat;
  is_topic_message?: boolean;
  is_automatic_forward?: boolean;
  has_protected_content?: boolean;
  forward_origin?: {
    type: string;
    date: number;
  };
  via_bot?: User;
  media_group_id?: string;
  author_signature?: string;
  text?: string;
  entities?: Entity[];
  caption?: string;
  caption_entities?: Entity[];
  voice?: Voice;
  audio?: Audio;
  photo?: PhotoSize[];
  document?: Document;
  new_chat_members?: User[];
  left_chat_member?: User;
  new_chat_title?: string;
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
  reply_markup?: InlineKeyboardMarkup;
}
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}
export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
/**
 * Yanıtlanan/sabitlenen mesaj (iç içe reply_to_message yok; şema özyinelemesizdir)
 */
export interface ReplyMessage1 {
  message_id: number;
  message_thread_id?: number;
  from?: User;
  sender_chat?: Chat;
  /**
   * Unix zamanı (saniye)
   */
  date: number;
  edit_date?: number;
  chat: Chat;
  is_topic_message?: boolean;
  is_automatic_forward?: boolean;
  has_protected_content?: boolean;
  forward_origin?: {
    type: string;
    date: number;
  };
  via_bot?: User;
  media_group_id?: string;
  author_signature?: string;
  text?: string;
  entities?: Entity[];
  caption?: string;
  caption_entities?: Entity[];
  voice?: Voice;
  audio?: Audio;
  photo?: PhotoSize[];
  document?: Document;
  new_chat_members?: User[];
  left_chat_member?: User;
  new_chat_title?: string;
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
  reply_markup?: InlineKeyboardMarkup;
}
export interface CallbackQuery {
  id: string;
  from: User;
  message?: ReplyMessage;
  inline_message_id?: string;
  chat_instance: string;
  /**
   * ans:<session>:<question>:<key> | hint:<question> | human:<message_id> | consent:<kind>:<yes|no> | diag:continue|later
   */
  data?: string;
}
export interface ChatMemberUpdated {
  chat: Chat;
  from: User;
  date: number;
  old_chat_member: ChatMember;
  new_chat_member: ChatMember;
  via_join_request?: boolean;
  via_chat_folder_invite_link?: boolean;
}
/**
 * ChatMember (owner/administrator/member/restricted/left/kicked birleşik alt kümesi)
 */
export interface ChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: User;
  is_anonymous?: boolean;
  custom_title?: string;
  until_date?: number;
  is_member?: boolean;
  can_be_edited?: boolean;
  can_manage_chat?: boolean;
  can_delete_messages?: boolean;
  can_manage_video_chats?: boolean;
  can_restrict_members?: boolean;
  can_promote_members?: boolean;
  can_change_info?: boolean;
  can_invite_users?: boolean;
  can_post_messages?: boolean;
  can_edit_messages?: boolean;
  can_pin_messages?: boolean;
  can_manage_topics?: boolean;
  can_post_stories?: boolean;
  can_edit_stories?: boolean;
  can_delete_stories?: boolean;
  can_send_messages?: boolean;
  can_send_audios?: boolean;
  can_send_documents?: boolean;
  can_send_photos?: boolean;
  can_send_videos?: boolean;
  can_send_video_notes?: boolean;
  can_send_voice_notes?: boolean;
  can_send_polls?: boolean;
  can_send_other_messages?: boolean;
  can_add_web_page_previews?: boolean;
}
