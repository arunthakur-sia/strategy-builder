import 'server-only'

function parseOrigins(input: string): string[] {
  return input
    .split(',')
    .map(v => v.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

const configuredOrigins = parseOrigins(
  process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000'
)

/** Env var that supplies each Wave 2 assistant id — used to tell the user exactly what to set when one is missing. */
export const WAVE2_ENV_VARS: Record<string, string> = {
  direction: 'SIAGPT_ASSISTANT_W2_STRATEGIC_DIRECTION',
  vmv: 'SIAGPT_ASSISTANT_W2_VMV',
  optionsDesign: 'SIAGPT_ASSISTANT_W2_OPTIONS_DESIGN',
  optionsEval: 'SIAGPT_ASSISTANT_W2_OPTIONS_EVAL',
  swotB: 'SIAGPT_ASSISTANT_W2_SWOT_B',
  shiftAgenda: 'SIAGPT_ASSISTANT_W2_SHIFT_AGENDA',
}

/** Env var that supplies each Wave 3 assistant id (step 5, the dashboard, has no assistant — it uses the report LLM). */
export const WAVE3_ENV_VARS: Record<string, string> = {
  strategyMap: 'SIAGPT_ASSISTANT_W3_STRATEGY_MAP',
  kpis: 'SIAGPT_ASSISTANT_W3_KPIS',
  initiatives: 'SIAGPT_ASSISTANT_W3_INITIATIVES',
  prioritisation: 'SIAGPT_ASSISTANT_W3_PRIORITISATION',
}

export const config = {
  sessionSecret: process.env.SESSION_SECRET || 'sia-dev-secret-change-in-production',
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: configuredOrigins[0] || 'http://localhost:3000',
  frontendOrigins: configuredOrigins,
  // Supabase
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  // Local file-based DB fallback
  localDb: process.env.LOCAL_DB === 'true' || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
  // SiaGPT (Claude backend)
  siagptBaseUrl: process.env.SIAGPT_BASE_URL || 'https://backend.siagpt.ai',
  siagptProjectId: process.env.SIAGPT_PROJECT_ID || process.env.NEXT_PUBLIC_SIAGPT_PROJECT_ID || '',
  oauth2TokenUrl: process.env.OAUTH2_TOKEN_URL || '',
  oauth2ClientId: process.env.OAUTH2_CLIENT_ID || '',
  oauth2ClientSecret: process.env.OAUTH2_CLIENT_SECRET || '',
  zitadelProjectId: process.env.ZITADEL_PROJECT_ID || '',
  siagptBearerToken: process.env.SIAGPT_BEARER_TOKEN || '',
  siagptMediaFolderId: process.env.SIAGPT_MEDIA_FOLDER_ID || '',
  siagptOwnerId: process.env.SIAGPT_OWNER_ID || '019cd318-5f66-7f23-a114-3400179bc75c',
  pillarAssistantIds: {
    P1: process.env.SIAGPT_ASSISTANT_P1 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_1 || '',
    P2: process.env.SIAGPT_ASSISTANT_P2 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_2 || '',
    P3: process.env.SIAGPT_ASSISTANT_P3 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_3 || '',
    P4: process.env.SIAGPT_ASSISTANT_P4 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_4 || '',
    P5: process.env.SIAGPT_ASSISTANT_P5 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_5 || '',
    P6: process.env.SIAGPT_ASSISTANT_P6 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_6 || '',
    P7: process.env.SIAGPT_ASSISTANT_P7 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_7 || '',
    P8: process.env.SIAGPT_ASSISTANT_P8 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_8 || '',
  } as Record<string, string>,
  assistantIds: {
    swot:         process.env.SIAGPT_ASSISTANT_SWOT         || '',
    strategy:     process.env.SIAGPT_ASSISTANT_STRATEGY     || '',
    chat:         process.env.SIAGPT_ASSISTANT_CHAT         || '',
    d1:           process.env.SIAGPT_ASSISTANT_D1           || '',
    d2:           process.env.SIAGPT_ASSISTANT_D2           || '',
    d3:           process.env.SIAGPT_ASSISTANT_D3           || '',
    d4:           process.env.SIAGPT_ASSISTANT_D4           || '',
    d5:           process.env.SIAGPT_ASSISTANT_D5           || '',
    d6:           process.env.SIAGPT_ASSISTANT_D6           || '',
    // Wave 1 external-analysis agents
    idiGuide:     process.env.SIAGPT_ASSISTANT_IDI_GUIDE    || '',
    idiSynth:     process.env.SIAGPT_ASSISTANT_IDI_SYNTH    || '',
    bench:        process.env.SIAGPT_ASSISTANT_BENCH        || '',
    pestel:       process.env.SIAGPT_ASSISTANT_PESTEL       || '',
    marketSizing: process.env.SIAGPT_ASSISTANT_MARKET_SIZE  || '',
    competitor:   process.env.SIAGPT_ASSISTANT_COMPETITOR   || '',
    entitySwot:   process.env.SIAGPT_ASSISTANT_ENTITY_SWOT  || process.env.SIAGPT_ASSISTANT_SWOT || '',
  } as Record<string, string>,
  // Wave 2 (Formulation) agents — one SiaGPT assistant per node in the Wave 2 flow diagram.
  wave2AssistantIds: {
    direction:     process.env.SIAGPT_ASSISTANT_W2_STRATEGIC_DIRECTION || '',
    vmv:           process.env.SIAGPT_ASSISTANT_W2_VMV                 || '',
    optionsDesign: process.env.SIAGPT_ASSISTANT_W2_OPTIONS_DESIGN      || '',
    optionsEval:   process.env.SIAGPT_ASSISTANT_W2_OPTIONS_EVAL        || '',
    swotB:         process.env.SIAGPT_ASSISTANT_W2_SWOT_B              || '',
    shiftAgenda:   process.env.SIAGPT_ASSISTANT_W2_SHIFT_AGENDA        || '',
  } as Record<string, string>,
  // Wave 3 (Translation) agents — one SiaGPT assistant per agent node in the Wave 3 flow diagram.
  wave3AssistantIds: {
    strategyMap:    process.env.SIAGPT_ASSISTANT_W3_STRATEGY_MAP    || '',
    kpis:           process.env.SIAGPT_ASSISTANT_W3_KPIS            || '',
    initiatives:    process.env.SIAGPT_ASSISTANT_W3_INITIATIVES     || '',
    prioritisation: process.env.SIAGPT_ASSISTANT_W3_PRIORITISATION  || '',
  } as Record<string, string>,
  // LiteLLM gateway (OpenAI-compatible) — used to turn an approved agent conversation into an
  // exportable report and to build the Wave 3 dashboard; independent of the SiaGPT agents above.
  reportLlm: {
    baseUrl: (process.env.REPORT_LLM_BASE_URL || 'https://litellm.heka.ai/v1').replace(/\/+$/, ''),
    apiKey: process.env.REPORT_LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.REPORT_LLM_MODEL || 'bedrock-opus-4.6',
    maxTokens: Number(process.env.REPORT_LLM_MAX_TOKENS) || 128000,
  },
  isDev: (process.env.NODE_ENV || 'development') === 'development',
}
