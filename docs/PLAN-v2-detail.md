# Öğrenmen 2.0 — Implementation detail (companion to docs/PLAN-v2.md)

English, for the coding agents. docs/PLAN-v2.md (Turkish) is the approved plan; this file pins the shapes the
plan refers to. When the two disagree, PLAN-v2.md wins on intent and this file wins on names/columns.

## 1. Repo layout (target)

```
apps/web            Next.js (App Router, React 19, Tailwind 4) — student / parent / instructor app, PWA
apps/worker         Node 22 — pg-boss consumer, Anthropic tool loops, Playwright PDF, web-push, embeddings
pipelines/ders      Python 3.13 — ffmpeg + Groq STT HTTP service (P5)
pipelines/verify    Python — SymPy verifier HTTP service, from pipelines/tablet/verify.py (P3)
pipelines/tablet, pipelines/kalem, pipelines/common   kept as libraries (Gemini/Telegram parts pruned over time)
packages/llm        Anthropic gateway: routes, caching, ledger, parse, streaming, batches, memory tool handlers, fake
packages/contracts  zod-first schemas (TS) + exported JSON Schema (for Python)
packages/doc-render React document-AST renderer (P3)
packages/design-system  tokens.json + TSX components (+ tokens-to-css)
packages/mastery-math, packages/pii   kept
supabase/           v2 migrations, seeds, tests, scripts
scripts/            check-all.sh (discovers */check.sh), drift/fixtures/rpc-parity checks, secret-scan
```

Conventions: TypeScript strict; code identifiers English, UI copy and comments Turkish; per-package `package.json`
inside one root bun workspace (`workspaces: ["apps/*", "packages/*"]`); every module ships `check.sh`
(lint + typecheck + unit tests) that `scripts/check-all.sh` discovers; no secrets in the repo (`scripts/secret-scan.sh`).
Local DB: `postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen` (throwaway test DBs are created by
`supabase/scripts/db-test.sh`; never drop the `ogrenmen` database itself).

## 2. Data model v2 (Postgres / Supabase)

### 2.1 Kept from v1 (same semantics; re-emitted in the v2 baseline)
`curricula` (+ `origin text check in ('seed','ai_draft','instructor')`, `source_refs jsonb`, `created_by uuid`),
`skills` (tree via `parent_id`, `is_leaf`, per-leaf `p_init/p_learn/p_guess/p_slip`), `skill_prerequisites`,
`misconception_tags`, `enrollments` (+ `course_id uuid`, `target_exam text`, `exam_date date`, `goal text`),
`observations` (+ `error_cause text check in ('concept','procedure','careless','reading','time')`; `source_type`
gains `'solution_analysis'`, `'exam_response'`), `mastery`, `mastery_history`, `misconceptions`,
`misconception_evidence`, `instructor_notes`, `preferences`, `questions`, `secure.answer_keys`,
`question_templates`, `attempts`, `content_pool`, `figures`, `memory_facts`, `weekly_summaries`,
`llm_calls` (+ `cache_read_tokens int`, `cache_write_tokens int`, `effort text`, `route text`), `spend_ledger`,
`runtime_flags`, `settings`, `lessons` (+ `upload_id`, `student_visible bool`, `auto_apply_threshold numeric
default 0.8`, `course_id`), `lesson_analyses`, `lesson_claims`, `courses` (+ `kind`, `created_by`, `visibility`),
`syllabus_topics`, `exam_sources`, `exam_items` (+ `format`, `trick`, `difficulty`), `exam_priority_plans`,
`library_documents`, `library_chunks`, `audit.events`, BKT functions in schema `app`, `public.apply_observation()`.
BKT SQL must stay byte-identical to `packages/mastery-math/sql/bkt.sql` (checked by `scripts/check-drift.py`).

### 2.2 Dropped
quota_*, consents, legal_texts, retention_*, storage_deletions, table_sizes_daily, secure.telegram_identities,
secure.staff_codes, secure.guardian_codes, tg_chats, chat_roles, tg_updates, messages, sessions, bot_responses,
provider_health, escalations, pilot_metrics, diagnostic_tests, diagnostic_sessions, research_*, citations,
roles `bot_runtime` and `batch_worker` (replaced by `service_role` used only by apps/worker), all consent/quota/
telegram RPCs, forbidden-word validators.

