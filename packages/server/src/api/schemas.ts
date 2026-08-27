/** Fastify JSON schemas for request validation. */

// ---- Accounts ----

export const createCustomAccountSchema = {
  type: 'object',
  required: ['name', 'email_address', 'imap_host', 'imap_user', 'imap_pass'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    provider: { type: 'string', enum: ['yahoo', 'custom'] },
    email_address: { type: 'string', minLength: 3, maxLength: 320 },
    imap_host: { type: 'string', minLength: 1, maxLength: 255 },
    imap_port: { type: 'integer', minimum: 1, maximum: 65535, default: 993 },
    imap_user: { type: 'string', minLength: 1, maxLength: 320 },
    imap_pass: { type: 'string', minLength: 1, maxLength: 1024 },
    imap_tls: { type: 'boolean', default: true },
    watch_folder: { type: 'string', maxLength: 255, default: 'INBOX' },
  },
} as const;

export const testConnectionSchema = {
  type: 'object',
  required: ['imap_host', 'imap_user', 'imap_pass'],
  additionalProperties: false,
  properties: {
    email_address: { type: 'string', maxLength: 320 },
    imap_host: { type: 'string', minLength: 1, maxLength: 255 },
    imap_port: { type: 'integer', minimum: 1, maximum: 65535, default: 993 },
    imap_user: { type: 'string', minLength: 1, maxLength: 320 },
    imap_pass: { type: 'string', minLength: 1, maxLength: 1024 },
    imap_tls: { type: 'boolean', default: true },
    watch_folder: { type: 'string', maxLength: 255, default: 'INBOX' },
  },
} as const;

export const updateAccountSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    watch_folder: { type: 'string', maxLength: 255 },
    is_active: { type: 'boolean' },
  },
} as const;

export const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

// ---- Rules ----

const filterPatternProps = {
  filter_from: { type: ['string', 'null'], maxLength: 500 },
  filter_to: { type: ['string', 'null'], maxLength: 500 },
  filter_subject: { type: ['string', 'null'], maxLength: 500 },
  filter_has_attachment: { type: ['boolean', 'null'] },
  filter_label: { type: ['string', 'null'], maxLength: 255 },
  filter_unseen_only: { type: 'boolean' },
};

export const createRuleSchema = {
  type: 'object',
  required: ['account_id', 'name', 'webhook_url'],
  additionalProperties: false,
  properties: {
    account_id: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    webhook_url: { type: 'string', minLength: 8, maxLength: 2048 },
    is_active: { type: 'boolean' },
    ...filterPatternProps,
  },
} as const;

export const updateRuleSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    webhook_url: { type: 'string', minLength: 8, maxLength: 2048 },
    is_active: { type: 'boolean' },
    ...filterPatternProps,
  },
} as const;

export const listRulesQuerySchema = {
  type: 'object',
  properties: {
    account_id: { type: 'string', maxLength: 64 },
  },
} as const;

// ---- Logs ----

export const logIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer' } },
} as const;

export const listLogsQuerySchema = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    status: { type: 'string', enum: ['pending', 'delivered', 'failed', 'retrying'] },
    account_id: { type: 'string', maxLength: 64 },
    rule_id: { type: 'string', maxLength: 64 },
    from: { type: 'string', maxLength: 40 },
    to: { type: 'string', maxLength: 40 },
  },
} as const;

export const purgeLogsQuerySchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', minimum: 0, default: 30 },
  },
} as const;
