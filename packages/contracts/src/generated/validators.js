// Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen).
// Ajv standalone (önceden derlenmiş) doğrulayıcılar; Worker şemaları çalışma anında derlemez. Cevap anahtarı taşıyan sözleşmeler burada YOK (validators-keys.js).
/* eslint-disable */
"use strict";
// Öğrenmen sözleşmeleri — çalışma zamanı çekirdeği (bağımlılıksız, düz ESM JavaScript).
//
// Bu dosya iki yerde kullanılır:
//   1. src/forbidden-words.ts ve src/index.ts doğrudan içe alır;
//   2. scripts/gen.ts metnini olduğu gibi src/generated/validators.js içine gömer
//      (Ajv standalone kodu böylece hiçbir require/import taşımaz; Worker yalnız onu yükler).
// Bu yüzden dosyada yalnız "export function" / "export const" bildirimleri bulunur ve
// başka modül içe alınmaz. Python eşleniği: python/ogrenmen_contracts/_core.py.

/**
 * Türkçe duyarlı küçük harfe çevirme ve İ/ı katlama: "TAHMİN", "TAHMIN", "tahmin"
 * aynı metne iner. Sıra: NFC, İ→i, I→ı, küçük harf, birleşik nokta (U+0307) silinir, ı→i.
 */
function ogrNormalizeTr(text) {
  return text
    .normalize('NFC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/̇/g, '')
    .replace(/ı/g, 'i');
}

/**
 * Yasaklı kelimenin aranacak biçimleri: normalize edilmiş kelime ve kelime "k" ile bitiyorsa
 * ünsüz yumuşaması (k → ğ) uğramış gövdesi ("çıkacak" → "çıkacağ": "çıkacağı", "çıkacağını").
 */
function ogrForbiddenStems(word) {
  const needle = ogrNormalizeTr(word);
  if (needle.length === 0) return [];
  return needle.endsWith('k') ? [needle, needle.slice(0, -1) + 'ğ'] : [needle];
}

/**
 * Kelime normalize edilmiş metnin herhangi bir yerinde geçiyor mu (BLUEPRINT §4: "geçerse"
 * düşer). Düz alt dize araması: "tahminen", "öntahmin", "TAHMİN" hepsi yakalanır.
 */
function ogrContainsForbidden(text, word) {
  const hay = ogrNormalizeTr(text);
  for (const stem of ogrForbiddenStems(word)) {
    if (hay.includes(stem)) return true;
  }
  return false;
}

/**
 * x-forbidden-words denetimi: verideki tüm metin DEĞERLERİNİ (anahtarlar hariç) derinlik
 * öncelikli gezer; ilk eşleşen yasaklı kelimeyi (listedeki yazımıyla) döner, yoksa null.
 */
function ogrFindForbiddenWord(data, words) {
  if (typeof data === 'string') {
    for (const w of words) {
      if (ogrContainsForbidden(data, w)) return w;
    }
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const hit = ogrFindForbiddenWord(item, words);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (data !== null && typeof data === 'object') {
    for (const key of Object.keys(data)) {
      const hit = ogrFindForbiddenWord(data[key], words);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** Dizenin kod noktası sayısı (Ajv runtime/ucs2length ile aynı; Python len() ile eşit). */
function ogrUcs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  let value;
  while (pos < len) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      value = str.charCodeAt(pos);
      if ((value & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}

// --- Biçimler (format): ajv-formats "full" kipinin uuid/date/date-time/uri tanımlarıyla aynı ---

const OGR_UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const OGR_DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const OGR_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const OGR_TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
const OGR_NOT_URI_FRAGMENT = /\/|:/;
const OGR_URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;

function ogrIsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** RFC 3339 full-date (YYYY-MM-DD; artık yıl denetimli). */
function ogrFormatDate(str) {
  const m = OGR_DATE.exec(str);
  if (!m) return false;
  const year = +m[1];
  const month = +m[2];
  const day = +m[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && ogrIsLeapYear(year) ? 29 : OGR_DAYS[month]);
}

/** RFC 3339 saat; saat dilimi zorunlu (z ya da ±hh:mm). */
function ogrFormatTime(str) {
  const m = OGR_TIME.exec(str);
  if (!m) return false;
  const hr = +m[1];
  const min = +m[2];
  const sec = +m[3];
  const tz = m[4];
  const tzSign = m[5] === '-' ? -1 : 1;
  const tzH = +(m[6] || 0);
  const tzM = +(m[7] || 0);
  if (tzH > 23 || tzM > 59 || !tz) return false;
  if (hr <= 23 && min <= 59 && sec < 60) return true;
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}

/** RFC 3339 date-time (ayraç t, T ya da boşluk). */
function ogrFormatDateTime(str) {
  const parts = str.split(/t|\s/i);
  return parts.length === 2 && ogrFormatDate(parts[0]) && ogrFormatTime(parts[1]);
}

/** UUID (RFC 4122 biçimi; büyük/küçük harf duyarsız). */
function ogrFormatUuid(str) {
  return OGR_UUID.test(str);
}

/** Mutlak URI (RFC 3986). */
function ogrFormatUri(str) {
  return OGR_NOT_URI_FRAGMENT.test(str) && OGR_URI.test(str);
}

/** Şemalarda kullanılan biçimlerin tamamı; standalone doğrulayıcılar bu nesneyi kullanır. */
const ogrFormats = {
  date: ogrFormatDate,
  'date-time': ogrFormatDateTime,
  uri: ogrFormatUri,
  uuid: ogrFormatUuid,
};

export const botResponseLog = validate53;
const schema20 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/bot-response-log.json","title":"BotResponseLog","description":"Her bot cevabının kaydı (bot_responses; log_bot_response). Kayıt yoksa cevap yok; prompt_text temizlenmiş tam prompttur.","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","chat_id","purpose","response_text","provider_attempts","memory_fact_ids","recent_message_ids","cost_usd","latency_ms","cache_hit","degraded_mode","escalated","pii_replacements"],"properties":{"schema_version":{"const":"1.0"},"in_message_id":{"type":["integer","null"]},"chat_id":{"type":"integer"},"out_telegram_message_id":{"type":["integer","null"]},"purpose":{"enum":["chat","feedback","hint","command","proactive","escalation","quota","consent","degraded"]},"mode":{"oneOf":[{"type":"null"},{"enum":["socratic","direct"]}]},"prompt_version":{"type":["string","null"]},"prompt_hash":{"type":["string","null"],"pattern":"^[a-f0-9]{64}$"},"prompt_text":{"type":["string","null"],"maxLength":16000,"description":"TEMİZLENMİŞ tam prompt (sistem + bağlam + mesaj); 30 gün sonra null"},"response_text":{"type":"string","maxLength":4000},"memory_fact_ids":{"type":"array","items":{"type":"integer"}},"recent_message_ids":{"type":"array","items":{"type":"integer"}},"pool_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/uuid"}]},"cache_hit":{"type":"boolean"},"provider":{"type":["string","null"]},"model":{"type":["string","null"]},"provider_attempts":{"type":"array","items":{"$ref":"common.json#/$defs/providerAttempt"}},"tokens_in":{"type":["integer","null"]},"tokens_out":{"type":["integer","null"]},"cost_usd":{"$ref":"common.json#/$defs/usd"},"latency_ms":{"type":"integer","minimum":0},"confidence":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/probability"}]},"escalated":{"type":"boolean"},"schema_valid":{"type":["boolean","null"]},"quota_state":{"type":"object","additionalProperties":false,"properties":{"used":{"type":"integer"},"limit":{"type":"integer"}}},"degraded_mode":{"type":"boolean"},"pii_replacements":{"type":"integer","minimum":0},"guards":{"type":"array","items":{"enum":["forbidden_topic","unsure","human_requested","quota","consent_missing","figure_unverified","format_fix","injection_suspect"]}}}};
const func2 = Object.prototype.hasOwnProperty;
const func1 = ogrUcs2length;
const pattern3 = new RegExp("^[a-f0-9]{64}$", "u");
const schema22 = {"type":"string","format":"uuid"};
const formats0 = ogrFormats.uuid;

function validate55(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate55.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!(formats0(data))){
const err0 = {instancePath,schemaPath:"#/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate55.errors = vErrors;
return errors === 0;
}
validate55.evaluated = {"dynamicProps":false,"dynamicItems":false};

const schema23 = {"type":"object","additionalProperties":false,"required":["provider","model","status"],"properties":{"provider":{"type":"string"},"model":{"type":"string"},"status":{"enum":["ok","error","rate_limited","timeout","cap_blocked","cooldown_skip","bad_output"]},"tokens_in":{"type":"integer","minimum":0},"tokens_out":{"type":"integer","minimum":0},"cost_usd":{"$ref":"#/$defs/usd"},"latency_ms":{"type":"integer","minimum":0},"error_code":{"type":["string","null"]}}};
const schema24 = {"type":"number","minimum":0};

function validate58(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate58.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((typeof data == "number") && (isFinite(data))){
if(data < 0 || isNaN(data)){
const err0 = {instancePath,schemaPath:"#/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate58.errors = vErrors;
return errors === 0;
}
validate58.evaluated = {"dynamicProps":false,"dynamicItems":false};


function validate57(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate57.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.provider === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "provider"},message:"must have required property '"+"provider"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.model === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "model"},message:"must have required property '"+"model"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.status === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "provider") || (key0 === "model")) || (key0 === "status")) || (key0 === "tokens_in")) || (key0 === "tokens_out")) || (key0 === "cost_usd")) || (key0 === "latency_ms")) || (key0 === "error_code"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.provider !== undefined){
if(typeof data.provider !== "string"){
const err4 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.model !== undefined){
if(typeof data.model !== "string"){
const err5 = {instancePath:instancePath+"/model",schemaPath:"#/properties/model/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.status !== undefined){
let data2 = data.status;
if(!(((((((data2 === "ok") || (data2 === "error")) || (data2 === "rate_limited")) || (data2 === "timeout")) || (data2 === "cap_blocked")) || (data2 === "cooldown_skip")) || (data2 === "bad_output"))){
const err6 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema23.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.tokens_in !== undefined){
let data3 = data.tokens_in;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err7 = {instancePath:instancePath+"/tokens_in",schemaPath:"#/properties/tokens_in/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err8 = {instancePath:instancePath+"/tokens_in",schemaPath:"#/properties/tokens_in/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.tokens_out !== undefined){
let data4 = data.tokens_out;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err9 = {instancePath:instancePath+"/tokens_out",schemaPath:"#/properties/tokens_out/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 0 || isNaN(data4)){
const err10 = {instancePath:instancePath+"/tokens_out",schemaPath:"#/properties/tokens_out/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
if(data.cost_usd !== undefined){
if(!(validate58(data.cost_usd, {instancePath:instancePath+"/cost_usd",parentData:data,parentDataProperty:"cost_usd",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
errors = vErrors.length;
}
}
if(data.latency_ms !== undefined){
let data6 = data.latency_ms;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err11 = {instancePath:instancePath+"/latency_ms",schemaPath:"#/properties/latency_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 < 0 || isNaN(data6)){
const err12 = {instancePath:instancePath+"/latency_ms",schemaPath:"#/properties/latency_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
if(data.error_code !== undefined){
let data7 = data.error_code;
if((typeof data7 !== "string") && (data7 !== null)){
const err13 = {instancePath:instancePath+"/error_code",schemaPath:"#/properties/error_code/type",keyword:"type",params:{type: schema23.properties.error_code.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
else {
const err14 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
validate57.errors = vErrors;
return errors === 0;
}
validate57.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate61(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate61.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((typeof data == "number") && (isFinite(data))){
if(data < 0 || isNaN(data)){
const err0 = {instancePath,schemaPath:"#/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate61.errors = vErrors;
return errors === 0;
}
validate61.evaluated = {"dynamicProps":false,"dynamicItems":false};

const schema26 = {"type":"number","minimum":0,"maximum":1};

function validate63(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate63.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((typeof data == "number") && (isFinite(data))){
if(data > 1 || isNaN(data)){
const err0 = {instancePath,schemaPath:"#/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data < 0 || isNaN(data)){
const err1 = {instancePath,schemaPath:"#/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate63.errors = vErrors;
return errors === 0;
}
validate63.evaluated = {"dynamicProps":false,"dynamicItems":false};


function validate53(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/bot-response-log.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate53.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.chat_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chat_id"},message:"must have required property '"+"chat_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.purpose === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "purpose"},message:"must have required property '"+"purpose"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.response_text === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "response_text"},message:"must have required property '"+"response_text"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.provider_attempts === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "provider_attempts"},message:"must have required property '"+"provider_attempts"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.memory_fact_ids === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "memory_fact_ids"},message:"must have required property '"+"memory_fact_ids"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.recent_message_ids === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "recent_message_ids"},message:"must have required property '"+"recent_message_ids"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.cost_usd === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "cost_usd"},message:"must have required property '"+"cost_usd"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.latency_ms === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "latency_ms"},message:"must have required property '"+"latency_ms"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.cache_hit === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "cache_hit"},message:"must have required property '"+"cache_hit"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.degraded_mode === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "degraded_mode"},message:"must have required property '"+"degraded_mode"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.escalated === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "escalated"},message:"must have required property '"+"escalated"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.pii_replacements === undefined){
const err12 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "pii_replacements"},message:"must have required property '"+"pii_replacements"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema20.properties, key0))){
const err13 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err14 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.in_message_id !== undefined){
let data1 = data.in_message_id;
if((!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))) && (data1 !== null)){
const err15 = {instancePath:instancePath+"/in_message_id",schemaPath:"#/properties/in_message_id/type",keyword:"type",params:{type: schema20.properties.in_message_id.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.chat_id !== undefined){
let data2 = data.chat_id;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err16 = {instancePath:instancePath+"/chat_id",schemaPath:"#/properties/chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.out_telegram_message_id !== undefined){
let data3 = data.out_telegram_message_id;
if((!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))) && (data3 !== null)){
const err17 = {instancePath:instancePath+"/out_telegram_message_id",schemaPath:"#/properties/out_telegram_message_id/type",keyword:"type",params:{type: schema20.properties.out_telegram_message_id.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.purpose !== undefined){
let data4 = data.purpose;
if(!(((((((((data4 === "chat") || (data4 === "feedback")) || (data4 === "hint")) || (data4 === "command")) || (data4 === "proactive")) || (data4 === "escalation")) || (data4 === "quota")) || (data4 === "consent")) || (data4 === "degraded"))){
const err18 = {instancePath:instancePath+"/purpose",schemaPath:"#/properties/purpose/enum",keyword:"enum",params:{allowedValues: schema20.properties.purpose.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.mode !== undefined){
let data5 = data.mode;
const _errs11 = errors;
let valid1 = false;
let passing0 = null;
const _errs12 = errors;
if(data5 !== null){
const err19 = {instancePath:instancePath+"/mode",schemaPath:"#/properties/mode/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid0 = _errs12 === errors;
if(_valid0){
valid1 = true;
passing0 = 0;
}
const _errs14 = errors;
if(!((data5 === "socratic") || (data5 === "direct"))){
const err20 = {instancePath:instancePath+"/mode",schemaPath:"#/properties/mode/oneOf/1/enum",keyword:"enum",params:{allowedValues: schema20.properties.mode.oneOf[1].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
var _valid0 = _errs14 === errors;
if(_valid0 && valid1){
valid1 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid1 = true;
passing0 = 1;
}
}
if(!valid1){
const err21 = {instancePath:instancePath+"/mode",schemaPath:"#/properties/mode/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
else {
errors = _errs11;
if(vErrors !== null){
if(_errs11){
vErrors.length = _errs11;
}
else {
vErrors = null;
}
}
}
}
if(data.prompt_version !== undefined){
let data6 = data.prompt_version;
if((typeof data6 !== "string") && (data6 !== null)){
const err22 = {instancePath:instancePath+"/prompt_version",schemaPath:"#/properties/prompt_version/type",keyword:"type",params:{type: schema20.properties.prompt_version.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.prompt_hash !== undefined){
let data7 = data.prompt_hash;
if((typeof data7 !== "string") && (data7 !== null)){
const err23 = {instancePath:instancePath+"/prompt_hash",schemaPath:"#/properties/prompt_hash/type",keyword:"type",params:{type: schema20.properties.prompt_hash.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(typeof data7 === "string"){
if(!pattern3.test(data7)){
const err24 = {instancePath:instancePath+"/prompt_hash",schemaPath:"#/properties/prompt_hash/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
if(data.prompt_text !== undefined){
let data8 = data.prompt_text;
if((typeof data8 !== "string") && (data8 !== null)){
const err25 = {instancePath:instancePath+"/prompt_text",schemaPath:"#/properties/prompt_text/type",keyword:"type",params:{type: schema20.properties.prompt_text.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(typeof data8 === "string"){
if(func1(data8) > 16000){
const err26 = {instancePath:instancePath+"/prompt_text",schemaPath:"#/properties/prompt_text/maxLength",keyword:"maxLength",params:{limit: 16000},message:"must NOT have more than 16000 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
if(data.response_text !== undefined){
let data9 = data.response_text;
if(typeof data9 === "string"){
if(func1(data9) > 4000){
const err27 = {instancePath:instancePath+"/response_text",schemaPath:"#/properties/response_text/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/response_text",schemaPath:"#/properties/response_text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.memory_fact_ids !== undefined){
let data10 = data.memory_fact_ids;
if(Array.isArray(data10)){
const len0 = data10.length;
for(let i0=0; i0<len0; i0++){
let data11 = data10[i0];
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err29 = {instancePath:instancePath+"/memory_fact_ids/" + i0,schemaPath:"#/properties/memory_fact_ids/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath:instancePath+"/memory_fact_ids",schemaPath:"#/properties/memory_fact_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.recent_message_ids !== undefined){
let data12 = data.recent_message_ids;
if(Array.isArray(data12)){
const len1 = data12.length;
for(let i1=0; i1<len1; i1++){
let data13 = data12[i1];
if(!(((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13))) && (isFinite(data13)))){
const err31 = {instancePath:instancePath+"/recent_message_ids/" + i1,schemaPath:"#/properties/recent_message_ids/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
}
else {
const err32 = {instancePath:instancePath+"/recent_message_ids",schemaPath:"#/properties/recent_message_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data.pool_id !== undefined){
let data14 = data.pool_id;
const _errs32 = errors;
let valid6 = false;
let passing1 = null;
const _errs33 = errors;
if(data14 !== null){
const err33 = {instancePath:instancePath+"/pool_id",schemaPath:"#/properties/pool_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
var _valid1 = _errs33 === errors;
if(_valid1){
valid6 = true;
passing1 = 0;
}
const _errs35 = errors;
if(!(validate55(data14, {instancePath:instancePath+"/pool_id",parentData:data,parentDataProperty:"pool_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
var _valid1 = _errs35 === errors;
if(_valid1 && valid6){
valid6 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid6 = true;
passing1 = 1;
}
}
if(!valid6){
const err34 = {instancePath:instancePath+"/pool_id",schemaPath:"#/properties/pool_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
else {
errors = _errs32;
if(vErrors !== null){
if(_errs32){
vErrors.length = _errs32;
}
else {
vErrors = null;
}
}
}
}
if(data.cache_hit !== undefined){
if(typeof data.cache_hit !== "boolean"){
const err35 = {instancePath:instancePath+"/cache_hit",schemaPath:"#/properties/cache_hit/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data.provider !== undefined){
let data16 = data.provider;
if((typeof data16 !== "string") && (data16 !== null)){
const err36 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/type",keyword:"type",params:{type: schema20.properties.provider.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data.model !== undefined){
let data17 = data.model;
if((typeof data17 !== "string") && (data17 !== null)){
const err37 = {instancePath:instancePath+"/model",schemaPath:"#/properties/model/type",keyword:"type",params:{type: schema20.properties.model.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data.provider_attempts !== undefined){
let data18 = data.provider_attempts;
if(Array.isArray(data18)){
const len2 = data18.length;
for(let i2=0; i2<len2; i2++){
if(!(validate57(data18[i2], {instancePath:instancePath+"/provider_attempts/" + i2,parentData:data18,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
}
else {
const err38 = {instancePath:instancePath+"/provider_attempts",schemaPath:"#/properties/provider_attempts/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data.tokens_in !== undefined){
let data20 = data.tokens_in;
if((!(((typeof data20 == "number") && (!(data20 % 1) && !isNaN(data20))) && (isFinite(data20)))) && (data20 !== null)){
const err39 = {instancePath:instancePath+"/tokens_in",schemaPath:"#/properties/tokens_in/type",keyword:"type",params:{type: schema20.properties.tokens_in.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
if(data.tokens_out !== undefined){
let data21 = data.tokens_out;
if((!(((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21))) && (isFinite(data21)))) && (data21 !== null)){
const err40 = {instancePath:instancePath+"/tokens_out",schemaPath:"#/properties/tokens_out/type",keyword:"type",params:{type: schema20.properties.tokens_out.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
if(data.cost_usd !== undefined){
if(!(validate61(data.cost_usd, {instancePath:instancePath+"/cost_usd",parentData:data,parentDataProperty:"cost_usd",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate61.errors : vErrors.concat(validate61.errors);
errors = vErrors.length;
}
}
if(data.latency_ms !== undefined){
let data23 = data.latency_ms;
if(!(((typeof data23 == "number") && (!(data23 % 1) && !isNaN(data23))) && (isFinite(data23)))){
const err41 = {instancePath:instancePath+"/latency_ms",schemaPath:"#/properties/latency_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if((typeof data23 == "number") && (isFinite(data23))){
if(data23 < 0 || isNaN(data23)){
const err42 = {instancePath:instancePath+"/latency_ms",schemaPath:"#/properties/latency_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
}
if(data.confidence !== undefined){
let data24 = data.confidence;
const _errs53 = errors;
let valid9 = false;
let passing2 = null;
const _errs54 = errors;
if(data24 !== null){
const err43 = {instancePath:instancePath+"/confidence",schemaPath:"#/properties/confidence/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
var _valid2 = _errs54 === errors;
if(_valid2){
valid9 = true;
passing2 = 0;
}
const _errs56 = errors;
if(!(validate63(data24, {instancePath:instancePath+"/confidence",parentData:data,parentDataProperty:"confidence",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate63.errors : vErrors.concat(validate63.errors);
errors = vErrors.length;
}
var _valid2 = _errs56 === errors;
if(_valid2 && valid9){
valid9 = false;
passing2 = [passing2, 1];
}
else {
if(_valid2){
valid9 = true;
passing2 = 1;
}
}
if(!valid9){
const err44 = {instancePath:instancePath+"/confidence",schemaPath:"#/properties/confidence/oneOf",keyword:"oneOf",params:{passingSchemas: passing2},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
else {
errors = _errs53;
if(vErrors !== null){
if(_errs53){
vErrors.length = _errs53;
}
else {
vErrors = null;
}
}
}
}
if(data.escalated !== undefined){
if(typeof data.escalated !== "boolean"){
const err45 = {instancePath:instancePath+"/escalated",schemaPath:"#/properties/escalated/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
if(data.schema_valid !== undefined){
let data26 = data.schema_valid;
if((typeof data26 !== "boolean") && (data26 !== null)){
const err46 = {instancePath:instancePath+"/schema_valid",schemaPath:"#/properties/schema_valid/type",keyword:"type",params:{type: schema20.properties.schema_valid.type},message:"must be boolean,null"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
if(data.quota_state !== undefined){
let data27 = data.quota_state;
if(data27 && typeof data27 == "object" && !Array.isArray(data27)){
for(const key1 in data27){
if(!((key1 === "used") || (key1 === "limit"))){
const err47 = {instancePath:instancePath+"/quota_state",schemaPath:"#/properties/quota_state/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
if(data27.used !== undefined){
let data28 = data27.used;
if(!(((typeof data28 == "number") && (!(data28 % 1) && !isNaN(data28))) && (isFinite(data28)))){
const err48 = {instancePath:instancePath+"/quota_state/used",schemaPath:"#/properties/quota_state/properties/used/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
if(data27.limit !== undefined){
let data29 = data27.limit;
if(!(((typeof data29 == "number") && (!(data29 % 1) && !isNaN(data29))) && (isFinite(data29)))){
const err49 = {instancePath:instancePath+"/quota_state/limit",schemaPath:"#/properties/quota_state/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
}
else {
const err50 = {instancePath:instancePath+"/quota_state",schemaPath:"#/properties/quota_state/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
if(data.degraded_mode !== undefined){
if(typeof data.degraded_mode !== "boolean"){
const err51 = {instancePath:instancePath+"/degraded_mode",schemaPath:"#/properties/degraded_mode/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data.pii_replacements !== undefined){
let data31 = data.pii_replacements;
if(!(((typeof data31 == "number") && (!(data31 % 1) && !isNaN(data31))) && (isFinite(data31)))){
const err52 = {instancePath:instancePath+"/pii_replacements",schemaPath:"#/properties/pii_replacements/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
if((typeof data31 == "number") && (isFinite(data31))){
if(data31 < 0 || isNaN(data31)){
const err53 = {instancePath:instancePath+"/pii_replacements",schemaPath:"#/properties/pii_replacements/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
}
if(data.guards !== undefined){
let data32 = data.guards;
if(Array.isArray(data32)){
const len3 = data32.length;
for(let i3=0; i3<len3; i3++){
let data33 = data32[i3];
if(!((((((((data33 === "forbidden_topic") || (data33 === "unsure")) || (data33 === "human_requested")) || (data33 === "quota")) || (data33 === "consent_missing")) || (data33 === "figure_unverified")) || (data33 === "format_fix")) || (data33 === "injection_suspect"))){
const err54 = {instancePath:instancePath+"/guards/" + i3,schemaPath:"#/properties/guards/items/enum",keyword:"enum",params:{allowedValues: schema20.properties.guards.items.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
}
else {
const err55 = {instancePath:instancePath+"/guards",schemaPath:"#/properties/guards/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
}
else {
const err56 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
validate53.errors = vErrors;
return errors === 0;
}
validate53.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const common = validate54;
const schema21 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/common.json","title":"Common","description":"Ortak tanımlar: kimlikler, zaman, olasılık, konuşmacı, kanıt ve sağlayıcı denemesi. Diğer şemalar $ref ile kullanır.","x-version":"1.0","$defs":{"uuid":{"type":"string","format":"uuid"},"dateTime":{"type":"string","format":"date-time"},"date":{"type":"string","format":"date"},"studentRef":{"type":"string","pattern":"^s_[a-z2-7]{12}$","description":"students.public_ref; ad ve uuid asla"},"skillId":{"type":"string","pattern":"^[a-z]+(\\.[a-z0-9-]+)+$","examples":["tyt.mat.temel.rasyonel-sayilar"]},"tag":{"type":"string","pattern":"^[a-z0-9-]+(\\.[a-z0-9-]+)+$","examples":["rasyonel.pay-payda-ayri-toplama"]},"probability":{"type":"number","minimum":0,"maximum":1},"usd":{"type":"number","minimum":0},"speaker":{"enum":["ÖĞRENCİ","EĞİTMEN"]},"ts":{"type":"string","pattern":"^[0-9]{2}:[0-9]{2}:[0-9]{2}$","description":"HH:MM:SS"},"optionKey":{"enum":["A","B","C","D"]},"timedQuote":{"type":"object","additionalProperties":false,"required":["speaker","quote","t"],"properties":{"speaker":{"$ref":"#/$defs/speaker"},"quote":{"type":"string","minLength":3,"maxLength":300,"description":"Alıntı; ad içermez"},"t":{"$ref":"#/$defs/ts"},"t_end":{"$ref":"#/$defs/ts"}}},"evidenceRef":{"type":"object","additionalProperties":false,"required":["kind","source","quote"],"properties":{"kind":{"enum":["lesson","quiz","chat","instructor"]},"source":{"type":"string","minLength":3},"quote":{"type":"string","minLength":1,"maxLength":300},"href":{"type":"string"},"observation_id":{"type":"integer"}}},"providerAttempt":{"type":"object","additionalProperties":false,"required":["provider","model","status"],"properties":{"provider":{"type":"string"},"model":{"type":"string"},"status":{"enum":["ok","error","rate_limited","timeout","cap_blocked","cooldown_skip","bad_output"]},"tokens_in":{"type":"integer","minimum":0},"tokens_out":{"type":"integer","minimum":0},"cost_usd":{"$ref":"#/$defs/usd"},"latency_ms":{"type":"integer","minimum":0},"error_code":{"type":["string","null"]}}}}};

function validate54(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/common.json" */;
validate54.errors = null;
return true;
}
validate54.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonDate = validate65;
const schema27 = {"type":"string","format":"date"};
const formats2 = ogrFormats.date;

function validate65(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate65.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!(formats2(data))){
const err0 = {instancePath,schemaPath:"#/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate65.errors = vErrors;
return errors === 0;
}
validate65.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonDateTime = validate66;
const schema28 = {"type":"string","format":"date-time"};
const formats4 = ogrFormats["date-time"];

function validate66(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate66.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!(formats4(data))){
const err0 = {instancePath,schemaPath:"#/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate66.errors = vErrors;
return errors === 0;
}
validate66.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonEvidenceRef = validate67;
const schema29 = {"type":"object","additionalProperties":false,"required":["kind","source","quote"],"properties":{"kind":{"enum":["lesson","quiz","chat","instructor"]},"source":{"type":"string","minLength":3},"quote":{"type":"string","minLength":1,"maxLength":300},"href":{"type":"string"},"observation_id":{"type":"integer"}}};

function validate67(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate67.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.source === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source"},message:"must have required property '"+"source"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.quote === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "quote"},message:"must have required property '"+"quote"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "kind") || (key0 === "source")) || (key0 === "quote")) || (key0 === "href")) || (key0 === "observation_id"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.kind !== undefined){
let data0 = data.kind;
if(!((((data0 === "lesson") || (data0 === "quiz")) || (data0 === "chat")) || (data0 === "instructor"))){
const err4 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema29.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.source !== undefined){
let data1 = data.source;
if(typeof data1 === "string"){
if(func1(data1) < 3){
const err5 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.quote !== undefined){
let data2 = data.quote;
if(typeof data2 === "string"){
if(func1(data2) > 300){
const err7 = {instancePath:instancePath+"/quote",schemaPath:"#/properties/quote/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func1(data2) < 1){
const err8 = {instancePath:instancePath+"/quote",schemaPath:"#/properties/quote/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/quote",schemaPath:"#/properties/quote/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.href !== undefined){
if(typeof data.href !== "string"){
const err10 = {instancePath:instancePath+"/href",schemaPath:"#/properties/href/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.observation_id !== undefined){
let data4 = data.observation_id;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err11 = {instancePath:instancePath+"/observation_id",schemaPath:"#/properties/observation_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate67.errors = vErrors;
return errors === 0;
}
validate67.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const commonOptionKey = validate68;
const schema30 = {"enum":["A","B","C","D"]};

function validate68(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate68.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!((((data === "A") || (data === "B")) || (data === "C")) || (data === "D"))){
const err0 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema30.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate68.errors = vErrors;
return errors === 0;
}
validate68.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonProbability = validate69;

function validate69(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate69.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((typeof data == "number") && (isFinite(data))){
if(data > 1 || isNaN(data)){
const err0 = {instancePath,schemaPath:"#/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data < 0 || isNaN(data)){
const err1 = {instancePath,schemaPath:"#/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate69.errors = vErrors;
return errors === 0;
}
validate69.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonProviderAttempt = validate70;

function validate70(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate70.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.provider === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "provider"},message:"must have required property '"+"provider"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.model === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "model"},message:"must have required property '"+"model"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.status === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "provider") || (key0 === "model")) || (key0 === "status")) || (key0 === "tokens_in")) || (key0 === "tokens_out")) || (key0 === "cost_usd")) || (key0 === "latency_ms")) || (key0 === "error_code"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.provider !== undefined){
if(typeof data.provider !== "string"){
const err4 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.model !== undefined){
if(typeof data.model !== "string"){
const err5 = {instancePath:instancePath+"/model",schemaPath:"#/properties/model/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.status !== undefined){
let data2 = data.status;
if(!(((((((data2 === "ok") || (data2 === "error")) || (data2 === "rate_limited")) || (data2 === "timeout")) || (data2 === "cap_blocked")) || (data2 === "cooldown_skip")) || (data2 === "bad_output"))){
const err6 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema23.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.tokens_in !== undefined){
let data3 = data.tokens_in;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err7 = {instancePath:instancePath+"/tokens_in",schemaPath:"#/properties/tokens_in/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err8 = {instancePath:instancePath+"/tokens_in",schemaPath:"#/properties/tokens_in/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.tokens_out !== undefined){
let data4 = data.tokens_out;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err9 = {instancePath:instancePath+"/tokens_out",schemaPath:"#/properties/tokens_out/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 0 || isNaN(data4)){
const err10 = {instancePath:instancePath+"/tokens_out",schemaPath:"#/properties/tokens_out/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
if(data.cost_usd !== undefined){
if(!(validate58(data.cost_usd, {instancePath:instancePath+"/cost_usd",parentData:data,parentDataProperty:"cost_usd",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
errors = vErrors.length;
}
}
if(data.latency_ms !== undefined){
let data6 = data.latency_ms;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err11 = {instancePath:instancePath+"/latency_ms",schemaPath:"#/properties/latency_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 < 0 || isNaN(data6)){
const err12 = {instancePath:instancePath+"/latency_ms",schemaPath:"#/properties/latency_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
if(data.error_code !== undefined){
let data7 = data.error_code;
if((typeof data7 !== "string") && (data7 !== null)){
const err13 = {instancePath:instancePath+"/error_code",schemaPath:"#/properties/error_code/type",keyword:"type",params:{type: schema23.properties.error_code.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
else {
const err14 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
validate70.errors = vErrors;
return errors === 0;
}
validate70.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const commonSkillId = validate72;
const schema33 = {"type":"string","pattern":"^[a-z]+(\\.[a-z0-9-]+)+$","examples":["tyt.mat.temel.rasyonel-sayilar"]};
const pattern4 = new RegExp("^[a-z]+(\\.[a-z0-9-]+)+$", "u");

function validate72(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate72.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!pattern4.test(data)){
const err0 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^[a-z]+(\\.[a-z0-9-]+)+$"},message:"must match pattern \""+"^[a-z]+(\\.[a-z0-9-]+)+$"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate72.errors = vErrors;
return errors === 0;
}
validate72.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonSpeaker = validate73;
const schema34 = {"enum":["ÖĞRENCİ","EĞİTMEN"]};

function validate73(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate73.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!((data === "ÖĞRENCİ") || (data === "EĞİTMEN"))){
const err0 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema34.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate73.errors = vErrors;
return errors === 0;
}
validate73.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonStudentRef = validate74;
const schema35 = {"type":"string","pattern":"^s_[a-z2-7]{12}$","description":"students.public_ref; ad ve uuid asla"};
const pattern5 = new RegExp("^s_[a-z2-7]{12}$", "u");

function validate74(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate74.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!pattern5.test(data)){
const err0 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^s_[a-z2-7]{12}$"},message:"must match pattern \""+"^s_[a-z2-7]{12}$"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate74.errors = vErrors;
return errors === 0;
}
validate74.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonTag = validate75;
const schema36 = {"type":"string","pattern":"^[a-z0-9-]+(\\.[a-z0-9-]+)+$","examples":["rasyonel.pay-payda-ayri-toplama"]};
const pattern6 = new RegExp("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", "u");

function validate75(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate75.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!pattern6.test(data)){
const err0 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^[a-z0-9-]+(\\.[a-z0-9-]+)+$"},message:"must match pattern \""+"^[a-z0-9-]+(\\.[a-z0-9-]+)+$"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate75.errors = vErrors;
return errors === 0;
}
validate75.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonTimedQuote = validate76;
const schema37 = {"type":"object","additionalProperties":false,"required":["speaker","quote","t"],"properties":{"speaker":{"$ref":"#/$defs/speaker"},"quote":{"type":"string","minLength":3,"maxLength":300,"description":"Alıntı; ad içermez"},"t":{"$ref":"#/$defs/ts"},"t_end":{"$ref":"#/$defs/ts"}}};
const schema38 = {"type":"string","pattern":"^[0-9]{2}:[0-9]{2}:[0-9]{2}$","description":"HH:MM:SS"};
const pattern7 = new RegExp("^[0-9]{2}:[0-9]{2}:[0-9]{2}$", "u");

function validate78(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate78.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!pattern7.test(data)){
const err0 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^[0-9]{2}:[0-9]{2}:[0-9]{2}$"},message:"must match pattern \""+"^[0-9]{2}:[0-9]{2}:[0-9]{2}$"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate78.errors = vErrors;
return errors === 0;
}
validate78.evaluated = {"dynamicProps":false,"dynamicItems":false};


function validate76(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate76.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.speaker === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "speaker"},message:"must have required property '"+"speaker"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.quote === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "quote"},message:"must have required property '"+"quote"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.t === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "speaker") || (key0 === "quote")) || (key0 === "t")) || (key0 === "t_end"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.speaker !== undefined){
if(!(validate73(data.speaker, {instancePath:instancePath+"/speaker",parentData:data,parentDataProperty:"speaker",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate73.errors : vErrors.concat(validate73.errors);
errors = vErrors.length;
}
}
if(data.quote !== undefined){
let data1 = data.quote;
if(typeof data1 === "string"){
if(func1(data1) > 300){
const err4 = {instancePath:instancePath+"/quote",schemaPath:"#/properties/quote/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data1) < 3){
const err5 = {instancePath:instancePath+"/quote",schemaPath:"#/properties/quote/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/quote",schemaPath:"#/properties/quote/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.t !== undefined){
if(!(validate78(data.t, {instancePath:instancePath+"/t",parentData:data,parentDataProperty:"t",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate78.errors : vErrors.concat(validate78.errors);
errors = vErrors.length;
}
}
if(data.t_end !== undefined){
if(!(validate78(data.t_end, {instancePath:instancePath+"/t_end",parentData:data,parentDataProperty:"t_end",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate78.errors : vErrors.concat(validate78.errors);
errors = vErrors.length;
}
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate76.errors = vErrors;
return errors === 0;
}
validate76.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const commonTs = validate81;

function validate81(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate81.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!pattern7.test(data)){
const err0 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^[0-9]{2}:[0-9]{2}:[0-9]{2}$"},message:"must match pattern \""+"^[0-9]{2}:[0-9]{2}:[0-9]{2}$"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate81.errors = vErrors;
return errors === 0;
}
validate81.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonUsd = validate82;

function validate82(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate82.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((typeof data == "number") && (isFinite(data))){
if(data < 0 || isNaN(data)){
const err0 = {instancePath,schemaPath:"#/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate82.errors = vErrors;
return errors === 0;
}
validate82.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const commonUuid = validate83;

function validate83(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate83.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!(formats0(data))){
const err0 = {instancePath,schemaPath:"#/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate83.errors = vErrors;
return errors === 0;
}
validate83.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const curriculum = validate84;
const schema42 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/curriculum.json","title":"CurriculumBundle","description":"Müfredat sürümünün birleşik doğrulaması: curriculum.json + skills.json + prerequisites.json tek nesnede ({curriculum, skills, prerequisites}). Tekil dosyalar $defs ile doğrulanabilir (curriculum#/$defs/skill vb.).","x-version":"1.0","type":"object","additionalProperties":false,"required":["curriculum","skills","prerequisites"],"properties":{"schema_version":{"const":"1.0"},"curriculum":{"$ref":"#/$defs/curriculum"},"skills":{"type":"array","minItems":1,"items":{"$ref":"#/$defs/skill"}},"prerequisites":{"type":"array","items":{"$ref":"#/$defs/prerequisite"}}},"$defs":{"curriculum":{"type":"object","additionalProperties":false,"description":"curriculum.json (curricula satırı + dönem + teşhis istisnaları)","required":["code","authority","year","version","label","status"],"properties":{"schema_version":{"const":"1.0"},"code":{"type":"string","pattern":"^[A-Z]{2,5}-[A-Z]{2,5}$","examples":["TYT-MAT"]},"authority":{"enum":["MEB","ÖSYM","UNI","OTHER"]},"year":{"type":"integer","minimum":2000,"maximum":2100},"version":{"type":"string","pattern":"^[0-9]{4}\\.[0-9]+$","examples":["2026.1"]},"label":{"type":"string","minLength":3,"maxLength":120},"status":{"enum":["draft","active","retired"],"description":"Zorunlu; export-sql.py curricula.status olarak aynen yazar"},"period_label":{"type":"string","minLength":3,"maxLength":40,"description":"settings.default_period ile aynı (ör. 'YKS 2027')"},"sources":{"type":"array","items":{"type":"string","minLength":3}},"diagnostic_exempt":{"type":"array","items":{"$ref":"common.json#/$defs/skillId"},"description":"Teşhis maddesi olmayan, pratikte ölçülen yapraklar"}}},"skill":{"type":"object","additionalProperties":false,"description":"skills.json öğesi (skills satırı)","required":["id","parent_id","name","is_leaf"],"properties":{"id":{"$ref":"common.json#/$defs/skillId"},"parent_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}]},"name":{"type":"string","minLength":2,"maxLength":120},"description":{"type":["string","null"],"maxLength":600},"is_leaf":{"type":"boolean","description":"Düğüm kazanımlar (false) mastery tutmaz"},"order_no":{"type":"integer","minimum":0},"p_init":{"type":"number","minimum":0.001,"maximum":0.999},"p_learn":{"type":"number","minimum":0.001,"maximum":0.999},"p_guess":{"type":"number","minimum":0.001,"maximum":0.999},"p_slip":{"type":"number","minimum":0.001,"maximum":0.999}}},"prerequisite":{"type":"object","additionalProperties":false,"description":"prerequisites.json öğesi (skill_prerequisites satırı)","required":["skill_id","prereq_id","strength"],"properties":{"skill_id":{"$ref":"common.json#/$defs/skillId"},"prereq_id":{"$ref":"common.json#/$defs/skillId"},"strength":{"type":"number","minimum":0,"maximum":1},"source":{"enum":["curriculum","instructor","inferred"]}}}}};
const schema43 = {"type":"object","additionalProperties":false,"description":"curriculum.json (curricula satırı + dönem + teşhis istisnaları)","required":["code","authority","year","version","label","status"],"properties":{"schema_version":{"const":"1.0"},"code":{"type":"string","pattern":"^[A-Z]{2,5}-[A-Z]{2,5}$","examples":["TYT-MAT"]},"authority":{"enum":["MEB","ÖSYM","UNI","OTHER"]},"year":{"type":"integer","minimum":2000,"maximum":2100},"version":{"type":"string","pattern":"^[0-9]{4}\\.[0-9]+$","examples":["2026.1"]},"label":{"type":"string","minLength":3,"maxLength":120},"status":{"enum":["draft","active","retired"],"description":"Zorunlu; export-sql.py curricula.status olarak aynen yazar"},"period_label":{"type":"string","minLength":3,"maxLength":40,"description":"settings.default_period ile aynı (ör. 'YKS 2027')"},"sources":{"type":"array","items":{"type":"string","minLength":3}},"diagnostic_exempt":{"type":"array","items":{"$ref":"common.json#/$defs/skillId"},"description":"Teşhis maddesi olmayan, pratikte ölçülen yapraklar"}}};
const pattern9 = new RegExp("^[A-Z]{2,5}-[A-Z]{2,5}$", "u");
const pattern10 = new RegExp("^[0-9]{4}\\.[0-9]+$", "u");

function validate85(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate85.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.code === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.authority === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "authority"},message:"must have required property '"+"authority"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.year === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "year"},message:"must have required property '"+"year"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.version === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.label === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "label"},message:"must have required property '"+"label"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.status === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema43.properties, key0))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err7 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.code !== undefined){
let data1 = data.code;
if(typeof data1 === "string"){
if(!pattern9.test(data1)){
const err8 = {instancePath:instancePath+"/code",schemaPath:"#/properties/code/pattern",keyword:"pattern",params:{pattern: "^[A-Z]{2,5}-[A-Z]{2,5}$"},message:"must match pattern \""+"^[A-Z]{2,5}-[A-Z]{2,5}$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/code",schemaPath:"#/properties/code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.authority !== undefined){
let data2 = data.authority;
if(!((((data2 === "MEB") || (data2 === "ÖSYM")) || (data2 === "UNI")) || (data2 === "OTHER"))){
const err10 = {instancePath:instancePath+"/authority",schemaPath:"#/properties/authority/enum",keyword:"enum",params:{allowedValues: schema43.properties.authority.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.year !== undefined){
let data3 = data.year;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err11 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 > 2100 || isNaN(data3)){
const err12 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/maximum",keyword:"maximum",params:{comparison: "<=", limit: 2100},message:"must be <= 2100"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data3 < 2000 || isNaN(data3)){
const err13 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/minimum",keyword:"minimum",params:{comparison: ">=", limit: 2000},message:"must be >= 2000"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
if(data.version !== undefined){
let data4 = data.version;
if(typeof data4 === "string"){
if(!pattern10.test(data4)){
const err14 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/pattern",keyword:"pattern",params:{pattern: "^[0-9]{4}\\.[0-9]+$"},message:"must match pattern \""+"^[0-9]{4}\\.[0-9]+$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.label !== undefined){
let data5 = data.label;
if(typeof data5 === "string"){
if(func1(data5) > 120){
const err16 = {instancePath:instancePath+"/label",schemaPath:"#/properties/label/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func1(data5) < 3){
const err17 = {instancePath:instancePath+"/label",schemaPath:"#/properties/label/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/label",schemaPath:"#/properties/label/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.status !== undefined){
let data6 = data.status;
if(!(((data6 === "draft") || (data6 === "active")) || (data6 === "retired"))){
const err19 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema43.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.period_label !== undefined){
let data7 = data.period_label;
if(typeof data7 === "string"){
if(func1(data7) > 40){
const err20 = {instancePath:instancePath+"/period_label",schemaPath:"#/properties/period_label/maxLength",keyword:"maxLength",params:{limit: 40},message:"must NOT have more than 40 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(func1(data7) < 3){
const err21 = {instancePath:instancePath+"/period_label",schemaPath:"#/properties/period_label/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/period_label",schemaPath:"#/properties/period_label/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.sources !== undefined){
let data8 = data.sources;
if(Array.isArray(data8)){
const len0 = data8.length;
for(let i0=0; i0<len0; i0++){
let data9 = data8[i0];
if(typeof data9 === "string"){
if(func1(data9) < 3){
const err23 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"#/properties/sources/items/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"#/properties/sources/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath:instancePath+"/sources",schemaPath:"#/properties/sources/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.diagnostic_exempt !== undefined){
let data10 = data.diagnostic_exempt;
if(Array.isArray(data10)){
const len1 = data10.length;
for(let i1=0; i1<len1; i1++){
if(!(validate72(data10[i1], {instancePath:instancePath+"/diagnostic_exempt/" + i1,parentData:data10,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
}
else {
const err26 = {instancePath:instancePath+"/diagnostic_exempt",schemaPath:"#/properties/diagnostic_exempt/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate85.errors = vErrors;
return errors === 0;
}
validate85.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema44 = {"type":"object","additionalProperties":false,"description":"skills.json öğesi (skills satırı)","required":["id","parent_id","name","is_leaf"],"properties":{"id":{"$ref":"common.json#/$defs/skillId"},"parent_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}]},"name":{"type":"string","minLength":2,"maxLength":120},"description":{"type":["string","null"],"maxLength":600},"is_leaf":{"type":"boolean","description":"Düğüm kazanımlar (false) mastery tutmaz"},"order_no":{"type":"integer","minimum":0},"p_init":{"type":"number","minimum":0.001,"maximum":0.999},"p_learn":{"type":"number","minimum":0.001,"maximum":0.999},"p_guess":{"type":"number","minimum":0.001,"maximum":0.999},"p_slip":{"type":"number","minimum":0.001,"maximum":0.999}}};

function validate88(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate88.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.parent_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "parent_id"},message:"must have required property '"+"parent_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.name === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.is_leaf === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "is_leaf"},message:"must have required property '"+"is_leaf"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema44.properties, key0))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.id !== undefined){
if(!(validate72(data.id, {instancePath:instancePath+"/id",parentData:data,parentDataProperty:"id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data.parent_id !== undefined){
let data1 = data.parent_id;
const _errs4 = errors;
let valid1 = false;
let passing0 = null;
const _errs5 = errors;
if(data1 !== null){
const err5 = {instancePath:instancePath+"/parent_id",schemaPath:"#/properties/parent_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
var _valid0 = _errs5 === errors;
if(_valid0){
valid1 = true;
passing0 = 0;
}
const _errs7 = errors;
if(!(validate72(data1, {instancePath:instancePath+"/parent_id",parentData:data,parentDataProperty:"parent_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid0 = _errs7 === errors;
if(_valid0 && valid1){
valid1 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid1 = true;
passing0 = 1;
}
}
if(!valid1){
const err6 = {instancePath:instancePath+"/parent_id",schemaPath:"#/properties/parent_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
else {
errors = _errs4;
if(vErrors !== null){
if(_errs4){
vErrors.length = _errs4;
}
else {
vErrors = null;
}
}
}
}
if(data.name !== undefined){
let data2 = data.name;
if(typeof data2 === "string"){
if(func1(data2) > 120){
const err7 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func1(data2) < 2){
const err8 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 2},message:"must NOT have fewer than 2 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.description !== undefined){
let data3 = data.description;
if((typeof data3 !== "string") && (data3 !== null)){
const err10 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/type",keyword:"type",params:{type: schema44.properties.description.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(typeof data3 === "string"){
if(func1(data3) > 600){
const err11 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
if(data.is_leaf !== undefined){
if(typeof data.is_leaf !== "boolean"){
const err12 = {instancePath:instancePath+"/is_leaf",schemaPath:"#/properties/is_leaf/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.order_no !== undefined){
let data5 = data.order_no;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err13 = {instancePath:instancePath+"/order_no",schemaPath:"#/properties/order_no/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err14 = {instancePath:instancePath+"/order_no",schemaPath:"#/properties/order_no/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
}
if(data.p_init !== undefined){
let data6 = data.p_init;
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 0.999 || isNaN(data6)){
const err15 = {instancePath:instancePath+"/p_init",schemaPath:"#/properties/p_init/maximum",keyword:"maximum",params:{comparison: "<=", limit: 0.999},message:"must be <= 0.999"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data6 < 0.001 || isNaN(data6)){
const err16 = {instancePath:instancePath+"/p_init",schemaPath:"#/properties/p_init/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.001},message:"must be >= 0.001"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/p_init",schemaPath:"#/properties/p_init/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.p_learn !== undefined){
let data7 = data.p_learn;
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 > 0.999 || isNaN(data7)){
const err18 = {instancePath:instancePath+"/p_learn",schemaPath:"#/properties/p_learn/maximum",keyword:"maximum",params:{comparison: "<=", limit: 0.999},message:"must be <= 0.999"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data7 < 0.001 || isNaN(data7)){
const err19 = {instancePath:instancePath+"/p_learn",schemaPath:"#/properties/p_learn/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.001},message:"must be >= 0.001"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/p_learn",schemaPath:"#/properties/p_learn/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.p_guess !== undefined){
let data8 = data.p_guess;
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 0.999 || isNaN(data8)){
const err21 = {instancePath:instancePath+"/p_guess",schemaPath:"#/properties/p_guess/maximum",keyword:"maximum",params:{comparison: "<=", limit: 0.999},message:"must be <= 0.999"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data8 < 0.001 || isNaN(data8)){
const err22 = {instancePath:instancePath+"/p_guess",schemaPath:"#/properties/p_guess/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.001},message:"must be >= 0.001"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/p_guess",schemaPath:"#/properties/p_guess/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.p_slip !== undefined){
let data9 = data.p_slip;
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 > 0.999 || isNaN(data9)){
const err24 = {instancePath:instancePath+"/p_slip",schemaPath:"#/properties/p_slip/maximum",keyword:"maximum",params:{comparison: "<=", limit: 0.999},message:"must be <= 0.999"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data9 < 0.001 || isNaN(data9)){
const err25 = {instancePath:instancePath+"/p_slip",schemaPath:"#/properties/p_slip/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.001},message:"must be >= 0.001"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/p_slip",schemaPath:"#/properties/p_slip/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate88.errors = vErrors;
return errors === 0;
}
validate88.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema45 = {"type":"object","additionalProperties":false,"description":"prerequisites.json öğesi (skill_prerequisites satırı)","required":["skill_id","prereq_id","strength"],"properties":{"skill_id":{"$ref":"common.json#/$defs/skillId"},"prereq_id":{"$ref":"common.json#/$defs/skillId"},"strength":{"type":"number","minimum":0,"maximum":1},"source":{"enum":["curriculum","instructor","inferred"]}}};

function validate92(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate92.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.skill_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_id"},message:"must have required property '"+"skill_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.prereq_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "prereq_id"},message:"must have required property '"+"prereq_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.strength === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "strength"},message:"must have required property '"+"strength"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "skill_id") || (key0 === "prereq_id")) || (key0 === "strength")) || (key0 === "source"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.skill_id !== undefined){
if(!(validate72(data.skill_id, {instancePath:instancePath+"/skill_id",parentData:data,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data.prereq_id !== undefined){
if(!(validate72(data.prereq_id, {instancePath:instancePath+"/prereq_id",parentData:data,parentDataProperty:"prereq_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data.strength !== undefined){
let data2 = data.strength;
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 > 1 || isNaN(data2)){
const err4 = {instancePath:instancePath+"/strength",schemaPath:"#/properties/strength/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err5 = {instancePath:instancePath+"/strength",schemaPath:"#/properties/strength/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/strength",schemaPath:"#/properties/strength/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.source !== undefined){
let data3 = data.source;
if(!(((data3 === "curriculum") || (data3 === "instructor")) || (data3 === "inferred"))){
const err7 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/enum",keyword:"enum",params:{allowedValues: schema45.properties.source.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
else {
const err8 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
validate92.errors = vErrors;
return errors === 0;
}
validate92.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate84(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/curriculum.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate84.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.curriculum === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "curriculum"},message:"must have required property '"+"curriculum"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.skills === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skills"},message:"must have required property '"+"skills"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.prerequisites === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "prerequisites"},message:"must have required property '"+"prerequisites"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schema_version") || (key0 === "curriculum")) || (key0 === "skills")) || (key0 === "prerequisites"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err4 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.curriculum !== undefined){
if(!(validate85(data.curriculum, {instancePath:instancePath+"/curriculum",parentData:data,parentDataProperty:"curriculum",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate85.errors : vErrors.concat(validate85.errors);
errors = vErrors.length;
}
}
if(data.skills !== undefined){
let data2 = data.skills;
if(Array.isArray(data2)){
if(data2.length < 1){
const err5 = {instancePath:instancePath+"/skills",schemaPath:"#/properties/skills/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const len0 = data2.length;
for(let i0=0; i0<len0; i0++){
if(!(validate88(data2[i0], {instancePath:instancePath+"/skills/" + i0,parentData:data2,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate88.errors : vErrors.concat(validate88.errors);
errors = vErrors.length;
}
}
}
else {
const err6 = {instancePath:instancePath+"/skills",schemaPath:"#/properties/skills/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.prerequisites !== undefined){
let data4 = data.prerequisites;
if(Array.isArray(data4)){
const len1 = data4.length;
for(let i1=0; i1<len1; i1++){
if(!(validate92(data4[i1], {instancePath:instancePath+"/prerequisites/" + i1,parentData:data4,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate92.errors : vErrors.concat(validate92.errors);
errors = vErrors.length;
}
}
}
else {
const err7 = {instancePath:instancePath+"/prerequisites",schemaPath:"#/properties/prerequisites/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
else {
const err8 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
validate84.errors = vErrors;
return errors === 0;
}
validate84.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const curriculumCurriculum = validate96;

function validate96(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate96.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.code === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.authority === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "authority"},message:"must have required property '"+"authority"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.year === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "year"},message:"must have required property '"+"year"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.version === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.label === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "label"},message:"must have required property '"+"label"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.status === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema43.properties, key0))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err7 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.code !== undefined){
let data1 = data.code;
if(typeof data1 === "string"){
if(!pattern9.test(data1)){
const err8 = {instancePath:instancePath+"/code",schemaPath:"#/properties/code/pattern",keyword:"pattern",params:{pattern: "^[A-Z]{2,5}-[A-Z]{2,5}$"},message:"must match pattern \""+"^[A-Z]{2,5}-[A-Z]{2,5}$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/code",schemaPath:"#/properties/code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.authority !== undefined){
let data2 = data.authority;
if(!((((data2 === "MEB") || (data2 === "ÖSYM")) || (data2 === "UNI")) || (data2 === "OTHER"))){
const err10 = {instancePath:instancePath+"/authority",schemaPath:"#/properties/authority/enum",keyword:"enum",params:{allowedValues: schema43.properties.authority.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.year !== undefined){
let data3 = data.year;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err11 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 > 2100 || isNaN(data3)){
const err12 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/maximum",keyword:"maximum",params:{comparison: "<=", limit: 2100},message:"must be <= 2100"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data3 < 2000 || isNaN(data3)){
const err13 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/minimum",keyword:"minimum",params:{comparison: ">=", limit: 2000},message:"must be >= 2000"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
if(data.version !== undefined){
let data4 = data.version;
if(typeof data4 === "string"){
if(!pattern10.test(data4)){
const err14 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/pattern",keyword:"pattern",params:{pattern: "^[0-9]{4}\\.[0-9]+$"},message:"must match pattern \""+"^[0-9]{4}\\.[0-9]+$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.label !== undefined){
let data5 = data.label;
if(typeof data5 === "string"){
if(func1(data5) > 120){
const err16 = {instancePath:instancePath+"/label",schemaPath:"#/properties/label/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func1(data5) < 3){
const err17 = {instancePath:instancePath+"/label",schemaPath:"#/properties/label/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/label",schemaPath:"#/properties/label/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.status !== undefined){
let data6 = data.status;
if(!(((data6 === "draft") || (data6 === "active")) || (data6 === "retired"))){
const err19 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema43.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.period_label !== undefined){
let data7 = data.period_label;
if(typeof data7 === "string"){
if(func1(data7) > 40){
const err20 = {instancePath:instancePath+"/period_label",schemaPath:"#/properties/period_label/maxLength",keyword:"maxLength",params:{limit: 40},message:"must NOT have more than 40 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(func1(data7) < 3){
const err21 = {instancePath:instancePath+"/period_label",schemaPath:"#/properties/period_label/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/period_label",schemaPath:"#/properties/period_label/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.sources !== undefined){
let data8 = data.sources;
if(Array.isArray(data8)){
const len0 = data8.length;
for(let i0=0; i0<len0; i0++){
let data9 = data8[i0];
if(typeof data9 === "string"){
if(func1(data9) < 3){
const err23 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"#/properties/sources/items/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"#/properties/sources/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath:instancePath+"/sources",schemaPath:"#/properties/sources/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.diagnostic_exempt !== undefined){
let data10 = data.diagnostic_exempt;
if(Array.isArray(data10)){
const len1 = data10.length;
for(let i1=0; i1<len1; i1++){
if(!(validate72(data10[i1], {instancePath:instancePath+"/diagnostic_exempt/" + i1,parentData:data10,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
}
else {
const err26 = {instancePath:instancePath+"/diagnostic_exempt",schemaPath:"#/properties/diagnostic_exempt/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate96.errors = vErrors;
return errors === 0;
}
validate96.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const curriculumPrerequisite = validate98;

function validate98(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate98.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.skill_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_id"},message:"must have required property '"+"skill_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.prereq_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "prereq_id"},message:"must have required property '"+"prereq_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.strength === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "strength"},message:"must have required property '"+"strength"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "skill_id") || (key0 === "prereq_id")) || (key0 === "strength")) || (key0 === "source"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.skill_id !== undefined){
if(!(validate72(data.skill_id, {instancePath:instancePath+"/skill_id",parentData:data,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data.prereq_id !== undefined){
if(!(validate72(data.prereq_id, {instancePath:instancePath+"/prereq_id",parentData:data,parentDataProperty:"prereq_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data.strength !== undefined){
let data2 = data.strength;
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 > 1 || isNaN(data2)){
const err4 = {instancePath:instancePath+"/strength",schemaPath:"#/properties/strength/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err5 = {instancePath:instancePath+"/strength",schemaPath:"#/properties/strength/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/strength",schemaPath:"#/properties/strength/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.source !== undefined){
let data3 = data.source;
if(!(((data3 === "curriculum") || (data3 === "instructor")) || (data3 === "inferred"))){
const err7 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/enum",keyword:"enum",params:{allowedValues: schema45.properties.source.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
else {
const err8 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
validate98.errors = vErrors;
return errors === 0;
}
validate98.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const curriculumSkill = validate101;

function validate101(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate101.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.parent_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "parent_id"},message:"must have required property '"+"parent_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.name === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.is_leaf === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "is_leaf"},message:"must have required property '"+"is_leaf"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema44.properties, key0))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.id !== undefined){
if(!(validate72(data.id, {instancePath:instancePath+"/id",parentData:data,parentDataProperty:"id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data.parent_id !== undefined){
let data1 = data.parent_id;
const _errs4 = errors;
let valid1 = false;
let passing0 = null;
const _errs5 = errors;
if(data1 !== null){
const err5 = {instancePath:instancePath+"/parent_id",schemaPath:"#/properties/parent_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
var _valid0 = _errs5 === errors;
if(_valid0){
valid1 = true;
passing0 = 0;
}
const _errs7 = errors;
if(!(validate72(data1, {instancePath:instancePath+"/parent_id",parentData:data,parentDataProperty:"parent_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid0 = _errs7 === errors;
if(_valid0 && valid1){
valid1 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid1 = true;
passing0 = 1;
}
}
if(!valid1){
const err6 = {instancePath:instancePath+"/parent_id",schemaPath:"#/properties/parent_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
else {
errors = _errs4;
if(vErrors !== null){
if(_errs4){
vErrors.length = _errs4;
}
else {
vErrors = null;
}
}
}
}
if(data.name !== undefined){
let data2 = data.name;
if(typeof data2 === "string"){
if(func1(data2) > 120){
const err7 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func1(data2) < 2){
const err8 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/minLength",keyword:"minLength",params:{limit: 2},message:"must NOT have fewer than 2 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.description !== undefined){
let data3 = data.description;
if((typeof data3 !== "string") && (data3 !== null)){
const err10 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/type",keyword:"type",params:{type: schema44.properties.description.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(typeof data3 === "string"){
if(func1(data3) > 600){
const err11 = {instancePath:instancePath+"/description",schemaPath:"#/properties/description/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
if(data.is_leaf !== undefined){
if(typeof data.is_leaf !== "boolean"){
const err12 = {instancePath:instancePath+"/is_leaf",schemaPath:"#/properties/is_leaf/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.order_no !== undefined){
let data5 = data.order_no;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err13 = {instancePath:instancePath+"/order_no",schemaPath:"#/properties/order_no/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err14 = {instancePath:instancePath+"/order_no",schemaPath:"#/properties/order_no/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
}
if(data.p_init !== undefined){
let data6 = data.p_init;
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 0.999 || isNaN(data6)){
const err15 = {instancePath:instancePath+"/p_init",schemaPath:"#/properties/p_init/maximum",keyword:"maximum",params:{comparison: "<=", limit: 0.999},message:"must be <= 0.999"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data6 < 0.001 || isNaN(data6)){
const err16 = {instancePath:instancePath+"/p_init",schemaPath:"#/properties/p_init/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.001},message:"must be >= 0.001"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/p_init",schemaPath:"#/properties/p_init/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.p_learn !== undefined){
let data7 = data.p_learn;
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 > 0.999 || isNaN(data7)){
const err18 = {instancePath:instancePath+"/p_learn",schemaPath:"#/properties/p_learn/maximum",keyword:"maximum",params:{comparison: "<=", limit: 0.999},message:"must be <= 0.999"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data7 < 0.001 || isNaN(data7)){
const err19 = {instancePath:instancePath+"/p_learn",schemaPath:"#/properties/p_learn/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.001},message:"must be >= 0.001"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/p_learn",schemaPath:"#/properties/p_learn/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.p_guess !== undefined){
let data8 = data.p_guess;
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 0.999 || isNaN(data8)){
const err21 = {instancePath:instancePath+"/p_guess",schemaPath:"#/properties/p_guess/maximum",keyword:"maximum",params:{comparison: "<=", limit: 0.999},message:"must be <= 0.999"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data8 < 0.001 || isNaN(data8)){
const err22 = {instancePath:instancePath+"/p_guess",schemaPath:"#/properties/p_guess/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.001},message:"must be >= 0.001"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/p_guess",schemaPath:"#/properties/p_guess/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.p_slip !== undefined){
let data9 = data.p_slip;
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 > 0.999 || isNaN(data9)){
const err24 = {instancePath:instancePath+"/p_slip",schemaPath:"#/properties/p_slip/maximum",keyword:"maximum",params:{comparison: "<=", limit: 0.999},message:"must be <= 0.999"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data9 < 0.001 || isNaN(data9)){
const err25 = {instancePath:instancePath+"/p_slip",schemaPath:"#/properties/p_slip/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.001},message:"must be >= 0.001"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/p_slip",schemaPath:"#/properties/p_slip/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate101.errors = vErrors;
return errors === 0;
}
validate101.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const diagnosticTest = validate104;
const schema49 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/diagnostic-test.json","title":"DiagnosticTest","description":"Teşhis testi madde listesi (diagnostic/items.json): 15–20 madde, sabit sıra, her madde 4 şık. Doğru şık alanı (correct) TANIMSIZDIR ve additionalProperties:false olduğundan anahtar bu dosyaya sızamaz.","x-version":"1.0","type":"array","minItems":15,"maxItems":20,"items":{"$ref":"#/$defs/item"},"$defs":{"item":{"type":"object","additionalProperties":false,"required":["code","skill_ids","difficulty","kind","stem","figure","options"],"properties":{"code":{"type":"string","pattern":"^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$","examples":["DIAG-2026.1-07"]},"skill_ids":{"type":"array","minItems":1,"maxItems":3,"items":{"$ref":"common.json#/$defs/skillId"}},"difficulty":{"$ref":"common.json#/$defs/probability"},"kind":{"const":"mcq","description":"Teşhis maddeleri A–D şıklıdır"},"stem":{"type":"string","minLength":10,"maxLength":900},"stem_values":{"type":"object","additionalProperties":{"type":["number","string"]}},"figure":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/figure"}]},"options":{"$ref":"question-item.json#/properties/options"}}},"figure":{"type":"object","additionalProperties":false,"required":["tool","png_path","alt_text"],"description":"Önceden render edilmiş şekil (diagnostic/figures/*.png + üreten .py, seed=2026)","properties":{"tool":{"enum":["matplotlib","svg","template"]},"png_path":{"type":"string","pattern":"^figures/[a-z0-9-]+\\.png$"},"source_path":{"type":"string","pattern":"^figures/[a-z0-9-]+\\.py$"},"alt_text":{"type":"string","minLength":15,"maxLength":400,"description":"Şekli kelimelerle anlatır (Telegram altyazısı)"}}}}};
const schema50 = {"type":"object","additionalProperties":false,"required":["code","skill_ids","difficulty","kind","stem","figure","options"],"properties":{"code":{"type":"string","pattern":"^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$","examples":["DIAG-2026.1-07"]},"skill_ids":{"type":"array","minItems":1,"maxItems":3,"items":{"$ref":"common.json#/$defs/skillId"}},"difficulty":{"$ref":"common.json#/$defs/probability"},"kind":{"const":"mcq","description":"Teşhis maddeleri A–D şıklıdır"},"stem":{"type":"string","minLength":10,"maxLength":900},"stem_values":{"type":"object","additionalProperties":{"type":["number","string"]}},"figure":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/figure"}]},"options":{"$ref":"question-item.json#/properties/options"}}};
const pattern13 = new RegExp("^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$", "u");
const schema51 = {"type":"object","additionalProperties":false,"required":["tool","png_path","alt_text"],"description":"Önceden render edilmiş şekil (diagnostic/figures/*.png + üreten .py, seed=2026)","properties":{"tool":{"enum":["matplotlib","svg","template"]},"png_path":{"type":"string","pattern":"^figures/[a-z0-9-]+\\.png$"},"source_path":{"type":"string","pattern":"^figures/[a-z0-9-]+\\.py$"},"alt_text":{"type":"string","minLength":15,"maxLength":400,"description":"Şekli kelimelerle anlatır (Telegram altyazısı)"}}};
const pattern14 = new RegExp("^figures/[a-z0-9-]+\\.png$", "u");
const pattern15 = new RegExp("^figures/[a-z0-9-]+\\.py$", "u");

function validate108(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate108.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.tool === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tool"},message:"must have required property '"+"tool"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.png_path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "png_path"},message:"must have required property '"+"png_path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.alt_text === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "alt_text"},message:"must have required property '"+"alt_text"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "tool") || (key0 === "png_path")) || (key0 === "source_path")) || (key0 === "alt_text"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.tool !== undefined){
let data0 = data.tool;
if(!(((data0 === "matplotlib") || (data0 === "svg")) || (data0 === "template"))){
const err4 = {instancePath:instancePath+"/tool",schemaPath:"#/properties/tool/enum",keyword:"enum",params:{allowedValues: schema51.properties.tool.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.png_path !== undefined){
let data1 = data.png_path;
if(typeof data1 === "string"){
if(!pattern14.test(data1)){
const err5 = {instancePath:instancePath+"/png_path",schemaPath:"#/properties/png_path/pattern",keyword:"pattern",params:{pattern: "^figures/[a-z0-9-]+\\.png$"},message:"must match pattern \""+"^figures/[a-z0-9-]+\\.png$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/png_path",schemaPath:"#/properties/png_path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.source_path !== undefined){
let data2 = data.source_path;
if(typeof data2 === "string"){
if(!pattern15.test(data2)){
const err7 = {instancePath:instancePath+"/source_path",schemaPath:"#/properties/source_path/pattern",keyword:"pattern",params:{pattern: "^figures/[a-z0-9-]+\\.py$"},message:"must match pattern \""+"^figures/[a-z0-9-]+\\.py$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/source_path",schemaPath:"#/properties/source_path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.alt_text !== undefined){
let data3 = data.alt_text;
if(typeof data3 === "string"){
if(func1(data3) > 400){
const err9 = {instancePath:instancePath+"/alt_text",schemaPath:"#/properties/alt_text/maxLength",keyword:"maxLength",params:{limit: 400},message:"must NOT have more than 400 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func1(data3) < 15){
const err10 = {instancePath:instancePath+"/alt_text",schemaPath:"#/properties/alt_text/minLength",keyword:"minLength",params:{limit: 15},message:"must NOT have fewer than 15 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/alt_text",schemaPath:"#/properties/alt_text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate108.errors = vErrors;
return errors === 0;
}
validate108.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema58 = {"type":"array","minItems":4,"maxItems":4,"description":"Tam dört şık, anahtarlar sırayla A, B, C, D (yinelenen, eksik ya da sırası bozuk anahtar düşer; Telegram A·B·C·D düğmeleri ve grade_attempt aynı sırayı varsayar). En az iki şık misconception_tag=null taşır (doğru şık + en az bir etiketsiz çeldirici).","items":{"type":"object","additionalProperties":false,"required":["key","text","misconception_tag"],"properties":{"key":{"$ref":"common.json#/$defs/optionKey"},"text":{"type":"string","minLength":1,"maxLength":200},"misconception_tag":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/tag"}],"description":"Yanlış şıkkın kodladığı yanılgı. DOĞRU ŞIK BU DİZİDEN ÇIKARILAMAZ: doğru şık null taşır VE en az bir çeldirici de null taşır (en az iki null zorunlu); LLM ve öğrenci yolu şıkları app.strip_tags ile etiketsiz görür."}}},"contains":{"type":"object","required":["misconception_tag"],"properties":{"misconception_tag":{"type":"null"}}},"minContains":2,"allOf":[{"minItems":4,"maxItems":4,"prefixItems":[{"properties":{"key":{"const":"A"}}},{"properties":{"key":{"const":"B"}}},{"properties":{"key":{"const":"C"}}},{"properties":{"key":{"const":"D"}}}]}]};

function validate131(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate131.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(Array.isArray(data)){
if(data.length > 4){
const err0 = {instancePath,schemaPath:"#/allOf/0/maxItems",keyword:"maxItems",params:{limit: 4},message:"must NOT have more than 4 items"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.length < 4){
const err1 = {instancePath,schemaPath:"#/allOf/0/minItems",keyword:"minItems",params:{limit: 4},message:"must NOT have fewer than 4 items"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
const len0 = data.length;
if(len0 > 0){
let data0 = data[0];
if(data0 && typeof data0 == "object" && !Array.isArray(data0)){
if(data0.key !== undefined){
if("A" !== data0.key){
const err2 = {instancePath:instancePath+"/0/key",schemaPath:"#/allOf/0/prefixItems/0/properties/key/const",keyword:"const",params:{allowedValue: "A"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
}
if(len0 > 1){
let data2 = data[1];
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.key !== undefined){
if("B" !== data2.key){
const err3 = {instancePath:instancePath+"/1/key",schemaPath:"#/allOf/0/prefixItems/1/properties/key/const",keyword:"const",params:{allowedValue: "B"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
}
if(len0 > 2){
let data4 = data[2];
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.key !== undefined){
if("C" !== data4.key){
const err4 = {instancePath:instancePath+"/2/key",schemaPath:"#/allOf/0/prefixItems/2/properties/key/const",keyword:"const",params:{allowedValue: "C"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
}
if(len0 > 3){
let data6 = data[3];
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
if(data6.key !== undefined){
if("D" !== data6.key){
const err5 = {instancePath:instancePath+"/3/key",schemaPath:"#/allOf/0/prefixItems/3/properties/key/const",keyword:"const",params:{allowedValue: "D"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
}
}
if(Array.isArray(data)){
if(data.length > 4){
const err6 = {instancePath,schemaPath:"#/maxItems",keyword:"maxItems",params:{limit: 4},message:"must NOT have more than 4 items"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.length < 4){
const err7 = {instancePath,schemaPath:"#/minItems",keyword:"minItems",params:{limit: 4},message:"must NOT have fewer than 4 items"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
const len1 = data.length;
for(let i0=0; i0<len1; i0++){
let data8 = data[i0];
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.key === undefined){
const err8 = {instancePath:instancePath+"/" + i0,schemaPath:"#/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data8.text === undefined){
const err9 = {instancePath:instancePath+"/" + i0,schemaPath:"#/items/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data8.misconception_tag === undefined){
const err10 = {instancePath:instancePath+"/" + i0,schemaPath:"#/items/required",keyword:"required",params:{missingProperty: "misconception_tag"},message:"must have required property '"+"misconception_tag"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
for(const key0 in data8){
if(!(((key0 === "key") || (key0 === "text")) || (key0 === "misconception_tag"))){
const err11 = {instancePath:instancePath+"/" + i0,schemaPath:"#/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data8.key !== undefined){
if(!(validate68(data8.key, {instancePath:instancePath+"/" + i0+"/key",parentData:data8,parentDataProperty:"key",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
if(data8.text !== undefined){
let data10 = data8.text;
if(typeof data10 === "string"){
if(func1(data10) > 200){
const err12 = {instancePath:instancePath+"/" + i0+"/text",schemaPath:"#/items/properties/text/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func1(data10) < 1){
const err13 = {instancePath:instancePath+"/" + i0+"/text",schemaPath:"#/items/properties/text/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/" + i0+"/text",schemaPath:"#/items/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data8.misconception_tag !== undefined){
let data11 = data8.misconception_tag;
const _errs17 = errors;
let valid9 = false;
let passing0 = null;
const _errs18 = errors;
if(data11 !== null){
const err15 = {instancePath:instancePath+"/" + i0+"/misconception_tag",schemaPath:"#/items/properties/misconception_tag/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
var _valid0 = _errs18 === errors;
if(_valid0){
valid9 = true;
passing0 = 0;
}
const _errs20 = errors;
if(!(validate75(data11, {instancePath:instancePath+"/" + i0+"/misconception_tag",parentData:data8,parentDataProperty:"misconception_tag",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
errors = vErrors.length;
}
var _valid0 = _errs20 === errors;
if(_valid0 && valid9){
valid9 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid9 = true;
passing0 = 1;
}
}
if(!valid9){
const err16 = {instancePath:instancePath+"/" + i0+"/misconception_tag",schemaPath:"#/items/properties/misconception_tag/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
else {
errors = _errs17;
if(vErrors !== null){
if(_errs17){
vErrors.length = _errs17;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err17 = {instancePath:instancePath+"/" + i0,schemaPath:"#/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
const _errs21 = errors;
const len2 = data.length;
let valid10 = false;
let count0 = 0;
for(let i1=0; i1<len2; i1++){
let data12 = data[i1];
const _errs22 = errors;
if(data12 && typeof data12 == "object" && !Array.isArray(data12)){
if(data12.misconception_tag === undefined){
const err18 = {instancePath:instancePath+"/" + i1,schemaPath:"#/contains/required",keyword:"required",params:{missingProperty: "misconception_tag"},message:"must have required property '"+"misconception_tag"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data12.misconception_tag !== undefined){
if(data12.misconception_tag !== null){
const err19 = {instancePath:instancePath+"/" + i1+"/misconception_tag",schemaPath:"#/contains/properties/misconception_tag/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
else {
const err20 = {instancePath:instancePath+"/" + i1,schemaPath:"#/contains/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
var _valid1 = _errs22 === errors;
if(_valid1){
count0++;
if(count0 >= 2){
valid10 = true;
break;
}
}
}
if(!valid10){
const err21 = {instancePath,schemaPath:"#/contains",keyword:"contains",params:{minContains: 2},message:"must contain at least 2 valid item(s)"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
else {
errors = _errs21;
if(vErrors !== null){
if(_errs21){
vErrors.length = _errs21;
}
else {
vErrors = null;
}
}
}
}
else {
const err22 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
validate131.errors = vErrors;
return errors === 0;
}
validate131.evaluated = {"items":true,"dynamicProps":false,"dynamicItems":false};


function validate105(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate105.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.code === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.skill_ids === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_ids"},message:"must have required property '"+"skill_ids"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.difficulty === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "difficulty"},message:"must have required property '"+"difficulty"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.kind === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.stem === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "stem"},message:"must have required property '"+"stem"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.figure === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "figure"},message:"must have required property '"+"figure"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.options === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "options"},message:"must have required property '"+"options"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "code") || (key0 === "skill_ids")) || (key0 === "difficulty")) || (key0 === "kind")) || (key0 === "stem")) || (key0 === "stem_values")) || (key0 === "figure")) || (key0 === "options"))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.code !== undefined){
let data0 = data.code;
if(typeof data0 === "string"){
if(!pattern13.test(data0)){
const err8 = {instancePath:instancePath+"/code",schemaPath:"#/properties/code/pattern",keyword:"pattern",params:{pattern: "^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$"},message:"must match pattern \""+"^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/code",schemaPath:"#/properties/code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.skill_ids !== undefined){
let data1 = data.skill_ids;
if(Array.isArray(data1)){
if(data1.length > 3){
const err10 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.length < 1){
const err11 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
const len0 = data1.length;
for(let i0=0; i0<len0; i0++){
if(!(validate72(data1[i0], {instancePath:instancePath+"/skill_ids/" + i0,parentData:data1,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
}
else {
const err12 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.difficulty !== undefined){
if(!(validate69(data.difficulty, {instancePath:instancePath+"/difficulty",parentData:data,parentDataProperty:"difficulty",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data.kind !== undefined){
if("mcq" !== data.kind){
const err13 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/const",keyword:"const",params:{allowedValue: "mcq"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.stem !== undefined){
let data5 = data.stem;
if(typeof data5 === "string"){
if(func1(data5) > 900){
const err14 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/maxLength",keyword:"maxLength",params:{limit: 900},message:"must NOT have more than 900 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func1(data5) < 10){
const err15 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/minLength",keyword:"minLength",params:{limit: 10},message:"must NOT have fewer than 10 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.stem_values !== undefined){
let data6 = data.stem_values;
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
for(const key1 in data6){
let data7 = data6[key1];
if((!((typeof data7 == "number") && (isFinite(data7)))) && (typeof data7 !== "string")){
const err17 = {instancePath:instancePath+"/stem_values/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/stem_values/additionalProperties/type",keyword:"type",params:{type: schema50.properties.stem_values.additionalProperties.type},message:"must be number,string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
else {
const err18 = {instancePath:instancePath+"/stem_values",schemaPath:"#/properties/stem_values/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.figure !== undefined){
let data8 = data.figure;
const _errs17 = errors;
let valid4 = false;
let passing0 = null;
const _errs18 = errors;
if(data8 !== null){
const err19 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid0 = _errs18 === errors;
if(_valid0){
valid4 = true;
passing0 = 0;
}
const _errs20 = errors;
if(!(validate108(data8, {instancePath:instancePath+"/figure",parentData:data,parentDataProperty:"figure",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate108.errors : vErrors.concat(validate108.errors);
errors = vErrors.length;
}
var _valid0 = _errs20 === errors;
if(_valid0 && valid4){
valid4 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid4 = true;
passing0 = 1;
}
}
if(!valid4){
const err20 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs17;
if(vErrors !== null){
if(_errs17){
vErrors.length = _errs17;
}
else {
vErrors = null;
}
}
}
}
if(data.options !== undefined){
if(!(validate131(data.options, {instancePath:instancePath+"/options",parentData:data,parentDataProperty:"options",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate131.errors : vErrors.concat(validate131.errors);
errors = vErrors.length;
}
}
}
else {
const err21 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
validate105.errors = vErrors;
return errors === 0;
}
validate105.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate104(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/diagnostic-test.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate104.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(Array.isArray(data)){
if(data.length > 20){
const err0 = {instancePath,schemaPath:"#/maxItems",keyword:"maxItems",params:{limit: 20},message:"must NOT have more than 20 items"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.length < 15){
const err1 = {instancePath,schemaPath:"#/minItems",keyword:"minItems",params:{limit: 15},message:"must NOT have fewer than 15 items"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
const len0 = data.length;
for(let i0=0; i0<len0; i0++){
if(!(validate105(data[i0], {instancePath:instancePath+"/" + i0,parentData:data,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate105.errors : vErrors.concat(validate105.errors);
errors = vErrors.length;
}
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate104.errors = vErrors;
return errors === 0;
}
validate104.evaluated = {"items":true,"dynamicProps":false,"dynamicItems":false};

export const diagnosticTestFigure = validate136;

function validate136(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate136.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.tool === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tool"},message:"must have required property '"+"tool"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.png_path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "png_path"},message:"must have required property '"+"png_path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.alt_text === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "alt_text"},message:"must have required property '"+"alt_text"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "tool") || (key0 === "png_path")) || (key0 === "source_path")) || (key0 === "alt_text"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.tool !== undefined){
let data0 = data.tool;
if(!(((data0 === "matplotlib") || (data0 === "svg")) || (data0 === "template"))){
const err4 = {instancePath:instancePath+"/tool",schemaPath:"#/properties/tool/enum",keyword:"enum",params:{allowedValues: schema51.properties.tool.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.png_path !== undefined){
let data1 = data.png_path;
if(typeof data1 === "string"){
if(!pattern14.test(data1)){
const err5 = {instancePath:instancePath+"/png_path",schemaPath:"#/properties/png_path/pattern",keyword:"pattern",params:{pattern: "^figures/[a-z0-9-]+\\.png$"},message:"must match pattern \""+"^figures/[a-z0-9-]+\\.png$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/png_path",schemaPath:"#/properties/png_path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.source_path !== undefined){
let data2 = data.source_path;
if(typeof data2 === "string"){
if(!pattern15.test(data2)){
const err7 = {instancePath:instancePath+"/source_path",schemaPath:"#/properties/source_path/pattern",keyword:"pattern",params:{pattern: "^figures/[a-z0-9-]+\\.py$"},message:"must match pattern \""+"^figures/[a-z0-9-]+\\.py$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/source_path",schemaPath:"#/properties/source_path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.alt_text !== undefined){
let data3 = data.alt_text;
if(typeof data3 === "string"){
if(func1(data3) > 400){
const err9 = {instancePath:instancePath+"/alt_text",schemaPath:"#/properties/alt_text/maxLength",keyword:"maxLength",params:{limit: 400},message:"must NOT have more than 400 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func1(data3) < 15){
const err10 = {instancePath:instancePath+"/alt_text",schemaPath:"#/properties/alt_text/minLength",keyword:"minLength",params:{limit: 15},message:"must NOT have fewer than 15 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/alt_text",schemaPath:"#/properties/alt_text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate136.errors = vErrors;
return errors === 0;
}
validate136.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const diagnosticTestItem = validate137;

function validate137(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate137.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.code === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.skill_ids === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_ids"},message:"must have required property '"+"skill_ids"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.difficulty === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "difficulty"},message:"must have required property '"+"difficulty"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.kind === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.stem === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "stem"},message:"must have required property '"+"stem"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.figure === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "figure"},message:"must have required property '"+"figure"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.options === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "options"},message:"must have required property '"+"options"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "code") || (key0 === "skill_ids")) || (key0 === "difficulty")) || (key0 === "kind")) || (key0 === "stem")) || (key0 === "stem_values")) || (key0 === "figure")) || (key0 === "options"))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.code !== undefined){
let data0 = data.code;
if(typeof data0 === "string"){
if(!pattern13.test(data0)){
const err8 = {instancePath:instancePath+"/code",schemaPath:"#/properties/code/pattern",keyword:"pattern",params:{pattern: "^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$"},message:"must match pattern \""+"^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/code",schemaPath:"#/properties/code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.skill_ids !== undefined){
let data1 = data.skill_ids;
if(Array.isArray(data1)){
if(data1.length > 3){
const err10 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.length < 1){
const err11 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
const len0 = data1.length;
for(let i0=0; i0<len0; i0++){
if(!(validate72(data1[i0], {instancePath:instancePath+"/skill_ids/" + i0,parentData:data1,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
}
else {
const err12 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.difficulty !== undefined){
if(!(validate69(data.difficulty, {instancePath:instancePath+"/difficulty",parentData:data,parentDataProperty:"difficulty",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data.kind !== undefined){
if("mcq" !== data.kind){
const err13 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/const",keyword:"const",params:{allowedValue: "mcq"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.stem !== undefined){
let data5 = data.stem;
if(typeof data5 === "string"){
if(func1(data5) > 900){
const err14 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/maxLength",keyword:"maxLength",params:{limit: 900},message:"must NOT have more than 900 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func1(data5) < 10){
const err15 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/minLength",keyword:"minLength",params:{limit: 10},message:"must NOT have fewer than 10 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.stem_values !== undefined){
let data6 = data.stem_values;
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
for(const key1 in data6){
let data7 = data6[key1];
if((!((typeof data7 == "number") && (isFinite(data7)))) && (typeof data7 !== "string")){
const err17 = {instancePath:instancePath+"/stem_values/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/stem_values/additionalProperties/type",keyword:"type",params:{type: schema50.properties.stem_values.additionalProperties.type},message:"must be number,string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
else {
const err18 = {instancePath:instancePath+"/stem_values",schemaPath:"#/properties/stem_values/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.figure !== undefined){
let data8 = data.figure;
const _errs17 = errors;
let valid4 = false;
let passing0 = null;
const _errs18 = errors;
if(data8 !== null){
const err19 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid0 = _errs18 === errors;
if(_valid0){
valid4 = true;
passing0 = 0;
}
const _errs20 = errors;
if(!(validate108(data8, {instancePath:instancePath+"/figure",parentData:data,parentDataProperty:"figure",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate108.errors : vErrors.concat(validate108.errors);
errors = vErrors.length;
}
var _valid0 = _errs20 === errors;
if(_valid0 && valid4){
valid4 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid4 = true;
passing0 = 1;
}
}
if(!valid4){
const err20 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs17;
if(vErrors !== null){
if(_errs17){
vErrors.length = _errs17;
}
else {
vErrors = null;
}
}
}
}
if(data.options !== undefined){
if(!(validate131(data.options, {instancePath:instancePath+"/options",parentData:data,parentDataProperty:"options",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate131.errors : vErrors.concat(validate131.errors);
errors = vErrors.length;
}
}
}
else {
const err21 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
validate137.errors = vErrors;
return errors === 0;
}
validate137.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const examItem = validate142;
const schema61 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/exam-item.json","title":"ExamItem","description":"Sınav arşivinden OCR ile çıkarılmış tek soru (exam_items). ocr_text hiçbir öğrenci çıktısına kopyalanmaz.","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","source_id","item_no","topic","kind","year","ocr_text"],"properties":{"schema_version":{"const":"1.0"},"source_id":{"$ref":"common.json#/$defs/uuid"},"item_no":{"type":"integer","minimum":1},"topic":{"type":"string","maxLength":120},"kind":{"enum":["proof","calc","mc","other"]},"points":{"type":["number","null"],"minimum":0},"year":{"type":"integer"},"term":{"oneOf":[{"type":"null"},{"enum":["vize","final","but","deneme","osym","diger"]}]},"instructor_alias":{"type":["string","null"],"pattern":"^hoca-[A-Z]$"},"skill_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}]},"ocr_text":{"type":"string","description":"Yalnız eğitmen arşivi ve kümeleme; hiçbir öğrenci çıktısına kopyalanmaz"},"ocr_confidence":{"$ref":"common.json#/$defs/probability"}}};
const pattern24 = new RegExp("^hoca-[A-Z]$", "u");

function validate142(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/exam-item.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate142.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.source_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source_id"},message:"must have required property '"+"source_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.item_no === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "item_no"},message:"must have required property '"+"item_no"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.topic === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "topic"},message:"must have required property '"+"topic"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.kind === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.year === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "year"},message:"must have required property '"+"year"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.ocr_text === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ocr_text"},message:"must have required property '"+"ocr_text"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema61.properties, key0))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err8 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.source_id !== undefined){
if(!(validate83(data.source_id, {instancePath:instancePath+"/source_id",parentData:data,parentDataProperty:"source_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.item_no !== undefined){
let data2 = data.item_no;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err9 = {instancePath:instancePath+"/item_no",schemaPath:"#/properties/item_no/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 1 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/item_no",schemaPath:"#/properties/item_no/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
if(data.topic !== undefined){
let data3 = data.topic;
if(typeof data3 === "string"){
if(func1(data3) > 120){
const err11 = {instancePath:instancePath+"/topic",schemaPath:"#/properties/topic/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/topic",schemaPath:"#/properties/topic/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.kind !== undefined){
let data4 = data.kind;
if(!((((data4 === "proof") || (data4 === "calc")) || (data4 === "mc")) || (data4 === "other"))){
const err13 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema61.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.points !== undefined){
let data5 = data.points;
if((!((typeof data5 == "number") && (isFinite(data5)))) && (data5 !== null)){
const err14 = {instancePath:instancePath+"/points",schemaPath:"#/properties/points/type",keyword:"type",params:{type: schema61.properties.points.type},message:"must be number,null"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err15 = {instancePath:instancePath+"/points",schemaPath:"#/properties/points/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
if(data.year !== undefined){
let data6 = data.year;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err16 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.term !== undefined){
let data7 = data.term;
const _errs14 = errors;
let valid1 = false;
let passing0 = null;
const _errs15 = errors;
if(data7 !== null){
const err17 = {instancePath:instancePath+"/term",schemaPath:"#/properties/term/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
var _valid0 = _errs15 === errors;
if(_valid0){
valid1 = true;
passing0 = 0;
}
const _errs17 = errors;
if(!((((((data7 === "vize") || (data7 === "final")) || (data7 === "but")) || (data7 === "deneme")) || (data7 === "osym")) || (data7 === "diger"))){
const err18 = {instancePath:instancePath+"/term",schemaPath:"#/properties/term/oneOf/1/enum",keyword:"enum",params:{allowedValues: schema61.properties.term.oneOf[1].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
var _valid0 = _errs17 === errors;
if(_valid0 && valid1){
valid1 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid1 = true;
passing0 = 1;
}
}
if(!valid1){
const err19 = {instancePath:instancePath+"/term",schemaPath:"#/properties/term/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
else {
errors = _errs14;
if(vErrors !== null){
if(_errs14){
vErrors.length = _errs14;
}
else {
vErrors = null;
}
}
}
}
if(data.instructor_alias !== undefined){
let data8 = data.instructor_alias;
if((typeof data8 !== "string") && (data8 !== null)){
const err20 = {instancePath:instancePath+"/instructor_alias",schemaPath:"#/properties/instructor_alias/type",keyword:"type",params:{type: schema61.properties.instructor_alias.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(typeof data8 === "string"){
if(!pattern24.test(data8)){
const err21 = {instancePath:instancePath+"/instructor_alias",schemaPath:"#/properties/instructor_alias/pattern",keyword:"pattern",params:{pattern: "^hoca-[A-Z]$"},message:"must match pattern \""+"^hoca-[A-Z]$"+"\""};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
if(data.skill_id !== undefined){
let data9 = data.skill_id;
const _errs21 = errors;
let valid2 = false;
let passing1 = null;
const _errs22 = errors;
if(data9 !== null){
const err22 = {instancePath:instancePath+"/skill_id",schemaPath:"#/properties/skill_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
var _valid1 = _errs22 === errors;
if(_valid1){
valid2 = true;
passing1 = 0;
}
const _errs24 = errors;
if(!(validate72(data9, {instancePath:instancePath+"/skill_id",parentData:data,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid1 = _errs24 === errors;
if(_valid1 && valid2){
valid2 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid2 = true;
passing1 = 1;
}
}
if(!valid2){
const err23 = {instancePath:instancePath+"/skill_id",schemaPath:"#/properties/skill_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
else {
errors = _errs21;
if(vErrors !== null){
if(_errs21){
vErrors.length = _errs21;
}
else {
vErrors = null;
}
}
}
}
if(data.ocr_text !== undefined){
if(typeof data.ocr_text !== "string"){
const err24 = {instancePath:instancePath+"/ocr_text",schemaPath:"#/properties/ocr_text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.ocr_confidence !== undefined){
if(!(validate69(data.ocr_confidence, {instancePath:instancePath+"/ocr_confidence",parentData:data,parentDataProperty:"ocr_confidence",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
}
else {
const err25 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
validate142.errors = vErrors;
return errors === 0;
}
validate142.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const examPriorityPlan = validate146;
const schema62 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/exam-priority-plan.json","title":"ExamPriorityPlan","description":"Kalem (b) çıktısı: geçmiş sınavların sıklık analizine göre öncelikler. Tahmin değildir; soru metni taşımaz.","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","course_code","period","title","years_total","rows","others","evidence_count","generated_at"],"x-forbidden-words":["tahmin","çıkacak","kesin","garanti"],"properties":{"schema_version":{"const":"1.0"},"course_code":{"type":"string"},"period":{"type":"string"},"title":{"const":"Sıklık analizine göre öncelikler"},"years_total":{"type":"integer","minimum":2},"rows":{"type":"array","minItems":1,"maxItems":10,"items":{"type":"object","additionalProperties":false,"required":["rank","topic","kind","hits","years","points_text","evidence_count","evidence_item_ids","syllabus_alignment"],"properties":{"rank":{"type":"integer","minimum":1},"topic":{"type":"string","maxLength":80},"kind":{"enum":["ispat","hesap","çoktan seçmeli","diğer"]},"skill_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}]},"hits":{"type":"integer","minimum":1},"years":{"type":"integer","minimum":1},"points_text":{"type":"string","pattern":"^≈[0-9]+ puan$"},"evidence_count":{"type":"integer","minimum":1},"evidence_item_ids":{"type":"array","minItems":1,"items":{"$ref":"common.json#/$defs/uuid"},"description":"Eğitmen arşivine bağlantı; soru metni yok"},"syllabus_alignment":{"enum":["covered_and_asked","covered_never_asked","asked_not_in_syllabus"]},"variant_question_ids":{"type":"array","items":{"$ref":"common.json#/$defs/uuid"},"description":"ÖZGÜN varyantlar (questions.source='llm', approved)"}}}},"others":{"type":"array","items":{"type":"string","maxLength":80}},"uncovered_topics":{"type":"array","items":{"type":"string"},"description":"İzlencede var, hiç sorulmamış"},"evidence_count":{"type":"integer","minimum":1},"generated_at":{"$ref":"common.json#/$defs/dateTime"}}};
const func51 = ogrFindForbiddenWord;
const pattern25 = new RegExp("^≈[0-9]+ puan$", "u");

function validate146(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/exam-priority-plan.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate146.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const forbidden0 = func51(data, ["tahmin","çıkacak","kesin","garanti"]);
if(forbidden0 !== null){
const err0 = {instancePath,schemaPath:"#/x-forbidden-words",keyword:"x-forbidden-words",params:{word: forbidden0},message:"yasaklı kelime içeriyor: "+forbidden0};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.course_code === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "course_code"},message:"must have required property '"+"course_code"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.period === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "period"},message:"must have required property '"+"period"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.title === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.years_total === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "years_total"},message:"must have required property '"+"years_total"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.rows === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "rows"},message:"must have required property '"+"rows"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.others === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "others"},message:"must have required property '"+"others"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.evidence_count === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "evidence_count"},message:"must have required property '"+"evidence_count"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.generated_at === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "generated_at"},message:"must have required property '"+"generated_at"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema62.properties, key0))){
const err10 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err11 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.course_code !== undefined){
if(typeof data.course_code !== "string"){
const err12 = {instancePath:instancePath+"/course_code",schemaPath:"#/properties/course_code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.period !== undefined){
if(typeof data.period !== "string"){
const err13 = {instancePath:instancePath+"/period",schemaPath:"#/properties/period/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.title !== undefined){
if("Sıklık analizine göre öncelikler" !== data.title){
const err14 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/const",keyword:"const",params:{allowedValue: "Sıklık analizine göre öncelikler"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.years_total !== undefined){
let data4 = data.years_total;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err15 = {instancePath:instancePath+"/years_total",schemaPath:"#/properties/years_total/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 2 || isNaN(data4)){
const err16 = {instancePath:instancePath+"/years_total",schemaPath:"#/properties/years_total/minimum",keyword:"minimum",params:{comparison: ">=", limit: 2},message:"must be >= 2"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
if(data.rows !== undefined){
let data5 = data.rows;
if(Array.isArray(data5)){
if(data5.length > 10){
const err17 = {instancePath:instancePath+"/rows",schemaPath:"#/properties/rows/maxItems",keyword:"maxItems",params:{limit: 10},message:"must NOT have more than 10 items"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data5.length < 1){
const err18 = {instancePath:instancePath+"/rows",schemaPath:"#/properties/rows/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
const len0 = data5.length;
for(let i0=0; i0<len0; i0++){
let data6 = data5[i0];
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
if(data6.rank === undefined){
const err19 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/required",keyword:"required",params:{missingProperty: "rank"},message:"must have required property '"+"rank"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data6.topic === undefined){
const err20 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/required",keyword:"required",params:{missingProperty: "topic"},message:"must have required property '"+"topic"+"'"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data6.kind === undefined){
const err21 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data6.hits === undefined){
const err22 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/required",keyword:"required",params:{missingProperty: "hits"},message:"must have required property '"+"hits"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data6.years === undefined){
const err23 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/required",keyword:"required",params:{missingProperty: "years"},message:"must have required property '"+"years"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data6.points_text === undefined){
const err24 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/required",keyword:"required",params:{missingProperty: "points_text"},message:"must have required property '"+"points_text"+"'"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data6.evidence_count === undefined){
const err25 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/required",keyword:"required",params:{missingProperty: "evidence_count"},message:"must have required property '"+"evidence_count"+"'"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(data6.evidence_item_ids === undefined){
const err26 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/required",keyword:"required",params:{missingProperty: "evidence_item_ids"},message:"must have required property '"+"evidence_item_ids"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data6.syllabus_alignment === undefined){
const err27 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/required",keyword:"required",params:{missingProperty: "syllabus_alignment"},message:"must have required property '"+"syllabus_alignment"+"'"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
for(const key1 in data6){
if(!(func2.call(schema62.properties.rows.items.properties, key1))){
const err28 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data6.rank !== undefined){
let data7 = data6.rank;
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err29 = {instancePath:instancePath+"/rows/" + i0+"/rank",schemaPath:"#/properties/rows/items/properties/rank/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 < 1 || isNaN(data7)){
const err30 = {instancePath:instancePath+"/rows/" + i0+"/rank",schemaPath:"#/properties/rows/items/properties/rank/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
}
if(data6.topic !== undefined){
let data8 = data6.topic;
if(typeof data8 === "string"){
if(func1(data8) > 80){
const err31 = {instancePath:instancePath+"/rows/" + i0+"/topic",schemaPath:"#/properties/rows/items/properties/topic/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
else {
const err32 = {instancePath:instancePath+"/rows/" + i0+"/topic",schemaPath:"#/properties/rows/items/properties/topic/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data6.kind !== undefined){
let data9 = data6.kind;
if(!((((data9 === "ispat") || (data9 === "hesap")) || (data9 === "çoktan seçmeli")) || (data9 === "diğer"))){
const err33 = {instancePath:instancePath+"/rows/" + i0+"/kind",schemaPath:"#/properties/rows/items/properties/kind/enum",keyword:"enum",params:{allowedValues: schema62.properties.rows.items.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data6.skill_id !== undefined){
let data10 = data6.skill_id;
const _errs21 = errors;
let valid4 = false;
let passing0 = null;
const _errs22 = errors;
if(data10 !== null){
const err34 = {instancePath:instancePath+"/rows/" + i0+"/skill_id",schemaPath:"#/properties/rows/items/properties/skill_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
var _valid0 = _errs22 === errors;
if(_valid0){
valid4 = true;
passing0 = 0;
}
const _errs24 = errors;
if(!(validate72(data10, {instancePath:instancePath+"/rows/" + i0+"/skill_id",parentData:data6,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid0 = _errs24 === errors;
if(_valid0 && valid4){
valid4 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid4 = true;
passing0 = 1;
}
}
if(!valid4){
const err35 = {instancePath:instancePath+"/rows/" + i0+"/skill_id",schemaPath:"#/properties/rows/items/properties/skill_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
else {
errors = _errs21;
if(vErrors !== null){
if(_errs21){
vErrors.length = _errs21;
}
else {
vErrors = null;
}
}
}
}
if(data6.hits !== undefined){
let data11 = data6.hits;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err36 = {instancePath:instancePath+"/rows/" + i0+"/hits",schemaPath:"#/properties/rows/items/properties/hits/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if((typeof data11 == "number") && (isFinite(data11))){
if(data11 < 1 || isNaN(data11)){
const err37 = {instancePath:instancePath+"/rows/" + i0+"/hits",schemaPath:"#/properties/rows/items/properties/hits/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
}
if(data6.years !== undefined){
let data12 = data6.years;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err38 = {instancePath:instancePath+"/rows/" + i0+"/years",schemaPath:"#/properties/rows/items/properties/years/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 < 1 || isNaN(data12)){
const err39 = {instancePath:instancePath+"/rows/" + i0+"/years",schemaPath:"#/properties/rows/items/properties/years/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
}
if(data6.points_text !== undefined){
let data13 = data6.points_text;
if(typeof data13 === "string"){
if(!pattern25.test(data13)){
const err40 = {instancePath:instancePath+"/rows/" + i0+"/points_text",schemaPath:"#/properties/rows/items/properties/points_text/pattern",keyword:"pattern",params:{pattern: "^≈[0-9]+ puan$"},message:"must match pattern \""+"^≈[0-9]+ puan$"+"\""};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
else {
const err41 = {instancePath:instancePath+"/rows/" + i0+"/points_text",schemaPath:"#/properties/rows/items/properties/points_text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
if(data6.evidence_count !== undefined){
let data14 = data6.evidence_count;
if(!(((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14))) && (isFinite(data14)))){
const err42 = {instancePath:instancePath+"/rows/" + i0+"/evidence_count",schemaPath:"#/properties/rows/items/properties/evidence_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if((typeof data14 == "number") && (isFinite(data14))){
if(data14 < 1 || isNaN(data14)){
const err43 = {instancePath:instancePath+"/rows/" + i0+"/evidence_count",schemaPath:"#/properties/rows/items/properties/evidence_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
}
if(data6.evidence_item_ids !== undefined){
let data15 = data6.evidence_item_ids;
if(Array.isArray(data15)){
if(data15.length < 1){
const err44 = {instancePath:instancePath+"/rows/" + i0+"/evidence_item_ids",schemaPath:"#/properties/rows/items/properties/evidence_item_ids/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
const len1 = data15.length;
for(let i1=0; i1<len1; i1++){
if(!(validate83(data15[i1], {instancePath:instancePath+"/rows/" + i0+"/evidence_item_ids/" + i1,parentData:data15,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
}
else {
const err45 = {instancePath:instancePath+"/rows/" + i0+"/evidence_item_ids",schemaPath:"#/properties/rows/items/properties/evidence_item_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
if(data6.syllabus_alignment !== undefined){
let data17 = data6.syllabus_alignment;
if(!(((data17 === "covered_and_asked") || (data17 === "covered_never_asked")) || (data17 === "asked_not_in_syllabus"))){
const err46 = {instancePath:instancePath+"/rows/" + i0+"/syllabus_alignment",schemaPath:"#/properties/rows/items/properties/syllabus_alignment/enum",keyword:"enum",params:{allowedValues: schema62.properties.rows.items.properties.syllabus_alignment.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
if(data6.variant_question_ids !== undefined){
let data18 = data6.variant_question_ids;
if(Array.isArray(data18)){
const len2 = data18.length;
for(let i2=0; i2<len2; i2++){
if(!(validate83(data18[i2], {instancePath:instancePath+"/rows/" + i0+"/variant_question_ids/" + i2,parentData:data18,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
}
else {
const err47 = {instancePath:instancePath+"/rows/" + i0+"/variant_question_ids",schemaPath:"#/properties/rows/items/properties/variant_question_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
}
else {
const err48 = {instancePath:instancePath+"/rows/" + i0,schemaPath:"#/properties/rows/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
}
else {
const err49 = {instancePath:instancePath+"/rows",schemaPath:"#/properties/rows/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data.others !== undefined){
let data20 = data.others;
if(Array.isArray(data20)){
const len3 = data20.length;
for(let i3=0; i3<len3; i3++){
let data21 = data20[i3];
if(typeof data21 === "string"){
if(func1(data21) > 80){
const err50 = {instancePath:instancePath+"/others/" + i3,schemaPath:"#/properties/others/items/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
else {
const err51 = {instancePath:instancePath+"/others/" + i3,schemaPath:"#/properties/others/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
}
else {
const err52 = {instancePath:instancePath+"/others",schemaPath:"#/properties/others/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
if(data.uncovered_topics !== undefined){
let data22 = data.uncovered_topics;
if(Array.isArray(data22)){
const len4 = data22.length;
for(let i4=0; i4<len4; i4++){
if(typeof data22[i4] !== "string"){
const err53 = {instancePath:instancePath+"/uncovered_topics/" + i4,schemaPath:"#/properties/uncovered_topics/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
}
else {
const err54 = {instancePath:instancePath+"/uncovered_topics",schemaPath:"#/properties/uncovered_topics/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
if(data.evidence_count !== undefined){
let data24 = data.evidence_count;
if(!(((typeof data24 == "number") && (!(data24 % 1) && !isNaN(data24))) && (isFinite(data24)))){
const err55 = {instancePath:instancePath+"/evidence_count",schemaPath:"#/properties/evidence_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
if((typeof data24 == "number") && (isFinite(data24))){
if(data24 < 1 || isNaN(data24)){
const err56 = {instancePath:instancePath+"/evidence_count",schemaPath:"#/properties/evidence_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
}
if(data.generated_at !== undefined){
if(!(validate66(data.generated_at, {instancePath:instancePath+"/generated_at",parentData:data,parentDataProperty:"generated_at",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
errors = vErrors.length;
}
}
}
else {
const err57 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
validate146.errors = vErrors;
return errors === 0;
}
validate146.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const figureRenderReport = validate151;
const schema63 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/figure-render-report.json","title":"FigureRenderReport","description":"Şekil denetim raporu (zincir vision_check): PNG + stem_values karşılaştırması {matches_stem, mismatches, notes}; isteğe bağlı olarak render adımının boyut/durum özeti. mismatch → attempts+1 ve 'kodu düzelt' ile yeniden üretim.","x-version":"1.0","type":"object","additionalProperties":false,"required":["matches_stem","mismatches"],"properties":{"schema_version":{"const":"1.0"},"figure_id":{"$ref":"common.json#/$defs/uuid"},"matches_stem":{"type":"boolean","description":"Şekil soru kökündeki değerlerle uyuşuyor mu"},"status":{"enum":["match","mismatch"],"description":"figures.vision_status karşılığı; matches_stem ile tutarlı olmalı"},"mismatches":{"type":"array","maxItems":20,"items":{"oneOf":[{"type":"string","minLength":1,"maxLength":300},{"$ref":"#/$defs/mismatch"}]}},"notes":{"type":["string","null"],"maxLength":600},"render":{"$ref":"#/$defs/render"}},"allOf":[{"if":{"properties":{"matches_stem":{"const":true}},"required":["matches_stem"]},"then":{"properties":{"mismatches":{"maxItems":0},"status":{"const":"match"}}}},{"if":{"properties":{"matches_stem":{"const":false}},"required":["matches_stem"]},"then":{"properties":{"mismatches":{"minItems":1},"status":{"const":"mismatch"}}}}],"$defs":{"mismatch":{"type":"object","additionalProperties":false,"required":["field"],"properties":{"field":{"type":"string","minLength":1,"maxLength":80,"description":"stem_values anahtarı ya da şekil öğesi"},"expected":{"type":["number","string","null"]},"observed":{"type":["number","string","null"]},"note":{"type":"string","maxLength":300}}},"render":{"type":"object","additionalProperties":false,"required":["status"],"properties":{"status":{"enum":["ok","failed","size_mismatch","blank","skipped"]},"tool":{"enum":["matplotlib","svg","tikz","vega-lite","schemdraw","rdkit","graphviz","latex","template"]},"width_px":{"type":"integer","minimum":0},"height_px":{"type":"integer","minimum":0},"bytes":{"type":"integer","minimum":0},"pixel_variance":{"type":"number","minimum":0},"duration_ms":{"type":"integer","minimum":0},"log":{"type":"string","maxLength":4000}}}}};
const schema64 = {"type":"object","additionalProperties":false,"required":["field"],"properties":{"field":{"type":"string","minLength":1,"maxLength":80,"description":"stem_values anahtarı ya da şekil öğesi"},"expected":{"type":["number","string","null"]},"observed":{"type":["number","string","null"]},"note":{"type":"string","maxLength":300}}};

function validate153(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate153.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.field === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "field"},message:"must have required property '"+"field"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "field") || (key0 === "expected")) || (key0 === "observed")) || (key0 === "note"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.field !== undefined){
let data0 = data.field;
if(typeof data0 === "string"){
if(func1(data0) > 80){
const err2 = {instancePath:instancePath+"/field",schemaPath:"#/properties/field/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func1(data0) < 1){
const err3 = {instancePath:instancePath+"/field",schemaPath:"#/properties/field/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/field",schemaPath:"#/properties/field/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.expected !== undefined){
let data1 = data.expected;
if(((!((typeof data1 == "number") && (isFinite(data1)))) && (typeof data1 !== "string")) && (data1 !== null)){
const err5 = {instancePath:instancePath+"/expected",schemaPath:"#/properties/expected/type",keyword:"type",params:{type: schema64.properties.expected.type},message:"must be number,string,null"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.observed !== undefined){
let data2 = data.observed;
if(((!((typeof data2 == "number") && (isFinite(data2)))) && (typeof data2 !== "string")) && (data2 !== null)){
const err6 = {instancePath:instancePath+"/observed",schemaPath:"#/properties/observed/type",keyword:"type",params:{type: schema64.properties.observed.type},message:"must be number,string,null"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.note !== undefined){
let data3 = data.note;
if(typeof data3 === "string"){
if(func1(data3) > 300){
const err7 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate153.errors = vErrors;
return errors === 0;
}
validate153.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema65 = {"type":"object","additionalProperties":false,"required":["status"],"properties":{"status":{"enum":["ok","failed","size_mismatch","blank","skipped"]},"tool":{"enum":["matplotlib","svg","tikz","vega-lite","schemdraw","rdkit","graphviz","latex","template"]},"width_px":{"type":"integer","minimum":0},"height_px":{"type":"integer","minimum":0},"bytes":{"type":"integer","minimum":0},"pixel_variance":{"type":"number","minimum":0},"duration_ms":{"type":"integer","minimum":0},"log":{"type":"string","maxLength":4000}}};

function validate155(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate155.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.status === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "status") || (key0 === "tool")) || (key0 === "width_px")) || (key0 === "height_px")) || (key0 === "bytes")) || (key0 === "pixel_variance")) || (key0 === "duration_ms")) || (key0 === "log"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.status !== undefined){
let data0 = data.status;
if(!(((((data0 === "ok") || (data0 === "failed")) || (data0 === "size_mismatch")) || (data0 === "blank")) || (data0 === "skipped"))){
const err2 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema65.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.tool !== undefined){
let data1 = data.tool;
if(!(((((((((data1 === "matplotlib") || (data1 === "svg")) || (data1 === "tikz")) || (data1 === "vega-lite")) || (data1 === "schemdraw")) || (data1 === "rdkit")) || (data1 === "graphviz")) || (data1 === "latex")) || (data1 === "template"))){
const err3 = {instancePath:instancePath+"/tool",schemaPath:"#/properties/tool/enum",keyword:"enum",params:{allowedValues: schema65.properties.tool.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.width_px !== undefined){
let data2 = data.width_px;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err4 = {instancePath:instancePath+"/width_px",schemaPath:"#/properties/width_px/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err5 = {instancePath:instancePath+"/width_px",schemaPath:"#/properties/width_px/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
if(data.height_px !== undefined){
let data3 = data.height_px;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err6 = {instancePath:instancePath+"/height_px",schemaPath:"#/properties/height_px/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err7 = {instancePath:instancePath+"/height_px",schemaPath:"#/properties/height_px/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.bytes !== undefined){
let data4 = data.bytes;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err8 = {instancePath:instancePath+"/bytes",schemaPath:"#/properties/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 0 || isNaN(data4)){
const err9 = {instancePath:instancePath+"/bytes",schemaPath:"#/properties/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.pixel_variance !== undefined){
let data5 = data.pixel_variance;
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err10 = {instancePath:instancePath+"/pixel_variance",schemaPath:"#/properties/pixel_variance/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/pixel_variance",schemaPath:"#/properties/pixel_variance/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.duration_ms !== undefined){
let data6 = data.duration_ms;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err12 = {instancePath:instancePath+"/duration_ms",schemaPath:"#/properties/duration_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 < 0 || isNaN(data6)){
const err13 = {instancePath:instancePath+"/duration_ms",schemaPath:"#/properties/duration_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
if(data.log !== undefined){
let data7 = data.log;
if(typeof data7 === "string"){
if(func1(data7) > 4000){
const err14 = {instancePath:instancePath+"/log",schemaPath:"#/properties/log/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/log",schemaPath:"#/properties/log/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
validate155.errors = vErrors;
return errors === 0;
}
validate155.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate151(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/figure-render-report.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate151.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.matches_stem === undefined) && (missing0 = "matches_stem")){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
else {
if(data.matches_stem !== undefined){
if(true !== data.matches_stem){
const err1 = {};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.mismatches !== undefined){
let data1 = data.mismatches;
if(Array.isArray(data1)){
if(data1.length > 0){
const err2 = {instancePath:instancePath+"/mismatches",schemaPath:"#/allOf/0/then/properties/mismatches/maxItems",keyword:"maxItems",params:{limit: 0},message:"must NOT have more than 0 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
if(data.status !== undefined){
if("match" !== data.status){
const err3 = {instancePath:instancePath+"/status",schemaPath:"#/allOf/0/then/properties/status/const",keyword:"const",params:{allowedValue: "match"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.mismatches = true;
props0.status = true;
props0.matches_stem = true;
}
}
if(!valid1){
const err4 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
const _errs9 = errors;
let valid4 = true;
const _errs10 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing1;
if((data.matches_stem === undefined) && (missing1 = "matches_stem")){
const err5 = {};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
if(data.matches_stem !== undefined){
if(false !== data.matches_stem){
const err6 = {};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
}
var _valid1 = _errs10 === errors;
errors = _errs9;
if(vErrors !== null){
if(_errs9){
vErrors.length = _errs9;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs12 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.mismatches !== undefined){
let data4 = data.mismatches;
if(Array.isArray(data4)){
if(data4.length < 1){
const err7 = {instancePath:instancePath+"/mismatches",schemaPath:"#/allOf/1/then/properties/mismatches/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.status !== undefined){
if("mismatch" !== data.status){
const err8 = {instancePath:instancePath+"/status",schemaPath:"#/allOf/1/then/properties/status/const",keyword:"const",params:{allowedValue: "mismatch"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
var _valid1 = _errs12 === errors;
valid4 = _valid1;
if(valid4){
var props1 = {};
props1.mismatches = true;
props1.status = true;
props1.matches_stem = true;
}
}
if(!valid4){
const err9 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(props0 !== true && props1 !== undefined){
if(props1 === true){
props0 = true;
}
else {
props0 = props0 || {};
Object.assign(props0, props1);
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.matches_stem === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "matches_stem"},message:"must have required property '"+"matches_stem"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.mismatches === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mismatches"},message:"must have required property '"+"mismatches"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "schema_version") || (key0 === "figure_id")) || (key0 === "matches_stem")) || (key0 === "status")) || (key0 === "mismatches")) || (key0 === "notes")) || (key0 === "render"))){
const err12 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err13 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.figure_id !== undefined){
if(!(validate83(data.figure_id, {instancePath:instancePath+"/figure_id",parentData:data,parentDataProperty:"figure_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.matches_stem !== undefined){
if(typeof data.matches_stem !== "boolean"){
const err14 = {instancePath:instancePath+"/matches_stem",schemaPath:"#/properties/matches_stem/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.status !== undefined){
let data9 = data.status;
if(!((data9 === "match") || (data9 === "mismatch"))){
const err15 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema63.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.mismatches !== undefined){
let data10 = data.mismatches;
if(Array.isArray(data10)){
if(data10.length > 20){
const err16 = {instancePath:instancePath+"/mismatches",schemaPath:"#/properties/mismatches/maxItems",keyword:"maxItems",params:{limit: 20},message:"must NOT have more than 20 items"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
const len0 = data10.length;
for(let i0=0; i0<len0; i0++){
let data11 = data10[i0];
const _errs24 = errors;
let valid10 = false;
let passing0 = null;
const _errs25 = errors;
if(typeof data11 === "string"){
if(func1(data11) > 300){
const err17 = {instancePath:instancePath+"/mismatches/" + i0,schemaPath:"#/properties/mismatches/items/oneOf/0/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(func1(data11) < 1){
const err18 = {instancePath:instancePath+"/mismatches/" + i0,schemaPath:"#/properties/mismatches/items/oneOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/mismatches/" + i0,schemaPath:"#/properties/mismatches/items/oneOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid2 = _errs25 === errors;
if(_valid2){
valid10 = true;
passing0 = 0;
}
const _errs27 = errors;
if(!(validate153(data11, {instancePath:instancePath+"/mismatches/" + i0,parentData:data10,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate153.errors : vErrors.concat(validate153.errors);
errors = vErrors.length;
}
var _valid2 = _errs27 === errors;
if(_valid2 && valid10){
valid10 = false;
passing0 = [passing0, 1];
}
else {
if(_valid2){
valid10 = true;
passing0 = 1;
}
}
if(!valid10){
const err20 = {instancePath:instancePath+"/mismatches/" + i0,schemaPath:"#/properties/mismatches/items/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs24;
if(vErrors !== null){
if(_errs24){
vErrors.length = _errs24;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err21 = {instancePath:instancePath+"/mismatches",schemaPath:"#/properties/mismatches/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.notes !== undefined){
let data12 = data.notes;
if((typeof data12 !== "string") && (data12 !== null)){
const err22 = {instancePath:instancePath+"/notes",schemaPath:"#/properties/notes/type",keyword:"type",params:{type: schema63.properties.notes.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(typeof data12 === "string"){
if(func1(data12) > 600){
const err23 = {instancePath:instancePath+"/notes",schemaPath:"#/properties/notes/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
if(data.render !== undefined){
if(!(validate155(data.render, {instancePath:instancePath+"/render",parentData:data,parentDataProperty:"render",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate155.errors : vErrors.concat(validate155.errors);
errors = vErrors.length;
}
}
}
else {
const err24 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
validate151.errors = vErrors;
return errors === 0;
}
validate151.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const figureRenderReportMismatch = validate157;

function validate157(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate157.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.field === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "field"},message:"must have required property '"+"field"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "field") || (key0 === "expected")) || (key0 === "observed")) || (key0 === "note"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.field !== undefined){
let data0 = data.field;
if(typeof data0 === "string"){
if(func1(data0) > 80){
const err2 = {instancePath:instancePath+"/field",schemaPath:"#/properties/field/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func1(data0) < 1){
const err3 = {instancePath:instancePath+"/field",schemaPath:"#/properties/field/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/field",schemaPath:"#/properties/field/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.expected !== undefined){
let data1 = data.expected;
if(((!((typeof data1 == "number") && (isFinite(data1)))) && (typeof data1 !== "string")) && (data1 !== null)){
const err5 = {instancePath:instancePath+"/expected",schemaPath:"#/properties/expected/type",keyword:"type",params:{type: schema64.properties.expected.type},message:"must be number,string,null"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.observed !== undefined){
let data2 = data.observed;
if(((!((typeof data2 == "number") && (isFinite(data2)))) && (typeof data2 !== "string")) && (data2 !== null)){
const err6 = {instancePath:instancePath+"/observed",schemaPath:"#/properties/observed/type",keyword:"type",params:{type: schema64.properties.observed.type},message:"must be number,string,null"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.note !== undefined){
let data3 = data.note;
if(typeof data3 === "string"){
if(func1(data3) > 300){
const err7 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate157.errors = vErrors;
return errors === 0;
}
validate157.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const figureRenderReportRender = validate158;

function validate158(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate158.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.status === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "status") || (key0 === "tool")) || (key0 === "width_px")) || (key0 === "height_px")) || (key0 === "bytes")) || (key0 === "pixel_variance")) || (key0 === "duration_ms")) || (key0 === "log"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.status !== undefined){
let data0 = data.status;
if(!(((((data0 === "ok") || (data0 === "failed")) || (data0 === "size_mismatch")) || (data0 === "blank")) || (data0 === "skipped"))){
const err2 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema65.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.tool !== undefined){
let data1 = data.tool;
if(!(((((((((data1 === "matplotlib") || (data1 === "svg")) || (data1 === "tikz")) || (data1 === "vega-lite")) || (data1 === "schemdraw")) || (data1 === "rdkit")) || (data1 === "graphviz")) || (data1 === "latex")) || (data1 === "template"))){
const err3 = {instancePath:instancePath+"/tool",schemaPath:"#/properties/tool/enum",keyword:"enum",params:{allowedValues: schema65.properties.tool.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.width_px !== undefined){
let data2 = data.width_px;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err4 = {instancePath:instancePath+"/width_px",schemaPath:"#/properties/width_px/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err5 = {instancePath:instancePath+"/width_px",schemaPath:"#/properties/width_px/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
if(data.height_px !== undefined){
let data3 = data.height_px;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err6 = {instancePath:instancePath+"/height_px",schemaPath:"#/properties/height_px/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err7 = {instancePath:instancePath+"/height_px",schemaPath:"#/properties/height_px/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.bytes !== undefined){
let data4 = data.bytes;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err8 = {instancePath:instancePath+"/bytes",schemaPath:"#/properties/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 0 || isNaN(data4)){
const err9 = {instancePath:instancePath+"/bytes",schemaPath:"#/properties/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.pixel_variance !== undefined){
let data5 = data.pixel_variance;
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err10 = {instancePath:instancePath+"/pixel_variance",schemaPath:"#/properties/pixel_variance/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/pixel_variance",schemaPath:"#/properties/pixel_variance/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.duration_ms !== undefined){
let data6 = data.duration_ms;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err12 = {instancePath:instancePath+"/duration_ms",schemaPath:"#/properties/duration_ms/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 < 0 || isNaN(data6)){
const err13 = {instancePath:instancePath+"/duration_ms",schemaPath:"#/properties/duration_ms/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
if(data.log !== undefined){
let data7 = data.log;
if(typeof data7 === "string"){
if(func1(data7) > 4000){
const err14 = {instancePath:instancePath+"/log",schemaPath:"#/properties/log/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/log",schemaPath:"#/properties/log/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
validate158.errors = vErrors;
return errors === 0;
}
validate158.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const generationRequest = validate159;
const schema68 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/generation-request.json","title":"GenerationRequest","description":"generation_requests satırı (boru hatları arası sözleşme tablosu): yalnız META taşır (kazanım, bant, konu, tür, puan). ocr_text/stem alanı TANIMSIZDIR ve additionalProperties:false olduğundan ham soru metni taşınamaz.","x-version":"1.0","type":"object","additionalProperties":false,"required":["kind","skill_id","difficulty_band"],"properties":{"id":{"$ref":"common.json#/$defs/uuid"},"kind":{"enum":["pool_miss","regenerate","exam_variant"]},"curriculum_id":{"$ref":"common.json#/$defs/uuid"},"skill_id":{"$ref":"common.json#/$defs/skillId"},"difficulty_band":{"enum":["easy","mid","hard"]},"topic":{"type":["string","null"],"maxLength":80,"description":"exam_variant: küme konusu (ham soru metni ASLA)"},"question_kind":{"oneOf":[{"type":"null"},{"enum":["mcq","numeric"]}]},"points":{"type":["number","null"],"minimum":0,"maximum":999.99},"plan_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/uuid"}]},"requested_by":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/uuid"}]},"requested_by_staff":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/uuid"}]},"served_question_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/uuid"}]},"served_at":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/dateTime"}]},"needs_generation":{"type":"boolean"},"created_at":{"$ref":"common.json#/$defs/dateTime"}},"allOf":[{"if":{"properties":{"kind":{"const":"exam_variant"}},"required":["kind"]},"then":{"required":["topic","plan_id"],"properties":{"topic":{"type":"string","minLength":1},"plan_id":{"$ref":"common.json#/$defs/uuid"}}}}]};

function validate159(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/generation-request.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate159.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.kind === undefined) && (missing0 = "kind")){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
else {
if(data.kind !== undefined){
if("exam_variant" !== data.kind){
const err1 = {};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.topic === undefined){
const err2 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "topic"},message:"must have required property '"+"topic"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.plan_id === undefined){
const err3 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "plan_id"},message:"must have required property '"+"plan_id"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.topic !== undefined){
let data1 = data.topic;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err4 = {instancePath:instancePath+"/topic",schemaPath:"#/allOf/0/then/properties/topic/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/topic",schemaPath:"#/allOf/0/then/properties/topic/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.plan_id !== undefined){
if(!(validate83(data.plan_id, {instancePath:instancePath+"/plan_id",parentData:data,parentDataProperty:"plan_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.topic = true;
props0.plan_id = true;
props0.kind = true;
}
}
if(!valid1){
const err6 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.skill_id === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_id"},message:"must have required property '"+"skill_id"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.difficulty_band === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "difficulty_band"},message:"must have required property '"+"difficulty_band"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema68.properties, key0))){
const err10 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.id !== undefined){
if(!(validate83(data.id, {instancePath:instancePath+"/id",parentData:data,parentDataProperty:"id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.kind !== undefined){
let data4 = data.kind;
if(!(((data4 === "pool_miss") || (data4 === "regenerate")) || (data4 === "exam_variant"))){
const err11 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema68.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.curriculum_id !== undefined){
if(!(validate83(data.curriculum_id, {instancePath:instancePath+"/curriculum_id",parentData:data,parentDataProperty:"curriculum_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.skill_id !== undefined){
if(!(validate72(data.skill_id, {instancePath:instancePath+"/skill_id",parentData:data,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data.difficulty_band !== undefined){
let data7 = data.difficulty_band;
if(!(((data7 === "easy") || (data7 === "mid")) || (data7 === "hard"))){
const err12 = {instancePath:instancePath+"/difficulty_band",schemaPath:"#/properties/difficulty_band/enum",keyword:"enum",params:{allowedValues: schema68.properties.difficulty_band.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.topic !== undefined){
let data8 = data.topic;
if((typeof data8 !== "string") && (data8 !== null)){
const err13 = {instancePath:instancePath+"/topic",schemaPath:"#/properties/topic/type",keyword:"type",params:{type: schema68.properties.topic.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(typeof data8 === "string"){
if(func1(data8) > 80){
const err14 = {instancePath:instancePath+"/topic",schemaPath:"#/properties/topic/maxLength",keyword:"maxLength",params:{limit: 80},message:"must NOT have more than 80 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
}
if(data.question_kind !== undefined){
let data9 = data.question_kind;
const _errs18 = errors;
let valid5 = false;
let passing0 = null;
const _errs19 = errors;
if(data9 !== null){
const err15 = {instancePath:instancePath+"/question_kind",schemaPath:"#/properties/question_kind/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
var _valid1 = _errs19 === errors;
if(_valid1){
valid5 = true;
passing0 = 0;
}
const _errs21 = errors;
if(!((data9 === "mcq") || (data9 === "numeric"))){
const err16 = {instancePath:instancePath+"/question_kind",schemaPath:"#/properties/question_kind/oneOf/1/enum",keyword:"enum",params:{allowedValues: schema68.properties.question_kind.oneOf[1].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
var _valid1 = _errs21 === errors;
if(_valid1 && valid5){
valid5 = false;
passing0 = [passing0, 1];
}
else {
if(_valid1){
valid5 = true;
passing0 = 1;
}
}
if(!valid5){
const err17 = {instancePath:instancePath+"/question_kind",schemaPath:"#/properties/question_kind/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
else {
errors = _errs18;
if(vErrors !== null){
if(_errs18){
vErrors.length = _errs18;
}
else {
vErrors = null;
}
}
}
}
if(data.points !== undefined){
let data10 = data.points;
if((!((typeof data10 == "number") && (isFinite(data10)))) && (data10 !== null)){
const err18 = {instancePath:instancePath+"/points",schemaPath:"#/properties/points/type",keyword:"type",params:{type: schema68.properties.points.type},message:"must be number,null"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if((typeof data10 == "number") && (isFinite(data10))){
if(data10 > 999.99 || isNaN(data10)){
const err19 = {instancePath:instancePath+"/points",schemaPath:"#/properties/points/maximum",keyword:"maximum",params:{comparison: "<=", limit: 999.99},message:"must be <= 999.99"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data10 < 0 || isNaN(data10)){
const err20 = {instancePath:instancePath+"/points",schemaPath:"#/properties/points/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
if(data.plan_id !== undefined){
let data11 = data.plan_id;
const _errs25 = errors;
let valid6 = false;
let passing1 = null;
const _errs26 = errors;
if(data11 !== null){
const err21 = {instancePath:instancePath+"/plan_id",schemaPath:"#/properties/plan_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
var _valid2 = _errs26 === errors;
if(_valid2){
valid6 = true;
passing1 = 0;
}
const _errs28 = errors;
if(!(validate83(data11, {instancePath:instancePath+"/plan_id",parentData:data,parentDataProperty:"plan_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
var _valid2 = _errs28 === errors;
if(_valid2 && valid6){
valid6 = false;
passing1 = [passing1, 1];
}
else {
if(_valid2){
valid6 = true;
passing1 = 1;
}
}
if(!valid6){
const err22 = {instancePath:instancePath+"/plan_id",schemaPath:"#/properties/plan_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
else {
errors = _errs25;
if(vErrors !== null){
if(_errs25){
vErrors.length = _errs25;
}
else {
vErrors = null;
}
}
}
}
if(data.requested_by !== undefined){
let data12 = data.requested_by;
const _errs30 = errors;
let valid7 = false;
let passing2 = null;
const _errs31 = errors;
if(data12 !== null){
const err23 = {instancePath:instancePath+"/requested_by",schemaPath:"#/properties/requested_by/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
var _valid3 = _errs31 === errors;
if(_valid3){
valid7 = true;
passing2 = 0;
}
const _errs33 = errors;
if(!(validate83(data12, {instancePath:instancePath+"/requested_by",parentData:data,parentDataProperty:"requested_by",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
var _valid3 = _errs33 === errors;
if(_valid3 && valid7){
valid7 = false;
passing2 = [passing2, 1];
}
else {
if(_valid3){
valid7 = true;
passing2 = 1;
}
}
if(!valid7){
const err24 = {instancePath:instancePath+"/requested_by",schemaPath:"#/properties/requested_by/oneOf",keyword:"oneOf",params:{passingSchemas: passing2},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
else {
errors = _errs30;
if(vErrors !== null){
if(_errs30){
vErrors.length = _errs30;
}
else {
vErrors = null;
}
}
}
}
if(data.requested_by_staff !== undefined){
let data13 = data.requested_by_staff;
const _errs35 = errors;
let valid8 = false;
let passing3 = null;
const _errs36 = errors;
if(data13 !== null){
const err25 = {instancePath:instancePath+"/requested_by_staff",schemaPath:"#/properties/requested_by_staff/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
var _valid4 = _errs36 === errors;
if(_valid4){
valid8 = true;
passing3 = 0;
}
const _errs38 = errors;
if(!(validate83(data13, {instancePath:instancePath+"/requested_by_staff",parentData:data,parentDataProperty:"requested_by_staff",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
var _valid4 = _errs38 === errors;
if(_valid4 && valid8){
valid8 = false;
passing3 = [passing3, 1];
}
else {
if(_valid4){
valid8 = true;
passing3 = 1;
}
}
if(!valid8){
const err26 = {instancePath:instancePath+"/requested_by_staff",schemaPath:"#/properties/requested_by_staff/oneOf",keyword:"oneOf",params:{passingSchemas: passing3},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
else {
errors = _errs35;
if(vErrors !== null){
if(_errs35){
vErrors.length = _errs35;
}
else {
vErrors = null;
}
}
}
}
if(data.served_question_id !== undefined){
let data14 = data.served_question_id;
const _errs40 = errors;
let valid9 = false;
let passing4 = null;
const _errs41 = errors;
if(data14 !== null){
const err27 = {instancePath:instancePath+"/served_question_id",schemaPath:"#/properties/served_question_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
var _valid5 = _errs41 === errors;
if(_valid5){
valid9 = true;
passing4 = 0;
}
const _errs43 = errors;
if(!(validate83(data14, {instancePath:instancePath+"/served_question_id",parentData:data,parentDataProperty:"served_question_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
var _valid5 = _errs43 === errors;
if(_valid5 && valid9){
valid9 = false;
passing4 = [passing4, 1];
}
else {
if(_valid5){
valid9 = true;
passing4 = 1;
}
}
if(!valid9){
const err28 = {instancePath:instancePath+"/served_question_id",schemaPath:"#/properties/served_question_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing4},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
else {
errors = _errs40;
if(vErrors !== null){
if(_errs40){
vErrors.length = _errs40;
}
else {
vErrors = null;
}
}
}
}
if(data.served_at !== undefined){
let data15 = data.served_at;
const _errs45 = errors;
let valid10 = false;
let passing5 = null;
const _errs46 = errors;
if(data15 !== null){
const err29 = {instancePath:instancePath+"/served_at",schemaPath:"#/properties/served_at/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
var _valid6 = _errs46 === errors;
if(_valid6){
valid10 = true;
passing5 = 0;
}
const _errs48 = errors;
if(!(validate66(data15, {instancePath:instancePath+"/served_at",parentData:data,parentDataProperty:"served_at",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
errors = vErrors.length;
}
var _valid6 = _errs48 === errors;
if(_valid6 && valid10){
valid10 = false;
passing5 = [passing5, 1];
}
else {
if(_valid6){
valid10 = true;
passing5 = 1;
}
}
if(!valid10){
const err30 = {instancePath:instancePath+"/served_at",schemaPath:"#/properties/served_at/oneOf",keyword:"oneOf",params:{passingSchemas: passing5},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
else {
errors = _errs45;
if(vErrors !== null){
if(_errs45){
vErrors.length = _errs45;
}
else {
vErrors = null;
}
}
}
}
if(data.needs_generation !== undefined){
if(typeof data.needs_generation !== "boolean"){
const err31 = {instancePath:instancePath+"/needs_generation",schemaPath:"#/properties/needs_generation/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.created_at !== undefined){
if(!(validate66(data.created_at, {instancePath:instancePath+"/created_at",parentData:data,parentDataProperty:"created_at",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
errors = vErrors.length;
}
}
}
else {
const err32 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
validate159.errors = vErrors;
return errors === 0;
}
validate159.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const instructorAlert = validate170;
const schema69 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/instructor-alert.json","title":"InstructorAlert","description":"Eğitmen paneli alarmı (instructor_alerts). Tek cümle, yargısız; şiddet panelde kelimeyle gösterilir.","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","kind","severity","student_ref","detail","since","ref"],"x-forbidden-words":["depresif","tembel","başarısız","umutsuz"],"properties":{"schema_version":{"const":"1.0"},"kind":{"enum":["unanswered","silent","morale","deadline","response","ops"]},"severity":{"enum":["danger","warning","neutral"],"description":"Panelde kelimeyle: Acil / Dikkat / Bilgi"},"student_ref":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/studentRef"}]},"staff_ref":{"type":["string","null"]},"detail":{"type":"string","maxLength":240,"description":"Tek cümle; cevapsız soruda sorunun kendisi tırnak içinde; yargı yok ('göstergesi düştü')"},"since":{"$ref":"common.json#/$defs/dateTime"},"ref":{"type":"object","additionalProperties":false,"properties":{"message_id":{"type":"integer"},"fact_id":{"type":"integer"},"escalation_id":{"$ref":"common.json#/$defs/uuid"},"lesson_id":{"$ref":"common.json#/$defs/uuid"},"chat_id":{"type":"integer","description":"ops alarmları (grup başına tekil)"},"source_id":{"$ref":"common.json#/$defs/uuid","description":"ops: exam_sources OCR hatası"}}}}};

function validate170(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/instructor-alert.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate170.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const forbidden0 = func51(data, ["depresif","tembel","başarısız","umutsuz"]);
if(forbidden0 !== null){
const err0 = {instancePath,schemaPath:"#/x-forbidden-words",keyword:"x-forbidden-words",params:{word: forbidden0},message:"yasaklı kelime içeriyor: "+forbidden0};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.kind === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.severity === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "severity"},message:"must have required property '"+"severity"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.student_ref === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "student_ref"},message:"must have required property '"+"student_ref"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.detail === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "detail"},message:"must have required property '"+"detail"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.since === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "since"},message:"must have required property '"+"since"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.ref === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ref"},message:"must have required property '"+"ref"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "schema_version") || (key0 === "kind")) || (key0 === "severity")) || (key0 === "student_ref")) || (key0 === "staff_ref")) || (key0 === "detail")) || (key0 === "since")) || (key0 === "ref"))){
const err8 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err9 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.kind !== undefined){
let data1 = data.kind;
if(!((((((data1 === "unanswered") || (data1 === "silent")) || (data1 === "morale")) || (data1 === "deadline")) || (data1 === "response")) || (data1 === "ops"))){
const err10 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema69.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.severity !== undefined){
let data2 = data.severity;
if(!(((data2 === "danger") || (data2 === "warning")) || (data2 === "neutral"))){
const err11 = {instancePath:instancePath+"/severity",schemaPath:"#/properties/severity/enum",keyword:"enum",params:{allowedValues: schema69.properties.severity.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.student_ref !== undefined){
let data3 = data.student_ref;
const _errs6 = errors;
let valid1 = false;
let passing0 = null;
const _errs7 = errors;
if(data3 !== null){
const err12 = {instancePath:instancePath+"/student_ref",schemaPath:"#/properties/student_ref/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
var _valid0 = _errs7 === errors;
if(_valid0){
valid1 = true;
passing0 = 0;
}
const _errs9 = errors;
if(!(validate74(data3, {instancePath:instancePath+"/student_ref",parentData:data,parentDataProperty:"student_ref",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors);
errors = vErrors.length;
}
var _valid0 = _errs9 === errors;
if(_valid0 && valid1){
valid1 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid1 = true;
passing0 = 1;
}
}
if(!valid1){
const err13 = {instancePath:instancePath+"/student_ref",schemaPath:"#/properties/student_ref/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
else {
errors = _errs6;
if(vErrors !== null){
if(_errs6){
vErrors.length = _errs6;
}
else {
vErrors = null;
}
}
}
}
if(data.staff_ref !== undefined){
let data4 = data.staff_ref;
if((typeof data4 !== "string") && (data4 !== null)){
const err14 = {instancePath:instancePath+"/staff_ref",schemaPath:"#/properties/staff_ref/type",keyword:"type",params:{type: schema69.properties.staff_ref.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.detail !== undefined){
let data5 = data.detail;
if(typeof data5 === "string"){
if(func1(data5) > 240){
const err15 = {instancePath:instancePath+"/detail",schemaPath:"#/properties/detail/maxLength",keyword:"maxLength",params:{limit: 240},message:"must NOT have more than 240 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/detail",schemaPath:"#/properties/detail/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.since !== undefined){
if(!(validate66(data.since, {instancePath:instancePath+"/since",parentData:data,parentDataProperty:"since",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
errors = vErrors.length;
}
}
if(data.ref !== undefined){
let data7 = data.ref;
if(data7 && typeof data7 == "object" && !Array.isArray(data7)){
for(const key1 in data7){
if(!((((((key1 === "message_id") || (key1 === "fact_id")) || (key1 === "escalation_id")) || (key1 === "lesson_id")) || (key1 === "chat_id")) || (key1 === "source_id"))){
const err17 = {instancePath:instancePath+"/ref",schemaPath:"#/properties/ref/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data7.message_id !== undefined){
let data8 = data7.message_id;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err18 = {instancePath:instancePath+"/ref/message_id",schemaPath:"#/properties/ref/properties/message_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data7.fact_id !== undefined){
let data9 = data7.fact_id;
if(!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))){
const err19 = {instancePath:instancePath+"/ref/fact_id",schemaPath:"#/properties/ref/properties/fact_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data7.escalation_id !== undefined){
if(!(validate83(data7.escalation_id, {instancePath:instancePath+"/ref/escalation_id",parentData:data7,parentDataProperty:"escalation_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data7.lesson_id !== undefined){
if(!(validate83(data7.lesson_id, {instancePath:instancePath+"/ref/lesson_id",parentData:data7,parentDataProperty:"lesson_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data7.chat_id !== undefined){
let data12 = data7.chat_id;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err20 = {instancePath:instancePath+"/ref/chat_id",schemaPath:"#/properties/ref/properties/chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data7.source_id !== undefined){
if(!(validate83(data7.source_id, {instancePath:instancePath+"/ref/source_id",parentData:data7,parentDataProperty:"source_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
}
else {
const err21 = {instancePath:instancePath+"/ref",schemaPath:"#/properties/ref/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
else {
const err22 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
validate170.errors = vErrors;
return errors === 0;
}
validate170.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const lessonAnalysis = validate176;
const schema70 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/lesson-analysis.json","title":"LessonAnalysis","description":"Ders videosu analizi (güçlü model, şema zorunlu). Her kazanım iddiası zaman damgalı alıntıyla gelir; adlar yerine ÖĞRENCİ/EĞİTMEN etiketi.","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","lesson_ref","student_ref","skills","questions","hesitations","misconceptions","commitments","talk","previous_profile_check","next_step","model_notes"],"properties":{"schema_version":{"const":"1.0"},"lesson_ref":{"$ref":"common.json#/$defs/uuid"},"student_ref":{"$ref":"common.json#/$defs/studentRef"},"duration_min":{"type":"integer","minimum":1},"skills":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["skill_id","mastery_estimate","confidence","evidence"],"properties":{"skill_id":{"$ref":"common.json#/$defs/skillId"},"mastery_estimate":{"$ref":"common.json#/$defs/probability"},"confidence":{"$ref":"common.json#/$defs/probability"},"evidence":{"type":"array","minItems":1,"maxItems":5,"items":{"$ref":"common.json#/$defs/timedQuote"},"description":"Kanıtsız kazanım geçersiz"}}}},"questions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["t","quote"],"properties":{"t":{"$ref":"common.json#/$defs/ts"},"quote":{"type":"string","maxLength":300},"skill_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}]},"answered":{"type":"boolean"}}}},"hesitations":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["t","kind"],"properties":{"t":{"$ref":"common.json#/$defs/ts"},"kind":{"enum":["said_dont_understand","long_silence","wrong_answer","asked_repeat"]},"quote":{"type":"string","maxLength":300},"skill_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}]}}}},"misconceptions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["text_instructor","text_student","skill_id","evidence"],"properties":{"tag":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/tag"}],"description":"Katalogdaki etiket; yoksa null ve metin serbest"},"skill_id":{"$ref":"common.json#/$defs/skillId"},"text_instructor":{"type":"string","maxLength":200},"text_student":{"type":"string","maxLength":200},"resolved_in_lesson":{"type":"boolean"},"evidence":{"type":"array","minItems":1,"items":{"$ref":"common.json#/$defs/timedQuote"}}}}},"commitments":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["who","kind","text","t"],"properties":{"who":{"$ref":"common.json#/$defs/speaker"},"kind":{"enum":["homework","promise","deadline"]},"text":{"type":"string","maxLength":300},"due":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/date"}]},"t":{"$ref":"common.json#/$defs/ts"}}}},"talk":{"type":"object","additionalProperties":false,"required":["student_ratio","student_questions","attention","morale"],"properties":{"student_ratio":{"$ref":"common.json#/$defs/probability"},"student_questions":{"type":"integer","minimum":0},"attention":{"enum":["low","medium","high"]},"morale":{"enum":["low","medium","high","unknown"]},"notes":{"type":"string","maxLength":300}}},"previous_profile_check":{"type":"array","description":"seed_profile'daki açık yanılgılar için","items":{"type":"object","additionalProperties":false,"required":["misconception_id","status"],"properties":{"misconception_id":{"$ref":"common.json#/$defs/uuid"},"status":{"enum":["still_present","improved","not_observed"]},"evidence":{"type":"array","items":{"$ref":"common.json#/$defs/timedQuote"}}}}},"next_step":{"type":"object","additionalProperties":false,"required":["for_student","for_instructor"],"properties":{"for_student":{"type":"string","maxLength":400},"for_instructor":{"type":"string","maxLength":400}}},"model_notes":{"type":"object","additionalProperties":false,"required":["model","prompt_version","cost_usd","tokens_in","tokens_out"],"properties":{"model":{"type":"string"},"prompt_version":{"type":"string"},"cost_usd":{"$ref":"common.json#/$defs/usd"},"tokens_in":{"type":"integer"},"tokens_out":{"type":"integer"},"frames":{"type":"integer"}}}}};

function validate176(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/lesson-analysis.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate176.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.lesson_ref === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "lesson_ref"},message:"must have required property '"+"lesson_ref"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.student_ref === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "student_ref"},message:"must have required property '"+"student_ref"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.skills === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skills"},message:"must have required property '"+"skills"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.questions === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "questions"},message:"must have required property '"+"questions"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.hesitations === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "hesitations"},message:"must have required property '"+"hesitations"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.misconceptions === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "misconceptions"},message:"must have required property '"+"misconceptions"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.commitments === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "commitments"},message:"must have required property '"+"commitments"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.talk === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "talk"},message:"must have required property '"+"talk"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.previous_profile_check === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "previous_profile_check"},message:"must have required property '"+"previous_profile_check"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.next_step === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "next_step"},message:"must have required property '"+"next_step"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.model_notes === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "model_notes"},message:"must have required property '"+"model_notes"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema70.properties, key0))){
const err12 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err13 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.lesson_ref !== undefined){
if(!(validate83(data.lesson_ref, {instancePath:instancePath+"/lesson_ref",parentData:data,parentDataProperty:"lesson_ref",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.student_ref !== undefined){
if(!(validate74(data.student_ref, {instancePath:instancePath+"/student_ref",parentData:data,parentDataProperty:"student_ref",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors);
errors = vErrors.length;
}
}
if(data.duration_min !== undefined){
let data3 = data.duration_min;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err14 = {instancePath:instancePath+"/duration_min",schemaPath:"#/properties/duration_min/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 1 || isNaN(data3)){
const err15 = {instancePath:instancePath+"/duration_min",schemaPath:"#/properties/duration_min/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
if(data.skills !== undefined){
let data4 = data.skills;
if(Array.isArray(data4)){
const len0 = data4.length;
for(let i0=0; i0<len0; i0++){
let data5 = data4[i0];
if(data5 && typeof data5 == "object" && !Array.isArray(data5)){
if(data5.skill_id === undefined){
const err16 = {instancePath:instancePath+"/skills/" + i0,schemaPath:"#/properties/skills/items/required",keyword:"required",params:{missingProperty: "skill_id"},message:"must have required property '"+"skill_id"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data5.mastery_estimate === undefined){
const err17 = {instancePath:instancePath+"/skills/" + i0,schemaPath:"#/properties/skills/items/required",keyword:"required",params:{missingProperty: "mastery_estimate"},message:"must have required property '"+"mastery_estimate"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data5.confidence === undefined){
const err18 = {instancePath:instancePath+"/skills/" + i0,schemaPath:"#/properties/skills/items/required",keyword:"required",params:{missingProperty: "confidence"},message:"must have required property '"+"confidence"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data5.evidence === undefined){
const err19 = {instancePath:instancePath+"/skills/" + i0,schemaPath:"#/properties/skills/items/required",keyword:"required",params:{missingProperty: "evidence"},message:"must have required property '"+"evidence"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
for(const key1 in data5){
if(!((((key1 === "skill_id") || (key1 === "mastery_estimate")) || (key1 === "confidence")) || (key1 === "evidence"))){
const err20 = {instancePath:instancePath+"/skills/" + i0,schemaPath:"#/properties/skills/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data5.skill_id !== undefined){
if(!(validate72(data5.skill_id, {instancePath:instancePath+"/skills/" + i0+"/skill_id",parentData:data5,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data5.mastery_estimate !== undefined){
if(!(validate69(data5.mastery_estimate, {instancePath:instancePath+"/skills/" + i0+"/mastery_estimate",parentData:data5,parentDataProperty:"mastery_estimate",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data5.confidence !== undefined){
if(!(validate69(data5.confidence, {instancePath:instancePath+"/skills/" + i0+"/confidence",parentData:data5,parentDataProperty:"confidence",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data5.evidence !== undefined){
let data9 = data5.evidence;
if(Array.isArray(data9)){
if(data9.length > 5){
const err21 = {instancePath:instancePath+"/skills/" + i0+"/evidence",schemaPath:"#/properties/skills/items/properties/evidence/maxItems",keyword:"maxItems",params:{limit: 5},message:"must NOT have more than 5 items"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data9.length < 1){
const err22 = {instancePath:instancePath+"/skills/" + i0+"/evidence",schemaPath:"#/properties/skills/items/properties/evidence/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
const len1 = data9.length;
for(let i1=0; i1<len1; i1++){
if(!(validate76(data9[i1], {instancePath:instancePath+"/skills/" + i0+"/evidence/" + i1,parentData:data9,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate76.errors : vErrors.concat(validate76.errors);
errors = vErrors.length;
}
}
}
else {
const err23 = {instancePath:instancePath+"/skills/" + i0+"/evidence",schemaPath:"#/properties/skills/items/properties/evidence/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
else {
const err24 = {instancePath:instancePath+"/skills/" + i0,schemaPath:"#/properties/skills/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath:instancePath+"/skills",schemaPath:"#/properties/skills/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.questions !== undefined){
let data11 = data.questions;
if(Array.isArray(data11)){
const len2 = data11.length;
for(let i2=0; i2<len2; i2++){
let data12 = data11[i2];
if(data12 && typeof data12 == "object" && !Array.isArray(data12)){
if(data12.t === undefined){
const err26 = {instancePath:instancePath+"/questions/" + i2,schemaPath:"#/properties/questions/items/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data12.quote === undefined){
const err27 = {instancePath:instancePath+"/questions/" + i2,schemaPath:"#/properties/questions/items/required",keyword:"required",params:{missingProperty: "quote"},message:"must have required property '"+"quote"+"'"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
for(const key2 in data12){
if(!((((key2 === "t") || (key2 === "quote")) || (key2 === "skill_id")) || (key2 === "answered"))){
const err28 = {instancePath:instancePath+"/questions/" + i2,schemaPath:"#/properties/questions/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data12.t !== undefined){
if(!(validate81(data12.t, {instancePath:instancePath+"/questions/" + i2+"/t",parentData:data12,parentDataProperty:"t",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
}
if(data12.quote !== undefined){
let data14 = data12.quote;
if(typeof data14 === "string"){
if(func1(data14) > 300){
const err29 = {instancePath:instancePath+"/questions/" + i2+"/quote",schemaPath:"#/properties/questions/items/properties/quote/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/questions/" + i2+"/quote",schemaPath:"#/properties/questions/items/properties/quote/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data12.skill_id !== undefined){
let data15 = data12.skill_id;
const _errs27 = errors;
let valid9 = false;
let passing0 = null;
const _errs28 = errors;
if(data15 !== null){
const err31 = {instancePath:instancePath+"/questions/" + i2+"/skill_id",schemaPath:"#/properties/questions/items/properties/skill_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
var _valid0 = _errs28 === errors;
if(_valid0){
valid9 = true;
passing0 = 0;
}
const _errs30 = errors;
if(!(validate72(data15, {instancePath:instancePath+"/questions/" + i2+"/skill_id",parentData:data12,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid0 = _errs30 === errors;
if(_valid0 && valid9){
valid9 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid9 = true;
passing0 = 1;
}
}
if(!valid9){
const err32 = {instancePath:instancePath+"/questions/" + i2+"/skill_id",schemaPath:"#/properties/questions/items/properties/skill_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
else {
errors = _errs27;
if(vErrors !== null){
if(_errs27){
vErrors.length = _errs27;
}
else {
vErrors = null;
}
}
}
}
if(data12.answered !== undefined){
if(typeof data12.answered !== "boolean"){
const err33 = {instancePath:instancePath+"/questions/" + i2+"/answered",schemaPath:"#/properties/questions/items/properties/answered/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
else {
const err34 = {instancePath:instancePath+"/questions/" + i2,schemaPath:"#/properties/questions/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
}
else {
const err35 = {instancePath:instancePath+"/questions",schemaPath:"#/properties/questions/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data.hesitations !== undefined){
let data17 = data.hesitations;
if(Array.isArray(data17)){
const len3 = data17.length;
for(let i3=0; i3<len3; i3++){
let data18 = data17[i3];
if(data18 && typeof data18 == "object" && !Array.isArray(data18)){
if(data18.t === undefined){
const err36 = {instancePath:instancePath+"/hesitations/" + i3,schemaPath:"#/properties/hesitations/items/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(data18.kind === undefined){
const err37 = {instancePath:instancePath+"/hesitations/" + i3,schemaPath:"#/properties/hesitations/items/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
for(const key3 in data18){
if(!((((key3 === "t") || (key3 === "kind")) || (key3 === "quote")) || (key3 === "skill_id"))){
const err38 = {instancePath:instancePath+"/hesitations/" + i3,schemaPath:"#/properties/hesitations/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data18.t !== undefined){
if(!(validate81(data18.t, {instancePath:instancePath+"/hesitations/" + i3+"/t",parentData:data18,parentDataProperty:"t",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
}
if(data18.kind !== undefined){
let data20 = data18.kind;
if(!((((data20 === "said_dont_understand") || (data20 === "long_silence")) || (data20 === "wrong_answer")) || (data20 === "asked_repeat"))){
const err39 = {instancePath:instancePath+"/hesitations/" + i3+"/kind",schemaPath:"#/properties/hesitations/items/properties/kind/enum",keyword:"enum",params:{allowedValues: schema70.properties.hesitations.items.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
if(data18.quote !== undefined){
let data21 = data18.quote;
if(typeof data21 === "string"){
if(func1(data21) > 300){
const err40 = {instancePath:instancePath+"/hesitations/" + i3+"/quote",schemaPath:"#/properties/hesitations/items/properties/quote/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
else {
const err41 = {instancePath:instancePath+"/hesitations/" + i3+"/quote",schemaPath:"#/properties/hesitations/items/properties/quote/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
if(data18.skill_id !== undefined){
let data22 = data18.skill_id;
const _errs43 = errors;
let valid13 = false;
let passing1 = null;
const _errs44 = errors;
if(data22 !== null){
const err42 = {instancePath:instancePath+"/hesitations/" + i3+"/skill_id",schemaPath:"#/properties/hesitations/items/properties/skill_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
var _valid1 = _errs44 === errors;
if(_valid1){
valid13 = true;
passing1 = 0;
}
const _errs46 = errors;
if(!(validate72(data22, {instancePath:instancePath+"/hesitations/" + i3+"/skill_id",parentData:data18,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid1 = _errs46 === errors;
if(_valid1 && valid13){
valid13 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid13 = true;
passing1 = 1;
}
}
if(!valid13){
const err43 = {instancePath:instancePath+"/hesitations/" + i3+"/skill_id",schemaPath:"#/properties/hesitations/items/properties/skill_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
else {
errors = _errs43;
if(vErrors !== null){
if(_errs43){
vErrors.length = _errs43;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err44 = {instancePath:instancePath+"/hesitations/" + i3,schemaPath:"#/properties/hesitations/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
}
else {
const err45 = {instancePath:instancePath+"/hesitations",schemaPath:"#/properties/hesitations/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
if(data.misconceptions !== undefined){
let data23 = data.misconceptions;
if(Array.isArray(data23)){
const len4 = data23.length;
for(let i4=0; i4<len4; i4++){
let data24 = data23[i4];
if(data24 && typeof data24 == "object" && !Array.isArray(data24)){
if(data24.text_instructor === undefined){
const err46 = {instancePath:instancePath+"/misconceptions/" + i4,schemaPath:"#/properties/misconceptions/items/required",keyword:"required",params:{missingProperty: "text_instructor"},message:"must have required property '"+"text_instructor"+"'"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(data24.text_student === undefined){
const err47 = {instancePath:instancePath+"/misconceptions/" + i4,schemaPath:"#/properties/misconceptions/items/required",keyword:"required",params:{missingProperty: "text_student"},message:"must have required property '"+"text_student"+"'"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if(data24.skill_id === undefined){
const err48 = {instancePath:instancePath+"/misconceptions/" + i4,schemaPath:"#/properties/misconceptions/items/required",keyword:"required",params:{missingProperty: "skill_id"},message:"must have required property '"+"skill_id"+"'"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
if(data24.evidence === undefined){
const err49 = {instancePath:instancePath+"/misconceptions/" + i4,schemaPath:"#/properties/misconceptions/items/required",keyword:"required",params:{missingProperty: "evidence"},message:"must have required property '"+"evidence"+"'"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
for(const key4 in data24){
if(!((((((key4 === "tag") || (key4 === "skill_id")) || (key4 === "text_instructor")) || (key4 === "text_student")) || (key4 === "resolved_in_lesson")) || (key4 === "evidence"))){
const err50 = {instancePath:instancePath+"/misconceptions/" + i4,schemaPath:"#/properties/misconceptions/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
if(data24.tag !== undefined){
let data25 = data24.tag;
const _errs53 = errors;
let valid17 = false;
let passing2 = null;
const _errs54 = errors;
if(data25 !== null){
const err51 = {instancePath:instancePath+"/misconceptions/" + i4+"/tag",schemaPath:"#/properties/misconceptions/items/properties/tag/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
var _valid2 = _errs54 === errors;
if(_valid2){
valid17 = true;
passing2 = 0;
}
const _errs56 = errors;
if(!(validate75(data25, {instancePath:instancePath+"/misconceptions/" + i4+"/tag",parentData:data24,parentDataProperty:"tag",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
errors = vErrors.length;
}
var _valid2 = _errs56 === errors;
if(_valid2 && valid17){
valid17 = false;
passing2 = [passing2, 1];
}
else {
if(_valid2){
valid17 = true;
passing2 = 1;
}
}
if(!valid17){
const err52 = {instancePath:instancePath+"/misconceptions/" + i4+"/tag",schemaPath:"#/properties/misconceptions/items/properties/tag/oneOf",keyword:"oneOf",params:{passingSchemas: passing2},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
else {
errors = _errs53;
if(vErrors !== null){
if(_errs53){
vErrors.length = _errs53;
}
else {
vErrors = null;
}
}
}
}
if(data24.skill_id !== undefined){
if(!(validate72(data24.skill_id, {instancePath:instancePath+"/misconceptions/" + i4+"/skill_id",parentData:data24,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data24.text_instructor !== undefined){
let data27 = data24.text_instructor;
if(typeof data27 === "string"){
if(func1(data27) > 200){
const err53 = {instancePath:instancePath+"/misconceptions/" + i4+"/text_instructor",schemaPath:"#/properties/misconceptions/items/properties/text_instructor/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
else {
const err54 = {instancePath:instancePath+"/misconceptions/" + i4+"/text_instructor",schemaPath:"#/properties/misconceptions/items/properties/text_instructor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
if(data24.text_student !== undefined){
let data28 = data24.text_student;
if(typeof data28 === "string"){
if(func1(data28) > 200){
const err55 = {instancePath:instancePath+"/misconceptions/" + i4+"/text_student",schemaPath:"#/properties/misconceptions/items/properties/text_student/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
else {
const err56 = {instancePath:instancePath+"/misconceptions/" + i4+"/text_student",schemaPath:"#/properties/misconceptions/items/properties/text_student/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
if(data24.resolved_in_lesson !== undefined){
if(typeof data24.resolved_in_lesson !== "boolean"){
const err57 = {instancePath:instancePath+"/misconceptions/" + i4+"/resolved_in_lesson",schemaPath:"#/properties/misconceptions/items/properties/resolved_in_lesson/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
if(data24.evidence !== undefined){
let data30 = data24.evidence;
if(Array.isArray(data30)){
if(data30.length < 1){
const err58 = {instancePath:instancePath+"/misconceptions/" + i4+"/evidence",schemaPath:"#/properties/misconceptions/items/properties/evidence/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
const len5 = data30.length;
for(let i5=0; i5<len5; i5++){
if(!(validate76(data30[i5], {instancePath:instancePath+"/misconceptions/" + i4+"/evidence/" + i5,parentData:data30,parentDataProperty:i5,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate76.errors : vErrors.concat(validate76.errors);
errors = vErrors.length;
}
}
}
else {
const err59 = {instancePath:instancePath+"/misconceptions/" + i4+"/evidence",schemaPath:"#/properties/misconceptions/items/properties/evidence/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
}
}
else {
const err60 = {instancePath:instancePath+"/misconceptions/" + i4,schemaPath:"#/properties/misconceptions/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
}
}
else {
const err61 = {instancePath:instancePath+"/misconceptions",schemaPath:"#/properties/misconceptions/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
}
if(data.commitments !== undefined){
let data32 = data.commitments;
if(Array.isArray(data32)){
const len6 = data32.length;
for(let i6=0; i6<len6; i6++){
let data33 = data32[i6];
if(data33 && typeof data33 == "object" && !Array.isArray(data33)){
if(data33.who === undefined){
const err62 = {instancePath:instancePath+"/commitments/" + i6,schemaPath:"#/properties/commitments/items/required",keyword:"required",params:{missingProperty: "who"},message:"must have required property '"+"who"+"'"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
if(data33.kind === undefined){
const err63 = {instancePath:instancePath+"/commitments/" + i6,schemaPath:"#/properties/commitments/items/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
if(data33.text === undefined){
const err64 = {instancePath:instancePath+"/commitments/" + i6,schemaPath:"#/properties/commitments/items/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
if(data33.t === undefined){
const err65 = {instancePath:instancePath+"/commitments/" + i6,schemaPath:"#/properties/commitments/items/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
for(const key5 in data33){
if(!(((((key5 === "who") || (key5 === "kind")) || (key5 === "text")) || (key5 === "due")) || (key5 === "t"))){
const err66 = {instancePath:instancePath+"/commitments/" + i6,schemaPath:"#/properties/commitments/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
if(data33.who !== undefined){
if(!(validate73(data33.who, {instancePath:instancePath+"/commitments/" + i6+"/who",parentData:data33,parentDataProperty:"who",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate73.errors : vErrors.concat(validate73.errors);
errors = vErrors.length;
}
}
if(data33.kind !== undefined){
let data35 = data33.kind;
if(!(((data35 === "homework") || (data35 === "promise")) || (data35 === "deadline"))){
const err67 = {instancePath:instancePath+"/commitments/" + i6+"/kind",schemaPath:"#/properties/commitments/items/properties/kind/enum",keyword:"enum",params:{allowedValues: schema70.properties.commitments.items.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
if(data33.text !== undefined){
let data36 = data33.text;
if(typeof data36 === "string"){
if(func1(data36) > 300){
const err68 = {instancePath:instancePath+"/commitments/" + i6+"/text",schemaPath:"#/properties/commitments/items/properties/text/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
}
else {
const err69 = {instancePath:instancePath+"/commitments/" + i6+"/text",schemaPath:"#/properties/commitments/items/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
}
if(data33.due !== undefined){
let data37 = data33.due;
const _errs77 = errors;
let valid23 = false;
let passing3 = null;
const _errs78 = errors;
if(data37 !== null){
const err70 = {instancePath:instancePath+"/commitments/" + i6+"/due",schemaPath:"#/properties/commitments/items/properties/due/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
var _valid3 = _errs78 === errors;
if(_valid3){
valid23 = true;
passing3 = 0;
}
const _errs80 = errors;
if(!(validate65(data37, {instancePath:instancePath+"/commitments/" + i6+"/due",parentData:data33,parentDataProperty:"due",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate65.errors : vErrors.concat(validate65.errors);
errors = vErrors.length;
}
var _valid3 = _errs80 === errors;
if(_valid3 && valid23){
valid23 = false;
passing3 = [passing3, 1];
}
else {
if(_valid3){
valid23 = true;
passing3 = 1;
}
}
if(!valid23){
const err71 = {instancePath:instancePath+"/commitments/" + i6+"/due",schemaPath:"#/properties/commitments/items/properties/due/oneOf",keyword:"oneOf",params:{passingSchemas: passing3},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
else {
errors = _errs77;
if(vErrors !== null){
if(_errs77){
vErrors.length = _errs77;
}
else {
vErrors = null;
}
}
}
}
if(data33.t !== undefined){
if(!(validate81(data33.t, {instancePath:instancePath+"/commitments/" + i6+"/t",parentData:data33,parentDataProperty:"t",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
}
}
else {
const err72 = {instancePath:instancePath+"/commitments/" + i6,schemaPath:"#/properties/commitments/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
}
}
else {
const err73 = {instancePath:instancePath+"/commitments",schemaPath:"#/properties/commitments/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
}
if(data.talk !== undefined){
let data39 = data.talk;
if(data39 && typeof data39 == "object" && !Array.isArray(data39)){
if(data39.student_ratio === undefined){
const err74 = {instancePath:instancePath+"/talk",schemaPath:"#/properties/talk/required",keyword:"required",params:{missingProperty: "student_ratio"},message:"must have required property '"+"student_ratio"+"'"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
if(data39.student_questions === undefined){
const err75 = {instancePath:instancePath+"/talk",schemaPath:"#/properties/talk/required",keyword:"required",params:{missingProperty: "student_questions"},message:"must have required property '"+"student_questions"+"'"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
if(data39.attention === undefined){
const err76 = {instancePath:instancePath+"/talk",schemaPath:"#/properties/talk/required",keyword:"required",params:{missingProperty: "attention"},message:"must have required property '"+"attention"+"'"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
if(data39.morale === undefined){
const err77 = {instancePath:instancePath+"/talk",schemaPath:"#/properties/talk/required",keyword:"required",params:{missingProperty: "morale"},message:"must have required property '"+"morale"+"'"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
for(const key6 in data39){
if(!(((((key6 === "student_ratio") || (key6 === "student_questions")) || (key6 === "attention")) || (key6 === "morale")) || (key6 === "notes"))){
const err78 = {instancePath:instancePath+"/talk",schemaPath:"#/properties/talk/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key6},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
}
if(data39.student_ratio !== undefined){
if(!(validate69(data39.student_ratio, {instancePath:instancePath+"/talk/student_ratio",parentData:data39,parentDataProperty:"student_ratio",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data39.student_questions !== undefined){
let data41 = data39.student_questions;
if(!(((typeof data41 == "number") && (!(data41 % 1) && !isNaN(data41))) && (isFinite(data41)))){
const err79 = {instancePath:instancePath+"/talk/student_questions",schemaPath:"#/properties/talk/properties/student_questions/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
if((typeof data41 == "number") && (isFinite(data41))){
if(data41 < 0 || isNaN(data41)){
const err80 = {instancePath:instancePath+"/talk/student_questions",schemaPath:"#/properties/talk/properties/student_questions/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
}
}
if(data39.attention !== undefined){
let data42 = data39.attention;
if(!(((data42 === "low") || (data42 === "medium")) || (data42 === "high"))){
const err81 = {instancePath:instancePath+"/talk/attention",schemaPath:"#/properties/talk/properties/attention/enum",keyword:"enum",params:{allowedValues: schema70.properties.talk.properties.attention.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
}
if(data39.morale !== undefined){
let data43 = data39.morale;
if(!((((data43 === "low") || (data43 === "medium")) || (data43 === "high")) || (data43 === "unknown"))){
const err82 = {instancePath:instancePath+"/talk/morale",schemaPath:"#/properties/talk/properties/morale/enum",keyword:"enum",params:{allowedValues: schema70.properties.talk.properties.morale.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
}
if(data39.notes !== undefined){
let data44 = data39.notes;
if(typeof data44 === "string"){
if(func1(data44) > 300){
const err83 = {instancePath:instancePath+"/talk/notes",schemaPath:"#/properties/talk/properties/notes/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
}
else {
const err84 = {instancePath:instancePath+"/talk/notes",schemaPath:"#/properties/talk/properties/notes/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
}
}
else {
const err85 = {instancePath:instancePath+"/talk",schemaPath:"#/properties/talk/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
}
if(data.previous_profile_check !== undefined){
let data45 = data.previous_profile_check;
if(Array.isArray(data45)){
const len7 = data45.length;
for(let i7=0; i7<len7; i7++){
let data46 = data45[i7];
if(data46 && typeof data46 == "object" && !Array.isArray(data46)){
if(data46.misconception_id === undefined){
const err86 = {instancePath:instancePath+"/previous_profile_check/" + i7,schemaPath:"#/properties/previous_profile_check/items/required",keyword:"required",params:{missingProperty: "misconception_id"},message:"must have required property '"+"misconception_id"+"'"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
if(data46.status === undefined){
const err87 = {instancePath:instancePath+"/previous_profile_check/" + i7,schemaPath:"#/properties/previous_profile_check/items/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
for(const key7 in data46){
if(!(((key7 === "misconception_id") || (key7 === "status")) || (key7 === "evidence"))){
const err88 = {instancePath:instancePath+"/previous_profile_check/" + i7,schemaPath:"#/properties/previous_profile_check/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key7},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
}
if(data46.misconception_id !== undefined){
if(!(validate83(data46.misconception_id, {instancePath:instancePath+"/previous_profile_check/" + i7+"/misconception_id",parentData:data46,parentDataProperty:"misconception_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data46.status !== undefined){
let data48 = data46.status;
if(!(((data48 === "still_present") || (data48 === "improved")) || (data48 === "not_observed"))){
const err89 = {instancePath:instancePath+"/previous_profile_check/" + i7+"/status",schemaPath:"#/properties/previous_profile_check/items/properties/status/enum",keyword:"enum",params:{allowedValues: schema70.properties.previous_profile_check.items.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
}
if(data46.evidence !== undefined){
let data49 = data46.evidence;
if(Array.isArray(data49)){
const len8 = data49.length;
for(let i8=0; i8<len8; i8++){
if(!(validate76(data49[i8], {instancePath:instancePath+"/previous_profile_check/" + i7+"/evidence/" + i8,parentData:data49,parentDataProperty:i8,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate76.errors : vErrors.concat(validate76.errors);
errors = vErrors.length;
}
}
}
else {
const err90 = {instancePath:instancePath+"/previous_profile_check/" + i7+"/evidence",schemaPath:"#/properties/previous_profile_check/items/properties/evidence/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
}
}
else {
const err91 = {instancePath:instancePath+"/previous_profile_check/" + i7,schemaPath:"#/properties/previous_profile_check/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
}
}
else {
const err92 = {instancePath:instancePath+"/previous_profile_check",schemaPath:"#/properties/previous_profile_check/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
}
if(data.next_step !== undefined){
let data51 = data.next_step;
if(data51 && typeof data51 == "object" && !Array.isArray(data51)){
if(data51.for_student === undefined){
const err93 = {instancePath:instancePath+"/next_step",schemaPath:"#/properties/next_step/required",keyword:"required",params:{missingProperty: "for_student"},message:"must have required property '"+"for_student"+"'"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
if(data51.for_instructor === undefined){
const err94 = {instancePath:instancePath+"/next_step",schemaPath:"#/properties/next_step/required",keyword:"required",params:{missingProperty: "for_instructor"},message:"must have required property '"+"for_instructor"+"'"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
for(const key8 in data51){
if(!((key8 === "for_student") || (key8 === "for_instructor"))){
const err95 = {instancePath:instancePath+"/next_step",schemaPath:"#/properties/next_step/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key8},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
}
if(data51.for_student !== undefined){
let data52 = data51.for_student;
if(typeof data52 === "string"){
if(func1(data52) > 400){
const err96 = {instancePath:instancePath+"/next_step/for_student",schemaPath:"#/properties/next_step/properties/for_student/maxLength",keyword:"maxLength",params:{limit: 400},message:"must NOT have more than 400 characters"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
}
else {
const err97 = {instancePath:instancePath+"/next_step/for_student",schemaPath:"#/properties/next_step/properties/for_student/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
}
if(data51.for_instructor !== undefined){
let data53 = data51.for_instructor;
if(typeof data53 === "string"){
if(func1(data53) > 400){
const err98 = {instancePath:instancePath+"/next_step/for_instructor",schemaPath:"#/properties/next_step/properties/for_instructor/maxLength",keyword:"maxLength",params:{limit: 400},message:"must NOT have more than 400 characters"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
}
else {
const err99 = {instancePath:instancePath+"/next_step/for_instructor",schemaPath:"#/properties/next_step/properties/for_instructor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
}
}
else {
const err100 = {instancePath:instancePath+"/next_step",schemaPath:"#/properties/next_step/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
}
if(data.model_notes !== undefined){
let data54 = data.model_notes;
if(data54 && typeof data54 == "object" && !Array.isArray(data54)){
if(data54.model === undefined){
const err101 = {instancePath:instancePath+"/model_notes",schemaPath:"#/properties/model_notes/required",keyword:"required",params:{missingProperty: "model"},message:"must have required property '"+"model"+"'"};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
if(data54.prompt_version === undefined){
const err102 = {instancePath:instancePath+"/model_notes",schemaPath:"#/properties/model_notes/required",keyword:"required",params:{missingProperty: "prompt_version"},message:"must have required property '"+"prompt_version"+"'"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
if(data54.cost_usd === undefined){
const err103 = {instancePath:instancePath+"/model_notes",schemaPath:"#/properties/model_notes/required",keyword:"required",params:{missingProperty: "cost_usd"},message:"must have required property '"+"cost_usd"+"'"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
if(data54.tokens_in === undefined){
const err104 = {instancePath:instancePath+"/model_notes",schemaPath:"#/properties/model_notes/required",keyword:"required",params:{missingProperty: "tokens_in"},message:"must have required property '"+"tokens_in"+"'"};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
if(data54.tokens_out === undefined){
const err105 = {instancePath:instancePath+"/model_notes",schemaPath:"#/properties/model_notes/required",keyword:"required",params:{missingProperty: "tokens_out"},message:"must have required property '"+"tokens_out"+"'"};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
for(const key9 in data54){
if(!((((((key9 === "model") || (key9 === "prompt_version")) || (key9 === "cost_usd")) || (key9 === "tokens_in")) || (key9 === "tokens_out")) || (key9 === "frames"))){
const err106 = {instancePath:instancePath+"/model_notes",schemaPath:"#/properties/model_notes/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key9},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
}
if(data54.model !== undefined){
if(typeof data54.model !== "string"){
const err107 = {instancePath:instancePath+"/model_notes/model",schemaPath:"#/properties/model_notes/properties/model/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
}
}
if(data54.prompt_version !== undefined){
if(typeof data54.prompt_version !== "string"){
const err108 = {instancePath:instancePath+"/model_notes/prompt_version",schemaPath:"#/properties/model_notes/properties/prompt_version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
}
if(data54.cost_usd !== undefined){
if(!(validate82(data54.cost_usd, {instancePath:instancePath+"/model_notes/cost_usd",parentData:data54,parentDataProperty:"cost_usd",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
errors = vErrors.length;
}
}
if(data54.tokens_in !== undefined){
let data58 = data54.tokens_in;
if(!(((typeof data58 == "number") && (!(data58 % 1) && !isNaN(data58))) && (isFinite(data58)))){
const err109 = {instancePath:instancePath+"/model_notes/tokens_in",schemaPath:"#/properties/model_notes/properties/tokens_in/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
}
if(data54.tokens_out !== undefined){
let data59 = data54.tokens_out;
if(!(((typeof data59 == "number") && (!(data59 % 1) && !isNaN(data59))) && (isFinite(data59)))){
const err110 = {instancePath:instancePath+"/model_notes/tokens_out",schemaPath:"#/properties/model_notes/properties/tokens_out/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
}
if(data54.frames !== undefined){
let data60 = data54.frames;
if(!(((typeof data60 == "number") && (!(data60 % 1) && !isNaN(data60))) && (isFinite(data60)))){
const err111 = {instancePath:instancePath+"/model_notes/frames",schemaPath:"#/properties/model_notes/properties/frames/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
}
}
}
else {
const err112 = {instancePath:instancePath+"/model_notes",schemaPath:"#/properties/model_notes/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err112];
}
else {
vErrors.push(err112);
}
errors++;
}
}
}
else {
const err113 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err113];
}
else {
vErrors.push(err113);
}
errors++;
}
validate176.errors = vErrors;
return errors === 0;
}
validate176.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const memoryFact = validate197;
const schema71 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/memory-fact.json","title":"MemoryFact","description":"Gece olgu çıkarımının tek olgusu (memory_facts satırı). Kaynak mesaj numarası zorunlu; ad içermez.","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","student_ref","kind","text","source_message_ids","confidence","requires_approval"],"properties":{"schema_version":{"const":"1.0"},"student_ref":{"$ref":"common.json#/$defs/studentRef"},"kind":{"enum":["promise","deadline","unanswered_question","morale","topic_asked","preference","instructor_fact","other"]},"text":{"type":"string","minLength":8,"maxLength":300,"description":"İsim yok; 'öğrenci' veya 'eğitmen' der; üçüncü tekil"},"source_message_ids":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"integer"},"description":"messages.id — kaynak zorunlu; günün mesajları arasında olmalı (pipeline doğrular)"},"confidence":{"$ref":"common.json#/$defs/probability"},"valid_until":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/date"}]},"morale_signal":{"type":["integer","null"],"minimum":-2,"maximum":2},"requires_approval":{"type":"boolean","description":"not/devamsızlık/puan/ödeme içeriyorsa true; bot approved olmadan kullanmaz"},"skill_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}]}},"allOf":[{"if":{"properties":{"kind":{"const":"instructor_fact"}}},"then":{"properties":{"requires_approval":{"const":true}}}}]};

function validate197(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/memory-fact.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate197.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("instructor_fact" !== data.kind){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.requires_approval !== undefined){
if(true !== data.requires_approval){
const err1 = {instancePath:instancePath+"/requires_approval",schemaPath:"#/allOf/0/then/properties/requires_approval/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.requires_approval = true;
props0.kind = true;
}
}
if(!valid1){
const err2 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.student_ref === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "student_ref"},message:"must have required property '"+"student_ref"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.kind === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.text === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.source_message_ids === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source_message_ids"},message:"must have required property '"+"source_message_ids"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.confidence === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "confidence"},message:"must have required property '"+"confidence"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.requires_approval === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requires_approval"},message:"must have required property '"+"requires_approval"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema71.properties, key0))){
const err10 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err11 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.student_ref !== undefined){
if(!(validate74(data.student_ref, {instancePath:instancePath+"/student_ref",parentData:data,parentDataProperty:"student_ref",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors);
errors = vErrors.length;
}
}
if(data.kind !== undefined){
let data4 = data.kind;
if(!((((((((data4 === "promise") || (data4 === "deadline")) || (data4 === "unanswered_question")) || (data4 === "morale")) || (data4 === "topic_asked")) || (data4 === "preference")) || (data4 === "instructor_fact")) || (data4 === "other"))){
const err12 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema71.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.text !== undefined){
let data5 = data.text;
if(typeof data5 === "string"){
if(func1(data5) > 300){
const err13 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/maxLength",keyword:"maxLength",params:{limit: 300},message:"must NOT have more than 300 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func1(data5) < 8){
const err14 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/minLength",keyword:"minLength",params:{limit: 8},message:"must NOT have fewer than 8 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.source_message_ids !== undefined){
let data6 = data.source_message_ids;
if(Array.isArray(data6)){
if(data6.length > 8){
const err16 = {instancePath:instancePath+"/source_message_ids",schemaPath:"#/properties/source_message_ids/maxItems",keyword:"maxItems",params:{limit: 8},message:"must NOT have more than 8 items"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data6.length < 1){
const err17 = {instancePath:instancePath+"/source_message_ids",schemaPath:"#/properties/source_message_ids/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
const len0 = data6.length;
for(let i0=0; i0<len0; i0++){
let data7 = data6[i0];
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err18 = {instancePath:instancePath+"/source_message_ids/" + i0,schemaPath:"#/properties/source_message_ids/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
else {
const err19 = {instancePath:instancePath+"/source_message_ids",schemaPath:"#/properties/source_message_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.confidence !== undefined){
if(!(validate69(data.confidence, {instancePath:instancePath+"/confidence",parentData:data,parentDataProperty:"confidence",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data.valid_until !== undefined){
let data9 = data.valid_until;
const _errs19 = errors;
let valid7 = false;
let passing0 = null;
const _errs20 = errors;
if(data9 !== null){
const err20 = {instancePath:instancePath+"/valid_until",schemaPath:"#/properties/valid_until/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
var _valid1 = _errs20 === errors;
if(_valid1){
valid7 = true;
passing0 = 0;
}
const _errs22 = errors;
if(!(validate65(data9, {instancePath:instancePath+"/valid_until",parentData:data,parentDataProperty:"valid_until",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate65.errors : vErrors.concat(validate65.errors);
errors = vErrors.length;
}
var _valid1 = _errs22 === errors;
if(_valid1 && valid7){
valid7 = false;
passing0 = [passing0, 1];
}
else {
if(_valid1){
valid7 = true;
passing0 = 1;
}
}
if(!valid7){
const err21 = {instancePath:instancePath+"/valid_until",schemaPath:"#/properties/valid_until/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
else {
errors = _errs19;
if(vErrors !== null){
if(_errs19){
vErrors.length = _errs19;
}
else {
vErrors = null;
}
}
}
}
if(data.morale_signal !== undefined){
let data10 = data.morale_signal;
if((!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))) && (data10 !== null)){
const err22 = {instancePath:instancePath+"/morale_signal",schemaPath:"#/properties/morale_signal/type",keyword:"type",params:{type: schema71.properties.morale_signal.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if((typeof data10 == "number") && (isFinite(data10))){
if(data10 > 2 || isNaN(data10)){
const err23 = {instancePath:instancePath+"/morale_signal",schemaPath:"#/properties/morale_signal/maximum",keyword:"maximum",params:{comparison: "<=", limit: 2},message:"must be <= 2"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data10 < -2 || isNaN(data10)){
const err24 = {instancePath:instancePath+"/morale_signal",schemaPath:"#/properties/morale_signal/minimum",keyword:"minimum",params:{comparison: ">=", limit: -2},message:"must be >= -2"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
if(data.requires_approval !== undefined){
if(typeof data.requires_approval !== "boolean"){
const err25 = {instancePath:instancePath+"/requires_approval",schemaPath:"#/properties/requires_approval/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.skill_id !== undefined){
let data12 = data.skill_id;
const _errs28 = errors;
let valid8 = false;
let passing1 = null;
const _errs29 = errors;
if(data12 !== null){
const err26 = {instancePath:instancePath+"/skill_id",schemaPath:"#/properties/skill_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
var _valid2 = _errs29 === errors;
if(_valid2){
valid8 = true;
passing1 = 0;
}
const _errs31 = errors;
if(!(validate72(data12, {instancePath:instancePath+"/skill_id",parentData:data,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid2 = _errs31 === errors;
if(_valid2 && valid8){
valid8 = false;
passing1 = [passing1, 1];
}
else {
if(_valid2){
valid8 = true;
passing1 = 1;
}
}
if(!valid8){
const err27 = {instancePath:instancePath+"/skill_id",schemaPath:"#/properties/skill_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
else {
errors = _errs28;
if(vErrors !== null){
if(_errs28){
vErrors.length = _errs28;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err28 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
validate197.errors = vErrors;
return errors === 0;
}
validate197.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const misconceptionTags = validate202;
const schema72 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/misconception-tags.json","title":"MisconceptionTags","description":"Yanılgı etiketi kataloğu (misconception-tags.json): dizi; her etiket eğitmen metni (üçüncü tekil) ve öğrenci metni (sen dili, ünlemsiz) taşır. skill_id null olan etiketler yalnız genel.* önekli olabilir.","x-version":"1.0","type":"array","minItems":1,"items":{"$ref":"#/$defs/tag"},"$defs":{"tag":{"type":"object","additionalProperties":false,"required":["tag","skill_id","prereq_skill_id","text_instructor","text_student"],"properties":{"tag":{"$ref":"common.json#/$defs/tag"},"skill_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}],"description":"null = çok kazanımlı genel etiket (genel.*)"},"prereq_skill_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}],"description":"'Asıl sorun alt konuda' çıkarımı için ön koşul"},"text_instructor":{"type":"string","minLength":5,"maxLength":200,"pattern":"^[^!☀-➿⭐-⭕️🀀-🫿]*$","description":"Üçüncü tekil, ünlemsiz, emojisiz (desen ! ve emoji aralıklarını reddeder)"},"text_student":{"type":"string","minLength":5,"maxLength":200,"pattern":"^[^!☀-➿⭐-⭕️🀀-🫿]*$","description":"Sen dili, ünlemsiz, emojisiz (desen ! ve emoji aralıklarını reddeder)"}},"allOf":[{"if":{"properties":{"skill_id":{"type":"null"}},"required":["skill_id"]},"then":{"properties":{"tag":{"pattern":"^genel\\."}}}}]}}};
const schema73 = {"type":"object","additionalProperties":false,"required":["tag","skill_id","prereq_skill_id","text_instructor","text_student"],"properties":{"tag":{"$ref":"common.json#/$defs/tag"},"skill_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}],"description":"null = çok kazanımlı genel etiket (genel.*)"},"prereq_skill_id":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/skillId"}],"description":"'Asıl sorun alt konuda' çıkarımı için ön koşul"},"text_instructor":{"type":"string","minLength":5,"maxLength":200,"pattern":"^[^!☀-➿⭐-⭕️🀀-🫿]*$","description":"Üçüncü tekil, ünlemsiz, emojisiz (desen ! ve emoji aralıklarını reddeder)"},"text_student":{"type":"string","minLength":5,"maxLength":200,"pattern":"^[^!☀-➿⭐-⭕️🀀-🫿]*$","description":"Sen dili, ünlemsiz, emojisiz (desen ! ve emoji aralıklarını reddeder)"}},"allOf":[{"if":{"properties":{"skill_id":{"type":"null"}},"required":["skill_id"]},"then":{"properties":{"tag":{"pattern":"^genel\\."}}}}]};
const pattern26 = new RegExp("^genel\\.", "u");
const pattern27 = new RegExp("^[^!☀-➿⭐-⭕️🀀-🫿]*$", "u");

function validate203(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate203.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.skill_id === undefined) && (missing0 = "skill_id")){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
else {
if(data.skill_id !== undefined){
if(data.skill_id !== null){
const err1 = {};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs6 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.tag !== undefined){
let data1 = data.tag;
if(typeof data1 === "string"){
if(!pattern26.test(data1)){
const err2 = {instancePath:instancePath+"/tag",schemaPath:"#/allOf/0/then/properties/tag/pattern",keyword:"pattern",params:{pattern: "^genel\\."},message:"must match pattern \""+"^genel\\."+"\""};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
}
var _valid0 = _errs6 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.tag = true;
props0.skill_id = true;
}
}
if(!valid1){
const err3 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.tag === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tag"},message:"must have required property '"+"tag"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.skill_id === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_id"},message:"must have required property '"+"skill_id"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.prereq_skill_id === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "prereq_skill_id"},message:"must have required property '"+"prereq_skill_id"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.text_instructor === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text_instructor"},message:"must have required property '"+"text_instructor"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.text_student === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text_student"},message:"must have required property '"+"text_student"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "tag") || (key0 === "skill_id")) || (key0 === "prereq_skill_id")) || (key0 === "text_instructor")) || (key0 === "text_student"))){
const err9 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.tag !== undefined){
if(!(validate75(data.tag, {instancePath:instancePath+"/tag",parentData:data,parentDataProperty:"tag",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
errors = vErrors.length;
}
}
if(data.skill_id !== undefined){
let data3 = data.skill_id;
const _errs11 = errors;
let valid5 = false;
let passing0 = null;
const _errs12 = errors;
if(data3 !== null){
const err10 = {instancePath:instancePath+"/skill_id",schemaPath:"#/properties/skill_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
var _valid1 = _errs12 === errors;
if(_valid1){
valid5 = true;
passing0 = 0;
}
const _errs14 = errors;
if(!(validate72(data3, {instancePath:instancePath+"/skill_id",parentData:data,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid1 = _errs14 === errors;
if(_valid1 && valid5){
valid5 = false;
passing0 = [passing0, 1];
}
else {
if(_valid1){
valid5 = true;
passing0 = 1;
}
}
if(!valid5){
const err11 = {instancePath:instancePath+"/skill_id",schemaPath:"#/properties/skill_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
else {
errors = _errs11;
if(vErrors !== null){
if(_errs11){
vErrors.length = _errs11;
}
else {
vErrors = null;
}
}
}
}
if(data.prereq_skill_id !== undefined){
let data4 = data.prereq_skill_id;
const _errs16 = errors;
let valid6 = false;
let passing1 = null;
const _errs17 = errors;
if(data4 !== null){
const err12 = {instancePath:instancePath+"/prereq_skill_id",schemaPath:"#/properties/prereq_skill_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
var _valid2 = _errs17 === errors;
if(_valid2){
valid6 = true;
passing1 = 0;
}
const _errs19 = errors;
if(!(validate72(data4, {instancePath:instancePath+"/prereq_skill_id",parentData:data,parentDataProperty:"prereq_skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid2 = _errs19 === errors;
if(_valid2 && valid6){
valid6 = false;
passing1 = [passing1, 1];
}
else {
if(_valid2){
valid6 = true;
passing1 = 1;
}
}
if(!valid6){
const err13 = {instancePath:instancePath+"/prereq_skill_id",schemaPath:"#/properties/prereq_skill_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
else {
errors = _errs16;
if(vErrors !== null){
if(_errs16){
vErrors.length = _errs16;
}
else {
vErrors = null;
}
}
}
}
if(data.text_instructor !== undefined){
let data5 = data.text_instructor;
if(typeof data5 === "string"){
if(func1(data5) > 200){
const err14 = {instancePath:instancePath+"/text_instructor",schemaPath:"#/properties/text_instructor/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func1(data5) < 5){
const err15 = {instancePath:instancePath+"/text_instructor",schemaPath:"#/properties/text_instructor/minLength",keyword:"minLength",params:{limit: 5},message:"must NOT have fewer than 5 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!pattern27.test(data5)){
const err16 = {instancePath:instancePath+"/text_instructor",schemaPath:"#/properties/text_instructor/pattern",keyword:"pattern",params:{pattern: "^[^!☀-➿⭐-⭕️🀀-🫿]*$"},message:"must match pattern \""+"^[^!☀-➿⭐-⭕️🀀-🫿]*$"+"\""};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/text_instructor",schemaPath:"#/properties/text_instructor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.text_student !== undefined){
let data6 = data.text_student;
if(typeof data6 === "string"){
if(func1(data6) > 200){
const err18 = {instancePath:instancePath+"/text_student",schemaPath:"#/properties/text_student/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(func1(data6) < 5){
const err19 = {instancePath:instancePath+"/text_student",schemaPath:"#/properties/text_student/minLength",keyword:"minLength",params:{limit: 5},message:"must NOT have fewer than 5 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(!pattern27.test(data6)){
const err20 = {instancePath:instancePath+"/text_student",schemaPath:"#/properties/text_student/pattern",keyword:"pattern",params:{pattern: "^[^!☀-➿⭐-⭕️🀀-🫿]*$"},message:"must match pattern \""+"^[^!☀-➿⭐-⭕️🀀-🫿]*$"+"\""};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/text_student",schemaPath:"#/properties/text_student/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
else {
const err22 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
validate203.errors = vErrors;
return errors === 0;
}
validate203.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate202(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/misconception-tags.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate202.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(Array.isArray(data)){
if(data.length < 1){
const err0 = {instancePath,schemaPath:"#/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
const len0 = data.length;
for(let i0=0; i0<len0; i0++){
if(!(validate203(data[i0], {instancePath:instancePath+"/" + i0,parentData:data,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate203.errors : vErrors.concat(validate203.errors);
errors = vErrors.length;
}
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate202.errors = vErrors;
return errors === 0;
}
validate202.evaluated = {"items":true,"dynamicProps":false,"dynamicItems":false};

export const misconceptionTagsTag = validate208;

function validate208(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate208.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.skill_id === undefined) && (missing0 = "skill_id")){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
else {
if(data.skill_id !== undefined){
if(data.skill_id !== null){
const err1 = {};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs6 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.tag !== undefined){
let data1 = data.tag;
if(typeof data1 === "string"){
if(!pattern26.test(data1)){
const err2 = {instancePath:instancePath+"/tag",schemaPath:"#/allOf/0/then/properties/tag/pattern",keyword:"pattern",params:{pattern: "^genel\\."},message:"must match pattern \""+"^genel\\."+"\""};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
}
var _valid0 = _errs6 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.tag = true;
props0.skill_id = true;
}
}
if(!valid1){
const err3 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.tag === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tag"},message:"must have required property '"+"tag"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.skill_id === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_id"},message:"must have required property '"+"skill_id"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.prereq_skill_id === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "prereq_skill_id"},message:"must have required property '"+"prereq_skill_id"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.text_instructor === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text_instructor"},message:"must have required property '"+"text_instructor"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.text_student === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text_student"},message:"must have required property '"+"text_student"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "tag") || (key0 === "skill_id")) || (key0 === "prereq_skill_id")) || (key0 === "text_instructor")) || (key0 === "text_student"))){
const err9 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.tag !== undefined){
if(!(validate75(data.tag, {instancePath:instancePath+"/tag",parentData:data,parentDataProperty:"tag",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
errors = vErrors.length;
}
}
if(data.skill_id !== undefined){
let data3 = data.skill_id;
const _errs11 = errors;
let valid5 = false;
let passing0 = null;
const _errs12 = errors;
if(data3 !== null){
const err10 = {instancePath:instancePath+"/skill_id",schemaPath:"#/properties/skill_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
var _valid1 = _errs12 === errors;
if(_valid1){
valid5 = true;
passing0 = 0;
}
const _errs14 = errors;
if(!(validate72(data3, {instancePath:instancePath+"/skill_id",parentData:data,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid1 = _errs14 === errors;
if(_valid1 && valid5){
valid5 = false;
passing0 = [passing0, 1];
}
else {
if(_valid1){
valid5 = true;
passing0 = 1;
}
}
if(!valid5){
const err11 = {instancePath:instancePath+"/skill_id",schemaPath:"#/properties/skill_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
else {
errors = _errs11;
if(vErrors !== null){
if(_errs11){
vErrors.length = _errs11;
}
else {
vErrors = null;
}
}
}
}
if(data.prereq_skill_id !== undefined){
let data4 = data.prereq_skill_id;
const _errs16 = errors;
let valid6 = false;
let passing1 = null;
const _errs17 = errors;
if(data4 !== null){
const err12 = {instancePath:instancePath+"/prereq_skill_id",schemaPath:"#/properties/prereq_skill_id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
var _valid2 = _errs17 === errors;
if(_valid2){
valid6 = true;
passing1 = 0;
}
const _errs19 = errors;
if(!(validate72(data4, {instancePath:instancePath+"/prereq_skill_id",parentData:data,parentDataProperty:"prereq_skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
var _valid2 = _errs19 === errors;
if(_valid2 && valid6){
valid6 = false;
passing1 = [passing1, 1];
}
else {
if(_valid2){
valid6 = true;
passing1 = 1;
}
}
if(!valid6){
const err13 = {instancePath:instancePath+"/prereq_skill_id",schemaPath:"#/properties/prereq_skill_id/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
else {
errors = _errs16;
if(vErrors !== null){
if(_errs16){
vErrors.length = _errs16;
}
else {
vErrors = null;
}
}
}
}
if(data.text_instructor !== undefined){
let data5 = data.text_instructor;
if(typeof data5 === "string"){
if(func1(data5) > 200){
const err14 = {instancePath:instancePath+"/text_instructor",schemaPath:"#/properties/text_instructor/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func1(data5) < 5){
const err15 = {instancePath:instancePath+"/text_instructor",schemaPath:"#/properties/text_instructor/minLength",keyword:"minLength",params:{limit: 5},message:"must NOT have fewer than 5 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!pattern27.test(data5)){
const err16 = {instancePath:instancePath+"/text_instructor",schemaPath:"#/properties/text_instructor/pattern",keyword:"pattern",params:{pattern: "^[^!☀-➿⭐-⭕️🀀-🫿]*$"},message:"must match pattern \""+"^[^!☀-➿⭐-⭕️🀀-🫿]*$"+"\""};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/text_instructor",schemaPath:"#/properties/text_instructor/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.text_student !== undefined){
let data6 = data.text_student;
if(typeof data6 === "string"){
if(func1(data6) > 200){
const err18 = {instancePath:instancePath+"/text_student",schemaPath:"#/properties/text_student/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(func1(data6) < 5){
const err19 = {instancePath:instancePath+"/text_student",schemaPath:"#/properties/text_student/minLength",keyword:"minLength",params:{limit: 5},message:"must NOT have fewer than 5 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(!pattern27.test(data6)){
const err20 = {instancePath:instancePath+"/text_student",schemaPath:"#/properties/text_student/pattern",keyword:"pattern",params:{pattern: "^[^!☀-➿⭐-⭕️🀀-🫿]*$"},message:"must match pattern \""+"^[^!☀-➿⭐-⭕️🀀-🫿]*$"+"\""};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/text_student",schemaPath:"#/properties/text_student/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
else {
const err22 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
validate208.errors = vErrors;
return errors === 0;
}
validate208.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const models = validate212;
const schema75 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/models.json","title":"ModelsConfig","description":"Sağlayıcı, model, fiyat, limit ve zincir tablosu (models.json; tek kaynak, verified_at zorunlu). Kod model adı içermez, zincir adı kullanır. Ücretsiz Gemini katmanı trains_on_data=true beyan etmek zorundadır (aydınlatma metni bunu yazar).","x-version":"1.0","type":"object","additionalProperties":false,"required":["verified_at","currency","providers","models","chains","cost_rules"],"properties":{"$schema":{"type":"string"},"verified_at":{"$ref":"common.json#/$defs/date"},"currency":{"const":"USD"},"note":{"type":"string"},"providers":{"type":"object","minProperties":1,"propertyNames":{"pattern":"^[a-z][a-z0-9-]*$"},"additionalProperties":{"$ref":"#/$defs/provider"}},"models":{"type":"object","minProperties":1,"additionalProperties":{"$ref":"#/$defs/model"}},"chains":{"type":"object","additionalProperties":false,"required":["chat","chat_free_only","nightly_facts","weekly_summary","question_gen","vision_check","ocr","lesson_analysis","transcribe","diarize","query_expand","research","embedding"],"properties":{"chat":{"$ref":"#/$defs/chain"},"chat_free_only":{"$ref":"#/$defs/chain"},"nightly_facts":{"$ref":"#/$defs/chain"},"weekly_summary":{"$ref":"#/$defs/chain"},"question_gen":{"$ref":"#/$defs/chain"},"vision_check":{"$ref":"#/$defs/chain"},"ocr":{"$ref":"#/$defs/chain"},"lesson_analysis":{"$ref":"#/$defs/chain"},"transcribe":{"$ref":"#/$defs/chain"},"diarize":{"$ref":"#/$defs/chain"},"query_expand":{"$ref":"#/$defs/chain"},"research":{"$ref":"#/$defs/chain"},"embedding":{"$ref":"#/$defs/chain"}}},"cost_rules":{"type":"object","additionalProperties":false,"required":["chat_budget_tokens_in","chat_turn_max_usd","chat_target_usd"],"properties":{"chat_budget_tokens_in":{"type":"integer","minimum":1},"chat_turn_max_usd":{"$ref":"common.json#/$defs/usd"},"chat_target_usd":{"$ref":"common.json#/$defs/usd"}}}},"$defs":{"provider":{"type":"object","additionalProperties":false,"required":["kind","tier"],"properties":{"kind":{"enum":["gemini","openai-compatible","workers-ai","anthropic","fake"]},"base":{"type":"string","format":"uri"},"rest_base":{"type":"string","pattern":"^https://"},"binding":{"type":"string","pattern":"^[A-Z][A-Z0-9_]*$"},"key_env":{"type":"string","pattern":"^[A-Z][A-Z0-9_]*$"},"tier":{"enum":["free","paid"]},"rpd":{"type":"integer","minimum":0},"neurons_per_day":{"type":"integer","minimum":0},"trains_on_data":{"type":"boolean","description":"Gönderilen veri sağlayıcının ürün eğitiminde kullanılabilir mi"},"enabled":{"type":"boolean"}},"allOf":[{"if":{"properties":{"kind":{"const":"gemini"}},"required":["kind"]},"then":{"required":["trains_on_data","base","key_env"]}},{"if":{"properties":{"kind":{"const":"gemini"},"tier":{"const":"free"}},"required":["kind","tier"]},"then":{"properties":{"trains_on_data":{"const":true}}}},{"if":{"properties":{"kind":{"enum":["openai-compatible","anthropic"]}},"required":["kind"]},"then":{"required":["base","key_env"]}},{"if":{"properties":{"kind":{"const":"workers-ai"}},"required":["kind"]},"then":{"required":["binding","rest_base"]}}]},"model":{"type":"object","additionalProperties":false,"required":["provider"],"properties":{"provider":{"type":"string","pattern":"^[a-z][a-z0-9-]*$"},"in_per_m":{"type":"number","minimum":0,"description":"1M giriş token başına USD"},"out_per_m":{"type":"number","minimum":0,"description":"1M çıkış token başına USD"},"batch_discount":{"type":"number","exclusiveMinimum":0,"maximum":1},"ctx":{"type":"integer","minimum":1},"structured":{"type":"boolean"},"vision":{"type":"boolean"},"audio":{"type":"boolean"},"dims":{"type":"integer","minimum":1},"use":{"type":"array","minItems":1,"items":{"enum":["chat","nightly_facts","weekly_summary","question_gen","vision_check","ocr","lesson_analysis","transcribe","diarize","research","embedding","query_expand","tts"]}},"per_audio_hour":{"type":"number","minimum":0},"neurons_per_1k_tokens":{"type":"number","minimum":0},"enabled":{"type":"boolean"}},"anyOf":[{"required":["in_per_m","out_per_m"]},{"required":["per_audio_hour"]}]},"chain":{"type":"array","minItems":1,"items":{"type":"string","minLength":1},"description":"Denenme sırasıyla model adları (models anahtarları)"}}};
const schema76 = {"type":"object","additionalProperties":false,"required":["kind","tier"],"properties":{"kind":{"enum":["gemini","openai-compatible","workers-ai","anthropic","fake"]},"base":{"type":"string","format":"uri"},"rest_base":{"type":"string","pattern":"^https://"},"binding":{"type":"string","pattern":"^[A-Z][A-Z0-9_]*$"},"key_env":{"type":"string","pattern":"^[A-Z][A-Z0-9_]*$"},"tier":{"enum":["free","paid"]},"rpd":{"type":"integer","minimum":0},"neurons_per_day":{"type":"integer","minimum":0},"trains_on_data":{"type":"boolean","description":"Gönderilen veri sağlayıcının ürün eğitiminde kullanılabilir mi"},"enabled":{"type":"boolean"}},"allOf":[{"if":{"properties":{"kind":{"const":"gemini"}},"required":["kind"]},"then":{"required":["trains_on_data","base","key_env"]}},{"if":{"properties":{"kind":{"const":"gemini"},"tier":{"const":"free"}},"required":["kind","tier"]},"then":{"properties":{"trains_on_data":{"const":true}}}},{"if":{"properties":{"kind":{"enum":["openai-compatible","anthropic"]}},"required":["kind"]},"then":{"required":["base","key_env"]}},{"if":{"properties":{"kind":{"const":"workers-ai"}},"required":["kind"]},"then":{"required":["binding","rest_base"]}}]};
const formats8 = ogrFormats.uri;
const pattern33 = new RegExp("^https://", "u");
const pattern34 = new RegExp("^[A-Z][A-Z0-9_]*$", "u");

function validate214(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate214.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.kind === undefined) && (missing0 = "kind")){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
else {
if(data.kind !== undefined){
if("gemini" !== data.kind){
const err1 = {};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.trains_on_data === undefined){
const err2 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "trains_on_data"},message:"must have required property '"+"trains_on_data"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.base === undefined){
const err3 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "base"},message:"must have required property '"+"base"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.key_env === undefined){
const err4 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "key_env"},message:"must have required property '"+"key_env"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
}
if(!valid1){
const err5 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const _errs7 = errors;
let valid3 = true;
const _errs8 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing1;
if(((data.kind === undefined) && (missing1 = "kind")) || ((data.tier === undefined) && (missing1 = "tier"))){
const err6 = {};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
else {
if(data.kind !== undefined){
const _errs9 = errors;
if("gemini" !== data.kind){
const err7 = {};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
var valid4 = _errs9 === errors;
}
else {
var valid4 = true;
}
if(valid4){
if(data.tier !== undefined){
const _errs10 = errors;
if("free" !== data.tier){
const err8 = {};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
var valid4 = _errs10 === errors;
}
else {
var valid4 = true;
}
}
}
}
var _valid1 = _errs8 === errors;
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs11 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.trains_on_data !== undefined){
if(true !== data.trains_on_data){
const err9 = {instancePath:instancePath+"/trains_on_data",schemaPath:"#/allOf/1/then/properties/trains_on_data/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
var _valid1 = _errs11 === errors;
valid3 = _valid1;
if(valid3){
var props0 = {};
props0.trains_on_data = true;
props0.kind = true;
props0.tier = true;
}
}
if(!valid3){
const err10 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.kind = true;
}
const _errs14 = errors;
let valid6 = true;
const _errs15 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing2;
if((data.kind === undefined) && (missing2 = "kind")){
const err11 = {};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
else {
if(data.kind !== undefined){
let data4 = data.kind;
if(!((data4 === "openai-compatible") || (data4 === "anthropic"))){
const err12 = {};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
}
var _valid2 = _errs15 === errors;
errors = _errs14;
if(vErrors !== null){
if(_errs14){
vErrors.length = _errs14;
}
else {
vErrors = null;
}
}
if(_valid2){
const _errs17 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.base === undefined){
const err13 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "base"},message:"must have required property '"+"base"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.key_env === undefined){
const err14 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "key_env"},message:"must have required property '"+"key_env"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
var _valid2 = _errs17 === errors;
valid6 = _valid2;
}
if(!valid6){
const err15 = {instancePath,schemaPath:"#/allOf/2/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.kind = true;
}
const _errs19 = errors;
let valid8 = true;
const _errs20 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing3;
if((data.kind === undefined) && (missing3 = "kind")){
const err16 = {};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
else {
if(data.kind !== undefined){
if("workers-ai" !== data.kind){
const err17 = {};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
}
var _valid3 = _errs20 === errors;
errors = _errs19;
if(vErrors !== null){
if(_errs19){
vErrors.length = _errs19;
}
else {
vErrors = null;
}
}
if(_valid3){
const _errs22 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.binding === undefined){
const err18 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "binding"},message:"must have required property '"+"binding"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data.rest_base === undefined){
const err19 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "rest_base"},message:"must have required property '"+"rest_base"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
var _valid3 = _errs22 === errors;
valid8 = _valid3;
}
if(!valid8){
const err20 = {instancePath,schemaPath:"#/allOf/3/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.kind = true;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err21 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data.tier === undefined){
const err22 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tier"},message:"must have required property '"+"tier"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema76.properties, key0))){
const err23 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.kind !== undefined){
let data6 = data.kind;
if(!(((((data6 === "gemini") || (data6 === "openai-compatible")) || (data6 === "workers-ai")) || (data6 === "anthropic")) || (data6 === "fake"))){
const err24 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema76.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.base !== undefined){
let data7 = data.base;
if(typeof data7 === "string"){
if(!(formats8(data7))){
const err25 = {instancePath:instancePath+"/base",schemaPath:"#/properties/base/format",keyword:"format",params:{format: "uri"},message:"must match format \""+"uri"+"\""};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/base",schemaPath:"#/properties/base/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.rest_base !== undefined){
let data8 = data.rest_base;
if(typeof data8 === "string"){
if(!pattern33.test(data8)){
const err27 = {instancePath:instancePath+"/rest_base",schemaPath:"#/properties/rest_base/pattern",keyword:"pattern",params:{pattern: "^https://"},message:"must match pattern \""+"^https://"+"\""};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/rest_base",schemaPath:"#/properties/rest_base/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.binding !== undefined){
let data9 = data.binding;
if(typeof data9 === "string"){
if(!pattern34.test(data9)){
const err29 = {instancePath:instancePath+"/binding",schemaPath:"#/properties/binding/pattern",keyword:"pattern",params:{pattern: "^[A-Z][A-Z0-9_]*$"},message:"must match pattern \""+"^[A-Z][A-Z0-9_]*$"+"\""};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/binding",schemaPath:"#/properties/binding/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.key_env !== undefined){
let data10 = data.key_env;
if(typeof data10 === "string"){
if(!pattern34.test(data10)){
const err31 = {instancePath:instancePath+"/key_env",schemaPath:"#/properties/key_env/pattern",keyword:"pattern",params:{pattern: "^[A-Z][A-Z0-9_]*$"},message:"must match pattern \""+"^[A-Z][A-Z0-9_]*$"+"\""};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
else {
const err32 = {instancePath:instancePath+"/key_env",schemaPath:"#/properties/key_env/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data.tier !== undefined){
let data11 = data.tier;
if(!((data11 === "free") || (data11 === "paid"))){
const err33 = {instancePath:instancePath+"/tier",schemaPath:"#/properties/tier/enum",keyword:"enum",params:{allowedValues: schema76.properties.tier.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data.rpd !== undefined){
let data12 = data.rpd;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err34 = {instancePath:instancePath+"/rpd",schemaPath:"#/properties/rpd/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 < 0 || isNaN(data12)){
const err35 = {instancePath:instancePath+"/rpd",schemaPath:"#/properties/rpd/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
if(data.neurons_per_day !== undefined){
let data13 = data.neurons_per_day;
if(!(((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13))) && (isFinite(data13)))){
const err36 = {instancePath:instancePath+"/neurons_per_day",schemaPath:"#/properties/neurons_per_day/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if((typeof data13 == "number") && (isFinite(data13))){
if(data13 < 0 || isNaN(data13)){
const err37 = {instancePath:instancePath+"/neurons_per_day",schemaPath:"#/properties/neurons_per_day/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
}
if(data.trains_on_data !== undefined){
if(typeof data.trains_on_data !== "boolean"){
const err38 = {instancePath:instancePath+"/trains_on_data",schemaPath:"#/properties/trains_on_data/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data.enabled !== undefined){
if(typeof data.enabled !== "boolean"){
const err39 = {instancePath:instancePath+"/enabled",schemaPath:"#/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
}
else {
const err40 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
validate214.errors = vErrors;
return errors === 0;
}
validate214.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema77 = {"type":"object","additionalProperties":false,"required":["provider"],"properties":{"provider":{"type":"string","pattern":"^[a-z][a-z0-9-]*$"},"in_per_m":{"type":"number","minimum":0,"description":"1M giriş token başına USD"},"out_per_m":{"type":"number","minimum":0,"description":"1M çıkış token başına USD"},"batch_discount":{"type":"number","exclusiveMinimum":0,"maximum":1},"ctx":{"type":"integer","minimum":1},"structured":{"type":"boolean"},"vision":{"type":"boolean"},"audio":{"type":"boolean"},"dims":{"type":"integer","minimum":1},"use":{"type":"array","minItems":1,"items":{"enum":["chat","nightly_facts","weekly_summary","question_gen","vision_check","ocr","lesson_analysis","transcribe","diarize","research","embedding","query_expand","tts"]}},"per_audio_hour":{"type":"number","minimum":0},"neurons_per_1k_tokens":{"type":"number","minimum":0},"enabled":{"type":"boolean"}},"anyOf":[{"required":["in_per_m","out_per_m"]},{"required":["per_audio_hour"]}]};
const pattern32 = new RegExp("^[a-z][a-z0-9-]*$", "u");

function validate216(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate216.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs1 = errors;
let valid0 = false;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.in_per_m === undefined){
const err0 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "in_per_m"},message:"must have required property '"+"in_per_m"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.out_per_m === undefined){
const err1 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "out_per_m"},message:"must have required property '"+"out_per_m"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var _valid0 = _errs2 === errors;
valid0 = valid0 || _valid0;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.per_audio_hour === undefined){
const err2 = {instancePath,schemaPath:"#/anyOf/1/required",keyword:"required",params:{missingProperty: "per_audio_hour"},message:"must have required property '"+"per_audio_hour"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
var _valid0 = _errs3 === errors;
valid0 = valid0 || _valid0;
if(!valid0){
const err3 = {instancePath,schemaPath:"#/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.provider === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "provider"},message:"must have required property '"+"provider"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema77.properties, key0))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.provider !== undefined){
let data0 = data.provider;
if(typeof data0 === "string"){
if(!pattern32.test(data0)){
const err6 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-z0-9-]*$"},message:"must match pattern \""+"^[a-z][a-z0-9-]*$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.in_per_m !== undefined){
let data1 = data.in_per_m;
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 < 0 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/in_per_m",schemaPath:"#/properties/in_per_m/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/in_per_m",schemaPath:"#/properties/in_per_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.out_per_m !== undefined){
let data2 = data.out_per_m;
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/out_per_m",schemaPath:"#/properties/out_per_m/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/out_per_m",schemaPath:"#/properties/out_per_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.batch_discount !== undefined){
let data3 = data.batch_discount;
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 > 1 || isNaN(data3)){
const err12 = {instancePath:instancePath+"/batch_discount",schemaPath:"#/properties/batch_discount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data3 <= 0 || isNaN(data3)){
const err13 = {instancePath:instancePath+"/batch_discount",schemaPath:"#/properties/batch_discount/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/batch_discount",schemaPath:"#/properties/batch_discount/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.ctx !== undefined){
let data4 = data.ctx;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err15 = {instancePath:instancePath+"/ctx",schemaPath:"#/properties/ctx/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 1 || isNaN(data4)){
const err16 = {instancePath:instancePath+"/ctx",schemaPath:"#/properties/ctx/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
if(data.structured !== undefined){
if(typeof data.structured !== "boolean"){
const err17 = {instancePath:instancePath+"/structured",schemaPath:"#/properties/structured/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.vision !== undefined){
if(typeof data.vision !== "boolean"){
const err18 = {instancePath:instancePath+"/vision",schemaPath:"#/properties/vision/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.audio !== undefined){
if(typeof data.audio !== "boolean"){
const err19 = {instancePath:instancePath+"/audio",schemaPath:"#/properties/audio/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.dims !== undefined){
let data8 = data.dims;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err20 = {instancePath:instancePath+"/dims",schemaPath:"#/properties/dims/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 < 1 || isNaN(data8)){
const err21 = {instancePath:instancePath+"/dims",schemaPath:"#/properties/dims/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
if(data.use !== undefined){
let data9 = data.use;
if(Array.isArray(data9)){
if(data9.length < 1){
const err22 = {instancePath:instancePath+"/use",schemaPath:"#/properties/use/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
const len0 = data9.length;
for(let i0=0; i0<len0; i0++){
let data10 = data9[i0];
if(!(((((((((((((data10 === "chat") || (data10 === "nightly_facts")) || (data10 === "weekly_summary")) || (data10 === "question_gen")) || (data10 === "vision_check")) || (data10 === "ocr")) || (data10 === "lesson_analysis")) || (data10 === "transcribe")) || (data10 === "diarize")) || (data10 === "research")) || (data10 === "embedding")) || (data10 === "query_expand")) || (data10 === "tts"))){
const err23 = {instancePath:instancePath+"/use/" + i0,schemaPath:"#/properties/use/items/enum",keyword:"enum",params:{allowedValues: schema77.properties.use.items.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
else {
const err24 = {instancePath:instancePath+"/use",schemaPath:"#/properties/use/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.per_audio_hour !== undefined){
let data11 = data.per_audio_hour;
if((typeof data11 == "number") && (isFinite(data11))){
if(data11 < 0 || isNaN(data11)){
const err25 = {instancePath:instancePath+"/per_audio_hour",schemaPath:"#/properties/per_audio_hour/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/per_audio_hour",schemaPath:"#/properties/per_audio_hour/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.neurons_per_1k_tokens !== undefined){
let data12 = data.neurons_per_1k_tokens;
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 < 0 || isNaN(data12)){
const err27 = {instancePath:instancePath+"/neurons_per_1k_tokens",schemaPath:"#/properties/neurons_per_1k_tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/neurons_per_1k_tokens",schemaPath:"#/properties/neurons_per_1k_tokens/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.enabled !== undefined){
if(typeof data.enabled !== "boolean"){
const err29 = {instancePath:instancePath+"/enabled",schemaPath:"#/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
validate216.errors = vErrors;
return errors === 0;
}
validate216.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema78 = {"type":"array","minItems":1,"items":{"type":"string","minLength":1},"description":"Denenme sırasıyla model adları (models anahtarları)"};

function validate218(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate218.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(Array.isArray(data)){
if(data.length < 1){
const err0 = {instancePath,schemaPath:"#/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
const len0 = data.length;
for(let i0=0; i0<len0; i0++){
let data0 = data[i0];
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err1 = {instancePath:instancePath+"/" + i0,schemaPath:"#/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath:instancePath+"/" + i0,schemaPath:"#/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate218.errors = vErrors;
return errors === 0;
}
validate218.evaluated = {"items":true,"dynamicProps":false,"dynamicItems":false};


function validate212(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/models.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate212.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.verified_at === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "verified_at"},message:"must have required property '"+"verified_at"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.currency === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "currency"},message:"must have required property '"+"currency"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.providers === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "providers"},message:"must have required property '"+"providers"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.models === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "models"},message:"must have required property '"+"models"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.chains === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chains"},message:"must have required property '"+"chains"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.cost_rules === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "cost_rules"},message:"must have required property '"+"cost_rules"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "$schema") || (key0 === "verified_at")) || (key0 === "currency")) || (key0 === "note")) || (key0 === "providers")) || (key0 === "models")) || (key0 === "chains")) || (key0 === "cost_rules"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.$schema !== undefined){
if(typeof data.$schema !== "string"){
const err7 = {instancePath:instancePath+"/$schema",schemaPath:"#/properties/%24schema/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.verified_at !== undefined){
if(!(validate65(data.verified_at, {instancePath:instancePath+"/verified_at",parentData:data,parentDataProperty:"verified_at",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate65.errors : vErrors.concat(validate65.errors);
errors = vErrors.length;
}
}
if(data.currency !== undefined){
if("USD" !== data.currency){
const err8 = {instancePath:instancePath+"/currency",schemaPath:"#/properties/currency/const",keyword:"const",params:{allowedValue: "USD"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.note !== undefined){
if(typeof data.note !== "string"){
const err9 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.providers !== undefined){
let data4 = data.providers;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(Object.keys(data4).length < 1){
const err10 = {instancePath:instancePath+"/providers",schemaPath:"#/properties/providers/minProperties",keyword:"minProperties",params:{limit: 1},message:"must NOT have fewer than 1 properties"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
for(const key1 in data4){
const _errs10 = errors;
if(typeof key1 === "string"){
if(!pattern32.test(key1)){
const err11 = {instancePath:instancePath+"/providers",schemaPath:"#/properties/providers/propertyNames/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-z0-9-]*$"},message:"must match pattern \""+"^[a-z][a-z0-9-]*$"+"\"",propertyName:key1};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
var valid1 = _errs10 === errors;
if(!valid1){
const err12 = {instancePath:instancePath+"/providers",schemaPath:"#/properties/providers/propertyNames",keyword:"propertyNames",params:{propertyName: key1},message:"property name must be valid"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
for(const key2 in data4){
if(!(validate214(data4[key2], {instancePath:instancePath+"/providers/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data4,parentDataProperty:key2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate214.errors : vErrors.concat(validate214.errors);
errors = vErrors.length;
}
}
}
else {
const err13 = {instancePath:instancePath+"/providers",schemaPath:"#/properties/providers/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.models !== undefined){
let data6 = data.models;
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
if(Object.keys(data6).length < 1){
const err14 = {instancePath:instancePath+"/models",schemaPath:"#/properties/models/minProperties",keyword:"minProperties",params:{limit: 1},message:"must NOT have fewer than 1 properties"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
for(const key3 in data6){
if(!(validate216(data6[key3], {instancePath:instancePath+"/models/" + key3.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data6,parentDataProperty:key3,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate216.errors : vErrors.concat(validate216.errors);
errors = vErrors.length;
}
}
}
else {
const err15 = {instancePath:instancePath+"/models",schemaPath:"#/properties/models/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.chains !== undefined){
let data8 = data.chains;
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.chat === undefined){
const err16 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "chat"},message:"must have required property '"+"chat"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data8.chat_free_only === undefined){
const err17 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "chat_free_only"},message:"must have required property '"+"chat_free_only"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data8.nightly_facts === undefined){
const err18 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "nightly_facts"},message:"must have required property '"+"nightly_facts"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data8.weekly_summary === undefined){
const err19 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "weekly_summary"},message:"must have required property '"+"weekly_summary"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data8.question_gen === undefined){
const err20 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "question_gen"},message:"must have required property '"+"question_gen"+"'"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data8.vision_check === undefined){
const err21 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "vision_check"},message:"must have required property '"+"vision_check"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data8.ocr === undefined){
const err22 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "ocr"},message:"must have required property '"+"ocr"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data8.lesson_analysis === undefined){
const err23 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "lesson_analysis"},message:"must have required property '"+"lesson_analysis"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data8.transcribe === undefined){
const err24 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "transcribe"},message:"must have required property '"+"transcribe"+"'"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data8.diarize === undefined){
const err25 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "diarize"},message:"must have required property '"+"diarize"+"'"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(data8.query_expand === undefined){
const err26 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "query_expand"},message:"must have required property '"+"query_expand"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data8.research === undefined){
const err27 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "research"},message:"must have required property '"+"research"+"'"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(data8.embedding === undefined){
const err28 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/required",keyword:"required",params:{missingProperty: "embedding"},message:"must have required property '"+"embedding"+"'"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
for(const key4 in data8){
if(!(func2.call(schema75.properties.chains.properties, key4))){
const err29 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data8.chat !== undefined){
if(!(validate218(data8.chat, {instancePath:instancePath+"/chains/chat",parentData:data8,parentDataProperty:"chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.chat_free_only !== undefined){
if(!(validate218(data8.chat_free_only, {instancePath:instancePath+"/chains/chat_free_only",parentData:data8,parentDataProperty:"chat_free_only",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.nightly_facts !== undefined){
if(!(validate218(data8.nightly_facts, {instancePath:instancePath+"/chains/nightly_facts",parentData:data8,parentDataProperty:"nightly_facts",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.weekly_summary !== undefined){
if(!(validate218(data8.weekly_summary, {instancePath:instancePath+"/chains/weekly_summary",parentData:data8,parentDataProperty:"weekly_summary",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.question_gen !== undefined){
if(!(validate218(data8.question_gen, {instancePath:instancePath+"/chains/question_gen",parentData:data8,parentDataProperty:"question_gen",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.vision_check !== undefined){
if(!(validate218(data8.vision_check, {instancePath:instancePath+"/chains/vision_check",parentData:data8,parentDataProperty:"vision_check",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.ocr !== undefined){
if(!(validate218(data8.ocr, {instancePath:instancePath+"/chains/ocr",parentData:data8,parentDataProperty:"ocr",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.lesson_analysis !== undefined){
if(!(validate218(data8.lesson_analysis, {instancePath:instancePath+"/chains/lesson_analysis",parentData:data8,parentDataProperty:"lesson_analysis",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.transcribe !== undefined){
if(!(validate218(data8.transcribe, {instancePath:instancePath+"/chains/transcribe",parentData:data8,parentDataProperty:"transcribe",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.diarize !== undefined){
if(!(validate218(data8.diarize, {instancePath:instancePath+"/chains/diarize",parentData:data8,parentDataProperty:"diarize",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.query_expand !== undefined){
if(!(validate218(data8.query_expand, {instancePath:instancePath+"/chains/query_expand",parentData:data8,parentDataProperty:"query_expand",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.research !== undefined){
if(!(validate218(data8.research, {instancePath:instancePath+"/chains/research",parentData:data8,parentDataProperty:"research",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
if(data8.embedding !== undefined){
if(!(validate218(data8.embedding, {instancePath:instancePath+"/chains/embedding",parentData:data8,parentDataProperty:"embedding",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate218.errors : vErrors.concat(validate218.errors);
errors = vErrors.length;
}
}
}
else {
const err30 = {instancePath:instancePath+"/chains",schemaPath:"#/properties/chains/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.cost_rules !== undefined){
let data22 = data.cost_rules;
if(data22 && typeof data22 == "object" && !Array.isArray(data22)){
if(data22.chat_budget_tokens_in === undefined){
const err31 = {instancePath:instancePath+"/cost_rules",schemaPath:"#/properties/cost_rules/required",keyword:"required",params:{missingProperty: "chat_budget_tokens_in"},message:"must have required property '"+"chat_budget_tokens_in"+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data22.chat_turn_max_usd === undefined){
const err32 = {instancePath:instancePath+"/cost_rules",schemaPath:"#/properties/cost_rules/required",keyword:"required",params:{missingProperty: "chat_turn_max_usd"},message:"must have required property '"+"chat_turn_max_usd"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data22.chat_target_usd === undefined){
const err33 = {instancePath:instancePath+"/cost_rules",schemaPath:"#/properties/cost_rules/required",keyword:"required",params:{missingProperty: "chat_target_usd"},message:"must have required property '"+"chat_target_usd"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
for(const key5 in data22){
if(!(((key5 === "chat_budget_tokens_in") || (key5 === "chat_turn_max_usd")) || (key5 === "chat_target_usd"))){
const err34 = {instancePath:instancePath+"/cost_rules",schemaPath:"#/properties/cost_rules/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data22.chat_budget_tokens_in !== undefined){
let data23 = data22.chat_budget_tokens_in;
if(!(((typeof data23 == "number") && (!(data23 % 1) && !isNaN(data23))) && (isFinite(data23)))){
const err35 = {instancePath:instancePath+"/cost_rules/chat_budget_tokens_in",schemaPath:"#/properties/cost_rules/properties/chat_budget_tokens_in/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if((typeof data23 == "number") && (isFinite(data23))){
if(data23 < 1 || isNaN(data23)){
const err36 = {instancePath:instancePath+"/cost_rules/chat_budget_tokens_in",schemaPath:"#/properties/cost_rules/properties/chat_budget_tokens_in/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
if(data22.chat_turn_max_usd !== undefined){
if(!(validate82(data22.chat_turn_max_usd, {instancePath:instancePath+"/cost_rules/chat_turn_max_usd",parentData:data22,parentDataProperty:"chat_turn_max_usd",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
errors = vErrors.length;
}
}
if(data22.chat_target_usd !== undefined){
if(!(validate82(data22.chat_target_usd, {instancePath:instancePath+"/cost_rules/chat_target_usd",parentData:data22,parentDataProperty:"chat_target_usd",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
errors = vErrors.length;
}
}
}
else {
const err37 = {instancePath:instancePath+"/cost_rules",schemaPath:"#/properties/cost_rules/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
}
else {
const err38 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
validate212.errors = vErrors;
return errors === 0;
}
validate212.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const modelsChain = validate234;

function validate234(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate234.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(Array.isArray(data)){
if(data.length < 1){
const err0 = {instancePath,schemaPath:"#/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
const len0 = data.length;
for(let i0=0; i0<len0; i0++){
let data0 = data[i0];
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err1 = {instancePath:instancePath+"/" + i0,schemaPath:"#/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath:instancePath+"/" + i0,schemaPath:"#/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate234.errors = vErrors;
return errors === 0;
}
validate234.evaluated = {"items":true,"dynamicProps":false,"dynamicItems":false};

export const modelsModel = validate235;

function validate235(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate235.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs1 = errors;
let valid0 = false;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.in_per_m === undefined){
const err0 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "in_per_m"},message:"must have required property '"+"in_per_m"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.out_per_m === undefined){
const err1 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "out_per_m"},message:"must have required property '"+"out_per_m"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var _valid0 = _errs2 === errors;
valid0 = valid0 || _valid0;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.per_audio_hour === undefined){
const err2 = {instancePath,schemaPath:"#/anyOf/1/required",keyword:"required",params:{missingProperty: "per_audio_hour"},message:"must have required property '"+"per_audio_hour"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
var _valid0 = _errs3 === errors;
valid0 = valid0 || _valid0;
if(!valid0){
const err3 = {instancePath,schemaPath:"#/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.provider === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "provider"},message:"must have required property '"+"provider"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema77.properties, key0))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.provider !== undefined){
let data0 = data.provider;
if(typeof data0 === "string"){
if(!pattern32.test(data0)){
const err6 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-z0-9-]*$"},message:"must match pattern \""+"^[a-z][a-z0-9-]*$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/provider",schemaPath:"#/properties/provider/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.in_per_m !== undefined){
let data1 = data.in_per_m;
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 < 0 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/in_per_m",schemaPath:"#/properties/in_per_m/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/in_per_m",schemaPath:"#/properties/in_per_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.out_per_m !== undefined){
let data2 = data.out_per_m;
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/out_per_m",schemaPath:"#/properties/out_per_m/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/out_per_m",schemaPath:"#/properties/out_per_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.batch_discount !== undefined){
let data3 = data.batch_discount;
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 > 1 || isNaN(data3)){
const err12 = {instancePath:instancePath+"/batch_discount",schemaPath:"#/properties/batch_discount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data3 <= 0 || isNaN(data3)){
const err13 = {instancePath:instancePath+"/batch_discount",schemaPath:"#/properties/batch_discount/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/batch_discount",schemaPath:"#/properties/batch_discount/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.ctx !== undefined){
let data4 = data.ctx;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err15 = {instancePath:instancePath+"/ctx",schemaPath:"#/properties/ctx/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 1 || isNaN(data4)){
const err16 = {instancePath:instancePath+"/ctx",schemaPath:"#/properties/ctx/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
if(data.structured !== undefined){
if(typeof data.structured !== "boolean"){
const err17 = {instancePath:instancePath+"/structured",schemaPath:"#/properties/structured/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.vision !== undefined){
if(typeof data.vision !== "boolean"){
const err18 = {instancePath:instancePath+"/vision",schemaPath:"#/properties/vision/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.audio !== undefined){
if(typeof data.audio !== "boolean"){
const err19 = {instancePath:instancePath+"/audio",schemaPath:"#/properties/audio/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.dims !== undefined){
let data8 = data.dims;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err20 = {instancePath:instancePath+"/dims",schemaPath:"#/properties/dims/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 < 1 || isNaN(data8)){
const err21 = {instancePath:instancePath+"/dims",schemaPath:"#/properties/dims/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
if(data.use !== undefined){
let data9 = data.use;
if(Array.isArray(data9)){
if(data9.length < 1){
const err22 = {instancePath:instancePath+"/use",schemaPath:"#/properties/use/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
const len0 = data9.length;
for(let i0=0; i0<len0; i0++){
let data10 = data9[i0];
if(!(((((((((((((data10 === "chat") || (data10 === "nightly_facts")) || (data10 === "weekly_summary")) || (data10 === "question_gen")) || (data10 === "vision_check")) || (data10 === "ocr")) || (data10 === "lesson_analysis")) || (data10 === "transcribe")) || (data10 === "diarize")) || (data10 === "research")) || (data10 === "embedding")) || (data10 === "query_expand")) || (data10 === "tts"))){
const err23 = {instancePath:instancePath+"/use/" + i0,schemaPath:"#/properties/use/items/enum",keyword:"enum",params:{allowedValues: schema77.properties.use.items.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
else {
const err24 = {instancePath:instancePath+"/use",schemaPath:"#/properties/use/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.per_audio_hour !== undefined){
let data11 = data.per_audio_hour;
if((typeof data11 == "number") && (isFinite(data11))){
if(data11 < 0 || isNaN(data11)){
const err25 = {instancePath:instancePath+"/per_audio_hour",schemaPath:"#/properties/per_audio_hour/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/per_audio_hour",schemaPath:"#/properties/per_audio_hour/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.neurons_per_1k_tokens !== undefined){
let data12 = data.neurons_per_1k_tokens;
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 < 0 || isNaN(data12)){
const err27 = {instancePath:instancePath+"/neurons_per_1k_tokens",schemaPath:"#/properties/neurons_per_1k_tokens/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/neurons_per_1k_tokens",schemaPath:"#/properties/neurons_per_1k_tokens/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.enabled !== undefined){
if(typeof data.enabled !== "boolean"){
const err29 = {instancePath:instancePath+"/enabled",schemaPath:"#/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
validate235.errors = vErrors;
return errors === 0;
}
validate235.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const modelsProvider = validate236;

function validate236(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate236.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.kind === undefined) && (missing0 = "kind")){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
else {
if(data.kind !== undefined){
if("gemini" !== data.kind){
const err1 = {};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.trains_on_data === undefined){
const err2 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "trains_on_data"},message:"must have required property '"+"trains_on_data"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.base === undefined){
const err3 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "base"},message:"must have required property '"+"base"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.key_env === undefined){
const err4 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "key_env"},message:"must have required property '"+"key_env"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
}
if(!valid1){
const err5 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const _errs7 = errors;
let valid3 = true;
const _errs8 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing1;
if(((data.kind === undefined) && (missing1 = "kind")) || ((data.tier === undefined) && (missing1 = "tier"))){
const err6 = {};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
else {
if(data.kind !== undefined){
const _errs9 = errors;
if("gemini" !== data.kind){
const err7 = {};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
var valid4 = _errs9 === errors;
}
else {
var valid4 = true;
}
if(valid4){
if(data.tier !== undefined){
const _errs10 = errors;
if("free" !== data.tier){
const err8 = {};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
var valid4 = _errs10 === errors;
}
else {
var valid4 = true;
}
}
}
}
var _valid1 = _errs8 === errors;
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs11 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.trains_on_data !== undefined){
if(true !== data.trains_on_data){
const err9 = {instancePath:instancePath+"/trains_on_data",schemaPath:"#/allOf/1/then/properties/trains_on_data/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
var _valid1 = _errs11 === errors;
valid3 = _valid1;
if(valid3){
var props0 = {};
props0.trains_on_data = true;
props0.kind = true;
props0.tier = true;
}
}
if(!valid3){
const err10 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.kind = true;
}
const _errs14 = errors;
let valid6 = true;
const _errs15 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing2;
if((data.kind === undefined) && (missing2 = "kind")){
const err11 = {};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
else {
if(data.kind !== undefined){
let data4 = data.kind;
if(!((data4 === "openai-compatible") || (data4 === "anthropic"))){
const err12 = {};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
}
var _valid2 = _errs15 === errors;
errors = _errs14;
if(vErrors !== null){
if(_errs14){
vErrors.length = _errs14;
}
else {
vErrors = null;
}
}
if(_valid2){
const _errs17 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.base === undefined){
const err13 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "base"},message:"must have required property '"+"base"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.key_env === undefined){
const err14 = {instancePath,schemaPath:"#/allOf/2/then/required",keyword:"required",params:{missingProperty: "key_env"},message:"must have required property '"+"key_env"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
var _valid2 = _errs17 === errors;
valid6 = _valid2;
}
if(!valid6){
const err15 = {instancePath,schemaPath:"#/allOf/2/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.kind = true;
}
const _errs19 = errors;
let valid8 = true;
const _errs20 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing3;
if((data.kind === undefined) && (missing3 = "kind")){
const err16 = {};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
else {
if(data.kind !== undefined){
if("workers-ai" !== data.kind){
const err17 = {};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
}
var _valid3 = _errs20 === errors;
errors = _errs19;
if(vErrors !== null){
if(_errs19){
vErrors.length = _errs19;
}
else {
vErrors = null;
}
}
if(_valid3){
const _errs22 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.binding === undefined){
const err18 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "binding"},message:"must have required property '"+"binding"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data.rest_base === undefined){
const err19 = {instancePath,schemaPath:"#/allOf/3/then/required",keyword:"required",params:{missingProperty: "rest_base"},message:"must have required property '"+"rest_base"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
var _valid3 = _errs22 === errors;
valid8 = _valid3;
}
if(!valid8){
const err20 = {instancePath,schemaPath:"#/allOf/3/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.kind = true;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err21 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data.tier === undefined){
const err22 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tier"},message:"must have required property '"+"tier"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema76.properties, key0))){
const err23 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.kind !== undefined){
let data6 = data.kind;
if(!(((((data6 === "gemini") || (data6 === "openai-compatible")) || (data6 === "workers-ai")) || (data6 === "anthropic")) || (data6 === "fake"))){
const err24 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema76.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.base !== undefined){
let data7 = data.base;
if(typeof data7 === "string"){
if(!(formats8(data7))){
const err25 = {instancePath:instancePath+"/base",schemaPath:"#/properties/base/format",keyword:"format",params:{format: "uri"},message:"must match format \""+"uri"+"\""};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/base",schemaPath:"#/properties/base/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.rest_base !== undefined){
let data8 = data.rest_base;
if(typeof data8 === "string"){
if(!pattern33.test(data8)){
const err27 = {instancePath:instancePath+"/rest_base",schemaPath:"#/properties/rest_base/pattern",keyword:"pattern",params:{pattern: "^https://"},message:"must match pattern \""+"^https://"+"\""};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/rest_base",schemaPath:"#/properties/rest_base/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.binding !== undefined){
let data9 = data.binding;
if(typeof data9 === "string"){
if(!pattern34.test(data9)){
const err29 = {instancePath:instancePath+"/binding",schemaPath:"#/properties/binding/pattern",keyword:"pattern",params:{pattern: "^[A-Z][A-Z0-9_]*$"},message:"must match pattern \""+"^[A-Z][A-Z0-9_]*$"+"\""};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/binding",schemaPath:"#/properties/binding/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.key_env !== undefined){
let data10 = data.key_env;
if(typeof data10 === "string"){
if(!pattern34.test(data10)){
const err31 = {instancePath:instancePath+"/key_env",schemaPath:"#/properties/key_env/pattern",keyword:"pattern",params:{pattern: "^[A-Z][A-Z0-9_]*$"},message:"must match pattern \""+"^[A-Z][A-Z0-9_]*$"+"\""};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
else {
const err32 = {instancePath:instancePath+"/key_env",schemaPath:"#/properties/key_env/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data.tier !== undefined){
let data11 = data.tier;
if(!((data11 === "free") || (data11 === "paid"))){
const err33 = {instancePath:instancePath+"/tier",schemaPath:"#/properties/tier/enum",keyword:"enum",params:{allowedValues: schema76.properties.tier.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data.rpd !== undefined){
let data12 = data.rpd;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err34 = {instancePath:instancePath+"/rpd",schemaPath:"#/properties/rpd/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 < 0 || isNaN(data12)){
const err35 = {instancePath:instancePath+"/rpd",schemaPath:"#/properties/rpd/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
if(data.neurons_per_day !== undefined){
let data13 = data.neurons_per_day;
if(!(((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13))) && (isFinite(data13)))){
const err36 = {instancePath:instancePath+"/neurons_per_day",schemaPath:"#/properties/neurons_per_day/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if((typeof data13 == "number") && (isFinite(data13))){
if(data13 < 0 || isNaN(data13)){
const err37 = {instancePath:instancePath+"/neurons_per_day",schemaPath:"#/properties/neurons_per_day/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
}
if(data.trains_on_data !== undefined){
if(typeof data.trains_on_data !== "boolean"){
const err38 = {instancePath:instancePath+"/trains_on_data",schemaPath:"#/properties/trains_on_data/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data.enabled !== undefined){
if(typeof data.enabled !== "boolean"){
const err39 = {instancePath:instancePath+"/enabled",schemaPath:"#/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
}
else {
const err40 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
validate236.errors = vErrors;
return errors === 0;
}
validate236.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const nightlyFactsOutput = validate237;
const schema82 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/nightly-facts-output.json","title":"NightlyFactsOutput","description":"Gece olgu çıkarımının öğrenci × gün çıktısı (Batch; zincir nightly_facts).","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","day","student_ref","facts","is_question_message_ids","answered_question_message_ids"],"properties":{"schema_version":{"const":"1.0"},"day":{"$ref":"common.json#/$defs/date"},"student_ref":{"$ref":"common.json#/$defs/studentRef"},"facts":{"type":"array","maxItems":12,"items":{"$ref":"memory-fact.json"}},"is_question_message_ids":{"type":"array","items":{"type":"integer"}},"answered_question_message_ids":{"type":"array","items":{"type":"integer"}},"preferences":{"type":"object","additionalProperties":false,"properties":{"modality":{"enum":["visual","verbal","mixed"]},"explanation_notes":{"type":"string","maxLength":200},"active_hours":{"type":"array","items":{"type":"integer","minimum":0,"maximum":23}}}}}};

function validate237(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/nightly-facts-output.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate237.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.day === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "day"},message:"must have required property '"+"day"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.student_ref === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "student_ref"},message:"must have required property '"+"student_ref"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.facts === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "facts"},message:"must have required property '"+"facts"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.is_question_message_ids === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "is_question_message_ids"},message:"must have required property '"+"is_question_message_ids"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.answered_question_message_ids === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "answered_question_message_ids"},message:"must have required property '"+"answered_question_message_ids"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "schema_version") || (key0 === "day")) || (key0 === "student_ref")) || (key0 === "facts")) || (key0 === "is_question_message_ids")) || (key0 === "answered_question_message_ids")) || (key0 === "preferences"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err7 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.day !== undefined){
if(!(validate65(data.day, {instancePath:instancePath+"/day",parentData:data,parentDataProperty:"day",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate65.errors : vErrors.concat(validate65.errors);
errors = vErrors.length;
}
}
if(data.student_ref !== undefined){
if(!(validate74(data.student_ref, {instancePath:instancePath+"/student_ref",parentData:data,parentDataProperty:"student_ref",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors);
errors = vErrors.length;
}
}
if(data.facts !== undefined){
let data3 = data.facts;
if(Array.isArray(data3)){
if(data3.length > 12){
const err8 = {instancePath:instancePath+"/facts",schemaPath:"#/properties/facts/maxItems",keyword:"maxItems",params:{limit: 12},message:"must NOT have more than 12 items"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
const len0 = data3.length;
for(let i0=0; i0<len0; i0++){
if(!(validate197(data3[i0], {instancePath:instancePath+"/facts/" + i0,parentData:data3,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate197.errors : vErrors.concat(validate197.errors);
errors = vErrors.length;
}
}
}
else {
const err9 = {instancePath:instancePath+"/facts",schemaPath:"#/properties/facts/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.is_question_message_ids !== undefined){
let data5 = data.is_question_message_ids;
if(Array.isArray(data5)){
const len1 = data5.length;
for(let i1=0; i1<len1; i1++){
let data6 = data5[i1];
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err10 = {instancePath:instancePath+"/is_question_message_ids/" + i1,schemaPath:"#/properties/is_question_message_ids/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath:instancePath+"/is_question_message_ids",schemaPath:"#/properties/is_question_message_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.answered_question_message_ids !== undefined){
let data7 = data.answered_question_message_ids;
if(Array.isArray(data7)){
const len2 = data7.length;
for(let i2=0; i2<len2; i2++){
let data8 = data7[i2];
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err12 = {instancePath:instancePath+"/answered_question_message_ids/" + i2,schemaPath:"#/properties/answered_question_message_ids/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
else {
const err13 = {instancePath:instancePath+"/answered_question_message_ids",schemaPath:"#/properties/answered_question_message_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.preferences !== undefined){
let data9 = data.preferences;
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
for(const key1 in data9){
if(!(((key1 === "modality") || (key1 === "explanation_notes")) || (key1 === "active_hours"))){
const err14 = {instancePath:instancePath+"/preferences",schemaPath:"#/properties/preferences/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data9.modality !== undefined){
let data10 = data9.modality;
if(!(((data10 === "visual") || (data10 === "verbal")) || (data10 === "mixed"))){
const err15 = {instancePath:instancePath+"/preferences/modality",schemaPath:"#/properties/preferences/properties/modality/enum",keyword:"enum",params:{allowedValues: schema82.properties.preferences.properties.modality.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data9.explanation_notes !== undefined){
let data11 = data9.explanation_notes;
if(typeof data11 === "string"){
if(func1(data11) > 200){
const err16 = {instancePath:instancePath+"/preferences/explanation_notes",schemaPath:"#/properties/preferences/properties/explanation_notes/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/preferences/explanation_notes",schemaPath:"#/properties/preferences/properties/explanation_notes/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data9.active_hours !== undefined){
let data12 = data9.active_hours;
if(Array.isArray(data12)){
const len3 = data12.length;
for(let i3=0; i3<len3; i3++){
let data13 = data12[i3];
if(!(((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13))) && (isFinite(data13)))){
const err18 = {instancePath:instancePath+"/preferences/active_hours/" + i3,schemaPath:"#/properties/preferences/properties/active_hours/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if((typeof data13 == "number") && (isFinite(data13))){
if(data13 > 23 || isNaN(data13)){
const err19 = {instancePath:instancePath+"/preferences/active_hours/" + i3,schemaPath:"#/properties/preferences/properties/active_hours/items/maximum",keyword:"maximum",params:{comparison: "<=", limit: 23},message:"must be <= 23"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data13 < 0 || isNaN(data13)){
const err20 = {instancePath:instancePath+"/preferences/active_hours/" + i3,schemaPath:"#/properties/preferences/properties/active_hours/items/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
}
else {
const err21 = {instancePath:instancePath+"/preferences/active_hours",schemaPath:"#/properties/preferences/properties/active_hours/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
else {
const err22 = {instancePath:instancePath+"/preferences",schemaPath:"#/properties/preferences/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
}
else {
const err23 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
validate237.errors = vErrors;
return errors === 0;
}
validate237.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const queryExpand = validate241;
const schema83 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/query-expand.json","title":"QueryExpand","description":"Kitap araştırma sorusunun 3–5 arama sorgusuna genişletilmesi (zincir query_expand).","x-version":"1.0","type":"object","additionalProperties":false,"required":["queries"],"properties":{"queries":{"type":"array","minItems":3,"maxItems":5,"items":{"type":"string","minLength":3,"maxLength":200}}}};

function validate241(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/query-expand.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate241.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.queries === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "queries"},message:"must have required property '"+"queries"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "queries")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.queries !== undefined){
let data0 = data.queries;
if(Array.isArray(data0)){
if(data0.length > 5){
const err2 = {instancePath:instancePath+"/queries",schemaPath:"#/properties/queries/maxItems",keyword:"maxItems",params:{limit: 5},message:"must NOT have more than 5 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data0.length < 3){
const err3 = {instancePath:instancePath+"/queries",schemaPath:"#/properties/queries/minItems",keyword:"minItems",params:{limit: 3},message:"must NOT have fewer than 3 items"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(typeof data1 === "string"){
if(func1(data1) > 200){
const err4 = {instancePath:instancePath+"/queries/" + i0,schemaPath:"#/properties/queries/items/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data1) < 3){
const err5 = {instancePath:instancePath+"/queries/" + i0,schemaPath:"#/properties/queries/items/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/queries/" + i0,schemaPath:"#/properties/queries/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath:instancePath+"/queries",schemaPath:"#/properties/queries/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
else {
const err8 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
validate241.errors = vErrors;
return errors === 0;
}
validate241.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const questionItem = validate110;
const schema52 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/question-item.json","title":"QuestionItem","description":"Soru maddesi. Cevap anahtarı BU NESNEDE YOKTUR (answer-key ayrı sözleşmedir).","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","curriculum_code","kind","skill_ids","stem","figure","source","verification"],"properties":{"schema_version":{"const":"1.0"},"id":{"$ref":"common.json#/$defs/uuid"},"curriculum_code":{"type":"string","pattern":"^[A-Z]{2,5}-[A-Z]{2,5}@[0-9]{4}\\.[0-9]+$","examples":["TYT-MAT@2026.1"]},"kind":{"enum":["mcq","numeric"]},"skill_ids":{"type":"array","minItems":1,"maxItems":3,"items":{"$ref":"common.json#/$defs/skillId"}},"stem":{"type":"string","minLength":10,"maxLength":900,"description":"Soru kökü; formüller düz metin/kod biçiminde; şekil varsa kök şekli kelimelerle de anlatır"},"stem_values":{"type":"object","additionalProperties":{"type":["number","string"]},"description":"Şekil denetiminin karşılaştırdığı değerler (kenar, açı, eksen)"},"figure":{"oneOf":[{"type":"null"},{"type":"object","additionalProperties":false,"required":["tool","code","alt_text"],"properties":{"tool":{"enum":["matplotlib","svg","tikz","vega-lite","schemdraw","rdkit","graphviz","latex","template"]},"code":{"type":"string","minLength":1,"maxLength":20000},"alt_text":{"type":"string","minLength":15,"maxLength":400,"description":"Şekli kelimelerle anlatır (Telegram altyazısı, alt)"},"expected_px":{"type":"object","additionalProperties":false,"properties":{"min_w":{"type":"integer"},"max_w":{"type":"integer"},"min_h":{"type":"integer"},"max_h":{"type":"integer"}}},"render":{"type":"object","additionalProperties":false,"properties":{"status":{"enum":["pending","rendered","failed"]},"png_path":{"type":"string"},"width_px":{"type":"integer"},"height_px":{"type":"integer"},"bytes":{"type":"integer"},"vision":{"enum":["pending","match","mismatch","not_applicable","skipped"]},"attempts":{"type":"integer","minimum":0,"maximum":3}}}}}]},"options":{"type":"array","minItems":4,"maxItems":4,"description":"Tam dört şık, anahtarlar sırayla A, B, C, D (yinelenen, eksik ya da sırası bozuk anahtar düşer; Telegram A·B·C·D düğmeleri ve grade_attempt aynı sırayı varsayar). En az iki şık misconception_tag=null taşır (doğru şık + en az bir etiketsiz çeldirici).","items":{"type":"object","additionalProperties":false,"required":["key","text","misconception_tag"],"properties":{"key":{"$ref":"common.json#/$defs/optionKey"},"text":{"type":"string","minLength":1,"maxLength":200},"misconception_tag":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/tag"}],"description":"Yanlış şıkkın kodladığı yanılgı. DOĞRU ŞIK BU DİZİDEN ÇIKARILAMAZ: doğru şık null taşır VE en az bir çeldirici de null taşır (en az iki null zorunlu); LLM ve öğrenci yolu şıkları app.strip_tags ile etiketsiz görür."}}},"contains":{"type":"object","required":["misconception_tag"],"properties":{"misconception_tag":{"type":"null"}}},"minContains":2,"allOf":[{"minItems":4,"maxItems":4,"prefixItems":[{"properties":{"key":{"const":"A"}}},{"properties":{"key":{"const":"B"}}},{"properties":{"key":{"const":"C"}}},{"properties":{"key":{"const":"D"}}}]}]},"difficulty":{"$ref":"common.json#/$defs/probability"},"source":{"enum":["template","llm","instructor","diagnostic"]},"template":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"params":{"type":"object","additionalProperties":{"$ref":"template-params.json#/$defs/value"},"description":"Şablon parametreleri (template-params ile aynı değer kuralı: sayı, metin, mantıksal, null, bunların düz dizisi ya da bir düzey düz nesne)"}}},"verification":{"type":"object","additionalProperties":false,"required":["schema","sympy","render","vision","attempts","status"],"properties":{"schema":{"type":"boolean"},"sympy":{"enum":["verified","failed","not_applicable","pending"]},"render":{"enum":["ok","failed","size_mismatch","not_applicable","pending"]},"vision":{"enum":["match","mismatch","not_applicable","pending","skipped"]},"attempts":{"type":"integer","minimum":0,"maximum":3},"status":{"enum":["draft","pending_review","approved","rejected","retired"]},"review_note":{"type":["string","null"]}}},"provenance":{"type":"object","additionalProperties":false,"properties":{"model":{"type":"string"},"cost_usd":{"$ref":"common.json#/$defs/usd"},"prompt_version":{"type":"string"},"prompt_hash":{"type":"string"},"created_at":{"$ref":"common.json#/$defs/dateTime"}}}},"allOf":[{"if":{"properties":{"kind":{"const":"mcq"}}},"then":{"required":["options"]}},{"if":{"properties":{"kind":{"const":"numeric"}}},"then":{"not":{"required":["options"]}}},{"if":{"properties":{"verification":{"properties":{"status":{"const":"approved"}}}}},"then":{"properties":{"verification":{"properties":{"sympy":{"enum":["verified","not_applicable"]}}}}}}]};
const schema54 = {"oneOf":[{"$ref":"#/$defs/leaf"},{"type":"object","minProperties":1,"maxProperties":12,"propertyNames":{"pattern":"^[a-z_][a-z0-9_]*$"},"additionalProperties":{"$ref":"#/$defs/leaf"}}]};
const schema55 = {"oneOf":[{"$ref":"#/$defs/scalar"},{"type":"array","maxItems":12,"items":{"$ref":"#/$defs/scalar"}}]};
const schema56 = {"type":["number","string","boolean","null"]};

function validate119(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate119.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((((!((typeof data == "number") && (isFinite(data)))) && (typeof data !== "string")) && (typeof data !== "boolean")) && (data !== null)){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: schema56.type},message:"must be number,string,boolean,null"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate119.errors = vErrors;
return errors === 0;
}
validate119.evaluated = {"dynamicProps":false,"dynamicItems":false};


function validate118(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate118.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate119(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate119.errors : vErrors.concat(validate119.errors);
errors = vErrors.length;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs2 = errors;
if(Array.isArray(data)){
if(data.length > 12){
const err0 = {instancePath,schemaPath:"#/oneOf/1/maxItems",keyword:"maxItems",params:{limit: 12},message:"must NOT have more than 12 items"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
const len0 = data.length;
for(let i0=0; i0<len0; i0++){
if(!(validate119(data[i0], {instancePath:instancePath+"/" + i0,parentData:data,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate119.errors : vErrors.concat(validate119.errors);
errors = vErrors.length;
}
}
}
else {
const err1 = {instancePath,schemaPath:"#/oneOf/1/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
var _valid0 = _errs2 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
var items0 = true;
}
}
if(!valid0){
const err2 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate118.errors = vErrors;
evaluated0.items = items0;
return errors === 0;
}
validate118.evaluated = {"dynamicProps":false,"dynamicItems":true};

const pattern18 = new RegExp("^[a-z_][a-z0-9_]*$", "u");

function validate125(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate125.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate118(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
else {
var items0 = validate118.evaluated.items;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(Object.keys(data).length > 12){
const err0 = {instancePath,schemaPath:"#/oneOf/1/maxProperties",keyword:"maxProperties",params:{limit: 12},message:"must NOT have more than 12 properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(Object.keys(data).length < 1){
const err1 = {instancePath,schemaPath:"#/oneOf/1/minProperties",keyword:"minProperties",params:{limit: 1},message:"must NOT have fewer than 1 properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
const _errs4 = errors;
if(typeof key0 === "string"){
if(!pattern18.test(key0)){
const err2 = {instancePath,schemaPath:"#/oneOf/1/propertyNames/pattern",keyword:"pattern",params:{pattern: "^[a-z_][a-z0-9_]*$"},message:"must match pattern \""+"^[a-z_][a-z0-9_]*$"+"\"",propertyName:key0};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
var valid1 = _errs4 === errors;
if(!valid1){
const err3 = {instancePath,schemaPath:"#/oneOf/1/propertyNames",keyword:"propertyNames",params:{propertyName: key0},message:"property name must be valid"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
for(const key1 in data){
if(!(validate118(data[key1], {instancePath:instancePath+"/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data,parentDataProperty:key1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
var _valid0 = _errs2 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
var props0 = true;
}
}
if(!valid0){
const err5 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate125.errors = vErrors;
evaluated0.props = props0;
evaluated0.items = items0;
return errors === 0;
}
validate125.evaluated = {"dynamicProps":true,"dynamicItems":true};

const pattern16 = new RegExp("^[A-Z]{2,5}-[A-Z]{2,5}@[0-9]{4}\\.[0-9]+$", "u");

function validate110(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/question-item.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate110.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("mcq" !== data.kind){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.options === undefined){
const err1 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "options"},message:"must have required property '"+"options"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
}
if(!valid1){
const err2 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const _errs7 = errors;
let valid3 = true;
const _errs8 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("numeric" !== data.kind){
const err3 = {};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
var _valid1 = _errs8 === errors;
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs10 = errors;
const _errs11 = errors;
const _errs12 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.options === undefined) && (missing0 = "options")){
const err4 = {};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
var valid5 = _errs12 === errors;
if(valid5){
const err5 = {instancePath,schemaPath:"#/allOf/1/then/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
errors = _errs11;
if(vErrors !== null){
if(_errs11){
vErrors.length = _errs11;
}
else {
vErrors = null;
}
}
}
var _valid1 = _errs10 === errors;
valid3 = _valid1;
}
if(!valid3){
const err6 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
const _errs14 = errors;
let valid6 = true;
const _errs15 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.verification !== undefined){
let data2 = data.verification;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.status !== undefined){
if("approved" !== data2.status){
const err7 = {};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
}
}
var _valid2 = _errs15 === errors;
errors = _errs14;
if(vErrors !== null){
if(_errs14){
vErrors.length = _errs14;
}
else {
vErrors = null;
}
}
if(_valid2){
const _errs18 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.verification !== undefined){
let data4 = data.verification;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.sympy !== undefined){
let data5 = data4.sympy;
if(!((data5 === "verified") || (data5 === "not_applicable"))){
const err8 = {instancePath:instancePath+"/verification/sympy",schemaPath:"#/allOf/2/then/properties/verification/properties/sympy/enum",keyword:"enum",params:{allowedValues: schema52.allOf[2].then.properties.verification.properties.sympy.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
}
}
var _valid2 = _errs18 === errors;
valid6 = _valid2;
if(valid6){
var props0 = {};
props0.verification = true;
}
}
if(!valid6){
const err9 = {instancePath,schemaPath:"#/allOf/2/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.kind = true;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.curriculum_code === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "curriculum_code"},message:"must have required property '"+"curriculum_code"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.kind === undefined){
const err12 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.skill_ids === undefined){
const err13 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_ids"},message:"must have required property '"+"skill_ids"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.stem === undefined){
const err14 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "stem"},message:"must have required property '"+"stem"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data.figure === undefined){
const err15 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "figure"},message:"must have required property '"+"figure"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data.source === undefined){
const err16 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source"},message:"must have required property '"+"source"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data.verification === undefined){
const err17 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "verification"},message:"must have required property '"+"verification"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema52.properties, key0))){
const err18 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err19 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.id !== undefined){
if(!(validate83(data.id, {instancePath:instancePath+"/id",parentData:data,parentDataProperty:"id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.curriculum_code !== undefined){
let data8 = data.curriculum_code;
if(typeof data8 === "string"){
if(!pattern16.test(data8)){
const err20 = {instancePath:instancePath+"/curriculum_code",schemaPath:"#/properties/curriculum_code/pattern",keyword:"pattern",params:{pattern: "^[A-Z]{2,5}-[A-Z]{2,5}@[0-9]{4}\\.[0-9]+$"},message:"must match pattern \""+"^[A-Z]{2,5}-[A-Z]{2,5}@[0-9]{4}\\.[0-9]+$"+"\""};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/curriculum_code",schemaPath:"#/properties/curriculum_code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.kind !== undefined){
let data9 = data.kind;
if(!((data9 === "mcq") || (data9 === "numeric"))){
const err22 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema52.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.skill_ids !== undefined){
let data10 = data.skill_ids;
if(Array.isArray(data10)){
if(data10.length > 3){
const err23 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data10.length < 1){
const err24 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
const len0 = data10.length;
for(let i0=0; i0<len0; i0++){
if(!(validate72(data10[i0], {instancePath:instancePath+"/skill_ids/" + i0,parentData:data10,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
}
else {
const err25 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.stem !== undefined){
let data12 = data.stem;
if(typeof data12 === "string"){
if(func1(data12) > 900){
const err26 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/maxLength",keyword:"maxLength",params:{limit: 900},message:"must NOT have more than 900 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(func1(data12) < 10){
const err27 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/minLength",keyword:"minLength",params:{limit: 10},message:"must NOT have fewer than 10 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.stem_values !== undefined){
let data13 = data.stem_values;
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
for(const key1 in data13){
let data14 = data13[key1];
if((!((typeof data14 == "number") && (isFinite(data14)))) && (typeof data14 !== "string")){
const err29 = {instancePath:instancePath+"/stem_values/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/stem_values/additionalProperties/type",keyword:"type",params:{type: schema52.properties.stem_values.additionalProperties.type},message:"must be number,string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath:instancePath+"/stem_values",schemaPath:"#/properties/stem_values/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.figure !== undefined){
let data15 = data.figure;
const _errs38 = errors;
let valid15 = false;
let passing0 = null;
const _errs39 = errors;
if(data15 !== null){
const err31 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
var _valid3 = _errs39 === errors;
if(_valid3){
valid15 = true;
passing0 = 0;
}
const _errs41 = errors;
if(data15 && typeof data15 == "object" && !Array.isArray(data15)){
if(data15.tool === undefined){
const err32 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/required",keyword:"required",params:{missingProperty: "tool"},message:"must have required property '"+"tool"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data15.code === undefined){
const err33 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data15.alt_text === undefined){
const err34 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/required",keyword:"required",params:{missingProperty: "alt_text"},message:"must have required property '"+"alt_text"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
for(const key2 in data15){
if(!(((((key2 === "tool") || (key2 === "code")) || (key2 === "alt_text")) || (key2 === "expected_px")) || (key2 === "render"))){
const err35 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data15.tool !== undefined){
let data16 = data15.tool;
if(!(((((((((data16 === "matplotlib") || (data16 === "svg")) || (data16 === "tikz")) || (data16 === "vega-lite")) || (data16 === "schemdraw")) || (data16 === "rdkit")) || (data16 === "graphviz")) || (data16 === "latex")) || (data16 === "template"))){
const err36 = {instancePath:instancePath+"/figure/tool",schemaPath:"#/properties/figure/oneOf/1/properties/tool/enum",keyword:"enum",params:{allowedValues: schema52.properties.figure.oneOf[1].properties.tool.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data15.code !== undefined){
let data17 = data15.code;
if(typeof data17 === "string"){
if(func1(data17) > 20000){
const err37 = {instancePath:instancePath+"/figure/code",schemaPath:"#/properties/figure/oneOf/1/properties/code/maxLength",keyword:"maxLength",params:{limit: 20000},message:"must NOT have more than 20000 characters"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(func1(data17) < 1){
const err38 = {instancePath:instancePath+"/figure/code",schemaPath:"#/properties/figure/oneOf/1/properties/code/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
else {
const err39 = {instancePath:instancePath+"/figure/code",schemaPath:"#/properties/figure/oneOf/1/properties/code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
if(data15.alt_text !== undefined){
let data18 = data15.alt_text;
if(typeof data18 === "string"){
if(func1(data18) > 400){
const err40 = {instancePath:instancePath+"/figure/alt_text",schemaPath:"#/properties/figure/oneOf/1/properties/alt_text/maxLength",keyword:"maxLength",params:{limit: 400},message:"must NOT have more than 400 characters"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(func1(data18) < 15){
const err41 = {instancePath:instancePath+"/figure/alt_text",schemaPath:"#/properties/figure/oneOf/1/properties/alt_text/minLength",keyword:"minLength",params:{limit: 15},message:"must NOT have fewer than 15 characters"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
else {
const err42 = {instancePath:instancePath+"/figure/alt_text",schemaPath:"#/properties/figure/oneOf/1/properties/alt_text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data15.expected_px !== undefined){
let data19 = data15.expected_px;
if(data19 && typeof data19 == "object" && !Array.isArray(data19)){
for(const key3 in data19){
if(!((((key3 === "min_w") || (key3 === "max_w")) || (key3 === "min_h")) || (key3 === "max_h"))){
const err43 = {instancePath:instancePath+"/figure/expected_px",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
if(data19.min_w !== undefined){
let data20 = data19.min_w;
if(!(((typeof data20 == "number") && (!(data20 % 1) && !isNaN(data20))) && (isFinite(data20)))){
const err44 = {instancePath:instancePath+"/figure/expected_px/min_w",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/properties/min_w/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
if(data19.max_w !== undefined){
let data21 = data19.max_w;
if(!(((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21))) && (isFinite(data21)))){
const err45 = {instancePath:instancePath+"/figure/expected_px/max_w",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/properties/max_w/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
if(data19.min_h !== undefined){
let data22 = data19.min_h;
if(!(((typeof data22 == "number") && (!(data22 % 1) && !isNaN(data22))) && (isFinite(data22)))){
const err46 = {instancePath:instancePath+"/figure/expected_px/min_h",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/properties/min_h/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
if(data19.max_h !== undefined){
let data23 = data19.max_h;
if(!(((typeof data23 == "number") && (!(data23 % 1) && !isNaN(data23))) && (isFinite(data23)))){
const err47 = {instancePath:instancePath+"/figure/expected_px/max_h",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/properties/max_h/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
}
else {
const err48 = {instancePath:instancePath+"/figure/expected_px",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
if(data15.render !== undefined){
let data24 = data15.render;
if(data24 && typeof data24 == "object" && !Array.isArray(data24)){
for(const key4 in data24){
if(!(((((((key4 === "status") || (key4 === "png_path")) || (key4 === "width_px")) || (key4 === "height_px")) || (key4 === "bytes")) || (key4 === "vision")) || (key4 === "attempts"))){
const err49 = {instancePath:instancePath+"/figure/render",schemaPath:"#/properties/figure/oneOf/1/properties/render/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data24.status !== undefined){
let data25 = data24.status;
if(!(((data25 === "pending") || (data25 === "rendered")) || (data25 === "failed"))){
const err50 = {instancePath:instancePath+"/figure/render/status",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/status/enum",keyword:"enum",params:{allowedValues: schema52.properties.figure.oneOf[1].properties.render.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
if(data24.png_path !== undefined){
if(typeof data24.png_path !== "string"){
const err51 = {instancePath:instancePath+"/figure/render/png_path",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/png_path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data24.width_px !== undefined){
let data27 = data24.width_px;
if(!(((typeof data27 == "number") && (!(data27 % 1) && !isNaN(data27))) && (isFinite(data27)))){
const err52 = {instancePath:instancePath+"/figure/render/width_px",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/width_px/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
if(data24.height_px !== undefined){
let data28 = data24.height_px;
if(!(((typeof data28 == "number") && (!(data28 % 1) && !isNaN(data28))) && (isFinite(data28)))){
const err53 = {instancePath:instancePath+"/figure/render/height_px",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/height_px/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data24.bytes !== undefined){
let data29 = data24.bytes;
if(!(((typeof data29 == "number") && (!(data29 % 1) && !isNaN(data29))) && (isFinite(data29)))){
const err54 = {instancePath:instancePath+"/figure/render/bytes",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
if(data24.vision !== undefined){
let data30 = data24.vision;
if(!(((((data30 === "pending") || (data30 === "match")) || (data30 === "mismatch")) || (data30 === "not_applicable")) || (data30 === "skipped"))){
const err55 = {instancePath:instancePath+"/figure/render/vision",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/vision/enum",keyword:"enum",params:{allowedValues: schema52.properties.figure.oneOf[1].properties.render.properties.vision.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
if(data24.attempts !== undefined){
let data31 = data24.attempts;
if(!(((typeof data31 == "number") && (!(data31 % 1) && !isNaN(data31))) && (isFinite(data31)))){
const err56 = {instancePath:instancePath+"/figure/render/attempts",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/attempts/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
if((typeof data31 == "number") && (isFinite(data31))){
if(data31 > 3 || isNaN(data31)){
const err57 = {instancePath:instancePath+"/figure/render/attempts",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/attempts/maximum",keyword:"maximum",params:{comparison: "<=", limit: 3},message:"must be <= 3"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
if(data31 < 0 || isNaN(data31)){
const err58 = {instancePath:instancePath+"/figure/render/attempts",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/attempts/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
}
}
else {
const err59 = {instancePath:instancePath+"/figure/render",schemaPath:"#/properties/figure/oneOf/1/properties/render/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
}
}
else {
const err60 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
var _valid3 = _errs41 === errors;
if(_valid3 && valid15){
valid15 = false;
passing0 = [passing0, 1];
}
else {
if(_valid3){
valid15 = true;
passing0 = 1;
}
}
if(!valid15){
const err61 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
else {
errors = _errs38;
if(vErrors !== null){
if(_errs38){
vErrors.length = _errs38;
}
else {
vErrors = null;
}
}
}
}
if(data.options !== undefined){
let data32 = data.options;
if(Array.isArray(data32)){
if(data32.length > 4){
const err62 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/allOf/0/maxItems",keyword:"maxItems",params:{limit: 4},message:"must NOT have more than 4 items"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
if(data32.length < 4){
const err63 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/allOf/0/minItems",keyword:"minItems",params:{limit: 4},message:"must NOT have fewer than 4 items"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
const len1 = data32.length;
if(len1 > 0){
let data33 = data32[0];
if(data33 && typeof data33 == "object" && !Array.isArray(data33)){
if(data33.key !== undefined){
if("A" !== data33.key){
const err64 = {instancePath:instancePath+"/options/0/key",schemaPath:"#/properties/options/allOf/0/prefixItems/0/properties/key/const",keyword:"const",params:{allowedValue: "A"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
}
}
if(len1 > 1){
let data35 = data32[1];
if(data35 && typeof data35 == "object" && !Array.isArray(data35)){
if(data35.key !== undefined){
if("B" !== data35.key){
const err65 = {instancePath:instancePath+"/options/1/key",schemaPath:"#/properties/options/allOf/0/prefixItems/1/properties/key/const",keyword:"const",params:{allowedValue: "B"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
}
}
}
if(len1 > 2){
let data37 = data32[2];
if(data37 && typeof data37 == "object" && !Array.isArray(data37)){
if(data37.key !== undefined){
if("C" !== data37.key){
const err66 = {instancePath:instancePath+"/options/2/key",schemaPath:"#/properties/options/allOf/0/prefixItems/2/properties/key/const",keyword:"const",params:{allowedValue: "C"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
}
}
if(len1 > 3){
let data39 = data32[3];
if(data39 && typeof data39 == "object" && !Array.isArray(data39)){
if(data39.key !== undefined){
if("D" !== data39.key){
const err67 = {instancePath:instancePath+"/options/3/key",schemaPath:"#/properties/options/allOf/0/prefixItems/3/properties/key/const",keyword:"const",params:{allowedValue: "D"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
}
}
}
if(Array.isArray(data32)){
if(data32.length > 4){
const err68 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/maxItems",keyword:"maxItems",params:{limit: 4},message:"must NOT have more than 4 items"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
if(data32.length < 4){
const err69 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/minItems",keyword:"minItems",params:{limit: 4},message:"must NOT have fewer than 4 items"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
const len2 = data32.length;
for(let i1=0; i1<len2; i1++){
let data41 = data32[i1];
if(data41 && typeof data41 == "object" && !Array.isArray(data41)){
if(data41.key === undefined){
const err70 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
if(data41.text === undefined){
const err71 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
if(data41.misconception_tag === undefined){
const err72 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/required",keyword:"required",params:{missingProperty: "misconception_tag"},message:"must have required property '"+"misconception_tag"+"'"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
for(const key5 in data41){
if(!(((key5 === "key") || (key5 === "text")) || (key5 === "misconception_tag"))){
const err73 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
}
if(data41.key !== undefined){
if(!(validate68(data41.key, {instancePath:instancePath+"/options/" + i1+"/key",parentData:data41,parentDataProperty:"key",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
if(data41.text !== undefined){
let data43 = data41.text;
if(typeof data43 === "string"){
if(func1(data43) > 200){
const err74 = {instancePath:instancePath+"/options/" + i1+"/text",schemaPath:"#/properties/options/items/properties/text/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
if(func1(data43) < 1){
const err75 = {instancePath:instancePath+"/options/" + i1+"/text",schemaPath:"#/properties/options/items/properties/text/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
}
else {
const err76 = {instancePath:instancePath+"/options/" + i1+"/text",schemaPath:"#/properties/options/items/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
}
if(data41.misconception_tag !== undefined){
let data44 = data41.misconception_tag;
const _errs93 = errors;
let valid28 = false;
let passing1 = null;
const _errs94 = errors;
if(data44 !== null){
const err77 = {instancePath:instancePath+"/options/" + i1+"/misconception_tag",schemaPath:"#/properties/options/items/properties/misconception_tag/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
var _valid4 = _errs94 === errors;
if(_valid4){
valid28 = true;
passing1 = 0;
}
const _errs96 = errors;
if(!(validate75(data44, {instancePath:instancePath+"/options/" + i1+"/misconception_tag",parentData:data41,parentDataProperty:"misconception_tag",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
errors = vErrors.length;
}
var _valid4 = _errs96 === errors;
if(_valid4 && valid28){
valid28 = false;
passing1 = [passing1, 1];
}
else {
if(_valid4){
valid28 = true;
passing1 = 1;
}
}
if(!valid28){
const err78 = {instancePath:instancePath+"/options/" + i1+"/misconception_tag",schemaPath:"#/properties/options/items/properties/misconception_tag/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
else {
errors = _errs93;
if(vErrors !== null){
if(_errs93){
vErrors.length = _errs93;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err79 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
const _errs97 = errors;
const len3 = data32.length;
let valid29 = false;
let count0 = 0;
for(let i2=0; i2<len3; i2++){
let data45 = data32[i2];
const _errs98 = errors;
if(data45 && typeof data45 == "object" && !Array.isArray(data45)){
if(data45.misconception_tag === undefined){
const err80 = {instancePath:instancePath+"/options/" + i2,schemaPath:"#/properties/options/contains/required",keyword:"required",params:{missingProperty: "misconception_tag"},message:"must have required property '"+"misconception_tag"+"'"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
if(data45.misconception_tag !== undefined){
if(data45.misconception_tag !== null){
const err81 = {instancePath:instancePath+"/options/" + i2+"/misconception_tag",schemaPath:"#/properties/options/contains/properties/misconception_tag/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
}
}
else {
const err82 = {instancePath:instancePath+"/options/" + i2,schemaPath:"#/properties/options/contains/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
var _valid5 = _errs98 === errors;
if(_valid5){
count0++;
if(count0 >= 2){
valid29 = true;
break;
}
}
}
if(!valid29){
const err83 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/contains",keyword:"contains",params:{minContains: 2},message:"must contain at least 2 valid item(s)"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
else {
errors = _errs97;
if(vErrors !== null){
if(_errs97){
vErrors.length = _errs97;
}
else {
vErrors = null;
}
}
}
}
else {
const err84 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
}
if(data.difficulty !== undefined){
if(!(validate69(data.difficulty, {instancePath:instancePath+"/difficulty",parentData:data,parentDataProperty:"difficulty",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data.source !== undefined){
let data48 = data.source;
if(!((((data48 === "template") || (data48 === "llm")) || (data48 === "instructor")) || (data48 === "diagnostic"))){
const err85 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/enum",keyword:"enum",params:{allowedValues: schema52.properties.source.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
}
if(data.template !== undefined){
let data49 = data.template;
if(data49 && typeof data49 == "object" && !Array.isArray(data49)){
for(const key6 in data49){
if(!((key6 === "id") || (key6 === "params"))){
const err86 = {instancePath:instancePath+"/template",schemaPath:"#/properties/template/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key6},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
}
if(data49.id !== undefined){
if(typeof data49.id !== "string"){
const err87 = {instancePath:instancePath+"/template/id",schemaPath:"#/properties/template/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
}
if(data49.params !== undefined){
let data51 = data49.params;
if(data51 && typeof data51 == "object" && !Array.isArray(data51)){
for(const key7 in data51){
if(!(validate125(data51[key7], {instancePath:instancePath+"/template/params/" + key7.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data51,parentDataProperty:key7,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate125.errors : vErrors.concat(validate125.errors);
errors = vErrors.length;
}
}
}
else {
const err88 = {instancePath:instancePath+"/template/params",schemaPath:"#/properties/template/properties/params/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
}
}
else {
const err89 = {instancePath:instancePath+"/template",schemaPath:"#/properties/template/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
}
if(data.verification !== undefined){
let data53 = data.verification;
if(data53 && typeof data53 == "object" && !Array.isArray(data53)){
if(data53.schema === undefined){
const err90 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "schema"},message:"must have required property '"+"schema"+"'"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
if(data53.sympy === undefined){
const err91 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "sympy"},message:"must have required property '"+"sympy"+"'"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
if(data53.render === undefined){
const err92 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "render"},message:"must have required property '"+"render"+"'"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
if(data53.vision === undefined){
const err93 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "vision"},message:"must have required property '"+"vision"+"'"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
if(data53.attempts === undefined){
const err94 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "attempts"},message:"must have required property '"+"attempts"+"'"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
if(data53.status === undefined){
const err95 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
for(const key8 in data53){
if(!(((((((key8 === "schema") || (key8 === "sympy")) || (key8 === "render")) || (key8 === "vision")) || (key8 === "attempts")) || (key8 === "status")) || (key8 === "review_note"))){
const err96 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key8},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
}
if(data53.schema !== undefined){
if(typeof data53.schema !== "boolean"){
const err97 = {instancePath:instancePath+"/verification/schema",schemaPath:"#/properties/verification/properties/schema/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
}
if(data53.sympy !== undefined){
let data55 = data53.sympy;
if(!((((data55 === "verified") || (data55 === "failed")) || (data55 === "not_applicable")) || (data55 === "pending"))){
const err98 = {instancePath:instancePath+"/verification/sympy",schemaPath:"#/properties/verification/properties/sympy/enum",keyword:"enum",params:{allowedValues: schema52.properties.verification.properties.sympy.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
}
if(data53.render !== undefined){
let data56 = data53.render;
if(!(((((data56 === "ok") || (data56 === "failed")) || (data56 === "size_mismatch")) || (data56 === "not_applicable")) || (data56 === "pending"))){
const err99 = {instancePath:instancePath+"/verification/render",schemaPath:"#/properties/verification/properties/render/enum",keyword:"enum",params:{allowedValues: schema52.properties.verification.properties.render.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
}
if(data53.vision !== undefined){
let data57 = data53.vision;
if(!(((((data57 === "match") || (data57 === "mismatch")) || (data57 === "not_applicable")) || (data57 === "pending")) || (data57 === "skipped"))){
const err100 = {instancePath:instancePath+"/verification/vision",schemaPath:"#/properties/verification/properties/vision/enum",keyword:"enum",params:{allowedValues: schema52.properties.verification.properties.vision.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
}
if(data53.attempts !== undefined){
let data58 = data53.attempts;
if(!(((typeof data58 == "number") && (!(data58 % 1) && !isNaN(data58))) && (isFinite(data58)))){
const err101 = {instancePath:instancePath+"/verification/attempts",schemaPath:"#/properties/verification/properties/attempts/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
if((typeof data58 == "number") && (isFinite(data58))){
if(data58 > 3 || isNaN(data58)){
const err102 = {instancePath:instancePath+"/verification/attempts",schemaPath:"#/properties/verification/properties/attempts/maximum",keyword:"maximum",params:{comparison: "<=", limit: 3},message:"must be <= 3"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
if(data58 < 0 || isNaN(data58)){
const err103 = {instancePath:instancePath+"/verification/attempts",schemaPath:"#/properties/verification/properties/attempts/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
}
}
if(data53.status !== undefined){
let data59 = data53.status;
if(!(((((data59 === "draft") || (data59 === "pending_review")) || (data59 === "approved")) || (data59 === "rejected")) || (data59 === "retired"))){
const err104 = {instancePath:instancePath+"/verification/status",schemaPath:"#/properties/verification/properties/status/enum",keyword:"enum",params:{allowedValues: schema52.properties.verification.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
}
if(data53.review_note !== undefined){
let data60 = data53.review_note;
if((typeof data60 !== "string") && (data60 !== null)){
const err105 = {instancePath:instancePath+"/verification/review_note",schemaPath:"#/properties/verification/properties/review_note/type",keyword:"type",params:{type: schema52.properties.verification.properties.review_note.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
}
}
else {
const err106 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
}
if(data.provenance !== undefined){
let data61 = data.provenance;
if(data61 && typeof data61 == "object" && !Array.isArray(data61)){
for(const key9 in data61){
if(!(((((key9 === "model") || (key9 === "cost_usd")) || (key9 === "prompt_version")) || (key9 === "prompt_hash")) || (key9 === "created_at"))){
const err107 = {instancePath:instancePath+"/provenance",schemaPath:"#/properties/provenance/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key9},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
}
}
if(data61.model !== undefined){
if(typeof data61.model !== "string"){
const err108 = {instancePath:instancePath+"/provenance/model",schemaPath:"#/properties/provenance/properties/model/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
}
if(data61.cost_usd !== undefined){
if(!(validate82(data61.cost_usd, {instancePath:instancePath+"/provenance/cost_usd",parentData:data61,parentDataProperty:"cost_usd",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
errors = vErrors.length;
}
}
if(data61.prompt_version !== undefined){
if(typeof data61.prompt_version !== "string"){
const err109 = {instancePath:instancePath+"/provenance/prompt_version",schemaPath:"#/properties/provenance/properties/prompt_version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
}
if(data61.prompt_hash !== undefined){
if(typeof data61.prompt_hash !== "string"){
const err110 = {instancePath:instancePath+"/provenance/prompt_hash",schemaPath:"#/properties/provenance/properties/prompt_hash/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
}
if(data61.created_at !== undefined){
if(!(validate66(data61.created_at, {instancePath:instancePath+"/provenance/created_at",parentData:data61,parentDataProperty:"created_at",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
errors = vErrors.length;
}
}
}
else {
const err111 = {instancePath:instancePath+"/provenance",schemaPath:"#/properties/provenance/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
}
}
}
else {
const err112 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err112];
}
else {
vErrors.push(err112);
}
errors++;
}
validate110.errors = vErrors;
return errors === 0;
}
validate110.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const researchOutput = validate242;
const schema84 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/research-output.json","title":"ResearchOutput","description":"Kitap araştırma çıktısı: her atıf Crossref'te doğrulanmış (verified) ya da DOI'siz kurumsal bağlantılı (no_doi); unresolved burada olamaz.","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","request_id","query","expanded_queries","synthesis","citations","matrix","removed","bibtex","apa","model","cost_usd"],"$defs":{"citation":{"type":"object","additionalProperties":false,"required":["ordinal","title","authors","year","crossref_status"],"properties":{"ordinal":{"type":"integer","minimum":1},"doi":{"type":"string","pattern":"^10\\.[0-9]{4,9}/\\S+$"},"title":{"type":"string"},"authors":{"type":"string"},"venue":{"type":["string","null"]},"year":{"type":"integer","minimum":1800,"maximum":2100},"crossref_status":{"enum":["verified","no_doi"]},"title_similarity":{"$ref":"common.json#/$defs/probability"},"verified_at":{"$ref":"common.json#/$defs/dateTime"},"oa_pdf_url":{"type":["string","null"],"format":"uri"},"tldr":{"type":["string","null"],"maxLength":240,"description":"Tek cümle; kaynağın iddiasını aşmaz"},"source":{"enum":["openalex","semantic_scholar","arxiv","crossref","manual"]}},"allOf":[{"if":{"properties":{"crossref_status":{"const":"verified"}}},"then":{"required":["doi","verified_at","title_similarity"],"properties":{"title_similarity":{"minimum":0.6}}}},{"if":{"properties":{"crossref_status":{"const":"no_doi"}}},"then":{"not":{"required":["doi"]}}}]}},"properties":{"schema_version":{"const":"1.0"},"request_id":{"$ref":"common.json#/$defs/uuid"},"query":{"type":"string"},"expanded_queries":{"type":"array","minItems":3,"maxItems":5,"items":{"type":"string"}},"synthesis":{"type":"array","minItems":1,"items":{"type":"object","additionalProperties":false,"required":["text","cites"],"properties":{"text":{"type":"string","maxLength":1200},"cites":{"type":"array","minItems":1,"items":{"type":"integer","minimum":1},"description":"citations[].ordinal — her paragraf en az bir doğrulanmış kaynağa bağlı; pipeline eşleşmeyen paragrafı atar"}}}},"citations":{"type":"array","items":{"$ref":"#/$defs/citation"},"description":"Yalnız verified veya no_doi; unresolved burada OLAMAZ (enum)"},"matrix":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["ordinal","method","sample","finding","limitation"],"properties":{"ordinal":{"type":"integer"},"method":{"type":"string"},"sample":{"type":"string"},"finding":{"type":"string"},"limitation":{"type":"string"}}}},"removed":{"type":"array","description":"Yalnız inceleme ekranı; öğrenciye gitmez","items":{"type":"object","additionalProperties":false,"required":["doi_or_title","reason"],"properties":{"doi_or_title":{"type":"string"},"reason":{"enum":["crossref_unresolved","title_mismatch","no_doi_no_link","duplicate","off_topic"]}}}},"bibtex":{"type":"string"},"apa":{"type":"array","items":{"type":"string"}},"model":{"type":"string"},"cost_usd":{"$ref":"common.json#/$defs/usd"}}};
const schema85 = {"type":"object","additionalProperties":false,"required":["ordinal","title","authors","year","crossref_status"],"properties":{"ordinal":{"type":"integer","minimum":1},"doi":{"type":"string","pattern":"^10\\.[0-9]{4,9}/\\S+$"},"title":{"type":"string"},"authors":{"type":"string"},"venue":{"type":["string","null"]},"year":{"type":"integer","minimum":1800,"maximum":2100},"crossref_status":{"enum":["verified","no_doi"]},"title_similarity":{"$ref":"common.json#/$defs/probability"},"verified_at":{"$ref":"common.json#/$defs/dateTime"},"oa_pdf_url":{"type":["string","null"],"format":"uri"},"tldr":{"type":["string","null"],"maxLength":240,"description":"Tek cümle; kaynağın iddiasını aşmaz"},"source":{"enum":["openalex","semantic_scholar","arxiv","crossref","manual"]}},"allOf":[{"if":{"properties":{"crossref_status":{"const":"verified"}}},"then":{"required":["doi","verified_at","title_similarity"],"properties":{"title_similarity":{"minimum":0.6}}}},{"if":{"properties":{"crossref_status":{"const":"no_doi"}}},"then":{"not":{"required":["doi"]}}}]};
const pattern41 = new RegExp("^10\\.[0-9]{4,9}/\\S+$", "u");

function validate244(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate244.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.crossref_status !== undefined){
if("verified" !== data.crossref_status){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.doi === undefined){
const err1 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "doi"},message:"must have required property '"+"doi"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.verified_at === undefined){
const err2 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "verified_at"},message:"must have required property '"+"verified_at"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.title_similarity === undefined){
const err3 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "title_similarity"},message:"must have required property '"+"title_similarity"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.title_similarity !== undefined){
let data1 = data.title_similarity;
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 < 0.6 || isNaN(data1)){
const err4 = {instancePath:instancePath+"/title_similarity",schemaPath:"#/allOf/0/then/properties/title_similarity/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.6},message:"must be >= 0.6"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.title_similarity = true;
props0.crossref_status = true;
}
}
if(!valid1){
const err5 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const _errs8 = errors;
let valid4 = true;
const _errs9 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.crossref_status !== undefined){
if("no_doi" !== data.crossref_status){
const err6 = {};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
var _valid1 = _errs9 === errors;
errors = _errs8;
if(vErrors !== null){
if(_errs8){
vErrors.length = _errs8;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs11 = errors;
const _errs12 = errors;
const _errs13 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.doi === undefined) && (missing0 = "doi")){
const err7 = {};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
var valid6 = _errs13 === errors;
if(valid6){
const err8 = {instancePath,schemaPath:"#/allOf/1/then/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
else {
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
}
var _valid1 = _errs11 === errors;
valid4 = _valid1;
}
if(!valid4){
const err9 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.crossref_status = true;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.ordinal === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ordinal"},message:"must have required property '"+"ordinal"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.title === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.authors === undefined){
const err12 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "authors"},message:"must have required property '"+"authors"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.year === undefined){
const err13 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "year"},message:"must have required property '"+"year"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.crossref_status === undefined){
const err14 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "crossref_status"},message:"must have required property '"+"crossref_status"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema85.properties, key0))){
const err15 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.ordinal !== undefined){
let data3 = data.ordinal;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err16 = {instancePath:instancePath+"/ordinal",schemaPath:"#/properties/ordinal/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 1 || isNaN(data3)){
const err17 = {instancePath:instancePath+"/ordinal",schemaPath:"#/properties/ordinal/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
if(data.doi !== undefined){
let data4 = data.doi;
if(typeof data4 === "string"){
if(!pattern41.test(data4)){
const err18 = {instancePath:instancePath+"/doi",schemaPath:"#/properties/doi/pattern",keyword:"pattern",params:{pattern: "^10\\.[0-9]{4,9}/\\S+$"},message:"must match pattern \""+"^10\\.[0-9]{4,9}/\\S+$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/doi",schemaPath:"#/properties/doi/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.title !== undefined){
if(typeof data.title !== "string"){
const err20 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.authors !== undefined){
if(typeof data.authors !== "string"){
const err21 = {instancePath:instancePath+"/authors",schemaPath:"#/properties/authors/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.venue !== undefined){
let data7 = data.venue;
if((typeof data7 !== "string") && (data7 !== null)){
const err22 = {instancePath:instancePath+"/venue",schemaPath:"#/properties/venue/type",keyword:"type",params:{type: schema85.properties.venue.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.year !== undefined){
let data8 = data.year;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err23 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 2100 || isNaN(data8)){
const err24 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/maximum",keyword:"maximum",params:{comparison: "<=", limit: 2100},message:"must be <= 2100"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data8 < 1800 || isNaN(data8)){
const err25 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1800},message:"must be >= 1800"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
}
if(data.crossref_status !== undefined){
let data9 = data.crossref_status;
if(!((data9 === "verified") || (data9 === "no_doi"))){
const err26 = {instancePath:instancePath+"/crossref_status",schemaPath:"#/properties/crossref_status/enum",keyword:"enum",params:{allowedValues: schema85.properties.crossref_status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.title_similarity !== undefined){
if(!(validate69(data.title_similarity, {instancePath:instancePath+"/title_similarity",parentData:data,parentDataProperty:"title_similarity",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data.verified_at !== undefined){
if(!(validate66(data.verified_at, {instancePath:instancePath+"/verified_at",parentData:data,parentDataProperty:"verified_at",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
errors = vErrors.length;
}
}
if(data.oa_pdf_url !== undefined){
let data12 = data.oa_pdf_url;
if((typeof data12 !== "string") && (data12 !== null)){
const err27 = {instancePath:instancePath+"/oa_pdf_url",schemaPath:"#/properties/oa_pdf_url/type",keyword:"type",params:{type: schema85.properties.oa_pdf_url.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(typeof data12 === "string"){
if(!(formats8(data12))){
const err28 = {instancePath:instancePath+"/oa_pdf_url",schemaPath:"#/properties/oa_pdf_url/format",keyword:"format",params:{format: "uri"},message:"must match format \""+"uri"+"\""};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
if(data.tldr !== undefined){
let data13 = data.tldr;
if((typeof data13 !== "string") && (data13 !== null)){
const err29 = {instancePath:instancePath+"/tldr",schemaPath:"#/properties/tldr/type",keyword:"type",params:{type: schema85.properties.tldr.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(typeof data13 === "string"){
if(func1(data13) > 240){
const err30 = {instancePath:instancePath+"/tldr",schemaPath:"#/properties/tldr/maxLength",keyword:"maxLength",params:{limit: 240},message:"must NOT have more than 240 characters"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
}
if(data.source !== undefined){
let data14 = data.source;
if(!(((((data14 === "openalex") || (data14 === "semantic_scholar")) || (data14 === "arxiv")) || (data14 === "crossref")) || (data14 === "manual"))){
const err31 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/enum",keyword:"enum",params:{allowedValues: schema85.properties.source.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
}
else {
const err32 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
validate244.errors = vErrors;
return errors === 0;
}
validate244.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate242(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/research-output.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate242.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.request_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "request_id"},message:"must have required property '"+"request_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.query === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "query"},message:"must have required property '"+"query"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.expanded_queries === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "expanded_queries"},message:"must have required property '"+"expanded_queries"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.synthesis === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "synthesis"},message:"must have required property '"+"synthesis"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.citations === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "citations"},message:"must have required property '"+"citations"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.matrix === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "matrix"},message:"must have required property '"+"matrix"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.removed === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "removed"},message:"must have required property '"+"removed"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.bibtex === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bibtex"},message:"must have required property '"+"bibtex"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.apa === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "apa"},message:"must have required property '"+"apa"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.model === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "model"},message:"must have required property '"+"model"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.cost_usd === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "cost_usd"},message:"must have required property '"+"cost_usd"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema84.properties, key0))){
const err12 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err13 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.request_id !== undefined){
if(!(validate83(data.request_id, {instancePath:instancePath+"/request_id",parentData:data,parentDataProperty:"request_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.query !== undefined){
if(typeof data.query !== "string"){
const err14 = {instancePath:instancePath+"/query",schemaPath:"#/properties/query/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.expanded_queries !== undefined){
let data3 = data.expanded_queries;
if(Array.isArray(data3)){
if(data3.length > 5){
const err15 = {instancePath:instancePath+"/expanded_queries",schemaPath:"#/properties/expanded_queries/maxItems",keyword:"maxItems",params:{limit: 5},message:"must NOT have more than 5 items"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data3.length < 3){
const err16 = {instancePath:instancePath+"/expanded_queries",schemaPath:"#/properties/expanded_queries/minItems",keyword:"minItems",params:{limit: 3},message:"must NOT have fewer than 3 items"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
const len0 = data3.length;
for(let i0=0; i0<len0; i0++){
if(typeof data3[i0] !== "string"){
const err17 = {instancePath:instancePath+"/expanded_queries/" + i0,schemaPath:"#/properties/expanded_queries/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
else {
const err18 = {instancePath:instancePath+"/expanded_queries",schemaPath:"#/properties/expanded_queries/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.synthesis !== undefined){
let data5 = data.synthesis;
if(Array.isArray(data5)){
if(data5.length < 1){
const err19 = {instancePath:instancePath+"/synthesis",schemaPath:"#/properties/synthesis/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
const len1 = data5.length;
for(let i1=0; i1<len1; i1++){
let data6 = data5[i1];
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
if(data6.text === undefined){
const err20 = {instancePath:instancePath+"/synthesis/" + i1,schemaPath:"#/properties/synthesis/items/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data6.cites === undefined){
const err21 = {instancePath:instancePath+"/synthesis/" + i1,schemaPath:"#/properties/synthesis/items/required",keyword:"required",params:{missingProperty: "cites"},message:"must have required property '"+"cites"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
for(const key1 in data6){
if(!((key1 === "text") || (key1 === "cites"))){
const err22 = {instancePath:instancePath+"/synthesis/" + i1,schemaPath:"#/properties/synthesis/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data6.text !== undefined){
let data7 = data6.text;
if(typeof data7 === "string"){
if(func1(data7) > 1200){
const err23 = {instancePath:instancePath+"/synthesis/" + i1+"/text",schemaPath:"#/properties/synthesis/items/properties/text/maxLength",keyword:"maxLength",params:{limit: 1200},message:"must NOT have more than 1200 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/synthesis/" + i1+"/text",schemaPath:"#/properties/synthesis/items/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data6.cites !== undefined){
let data8 = data6.cites;
if(Array.isArray(data8)){
if(data8.length < 1){
const err25 = {instancePath:instancePath+"/synthesis/" + i1+"/cites",schemaPath:"#/properties/synthesis/items/properties/cites/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
const len2 = data8.length;
for(let i2=0; i2<len2; i2++){
let data9 = data8[i2];
if(!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))){
const err26 = {instancePath:instancePath+"/synthesis/" + i1+"/cites/" + i2,schemaPath:"#/properties/synthesis/items/properties/cites/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 < 1 || isNaN(data9)){
const err27 = {instancePath:instancePath+"/synthesis/" + i1+"/cites/" + i2,schemaPath:"#/properties/synthesis/items/properties/cites/items/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
}
else {
const err28 = {instancePath:instancePath+"/synthesis/" + i1+"/cites",schemaPath:"#/properties/synthesis/items/properties/cites/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
else {
const err29 = {instancePath:instancePath+"/synthesis/" + i1,schemaPath:"#/properties/synthesis/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath:instancePath+"/synthesis",schemaPath:"#/properties/synthesis/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.citations !== undefined){
let data10 = data.citations;
if(Array.isArray(data10)){
const len3 = data10.length;
for(let i3=0; i3<len3; i3++){
if(!(validate244(data10[i3], {instancePath:instancePath+"/citations/" + i3,parentData:data10,parentDataProperty:i3,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate244.errors : vErrors.concat(validate244.errors);
errors = vErrors.length;
}
}
}
else {
const err31 = {instancePath:instancePath+"/citations",schemaPath:"#/properties/citations/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.matrix !== undefined){
let data12 = data.matrix;
if(Array.isArray(data12)){
const len4 = data12.length;
for(let i4=0; i4<len4; i4++){
let data13 = data12[i4];
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
if(data13.ordinal === undefined){
const err32 = {instancePath:instancePath+"/matrix/" + i4,schemaPath:"#/properties/matrix/items/required",keyword:"required",params:{missingProperty: "ordinal"},message:"must have required property '"+"ordinal"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data13.method === undefined){
const err33 = {instancePath:instancePath+"/matrix/" + i4,schemaPath:"#/properties/matrix/items/required",keyword:"required",params:{missingProperty: "method"},message:"must have required property '"+"method"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data13.sample === undefined){
const err34 = {instancePath:instancePath+"/matrix/" + i4,schemaPath:"#/properties/matrix/items/required",keyword:"required",params:{missingProperty: "sample"},message:"must have required property '"+"sample"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data13.finding === undefined){
const err35 = {instancePath:instancePath+"/matrix/" + i4,schemaPath:"#/properties/matrix/items/required",keyword:"required",params:{missingProperty: "finding"},message:"must have required property '"+"finding"+"'"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data13.limitation === undefined){
const err36 = {instancePath:instancePath+"/matrix/" + i4,schemaPath:"#/properties/matrix/items/required",keyword:"required",params:{missingProperty: "limitation"},message:"must have required property '"+"limitation"+"'"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
for(const key2 in data13){
if(!(((((key2 === "ordinal") || (key2 === "method")) || (key2 === "sample")) || (key2 === "finding")) || (key2 === "limitation"))){
const err37 = {instancePath:instancePath+"/matrix/" + i4,schemaPath:"#/properties/matrix/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data13.ordinal !== undefined){
let data14 = data13.ordinal;
if(!(((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14))) && (isFinite(data14)))){
const err38 = {instancePath:instancePath+"/matrix/" + i4+"/ordinal",schemaPath:"#/properties/matrix/items/properties/ordinal/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data13.method !== undefined){
if(typeof data13.method !== "string"){
const err39 = {instancePath:instancePath+"/matrix/" + i4+"/method",schemaPath:"#/properties/matrix/items/properties/method/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
if(data13.sample !== undefined){
if(typeof data13.sample !== "string"){
const err40 = {instancePath:instancePath+"/matrix/" + i4+"/sample",schemaPath:"#/properties/matrix/items/properties/sample/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
if(data13.finding !== undefined){
if(typeof data13.finding !== "string"){
const err41 = {instancePath:instancePath+"/matrix/" + i4+"/finding",schemaPath:"#/properties/matrix/items/properties/finding/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
if(data13.limitation !== undefined){
if(typeof data13.limitation !== "string"){
const err42 = {instancePath:instancePath+"/matrix/" + i4+"/limitation",schemaPath:"#/properties/matrix/items/properties/limitation/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
}
else {
const err43 = {instancePath:instancePath+"/matrix/" + i4,schemaPath:"#/properties/matrix/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
}
else {
const err44 = {instancePath:instancePath+"/matrix",schemaPath:"#/properties/matrix/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
if(data.removed !== undefined){
let data19 = data.removed;
if(Array.isArray(data19)){
const len5 = data19.length;
for(let i5=0; i5<len5; i5++){
let data20 = data19[i5];
if(data20 && typeof data20 == "object" && !Array.isArray(data20)){
if(data20.doi_or_title === undefined){
const err45 = {instancePath:instancePath+"/removed/" + i5,schemaPath:"#/properties/removed/items/required",keyword:"required",params:{missingProperty: "doi_or_title"},message:"must have required property '"+"doi_or_title"+"'"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(data20.reason === undefined){
const err46 = {instancePath:instancePath+"/removed/" + i5,schemaPath:"#/properties/removed/items/required",keyword:"required",params:{missingProperty: "reason"},message:"must have required property '"+"reason"+"'"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
for(const key3 in data20){
if(!((key3 === "doi_or_title") || (key3 === "reason"))){
const err47 = {instancePath:instancePath+"/removed/" + i5,schemaPath:"#/properties/removed/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
if(data20.doi_or_title !== undefined){
if(typeof data20.doi_or_title !== "string"){
const err48 = {instancePath:instancePath+"/removed/" + i5+"/doi_or_title",schemaPath:"#/properties/removed/items/properties/doi_or_title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
if(data20.reason !== undefined){
let data22 = data20.reason;
if(!(((((data22 === "crossref_unresolved") || (data22 === "title_mismatch")) || (data22 === "no_doi_no_link")) || (data22 === "duplicate")) || (data22 === "off_topic"))){
const err49 = {instancePath:instancePath+"/removed/" + i5+"/reason",schemaPath:"#/properties/removed/items/properties/reason/enum",keyword:"enum",params:{allowedValues: schema84.properties.removed.items.properties.reason.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
}
else {
const err50 = {instancePath:instancePath+"/removed/" + i5,schemaPath:"#/properties/removed/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
}
else {
const err51 = {instancePath:instancePath+"/removed",schemaPath:"#/properties/removed/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data.bibtex !== undefined){
if(typeof data.bibtex !== "string"){
const err52 = {instancePath:instancePath+"/bibtex",schemaPath:"#/properties/bibtex/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
if(data.apa !== undefined){
let data24 = data.apa;
if(Array.isArray(data24)){
const len6 = data24.length;
for(let i6=0; i6<len6; i6++){
if(typeof data24[i6] !== "string"){
const err53 = {instancePath:instancePath+"/apa/" + i6,schemaPath:"#/properties/apa/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
}
else {
const err54 = {instancePath:instancePath+"/apa",schemaPath:"#/properties/apa/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
if(data.model !== undefined){
if(typeof data.model !== "string"){
const err55 = {instancePath:instancePath+"/model",schemaPath:"#/properties/model/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
if(data.cost_usd !== undefined){
if(!(validate82(data.cost_usd, {instancePath:instancePath+"/cost_usd",parentData:data,parentDataProperty:"cost_usd",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
errors = vErrors.length;
}
}
}
else {
const err56 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
validate242.errors = vErrors;
return errors === 0;
}
validate242.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const researchOutputCitation = validate249;

function validate249(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate249.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.crossref_status !== undefined){
if("verified" !== data.crossref_status){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.doi === undefined){
const err1 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "doi"},message:"must have required property '"+"doi"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.verified_at === undefined){
const err2 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "verified_at"},message:"must have required property '"+"verified_at"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.title_similarity === undefined){
const err3 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "title_similarity"},message:"must have required property '"+"title_similarity"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.title_similarity !== undefined){
let data1 = data.title_similarity;
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 < 0.6 || isNaN(data1)){
const err4 = {instancePath:instancePath+"/title_similarity",schemaPath:"#/allOf/0/then/properties/title_similarity/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0.6},message:"must be >= 0.6"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
if(valid1){
var props0 = {};
props0.title_similarity = true;
props0.crossref_status = true;
}
}
if(!valid1){
const err5 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const _errs8 = errors;
let valid4 = true;
const _errs9 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.crossref_status !== undefined){
if("no_doi" !== data.crossref_status){
const err6 = {};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
var _valid1 = _errs9 === errors;
errors = _errs8;
if(vErrors !== null){
if(_errs8){
vErrors.length = _errs8;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs11 = errors;
const _errs12 = errors;
const _errs13 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.doi === undefined) && (missing0 = "doi")){
const err7 = {};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
var valid6 = _errs13 === errors;
if(valid6){
const err8 = {instancePath,schemaPath:"#/allOf/1/then/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
else {
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
}
var _valid1 = _errs11 === errors;
valid4 = _valid1;
}
if(!valid4){
const err9 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.crossref_status = true;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.ordinal === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ordinal"},message:"must have required property '"+"ordinal"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.title === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.authors === undefined){
const err12 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "authors"},message:"must have required property '"+"authors"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.year === undefined){
const err13 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "year"},message:"must have required property '"+"year"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.crossref_status === undefined){
const err14 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "crossref_status"},message:"must have required property '"+"crossref_status"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema85.properties, key0))){
const err15 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.ordinal !== undefined){
let data3 = data.ordinal;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err16 = {instancePath:instancePath+"/ordinal",schemaPath:"#/properties/ordinal/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 1 || isNaN(data3)){
const err17 = {instancePath:instancePath+"/ordinal",schemaPath:"#/properties/ordinal/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
if(data.doi !== undefined){
let data4 = data.doi;
if(typeof data4 === "string"){
if(!pattern41.test(data4)){
const err18 = {instancePath:instancePath+"/doi",schemaPath:"#/properties/doi/pattern",keyword:"pattern",params:{pattern: "^10\\.[0-9]{4,9}/\\S+$"},message:"must match pattern \""+"^10\\.[0-9]{4,9}/\\S+$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/doi",schemaPath:"#/properties/doi/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.title !== undefined){
if(typeof data.title !== "string"){
const err20 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.authors !== undefined){
if(typeof data.authors !== "string"){
const err21 = {instancePath:instancePath+"/authors",schemaPath:"#/properties/authors/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.venue !== undefined){
let data7 = data.venue;
if((typeof data7 !== "string") && (data7 !== null)){
const err22 = {instancePath:instancePath+"/venue",schemaPath:"#/properties/venue/type",keyword:"type",params:{type: schema85.properties.venue.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.year !== undefined){
let data8 = data.year;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err23 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 2100 || isNaN(data8)){
const err24 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/maximum",keyword:"maximum",params:{comparison: "<=", limit: 2100},message:"must be <= 2100"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data8 < 1800 || isNaN(data8)){
const err25 = {instancePath:instancePath+"/year",schemaPath:"#/properties/year/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1800},message:"must be >= 1800"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
}
if(data.crossref_status !== undefined){
let data9 = data.crossref_status;
if(!((data9 === "verified") || (data9 === "no_doi"))){
const err26 = {instancePath:instancePath+"/crossref_status",schemaPath:"#/properties/crossref_status/enum",keyword:"enum",params:{allowedValues: schema85.properties.crossref_status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.title_similarity !== undefined){
if(!(validate69(data.title_similarity, {instancePath:instancePath+"/title_similarity",parentData:data,parentDataProperty:"title_similarity",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data.verified_at !== undefined){
if(!(validate66(data.verified_at, {instancePath:instancePath+"/verified_at",parentData:data,parentDataProperty:"verified_at",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
errors = vErrors.length;
}
}
if(data.oa_pdf_url !== undefined){
let data12 = data.oa_pdf_url;
if((typeof data12 !== "string") && (data12 !== null)){
const err27 = {instancePath:instancePath+"/oa_pdf_url",schemaPath:"#/properties/oa_pdf_url/type",keyword:"type",params:{type: schema85.properties.oa_pdf_url.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(typeof data12 === "string"){
if(!(formats8(data12))){
const err28 = {instancePath:instancePath+"/oa_pdf_url",schemaPath:"#/properties/oa_pdf_url/format",keyword:"format",params:{format: "uri"},message:"must match format \""+"uri"+"\""};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
if(data.tldr !== undefined){
let data13 = data.tldr;
if((typeof data13 !== "string") && (data13 !== null)){
const err29 = {instancePath:instancePath+"/tldr",schemaPath:"#/properties/tldr/type",keyword:"type",params:{type: schema85.properties.tldr.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(typeof data13 === "string"){
if(func1(data13) > 240){
const err30 = {instancePath:instancePath+"/tldr",schemaPath:"#/properties/tldr/maxLength",keyword:"maxLength",params:{limit: 240},message:"must NOT have more than 240 characters"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
}
if(data.source !== undefined){
let data14 = data.source;
if(!(((((data14 === "openalex") || (data14 === "semantic_scholar")) || (data14 === "arxiv")) || (data14 === "crossref")) || (data14 === "manual"))){
const err31 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/enum",keyword:"enum",params:{allowedValues: schema85.properties.source.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
}
else {
const err32 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
validate249.errors = vErrors;
return errors === 0;
}
validate249.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdate = validate252;
const schema87 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/telegram-update.json","title":"TelegramUpdate","description":"Sahte Telegram (fixtures/telegram, Worker testleri) için daraltılmış Bot API Update nesnesi: message, edited_message, callback_query, my_chat_member, chat_member (setWebhook allowed_updates ile aynı küme). Tam olarak bir olay alanı taşır. YALNIZ sahte/fikstür güncellemelerini doğrular: gerçek Bot API güncellemeleri burada tanımsız alanlar taşır (link_preview_options, sticker, quote, external_reply, chat.photo …); Worker canlı webhook güncellemesini bu şemayla REDDETMEZ, yalnız kullandığı alanları okur.","x-version":"1.0","type":"object","additionalProperties":false,"required":["update_id"],"properties":{"update_id":{"type":"integer","minimum":0},"message":{"$ref":"#/$defs/message"},"edited_message":{"$ref":"#/$defs/message"},"callback_query":{"$ref":"#/$defs/callbackQuery"},"my_chat_member":{"$ref":"#/$defs/chatMemberUpdated"},"chat_member":{"$ref":"#/$defs/chatMemberUpdated"}},"oneOf":[{"required":["message"]},{"required":["edited_message"]},{"required":["callback_query"]},{"required":["my_chat_member"]},{"required":["chat_member"]}],"$defs":{"user":{"type":"object","additionalProperties":false,"required":["id","is_bot","first_name"],"description":"Telegram User (alt küme). first_name/last_name yalnız resolve_telegram'a gider.","properties":{"id":{"type":"integer"},"is_bot":{"type":"boolean"},"first_name":{"type":"string"},"last_name":{"type":"string"},"username":{"type":"string"},"language_code":{"type":"string"},"is_premium":{"type":"boolean"},"added_to_attachment_menu":{"type":"boolean"},"can_join_groups":{"type":"boolean"},"can_read_all_group_messages":{"type":"boolean"},"supports_inline_queries":{"type":"boolean"},"can_connect_to_business":{"type":"boolean"},"has_main_web_app":{"type":"boolean"}}},"chat":{"type":"object","additionalProperties":false,"required":["id","type"],"properties":{"id":{"type":"integer"},"type":{"enum":["private","group","supergroup","channel"]},"title":{"type":"string"},"username":{"type":"string"},"first_name":{"type":"string"},"last_name":{"type":"string"},"is_forum":{"type":"boolean"},"all_members_are_administrators":{"type":"boolean"}}},"entity":{"type":"object","additionalProperties":false,"required":["type","offset","length"],"properties":{"type":{"type":"string"},"offset":{"type":"integer","minimum":0},"length":{"type":"integer","minimum":0},"url":{"type":"string"},"user":{"$ref":"#/$defs/user"},"language":{"type":"string"},"custom_emoji_id":{"type":"string"}}},"voice":{"type":"object","additionalProperties":false,"required":["file_id","file_unique_id","duration"],"properties":{"file_id":{"type":"string"},"file_unique_id":{"type":"string"},"file_size":{"type":"integer","minimum":0},"duration":{"type":"integer","minimum":0},"mime_type":{"type":"string"}}},"audio":{"type":"object","additionalProperties":false,"required":["file_id","file_unique_id","duration"],"properties":{"file_id":{"type":"string"},"file_unique_id":{"type":"string"},"file_size":{"type":"integer","minimum":0},"duration":{"type":"integer","minimum":0},"mime_type":{"type":"string"},"performer":{"type":"string"},"title":{"type":"string"},"file_name":{"type":"string"}}},"photoSize":{"type":"object","additionalProperties":false,"required":["file_id","file_unique_id","width","height"],"properties":{"file_id":{"type":"string"},"file_unique_id":{"type":"string"},"file_size":{"type":"integer","minimum":0},"width":{"type":"integer"},"height":{"type":"integer"}}},"document":{"type":"object","additionalProperties":false,"required":["file_id","file_unique_id"],"properties":{"file_id":{"type":"string"},"file_unique_id":{"type":"string"},"file_size":{"type":"integer","minimum":0},"file_name":{"type":"string"},"mime_type":{"type":"string"}}},"inlineButton":{"type":"object","additionalProperties":false,"required":["text"],"properties":{"text":{"type":"string"},"callback_data":{"type":"string"},"url":{"type":"string"}}},"inlineKeyboardMarkup":{"type":"object","additionalProperties":false,"required":["inline_keyboard"],"properties":{"inline_keyboard":{"type":"array","items":{"type":"array","items":{"$ref":"#/$defs/inlineButton"}}}}},"message":{"type":"object","additionalProperties":false,"required":["message_id","date","chat"],"properties":{"message_id":{"type":"integer"},"message_thread_id":{"type":"integer"},"from":{"$ref":"#/$defs/user"},"sender_chat":{"$ref":"#/$defs/chat"},"date":{"type":"integer","description":"Unix zamanı (saniye)"},"edit_date":{"type":"integer"},"chat":{"$ref":"#/$defs/chat"},"is_topic_message":{"type":"boolean"},"is_automatic_forward":{"type":"boolean"},"has_protected_content":{"type":"boolean"},"forward_origin":{"type":"object","additionalProperties":false,"required":["type","date"],"properties":{"type":{"type":"string"},"date":{"type":"integer"}}},"via_bot":{"$ref":"#/$defs/user"},"media_group_id":{"type":"string"},"author_signature":{"type":"string"},"text":{"type":"string"},"entities":{"type":"array","items":{"$ref":"#/$defs/entity"}},"caption":{"type":"string"},"caption_entities":{"type":"array","items":{"$ref":"#/$defs/entity"}},"voice":{"$ref":"#/$defs/voice"},"audio":{"$ref":"#/$defs/audio"},"photo":{"type":"array","items":{"$ref":"#/$defs/photoSize"}},"document":{"$ref":"#/$defs/document"},"new_chat_members":{"type":"array","items":{"$ref":"#/$defs/user"}},"left_chat_member":{"$ref":"#/$defs/user"},"new_chat_title":{"type":"string"},"group_chat_created":{"type":"boolean"},"supergroup_chat_created":{"type":"boolean"},"migrate_to_chat_id":{"type":"integer"},"migrate_from_chat_id":{"type":"integer"},"pinned_message":{"$ref":"#/$defs/replyMessage"},"reply_markup":{"$ref":"#/$defs/inlineKeyboardMarkup"},"reply_to_message":{"$ref":"#/$defs/replyMessage","description":"Telegram yanıtlanan mesajda reply_to_message'ı tekrar etmez"}}},"replyMessage":{"type":"object","additionalProperties":false,"required":["message_id","date","chat"],"properties":{"message_id":{"type":"integer"},"message_thread_id":{"type":"integer"},"from":{"$ref":"#/$defs/user"},"sender_chat":{"$ref":"#/$defs/chat"},"date":{"type":"integer","description":"Unix zamanı (saniye)"},"edit_date":{"type":"integer"},"chat":{"$ref":"#/$defs/chat"},"is_topic_message":{"type":"boolean"},"is_automatic_forward":{"type":"boolean"},"has_protected_content":{"type":"boolean"},"forward_origin":{"type":"object","additionalProperties":false,"required":["type","date"],"properties":{"type":{"type":"string"},"date":{"type":"integer"}}},"via_bot":{"$ref":"#/$defs/user"},"media_group_id":{"type":"string"},"author_signature":{"type":"string"},"text":{"type":"string"},"entities":{"type":"array","items":{"$ref":"#/$defs/entity"}},"caption":{"type":"string"},"caption_entities":{"type":"array","items":{"$ref":"#/$defs/entity"}},"voice":{"$ref":"#/$defs/voice"},"audio":{"$ref":"#/$defs/audio"},"photo":{"type":"array","items":{"$ref":"#/$defs/photoSize"}},"document":{"$ref":"#/$defs/document"},"new_chat_members":{"type":"array","items":{"$ref":"#/$defs/user"}},"left_chat_member":{"$ref":"#/$defs/user"},"new_chat_title":{"type":"string"},"group_chat_created":{"type":"boolean"},"supergroup_chat_created":{"type":"boolean"},"migrate_to_chat_id":{"type":"integer"},"migrate_from_chat_id":{"type":"integer"},"reply_markup":{"$ref":"#/$defs/inlineKeyboardMarkup"}},"description":"Yanıtlanan/sabitlenen mesaj (iç içe reply_to_message yok; şema özyinelemesizdir)"},"callbackQuery":{"type":"object","additionalProperties":false,"required":["id","from","chat_instance"],"properties":{"id":{"type":"string"},"from":{"$ref":"#/$defs/user"},"message":{"$ref":"#/$defs/replyMessage"},"inline_message_id":{"type":"string"},"chat_instance":{"type":"string"},"data":{"type":"string","maxLength":64,"description":"ans:<session>:<question>:<key> | hint:<question> | human:<message_id> | consent:<kind>:<yes|no> | diag:continue|later"}}},"chatMember":{"type":"object","additionalProperties":false,"required":["status","user"],"description":"ChatMember (owner/administrator/member/restricted/left/kicked birleşik alt kümesi)","properties":{"status":{"enum":["creator","administrator","member","restricted","left","kicked"]},"user":{"$ref":"#/$defs/user"},"is_anonymous":{"type":"boolean"},"custom_title":{"type":"string"},"until_date":{"type":"integer"},"is_member":{"type":"boolean"},"can_be_edited":{"type":"boolean"},"can_manage_chat":{"type":"boolean"},"can_delete_messages":{"type":"boolean"},"can_manage_video_chats":{"type":"boolean"},"can_restrict_members":{"type":"boolean"},"can_promote_members":{"type":"boolean"},"can_change_info":{"type":"boolean"},"can_invite_users":{"type":"boolean"},"can_post_messages":{"type":"boolean"},"can_edit_messages":{"type":"boolean"},"can_pin_messages":{"type":"boolean"},"can_manage_topics":{"type":"boolean"},"can_post_stories":{"type":"boolean"},"can_edit_stories":{"type":"boolean"},"can_delete_stories":{"type":"boolean"},"can_send_messages":{"type":"boolean"},"can_send_audios":{"type":"boolean"},"can_send_documents":{"type":"boolean"},"can_send_photos":{"type":"boolean"},"can_send_videos":{"type":"boolean"},"can_send_video_notes":{"type":"boolean"},"can_send_voice_notes":{"type":"boolean"},"can_send_polls":{"type":"boolean"},"can_send_other_messages":{"type":"boolean"},"can_add_web_page_previews":{"type":"boolean"}}},"chatMemberUpdated":{"type":"object","additionalProperties":false,"required":["chat","from","date","old_chat_member","new_chat_member"],"properties":{"chat":{"$ref":"#/$defs/chat"},"from":{"$ref":"#/$defs/user"},"date":{"type":"integer"},"old_chat_member":{"$ref":"#/$defs/chatMember"},"new_chat_member":{"$ref":"#/$defs/chatMember"},"via_join_request":{"type":"boolean"},"via_chat_folder_invite_link":{"type":"boolean"}}}}};
const schema88 = {"type":"object","additionalProperties":false,"required":["message_id","date","chat"],"properties":{"message_id":{"type":"integer"},"message_thread_id":{"type":"integer"},"from":{"$ref":"#/$defs/user"},"sender_chat":{"$ref":"#/$defs/chat"},"date":{"type":"integer","description":"Unix zamanı (saniye)"},"edit_date":{"type":"integer"},"chat":{"$ref":"#/$defs/chat"},"is_topic_message":{"type":"boolean"},"is_automatic_forward":{"type":"boolean"},"has_protected_content":{"type":"boolean"},"forward_origin":{"type":"object","additionalProperties":false,"required":["type","date"],"properties":{"type":{"type":"string"},"date":{"type":"integer"}}},"via_bot":{"$ref":"#/$defs/user"},"media_group_id":{"type":"string"},"author_signature":{"type":"string"},"text":{"type":"string"},"entities":{"type":"array","items":{"$ref":"#/$defs/entity"}},"caption":{"type":"string"},"caption_entities":{"type":"array","items":{"$ref":"#/$defs/entity"}},"voice":{"$ref":"#/$defs/voice"},"audio":{"$ref":"#/$defs/audio"},"photo":{"type":"array","items":{"$ref":"#/$defs/photoSize"}},"document":{"$ref":"#/$defs/document"},"new_chat_members":{"type":"array","items":{"$ref":"#/$defs/user"}},"left_chat_member":{"$ref":"#/$defs/user"},"new_chat_title":{"type":"string"},"group_chat_created":{"type":"boolean"},"supergroup_chat_created":{"type":"boolean"},"migrate_to_chat_id":{"type":"integer"},"migrate_from_chat_id":{"type":"integer"},"pinned_message":{"$ref":"#/$defs/replyMessage"},"reply_markup":{"$ref":"#/$defs/inlineKeyboardMarkup"},"reply_to_message":{"$ref":"#/$defs/replyMessage","description":"Telegram yanıtlanan mesajda reply_to_message'ı tekrar etmez"}}};
const schema89 = {"type":"object","additionalProperties":false,"required":["id","is_bot","first_name"],"description":"Telegram User (alt küme). first_name/last_name yalnız resolve_telegram'a gider.","properties":{"id":{"type":"integer"},"is_bot":{"type":"boolean"},"first_name":{"type":"string"},"last_name":{"type":"string"},"username":{"type":"string"},"language_code":{"type":"string"},"is_premium":{"type":"boolean"},"added_to_attachment_menu":{"type":"boolean"},"can_join_groups":{"type":"boolean"},"can_read_all_group_messages":{"type":"boolean"},"supports_inline_queries":{"type":"boolean"},"can_connect_to_business":{"type":"boolean"},"has_main_web_app":{"type":"boolean"}}};

function validate254(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate254.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.is_bot === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "is_bot"},message:"must have required property '"+"is_bot"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.first_name === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "first_name"},message:"must have required property '"+"first_name"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema89.properties, key0))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err4 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.is_bot !== undefined){
if(typeof data.is_bot !== "boolean"){
const err5 = {instancePath:instancePath+"/is_bot",schemaPath:"#/properties/is_bot/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.first_name !== undefined){
if(typeof data.first_name !== "string"){
const err6 = {instancePath:instancePath+"/first_name",schemaPath:"#/properties/first_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.last_name !== undefined){
if(typeof data.last_name !== "string"){
const err7 = {instancePath:instancePath+"/last_name",schemaPath:"#/properties/last_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.username !== undefined){
if(typeof data.username !== "string"){
const err8 = {instancePath:instancePath+"/username",schemaPath:"#/properties/username/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.language_code !== undefined){
if(typeof data.language_code !== "string"){
const err9 = {instancePath:instancePath+"/language_code",schemaPath:"#/properties/language_code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.is_premium !== undefined){
if(typeof data.is_premium !== "boolean"){
const err10 = {instancePath:instancePath+"/is_premium",schemaPath:"#/properties/is_premium/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.added_to_attachment_menu !== undefined){
if(typeof data.added_to_attachment_menu !== "boolean"){
const err11 = {instancePath:instancePath+"/added_to_attachment_menu",schemaPath:"#/properties/added_to_attachment_menu/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.can_join_groups !== undefined){
if(typeof data.can_join_groups !== "boolean"){
const err12 = {instancePath:instancePath+"/can_join_groups",schemaPath:"#/properties/can_join_groups/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.can_read_all_group_messages !== undefined){
if(typeof data.can_read_all_group_messages !== "boolean"){
const err13 = {instancePath:instancePath+"/can_read_all_group_messages",schemaPath:"#/properties/can_read_all_group_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.supports_inline_queries !== undefined){
if(typeof data.supports_inline_queries !== "boolean"){
const err14 = {instancePath:instancePath+"/supports_inline_queries",schemaPath:"#/properties/supports_inline_queries/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.can_connect_to_business !== undefined){
if(typeof data.can_connect_to_business !== "boolean"){
const err15 = {instancePath:instancePath+"/can_connect_to_business",schemaPath:"#/properties/can_connect_to_business/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.has_main_web_app !== undefined){
if(typeof data.has_main_web_app !== "boolean"){
const err16 = {instancePath:instancePath+"/has_main_web_app",schemaPath:"#/properties/has_main_web_app/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
validate254.errors = vErrors;
return errors === 0;
}
validate254.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema90 = {"type":"object","additionalProperties":false,"required":["id","type"],"properties":{"id":{"type":"integer"},"type":{"enum":["private","group","supergroup","channel"]},"title":{"type":"string"},"username":{"type":"string"},"first_name":{"type":"string"},"last_name":{"type":"string"},"is_forum":{"type":"boolean"},"all_members_are_administrators":{"type":"boolean"}}};

function validate256(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate256.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.type === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "id") || (key0 === "type")) || (key0 === "title")) || (key0 === "username")) || (key0 === "first_name")) || (key0 === "last_name")) || (key0 === "is_forum")) || (key0 === "all_members_are_administrators"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err3 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.type !== undefined){
let data1 = data.type;
if(!((((data1 === "private") || (data1 === "group")) || (data1 === "supergroup")) || (data1 === "channel"))){
const err4 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/enum",keyword:"enum",params:{allowedValues: schema90.properties.type.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.title !== undefined){
if(typeof data.title !== "string"){
const err5 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.username !== undefined){
if(typeof data.username !== "string"){
const err6 = {instancePath:instancePath+"/username",schemaPath:"#/properties/username/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.first_name !== undefined){
if(typeof data.first_name !== "string"){
const err7 = {instancePath:instancePath+"/first_name",schemaPath:"#/properties/first_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.last_name !== undefined){
if(typeof data.last_name !== "string"){
const err8 = {instancePath:instancePath+"/last_name",schemaPath:"#/properties/last_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.is_forum !== undefined){
if(typeof data.is_forum !== "boolean"){
const err9 = {instancePath:instancePath+"/is_forum",schemaPath:"#/properties/is_forum/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.all_members_are_administrators !== undefined){
if(typeof data.all_members_are_administrators !== "boolean"){
const err10 = {instancePath:instancePath+"/all_members_are_administrators",schemaPath:"#/properties/all_members_are_administrators/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate256.errors = vErrors;
return errors === 0;
}
validate256.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema91 = {"type":"object","additionalProperties":false,"required":["type","offset","length"],"properties":{"type":{"type":"string"},"offset":{"type":"integer","minimum":0},"length":{"type":"integer","minimum":0},"url":{"type":"string"},"user":{"$ref":"#/$defs/user"},"language":{"type":"string"},"custom_emoji_id":{"type":"string"}}};

function validate260(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate260.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.type === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.offset === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "offset"},message:"must have required property '"+"offset"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.length === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "length"},message:"must have required property '"+"length"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "type") || (key0 === "offset")) || (key0 === "length")) || (key0 === "url")) || (key0 === "user")) || (key0 === "language")) || (key0 === "custom_emoji_id"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.type !== undefined){
if(typeof data.type !== "string"){
const err4 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.offset !== undefined){
let data1 = data.offset;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err5 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 < 0 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
if(data.length !== undefined){
let data2 = data.length;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err7 = {instancePath:instancePath+"/length",schemaPath:"#/properties/length/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err8 = {instancePath:instancePath+"/length",schemaPath:"#/properties/length/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.url !== undefined){
if(typeof data.url !== "string"){
const err9 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.user !== undefined){
if(!(validate254(data.user, {instancePath:instancePath+"/user",parentData:data,parentDataProperty:"user",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.language !== undefined){
if(typeof data.language !== "string"){
const err10 = {instancePath:instancePath+"/language",schemaPath:"#/properties/language/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.custom_emoji_id !== undefined){
if(typeof data.custom_emoji_id !== "string"){
const err11 = {instancePath:instancePath+"/custom_emoji_id",schemaPath:"#/properties/custom_emoji_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate260.errors = vErrors;
return errors === 0;
}
validate260.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema92 = {"type":"object","additionalProperties":false,"required":["file_id","file_unique_id","duration"],"properties":{"file_id":{"type":"string"},"file_unique_id":{"type":"string"},"file_size":{"type":"integer","minimum":0},"duration":{"type":"integer","minimum":0},"mime_type":{"type":"string"}}};

function validate264(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate264.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.file_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_id"},message:"must have required property '"+"file_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.file_unique_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_unique_id"},message:"must have required property '"+"file_unique_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.duration === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "duration"},message:"must have required property '"+"duration"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "file_id") || (key0 === "file_unique_id")) || (key0 === "file_size")) || (key0 === "duration")) || (key0 === "mime_type"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.file_id !== undefined){
if(typeof data.file_id !== "string"){
const err4 = {instancePath:instancePath+"/file_id",schemaPath:"#/properties/file_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.file_unique_id !== undefined){
if(typeof data.file_unique_id !== "string"){
const err5 = {instancePath:instancePath+"/file_unique_id",schemaPath:"#/properties/file_unique_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.file_size !== undefined){
let data2 = data.file_size;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err6 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err7 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.duration !== undefined){
let data3 = data.duration;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err8 = {instancePath:instancePath+"/duration",schemaPath:"#/properties/duration/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err9 = {instancePath:instancePath+"/duration",schemaPath:"#/properties/duration/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.mime_type !== undefined){
if(typeof data.mime_type !== "string"){
const err10 = {instancePath:instancePath+"/mime_type",schemaPath:"#/properties/mime_type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate264.errors = vErrors;
return errors === 0;
}
validate264.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema93 = {"type":"object","additionalProperties":false,"required":["file_id","file_unique_id","duration"],"properties":{"file_id":{"type":"string"},"file_unique_id":{"type":"string"},"file_size":{"type":"integer","minimum":0},"duration":{"type":"integer","minimum":0},"mime_type":{"type":"string"},"performer":{"type":"string"},"title":{"type":"string"},"file_name":{"type":"string"}}};

function validate266(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate266.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.file_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_id"},message:"must have required property '"+"file_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.file_unique_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_unique_id"},message:"must have required property '"+"file_unique_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.duration === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "duration"},message:"must have required property '"+"duration"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "file_id") || (key0 === "file_unique_id")) || (key0 === "file_size")) || (key0 === "duration")) || (key0 === "mime_type")) || (key0 === "performer")) || (key0 === "title")) || (key0 === "file_name"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.file_id !== undefined){
if(typeof data.file_id !== "string"){
const err4 = {instancePath:instancePath+"/file_id",schemaPath:"#/properties/file_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.file_unique_id !== undefined){
if(typeof data.file_unique_id !== "string"){
const err5 = {instancePath:instancePath+"/file_unique_id",schemaPath:"#/properties/file_unique_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.file_size !== undefined){
let data2 = data.file_size;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err6 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err7 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.duration !== undefined){
let data3 = data.duration;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err8 = {instancePath:instancePath+"/duration",schemaPath:"#/properties/duration/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err9 = {instancePath:instancePath+"/duration",schemaPath:"#/properties/duration/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.mime_type !== undefined){
if(typeof data.mime_type !== "string"){
const err10 = {instancePath:instancePath+"/mime_type",schemaPath:"#/properties/mime_type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.performer !== undefined){
if(typeof data.performer !== "string"){
const err11 = {instancePath:instancePath+"/performer",schemaPath:"#/properties/performer/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.title !== undefined){
if(typeof data.title !== "string"){
const err12 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.file_name !== undefined){
if(typeof data.file_name !== "string"){
const err13 = {instancePath:instancePath+"/file_name",schemaPath:"#/properties/file_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
else {
const err14 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
validate266.errors = vErrors;
return errors === 0;
}
validate266.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema94 = {"type":"object","additionalProperties":false,"required":["file_id","file_unique_id","width","height"],"properties":{"file_id":{"type":"string"},"file_unique_id":{"type":"string"},"file_size":{"type":"integer","minimum":0},"width":{"type":"integer"},"height":{"type":"integer"}}};

function validate268(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate268.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.file_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_id"},message:"must have required property '"+"file_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.file_unique_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_unique_id"},message:"must have required property '"+"file_unique_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.width === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "width"},message:"must have required property '"+"width"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.height === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "height"},message:"must have required property '"+"height"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "file_id") || (key0 === "file_unique_id")) || (key0 === "file_size")) || (key0 === "width")) || (key0 === "height"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.file_id !== undefined){
if(typeof data.file_id !== "string"){
const err5 = {instancePath:instancePath+"/file_id",schemaPath:"#/properties/file_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.file_unique_id !== undefined){
if(typeof data.file_unique_id !== "string"){
const err6 = {instancePath:instancePath+"/file_unique_id",schemaPath:"#/properties/file_unique_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.file_size !== undefined){
let data2 = data.file_size;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err7 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err8 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.width !== undefined){
let data3 = data.width;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err9 = {instancePath:instancePath+"/width",schemaPath:"#/properties/width/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.height !== undefined){
let data4 = data.height;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err10 = {instancePath:instancePath+"/height",schemaPath:"#/properties/height/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate268.errors = vErrors;
return errors === 0;
}
validate268.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema95 = {"type":"object","additionalProperties":false,"required":["file_id","file_unique_id"],"properties":{"file_id":{"type":"string"},"file_unique_id":{"type":"string"},"file_size":{"type":"integer","minimum":0},"file_name":{"type":"string"},"mime_type":{"type":"string"}}};

function validate270(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate270.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.file_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_id"},message:"must have required property '"+"file_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.file_unique_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_unique_id"},message:"must have required property '"+"file_unique_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "file_id") || (key0 === "file_unique_id")) || (key0 === "file_size")) || (key0 === "file_name")) || (key0 === "mime_type"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.file_id !== undefined){
if(typeof data.file_id !== "string"){
const err3 = {instancePath:instancePath+"/file_id",schemaPath:"#/properties/file_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.file_unique_id !== undefined){
if(typeof data.file_unique_id !== "string"){
const err4 = {instancePath:instancePath+"/file_unique_id",schemaPath:"#/properties/file_unique_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.file_size !== undefined){
let data2 = data.file_size;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err5 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err6 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
if(data.file_name !== undefined){
if(typeof data.file_name !== "string"){
const err7 = {instancePath:instancePath+"/file_name",schemaPath:"#/properties/file_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.mime_type !== undefined){
if(typeof data.mime_type !== "string"){
const err8 = {instancePath:instancePath+"/mime_type",schemaPath:"#/properties/mime_type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate270.errors = vErrors;
return errors === 0;
}
validate270.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema96 = {"type":"object","additionalProperties":false,"required":["message_id","date","chat"],"properties":{"message_id":{"type":"integer"},"message_thread_id":{"type":"integer"},"from":{"$ref":"#/$defs/user"},"sender_chat":{"$ref":"#/$defs/chat"},"date":{"type":"integer","description":"Unix zamanı (saniye)"},"edit_date":{"type":"integer"},"chat":{"$ref":"#/$defs/chat"},"is_topic_message":{"type":"boolean"},"is_automatic_forward":{"type":"boolean"},"has_protected_content":{"type":"boolean"},"forward_origin":{"type":"object","additionalProperties":false,"required":["type","date"],"properties":{"type":{"type":"string"},"date":{"type":"integer"}}},"via_bot":{"$ref":"#/$defs/user"},"media_group_id":{"type":"string"},"author_signature":{"type":"string"},"text":{"type":"string"},"entities":{"type":"array","items":{"$ref":"#/$defs/entity"}},"caption":{"type":"string"},"caption_entities":{"type":"array","items":{"$ref":"#/$defs/entity"}},"voice":{"$ref":"#/$defs/voice"},"audio":{"$ref":"#/$defs/audio"},"photo":{"type":"array","items":{"$ref":"#/$defs/photoSize"}},"document":{"$ref":"#/$defs/document"},"new_chat_members":{"type":"array","items":{"$ref":"#/$defs/user"}},"left_chat_member":{"$ref":"#/$defs/user"},"new_chat_title":{"type":"string"},"group_chat_created":{"type":"boolean"},"supergroup_chat_created":{"type":"boolean"},"migrate_to_chat_id":{"type":"integer"},"migrate_from_chat_id":{"type":"integer"},"reply_markup":{"$ref":"#/$defs/inlineKeyboardMarkup"}},"description":"Yanıtlanan/sabitlenen mesaj (iç içe reply_to_message yok; şema özyinelemesizdir)"};
const schema97 = {"type":"object","additionalProperties":false,"required":["inline_keyboard"],"properties":{"inline_keyboard":{"type":"array","items":{"type":"array","items":{"$ref":"#/$defs/inlineButton"}}}}};
const schema98 = {"type":"object","additionalProperties":false,"required":["text"],"properties":{"text":{"type":"string"},"callback_data":{"type":"string"},"url":{"type":"string"}}};

function validate288(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate288.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.text === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "text") || (key0 === "callback_data")) || (key0 === "url"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.text !== undefined){
if(typeof data.text !== "string"){
const err2 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.callback_data !== undefined){
if(typeof data.callback_data !== "string"){
const err3 = {instancePath:instancePath+"/callback_data",schemaPath:"#/properties/callback_data/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.url !== undefined){
if(typeof data.url !== "string"){
const err4 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate288.errors = vErrors;
return errors === 0;
}
validate288.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate287(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate287.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.inline_keyboard === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "inline_keyboard"},message:"must have required property '"+"inline_keyboard"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "inline_keyboard")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.inline_keyboard !== undefined){
let data0 = data.inline_keyboard;
if(Array.isArray(data0)){
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(Array.isArray(data1)){
const len1 = data1.length;
for(let i1=0; i1<len1; i1++){
if(!(validate288(data1[i1], {instancePath:instancePath+"/inline_keyboard/" + i0+"/" + i1,parentData:data1,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate288.errors : vErrors.concat(validate288.errors);
errors = vErrors.length;
}
}
}
else {
const err2 = {instancePath:instancePath+"/inline_keyboard/" + i0,schemaPath:"#/properties/inline_keyboard/items/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
else {
const err3 = {instancePath:instancePath+"/inline_keyboard",schemaPath:"#/properties/inline_keyboard/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate287.errors = vErrors;
return errors === 0;
}
validate287.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate274(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate274.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.message_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message_id"},message:"must have required property '"+"message_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.date === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.chat === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chat"},message:"must have required property '"+"chat"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema96.properties, key0))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.message_id !== undefined){
let data0 = data.message_id;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err4 = {instancePath:instancePath+"/message_id",schemaPath:"#/properties/message_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.message_thread_id !== undefined){
let data1 = data.message_thread_id;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err5 = {instancePath:instancePath+"/message_thread_id",schemaPath:"#/properties/message_thread_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.from !== undefined){
if(!(validate254(data.from, {instancePath:instancePath+"/from",parentData:data,parentDataProperty:"from",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.sender_chat !== undefined){
if(!(validate256(data.sender_chat, {instancePath:instancePath+"/sender_chat",parentData:data,parentDataProperty:"sender_chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.date !== undefined){
let data4 = data.date;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err6 = {instancePath:instancePath+"/date",schemaPath:"#/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.edit_date !== undefined){
let data5 = data.edit_date;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err7 = {instancePath:instancePath+"/edit_date",schemaPath:"#/properties/edit_date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.chat !== undefined){
if(!(validate256(data.chat, {instancePath:instancePath+"/chat",parentData:data,parentDataProperty:"chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.is_topic_message !== undefined){
if(typeof data.is_topic_message !== "boolean"){
const err8 = {instancePath:instancePath+"/is_topic_message",schemaPath:"#/properties/is_topic_message/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.is_automatic_forward !== undefined){
if(typeof data.is_automatic_forward !== "boolean"){
const err9 = {instancePath:instancePath+"/is_automatic_forward",schemaPath:"#/properties/is_automatic_forward/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.has_protected_content !== undefined){
if(typeof data.has_protected_content !== "boolean"){
const err10 = {instancePath:instancePath+"/has_protected_content",schemaPath:"#/properties/has_protected_content/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.forward_origin !== undefined){
let data10 = data.forward_origin;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.type === undefined){
const err11 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data10.date === undefined){
const err12 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
for(const key1 in data10){
if(!((key1 === "type") || (key1 === "date"))){
const err13 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data10.type !== undefined){
if(typeof data10.type !== "string"){
const err14 = {instancePath:instancePath+"/forward_origin/type",schemaPath:"#/properties/forward_origin/properties/type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data10.date !== undefined){
let data12 = data10.date;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err15 = {instancePath:instancePath+"/forward_origin/date",schemaPath:"#/properties/forward_origin/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.via_bot !== undefined){
if(!(validate254(data.via_bot, {instancePath:instancePath+"/via_bot",parentData:data,parentDataProperty:"via_bot",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.media_group_id !== undefined){
if(typeof data.media_group_id !== "string"){
const err17 = {instancePath:instancePath+"/media_group_id",schemaPath:"#/properties/media_group_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.author_signature !== undefined){
if(typeof data.author_signature !== "string"){
const err18 = {instancePath:instancePath+"/author_signature",schemaPath:"#/properties/author_signature/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.text !== undefined){
if(typeof data.text !== "string"){
const err19 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.entities !== undefined){
let data17 = data.entities;
if(Array.isArray(data17)){
const len0 = data17.length;
for(let i0=0; i0<len0; i0++){
if(!(validate260(data17[i0], {instancePath:instancePath+"/entities/" + i0,parentData:data17,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate260.errors : vErrors.concat(validate260.errors);
errors = vErrors.length;
}
}
}
else {
const err20 = {instancePath:instancePath+"/entities",schemaPath:"#/properties/entities/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.caption !== undefined){
if(typeof data.caption !== "string"){
const err21 = {instancePath:instancePath+"/caption",schemaPath:"#/properties/caption/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.caption_entities !== undefined){
let data20 = data.caption_entities;
if(Array.isArray(data20)){
const len1 = data20.length;
for(let i1=0; i1<len1; i1++){
if(!(validate260(data20[i1], {instancePath:instancePath+"/caption_entities/" + i1,parentData:data20,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate260.errors : vErrors.concat(validate260.errors);
errors = vErrors.length;
}
}
}
else {
const err22 = {instancePath:instancePath+"/caption_entities",schemaPath:"#/properties/caption_entities/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.voice !== undefined){
if(!(validate264(data.voice, {instancePath:instancePath+"/voice",parentData:data,parentDataProperty:"voice",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate264.errors : vErrors.concat(validate264.errors);
errors = vErrors.length;
}
}
if(data.audio !== undefined){
if(!(validate266(data.audio, {instancePath:instancePath+"/audio",parentData:data,parentDataProperty:"audio",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate266.errors : vErrors.concat(validate266.errors);
errors = vErrors.length;
}
}
if(data.photo !== undefined){
let data24 = data.photo;
if(Array.isArray(data24)){
const len2 = data24.length;
for(let i2=0; i2<len2; i2++){
if(!(validate268(data24[i2], {instancePath:instancePath+"/photo/" + i2,parentData:data24,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate268.errors : vErrors.concat(validate268.errors);
errors = vErrors.length;
}
}
}
else {
const err23 = {instancePath:instancePath+"/photo",schemaPath:"#/properties/photo/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.document !== undefined){
if(!(validate270(data.document, {instancePath:instancePath+"/document",parentData:data,parentDataProperty:"document",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate270.errors : vErrors.concat(validate270.errors);
errors = vErrors.length;
}
}
if(data.new_chat_members !== undefined){
let data27 = data.new_chat_members;
if(Array.isArray(data27)){
const len3 = data27.length;
for(let i3=0; i3<len3; i3++){
if(!(validate254(data27[i3], {instancePath:instancePath+"/new_chat_members/" + i3,parentData:data27,parentDataProperty:i3,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
}
else {
const err24 = {instancePath:instancePath+"/new_chat_members",schemaPath:"#/properties/new_chat_members/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.left_chat_member !== undefined){
if(!(validate254(data.left_chat_member, {instancePath:instancePath+"/left_chat_member",parentData:data,parentDataProperty:"left_chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.new_chat_title !== undefined){
if(typeof data.new_chat_title !== "string"){
const err25 = {instancePath:instancePath+"/new_chat_title",schemaPath:"#/properties/new_chat_title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.group_chat_created !== undefined){
if(typeof data.group_chat_created !== "boolean"){
const err26 = {instancePath:instancePath+"/group_chat_created",schemaPath:"#/properties/group_chat_created/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.supergroup_chat_created !== undefined){
if(typeof data.supergroup_chat_created !== "boolean"){
const err27 = {instancePath:instancePath+"/supergroup_chat_created",schemaPath:"#/properties/supergroup_chat_created/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data.migrate_to_chat_id !== undefined){
let data33 = data.migrate_to_chat_id;
if(!(((typeof data33 == "number") && (!(data33 % 1) && !isNaN(data33))) && (isFinite(data33)))){
const err28 = {instancePath:instancePath+"/migrate_to_chat_id",schemaPath:"#/properties/migrate_to_chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.migrate_from_chat_id !== undefined){
let data34 = data.migrate_from_chat_id;
if(!(((typeof data34 == "number") && (!(data34 % 1) && !isNaN(data34))) && (isFinite(data34)))){
const err29 = {instancePath:instancePath+"/migrate_from_chat_id",schemaPath:"#/properties/migrate_from_chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.reply_markup !== undefined){
if(!(validate287(data.reply_markup, {instancePath:instancePath+"/reply_markup",parentData:data,parentDataProperty:"reply_markup",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate287.errors : vErrors.concat(validate287.errors);
errors = vErrors.length;
}
}
}
else {
const err30 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
validate274.errors = vErrors;
return errors === 0;
}
validate274.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate253(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate253.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.message_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message_id"},message:"must have required property '"+"message_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.date === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.chat === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chat"},message:"must have required property '"+"chat"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema88.properties, key0))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.message_id !== undefined){
let data0 = data.message_id;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err4 = {instancePath:instancePath+"/message_id",schemaPath:"#/properties/message_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.message_thread_id !== undefined){
let data1 = data.message_thread_id;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err5 = {instancePath:instancePath+"/message_thread_id",schemaPath:"#/properties/message_thread_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.from !== undefined){
if(!(validate254(data.from, {instancePath:instancePath+"/from",parentData:data,parentDataProperty:"from",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.sender_chat !== undefined){
if(!(validate256(data.sender_chat, {instancePath:instancePath+"/sender_chat",parentData:data,parentDataProperty:"sender_chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.date !== undefined){
let data4 = data.date;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err6 = {instancePath:instancePath+"/date",schemaPath:"#/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.edit_date !== undefined){
let data5 = data.edit_date;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err7 = {instancePath:instancePath+"/edit_date",schemaPath:"#/properties/edit_date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.chat !== undefined){
if(!(validate256(data.chat, {instancePath:instancePath+"/chat",parentData:data,parentDataProperty:"chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.is_topic_message !== undefined){
if(typeof data.is_topic_message !== "boolean"){
const err8 = {instancePath:instancePath+"/is_topic_message",schemaPath:"#/properties/is_topic_message/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.is_automatic_forward !== undefined){
if(typeof data.is_automatic_forward !== "boolean"){
const err9 = {instancePath:instancePath+"/is_automatic_forward",schemaPath:"#/properties/is_automatic_forward/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.has_protected_content !== undefined){
if(typeof data.has_protected_content !== "boolean"){
const err10 = {instancePath:instancePath+"/has_protected_content",schemaPath:"#/properties/has_protected_content/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.forward_origin !== undefined){
let data10 = data.forward_origin;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.type === undefined){
const err11 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data10.date === undefined){
const err12 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
for(const key1 in data10){
if(!((key1 === "type") || (key1 === "date"))){
const err13 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data10.type !== undefined){
if(typeof data10.type !== "string"){
const err14 = {instancePath:instancePath+"/forward_origin/type",schemaPath:"#/properties/forward_origin/properties/type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data10.date !== undefined){
let data12 = data10.date;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err15 = {instancePath:instancePath+"/forward_origin/date",schemaPath:"#/properties/forward_origin/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.via_bot !== undefined){
if(!(validate254(data.via_bot, {instancePath:instancePath+"/via_bot",parentData:data,parentDataProperty:"via_bot",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.media_group_id !== undefined){
if(typeof data.media_group_id !== "string"){
const err17 = {instancePath:instancePath+"/media_group_id",schemaPath:"#/properties/media_group_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.author_signature !== undefined){
if(typeof data.author_signature !== "string"){
const err18 = {instancePath:instancePath+"/author_signature",schemaPath:"#/properties/author_signature/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.text !== undefined){
if(typeof data.text !== "string"){
const err19 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.entities !== undefined){
let data17 = data.entities;
if(Array.isArray(data17)){
const len0 = data17.length;
for(let i0=0; i0<len0; i0++){
if(!(validate260(data17[i0], {instancePath:instancePath+"/entities/" + i0,parentData:data17,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate260.errors : vErrors.concat(validate260.errors);
errors = vErrors.length;
}
}
}
else {
const err20 = {instancePath:instancePath+"/entities",schemaPath:"#/properties/entities/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.caption !== undefined){
if(typeof data.caption !== "string"){
const err21 = {instancePath:instancePath+"/caption",schemaPath:"#/properties/caption/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.caption_entities !== undefined){
let data20 = data.caption_entities;
if(Array.isArray(data20)){
const len1 = data20.length;
for(let i1=0; i1<len1; i1++){
if(!(validate260(data20[i1], {instancePath:instancePath+"/caption_entities/" + i1,parentData:data20,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate260.errors : vErrors.concat(validate260.errors);
errors = vErrors.length;
}
}
}
else {
const err22 = {instancePath:instancePath+"/caption_entities",schemaPath:"#/properties/caption_entities/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.voice !== undefined){
if(!(validate264(data.voice, {instancePath:instancePath+"/voice",parentData:data,parentDataProperty:"voice",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate264.errors : vErrors.concat(validate264.errors);
errors = vErrors.length;
}
}
if(data.audio !== undefined){
if(!(validate266(data.audio, {instancePath:instancePath+"/audio",parentData:data,parentDataProperty:"audio",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate266.errors : vErrors.concat(validate266.errors);
errors = vErrors.length;
}
}
if(data.photo !== undefined){
let data24 = data.photo;
if(Array.isArray(data24)){
const len2 = data24.length;
for(let i2=0; i2<len2; i2++){
if(!(validate268(data24[i2], {instancePath:instancePath+"/photo/" + i2,parentData:data24,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate268.errors : vErrors.concat(validate268.errors);
errors = vErrors.length;
}
}
}
else {
const err23 = {instancePath:instancePath+"/photo",schemaPath:"#/properties/photo/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.document !== undefined){
if(!(validate270(data.document, {instancePath:instancePath+"/document",parentData:data,parentDataProperty:"document",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate270.errors : vErrors.concat(validate270.errors);
errors = vErrors.length;
}
}
if(data.new_chat_members !== undefined){
let data27 = data.new_chat_members;
if(Array.isArray(data27)){
const len3 = data27.length;
for(let i3=0; i3<len3; i3++){
if(!(validate254(data27[i3], {instancePath:instancePath+"/new_chat_members/" + i3,parentData:data27,parentDataProperty:i3,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
}
else {
const err24 = {instancePath:instancePath+"/new_chat_members",schemaPath:"#/properties/new_chat_members/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.left_chat_member !== undefined){
if(!(validate254(data.left_chat_member, {instancePath:instancePath+"/left_chat_member",parentData:data,parentDataProperty:"left_chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.new_chat_title !== undefined){
if(typeof data.new_chat_title !== "string"){
const err25 = {instancePath:instancePath+"/new_chat_title",schemaPath:"#/properties/new_chat_title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.group_chat_created !== undefined){
if(typeof data.group_chat_created !== "boolean"){
const err26 = {instancePath:instancePath+"/group_chat_created",schemaPath:"#/properties/group_chat_created/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.supergroup_chat_created !== undefined){
if(typeof data.supergroup_chat_created !== "boolean"){
const err27 = {instancePath:instancePath+"/supergroup_chat_created",schemaPath:"#/properties/supergroup_chat_created/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data.migrate_to_chat_id !== undefined){
let data33 = data.migrate_to_chat_id;
if(!(((typeof data33 == "number") && (!(data33 % 1) && !isNaN(data33))) && (isFinite(data33)))){
const err28 = {instancePath:instancePath+"/migrate_to_chat_id",schemaPath:"#/properties/migrate_to_chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.migrate_from_chat_id !== undefined){
let data34 = data.migrate_from_chat_id;
if(!(((typeof data34 == "number") && (!(data34 % 1) && !isNaN(data34))) && (isFinite(data34)))){
const err29 = {instancePath:instancePath+"/migrate_from_chat_id",schemaPath:"#/properties/migrate_from_chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.pinned_message !== undefined){
if(!(validate274(data.pinned_message, {instancePath:instancePath+"/pinned_message",parentData:data,parentDataProperty:"pinned_message",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate274.errors : vErrors.concat(validate274.errors);
errors = vErrors.length;
}
}
if(data.reply_markup !== undefined){
if(!(validate287(data.reply_markup, {instancePath:instancePath+"/reply_markup",parentData:data,parentDataProperty:"reply_markup",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate287.errors : vErrors.concat(validate287.errors);
errors = vErrors.length;
}
}
if(data.reply_to_message !== undefined){
if(!(validate274(data.reply_to_message, {instancePath:instancePath+"/reply_to_message",parentData:data,parentDataProperty:"reply_to_message",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate274.errors : vErrors.concat(validate274.errors);
errors = vErrors.length;
}
}
}
else {
const err30 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
validate253.errors = vErrors;
return errors === 0;
}
validate253.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema99 = {"type":"object","additionalProperties":false,"required":["id","from","chat_instance"],"properties":{"id":{"type":"string"},"from":{"$ref":"#/$defs/user"},"message":{"$ref":"#/$defs/replyMessage"},"inline_message_id":{"type":"string"},"chat_instance":{"type":"string"},"data":{"type":"string","maxLength":64,"description":"ans:<session>:<question>:<key> | hint:<question> | human:<message_id> | consent:<kind>:<yes|no> | diag:continue|later"}}};

function validate296(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate296.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.from === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "from"},message:"must have required property '"+"from"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.chat_instance === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chat_instance"},message:"must have required property '"+"chat_instance"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "id") || (key0 === "from")) || (key0 === "message")) || (key0 === "inline_message_id")) || (key0 === "chat_instance")) || (key0 === "data"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.id !== undefined){
if(typeof data.id !== "string"){
const err4 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.from !== undefined){
if(!(validate254(data.from, {instancePath:instancePath+"/from",parentData:data,parentDataProperty:"from",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.message !== undefined){
if(!(validate274(data.message, {instancePath:instancePath+"/message",parentData:data,parentDataProperty:"message",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate274.errors : vErrors.concat(validate274.errors);
errors = vErrors.length;
}
}
if(data.inline_message_id !== undefined){
if(typeof data.inline_message_id !== "string"){
const err5 = {instancePath:instancePath+"/inline_message_id",schemaPath:"#/properties/inline_message_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.chat_instance !== undefined){
if(typeof data.chat_instance !== "string"){
const err6 = {instancePath:instancePath+"/chat_instance",schemaPath:"#/properties/chat_instance/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.data !== undefined){
let data5 = data.data;
if(typeof data5 === "string"){
if(func1(data5) > 64){
const err7 = {instancePath:instancePath+"/data",schemaPath:"#/properties/data/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/data",schemaPath:"#/properties/data/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate296.errors = vErrors;
return errors === 0;
}
validate296.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema100 = {"type":"object","additionalProperties":false,"required":["chat","from","date","old_chat_member","new_chat_member"],"properties":{"chat":{"$ref":"#/$defs/chat"},"from":{"$ref":"#/$defs/user"},"date":{"type":"integer"},"old_chat_member":{"$ref":"#/$defs/chatMember"},"new_chat_member":{"$ref":"#/$defs/chatMember"},"via_join_request":{"type":"boolean"},"via_chat_folder_invite_link":{"type":"boolean"}}};
const schema101 = {"type":"object","additionalProperties":false,"required":["status","user"],"description":"ChatMember (owner/administrator/member/restricted/left/kicked birleşik alt kümesi)","properties":{"status":{"enum":["creator","administrator","member","restricted","left","kicked"]},"user":{"$ref":"#/$defs/user"},"is_anonymous":{"type":"boolean"},"custom_title":{"type":"string"},"until_date":{"type":"integer"},"is_member":{"type":"boolean"},"can_be_edited":{"type":"boolean"},"can_manage_chat":{"type":"boolean"},"can_delete_messages":{"type":"boolean"},"can_manage_video_chats":{"type":"boolean"},"can_restrict_members":{"type":"boolean"},"can_promote_members":{"type":"boolean"},"can_change_info":{"type":"boolean"},"can_invite_users":{"type":"boolean"},"can_post_messages":{"type":"boolean"},"can_edit_messages":{"type":"boolean"},"can_pin_messages":{"type":"boolean"},"can_manage_topics":{"type":"boolean"},"can_post_stories":{"type":"boolean"},"can_edit_stories":{"type":"boolean"},"can_delete_stories":{"type":"boolean"},"can_send_messages":{"type":"boolean"},"can_send_audios":{"type":"boolean"},"can_send_documents":{"type":"boolean"},"can_send_photos":{"type":"boolean"},"can_send_videos":{"type":"boolean"},"can_send_video_notes":{"type":"boolean"},"can_send_voice_notes":{"type":"boolean"},"can_send_polls":{"type":"boolean"},"can_send_other_messages":{"type":"boolean"},"can_add_web_page_previews":{"type":"boolean"}}};

function validate303(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate303.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.status === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.user === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "user"},message:"must have required property '"+"user"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema101.properties, key0))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.status !== undefined){
let data0 = data.status;
if(!((((((data0 === "creator") || (data0 === "administrator")) || (data0 === "member")) || (data0 === "restricted")) || (data0 === "left")) || (data0 === "kicked"))){
const err3 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema101.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.user !== undefined){
if(!(validate254(data.user, {instancePath:instancePath+"/user",parentData:data,parentDataProperty:"user",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.is_anonymous !== undefined){
if(typeof data.is_anonymous !== "boolean"){
const err4 = {instancePath:instancePath+"/is_anonymous",schemaPath:"#/properties/is_anonymous/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.custom_title !== undefined){
if(typeof data.custom_title !== "string"){
const err5 = {instancePath:instancePath+"/custom_title",schemaPath:"#/properties/custom_title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.until_date !== undefined){
let data4 = data.until_date;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err6 = {instancePath:instancePath+"/until_date",schemaPath:"#/properties/until_date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.is_member !== undefined){
if(typeof data.is_member !== "boolean"){
const err7 = {instancePath:instancePath+"/is_member",schemaPath:"#/properties/is_member/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.can_be_edited !== undefined){
if(typeof data.can_be_edited !== "boolean"){
const err8 = {instancePath:instancePath+"/can_be_edited",schemaPath:"#/properties/can_be_edited/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.can_manage_chat !== undefined){
if(typeof data.can_manage_chat !== "boolean"){
const err9 = {instancePath:instancePath+"/can_manage_chat",schemaPath:"#/properties/can_manage_chat/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.can_delete_messages !== undefined){
if(typeof data.can_delete_messages !== "boolean"){
const err10 = {instancePath:instancePath+"/can_delete_messages",schemaPath:"#/properties/can_delete_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.can_manage_video_chats !== undefined){
if(typeof data.can_manage_video_chats !== "boolean"){
const err11 = {instancePath:instancePath+"/can_manage_video_chats",schemaPath:"#/properties/can_manage_video_chats/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.can_restrict_members !== undefined){
if(typeof data.can_restrict_members !== "boolean"){
const err12 = {instancePath:instancePath+"/can_restrict_members",schemaPath:"#/properties/can_restrict_members/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.can_promote_members !== undefined){
if(typeof data.can_promote_members !== "boolean"){
const err13 = {instancePath:instancePath+"/can_promote_members",schemaPath:"#/properties/can_promote_members/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.can_change_info !== undefined){
if(typeof data.can_change_info !== "boolean"){
const err14 = {instancePath:instancePath+"/can_change_info",schemaPath:"#/properties/can_change_info/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.can_invite_users !== undefined){
if(typeof data.can_invite_users !== "boolean"){
const err15 = {instancePath:instancePath+"/can_invite_users",schemaPath:"#/properties/can_invite_users/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.can_post_messages !== undefined){
if(typeof data.can_post_messages !== "boolean"){
const err16 = {instancePath:instancePath+"/can_post_messages",schemaPath:"#/properties/can_post_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.can_edit_messages !== undefined){
if(typeof data.can_edit_messages !== "boolean"){
const err17 = {instancePath:instancePath+"/can_edit_messages",schemaPath:"#/properties/can_edit_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.can_pin_messages !== undefined){
if(typeof data.can_pin_messages !== "boolean"){
const err18 = {instancePath:instancePath+"/can_pin_messages",schemaPath:"#/properties/can_pin_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.can_manage_topics !== undefined){
if(typeof data.can_manage_topics !== "boolean"){
const err19 = {instancePath:instancePath+"/can_manage_topics",schemaPath:"#/properties/can_manage_topics/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.can_post_stories !== undefined){
if(typeof data.can_post_stories !== "boolean"){
const err20 = {instancePath:instancePath+"/can_post_stories",schemaPath:"#/properties/can_post_stories/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.can_edit_stories !== undefined){
if(typeof data.can_edit_stories !== "boolean"){
const err21 = {instancePath:instancePath+"/can_edit_stories",schemaPath:"#/properties/can_edit_stories/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.can_delete_stories !== undefined){
if(typeof data.can_delete_stories !== "boolean"){
const err22 = {instancePath:instancePath+"/can_delete_stories",schemaPath:"#/properties/can_delete_stories/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.can_send_messages !== undefined){
if(typeof data.can_send_messages !== "boolean"){
const err23 = {instancePath:instancePath+"/can_send_messages",schemaPath:"#/properties/can_send_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.can_send_audios !== undefined){
if(typeof data.can_send_audios !== "boolean"){
const err24 = {instancePath:instancePath+"/can_send_audios",schemaPath:"#/properties/can_send_audios/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.can_send_documents !== undefined){
if(typeof data.can_send_documents !== "boolean"){
const err25 = {instancePath:instancePath+"/can_send_documents",schemaPath:"#/properties/can_send_documents/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.can_send_photos !== undefined){
if(typeof data.can_send_photos !== "boolean"){
const err26 = {instancePath:instancePath+"/can_send_photos",schemaPath:"#/properties/can_send_photos/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.can_send_videos !== undefined){
if(typeof data.can_send_videos !== "boolean"){
const err27 = {instancePath:instancePath+"/can_send_videos",schemaPath:"#/properties/can_send_videos/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data.can_send_video_notes !== undefined){
if(typeof data.can_send_video_notes !== "boolean"){
const err28 = {instancePath:instancePath+"/can_send_video_notes",schemaPath:"#/properties/can_send_video_notes/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.can_send_voice_notes !== undefined){
if(typeof data.can_send_voice_notes !== "boolean"){
const err29 = {instancePath:instancePath+"/can_send_voice_notes",schemaPath:"#/properties/can_send_voice_notes/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.can_send_polls !== undefined){
if(typeof data.can_send_polls !== "boolean"){
const err30 = {instancePath:instancePath+"/can_send_polls",schemaPath:"#/properties/can_send_polls/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.can_send_other_messages !== undefined){
if(typeof data.can_send_other_messages !== "boolean"){
const err31 = {instancePath:instancePath+"/can_send_other_messages",schemaPath:"#/properties/can_send_other_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.can_add_web_page_previews !== undefined){
if(typeof data.can_add_web_page_previews !== "boolean"){
const err32 = {instancePath:instancePath+"/can_add_web_page_previews",schemaPath:"#/properties/can_add_web_page_previews/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
else {
const err33 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
validate303.errors = vErrors;
return errors === 0;
}
validate303.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate300(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate300.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.chat === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chat"},message:"must have required property '"+"chat"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.from === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "from"},message:"must have required property '"+"from"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.date === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.old_chat_member === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "old_chat_member"},message:"must have required property '"+"old_chat_member"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.new_chat_member === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "new_chat_member"},message:"must have required property '"+"new_chat_member"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "chat") || (key0 === "from")) || (key0 === "date")) || (key0 === "old_chat_member")) || (key0 === "new_chat_member")) || (key0 === "via_join_request")) || (key0 === "via_chat_folder_invite_link"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.chat !== undefined){
if(!(validate256(data.chat, {instancePath:instancePath+"/chat",parentData:data,parentDataProperty:"chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.from !== undefined){
if(!(validate254(data.from, {instancePath:instancePath+"/from",parentData:data,parentDataProperty:"from",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.date !== undefined){
let data2 = data.date;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err6 = {instancePath:instancePath+"/date",schemaPath:"#/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.old_chat_member !== undefined){
if(!(validate303(data.old_chat_member, {instancePath:instancePath+"/old_chat_member",parentData:data,parentDataProperty:"old_chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate303.errors : vErrors.concat(validate303.errors);
errors = vErrors.length;
}
}
if(data.new_chat_member !== undefined){
if(!(validate303(data.new_chat_member, {instancePath:instancePath+"/new_chat_member",parentData:data,parentDataProperty:"new_chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate303.errors : vErrors.concat(validate303.errors);
errors = vErrors.length;
}
}
if(data.via_join_request !== undefined){
if(typeof data.via_join_request !== "boolean"){
const err7 = {instancePath:instancePath+"/via_join_request",schemaPath:"#/properties/via_join_request/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.via_chat_folder_invite_link !== undefined){
if(typeof data.via_chat_folder_invite_link !== "boolean"){
const err8 = {instancePath:instancePath+"/via_chat_folder_invite_link",schemaPath:"#/properties/via_chat_folder_invite_link/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate300.errors = vErrors;
return errors === 0;
}
validate300.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate252(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/telegram-update.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate252.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs1 = errors;
let valid0 = false;
let passing0 = null;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.message === undefined){
const err0 = {instancePath,schemaPath:"#/oneOf/0/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
var _valid0 = _errs2 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.edited_message === undefined){
const err1 = {instancePath,schemaPath:"#/oneOf/1/required",keyword:"required",params:{missingProperty: "edited_message"},message:"must have required property '"+"edited_message"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var _valid0 = _errs3 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
}
const _errs4 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.callback_query === undefined){
const err2 = {instancePath,schemaPath:"#/oneOf/2/required",keyword:"required",params:{missingProperty: "callback_query"},message:"must have required property '"+"callback_query"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
var _valid0 = _errs4 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 2];
}
else {
if(_valid0){
valid0 = true;
passing0 = 2;
}
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.my_chat_member === undefined){
const err3 = {instancePath,schemaPath:"#/oneOf/3/required",keyword:"required",params:{missingProperty: "my_chat_member"},message:"must have required property '"+"my_chat_member"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 3];
}
else {
if(_valid0){
valid0 = true;
passing0 = 3;
}
const _errs6 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.chat_member === undefined){
const err4 = {instancePath,schemaPath:"#/oneOf/4/required",keyword:"required",params:{missingProperty: "chat_member"},message:"must have required property '"+"chat_member"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
var _valid0 = _errs6 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 4];
}
else {
if(_valid0){
valid0 = true;
passing0 = 4;
}
}
}
}
}
if(!valid0){
const err5 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.update_id === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "update_id"},message:"must have required property '"+"update_id"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "update_id") || (key0 === "message")) || (key0 === "edited_message")) || (key0 === "callback_query")) || (key0 === "my_chat_member")) || (key0 === "chat_member"))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.update_id !== undefined){
let data0 = data.update_id;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err8 = {instancePath:instancePath+"/update_id",schemaPath:"#/properties/update_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if((typeof data0 == "number") && (isFinite(data0))){
if(data0 < 0 || isNaN(data0)){
const err9 = {instancePath:instancePath+"/update_id",schemaPath:"#/properties/update_id/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.message !== undefined){
if(!(validate253(data.message, {instancePath:instancePath+"/message",parentData:data,parentDataProperty:"message",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate253.errors : vErrors.concat(validate253.errors);
errors = vErrors.length;
}
}
if(data.edited_message !== undefined){
if(!(validate253(data.edited_message, {instancePath:instancePath+"/edited_message",parentData:data,parentDataProperty:"edited_message",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate253.errors : vErrors.concat(validate253.errors);
errors = vErrors.length;
}
}
if(data.callback_query !== undefined){
if(!(validate296(data.callback_query, {instancePath:instancePath+"/callback_query",parentData:data,parentDataProperty:"callback_query",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate296.errors : vErrors.concat(validate296.errors);
errors = vErrors.length;
}
}
if(data.my_chat_member !== undefined){
if(!(validate300(data.my_chat_member, {instancePath:instancePath+"/my_chat_member",parentData:data,parentDataProperty:"my_chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate300.errors : vErrors.concat(validate300.errors);
errors = vErrors.length;
}
}
if(data.chat_member !== undefined){
if(!(validate300(data.chat_member, {instancePath:instancePath+"/chat_member",parentData:data,parentDataProperty:"chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate300.errors : vErrors.concat(validate300.errors);
errors = vErrors.length;
}
}
}
else {
const err10 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
validate252.errors = vErrors;
return errors === 0;
}
validate252.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateAudio = validate309;

function validate309(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate309.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.file_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_id"},message:"must have required property '"+"file_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.file_unique_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_unique_id"},message:"must have required property '"+"file_unique_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.duration === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "duration"},message:"must have required property '"+"duration"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "file_id") || (key0 === "file_unique_id")) || (key0 === "file_size")) || (key0 === "duration")) || (key0 === "mime_type")) || (key0 === "performer")) || (key0 === "title")) || (key0 === "file_name"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.file_id !== undefined){
if(typeof data.file_id !== "string"){
const err4 = {instancePath:instancePath+"/file_id",schemaPath:"#/properties/file_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.file_unique_id !== undefined){
if(typeof data.file_unique_id !== "string"){
const err5 = {instancePath:instancePath+"/file_unique_id",schemaPath:"#/properties/file_unique_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.file_size !== undefined){
let data2 = data.file_size;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err6 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err7 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.duration !== undefined){
let data3 = data.duration;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err8 = {instancePath:instancePath+"/duration",schemaPath:"#/properties/duration/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err9 = {instancePath:instancePath+"/duration",schemaPath:"#/properties/duration/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.mime_type !== undefined){
if(typeof data.mime_type !== "string"){
const err10 = {instancePath:instancePath+"/mime_type",schemaPath:"#/properties/mime_type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.performer !== undefined){
if(typeof data.performer !== "string"){
const err11 = {instancePath:instancePath+"/performer",schemaPath:"#/properties/performer/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.title !== undefined){
if(typeof data.title !== "string"){
const err12 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.file_name !== undefined){
if(typeof data.file_name !== "string"){
const err13 = {instancePath:instancePath+"/file_name",schemaPath:"#/properties/file_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
else {
const err14 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
validate309.errors = vErrors;
return errors === 0;
}
validate309.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateCallbackQuery = validate310;

function validate310(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate310.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.from === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "from"},message:"must have required property '"+"from"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.chat_instance === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chat_instance"},message:"must have required property '"+"chat_instance"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "id") || (key0 === "from")) || (key0 === "message")) || (key0 === "inline_message_id")) || (key0 === "chat_instance")) || (key0 === "data"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.id !== undefined){
if(typeof data.id !== "string"){
const err4 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.from !== undefined){
if(!(validate254(data.from, {instancePath:instancePath+"/from",parentData:data,parentDataProperty:"from",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.message !== undefined){
if(!(validate274(data.message, {instancePath:instancePath+"/message",parentData:data,parentDataProperty:"message",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate274.errors : vErrors.concat(validate274.errors);
errors = vErrors.length;
}
}
if(data.inline_message_id !== undefined){
if(typeof data.inline_message_id !== "string"){
const err5 = {instancePath:instancePath+"/inline_message_id",schemaPath:"#/properties/inline_message_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.chat_instance !== undefined){
if(typeof data.chat_instance !== "string"){
const err6 = {instancePath:instancePath+"/chat_instance",schemaPath:"#/properties/chat_instance/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.data !== undefined){
let data5 = data.data;
if(typeof data5 === "string"){
if(func1(data5) > 64){
const err7 = {instancePath:instancePath+"/data",schemaPath:"#/properties/data/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/data",schemaPath:"#/properties/data/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate310.errors = vErrors;
return errors === 0;
}
validate310.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateChat = validate313;

function validate313(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate313.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.type === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "id") || (key0 === "type")) || (key0 === "title")) || (key0 === "username")) || (key0 === "first_name")) || (key0 === "last_name")) || (key0 === "is_forum")) || (key0 === "all_members_are_administrators"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err3 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.type !== undefined){
let data1 = data.type;
if(!((((data1 === "private") || (data1 === "group")) || (data1 === "supergroup")) || (data1 === "channel"))){
const err4 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/enum",keyword:"enum",params:{allowedValues: schema90.properties.type.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.title !== undefined){
if(typeof data.title !== "string"){
const err5 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.username !== undefined){
if(typeof data.username !== "string"){
const err6 = {instancePath:instancePath+"/username",schemaPath:"#/properties/username/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.first_name !== undefined){
if(typeof data.first_name !== "string"){
const err7 = {instancePath:instancePath+"/first_name",schemaPath:"#/properties/first_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.last_name !== undefined){
if(typeof data.last_name !== "string"){
const err8 = {instancePath:instancePath+"/last_name",schemaPath:"#/properties/last_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.is_forum !== undefined){
if(typeof data.is_forum !== "boolean"){
const err9 = {instancePath:instancePath+"/is_forum",schemaPath:"#/properties/is_forum/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.all_members_are_administrators !== undefined){
if(typeof data.all_members_are_administrators !== "boolean"){
const err10 = {instancePath:instancePath+"/all_members_are_administrators",schemaPath:"#/properties/all_members_are_administrators/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate313.errors = vErrors;
return errors === 0;
}
validate313.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateChatMember = validate314;

function validate314(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate314.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.status === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.user === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "user"},message:"must have required property '"+"user"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema101.properties, key0))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.status !== undefined){
let data0 = data.status;
if(!((((((data0 === "creator") || (data0 === "administrator")) || (data0 === "member")) || (data0 === "restricted")) || (data0 === "left")) || (data0 === "kicked"))){
const err3 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema101.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.user !== undefined){
if(!(validate254(data.user, {instancePath:instancePath+"/user",parentData:data,parentDataProperty:"user",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.is_anonymous !== undefined){
if(typeof data.is_anonymous !== "boolean"){
const err4 = {instancePath:instancePath+"/is_anonymous",schemaPath:"#/properties/is_anonymous/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.custom_title !== undefined){
if(typeof data.custom_title !== "string"){
const err5 = {instancePath:instancePath+"/custom_title",schemaPath:"#/properties/custom_title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.until_date !== undefined){
let data4 = data.until_date;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err6 = {instancePath:instancePath+"/until_date",schemaPath:"#/properties/until_date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.is_member !== undefined){
if(typeof data.is_member !== "boolean"){
const err7 = {instancePath:instancePath+"/is_member",schemaPath:"#/properties/is_member/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.can_be_edited !== undefined){
if(typeof data.can_be_edited !== "boolean"){
const err8 = {instancePath:instancePath+"/can_be_edited",schemaPath:"#/properties/can_be_edited/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.can_manage_chat !== undefined){
if(typeof data.can_manage_chat !== "boolean"){
const err9 = {instancePath:instancePath+"/can_manage_chat",schemaPath:"#/properties/can_manage_chat/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.can_delete_messages !== undefined){
if(typeof data.can_delete_messages !== "boolean"){
const err10 = {instancePath:instancePath+"/can_delete_messages",schemaPath:"#/properties/can_delete_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.can_manage_video_chats !== undefined){
if(typeof data.can_manage_video_chats !== "boolean"){
const err11 = {instancePath:instancePath+"/can_manage_video_chats",schemaPath:"#/properties/can_manage_video_chats/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.can_restrict_members !== undefined){
if(typeof data.can_restrict_members !== "boolean"){
const err12 = {instancePath:instancePath+"/can_restrict_members",schemaPath:"#/properties/can_restrict_members/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.can_promote_members !== undefined){
if(typeof data.can_promote_members !== "boolean"){
const err13 = {instancePath:instancePath+"/can_promote_members",schemaPath:"#/properties/can_promote_members/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.can_change_info !== undefined){
if(typeof data.can_change_info !== "boolean"){
const err14 = {instancePath:instancePath+"/can_change_info",schemaPath:"#/properties/can_change_info/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.can_invite_users !== undefined){
if(typeof data.can_invite_users !== "boolean"){
const err15 = {instancePath:instancePath+"/can_invite_users",schemaPath:"#/properties/can_invite_users/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.can_post_messages !== undefined){
if(typeof data.can_post_messages !== "boolean"){
const err16 = {instancePath:instancePath+"/can_post_messages",schemaPath:"#/properties/can_post_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.can_edit_messages !== undefined){
if(typeof data.can_edit_messages !== "boolean"){
const err17 = {instancePath:instancePath+"/can_edit_messages",schemaPath:"#/properties/can_edit_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.can_pin_messages !== undefined){
if(typeof data.can_pin_messages !== "boolean"){
const err18 = {instancePath:instancePath+"/can_pin_messages",schemaPath:"#/properties/can_pin_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.can_manage_topics !== undefined){
if(typeof data.can_manage_topics !== "boolean"){
const err19 = {instancePath:instancePath+"/can_manage_topics",schemaPath:"#/properties/can_manage_topics/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.can_post_stories !== undefined){
if(typeof data.can_post_stories !== "boolean"){
const err20 = {instancePath:instancePath+"/can_post_stories",schemaPath:"#/properties/can_post_stories/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.can_edit_stories !== undefined){
if(typeof data.can_edit_stories !== "boolean"){
const err21 = {instancePath:instancePath+"/can_edit_stories",schemaPath:"#/properties/can_edit_stories/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.can_delete_stories !== undefined){
if(typeof data.can_delete_stories !== "boolean"){
const err22 = {instancePath:instancePath+"/can_delete_stories",schemaPath:"#/properties/can_delete_stories/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.can_send_messages !== undefined){
if(typeof data.can_send_messages !== "boolean"){
const err23 = {instancePath:instancePath+"/can_send_messages",schemaPath:"#/properties/can_send_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.can_send_audios !== undefined){
if(typeof data.can_send_audios !== "boolean"){
const err24 = {instancePath:instancePath+"/can_send_audios",schemaPath:"#/properties/can_send_audios/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.can_send_documents !== undefined){
if(typeof data.can_send_documents !== "boolean"){
const err25 = {instancePath:instancePath+"/can_send_documents",schemaPath:"#/properties/can_send_documents/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.can_send_photos !== undefined){
if(typeof data.can_send_photos !== "boolean"){
const err26 = {instancePath:instancePath+"/can_send_photos",schemaPath:"#/properties/can_send_photos/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.can_send_videos !== undefined){
if(typeof data.can_send_videos !== "boolean"){
const err27 = {instancePath:instancePath+"/can_send_videos",schemaPath:"#/properties/can_send_videos/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data.can_send_video_notes !== undefined){
if(typeof data.can_send_video_notes !== "boolean"){
const err28 = {instancePath:instancePath+"/can_send_video_notes",schemaPath:"#/properties/can_send_video_notes/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.can_send_voice_notes !== undefined){
if(typeof data.can_send_voice_notes !== "boolean"){
const err29 = {instancePath:instancePath+"/can_send_voice_notes",schemaPath:"#/properties/can_send_voice_notes/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.can_send_polls !== undefined){
if(typeof data.can_send_polls !== "boolean"){
const err30 = {instancePath:instancePath+"/can_send_polls",schemaPath:"#/properties/can_send_polls/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.can_send_other_messages !== undefined){
if(typeof data.can_send_other_messages !== "boolean"){
const err31 = {instancePath:instancePath+"/can_send_other_messages",schemaPath:"#/properties/can_send_other_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data.can_add_web_page_previews !== undefined){
if(typeof data.can_add_web_page_previews !== "boolean"){
const err32 = {instancePath:instancePath+"/can_add_web_page_previews",schemaPath:"#/properties/can_add_web_page_previews/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
else {
const err33 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
validate314.errors = vErrors;
return errors === 0;
}
validate314.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateChatMemberUpdated = validate316;

function validate316(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate316.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.chat === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chat"},message:"must have required property '"+"chat"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.from === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "from"},message:"must have required property '"+"from"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.date === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.old_chat_member === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "old_chat_member"},message:"must have required property '"+"old_chat_member"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.new_chat_member === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "new_chat_member"},message:"must have required property '"+"new_chat_member"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "chat") || (key0 === "from")) || (key0 === "date")) || (key0 === "old_chat_member")) || (key0 === "new_chat_member")) || (key0 === "via_join_request")) || (key0 === "via_chat_folder_invite_link"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.chat !== undefined){
if(!(validate256(data.chat, {instancePath:instancePath+"/chat",parentData:data,parentDataProperty:"chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.from !== undefined){
if(!(validate254(data.from, {instancePath:instancePath+"/from",parentData:data,parentDataProperty:"from",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.date !== undefined){
let data2 = data.date;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err6 = {instancePath:instancePath+"/date",schemaPath:"#/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.old_chat_member !== undefined){
if(!(validate303(data.old_chat_member, {instancePath:instancePath+"/old_chat_member",parentData:data,parentDataProperty:"old_chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate303.errors : vErrors.concat(validate303.errors);
errors = vErrors.length;
}
}
if(data.new_chat_member !== undefined){
if(!(validate303(data.new_chat_member, {instancePath:instancePath+"/new_chat_member",parentData:data,parentDataProperty:"new_chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate303.errors : vErrors.concat(validate303.errors);
errors = vErrors.length;
}
}
if(data.via_join_request !== undefined){
if(typeof data.via_join_request !== "boolean"){
const err7 = {instancePath:instancePath+"/via_join_request",schemaPath:"#/properties/via_join_request/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.via_chat_folder_invite_link !== undefined){
if(typeof data.via_chat_folder_invite_link !== "boolean"){
const err8 = {instancePath:instancePath+"/via_chat_folder_invite_link",schemaPath:"#/properties/via_chat_folder_invite_link/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate316.errors = vErrors;
return errors === 0;
}
validate316.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateDocument = validate321;

function validate321(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate321.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.file_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_id"},message:"must have required property '"+"file_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.file_unique_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_unique_id"},message:"must have required property '"+"file_unique_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "file_id") || (key0 === "file_unique_id")) || (key0 === "file_size")) || (key0 === "file_name")) || (key0 === "mime_type"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.file_id !== undefined){
if(typeof data.file_id !== "string"){
const err3 = {instancePath:instancePath+"/file_id",schemaPath:"#/properties/file_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.file_unique_id !== undefined){
if(typeof data.file_unique_id !== "string"){
const err4 = {instancePath:instancePath+"/file_unique_id",schemaPath:"#/properties/file_unique_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.file_size !== undefined){
let data2 = data.file_size;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err5 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err6 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
if(data.file_name !== undefined){
if(typeof data.file_name !== "string"){
const err7 = {instancePath:instancePath+"/file_name",schemaPath:"#/properties/file_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.mime_type !== undefined){
if(typeof data.mime_type !== "string"){
const err8 = {instancePath:instancePath+"/mime_type",schemaPath:"#/properties/mime_type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate321.errors = vErrors;
return errors === 0;
}
validate321.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateEntity = validate322;

function validate322(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate322.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.type === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.offset === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "offset"},message:"must have required property '"+"offset"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.length === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "length"},message:"must have required property '"+"length"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "type") || (key0 === "offset")) || (key0 === "length")) || (key0 === "url")) || (key0 === "user")) || (key0 === "language")) || (key0 === "custom_emoji_id"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.type !== undefined){
if(typeof data.type !== "string"){
const err4 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.offset !== undefined){
let data1 = data.offset;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err5 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 < 0 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
if(data.length !== undefined){
let data2 = data.length;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err7 = {instancePath:instancePath+"/length",schemaPath:"#/properties/length/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err8 = {instancePath:instancePath+"/length",schemaPath:"#/properties/length/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.url !== undefined){
if(typeof data.url !== "string"){
const err9 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.user !== undefined){
if(!(validate254(data.user, {instancePath:instancePath+"/user",parentData:data,parentDataProperty:"user",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.language !== undefined){
if(typeof data.language !== "string"){
const err10 = {instancePath:instancePath+"/language",schemaPath:"#/properties/language/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.custom_emoji_id !== undefined){
if(typeof data.custom_emoji_id !== "string"){
const err11 = {instancePath:instancePath+"/custom_emoji_id",schemaPath:"#/properties/custom_emoji_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate322.errors = vErrors;
return errors === 0;
}
validate322.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateInlineButton = validate324;

function validate324(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate324.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.text === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "text") || (key0 === "callback_data")) || (key0 === "url"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.text !== undefined){
if(typeof data.text !== "string"){
const err2 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.callback_data !== undefined){
if(typeof data.callback_data !== "string"){
const err3 = {instancePath:instancePath+"/callback_data",schemaPath:"#/properties/callback_data/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.url !== undefined){
if(typeof data.url !== "string"){
const err4 = {instancePath:instancePath+"/url",schemaPath:"#/properties/url/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
validate324.errors = vErrors;
return errors === 0;
}
validate324.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateInlineKeyboardMarkup = validate325;

function validate325(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate325.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.inline_keyboard === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "inline_keyboard"},message:"must have required property '"+"inline_keyboard"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "inline_keyboard")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.inline_keyboard !== undefined){
let data0 = data.inline_keyboard;
if(Array.isArray(data0)){
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(Array.isArray(data1)){
const len1 = data1.length;
for(let i1=0; i1<len1; i1++){
if(!(validate288(data1[i1], {instancePath:instancePath+"/inline_keyboard/" + i0+"/" + i1,parentData:data1,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate288.errors : vErrors.concat(validate288.errors);
errors = vErrors.length;
}
}
}
else {
const err2 = {instancePath:instancePath+"/inline_keyboard/" + i0,schemaPath:"#/properties/inline_keyboard/items/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
else {
const err3 = {instancePath:instancePath+"/inline_keyboard",schemaPath:"#/properties/inline_keyboard/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate325.errors = vErrors;
return errors === 0;
}
validate325.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateMessage = validate327;

function validate327(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate327.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.message_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message_id"},message:"must have required property '"+"message_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.date === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.chat === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chat"},message:"must have required property '"+"chat"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema88.properties, key0))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.message_id !== undefined){
let data0 = data.message_id;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err4 = {instancePath:instancePath+"/message_id",schemaPath:"#/properties/message_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.message_thread_id !== undefined){
let data1 = data.message_thread_id;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err5 = {instancePath:instancePath+"/message_thread_id",schemaPath:"#/properties/message_thread_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.from !== undefined){
if(!(validate254(data.from, {instancePath:instancePath+"/from",parentData:data,parentDataProperty:"from",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.sender_chat !== undefined){
if(!(validate256(data.sender_chat, {instancePath:instancePath+"/sender_chat",parentData:data,parentDataProperty:"sender_chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.date !== undefined){
let data4 = data.date;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err6 = {instancePath:instancePath+"/date",schemaPath:"#/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.edit_date !== undefined){
let data5 = data.edit_date;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err7 = {instancePath:instancePath+"/edit_date",schemaPath:"#/properties/edit_date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.chat !== undefined){
if(!(validate256(data.chat, {instancePath:instancePath+"/chat",parentData:data,parentDataProperty:"chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.is_topic_message !== undefined){
if(typeof data.is_topic_message !== "boolean"){
const err8 = {instancePath:instancePath+"/is_topic_message",schemaPath:"#/properties/is_topic_message/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.is_automatic_forward !== undefined){
if(typeof data.is_automatic_forward !== "boolean"){
const err9 = {instancePath:instancePath+"/is_automatic_forward",schemaPath:"#/properties/is_automatic_forward/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.has_protected_content !== undefined){
if(typeof data.has_protected_content !== "boolean"){
const err10 = {instancePath:instancePath+"/has_protected_content",schemaPath:"#/properties/has_protected_content/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.forward_origin !== undefined){
let data10 = data.forward_origin;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.type === undefined){
const err11 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data10.date === undefined){
const err12 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
for(const key1 in data10){
if(!((key1 === "type") || (key1 === "date"))){
const err13 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data10.type !== undefined){
if(typeof data10.type !== "string"){
const err14 = {instancePath:instancePath+"/forward_origin/type",schemaPath:"#/properties/forward_origin/properties/type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data10.date !== undefined){
let data12 = data10.date;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err15 = {instancePath:instancePath+"/forward_origin/date",schemaPath:"#/properties/forward_origin/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.via_bot !== undefined){
if(!(validate254(data.via_bot, {instancePath:instancePath+"/via_bot",parentData:data,parentDataProperty:"via_bot",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.media_group_id !== undefined){
if(typeof data.media_group_id !== "string"){
const err17 = {instancePath:instancePath+"/media_group_id",schemaPath:"#/properties/media_group_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.author_signature !== undefined){
if(typeof data.author_signature !== "string"){
const err18 = {instancePath:instancePath+"/author_signature",schemaPath:"#/properties/author_signature/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.text !== undefined){
if(typeof data.text !== "string"){
const err19 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.entities !== undefined){
let data17 = data.entities;
if(Array.isArray(data17)){
const len0 = data17.length;
for(let i0=0; i0<len0; i0++){
if(!(validate260(data17[i0], {instancePath:instancePath+"/entities/" + i0,parentData:data17,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate260.errors : vErrors.concat(validate260.errors);
errors = vErrors.length;
}
}
}
else {
const err20 = {instancePath:instancePath+"/entities",schemaPath:"#/properties/entities/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.caption !== undefined){
if(typeof data.caption !== "string"){
const err21 = {instancePath:instancePath+"/caption",schemaPath:"#/properties/caption/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.caption_entities !== undefined){
let data20 = data.caption_entities;
if(Array.isArray(data20)){
const len1 = data20.length;
for(let i1=0; i1<len1; i1++){
if(!(validate260(data20[i1], {instancePath:instancePath+"/caption_entities/" + i1,parentData:data20,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate260.errors : vErrors.concat(validate260.errors);
errors = vErrors.length;
}
}
}
else {
const err22 = {instancePath:instancePath+"/caption_entities",schemaPath:"#/properties/caption_entities/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.voice !== undefined){
if(!(validate264(data.voice, {instancePath:instancePath+"/voice",parentData:data,parentDataProperty:"voice",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate264.errors : vErrors.concat(validate264.errors);
errors = vErrors.length;
}
}
if(data.audio !== undefined){
if(!(validate266(data.audio, {instancePath:instancePath+"/audio",parentData:data,parentDataProperty:"audio",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate266.errors : vErrors.concat(validate266.errors);
errors = vErrors.length;
}
}
if(data.photo !== undefined){
let data24 = data.photo;
if(Array.isArray(data24)){
const len2 = data24.length;
for(let i2=0; i2<len2; i2++){
if(!(validate268(data24[i2], {instancePath:instancePath+"/photo/" + i2,parentData:data24,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate268.errors : vErrors.concat(validate268.errors);
errors = vErrors.length;
}
}
}
else {
const err23 = {instancePath:instancePath+"/photo",schemaPath:"#/properties/photo/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.document !== undefined){
if(!(validate270(data.document, {instancePath:instancePath+"/document",parentData:data,parentDataProperty:"document",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate270.errors : vErrors.concat(validate270.errors);
errors = vErrors.length;
}
}
if(data.new_chat_members !== undefined){
let data27 = data.new_chat_members;
if(Array.isArray(data27)){
const len3 = data27.length;
for(let i3=0; i3<len3; i3++){
if(!(validate254(data27[i3], {instancePath:instancePath+"/new_chat_members/" + i3,parentData:data27,parentDataProperty:i3,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
}
else {
const err24 = {instancePath:instancePath+"/new_chat_members",schemaPath:"#/properties/new_chat_members/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.left_chat_member !== undefined){
if(!(validate254(data.left_chat_member, {instancePath:instancePath+"/left_chat_member",parentData:data,parentDataProperty:"left_chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.new_chat_title !== undefined){
if(typeof data.new_chat_title !== "string"){
const err25 = {instancePath:instancePath+"/new_chat_title",schemaPath:"#/properties/new_chat_title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.group_chat_created !== undefined){
if(typeof data.group_chat_created !== "boolean"){
const err26 = {instancePath:instancePath+"/group_chat_created",schemaPath:"#/properties/group_chat_created/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.supergroup_chat_created !== undefined){
if(typeof data.supergroup_chat_created !== "boolean"){
const err27 = {instancePath:instancePath+"/supergroup_chat_created",schemaPath:"#/properties/supergroup_chat_created/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data.migrate_to_chat_id !== undefined){
let data33 = data.migrate_to_chat_id;
if(!(((typeof data33 == "number") && (!(data33 % 1) && !isNaN(data33))) && (isFinite(data33)))){
const err28 = {instancePath:instancePath+"/migrate_to_chat_id",schemaPath:"#/properties/migrate_to_chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.migrate_from_chat_id !== undefined){
let data34 = data.migrate_from_chat_id;
if(!(((typeof data34 == "number") && (!(data34 % 1) && !isNaN(data34))) && (isFinite(data34)))){
const err29 = {instancePath:instancePath+"/migrate_from_chat_id",schemaPath:"#/properties/migrate_from_chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.pinned_message !== undefined){
if(!(validate274(data.pinned_message, {instancePath:instancePath+"/pinned_message",parentData:data,parentDataProperty:"pinned_message",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate274.errors : vErrors.concat(validate274.errors);
errors = vErrors.length;
}
}
if(data.reply_markup !== undefined){
if(!(validate287(data.reply_markup, {instancePath:instancePath+"/reply_markup",parentData:data,parentDataProperty:"reply_markup",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate287.errors : vErrors.concat(validate287.errors);
errors = vErrors.length;
}
}
if(data.reply_to_message !== undefined){
if(!(validate274(data.reply_to_message, {instancePath:instancePath+"/reply_to_message",parentData:data,parentDataProperty:"reply_to_message",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate274.errors : vErrors.concat(validate274.errors);
errors = vErrors.length;
}
}
}
else {
const err30 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
validate327.errors = vErrors;
return errors === 0;
}
validate327.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdatePhotoSize = validate343;

function validate343(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate343.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.file_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_id"},message:"must have required property '"+"file_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.file_unique_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_unique_id"},message:"must have required property '"+"file_unique_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.width === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "width"},message:"must have required property '"+"width"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.height === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "height"},message:"must have required property '"+"height"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "file_id") || (key0 === "file_unique_id")) || (key0 === "file_size")) || (key0 === "width")) || (key0 === "height"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.file_id !== undefined){
if(typeof data.file_id !== "string"){
const err5 = {instancePath:instancePath+"/file_id",schemaPath:"#/properties/file_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.file_unique_id !== undefined){
if(typeof data.file_unique_id !== "string"){
const err6 = {instancePath:instancePath+"/file_unique_id",schemaPath:"#/properties/file_unique_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.file_size !== undefined){
let data2 = data.file_size;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err7 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err8 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.width !== undefined){
let data3 = data.width;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err9 = {instancePath:instancePath+"/width",schemaPath:"#/properties/width/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.height !== undefined){
let data4 = data.height;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err10 = {instancePath:instancePath+"/height",schemaPath:"#/properties/height/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate343.errors = vErrors;
return errors === 0;
}
validate343.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateReplyMessage = validate344;

function validate344(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate344.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.message_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message_id"},message:"must have required property '"+"message_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.date === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.chat === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chat"},message:"must have required property '"+"chat"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema96.properties, key0))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.message_id !== undefined){
let data0 = data.message_id;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err4 = {instancePath:instancePath+"/message_id",schemaPath:"#/properties/message_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.message_thread_id !== undefined){
let data1 = data.message_thread_id;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err5 = {instancePath:instancePath+"/message_thread_id",schemaPath:"#/properties/message_thread_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.from !== undefined){
if(!(validate254(data.from, {instancePath:instancePath+"/from",parentData:data,parentDataProperty:"from",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.sender_chat !== undefined){
if(!(validate256(data.sender_chat, {instancePath:instancePath+"/sender_chat",parentData:data,parentDataProperty:"sender_chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.date !== undefined){
let data4 = data.date;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err6 = {instancePath:instancePath+"/date",schemaPath:"#/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.edit_date !== undefined){
let data5 = data.edit_date;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err7 = {instancePath:instancePath+"/edit_date",schemaPath:"#/properties/edit_date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.chat !== undefined){
if(!(validate256(data.chat, {instancePath:instancePath+"/chat",parentData:data,parentDataProperty:"chat",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate256.errors : vErrors.concat(validate256.errors);
errors = vErrors.length;
}
}
if(data.is_topic_message !== undefined){
if(typeof data.is_topic_message !== "boolean"){
const err8 = {instancePath:instancePath+"/is_topic_message",schemaPath:"#/properties/is_topic_message/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.is_automatic_forward !== undefined){
if(typeof data.is_automatic_forward !== "boolean"){
const err9 = {instancePath:instancePath+"/is_automatic_forward",schemaPath:"#/properties/is_automatic_forward/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.has_protected_content !== undefined){
if(typeof data.has_protected_content !== "boolean"){
const err10 = {instancePath:instancePath+"/has_protected_content",schemaPath:"#/properties/has_protected_content/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.forward_origin !== undefined){
let data10 = data.forward_origin;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.type === undefined){
const err11 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data10.date === undefined){
const err12 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
for(const key1 in data10){
if(!((key1 === "type") || (key1 === "date"))){
const err13 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data10.type !== undefined){
if(typeof data10.type !== "string"){
const err14 = {instancePath:instancePath+"/forward_origin/type",schemaPath:"#/properties/forward_origin/properties/type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data10.date !== undefined){
let data12 = data10.date;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err15 = {instancePath:instancePath+"/forward_origin/date",schemaPath:"#/properties/forward_origin/properties/date/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath:instancePath+"/forward_origin",schemaPath:"#/properties/forward_origin/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.via_bot !== undefined){
if(!(validate254(data.via_bot, {instancePath:instancePath+"/via_bot",parentData:data,parentDataProperty:"via_bot",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.media_group_id !== undefined){
if(typeof data.media_group_id !== "string"){
const err17 = {instancePath:instancePath+"/media_group_id",schemaPath:"#/properties/media_group_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.author_signature !== undefined){
if(typeof data.author_signature !== "string"){
const err18 = {instancePath:instancePath+"/author_signature",schemaPath:"#/properties/author_signature/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.text !== undefined){
if(typeof data.text !== "string"){
const err19 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.entities !== undefined){
let data17 = data.entities;
if(Array.isArray(data17)){
const len0 = data17.length;
for(let i0=0; i0<len0; i0++){
if(!(validate260(data17[i0], {instancePath:instancePath+"/entities/" + i0,parentData:data17,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate260.errors : vErrors.concat(validate260.errors);
errors = vErrors.length;
}
}
}
else {
const err20 = {instancePath:instancePath+"/entities",schemaPath:"#/properties/entities/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.caption !== undefined){
if(typeof data.caption !== "string"){
const err21 = {instancePath:instancePath+"/caption",schemaPath:"#/properties/caption/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.caption_entities !== undefined){
let data20 = data.caption_entities;
if(Array.isArray(data20)){
const len1 = data20.length;
for(let i1=0; i1<len1; i1++){
if(!(validate260(data20[i1], {instancePath:instancePath+"/caption_entities/" + i1,parentData:data20,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate260.errors : vErrors.concat(validate260.errors);
errors = vErrors.length;
}
}
}
else {
const err22 = {instancePath:instancePath+"/caption_entities",schemaPath:"#/properties/caption_entities/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.voice !== undefined){
if(!(validate264(data.voice, {instancePath:instancePath+"/voice",parentData:data,parentDataProperty:"voice",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate264.errors : vErrors.concat(validate264.errors);
errors = vErrors.length;
}
}
if(data.audio !== undefined){
if(!(validate266(data.audio, {instancePath:instancePath+"/audio",parentData:data,parentDataProperty:"audio",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate266.errors : vErrors.concat(validate266.errors);
errors = vErrors.length;
}
}
if(data.photo !== undefined){
let data24 = data.photo;
if(Array.isArray(data24)){
const len2 = data24.length;
for(let i2=0; i2<len2; i2++){
if(!(validate268(data24[i2], {instancePath:instancePath+"/photo/" + i2,parentData:data24,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate268.errors : vErrors.concat(validate268.errors);
errors = vErrors.length;
}
}
}
else {
const err23 = {instancePath:instancePath+"/photo",schemaPath:"#/properties/photo/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.document !== undefined){
if(!(validate270(data.document, {instancePath:instancePath+"/document",parentData:data,parentDataProperty:"document",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate270.errors : vErrors.concat(validate270.errors);
errors = vErrors.length;
}
}
if(data.new_chat_members !== undefined){
let data27 = data.new_chat_members;
if(Array.isArray(data27)){
const len3 = data27.length;
for(let i3=0; i3<len3; i3++){
if(!(validate254(data27[i3], {instancePath:instancePath+"/new_chat_members/" + i3,parentData:data27,parentDataProperty:i3,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
}
else {
const err24 = {instancePath:instancePath+"/new_chat_members",schemaPath:"#/properties/new_chat_members/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.left_chat_member !== undefined){
if(!(validate254(data.left_chat_member, {instancePath:instancePath+"/left_chat_member",parentData:data,parentDataProperty:"left_chat_member",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate254.errors : vErrors.concat(validate254.errors);
errors = vErrors.length;
}
}
if(data.new_chat_title !== undefined){
if(typeof data.new_chat_title !== "string"){
const err25 = {instancePath:instancePath+"/new_chat_title",schemaPath:"#/properties/new_chat_title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.group_chat_created !== undefined){
if(typeof data.group_chat_created !== "boolean"){
const err26 = {instancePath:instancePath+"/group_chat_created",schemaPath:"#/properties/group_chat_created/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.supergroup_chat_created !== undefined){
if(typeof data.supergroup_chat_created !== "boolean"){
const err27 = {instancePath:instancePath+"/supergroup_chat_created",schemaPath:"#/properties/supergroup_chat_created/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data.migrate_to_chat_id !== undefined){
let data33 = data.migrate_to_chat_id;
if(!(((typeof data33 == "number") && (!(data33 % 1) && !isNaN(data33))) && (isFinite(data33)))){
const err28 = {instancePath:instancePath+"/migrate_to_chat_id",schemaPath:"#/properties/migrate_to_chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.migrate_from_chat_id !== undefined){
let data34 = data.migrate_from_chat_id;
if(!(((typeof data34 == "number") && (!(data34 % 1) && !isNaN(data34))) && (isFinite(data34)))){
const err29 = {instancePath:instancePath+"/migrate_from_chat_id",schemaPath:"#/properties/migrate_from_chat_id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.reply_markup !== undefined){
if(!(validate287(data.reply_markup, {instancePath:instancePath+"/reply_markup",parentData:data,parentDataProperty:"reply_markup",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate287.errors : vErrors.concat(validate287.errors);
errors = vErrors.length;
}
}
}
else {
const err30 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
validate344.errors = vErrors;
return errors === 0;
}
validate344.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateUser = validate358;

function validate358(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate358.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.is_bot === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "is_bot"},message:"must have required property '"+"is_bot"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.first_name === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "first_name"},message:"must have required property '"+"first_name"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema89.properties, key0))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err4 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.is_bot !== undefined){
if(typeof data.is_bot !== "boolean"){
const err5 = {instancePath:instancePath+"/is_bot",schemaPath:"#/properties/is_bot/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.first_name !== undefined){
if(typeof data.first_name !== "string"){
const err6 = {instancePath:instancePath+"/first_name",schemaPath:"#/properties/first_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.last_name !== undefined){
if(typeof data.last_name !== "string"){
const err7 = {instancePath:instancePath+"/last_name",schemaPath:"#/properties/last_name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.username !== undefined){
if(typeof data.username !== "string"){
const err8 = {instancePath:instancePath+"/username",schemaPath:"#/properties/username/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.language_code !== undefined){
if(typeof data.language_code !== "string"){
const err9 = {instancePath:instancePath+"/language_code",schemaPath:"#/properties/language_code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.is_premium !== undefined){
if(typeof data.is_premium !== "boolean"){
const err10 = {instancePath:instancePath+"/is_premium",schemaPath:"#/properties/is_premium/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.added_to_attachment_menu !== undefined){
if(typeof data.added_to_attachment_menu !== "boolean"){
const err11 = {instancePath:instancePath+"/added_to_attachment_menu",schemaPath:"#/properties/added_to_attachment_menu/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.can_join_groups !== undefined){
if(typeof data.can_join_groups !== "boolean"){
const err12 = {instancePath:instancePath+"/can_join_groups",schemaPath:"#/properties/can_join_groups/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.can_read_all_group_messages !== undefined){
if(typeof data.can_read_all_group_messages !== "boolean"){
const err13 = {instancePath:instancePath+"/can_read_all_group_messages",schemaPath:"#/properties/can_read_all_group_messages/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.supports_inline_queries !== undefined){
if(typeof data.supports_inline_queries !== "boolean"){
const err14 = {instancePath:instancePath+"/supports_inline_queries",schemaPath:"#/properties/supports_inline_queries/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.can_connect_to_business !== undefined){
if(typeof data.can_connect_to_business !== "boolean"){
const err15 = {instancePath:instancePath+"/can_connect_to_business",schemaPath:"#/properties/can_connect_to_business/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.has_main_web_app !== undefined){
if(typeof data.has_main_web_app !== "boolean"){
const err16 = {instancePath:instancePath+"/has_main_web_app",schemaPath:"#/properties/has_main_web_app/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
validate358.errors = vErrors;
return errors === 0;
}
validate358.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const telegramUpdateVoice = validate359;

function validate359(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate359.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.file_id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_id"},message:"must have required property '"+"file_id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.file_unique_id === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "file_unique_id"},message:"must have required property '"+"file_unique_id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.duration === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "duration"},message:"must have required property '"+"duration"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "file_id") || (key0 === "file_unique_id")) || (key0 === "file_size")) || (key0 === "duration")) || (key0 === "mime_type"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.file_id !== undefined){
if(typeof data.file_id !== "string"){
const err4 = {instancePath:instancePath+"/file_id",schemaPath:"#/properties/file_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.file_unique_id !== undefined){
if(typeof data.file_unique_id !== "string"){
const err5 = {instancePath:instancePath+"/file_unique_id",schemaPath:"#/properties/file_unique_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.file_size !== undefined){
let data2 = data.file_size;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err6 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err7 = {instancePath:instancePath+"/file_size",schemaPath:"#/properties/file_size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.duration !== undefined){
let data3 = data.duration;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err8 = {instancePath:instancePath+"/duration",schemaPath:"#/properties/duration/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err9 = {instancePath:instancePath+"/duration",schemaPath:"#/properties/duration/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.mime_type !== undefined){
if(typeof data.mime_type !== "string"){
const err10 = {instancePath:instancePath+"/mime_type",schemaPath:"#/properties/mime_type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate359.errors = vErrors;
return errors === 0;
}
validate359.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const templateParams = validate116;
const schema53 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/template-params.json","title":"TemplateParams","description":"Parametrik şablon varyantının parametreleri (question-item.template ile aynı biçim: {id, params}); seed ile aynı varyant yeniden üretilir. Değerler: sayı, metin, mantıksal, null, bunların düz dizisi ya da bir düzey düz nesne (ör. {\"kesir1\": {\"pay\": 1, \"payda\": 2}}); iki düzey iç içe nesne düşer.","x-version":"1.0","type":"object","additionalProperties":false,"required":["id","params"],"properties":{"schema_version":{"const":"1.0"},"id":{"type":"string","pattern":"^[a-z0-9]+(-[a-z0-9]+)*$","examples":["kesir-modeli-toplama"]},"seed":{"type":"integer","minimum":0},"params":{"type":"object","minProperties":1,"propertyNames":{"pattern":"^[a-z_][a-z0-9_]*$"},"additionalProperties":{"$ref":"#/$defs/value"}}},"$defs":{"scalar":{"type":["number","string","boolean","null"]},"leaf":{"oneOf":[{"$ref":"#/$defs/scalar"},{"type":"array","maxItems":12,"items":{"$ref":"#/$defs/scalar"}}]},"value":{"oneOf":[{"$ref":"#/$defs/leaf"},{"type":"object","minProperties":1,"maxProperties":12,"propertyNames":{"pattern":"^[a-z_][a-z0-9_]*$"},"additionalProperties":{"$ref":"#/$defs/leaf"}}]}}};
const pattern17 = new RegExp("^[a-z0-9]+(-[a-z0-9]+)*$", "u");

function validate117(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate117.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate118(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
else {
var items0 = validate118.evaluated.items;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(Object.keys(data).length > 12){
const err0 = {instancePath,schemaPath:"#/oneOf/1/maxProperties",keyword:"maxProperties",params:{limit: 12},message:"must NOT have more than 12 properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(Object.keys(data).length < 1){
const err1 = {instancePath,schemaPath:"#/oneOf/1/minProperties",keyword:"minProperties",params:{limit: 1},message:"must NOT have fewer than 1 properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
const _errs4 = errors;
if(typeof key0 === "string"){
if(!pattern18.test(key0)){
const err2 = {instancePath,schemaPath:"#/oneOf/1/propertyNames/pattern",keyword:"pattern",params:{pattern: "^[a-z_][a-z0-9_]*$"},message:"must match pattern \""+"^[a-z_][a-z0-9_]*$"+"\"",propertyName:key0};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
var valid1 = _errs4 === errors;
if(!valid1){
const err3 = {instancePath,schemaPath:"#/oneOf/1/propertyNames",keyword:"propertyNames",params:{propertyName: key0},message:"property name must be valid"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
for(const key1 in data){
if(!(validate118(data[key1], {instancePath:instancePath+"/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data,parentDataProperty:key1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
var _valid0 = _errs2 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
var props0 = true;
}
}
if(!valid0){
const err5 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate117.errors = vErrors;
evaluated0.props = props0;
evaluated0.items = items0;
return errors === 0;
}
validate117.evaluated = {"dynamicProps":true,"dynamicItems":true};


function validate116(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/template-params.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate116.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.params === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "params"},message:"must have required property '"+"params"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "schema_version") || (key0 === "id")) || (key0 === "seed")) || (key0 === "params"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err3 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.id !== undefined){
let data1 = data.id;
if(typeof data1 === "string"){
if(!pattern17.test(data1)){
const err4 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/pattern",keyword:"pattern",params:{pattern: "^[a-z0-9]+(-[a-z0-9]+)*$"},message:"must match pattern \""+"^[a-z0-9]+(-[a-z0-9]+)*$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.seed !== undefined){
let data2 = data.seed;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err6 = {instancePath:instancePath+"/seed",schemaPath:"#/properties/seed/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err7 = {instancePath:instancePath+"/seed",schemaPath:"#/properties/seed/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.params !== undefined){
let data3 = data.params;
if(data3 && typeof data3 == "object" && !Array.isArray(data3)){
if(Object.keys(data3).length < 1){
const err8 = {instancePath:instancePath+"/params",schemaPath:"#/properties/params/minProperties",keyword:"minProperties",params:{limit: 1},message:"must NOT have fewer than 1 properties"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
for(const key1 in data3){
const _errs9 = errors;
if(typeof key1 === "string"){
if(!pattern18.test(key1)){
const err9 = {instancePath:instancePath+"/params",schemaPath:"#/properties/params/propertyNames/pattern",keyword:"pattern",params:{pattern: "^[a-z_][a-z0-9_]*$"},message:"must match pattern \""+"^[a-z_][a-z0-9_]*$"+"\"",propertyName:key1};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
var valid1 = _errs9 === errors;
if(!valid1){
const err10 = {instancePath:instancePath+"/params",schemaPath:"#/properties/params/propertyNames",keyword:"propertyNames",params:{propertyName: key1},message:"property name must be valid"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
for(const key2 in data3){
if(!(validate117(data3[key2], {instancePath:instancePath+"/params/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data3,parentDataProperty:key2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate117.errors : vErrors.concat(validate117.errors);
errors = vErrors.length;
}
}
}
else {
const err11 = {instancePath:instancePath+"/params",schemaPath:"#/properties/params/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate116.errors = vErrors;
return errors === 0;
}
validate116.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const templateParamsLeaf = validate360;

function validate360(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate360.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate119(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate119.errors : vErrors.concat(validate119.errors);
errors = vErrors.length;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs2 = errors;
if(Array.isArray(data)){
if(data.length > 12){
const err0 = {instancePath,schemaPath:"#/oneOf/1/maxItems",keyword:"maxItems",params:{limit: 12},message:"must NOT have more than 12 items"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
const len0 = data.length;
for(let i0=0; i0<len0; i0++){
if(!(validate119(data[i0], {instancePath:instancePath+"/" + i0,parentData:data,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate119.errors : vErrors.concat(validate119.errors);
errors = vErrors.length;
}
}
}
else {
const err1 = {instancePath,schemaPath:"#/oneOf/1/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
var _valid0 = _errs2 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
var items0 = true;
}
}
if(!valid0){
const err2 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate360.errors = vErrors;
evaluated0.items = items0;
return errors === 0;
}
validate360.evaluated = {"dynamicProps":false,"dynamicItems":true};

export const templateParamsScalar = validate363;

function validate363(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate363.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((((!((typeof data == "number") && (isFinite(data)))) && (typeof data !== "string")) && (typeof data !== "boolean")) && (data !== null)){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: schema56.type},message:"must be number,string,boolean,null"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate363.errors = vErrors;
return errors === 0;
}
validate363.evaluated = {"dynamicProps":false,"dynamicItems":false};

export const templateParamsValue = validate364;

function validate364(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate364.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate118(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
else {
var items0 = validate118.evaluated.items;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(Object.keys(data).length > 12){
const err0 = {instancePath,schemaPath:"#/oneOf/1/maxProperties",keyword:"maxProperties",params:{limit: 12},message:"must NOT have more than 12 properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(Object.keys(data).length < 1){
const err1 = {instancePath,schemaPath:"#/oneOf/1/minProperties",keyword:"minProperties",params:{limit: 1},message:"must NOT have fewer than 1 properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
const _errs4 = errors;
if(typeof key0 === "string"){
if(!pattern18.test(key0)){
const err2 = {instancePath,schemaPath:"#/oneOf/1/propertyNames/pattern",keyword:"pattern",params:{pattern: "^[a-z_][a-z0-9_]*$"},message:"must match pattern \""+"^[a-z_][a-z0-9_]*$"+"\"",propertyName:key0};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
var valid1 = _errs4 === errors;
if(!valid1){
const err3 = {instancePath,schemaPath:"#/oneOf/1/propertyNames",keyword:"propertyNames",params:{propertyName: key0},message:"property name must be valid"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
for(const key1 in data){
if(!(validate118(data[key1], {instancePath:instancePath+"/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data,parentDataProperty:key1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate118.errors : vErrors.concat(validate118.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
var _valid0 = _errs2 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
var props0 = true;
}
}
if(!valid0){
const err5 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate364.errors = vErrors;
evaluated0.props = props0;
evaluated0.items = items0;
return errors === 0;
}
validate364.evaluated = {"dynamicProps":true,"dynamicItems":true};

export const transcript = validate367;
const schema119 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/transcript.json","title":"Transcript","description":"Ders transkripti (transcribe/diarize sahteleri ve transcripts/<id>.jsonl): konuşmacı etiketli, isimsiz bölümler. Tek bölüm transcript#/$defs/segment ile doğrulanır.","x-version":"1.0","type":"object","additionalProperties":false,"required":["segments"],"properties":{"segments":{"type":"array","minItems":1,"items":{"$ref":"#/$defs/segment"}}},"$defs":{"segment":{"type":"object","additionalProperties":false,"required":["t","speaker","text"],"properties":{"t":{"$ref":"common.json#/$defs/ts"},"t_end":{"$ref":"common.json#/$defs/ts"},"speaker":{"$ref":"common.json#/$defs/speaker"},"text":{"type":"string","minLength":1,"maxLength":4000}}}}};
const schema120 = {"type":"object","additionalProperties":false,"required":["t","speaker","text"],"properties":{"t":{"$ref":"common.json#/$defs/ts"},"t_end":{"$ref":"common.json#/$defs/ts"},"speaker":{"$ref":"common.json#/$defs/speaker"},"text":{"type":"string","minLength":1,"maxLength":4000}}};

function validate368(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate368.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.t === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.speaker === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "speaker"},message:"must have required property '"+"speaker"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.text === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "t") || (key0 === "t_end")) || (key0 === "speaker")) || (key0 === "text"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.t !== undefined){
if(!(validate81(data.t, {instancePath:instancePath+"/t",parentData:data,parentDataProperty:"t",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
}
if(data.t_end !== undefined){
if(!(validate81(data.t_end, {instancePath:instancePath+"/t_end",parentData:data,parentDataProperty:"t_end",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
}
if(data.speaker !== undefined){
if(!(validate73(data.speaker, {instancePath:instancePath+"/speaker",parentData:data,parentDataProperty:"speaker",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate73.errors : vErrors.concat(validate73.errors);
errors = vErrors.length;
}
}
if(data.text !== undefined){
let data3 = data.text;
if(typeof data3 === "string"){
if(func1(data3) > 4000){
const err4 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data3) < 1){
const err5 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate368.errors = vErrors;
return errors === 0;
}
validate368.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate367(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/transcript.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate367.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.segments === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "segments"},message:"must have required property '"+"segments"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "segments")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.segments !== undefined){
let data0 = data.segments;
if(Array.isArray(data0)){
if(data0.length < 1){
const err2 = {instancePath:instancePath+"/segments",schemaPath:"#/properties/segments/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
if(!(validate368(data0[i0], {instancePath:instancePath+"/segments/" + i0,parentData:data0,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate368.errors : vErrors.concat(validate368.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath:instancePath+"/segments",schemaPath:"#/properties/segments/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate367.errors = vErrors;
return errors === 0;
}
validate367.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const transcriptSegment = validate373;

function validate373(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate373.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.t === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.speaker === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "speaker"},message:"must have required property '"+"speaker"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.text === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "t") || (key0 === "t_end")) || (key0 === "speaker")) || (key0 === "text"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.t !== undefined){
if(!(validate81(data.t, {instancePath:instancePath+"/t",parentData:data,parentDataProperty:"t",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
}
if(data.t_end !== undefined){
if(!(validate81(data.t_end, {instancePath:instancePath+"/t_end",parentData:data,parentDataProperty:"t_end",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
}
if(data.speaker !== undefined){
if(!(validate73(data.speaker, {instancePath:instancePath+"/speaker",parentData:data,parentDataProperty:"speaker",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate73.errors : vErrors.concat(validate73.errors);
errors = vErrors.length;
}
}
if(data.text !== undefined){
let data3 = data.text;
if(typeof data3 === "string"){
if(func1(data3) > 4000){
const err4 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/maxLength",keyword:"maxLength",params:{limit: 4000},message:"must NOT have more than 4000 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data3) < 1){
const err5 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate373.errors = vErrors;
return errors === 0;
}
validate373.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const tutorReply = validate377;
const schema122 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/tutor-reply.json","title":"TutorReply","description":"Sohbetin yapılandırılmış çıktısı (zincir chat). Sunucu used_fact_ids ve detected_skill_ids'i doğrular.","x-version":"1.0","type":"object","additionalProperties":false,"required":["reply","ends_with_question","confidence","escalate","escalate_reason","detected_skill_ids","detected_misconception_tag","used_fact_ids","suggest_pool_save"],"properties":{"reply":{"type":"string","minLength":1,"maxLength":700,"description":"En çok 4 satır; emoji ve ünlem yok; yalnız **kalın** ve `kod`"},"ends_with_question":{"type":"boolean"},"hint_level":{"type":"integer","minimum":0,"maximum":3},"confidence":{"$ref":"common.json#/$defs/probability"},"escalate":{"type":"boolean"},"escalate_reason":{"oneOf":[{"type":"null"},{"enum":["bot_unsure","grade_attendance_payment","human_requested"]}]},"detected_skill_ids":{"type":"array","maxItems":2,"items":{"$ref":"common.json#/$defs/skillId"}},"detected_misconception_tag":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/tag"}]},"used_fact_ids":{"type":"array","items":{"type":"integer"},"description":"Gerçekten kullanılan olgu numaraları; sunucu bilinmeyen id'yi atar"},"suggested_buttons":{"type":"array","maxItems":3,"items":{"enum":["hint","show_solution","ask_instructor","skip","continue"]}},"suggest_pool_save":{"type":"boolean","description":"Cevap genel bir açıklamaysa content_pool adayı"}}};

function validate377(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/tutor-reply.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate377.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.reply === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "reply"},message:"must have required property '"+"reply"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.ends_with_question === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ends_with_question"},message:"must have required property '"+"ends_with_question"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.confidence === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "confidence"},message:"must have required property '"+"confidence"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.escalate === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "escalate"},message:"must have required property '"+"escalate"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.escalate_reason === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "escalate_reason"},message:"must have required property '"+"escalate_reason"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.detected_skill_ids === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "detected_skill_ids"},message:"must have required property '"+"detected_skill_ids"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.detected_misconception_tag === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "detected_misconception_tag"},message:"must have required property '"+"detected_misconception_tag"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.used_fact_ids === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "used_fact_ids"},message:"must have required property '"+"used_fact_ids"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.suggest_pool_save === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "suggest_pool_save"},message:"must have required property '"+"suggest_pool_save"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
for(const key0 in data){
if(!(func2.call(schema122.properties, key0))){
const err9 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.reply !== undefined){
let data0 = data.reply;
if(typeof data0 === "string"){
if(func1(data0) > 700){
const err10 = {instancePath:instancePath+"/reply",schemaPath:"#/properties/reply/maxLength",keyword:"maxLength",params:{limit: 700},message:"must NOT have more than 700 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func1(data0) < 1){
const err11 = {instancePath:instancePath+"/reply",schemaPath:"#/properties/reply/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/reply",schemaPath:"#/properties/reply/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.ends_with_question !== undefined){
if(typeof data.ends_with_question !== "boolean"){
const err13 = {instancePath:instancePath+"/ends_with_question",schemaPath:"#/properties/ends_with_question/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.hint_level !== undefined){
let data2 = data.hint_level;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err14 = {instancePath:instancePath+"/hint_level",schemaPath:"#/properties/hint_level/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 > 3 || isNaN(data2)){
const err15 = {instancePath:instancePath+"/hint_level",schemaPath:"#/properties/hint_level/maximum",keyword:"maximum",params:{comparison: "<=", limit: 3},message:"must be <= 3"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err16 = {instancePath:instancePath+"/hint_level",schemaPath:"#/properties/hint_level/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
if(data.confidence !== undefined){
if(!(validate69(data.confidence, {instancePath:instancePath+"/confidence",parentData:data,parentDataProperty:"confidence",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
}
if(data.escalate !== undefined){
if(typeof data.escalate !== "boolean"){
const err17 = {instancePath:instancePath+"/escalate",schemaPath:"#/properties/escalate/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.escalate_reason !== undefined){
let data5 = data.escalate_reason;
const _errs12 = errors;
let valid1 = false;
let passing0 = null;
const _errs13 = errors;
if(data5 !== null){
const err18 = {instancePath:instancePath+"/escalate_reason",schemaPath:"#/properties/escalate_reason/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
var _valid0 = _errs13 === errors;
if(_valid0){
valid1 = true;
passing0 = 0;
}
const _errs15 = errors;
if(!(((data5 === "bot_unsure") || (data5 === "grade_attendance_payment")) || (data5 === "human_requested"))){
const err19 = {instancePath:instancePath+"/escalate_reason",schemaPath:"#/properties/escalate_reason/oneOf/1/enum",keyword:"enum",params:{allowedValues: schema122.properties.escalate_reason.oneOf[1].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid0 = _errs15 === errors;
if(_valid0 && valid1){
valid1 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid1 = true;
passing0 = 1;
}
}
if(!valid1){
const err20 = {instancePath:instancePath+"/escalate_reason",schemaPath:"#/properties/escalate_reason/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
}
}
if(data.detected_skill_ids !== undefined){
let data6 = data.detected_skill_ids;
if(Array.isArray(data6)){
if(data6.length > 2){
const err21 = {instancePath:instancePath+"/detected_skill_ids",schemaPath:"#/properties/detected_skill_ids/maxItems",keyword:"maxItems",params:{limit: 2},message:"must NOT have more than 2 items"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
const len0 = data6.length;
for(let i0=0; i0<len0; i0++){
if(!(validate72(data6[i0], {instancePath:instancePath+"/detected_skill_ids/" + i0,parentData:data6,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
}
else {
const err22 = {instancePath:instancePath+"/detected_skill_ids",schemaPath:"#/properties/detected_skill_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.detected_misconception_tag !== undefined){
let data8 = data.detected_misconception_tag;
const _errs20 = errors;
let valid4 = false;
let passing1 = null;
const _errs21 = errors;
if(data8 !== null){
const err23 = {instancePath:instancePath+"/detected_misconception_tag",schemaPath:"#/properties/detected_misconception_tag/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
var _valid1 = _errs21 === errors;
if(_valid1){
valid4 = true;
passing1 = 0;
}
const _errs23 = errors;
if(!(validate75(data8, {instancePath:instancePath+"/detected_misconception_tag",parentData:data,parentDataProperty:"detected_misconception_tag",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
errors = vErrors.length;
}
var _valid1 = _errs23 === errors;
if(_valid1 && valid4){
valid4 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid4 = true;
passing1 = 1;
}
}
if(!valid4){
const err24 = {instancePath:instancePath+"/detected_misconception_tag",schemaPath:"#/properties/detected_misconception_tag/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
else {
errors = _errs20;
if(vErrors !== null){
if(_errs20){
vErrors.length = _errs20;
}
else {
vErrors = null;
}
}
}
}
if(data.used_fact_ids !== undefined){
let data9 = data.used_fact_ids;
if(Array.isArray(data9)){
const len1 = data9.length;
for(let i1=0; i1<len1; i1++){
let data10 = data9[i1];
if(!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))){
const err25 = {instancePath:instancePath+"/used_fact_ids/" + i1,schemaPath:"#/properties/used_fact_ids/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
}
else {
const err26 = {instancePath:instancePath+"/used_fact_ids",schemaPath:"#/properties/used_fact_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.suggested_buttons !== undefined){
let data11 = data.suggested_buttons;
if(Array.isArray(data11)){
if(data11.length > 3){
const err27 = {instancePath:instancePath+"/suggested_buttons",schemaPath:"#/properties/suggested_buttons/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
const len2 = data11.length;
for(let i2=0; i2<len2; i2++){
let data12 = data11[i2];
if(!(((((data12 === "hint") || (data12 === "show_solution")) || (data12 === "ask_instructor")) || (data12 === "skip")) || (data12 === "continue"))){
const err28 = {instancePath:instancePath+"/suggested_buttons/" + i2,schemaPath:"#/properties/suggested_buttons/items/enum",keyword:"enum",params:{allowedValues: schema122.properties.suggested_buttons.items.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
else {
const err29 = {instancePath:instancePath+"/suggested_buttons",schemaPath:"#/properties/suggested_buttons/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.suggest_pool_save !== undefined){
if(typeof data.suggest_pool_save !== "boolean"){
const err30 = {instancePath:instancePath+"/suggest_pool_save",schemaPath:"#/properties/suggest_pool_save/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
}
else {
const err31 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
validate377.errors = vErrors;
return errors === 0;
}
validate377.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const weeklySummary = validate381;
const schema123 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/weekly-summary.json","title":"WeeklySummary","description":"Haftalık öğrenci özeti (Katman 3): üçüncü tekil, isimsiz; metrikler SQL/Python'dan, LLM yalnız metni yazar.","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","student_ref","week_start","body","metrics","facts_used"],"properties":{"schema_version":{"const":"1.0"},"student_ref":{"$ref":"common.json#/$defs/studentRef"},"week_start":{"$ref":"common.json#/$defs/date"},"body":{"type":"string","maxLength":600,"description":"3–6 cümle, üçüncü tekil, isimsiz: ne çalıştı, nerede takıldı, ne söz verdi, moral"},"metrics":{"type":"object","additionalProperties":false,"required":["messages","questions_solved","accuracy","active_days","open_misconceptions","unanswered_questions","morale_trend"],"properties":{"messages":{"type":"integer"},"questions_solved":{"type":"integer"},"accuracy":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/probability"}]},"active_days":{"type":"integer","minimum":0,"maximum":7},"open_misconceptions":{"type":"integer"},"unanswered_questions":{"type":"integer"},"morale_trend":{"enum":["up","flat","down","unknown"]},"mastery_deltas":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["skill_id","delta"],"properties":{"skill_id":{"$ref":"common.json#/$defs/skillId"},"delta":{"type":"number","minimum":-1,"maximum":1},"reliable":{"type":"boolean"}}}}}},"facts_used":{"type":"array","items":{"type":"integer"}},"next_week_focus":{"type":"array","maxItems":3,"items":{"$ref":"common.json#/$defs/skillId"}}}};

function validate381(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/weekly-summary.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate381.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.student_ref === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "student_ref"},message:"must have required property '"+"student_ref"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.week_start === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "week_start"},message:"must have required property '"+"week_start"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.body === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "body"},message:"must have required property '"+"body"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.metrics === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "metrics"},message:"must have required property '"+"metrics"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.facts_used === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "facts_used"},message:"must have required property '"+"facts_used"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "schema_version") || (key0 === "student_ref")) || (key0 === "week_start")) || (key0 === "body")) || (key0 === "metrics")) || (key0 === "facts_used")) || (key0 === "next_week_focus"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err7 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.student_ref !== undefined){
if(!(validate74(data.student_ref, {instancePath:instancePath+"/student_ref",parentData:data,parentDataProperty:"student_ref",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors);
errors = vErrors.length;
}
}
if(data.week_start !== undefined){
if(!(validate65(data.week_start, {instancePath:instancePath+"/week_start",parentData:data,parentDataProperty:"week_start",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate65.errors : vErrors.concat(validate65.errors);
errors = vErrors.length;
}
}
if(data.body !== undefined){
let data3 = data.body;
if(typeof data3 === "string"){
if(func1(data3) > 600){
const err8 = {instancePath:instancePath+"/body",schemaPath:"#/properties/body/maxLength",keyword:"maxLength",params:{limit: 600},message:"must NOT have more than 600 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/body",schemaPath:"#/properties/body/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.metrics !== undefined){
let data4 = data.metrics;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.messages === undefined){
const err10 = {instancePath:instancePath+"/metrics",schemaPath:"#/properties/metrics/required",keyword:"required",params:{missingProperty: "messages"},message:"must have required property '"+"messages"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data4.questions_solved === undefined){
const err11 = {instancePath:instancePath+"/metrics",schemaPath:"#/properties/metrics/required",keyword:"required",params:{missingProperty: "questions_solved"},message:"must have required property '"+"questions_solved"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data4.accuracy === undefined){
const err12 = {instancePath:instancePath+"/metrics",schemaPath:"#/properties/metrics/required",keyword:"required",params:{missingProperty: "accuracy"},message:"must have required property '"+"accuracy"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data4.active_days === undefined){
const err13 = {instancePath:instancePath+"/metrics",schemaPath:"#/properties/metrics/required",keyword:"required",params:{missingProperty: "active_days"},message:"must have required property '"+"active_days"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data4.open_misconceptions === undefined){
const err14 = {instancePath:instancePath+"/metrics",schemaPath:"#/properties/metrics/required",keyword:"required",params:{missingProperty: "open_misconceptions"},message:"must have required property '"+"open_misconceptions"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data4.unanswered_questions === undefined){
const err15 = {instancePath:instancePath+"/metrics",schemaPath:"#/properties/metrics/required",keyword:"required",params:{missingProperty: "unanswered_questions"},message:"must have required property '"+"unanswered_questions"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data4.morale_trend === undefined){
const err16 = {instancePath:instancePath+"/metrics",schemaPath:"#/properties/metrics/required",keyword:"required",params:{missingProperty: "morale_trend"},message:"must have required property '"+"morale_trend"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
for(const key1 in data4){
if(!((((((((key1 === "messages") || (key1 === "questions_solved")) || (key1 === "accuracy")) || (key1 === "active_days")) || (key1 === "open_misconceptions")) || (key1 === "unanswered_questions")) || (key1 === "morale_trend")) || (key1 === "mastery_deltas"))){
const err17 = {instancePath:instancePath+"/metrics",schemaPath:"#/properties/metrics/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data4.messages !== undefined){
let data5 = data4.messages;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err18 = {instancePath:instancePath+"/metrics/messages",schemaPath:"#/properties/metrics/properties/messages/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data4.questions_solved !== undefined){
let data6 = data4.questions_solved;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err19 = {instancePath:instancePath+"/metrics/questions_solved",schemaPath:"#/properties/metrics/properties/questions_solved/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data4.accuracy !== undefined){
let data7 = data4.accuracy;
const _errs15 = errors;
let valid2 = false;
let passing0 = null;
const _errs16 = errors;
if(data7 !== null){
const err20 = {instancePath:instancePath+"/metrics/accuracy",schemaPath:"#/properties/metrics/properties/accuracy/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
var _valid0 = _errs16 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs18 = errors;
if(!(validate69(data7, {instancePath:instancePath+"/metrics/accuracy",parentData:data4,parentDataProperty:"accuracy",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate69.errors : vErrors.concat(validate69.errors);
errors = vErrors.length;
}
var _valid0 = _errs18 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err21 = {instancePath:instancePath+"/metrics/accuracy",schemaPath:"#/properties/metrics/properties/accuracy/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
else {
errors = _errs15;
if(vErrors !== null){
if(_errs15){
vErrors.length = _errs15;
}
else {
vErrors = null;
}
}
}
}
if(data4.active_days !== undefined){
let data8 = data4.active_days;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err22 = {instancePath:instancePath+"/metrics/active_days",schemaPath:"#/properties/metrics/properties/active_days/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 7 || isNaN(data8)){
const err23 = {instancePath:instancePath+"/metrics/active_days",schemaPath:"#/properties/metrics/properties/active_days/maximum",keyword:"maximum",params:{comparison: "<=", limit: 7},message:"must be <= 7"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err24 = {instancePath:instancePath+"/metrics/active_days",schemaPath:"#/properties/metrics/properties/active_days/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
if(data4.open_misconceptions !== undefined){
let data9 = data4.open_misconceptions;
if(!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))){
const err25 = {instancePath:instancePath+"/metrics/open_misconceptions",schemaPath:"#/properties/metrics/properties/open_misconceptions/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data4.unanswered_questions !== undefined){
let data10 = data4.unanswered_questions;
if(!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))){
const err26 = {instancePath:instancePath+"/metrics/unanswered_questions",schemaPath:"#/properties/metrics/properties/unanswered_questions/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data4.morale_trend !== undefined){
let data11 = data4.morale_trend;
if(!((((data11 === "up") || (data11 === "flat")) || (data11 === "down")) || (data11 === "unknown"))){
const err27 = {instancePath:instancePath+"/metrics/morale_trend",schemaPath:"#/properties/metrics/properties/morale_trend/enum",keyword:"enum",params:{allowedValues: schema123.properties.metrics.properties.morale_trend.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data4.mastery_deltas !== undefined){
let data12 = data4.mastery_deltas;
if(Array.isArray(data12)){
const len0 = data12.length;
for(let i0=0; i0<len0; i0++){
let data13 = data12[i0];
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
if(data13.skill_id === undefined){
const err28 = {instancePath:instancePath+"/metrics/mastery_deltas/" + i0,schemaPath:"#/properties/metrics/properties/mastery_deltas/items/required",keyword:"required",params:{missingProperty: "skill_id"},message:"must have required property '"+"skill_id"+"'"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(data13.delta === undefined){
const err29 = {instancePath:instancePath+"/metrics/mastery_deltas/" + i0,schemaPath:"#/properties/metrics/properties/mastery_deltas/items/required",keyword:"required",params:{missingProperty: "delta"},message:"must have required property '"+"delta"+"'"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
for(const key2 in data13){
if(!(((key2 === "skill_id") || (key2 === "delta")) || (key2 === "reliable"))){
const err30 = {instancePath:instancePath+"/metrics/mastery_deltas/" + i0,schemaPath:"#/properties/metrics/properties/mastery_deltas/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data13.skill_id !== undefined){
if(!(validate72(data13.skill_id, {instancePath:instancePath+"/metrics/mastery_deltas/" + i0+"/skill_id",parentData:data13,parentDataProperty:"skill_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data13.delta !== undefined){
let data15 = data13.delta;
if((typeof data15 == "number") && (isFinite(data15))){
if(data15 > 1 || isNaN(data15)){
const err31 = {instancePath:instancePath+"/metrics/mastery_deltas/" + i0+"/delta",schemaPath:"#/properties/metrics/properties/mastery_deltas/items/properties/delta/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data15 < -1 || isNaN(data15)){
const err32 = {instancePath:instancePath+"/metrics/mastery_deltas/" + i0+"/delta",schemaPath:"#/properties/metrics/properties/mastery_deltas/items/properties/delta/minimum",keyword:"minimum",params:{comparison: ">=", limit: -1},message:"must be >= -1"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
else {
const err33 = {instancePath:instancePath+"/metrics/mastery_deltas/" + i0+"/delta",schemaPath:"#/properties/metrics/properties/mastery_deltas/items/properties/delta/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data13.reliable !== undefined){
if(typeof data13.reliable !== "boolean"){
const err34 = {instancePath:instancePath+"/metrics/mastery_deltas/" + i0+"/reliable",schemaPath:"#/properties/metrics/properties/mastery_deltas/items/properties/reliable/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
}
else {
const err35 = {instancePath:instancePath+"/metrics/mastery_deltas/" + i0,schemaPath:"#/properties/metrics/properties/mastery_deltas/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
else {
const err36 = {instancePath:instancePath+"/metrics/mastery_deltas",schemaPath:"#/properties/metrics/properties/mastery_deltas/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
else {
const err37 = {instancePath:instancePath+"/metrics",schemaPath:"#/properties/metrics/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data.facts_used !== undefined){
let data17 = data.facts_used;
if(Array.isArray(data17)){
const len1 = data17.length;
for(let i1=0; i1<len1; i1++){
let data18 = data17[i1];
if(!(((typeof data18 == "number") && (!(data18 % 1) && !isNaN(data18))) && (isFinite(data18)))){
const err38 = {instancePath:instancePath+"/facts_used/" + i1,schemaPath:"#/properties/facts_used/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
}
else {
const err39 = {instancePath:instancePath+"/facts_used",schemaPath:"#/properties/facts_used/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
if(data.next_week_focus !== undefined){
let data19 = data.next_week_focus;
if(Array.isArray(data19)){
if(data19.length > 3){
const err40 = {instancePath:instancePath+"/next_week_focus",schemaPath:"#/properties/next_week_focus/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
const len2 = data19.length;
for(let i2=0; i2<len2; i2++){
if(!(validate72(data19[i2], {instancePath:instancePath+"/next_week_focus/" + i2,parentData:data19,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
}
else {
const err41 = {instancePath:instancePath+"/next_week_focus",schemaPath:"#/properties/next_week_focus/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
}
else {
const err42 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
validate381.errors = vErrors;
return errors === 0;
}
validate381.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};