### 2.3 New tables
| table | columns (pk first) | notes |
|---|---|---|
| `profiles` | `id uuid pk references auth.users`, `role text check in ('student','parent','instructor','admin')`, `display_name text`, `locale text default 'tr'`, `tz text default 'Europe/Istanbul'`, `avatar_path text`, `onboarded_at timestamptz`, `created_at` | replaces `staff`; trigger creates a `students` row for role student |
| `students` (modified) | keep `id`, `public_ref`; add `profile_id uuid unique references profiles`, `grade text`, `school text`; drop tier/consent/minor columns | |
| `guardian_links` | `id`, `parent_id → profiles`, `student_id → students`, `relation text`, `status text check in ('invited','active','revoked')`, `invite_token_hash text`, `created_at`, unique(parent_id, student_id) | |
| `instructor_links` | `id`, `instructor_id → profiles`, `student_id → students`, `course_id uuid null`, `role text check in ('owner','viewer')`, unique(instructor_id, student_id, course_id) | replaces staff_students |
| `uploads` | `id`, `owner_id → profiles`, `student_id → students null`, `kind text check in ('photo','pdf','video','audio','transcript','document','canvas')`, `storage_path text`, `mime text`, `bytes bigint`, `sha256 text`, `width int`, `height int`, `pages int`, `anthropic_file_id text`, `status text check in ('stored','processing','ready','failed')`, `extracted_text text`, `embedding halfvec(1024)`, `created_at` | |
| `conversations` | `id`, `student_id`, `kind text check in ('coach','parent','instructor')`, `participant_id → profiles`, `course_id null`, `title text`, `mode text check in ('hint','explain','solve') default 'hint'`, `summary text`, `summary_upto_message_id bigint`, `last_message_at` | |
| `conversation_messages` | `id bigserial`, `conversation_id`, `role text check in ('user','assistant','system')`, `content jsonb` (Anthropic content blocks), `upload_ids uuid[]`, `llm_call_id bigint`, `tool_calls jsonb`, `created_at` | |
| `solution_analyses` | `id`, `enrollment_id`, `conversation_message_id null`, `exam_response_id null`, `upload_ids uuid[]`, `question_text text`, `student_work_text text`, `analysis jsonb`, `verdict text check in ('correct','wrong','incomplete','unreadable')`, `failing_step_no int`, `error_cause text`, `skill_ids text[]`, `misconception_tags text[]`, `style_id uuid null`, `proposal_id uuid null`, `model text`, `cost_usd numeric`, `embedding halfvec(1024)`, `created_at` | source row for observations |
| `exams` | `id`, `course_id`, `curriculum_id`, `created_by`, `kind text check in ('deneme','diagnostic','practice','published')`, `source text check in ('uploaded','generated','instructor')`, `title`, `publisher`, `held_on date`, `is_copyrighted bool default false`, `question_count int`, `sections jsonb`, `generated_document_id uuid null`, `status text` | |
| `exam_questions` | `id`, `exam_id`, `no int`, `section text`, `kind text check in ('mcq','numeric','open')`, `stem_text text`, `options jsonb`, `figure_upload_id uuid null`, `skill_ids text[]`, `style_id uuid null`, `difficulty numeric`, `question_id uuid null → questions`, unique(exam_id, no) | `stem_text` hidden from students when `exams.is_copyrighted` |
| `secure.exam_answer_keys` | `exam_question_id pk`, `correct_option text`, `numeric_value numeric`, `source text check in ('uploaded','inferred','instructor','generated')`, `confidence numeric` | read only inside `grade_exam_session()` |
| `exam_sessions` | `id`, `exam_id`, `enrollment_id`, `mode text check in ('in_app','uploaded')`, `started_at`, `finished_at`, `duration_sec int`, `status text check in ('in_progress','grading','analysing','done','failed')`, `score jsonb`, `report_document_id uuid null` | |
| `exam_responses` | `id`, `session_id`, `exam_question_id`, `answer text`, `outcome text check in ('correct','wrong','blank','unfinished')`, `time_spent_sec int`, `flagged bool`, `work_upload_ids uuid[]`, `how_far_text text`, `solution_analysis_id uuid null`, unique(session_id, exam_question_id) | source row for observations |
| `generated_documents` | `id`, `student_id null`, `course_id`, `kind text check in ('notes','mock_exam','report','question_set','answer_key')`, `title`, `spec jsonb`, `content jsonb` (document AST), `html_path`, `pdf_path`, `status text check in ('queued','generating','rendered','review','published','failed')`, `version int default 1`, `personalization jsonb`, `verification jsonb`, `model`, `cost_usd`, `created_by`, `created_at` | |
| `question_styles` | `id`, `course_id`, `curriculum_id`, `code text`, `name`, `description`, `format text`, `trick text`, `difficulty_band text`, `skill_ids text[]`, `years_hit smallint[]`, `years_total smallint`, `recency_score numeric`, `frequency_score numeric`, `exemplar_item_ids uuid[]`, `embedding halfvec(1024)`, `source text check in ('extracted','instructor')`, `status text`, `created_by` | |
| `style_coverage` | pk(`enrollment_id`, `style_id`), `seen_count int`, `solved_count int`, `correct_count int`, `last_seen_at` | |
| `curriculum_proposals` | `id`, `curriculum_id`, `kind text check in ('add_subskill','rename','merge','add_prereq','add_tag')`, `payload jsonb`, `evidence_ids uuid[]`, `status text check in ('open','accepted','rejected')`, `decided_by`, `decided_at`, `created_at` | |
| `memory_files` | pk(`student_id`, `path`), `content text`, `bytes int`, `updated_at` | memory tool store; path under `/memories/`, ≤12 files, ≤8 KB each |
| `memory_file_versions` | `id bigserial`, `student_id`, `path`, `version int`, `op text`, `actor text`, `content text`, `created_at` | |
| `notifications` | `id`, `recipient_id → profiles`, `kind text`, `title`, `body`, `payload jsonb`, `channels text[]`, `read_at`, `sent_at`, `created_at` | replaces proactive_messages |
| `notification_rules` | pk(`recipient_id`, `kind`), `enabled bool`, `params jsonb` | |
| `push_subscriptions` | `id`, `user_id`, `endpoint text unique`, `p256dh`, `auth`, `ua`, `created_at` | |
| `prompt_versions` | `id`, `route text`, `version text`, `system_text text`, `schema_name text`, `model text`, `effort text`, `active bool`, `created_at`, unique(route, version) | |
| `eval_cases` / `eval_runs` | cases: `id`, `route`, `input jsonb`, `expected jsonb`, `upload_ids`, `notes`; runs: `id`, `route`, `prompt_version`, `started_at`, `finished_at`, `scores jsonb`, `summary` | |
| `student_dossier_cache` | pk(`student_id`, `course_id`), `hash text`, `rendered text`, `updated_at` | |

