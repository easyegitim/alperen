/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). */
export interface StandaloneError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}
export interface StandaloneValidate {
  (data: unknown, ctx?: unknown): boolean;
  errors?: StandaloneError[] | null;
}
/** https://ogrenmen.easy/schemas/bot-response-log.json */
export declare const botResponseLog: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json */
export declare const common: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/date */
export declare const commonDate: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/dateTime */
export declare const commonDateTime: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/evidenceRef */
export declare const commonEvidenceRef: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/optionKey */
export declare const commonOptionKey: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/probability */
export declare const commonProbability: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/providerAttempt */
export declare const commonProviderAttempt: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/skillId */
export declare const commonSkillId: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/speaker */
export declare const commonSpeaker: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/studentRef */
export declare const commonStudentRef: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/tag */
export declare const commonTag: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/timedQuote */
export declare const commonTimedQuote: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/ts */
export declare const commonTs: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/usd */
export declare const commonUsd: StandaloneValidate;
/** https://ogrenmen.easy/schemas/common.json#/$defs/uuid */
export declare const commonUuid: StandaloneValidate;
/** https://ogrenmen.easy/schemas/curriculum.json */
export declare const curriculum: StandaloneValidate;
/** https://ogrenmen.easy/schemas/curriculum.json#/$defs/curriculum */
export declare const curriculumCurriculum: StandaloneValidate;
/** https://ogrenmen.easy/schemas/curriculum.json#/$defs/prerequisite */
export declare const curriculumPrerequisite: StandaloneValidate;
/** https://ogrenmen.easy/schemas/curriculum.json#/$defs/skill */
export declare const curriculumSkill: StandaloneValidate;
/** https://ogrenmen.easy/schemas/diagnostic-test.json */
export declare const diagnosticTest: StandaloneValidate;
/** https://ogrenmen.easy/schemas/diagnostic-test.json#/$defs/figure */
export declare const diagnosticTestFigure: StandaloneValidate;
/** https://ogrenmen.easy/schemas/diagnostic-test.json#/$defs/item */
export declare const diagnosticTestItem: StandaloneValidate;
/** https://ogrenmen.easy/schemas/exam-item.json */
export declare const examItem: StandaloneValidate;
/** https://ogrenmen.easy/schemas/exam-priority-plan.json */
export declare const examPriorityPlan: StandaloneValidate;
/** https://ogrenmen.easy/schemas/figure-render-report.json */
export declare const figureRenderReport: StandaloneValidate;
/** https://ogrenmen.easy/schemas/figure-render-report.json#/$defs/mismatch */
export declare const figureRenderReportMismatch: StandaloneValidate;
/** https://ogrenmen.easy/schemas/figure-render-report.json#/$defs/render */
export declare const figureRenderReportRender: StandaloneValidate;
/** https://ogrenmen.easy/schemas/generation-request.json */
export declare const generationRequest: StandaloneValidate;
/** https://ogrenmen.easy/schemas/instructor-alert.json */
export declare const instructorAlert: StandaloneValidate;
/** https://ogrenmen.easy/schemas/lesson-analysis.json */
export declare const lessonAnalysis: StandaloneValidate;
/** https://ogrenmen.easy/schemas/memory-fact.json */
export declare const memoryFact: StandaloneValidate;
/** https://ogrenmen.easy/schemas/misconception-tags.json */
export declare const misconceptionTags: StandaloneValidate;
/** https://ogrenmen.easy/schemas/misconception-tags.json#/$defs/tag */
export declare const misconceptionTagsTag: StandaloneValidate;
/** https://ogrenmen.easy/schemas/models.json */
export declare const models: StandaloneValidate;
/** https://ogrenmen.easy/schemas/models.json#/$defs/chain */
export declare const modelsChain: StandaloneValidate;
/** https://ogrenmen.easy/schemas/models.json#/$defs/model */
export declare const modelsModel: StandaloneValidate;
/** https://ogrenmen.easy/schemas/models.json#/$defs/provider */
export declare const modelsProvider: StandaloneValidate;
/** https://ogrenmen.easy/schemas/nightly-facts-output.json */
export declare const nightlyFactsOutput: StandaloneValidate;
/** https://ogrenmen.easy/schemas/query-expand.json */
export declare const queryExpand: StandaloneValidate;
/** https://ogrenmen.easy/schemas/question-item.json */
export declare const questionItem: StandaloneValidate;
/** https://ogrenmen.easy/schemas/research-output.json */
export declare const researchOutput: StandaloneValidate;
/** https://ogrenmen.easy/schemas/research-output.json#/$defs/citation */
export declare const researchOutputCitation: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json */
export declare const telegramUpdate: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/audio */
export declare const telegramUpdateAudio: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/callbackQuery */
export declare const telegramUpdateCallbackQuery: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/chat */
export declare const telegramUpdateChat: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/chatMember */
export declare const telegramUpdateChatMember: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/chatMemberUpdated */
export declare const telegramUpdateChatMemberUpdated: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/document */
export declare const telegramUpdateDocument: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/entity */
export declare const telegramUpdateEntity: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/inlineButton */
export declare const telegramUpdateInlineButton: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/inlineKeyboardMarkup */
export declare const telegramUpdateInlineKeyboardMarkup: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/message */
export declare const telegramUpdateMessage: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/photoSize */
export declare const telegramUpdatePhotoSize: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/replyMessage */
export declare const telegramUpdateReplyMessage: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/user */
export declare const telegramUpdateUser: StandaloneValidate;
/** https://ogrenmen.easy/schemas/telegram-update.json#/$defs/voice */
export declare const telegramUpdateVoice: StandaloneValidate;
/** https://ogrenmen.easy/schemas/template-params.json */
export declare const templateParams: StandaloneValidate;
/** https://ogrenmen.easy/schemas/template-params.json#/$defs/leaf */
export declare const templateParamsLeaf: StandaloneValidate;
/** https://ogrenmen.easy/schemas/template-params.json#/$defs/scalar */
export declare const templateParamsScalar: StandaloneValidate;
/** https://ogrenmen.easy/schemas/template-params.json#/$defs/value */
export declare const templateParamsValue: StandaloneValidate;
/** https://ogrenmen.easy/schemas/transcript.json */
export declare const transcript: StandaloneValidate;
/** https://ogrenmen.easy/schemas/transcript.json#/$defs/segment */
export declare const transcriptSegment: StandaloneValidate;
/** https://ogrenmen.easy/schemas/tutor-reply.json */
export declare const tutorReply: StandaloneValidate;
/** https://ogrenmen.easy/schemas/weekly-summary.json */
export declare const weeklySummary: StandaloneValidate;