### 2.4 RLS (who sees what)
- helper `app.uid()` = `auth.uid()`; `app.role()` from `profiles`; `app.my_student_id()`; `app.my_children()`
  (active guardian_links); `app.my_students()` (instructor_links); admin bypass via `profiles.role='admin'`.
- Student: own rows (`student_id = app.my_student_id()`), curricula/skills/question_styles of enrolled courses,
  `exam_questions` of exams with an own session (and `stem_text` masked via a view when `is_copyrighted`); never `secure.*`.
- Parent: children's `generated_documents(kind='report')`, `exam_sessions`(score), `mastery` (via view),
  `notifications`, `conversations(kind='parent')` of their own; never `conversation_messages` of kind coach,
  never `exam_questions`, never raw `uploads`.
- Instructor: full read on linked students; writes through RPCs (`approve_*`, `decide_proposal`, `set_exam_key`).
- `service_role` (worker) bypasses RLS; the web app uses the user's JWT only.

### 2.5 RPCs (SECURITY DEFINER, OGR-* error codes as in v1)
`apply_diagnosis(p_analysis jsonb)` → inserts solution_analyses + observations (weight 0.5 for careless/time) +
style_coverage, returns id · `grade_exam_session(p_session uuid)` → outcomes, score, observations(kind='test',
guess_override 0.2) · `start_exam_session`, `record_exam_response` · `render_dossier(p_student, p_course)` →
structured JSON for the dossier block · `decide_proposal(p_id, p_accept)` · `set_exam_key(p_exam_question, …)` ·
`accept_guardian_invite(p_token)` · `create_guardian_invite(p_student)` · `enqueue_job(name, data)` (pg-boss
`send` via SQL so jobs are enqueued in the same transaction).

## 3. packages/llm gateway (TypeScript, `@anthropic-ai/sdk` ≥ 1.4)

Rules: never send `temperature/top_p/top_k`; Opus 5.5: do not send `thinking` (always on), depth via
`output_config.effort`; Sonnet 5.5 "thinking off" = `thinking:{type:"between_tools"}` with effort ≤ high;
Haiku 5.5 "thinking off" = `thinking:{type:"disabled"}` with effort ≤ high; structured output via
`client.messages.parse({ output_config: { format: zodOutputFormat(Schema) } })` → `parsed_output`; streaming via
`client.messages.stream()` / `finalMessage()` for long outputs; sync Opus/Sonnet calls add `fallbacks:"default"`
with beta header `server-side-fallback-2026-07-01` (not on Haiku, not in Batches); never force `tool_choice`;
handle `stop_reason` `refusal` (read `stop_details.category`), `max_tokens` (retry once with 2×), null
`parsed_output` (one repair turn, then fail loudly). Caching: `cache_control:{type:"ephemeral"}` (+`ttl:"1h"` on
the product and course blocks), ≤4 breakpoints, order tools → system → messages; minimum 512 tokens per cached
prefix. Every call writes `llm_calls` (route, model, effort, tokens in/out, cache read/write, cost_usd, status,
prompt_version, ref_table/ref_id, student_ref).

Modules: `routes.ts` (route → {model, effort, thinking, schema, tools, cache policy, mode sync|batch}),
`client.ts` (Anthropic client factory, betas), `prompt.ts` (block builders: product/course/dossier/turn),
`parse.ts`, `stream.ts`, `batch.ts` (create/poll/results), `ledger.ts` (Postgres writer), `pricing.ts`
(per-model $/MTok incl. cache multipliers), `memory/pgMemory.ts` (memory tool handlers over `memory_files`:
view/create/str_replace/insert/delete/rename, path allow-list, size caps, versions), `fake.ts` (deterministic
fake for tests and local dev, selected by `OGRENMEN_LLM=fake`), `errors.ts`.

## 4. Document AST (packages/contracts `document-ast`)
Non-recursive. `{ kind: 'notes'|'mock_exam'|'report'|'question_set', title, meta, sections: [{no, title}],
blocks: Block[], keys: Key[] }` where Block is a discriminated union on `type`: heading, paragraph (inline math
`$…$`), math_display, definition_box, summary_box, worked_example {steps[]}, common_mistake_callout
{pattern_id, text}, check_yourself {question, answer_hidden}, figure {svg | upload_id, alt}, table {rows},
question {no, stem, options[], figure?, skill_ids, style_id?}, answer_sheet, answer_key_page, page_break; every
block carries `section_no`. `keys[]` = {question_no, correct_option | numeric_value, canonical_expr?}.

## 5. Core structured-output schemas (packages/contracts, zod)
`solution-diagnosis`, `curriculum-draft`, `page-class`, `exam-page-items`, `answer-sheet`, `inferred-keys`,
`exam-report`, `document-ast`, `exam-generation`, `style-definition`, `memory-delta`, `conversation-summary`,
`notification-copy`, `eval-verdict`, plus v1 survivors `question-item`, `answer-key`, `lesson-analysis` (v2 adds
`course_insights[]`), `exam-item` (v2 adds format/trick/difficulty), `exam-priority-plan` (+`style_ids`),
`memory-fact`, `weekly-summary`, `transcript`, `figure-render-report`. Structured-output constraints: no recursive
schemas, no min/max/multipleOf/minLength/maxLength (validate those client-side), `additionalProperties:false`.
